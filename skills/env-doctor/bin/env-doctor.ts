#!/usr/bin/env -S bun run
/**
 * env-doctor — read-only pre-flight verifier for an Oh My Pi dogfood session.
 *
 * SpecSafe slice: SPEC-20260427-012 — env-doctor-skill
 *
 * Eight checklist items (a-h) run in fixed order; none mutate state.
 *
 * Usage:
 *   bun run .omp/skills/env-doctor/bin/env-doctor.ts [--strict] [--json]
 *
 * Test seams (env vars):
 *   PI_ENVDOCTOR_HONCHO_PROBE_CMD  replaces the Honcho SDK round-trip.
 *   PI_ENVDOCTOR_LINEAR_CMD        replaces `linear list --limit=1`.
 *   PI_ENVDOCTOR_GH_CMD            replaces `gh auth status`.
 *   PI_ENVDOCTOR_OMP_CMD           replaces `omp --version`.
 *
 * Exit codes:
 *   0 — all REQUIRED checks passed (OPTIONAL may SKIP)
 *   1 — at least one REQUIRED check failed
 *   2 — invocation error (unknown flag)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Status = "PASS" | "FAIL" | "SKIP";
type Key = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

type Item = {
	status: Status;
	note?: string;
};

const LABELS: Record<Key, string> = {
	a: "HONCHO_API_KEY",
	b: "HONCHO env vars",
	c: "LINEAR_API_KEY",
	d: "gh auth",
	e: "omp config",
	f: "agent symlinks",
	g: "honcho state",
	h: "agent honcho config",
};

const REQUIRED_KEYS: ReadonlySet<Key> = new Set<Key>(["a", "b", "d", "e", "f"]);
const OPTIONAL_KEYS: ReadonlySet<Key> = new Set<Key>(["c", "g", "h"]);

// ---------------------------------------------------------------------------
// Secret sanitization — mirrors .omp/tools/honcho/index.ts:69-73
// ---------------------------------------------------------------------------

function sanitize(
	text: string,
	secrets: ReadonlyArray<string | undefined>,
): string {
	let out = text;
	for (const s of secrets) {
		if (!s) continue;
		if (out.includes(s)) out = out.split(s).join("<redacted>");
	}
	return out;
}

// ---------------------------------------------------------------------------
// Honcho state-file parsing — inlined from .omp/hooks/specsafe-session.ts
// (intentionally non-quarantining: env-doctor is read-only)
// ---------------------------------------------------------------------------

type ParseResult =
	| { kind: "absent" }
	| { kind: "ok" }
	| { kind: "fail"; reason: string };

function parseStateFile(filePath: string): ParseResult {
	if (!fs.existsSync(filePath)) return { kind: "absent" };
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return { kind: "fail", reason: "parse error: not a JSON object" };
		}
		if (
			!("currentSlice" in parsed) ||
			!Array.isArray((parsed as { history?: unknown }).history)
		) {
			return { kind: "fail", reason: "parse error: missing required fields" };
		}
		return { kind: "ok" };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { kind: "fail", reason: `parse error: ${msg}` };
	}
}

function parseAgentHonchoConfig(filePath: string): ParseResult {
	if (!fs.existsSync(filePath)) return { kind: "absent" };
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return { kind: "fail", reason: "parse error: not a JSON object" };
		}
		// mode 0600 spot-check (best-effort; some filesystems strip mode bits).
		try {
			const st = fs.statSync(filePath);
			const perm = st.mode & 0o777;
			if (perm !== 0o600 && process.platform !== "win32") {
				return {
					kind: "fail",
					reason: `mode ${perm.toString(8)} (expected 0600)`,
				};
			}
		} catch {
			// stat failure is non-fatal; we already read the file.
		}
		return { kind: "ok" };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { kind: "fail", reason: `parse error: ${msg}` };
	}
}

// ---------------------------------------------------------------------------
// Probe runners
// ---------------------------------------------------------------------------

type ProbeOutput = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

// Derive the per-cwd session id used by the omp shell function (slice-008.6
// wiring: workspace=oh-my-pi, session=<peer>-<basename-of-cwd>). Used as a
// fallback when HONCHO_SESSION_ID is not set in the calling shell, which is
// the common case when env-doctor is invoked outside the omp wrapper.
function deriveSessionId(env: NodeJS.ProcessEnv): string {
	const rawPeer = env.HONCHO_PEER_NAME ?? env.HONCHO_PEER_ID ?? "luci";
	const peer = rawPeer.toLowerCase();
	return `${peer}-${path.basename(process.cwd())}`;
}

// Locate the omp binary. The omp shell function adds bun's global bin to
// PATH, but a child subprocess spawned from `bun run ...` may not see that
// addition, and bun's global bin location varies by system (XDG_CACHE_HOME
// convention, BUN_INSTALL override, mise-managed bun, etc.).
// Resolution order:
//   (a) PATH lookup via `command -v omp`
//   (b) `bun pm bin -g` -- bun's authoritative global-bin path
//   (c) BUN_INSTALL env var
//   (d) Well-known fallback constants
function findOmpBinary(env: NodeJS.ProcessEnv): string | null {
	const which = spawnSync("sh", ["-c", "command -v omp"], {
		encoding: "utf-8",
		env,
	});
	if (which.status === 0) {
		const found = (which.stdout ?? "").trim();
		if (found && fs.existsSync(found)) return found;
	}
	const pmBin = spawnSync("bun", ["pm", "bin", "-g"], {
		encoding: "utf-8",
		env,
	});
	if (pmBin.status === 0) {
		const dir = (pmBin.stdout ?? "").trim();
		if (dir) {
			const candidate = path.join(dir, "omp");
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	const home = os.homedir();
	const bunInstall = env.BUN_INSTALL;
	const candidates = [
		...(bunInstall ? [path.join(bunInstall, "bin", "omp")] : []),
		path.join(home, ".bun", "bin", "omp"),
		path.join(home, ".cache", ".bun", "bin", "omp"),
		path.join(home, ".cache", "bun", "bin", "omp"),
		path.join(home, ".local", "share", "bun", "bin", "omp"),
		path.join(home, ".bun", "install", "global", "node_modules", ".bin", "omp"),
		"/usr/local/bin/omp",
	];
	for (const c of candidates) {
		if (fs.existsSync(c)) return c;
	}
	return null;
}

function runStub(cmd: string, args: string[] = []): ProbeOutput {
	const r = spawnSync(cmd, args, { encoding: "utf-8" });
	return {
		exitCode: r.status ?? (r.error ? 1 : 0),
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? (r.error ? String(r.error) : ""),
	};
}

function checkHonchoProbe(env: NodeJS.ProcessEnv, secrets: string[]): Item {
	const apiKey = env.HONCHO_API_KEY;
	if (!apiKey) return { status: "FAIL", note: "missing HONCHO_API_KEY" };
	const stubCmd = env.PI_ENVDOCTOR_HONCHO_PROBE_CMD;
	let probe: ProbeOutput;
	if (stubCmd) {
		probe = runStub(stubCmd);
	} else {
		const probeEnv = env.HONCHO_SESSION_ID
			? env
			: ({
					...env,
					HONCHO_SESSION_ID: deriveSessionId(env),
				} as NodeJS.ProcessEnv);
		probe = runRealHonchoProbe(probeEnv);
	}
	const combinedRaw = `${probe.stdout}\n${probe.stderr}`;
	const combined = sanitize(combinedRaw, secrets);
	const lower = combinedRaw.toLowerCase();

	const sessionNotFound =
		lower.includes("session-not-found") ||
		lower.includes("session_not_found") ||
		lower.includes("not_found") ||
		lower.includes("session not found") ||
		lower.includes(" 404");

	if (sessionNotFound) {
		return { status: "PASS", note: "auth OK (session not found)" };
	}
	if (probe.exitCode === 0) {
		return { status: "PASS", note: "auth OK" };
	}
	const m = combinedRaw.match(/\b(40[0-9])\b/);
	const code = m ? m[1] : null;
	const firstLine =
		combined.trim().split(/\r?\n/)[0]?.slice(0, 200) || "probe failed";
	const note = code ? `${code}: ${firstLine}` : `probe failed: ${firstLine}`;
	return { status: "FAIL", note };
}

function runRealHonchoProbe(env: NodeJS.ProcessEnv): ProbeOutput {
	// Real-network path; tests always use the stub. We invoke the SDK via a
	// short bun subprocess so failures are isolated and timeouts can be bounded.
	try {
		// Inline child-script: import @honcho-ai/sdk and run a single search.
		const script = `
			import { Honcho } from "@honcho-ai/sdk";
			const c = new Honcho({
				apiKey: process.env.HONCHO_API_KEY,
				workspaceId: process.env.HONCHO_WORKSPACE_ID,
				...(process.env.HONCHO_BASE_URL ? { baseURL: process.env.HONCHO_BASE_URL } : {}),
			});
			(async () => {
				try {
					const s = await c.session(process.env.HONCHO_SESSION_ID);
					await s.search("__envdoctor_probe__");
					process.stdout.write("ok");
				} catch (e) {
					const msg = (e && e.message) ? e.message : String(e);
					process.stderr.write(msg);
					process.exit(/40[13]/.test(msg) ? 1 : (/not.?found/i.test(msg) ? 0 : 1));
				}
			})();
		`;
		const r = spawnSync("bun", ["-e", script], {
			encoding: "utf-8",
			env: { ...env } as NodeJS.ProcessEnv,
			timeout: 15_000,
		});
		return {
			exitCode: r.status ?? 1,
			stdout: r.stdout ?? "",
			stderr: r.stderr ?? "",
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { exitCode: 1, stdout: "", stderr: msg };
	}
}

function checkHonchoEnvVars(env: NodeJS.ProcessEnv): Item {
	const required = ["HONCHO_WORKSPACE_ID", "HONCHO_PEER_ID"] as const;
	const missing = required.filter((k) => !env[k]);
	if (missing.length > 0) {
		return { status: "FAIL", note: `missing: ${missing.join(", ")}` };
	}
	if (!env.HONCHO_SESSION_ID) {
		const derived = deriveSessionId(env);
		return {
			status: "PASS",
			note: `HONCHO_SESSION_ID auto-derived: ${derived}`,
		};
	}
	return { status: "PASS" };
}

function checkLinear(
	env: NodeJS.ProcessEnv,
	strict: boolean,
	secrets: string[],
): Item {
	const key = env.LINEAR_API_KEY;
	if (!key) {
		return strict
			? { status: "FAIL", note: "missing LINEAR_API_KEY (--strict)" }
			: { status: "SKIP", note: "LINEAR_API_KEY not set" };
	}
	const stubCmd = env.PI_ENVDOCTOR_LINEAR_CMD;
	let probe: ProbeOutput;
	if (stubCmd) {
		probe = runStub(stubCmd);
	} else {
		probe = runStub("bun", [
			"run",
			path.resolve(process.cwd(), ".omp/skills/linear/bin/linear.ts"),
			"list",
			"--limit=1",
		]);
	}
	if (probe.exitCode === 0) return { status: "PASS" };
	const firstLine =
		sanitize(probe.stderr || probe.stdout || "linear probe failed", secrets)
			.trim()
			.split(/\r?\n/)[0]
			?.slice(0, 200) || "linear probe failed";
	return { status: "FAIL", note: firstLine };
}

function checkGhAuth(env: NodeJS.ProcessEnv, secrets: string[]): Item {
	const stubCmd = env.PI_ENVDOCTOR_GH_CMD;
	const probe = stubCmd ? runStub(stubCmd) : runStub("gh", ["auth", "status"]);
	if (probe.exitCode === 0) return { status: "PASS" };
	const firstLine =
		sanitize(probe.stderr || probe.stdout || "gh auth failed", secrets)
			.trim()
			.split(/\r?\n/)[0]
			?.slice(0, 200) || "gh auth failed";
	return { status: "FAIL", note: firstLine };
}

function checkOmpConfig(env: NodeJS.ProcessEnv, secrets: string[]): Item {
	const stubCmd = env.PI_ENVDOCTOR_OMP_CMD;
	let probe: ProbeOutput;
	if (stubCmd) {
		probe = runStub(stubCmd);
	} else {
		const found = findOmpBinary(env);
		if (!found) {
			return {
				status: "FAIL",
				note: "omp binary not found on PATH or in ~/.bun/bin (set PI_ENVDOCTOR_OMP_CMD or `bun link -g`)",
			};
		}
		probe = runStub(found, ["--version"]);
	}
	if (probe.exitCode === 0) return { status: "PASS" };
	const firstLine =
		sanitize(probe.stderr || probe.stdout || "omp config failed", secrets)
			.trim()
			.split(/\r?\n/)[0]
			?.slice(0, 200) || "omp config failed";
	return { status: "FAIL", note: firstLine };
}

function checkAgentSymlinks(cwd: string): Item {
	const home = os.homedir();
	const names = ["hooks", "tools", "agents", "skills"] as const;
	const failures: string[] = [];
	for (const name of names) {
		const linkPath = path.join(home, ".omp", "agent", name);
		const expected = path.resolve(cwd, ".omp", name);
		try {
			const real = fs.realpathSync(linkPath);
			const expectedReal = fs.realpathSync(expected);
			if (real !== expectedReal) {
				failures.push(`${name} -> ${real} (expected ${expectedReal})`);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			failures.push(`${name}: ${msg}`);
		}
	}
	if (failures.length === 0) return { status: "PASS" };
	return { status: "FAIL", note: failures.join("; ") };
}

function checkHonchoState(cwd: string, strict: boolean): Item {
	const filePath = path.join(cwd, ".pi", ".honcho-state.json");
	const r = parseStateFile(filePath);
	if (r.kind === "absent") {
		return strict
			? { status: "FAIL", note: ".pi/.honcho-state.json absent (--strict)" }
			: { status: "SKIP", note: ".pi/.honcho-state.json absent" };
	}
	if (r.kind === "fail") return { status: "FAIL", note: r.reason };
	return { status: "PASS" };
}

function checkAgentHonchoConfig(strict: boolean): Item {
	const filePath = path.join(os.homedir(), ".omp", "agent", "honcho.json");
	const r = parseAgentHonchoConfig(filePath);
	if (r.kind === "absent") {
		return strict
			? { status: "FAIL", note: "~/.omp/agent/honcho.json absent (--strict)" }
			: { status: "SKIP", note: "~/.omp/agent/honcho.json absent" };
	}
	if (r.kind === "fail") return { status: "FAIL", note: r.reason };
	return { status: "PASS" };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(
	argv: string[],
): { strict: boolean; json: boolean } | { error: string } {
	let strict = false;
	let json = false;
	for (const a of argv) {
		if (a === "--strict") strict = true;
		else if (a === "--json") json = true;
		else if (a === "--help" || a === "-h") {
			// Treat help as invocation error so the caller can branch; tests don't hit this.
			return { error: `help requested` };
		} else {
			return { error: `unknown flag: ${a}` };
		}
	}
	return { strict, json };
}

function main(): number {
	const parsed = parseArgs(process.argv.slice(2));
	if ("error" in parsed) {
		process.stderr.write(`env-doctor: ${parsed.error}\n`);
		return 2;
	}
	const { strict, json } = parsed;
	const env = process.env;
	const secrets = [env.HONCHO_API_KEY, env.LINEAR_API_KEY].filter(
		(s): s is string => typeof s === "string" && s.length > 0,
	);
	const cwd = process.cwd();

	const results: Record<Key, Item> = {
		a: checkHonchoProbe(env, secrets),
		b: checkHonchoEnvVars(env),
		c: checkLinear(env, strict, secrets),
		d: checkGhAuth(env, secrets),
		e: checkOmpConfig(env, secrets),
		f: checkAgentSymlinks(cwd),
		g: checkHonchoState(cwd, strict),
		h: checkAgentHonchoConfig(strict),
	};

	// Final sanitization pass — every note string scrubbed of any secret.
	for (const k of Object.keys(results) as Key[]) {
		const item = results[k];
		if (item.note) item.note = sanitize(item.note, secrets);
	}

	// Any FAIL — required or optional — is fatal. OPTIONAL only governs whether
	// an absent prerequisite SKIPs (default) or FAILs (--strict); once an
	// optional check has actually failed (e.g. a corrupt state file), that's a
	// real fault and exit 1 regardless of --strict.
	const anyFail = (Object.keys(results) as Key[]).some(
		(k) => results[k].status === "FAIL",
	);
	const exitCode = anyFail ? 1 : 0;

	if (json) {
		const payload: Record<string, Item> = {};
		for (const k of Object.keys(results) as Key[]) {
			payload[k] = results[k];
		}
		process.stdout.write(JSON.stringify(payload));
		return exitCode;
	}

	const lines: string[] = [];
	for (const k of Object.keys(results) as Key[]) {
		const item = results[k];
		const noteSuffix = item.note ? ` — ${item.note}` : "";
		lines.push(`${LABELS[k]}: ${item.status}${noteSuffix}`);
	}
	process.stdout.write(`${lines.join("\n")}\n`);
	return exitCode;
}

if (import.meta.main) {
	process.exit(main());
}

export { main, sanitize, parseStateFile, parseAgentHonchoConfig };

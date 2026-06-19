#!/usr/bin/env -S bun run
/**
 * env-doctor — read-only pre-flight verifier for an Oh My Pi dogfood session.
 *
 * SpecSafe slice: SPEC-20260427-012 — env-doctor-skill
 *
 * Five checklist items (a-e) run in fixed order; none mutate state.
 *
 * Usage:
 *   bun run .omp/skills/env-doctor/bin/env-doctor.ts [--strict] [--json]
 *
 * Test seams (env vars):
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
type Key = "a" | "b" | "c" | "d" | "e";

type Item = {
	status: Status;
	note?: string;
};

const LABELS: Record<Key, string> = {
	a: "LINEAR_API_KEY",
	b: "gh auth",
	c: "omp config",
	d: "agent symlinks",
	e: "SpecSafe state",
};

const ALL_KEYS: readonly Key[] = ["a", "b", "c", "d", "e"];

// ---------------------------------------------------------------------------
// Secret sanitization — currently only LINEAR_API_KEY is probe-sensitive.
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
// SpecSafe state-file parsing — inlined from .omp/hooks/specsafe-session.ts
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
		if (!("currentSlice" in parsed) || !("history" in parsed)) {
			return { kind: "fail", reason: "parse error: missing required fields" };
		}
		if (!Array.isArray(parsed.history)) {
			return { kind: "fail", reason: "parse error: history is not an array" };
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

function checkSpecSafeState(cwd: string, strict: boolean): Item {
	const filePath = path.join(cwd, ".pi", ".specsafe-state.json");
	const r = parseStateFile(filePath);
	if (r.kind === "absent") {
		return strict
			? { status: "FAIL", note: ".pi/.specsafe-state.json absent (--strict)" }
			: { status: "SKIP", note: ".pi/.specsafe-state.json absent" };
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
	const secrets = [env.LINEAR_API_KEY].filter(
		(s): s is string => typeof s === "string" && s.length > 0,
	);
	const cwd = process.cwd();

	const results: Record<Key, Item> = {
		a: checkLinear(env, strict, secrets),
		b: checkGhAuth(env, secrets),
		c: checkOmpConfig(env, secrets),
		d: checkAgentSymlinks(cwd),
		e: checkSpecSafeState(cwd, strict),
	};

	// Final sanitization pass — every note string scrubbed of any secret.
	for (const k of ALL_KEYS) {
		const item = results[k];
		if (item.note) item.note = sanitize(item.note, secrets);
	}

	// Any FAIL — required or optional — is fatal. OPTIONAL only governs whether
	// an absent prerequisite SKIPs (default) or FAILs (--strict); once an
	// optional check has actually failed (e.g. a corrupt state file), that's a
	// real fault and exit 1 regardless of --strict.
	const anyFail = ALL_KEYS.some((k) => results[k].status === "FAIL");
	const exitCode = anyFail ? 1 : 0;

	if (json) {
		const payload: Record<string, Item> = {};
		for (const k of ALL_KEYS) {
			payload[k] = results[k];
		}
		process.stdout.write(JSON.stringify(payload));
		return exitCode;
	}

	const lines: string[] = [];
	for (const k of ALL_KEYS) {
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

export { main, sanitize, parseStateFile };

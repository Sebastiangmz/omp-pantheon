#!/usr/bin/env -S bun run
/**
 * coherence — read-only cross-source consistency checker.
 *
 * SpecSafe slice: SPEC-20260427-011 — coherence-skill
 *
 * Surfaces drift between Linear issue state, SpecSafe slice files, and
 * commit `Spec-Slice:` trailers. No mutations, no `--i-approve` gate.
 *
 * Subcommands:
 *   coherence check linear-vs-specs
 *   coherence check trailers-vs-linear [--range=<git-range>]
 *   coherence check brief-coverage
 *
 * Exit codes:
 *   0  all clean
 *   1  drift detected (one line per item on stdout, prefixed with [category])
 *   2  config or usage error (single-line stderr notice, no stdout)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Mirrors the github skill's branch-name parser: anchors on a Linear-style key
// (e.g. CUR-92) optionally followed by a `-suffix` or `_suffix` slug.
const LINEAR_KEY_RE = /^([A-Z]+-[0-9]+)([-_].*)?$/;

const OPEN_STATES = new Set(["in_progress", "in_review"]);
const STALE_STATES = new Set(["triage"]);

const USAGE = `usage: coherence check <subcommand> [options]

Subcommands:
  linear-vs-specs                       compare Linear open tickets to specs/<KEY>*.md
  trailers-vs-linear [--range=<range>]  compare Spec-Slice: trailers to Linear state
  brief-coverage                        compare Linear open tickets to specs/briefs/<KEY>*.md`;

// ---------------------------------------------------------------------------
// Linear invocation
// ---------------------------------------------------------------------------

type LinearResult = { stdout: string; stderr: string; status: number };

function runLinear(subArgs: string[], cwd: string): LinearResult {
	const stub = process.env.PI_COHERENCE_LINEAR_CMD;
	let cmd: string;
	let args: string[];
	if (stub) {
		cmd = stub;
		args = [...subArgs];
	} else {
		cmd = "bun";
		args = [
			"run",
			path.resolve(process.cwd(), ".omp/skills/linear/bin/linear.ts"),
			...subArgs,
		];
	}
	const r = spawnSync(cmd, args, {
		cwd,
		encoding: "utf-8",
		env: { ...process.env },
	});
	return {
		stdout: r.stdout ?? "",
		stderr: r.stderr ?? "",
		status: r.status ?? 1,
	};
}

// ---------------------------------------------------------------------------
// Linear list parsing
//
// `linear list` emits a fixed-width text table. We parse by header column
// positions so that multi-word state labels ("In Progress") survive intact,
// then normalize to lowercase snake_case for comparison against open-state
// tokens.
// ---------------------------------------------------------------------------

type Ticket = { key: string; state: string };

function parseLinearList(stdout: string): Ticket[] {
	const tickets: Ticket[] = [];
	const lines = stdout.split("\n");
	let headerCols: { name: string; start: number }[] | null = null;

	for (const raw of lines) {
		const line = raw.replace(/\s+$/, "");
		if (!line.trim()) continue;
		// Skip table separator rows (---) and the empty-marker.
		if (/^[-=]+$/.test(line.trim())) continue;
		if (line.trim().startsWith("(")) continue;

		if (!headerCols) {
			const tokens = [...line.matchAll(/\S+/g)];
			if (tokens.length >= 2 && tokens[0]?.[0] === "KEY") {
				headerCols = tokens.map((m) => ({
					name: m[0] ?? "",
					start: m.index ?? 0,
				}));
			}
			continue;
		}

		const cols: Record<string, string> = {};
		for (let i = 0; i < headerCols.length; i++) {
			const start = headerCols[i]?.start;
			const end =
				i + 1 < headerCols.length ? headerCols[i + 1]?.start : line.length;
			cols[headerCols[i]?.name] = line.slice(start, end).trim();
		}
		const key = cols.KEY ?? "";
		const state = (cols.STATE ?? "").toLowerCase().replace(/\s+/g, "_");
		if (key && LINEAR_KEY_RE.test(key)) {
			tickets.push({ key, state });
		}
	}
	return tickets;
}

// ---------------------------------------------------------------------------
// Linear get parsing
//
// `linear get <KEY>` emits `state: <Display> (<type>)`. We strip the
// parenthesized state-type and normalize the display label to snake_case;
// the only token we actually act on is `triage`, but the normalization keeps
// future state checks symmetric with `parseLinearList`.
// ---------------------------------------------------------------------------

function parseLinearGetState(stdout: string): string {
	const m = stdout.match(/^state:\s*(.+)$/m);
	if (!m) return "";
	const noParen = m[1]?.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return noParen.toLowerCase().replace(/\s+/g, "_");
}

// ---------------------------------------------------------------------------
// Spec / brief discovery
// ---------------------------------------------------------------------------

function specKeyFromFilename(filename: string): string | null {
	const base = filename.replace(/\.md$/, "");
	const m = base.match(LINEAR_KEY_RE);
	return m?.[1] ?? null;
}

function listSpecKeys(repo: string): Set<string> {
	const dir = path.join(repo, "specs");
	if (!fs.existsSync(dir)) return new Set();
	const keys = new Set<string>();
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const k = specKeyFromFilename(entry.name);
		if (k) keys.add(k);
	}
	return keys;
}

function briefMatches(briefFiles: string[], key: string): boolean {
	// Prefix match must stop at a word boundary: <KEY>__, <KEY>-, or <KEY>.md.
	// Any other suffix would let CUR-9 falsely match CUR-92's brief.
	for (const f of briefFiles) {
		if (f === `${key}.md`) return true;
		if (
			f.startsWith(`${key}-`) ||
			f.startsWith(`${key}__`) ||
			f.startsWith(`${key}_`)
		) {
			return true;
		}
	}
	return false;
}

function listBriefFiles(repo: string): string[] {
	const dir = path.join(repo, "specs", "briefs");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Auth precondition
//
// Mirrors the github skill: missing LINEAR_API_KEY is exit 2 with a single
// stderr line and zero stdout, so CI wrappers can grep for the notice.
// ---------------------------------------------------------------------------

function emitLinearUnavailable(): number {
	process.stderr.write(
		"Linear integration unavailable: LINEAR_API_KEY not set\n",
	);
	return 2;
}

function hasLinearKey(): boolean {
	return Boolean(process.env.LINEAR_API_KEY);
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdLinearVsSpecs(repo: string): number {
	if (!hasLinearKey()) return emitLinearUnavailable();

	const r = runLinear(["list"], repo);
	if (r.status !== 0) {
		process.stderr.write(`coherence: linear list failed: ${r.stderr.trim()}\n`);
		return 2;
	}

	const tickets = parseLinearList(r.stdout);
	const open = tickets.filter((t) => OPEN_STATES.has(t.state));
	const allListedKeys = new Set(tickets.map((t) => t.key));
	const specKeys = listSpecKeys(repo);

	const drift: string[] = [];
	// orphan-linear: open ticket with no spec covering its KEY (prefix match
	// happens for free because spec filenames are reduced to their KEY).
	for (const t of open) {
		if (!specKeys.has(t.key)) {
			drift.push(`[orphan-linear] ${t.key} ${t.state}, no spec`);
		}
	}
	// orphan-spec: spec exists but no Linear ticket in any returned state.
	for (const k of specKeys) {
		if (!allListedKeys.has(k)) {
			drift.push(`[orphan-spec] ${k} has spec but no matching Linear ticket`);
		}
	}

	for (const line of drift) console.log(line);
	return drift.length === 0 ? 0 : 1;
}

function cmdTrailersVsLinear(repo: string, range: string): number {
	if (!hasLinearKey()) return emitLinearUnavailable();

	const g = spawnSync("git", ["log", range, "--format=%H%x00%B%x1e"], {
		cwd: repo,
		encoding: "utf-8",
		env: { ...process.env },
	});
	if (g.status !== 0) {
		process.stderr.write(
			`coherence: git log failed: ${(g.stderr ?? "").trim()}\n`,
		);
		return 2;
	}

	const trailerKeys = new Set<string>();
	const commits = (g.stdout ?? "").split("\x1e");
	for (const commit of commits) {
		const trimmed = commit.replace(/^\s+/, "");
		if (!trimmed) continue;
		const nul = trimmed.indexOf("\x00");
		if (nul < 0) continue;
		const body = trimmed.slice(nul + 1);
		try {
			const matches = [...body.matchAll(/^Spec-Slice:\s*(\S+)/gim)];
			if (matches.length === 0) continue;
			// Spec §4.7: take the LAST trailer.
			const last = matches[matches.length - 1]?.[1];
			if (!last) continue;
			const m = last.match(LINEAR_KEY_RE);
			const key = m?.[1];
			if (key) trailerKeys.add(key);
		} catch {}
	}

	const drift: string[] = [];
	for (const key of trailerKeys) {
		const got = runLinear(["get", key], repo);
		if (got.status !== 0) {
			drift.push(
				`[orphan-trailer] ${key} commit references unknown Linear ticket`,
			);
			continue;
		}
		const state = parseLinearGetState(got.stdout);
		if (STALE_STATES.has(state)) {
			drift.push(
				`[stale-trailer] ${key} commit trailer points to ticket in ${state}`,
			);
		}
	}

	for (const line of drift) console.log(line);
	return drift.length === 0 ? 0 : 1;
}

function cmdBriefCoverage(repo: string): number {
	if (!hasLinearKey()) return emitLinearUnavailable();

	const r = runLinear(["list"], repo);
	if (r.status !== 0) {
		process.stderr.write(`coherence: linear list failed: ${r.stderr.trim()}\n`);
		return 2;
	}

	const open = parseLinearList(r.stdout).filter((t) =>
		OPEN_STATES.has(t.state),
	);
	const briefFiles = listBriefFiles(repo);

	const drift: string[] = [];
	for (const t of open) {
		if (!briefMatches(briefFiles, t.key)) {
			drift.push(
				`[orphan-brief] ${t.key} ${t.state}, no brief in specs/briefs/`,
			);
		}
	}

	for (const line of drift) console.log(line);
	return drift.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Argv dispatch
// ---------------------------------------------------------------------------

function parseRange(rest: string[]): string {
	for (const arg of rest) {
		const m = arg.match(/^--range=(.+)$/);
		if (m?.[1]) return m[1];
	}
	return "HEAD~50..HEAD";
}

function main(argv: string[]): number {
	const cwd = process.cwd();
	const [command, sub, ...rest] = argv;

	if (command !== "check" || !sub) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}

	switch (sub) {
		case "linear-vs-specs":
			return cmdLinearVsSpecs(cwd);
		case "trailers-vs-linear":
			return cmdTrailersVsLinear(cwd, parseRange(rest));
		case "brief-coverage":
			return cmdBriefCoverage(cwd);
		default:
			process.stderr.write(`coherence: unknown subcommand: ${sub}\n${USAGE}\n`);
			return 2;
	}
}

if (import.meta.main) {
	process.exit(main(process.argv.slice(2)));
}

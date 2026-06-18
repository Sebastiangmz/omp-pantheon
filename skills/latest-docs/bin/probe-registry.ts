#!/usr/bin/env -S bun run
/**
 * probe-registry — exercise `latest-docs fetch <lib>` against every
 * unverified registry entry, log results, and (optionally) flip
 * `verified: true` for entries that fetch successfully.
 *
 * SpecSafe slice: SPEC-20260427-014 — latest-docs registry URL probe
 *
 * Usage:
 *   bun run .omp/skills/latest-docs/bin/probe-registry.ts            # dry-run preview
 *   bun run .omp/skills/latest-docs/bin/probe-registry.ts --apply    # rewrite registry
 *
 * Behavior:
 *   - Reads .pi/skills/latest-docs/registry.json (the path latest-docs uses).
 *   - For each entry not already `verified: true`, sequentially shells out to
 *     `bun run .omp/skills/latest-docs/bin/latest-docs.ts fetch <lib>` and
 *     captures the exit code. Sequential (not parallel) to dodge raw.github
 *     rate-limits (spec §6).
 *   - Prints `WOULD FLIP <lib> false→true` on exit 0 or
 *     `WOULD KEEP <lib> false (status=<exit>)` otherwise.
 *   - With `--apply`, atomically rewrites the registry: entries that probed
 *     successfully gain `verified: true`; entries that failed keep their
 *     existing `verified` value (we never downgrade `true → false`).
 *   - Appends one JSONL line per probed entry to `.pi/.docs-registry-log.jsonl`
 *     (action `"probe"`; `approver: "luci"` only on `--apply` runs).
 *   - Preserves `_meta` and key ordering verbatim.
 *
 * Exit codes:
 *   0 — every entry was probed (network outcome irrelevant; a 404 is a
 *       successful probe).
 *   1 — failed to spawn `latest-docs` or to read the registry.
 *   2 — invoked with an unknown flag.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type RegistryEntry = {
	url: string;
	type: "markdown" | "html";
	selector?: string;
	ttl_days?: number;
	verified?: boolean;
};

const cwd = process.cwd();
const REGISTRY_PATH =
	[
		path.join(cwd, "skills", "latest-docs", "registry.json"),
		path.join(cwd, ".omp", "skills", "latest-docs", "registry.json"),
		path.join(cwd, ".pi", "skills", "latest-docs", "registry.json"),
	].find((p) => fs.existsSync(p)) ??
	path.join(cwd, "skills", "latest-docs", "registry.json");
const LATEST_DOCS =
	[
		path.join(cwd, "skills", "latest-docs", "bin", "latest-docs.ts"),
		path.join(cwd, ".omp", "skills", "latest-docs", "bin", "latest-docs.ts"),
	].find((p) => fs.existsSync(p)) ??
	path.join(cwd, "skills", "latest-docs", "bin", "latest-docs.ts");
const AUDIT_DIR = path.join(cwd, ".pi");
const AUDIT_LOG = path.join(AUDIT_DIR, ".docs-registry-log.jsonl");

function parseArgs(argv: string[]): { apply: boolean } {
	let apply = false;
	for (const a of argv.slice(2)) {
		if (a === "--apply") {
			apply = true;
			continue;
		}
		console.error(`unknown flag: ${a}`);
		process.exit(2);
	}
	return { apply };
}

function isEntry(v: unknown): v is RegistryEntry {
	return (
		!!v && typeof v === "object" && typeof (v as RegistryEntry).url === "string"
	);
}

function loadRegistry(): Record<string, unknown> {
	if (!fs.existsSync(REGISTRY_PATH)) {
		console.error(`registry not found: ${REGISTRY_PATH}`);
		process.exit(1);
	}
	try {
		return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as Record<
			string,
			unknown
		>;
	} catch (err) {
		console.error(`failed to parse registry: ${(err as Error).message}`);
		process.exit(1);
	}
}

function probeOne(lib: string): number {
	const res = spawnSync("bun", ["run", LATEST_DOCS, "fetch", lib], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
	});
	if (res.error) {
		console.error(
			`failed to spawn latest-docs for ${lib}: ${res.error.message}`,
		);
		process.exit(1);
	}
	// spawnSync returns null status when the process was killed by signal; treat
	// as a non-zero outcome (kept) rather than a spawn failure.
	return res.status ?? -1;
}

function appendAudit(entry: Record<string, unknown>): void {
	fs.mkdirSync(AUDIT_DIR, { recursive: true });
	const existed = fs.existsSync(AUDIT_LOG);
	fs.appendFileSync(AUDIT_LOG, `${JSON.stringify(entry)}\n`);
	if (!existed) {
		fs.chmodSync(AUDIT_LOG, 0o600);
	}
}

function atomicWrite(target: string, content: string): void {
	const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
	fs.writeFileSync(tmp, content, { mode: 0o644 });
	fs.renameSync(tmp, target);
}

type ProbeResult = {
	lib: string;
	before: RegistryEntry;
	after: RegistryEntry;
	exit: number;
	flipped: boolean;
};

function main(): void {
	const { apply } = parseArgs(process.argv);
	const registry = loadRegistry();

	const results: ProbeResult[] = [];
	let flipped = 0;
	let kept = 0;

	// Iterate in the file's original key order. Skip _meta and any
	// already-verified entries (spec §2: do not re-probe `verified: true`).
	for (const [key, val] of Object.entries(registry)) {
		if (key === "_meta") continue;
		if (!isEntry(val)) continue;
		if (val.verified === true) continue;

		const before = val;
		const exit = probeOne(key);
		const success = exit === 0;
		// Never downgrade `verified: true → false` (spec §6); since we already
		// skipped `verified: true`, `after` only differs from `before` when the
		// probe succeeded.
		const after: RegistryEntry = success
			? { ...before, verified: true }
			: before;
		const didFlip = success;

		if (didFlip) {
			flipped++;
			console.log(`WOULD FLIP ${key} false\u2192true`);
		} else {
			kept++;
			console.log(`WOULD KEEP ${key} false (status=${exit})`);
		}
		results.push({ lib: key, before, after, exit, flipped: didFlip });
	}

	if (apply) {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(registry)) {
			if (key === "_meta") {
				out[key] = val;
				continue;
			}
			const r = results.find((x) => x.lib === key);
			out[key] = r ? r.after : val;
		}
		atomicWrite(REGISTRY_PATH, `${JSON.stringify(out, null, 2)}\n`);
	}

	const ts = new Date().toISOString();
	for (const r of results) {
		const line: Record<string, unknown> = {
			ts,
			action: "probe",
			lib: r.lib,
			before: r.before,
			after: r.after,
			exit_code: r.exit,
		};
		if (apply) line.approver = "luci";
		appendAudit(line);
	}

	console.log(`${flipped} flipped, ${kept} kept, ${results.length} total`);
	process.exit(0);
}

main();

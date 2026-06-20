/**
 * Tests for the SpecSafe Oh My Pi hook port.
 *
 * Source of truth for the cases:
 *   .pi/extensions/specsafe-subagents/test/subagents-patch.test.ts
 *   .pi/extensions/specsafe-session/test/specsafe-session.test.ts
 *
 * The `buildChildEnv` cases from the vanilla suite are intentionally
 * absent — env injection is not ported. See ../hooks/PORT-NOTES.md.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	type StateFile,
	buildTrailerBlock,
	readStateFileOrNull,
	statePathFor,
} from "../hooks/specsafe-session";
import { commitSubagentWork } from "../hooks/specsafe-subagents";

// ---------------------------------------------------------------------------
// helpers (mirror .pi test helpers)
// ---------------------------------------------------------------------------

function mkTmpRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-specsafe-"));
	spawnSync("git", ["init", "-b", "main"], { cwd: dir });
	spawnSync("git", ["config", "user.email", "test@seshat.local"], { cwd: dir });
	spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
	spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
	fs.writeFileSync(path.join(dir, "README.md"), "initial\n");
	spawnSync("git", ["add", "."], { cwd: dir });
	spawnSync("git", ["commit", "-m", "initial"], { cwd: dir });
	return dir;
}

function lastCommit(cwd: string): { subject: string; body: string } {
	const subj = spawnSync("git", ["log", "-1", "--pretty=%s"], {
		cwd,
		encoding: "utf-8",
	}).stdout.trim();
	const body = spawnSync("git", ["log", "-1", "--pretty=%B"], {
		cwd,
		encoding: "utf-8",
	}).stdout;
	return { subject: subj, body };
}

function commitCount(cwd: string): number {
	const out = spawnSync("git", ["rev-list", "--count", "HEAD"], {
		cwd,
		encoding: "utf-8",
	}).stdout.trim();
	return Number(out);
}

let repo: string;
beforeEach(() => {
	repo = mkTmpRepo();
});
afterEach(() => {
	try {
		fs.rmSync(repo, { recursive: true, force: true });
	} catch {}
});

// ---------------------------------------------------------------------------
// commitSubagentWork — ports subagents-patch.test.ts cases
// ---------------------------------------------------------------------------

describe("[unit] commitSubagentWork — successful dirty tree", () => {
	test("stages all changes and commits with required trailers", () => {
		fs.writeFileSync(path.join(repo, "out.md"), "ghola wrote this\n");

		const result = commitSubagentWork({
			cwd: repo,
			agent: "spec-writer",
			sliceId: "TEST-001",
			sessionId: "sess-abc",
			message: "drafted the opening spec",
		});
		expect(result.committed).toBe(true);

		const { subject, body } = lastCommit(repo);
		expect(subject.startsWith("spec-writer:")).toBe(true);
		expect(subject).toContain("drafted the opening spec");

		for (const trailer of [
			"Co-Authored-By: spec-writer",
			"Spec-Slice: TEST-001",
			"Peer: spec-writer",
			"Session: sess-abc",
		]) {
			expect(body).toContain(trailer);
		}
	});
});

describe("[unit] commitSubagentWork — clean tree", () => {
	test("is a no-op, does not create an empty commit, reports committed:false", () => {
		const before = commitCount(repo);
		const result = commitSubagentWork({
			cwd: repo,
			agent: "doc-scout",
			sliceId: "TEST-001",
			sessionId: "sess-def",
			message: "no files touched",
		});
		expect(result.committed).toBe(false);
		expect(commitCount(repo)).toBe(before);
	});
});

describe("[unit] commitSubagentWork — error handling", () => {
	test("does not throw when cwd is not a git repo (returns committed:false with error)", () => {
		const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), "omp-notrepo-"));
		fs.writeFileSync(path.join(notRepo, "x.txt"), "content\n");
		try {
			const result = commitSubagentWork({
				cwd: notRepo,
				agent: "implementer",
				sliceId: "TEST-001",
				sessionId: "sess-xyz",
				message: "would fail silently",
			});
			expect(result.committed).toBe(false);
			expect(result.error).toBeDefined();
		} finally {
			fs.rmSync(notRepo, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// state-file helpers — port a subset of specsafe-session.test.ts that does
// not depend on the begin/end tools (those tools live in .pi/, not .omp/).
// ---------------------------------------------------------------------------

describe("[unit] state file — readStateFileOrNull", () => {
	let projectDir: string;
	beforeEach(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-specsafe-state-"));
		fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
	});
	afterEach(() => {
		try {
			fs.rmSync(projectDir, { recursive: true, force: true });
		} catch {}
	});

	test("returns null on missing file (does not throw)", () => {
		const s = readStateFileOrNull(statePathFor(projectDir));
		expect(s).toBeNull();
	});

	test("corrupt state file is quarantined, returns null", () => {
		const sp = statePathFor(projectDir);
		fs.writeFileSync(sp, "{not valid json", { mode: 0o600 });
		const s = readStateFileOrNull(sp);
		expect(s).toBeNull();
		const entries = fs.readdirSync(path.join(projectDir, ".pi"));
		expect(
			entries.some((f) => f.startsWith(".specsafe-state.json.corrupt-")),
		).toBe(true);
		expect(fs.existsSync(sp)).toBe(false);
	});

	test("reads a valid state file with currentSlice", () => {
		const state: StateFile = {
			currentSlice: {
				id: "S1",
				workspaceId: "w",
				sessionId: "sess-1",
				beganAt: new Date().toISOString(),
				costCounter: {
					externalMemoryCalls: 0,
					externalMemoryCost: 0,
					subagentTokens: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0,
						turns: 0,
					},
				},
			},
			history: [],
		};
		fs.writeFileSync(statePathFor(projectDir), JSON.stringify(state), {
			mode: 0o600,
		});
		const loaded = readStateFileOrNull(statePathFor(projectDir));
		expect(loaded?.currentSlice?.id).toBe("S1");
		expect(loaded?.currentSlice?.sessionId).toBe("sess-1");
	});
});

// ---------------------------------------------------------------------------
// [unit] statePathFor parity — canonical vs inlined skill copies
//
// These tests import the canonical OMP hook and the inlined docs skill copy:
//   hooks/specsafe-session.ts
//   skills/docs/bin/_specsafe-state.ts
// They catch drift between the hook and skill helper copy at the test boundary.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Parity pin test helpers — loaded dynamically so that missing inlined modules
// produce clear per-test failures rather than whole-file load failures.
// ---------------------------------------------------------------------------

type StatePathFn = (cwd: string) => string;
type ReadStateFn = (
	filePath: string,
) => { currentSlice: unknown; history: unknown[] } | null;

async function loadCanonical(): Promise<{
	statePathFor: StatePathFn;
	readStateFileOrNull: ReadStateFn;
}> {
	return import("../hooks/specsafe-session");
}

async function loadDocsInlined(): Promise<{
	statePathFor: StatePathFn;
	readStateFileOrNull: ReadStateFn;
}> {
	return import("../skills/docs/bin/_specsafe-state.ts");
}

describe("[unit] statePathFor parity", () => {
	const cases: Array<{ label: string; cwd: string }> = [
		{ label: "typical absolute path", cwd: "/home/user/projects/pi" },
		{ label: "path with spaces", cwd: "/home/user/my projects/pi repo" },
		{ label: "relative path", cwd: "relative/path/to/repo" },
	];

	for (const { label, cwd } of cases) {
		test(`canonical === docs inlined: ${label}`, async () => {
			const { statePathFor: canon } = await loadCanonical();
			const { statePathFor: docsInlined } = await loadDocsInlined();
			expect(docsInlined(cwd)).toBe(canon(cwd));
		});
	}
});

describe("[unit] readStateFileOrNull parity", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-specsafe-parity-"));
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	test("non-existent file: both readers return null", async () => {
		const { readStateFileOrNull: canon } = await loadCanonical();
		const { readStateFileOrNull: docsInlined } = await loadDocsInlined();
		const filePath = path.join(tmpDir, ".pi", "nonexistent.json");
		expect(canon(filePath)).toBeNull();
		expect(docsInlined(filePath)).toBeNull();
	});

	test("well-formed JSON: both readers return structurally-equal StateFile", async () => {
		const { readStateFileOrNull: canon } = await loadCanonical();
		const { readStateFileOrNull: docsInlined } = await loadDocsInlined();
		const fixture = {
			currentSlice: {
				id: "SPEC-PARITY-001",
				workspaceId: "ws-parity",
				sessionId: "sess-parity",
				beganAt: "2026-04-26T10:00:00Z",
				costCounter: {
					externalMemoryCalls: 5,
					externalMemoryCost: 0.001,
					subagentTokens: {
						input: 1000,
						output: 200,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0.003,
						turns: 2,
					},
				},
			},
			history: [],
		};
		const filePath = path.join(tmpDir, ".pi", ".specsafe-state.json");
		fs.writeFileSync(filePath, JSON.stringify(fixture), { mode: 0o600 });

		const canonical = canon(filePath);
		fs.writeFileSync(filePath, JSON.stringify(fixture), { mode: 0o600 });
		const docsInlinedResult = docsInlined(filePath);

		expect(canonical).not.toBeNull();
		expect(JSON.stringify(docsInlinedResult)).toBe(JSON.stringify(canonical));
	});

	test("malformed JSON: both return null AND quarantine the file", async () => {
		const { readStateFileOrNull: canon } = await loadCanonical();
		const { readStateFileOrNull: docsInlined } = await loadDocsInlined();

		// Each needs its own file since quarantine renames happen once per path.
		const dirs = [
			fs.mkdtempSync(path.join(os.tmpdir(), "omp-parity-corrupt-canonical-")),
			fs.mkdtempSync(path.join(os.tmpdir(), "omp-parity-corrupt-docs-")),
		];
		try {
			const paths = dirs.map((d) => {
				fs.mkdirSync(path.join(d, ".pi"), { recursive: true });
				const p = path.join(d, ".pi", ".specsafe-state.json");
				fs.writeFileSync(p, "{not valid json", { mode: 0o600 });
				return p;
			});

			const [canonicalPath, docsPath] = paths as [string, string];

			expect(canon(canonicalPath)).toBeNull();
			expect(fs.existsSync(canonicalPath)).toBe(false);
			expect(
				fs
					.readdirSync(path.dirname(canonicalPath))
					.some((f) => f.startsWith(".specsafe-state.json.corrupt-")),
			).toBe(true);

			expect(docsInlined(docsPath)).toBeNull();
			expect(fs.existsSync(docsPath)).toBe(false);
			expect(
				fs
					.readdirSync(path.dirname(docsPath))
					.some((f) => f.startsWith(".specsafe-state.json.corrupt-")),
			).toBe(true);
		} finally {
			for (const d of dirs) {
				try {
					fs.rmSync(d, { recursive: true, force: true });
				} catch {}
			}
		}
	});
});

describe("[unit] StateFile shape parity", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-specsafe-shape-"));
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	test("fixture written once, both readers return JSON.stringify-equal results", async () => {
		const { readStateFileOrNull: canon } = await loadCanonical();
		const { readStateFileOrNull: docsInlined } = await loadDocsInlined();
		const fixture = {
			currentSlice: {
				id: "SPEC-SHAPE-001",
				workspaceId: "ws-shape",
				sessionId: "sess-shape",
				beganAt: "2026-04-26T12:00:00Z",
				costCounter: {
					externalMemoryCalls: 3,
					externalMemoryCost: 0.0006,
					subagentTokens: {
						input: 500,
						output: 100,
						cacheRead: 50,
						cacheWrite: 10,
						cost: 0.001,
						turns: 1,
					},
				},
			},
			history: [
				{
					sliceId: "SPEC-SHAPE-000",
					workspaceId: "ws-shape",
					sessionId: "sess-prev",
					beganAt: "2026-04-25T10:00:00Z",
					endedAt: "2026-04-25T11:00:00Z",
					outcome: "PASS",
					costSummary: {
						externalMemoryCalls: 1,
						externalMemoryCost: 0.0002,
						subagentTokens: {
							input: 200,
							output: 50,
							cacheRead: 0,
							cacheWrite: 0,
							cost: 0.0003,
							turns: 1,
						},
					},
				},
			],
		};
		const filePath = path.join(tmpDir, ".pi", ".specsafe-state.json");
		fs.writeFileSync(filePath, JSON.stringify(fixture), { mode: 0o600 });

		const canonicalResult = canon(filePath);
		// Re-write fixture between reads (read doesn't consume, but ensures isolation)
		fs.writeFileSync(filePath, JSON.stringify(fixture), { mode: 0o600 });
		const docsInlinedResult = docsInlined(filePath);

		expect(canonicalResult).not.toBeNull();
		expect(canonicalResult).toHaveProperty("currentSlice");
		expect(canonicalResult).toHaveProperty("history");

		expect(JSON.stringify(docsInlinedResult)).toBe(
			JSON.stringify(canonicalResult),
		);
	});
});

// ---------------------------------------------------------------------------
// buildTrailerBlock — exercises the four-trailer recipe
// ---------------------------------------------------------------------------

describe("[unit] buildTrailerBlock", () => {
	test("emits all four trailers in source-faithful order", () => {
		const block = buildTrailerBlock({
			agent: "implementer",
			sliceId: "CUR-92__login",
			sessionId: "sess-xyz",
		});
		const lines = block.split("\n");
		expect(lines[0]).toBe(
			"Co-Authored-By: implementer <implementer@seshat.local>",
		);
		expect(lines[1]).toBe("Spec-Slice: CUR-92__login");
		expect(lines[2]).toBe("Peer: implementer");
		expect(lines[3]).toBe("Session: sess-xyz");
	});
});

/**
 * Tests for the docs skill — bin/docs.ts
 *
 * SpecSafe slice: SPEC-20260424-004 — linear-steward-docs
 *
 * Test types:
 *   [unit] — stub git runner; no real git; tests dispatch logic, file format, error paths.
 *   [integration] — real git in temp repo; tests full propose → apply lifecycle.
 *
 * IMPORTANT: all tests use temp cwd — no mutations to the real .pi/.doc-drafts/.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { DispatchOpts, DispatchResult } from "../bin/docs.ts";
import { dispatch } from "../bin/docs.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));
}

function makeStdin(content: string): NodeJS.ReadableStream {
	return Readable.from(content) as unknown as NodeJS.ReadableStream;
}

/** A minimal well-formed unified diff for docs/PRD.md */
const VALID_DIFF = `--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -1,3 +1,4 @@
 # PRD

 Some content.
+## New Section
`;

/** A diff for specs/brief.md (valid scope) */
const VALID_DIFF_SPECS = `--- a/specs/brief.md
+++ b/specs/brief.md
@@ -1,2 +1,3 @@
 # Brief
+Added line.
 End.
`;

/** A stub gitRunner that records calls and returns a configurable result */
type GitCall = { args: string[]; cwd: string };

function makeStubGitRunner(
	results: Record<
		string,
		{ stdout: string; stderr: string; exit: number }
	> = {},
): {
	runner: DispatchOpts["gitRunner"];
	calls: GitCall[];
} {
	const calls: GitCall[] = [];
	const runner: DispatchOpts["gitRunner"] = (args, opts) => {
		calls.push({ args, cwd: opts.cwd });
		const key = args[0] ?? "";
		return results[key] ?? { stdout: "", stderr: "", exit: 0 };
	};
	return { runner, calls };
}

function makeBaseOpts(
	tmpDir: string,
	overrides: Partial<DispatchOpts> = {},
): DispatchOpts {
	const { runner } = makeStubGitRunner({
		status: { stdout: "", stderr: "", exit: 0 }, // clean tree
		apply: { stdout: "", stderr: "", exit: 0 },
		commit: { stdout: "", stderr: "", exit: 0 },
	});
	return {
		cwd: tmpDir,
		stdin: makeStdin(""),
		gitRunner: runner,
		now: () => new Date("2026-04-24T14:02:11Z"),
		...overrides,
	};
}

/** Write .pi/.specsafe-state.json with optional slice */
function writeSpecSafeState(tmpDir: string, sliceId: string | null): void {
	const piDir = path.join(tmpDir, ".pi");
	fs.mkdirSync(piDir, { recursive: true });
	const state = {
		currentSlice: sliceId
			? {
					id: sliceId,
					workspaceId: "ws-test",
					sessionId: "sess-test",
					beganAt: "2026-04-24T14:00:00Z",
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
				}
			: null,
		history: [],
	};
	fs.writeFileSync(
		path.join(piDir, ".specsafe-state.json"),
		JSON.stringify(state, null, 2),
		{ mode: 0o600 },
	);
}

function getDraftsDir(tmpDir: string): string {
	return path.join(tmpDir, ".pi", ".doc-drafts");
}

function listDraftFiles(tmpDir: string): string[] {
	const dir = getDraftsDir(tmpDir);
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => f.endsWith(".patch"));
}

// ---------------------------------------------------------------------------
// Git helpers for integration tests
// ---------------------------------------------------------------------------

function execGit(
	args: string[],
	cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exitCode: result.exitCode ?? 0,
	};
}

function setupIntegrationRepo(): string {
	const tmpDir = makeTempDir();
	execGit(["init", "-b", "main", tmpDir], tmpDir);
	execGit(["config", "user.email", "test@example.com"], tmpDir);
	execGit(["config", "user.name", "Test User"], tmpDir);

	// Add .gitignore that ignores .pi/ (mirrors real project)
	fs.writeFileSync(path.join(tmpDir, ".gitignore"), ".pi/\n");

	// Create docs/PRD.md
	const docsDir = path.join(tmpDir, "docs");
	fs.mkdirSync(docsDir, { recursive: true });
	fs.writeFileSync(path.join(docsDir, "PRD.md"), "# PRD\n\nSome content.\n");
	execGit(["add", "."], tmpDir);
	execGit(["commit", "-m", "chore: initial commit"], tmpDir);

	// Create .pi dir (not tracked by git — matches real project)
	const piDir = path.join(tmpDir, ".pi");
	fs.mkdirSync(piDir, { recursive: true });

	return tmpDir;
}

// ---------------------------------------------------------------------------
// [unit] SPEC-008.2 — module-load smoke test for _specsafe-state.ts inline copy
//
// Asserts that the inlined surface exported by ../bin/_specsafe-state.ts is
// importable and exposes the expected shapes. Fails RED (Cannot find module)
// until the implementer creates that file per SPEC-008.2 §3.2.
//
// NOTE: The docs skill does NOT inline CONCLUSION_WRITERS (only memory does).
// ---------------------------------------------------------------------------

describe("[unit] _specsafe-state.ts module-load smoke", () => {
	test("statePathFor is a function", async () => {
		const mod = await import("../bin/_specsafe-state.ts");
		expect(typeof mod.statePathFor).toBe("function");
	});

	test("readStateFileOrNull is a function", async () => {
		const mod = await import("../bin/_specsafe-state.ts");
		expect(typeof mod.readStateFileOrNull).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// [unit] AC11 — scope validation: reject non-docs/specs paths
// ---------------------------------------------------------------------------

describe("[unit] AC11 — scope validation", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("docs/PRD.md is accepted (no scope error)", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const result = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add X section"],
			opts,
		);
		// Should not fail with scope error (may succeed or fail for other reasons)
		expect(result.stderr).not.toContain("scoped to BMad artifacts");
		expect(result.exit).toBe(0);
	});

	test("specs/brief.md is accepted", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF_SPECS) });
		const result = await dispatch(
			["propose", "specs/brief.md", "--rationale=test"],
			opts,
		);
		expect(result.stderr).not.toContain("scoped to BMad artifacts");
		expect(result.exit).toBe(0);
	});

	test("specs/briefs/CUR-92.md is accepted", async () => {
		const diff =
			"--- a/specs/briefs/CUR-92.md\n+++ b/specs/briefs/CUR-92.md\n@@ -1,2 +1,3 @@\n # Brief\n+Added.\n End.\n";
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(diff) });
		const result = await dispatch(
			["propose", "specs/briefs/CUR-92.md", "--rationale=test"],
			opts,
		);
		expect(result.stderr).not.toContain("scoped to BMad artifacts");
		expect(result.exit).toBe(0);
	});

	test("src/foo.ts is rejected with scope message", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const result = await dispatch(
			["propose", "src/foo.ts", "--rationale=hack"],
			opts,
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr).toContain("scoped to BMad artifacts");
	});

	test("README.md is rejected (not in allowlist)", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const result = await dispatch(
			["propose", "README.md", "--rationale=x"],
			opts,
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr).toContain("scoped to BMad artifacts");
	});

	test("docs-extra/foo.md is rejected (not docs/, specs/, specs/briefs/)", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const result = await dispatch(
			["propose", "docs-extra/foo.md", "--rationale=x"],
			opts,
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr).toContain("scoped to BMad artifacts");
	});
});

// ---------------------------------------------------------------------------
// [unit] Diff validation
// ---------------------------------------------------------------------------

describe("[unit] diff validation", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("invalid diff (no --- +++ headers) is rejected at propose time", async () => {
		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin("this is not a unified diff\njust some text\n"),
		});
		const result = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr.toLowerCase()).toMatch(
			/invalid|not a valid|unified diff/i,
		);
	});

	test("empty diff is rejected", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin("") });
		const result = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		expect(result.exit).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// [unit] AC8 — propose creates .patch file with correct format
// ---------------------------------------------------------------------------

describe("[unit] AC8 — propose creates .patch file", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates patch under .pi/.doc-drafts/, has mode 0600, appears in list", async () => {
		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			now: () => new Date("2026-04-24T14:02:11Z"),
		});

		// Propose
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add X section"],
			opts,
		);
		expect(proposeResult.exit).toBe(0);

		// Check file exists
		const drafts = listDraftFiles(tmpDir);
		expect(drafts).toHaveLength(1);

		const draft = drafts[0];
		expect(draft).toBeDefined();
		if (!draft) throw new Error("expected draft file");
		const draftPath = path.join(getDraftsDir(tmpDir), draft);
		expect(fs.existsSync(draftPath)).toBe(true);

		// Check mode 0600
		const stat = fs.statSync(draftPath);
		expect(stat.mode & 0o777).toBe(0o600);

		// Check file content has required headers
		const content = fs.readFileSync(draftPath, "utf8");
		expect(content).toContain("# Rationale: add X section");
		expect(content).toContain("# Proposed at: 2026-04-24T14:02:11Z");
		expect(content).toContain("# Target: docs/PRD.md");

		// Should contain the diff body
		expect(content).toContain("--- a/docs/PRD.md");
		expect(content).toContain("+++ b/docs/PRD.md");

		// List should show it
		const listResult = await dispatch(["list"], makeBaseOpts(tmpDir));
		expect(listResult.stdout).toContain("docs/PRD.md");
		expect(listResult.stdout).toContain("add X section");
	});

	test("draft ID is filename without .patch extension", async () => {
		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			now: () => new Date("2026-04-24T14:02:11Z"),
		});
		const result = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toMatch(/^2026-04-24T14:02:11Z-prd-md$/m);
	});

	test("slug sanitized from path basename", async () => {
		const diff =
			"--- a/specs/briefs/CUR-92.md\n+++ b/specs/briefs/CUR-92.md\n@@ -1,2 +1,3 @@\n # Brief\n+Added.\n End.\n";
		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(diff),
			now: () => new Date("2026-04-24T14:02:11Z"),
		});
		const result = await dispatch(
			["propose", "specs/briefs/CUR-92.md", "--rationale=test"],
			opts,
		);
		expect(result.exit).toBe(0);
		// Slug from basename: CUR-92.md → cur-92-md
		expect(result.stdout).toMatch(/cur-92-md/);
	});
});

// ---------------------------------------------------------------------------
// [unit] docs list — empty state
// ---------------------------------------------------------------------------

describe("[unit] docs list", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("no pending drafts prints message", async () => {
		const result = await dispatch(["list"], makeBaseOpts(tmpDir));
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("no pending drafts");
	});

	test("discarded drafts do not appear in list", async () => {
		// Propose a draft
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		await dispatch(["propose", "docs/PRD.md", "--rationale=test"], opts);

		const drafts = listDraftFiles(tmpDir);
		expect(drafts).toHaveLength(1);
		const draftId = drafts[0]?.replace(".patch", "");

		// Discard it
		await dispatch(["discard", draftId], makeBaseOpts(tmpDir));

		// List should be empty
		const listResult = await dispatch(["list"], makeBaseOpts(tmpDir));
		expect(listResult.stdout).toContain("no pending drafts");
	});
});

// ---------------------------------------------------------------------------
// [unit] docs show
// ---------------------------------------------------------------------------

describe("[unit] docs show", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("show with valid id displays rationale and diff", async () => {
		// Propose
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add X section"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		// Show
		const showResult = await dispatch(["show", draftId], makeBaseOpts(tmpDir));
		expect(showResult.exit).toBe(0);
		expect(showResult.stdout).toContain("# Rationale: add X section");
		expect(showResult.stdout).toContain("--- a/docs/PRD.md");
	});

	test("show with nonexistent id exits non-zero", async () => {
		const result = await dispatch(
			["show", "nonexistent-id"],
			makeBaseOpts(tmpDir),
		);
		expect(result.exit).not.toBe(0);
		expect(result.stderr.toLowerCase()).toMatch(/not found|no draft/i);
	});
});

// ---------------------------------------------------------------------------
// [unit] AC10 — discard moves to .discarded/
// ---------------------------------------------------------------------------

describe("[unit] AC10 — discard", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("discard moves patch to .discarded/ and removes from list", async () => {
		// Propose
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		// Discard
		const discardResult = await dispatch(
			["discard", draftId],
			makeBaseOpts(tmpDir),
		);
		expect(discardResult.exit).toBe(0);

		// Original not in pending
		expect(listDraftFiles(tmpDir)).toHaveLength(0);

		// In .discarded/
		const discardedPath = path.join(
			getDraftsDir(tmpDir),
			".discarded",
			`${draftId}.patch`,
		);
		expect(fs.existsSync(discardedPath)).toBe(true);

		// No longer in list
		const listResult = await dispatch(["list"], makeBaseOpts(tmpDir));
		expect(listResult.stdout).toContain("no pending drafts");
	});

	test("discard nonexistent id exits non-zero", async () => {
		const result = await dispatch(
			["discard", "no-such-draft"],
			makeBaseOpts(tmpDir),
		);
		expect(result.exit).not.toBe(0);
	});

	test("discard creates .discarded/ directory if absent", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		const discardedDir = path.join(getDraftsDir(tmpDir), ".discarded");
		expect(fs.existsSync(discardedDir)).toBe(false);

		await dispatch(["discard", draftId], makeBaseOpts(tmpDir));

		expect(fs.existsSync(discardedDir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// [unit] docs apply — without --i-approve (dry-run)
// ---------------------------------------------------------------------------

describe("[unit] docs apply — dry-run (no --i-approve)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("without --i-approve exits 0 with preview and NOT YET APPLIED message", async () => {
		const opts = makeBaseOpts(tmpDir, { stdin: makeStdin(VALID_DIFF) });
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add X section"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		const applyResult = await dispatch(
			["apply", draftId],
			makeBaseOpts(tmpDir),
		);
		expect(applyResult.exit).toBe(0);
		expect(applyResult.stdout).toContain("NOT YET APPLIED");
		expect(applyResult.stdout).toContain("--i-approve");
		expect(applyResult.stdout).toContain("docs/PRD.md"); // target shown

		// Draft still in pending list
		const listResult = await dispatch(["list"], makeBaseOpts(tmpDir));
		expect(listResult.stdout).not.toContain("no pending drafts");
	});
});

// ---------------------------------------------------------------------------
// [unit] docs apply — stub git, check calls
// ---------------------------------------------------------------------------

describe("[unit] docs apply --i-approve — stub git", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("calls git apply --index and git commit; moves to .applied/", async () => {
		const gitCalls: GitCall[] = [];
		const gitRunner: DispatchOpts["gitRunner"] = (args, opts) => {
			gitCalls.push({ args, cwd: opts.cwd });
			const cmd = args[0] ?? "";
			if (cmd === "status") return { stdout: "", stderr: "", exit: 0 }; // clean tree
			if (cmd === "apply") return { stdout: "", stderr: "", exit: 0 };
			if (cmd === "commit") return { stdout: "", stderr: "", exit: 0 };
			return { stdout: "", stderr: "", exit: 0 };
		};

		// Propose
		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			gitRunner,
		});
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add X section"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		// Clear calls from propose (none expected but reset)
		gitCalls.length = 0;

		// Apply
		const applyResult = await dispatch(
			["apply", draftId, "--i-approve"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);
		expect(applyResult.exit).toBe(0);

		// git status called
		expect(gitCalls.some((c) => c.args[0] === "status")).toBe(true);
		// git apply called with --index
		expect(
			gitCalls.some((c) => c.args[0] === "apply" && c.args.includes("--index")),
		).toBe(true);
		// git commit called
		expect(gitCalls.some((c) => c.args[0] === "commit")).toBe(true);

		// Commit message contains trailers
		const commitCall = gitCalls.find((c) => c.args[0] === "commit");
		const commitMsg = commitCall?.args.join(" ") ?? "";
		expect(commitMsg).toContain("Proposed-By: steward");
		expect(commitMsg).toContain("Approved-By: luci");
		expect(commitMsg).toContain(`Rationale-From: ${draftId}`);

		// Moved to .applied/
		const appliedPath = path.join(
			getDraftsDir(tmpDir),
			".applied",
			`${draftId}.patch`,
		);
		expect(fs.existsSync(appliedPath)).toBe(true);

		// No longer in pending list
		const listResult = await dispatch(
			["list"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);
		expect(listResult.stdout).toContain("no pending drafts");
	});

	test("dirty tree exits non-zero without calling git apply", async () => {
		const gitCalls: GitCall[] = [];
		const gitRunner: DispatchOpts["gitRunner"] = (args, opts) => {
			gitCalls.push({ args, cwd: opts.cwd });
			if (args[0] === "status")
				return { stdout: "M docs/PRD.md\n", stderr: "", exit: 0 };
			return { stdout: "", stderr: "", exit: 0 };
		};

		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			gitRunner,
		});
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();

		gitCalls.length = 0;

		const applyResult = await dispatch(
			["apply", draftId, "--i-approve"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);
		expect(applyResult.exit).not.toBe(0);
		expect(applyResult.stderr).toContain("working tree must be clean");

		// git apply should NOT have been called
		expect(gitCalls.some((c) => c.args[0] === "apply")).toBe(false);
	});

	test("with open slice: commit includes Spec-Slice: trailer", async () => {
		writeSpecSafeState(tmpDir, "SPEC-20260424-004");

		const gitCalls: GitCall[] = [];
		const gitRunner: DispatchOpts["gitRunner"] = (args, opts) => {
			gitCalls.push({ args, cwd: opts.cwd });
			if (args[0] === "status") return { stdout: "", stderr: "", exit: 0 };
			return { stdout: "", stderr: "", exit: 0 };
		};

		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			gitRunner,
		});
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();
		gitCalls.length = 0;

		await dispatch(
			["apply", draftId, "--i-approve"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);

		const commitCall = gitCalls.find((c) => c.args[0] === "commit");
		const commitMsg = commitCall?.args.join(" ") ?? "";
		expect(commitMsg).toContain("Spec-Slice: SPEC-20260424-004");
	});

	test("without SpecSafe state file: commit omits Spec-Slice: trailer", async () => {
		// No .specsafe-state.json written
		const gitCalls: GitCall[] = [];
		const gitRunner: DispatchOpts["gitRunner"] = (args, opts) => {
			gitCalls.push({ args, cwd: opts.cwd });
			if (args[0] === "status") return { stdout: "", stderr: "", exit: 0 };
			return { stdout: "", stderr: "", exit: 0 };
		};

		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			gitRunner,
		});
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();
		gitCalls.length = 0;

		await dispatch(
			["apply", draftId, "--i-approve"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);

		const commitCall = gitCalls.find((c) => c.args[0] === "commit");
		const commitMsg = commitCall?.args.join(" ") ?? "";
		expect(commitMsg).not.toContain("Spec-Slice:");
	});

	test("with currentSlice null: commit omits Spec-Slice: trailer", async () => {
		writeSpecSafeState(tmpDir, null);

		const gitCalls: GitCall[] = [];
		const gitRunner: DispatchOpts["gitRunner"] = (args, opts) => {
			gitCalls.push({ args, cwd: opts.cwd });
			if (args[0] === "status") return { stdout: "", stderr: "", exit: 0 };
			return { stdout: "", stderr: "", exit: 0 };
		};

		const opts = makeBaseOpts(tmpDir, {
			stdin: makeStdin(VALID_DIFF),
			gitRunner,
		});
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=test"],
			opts,
		);
		const draftId = proposeResult.stdout.trim();
		gitCalls.length = 0;

		await dispatch(
			["apply", draftId, "--i-approve"],
			makeBaseOpts(tmpDir, { gitRunner }),
		);

		const commitCall = gitCalls.find((c) => c.args[0] === "commit");
		const commitMsg = commitCall?.args.join(" ") ?? "";
		expect(commitMsg).not.toContain("Spec-Slice:");
	});
});

// ---------------------------------------------------------------------------
// [integration] AC9 — full propose → apply in a real git repo
// ---------------------------------------------------------------------------

describe("[integration] AC9 — full propose → apply lifecycle", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = setupIntegrationRepo();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeIntegrationOpts(
		overrides: Partial<DispatchOpts> = {},
	): DispatchOpts {
		return {
			cwd: tmpDir,
			stdin: makeStdin(""),
			now: () => new Date("2026-04-24T14:02:11Z"),
			...overrides,
		};
	}

	test("AC9: propose then apply patches file and creates commit with correct trailers", async () => {
		// Generate a real diff
		const original = fs.readFileSync(
			path.join(tmpDir, "docs", "PRD.md"),
			"utf8",
		);
		const modified = `${original}## New Section\n\nAdded by steward.\n`;

		// Create a proper diff
		const diff = `--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -1,3 +1,6 @@
 # PRD

 Some content.
+## New Section
+
+Added by steward.
`;

		// Propose
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add new section for feature X"],
			makeIntegrationOpts({ stdin: makeStdin(diff) }),
		);
		expect(proposeResult.exit).toBe(0);
		const draftId = proposeResult.stdout.trim();

		// Apply
		const applyResult = await dispatch(
			["apply", draftId, "--i-approve"],
			makeIntegrationOpts(),
		);
		expect(applyResult.exit).toBe(0);

		// Check git log
		const log = execGit(["log", "-1", "--format=%B"], tmpDir);
		expect(log.stdout).toContain("Proposed-By: steward");
		expect(log.stdout).toContain("Approved-By: luci");
		expect(log.stdout).toContain(`Rationale-From: ${draftId}`);

		// Check file patched
		const patched = fs.readFileSync(
			path.join(tmpDir, "docs", "PRD.md"),
			"utf8",
		);
		expect(patched).toContain("## New Section");
		expect(patched).toContain("Added by steward.");
	});

	test("with SpecSafe state open slice: commit includes Spec-Slice:", async () => {
		writeSpecSafeState(tmpDir, "SPEC-20260424-004");

		const diff = `--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -1,3 +1,4 @@
 # PRD

 Some content.
+## Extra
`;
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add extra section"],
			makeIntegrationOpts({ stdin: makeStdin(diff) }),
		);
		const draftId = proposeResult.stdout.trim();
		expect(proposeResult.exit).toBe(0);

		const applyResult = await dispatch(
			["apply", draftId, "--i-approve"],
			makeIntegrationOpts(),
		);
		expect(applyResult.exit).toBe(0);

		const log = execGit(["log", "-1", "--format=%B"], tmpDir);
		expect(log.stdout).toContain("Spec-Slice: SPEC-20260424-004");
		expect(log.stdout).toContain("Proposed-By: steward");
		expect(log.stdout).toContain("Approved-By: luci");
	});

	test("without SpecSafe state file: commit omits Spec-Slice:", async () => {
		// No .specsafe-state.json

		const diff = `--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -1,3 +1,4 @@
 # PRD

 Some content.
+## Another
`;
		const proposeResult = await dispatch(
			["propose", "docs/PRD.md", "--rationale=add another section"],
			makeIntegrationOpts({ stdin: makeStdin(diff) }),
		);
		const draftId = proposeResult.stdout.trim();
		expect(proposeResult.exit).toBe(0);

		const applyResult = await dispatch(
			["apply", draftId, "--i-approve"],
			makeIntegrationOpts(),
		);
		expect(applyResult.exit).toBe(0);

		const log = execGit(["log", "-1", "--format=%B"], tmpDir);
		expect(log.stdout).not.toContain("Spec-Slice:");
	});

	test("dirty tree: apply rejected without running git apply", async () => {
		// Create dirty state
		fs.writeFileSync(
			path.join(tmpDir, "docs", "PRD.md"),
			"# PRD\n\nDirty change!\n",
		);

		const diff = `--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -1,3 +1,4 @@
 # PRD

 Some content.
+## New
`;
		// We need to first stash or just test against a fresh propose
		// But the dirty file makes the tree dirty before apply
		// Propose first (separate from dirty state)
		const cleanDir = setupIntegrationRepo();
		try {
			const cleanOpts: DispatchOpts = {
				cwd: cleanDir,
				stdin: makeStdin(diff),
				now: () => new Date("2026-04-24T14:02:11Z"),
			};
			const proposeResult = await dispatch(
				["propose", "docs/PRD.md", "--rationale=test dirty"],
				cleanOpts,
			);
			const draftId = proposeResult.stdout.trim();
			expect(proposeResult.exit).toBe(0);

			// Copy the draft to tmpDir (dirty repo)
			const draftsDir = getDraftsDir(cleanDir);
			const draftFile = path.join(draftsDir, `${draftId}.patch`);
			const targetDraftsDir = getDraftsDir(tmpDir);
			fs.mkdirSync(targetDraftsDir, { recursive: true });
			fs.copyFileSync(
				draftFile,
				path.join(targetDraftsDir, `${draftId}.patch`),
			);

			// Try to apply in dirty repo
			const applyResult = await dispatch(["apply", draftId, "--i-approve"], {
				cwd: tmpDir,
				now: () => new Date(),
			});
			expect(applyResult.exit).not.toBe(0);
			expect(applyResult.stderr).toContain("working tree must be clean");
		} finally {
			fs.rmSync(cleanDir, { recursive: true, force: true });
		}
	});
});

/**
 * Tests for the github skill — bin/github.sh
 *
 * SpecSafe slice: SPEC-20260424-005 — github-skill
 *
 * Strategy:
 *   - Stub `gh` by setting PI_GITHUB_GH_CMD to a shell script that prints
 *     deterministic output + echoes its argv to a side-channel file.
 *   - Stub `linear` by setting PI_GITHUB_LINEAR_CMD to a shell script that
 *     prints a fake `state:` line for a given branch.
 *   - Run each test in an isolated tmp dir that looks like a Pi repo
 *     (has .git, .pi/, and the current branch set via git commands).
 *   - Assert on stdout, stderr, exit code, and the contents of
 *     .pi/.github-log.jsonl.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const GITHUB_SH = path.resolve(import.meta.dir, "../bin/github.sh");

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function run(
	args: string[],
	cwd: string,
	extraEnv: Record<string, string> = {},
): Promise<RunResult> {
	const proc = Bun.spawn(["bash", GITHUB_SH, ...args], {
		cwd,
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
			HOME: cwd,
			...extraEnv,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

function execGit(args: string[], cwd: string): void {
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
	if (result.exitCode !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${result.stderr.toString()}`,
		);
	}
}

interface TestEnv {
	repo: string;
	tmpDir: string;
	ghLog: string; // file where the gh stub writes its invocations
}

function createTestEnv(): TestEnv {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-github-"));
	const repo = path.join(tmpDir, "repo");
	fs.mkdirSync(repo, { recursive: true });
	execGit(["init", "-b", "main", repo], tmpDir);
	execGit(["config", "user.email", "test@example.com"], repo);
	execGit(["config", "user.name", "Test User"], repo);
	fs.mkdirSync(path.join(repo, ".pi"), { recursive: true });
	fs.writeFileSync(path.join(repo, ".gitignore"), ".pi/\n");
	execGit(["add", ".gitignore"], repo);
	execGit(["commit", "-m", "init"], repo);
	const ghLog = path.join(tmpDir, "gh-invocations.log");
	return { repo, tmpDir, ghLog };
}

/**
 * Creates a stub `gh` executable script and returns an env overlay that
 * points the skill at it. The stub prints `stdout` as its stdout and
 * appends its argv to `ghLog`.
 */
function stubGh(
	tmpDir: string,
	stdoutText: string,
	ghLog: string,
	exitCode = 0,
): { PI_GITHUB_GH_CMD: string } {
	const script = path.join(tmpDir, "gh-stub.sh");
	fs.writeFileSync(
		script,
		[
			"#!/usr/bin/env bash",
			`printf '%s\\n' "gh-args:" "$@" >> "${ghLog}"`,
			// Support the `gh pr view <n> --json mergeCommit --jq ...` lookup used by merge.
			'if [ "$1" = "pr" ] && [ "$2" = "view" ] && [[ "$*" == *mergeCommit* ]]; then',
			"  echo 'abc123merge'",
			"  exit 0",
			"fi",
			`cat <<'EOF'`,
			stdoutText,
			`EOF`,
			`exit ${exitCode}`,
		].join("\n"),
	);
	fs.chmodSync(script, 0o755);
	return { PI_GITHUB_GH_CMD: `bash ${script}` };
}

function stubLinear(
	tmpDir: string,
	stateName: string,
	stateType = "started",
	exitCode = 0,
	opts: { authMissing?: boolean } = {},
): { PI_GITHUB_LINEAR_CMD: string } {
	const script = path.join(tmpDir, "linear-stub.sh");
	const body = opts.authMissing
		? ["echo 'LINEAR_API_KEY is not set.' >&2", "exit 2"].join("\n")
		: [
				`cat <<'EOF'`,
				`key:         ${"$2"}`,
				`title:       Test Issue`,
				`state:       ${stateName} (${stateType})`,
				`assignee:    nobody`,
				`team:        TST`,
				`EOF`,
				`exit ${exitCode}`,
			].join("\n");
	fs.writeFileSync(script, ["#!/usr/bin/env bash", body].join("\n"));
	fs.chmodSync(script, 0o755);
	return { PI_GITHUB_LINEAR_CMD: `bash ${script}` };
}

let envs: TestEnv[] = [];
afterEach(() => {
	for (const e of envs) {
		try {
			fs.rmSync(e.tmpDir, { recursive: true, force: true });
		} catch {}
	}
	envs = [];
});

function mkEnv(): TestEnv {
	const e = createTestEnv();
	envs.push(e);
	return e;
}

// ---------------------------------------------------------------------------
// Usage / gh-missing
// ---------------------------------------------------------------------------

describe("usage and gh-missing", () => {
	test("AC9: missing gh prints install+auth hint, exits non-zero", async () => {
		const env = mkEnv();
		// Point PI_GITHUB_GH_CMD at a nonexistent path so command -v fails.
		const result = await run(["pr", "view", "1"], env.repo, {
			PI_GITHUB_GH_CMD: "/nonexistent/gh-binary-xyz",
		});
		expect(result.exitCode).toBe(127);
		expect(result.stderr).toContain("gh CLI not found");
		expect(result.stderr).toContain("gh auth login --scopes repo,workflow");
	});

	test("no args prints usage and exits 1", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const result = await run([], env.repo, stub);
		expect(result.exitCode).toBe(1);
		expect(result.stdout + result.stderr).toContain("github");
	});

	test("unknown subcommand exits 1", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const result = await run(["pr", "nuke"], env.repo, stub);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown or unsupported");
	});
});

// ---------------------------------------------------------------------------
// Reads — pass-through
// ---------------------------------------------------------------------------

describe("reads pass through", () => {
	test("AC1: pr view <n> is pure pass-through to gh", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "PR #42: Fix login bug", env.ghLog);
		const result = await run(["pr", "view", "42"], env.repo, stub);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("PR #42: Fix login bug");
		const ghArgs = fs.readFileSync(env.ghLog, "utf8");
		expect(ghArgs).toContain("pr");
		expect(ghArgs).toContain("view");
		expect(ghArgs).toContain("42");
		// No log written for reads
		expect(fs.existsSync(path.join(env.repo, ".pi", ".github-log.jsonl"))).toBe(
			false,
		);
	});

	test("issue view passes through", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "Issue #7", env.ghLog);
		const result = await run(["issue", "view", "7"], env.repo, stub);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Issue #7");
	});

	test("AC7: api without -X is a GET pass-through", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, '{"ok":true}', env.ghLog);
		const result = await run(["api", "repos/org/repo"], env.repo, stub);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('{"ok":true}');
		expect(fs.existsSync(path.join(env.repo, ".pi", ".github-log.jsonl"))).toBe(
			false,
		);
	});

	test("api with explicit -X GET is still a pass-through (regression)", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, '{"ok":true}', env.ghLog);
		const result = await run(
			["api", "repos/org/repo", "-X", "GET"],
			env.repo,
			stub,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('{"ok":true}');
		expect(result.stdout).not.toContain("DRAFT");
		expect(fs.existsSync(path.join(env.repo, ".pi", ".github-log.jsonl"))).toBe(
			false,
		);
	});

	test("api with -X POST requires --i-approve (mutation)", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const result = await run(
			["api", "repos/org/repo/pulls", "-X", "POST", "-f", "title=x"],
			env.repo,
			stub,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("DRAFT");
		expect(fs.existsSync(path.join(env.repo, ".pi", ".github-log.jsonl"))).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// pr create — Linear-state invariant
// ---------------------------------------------------------------------------

describe("pr create + Linear invariant", () => {
	test("AC5: branch without Linear key refuses with rename hint", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "random-branch"], env.repo);
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const linearStub = stubLinear(env.tmpDir, "In Progress");
		const result = await run(["pr", "create", "--title=test"], env.repo, {
			...stub,
			...linearStub,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"branch does not reference a Linear ticket",
		);
		expect(result.stderr).toContain("<KEY>-<slug>");
	});

	test("AC2: dry-run on valid branch prints preview and Linear context, exits 0", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92-login-fix"], env.repo);
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const linearStub = stubLinear(env.tmpDir, "In Progress");
		const result = await run(["pr", "create", "--title=test"], env.repo, {
			...stub,
			...linearStub,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("DRAFT");
		expect(result.stdout).toContain("Linear");
		expect(result.stdout).toContain("In Progress");
		// Should include --draft in the resolved command by default
		expect(result.stdout).toContain("--draft");
		// Did NOT execute gh
		expect(fs.existsSync(env.ghLog)).toBe(false);
	});

	test("AC4: Linear ticket in 'Done' refuses even with --i-approve", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92-foo"], env.repo);
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const linearStub = stubLinear(env.tmpDir, "Done", "completed");
		const result = await run(
			["pr", "create", "--title=test", "--i-approve"],
			env.repo,
			{ ...stub, ...linearStub },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(
			/state-mismatch|is in 'Done'|expected one of/i,
		);
		// Log should not be written on refusal
		expect(fs.existsSync(path.join(env.repo, ".pi", ".github-log.jsonl"))).toBe(
			false,
		);
	});

	test("AC3-proxy: --i-approve with in_progress executes and logs (gh stubbed)", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92__login-fix"], env.repo);
		const stub = stubGh(
			env.tmpDir,
			"https://github.com/org/repo/pull/42",
			env.ghLog,
		);
		const linearStub = stubLinear(env.tmpDir, "In Progress");
		const result = await run(
			["pr", "create", "--title=test", "--i-approve"],
			env.repo,
			{ ...stub, ...linearStub },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("https://github.com/org/repo/pull/42");
		// Log entry was written
		const logPath = path.join(env.repo, ".pi", ".github-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
		const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
		expect(entry.action).toBe("pr create");
		expect(entry.exit).toBe(0);
		expect(entry.result_url).toBe("https://github.com/org/repo/pull/42");
		expect(entry.approver).toBe("luci");
		// 0600 mode
		const mode = fs.statSync(logPath).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("--bypass-linear-check + --i-approve overrides a bad state", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92-foo"], env.repo);
		const stub = stubGh(
			env.tmpDir,
			"https://github.com/org/repo/pull/43",
			env.ghLog,
		);
		const linearStub = stubLinear(env.tmpDir, "Done", "completed");
		const result = await run(
			[
				"pr",
				"create",
				"--title=hotfix",
				"--bypass-linear-check",
				"--i-approve",
			],
			env.repo,
			{ ...stub, ...linearStub },
		);
		expect(result.exitCode).toBe(0);
		const logPath = path.join(env.repo, ".pi", ".github-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
	});

	test("Q2: missing LINEAR_API_KEY auto-skips invariant", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92-foo"], env.repo);
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const linearStub = stubLinear(env.tmpDir, "", "", 2, { authMissing: true });
		const result = await run(["pr", "create", "--title=test"], env.repo, {
			...stub,
			...linearStub,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("skipped");
		expect(result.stdout).toContain("LINEAR_API_KEY");
	});

	test("--ready suppresses the default --draft", async () => {
		const env = mkEnv();
		execGit(["checkout", "-b", "CUR-92-foo"], env.repo);
		const stub = stubGh(env.tmpDir, "", env.ghLog);
		const linearStub = stubLinear(env.tmpDir, "In Progress");
		const result = await run(
			["pr", "create", "--title=test", "--ready"],
			env.repo,
			{ ...stub, ...linearStub },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("--draft");
	});
});

// ---------------------------------------------------------------------------
// Other mutations
// ---------------------------------------------------------------------------

describe("other mutations", () => {
	test("pr comment requires --i-approve", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "comment url", env.ghLog);
		const dry = await run(["pr", "comment", "42", "LGTM"], env.repo, stub);
		expect(dry.exitCode).toBe(0);
		expect(dry.stdout).toContain("DRAFT");
		expect(fs.existsSync(env.ghLog)).toBe(false);
	});

	test("pr comment with --i-approve executes and logs", async () => {
		const env = mkEnv();
		const stub = stubGh(
			env.tmpDir,
			"https://github.com/org/repo/pull/42#issuecomment-1",
			env.ghLog,
		);
		const result = await run(
			["pr", "comment", "42", "LGTM", "--i-approve"],
			env.repo,
			stub,
		);
		expect(result.exitCode).toBe(0);
		const logPath = path.join(env.repo, ".pi", ".github-log.jsonl");
		const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
		expect(entry.action).toBe("pr comment");
		expect(entry.result_url).toContain("issuecomment");
	});

	test("AC6-proxy: pr merge with --i-approve captures merge commit SHA via follow-up view", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "Merged PR #42", env.ghLog);
		const result = await run(
			["pr", "merge", "42", "--squash", "--i-approve"],
			env.repo,
			stub,
		);
		expect(result.exitCode).toBe(0);
		const logPath = path.join(env.repo, ".pi", ".github-log.jsonl");
		const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
		expect(entry.action).toBe("pr merge");
		expect(entry.result_url).toBe("abc123merge");
	});

	test("log file is mode 0600", async () => {
		const env = mkEnv();
		const stub = stubGh(env.tmpDir, "url", env.ghLog);
		await run(["pr", "comment", "1", "hi", "--i-approve"], env.repo, stub);
		const logPath = path.join(env.repo, ".pi", ".github-log.jsonl");
		const mode = fs.statSync(logPath).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

// ---------------------------------------------------------------------------
// AC8 — .pi/.github-log.jsonl is in gitignore
// ---------------------------------------------------------------------------

describe("gitignore", () => {
	test("AC8: .pi/.github-log.jsonl is gitignored at repo root", () => {
		const repoRoot = path.resolve(import.meta.dir, "../../..");
		const gi = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
		expect(gi).toMatch(/\.pi\/\.github-log\.jsonl/);
	});
});

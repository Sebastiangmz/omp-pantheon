/**
 * Tests for the push skill — bin/push.sh
 *
 * SpecSafe slice: SPEC-20260424-003 — push-and-memory-skills
 *
 * All tests spin up isolated temp-dir repos with bare remotes.
 * No network I/O; no real .pi/.push-log.jsonl written to the project root.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Absolute path to the script under test
const PUSH_SH = path.resolve(import.meta.dir, "../bin/push.sh");

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
	const proc = Bun.spawn(["bash", PUSH_SH, ...args], {
		cwd,
		env: {
			...process.env,
			// Isolate from global git config (signing, hooks, etc.)
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

/**
 * Create a test environment:
 * - bareRepo: bare git repo acting as remote
 * - repo: working repo with origin pointing at bareRepo
 *
 * Returns paths for both.
 */
interface TestEnv {
	repo: string;
	bareRepo: string;
	tmpDir: string;
}

function createTestEnv(): TestEnv {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-push-"));
	const bareRepo = path.join(tmpDir, "origin.git");
	const repo = path.join(tmpDir, "repo");

	// Create bare repo
	fs.mkdirSync(bareRepo, { recursive: true });
	execGit(["init", "--bare", "-b", "main", bareRepo], tmpDir);

	// Create working repo
	fs.mkdirSync(repo, { recursive: true });
	execGit(["init", "-b", "main", repo], tmpDir);
	execGit(["config", "user.email", "test@example.com"], repo);
	execGit(["config", "user.name", "Test User"], repo);
	execGit(["remote", "add", "origin", bareRepo], repo);

	// Create .pi directory in working repo
	fs.mkdirSync(path.join(repo, ".pi"), { recursive: true });

	// Add a .gitignore that matches the real Pi project (so .pi/ state files don't dirty the tree)
	fs.writeFileSync(path.join(repo, ".gitignore"), ".pi/\n");
	execGit(["add", ".gitignore"], repo);
	execGit(["commit", "-m", "chore: add gitignore"], repo);
	execGit(["push", "-u", "origin", "main"], repo);

	return { repo, bareRepo, tmpDir };
}

/**
 * Make a commit in the repo. Adds a dummy file change.
 * If trailerLine is provided, it is appended after a blank line as a git trailer.
 */
function makeCommit(repo: string, message: string, trailerLine?: string): void {
	const fileName = `file-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
	fs.writeFileSync(path.join(repo, fileName), `content-${Date.now()}\n`);
	execGit(["add", "."], repo);
	const fullMessage = trailerLine ? `${message}\n\n${trailerLine}` : message;
	execGit(["commit", "-m", fullMessage], repo);
}

/**
 * Push a branch to origin and set up tracking. Used to establish baseline.
 */
function pushBaseline(repo: string, branch: string): void {
	execGit(["push", "-u", "origin", branch], repo);
}

let env: TestEnv;

beforeEach(() => {
	env = createTestEnv();
});

afterEach(() => {
	try {
		fs.rmSync(env.tmpDir, { recursive: true, force: true });
	} catch {}
});

// ---------------------------------------------------------------------------
// AC1 — Dry-run on clean, ahead feature branch with Spec-Slice trailer
// ---------------------------------------------------------------------------
describe("[unit] AC1 — dry-run: clean ahead feature branch", () => {
	test("exits 0, prints READY TO PUSH, does NOT create push-log", async () => {
		// Baseline commit on main to allow feature branching
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		// Create feature branch
		execGit(["checkout", "-b", "feat/ac1"], env.repo);
		makeCommit(env.repo, "feat: add something", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/ac1");

		// Now add another commit ahead of remote so check 2 passes
		makeCommit(env.repo, "feat: additional work", "Spec-Slice: SPEC-003");

		const result = await run([], env.repo);

		expect(result.exitCode).toBe(0);
		expect(result.stdout + result.stderr).toContain("READY TO PUSH");

		// Log must NOT be written in dry-run
		const logPath = path.join(env.repo, ".pi", ".push-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC2 — --i-approve on clean, ahead feature branch pushes and logs
// ---------------------------------------------------------------------------
describe("[unit] AC2 — --i-approve: clean ahead feature branch", () => {
	test("exits 0, push-log has exactly 1 valid JSON line, push succeeds", async () => {
		// Baseline commit on main
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		// Create feature branch with baseline tracking
		execGit(["checkout", "-b", "feat/ac2"], env.repo);
		makeCommit(env.repo, "feat: base on feature", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/ac2");

		// Add a commit AHEAD of remote
		makeCommit(env.repo, "feat: ahead commit", "Spec-Slice: SPEC-003");

		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).toBe(0);

		// Check push-log
		const logPath = path.join(env.repo, ".pi", ".push-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);

		const lines = fs
			.readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
		expect(lines).toHaveLength(1);

		const entry = JSON.parse(lines[0]);
		expect(entry).toHaveProperty("ts");
		expect(entry).toHaveProperty("branch", "feat/ac2");
		expect(entry).toHaveProperty("remote", "origin");
		expect(entry).toHaveProperty("range");
		expect(entry).toHaveProperty("commits");
		expect(entry).toHaveProperty("approver", "luci");
		expect(typeof entry.commits).toBe("number");
		expect(entry.commits).toBeGreaterThan(0);
		expect(entry.range).toMatch(/^[0-9a-f]+\.\.[0-9a-f]+$/);

		// Verify push actually happened (bare repo has the new commit on feat/ac2)
		const bareLogs = Bun.spawnSync(["git", "log", "--oneline", "feat/ac2"], {
			cwd: env.bareRepo,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(bareLogs.stdout.toString()).toContain("ahead commit");
	});

	test("audit log has mode 0600", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/perms"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/perms");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		await run(["--i-approve"], env.repo);

		const logPath = path.join(env.repo, ".pi", ".push-log.jsonl");
		const stat = fs.statSync(logPath);
		expect(stat.mode & 0o777).toBe(0o600);
	});
});

// ---------------------------------------------------------------------------
// AC3 — main without --allow-main is rejected
// ---------------------------------------------------------------------------
describe("[unit] AC3 — push to main/master without --allow-main is rejected", () => {
	test("exits non-zero with message about protected branch", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");
		makeCommit(env.repo, "feat: on main", "Spec-Slice: SPEC-003");

		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(/protected branch|allow-main/i);
	});

	test("push to master also rejected", async () => {
		// Re-init a master-named repo
		const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "pi-push-master-"));
		const bareRepo2 = path.join(tmpDir2, "origin.git");
		const repo2 = path.join(tmpDir2, "repo");

		fs.mkdirSync(bareRepo2, { recursive: true });
		execGit(["init", "--bare", "-b", "master", bareRepo2], tmpDir2);
		fs.mkdirSync(repo2, { recursive: true });
		execGit(["init", "-b", "master", repo2], tmpDir2);
		execGit(["config", "user.email", "test@example.com"], repo2);
		execGit(["config", "user.name", "Test User"], repo2);
		execGit(["remote", "add", "origin", bareRepo2], repo2);
		fs.mkdirSync(path.join(repo2, ".pi"), { recursive: true });

		makeCommit(repo2, "chore: initial");
		execGit(["push", "-u", "origin", "master"], repo2);
		makeCommit(repo2, "feat: on master", "Spec-Slice: SPEC-003");

		const result = await run(["--i-approve"], repo2);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(/protected branch|allow-main/i);

		fs.rmSync(tmpDir2, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// AC3b — main WITH --allow-main + all checks green succeeds
// ---------------------------------------------------------------------------
describe("[unit] AC3b — main WITH --allow-main succeeds when all checks green", () => {
	test("exits 0, pushes, logs one entry", async () => {
		// Baseline commit (no trailer needed for non-feature range)
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		// New commit WITH Spec-Slice trailer, ahead of origin
		makeCommit(env.repo, "feat: main work", "Spec-Slice: SPEC-003");

		const result = await run(["--i-approve", "--allow-main"], env.repo);

		expect(result.exitCode).toBe(0);

		const logPath = path.join(env.repo, ".pi", ".push-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
		const lines = fs
			.readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0]);
		expect(entry.branch).toBe("main");
	});
});

// ---------------------------------------------------------------------------
// AC4 — mid-slice (currentSlice != null) is rejected
// ---------------------------------------------------------------------------
describe("[unit] AC4 — mid-slice: currentSlice != null is rejected", () => {
	test("exits non-zero, message mentions slice still open", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/ac4"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/ac4");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		// Write specsafe-state.json with open slice
		const stateFile = path.join(env.repo, ".pi", ".specsafe-state.json");
		fs.writeFileSync(
			stateFile,
			JSON.stringify({
				currentSlice: { id: "SPEC-003", beganAt: new Date().toISOString() },
				history: [],
			}),
		);

		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(
			/slice still open|specsafe_end|current.?slice/i,
		);
	});

	test("missing specsafe-state.json is treated as no open slice (passes check)", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/no-state"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/no-state");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		// No specsafe-state.json — must pass
		const result = await run(["--i-approve"], env.repo);
		expect(result.exitCode).toBe(0);
	});

	test("specsafe-state.json with currentSlice=null passes check", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/null-state"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/null-state");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		const stateFile = path.join(env.repo, ".pi", ".specsafe-state.json");
		fs.writeFileSync(
			stateFile,
			JSON.stringify({ currentSlice: null, history: [] }),
		);

		const result = await run(["--i-approve"], env.repo);
		expect(result.exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Pre-flight: dirty tree fails
// ---------------------------------------------------------------------------
describe("[unit] pre-flight: dirty working tree fails", () => {
	test("exits non-zero when tree is dirty", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/dirty"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/dirty");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		// Dirty the tree
		fs.writeFileSync(path.join(env.repo, "dirty-file.txt"), "uncommitted\n");

		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(
			/dirty|clean|uncommitted|working tree/i,
		);
	});
});

// ---------------------------------------------------------------------------
// Pre-flight: behind remote (diverged) fails
// ---------------------------------------------------------------------------
describe("[unit] pre-flight: behind remote fails", () => {
	test("exits non-zero when local is behind remote", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/behind"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/behind");

		// Simulate a remote commit by pushing directly to bare repo via another clone
		const clone = path.join(env.tmpDir, "clone");
		execGit(["clone", env.bareRepo, clone], env.tmpDir);
		execGit(["config", "user.email", "test@example.com"], clone);
		execGit(["config", "user.name", "Test User"], clone);
		// In clone, checkout feat/behind and add a commit
		execGit(["checkout", "-b", "feat/behind", "origin/feat/behind"], clone);
		makeCommit(clone, "feat: remote advance", "Spec-Slice: SPEC-003");
		execGit(["push", "origin", "feat/behind"], clone);

		// Fetch to update tracking without merging
		execGit(["fetch", "origin"], env.repo);

		// Local is now BEHIND (right > 0, left == 0 from right-right perspective)
		// Actually local has no new commits; remote does → local is behind
		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(/behind|diverged|ahead/i);
	});
});

// ---------------------------------------------------------------------------
// Pre-flight: no Spec-Slice trailer in range fails
// ---------------------------------------------------------------------------
describe("[unit] pre-flight: no Spec-Slice trailer in range fails", () => {
	test("exits non-zero when no Spec-Slice trailer found", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/no-trailer"], env.repo);
		makeCommit(env.repo, "feat: base without trailer");
		pushBaseline(env.repo, "feat/no-trailer");
		// Add commit ahead, but no Spec-Slice trailer
		makeCommit(env.repo, "feat: ahead without trailer");

		const result = await run(["--i-approve"], env.repo);

		expect(result.exitCode).not.toBe(0);
		const combined = result.stdout + result.stderr;
		expect(combined.toLowerCase()).toMatch(/spec-slice|trailer|seshat/i);
	});
});

// ---------------------------------------------------------------------------
// --remote flag
// ---------------------------------------------------------------------------
describe("[unit] --remote flag works", () => {
	test("explicit --remote=origin works same as default", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/remote-flag"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		pushBaseline(env.repo, "feat/remote-flag");
		makeCommit(env.repo, "feat: ahead", "Spec-Slice: SPEC-003");

		const result = await run(["--i-approve", "--remote=origin"], env.repo);
		expect(result.exitCode).toBe(0);

		const logPath = path.join(env.repo, ".pi", ".push-log.jsonl");
		const lines = fs
			.readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0]);
		expect(entry.remote).toBe("origin");
	});
});

// ---------------------------------------------------------------------------
// Not ahead of remote (at parity) fails check 2
// ---------------------------------------------------------------------------
describe("[unit] pre-flight: at parity with remote fails (not ahead)", () => {
	test("exits non-zero when no new commits (left==0)", async () => {
		makeCommit(env.repo, "chore: initial commit");
		pushBaseline(env.repo, "main");

		execGit(["checkout", "-b", "feat/parity"], env.repo);
		makeCommit(env.repo, "feat: base", "Spec-Slice: SPEC-003");
		// Push and don't add more commits — at parity
		pushBaseline(env.repo, "feat/parity");

		const result = await run(["--i-approve"], env.repo);
		expect(result.exitCode).not.toBe(0);
	});
});

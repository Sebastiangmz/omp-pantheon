/**
 * Tests for the future coherence skill.
 *
 * Contract for the implementer: these tests stub Linear by setting
 * `PI_COHERENCE_LINEAR_CMD` to an executable script path. The coherence CLI
 * must use that command instead of `bun run .omp/skills/linear/bin/linear.ts`
 * for every internal `linear list` / `linear get` invocation. The stub consumes
 * fixture paths from `PI_COHERENCE_LINEAR_LIST_FIXTURE` and
 * `PI_COHERENCE_LINEAR_GET_FIXTURE_DIR`.
 *
 * These are intentionally black-box RED tests: the production coherence CLI is
 * expected at `.omp/skills/coherence/bin/coherence.ts` and does not exist yet.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const COHERENCE_TS = path.resolve(
	process.cwd(),
	"skills/coherence/bin/coherence.ts",
);
const FIXTURE_DIR = path.resolve(import.meta.dir, "fixture");
const LINEAR_FIXTURE_DIR = path.join(FIXTURE_DIR, "linear");
const GET_IN_PROGRESS_DIR = path.join(LINEAR_FIXTURE_DIR, "get");
const GET_TRIAGE_DIR = path.join(LINEAR_FIXTURE_DIR, "get-triage");

let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

function makeTempDir(prefix = "omp-coherence-"): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function makeFixtureRepo(): string {
	const repo = makeTempDir();
	fs.cpSync(FIXTURE_DIR, repo, { recursive: true });
	return repo;
}

function writeLinearStub(tmpDir: string): string {
	const stubPath = path.join(tmpDir, "linear-stub.sh");
	fs.writeFileSync(
		stubPath,
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'cmd="${1:-}"',
			'case "$cmd" in',
			"  list)",
			'    cat "${PI_COHERENCE_LINEAR_LIST_FIXTURE:?missing list fixture}"',
			"    ;;",
			"  get)",
			'    key="${2:-}"',
			'    file="${PI_COHERENCE_LINEAR_GET_FIXTURE_DIR:?missing get fixture dir}/${key}.txt"',
			'    if [ -f "$file" ]; then',
			'      cat "$file"',
			"    else",
			'      echo "error: issue not found: $key" >&2',
			"      exit 2",
			"    fi",
			"    ;;",
			"  *)",
			'    echo "unknown linear stub command: $cmd" >&2',
			"    exit 2",
			"    ;;",
			"esac",
		].join("\n"),
	);
	fs.chmodSync(stubPath, 0o755);
	return stubPath;
}

function baseEnv(
	repo: string,
	overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
		HOME: repo,
		LINEAR_API_KEY: "lin_api_test",
		PI_COHERENCE_LINEAR_CMD: writeLinearStub(repo),
		PI_COHERENCE_LINEAR_LIST_FIXTURE: path.join(
			LINEAR_FIXTURE_DIR,
			"list-clean.txt",
		),
		PI_COHERENCE_LINEAR_GET_FIXTURE_DIR: GET_IN_PROGRESS_DIR,
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete env[key];
		} else {
			env[key] = value;
		}
	}
	return env;
}

function withoutLinearApiKey(
	repo: string,
	overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
	const env = baseEnv(repo, overrides);
	delete env.LINEAR_API_KEY;
	return env;
}

function runCoherence(
	repo: string,
	args: string[],
	overrides: Record<string, string | undefined> = {},
): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", COHERENCE_TS, ...args], {
		cwd: repo,
		encoding: "utf-8",
		env: baseEnv(repo, overrides),
	});
}

function runCoherenceWithoutLinearKey(
	repo: string,
	args: string[],
): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", COHERENCE_TS, ...args], {
		cwd: repo,
		encoding: "utf-8",
		env: withoutLinearApiKey(repo),
	});
}

function stdoutLines(result: SpawnSyncReturns<string>): string[] {
	return result.stdout.trim().split("\n").filter(Boolean);
}

function stderrLines(result: SpawnSyncReturns<string>): string[] {
	return result.stderr.trim().split("\n").filter(Boolean);
}

function expectOneStdoutLine(
	result: SpawnSyncReturns<string>,
	pattern: RegExp,
): void {
	const lines = stdoutLines(result);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatch(pattern);
}

function execGit(repo: string, args: string[]): void {
	const result = spawnSync("git", args, {
		cwd: repo,
		encoding: "utf-8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
			HOME: repo,
		},
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
}

function createCommitHistory(repo: string): void {
	execGit(repo, ["init", "-b", "main"]);
	execGit(repo, ["config", "user.email", "test@example.com"]);
	execGit(repo, ["config", "user.name", "Test User"]);
	execGit(repo, ["config", "commit.gpgsign", "false"]);
	execGit(repo, ["commit", "--allow-empty", "-m", "initial"]);
	execGit(repo, ["commit", "--allow-empty", "-m", "docs: no trailer"]);
	execGit(repo, [
		"commit",
		"--allow-empty",
		"-m",
		"fix: login\n\nSpec-Slice: CUR-92",
	]);
	execGit(repo, ["commit", "--allow-empty", "-m", "chore: still no trailer"]);
	execGit(repo, [
		"commit",
		"--allow-empty",
		"-m",
		"test: another slice\n\nSpec-Slice: CUR-92",
	]);
	execGit(repo, ["commit", "--allow-empty", "-m", "docs: tail commit"]);
}

describe("[unit] coherence skill", () => {
	test("C1 linear-vs-specs exits 0 on fixture repo with matching Linear issue and spec", () => {
		const repo = makeFixtureRepo();

		const result = runCoherence(repo, ["check", "linear-vs-specs"]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
	});

	test("C2 linear-vs-specs reports orphan-linear when Linear has in-progress ticket but no spec", () => {
		const repo = makeFixtureRepo();
		fs.rmSync(path.join(repo, "specs", "CUR-92__login-fix.md"));

		const result = runCoherence(repo, ["check", "linear-vs-specs"]);

		expect(result.status).toBe(1);
		expectOneStdoutLine(result, /^\[orphan-linear\] CUR-92/);
	});

	test("C3 linear-vs-specs reports orphan-spec when spec exists but Linear has no matching ticket", () => {
		const repo = makeFixtureRepo();

		const result = runCoherence(repo, ["check", "linear-vs-specs"], {
			PI_COHERENCE_LINEAR_LIST_FIXTURE: path.join(
				LINEAR_FIXTURE_DIR,
				"list-empty.txt",
			),
		});

		expect(result.status).toBe(1);
		expectOneStdoutLine(result, /^\[orphan-spec\] CUR-92/);
	});

	test("C4 trailers-vs-linear parses commits with and without Spec-Slice trailers", () => {
		const repo = makeFixtureRepo();
		createCommitHistory(repo);

		const result = runCoherence(repo, [
			"check",
			"trailers-vs-linear",
			"--range=HEAD~5..HEAD",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
	});

	test("C5 trailers-vs-linear reports stale-trailer when trailer ticket is still in triage", () => {
		const repo = makeFixtureRepo();
		createCommitHistory(repo);

		const result = runCoherence(
			repo,
			["check", "trailers-vs-linear", "--range=HEAD~5..HEAD"],
			{
				PI_COHERENCE_LINEAR_GET_FIXTURE_DIR: GET_TRIAGE_DIR,
			},
		);

		expect(result.status).toBe(1);
		expect(
			stdoutLines(result).some((line) => /^\[stale-trailer\]/.test(line)),
		).toBe(true);
	});

	test("C6 brief-coverage reports orphan-brief by Linear key prefix when a required brief is missing", () => {
		const repo = makeFixtureRepo();
		fs.rmSync(path.join(repo, "specs", "briefs", "CUR-92-brief.md"));

		const result = runCoherence(repo, ["check", "brief-coverage"]);

		expect(result.status).toBe(1);
		expectOneStdoutLine(result, /^\[orphan-brief\] CUR-92/);
	});

	test("C7 all subcommands exit 2 with a single-line Linear-unavailable notice when LINEAR_API_KEY is unset", () => {
		const repo = makeFixtureRepo();
		createCommitHistory(repo);
		const cases = [
			["check", "linear-vs-specs"],
			["check", "trailers-vs-linear", "--range=HEAD~5..HEAD"],
			["check", "brief-coverage"],
		];

		for (const args of cases) {
			const result = runCoherenceWithoutLinearKey(repo, args);
			expect(result.status).toBe(2);
			expect(result.stdout).toBe("");
			const lines = stderrLines(result);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("Linear");
			expect(lines[0]).toContain("unavailable");
			expect(lines[0]).toContain("LINEAR_API_KEY");
		}
	});

	test("C8 fixtures live under .omp/test/coherence and are usable by the black-box CLI", () => {
		for (const rel of [
			"specs/CUR-92__login-fix.md",
			"specs/briefs/CUR-92-brief.md",
			"linear/list-clean.txt",
			"linear/list-empty.txt",
			"linear/get/CUR-92.txt",
			"linear/get-triage/CUR-92.txt",
			"fake-commit-history.sh",
		]) {
			expect(fs.existsSync(path.join(FIXTURE_DIR, rel))).toBe(true);
		}

		const repo = makeFixtureRepo();
		const result = runCoherence(repo, ["check", "linear-vs-specs"]);
		expect(result.status).toBe(0);
	});
});

/**
 * Black-box RED tests for the future bootstrap skill.
 *
 * The production CLI is expected at `skills/bootstrap/bin/bootstrap.ts`.
 * These tests run it from hermetic temporary fixture projects and must never
 * write to the real source bundle.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const bootstrapBin = path.resolve(
	process.cwd(),
	"skills/bootstrap/bin/bootstrap.ts",
);
const piSeshatRoot = process.cwd();
const expectedOmpTarget = piSeshatRoot;
const gitignorePatterns = [
	".pi/.specsafe-state.json",
	".pi/.specsafe-state.json.corrupt-*",
	".pi/.push-log.jsonl",
	".pi/.linear-log.jsonl",
	".pi/.github-log.jsonl",
	".pi/.docs-registry-log.jsonl",
	".pi/.doc-drafts/",
	".pi/.docs-cache/",
	".pi/.bootstrap-log.jsonl",
];

let tempDir: string;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-"));
});

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

function runBootstrap(
	args: string[] = [],
	cwd = tempDir,
): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", bootstrapBin, ...args], {
		cwd,
		encoding: "utf-8",
		env: {
			...process.env,
		},
	});
}

function applyBootstrap(...args: string[]): SpawnSyncReturns<string> {
	return runBootstrap(["--i-approve", ...args]);
}

function readText(relativePath: string): string {
	return fs.readFileSync(path.join(tempDir, relativePath), "utf-8");
}

function statMtimes(paths: string[]): Record<string, number> {
	const mtimes: Record<string, number> = {};
	for (const relativePath of paths) {
		mtimes[relativePath] = fs.lstatSync(
			path.join(tempDir, relativePath),
		).mtimeMs;
	}
	return mtimes;
}

function auditLogPath(): string {
	return path.join(tempDir, ".pi", ".bootstrap-log.jsonl");
}

function auditLogLines(): string[] {
	return fs
		.readFileSync(auditLogPath(), "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean);
}

function countExactLine(content: string, expectedLine: string): number {
	return content.split(/\r?\n/).filter((line) => line === expectedLine).length;
}

function expectActionPreview(stdout: string, actionLabel: string): void {
	expect(stdout).toContain(actionLabel);
}

function dryRunPreviewIsEmpty(stdout: string): boolean {
	const actionLines = stdout
		.split(/\r?\n/)
		.filter((line) => /\bwould\s+/.test(line));
	return actionLines.length === 0 || stdout.includes("nothing to do");
}

describe("[unit] bootstrap skill", () => {
	test("C1 dry-run on a clean fixture previews all six mutation groups and leaves the fixture empty", () => {
		const result = runBootstrap();

		expect(result.status).toBe(0);
		expectActionPreview(result.stdout, "would create directories");
		expectActionPreview(result.stdout, "would symlink .omp →");
		expectActionPreview(result.stdout, "would write AGENTS.md");
		expectActionPreview(result.stdout, "would write CLAUDE.md");
		expectActionPreview(result.stdout, "would update .gitignore");
		expectActionPreview(result.stdout, "would write audit log");
		expect(fs.readdirSync(tempDir)).toHaveLength(0);
	});

	test("C2 apply creates .pi, specs, specs/briefs, and specs/archive as real directories", () => {
		const result = applyBootstrap();

		expect(result.status).toBe(0);
		for (const dir of [".pi", "specs", "specs/briefs", "specs/archive"]) {
			expect(fs.statSync(path.join(tempDir, dir)).isDirectory()).toBe(true);
		}
	});

	test("C3 apply creates .omp as a symlink to the pi-seshat .omp tree", () => {
		const result = applyBootstrap();
		const ompPath = path.join(tempDir, ".omp");

		expect(result.status).toBe(0);
		expect(fs.lstatSync(ompPath).isSymbolicLink()).toBe(true);
		expect(fs.realpathSync(ompPath)).toBe(expectedOmpTarget);
	});

	test("C4 apply writes AGENTS.md with the fixture project name substituted", () => {
		const result = applyBootstrap();
		const agentsPath = path.join(tempDir, "AGENTS.md");

		expect(result.status).toBe(0);
		expect(fs.existsSync(agentsPath)).toBe(true);
		expect(readText("AGENTS.md")).toContain(path.basename(tempDir));
	});

	test("C5 apply writes non-empty CLAUDE.md", () => {
		const result = applyBootstrap();
		const claudePath = path.join(tempDir, "CLAUDE.md");

		expect(result.status).toBe(0);
		expect(fs.existsSync(claudePath)).toBe(true);
		expect(readText("CLAUDE.md").trim().length).toBeGreaterThan(0);
	});

	test("C6 apply appends each bootstrap .gitignore pattern once and re-apply does not duplicate them", () => {
		const first = applyBootstrap();
		expect(first.status).toBe(0);
		const firstGitignore = readText(".gitignore");

		for (const pattern of gitignorePatterns) {
			expect(countExactLine(firstGitignore, pattern)).toBe(1);
		}

		const firstSize = fs.statSync(path.join(tempDir, ".gitignore")).size;
		const second = applyBootstrap();
		expect(second.status).toBe(0);
		const secondGitignore = readText(".gitignore");

		expect(fs.statSync(path.join(tempDir, ".gitignore")).size).toBe(firstSize);
		for (const pattern of gitignorePatterns) {
			expect(countExactLine(secondGitignore, pattern)).toBe(1);
		}
	});

	test("C7 apply writes a 0600 JSONL audit log with bootstrap action and luci approver", () => {
		const result = applyBootstrap();
		const logPath = auditLogPath();

		expect(result.status).toBe(0);
		expect(fs.existsSync(logPath)).toBe(true);
		expect(fs.statSync(logPath).mode & 0o777).toBe(0o600);

		const lines = auditLogLines();
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0]!) as {
			action?: unknown;
			approver?: unknown;
		};
		expect(entry.action).toBe("bootstrap");
		expect(entry.approver).toBe("luci");
	});

	test("C8 re-apply only appends audit history and a later dry-run leaves the bootstrapped project unchanged", () => {
		const first = applyBootstrap();
		expect(first.status).toBe(0);
		const stablePaths = ["AGENTS.md", "CLAUDE.md", ".omp"];
		const beforeStableMtimes = statMtimes(stablePaths);
		const beforeLogMtime = fs.statSync(auditLogPath()).mtimeMs;

		const second = applyBootstrap();
		expect(second.status).toBe(0);
		expect(auditLogLines()).toHaveLength(2);
		expect(fs.statSync(auditLogPath()).mtimeMs).not.toBe(beforeLogMtime);
		expect(statMtimes(stablePaths)).toEqual(beforeStableMtimes);

		const beforeDryRunMtimes = statMtimes([
			...stablePaths,
			".gitignore",
			".pi/.bootstrap-log.jsonl",
		]);
		const dryRun = runBootstrap();
		expect(dryRun.status).toBe(0);
		expect(dryRunPreviewIsEmpty(dryRun.stdout)).toBe(true);
		expect(
			statMtimes([...stablePaths, ".gitignore", ".pi/.bootstrap-log.jsonl"]),
		).toEqual(beforeDryRunMtimes);
	});

	test("C9 refuses to bootstrap pi-seshat itself rather than mistaking a foreign symlinked .omp for self", () => {
		// Self-detection must reject only a real `<cwd>/.omp` directory. A foreign
		// project that has already been bootstrapped reaches `.omp/skills/bootstrap`
		// through a symlink and must not be classified as pi-seshat self.
		const result = runBootstrap([], piSeshatRoot);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("pi-seshat self");
	});

	test("C10 apply refuses a regular .omp directory conflict and --force-symlink replaces it with the correct symlink", () => {
		fs.mkdirSync(path.join(tempDir, ".omp"));

		const conflict = applyBootstrap();
		expect(conflict.status).toBe(1);
		expect(conflict.stderr).toContain("conflict");
		expect(fs.statSync(path.join(tempDir, ".omp")).isDirectory()).toBe(true);
		expect(fs.lstatSync(path.join(tempDir, ".omp")).isSymbolicLink()).toBe(
			false,
		);

		const forced = applyBootstrap("--force-symlink");
		expect(forced.status).toBe(0);
		expect(fs.lstatSync(path.join(tempDir, ".omp")).isSymbolicLink()).toBe(
			true,
		);
		expect(fs.realpathSync(path.join(tempDir, ".omp"))).toBe(expectedOmpTarget);
	});

	test("C11 apply preserves existing AGENTS.md and CLAUDE.md user content", () => {
		fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "USER MODIFIED");
		fs.writeFileSync(path.join(tempDir, "CLAUDE.md"), "USER MODIFIED");

		const result = applyBootstrap();

		expect(result.status).toBe(0);
		expect(readText("AGENTS.md")).toBe("USER MODIFIED");
		expect(readText("CLAUDE.md")).toBe("USER MODIFIED");
	});
});

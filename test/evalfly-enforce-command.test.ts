import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { readEvalFlyEnforcementState } from "../skills/evalfly/bin/enforcement-state";
import { dispatch } from "../skills/evalfly/bin/evalfly.ts";

async function withTempProject(
	run: (cwd: string) => Promise<void>,
): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-command-"));
	try {
		await run(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

describe("evalfly enforce command", () => {
	test("status reports advisory by default", async () => {
		await withTempProject(async (cwd) => {
			const result = await dispatch(["enforce", "status"], { cwd });

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("EvalFly enforcement: advisory");
			expect(result.stdout).toContain("not blocking by default");
		});
	});

	test("start writes enforced state with suite, commit range, and timestamp", async () => {
		await withTempProject(async (cwd) => {
			const result = await dispatch(
				[
					"enforce",
					"start",
					"--suite",
					"smoke",
					"--commit-range",
					"main..HEAD",
				],
				{ cwd, now: () => new Date("2026-06-20T10:11:12.000Z") },
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("EvalFly enforcement: enforced");
			expect(result.stdout).toContain("suite: smoke");
			expect(result.stdout).toContain("commit range: main..HEAD");
			expect(readEvalFlyEnforcementState(cwd)).toEqual({
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
				activatedAt: "2026-06-20T10:11:12.000Z",
				activatedBy: "evalfly enforce start",
			});
			await expect(
				readFile(join(cwd, ".pi", "evalfly", "enforcement.json"), "utf8"),
			).resolves.toContain('"mode": "enforced"');
		});
	});

	test("stop writes advisory state", async () => {
		await withTempProject(async (cwd) => {
			await dispatch(
				[
					"enforce",
					"start",
					"--suite",
					"smoke",
					"--commit-range",
					"main..HEAD",
				],
				{ cwd, now: () => new Date("2026-06-20T10:11:12.000Z") },
			);

			const result = await dispatch(["enforce", "stop"], { cwd });

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("EvalFly enforcement: advisory");
			expect(readEvalFlyEnforcementState(cwd)).toEqual({ mode: "advisory" });
		});
	});

	test("invalid or missing subcommands fail with helpful stderr", async () => {
		await withTempProject(async (cwd) => {
			const invalid = await dispatch(["enforce", "forever"], { cwd });
			expect(invalid.exitCode).toBe(1);
			expect(invalid.stdout).toBe("");
			expect(invalid.stderr).toContain(
				"unknown evalfly enforce subcommand: forever",
			);
			expect(invalid.stderr).toContain("evalfly enforce status");
			expect(invalid.stderr).toContain(
				"evalfly enforce start --suite smoke --commit-range main..HEAD",
			);

			const missing = await dispatch(["enforce"], { cwd });
			expect(missing.exitCode).toBe(1);
			expect(missing.stdout).toBe("");
			expect(missing.stderr).toContain("missing evalfly enforce subcommand");
			expect(missing.stderr).toContain("evalfly enforce stop");
		});
	});

	test("existing unknown-command behavior still reports top-level usage", async () => {
		await withTempProject(async (cwd) => {
			const result = await dispatch(["unknown-command"], { cwd });

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("unknown command: unknown-command");
			expect(result.stderr).toContain("Usage: evalfly validate");
		});
	});

	test("slash command markdown carries actionable argument contract", async () => {
		const command = await readFile("commands/evalfly-enforce.md", "utf8");

		expect(command).toContain("<command-instruction>");
		expect(command).toContain("$ARGUMENTS");
		expect(command).toContain("bun run <evalfly.ts path> enforce $ARGUMENTS");
		expect(command).toContain(".pi/evalfly/enforcement.json");
		expect(command).toContain(
			'Do not claim enforcement is active unless that file shows `"mode": "enforced"`.',
		);
	});
});

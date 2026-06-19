import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { dispatch } from "../bin/evalfly.ts";
import { validateEvalRun } from "../bin/schema.ts";

const validCase = {
	schema_version: "evalfly.case.v1",
	case_id: "critical-file-exists",
	title: "Critical file exists",
	suite: "smoke",
	risk_tier: "critical",
	task_type: "deterministic_fixture",
	source: { kind: "fixture" },
	privacy: { classification: "public", sanitized: true },
	expected: { success_criteria: ["The expected file exists."] },
	judge: {
		type: "deterministic",
		assertions: [{ type: "file_exists", path: "expected.txt" }],
	},
} as const;

async function makeProject(
	config: unknown = {
		schema_version: "evalfly.config.v1",
		name: "Smoke suite",
		cases: [validCase],
	},
) {
	const cwd = await mkdtemp(join(tmpdir(), "evalfly-"));
	await mkdir(join(cwd, "evals"), { recursive: true });
	await writeFile(
		join(cwd, "evals", "config.json"),
		JSON.stringify(config, null, 2),
	);
	return cwd;
}

function caseWithFileExistsPath(path: string) {
	return {
		...validCase,
		judge: {
			type: "deterministic",
			assertions: [{ type: "file_exists", path }],
		},
	};
}

describe("evalfly CLI", () => {
	test("validate succeeds on valid evals tree", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");

		const result = await dispatch(["validate"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("valid");
	});

	test("CLI entrypoint validates a project cwd", async () => {
		const cwd = await makeProject();
		const result = spawnSync(
			process.execPath,
			[join(import.meta.dir, "..", "bin", "evalfly.ts"), "validate"],
			{
				cwd,
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("valid");
	});

	test("validate fails with clear error on invalid case", async () => {
		const cwd = await makeProject({
			schema_version: "evalfly.config.v1",
			name: "Broken suite",
			cases: [{ ...validCase, suite: "nightly" }],
		});

		const result = await dispatch(["validate"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("cases[0].suite");
		expect(result.stderr).toContain("nightly");
	});

	test("run --suite smoke writes run JSON and markdown report", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-smoke-test",
		});

		expect(result.exitCode).toBe(0);
		const run = JSON.parse(
			await readFile(join(cwd, "evals", "runs", "run-smoke-test.json"), "utf8"),
		);
		expect(run.schema_version).toBe("evalfly.run.v1");
		expect(run.run_id).toBe("run-smoke-test");
		expect(run.suite).toBe("smoke");
		expect(run.created_at).toBe("2026-06-19T12:00:00.000Z");
		expect(run.summary).toEqual({
			total: 1,
			passed: 1,
			failed: 0,
			critical_regressions: 0,
		});
		expect(run.verdict).toBe("pass");
		expect(run.results[0]).toMatchObject({
			case_id: "critical-file-exists",
			passed: true,
			critical: true,
		});
		expect(validateEvalRun(run).ok).toBe(true);

		const report = await readFile(
			join(cwd, "evals", "reports", "run-smoke-test.md"),
			"utf8",
		);
		expect(report).toContain("Suite: smoke");
		expect(report).toContain("Passed: 1");
		expect(report).toContain("Failed: 0");
		expect(report).toContain("critical_regressions: 0");
		expect(report).toContain("Privacy: sanitized");
		expect(report).toContain("Verdict: pass");
	});

	test("missing file_exists critical case produces fail verdict and nonzero exit", async () => {
		const cwd = await makeProject();

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-missing-critical",
		});

		expect(result.exitCode).toBe(1);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-missing-critical.json"),
				"utf8",
			),
		);
		expect(run.verdict).toBe("fail");
		expect(run.summary.critical_regressions).toBe(1);
		expect(run.results[0]).toMatchObject({ passed: false, critical: true });
		expect(run.results[0].errors.join("\n")).toContain("expected.txt");
	});

	test("file_exists parent traversal outside cwd fails without probing outside files", async () => {
		const cwd = await makeProject();
		const outsideName = `${basename(cwd)}-outside.txt`;
		await writeFile(
			join(cwd, "evals", "config.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.config.v1",
					name: "Traversal suite",
					cases: [caseWithFileExistsPath(`../${outsideName}`)],
				},
				null,
				2,
			),
		);
		await writeFile(join(cwd, "..", outsideName), "outside");

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-traversal",
		});

		expect(result.exitCode).toBe(1);
		const run = JSON.parse(
			await readFile(join(cwd, "evals", "runs", "run-traversal.json"), "utf8"),
		);
		expect(run.results[0]).toMatchObject({ passed: false, critical: true });
		expect(run.results[0].errors.join("\n")).toContain(
			"file_exists path must stay within cwd",
		);
	});

	test("file_exists absolute path fails without probing outside files", async () => {
		const cwd = await makeProject();
		const absolutePath = join(cwd, "..", `${basename(cwd)}-absolute.txt`);
		await writeFile(absolutePath, "outside");
		await writeFile(
			join(cwd, "evals", "config.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.config.v1",
					name: "Absolute suite",
					cases: [caseWithFileExistsPath(absolutePath)],
				},
				null,
				2,
			),
		);

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-absolute",
		});

		expect(result.exitCode).toBe(1);
		const run = JSON.parse(
			await readFile(join(cwd, "evals", "runs", "run-absolute.json"), "utf8"),
		);
		expect(run.results[0]).toMatchObject({ passed: false, critical: true });
		expect(run.results[0].errors.join("\n")).toContain(
			"file_exists path must stay within cwd",
		);
	});

	test("file_exists symlink escape outside cwd fails without probing outside files", async () => {
		const cwd = await makeProject();
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-outside-"));
		await writeFile(join(outsideDir, "secret.txt"), "outside");
		await symlink(outsideDir, join(cwd, "link-outside"), "dir");
		await writeFile(
			join(cwd, "evals", "config.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.config.v1",
					name: "Symlink escape suite",
					cases: [caseWithFileExistsPath("link-outside/secret.txt")],
				},
				null,
				2,
			),
		);

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-symlink-escape",
		});

		expect(result.exitCode).toBe(1);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-symlink-escape.json"),
				"utf8",
			),
		);
		expect(run.results[0]).toMatchObject({ passed: false, critical: true });
		expect(run.results[0].errors.join("\n")).toContain(
			"file_exists path must stay within cwd",
		);
	});

	test("file_exists symlink to directory inside cwd passes", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "actual"), { recursive: true });
		await writeFile(join(cwd, "actual", "expected.txt"), "inside");
		await symlink(join(cwd, "actual"), join(cwd, "link-inside"), "dir");
		await writeFile(
			join(cwd, "evals", "config.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.config.v1",
					name: "Symlink inside suite",
					cases: [caseWithFileExistsPath("link-inside/expected.txt")],
				},
				null,
				2,
			),
		);

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-symlink-inside",
		});

		expect(result.exitCode).toBe(0);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-symlink-inside.json"),
				"utf8",
			),
		);
		expect(run.results[0]).toMatchObject({ passed: true, critical: true });
	});

	test("report content includes verdict and critical_regressions", async () => {
		const cwd = await makeProject();

		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-report-fields",
		});

		const reportResult = await dispatch(["report", "run-report-fields"], {
			cwd,
		});
		const report = await readFile(
			join(cwd, "evals", "reports", "run-report-fields.md"),
			"utf8",
		);

		expect(reportResult.exitCode).toBe(0);
		expect(report).toContain("Verdict: fail");
		expect(report).toContain("critical_regressions: 1");
	});
});

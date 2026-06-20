import { spawnSync } from "node:child_process";
import {
	access,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
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

	test("check --suite smoke runs the suite and prints the report path", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");

		const result = await dispatch(
			["check", "--suite", "smoke", "--commit-range", "main..HEAD"],
			{
				cwd,
				now: () => new Date("2026-06-19T12:00:00.000Z"),
				runId: "run-check-pass",
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("evalfly check run-check-pass: pass");
		expect(result.stdout).toContain("report: evals/reports/run-check-pass.md");
		const run = JSON.parse(
			await readFile(join(cwd, "evals", "runs", "run-check-pass.json"), "utf8"),
		);
		expect(run.verdict).toBe("pass");
		expect(run.context.commit_range).toBe("main..HEAD");
		await expect(
			readFile(join(cwd, "evals", "reports", "run-check-pass.md"), "utf8"),
		).resolves.toContain("Verdict: pass");
	});

	test("check --suite smoke returns nonzero while preserving failed evidence", async () => {
		const cwd = await makeProject();

		const result = await dispatch(["check", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-check-fail",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("evalfly check run-check-fail: fail");
		expect(result.stdout).toContain("report: evals/reports/run-check-fail.md");
		const run = JSON.parse(
			await readFile(join(cwd, "evals", "runs", "run-check-fail.json"), "utf8"),
		);
		expect(run.verdict).toBe("fail");
		expect(run.summary.critical_regressions).toBe(1);
		await expect(
			readFile(join(cwd, "evals", "reports", "run-check-fail.md"), "utf8"),
		).resolves.toContain("Verdict: fail");
	});

	test("run links current SpecSafe slice by reference without mutating state", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, "expected.txt"), "ok");
		const statePath = join(cwd, ".pi", ".specsafe-state.json");
		const state = `${JSON.stringify(
			{
				currentSlice: {
					id: "SPEC-20260619-001",
					workspaceId: "ws-abc",
					sessionId: "sess-abc",
					beganAt: "2026-06-19T11:00:00.000Z",
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
			},
			null,
			2,
		)}\n`;
		await writeFile(statePath, state);

		const result = await dispatch(
			["run", "--suite", "smoke", "--commit-range", "main..HEAD"],
			{
				cwd,
				now: () => new Date("2026-06-19T12:00:00.000Z"),
				runId: "run-specsafe-linkage",
			},
		);

		expect(result.exitCode).toBe(0);
		expect(await readFile(statePath, "utf8")).toBe(state);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-specsafe-linkage.json"),
				"utf8",
			),
		);
		expect(run.context).toEqual({
			spec_slice: "SPEC-20260619-001",
			session_id: "sess-abc",
			commit_range: "main..HEAD",
			eval_report_path: "evals/reports/run-specsafe-linkage.md",
		});
		const report = await readFile(
			join(cwd, "evals", "reports", "run-specsafe-linkage.md"),
			"utf8",
		);
		expect(report).toContain("Spec-Slice: SPEC-20260619-001");
		expect(report).toContain("Session: sess-abc");
		expect(report).toContain("Commit range: main..HEAD");
		expect(report).toContain(
			"evalReportPath: evals/reports/run-specsafe-linkage.md",
		);
	});

	test("run ignores a SpecSafe state symlink outside cwd", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, "expected.txt"), "ok");
		const outsideDir = await mkdtemp(
			join(tmpdir(), "evalfly-specsafe-outside-"),
		);
		await writeFile(
			join(outsideDir, "state.json"),
			JSON.stringify({
				currentSlice: {
					id: "SPEC-OUTSIDE",
					sessionId: "sess-outside",
				},
				history: [],
			}),
		);
		await symlink(
			join(outsideDir, "state.json"),
			join(cwd, ".pi", ".specsafe-state.json"),
		);

		const result = await dispatch(
			["run", "--suite", "smoke", "--commit-range", "main..HEAD"],
			{
				cwd,
				now: () => new Date("2026-06-19T12:00:00.000Z"),
				runId: "run-specsafe-symlink",
			},
		);

		expect(result.exitCode).toBe(0);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-specsafe-symlink.json"),
				"utf8",
			),
		);
		expect(run.context).toEqual({
			commit_range: "main..HEAD",
			eval_report_path: "evals/reports/run-specsafe-symlink.md",
		});
	});

	test("run fails clearly when SpecSafe state exists but is malformed", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, "expected.txt"), "ok");
		await writeFile(join(cwd, ".pi", ".specsafe-state.json"), "{not json");

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-malformed-specsafe",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("failed to read .pi/.specsafe-state.json");
		await expect(
			readFile(join(cwd, "evals", "runs", "run-malformed-specsafe.json")),
		).rejects.toThrow();
	});

	test("run fails clearly when SpecSafe state has malformed shape", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, "expected.txt"), "ok");
		await writeFile(
			join(cwd, ".pi", ".specsafe-state.json"),
			JSON.stringify({ history: [] }),
		);

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-bad-specsafe-shape",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("failed to read .pi/.specsafe-state.json");
		await expect(
			readFile(join(cwd, "evals", "runs", "run-bad-specsafe-shape.json")),
		).rejects.toThrow();
	});

	test("run rejects control characters in commit range before writing artifacts", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");

		const result = await dispatch(
			["run", "--suite", "smoke", "--commit-range", "main..HEAD\nInjected"],
			{
				cwd,
				now: () => new Date("2026-06-19T12:00:00.000Z"),
				runId: "run-bad-commit-range",
			},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--commit-range must be a single line");
		await expect(
			readFile(join(cwd, "evals", "runs", "run-bad-commit-range.json")),
		).rejects.toThrow();
	});

	test("run rejects --commit-range without a value before writing artifacts", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");

		const result = await dispatch(
			["run", "--suite", "smoke", "--commit-range", "--unused"],
			{
				cwd,
				now: () => new Date("2026-06-19T12:00:00.000Z"),
				runId: "run-missing-commit-range",
			},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--commit-range requires a value");
		await expect(
			readFile(join(cwd, "evals", "runs", "run-missing-commit-range.json")),
		).rejects.toThrow();
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

	test("run --suite smoke rejects an empty selected suite", async () => {
		const cwd = await makeProject({
			schema_version: "evalfly.config.v1",
			name: "Regression only suite",
			cases: [{ ...validCase, suite: "regression" }],
		});

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-empty-smoke",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("no cases selected for suite: smoke");
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

	test("run records llm judge cases as unsupported without calling an llm", async () => {
		const cwd = await makeProject({
			schema_version: "evalfly.config.v1",
			name: "LLM metadata suite",
			cases: [
				{
					...validCase,
					case_id: "llm-advisory-case",
					title: "LLM advisory case",
					judge: {
						type: "llm",
						rubric: "Judge whether the answer cites the EvalFly report path.",
						model: "gpt-4.1-mini",
					},
				},
			],
		});

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-20T12:00:00.000Z"),
			runId: "run-llm-advisory",
		});

		expect(result.exitCode).toBe(1);
		const run = JSON.parse(
			await readFile(
				join(cwd, "evals", "runs", "run-llm-advisory.json"),
				"utf8",
			),
		);
		expect(run.results[0]).toMatchObject({
			case_id: "llm-advisory-case",
			passed: false,
			errors: ["unsupported judge type: llm"],
		});
	});

	test("latest prints the newest valid run and report path", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-older",
		});
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-20T12:00:00.000Z"),
			runId: "run-newer",
		});

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("latest evalfly run: run-newer");
		expect(result.stdout).toContain("verdict: pass");
		expect(result.stdout).toContain("suite: smoke");
		expect(result.stdout).toContain("report: evals/reports/run-newer.md");
		expect(result.stdout).not.toContain("run-older");
	});

	test("list prints valid runs newest first with canonical report paths", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-older",
		});
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-20T12:00:00.000Z"),
			runId: "run-newer",
		});
		const runPath = join(cwd, "evals", "runs", "run-newer.json");
		const run = JSON.parse(await readFile(runPath, "utf8"));
		run.context.eval_report_path = "/Users/sebastian/private/raw-trace.md";
		await writeFile(runPath, JSON.stringify(run, null, 2));

		const result = await dispatch(["list"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("evalfly runs:\n");
		expect(result.stdout).toContain(
			"2026-06-20T12:00:00.000Z run-newer pass smoke evals/reports/run-newer.md",
		);
		expect(result.stdout).toContain(
			"2026-06-19T12:00:00.000Z run-older pass smoke evals/reports/run-older.md",
		);
		expect(result.stdout.indexOf("run-newer")).toBeLessThan(
			result.stdout.indexOf("run-older"),
		);
		expect(result.stdout).not.toContain("/Users/sebastian");
	});

	test("summary prints aggregate evidence and latest context", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-pass",
		});
		await rm(join(cwd, "expected.txt"));
		await dispatch(
			["run", "--suite", "smoke", "--commit-range", "main..HEAD"],
			{
				cwd,
				now: () => new Date("2026-06-20T12:00:00.000Z"),
				runId: "run-fail",
			},
		);

		const result = await dispatch(["summary"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("evalfly summary:");
		expect(result.stdout).toContain("runs: 2");
		expect(result.stdout).toContain("passing runs: 1");
		expect(result.stdout).toContain("failing runs: 1");
		expect(result.stdout).toContain("critical regressions: 1");
		expect(result.stdout).toContain("latest run: run-fail");
		expect(result.stdout).toContain("latest verdict: fail");
		expect(result.stdout).toContain("latest report: evals/reports/run-fail.md");
		expect(result.stdout).toContain("latest commit range: main..HEAD");
		expect(result.stdout).not.toContain("/Users/sebastian");
	});

	test("traces lists sanitized trace fixtures without reading raw traces", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "traces", "sanitized"), { recursive: true });
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "traces", "sanitized", "alpha.json"),
			'{"ok":true}\n',
		);
		await writeFile(
			join(cwd, "evals", "traces", "sanitized", "beta.txt"),
			"beta\n",
		);
		await writeFile(
			join(cwd, ".pi", "evalfly", "raw", "secret.txt"),
			"secret@example.com\n",
		);

		const result = await dispatch(["traces"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("sanitized evalfly traces:");
		expect(result.stdout).toContain("evals/traces/sanitized/alpha.json");
		expect(result.stdout).toContain("evals/traces/sanitized/beta.txt");
		expect(result.stdout).toContain("bytes:");
		expect(result.stdout).not.toContain("secret");
		expect(result.stdout).not.toContain(".pi/evalfly/raw");
	});

	test("traces refuses symlinked sanitized trace files", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "traces", "sanitized"), { recursive: true });
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-trace-outside-"));
		await writeFile(join(outsideDir, "outside.txt"), "private\n");
		await symlink(
			join(outsideDir, "outside.txt"),
			join(cwd, "evals", "traces", "sanitized", "outside.txt"),
		);

		const result = await dispatch(["traces"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"unsafe sanitized trace: evals/traces/sanitized/outside.txt",
		);
	});

	test("list rejects malformed saved run records instead of hiding them", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "broken.json"),
			JSON.stringify({
				schema_version: "evalfly.run.v1",
				run_id: "broken",
				suite: "smoke",
				config_name: "Smoke suite",
				created_at: "2026-06-20T12:00:00.000Z",
				results: "not-an-array",
				summary: {
					total: 0,
					passed: 0,
					failed: 0,
					critical_regressions: 0,
				},
				verdict: "pass",
			}),
		);

		const result = await dispatch(["list"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("invalid evals/runs/broken.json");
		expect(result.stderr).toContain("results must be an array");
	});

	test("latest rejects malformed saved run records instead of hiding them", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "broken.json"),
			JSON.stringify({
				schema_version: "evalfly.run.v1",
				run_id: "broken",
				suite: "smoke",
				config_name: "Smoke suite",
				created_at: "2026-06-20T12:00:00.000Z",
				results: "not-an-array",
				summary: {
					total: 0,
					passed: 0,
					failed: 0,
					critical_regressions: 0,
				},
				verdict: "pass",
			}),
		);

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("invalid evals/runs/broken.json");
		expect(result.stderr).toContain("results must be an array");
	});

	test("latest rejects non-ISO created_at values before ordering", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "bad-date.json"),
			JSON.stringify({
				schema_version: "evalfly.run.v1",
				run_id: "bad-date",
				suite: "smoke",
				config_name: "Smoke suite",
				created_at: "zz",
				results: [],
				summary: {
					total: 0,
					passed: 0,
					failed: 0,
					critical_regressions: 0,
				},
				verdict: "pass",
			}),
		);

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("invalid evals/runs/bad-date.json");
		expect(result.stderr).toContain("created_at must be an ISO timestamp");
	});

	test("latest derives report path from run id instead of saved context", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-20T12:00:00.000Z"),
			runId: "run-canonical-report",
		});
		const runPath = join(cwd, "evals", "runs", "run-canonical-report.json");
		const run = JSON.parse(await readFile(runPath, "utf8"));
		run.context.eval_report_path = "/Users/sebastian/private/raw-trace.md";
		await writeFile(runPath, JSON.stringify(run, null, 2));

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"report: evals/reports/run-canonical-report.md",
		);
		expect(result.stdout).not.toContain("/Users/sebastian");
	});

	test("latest requires the canonical report artifact to exist", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "missing-report.json"),
			JSON.stringify({
				schema_version: "evalfly.run.v1",
				run_id: "missing-report",
				suite: "smoke",
				config_name: "Smoke suite",
				created_at: "2026-06-20T12:00:00.000Z",
				results: [],
				summary: {
					total: 0,
					passed: 0,
					failed: 0,
					critical_regressions: 0,
				},
				verdict: "pass",
			}),
		);

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"missing report: evals/reports/missing-report.md",
		);
	});

	test("latest refuses symlinked run artifact files", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		const outsideDir = await mkdtemp(
			join(tmpdir(), "evalfly-run-file-outside-"),
		);
		await writeFile(
			join(outsideDir, "run-link.json"),
			JSON.stringify({
				schema_version: "evalfly.run.v1",
				run_id: "run-link",
				suite: "smoke",
				config_name: "Smoke suite",
				created_at: "2026-06-20T12:00:00.000Z",
				results: [],
				summary: {
					total: 0,
					passed: 0,
					failed: 0,
					critical_regressions: 0,
				},
				verdict: "pass",
			}),
		);
		await symlink(
			join(outsideDir, "run-link.json"),
			join(cwd, "evals", "runs", "run-link.json"),
		);

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"unsafe run artifact: evals/runs/run-link.json",
		);
	});

	test("latest refuses symlinked report artifact files", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-20T12:00:00.000Z"),
			runId: "run-report-link",
		});
		const outsideDir = await mkdtemp(
			join(tmpdir(), "evalfly-report-file-outside-"),
		);
		await writeFile(join(outsideDir, "report.md"), "private report\n");
		await rm(join(cwd, "evals", "reports", "run-report-link.md"));
		await symlink(
			join(outsideDir, "report.md"),
			join(cwd, "evals", "reports", "run-report-link.md"),
		);

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"unsafe report artifact: evals/reports/run-report-link.md",
		);
	});

	test("latest fails clearly when no run artifacts exist", async () => {
		const cwd = await makeProject();

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("no evalfly runs found");
		await expect(access(join(cwd, "evals", "runs"))).rejects.toThrow();
	});

	test("latest does not create runs through a symlinked evals directory", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "evalfly-"));
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-latest-outside-"));
		await symlink(outsideDir, join(cwd, "evals"), "dir");

		const result = await dispatch(["latest"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must be evals");
		await expect(access(join(outsideDir, "runs"))).rejects.toThrow();
	});
	test("report rejects unsafe run ids before reading run artifacts", async () => {
		const cwd = await makeProject();

		const result = await dispatch(["report", "../outside"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsafe run id");
	});

	test("report rejects saved run_id that would write outside reports directory", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "safe-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "../escaped-report",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);

		const result = await dispatch(["report", "safe-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsafe run id");
	});

	test("run refuses to write through an escaping runs directory symlink", async () => {
		const cwd = await makeProject();
		await writeFile(join(cwd, "expected.txt"), "ok");
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-runs-outside-"));
		await symlink(outsideDir, join(cwd, "evals", "runs"), "dir");

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-symlink-runs",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must stay within cwd");
	});

	test("run refuses when evals is a symlink outside cwd and does not create outside runs", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "evalfly-"));
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-evals-outside-"));
		await writeFile(
			join(outsideDir, "config.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.config.v1",
					name: "Smoke suite",
					cases: [validCase],
				},
				null,
				2,
			),
		);
		await writeFile(join(cwd, "expected.txt"), "ok");
		await symlink(outsideDir, join(cwd, "evals"), "dir");

		const result = await dispatch(["run", "--suite", "smoke"], {
			cwd,
			now: () => new Date("2026-06-19T12:00:00.000Z"),
			runId: "run-evals-symlink",
		});

		expect(result.exitCode).toBe(1);
		await expect(access(join(outsideDir, "runs"))).rejects.toThrow();
		expect(result.stderr).toContain("artifact directory must be evals");
	});

	test("report refuses to read through an escaping runs directory symlink", async () => {
		const cwd = await makeProject();
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-runs-outside-"));
		await writeFile(
			join(outsideDir, "outside-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "outside-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);
		await symlink(outsideDir, join(cwd, "evals", "runs"), "dir");

		const result = await dispatch(["report", "outside-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must stay within cwd");
	});

	test("report refuses to write through an escaping reports directory symlink", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "safe-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "safe-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);
		const outsideDir = await mkdtemp(
			join(tmpdir(), "evalfly-reports-outside-"),
		);
		await symlink(outsideDir, join(cwd, "evals", "reports"), "dir");

		const result = await dispatch(["report", "safe-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must stay within cwd");
	});

	test("report refuses to write through a reports directory symlink inside cwd", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "safe-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "safe-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);
		await mkdir(join(cwd, "reports-target"), { recursive: true });
		await symlink(
			join(cwd, "reports-target"),
			join(cwd, "evals", "reports"),
			"dir",
		);

		const result = await dispatch(["report", "safe-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must be evals/reports");
	});

	test("report refuses when evals is a symlink outside cwd and does not create outside reports", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "evalfly-"));
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-evals-outside-"));
		await mkdir(join(outsideDir, "runs"), { recursive: true });
		await writeFile(
			join(outsideDir, "runs", "safe-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "safe-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);
		await symlink(outsideDir, join(cwd, "evals"), "dir");

		const result = await dispatch(["report", "safe-run"], { cwd });

		expect(result.exitCode).toBe(1);
		await expect(access(join(outsideDir, "reports"))).rejects.toThrow();
		expect(result.stderr).toContain("artifact directory must be evals");
	});

	test('report safe-run rejects a saved JSON with run_id: "other-safe-run"', async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "safe-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "other-safe-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: [],
					summary: {
						total: 0,
						passed: 0,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);

		const result = await dispatch(["report", "safe-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"run_id mismatch: requested safe-run but saved run is other-safe-run",
		);
	});

	test("report rejects malformed saved run records", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, "evals", "runs"), { recursive: true });
		await writeFile(
			join(cwd, "evals", "runs", "malformed-run.json"),
			JSON.stringify(
				{
					schema_version: "evalfly.run.v1",
					run_id: "malformed-run",
					suite: "smoke",
					config_name: "Smoke suite",
					created_at: "2026-06-19T12:00:00.000Z",
					results: "not-an-array",
					summary: {
						total: 1,
						passed: 1,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				},
				null,
				2,
			),
		);

		const result = await dispatch(["report", "malformed-run"], { cwd });

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("invalid evals/runs/malformed-run.json");
		expect(result.stderr).toContain("results must be an array");
	});

	test("curate-trace copies a sanitized raw trace into evals/traces/sanitized", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		const trace = `${JSON.stringify(
			{
				events: [
					{
						role: "assistant",
						content: "Use the report path evals/reports/run-smoke.md",
					},
				],
			},
			null,
			2,
		)}\n`;
		await writeFile(join(cwd, ".pi", "evalfly", "raw", "trace.json"), trace);

		const result = await dispatch(
			["curate-trace", "trace.json", "example-trace.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"evals/traces/sanitized/example-trace.json",
		);
		expect(
			await readFile(
				join(cwd, "evals", "traces", "sanitized", "example-trace.json"),
				"utf8",
			),
		).toBe(trace);
	});

	test("curate-trace rejects traces with obvious secrets before writing", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await writeFile(
			join(cwd, ".pi", "evalfly", "raw", "secret.json"),
			JSON.stringify({ Authorization: "Bearer secret-token-value" }),
		);

		const result = await dispatch(
			["curate-trace", "secret.json", "secret.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("trace appears unsanitized");
		await expect(
			readFile(join(cwd, "evals", "traces", "sanitized", "secret.json")),
		).rejects.toThrow();
	});

	test("curate-trace refuses raw trace symlink escapes", async () => {
		const cwd = await makeProject();
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-raw-outside-"));
		await writeFile(join(outsideDir, "trace.json"), '{"safe":true}\n');
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await symlink(
			join(outsideDir, "trace.json"),
			join(cwd, ".pi", "evalfly", "raw", "link.json"),
		);

		const result = await dispatch(["curate-trace", "link.json", "link.json"], {
			cwd,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsafe raw trace path");
		await expect(
			readFile(join(cwd, "evals", "traces", "sanitized", "link.json")),
		).rejects.toThrow();
	});

	test("curate-trace refuses a symlinked raw trace root", async () => {
		const cwd = await makeProject();
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-raw-root-"));
		await writeFile(join(outsideDir, "trace.json"), '{"safe":true}\n');
		await mkdir(join(cwd, ".pi", "evalfly"), { recursive: true });
		await symlink(outsideDir, join(cwd, ".pi", "evalfly", "raw"), "dir");

		const result = await dispatch(
			["curate-trace", "trace.json", "root-link.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsafe raw trace directory");
		await expect(
			readFile(join(cwd, "evals", "traces", "sanitized", "root-link.json")),
		).rejects.toThrow();
	});

	test("curate-trace refuses a symlinked traces directory without creating outside sanitized", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await writeFile(join(cwd, ".pi", "evalfly", "raw", "trace.json"), "{}\n");
		const outsideDir = await mkdtemp(join(tmpdir(), "evalfly-traces-outside-"));
		await symlink(outsideDir, join(cwd, "evals", "traces"), "dir");

		const result = await dispatch(
			["curate-trace", "trace.json", "trace.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("artifact directory must be evals/traces");
		await expect(access(join(outsideDir, "sanitized"))).rejects.toThrow();
	});

	test("curate-trace refuses to overwrite an existing sanitized trace", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await mkdir(join(cwd, "evals", "traces", "sanitized"), { recursive: true });
		await writeFile(join(cwd, ".pi", "evalfly", "raw", "trace.json"), "{}\n");
		await writeFile(
			join(cwd, "evals", "traces", "sanitized", "trace.json"),
			"sentinel\n",
		);

		const result = await dispatch(
			["curate-trace", "trace.json", "trace.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sanitized trace already exists");
		expect(
			await readFile(
				join(cwd, "evals", "traces", "sanitized", "trace.json"),
				"utf8",
			),
		).toBe("sentinel\n");
	});
	test("curate-trace refuses unsafe sanitized trace names", async () => {
		const cwd = await makeProject();
		await mkdir(join(cwd, ".pi", "evalfly", "raw"), { recursive: true });
		await writeFile(join(cwd, ".pi", "evalfly", "raw", "trace.json"), "{}\n");

		const result = await dispatch(
			["curate-trace", "trace.json", "../trace.json"],
			{ cwd },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unsafe sanitized trace name");
	});
});

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	evaluateEvalFlyCompletionGate,
	registerEvalFlyEnforcementGate,
} from "../extensions/oh-my-omp/evalfly/enforcement-gate";
import { writeEvalFlyEnforcementState } from "../skills/evalfly/bin/enforcement-state";

type HookHandler = (event?: unknown, ctx?: { cwd: string }) => unknown;

function withProject<T>(fn: (cwd: string) => T): T {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-gate-"));
	try {
		return fn(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

function writeRun(
	cwd: string,
	name: string,
	run: {
		created_at: string;
		verdict: "pass" | "fail";
		critical_regressions: number;
		suite?: "smoke" | "regression" | "benchmark";
		commitRange?: string;
		reportPath?: string;
	},
): void {
	mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
	const reportPath = run.reportPath ?? join("evals", "reports", `${name}.md`);
	mkdirSync(dirname(join(cwd, reportPath)), { recursive: true });
	writeFileSync(join(cwd, reportPath), "# EvalFly report\n");
	writeFileSync(
		join(cwd, "evals", "runs", `${name}.json`),
		`${JSON.stringify(
			{
				schema_version: "evalfly.run.v1",
				run_id: name,
				suite: run.suite ?? "smoke",
				config_name: "gate-test",
				created_at: run.created_at,
				context: {
					eval_report_path: reportPath,
					commit_range: run.commitRange ?? "main..HEAD",
				},
				results: [],
				summary: {
					total: 1,
					passed: run.verdict === "pass" ? 1 : 0,
					failed: run.verdict === "pass" ? 0 : 1,
					critical_regressions: run.critical_regressions,
				},
				verdict: run.verdict,
			},
			null,
		)}\n`,
	);
}

function registerWithFakePi() {
	const handlers: Record<string, HookHandler[]> = {};
	const logs: string[] = [];
	registerEvalFlyEnforcementGate({
		on(event: string, handler: HookHandler) {
			handlers[event] ??= [];
			handlers[event].push(handler);
		},
		logger: {
			debug(message: string) {
				logs.push(message);
			},
			info(message: string) {
				logs.push(message);
			},
		},
	} as never);
	return { handlers, logs };
}

describe("EvalFly completion gate", () => {
	test("allows completion in advisory mode without eval runs", () =>
		withProject((cwd) => {
			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({ allowed: true });
		}));

	test("blocks enforced mode without runs", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but no latest run report was found.",
			});
		}));

	test("blocks enforced mode when latest run failed", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "older-pass", {
				created_at: "2026-06-20T00:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
			});
			writeRun(cwd, "latest-fail", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "fail",
				critical_regressions: 0,
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but the latest run did not pass.",
			});
		}));

	test("blocks enforced mode when latest run has critical regressions", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-critical", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 1,
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but critical regressions are present.",
			});
		}));

	test("blocks enforced mode when latest passing run report is missing", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
			writeFileSync(
				join(cwd, "evals", "runs", "latest-missing-report.json"),
				`${JSON.stringify({
					schema_version: "evalfly.run.v1",
					run_id: "latest-missing-report",
					suite: "smoke",
					config_name: "gate-test",
					created_at: "2026-06-20T01:00:00.000Z",
					context: { eval_report_path: join("evals", "reports", "missing.md") },
					results: [],
					summary: {
						total: 1,
						passed: 1,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				})}\n`,
			);

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but no latest run report was found.",
			});
		}));

	test("blocks enforced mode when saved run JSON is malformed", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
			writeFileSync(join(cwd, "evals", "runs", "broken.json"), "{ nope");

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but saved run evidence is invalid.",
			});
			const { handlers } = registerWithFakePi();
			expect(() => handlers.session_stop?.[0]?.({}, { cwd })).not.toThrow();
			expect(handlers.session_stop?.[0]?.({}, { cwd })).toEqual({
				continue: true,
				additionalContext: expect.stringContaining(
					"saved run evidence is invalid",
				),
			});
		}));

	test("blocks enforced mode when latest run is not a valid EvalFly run", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
			mkdirSync(join(cwd, "evals", "reports"), { recursive: true });
			writeFileSync(join(cwd, "evals", "reports", "fake.md"), "# fake\n");
			writeFileSync(
				join(cwd, "evals", "runs", "fake.json"),
				`${JSON.stringify({
					created_at: "2026-06-20T01:00:00.000Z",
					verdict: "pass",
					context: { eval_report_path: join("evals", "reports", "fake.md") },
					summary: { critical_regressions: 0 },
				})}\n`,
			);

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but saved run evidence is invalid.",
			});
		}));

	test("blocks enforced mode when latest run id contains path components", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
			mkdirSync(join(cwd, "evals", "reports"), { recursive: true });
			writeFileSync(join(cwd, "evals", "reports", "pwn.md"), "# pwn\n");
			writeFileSync(
				join(cwd, "evals", "runs", "unsafe-run.json"),
				`${JSON.stringify({
					schema_version: "evalfly.run.v1",
					run_id: "../pwn",
					suite: "smoke",
					config_name: "gate-test",
					created_at: "2026-06-20T01:00:00.000Z",
					context: { eval_report_path: join("evals", "reports", "pwn.md") },
					results: [],
					summary: {
						total: 1,
						passed: 1,
						failed: 0,
						critical_regressions: 0,
					},
					verdict: "pass",
				})}\n`,
			);

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but saved run evidence is invalid.",
			});
		}));

	test("blocks enforced mode when evals runs directory is symlinked", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			const outside = mkdtempSync(join(tmpdir(), "evalfly-gate-runs-"));
			try {
				mkdirSync(join(cwd, "evals"), { recursive: true });
				symlinkSync(outside, join(cwd, "evals", "runs"), "dir");

				expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
					allowed: false,
					reason:
						"EvalFly enforcement is active but saved run evidence is invalid.",
				});
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		}));

	test("blocks enforced mode when latest run file is symlinked", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
			});
			const outside = mkdtempSync(join(tmpdir(), "evalfly-gate-runfile-"));
			try {
				writeFileSync(join(outside, "latest-pass.json"), "{}\n");
				rmSync(join(cwd, "evals", "runs", "latest-pass.json"));
				symlinkSync(
					join(outside, "latest-pass.json"),
					join(cwd, "evals", "runs", "latest-pass.json"),
				);

				expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
					allowed: false,
					reason:
						"EvalFly enforcement is active but saved run evidence is invalid.",
				});
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		}));

	test("blocks enforced mode when run filename and run id disagree", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
			});
			const runPath = join(cwd, "evals", "runs", "latest-pass.json");
			const run = JSON.parse(readFileSync(runPath, "utf8"));
			run.run_id = "other-pass";
			writeFileSync(runPath, `${JSON.stringify(run)}\n`);

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but saved run evidence is invalid.",
			});
		}));

	test("blocks enforced mode when report artifact is a directory", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
			});
			rmSync(join(cwd, "evals", "reports", "latest-pass.md"));
			mkdirSync(join(cwd, "evals", "reports", "latest-pass.md"));

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but no latest run report was found.",
			});
		}));

	test("blocks enforced mode when no run matches commit range", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
				commitRange: "main~1..HEAD",
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but no latest run report was found.",
			});
		}));

	test("blocks enforced mode when no run matches suite", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "regression",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
				suite: "smoke",
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
				allowed: false,
				reason:
					"EvalFly enforcement is active but no latest run report was found.",
			});
		}));
	test("allows enforced mode with latest passing run and report", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "older-fail", {
				created_at: "2026-06-20T00:00:00.000Z",
				verdict: "fail",
				critical_regressions: 0,
			});
			writeRun(cwd, "latest-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
				commitRange: "main..HEAD",
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({ allowed: true });
		}));

	test("allows enforced mode when newer unrelated run exists after matching pass", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "matching-pass", {
				created_at: "2026-06-20T01:00:00.000Z",
				verdict: "pass",
				critical_regressions: 0,
				commitRange: "main..HEAD",
			});
			writeRun(cwd, "unrelated-newer", {
				created_at: "2026-06-20T02:00:00.000Z",
				verdict: "fail",
				critical_regressions: 1,
				commitRange: "feature..HEAD",
			});

			expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({ allowed: true });
		}));

	test("registered hook continues session_stop only when blocked", () =>
		withProject((cwd) => {
			const { handlers } = registerWithFakePi();
			expect(Object.keys(handlers)).toEqual(["session_stop"]);
			expect(handlers.session_stop?.[0]?.({}, { cwd })).toBeUndefined();

			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			const result = handlers.session_stop?.[0]?.({}, { cwd });

			expect(result).toEqual({
				continue: true,
				additionalContext: expect.stringContaining(
					"EvalFly enforcement is active but no latest run report was found.",
				),
			});
		}));
});

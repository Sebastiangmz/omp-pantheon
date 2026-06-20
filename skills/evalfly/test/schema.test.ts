import { describe, expect, test } from "bun:test";

import {
	type EvalCase,
	type EvalConfig,
	type EvalRun,
	EvalCaseSchema,
	EvalConfigSchema,
	EvalRunSchema,
	validateEvalCase,
	validateEvalConfig,
	validateEvalRun,
} from "../bin/schema.ts";

const validCase: EvalCase = {
	schema_version: "evalfly.case.v1",
	case_id: "case-critical-file-exists",
	title: "Critical artifact exists",
	suite: "smoke",
	risk_tier: "critical",
	task_type: "deterministic_fixture",
	source: {
		kind: "fixture",
	},
	privacy: {
		classification: "public",
		sanitized: true,
	},
	expected: {
		success_criteria: ["The expected file exists after the run."],
	},
	judge: {
		type: "deterministic",
		assertions: [
			{
				type: "file_exists",
				path: "reports/evalfly/summary.md",
			},
		],
	},
};

const validConfig: EvalConfig = {
	schema_version: "evalfly.config.v1",
	name: "Evaluation flywheel contract smoke",
	cases: [validCase],
};

describe("evalfly schema validation", () => {
	test("exports versioned schemas for config case and run", () => {
		expect(EvalConfigSchema.properties.schema_version.const).toBe(
			"evalfly.config.v1",
		);
		expect(EvalCaseSchema.properties.schema_version.const).toBe(
			"evalfly.case.v1",
		);
		expect(EvalRunSchema.properties.schema_version.const).toBe(
			"evalfly.run.v1",
		);
		expect(EvalCaseSchema.required).toContain("privacy");
		expect(EvalConfigSchema.properties.cases.minItems).toBe(1);
		expect(
			EvalCaseSchema.properties.expected.properties.success_criteria.minItems,
		).toBe(1);
		expect(
			EvalCaseSchema.properties.judge.anyOf[0].properties.assertions.minItems,
		).toBe(1);
	});

	test("valid config and case pass", () => {
		expect(validateEvalCase(validCase)).toEqual({ ok: true, value: validCase });
		expect(validateEvalConfig(validConfig)).toEqual({
			ok: true,
			value: validConfig,
		});
	});

	test("config rejects empty cases to match schema minItems", () => {
		const result = validateEvalConfig({ ...validConfig, cases: [] });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain(
				"cases must contain at least one case",
			);
		}
	});

	test("case rejects empty success criteria to match schema minItems", () => {
		const result = validateEvalCase({
			...validCase,
			expected: { success_criteria: [] },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain(
				"expected.success_criteria must contain at least one criterion",
			);
		}
	});

	test("deterministic judge rejects empty assertions to match schema minItems", () => {
		const result = validateEvalCase({
			...validCase,
			judge: { type: "deterministic", assertions: [] },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain(
				"judge.assertions must contain at least one assertion",
			);
		}
	});

	test("runtime validators reject unknown properties where schemas disallow them", () => {
		const configResult = validateEvalConfig({ ...validConfig, extra: true });
		const caseResult = validateEvalCase({
			...validCase,
			unexpected: true,
			privacy: { ...validCase.privacy, extra: true },
			expected: { ...validCase.expected, extra: true },
			judge: {
				type: "deterministic",
				extra: true,
				assertions: [
					{
						type: "file_exists",
						path: "reports/evalfly/summary.md",
						extra: true,
					},
				],
			},
		});
		const runResult = validateEvalRun({
			schema_version: "evalfly.run.v1",
			run_id: "run-unknown-fields",
			suite: "smoke",
			config_name: validConfig.name,
			created_at: "2026-06-19T00:00:00.000Z",
			extra: true,
			results: [
				{
					case_id: validCase.case_id,
					title: validCase.title,
					risk_tier: "critical",
					critical: true,
					passed: true,
					privacy: { ...validCase.privacy, extra: true },
					errors: [],
					extra: true,
				},
			],
			summary: {
				total: 1,
				passed: 1,
				failed: 0,
				critical_regressions: 0,
				extra: true,
			},
			verdict: "pass",
		});

		expect(configResult.ok).toBe(false);
		expect(caseResult.ok).toBe(false);
		expect(runResult.ok).toBe(false);
		if (!configResult.ok) {
			expect(configResult.errors.join("\n")).toContain(
				"unexpected property: extra",
			);
		}
		if (!caseResult.ok) {
			const errors = caseResult.errors.join("\n");
			expect(errors).toContain("unexpected property: unexpected");
			expect(errors).toContain("privacy unexpected property: extra");
			expect(errors).toContain("expected unexpected property: extra");
			expect(errors).toContain("judge unexpected property: extra");
			expect(errors).toContain(
				"judge.assertions[0] unexpected property: extra",
			);
		}
		if (!runResult.ok) {
			const errors = runResult.errors.join("\n");
			expect(errors).toContain("unexpected property: extra");
			expect(errors).toContain("results[0] unexpected property: extra");
			expect(errors).toContain("results[0].privacy unexpected property: extra");
			expect(errors).toContain("summary unexpected property: extra");
		}
	});

	test("missing privacy metadata fails with field path", () => {
		const { privacy: _privacy, ...missingPrivacy } = validCase;

		const result = validateEvalCase(missingPrivacy);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain("privacy");
		}
	});

	test("invalid suite fails with field path", () => {
		const result = validateEvalCase({ ...validCase, suite: "nightly" });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain("suite");
		}
	});

	test("critical deterministic file_exists case shape validates", () => {
		const result = validateEvalCase({
			...validCase,
			risk_tier: "critical",
			judge: {
				type: "deterministic",
				assertions: [{ type: "file_exists", path: "tmp/output.txt" }],
			},
		});

		expect(result.ok).toBe(true);
	});

	test("run schema accepts optional SpecSafe linkage context", () => {
		const run: EvalRun = {
			schema_version: "evalfly.run.v1",
			run_id: "run-with-specsafe-context",
			suite: "smoke",
			config_name: validConfig.name,
			created_at: "2026-06-19T00:00:00.000Z",
			context: {
				spec_slice: "SPEC-20260619-001",
				session_id: "sess-abc",
				commit_range: "main..HEAD",
				eval_report_path: "evals/reports/run-with-specsafe-context.md",
			},
			results: [],
			summary: {
				total: 0,
				passed: 0,
				failed: 0,
				critical_regressions: 0,
			},
			verdict: "pass",
		};

		expect(validateEvalRun(run)).toEqual({ ok: true, value: run });
	});

	test("run schema rejects unknown SpecSafe linkage context fields", () => {
		const result = validateEvalRun({
			schema_version: "evalfly.run.v1",
			run_id: "run-with-bad-context",
			suite: "smoke",
			config_name: validConfig.name,
			created_at: "2026-06-19T00:00:00.000Z",
			context: {
				spec_slice: "SPEC-20260619-001",
				unexpected: "field",
			},
			results: [],
			summary: {
				total: 0,
				passed: 0,
				failed: 0,
				critical_regressions: 0,
			},
			verdict: "pass",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join("\n")).toContain(
				"context unexpected property: unexpected",
			);
		}
	});

	test("run schema validates CLI run records", () => {
		const run: EvalRun = {
			schema_version: "evalfly.run.v1",
			run_id: "run-2026-06-19-smoke",
			suite: "smoke",
			config_name: validConfig.name,
			created_at: "2026-06-19T00:00:00.000Z",
			results: [
				{
					case_id: validCase.case_id,
					title: validCase.title,
					risk_tier: "critical",
					critical: true,
					passed: false,
					privacy: validCase.privacy,
					errors: ["missing file: reports/evalfly/summary.md"],
				},
			],
			summary: {
				total: 1,
				passed: 0,
				failed: 1,
				critical_regressions: 1,
			},
			verdict: "fail",
		};

		expect(EvalRunSchema.required).toContain("created_at");
		expect(EvalRunSchema.required).toContain("results");
		expect(EvalRunSchema.required).toContain("verdict");
		expect(validateEvalRun(run)).toEqual({ ok: true, value: run });
	});
});

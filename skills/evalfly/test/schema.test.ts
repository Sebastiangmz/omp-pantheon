import { describe, expect, test } from "bun:test";

import {
	type EvalCase,
	type EvalConfig,
	type EvalRun,
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
	test("valid config and case pass", () => {
		expect(validateEvalCase(validCase)).toEqual({ ok: true, value: validCase });
		expect(validateEvalConfig(validConfig)).toEqual({
			ok: true,
			value: validConfig,
		});
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

	test("run summary validates with critical_regressions count", () => {
		const run: EvalRun = {
			schema_version: "evalfly.run.v1",
			run_id: "run-2026-06-19-smoke",
			config_name: validConfig.name,
			started_at: "2026-06-19T00:00:00.000Z",
			finished_at: "2026-06-19T00:01:00.000Z",
			summary: {
				total: 1,
				passed: 0,
				failed: 1,
				critical_regressions: 1,
			},
		};

		expect(validateEvalRun(run)).toEqual({ ok: true, value: run });
	});
});

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function expectAllTerms(content: string, terms: string[]): void {
	for (const term of terms) {
		expect(content).toContain(term);
	}
}

describe("agent EvalFly planning contracts", () => {
	test("spec-writer requires explicit EvalFly planning fields in specs and yield data", () => {
		const specWriter = fs.readFileSync(
			path.join(process.cwd(), "agents/spec-writer.md"),
			"utf-8",
		);

		expect(specWriter).toContain("## Evaluation Flywheel planning");
		expectAllTerms(specWriter, [
			"evalApplicability",
			"required",
			"not_applicable",
			"evalTargets",
			"riskTier",
			"failureModes",
			"evalNotApplicableReason",
			"EvalFly suite expectations",
			"Evaluation Flywheel planning block",
			"opt-in evidence tooling",
			"do not claim hook or CI enforcement",
		]);
		expect(specWriter).toContain("evalPlanning");
	});

	test("test-writer maps each acceptance criterion to deterministic or EvalFly coverage", () => {
		const testWriter = fs.readFileSync(
			path.join(process.cwd(), "agents/test-writer.md"),
			"utf-8",
		);

		expect(testWriter).toContain("## Evaluation Flywheel planning");
		expectAllTerms(testWriter, [
			"acceptance criterion",
			"unit",
			"integration",
			"evalfly",
			"no-eval",
			"Create or update EvalFly cases only when the spec requires evals",
			"deterministic-first",
			"evalFiles",
			"evalCases",
			"EvalFly files/cases",
			"opt-in evidence tooling",
			"hook enforcement",
			"CI enforcement",
		]);
	});

	test("EvalFly planning contract stays independent from Honcho", () => {
		const specWriter = fs.readFileSync(
			path.join(process.cwd(), "agents/spec-writer.md"),
			"utf-8",
		);
		const testWriter = fs.readFileSync(
			path.join(process.cwd(), "agents/test-writer.md"),
			"utf-8",
		);

		expect(`${specWriter}\n${testWriter}`).not.toMatch(/Honcho/i);
	});
});

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

function readAgentContract(agentName: string): string {
	return fs.readFileSync(
		path.join(process.cwd(), "agents", `${agentName}.md`),
		"utf-8",
	);
}

function expectAllTerms(content: string, terms: string[]): void {
	for (const term of terms) {
		expect(content).toContain(term);
	}
}

describe("agent EvalFly validation contracts", () => {
	test("validator requires and reports EvalFly evidence for required eval planning", () => {
		const validator = readAgentContract("validator");

		expect(validator).toContain("## Evaluation Flywheel evidence");
		expectAllTerms(validator, [
			"evalPlanning.evalApplicability",
			"required",
			"evalReportPath",
			"evalNotApplicableReason",
			"run or inspect the relevant EvalFly report",
			"critical regressions",
			"privacy status",
			"opt-in evidence tooling",
			"do not claim hooks or CI enforcement",
			"evalEvidence",
		]);
	});

	test("reviewer verifies EvalFly coverage and report quality without overclaiming", () => {
		const reviewer = readAgentContract("reviewer");

		expect(reviewer).toContain("## Evaluation Flywheel review");
		expectAllTerms(reviewer, [
			"required evals exist",
			"critical regressions=0",
			"report path matches current work",
			"privacy status",
			"overclaiming",
			"evalReview",
			"evalReportPath",
			"evalNotApplicableReason",
			"opt-in evidence tooling",
			"do not claim hook or CI enforcement",
		]);
	});

	test("EvalFly validation contracts stay independent from Honcho", () => {
		const validator = readAgentContract("validator");
		const reviewer = readAgentContract("reviewer");

		expect(`${validator}\n${reviewer}`).not.toMatch(/Honcho/i);
	});
});

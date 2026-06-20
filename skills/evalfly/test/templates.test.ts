import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const templateRoot = join(import.meta.dir, "..", "templates");

describe("evalfly templates", () => {
	test("GitHub Actions example runs explicit evalfly check without making repository CI blocking", async () => {
		const workflow = await readFile(
			join(templateRoot, "github-actions", "evalfly-check.yml"),
			"utf8",
		);

		expect(workflow).toContain("name: EvalFly check example");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("continue-on-error: true");
		expect(workflow).toContain(
			"bun run skills/evalfly/bin/evalfly.ts check --suite smoke --commit-range",
		);
		expect(workflow).toContain("permissions:");
		expect(workflow).toContain("contents: read");
		expect(workflow).toContain("persist-credentials: false");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow.indexOf("bun install --frozen-lockfile")).toBeLessThan(
			workflow.indexOf("bun run skills/evalfly/bin/evalfly.ts check"),
		);
		expect(workflow).toContain("COMMIT_RANGE:");
		expect(workflow).toContain('--commit-range "$COMMIT_RANGE"');
		expect(workflow).toContain("Do not upload raw traces or secrets");
		expect(workflow).toContain(
			"Pin third-party actions to reviewed commit SHAs",
		);
		expect(workflow).not.toContain("pull_request:");
		expect(workflow).not.toContain("push:");
	});

	test("GitHub Actions required gate template is explicit opt-in and blocking", async () => {
		const workflow = await readFile(
			join(templateRoot, "github-actions", "evalfly-required-gate.yml"),
			"utf8",
		);

		expect(workflow).toContain("name: EvalFly required gate");
		expect(workflow).toContain("pull_request:");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).not.toContain("continue-on-error: true");
		expect(workflow).toContain("permissions:");
		expect(workflow).toContain("contents: read");
		expect(workflow).toContain("persist-credentials: false");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow.indexOf("bun install --frozen-lockfile")).toBeLessThan(
			workflow.indexOf("bun run skills/evalfly/bin/evalfly.ts check"),
		);
		expect(workflow).toContain("COMMIT_RANGE:");
		expect(workflow).toContain('--commit-range "$COMMIT_RANGE"');
		expect(workflow).toContain("Configure branch protection");
		expect(workflow).toContain("Do not upload raw traces or secrets");
		expect(workflow).not.toContain("evals/traces");
	});
});

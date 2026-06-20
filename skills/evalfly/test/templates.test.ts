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
		expect(workflow).not.toContain("pull_request:");
		expect(workflow).not.toContain("push:");
	});
});

import { describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const honchoToolDir = path.join(repoRoot, "tools", "honcho");
const honchoToolEntry = path.join(honchoToolDir, "index.ts");

describe("[unit] OMP Honcho tool loader compatibility", () => {
	test("honcho tool directory exposes only executable loader entries", () => {
		const nonExecutableToolFiles = fs
			.readdirSync(honchoToolDir)
			.filter((name) => name.endsWith(".md") || name.endsWith(".json"));

		expect(nonExecutableToolFiles).toEqual([]);
	});

	test("honcho entry has no top-level Honcho SDK runtime import", () => {
		const source = fs.readFileSync(honchoToolEntry, "utf-8");

		expect(source).not.toContain('from "@honcho-ai/sdk"');
		expect(source).not.toContain("from '@honcho-ai/sdk'");
	});

	test("honcho factory binds tools without the removed pi.pi.StringEnum helper", async () => {
		const { default: factory } = await import("../tools/honcho/index.ts");
		const schemaFactory = {
			Object: mock((shape: Record<string, unknown>) => ({
				type: "object",
				shape,
			})),
			String: mock((opts?: Record<string, unknown>) => ({
				type: "string",
				opts,
			})),
			Optional: mock((schema: unknown) => ({ type: "optional", schema })),
			Number: mock((opts?: Record<string, unknown>) => ({
				type: "number",
				opts,
			})),
			Enum: mock((values: readonly string[]) => ({ type: "enum", values })),
		};

		const tools = (await factory({
			typebox: { Type: schemaFactory },
			pi: {},
		} as any)) as Array<{ name: string }>;

		expect(Array.isArray(tools)).toBe(true);
		expect(tools.map((tool) => tool.name)).toEqual([
			"honcho_recall",
			"honcho_search",
			"honcho_remember",
			"honcho_conclude",
		]);
	});
});

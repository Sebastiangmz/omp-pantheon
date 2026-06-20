import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { registerEvalFlyAdvisor } from "../extensions/oh-my-omp/hooks/evalfly-advisor";

type HookHandler = (
	event?: unknown,
	ctx?: { cwd: string; hasUI: boolean },
) => unknown;

function makeProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-advisor-"));
	mkdirSync(join(cwd, "evals"), { recursive: true });
	writeFileSync(
		join(cwd, "evals", "config.json"),
		`${JSON.stringify({ schema_version: "evalfly.config.v1", name: "Smoke", cases: [] }, null, 2)}\n`,
	);
	return cwd;
}

function enableHints(cwd: string): void {
	mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "evalfly", "hints-enabled"), "1\n");
}

function registerWithFakePi() {
	const handlers: Record<string, HookHandler[]> = {};
	const logs: string[] = [];
	registerEvalFlyAdvisor({
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

describe("EvalFly advisory hook", () => {
	test("does nothing unless the project explicitly enables hints", () => {
		const cwd = makeProject();
		const { handlers } = registerWithFakePi();

		const result = handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true });

		expect(result).toBeUndefined();
	});

	test("injects non-blocking EvalFly context when hints are enabled", () => {
		const cwd = makeProject();
		enableHints(cwd);
		const { handlers } = registerWithFakePi();

		const result = handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true });

		expect(result).toEqual({
			message: {
				customType: "evalfly-advisor",
				content: expect.stringContaining("EvalFly evidence is opt-in"),
				display: false,
				details: "Injected by oh-my-omp evalfly-advisor (opt-in)",
				attribution: "user",
			},
		});
		expect(JSON.stringify(result)).not.toContain("continue");
	});

	test("injects at most once per session and resets on session switch", () => {
		const cwd = makeProject();
		enableHints(cwd);
		const { handlers } = registerWithFakePi();

		expect(
			handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true }),
		).toBeDefined();
		expect(
			handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true }),
		).toBeUndefined();
		handlers.session_switch?.[0]?.({}, { cwd, hasUI: true });
		expect(
			handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true }),
		).toBeDefined();
	});

	test("does nothing when hints are enabled but no evals config exists", () => {
		const cwd = mkdtempSync(join(tmpdir(), "evalfly-advisor-no-config-"));
		enableHints(cwd);
		const { handlers } = registerWithFakePi();

		const result = handlers.before_agent_start?.[0]?.({}, { cwd, hasUI: true });

		expect(result).toBeUndefined();
	});

	test("does nothing in headless subagents", () => {
		const cwd = makeProject();
		enableHints(cwd);
		const { handlers } = registerWithFakePi();

		const result = handlers.before_agent_start?.[0]?.(
			{},
			{ cwd, hasUI: false },
		);

		expect(result).toBeUndefined();
	});
});

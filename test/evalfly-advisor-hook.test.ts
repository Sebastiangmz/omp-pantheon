import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { registerEvalFlyAdvisor } from "../extensions/oh-my-omp/hooks/evalfly-advisor";

type SessionStopHandler = (event?: unknown, ctx?: unknown) => unknown;

function makeProject(): string {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-advisor-"));
	mkdirSync(join(cwd, "evals"), { recursive: true });
	writeFileSync(
		join(cwd, "evals", "config.json"),
		`${JSON.stringify({ schema_version: "evalfly.config.v1", name: "Smoke", cases: [] }, null, 2)}\n`,
	);
	return cwd;
}

function registerWithFakePi() {
	const handlers: Record<string, SessionStopHandler[]> = {};
	const logs: string[] = [];
	registerEvalFlyAdvisor({
		on(event: string, handler: SessionStopHandler) {
			(handlers[event] ??= []).push(handler);
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

		const result = handlers.session_stop?.[0]?.({}, { cwd });

		expect(result).toBeUndefined();
	});

	test("returns non-blocking EvalFly context when hints are enabled", () => {
		const cwd = makeProject();
		mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "evalfly", "hints-enabled"), "1\n");
		const { handlers } = registerWithFakePi();

		const result = handlers.session_stop?.[0]?.({}, { cwd });

		expect(result).toEqual({
			additionalContext: expect.stringContaining("EvalFly evidence is opt-in"),
		});
		expect(JSON.stringify(result)).not.toContain("continue");
	});

	test("does nothing when hints are enabled but no evals config exists", () => {
		const cwd = mkdtempSync(join(tmpdir(), "evalfly-advisor-no-config-"));
		mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "evalfly", "hints-enabled"), "1\n");
		const { handlers } = registerWithFakePi();

		const result = handlers.session_stop?.[0]?.({}, { cwd });

		expect(result).toBeUndefined();
	});
});

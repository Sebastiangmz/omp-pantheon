import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	appendEvalFlyTraceEvent,
	clearEvalFlyTraceBuffer,
	readEvalFlyTraceBuffer,
	registerEvalFlyTraceCapture,
} from "../extensions/oh-my-omp/evalfly/trace-buffer";
import { writeEvalFlyEnforcementState } from "../skills/evalfly/bin/enforcement-state";

type HookHandler = (event?: unknown, ctx?: { cwd: string }) => unknown;

function withProject(run: (cwd: string) => void): void {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-trace-"));
	try {
		run(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

function registerWithFakePi() {
	const handlers: Record<string, HookHandler[]> = {};
	registerEvalFlyTraceCapture({
		on(name: string, handler: HookHandler) {
			handlers[name] ??= [];
			handlers[name].push(handler);
		},
	} as never);
	return handlers;
}

describe("EvalFly trace capture", () => {
	test("does not capture direct events when enforcement is inactive", () =>
		withProject((cwd) => {
			appendEvalFlyTraceEvent(cwd, {
				type: "tool_result",
				content: "raw payload",
				sanitized_input: "safe input",
			});

			expect(readEvalFlyTraceBuffer(cwd)).toEqual([]);
		}));

	test("captures sanitized direct events when enforcement is active", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});

			appendEvalFlyTraceEvent(cwd, {
				type: "tool_result",
				input: "raw input",
				output: "raw output",
				content: "raw content",
				prompt: "raw prompt alias",
				response: "raw response alias",
				nested: { content: "nested raw", keep: "safe" },
				sanitized_input: "safe input",
			});

			expect(readEvalFlyTraceBuffer(cwd)).toEqual([
				{
					type: "tool_result",
					sanitized_input: "safe input",
				},
			]);
		}));

	test("handles cyclic objects without preserving raw fields", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			const cyclic: Record<string, unknown> = {
				type: "tool_result",
				content: "raw",
				nested: { keep: "safe" },
			};
			cyclic.self = cyclic;

			expect(() => appendEvalFlyTraceEvent(cwd, cyclic)).not.toThrow();
			expect(readEvalFlyTraceBuffer(cwd)).toEqual([
				{
					type: "tool_result",
				},
			]);
		}));

	test("returns defensive sanitized copies from the buffer", () =>
		withProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			appendEvalFlyTraceEvent(cwd, {
				type: "tool_result",
				sanitized_input: "safe input",
			});

			const firstRead = readEvalFlyTraceBuffer(cwd);
			firstRead.push({ type: "mutated", content: "raw" });
			const first = firstRead[0];
			if (first) first.content = "raw mutation";

			expect(readEvalFlyTraceBuffer(cwd)).toEqual([
				{ type: "tool_result", sanitized_input: "safe input" },
			]);
		}));

	test("hook captures tool metadata only when enforcement is active", () =>
		withProject((cwd) => {
			const handlers = registerWithFakePi();
			handlers.tool_result?.[0]?.(
				{
					toolName: "read",
					isError: false,
					details: {
						content: "raw tool output",
						sanitized_input: "read README.md",
						latency_ms: 12,
					},
				},
				{ cwd },
			);
			expect(readEvalFlyTraceBuffer(cwd)).toEqual([]);

			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
			handlers.tool_result?.[0]?.(
				{
					toolName: "read",
					isError: false,
					details: {
						content: "raw tool output",
						sanitized_input: "read README.md",
						latency_ms: 12,
					},
				},
				{ cwd },
			);

			expect(readEvalFlyTraceBuffer(cwd)).toEqual([
				{
					type: "tool_result",
					tool_name: "read",
					status: "ok",
					sanitized_input: "read README.md",
					latency_ms: 12,
				},
			]);
		}));

	test("hook captures agent end metadata and clears on session transitions", () =>
		withProject((cwd) => {
			const handlers = registerWithFakePi();
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});

			handlers.agent_end?.[0]?.(
				{
					agent: "validator",
					model: "model-x",
					status: "completed",
					verdict: "pass",
					cost_usd: 0.01,
				},
				{ cwd },
			);
			expect(readEvalFlyTraceBuffer(cwd)).toEqual([
				{
					type: "agent_end",
					agent: "validator",
					model: "model-x",
					status: "completed",
					verdict: "pass",
					cost_usd: 0.01,
				},
			]);

			handlers.session_switch?.[0]?.({}, { cwd });
			expect(readEvalFlyTraceBuffer(cwd)).toEqual([]);
			clearEvalFlyTraceBuffer(cwd);
		}));
});

/**
 * Acceptance criterion §4.7 — integration test: real omp task dispatch.
 *
 * SpecSafe slice: SPEC-20260426-008.1 — persona-prompt-identity
 *
 * This test dispatches a validator Ghola via `omp task` and asserts that
 * the resulting Honcho conclusion is attributed to `validator`, NOT to the
 * parent orchestrator's ambient HONCHO_PEER_ID.
 *
 * Gated behind OMP_LIVE_TESTS=1 (matches migration-suite convention from
 * SPEC-008 A1–A10). Skips loudly if env unset.
 *
 * FEASIBILITY NOTE (for the implementer):
 * At test-writer time (2026-04-26), `omp` is not available as a CLI binary
 * in this project's PATH or node_modules/.bin/. The `@oh-my-pi/pi-coding-agent`
 * package is installed globally but not exposed as a bun-runnable CLI from
 * within the test runner context.
 *
 * The test is written as scaffolding — `.skip` with a TODO — until one of:
 *   (a) `omp` (or `pi`) is available on PATH and the real dispatch API is confirmed;
 *   (b) the implementer identifies a programmatic in-process entry point
 *       (e.g. an exported `runTask` function from @oh-my-pi/pi-coding-agent)
 *       callable from a bun test without a full shell spawn.
 *
 * The assertion shape below documents exactly what the test should verify once
 * wired; the implementer should un-skip and wire the dispatch accordingly.
 * See spec §3.4 for the intended dispatch + assertion approach.
 */

import { describe, expect, test } from "bun:test";

const LIVE =
	process.env.OMP_LIVE_TESTS === "1" &&
	!!process.env.HONCHO_API_KEY &&
	!!process.env.HONCHO_WORKSPACE_ID &&
	!!process.env.HONCHO_SESSION_ID;

describe("[integration] §4.7 — validator identity attribution under real omp dispatch", () => {
	// TODO (implementer): un-skip and wire once `omp` CLI or a programmatic
	// dispatch surface is available from a bun test.
	//
	// Wire path:
	//   1. Set process.env.HONCHO_PEER_ID = "seshat" (simulate parent orchestrator).
	//   2. Dispatch a validator Ghola via `omp task` (or in-process equivalent)
	//      with a trivial task: "Call honcho_conclude with as_peer='validator' and
	//      content 'engineering truth: identity-test-<run-id>'."
	//   3. Wait for the conclusion to land (poll listConclusionsForTest).
	//   4. Assert the conclusion's peer attribution is `validator`, not `seshat`.
	//
	// Why it's not wired:
	//   - `omp` binary not found in PATH (`which omp` returns empty).
	//   - No `node_modules/.bin/omp` in this project.
	//   - @oh-my-pi/pi-coding-agent is installed globally, but its programmatic
	//     API surface for spawning a single-shot subagent task is not confirmed;
	//     attempting to import and call it blind risks a runtime crash in CI.
	//   - A full `Bun.spawn` call against the global omp binary would be slow,
	//     require full API keys, and is non-trivial to sandbox.
	test.skip("[OMP_LIVE_TESTS=1 required] validator conclude is attributed to validator, not parent HONCHO_PEER_ID", async () => {
		if (!LIVE) {
			// Belt-and-suspenders: describe.skipIf is the outer gate, but if somehow
			// the test runs without the env, skip loudly here too.
			console.warn(
				"SKIPPED: OMP_LIVE_TESTS=1, HONCHO_API_KEY, HONCHO_WORKSPACE_ID, and HONCHO_SESSION_ID " +
					"must all be set to run this integration test.",
			);
			return;
		}

		// --- Assertion shape (implementer: replace stubs below with real dispatch) ---

		const runId = `identity-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		// Step 1: Set parent peer to seshat (simulates orchestrator context).
		const originalPeerId = process.env.HONCHO_PEER_ID;
		process.env.HONCHO_PEER_ID = "seshat";

		try {
			// Step 2: Dispatch validator via omp task.
			// TODO: replace with real dispatch once omp CLI or programmatic API confirmed.
			// Example Bun.spawn approach (not yet verified):
			//
			//   const proc = Bun.spawn([
			//     "omp", "task",
			//     "--agent", "validator",
			//     "--task", `Call honcho_conclude with as_peer='validator' and content 'engineering truth: ${runId}'`,
			//   ], { env: { ...process.env } });
			//   await proc.exited;
			//
			throw new Error(
				"TODO: implementer must wire real omp task dispatch here",
			);

			// Step 3 + 4: Assert attribution.
			// const { listConclusionsForTest } = await import("../../tools/honcho/index.ts");
			// const ids = await listConclusionsForTest({
			//   workspaceId: process.env.HONCHO_WORKSPACE_ID!,
			//   peerId: "validator",
			// });
			// expect(ids.length).toBeGreaterThan(0);
			// The latest conclusion content should contain the runId marker,
			// confirming the validator (not seshat) wrote it.
		} finally {
			process.env.HONCHO_PEER_ID = originalPeerId;
		}
	});
});

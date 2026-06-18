/**
 * Tests for the OMP-ported honcho custom tool.
 *
 * Source lineage: pi-seshat Honcho extension test suite.
 * SpecSafe slice: SPEC-20260424-001 — pi-honcho-bridge-v1
 *
 * Test types:
 *   [unit] — no network; test pure helpers and validation logic.
 *   [live] — hits the real Honcho sandbox workspace (pi-dev-sandbox).
 *            Runs only when HONCHO_TESTS_LIVE=1 is set AND HONCHO_API_KEY is present.
 *
 * The invariants tested here are identical to the vanilla-Pi suite.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const LIVE =
	process.env.HONCHO_TESTS_LIVE === "1" && !!process.env.HONCHO_API_KEY;

const TEST_RUN_ID = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_WORKSPACE = "pi-dev-sandbox";

import {
	buildHonchoTools,
	type HonchoToolRuntimeEnv,
	isConclusionWriter,
	sanitizeErrorForDisplay,
} from "../tools/honcho/index.ts";

// ---------- [unit] helper-level tests ----------

describe("[unit] isConclusionWriter", () => {
	test("permits validator, reviewer, steward", () => {
		expect(isConclusionWriter("validator")).toBe(true);
		expect(isConclusionWriter("reviewer")).toBe(true);
		expect(isConclusionWriter("steward")).toBe(true);
	});

	test("denies other peers including the orchestrator itself", () => {
		for (const peer of [
			"luci",
			"seshat",
			"spec-writer",
			"test-writer",
			"implementer",
			"doc-scout",
			"unknown",
		]) {
			expect(isConclusionWriter(peer)).toBe(false);
		}
	});

	test("denies empty and malformed peer ids", () => {
		expect(isConclusionWriter("")).toBe(false);
		expect(isConclusionWriter("VALIDATOR")).toBe(false);
		expect(isConclusionWriter(" validator ")).toBe(false);
	});
});

describe("[unit] sanitizeErrorForDisplay", () => {
	test("strips HONCHO_API_KEY when embedded in error message", () => {
		const apiKey = "fake-honcho-api-key-for-redaction-test";
		const raw = `Error calling Honcho: unauthorized (apiKey=${apiKey}) at line 42`;
		const clean = sanitizeErrorForDisplay(raw, apiKey);
		expect(clean).not.toContain(apiKey);
		expect(clean).toContain("<redacted>");
	});

	test("is a no-op when no apiKey is provided or key absent from text", () => {
		expect(sanitizeErrorForDisplay("plain error", "")).toBe("plain error");
		expect(sanitizeErrorForDisplay("plain error", "fake-honcho-api-key")).toBe(
			"plain error",
		);
	});
});

describe("[unit] buildHonchoTools — missing env", () => {
	const emptyEnv: HonchoToolRuntimeEnv = {
		HONCHO_API_KEY: undefined,
		HONCHO_WORKSPACE_ID: undefined,
		HONCHO_SESSION_ID: undefined,
		HONCHO_PEER_ID: undefined,
	};

	test("honcho_recall returns isError with the missing var name when API key absent", async () => {
		const tools = buildHonchoTools({ getEnv: () => emptyEnv });
		const result = await tools.honcho_recall.execute(
			"call-1",
			{ query: "x" },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text).toContain("HONCHO_API_KEY");
	});

	test("honcho_remember returns isError listing every missing required var", async () => {
		const tools = buildHonchoTools({ getEnv: () => emptyEnv });
		const result = await tools.honcho_remember.execute(
			"call-2",
			{ content: "x" },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		for (const v of [
			"HONCHO_API_KEY",
			"HONCHO_WORKSPACE_ID",
			"HONCHO_SESSION_ID",
			"HONCHO_PEER_ID",
		]) {
			expect(text).toContain(v);
		}
	});
});

describe("[unit] honcho_conclude peer-allowlist gate", () => {
	// SPEC-008.1: All tests now use `as_peer` explicitly. `getEnv()` returns a
	// peer intentionally DIFFERENT from `as_peer` to prove declared identity beats env.
	// §3.2: as_peer is required for honcho_conclude; env fallback is NOT used.

	test("returns isError for a non-writer peer without calling Honcho", async () => {
		// env says "seshat" (orchestrator), but as_peer says "implementer" — allowlist check
		// must be against the declared as_peer, not the env.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
		});
		const result = await tools.honcho_conclude.execute(
			"call-3",
			{ content: "should not land", as_peer: "implementer" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text).toContain("implementer");
		expect(text.toLowerCase()).toContain("not permitted");
	});

	test("seshat (orchestrator) is rejected by the gate via as_peer", async () => {
		// env says "validator" (a writer), but declared as_peer="seshat" must be rejected.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "validator",
			}),
		});
		const result = await tools.honcho_conclude.execute(
			"call-3a",
			{ content: "should not land", as_peer: "seshat" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
	});

	test("does NOT return isError for validator (pre-network gate passes)", async () => {
		// env says "seshat" (orchestrator), declared as_peer="validator" must be accepted.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
			__fakeConcludeResult: { id: "fake-conclusion-id" },
		});
		const result = await tools.honcho_conclude.execute(
			"call-4",
			{ content: "fixture", as_peer: "validator" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});

	test("does NOT return isError for reviewer (pre-network gate passes)", async () => {
		// env says "seshat" (orchestrator), declared as_peer="reviewer" must be accepted.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
			__fakeConcludeResult: { id: "fake-reviewer-id" },
		});
		const result = await tools.honcho_conclude.execute(
			"call-4r",
			{ content: "reviewer-truth", as_peer: "reviewer" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});
});

// §4.1 — as_peer required for honcho_conclude (new tests)
describe("[unit] honcho_conclude as_peer parameter", () => {
	const envWithWriter = (): HonchoToolRuntimeEnv => ({
		HONCHO_API_KEY: "dummy",
		HONCHO_WORKSPACE_ID: "w",
		HONCHO_SESSION_ID: "s",
		// env has a valid writer but as_peer must still be explicitly required
		HONCHO_PEER_ID: "validator",
	});

	// §4.1: missing as_peer returns isError naming the missing parameter
	test("rejects when as_peer is missing (env has valid writer)", async () => {
		const tools = buildHonchoTools({
			getEnv: envWithWriter,
			__fakeConcludeResult: { id: "should-not-reach" },
		});
		const result = await tools.honcho_conclude.execute(
			"req-1",
			{ content: "some conclusion" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text.toLowerCase()).toContain("as_peer");
	});

	// §4.1: empty-string as_peer returns isError
	test("rejects when as_peer is empty string (env has valid writer)", async () => {
		const tools = buildHonchoTools({
			getEnv: envWithWriter,
			__fakeConcludeResult: { id: "should-not-reach" },
		});
		const result = await tools.honcho_conclude.execute(
			"req-2",
			{ content: "some conclusion", as_peer: "" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text.toLowerCase()).toContain("as_peer");
	});

	// §4.3: env=validator, as_peer=seshat → rejected (declared identity beats env)
	test("rejects seshat as_peer even when env HONCHO_PEER_ID=validator", async () => {
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "validator",
			}),
			__fakeConcludeResult: { id: "should-not-reach" },
		});
		const result = await tools.honcho_conclude.execute(
			"prec-1",
			{ content: "some conclusion", as_peer: "seshat" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
	});

	// §4.3: env=seshat, as_peer=validator → accepted (declared identity beats env)
	test("accepts validator as_peer even when env HONCHO_PEER_ID=seshat", async () => {
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
			__fakeConcludeResult: { id: "fake-prec-2" },
		});
		const result = await tools.honcho_conclude.execute(
			"prec-2",
			{ content: "validator conclusion", as_peer: "validator" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});

	// §4.1: steward with as_peer is accepted at schema level (prefix checked separately)
	test("accepts steward as_peer with product: prefix", async () => {
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
			__fakeConcludeResult: { id: "fake-steward" },
		});
		const result = await tools.honcho_conclude.execute(
			"req-3",
			{ content: "product: a product truth", as_peer: "steward" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});
});

// §4.2 — as_peer optional for honcho_remember (new tests)
describe("[unit] honcho_remember as_peer parameter", () => {
	// §4.2: omitting as_peer falls back to env-derived peer (existing behaviour preserved)
	test("omitting as_peer uses env HONCHO_PEER_ID for the call", async () => {
		// We can't observe the Honcho client peer() argument without a live call,
		// but we can verify the call does NOT return isError (i.e. no mandatory-field rejection).
		// The env-fallback contract is: no isError at the pre-network gate when all env vars present.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "luci",
			}),
		});
		// Without __fakeConcludeResult / network, this will hit network and error — but the
		// error will be a Honcho SDK error, not an as_peer validation error. We test
		// that the error text does NOT contain "as_peer" (it's not a required-field error).
		const result = await tools.honcho_remember.execute(
			"rem-1",
			{ content: "a memory" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		// If network fails the result will be isError from Honcho, but not from as_peer gate.
		if (result.isError) {
			const text = result.content.map((c: any) => c.text).join("\n");
			expect(text).not.toContain("as_peer is required");
		}
		// No assertion that it succeeded — we only assert absence of as_peer validation error.
	});

	// §4.2: supplied as_peer overrides env peer for the network call
	test("supplying as_peer overrides HONCHO_PEER_ID from env", async () => {
		// Again can't intercept the client peer() arg without a live call, but we can
		// assert: no isError due to as_peer validation (it's an optional param — should
		// be accepted by the schema). If a schema validator rejects unknown keys, this
		// test would incorrectly pass; implementer must ensure as_peer flows through.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "seshat",
			}),
		});
		const result = await tools.honcho_remember.execute(
			"rem-2",
			{ content: "a memory", as_peer: "implementer" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		// Like above: only assert the response is NOT an as_peer-validation error.
		if (result.isError) {
			const text = result.content.map((c: any) => c.text).join("\n");
			expect(text).not.toContain("as_peer is required");
		}
	});
});

describe("[unit] honcho_search workspace scope rejection", () => {
	const envFull: HonchoToolRuntimeEnv = {
		HONCHO_API_KEY: "dummy",
		HONCHO_WORKSPACE_ID: "w",
		HONCHO_SESSION_ID: "s",
		HONCHO_PEER_ID: "luci",
	};

	test("scope:'workspace' returns isError containing 'not yet wired'", async () => {
		const tools = buildHonchoTools({ getEnv: () => envFull });
		const result = await tools.honcho_search.execute(
			"ws-1",
			{ query: "anything", scope: "workspace" },
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text).toContain("not yet wired");
	});
});

describe("[unit] steward product: prefix gate", () => {
	// SPEC-008.1: Prefix enforcement is checked against the DECLARED as_peer identity,
	// not the env HONCHO_PEER_ID. getEnv() returns a peer intentionally different from
	// as_peer to prove the gate reads the declared identity.

	// §4.4: as_peer=steward, no prefix → isError
	test("rejects steward conclusions without 'product:' prefix (via as_peer)", async () => {
		// env says "validator" (not steward); declared as_peer="steward" triggers prefix gate.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "validator",
			}),
			__fakeConcludeResult: { id: "fake-id" },
		});
		const result = await tools.honcho_conclude.execute(
			"gate-1",
			{ content: "lesson learned from slice", as_peer: "steward" } as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBe(true);
		const text = result.content.map((c: any) => c.text).join("\n");
		expect(text).toContain("product:");
	});

	// §4.4: as_peer=steward, with prefix → not isError
	test("allows steward conclusions with 'product:' prefix (via as_peer)", async () => {
		// env says "validator" (not steward); declared as_peer="steward" passes when prefix present.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "validator",
			}),
			__fakeConcludeResult: { id: "fake-steward-id" },
		});
		const result = await tools.honcho_conclude.execute(
			"gate-2",
			{
				content: "product: Curia requires LFPDPPP data-residency",
				as_peer: "steward",
			} as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});

	// §4.4: as_peer=validator, no prefix → NOT isError (prefix gate only applies to steward)
	test("allows validator conclusions without 'product:' prefix (via as_peer)", async () => {
		// env says "steward"; declared as_peer="validator" must NOT trigger the prefix gate.
		const tools = buildHonchoTools({
			getEnv: () => ({
				HONCHO_API_KEY: "dummy",
				HONCHO_WORKSPACE_ID: "w",
				HONCHO_SESSION_ID: "s",
				HONCHO_PEER_ID: "steward",
			}),
			__fakeConcludeResult: { id: "fake-validator-id" },
		});
		const result = await tools.honcho_conclude.execute(
			"gate-3",
			{
				content: "engineering truth: no prefix needed",
				as_peer: "validator",
			} as any,
			new AbortController().signal,
			() => {},
			{ cwd: process.cwd() } as any,
		);
		expect(result.isError).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// [unit] CONCLUSION_WRITERS pin
//
// Imports CONCLUSION_WRITERS from the canonical OMP Honcho tool AND from the
// inlined skill copy in skills/memory/bin/_specsafe-state.ts. Asserts
// set-equality so that any drift between the two is caught at the test boundary.
// ---------------------------------------------------------------------------

describe("[unit] CONCLUSION_WRITERS pin", () => {
	test("canonical and memory-inlined sets contain the same three members", async () => {
		const { CONCLUSION_WRITERS: canonical } = await import(
			"../tools/honcho/index.ts"
		);
		const { CONCLUSION_WRITERS: memoryInlined } = await import(
			"../skills/memory/bin/_specsafe-state.ts"
		);

		const canonicalSorted = Array.from(canonical).sort();
		const memoryInlinedSorted = Array.from(memoryInlined).sort();

		expect(canonicalSorted).toEqual(["reviewer", "steward", "validator"]);
		expect(memoryInlinedSorted).toEqual(["reviewer", "steward", "validator"]);
		expect(canonicalSorted).toEqual(memoryInlinedSorted);
	});

	test("canonical and memory-inlined sets both have size 3", async () => {
		const { CONCLUSION_WRITERS: canonical } = await import(
			"../tools/honcho/index.ts"
		);
		const { CONCLUSION_WRITERS: memoryInlined } = await import(
			"../skills/memory/bin/_specsafe-state.ts"
		);

		expect(canonical.size).toBe(3);
		expect(memoryInlined.size).toBe(3);
	});
});

// ---------- [live] integration tests against pi-dev-sandbox ----------

describe.skipIf(!LIVE)(
	"[live] honcho integration against pi-dev-sandbox",
	() => {
		let liveSessionId: string;

		beforeAll(async () => {
			const { provisionSandboxSession } = await import(
				"../tools/honcho/index.ts"
			);
			liveSessionId = await provisionSandboxSession({
				workspaceId: TEST_WORKSPACE,
				sessionId: `${TEST_RUN_ID}-roundtrip`,
			});
		});

		afterAll(async () => {
			const { cleanupSandboxSession } = await import(
				"../tools/honcho/index.ts"
			);
			await cleanupSandboxSession({
				workspaceId: TEST_WORKSPACE,
				sessionId: liveSessionId,
			});
		});

		test("round-trip: remember a message, search retrieves it", async () => {
			const tools = buildHonchoTools({
				getEnv: () => ({
					HONCHO_API_KEY: process.env.HONCHO_API_KEY,
					HONCHO_WORKSPACE_ID: TEST_WORKSPACE,
					HONCHO_SESSION_ID: liveSessionId,
					HONCHO_PEER_ID: "luci",
				}),
			});

			const needle = `roundtrip-${TEST_RUN_ID}`;
			const write = await tools.honcho_remember.execute(
				"live-1",
				{ content: `needle ${needle} payload` },
				new AbortController().signal,
				() => {},
				{ cwd: process.cwd() } as any,
			);
			expect(write.isError).toBeFalsy();

			const deadline = Date.now() + 10_000;
			let foundNeedle = false;
			while (Date.now() < deadline) {
				const search = await tools.honcho_search.execute(
					"live-2",
					{ query: needle, scope: "session" },
					new AbortController().signal,
					() => {},
					{ cwd: process.cwd() } as any,
				);
				const text = search.content.map((c: any) => c.text).join("\n");
				if (text.includes(needle)) {
					foundNeedle = true;
					break;
				}
				await new Promise((r) => setTimeout(r, 500));
			}
			expect(foundNeedle).toBe(true);
		});

		test("honcho_conclude from validator creates a listable conclusion", async () => {
			const tools = buildHonchoTools({
				getEnv: () => ({
					HONCHO_API_KEY: process.env.HONCHO_API_KEY,
					HONCHO_WORKSPACE_ID: TEST_WORKSPACE,
					HONCHO_SESSION_ID: liveSessionId,
					HONCHO_PEER_ID: "validator",
				}),
			});

			const uniq = `validator-conclusion-${TEST_RUN_ID}`;
			const result = await tools.honcho_conclude.execute(
				"live-5",
				{ content: `engineering truth: ${uniq}`, as_peer: "validator" },
				new AbortController().signal,
				() => {},
				{ cwd: process.cwd() } as any,
			);
			expect(result.isError).toBeFalsy();
			const conclusionId = (result.details as any)?.conclusionId;
			expect(typeof conclusionId).toBe("string");
			expect(conclusionId.length).toBeGreaterThan(0);

			const { listConclusionsForTest } = await import(
				"../tools/honcho/index.ts"
			);
			const ids = await listConclusionsForTest({
				workspaceId: TEST_WORKSPACE,
				peerId: "validator",
			});
			expect(ids).toContain(conclusionId);
		});

		test("honcho_conclude from implementer does NOT create a conclusion on Honcho", async () => {
			const tools = buildHonchoTools({
				getEnv: () => ({
					HONCHO_API_KEY: process.env.HONCHO_API_KEY,
					HONCHO_WORKSPACE_ID: TEST_WORKSPACE,
					HONCHO_SESSION_ID: liveSessionId,
					HONCHO_PEER_ID: "implementer",
				}),
			});
			const { listConclusionsForTest } = await import(
				"../tools/honcho/index.ts"
			);
			const before = await listConclusionsForTest({
				workspaceId: TEST_WORKSPACE,
				peerId: "implementer",
			});
			const result = await tools.honcho_conclude.execute(
				"live-6",
				{ content: "should be rejected", as_peer: "implementer" },
				new AbortController().signal,
				() => {},
				{ cwd: process.cwd() } as any,
			);
			expect(result.isError).toBe(true);
			const after = await listConclusionsForTest({
				workspaceId: TEST_WORKSPACE,
				peerId: "implementer",
			});
			expect(after.length).toBe(before.length);
		});

		test("api key is never echoed in any tool result (content or details)", async () => {
			const apiKey = process.env.HONCHO_API_KEY ?? "";
			expect(apiKey.length).toBeGreaterThan(0);

			const tools = buildHonchoTools({
				getEnv: () => ({
					HONCHO_API_KEY: apiKey,
					HONCHO_WORKSPACE_ID: TEST_WORKSPACE,
					HONCHO_SESSION_ID: liveSessionId,
					HONCHO_PEER_ID: "luci",
				}),
			});

			for (const [name, input] of [
				["honcho_remember", { content: "probe" }],
				["honcho_search", { query: "probe" }],
				["honcho_recall", { query: "probe" }],
			] as const) {
				const tool = (tools as any)[name];
				const res = await tool.execute(
					"key-leak-" + name,
					input,
					new AbortController().signal,
					() => {},
					{
						cwd: process.cwd(),
					} as any,
				);
				const blob = JSON.stringify(res);
				expect(blob).not.toContain(apiKey);
			}
		}, 20_000);
	},
);

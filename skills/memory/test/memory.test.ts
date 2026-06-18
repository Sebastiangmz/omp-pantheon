/**
 * Tests for the memory skill.
 *
 * SpecSafe slice: SPEC-20260424-003 — push-and-memory-skills
 *
 * Test types:
 *   [unit] — no network; pure dispatch logic with mock Honcho client.
 *
 * These tests MUST fail RED before the implementation exists, then turn GREEN.
 */

import { describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StateFile } from "../bin/_specsafe-state.ts";
// NOTE: The smoke test below imports from ../bin/_specsafe-state.ts. That import
// will fail (Cannot find module) until the implementer creates the file per
// SPEC-008.2 §3.2. This is the correct TDD-red state.
import { dispatch } from "../bin/memory.ts";

// ---------------------------------------------------------------------------
// [unit] SPEC-008.2 — module-load smoke test for _specsafe-state.ts inline copy
//
// Asserts that the inlined surface exported by ../bin/_specsafe-state.ts is
// importable and exposes the expected shapes. Fails RED (Cannot find module)
// until the implementer creates that file per SPEC-008.2 §3.2.
// ---------------------------------------------------------------------------

describe("[unit] _specsafe-state.ts module-load smoke", () => {
	test("statePathFor is a function", async () => {
		const mod = await import("../bin/_specsafe-state.ts");
		expect(typeof mod.statePathFor).toBe("function");
	});

	test("readStateFileOrNull is a function", async () => {
		const mod = await import("../bin/_specsafe-state.ts");
		expect(typeof mod.readStateFileOrNull).toBe("function");
	});

	test("CONCLUSION_WRITERS is a Set with size 3", async () => {
		const mod = await import("../bin/_specsafe-state.ts");
		expect(mod.CONCLUSION_WRITERS).toBeInstanceOf(Set);
		expect((mod.CONCLUSION_WRITERS as Set<string>).size).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
}

function writeState(dir: string, state: StateFile): void {
	const piDir = path.join(dir, ".pi");
	fs.mkdirSync(piDir, { recursive: true });
	fs.writeFileSync(
		path.join(piDir, ".honcho-state.json"),
		JSON.stringify(state, null, 2),
		{ mode: 0o600 },
	);
}

function makeOpenSliceState(): StateFile {
	return {
		currentSlice: {
			id: "SPEC-20260424-003",
			workspaceId: "ws-abc123",
			sessionId: "sess-xyz789",
			beganAt: "2026-04-24T14:02:11Z",
			costCounter: {
				honchoCalls: 42,
				honchoCost: 0.0084,
				subagentTokens: {
					input: 15230,
					output: 3104,
					cacheRead: 22400,
					cacheWrite: 980,
					cost: 0.0412,
					turns: 7,
				},
			},
		},
		history: [
			{
				sliceId: "SPEC-20260424-001",
				workspaceId: "ws-abc123",
				sessionId: "sess-old111",
				beganAt: "2026-04-23T10:00:00Z",
				endedAt: "2026-04-23T11:30:00Z",
				outcome: "PASS",
				costSummary: {
					honchoCalls: 10,
					honchoCost: 0.002,
					subagentTokens: {
						input: 5000,
						output: 1000,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0.015,
						turns: 3,
					},
				},
			},
			{
				sliceId: "SPEC-20260424-002",
				workspaceId: "ws-abc123",
				sessionId: "sess-old222",
				beganAt: "2026-04-24T09:00:00Z",
				endedAt: "2026-04-24T10:15:00Z",
				outcome: "FAIL",
				costSummary: {
					honchoCalls: 5,
					honchoCost: 0.001,
					subagentTokens: {
						input: 2000,
						output: 500,
						cacheRead: 100,
						cacheWrite: 50,
						cost: 0.005,
						turns: 2,
					},
				},
			},
		],
	};
}

function makeClosedSliceState(): StateFile {
	const open = makeOpenSliceState();
	const closed: StateFile = {
		currentSlice: null,
		history: [
			...open.history,
			{
				sliceId: "SPEC-20260424-003",
				workspaceId: "ws-abc123",
				sessionId: "sess-xyz789",
				beganAt: "2026-04-24T14:02:11Z",
				endedAt: "2026-04-24T16:45:00Z",
				outcome: "PASS",
				costSummary: {
					honchoCalls: 42,
					honchoCost: 0.0084,
					subagentTokens: {
						input: 15230,
						output: 3104,
						cacheRead: 22400,
						cacheWrite: 980,
						cost: 0.0412,
						turns: 7,
					},
				},
			},
		],
	};
	return closed;
}

// ---------------------------------------------------------------------------
// Mock Honcho client factory
// ---------------------------------------------------------------------------

function neverCall(name: string) {
	return mock((..._args: unknown[]) => {
		throw new Error(
			`WRITE METHOD CALLED: ${name} — this is forbidden in the memory skill`,
		);
	});
}

interface MockConclusion {
	id: string;
	content: string;
	created_at: string;
	peer_id?: string;
}

interface MockHit {
	content: string;
	created_at?: string;
}

function makeMockFactory(opts: {
	conclusions?: Record<string, MockConclusion[]>; // peerId -> conclusions
	searchHits?: MockHit[];
}) {
	const conclusionsByPeer = opts.conclusions ?? {};
	const hits = opts.searchHits ?? [];

	// Track write attempts
	const writeSpies = {
		conclusionsCreate: neverCall("conclusions.create"),
		addMessages: neverCall("addMessages"),
		peerChat: neverCall("peer.chat"),
		peerMessage: neverCall("peer.message"),
	};

	function makePeer(peerId: string) {
		const peerConclusions = conclusionsByPeer[peerId] ?? [];
		return {
			conclusions: {
				create: writeSpies.conclusionsCreate,
				async list(_opts?: { page?: number; size?: number }): Promise<
					AsyncIterable<MockConclusion>
				> {
					async function* gen() {
						for (const c of peerConclusions) {
							yield c;
						}
					}
					return gen();
				},
			},
			async search(_query: string): Promise<AsyncIterable<MockHit>> {
				async function* gen() {
					for (const h of hits) {
						yield h;
					}
				}
				return gen();
			},
			addMessages: writeSpies.addMessages,
			message: writeSpies.peerMessage,
			chat: writeSpies.peerChat,
		};
	}

	function makeSession(_sessionId: string) {
		return {
			async search(_query: string): Promise<AsyncIterable<MockHit>> {
				async function* gen() {
					for (const h of hits) {
						yield h;
					}
				}
				return gen();
			},
			addMessages: writeSpies.addMessages,
		};
	}

	const factory = mock((_env: Record<string, string | undefined>) => ({
		peer: mock(async (peerId: string) => makePeer(peerId)),
		session: mock(async (sessionId: string) => makeSession(sessionId)),
	}));

	return { factory, writeSpies };
}

// ---------------------------------------------------------------------------
// Helper env
// ---------------------------------------------------------------------------

const baseEnv: Record<string, string | undefined> = {
	HONCHO_API_KEY: "test-api-key",
	HONCHO_WORKSPACE_ID: "ws-abc123",
};

// ---------------------------------------------------------------------------
// [AC5] status with open slice
// ---------------------------------------------------------------------------

describe("[unit] status — open slice", () => {
	test("[AC5] prints slice id, session id, workspace id, and counter numbers", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({});
		const result = await dispatch(["status"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("SPEC-20260424-003");
		expect(result.stdout).toContain("sess-xyz789");
		expect(result.stdout).toContain("ws-abc123");
		expect(result.stdout).toContain("42"); // honcho_calls
		expect(result.stdout).toContain("7"); // subagent_turns
		expect(result.stdout).toContain("15230"); // input tokens
		expect(result.stdout).toContain("3104"); // output tokens
	});

	test("prints last 3 history entries when no slice open", async () => {
		const tmpDir = makeTempDir();
		const state = makeClosedSliceState();
		writeState(tmpDir, state);
		const { factory } = makeMockFactory({});
		const result = await dispatch(["status"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("no slice currently open");
		// Should show up to 3 recent history entries
		expect(result.stdout).toContain("SPEC-20260424-003");
	});

	test("handles missing state file gracefully", async () => {
		const tmpDir = makeTempDir();
		const { factory } = makeMockFactory({});
		const result = await dispatch(["status"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("no slice currently open");
	});
});

// ---------------------------------------------------------------------------
// [AC6] cost command
// ---------------------------------------------------------------------------

describe("[unit] cost — finished slice from history", () => {
	test("[AC6] prints cost breakdown matching state file history entry exactly", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());
		const { factory } = makeMockFactory({});
		const result = await dispatch(["cost", "SPEC-20260424-003"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("SPEC-20260424-003");
		expect(result.stdout).toContain("42"); // honcho_calls
		expect(result.stdout).toContain("7"); // turns
		expect(result.stdout).toContain("15230"); // input tokens
		expect(result.stdout).toContain("3104"); // output tokens
		expect(result.stdout).toContain("22400"); // cache read
		expect(result.stdout).toContain("980"); // cache write
		// Dollar amounts
		expect(result.stdout).toContain("0.0084");
		expect(result.stdout).toContain("0.0412");
	});

	test("uses current slice when no sliceId given", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({});
		const result = await dispatch(["cost"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("SPEC-20260424-003");
	});

	test("exits non-zero with message when sliceId not found", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());
		const { factory } = makeMockFactory({});
		const result = await dispatch(["cost", "SPEC-NOT-EXIST"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(1);
		expect(result.stderr).toContain("SPEC-NOT-EXIST");
		expect(result.stderr.toLowerCase()).toContain("not found");
	});
});

// ---------------------------------------------------------------------------
// [AC7] review command — time window filter
// ---------------------------------------------------------------------------

describe("[unit] review — time window filter", () => {
	// Session window: 2026-04-24T14:02:11Z → 2026-04-24T16:45:00Z
	// Grace band: ±5s
	const beganAt = new Date("2026-04-24T14:02:11Z");
	const endedAt = new Date("2026-04-24T16:45:00Z");
	const grace = 5_000;

	// Inside window
	const inside1 = new Date(beganAt.getTime() + 60_000); // +1m
	const inside2 = new Date(endedAt.getTime() - 60_000); // -1m from end

	// At grace boundary (included)
	const justBeforeGrace = new Date(beganAt.getTime() - 3_000); // -3s (within ±5s grace)
	const justAfterGrace = new Date(endedAt.getTime() + 3_000); // +3s (within ±5s grace)

	// Outside grace band (excluded)
	const tooEarly = new Date(beganAt.getTime() - 10_000); // -10s
	const tooLate = new Date(endedAt.getTime() + 10_000); // +10s

	const mockConclusions: Record<string, MockConclusion[]> = {
		validator: [
			{
				id: "c-inside1",
				content: "conclusion inside window",
				created_at: inside1.toISOString(),
			},
			{
				id: "c-inside2",
				content: "conclusion near end",
				created_at: inside2.toISOString(),
			},
			{
				id: "c-grace-begin",
				content: "conclusion within begin grace",
				created_at: justBeforeGrace.toISOString(),
			},
			{
				id: "c-grace-end",
				content: "conclusion within end grace",
				created_at: justAfterGrace.toISOString(),
			},
			{
				id: "c-too-early",
				content: "conclusion too early - EXCLUDED",
				created_at: tooEarly.toISOString(),
			},
			{
				id: "c-too-late",
				content: "conclusion too late - EXCLUDED",
				created_at: tooLate.toISOString(),
			},
		],
		reviewer: [],
		steward: [],
	};

	test("[AC7] includes conclusions inside window and within grace, excludes those outside", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState()); // has SPEC-20260424-003 with sess-xyz789
		const { factory } = makeMockFactory({ conclusions: mockConclusions });

		const result = await dispatch(["review", "sess-xyz789"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});

		expect(result.exit).toBe(0);
		// Included
		expect(result.stdout).toContain("conclusion inside window");
		expect(result.stdout).toContain("conclusion near end");
		expect(result.stdout).toContain("conclusion within begin grace");
		expect(result.stdout).toContain("conclusion within end grace");
		// Excluded
		expect(result.stdout).not.toContain("EXCLUDED");
		expect(result.stdout).not.toContain("conclusion too early");
		expect(result.stdout).not.toContain("conclusion too late");
	});

	test("[AC7] calls conclusions.list on each expected peer (validator, reviewer, steward)", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());

		let validatorListCalled = false;
		let reviewerListCalled = false;
		let stewardListCalled = false;

		const listSpy = mock((peerId: string) => {
			if (peerId === "validator") validatorListCalled = true;
			if (peerId === "reviewer") reviewerListCalled = true;
			if (peerId === "steward") stewardListCalled = true;
		});

		// Build a factory that tracks which peers had list called
		const trackingFactory = mock(
			(_env: Record<string, string | undefined>) => ({
				peer: mock(async (peerId: string) => {
					const peerConclusions = mockConclusions[peerId] ?? [];
					return {
						conclusions: {
							create: neverCall("conclusions.create"),
							async list(_opts?: { page?: number; size?: number }) {
								listSpy(peerId);
								async function* gen() {
									for (const c of peerConclusions) yield c;
								}
								return gen();
							},
						},
						search: mock(async (_q: string) => {
							async function* gen() {}
							return gen();
						}),
						addMessages: neverCall("addMessages"),
						message: neverCall("message"),
						chat: neverCall("chat"),
					};
				}),
				session: mock(async (_sessionId: string) => ({
					search: mock(async (_q: string) => {
						async function* gen() {}
						return gen();
					}),
					addMessages: neverCall("addMessages"),
				})),
			}),
		);

		await dispatch(["review", "sess-xyz789"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: trackingFactory,
		});

		expect(validatorListCalled).toBe(true);
		expect(reviewerListCalled).toBe(true);
		expect(stewardListCalled).toBe(true);
	});

	test("exits non-zero when session not found in state", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());
		const { factory } = makeMockFactory({});

		const result = await dispatch(["review", "sess-NOTEXIST"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});

		expect(result.exit).toBe(2);
		expect(result.stderr).toContain("sess-NOTEXIST");
	});

	test("exits 1 when no session-id argument given", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());
		const { factory } = makeMockFactory({});

		const result = await dispatch(["review"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});

		expect(result.exit).toBe(1);
		expect(result.stderr.toLowerCase()).toContain("usage");
	});
});

// ---------------------------------------------------------------------------
// [AC8] No write methods called by any command
// ---------------------------------------------------------------------------

describe("[unit] [AC8] no write methods called by any command", () => {
	test("none of status, cost, history, review, search call write methods", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());

		const { factory, writeSpies } = makeMockFactory({
			conclusions: { validator: [], reviewer: [], steward: [] },
			searchHits: [{ content: "some search result" }],
		});

		// Override write spies to track rather than throw (we check call counts)
		const wroteCreate = mock(() => Promise.resolve({ id: "should-not-exist" }));
		const wroteAddMessages = mock(() => Promise.resolve([]));

		const trackFactory = mock((_env: Record<string, string | undefined>) => ({
			peer: mock(async (peerId: string) => ({
				conclusions: {
					create: wroteCreate,
					async list(_opts?: unknown) {
						async function* gen() {}
						return gen();
					},
				},
				search: mock(async (_q: string) => {
					async function* gen() {
						yield { content: "hit" };
					}
					return gen();
				}),
				addMessages: wroteAddMessages,
				message: mock(() => ({})),
				chat: mock(async () => "response"),
			})),
			session: mock(async (_sessionId: string) => ({
				search: mock(async (_q: string) => {
					async function* gen() {}
					return gen();
				}),
				addMessages: wroteAddMessages,
			})),
		}));

		const commands: [string[]][] = [
			[["status"]],
			[["cost", "SPEC-20260424-003"]],
			[["history", "--limit=2"]],
			[["review", "sess-xyz789"]],
			[["search", "some query"]],
		];

		for (const [[cmd, ...args]] of commands) {
			await dispatch([cmd, ...args], {
				cwd: tmpDir,
				env: baseEnv,
				honchoClientFactory: trackFactory,
			});
		}

		// Verify that write methods were never invoked
		expect(wroteCreate.mock.calls.length).toBe(0);
		expect(wroteAddMessages.mock.calls.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// history command
// ---------------------------------------------------------------------------

describe("[unit] history", () => {
	test("prints all history entries by default (up to 10)", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState());
		const { factory } = makeMockFactory({});

		const result = await dispatch(["history"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("SPEC-20260424-001");
		expect(result.stdout).toContain("SPEC-20260424-002");
		expect(result.stdout).toContain("SPEC-20260424-003");
	});

	test("--limit=2 prints exactly 2 most recent entries", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeClosedSliceState()); // 3 entries in history
		const { factory } = makeMockFactory({});

		const result = await dispatch(["history", "--limit=2"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		// Should have exactly 2 entries: SPEC-002 and SPEC-003 (most recent)
		expect(result.stdout).toContain("SPEC-20260424-002");
		expect(result.stdout).toContain("SPEC-20260424-003");
		// SPEC-001 should not appear (it's the oldest of 3)
		expect(result.stdout).not.toContain("SPEC-20260424-001");
	});

	test("prints '(no history)' when history is empty", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, { currentSlice: null, history: [] });
		const { factory } = makeMockFactory({});

		const result = await dispatch(["history"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("(no history)");
	});
});

// ---------------------------------------------------------------------------
// search command
// ---------------------------------------------------------------------------

describe("[unit] search", () => {
	test("returns formatted hits from mock", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({
			searchHits: [
				{ content: "a result from honcho" },
				{ content: "another one" },
			],
		});

		const result = await dispatch(["search", "my query"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("a result from honcho");
		expect(result.stdout).toContain("another one");
	});

	test("prints (no matches) when there are no hits", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({ searchHits: [] });

		const result = await dispatch(["search", "empty query"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("(no matches)");
	});

	test("exits 1 when no query argument", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({});

		const result = await dispatch(["search"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(1);
		expect(result.stderr.toLowerCase()).toContain("usage");
	});

	test("exits 2 when HONCHO_API_KEY missing", async () => {
		const tmpDir = makeTempDir();
		writeState(tmpDir, makeOpenSliceState());
		const { factory } = makeMockFactory({});

		const result = await dispatch(["search", "query"], {
			cwd: tmpDir,
			env: { ...baseEnv, HONCHO_API_KEY: undefined },
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(2);
		expect(result.stderr).toContain("HONCHO_API_KEY");
	});
});

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------

describe("[unit] unknown command", () => {
	test("exits 1 with usage message", async () => {
		const tmpDir = makeTempDir();
		const { factory } = makeMockFactory({});
		const result = await dispatch(["bogus"], {
			cwd: tmpDir,
			env: baseEnv,
			honchoClientFactory: factory,
		});
		expect(result.exit).toBe(1);
		expect(result.stderr.toLowerCase()).toContain("usage");
	});
});

#!/usr/bin/env -S bun run
/**
 * memory — read-side helpers for Honcho memory and SpecSafe slice cost/activity.
 *
 * SpecSafe slice: SPEC-20260424-003 — push-and-memory-skills
 *
 * All commands are read-only. No mutations to Honcho or state files.
 *
 * Usage:
 *   bun run ./bin/memory.ts status
 *   bun run ./bin/memory.ts review <session-id>
 *   bun run ./bin/memory.ts cost [<slice-id>]
 *   bun run ./bin/memory.ts history [--limit=N]
 *   bun run ./bin/memory.ts search <query>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	CostCounter,
	CurrentSlice,
	HistoryEntry,
	StateFile,
} from "./_specsafe-state.ts";
import {
	readStateFileOrNull,
	statePathFor,
	CONCLUSION_WRITERS,
} from "./_specsafe-state.ts";

// ---------------------------------------------------------------------------
// Re-export types for consumers
// ---------------------------------------------------------------------------
export type { CostCounter, CurrentSlice, HistoryEntry, StateFile };

// ---------------------------------------------------------------------------
// Honcho client factory type
// ---------------------------------------------------------------------------

export type HonchoEnv = {
	HONCHO_API_KEY?: string;
	HONCHO_WORKSPACE_ID?: string;
};

export type MockConclusion = {
	id: string;
	content: string;
	created_at: string;
	peer_id?: string;
};

export type MockHit = {
	content: string;
	created_at?: string;
};

export type HonchoClient = {
	peer(peerId: string): Promise<{
		conclusions: {
			create(...args: unknown[]): unknown;
			list(opts?: { page?: number; size?: number }): Promise<
				AsyncIterable<MockConclusion>
			>;
		};
		search(query: string): Promise<AsyncIterable<MockHit>>;
		addMessages(...args: unknown[]): unknown;
		message(...args: unknown[]): unknown;
		chat(...args: unknown[]): unknown;
	}>;
	session(sessionId: string): Promise<{
		search(query: string): Promise<AsyncIterable<MockHit>>;
		addMessages(...args: unknown[]): unknown;
	}>;
};

export type HonchoClientFactory = (
	env: Record<string, string | undefined>,
) => HonchoClient;

// ---------------------------------------------------------------------------
// Dispatch options and result
// ---------------------------------------------------------------------------

export type DispatchOpts = {
	cwd: string;
	env: Record<string, string | undefined>;
	honchoClientFactory: HonchoClientFactory;
};

export type DispatchResult = {
	stdout: string;
	stderr: string;
	exit: number;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 24;
const NUM_WIDTH = 8;

function padLabel(label: string): string {
	return label.padEnd(LABEL_WIDTH);
}

function padNum(n: number | string): string {
	return String(n).padStart(NUM_WIDTH);
}

function formatDollars(n: number): string {
	return `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function loadState(cwd: string): StateFile {
	const sp = statePathFor(cwd);
	return readStateFileOrNull(sp) ?? { currentSlice: null, history: [] };
}

function findSessionInState(
	state: StateFile,
	sessionId: string,
): { entry: CurrentSlice | HistoryEntry; endedAt: string } | null {
	// Check currentSlice
	if (state.currentSlice && state.currentSlice.sessionId === sessionId) {
		return { entry: state.currentSlice, endedAt: new Date().toISOString() };
	}
	// Check history
	for (const h of state.history) {
		if (h.sessionId === sessionId) {
			return { entry: h, endedAt: h.endedAt };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Individual command implementations
// ---------------------------------------------------------------------------

async function cmdStatus(state: StateFile): Promise<DispatchResult> {
	const lines: string[] = [];

	if (!state.currentSlice) {
		lines.push("no slice currently open");
		lines.push("");
		const recent = state.history.slice(-3);
		if (recent.length === 0) {
			lines.push("(no history)");
		} else {
			lines.push("recent slices:");
			for (const h of recent) {
				lines.push(
					`  ${h.sliceId}  ${h.outcome}  ${h.beganAt} -> ${h.endedAt}`,
				);
			}
		}
	} else {
		const c = state.currentSlice;
		const cc = c.costCounter;
		lines.push(`${padLabel("slice:")}${c.id}`);
		lines.push(`${padLabel("session:")}${c.sessionId}`);
		lines.push(`${padLabel("workspace:")}${c.workspaceId}`);
		lines.push(`${padLabel("began:")}${c.beganAt}`);
		lines.push(`${padLabel("honcho_calls:")}${padNum(cc.honchoCalls)}`);
		lines.push(
			`${padLabel("subagent_turns:")}${padNum(cc.subagentTokens.turns)}`,
		);
		lines.push(
			`${padLabel("subagent_input_tok:")}${padNum(cc.subagentTokens.input)}`,
		);
		lines.push(
			`${padLabel("subagent_output_tok:")}${padNum(cc.subagentTokens.output)}`,
		);
	}

	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

async function cmdReview(
	sessionId: string,
	state: StateFile,
	env: Record<string, string | undefined>,
	honchoClientFactory: HonchoClientFactory,
): Promise<DispatchResult> {
	const apiKey = env.HONCHO_API_KEY;
	if (!apiKey) {
		return {
			stdout: "",
			stderr: "error: HONCHO_API_KEY env var is required for review command",
			exit: 2,
		};
	}

	const found = findSessionInState(state, sessionId);
	if (!found) {
		return {
			stdout: "",
			stderr: `error: session ${sessionId} not found in current slice or history`,
			exit: 2,
		};
	}

	const { entry, endedAt } = found;
	const beganAt = entry.beganAt;
	const GRACE_MS = 5_000;
	const windowStart = new Date(beganAt).getTime() - GRACE_MS;
	const windowEnd = new Date(endedAt).getTime() + GRACE_MS;

	// Get workspaceId from state entry or env
	const workspaceId =
		env.HONCHO_WORKSPACE_ID ??
		("workspaceId" in entry ? entry.workspaceId : undefined);

	if (!workspaceId) {
		return {
			stdout: "",
			stderr:
				"error: HONCHO_WORKSPACE_ID is required (set env var or ensure state file has workspaceId)",
			exit: 2,
		};
	}

	const client = honchoClientFactory({
		...env,
		HONCHO_WORKSPACE_ID: workspaceId,
	});

	const lines: string[] = [];

	try {
		for (const peerId of CONCLUSION_WRITERS) {
			const peer = await client.peer(peerId);
			const page = await peer.conclusions.list({ page: 1, size: 100 });
			for await (const c of page) {
				const createdMs = new Date(c.created_at).getTime();
				if (createdMs >= windowStart && createdMs <= windowEnd) {
					const truncated = c.content.slice(0, 200);
					lines.push(`[${c.created_at}] ${peerId}: ${truncated}`);
				}
			}
		}
	} catch (err: unknown) {
		const raw = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `error: honcho call failed: ${raw}`, exit: 2 };
	}

	if (lines.length === 0) {
		lines.push("(no conclusions in this window)");
	}

	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

async function cmdCost(
	sliceId: string | undefined,
	state: StateFile,
): Promise<DispatchResult> {
	let id: string;
	let cc: CostCounter;

	if (!sliceId) {
		// Use current slice
		if (!state.currentSlice) {
			// Fall back to most recent history entry
			const last = state.history[state.history.length - 1];
			if (!last) {
				return {
					stdout: "",
					stderr: "error: no slice currently open and no history entries",
					exit: 1,
				};
			}
			id = last.sliceId;
			cc = last.costSummary;
		} else {
			id = state.currentSlice.id;
			cc = state.currentSlice.costCounter;
		}
	} else {
		// Search by sliceId — check currentSlice first, then history
		if (state.currentSlice && state.currentSlice.id === sliceId) {
			id = state.currentSlice.id;
			cc = state.currentSlice.costCounter;
		} else {
			const entry = state.history.find((h) => h.sliceId === sliceId);
			if (!entry) {
				return {
					stdout: "",
					stderr: `error: slice ${sliceId} not found in current slice or history`,
					exit: 1,
				};
			}
			id = entry.sliceId;
			cc = entry.costSummary;
		}
	}

	const total = cc.honchoCost + cc.subagentTokens.cost;
	const lines: string[] = [
		`${padLabel("slice:")}${id}`,
		`${padLabel("honcho_calls:")}${padNum(cc.honchoCalls)}`,
		`${padLabel("honcho_cost:")}${padNum(formatDollars(cc.honchoCost))}`,
		`${padLabel("subagent_turns:")}${padNum(cc.subagentTokens.turns)}`,
		`${padLabel(" input tokens:")}${padNum(cc.subagentTokens.input)}`,
		`${padLabel(" output tokens:")}${padNum(cc.subagentTokens.output)}`,
		`${padLabel(" cache read:")}${padNum(cc.subagentTokens.cacheRead)}`,
		`${padLabel(" cache write:")}${padNum(cc.subagentTokens.cacheWrite)}`,
		`${padLabel(" subagent_cost:")}${padNum(formatDollars(cc.subagentTokens.cost))}`,
		`${padLabel("total:")}${padNum(formatDollars(total))}`,
	];

	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

async function cmdHistory(
	limit: number,
	state: StateFile,
): Promise<DispatchResult> {
	if (state.history.length === 0) {
		return { stdout: "(no history)", stderr: "", exit: 0 };
	}

	const entries = state.history.slice(-limit);
	const COL_SLICE = 22;
	const COL_OUTCOME = 10;
	const COL_DATE = 22;
	const COL_COST = 10;

	const header = [
		"sliceId".padEnd(COL_SLICE),
		"outcome".padStart(COL_OUTCOME),
		"began".padEnd(COL_DATE),
		"ended".padEnd(COL_DATE),
		"cost".padStart(COL_COST),
	].join("  ");

	const separator = "-".repeat(header.length);

	const rows = entries.map((h) => {
		const cost = h.costSummary.honchoCost + h.costSummary.subagentTokens.cost;
		return [
			h.sliceId.padEnd(COL_SLICE),
			h.outcome.padStart(COL_OUTCOME),
			h.beganAt.padEnd(COL_DATE),
			h.endedAt.padEnd(COL_DATE),
			formatDollars(cost).padStart(COL_COST),
		].join("  ");
	});

	const lines = [header, separator, ...rows];
	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

async function cmdSearch(
	query: string,
	state: StateFile,
	env: Record<string, string | undefined>,
	honchoClientFactory: HonchoClientFactory,
): Promise<DispatchResult> {
	const apiKey = env.HONCHO_API_KEY;
	if (!apiKey) {
		return {
			stdout: "",
			stderr: "error: HONCHO_API_KEY env var is required for search command",
			exit: 2,
		};
	}

	// Determine workspaceId
	const workspaceId =
		env.HONCHO_WORKSPACE_ID ??
		state.currentSlice?.workspaceId ??
		(state.history.length > 0
			? state.history[state.history.length - 1]?.workspaceId
			: undefined);

	if (!workspaceId) {
		return {
			stdout: "",
			stderr:
				"error: HONCHO_WORKSPACE_ID required (set env var or open/have a slice in history)",
			exit: 2,
		};
	}

	const client = honchoClientFactory({
		...env,
		HONCHO_WORKSPACE_ID: workspaceId,
	});
	const allHits: string[] = [];

	try {
		// Workspace scope: iterate over conclusion-writer peers and merge results
		for (const peerId of CONCLUSION_WRITERS) {
			const peer = await client.peer(peerId);
			const page = await peer.search(query);
			for await (const hit of page) {
				const content = String((hit as any).content ?? "");
				allHits.push(content.slice(0, 160));
			}
		}
	} catch (err: unknown) {
		const raw = err instanceof Error ? err.message : String(err);
		return {
			stdout: "",
			stderr: `error: honcho search failed: ${raw}`,
			exit: 2,
		};
	}

	if (allHits.length === 0) {
		return { stdout: "(no matches)", stderr: "", exit: 0 };
	}

	const lines = allHits.map((h) => `- ${h}`);
	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Main dispatch function (pure — no process.* calls)
// ---------------------------------------------------------------------------

export async function dispatch(
	argv: string[],
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const [command, ...rest] = argv;
	const state = loadState(opts.cwd);

	const USAGE = `usage: memory <command> [args]

Commands:
  status                   current slice summary + cost counter
  review <session-id>      conclusions written during that session
  cost [<slice-id>]        cost breakdown for a slice
  history [--limit=N]      recent finished slices with outcome (default N=10)
  search <query>           search Honcho at workspace scope`;

	switch (command) {
		case "status":
			return cmdStatus(state);

		case "review": {
			const sessionId = rest[0];
			if (!sessionId) {
				return {
					stdout: "",
					stderr: `usage: memory review <session-id>\n\n${USAGE}`,
					exit: 1,
				};
			}
			return cmdReview(sessionId, state, opts.env, opts.honchoClientFactory);
		}

		case "cost": {
			const sliceId = rest[0];
			return cmdCost(sliceId, state);
		}

		case "history": {
			let limit = 10;
			for (const arg of rest) {
				const m = arg.match(/^--limit=(\d+)$/);
				if (m) limit = parseInt(m[1]!, 10);
			}
			return cmdHistory(limit, state);
		}

		case "search": {
			const query = rest.join(" ").trim();
			if (!query) {
				return {
					stdout: "",
					stderr: `usage: memory search <query>\n\n${USAGE}`,
					exit: 1,
				};
			}
			return cmdSearch(query, state, opts.env, opts.honchoClientFactory);
		}

		default:
			return {
				stdout: "",
				stderr: `unknown command: ${command ?? "(none)"}\n\n${USAGE}`,
				exit: 1,
			};
	}
}

// ---------------------------------------------------------------------------
// Real Honcho client factory (used by the CLI entry point)
// ---------------------------------------------------------------------------

function realHonchoClientFactory(
	env: Record<string, string | undefined>,
): HonchoClient {
	// Lazy import to avoid requiring Honcho SDK in tests
	const { Honcho } = require("@honcho-ai/sdk");
	const client = new Honcho({
		apiKey: env.HONCHO_API_KEY!,
		workspaceId: env.HONCHO_WORKSPACE_ID!,
	});
	return {
		async peer(peerId: string) {
			return client.peer(peerId);
		},
		async session(sessionId: string) {
			return client.session(sessionId);
		},
	};
}

// ---------------------------------------------------------------------------
// CLI entry point — thin wrapper only
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const result = await dispatch(process.argv.slice(2), {
		cwd: process.cwd(),
		env: process.env as Record<string, string | undefined>,
		honchoClientFactory: realHonchoClientFactory,
	});

	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	process.exit(result.exit);
}

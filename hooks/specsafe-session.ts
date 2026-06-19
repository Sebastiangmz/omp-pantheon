/**
 * SpecSafe session lifecycle hook (Oh My Pi port).
 *
 * Source of truth: ../../.pi/extensions/specsafe-session/index.ts
 *   - lines 25-75:  StateFile/CostCounter shapes + statePathFor()
 *   - lines 77-95:  readStateFileOrNull (corrupt-quarantine semantics)
 *
 * Port adaptations vs vanilla Pi:
 *   - Vanilla Pi exposed three ExtensionAPI tools (specsafe_begin/end/status).
 *     Oh My Pi hooks cannot register tools the way the Pi extension API does;
 *     this port keeps the *state-file shape* identical and emits a trailer
 *     block on session_shutdown when a slice is open. The slice-lifecycle
 *     tools themselves stay in `.pi/` for the vanilla-Pi runtime; this hook
 *     only consumes the state file when running under Oh My Pi.
 *   - The CostCounter is reproduced by shape for SpecSafe accounting. This hook does NOT mutate the counter.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { HookAPI } from "./types";

// ---------------------------------------------------------------------------
// State-file shape — kept structurally identical to .pi/extensions/specsafe-session
// ---------------------------------------------------------------------------

export type CostCounter = {
	externalMemoryCalls: number;
	externalMemoryCost: number;
	subagentTokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
	};
};

export type CurrentSlice = {
	id: string;
	workspaceId: string;
	sessionId: string;
	beganAt: string;
	costCounter: CostCounter;
};

export type HistoryEntry = {
	sliceId: string;
	workspaceId: string;
	sessionId: string;
	beganAt: string;
	endedAt: string;
	outcome: "PASS" | "FAIL" | "ABANDONED";
	costSummary: CostCounter;
};

export type StateFile = {
	currentSlice: CurrentSlice | null;
	history: HistoryEntry[];
};

export function statePathFor(cwd: string): string {
	return join(cwd, ".pi", ".specsafe-state.json");
}

export function readStateFileOrNull(filePath: string): StateFile | null {
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as StateFile;
		if (
			!("currentSlice" in parsed) ||
			!Array.isArray((parsed as { history?: unknown }).history)
		) {
			throw new Error("missing required fields");
		}
		return parsed;
	} catch {
		try {
			const quarantine = `${filePath}.corrupt-${Date.now()}`;
			renameSync(filePath, quarantine);
		} catch {
			// best-effort
		}
		return null;
	}
}

/**
 * Build the four trailers the SpecSafe workflow stamps on every Ghola commit.
 * Mirrors .pi/extensions/specsafe-subagents/index.ts:90-103.
 *
 *   Co-Authored-By — agent/persona name (NOT the model; per source)
 *   Spec-Slice     — current slice id from .pi/.specsafe-state.json
 *   Peer           — agent/persona name
 *   Session        — session id from state file
 */
export function buildTrailerBlock(opts: {
	agent: string;
	sliceId: string;
	sessionId: string;
}): string {
	return [
		`Co-Authored-By: ${opts.agent} <${opts.agent}@seshat.local>`,
		`Spec-Slice: ${opts.sliceId}`,
		`Peer: ${opts.agent}`,
		`Session: ${opts.sessionId}`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

export default function (pi: HookAPI): void {
	// On session start, surface the open slice (if any) into the status bar
	// so the operator can see they're inside a SpecSafe slice.
	pi.on("session_start", async (_event, ctx) => {
		const state = readStateFileOrNull(statePathFor(ctx.cwd));
		const slice = state?.currentSlice;
		if (slice && ctx.hasUI) {
			ctx.ui.setStatus("specsafe", `slice:${slice.id}`);
		}
	});

	// On shutdown, if a slice is open, emit a trailer block as a notification
	// (in interactive) and append it to the session as a custom entry so it
	// persists for subsequent commit-message authoring. This matches the
	// "flush at session end + emit a commit-trailer block" semantic.
	pi.on("session_shutdown", async (_event, ctx) => {
		const state = readStateFileOrNull(statePathFor(ctx.cwd));
		const slice = state?.currentSlice;
		if (!slice) return;

		const sessionId = ctx.sessionManager.getSessionId();
		const block = buildTrailerBlock({
			// Persona/agent name is unknown at the parent session shutdown;
			// fall back to "seshat" (the orchestrator persona — see CLAUDE.md
			// "Memory discipline" section). Per-Ghola trailers are stamped at
			// the subagent boundary by specsafe-subagents.ts.
			agent: "seshat",
			sliceId: slice.id,
			sessionId: slice.sessionId || sessionId,
		});

		pi.appendEntry("specsafe-session-trailers", {
			sliceId: slice.id,
			sessionId: slice.sessionId,
			block,
			emittedAt: new Date().toISOString(),
		});

		if (ctx.hasUI) {
			ctx.ui.notify(
				`SpecSafe slice ${slice.id} still open at shutdown`,
				"warning",
			);
		}
	});
}

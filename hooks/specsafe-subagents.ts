/**
 * SpecSafe subagent trailer-propagation hook (Oh My Pi port).
 *
 * Source of truth: ../../.pi/extensions/specsafe-subagents/index.ts
 *   - lines 47-55:   readSpecsafeState (state-file consumer)
 *   - lines 61-110:  commitSubagentWork (the auto-commit-with-trailers core)
 *   - lines 112-132: summarizeForCommit (assistant-message → commit subject)
 *   - lines 351-364: the runAgent guard `if exitCode === 0 && currentSlice`
 *
 * Port adaptations vs vanilla Pi:
 *   - Vanilla Pi shipped its OWN `subagent` tool that wholesale replaced
 *     dispatch and ran child env injection (SPECSAFE_SLICE_ID and per-agent identity) per-spawn via spawn() options.
 *     Oh My Pi has its own bundled `task` tool whose subprocess we do NOT
 *     control from a hook — there is no clean per-spawn env injection seam.
 *     See PORT-NOTES.md. This port keeps ONLY the auto-commit-with-trailers
 *     half, hooked off `tool_result` for `task`.
 *   - The "no commit on exit != 0" invariant from runAgent is reproduced by
 *     gating on `event.isError !== true`.
 *   - The "no commit on clean tree" + "no commit when no slice open" guards
 *     are kept verbatim inside commitSubagentWork.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { HookAPI } from "./types";
import { statePathFor } from "./specsafe-session";

type SpecsafeStateSnapshot = {
	currentSlice: {
		id: string;
		workspaceId: string;
		sessionId: string;
	} | null;
} | null;

function readSpecsafeState(cwd: string): SpecsafeStateSnapshot {
	const sp = statePathFor(cwd);
	try {
		if (!existsSync(sp)) return null;
		return JSON.parse(readFileSync(sp, "utf-8")) as SpecsafeStateSnapshot;
	} catch {
		return null;
	}
}

/**
 * Commit any dirty working-tree changes with structured trailers attributing
 * the commit to the subagent. No-op when tree is clean or cwd isn't a repo.
 *
 * Port-faithful copy of .pi/extensions/specsafe-subagents/index.ts:61-110.
 */
export function commitSubagentWork(opts: {
	cwd: string;
	agent: string;
	sliceId: string;
	sessionId: string;
	message: string;
}): { committed: boolean; error?: string } {
	const repoCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd: opts.cwd,
		encoding: "utf-8",
	});
	if (repoCheck.status !== 0) {
		return {
			committed: false,
			error: `not a git repo: ${repoCheck.stderr.trim() || "unknown"}`,
		};
	}
	const porcelain = spawnSync("git", ["status", "--porcelain"], {
		cwd: opts.cwd,
		encoding: "utf-8",
	});
	if (porcelain.status !== 0) {
		return {
			committed: false,
			error: `git status failed: ${porcelain.stderr}`,
		};
	}
	if (porcelain.stdout.trim().length === 0) {
		return { committed: false };
	}
	const addRes = spawnSync("git", ["add", "-A"], {
		cwd: opts.cwd,
		encoding: "utf-8",
	});
	if (addRes.status !== 0) {
		return { committed: false, error: `git add failed: ${addRes.stderr}` };
	}
	const firstLine = (opts.message || "work").split("\n")[0]!.trim();
	const clipped =
		firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
	const subject = `${opts.agent}: ${clipped}`;
	const commitRes = spawnSync(
		"git",
		[
			"commit",
			"-m",
			subject,
			"--trailer",
			`Co-Authored-By: ${opts.agent} <${opts.agent}@seshat.local>`,
			"--trailer",
			`Spec-Slice: ${opts.sliceId}`,
			"--trailer",
			`Peer: ${opts.agent}`,
			"--trailer",
			`Session: ${opts.sessionId}`,
		],
		{ cwd: opts.cwd, encoding: "utf-8" },
	);
	if (commitRes.status !== 0) {
		return {
			committed: false,
			error: `git commit failed: ${commitRes.stderr}`,
		};
	}
	return { committed: true };
}

/**
 * Pull a commit-subject summary out of a tool-result content array.
 * Adapted from .pi/extensions/specsafe-subagents/index.ts:112-132 — the
 * vanilla version walked Pi `Message[]` looking for the last assistant text;
 * here we consume the `tool_result` content array directly.
 */
function summarizeForCommit(
	content: ReadonlyArray<{ type: string; text?: string }>,
): string {
	for (let i = content.length - 1; i >= 0; i--) {
		const part = content[i];
		if (
			part?.type === "text" &&
			typeof part.text === "string" &&
			part.text.trim()
		) {
			return (
				(part.text.trim().split("\n")[0] ?? "").slice(0, 160) ||
				"work in progress"
			);
		}
	}
	return "work in progress";
}

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------

export default function (pi: HookAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		// Only Oh My Pi's bundled `task` tool dispatches subagents.
		if (event.toolName !== "task") return;
		// Honor the runAgent guard: never commit on subagent failure.
		if (event.isError === true) return;

		const state = readSpecsafeState(ctx.cwd);
		const slice = state?.currentSlice;
		if (!slice) return;

		// `task` tool input shape (see @oh-my-pi/pi-coding-agent task/types.ts):
		//   { agent: string; tasks: TaskItem[]; ... }
		const agentName =
			typeof (event.input as { agent?: unknown })?.agent === "string"
				? (event.input as { agent: string }).agent
				: "subagent";

		try {
			const result = commitSubagentWork({
				cwd: ctx.cwd,
				agent: agentName,
				sliceId: slice.id,
				sessionId: slice.sessionId,
				message: summarizeForCommit(
					event.content as ReadonlyArray<{ type: string; text?: string }>,
				),
			});
			if (result.committed && ctx.hasUI) {
				ctx.ui.notify(`auto-commit: ${agentName} on slice ${slice.id}`, "info");
			}
			if (result.error) {
				pi.logger.warn(
					`[specsafe-subagents] auto-commit error: ${result.error}`,
				);
			}
		} catch (err) {
			pi.logger.error(
				`[specsafe-subagents] auto-commit threw: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	});
}

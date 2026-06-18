/**
 * Todo continuation enforcer hook (OMP port of OMO's todo-continuation-enforcer).
 *
 * OMO yanks an idle OpenCode agent back to work when its todo list still has
 * incomplete tasks. OMP exposes the right primitive directly: the `session_stop`
 * event fires on the MAIN session just before it settles and may return
 * `{ continue: true, additionalContext }` to keep the agent going. The runtime
 * caps this at 8 consecutive continuations and never fires it for task/subagent
 * sessions, so we get loop-safety and subagent-immunity for free.
 *
 * Todo state is read the documented way: every successful `todo` tool result
 * carries `details.phases` (TodoPhase[]), so we mirror the latest snapshot from
 * `tool_result` events and consult it on `session_stop`.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const HOOK_NAME = "todo-enforcer";

/** Statuses that count as "closed" and need no continuation. */
const TERMINAL_STATUSES: Record<string, true> = {
	completed: true,
	abandoned: true,
};

/**
 * If the remaining count stops dropping across continuations, the agent is
 * stuck — stop nagging after this many stagnant stops so we don't burn the
 * runtime's continuation budget on a wedged run.
 */
const MAX_STAGNANT_CONTINUATIONS = 3;

interface TodoItem {
	content: string;
	status: string;
}
interface TodoPhase {
	name: string;
	tasks: TodoItem[];
}

const CONTINUATION_HEADER = `<system-directive type="todo-continuation">
You are about to stop, but the todo list still has incomplete tasks. Do NOT stop here.
Resume work and drive the remaining tasks to completion, marking each task done the
moment it is finished. Stop only when every task is completed or explicitly abandoned.
If a task is genuinely blocked, mark it abandoned (with the reason) rather than leaving
it pending.
</system-directive>`;

export function registerTodoEnforcer(pi: ExtensionAPI): void {
	let latestPhases: TodoPhase[] | null = null;
	let lastIncomplete = -1;
	let stagnant = 0;

	const reset = (): void => {
		latestPhases = null;
		lastIncomplete = -1;
		stagnant = 0;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);
	pi.on("session_branch", reset);

	// Mirror the latest todo snapshot as the agent mutates it. `details.phases`
	// is the documented shape of a successful `todo` tool result.
	pi.on("tool_result", (event) => {
		if (event.toolName !== "todo" || event.isError) return;
		const phases = (event.details as { phases?: TodoPhase[] } | undefined)
			?.phases;
		if (Array.isArray(phases)) latestPhases = phases;
	});

	pi.on("session_stop", () => {
		if (!latestPhases) return;

		const all = latestPhases.flatMap((p) => p.tasks);
		const incomplete = all.filter((t) => !TERMINAL_STATUSES[t.status]);
		if (incomplete.length === 0) return;

		// Stagnation guard: if we're not making progress, give up gracefully.
		if (lastIncomplete !== -1 && incomplete.length >= lastIncomplete) {
			stagnant += 1;
			if (stagnant >= MAX_STAGNANT_CONTINUATIONS) {
				pi.logger.info(
					`[${HOOK_NAME}] ${incomplete.length} todos still open but no progress across ${stagnant} stops — letting the session settle.`,
				);
				return;
			}
		} else {
			stagnant = 0;
		}
		lastIncomplete = incomplete.length;

		const list = incomplete
			.map((t) => `- [${t.status}] ${t.content}`)
			.join("\n");
		const done = all.length - incomplete.length;

		pi.logger.debug(
			`[${HOOK_NAME}] continuing: ${incomplete.length} todos open`,
		);

		return {
			continue: true,
			additionalContext: `${CONTINUATION_HEADER}

[Progress: ${done}/${all.length} done, ${incomplete.length} remaining]

Remaining tasks:
${list}`,
		};
	});
}

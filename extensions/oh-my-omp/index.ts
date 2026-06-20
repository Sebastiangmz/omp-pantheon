/**
 * oh-my-omp — port of oh-my-openagent (OMO) to oh-my-pi (OMP).
 *
 * Responsibilities:
 *   - Advertise the bundled skills directory via `resources_discover`.
 *   - Register the loop runtime (ralph / ulw) and hook it to `agent_end`,
 *     plus the loop control commands (`/ralph-loop`, `/ulw-loop`,
 *     `/cancel-ralph`, `/stop-continuation`).
 *   - Register the lifecycle hooks: `todo-enforcer` (session_stop
 *     continuation), `evalfly-advisor` (opt-in non-blocking evidence reminder),
 *     `comment-checker` (tool_result on edit/write), `intent-gate`
 *     (before_agent_start directive).
 *   - Markdown slash commands (/ulw, /ultrawork, /init-deep, /refactor,
 *     /handoff, /start-work, /remove-ai-slops, /omomomo), agents, and
 *     skills ship as plain files discovered by OMP; nothing to wire here.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { registerEvalFlyAdvisor } from "./hooks/evalfly-advisor";
import { registerCommentChecker } from "./hooks/comment-checker";
import { registerIntentGate } from "./hooks/intent-gate";
import { registerTodoEnforcer } from "./hooks/todo-enforcer";
import { registerLoopCommands } from "./loop/commands";
import { LoopRuntime } from "./loop/runtime";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, "../../skills");
const VERSION = "0.2.0";

export default async function (pi: ExtensionAPI): Promise<void> {
	// Advertise our bundled skill bundle. OMP normally only scans
	// ~/.omp/agent/skills/, but doing this through the event keeps the
	// extension self-contained and forward-compatible if the layout ever
	// changes.
	pi.on("resources_discover", () => ({
		skillPaths: [SKILLS_DIR],
	}));

	pi.on("session_start", () => {
		pi.logger.debug("oh-my-omp loaded", {
			version: VERSION,
			skills: SKILLS_DIR,
		});
	});

	// Loop runtime: state-machine driven by `agent_end`.
	const runtime = new LoopRuntime(pi);
	pi.on("session_start", (_event, ctx) => runtime.attach(ctx));
	pi.on("session_switch", (_event, ctx) => runtime.attach(ctx));
	pi.on("session_branch", (_event, ctx) => runtime.attach(ctx));
	pi.on("agent_end", (event, ctx) => runtime.onAgentEnd(event, ctx));

	registerLoopCommands(pi, runtime);

	// Lifecycle hooks: advisory context plus discipline enforcement.
	registerEvalFlyAdvisor(pi);
	registerTodoEnforcer(pi);
	registerCommentChecker(pi);
	registerIntentGate(pi);
}

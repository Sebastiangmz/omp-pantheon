/**
 * oh-my-omp — port of oh-my-openagent (OMO) to oh-my-pi (OMP).
 *
 * Iteration 1 responsibilities:
 *   - Advertise the bundled skills directory via `resources_discover`.
 *   - Register the loop runtime (ralph / ulw) and hook it to `agent_end`.
 *   - Provide the loop control commands (`/ralph-loop`, `/ulw-loop`,
 *     `/cancel-ralph`, `/stop-continuation`).
 *   - Markdown slash commands (/ulw, /ultrawork, /init-deep, /refactor,
 *     /handoff, /start-work, /remove-ai-slops, /omomomo) ship as plain
 *     `.md` drops alongside this extension; nothing for the runtime to do.
 *
 * Hooks (`todo-enforcer`, `comment-checker`, `intent-gate`) and the rest
 * of the agent / skill bodies land in iterations 2-4. See README.md.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { LoopRuntime } from "./loop/runtime";
import { registerLoopCommands } from "./loop/commands";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(HERE, "../../skills");
const VERSION = "0.1.0";

export default async function (pi: ExtensionAPI): Promise<void> {
	// Advertise our bundled skill bundle. OMP normally only scans
	// ~/.omp/agent/skills/, but doing this through the event keeps the
	// extension self-contained and forward-compatible if the layout ever
	// changes.
	pi.on("resources_discover", () => ({
		skillPaths: [SKILLS_DIR],
	}));

	pi.on("session_start", () => {
		pi.logger.debug("oh-my-omp loaded", { version: VERSION, skills: SKILLS_DIR });
	});

	// Loop runtime: state-machine driven by `agent_end`.
	const runtime = new LoopRuntime(pi);
	pi.on("session_start", (_event, ctx) => runtime.attach(ctx));
	pi.on("session_switch", (_event, ctx) => runtime.attach(ctx));
	pi.on("session_branch", (_event, ctx) => runtime.attach(ctx));
	pi.on("agent_end", (event, ctx) => runtime.onAgentEnd(event, ctx));

	registerLoopCommands(pi, runtime);
}

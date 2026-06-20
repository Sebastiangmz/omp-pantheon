import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const HOOK_NAME = "evalfly-advisor";
const FLAG_FILE = join(".pi", "evalfly", "hints-enabled");
const CONFIG_FILE = join("evals", "config.json");

const ADVISORY_CONTEXT = `<system-directive type="evalfly-advisor">
EvalFly evidence is opt-in. This project has enabled EvalFly hints and contains evals/config.json.
Before stopping, if this work changed agent behavior, skills, commands, schemas, hooks, or other workflow-critical behavior, make sure the final answer cites the relevant EvalFly report path/run id or states why EvalFly is not applicable.
Do not claim hook or CI enforcement; this reminder is advisory only and must not block completion.
</system-directive>`;

export function evalFlyHintsEnabled(cwd: string): boolean {
	return existsSync(join(cwd, FLAG_FILE)) && existsSync(join(cwd, CONFIG_FILE));
}

export function buildEvalFlyAdvisoryContext(cwd: string): string | undefined {
	return evalFlyHintsEnabled(cwd) ? ADVISORY_CONTEXT : undefined;
}

export function registerEvalFlyAdvisor(pi: ExtensionAPI): void {
	pi.on("session_stop", (_event, ctx) => {
		const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
		if (!cwd) return;
		const additionalContext = buildEvalFlyAdvisoryContext(cwd);
		if (!additionalContext) return;
		pi.logger.debug(`[${HOOK_NAME}] adding non-blocking EvalFly advisory`);
		return { additionalContext };
	});
}

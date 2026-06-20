import { lstatSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const HOOK_NAME = "evalfly-advisor";
const FLAG_FILE = join(".pi", "evalfly", "hints-enabled");
const CONFIG_FILE = join("evals", "config.json");

const ADVISORY_CONTEXT = `<system-directive type="evalfly-advisor">
EvalFly evidence is opt-in. This project has enabled EvalFly hints and contains evals/config.json.
If this work changes agent behavior, skills, commands, schemas, hooks, or other workflow-critical behavior, make sure the final answer cites the relevant EvalFly report path/run id or states why EvalFly is not applicable.
Do not claim hook or CI enforcement; this reminder is advisory only and must not block completion.
</system-directive>`;

function isRegularFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

export function evalFlyHintsEnabled(cwd: string): boolean {
	return (
		isRegularFile(join(cwd, FLAG_FILE)) && isRegularFile(join(cwd, CONFIG_FILE))
	);
}

export function buildEvalFlyAdvisoryContext(cwd: string): string | undefined {
	return evalFlyHintsEnabled(cwd) ? ADVISORY_CONTEXT : undefined;
}

export function registerEvalFlyAdvisor(pi: ExtensionAPI): void {
	let injectedThisSession = false;

	const reset = (): void => {
		injectedThisSession = false;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);
	pi.on("session_branch", reset);

	pi.on("before_agent_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (injectedThisSession) return;
		const content = buildEvalFlyAdvisoryContext(ctx.cwd);
		if (!content) return;
		injectedThisSession = true;
		pi.logger.debug(`[${HOOK_NAME}] injecting opt-in EvalFly advisory`);
		return {
			message: {
				customType: HOOK_NAME,
				content,
				display: false,
				details: "Injected by oh-my-omp evalfly-advisor (opt-in)",
				attribution: "user",
			},
		};
	});
}

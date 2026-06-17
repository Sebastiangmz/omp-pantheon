/**
 * Intent gate hook (OMP port of OMO's IntentGate concept).
 *
 * OMO analyzes the user's true intent before the agent classifies or acts.
 * There is no standalone upstream hook — the behavior lives in the Sisyphus
 * Phase 0 "Intent Gate". This hook injects a concise intent-verbalization
 * directive on the first agent turn of a session via `before_agent_start`,
 * whose documented return shape is `{ message: { customType, content, … } }`.
 *
 * Fires once per session; the flag resets on session lifecycle changes.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const HOOK_NAME = "intent-gate";

const INTENT_DIRECTIVE = `<system-directive type="intent-gate">
Before acting on this request, map the surface form to the user's true intent, then state your routing out loud:

- "explain / how does X work" → Research → investigate, then answer (no edits)
- "implement / add / create X" → Implementation (explicit) → plan, then build
- "look into / check / investigate X" → Investigation → report findings
- "what do you think about X?" → Evaluation → propose, then WAIT for confirmation
- "error X / Y is broken" → Fix → diagnose, then fix minimally
- "refactor / improve / clean up" → Open-ended → assess the codebase first

Verbalize: "I detect [type] intent — [reason]. My approach: [plan]."
Only then proceed. This prevents premature implementation of requests that actually need investigation, evaluation, or clarification first.
</system-directive>`;

export function registerIntentGate(pi: ExtensionAPI): void {
	let injectedThisSession = false;

	const reset = (): void => {
		injectedThisSession = false;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);
	pi.on("session_branch", reset);

	pi.on("before_agent_start", () => {
		if (injectedThisSession) return;
		injectedThisSession = true;

		pi.logger.debug(`[${HOOK_NAME}] injecting intent-verbalization directive`);

		return {
			message: {
				customType: HOOK_NAME,
				content: INTENT_DIRECTIVE,
				display: false,
				details: "Injected by oh-my-omp intent-gate (first turn of session)",
				attribution: "user",
			},
		};
	});
}

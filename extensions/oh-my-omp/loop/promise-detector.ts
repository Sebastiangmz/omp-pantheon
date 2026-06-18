/**
 * Detects the `<promise>...</promise>` completion tag in an assistant message.
 *
 * The agent signals it believes the task is done by emitting:
 *
 *     <promise>DONE</promise>
 *
 * The token is configurable per-loop (default "DONE"). Match is
 * case-insensitive and tolerant of leading/trailing whitespace inside the tag.
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";

const PROMISE_RE = /<promise>\s*([^<\s][^<]*?)\s*<\/promise>/i;

/**
 * Extract the promise token from an assistant message.
 * Returns the matched token (verbatim from the message) or null.
 */
export function extractPromiseTag(
	message: AgentMessage | undefined,
): string | null {
	if (!message || message.role !== "assistant") return null;
	const text = collectAssistantText(message);
	if (!text) return null;
	const m = text.match(PROMISE_RE);
	return m ? m[1] : null;
}

/**
 * True iff the most recent assistant message contains a promise tag whose
 * token matches `expected` (case-insensitive).
 */
export function detectPromise(
	messages: AgentMessage[],
	expected: string,
): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		const tag = extractPromiseTag(msg);
		if (tag === null) return false;
		return tag.toLowerCase() === expected.toLowerCase();
	}
	return false;
}

function collectAssistantText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (
					part &&
					typeof part === "object" &&
					"text" in part &&
					typeof (part as { text?: unknown }).text === "string"
				) {
					return (part as { text: string }).text;
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

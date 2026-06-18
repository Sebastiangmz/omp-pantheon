import type { HookAPI } from "./types";

const MUTATION_PATTERNS = [
	/^\s*git\s+push\b/,
	/^\s*gh\s+(pr|repo|issue|api|release|workflow|run|gist|secret|variable)\s+(create|edit|merge|comment|delete|close|reopen|add|set|put|post|patch)\b/,
	/^\s*linear-cli\b/,
	/^\s*bmad-doc\s+apply\b/,
	/^\s*npm\s+publish\b/,
	/^\s*bun\s+publish\b/,
];

const TOKEN = "--i-approve";

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) =>
			c &&
			typeof c === "object" &&
			"type" in c &&
			c.type === "text" &&
			"text" in c
				? String(c.text)
				: "",
		)
		.join("\n");
}

function lastUserMessageText(entries: readonly unknown[]): string {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i] as {
			type?: string;
			message?: { role?: string; content?: unknown };
		};
		if (e?.type === "message" && e.message?.role === "user") {
			return extractText(e.message.content);
		}
	}
	return "";
}

export default function (pi: HookAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = String(
			(event.input as { command?: unknown })?.command ?? "",
		);
		if (!MUTATION_PATTERNS.some((p) => p.test(command))) return undefined;

		const userText = lastUserMessageText(
			ctx.sessionManager.getEntries() as unknown[],
		);
		if (userText.includes(TOKEN)) return undefined;

		return {
			block: true,
			reason: `Mutation requires --i-approve token in the latest user message. Command: ${command.slice(0, 80)}`,
		};
	});
}

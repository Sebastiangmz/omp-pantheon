import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HookAPI } from "./types";

const LOG_PATH = join(homedir(), ".omp", "agent", ".fallback-log.jsonl");

const SECRET_PATTERNS = [
	/sk-[a-zA-Z0-9_-]{20,}/g,
	/Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
	/(api[_-]?key|token|secret|password)["'\s:=]+[a-zA-Z0-9._-]{16,}/gi,
];

function redact(text: string): string {
	let out = text;
	for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
	return out;
}

async function append(line: Record<string, unknown>): Promise<void> {
	try {
		await mkdir(dirname(LOG_PATH), { recursive: true });
		await appendFile(LOG_PATH, `${JSON.stringify(line)}\n`, { mode: 0o600 });
	} catch {
		// Audit-log failure must not break the agent loop.
	}
}

export default function (pi: HookAPI): void {
	pi.on("auto_retry_start", async (event, ctx) => {
		await append({
			ts: new Date().toISOString(),
			event: "retry_start",
			session: ctx.sessionManager.getSessionId(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
			attempt: event.attempt,
			maxAttempts: event.maxAttempts,
			delayMs: event.delayMs,
			error: redact(event.errorMessage ?? ""),
		});
	});

	pi.on("auto_retry_end", async (event, ctx) => {
		await append({
			ts: new Date().toISOString(),
			event: "retry_end",
			session: ctx.sessionManager.getSessionId(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
			attempt: event.attempt,
			success: event.success,
			finalError: event.finalError ? redact(event.finalError) : undefined,
		});
	});
}

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import { readEvalFlyEnforcementState } from "../../../skills/evalfly/bin/enforcement-state.ts";

const MAX_BUFFER_EVENTS = 1000;
const TRACE_TEXT_MAX_LENGTH = 4096;
const TEXT_FIELDS = new Set([
	"type",
	"timestamp",
	"agent",
	"model",
	"role",
	"tool_name",
	"status",
	"verdict",
	"sanitized_input",
	"sanitized_output",
]);
const NUMBER_FIELDS = new Set(["latency_ms", "cost_usd"]);
const buffers = new Map<string, Record<string, unknown>[]>();

type HookContext = { cwd?: string };
type ToolResultEvent = {
	toolName?: string;
	isError?: boolean;
	details?: unknown;
};
type AgentEndEvent = {
	agent?: string;
	model?: string;
	status?: string;
	verdict?: string;
	latency_ms?: number;
	cost_usd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyTraceText(value: string): string {
	if (value.length <= TRACE_TEXT_MAX_LENGTH) return value;
	return `${value.slice(0, TRACE_TEXT_MAX_LENGTH)}...[truncated]`;
}

export function sanitizeEvalFlyTraceEvent(
	event: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (TEXT_FIELDS.has(key) && typeof value === "string") {
			out[key] = copyTraceText(value);
		}
		if (
			NUMBER_FIELDS.has(key) &&
			typeof value === "number" &&
			Number.isFinite(value) &&
			value >= 0
		) {
			out[key] = value;
		}
	}
	return out;
}

export function appendEvalFlyTraceEvent(
	cwd: string,
	event: Record<string, unknown>,
): void {
	try {
		if (readEvalFlyEnforcementState(cwd).mode !== "enforced") {
			clearEvalFlyTraceBuffer(cwd);
			return;
		}
	} catch {
		clearEvalFlyTraceBuffer(cwd);
		return;
	}
	const existing = buffers.get(cwd) ?? [];
	const next = [...existing, sanitizeEvalFlyTraceEvent(event)].slice(
		-MAX_BUFFER_EVENTS,
	);
	buffers.set(cwd, next);
}

export function readEvalFlyTraceBuffer(cwd: string): Record<string, unknown>[] {
	return (buffers.get(cwd) ?? []).map((event) =>
		sanitizeEvalFlyTraceEvent(event),
	);
}

export function clearEvalFlyTraceBuffer(cwd: string): void {
	buffers.delete(cwd);
}

function appendToolResult(cwd: string, event: ToolResultEvent): void {
	const traceEvent: Record<string, unknown> = {
		type: "tool_result",
		tool_name: event.toolName ?? "unknown",
		status: event.isError ? "error" : "ok",
	};
	if (isRecord(event.details)) {
		if (typeof event.details.sanitized_input === "string") {
			traceEvent.sanitized_input = event.details.sanitized_input;
		}
		if (typeof event.details.sanitized_output === "string") {
			traceEvent.sanitized_output = event.details.sanitized_output;
		}
		if (typeof event.details.latency_ms === "number") {
			traceEvent.latency_ms = event.details.latency_ms;
		}
		if (typeof event.details.cost_usd === "number") {
			traceEvent.cost_usd = event.details.cost_usd;
		}
	}
	appendEvalFlyTraceEvent(cwd, traceEvent);
}

function appendAgentEnd(cwd: string, event: AgentEndEvent): void {
	appendEvalFlyTraceEvent(cwd, {
		type: "agent_end",
		...(event.agent ? { agent: event.agent } : {}),
		...(event.model ? { model: event.model } : {}),
		...(event.status ? { status: event.status } : {}),
		...(event.verdict ? { verdict: event.verdict } : {}),
		...(typeof event.latency_ms === "number"
			? { latency_ms: event.latency_ms }
			: {}),
		...(typeof event.cost_usd === "number" ? { cost_usd: event.cost_usd } : {}),
	});
}

export function registerEvalFlyTraceCapture(pi: ExtensionAPI): void {
	const clear = (_event?: unknown, ctx?: HookContext): void => {
		if (ctx?.cwd) clearEvalFlyTraceBuffer(ctx.cwd);
	};
	pi.on("session_start", clear);
	pi.on("session_switch", clear);
	pi.on("session_branch", clear);
	pi.on("tool_result", (event, ctx) => {
		const cwd = (ctx as HookContext | undefined)?.cwd;
		if (!cwd) return;
		appendToolResult(cwd, event as ToolResultEvent);
	});
	pi.on("agent_end", (event, ctx) => {
		const cwd = (ctx as HookContext | undefined)?.cwd;
		if (!cwd) return;
		appendAgentEnd(cwd, event as AgentEndEvent);
	});
}

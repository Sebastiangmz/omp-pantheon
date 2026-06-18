/**
 * Honcho memory bridge — Oh My Pi port of pi-seshat's honcho extension.
 *
 * Source lineage: pi-seshat Honcho extension.
 * SpecSafe slice: SPEC-20260424-001 — pi-honcho-bridge-v1
 * Identity model updated: SPEC-20260426-008.1 — persona-prompt-identity
 *
 * Faithful port of the four tools (honcho_recall, honcho_search,
 * honcho_remember, honcho_conclude) onto the Oh My Pi `CustomToolFactory`
 * surface. Behavioral invariants preserved:
 *   - Allowlist on honcho_conclude: only validator/reviewer/steward Gholas
 *     may write durable conclusions.
 *   - Steward conclusions must be prefixed with "product:" (engineering
 *     dialect separator).
 *   - HONCHO_API_KEY is sanitized out of any error text before display.
 *
 * Identity model (SPEC-008.1). This bridge uses a MODEL-TRUSTED allowlist.
 * Each Ghola's persona prompt instructs the model to declare its peer identity
 * via the `as_peer` parameter on every Honcho-write call. The tool validates
 * the declared identity against CONCLUSION_WRITERS, but cannot cryptographically
 * verify it — a misbehaving model can lie about `as_peer` and bypass the gate.
 * This trade-off is accepted explicitly; see SPEC-008.1 §3.1 (a)/(b)/(c) for
 * the primary-source analysis of why process-trusted enforcement is infeasible
 * in @oh-my-pi/pi-coding-agent v14.4.0 (no per-agent identity field on
 * CustomToolContext, no subagent_start hook, no safe per-spawn env-injection
 * seam for concurrent dispatches). Defense-in-depth: the Steward product: prefix
 * is an independent content-shape invariant; reviewer audit is the second line.
 * Follow-up trigger: if upstream adds ctx.activeAgent?.name or a subagent_start
 * hook event with agentName, switch to that as a hard cross-check against as_peer.
 *
 * OMP's `CustomToolContext` does not expose per-call agent identity.
 * We optionally hydrate missing env vars from ~/.omp/agent/honcho.json on
 * first use; the file shape matches the pi-seshat ~/.pi/agent/honcho.json
 * and the two MAY be symlinked together.
 *
 * Cost-counter integration. The original extension bumps a per-slice
 * Honcho-call counter on the SpecSafe state file at
 * `<cwd>/.pi/.honcho-state.json`. Until the SpecSafe-session extension
 * is itself ported under `.omp/`, we keep writing to the same `.pi`
 * path so dual-installs stay accurate; the operation is best-effort and
 * never blocks a tool call.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentToolResult,
	CustomTool,
	CustomToolContext,
	CustomToolFactory,
} from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Policy surface — exported for the unit tests.
// ---------------------------------------------------------------------------

export const CONCLUSION_WRITERS: ReadonlySet<string> = new Set([
	"validator",
	"reviewer",
	"steward",
]);

export function isConclusionWriter(peer: string): boolean {
	return CONCLUSION_WRITERS.has(peer);
}

export function sanitizeErrorForDisplay(text: string, apiKey: string): string {
	if (!apiKey) return text;
	if (!text.includes(apiKey)) return text;
	return text.split(apiKey).join("<redacted>");
}

// ---------------------------------------------------------------------------
// Env + cost-counter plumbing.
// ---------------------------------------------------------------------------

export type HonchoToolRuntimeEnv = {
	HONCHO_API_KEY?: string;
	HONCHO_WORKSPACE_ID?: string;
	HONCHO_SESSION_ID?: string;
	HONCHO_PEER_ID?: string;
	HONCHO_BASE_URL?: string;
};

const REQUIRED_VARS = [
	"HONCHO_API_KEY",
	"HONCHO_WORKSPACE_ID",
	"HONCHO_SESSION_ID",
	"HONCHO_PEER_ID",
] as const;

function checkRequired(env: HonchoToolRuntimeEnv): string | null {
	const missing = REQUIRED_VARS.filter((k) => !env[k]);
	if (missing.length === 0) return null;
	return `Missing required Honcho env vars: ${missing.join(", ")}`;
}

/**
 * Hydrate missing fields on `env` from ~/.omp/agent/honcho.json.
 * The file shape is identical to ~/.pi/agent/honcho.json and the two
 * MAY be symlinked.
 */
function hydrateFromConfigFile(
	env: HonchoToolRuntimeEnv,
): HonchoToolRuntimeEnv {
	try {
		const cfgPath = path.join(os.homedir(), ".omp", "agent", "honcho.json");
		if (!fs.existsSync(cfgPath)) return env;
		const raw = fs.readFileSync(cfgPath, "utf-8");
		const cfg = JSON.parse(raw) as Partial<
			Record<keyof HonchoToolRuntimeEnv, string>
		>;
		const merged: HonchoToolRuntimeEnv = { ...env };
		for (const k of [
			"HONCHO_API_KEY",
			"HONCHO_WORKSPACE_ID",
			"HONCHO_SESSION_ID",
			"HONCHO_PEER_ID",
			"HONCHO_BASE_URL",
		] as const) {
			if (!merged[k] && cfg[k]) merged[k] = cfg[k];
		}
		return merged;
	} catch {
		// Config-file hydration is best effort; never block on it.
		return env;
	}
}

function statePathFor(cwd: string): string {
	// Mirrors .pi/extensions/specsafe-session/index.ts::statePathFor.
	return path.join(cwd, ".pi", ".honcho-state.json");
}

function bumpHonchoCallCounter(cwd: string): void {
	const sp = statePathFor(cwd);
	try {
		if (!fs.existsSync(sp)) return;
		const raw = fs.readFileSync(sp, "utf-8");
		const state = JSON.parse(raw);
		if (state?.currentSlice?.costCounter) {
			state.currentSlice.costCounter.honchoCalls =
				(state.currentSlice.costCounter.honchoCalls ?? 0) + 1;
			fs.writeFileSync(sp, JSON.stringify(state, null, 2), { mode: 0o600 });
		}
	} catch {
		// Cost counter is advisory. Never block a tool call on counter failures.
	}
}

// ---------------------------------------------------------------------------
// Test seams + tool result shape.
// ---------------------------------------------------------------------------

type BuildOpts = {
	getEnv: () => HonchoToolRuntimeEnv;
	/** Test-only: resolves a stubbed conclusion id without hitting the network. */
	__fakeConcludeResult?: { id: string };
};

// Loose shape used in tests — matches AgentToolResult<unknown> structurally.
type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
};

function errText(text: string, details?: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: "text", text }],
		details: details ?? {},
		isError: true,
	};
}

function okText(text: string, details?: Record<string, unknown>): ToolResult {
	return { content: [{ type: "text", text }], details: details ?? {} };
}

type HonchoConstructor = new (opts: {
	apiKey: string;
	workspaceId: string;
	baseURL?: string;
}) => {
	peer(id: string): Promise<any>;
	session(id: string): Promise<any>;
};

let honchoConstructorPromise: Promise<HonchoConstructor> | null = null;

function findNodeModulePath(...segments: string[]): string {
	let dir = import.meta.dir;
	for (;;) {
		const candidate = path.join(dir, "node_modules", ...segments);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir)
			return path.resolve(
				import.meta.dir,
				"..",
				"..",
				"node_modules",
				...segments,
			);
		dir = parent;
	}
}

async function loadHonchoConstructor(): Promise<HonchoConstructor> {
	if (!honchoConstructorPromise) {
		const sdkPath = findNodeModulePath("@honcho-ai", "sdk", "dist", "index.js");
		honchoConstructorPromise = import(pathToFileURL(sdkPath).href).then(
			(mod) => {
				const ctor =
					(
						mod as {
							Honcho?: HonchoConstructor;
							default?: { Honcho?: HonchoConstructor };
						}
					).Honcho ?? mod.default?.Honcho;
				if (!ctor)
					throw new Error(`Honcho SDK did not export Honcho from ${sdkPath}`);
				return ctor;
			},
		);
	}
	return honchoConstructorPromise;
}

async function makeClient(env: HonchoToolRuntimeEnv) {
	const Honcho = await loadHonchoConstructor();
	return new Honcho({
		apiKey: env.HONCHO_API_KEY!,
		workspaceId: env.HONCHO_WORKSPACE_ID!,
		...(env.HONCHO_BASE_URL ? { baseURL: env.HONCHO_BASE_URL } : {}),
	});
}

// ---------------------------------------------------------------------------
// Pure factory used by the test suite. Independent of OMP's pi.typebox so
// tests can construct tools without the OMP runtime present.
// ---------------------------------------------------------------------------

export function buildHonchoTools(opts: BuildOpts) {
	const cwd = process.cwd();

	async function guarded<T>(fn: () => Promise<T>): Promise<T | ToolResult> {
		const env = hydrateFromConfigFile(opts.getEnv());
		const missing = checkRequired(env);
		if (missing) return errText(missing);
		try {
			const result = await fn();
			bumpHonchoCallCounter(cwd);
			return result;
		} catch (err: unknown) {
			const apiKey = env.HONCHO_API_KEY ?? "";
			const raw = err instanceof Error ? err.message : String(err);
			return errText(sanitizeErrorForDisplay(`honcho error: ${raw}`, apiKey));
		}
	}

	const honcho_recall = {
		label: "Honcho Recall",
		description:
			"Ask Honcho a natural-language question about what's known in the current session (default) or about another peer. Uses dialectic chat.",
		// Test-callable execute. Signature accepts the OMP positional set
		// (toolCallId, params, onUpdate, ctx, signal) but the test suite calls
		// with the legacy (id, params, signal, onUpdate, ctx) ordering. To stay
		// faithful to the source tests we expose the legacy ordering here and
		// adapt to OMP at register time below.
		async execute(
			_id: string,
			params: { query: string; target?: string; scope?: "session" | "peer" },
			_sig: AbortSignal,
			_upd: unknown,
			_ctx: { cwd: string },
		): Promise<ToolResult> {
			return guarded(async () => {
				const env = hydrateFromConfigFile(opts.getEnv());
				const client = await makeClient(env);
				const peer = await client.peer(env.HONCHO_PEER_ID!);
				const scope = params.scope ?? "session";
				const chatOptions: Record<string, unknown> = {};
				if (scope === "session") chatOptions.sessionId = env.HONCHO_SESSION_ID;
				if (params.target) chatOptions.target = params.target;
				const response = await peer.chat(params.query, chatOptions);
				const textOut =
					typeof response === "string" ? response : JSON.stringify(response);
				return okText(textOut, { response });
			}) as Promise<ToolResult>;
		},
	};

	const honcho_search = {
		label: "Honcho Search",
		description:
			"Hybrid semantic+text search. Default scope is the current session.",
		async execute(
			_id: string,
			params: {
				query: string;
				scope?: "session" | "peer" | "workspace";
				limit?: number;
			},
			_sig: AbortSignal,
			_upd: unknown,
			_ctx: { cwd: string },
		): Promise<ToolResult> {
			return guarded(async () => {
				const env = hydrateFromConfigFile(opts.getEnv());
				const client = await makeClient(env);
				const scope = params.scope ?? "session";
				let page: unknown;
				if (scope === "session") {
					const session = await client.session(env.HONCHO_SESSION_ID!);
					page = await session.search(params.query);
				} else if (scope === "peer") {
					const peer = await client.peer(env.HONCHO_PEER_ID!);
					page = await peer.search(params.query);
				} else {
					return errText(
						"workspace-scope search is not yet wired; use 'session' or 'peer'",
					);
				}
				const hits: Array<Record<string, unknown>> = [];
				const iterable =
					page && typeof (page as any)[Symbol.asyncIterator] === "function"
						? (page as AsyncIterable<unknown>)
						: null;
				if (iterable) {
					let n = 0;
					const limit = params.limit ?? 10;
					for await (const m of iterable) {
						const mm = m as Record<string, unknown>;
						hits.push({
							content: mm.content,
							peerId: mm.peerId ?? mm.peer_id,
							createdAt: mm.createdAt ?? mm.created_at,
						});
						if (++n >= limit) break;
					}
				} else if (Array.isArray(page)) {
					hits.push(
						...(page as Array<Record<string, unknown>>).slice(
							0,
							params.limit ?? 10,
						),
					);
				}
				const summary = hits.length
					? hits.map((h) => `- ${String(h.content).slice(0, 160)}`).join("\n")
					: "(no matches)";
				return okText(summary, { hits });
			}) as Promise<ToolResult>;
		},
	};

	const honcho_remember = {
		label: "Honcho Remember",
		description:
			"Record a message in the current session under the current peer identity.",
		async execute(
			_id: string,
			params: {
				content: string;
				role?: "assistant" | "user";
				as_peer?: string;
			},
			_sig: AbortSignal,
			_upd: unknown,
			_ctx: { cwd: string },
		): Promise<ToolResult> {
			return guarded(async () => {
				const env = hydrateFromConfigFile(opts.getEnv());
				// SPEC-008.1: as_peer is optional for honcho_remember. If supplied, use
				// the declared identity; otherwise fall back to env-derived HONCHO_PEER_ID.
				const effectivePeer = params.as_peer ?? env.HONCHO_PEER_ID!;
				const client = await makeClient(env);
				const peer = await client.peer(effectivePeer);
				const session = await client.session(env.HONCHO_SESSION_ID!);
				// Honcho SDK accepts a heterogeneous message-builder array; cast
				// is local to this call and matches the source extension.
				const messages = await session.addMessages([
					peer.message(params.content),
				] as any);
				const messageId =
					Array.isArray(messages) && messages[0]
						? (messages[0] as any).id
						: undefined;
				return okText("remembered", { messageId });
			}) as Promise<ToolResult>;
		},
	};

	const honcho_conclude = {
		label: "Honcho Conclude",
		description:
			"Write a durable conclusion about the current peer. Restricted to validator/reviewer/steward peers.",
		async execute(
			_id: string,
			params: { content: string; as_peer?: string },
			_sig: AbortSignal,
			_upd: unknown,
			_ctx: { cwd: string },
		): Promise<ToolResult> {
			// SPEC-008.1 §3.2: validation order is exact — as_peer checks run BEFORE
			// env checks so that a missing as_peer is rejected even when env is incomplete.

			// Step 1: as_peer is REQUIRED for honcho_conclude. No env fallback.
			if (!params.as_peer || params.as_peer.length === 0) {
				return errText(
					`as_peer is required for honcho_conclude and must be one of: ${[...CONCLUSION_WRITERS].join(", ")}`,
				);
			}

			// Step 2: validate declared identity against CONCLUSION_WRITERS allowlist.
			if (!isConclusionWriter(params.as_peer)) {
				return errText(
					`peer ${params.as_peer} is not permitted to write conclusions`,
				);
			}

			// Step 3: steward product: prefix gate against declared identity.
			if (
				params.as_peer === "steward" &&
				!params.content.startsWith("product:")
			) {
				return errText(
					"steward conclusions must be prefixed with 'product:' — this is a dialect separator; engineering conclusions do not use it",
				);
			}

			// Step 4: required-env check.
			const env = hydrateFromConfigFile(opts.getEnv());
			const missing = checkRequired(env);
			if (missing) return errText(missing);

			// Step 5: short-circuit for tests.
			if (opts.__fakeConcludeResult) {
				bumpHonchoCallCounter(process.cwd());
				return okText("conclusion recorded (stub)", {
					conclusionId: opts.__fakeConcludeResult.id,
				});
			}

			// Step 6: network call — use declared as_peer identity, not env.
			try {
				const client = await makeClient(env);
				const peer = await client.peer(params.as_peer);
				const created = await peer.conclusions.create({
					content: params.content,
					sessionId: env.HONCHO_SESSION_ID,
				});
				const conclusionId =
					Array.isArray(created) && created[0] ? created[0].id : undefined;
				bumpHonchoCallCounter(process.cwd());
				return okText("conclusion recorded", { conclusionId });
			} catch (err: unknown) {
				const apiKey = env.HONCHO_API_KEY ?? "";
				const raw = err instanceof Error ? err.message : String(err);
				return errText(sanitizeErrorForDisplay(`honcho error: ${raw}`, apiKey));
			}
		},
	};

	return { honcho_recall, honcho_search, honcho_remember, honcho_conclude };
}

// ---------------------------------------------------------------------------
// Sandbox helpers used by the [live] integration tests.
// ---------------------------------------------------------------------------

export async function provisionSandboxSession(opts: {
	workspaceId: string;
	sessionId: string;
}): Promise<string> {
	const Honcho = await loadHonchoConstructor();
	const client = new Honcho({
		apiKey: process.env.HONCHO_API_KEY!,
		workspaceId: opts.workspaceId,
	});
	const session = await client.session(opts.sessionId);
	return session.id;
}

export async function cleanupSandboxSession(_opts: {
	workspaceId: string;
	sessionId: string;
}): Promise<void> {
	// Honcho sessions are cheap and not easily deleted by the SDK. Leave them
	// in place; sandbox workspace retention is the Honcho account owner's call.
}

export async function listConclusionsForTest(opts: {
	workspaceId: string;
	peerId: string;
}): Promise<string[]> {
	const Honcho = await loadHonchoConstructor();
	const client = new Honcho({
		apiKey: process.env.HONCHO_API_KEY!,
		workspaceId: opts.workspaceId,
	});
	const peer = await client.peer(opts.peerId);
	const ids: string[] = [];
	const page: any = await peer.conclusions.list({ page: 1, size: 50 });
	if (page && typeof page[Symbol.asyncIterator] === "function") {
		for await (const c of page) ids.push((c as any).id);
	}
	return ids;
}

// ---------------------------------------------------------------------------
// OMP CustomToolFactory entry point.
//
// Returns four tools. Each tool wraps the corresponding entry from
// buildHonchoTools(), translating between OMP's execute signature
// `(toolCallId, params, onUpdate, ctx, signal)` and the legacy positional
// ordering preserved above for test compatibility.
// ---------------------------------------------------------------------------

const factory: CustomToolFactory = (pi) => {
	const { Type } = pi.typebox;

	const tools = buildHonchoTools({
		getEnv: () => process.env as HonchoToolRuntimeEnv,
	});

	const RecallParams = Type.Object({
		query: Type.String({ description: "Natural-language question" }),
		target: Type.Optional(
			Type.String({
				description: "Other peer to query about (theory-of-mind)",
			}),
		),
		scope: Type.Optional(Type.Enum(["session", "peer"] as const)),
	});
	const SearchParams = Type.Object({
		query: Type.String(),
		scope: Type.Optional(Type.Enum(["session", "peer", "workspace"] as const)),
		limit: Type.Optional(Type.Number({ default: 10, minimum: 1, maximum: 50 })),
	});
	const RememberParams = Type.Object({
		content: Type.String(),
		role: Type.Optional(Type.Enum(["assistant", "user"] as const)),
		as_peer: Type.Optional(
			Type.String({
				minLength: 1,
				description:
					"Optional override of the peer identity used to attribute this message. Defaults to the calling session's HONCHO_PEER_ID env.",
			}),
		),
	});
	const ConcludeParams = Type.Object({
		content: Type.String(),
		as_peer: Type.String({
			minLength: 1,
			description:
				"The Ghola peer identity making this conclusion. MUST match the declaring agent's persona name. Required; the allowlist rejects calls without it.",
		}),
	});

	function adapt<
		TParams extends { execute: Function; label: string; description: string },
	>(name: string, schema: any, impl: TParams): CustomTool<any, any> {
		return {
			name,
			label: impl.label,
			description: impl.description,
			parameters: schema,
			async execute(
				toolCallId: string,
				params: any,
				_onUpdate: unknown,
				_ctx: CustomToolContext,
				signal?: AbortSignal,
			): Promise<AgentToolResult<any>> {
				const ac = signal ?? new AbortController().signal;
				const result = await impl.execute(toolCallId, params, ac, () => {}, {
					cwd: process.cwd(),
				});
				return result as AgentToolResult<any>;
			},
		};
	}

	return [
		adapt("honcho_recall", RecallParams, tools.honcho_recall),
		adapt("honcho_search", SearchParams, tools.honcho_search),
		adapt("honcho_remember", RememberParams, tools.honcho_remember),
		adapt("honcho_conclude", ConcludeParams, tools.honcho_conclude),
	];
};

export default factory;

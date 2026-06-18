#!/usr/bin/env -S bun run
/**
 * linear — read and draft-mutate Linear issues, comments, and state transitions.
 *
 * SpecSafe slice: SPEC-20260424-004 — linear-steward-docs
 *
 * All mutations require --i-approve. Without it, a preview is printed (exit 0).
 * Approved mutations are logged to .pi/.linear-log.jsonl (mode 0600).
 *
 * Usage:
 *   bun run .omp/skills/linear/bin/linear.ts list [--team=KEY] [--state=in_progress] [--assignee=me]
 *   bun run .omp/skills/linear/bin/linear.ts get CUR-92
 *   bun run .omp/skills/linear/bin/linear.ts comment CUR-92 "body" [--i-approve]
 *   bun run .omp/skills/linear/bin/linear.ts transition CUR-92 in_review [--i-approve]
 *   bun run .omp/skills/linear/bin/linear.ts create --team=<id> --title=<t> [--body=<b>] [--i-approve]
 *
 * SDK: @linear/sdk v82.1.0
 * Key method signatures used:
 *   LinearClient({ apiKey })
 *   client.issues(variables?: IssuesQueryVariables): LinearFetch<IssueConnection>
 *   client.issue(id: string): LinearFetch<Issue>          // accepts identifier (e.g., CUR-92) or UUID
 *   client.createComment(input: CommentCreateInput): LinearFetch<CommentPayload>
 *   client.updateIssue(id: string, input: IssueUpdateInput): LinearFetch<IssuePayload>
 *   client.createIssue(input: IssueCreateInput): LinearFetch<IssuePayload>
 *   client.team(id: string): LinearFetch<Team>
 *   team.states(): LinearFetch<WorkflowStateConnection>
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Narrow interface — only what we actually use
// ---------------------------------------------------------------------------

export type IssueNode = {
	id: string;
	identifier: string;
	title: string;
	description?: string | null;
	url: string;
	priority?: number;
	priorityLabel?: string;
	stateId?: string | null;
	teamId?: string | null;
	assigneeId?: string | null;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	// Lazy-resolved via getters in real SDK; functions in mock for testability
	state: () => Promise<
		{ id: string; name: string; type: string } | null | undefined
	>;
	assignee: () => Promise<{ id: string; name: string } | null | undefined>;
	team: () => Promise<{ id: string; key: string } | null | undefined>;
};

export type WorkflowStateNode = {
	id: string;
	name: string;
	type: string;
};

export type LinearClientLike = {
	issues(variables?: unknown): Promise<{ nodes: IssueNode[] }>;
	issue(id: string): Promise<IssueNode>;
	createIssue(
		input: unknown,
	): Promise<{ success: boolean; issue?: { id: string; identifier: string } }>;
	createComment(
		input: unknown,
	): Promise<{ success: boolean; comment?: { id: string } }>;
	updateIssue(id: string, input: unknown): Promise<{ success: boolean }>;
	team(id: string): Promise<{
		id: string;
		key: string;
		name: string;
		states: () => Promise<{ nodes: WorkflowStateNode[] }>;
	}>;
};

// ---------------------------------------------------------------------------
// Dispatch options and result
// ---------------------------------------------------------------------------

export type DispatchOpts = {
	cwd: string;
	env: { LINEAR_API_KEY?: string; [k: string]: string | undefined };
	linearClientFactory: (apiKey: string) => LinearClientLike;
	now?: () => Date;
};

export type DispatchResult = {
	stdout: string;
	stderr: string;
	exit: number;
};

// ---------------------------------------------------------------------------
// State name → type mapping for canonical tokens
// ---------------------------------------------------------------------------

// Maps our canonical CLI token to the LinearWorkflowState.type value(s) and
// preferred display-name pattern for fuzzy matching.
const STATE_TOKEN_MAP: Record<string, { types: string[]; pattern: RegExp }> = {
	triage: { types: ["triage"], pattern: /triage/i },
	todo: { types: ["unstarted", "backlog"], pattern: /^todo$/i },
	in_progress: { types: ["started"], pattern: /in[\s_-]?progress/i },
	in_review: { types: ["started"], pattern: /in[\s_-]?review/i },
	done: { types: ["completed"], pattern: /^done$/i },
};

/**
 * Resolve a CLI state token to a WorkflowState node.
 * First tries name-based fuzzy match, then falls back to type-based match.
 * Returns null if not found.
 */
function resolveState(
	token: string,
	states: WorkflowStateNode[],
): WorkflowStateNode | null {
	const mapping = STATE_TOKEN_MAP[token];
	if (!mapping) return null;

	// First pass: exact name match via pattern
	const nameMatch = states.find((s) => mapping.pattern.test(s.name));
	if (nameMatch) return nameMatch;

	// Second pass: type-based match (for tokens with unique types)
	if (mapping.types.length === 1) {
		const typeMatch = states.find((s) => s.type === mapping.types[0]);
		if (typeMatch) return typeMatch;
	}

	// Third pass: first matching type
	for (const t of mapping.types) {
		const found = states.find((s) => s.type === t);
		if (found) return found;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Audit log helpers
// ---------------------------------------------------------------------------

function getLogPath(cwd: string): string {
	return path.join(cwd, ".pi", ".linear-log.jsonl");
}

function ensureLog0600(logPath: string): void {
	if (!fs.existsSync(logPath)) {
		// Create with 0600 like push skill does (atomic touch + mode)
		fs.writeFileSync(logPath, "", { mode: 0o600 });
	}
	// Enforce 0600 even if the file already existed
	fs.chmodSync(logPath, 0o600);
}

function appendLogEntry(logPath: string, entry: Record<string, unknown>): void {
	ensureLog0600(logPath);
	fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtPriority(p: number | undefined): string {
	switch (p) {
		case 1:
			return "Urgent";
		case 2:
			return "High";
		case 3:
			return "Medium";
		case 4:
			return "Low";
		default:
			return "No priority";
	}
}

function formatDate(d: string | Date | undefined): string {
	if (!d) return "—";
	return new Date(d as string).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

function parseFlag(args: string[], flag: string): boolean {
	return args.includes(flag);
}

function parseOpt(args: string[], prefix: string): string | undefined {
	const found = args.find((a) => a.startsWith(prefix));
	return found ? found.slice(prefix.length) : undefined;
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

const AUTH_ERROR = `LINEAR_API_KEY not set. Add to ~/.bashrc:
  export LINEAR_API_KEY="lin_api_..."
Then: source ~/.bashrc`;

// ---------------------------------------------------------------------------
// Command: list
// ---------------------------------------------------------------------------

async function cmdList(
	argv: string[],
	client: LinearClientLike,
): Promise<DispatchResult> {
	const teamFilter = parseOpt(argv, "--team=");
	const stateFilter = parseOpt(argv, "--state=");
	const assigneeFilter = parseFlag(argv, "--assignee=me");

	// Build filter variables for the SDK
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const variables: Record<string, unknown> = {};
	const filter: Record<string, unknown> = {};

	if (teamFilter) {
		filter.team = { key: { eq: teamFilter } };
	}
	if (stateFilter) {
		const mapping = STATE_TOKEN_MAP[stateFilter];
		if (mapping) {
			// Filter by type(s) — we'll post-filter by name pattern below
			filter.state = { type: { in: mapping.types } };
		}
	}
	if (assigneeFilter) {
		filter.assignee = { isMe: { eq: true } };
	}

	if (Object.keys(filter).length > 0) {
		variables.filter = filter;
	}

	const conn = await client.issues(variables);
	let issues = conn.nodes;

	// Post-filter by name pattern for tokens that share a type (in_progress vs in_review)
	if (stateFilter && STATE_TOKEN_MAP[stateFilter]) {
		const mapping = STATE_TOKEN_MAP[stateFilter];
		if (stateFilter === "in_progress" || stateFilter === "in_review") {
			// Need to resolve state name for each issue to disambiguate
			const resolved = await Promise.all(
				issues.map(async (issue) => {
					const s = await issue.state();
					return { issue, stateName: s?.name ?? "" };
				}),
			);
			issues = resolved
				.filter(({ stateName }) => mapping.pattern.test(stateName))
				.map(({ issue }) => issue);
		}
	}

	if (issues.length === 0) {
		return { stdout: "(no issues)", stderr: "", exit: 0 };
	}

	// Resolve state names for display
	const rows = await Promise.all(
		issues.map(async (issue) => {
			const state = await issue.state();
			const assignee = await issue.assignee();
			return {
				key: issue.identifier,
				title: issue.title,
				state: state?.name ?? "—",
				assignee: assignee?.name ?? "—",
				priority: issue.priorityLabel ?? fmtPriority(issue.priority),
				updated: formatDate(issue.updatedAt),
			};
		}),
	);

	const COL_KEY = 10;
	const COL_STATE = 16;
	const COL_ASSIGNEE = 14;
	const COL_PRIORITY = 12;
	const COL_DATE = 12;

	const header =
		"KEY".padEnd(COL_KEY) +
		"STATE".padEnd(COL_STATE) +
		"ASSIGNEE".padEnd(COL_ASSIGNEE) +
		"PRIORITY".padEnd(COL_PRIORITY) +
		"UPDATED".padEnd(COL_DATE) +
		"TITLE";
	const sep = "-".repeat(header.length + 20);

	const lines = [header, sep];
	for (const r of rows) {
		lines.push(
			r.key.padEnd(COL_KEY) +
				r.state.padEnd(COL_STATE) +
				r.assignee.padEnd(COL_ASSIGNEE) +
				r.priority.padEnd(COL_PRIORITY) +
				r.updated.padEnd(COL_DATE) +
				r.title,
		);
	}

	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Command: get
// ---------------------------------------------------------------------------

async function cmdGet(
	argv: string[],
	client: LinearClientLike,
): Promise<DispatchResult> {
	const key = argv[0];
	if (!key) {
		return { stdout: "", stderr: "usage: linear get <KEY>", exit: 1 };
	}

	let issue: IssueNode;
	try {
		issue = await client.issue(key);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `error: ${msg}`, exit: 2 };
	}

	const [state, assignee, team] = await Promise.all([
		issue.state(),
		issue.assignee(),
		issue.team(),
	]);

	const lines = [
		`key:         ${issue.identifier}`,
		`title:       ${issue.title}`,
		`state:       ${state?.name ?? "—"} (${state?.type ?? "—"})`,
		`assignee:    ${assignee?.name ?? "unassigned"}`,
		`team:        ${team?.key ?? "—"}`,
		`priority:    ${issue.priorityLabel ?? fmtPriority(issue.priority)}`,
		`url:         ${issue.url}`,
		`created:     ${formatDate(issue.createdAt)}`,
		`updated:     ${formatDate(issue.updatedAt)}`,
		``,
		`description:`,
		issue.description ? issue.description : "(none)",
	];

	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Command: comment
// ---------------------------------------------------------------------------

async function cmdComment(
	argv: string[],
	client: LinearClientLike,
	cwd: string,
	now: () => Date,
): Promise<DispatchResult> {
	const key = argv[0];
	const body = argv[1];
	const approve = parseFlag(argv, "--i-approve");

	if (!key || !body) {
		return {
			stdout: "",
			stderr: "usage: linear comment <KEY> <body> [--i-approve]",
			exit: 1,
		};
	}

	let issue: IssueNode;
	try {
		issue = await client.issue(key);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `error: ${msg}`, exit: 2 };
	}

	const state = await issue.state();
	const payload = { issueId: issue.id, body };

	if (!approve) {
		const preview = [
			"DRY-RUN — no changes will be made. Re-run with --i-approve to execute.",
			"",
			`action:      comment`,
			`key:         ${key}  (internal id: ${issue.id})`,
			`title:       ${issue.title}`,
			`state:       ${state?.name ?? "—"}`,
			``,
			`mutation payload:`,
			JSON.stringify({ createComment: payload }, null, 2),
			``,
			`diff (what would change):`,
			`  + comment on ${key}: "${body}"`,
		];
		return { stdout: preview.join("\n"), stderr: "", exit: 0 };
	}

	// Execute
	const result = await client.createComment(payload);
	if (!result.success) {
		return {
			stdout: "",
			stderr: "error: createComment returned success=false",
			exit: 2,
		};
	}

	const ts = now().toISOString();
	const logEntry = {
		ts,
		action: "comment",
		key,
		before: { state: state?.name ?? null, comment: null },
		after: { state: state?.name ?? null, comment: body },
		approver: "luci",
	};

	const logPath = getLogPath(cwd);
	appendLogEntry(logPath, logEntry);

	return { stdout: `comment posted on ${key}`, stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Command: transition
// ---------------------------------------------------------------------------

async function cmdTransition(
	argv: string[],
	client: LinearClientLike,
	cwd: string,
	now: () => Date,
): Promise<DispatchResult> {
	const key = argv[0];
	const stateToken = argv[1];
	const approve = parseFlag(argv, "--i-approve");

	if (!key || !stateToken) {
		return {
			stdout: "",
			stderr: "usage: linear transition <KEY> <state> [--i-approve]",
			exit: 1,
		};
	}

	let issue: IssueNode;
	try {
		issue = await client.issue(key);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `error: ${msg}`, exit: 2 };
	}

	const [currentState, teamInfo] = await Promise.all([
		issue.state(),
		issue.team(),
	]);

	if (!teamInfo?.id) {
		return {
			stdout: "",
			stderr: `error: could not determine team for issue ${key}`,
			exit: 2,
		};
	}

	// Resolve state name → state ID via team.states()
	const team = await client.team(teamInfo.id);
	const statesConn = await team.states();
	const stateNodes = statesConn.nodes;

	const targetState = resolveState(stateToken, stateNodes);
	if (!targetState) {
		return {
			stdout: "",
			stderr: `error: unknown state token "${stateToken}". Valid tokens: triage, todo, in_progress, in_review, done`,
			exit: 1,
		};
	}

	const payload = { stateId: targetState.id };

	if (!approve) {
		const preview = [
			"DRY-RUN — no changes will be made. Re-run with --i-approve to execute.",
			"",
			`action:      transition`,
			`key:         ${key}  (internal id: ${issue.id})`,
			`title:       ${issue.title}`,
			``,
			`before → after:`,
			`  state:     "${currentState?.name ?? "—"}" → "${targetState.name}"`,
			`             (id: ${issue.stateId ?? "—"} → ${targetState.id})`,
			``,
			`mutation payload:`,
			JSON.stringify({ updateIssue: { id: issue.id, ...payload } }, null, 2),
		];
		return { stdout: preview.join("\n"), stderr: "", exit: 0 };
	}

	// Execute
	const result = await client.updateIssue(issue.id, payload);
	if (!result.success) {
		return {
			stdout: "",
			stderr: "error: updateIssue returned success=false",
			exit: 2,
		};
	}

	const ts = now().toISOString();
	const logEntry = {
		ts,
		action: "transition",
		key,
		before: {
			state: currentState?.name ?? null,
			stateId: issue.stateId ?? null,
		},
		after: { state: targetState.name, stateId: targetState.id },
		approver: "luci",
	};

	const logPath = getLogPath(cwd);
	appendLogEntry(logPath, logEntry);

	return {
		stdout: `transitioned ${key}: "${currentState?.name ?? "—"}" → "${targetState.name}"`,
		stderr: "",
		exit: 0,
	};
}

// ---------------------------------------------------------------------------
// Command: create
// ---------------------------------------------------------------------------

async function cmdCreate(
	argv: string[],
	client: LinearClientLike,
	cwd: string,
	now: () => Date,
): Promise<DispatchResult> {
	const teamId = parseOpt(argv, "--team=");
	const title = parseOpt(argv, "--title=");
	const body = parseOpt(argv, "--body=");
	const approve = parseFlag(argv, "--i-approve");

	if (!teamId) {
		return { stdout: "", stderr: "error: --team=<id> is required", exit: 1 };
	}
	if (!title) {
		return { stdout: "", stderr: "error: --title=<t> is required", exit: 1 };
	}

	const payload: Record<string, unknown> = { teamId, title };
	if (body) payload.description = body;

	if (!approve) {
		const preview = [
			"DRY-RUN — no changes will be made. Re-run with --i-approve to execute.",
			"",
			`action:      create`,
			`team:        ${teamId}`,
			`title:       ${title}`,
			body ? `body:        ${body}` : "body:        (none)",
			``,
			`mutation payload:`,
			JSON.stringify({ createIssue: payload }, null, 2),
		];
		return { stdout: preview.join("\n"), stderr: "", exit: 0 };
	}

	const result = await client.createIssue(payload);
	if (!result.success) {
		return {
			stdout: "",
			stderr: "error: createIssue returned success=false",
			exit: 2,
		};
	}

	const ts = now().toISOString();
	const newKey = result.issue?.identifier ?? "unknown";
	const logEntry = {
		ts,
		action: "create",
		key: newKey,
		before: null,
		after: { teamId, title, description: body ?? null },
		approver: "luci",
	};

	const logPath = getLogPath(cwd);
	appendLogEntry(logPath, logEntry);

	return { stdout: `created issue ${newKey}`, stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Main dispatch function (pure — no process.* calls)
// ---------------------------------------------------------------------------

const USAGE = `usage: linear <command> [args]

Commands:
  list [--team=KEY] [--state=triage|todo|in_progress|in_review|done] [--assignee=me]
  get <KEY>                           e.g. CUR-92
  comment <KEY> <body> [--i-approve]
  transition <KEY> <state> [--i-approve]
  create --team=<id> --title=<t> [--body=<b>] [--i-approve]

Reads execute immediately.
Mutations without --i-approve print a DRY-RUN preview (exit 0).
Mutations with --i-approve execute and append to .pi/.linear-log.jsonl.`;

export async function dispatch(
	argv: string[],
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const [command, ...rest] = argv;

	// Auth check for all commands
	const apiKey = opts.env.LINEAR_API_KEY;
	if (!apiKey) {
		return { stdout: "", stderr: AUTH_ERROR, exit: 2 };
	}

	const now = opts.now ?? (() => new Date());
	const client = opts.linearClientFactory(apiKey);

	switch (command) {
		case "list":
			return cmdList(rest, client);

		case "get":
			return cmdGet(rest, client);

		case "comment":
			return cmdComment(rest, client, opts.cwd, now);

		case "transition":
			return cmdTransition(rest, client, opts.cwd, now);

		case "create":
			return cmdCreate(rest, client, opts.cwd, now);

		default:
			return {
				stdout: "",
				stderr: `unknown command: ${command ?? "(none)"}\n\n${USAGE}`,
				exit: 1,
			};
	}
}

// ---------------------------------------------------------------------------
// Real LinearClient adapter — wraps SDK to match LinearClientLike
// ---------------------------------------------------------------------------

function wrapLinearClient(
	sdkClient: import("@linear/sdk").LinearClient,
): LinearClientLike {
	return {
		async issues(variables?: unknown) {
			const conn = await sdkClient.issues(
				variables as import("@linear/sdk").IssuesQueryVariables,
			);
			return {
				nodes: conn.nodes.map((issue) => ({
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.description,
					url: issue.url,
					priority: issue.priority,
					priorityLabel: issue.priorityLabel,
					stateId: issue.stateId,
					teamId: issue.teamId,
					assigneeId: issue.assigneeId,
					createdAt: issue.createdAt?.toISOString(),
					updatedAt: issue.updatedAt?.toISOString(),
					state: async () => {
						const s = await issue.state;
						return s ? { id: s.id, name: s.name, type: s.type } : null;
					},
					assignee: async () => {
						const a = await issue.assignee;
						return a ? { id: a.id, name: a.name } : null;
					},
					team: async () => {
						const t = await issue.team;
						return t ? { id: t.id, key: t.key } : null;
					},
				})),
			};
		},

		async issue(id: string) {
			const issue = await sdkClient.issue(id);
			return {
				id: issue.id,
				identifier: issue.identifier,
				title: issue.title,
				description: issue.description,
				url: issue.url,
				priority: issue.priority,
				priorityLabel: issue.priorityLabel,
				stateId: issue.stateId,
				teamId: issue.teamId,
				assigneeId: issue.assigneeId,
				createdAt: issue.createdAt?.toISOString(),
				updatedAt: issue.updatedAt?.toISOString(),
				state: async () => {
					const s = await issue.state;
					return s ? { id: s.id, name: s.name, type: s.type } : null;
				},
				assignee: async () => {
					const a = await issue.assignee;
					return a ? { id: a.id, name: a.name } : null;
				},
				team: async () => {
					const t = await issue.team;
					return t ? { id: t.id, key: t.key } : null;
				},
			};
		},

		async createIssue(input: unknown) {
			const payload = await sdkClient.createIssue(
				input as import("@linear/sdk").IssueCreateInput,
			);
			const issue = await payload.issue;
			return {
				success: payload.success,
				issue: issue
					? { id: issue.id, identifier: issue.identifier }
					: undefined,
			};
		},

		async createComment(input: unknown) {
			const payload = await sdkClient.createComment(
				input as import("@linear/sdk").CommentCreateInput,
			);
			const comment = await payload.comment;
			return {
				success: payload.success,
				comment: comment ? { id: comment.id } : undefined,
			};
		},

		async updateIssue(id: string, input: unknown) {
			const payload = await sdkClient.updateIssue(
				id,
				input as import("@linear/sdk").IssueUpdateInput,
			);
			return { success: payload.success };
		},

		async team(id: string) {
			const team = await sdkClient.team(id);
			return {
				id: team.id,
				key: team.key,
				name: team.name,
				states: async () => {
					const conn = await team.states();
					return {
						nodes: conn.nodes.map((s) => ({
							id: s.id,
							name: s.name,
							type: s.type,
						})),
					};
				},
			};
		},
	};
}

// ---------------------------------------------------------------------------
// CLI entry point — thin wrapper only
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const { LinearClient } = await import("@linear/sdk");

	const result = await dispatch(process.argv.slice(2), {
		cwd: process.cwd(),
		env: process.env as Record<string, string | undefined>,
		linearClientFactory: (apiKey: string) =>
			wrapLinearClient(new LinearClient({ apiKey })),
	});

	if (result.stdout) process.stdout.write(result.stdout + "\n");
	if (result.stderr) process.stderr.write(result.stderr + "\n");
	process.exit(result.exit);
}

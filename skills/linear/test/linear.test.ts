/**
 * Tests for the linear skill.
 *
 * SpecSafe slice: SPEC-20260424-004 — linear-steward-docs
 *
 * Test types:
 *   [unit] — no network; fully mocked LinearClient.
 *   [live]  — real Linear API, skipped unless LINEAR_TESTS_LIVE=1.
 *
 * Run unit only:  bun test --test-name-pattern='\[unit\]'
 * Run all:        bun test ./.omp/skills/linear/test/linear.test.ts
 * Run live:       LINEAR_TESTS_LIVE=1 bun test ./.omp/skills/linear/test/linear.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LinearClientLike, DispatchOpts } from "../bin/linear.ts";
import { dispatch } from "../bin/linear.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "linear-test-"));
}

function makePiDir(dir: string): string {
	const piDir = path.join(dir, ".pi");
	fs.mkdirSync(piDir, { recursive: true });
	return piDir;
}

/** Build a mock WorkflowState */
function mockState(id: string, name: string, type: string) {
	return { id, name, type };
}

/** Build a mock User */
function mockUser(id: string, name: string) {
	return { id, name };
}

/** Build a mock Issue */
function mockIssue(opts: {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	url: string;
	priority?: number;
	priorityLabel?: string;
	stateName: string;
	stateType: string;
	stateId: string;
	teamId: string;
	assigneeName?: string;
	assigneeId?: string;
	createdAt?: string;
	updatedAt?: string;
}) {
	return {
		id: opts.id,
		identifier: opts.identifier,
		title: opts.title,
		description: opts.description ?? null,
		url: opts.url,
		priority: opts.priority ?? 0,
		priorityLabel: opts.priorityLabel ?? "No priority",
		stateId: opts.stateId,
		teamId: opts.teamId,
		assigneeId: opts.assigneeId ?? null,
		createdAt: opts.createdAt ?? "2026-04-24T10:00:00Z",
		updatedAt: opts.updatedAt ?? "2026-04-24T10:00:00Z",
		// Lazy-resolved objects
		state: async () => ({
			id: opts.stateId,
			name: opts.stateName,
			type: opts.stateType,
		}),
		assignee: async () =>
			opts.assigneeId
				? mockUser(opts.assigneeId, opts.assigneeName ?? "Luci")
				: null,
		team: async () => ({ id: opts.teamId, key: "CUR" }),
	};
}

/** The canonical mock issues */
const MOCK_ISSUES = [
	mockIssue({
		id: "issue-uuid-1",
		identifier: "CUR-92",
		title: "Implement linear skill",
		description: "Build the linear CLI skill for Pi.",
		url: "https://linear.app/cur/issue/CUR-92",
		priority: 2,
		priorityLabel: "High",
		stateId: "state-uuid-inprogress",
		stateName: "In Progress",
		stateType: "started",
		teamId: "team-uuid-1",
		assigneeId: "user-uuid-1",
		assigneeName: "Luci",
	}),
	mockIssue({
		id: "issue-uuid-2",
		identifier: "CUR-93",
		title: "Write tests",
		url: "https://linear.app/cur/issue/CUR-93",
		stateId: "state-uuid-todo",
		stateName: "Todo",
		stateType: "unstarted",
		teamId: "team-uuid-1",
	}),
];

const MOCK_WORKFLOW_STATES = [
	mockState("state-uuid-triage", "Triage", "triage"),
	mockState("state-uuid-todo", "Todo", "unstarted"),
	mockState("state-uuid-inprogress", "In Progress", "started"),
	mockState("state-uuid-inreview", "In Review", "started"),
	mockState("state-uuid-done", "Done", "completed"),
];

/** Build a mock LinearClient */
function makeMockClient(
	overrides?: Partial<LinearClientLike>,
): LinearClientLike {
	const defaultClient: LinearClientLike = {
		issues: mock(async (_variables?: unknown) => ({
			nodes: MOCK_ISSUES,
			pageInfo: { hasNextPage: false, endCursor: null },
		})),
		issue: mock(async (id: string) => {
			const found = MOCK_ISSUES.find((i) => i.identifier === id || i.id === id);
			if (!found) throw new Error(`Issue ${id} not found`);
			return found;
		}),
		createIssue: mock(async (_input: unknown) => ({
			success: true,
			issue: { id: "issue-uuid-new", identifier: "CUR-100" },
		})),
		createComment: mock(async (_input: unknown) => ({
			success: true,
			comment: { id: "comment-uuid-1", body: "hi" },
		})),
		updateIssue: mock(async (_id: string, _input: unknown) => ({
			success: true,
			issue: { id: "issue-uuid-1" },
		})),
		team: mock(async (_id: string) => ({
			id: "team-uuid-1",
			key: "CUR",
			name: "Current",
			states: async () => ({
				nodes: MOCK_WORKFLOW_STATES,
			}),
		})),
	};
	return { ...defaultClient, ...overrides };
}

/** Build dispatch opts */
function makeOpts(
	dir: string,
	clientFactory?: () => LinearClientLike,
	nowFn?: () => Date,
): DispatchOpts {
	makePiDir(dir);
	return {
		cwd: dir,
		env: { LINEAR_API_KEY: "lin_api_test123" },
		linearClientFactory: clientFactory
			? (_key: string) => clientFactory()
			: (_key: string) => makeMockClient(),
		now: nowFn,
	};
}

// ---------------------------------------------------------------------------
// [unit] list command
// ---------------------------------------------------------------------------

describe("[unit] linear list", () => {
	let tmpDir: string;
	let mockClient: LinearClientLike;

	beforeEach(() => {
		tmpDir = makeTempDir();
		mockClient = makeMockClient();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] list returns issue titles and keys", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["list"], opts);

		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("CUR-92");
		expect(result.stdout).toContain("Implement linear skill");
		expect(result.stdout).toContain("CUR-93");
		expect(result.stdout).toContain("Write tests");
	});

	test("[unit] list passes state filter to client", async () => {
		const issuesFn = mock(async (_variables?: unknown) => ({
			nodes: MOCK_ISSUES,
			pageInfo: { hasNextPage: false, endCursor: null },
		}));
		mockClient = makeMockClient({ issues: issuesFn });
		const opts = makeOpts(tmpDir, () => mockClient);

		const result = await dispatch(["list", "--state=in_progress"], opts);
		expect(result.exit).toBe(0);
		// issues() should have been called
		expect(issuesFn).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// [unit] get command
// ---------------------------------------------------------------------------

describe("[unit] linear get", () => {
	let tmpDir: string;
	let mockClient: LinearClientLike;

	beforeEach(() => {
		tmpDir = makeTempDir();
		mockClient = makeMockClient();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] get CUR-92 shows all key fields", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["get", "CUR-92"], opts);

		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("CUR-92");
		expect(result.stdout).toContain("Implement linear skill");
		expect(result.stdout).toContain("In Progress");
		expect(result.stdout).toContain("Luci");
		expect(result.stdout).toContain("https://linear.app/cur/issue/CUR-92");
	});

	test("[unit] get missing KEY returns exit 2", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["get"], opts);
		expect(result.exit).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// [unit] comment command — dry-run vs approved
// ---------------------------------------------------------------------------

describe("[unit] linear comment", () => {
	let tmpDir: string;
	let mockClient: LinearClientLike;

	beforeEach(() => {
		tmpDir = makeTempDir();
		mockClient = makeMockClient();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] comment without --i-approve prints preview and does NOT call createComment", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["comment", "CUR-92", "hi"], opts);

		expect(result.exit).toBe(0);
		// Should contain preview block
		expect(result.stdout).toContain("DRY-RUN");
		expect(result.stdout).toContain("CUR-92");
		expect(result.stdout).toContain("hi");
		// createComment should NOT have been called
		expect(mockClient.createComment).not.toHaveBeenCalled();
	});

	test("[unit] comment --i-approve calls createComment exactly once and appends to log", async () => {
		const now = new Date("2026-04-24T12:00:00Z");
		const opts = makeOpts(
			tmpDir,
			() => mockClient,
			() => now,
		);
		const result = await dispatch(
			["comment", "CUR-92", "hi", "--i-approve"],
			opts,
		);

		expect(result.exit).toBe(0);
		expect(mockClient.createComment).toHaveBeenCalledTimes(1);

		// Log file should exist and contain the entry
		const logPath = path.join(tmpDir, ".pi", ".linear-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
		const logContent = fs.readFileSync(logPath, "utf-8").trim();
		const logEntry = JSON.parse(logContent);
		expect(logEntry.action).toBe("comment");
		expect(logEntry.key).toBe("CUR-92");
		expect(logEntry.approver).toBe("luci");
		expect(logEntry.ts).toBe("2026-04-24T12:00:00.000Z");
	});

	test("[unit] audit log has mode 0600 after a mutation", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		await dispatch(["comment", "CUR-92", "hello world", "--i-approve"], opts);

		const logPath = path.join(tmpDir, ".pi", ".linear-log.jsonl");
		const stat = fs.statSync(logPath);
		expect(stat.mode & 0o777).toBe(0o600);
	});
});

// ---------------------------------------------------------------------------
// [unit] transition command — dry-run vs approved
// ---------------------------------------------------------------------------

describe("[unit] linear transition", () => {
	let tmpDir: string;
	let mockClient: LinearClientLike;

	beforeEach(() => {
		tmpDir = makeTempDir();
		mockClient = makeMockClient();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] transition without --i-approve resolves state name to ID, prints preview, does NOT call updateIssue", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["transition", "CUR-92", "in_review"], opts);

		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("DRY-RUN");
		// Should show the resolved state ID
		expect(result.stdout).toContain("state-uuid-inreview");
		// updateIssue should NOT have been called
		expect(mockClient.updateIssue).not.toHaveBeenCalled();
	});

	test("[unit] transition --i-approve calls updateIssue with resolved stateId", async () => {
		const now = new Date("2026-04-24T12:00:00Z");
		const opts = makeOpts(
			tmpDir,
			() => mockClient,
			() => now,
		);
		const result = await dispatch(
			["transition", "CUR-92", "in_review", "--i-approve"],
			opts,
		);

		expect(result.exit).toBe(0);
		expect(mockClient.updateIssue).toHaveBeenCalledTimes(1);
		const [id, input] = (mockClient.updateIssue as ReturnType<typeof mock>).mock
			.calls[0] as [string, { stateId: string }];
		expect(id).toBe("issue-uuid-1");
		expect(input.stateId).toBe("state-uuid-inreview");

		// Log should have before/after state names
		const logPath = path.join(tmpDir, ".pi", ".linear-log.jsonl");
		const logEntry = JSON.parse(fs.readFileSync(logPath, "utf-8").trim());
		expect(logEntry.before.state).toBe("In Progress");
		expect(logEntry.after.state).toBe("In Review");
	});

	test("[unit] transition to unknown state name returns exit 1", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(
			["transition", "CUR-92", "nonexistent_state"],
			opts,
		);
		expect(result.exit).toBe(1);
		expect(result.stderr).toContain("nonexistent_state");
	});
});

// ---------------------------------------------------------------------------
// [unit] create command — dry-run
// ---------------------------------------------------------------------------

describe("[unit] linear create", () => {
	let tmpDir: string;
	let mockClient: LinearClientLike;

	beforeEach(() => {
		tmpDir = makeTempDir();
		mockClient = makeMockClient();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] create without --i-approve prints preview payload", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(
			[
				"create",
				"--team=team-uuid-1",
				"--title=New Feature",
				"--body=Some description",
			],
			opts,
		);

		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("DRY-RUN");
		expect(result.stdout).toContain("New Feature");
		expect(result.stdout).toContain("team-uuid-1");
		expect(mockClient.createIssue).not.toHaveBeenCalled();
	});

	test("[unit] create --i-approve calls createIssue and logs", async () => {
		const now = new Date("2026-04-24T12:00:00Z");
		const opts = makeOpts(
			tmpDir,
			() => mockClient,
			() => now,
		);
		const result = await dispatch(
			["create", "--team=team-uuid-1", "--title=New Feature", "--i-approve"],
			opts,
		);

		expect(result.exit).toBe(0);
		expect(mockClient.createIssue).toHaveBeenCalledTimes(1);
		const logPath = path.join(tmpDir, ".pi", ".linear-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
	});

	test("[unit] create without --team or --title returns error", async () => {
		const opts = makeOpts(tmpDir, () => mockClient);
		const result = await dispatch(["create", "--title=Only Title"], opts);
		expect(result.exit).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// [unit] auth error — missing LINEAR_API_KEY
// ---------------------------------------------------------------------------

describe("[unit] linear auth", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTempDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("[unit] missing LINEAR_API_KEY exits non-zero with export line", async () => {
		makePiDir(tmpDir);
		const opts: DispatchOpts = {
			cwd: tmpDir,
			env: {}, // No API key
			linearClientFactory: (_key: string) => makeMockClient(),
		};
		const result = await dispatch(["list"], opts);

		expect(result.exit).not.toBe(0);
		expect(result.stderr).toContain("LINEAR_API_KEY");
		expect(result.stderr).toContain("export LINEAR_API_KEY");
		expect(result.stderr).toContain("~/.bashrc");
	});
});

// ---------------------------------------------------------------------------
// [live] smoke tests — skipped unless LINEAR_TESTS_LIVE=1
// ---------------------------------------------------------------------------
// NOTE: Live tests assume team key "CUR" exists and at least one issue is present.
// Issue key CUR-1 must exist for the get smoke test.
// Deferred to end-to-end smoke; these are skeleton stubs.

describe("[live] linear smoke tests", () => {
	const LIVE = process.env.LINEAR_TESTS_LIVE === "1";

	test.skipIf(!LIVE)(
		"[live] linear list returns at least one issue",
		async () => {
			const { LinearClient } = await import("@linear/sdk");
			const apiKey = process.env.LINEAR_API_KEY!;
			const tmpDir = makeTempDir();
			try {
				const opts: DispatchOpts = {
					cwd: tmpDir,
					env: process.env as Record<string, string | undefined>,
					linearClientFactory: (key: string) =>
						new LinearClient({ apiKey: key }) as unknown as LinearClientLike,
				};
				const result = await dispatch(["list"], opts);
				expect(result.exit).toBe(0);
				expect(result.stdout.length).toBeGreaterThan(0);
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		},
	);
});

import {
	access,
	lstat,
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	EVAL_RUN_SCHEMA_VERSION,
	type EvalCase,
	type EvalConfig,
	type EvalRun,
	type EvalRunContext,
	type EvalSuite,
	validateEvalConfig,
	validateEvalRun,
} from "./schema.ts";

const RUN_ID_TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const CONTEXT_VALUE_MAX_LENGTH = 512;
const TRACE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const UNSANITIZED_TRACE_PATTERNS = [
	/authorization["'\s:]+bearer/i,
	/api[_-]?key["'\s:=]+[A-Za-z0-9._-]{12,}/i,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
	/\/Users\/[A-Za-z0-9._-]+/,
	/\/home\/[A-Za-z0-9._-]+/,
	/https?:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/i,
] as const;

const USAGE =
	"Usage: evalfly validate | run --suite smoke | check --suite smoke | latest | list | summary | traces | audit-traces | compare <baseline-run-id> <after-run-id> | report <run-id> | curate-trace <raw-relative-path> <sanitized-name> | normalize-trace <raw-relative-path> <sanitized-name> | import-session-trace <raw-relative-path> <sanitized-name>";

export type DispatchOptions = {
	cwd?: string;
	now?: () => Date;
	runId?: string;
};

export type DispatchResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type CaseResult = {
	case_id: string;
	title: string;
	risk_tier: EvalCase["risk_tier"];
	critical: boolean;
	passed: boolean;
	privacy: EvalCase["privacy"];
	errors: string[];
};

type RunRecord = EvalRun;

export async function dispatch(
	args: string[],
	opts: DispatchOptions = {},
): Promise<DispatchResult> {
	const command = args[0];
	const cwd = opts.cwd ?? process.cwd();

	try {
		if (command === "validate") {
			const config = await loadConfig(cwd);
			return {
				exitCode: 0,
				stdout: `evalfly config valid: ${config.name}\n`,
				stderr: "",
			};
		}
		if (command === "run") {
			return await runCommand(args.slice(1), cwd, opts);
		}
		if (command === "check") {
			return await checkCommand(args.slice(1), cwd, opts);
		}
		if (command === "latest") {
			return await latestCommand(cwd);
		}
		if (command === "list") {
			return await listCommand(cwd);
		}
		if (command === "summary") {
			return await summaryCommand(cwd);
		}
		if (command === "compare") {
			return await compareCommand(args.slice(1), cwd);
		}
		if (command === "traces") {
			return await tracesCommand(cwd);
		}
		if (command === "audit-traces") {
			return await auditTracesCommand(cwd);
		}
		if (command === "report") {
			return await reportCommand(args.slice(1), cwd);
		}
		if (command === "curate-trace") {
			return await curateTraceCommand(args.slice(1), cwd);
		}
		if (command === "normalize-trace") {
			return await normalizeTraceCommand(args.slice(1), cwd);
		}
		if (command === "import-session-trace") {
			return await importSessionTraceCommand(args.slice(1), cwd);
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: `unknown command: ${command ?? "(none)"}\n${USAGE}\n`,
		};
	} catch (error) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `${error instanceof Error ? error.message : String(error)}\n`,
		};
	}
}

async function runCommand(
	args: string[],
	cwd: string,
	opts: DispatchOptions,
): Promise<DispatchResult> {
	const run = await executeRun(args, cwd, opts);
	return {
		exitCode: run.verdict === "pass" ? 0 : 1,
		stdout: `evalfly run ${run.run_id}: ${run.verdict}\n`,
		stderr: "",
	};
}

async function checkCommand(
	args: string[],
	cwd: string,
	opts: DispatchOptions,
): Promise<DispatchResult> {
	const run = await executeRun(args, cwd, opts);
	return {
		exitCode: run.verdict === "pass" ? 0 : 1,
		stdout: `evalfly check ${run.run_id}: ${run.verdict}\nreport: ${run.context?.eval_report_path ?? join("evals", "reports", `${run.run_id}.md`)}\n`,
		stderr: "",
	};
}

async function executeRun(
	args: string[],
	cwd: string,
	opts: DispatchOptions,
): Promise<RunRecord> {
	const suite = parseSuite(args);
	const commitRange = parseOptionalFlag(args, "--commit-range");
	const config = await loadConfig(cwd);
	const cases = config.cases.filter((testCase) => testCase.suite === suite);
	if (cases.length === 0) {
		throw new Error(`no cases selected for suite: ${suite}`);
	}
	const createdAt = (opts.now?.() ?? new Date()).toISOString();
	const runId = opts.runId ?? defaultRunId(suite, createdAt);
	assertSafeRunId(runId);
	const context = await buildRunContext(cwd, runId, commitRange);
	const results = await Promise.all(
		cases.map((testCase) => evaluateCase(cwd, testCase)),
	);
	const failed = results.filter((result) => !result.passed).length;
	const criticalRegressions = results.filter(
		(result) => result.critical && !result.passed,
	).length;
	const run: RunRecord = {
		schema_version: EVAL_RUN_SCHEMA_VERSION,
		run_id: runId,
		suite,
		config_name: config.name,
		created_at: createdAt,
		context,
		results,
		summary: {
			total: results.length,
			passed: results.length - failed,
			failed,
			critical_regressions: criticalRegressions,
		},
		verdict: criticalRegressions === 0 && failed === 0 ? "pass" : "fail",
	};

	await writeRun(cwd, run);
	await writeReport(cwd, run);
	return run;
}

async function reportCommand(
	args: string[],
	cwd: string,
): Promise<DispatchResult> {
	const runId = args[0];
	if (!runId) {
		return { exitCode: 1, stdout: "", stderr: "report requires a run id\n" };
	}
	assertSafeRunId(runId);
	const runPath = await artifactPath(cwd, ["evals", "runs"], runId, ".json");
	const parsed = JSON.parse(await readFile(runPath, "utf8"));
	const result = validateEvalRun(parsed);
	if (!result.ok) {
		throw new Error(
			`invalid ${join("evals", "runs", `${runId}.json`)}:\n${result.errors.join("\n")}`,
		);
	}
	assertSafeRunId(result.value.run_id);
	if (result.value.run_id !== runId) {
		throw new Error(
			`run_id mismatch: requested ${runId} but saved run is ${result.value.run_id}`,
		);
	}
	await writeReport(cwd, result.value);
	return {
		exitCode: 0,
		stdout: `evalfly report written: ${join("evals", "reports", `${runId}.md`)}\n`,
		stderr: "",
	};
}

async function compareCommand(
	args: string[],
	cwd: string,
): Promise<DispatchResult> {
	if (args.length !== 2) {
		throw new Error("compare requires <baseline-run-id> <after-run-id>");
	}
	const [baselineRunId, afterRunId] = args;
	assertSafeRunId(baselineRunId);
	assertSafeRunId(afterRunId);
	const runs = await readSavedRuns(cwd);
	const baseline = findRun(runs, baselineRunId);
	const after = findRun(runs, afterRunId);
	const totalDelta = after.summary.total - baseline.summary.total;
	const passedDelta = after.summary.passed - baseline.summary.passed;
	const failedDelta = after.summary.failed - baseline.summary.failed;
	const criticalDelta =
		after.summary.critical_regressions - baseline.summary.critical_regressions;
	const comparisonPassed =
		after.summary.critical_regressions === 0 &&
		failedDelta <= 0 &&
		criticalDelta <= 0;
	const lines = [
		`evalfly compare: ${baseline.run_id} -> ${after.run_id}`,
		`baseline verdict: ${baseline.verdict}`,
		`after verdict: ${after.verdict}`,
		`total delta: ${formatDelta(totalDelta)}`,
		`passed delta: ${formatDelta(passedDelta)}`,
		`failed delta: ${formatDelta(failedDelta)}`,
		`critical_regressions delta: ${formatDelta(criticalDelta)}`,
		`comparison verdict: ${comparisonPassed ? "pass" : "fail"}`,
	];
	return {
		exitCode: comparisonPassed ? 0 : 1,
		stdout: `${lines.join("\n")}\n`,
		stderr: "",
	};
}

function findRun(runs: EvalRun[], runId: string): EvalRun {
	const run = runs.find((candidate) => candidate.run_id === runId);
	if (!run) {
		throw new Error(`evalfly run not found: ${runId}`);
	}
	return run;
}

function formatDelta(value: number): string {
	return value > 0 ? `+${value}` : String(value);
}

async function latestCommand(cwd: string): Promise<DispatchResult> {
	const runs = await readSavedRuns(cwd);
	let latest: EvalRun | undefined;
	for (const run of runs) {
		if (!latest || run.created_at > latest.created_at) {
			latest = run;
		}
	}
	if (!latest) {
		throw new Error("no evalfly runs found");
	}
	const reportPath = await canonicalReportPath(cwd, latest.run_id);
	return {
		exitCode: 0,
		stdout: `latest evalfly run: ${latest.run_id}\nverdict: ${latest.verdict}\nsuite: ${latest.suite}\nreport: ${reportPath}\n`,
		stderr: "",
	};
}

async function listCommand(cwd: string): Promise<DispatchResult> {
	const runs = await readSavedRuns(cwd);
	const lines = ["evalfly runs:"];
	for (const run of runs.sort((a, b) =>
		b.created_at.localeCompare(a.created_at),
	)) {
		lines.push(
			`${run.created_at} ${run.run_id} ${run.verdict} ${run.suite} ${await canonicalReportPath(cwd, run.run_id)}`,
		);
	}
	return {
		exitCode: 0,
		stdout: `${lines.join("\n")}\n`,
		stderr: "",
	};
}

async function summaryCommand(cwd: string): Promise<DispatchResult> {
	const runs = await readSavedRuns(cwd);
	let latest: EvalRun | undefined;
	let passingRuns = 0;
	let failingRuns = 0;
	let criticalRegressions = 0;
	for (const run of runs) {
		if (run.verdict === "pass") {
			passingRuns += 1;
		} else {
			failingRuns += 1;
		}
		criticalRegressions += run.summary.critical_regressions;
		if (!latest || run.created_at > latest.created_at) {
			latest = run;
		}
	}
	if (!latest) {
		throw new Error("no evalfly runs found");
	}
	const lines = [
		"evalfly summary:",
		`runs: ${runs.length}`,
		`passing runs: ${passingRuns}`,
		`failing runs: ${failingRuns}`,
		`critical regressions: ${criticalRegressions}`,
		`latest run: ${latest.run_id}`,
		`latest verdict: ${latest.verdict}`,
		`latest suite: ${latest.suite}`,
		`latest report: ${await canonicalReportPath(cwd, latest.run_id)}`,
		`latest spec slice: ${latest.context?.spec_slice ?? "not linked"}`,
		`latest commit range: ${latest.context?.commit_range ?? "not linked"}`,
	];
	return {
		exitCode: 0,
		stdout: `${lines.join("\n")}\n`,
		stderr: "",
	};
}

async function tracesCommand(cwd: string): Promise<DispatchResult> {
	const tracesDir = await readExactArtifactDir(cwd, [
		"evals",
		"traces",
		"sanitized",
	]);
	if (!tracesDir) {
		throw new Error("no sanitized evalfly traces found");
	}
	const files = (await readdir(tracesDir))
		.filter((file) => file !== ".gitkeep")
		.sort();
	if (files.length === 0) {
		throw new Error("no sanitized evalfly traces found");
	}
	const lines = ["sanitized evalfly traces:"];
	for (const file of files) {
		assertSafeTraceName(file);
		const relativeTracePath = join("evals", "traces", "sanitized", file);
		const tracePath = resolve(tracesDir, file);
		const stat = await lstat(tracePath);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error(`unsafe sanitized trace: ${relativeTracePath}`);
		}
		const realTracePath = await realpath(tracePath);
		if (realTracePath !== tracePath) {
			throw new Error(`unsafe sanitized trace: ${relativeTracePath}`);
		}
		lines.push(`${relativeTracePath} bytes: ${stat.size}`);
	}
	return {
		exitCode: 0,
		stdout: `${lines.join("\n")}\n`,
		stderr: "",
	};
}

async function auditTracesCommand(cwd: string): Promise<DispatchResult> {
	const traces = await readSanitizedTraceArtifacts(cwd);
	const privacyIssues: string[] = [];
	const curationCandidates: string[] = [];
	for (const trace of traces) {
		try {
			assertSanitizedTrace(trace.content);
		} catch {
			privacyIssues.push(`${trace.relativePath} appears unsanitized`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trace.content);
		} catch {
			privacyIssues.push(`${trace.relativePath} invalid JSON`);
			continue;
		}
		for (const rawField of findRawTraceFields(parsed, [])) {
			privacyIssues.push(`${trace.relativePath} raw field ${rawField}`);
		}
		if (isRecord(parsed) && isRecord(parsed.summary)) {
			const cost = parsed.summary.total_cost_usd;
			if (typeof cost === "number" && cost >= 0.05) {
				curationCandidates.push(
					`${trace.relativePath} high_cost total_cost_usd=${cost}`,
				);
			}
			const latency = parsed.summary.total_latency_ms;
			if (typeof latency === "number" && latency >= 60000) {
				curationCandidates.push(
					`${trace.relativePath} high_latency total_latency_ms=${latency}`,
				);
			}
		}
		if (isRecord(parsed) && Array.isArray(parsed.events)) {
			for (const [index, event] of parsed.events.entries()) {
				if (
					isRecord(event) &&
					event.sanitized_input === undefined &&
					event.sanitized_output === undefined
				) {
					curationCandidates.push(
						`${trace.relativePath} missing_sanitized_evidence event=${index}`,
					);
				}
			}
		}
	}
	const lines = [
		"evalfly trace audit:",
		`traces: ${traces.length}`,
		`privacy issues: ${privacyIssues.length}`,
		`curation candidates: ${curationCandidates.length}`,
	];
	for (const issue of privacyIssues) {
		lines.push(`privacy issue: ${issue}`);
	}
	for (const candidate of curationCandidates) {
		lines.push(`curation candidate: ${candidate}`);
	}
	return {
		exitCode: privacyIssues.length > 0 ? 1 : 0,
		stdout: `${lines.join("\n")}\n`,
		stderr: "",
	};
}

type SanitizedTraceArtifact = {
	relativePath: string;
	content: string;
};

async function readSanitizedTraceArtifacts(
	cwd: string,
): Promise<SanitizedTraceArtifact[]> {
	const tracesDir = await readExactArtifactDir(cwd, [
		"evals",
		"traces",
		"sanitized",
	]);
	if (!tracesDir) {
		throw new Error("no sanitized evalfly traces found");
	}
	const files = (await readdir(tracesDir))
		.filter((file) => file !== ".gitkeep")
		.sort();
	if (files.length === 0) {
		throw new Error("no sanitized evalfly traces found");
	}
	const traces: SanitizedTraceArtifact[] = [];
	for (const file of files) {
		assertSafeTraceName(file);
		const relativeTracePath = join("evals", "traces", "sanitized", file);
		const tracePath = resolve(tracesDir, file);
		const stat = await lstat(tracePath);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			throw new Error(`unsafe sanitized trace: ${relativeTracePath}`);
		}
		const realTracePath = await realpath(tracePath);
		if (realTracePath !== tracePath) {
			throw new Error(`unsafe sanitized trace: ${relativeTracePath}`);
		}
		traces.push({
			relativePath: relativeTracePath,
			content: await readFile(tracePath, "utf8"),
		});
	}
	return traces;
}

function findRawTraceFields(value: unknown, path: string[]): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item, index) =>
			findRawTraceFields(
				item,
				[...path.slice(0, -1), `${path.at(-1) ?? ""}[${index}]`].filter(
					Boolean,
				),
			),
		);
	}
	if (!isRecord(value)) {
		return [];
	}
	const fields: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		const childPath = [...path, key];
		if (key === "input" || key === "output" || key === "content") {
			fields.push(childPath.join("."));
		}
		fields.push(...findRawTraceFields(child, childPath));
	}
	return fields;
}

async function readSavedRuns(cwd: string): Promise<EvalRun[]> {
	const runsDir = await readExactArtifactDir(cwd, ["evals", "runs"]);
	if (!runsDir) {
		throw new Error("no evalfly runs found");
	}
	const files = (await readdir(runsDir))
		.filter((file) => file.endsWith(".json"))
		.sort();
	if (files.length === 0) {
		throw new Error("no evalfly runs found");
	}
	const runs: EvalRun[] = [];
	for (const file of files) {
		const runId = file.slice(0, -".json".length);
		assertSafeRunId(runId);
		const runPath = await exactArtifactFilePath(
			cwd,
			["evals", "runs"],
			runId,
			".json",
			"run",
		);
		const parsed = JSON.parse(await readFile(runPath, "utf8"));
		const result = validateEvalRun(parsed);
		if (!result.ok) {
			throw new Error(
				`invalid ${join("evals", "runs", file)}:\n${result.errors.join("\n")}`,
			);
		}
		assertSafeRunId(result.value.run_id);
		if (result.value.run_id !== runId) {
			throw new Error(
				`run_id mismatch: requested ${runId} but saved run is ${result.value.run_id}`,
			);
		}
		runs.push(result.value);
	}
	return runs;
}

async function canonicalReportPath(
	cwd: string,
	runId: string,
): Promise<string> {
	const relativeReportPath = join("evals", "reports", `${runId}.md`);
	try {
		const reportPath = await exactArtifactFilePath(
			cwd,
			["evals", "reports"],
			runId,
			".md",
			"report",
		);
		await access(reportPath);
		return relativeReportPath;
	} catch (error) {
		if (missingPathError(error)) {
			throw new Error(`missing report: ${relativeReportPath}`);
		}
		throw error;
	}
}

async function curateTraceCommand(
	args: string[],
	cwd: string,
): Promise<DispatchResult> {
	const [rawPath, sanitizedName] = args;
	if (!rawPath || !sanitizedName) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: "curate-trace requires <raw-relative-path> <sanitized-name>\n",
		};
	}
	assertSafeRelativePath("raw trace path", rawPath);
	assertSafeTraceName(sanitizedName);
	const rawTracePath = await boundedPath(
		cwd,
		[".pi", "evalfly", "raw"],
		rawPath,
	);
	const content = await readFile(rawTracePath, "utf8");
	assertSanitizedTrace(content);
	const targetDir = await ensureSanitizedTraceDir(cwd);
	const targetPath = resolve(targetDir, sanitizedName);
	if (
		relative(targetDir, targetPath) === ".." ||
		relative(targetDir, targetPath).startsWith(`..${sep}`)
	) {
		throw new Error(`unsafe sanitized trace name: ${sanitizedName}`);
	}
	try {
		await access(targetPath);
		throw new Error(`sanitized trace already exists: ${sanitizedName}`);
	} catch (error) {
		if (!missingPathError(error)) {
			throw error;
		}
	}
	await writeFile(targetPath, content, { flag: "wx" });
	return {
		exitCode: 0,
		stdout: `evalfly trace curated: ${join("evals", "traces", "sanitized", sanitizedName)}\n`,
		stderr: "",
	};
}

async function normalizeTraceCommand(
	args: string[],
	cwd: string,
): Promise<DispatchResult> {
	const [rawPath, sanitizedName] = args;
	if (!rawPath || !sanitizedName) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: "normalize-trace requires <raw-relative-path> <sanitized-name>\n",
		};
	}
	assertSafeRelativePath("raw trace path", rawPath);
	assertSafeTraceName(sanitizedName);
	const rawTracePath = await boundedPath(
		cwd,
		[".pi", "evalfly", "raw"],
		rawPath,
	);
	const normalizedTrace = normalizeTraceJsonl(
		await readFile(rawTracePath, "utf8"),
	);
	return await writeSanitizedTrace(
		cwd,
		sanitizedName,
		normalizedTrace,
		"normalized",
	);
}

async function importSessionTraceCommand(
	args: string[],
	cwd: string,
): Promise<DispatchResult> {
	const [rawPath, sanitizedName] = args;
	if (!rawPath || !sanitizedName) {
		return {
			exitCode: 1,
			stdout: "",
			stderr:
				"import-session-trace requires <raw-relative-path> <sanitized-name>\n",
		};
	}
	assertSafeRelativePath("raw trace path", rawPath);
	assertSafeTraceName(sanitizedName);
	const rawTracePath = await boundedPath(
		cwd,
		[".pi", "evalfly", "raw"],
		rawPath,
	);
	const rawSession = parseRawSessionTrace(await readFile(rawTracePath, "utf8"));
	const normalizedTrace = importSessionTrace(rawSession);
	return await writeSanitizedTrace(
		cwd,
		sanitizedName,
		normalizedTrace,
		"imported",
	);
}

async function writeSanitizedTrace(
	cwd: string,
	sanitizedName: string,
	normalizedTrace: Record<string, unknown>,
	action: "normalized" | "imported",
): Promise<DispatchResult> {
	const content = `${JSON.stringify(normalizedTrace, null, 2)}\n`;
	assertSanitizedTrace(content);
	const targetDir = await ensureSanitizedTraceDir(cwd);
	const targetPath = resolve(targetDir, sanitizedName);
	if (
		relative(targetDir, targetPath) === ".." ||
		relative(targetDir, targetPath).startsWith(`..${sep}`)
	) {
		throw new Error(`unsafe sanitized trace name: ${sanitizedName}`);
	}
	try {
		await access(targetPath);
		throw new Error(`sanitized trace already exists: ${sanitizedName}`);
	} catch (error) {
		if (!missingPathError(error)) {
			throw error;
		}
	}
	await writeFile(targetPath, content, { flag: "wx" });
	return {
		exitCode: 0,
		stdout: `evalfly trace ${action}: ${join("evals", "traces", "sanitized", sanitizedName)}\n`,
		stderr: "",
	};
}

function parseRawSessionTrace(content: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed)) {
			throw new Error("expected object");
		}
		return parsed;
	} catch {
		throw new Error("invalid raw session trace: expected JSON object");
	}
}

function importSessionTrace(
	session: Record<string, unknown>,
): Record<string, unknown> {
	const traceId = optionalTraceLine("trace_id", session.trace_id);
	const sessionId = optionalTraceLine("session_id", session.session_id);
	const sliceId = optionalTraceLine("slice_id", session.slice_id);
	const baseAgent = optionalTraceLine("agent", session.agent);
	const baseModel = optionalTraceLine("model", session.model);
	const events: Record<string, unknown>[] = [];
	appendSessionEvents(
		events,
		session.messages,
		"message",
		baseAgent,
		baseModel,
	);
	appendSessionEvents(
		events,
		session.tool_calls,
		"tool_call",
		baseAgent,
		baseModel,
	);
	if (events.length === 0) {
		throw new Error("raw session trace has no messages or tool_calls");
	}
	return buildNormalizedTrace({ traceId, sessionId, sliceId, events });
}

function appendSessionEvents(
	events: Record<string, unknown>[],
	value: unknown,
	type: "message" | "tool_call",
	baseAgent: string | undefined,
	baseModel: string | undefined,
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (!Array.isArray(value)) {
		throw new Error(
			`${type === "message" ? "messages" : "tool_calls"} must be an array`,
		);
	}
	for (const item of value) {
		if (!isRecord(item)) {
			throw new Error(
				`${type === "message" ? "messages" : "tool_calls"} entries must be objects`,
			);
		}
		const merged: Record<string, unknown> = { ...item, type };
		if (baseAgent && merged.agent === undefined) {
			merged.agent = baseAgent;
		}
		if (baseModel && merged.model === undefined) {
			merged.model = baseModel;
		}
		events.push(normalizeTraceEvent(merged));
	}
}

function normalizeTraceJsonl(content: string): Record<string, unknown> {
	const events: Record<string, unknown>[] = [];
	let traceId: string | undefined;
	let sliceId: string | undefined;
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		throw new Error("raw trace is empty");
	}
	for (const [index, line] of lines.entries()) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(
				`invalid raw trace JSONL line ${index + 1}: expected JSON object`,
			);
		}
		if (!isRecord(parsed)) {
			throw new Error(
				`invalid raw trace JSONL line ${index + 1}: expected object`,
			);
		}
		const eventTraceId = optionalTraceLine("trace_id", parsed.trace_id);
		if (eventTraceId) {
			if (traceId && traceId !== eventTraceId) {
				throw new Error("raw trace contains conflicting trace_id values");
			}
			traceId = eventTraceId;
		}
		const eventSliceId = optionalTraceLine("slice_id", parsed.slice_id);
		if (eventSliceId) {
			if (sliceId && sliceId !== eventSliceId) {
				throw new Error("raw trace contains conflicting slice_id values");
			}
			sliceId = eventSliceId;
		}
		const event = normalizeTraceEvent(parsed);
		events.push(event);
	}
	return buildNormalizedTrace({ traceId, sliceId, events });
}

function buildNormalizedTrace(input: {
	traceId?: string;
	sessionId?: string;
	sliceId?: string;
	events: Record<string, unknown>[];
}): Record<string, unknown> {
	let totalCostUsd = 0;
	let totalLatencyMs = 0;
	let toolCalls = 0;
	for (const event of input.events) {
		if (event.type === "tool_call") {
			toolCalls += 1;
		}
		if (typeof event.cost_usd === "number") {
			totalCostUsd += event.cost_usd;
		}
		if (typeof event.latency_ms === "number") {
			totalLatencyMs += event.latency_ms;
		}
	}
	return {
		schema_version: "evalfly.trace.v1",
		...(input.traceId ? { trace_id: input.traceId } : {}),
		...(input.sessionId ? { session_id: input.sessionId } : {}),
		...(input.sliceId ? { slice_id: input.sliceId } : {}),
		events: input.events,
		summary: {
			events: input.events.length,
			tool_calls: toolCalls,
			total_cost_usd: Number(totalCostUsd.toFixed(6)),
			total_latency_ms: totalLatencyMs,
		},
	};
}

function normalizeTraceEvent(
	event: Record<string, unknown>,
): Record<string, unknown> {
	const toolName = optionalTraceLine("tool_name", event.tool_name);
	const type =
		optionalTraceLine("type", event.type) ??
		(toolName ? "tool_call" : "message");
	const normalized: Record<string, unknown> = { type };
	copyOptionalLine(normalized, "timestamp", event.timestamp);
	copyOptionalLine(normalized, "agent", event.agent);
	copyOptionalLine(normalized, "model", event.model);
	copyOptionalLine(normalized, "role", event.role);
	if (toolName) {
		normalized.tool_name = toolName;
	}
	copyOptionalLine(normalized, "status", event.status);
	copyOptionalLine(normalized, "sanitized_input", event.sanitized_input);
	copyOptionalLine(normalized, "sanitized_output", event.sanitized_output);
	copyOptionalLine(normalized, "verdict", event.verdict);
	copyOptionalNonNegativeNumber(normalized, "latency_ms", event.latency_ms);
	copyOptionalNonNegativeNumber(normalized, "cost_usd", event.cost_usd);
	return normalized;
}

function copyOptionalLine(
	target: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	const line = optionalTraceLine(key, value);
	if (line) {
		target[key] = line;
	}
}

function optionalTraceLine(label: string, value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}
	assertContextLine(label, value);
	return value;
}

function copyOptionalNonNegativeNumber(
	target: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${key} must be a non-negative number`);
	}
	target[key] = value;
}

async function loadConfig(cwd: string): Promise<EvalConfig> {
	const configPath = join(cwd, "evals", "config.json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(configPath, "utf8"));
	} catch (error) {
		throw new Error(
			`failed to read evals/config.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const result = validateEvalConfig(parsed);
	if (!result.ok) {
		throw new Error(
			`invalid evals/config.json:\n${formatValidationErrors(parsed, result.errors).join("\n")}`,
		);
	}
	return result.value;
}

function formatValidationErrors(config: unknown, errors: string[]): string[] {
	if (
		typeof config !== "object" ||
		config === null ||
		!Array.isArray((config as { cases?: unknown }).cases)
	) {
		return errors;
	}
	const cases = (config as { cases: unknown[] }).cases;
	return errors.map((error) => {
		const match = /^cases\[(\d+)]\.([a-z_]+) /.exec(error);
		if (!match) {
			return error;
		}
		const testCase = cases[Number(match[1])];
		if (typeof testCase !== "object" || testCase === null) {
			return error;
		}
		const received = (testCase as Record<string, unknown>)[match[2]];
		return typeof received === "string"
			? `${error} (received: ${received})`
			: error;
	});
}

function parseSuite(args: string[]): EvalSuite {
	const suiteFlag = args.indexOf("--suite");
	const suite = suiteFlag >= 0 ? args[suiteFlag + 1] : undefined;
	if (suite !== "smoke") {
		throw new Error("run requires --suite smoke");
	}
	return suite;
}

function parseOptionalFlag(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index === -1) {
		return undefined;
	}
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	assertContextLine(flag, value);
	return value;
}
function assertContextLine(label: string, value: string): void {
	if (
		value.length > CONTEXT_VALUE_MAX_LENGTH ||
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		throw new Error(`${label} must be a single line`);
	}
}

function requireContextLine(label: string, value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	assertContextLine(label, value);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function buildRunContext(
	cwd: string,
	runId: string,
	commitRange: string | undefined,
): Promise<EvalRunContext> {
	const slice = await readCurrentSpecSafeSlice(cwd);
	return {
		...(slice?.id ? { spec_slice: slice.id } : {}),
		...(slice?.sessionId ? { session_id: slice.sessionId } : {}),
		...(commitRange ? { commit_range: commitRange } : {}),
		eval_report_path: join("evals", "reports", `${runId}.md`),
	};
}

async function readCurrentSpecSafeSlice(
	cwd: string,
): Promise<{ id?: string; sessionId?: string } | undefined> {
	try {
		const statePath = join(cwd, ".pi", ".specsafe-state.json");
		const realCwd = await realpath(cwd);
		const expectedStatePath = resolve(realCwd, ".pi", ".specsafe-state.json");
		if ((await lstat(statePath)).isSymbolicLink()) {
			return undefined;
		}
		if ((await realpath(statePath)) !== expectedStatePath) {
			return undefined;
		}
		const parsed = JSON.parse(await readFile(statePath, "utf8"));
		if (
			!isRecord(parsed) ||
			!("currentSlice" in parsed) ||
			!Array.isArray(parsed.history)
		) {
			throw new Error("malformed SpecSafe state");
		}
		const slice = parsed.currentSlice;
		if (slice === null) {
			return undefined;
		}
		if (!isRecord(slice)) {
			throw new Error("malformed SpecSafe currentSlice");
		}
		return {
			id: requireContextLine("currentSlice.id", slice.id),
			sessionId: requireContextLine("currentSlice.sessionId", slice.sessionId),
		};
	} catch (error) {
		if (missingPathError(error)) {
			return undefined;
		}
		throw new Error(
			`failed to read .pi/.specsafe-state.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function evaluateCase(
	cwd: string,
	testCase: EvalCase,
): Promise<CaseResult> {
	const errors: string[] = [];
	if (testCase.judge.type !== "deterministic") {
		errors.push(`unsupported judge type: ${testCase.judge.type}`);
	} else {
		for (const assertion of testCase.judge.assertions) {
			if (assertion.type === "file_exists") {
				const unsafeReason = unsafeFileExistsPath(cwd, assertion.path);
				if (unsafeReason) {
					errors.push(unsafeReason);
					continue;
				}
				const symlinkReason = await resolvedFileExistsPathEscapesCwd(
					cwd,
					assertion.path,
				);
				if (symlinkReason) {
					errors.push(symlinkReason);
					continue;
				}
				const absolutePath = resolve(cwd, assertion.path);
				try {
					await access(absolutePath);
				} catch {
					errors.push(`missing file: ${assertion.path}`);
				}
			}
		}
	}

	return {
		case_id: testCase.case_id,
		title: testCase.title,
		risk_tier: testCase.risk_tier,
		critical: testCase.risk_tier === "critical",
		passed: errors.length === 0,
		privacy: testCase.privacy,
		errors,
	};
}

function unsafeFileExistsPath(cwd: string, path: string): string | undefined {
	if (isAbsolute(path)) {
		return `unsafe file_exists path: ${path} (file_exists path must stay within cwd)`;
	}
	const relativePath = relative(cwd, resolve(cwd, path));
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return `unsafe file_exists path: ${path} (file_exists path must stay within cwd)`;
	}
	return undefined;
}

async function resolvedFileExistsPathEscapesCwd(
	cwd: string,
	path: string,
): Promise<string | undefined> {
	const realCwd = await realpath(cwd);
	const absolutePath = resolve(cwd, path);
	let existingPath = absolutePath;
	while (true) {
		try {
			const realExistingPath = await realpath(existingPath);
			const realRelativePath = relative(realCwd, realExistingPath);
			if (
				realRelativePath === ".." ||
				realRelativePath.startsWith(`..${sep}`) ||
				isAbsolute(realRelativePath)
			) {
				return `unsafe file_exists path: ${path} (file_exists path must stay within cwd)`;
			}
			return undefined;
		} catch (error) {
			if (!missingPathError(error)) {
				return `unsafe file_exists path: ${path} (file_exists path must stay within cwd)`;
			}
			const parentPath = dirname(existingPath);
			if (parentPath === existingPath) {
				return `unsafe file_exists path: ${path} (file_exists path must stay within cwd)`;
			}
			existingPath = parentPath;
		}
	}
}

function missingPathError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

async function writeRun(cwd: string, run: RunRecord): Promise<void> {
	await ensureArtifactDir(cwd, ["evals", "runs"]);
	await writeFile(
		await artifactPath(cwd, ["evals", "runs"], run.run_id, ".json"),
		`${JSON.stringify(run, null, 2)}\n`,
	);
}

async function writeReport(cwd: string, run: RunRecord): Promise<void> {
	await ensureArtifactDir(cwd, ["evals", "reports"]);
	await writeFile(
		await artifactPath(cwd, ["evals", "reports"], run.run_id, ".md"),
		renderReport(run),
	);
}

function renderReport(run: RunRecord): string {
	const privacyStatus = run.results.every((result) => result.privacy.sanitized)
		? "sanitized"
		: "unsanitized";
	const lines = [
		`# EvalFly Report ${run.run_id}`,
		"",
		`Suite: ${run.suite}`,
		`Verdict: ${run.verdict}`,
		`Passed: ${run.summary.passed}`,
		`Failed: ${run.summary.failed}`,
		`critical_regressions: ${run.summary.critical_regressions}`,
		`Privacy: ${privacyStatus}`,
		"",
		"## Context",
		`Spec-Slice: ${run.context?.spec_slice ?? "not linked"}`,
		`Session: ${run.context?.session_id ?? "not linked"}`,
		`Commit range: ${run.context?.commit_range ?? "not linked"}`,
		`evalReportPath: ${run.context?.eval_report_path ?? join("evals", "reports", `${run.run_id}.md`)}`,
		"",
		"## Results",
	];
	for (const result of run.results) {
		lines.push(
			`- ${result.passed ? "PASS" : "FAIL"} ${result.case_id} (${result.risk_tier})${result.errors.length > 0 ? ` — ${result.errors.join("; ")}` : ""}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

function assertSafeRunId(runId: string): void {
	if (!RUN_ID_TOKEN_RE.test(runId)) {
		throw new Error(`unsafe run id: ${runId}`);
	}
}

function assertSafeRelativePath(label: string, path: string): void {
	if (isAbsolute(path) || path === "" || path.includes("\0")) {
		throw new Error(`unsafe ${label}: ${path}`);
	}
	const normalized = relative(".", path);
	if (
		normalized === ".." ||
		normalized.startsWith(`..${sep}`) ||
		isAbsolute(normalized)
	) {
		throw new Error(`unsafe ${label}: ${path}`);
	}
}

function assertSafeTraceName(name: string): void {
	if (!TRACE_NAME_RE.test(name) || name === "." || name === "..") {
		throw new Error(`unsafe sanitized trace name: ${name}`);
	}
}

function assertSanitizedTrace(content: string): void {
	for (const pattern of UNSANITIZED_TRACE_PATTERNS) {
		if (pattern.test(content)) {
			throw new Error(
				"trace appears unsanitized; keep raw traces in .pi/evalfly/raw/",
			);
		}
	}
}

async function boundedPath(
	cwd: string,
	baseParts: [string, string, string],
	relativePath: string,
): Promise<string> {
	const basePath = join(cwd, ...baseParts);
	const realCwd = await realpath(cwd);
	const expectedBasePath = resolve(realCwd, ...baseParts);
	const realBasePath = await realpath(basePath);
	if (realBasePath !== expectedBasePath) {
		throw new Error(
			`unsafe raw trace directory: ${join(...baseParts)} (raw trace directory must be ${join(...baseParts)})`,
		);
	}
	const targetPath = resolve(realBasePath, relativePath);
	const relativeTarget = relative(realBasePath, targetPath);
	if (
		relativeTarget === "" ||
		relativeTarget === ".." ||
		relativeTarget.startsWith(`..${sep}`) ||
		isAbsolute(relativeTarget)
	) {
		throw new Error(`unsafe raw trace path: ${relativePath}`);
	}
	const realTargetPath = await realpath(targetPath);
	const realRelativeTarget = relative(realBasePath, realTargetPath);
	if (
		realRelativeTarget === "" ||
		realRelativeTarget === ".." ||
		realRelativeTarget.startsWith(`..${sep}`) ||
		isAbsolute(realRelativeTarget)
	) {
		throw new Error(`unsafe raw trace path: ${relativePath}`);
	}
	return realTargetPath;
}

async function ensureSanitizedTraceDir(cwd: string): Promise<string> {
	await assertProjectEvalsDir(cwd);
	const tracesDir = await ensureExactArtifactDir(cwd, ["evals", "traces"]);
	const sanitizedDir = join(tracesDir, "sanitized");
	try {
		const realSanitizedDir = await realpath(sanitizedDir);
		await assertExactArtifactDir(
			cwd,
			["evals", "traces", "sanitized"],
			realSanitizedDir,
		);
		return realSanitizedDir;
	} catch (error) {
		if (!missingPathError(error)) {
			throw error;
		}
	}
	await mkdir(sanitizedDir);
	const realSanitizedDir = await realpath(sanitizedDir);
	await assertExactArtifactDir(
		cwd,
		["evals", "traces", "sanitized"],
		realSanitizedDir,
	);
	return realSanitizedDir;
}

async function ensureExactArtifactDir(
	cwd: string,
	artifactDirParts: readonly string[],
): Promise<string> {
	const artifactDir = join(cwd, ...artifactDirParts);
	try {
		const realArtifactDir = await realpath(artifactDir);
		await assertExactArtifactDir(cwd, artifactDirParts, realArtifactDir);
		return realArtifactDir;
	} catch (error) {
		if (!missingPathError(error)) {
			throw error;
		}
	}
	await mkdir(artifactDir);
	const realArtifactDir = await realpath(artifactDir);
	await assertExactArtifactDir(cwd, artifactDirParts, realArtifactDir);
	return realArtifactDir;
}

async function readExactArtifactDir(
	cwd: string,
	artifactDirParts: readonly string[],
): Promise<string | undefined> {
	await assertProjectEvalsDir(cwd);
	const artifactDir = join(cwd, ...artifactDirParts);
	try {
		const realArtifactDir = await realpath(artifactDir);
		await assertExactArtifactDir(cwd, artifactDirParts, realArtifactDir);
		return realArtifactDir;
	} catch (error) {
		if (missingPathError(error)) {
			return undefined;
		}
		throw error;
	}
}

async function assertExactArtifactDir(
	cwd: string,
	artifactDirParts: readonly string[],
	realArtifactDir: string,
): Promise<void> {
	const realCwd = await realpath(cwd);
	const expectedArtifactDir = resolve(realCwd, ...artifactDirParts);
	if (realArtifactDir !== expectedArtifactDir) {
		throw new Error(
			`unsafe artifact directory: ${join(...artifactDirParts)} (artifact directory must be ${join(...artifactDirParts)})`,
		);
	}
}

async function ensureArtifactDir(
	cwd: string,
	artifactDirParts: [string, string],
): Promise<void> {
	const artifactDir = join(cwd, ...artifactDirParts);
	await assertProjectEvalsDir(cwd);
	try {
		await assertArtifactDir(cwd, artifactDirParts, await realpath(artifactDir));
		return;
	} catch (error) {
		if (!missingPathError(error)) {
			throw error;
		}
	}
	await mkdir(artifactDir, { recursive: true });
	await assertArtifactDir(cwd, artifactDirParts, await realpath(artifactDir));
}

async function assertProjectEvalsDir(cwd: string): Promise<void> {
	const realCwd = await realpath(cwd);
	const realEvalsDir = await realpath(join(cwd, "evals"));
	const expectedEvalsDir = resolve(realCwd, "evals");
	if (realEvalsDir !== expectedEvalsDir) {
		throw new Error(
			"unsafe artifact directory: evals (artifact directory must be evals)",
		);
	}
}

async function assertArtifactDir(
	cwd: string,
	artifactDirParts: [string, string],
	realArtifactDir: string,
): Promise<void> {
	const realCwd = await realpath(cwd);
	const realArtifactDirRelativePath = relative(realCwd, realArtifactDir);
	if (
		realArtifactDirRelativePath === "" ||
		realArtifactDirRelativePath === ".." ||
		realArtifactDirRelativePath.startsWith(`..${sep}`) ||
		isAbsolute(realArtifactDirRelativePath)
	) {
		throw new Error(
			`unsafe artifact directory: ${join(...artifactDirParts)} (artifact directory must stay within cwd)`,
		);
	}
	const expectedArtifactDir = resolve(realCwd, ...artifactDirParts);
	if (realArtifactDir !== expectedArtifactDir) {
		throw new Error(
			`unsafe artifact directory: ${join(...artifactDirParts)} (artifact directory must be ${join(...artifactDirParts)})`,
		);
	}
}

async function artifactPath(
	cwd: string,
	artifactDirParts: [string, string],
	runId: string,
	extension: ".json" | ".md",
): Promise<string> {
	assertSafeRunId(runId);
	const artifactDir = join(cwd, ...artifactDirParts);
	await assertProjectEvalsDir(cwd);
	const realArtifactDir = await realpath(artifactDir);
	await assertArtifactDir(cwd, artifactDirParts, realArtifactDir);

	const targetPath = resolve(realArtifactDir, `${runId}${extension}`);
	const relativePath = relative(realArtifactDir, targetPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error(`unsafe run id: ${runId}`);
	}
	return targetPath;
}

async function exactArtifactFilePath(
	cwd: string,
	artifactDirParts: [string, string],
	runId: string,
	extension: ".json" | ".md",
	label: "run" | "report",
): Promise<string> {
	const targetPath = await artifactPath(
		cwd,
		artifactDirParts,
		runId,
		extension,
	);
	const relativeTargetPath = join(...artifactDirParts, `${runId}${extension}`);
	const stat = await lstat(targetPath);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new Error(`unsafe ${label} artifact: ${relativeTargetPath}`);
	}
	const realTargetPath = await realpath(targetPath);
	if (realTargetPath !== targetPath) {
		throw new Error(`unsafe ${label} artifact: ${relativeTargetPath}`);
	}
	return targetPath;
}

function defaultRunId(suite: EvalSuite, createdAt: string): string {
	return `run-${suite}-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

if (import.meta.main) {
	const result = await dispatch(process.argv.slice(2));
	if (result.stdout) {
		process.stdout.write(result.stdout);
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	process.exit(result.exitCode);
}

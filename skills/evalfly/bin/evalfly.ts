import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	EVAL_RUN_SCHEMA_VERSION,
	type EvalCase,
	type EvalConfig,
	type EvalRunContext,
	type EvalSuite,
	validateEvalConfig,
	validateEvalRun,
} from "./schema.ts";

const RUN_ID_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

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
		if (command === "report") {
			return await reportCommand(args.slice(1), cwd);
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: `unknown command: ${command ?? "(none)"}\nUsage: evalfly validate | run --suite smoke | report <run-id>\n`,
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

	return {
		exitCode: run.verdict === "pass" ? 0 : 1,
		stdout: `evalfly run ${run.run_id}: ${run.verdict}\n`,
		stderr: "",
	};
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
	return value;
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
		const parsed = JSON.parse(
			await readFile(join(cwd, ".pi", ".specsafe-state.json"), "utf8"),
		);
		const slice =
			typeof parsed === "object" && parsed !== null
				? (parsed as { currentSlice?: unknown }).currentSlice
				: undefined;
		if (typeof slice !== "object" || slice === null) {
			return undefined;
		}
		return {
			id:
				typeof (slice as { id?: unknown }).id === "string"
					? (slice as { id: string }).id
					: undefined,
			sessionId:
				typeof (slice as { sessionId?: unknown }).sessionId === "string"
					? (slice as { sessionId: string }).sessionId
					: undefined,
		};
	} catch {
		return undefined;
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

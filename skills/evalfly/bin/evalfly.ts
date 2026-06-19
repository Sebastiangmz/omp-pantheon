import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	EVAL_RUN_SCHEMA_VERSION,
	type EvalCase,
	type EvalConfig,
	type EvalSuite,
	validateEvalConfig,
} from "./schema.ts";

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

type RunRecord = {
	schema_version: typeof EVAL_RUN_SCHEMA_VERSION;
	run_id: string;
	suite: EvalSuite;
	config_name: string;
	created_at: string;
	results: CaseResult[];
	summary: {
		total: number;
		passed: number;
		failed: number;
		critical_regressions: number;
	};
	verdict: "pass" | "fail";
};

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
	const config = await loadConfig(cwd);
	const cases = config.cases.filter((testCase) => testCase.suite === suite);
	const createdAt = (opts.now?.() ?? new Date()).toISOString();
	const runId = opts.runId ?? defaultRunId(suite, createdAt);
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
	const runPath = join(cwd, "evals", "runs", `${runId}.json`);
	const run = JSON.parse(await readFile(runPath, "utf8")) as RunRecord;
	await writeReport(cwd, run);
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
	const runsDir = join(cwd, "evals", "runs");
	await mkdir(runsDir, { recursive: true });
	await writeFile(
		join(runsDir, `${run.run_id}.json`),
		`${JSON.stringify(run, null, 2)}\n`,
	);
}

async function writeReport(cwd: string, run: RunRecord): Promise<void> {
	const reportsDir = join(cwd, "evals", "reports");
	await mkdir(reportsDir, { recursive: true });
	await writeFile(join(reportsDir, `${run.run_id}.md`), renderReport(run));
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
		"## Results",
	];
	for (const result of run.results) {
		lines.push(
			`- ${result.passed ? "PASS" : "FAIL"} ${result.case_id} (${result.risk_tier})${result.errors.length > 0 ? ` — ${result.errors.join("; ")}` : ""}`,
		);
	}
	return `${lines.join("\n")}\n`;
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

export const EVAL_CONFIG_SCHEMA_VERSION = "evalfly.config.v1" as const;
export const EVAL_CASE_SCHEMA_VERSION = "evalfly.case.v1" as const;
export const EVAL_RUN_SCHEMA_VERSION = "evalfly.run.v1" as const;

export const EVAL_SUITES = ["smoke", "regression", "benchmark"] as const;
export const EVAL_RISK_TIERS = ["critical", "major", "minor"] as const;
export const EVAL_JUDGE_TYPES = ["deterministic", "llm", "human"] as const;

export type EvalSuite = (typeof EVAL_SUITES)[number];
export type EvalRiskTier = (typeof EVAL_RISK_TIERS)[number];
export type EvalJudgeType = (typeof EVAL_JUDGE_TYPES)[number];

export type EvalSource = {
	kind: string;
};

export type EvalPrivacy = {
	classification: string;
	sanitized: boolean;
};

export type EvalExpected = {
	success_criteria: string[];
};

export type FileExistsAssertion = {
	type: "file_exists";
	path: string;
};

export type DeterministicJudge = {
	type: "deterministic";
	assertions: FileExistsAssertion[];
};

export type LlmJudge = {
	type: "llm";
};

export type HumanJudge = {
	type: "human";
};

export type EvalJudge = DeterministicJudge | LlmJudge | HumanJudge;

export type EvalCase = {
	schema_version: typeof EVAL_CASE_SCHEMA_VERSION;
	case_id: string;
	title: string;
	suite: EvalSuite;
	risk_tier: EvalRiskTier;
	task_type: string;
	source: EvalSource;
	privacy: EvalPrivacy;
	expected: EvalExpected;
	judge: EvalJudge;
};

export type EvalConfig = {
	schema_version: typeof EVAL_CONFIG_SCHEMA_VERSION;
	name: string;
	cases: EvalCase[];
};

export type EvalRunSummary = {
	total: number;
	passed: number;
	failed: number;
	critical_regressions: number;
};

export type EvalRun = {
	schema_version: typeof EVAL_RUN_SCHEMA_VERSION;
	run_id: string;
	config_name: string;
	started_at: string;
	finished_at?: string;
	summary: EvalRunSummary;
};

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: string[] };

type ErrorSink = string[];

export function validateEvalConfig(value: unknown): ValidationResult<EvalConfig> {
	const errors: ErrorSink = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ["$ must be an object"] };
	}

	requireLiteral(value, "schema_version", EVAL_CONFIG_SCHEMA_VERSION, errors);
	requireString(value, "name", errors);
	if (Array.isArray(value.cases)) {
		value.cases.forEach((item, index) => validateCaseInto(item, `cases[${index}]`, errors));
	} else {
		errors.push("cases must be an array");
	}

	return finish(value, errors);
}

export function validateEvalCase(value: unknown): ValidationResult<EvalCase> {
	const errors: ErrorSink = [];
	validateCaseInto(value, "$", errors);
	return finish(value, errors);
}

export function validateEvalRun(value: unknown): ValidationResult<EvalRun> {
	const errors: ErrorSink = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ["$ must be an object"] };
	}

	requireLiteral(value, "schema_version", EVAL_RUN_SCHEMA_VERSION, errors);
	requireString(value, "run_id", errors);
	requireString(value, "config_name", errors);
	requireString(value, "started_at", errors);
	if ("finished_at" in value && value.finished_at !== undefined) {
		requireString(value, "finished_at", errors);
	}
	validateRunSummary(value.summary, "summary", errors);

	return finish(value, errors);
}

function validateCaseInto(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}

	requireLiteral(value, joinPath(path, "schema_version"), EVAL_CASE_SCHEMA_VERSION, errors);
	requireString(value, joinPath(path, "case_id"), errors);
	requireString(value, joinPath(path, "title"), errors);
	requireOneOf(value, joinPath(path, "suite"), EVAL_SUITES, errors);
	requireOneOf(value, joinPath(path, "risk_tier"), EVAL_RISK_TIERS, errors);
	requireString(value, joinPath(path, "task_type"), errors);
	validateSource(value.source, joinPath(path, "source"), errors);
	validatePrivacy(value.privacy, joinPath(path, "privacy"), errors);
	validateExpected(value.expected, joinPath(path, "expected"), errors);
	validateJudge(value.judge, joinPath(path, "judge"), errors);
}

function validateSource(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	requireString(value, joinPath(path, "kind"), errors);
}

function validatePrivacy(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	requireString(value, joinPath(path, "classification"), errors);
	requireBoolean(value, joinPath(path, "sanitized"), errors);
}

function validateExpected(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	if (!Array.isArray(value.success_criteria)) {
		errors.push(`${joinPath(path, "success_criteria")} must be an array`);
		return;
	}
	value.success_criteria.forEach((criterion, index) => {
		if (typeof criterion !== "string" || criterion.length === 0) {
			errors.push(`${joinPath(path, `success_criteria[${index}]`)} must be a non-empty string`);
		}
	});
}

function validateJudge(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	requireOneOf(value, joinPath(path, "type"), EVAL_JUDGE_TYPES, errors);
	if (value.type !== "deterministic") {
		return;
	}
	if (!Array.isArray(value.assertions)) {
		errors.push(`${joinPath(path, "assertions")} must be an array`);
		return;
	}
	value.assertions.forEach((assertion, index) => {
		validateFileExistsAssertion(assertion, joinPath(path, `assertions[${index}]`), errors);
	});
}

function validateFileExistsAssertion(
	value: unknown,
	path: string,
	errors: ErrorSink,
): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	requireLiteral(value, joinPath(path, "type"), "file_exists", errors);
	requireString(value, joinPath(path, "path"), errors);
}

function validateRunSummary(value: unknown, path: string, errors: ErrorSink): void {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	requireNonNegativeInteger(value, joinPath(path, "total"), errors);
	requireNonNegativeInteger(value, joinPath(path, "passed"), errors);
	requireNonNegativeInteger(value, joinPath(path, "failed"), errors);
	requireNonNegativeInteger(value, joinPath(path, "critical_regressions"), errors);
}

function requireString(value: Record<string, unknown>, path: string, errors: ErrorSink): void {
	const field = fieldName(path);
	if (typeof value[field] !== "string" || value[field].length === 0) {
		errors.push(`${path} must be a non-empty string`);
	}
}

function requireBoolean(value: Record<string, unknown>, path: string, errors: ErrorSink): void {
	const field = fieldName(path);
	if (typeof value[field] !== "boolean") {
		errors.push(`${path} must be a boolean`);
	}
}

function requireLiteral<T extends string>(
	value: Record<string, unknown>,
	path: string,
	expected: T,
	errors: ErrorSink,
): void {
	const field = fieldName(path);
	if (value[field] !== expected) {
		errors.push(`${path} must be ${expected}`);
	}
}

function requireOneOf<const T extends readonly string[]>(
	value: Record<string, unknown>,
	path: string,
	allowed: T,
	errors: ErrorSink,
): void {
	const field = fieldName(path);
	if (typeof value[field] !== "string" || !allowed.includes(value[field])) {
		errors.push(`${path} must be one of: ${allowed.join(", ")}`);
	}
}

function requireNonNegativeInteger(
	value: Record<string, unknown>,
	path: string,
	errors: ErrorSink,
): void {
	const field = fieldName(path);
	if (!Number.isInteger(value[field]) || (value[field] as number) < 0) {
		errors.push(`${path} must be a non-negative integer`);
	}
}

function finish<T>(value: unknown, errors: ErrorSink): ValidationResult<T> {
	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: value as T };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(base: string, field: string): string {
	return base === "$" ? field : `${base}.${field}`;
}

function fieldName(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? path : path.slice(dot + 1);
}

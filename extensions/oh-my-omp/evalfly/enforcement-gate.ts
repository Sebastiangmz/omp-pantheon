import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	type EvalRun,
	validateEvalRun,
} from "../../../skills/evalfly/bin/schema.ts";

import { readEvalFlyEnforcementState } from "../../../skills/evalfly/bin/enforcement-state.ts";

const HOOK_NAME = "evalfly-enforcement-gate";
const NO_LATEST_REPORT_REASON =
	"EvalFly enforcement is active but no latest run report was found.";
const RUN_ID_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

function hasSafeRunId(run: EvalRun): boolean {
	return RUN_ID_TOKEN_RE.test(run.run_id);
}

function assertExactArtifactDir(
	cwd: string,
	artifactDirParts: [string, string],
): string {
	const realCwd = realpathSync(cwd);
	const evalsDir = join(cwd, "evals");
	if (lstatSync(evalsDir).isSymbolicLink()) {
		throw new Error("unsafe EvalFly artifact directory");
	}
	const realEvalsDir = realpathSync(evalsDir);
	if (realEvalsDir !== resolve(realCwd, "evals")) {
		throw new Error("unsafe EvalFly artifact directory");
	}
	const artifactDir = join(cwd, ...artifactDirParts);
	const artifactDirStat = lstatSync(artifactDir);
	if (!artifactDirStat.isDirectory() || artifactDirStat.isSymbolicLink()) {
		throw new Error("unsafe EvalFly artifact directory");
	}
	const realArtifactDir = realpathSync(artifactDir);
	if (realArtifactDir !== resolve(realCwd, ...artifactDirParts)) {
		throw new Error("unsafe EvalFly artifact directory");
	}
	return realArtifactDir;
}

function exactArtifactFilePath(
	cwd: string,
	artifactDirParts: [string, string],
	runId: string,
	extension: ".json" | ".md",
	label: "run" | "report",
): string {
	if (!RUN_ID_TOKEN_RE.test(runId)) {
		throw new Error(`unsafe EvalFly ${label} artifact`);
	}
	const artifactDir = assertExactArtifactDir(cwd, artifactDirParts);
	const targetPath = resolve(artifactDir, `${runId}${extension}`);
	const relativePath = relative(artifactDir, targetPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error(`unsafe EvalFly ${label} artifact`);
	}
	const stat = lstatSync(targetPath);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new Error(`unsafe EvalFly ${label} artifact`);
	}
	const realTargetPath = realpathSync(targetPath);
	if (realTargetPath !== targetPath) {
		throw new Error(`unsafe EvalFly ${label} artifact`);
	}
	return targetPath;
}

export type EvalFlyGateResult =
	| { allowed: true }
	| { allowed: false; reason: string };

type LatestRunResult = EvalRun | "invalid" | undefined;

function canonicalReportExists(cwd: string, run: EvalRun): boolean {
	const reportPath = run.context?.eval_report_path;
	const expected = join("evals", "reports", `${run.run_id}.md`);
	if (reportPath !== expected) return false;
	if (isAbsolute(reportPath)) return false;
	try {
		exactArtifactFilePath(
			cwd,
			["evals", "reports"],
			run.run_id,
			".md",
			"report",
		);
		return true;
	} catch {
		return false;
	}
}

function readLatestRun(
	cwd: string,
	required: { suite: string; commitRange: string },
): LatestRunResult {
	const runsDir = join(cwd, "evals", "runs");
	if (!existsSync(runsDir)) return undefined;

	let runNames: string[];
	try {
		const exactRunsDir = assertExactArtifactDir(cwd, ["evals", "runs"]);
		runNames = readdirSync(exactRunsDir).filter((file) =>
			file.endsWith(".json"),
		);
	} catch {
		return "invalid";
	}

	const runs: EvalRun[] = [];
	for (const name of runNames) {
		const runId = name.slice(0, -".json".length);
		if (!RUN_ID_TOKEN_RE.test(runId)) return "invalid";
		let parsed: unknown;
		try {
			const runPath = exactArtifactFilePath(
				cwd,
				["evals", "runs"],
				runId,
				".json",
				"run",
			);
			parsed = JSON.parse(readFileSync(runPath, "utf8"));
		} catch {
			return "invalid";
		}
		const validation = validateEvalRun(parsed);
		if (!validation.ok || !hasSafeRunId(validation.value)) {
			return "invalid";
		}
		if (validation.value.run_id !== runId) {
			return "invalid";
		}
		runs.push(validation.value);
	}
	return runs
		.filter(
			(run) =>
				run.suite === required.suite &&
				run.context?.commit_range === required.commitRange,
		)
		.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function evaluateEvalFlyCompletionGate(cwd: string): EvalFlyGateResult {
	const state = readEvalFlyEnforcementState(cwd);
	if (state.mode !== "enforced") return { allowed: true };

	const latest = readLatestRun(cwd, {
		suite: state.suite ?? "",
		commitRange: state.commitRange ?? "",
	});
	if (latest === "invalid") {
		return {
			allowed: false,
			reason:
				"EvalFly enforcement is active but saved run evidence is invalid.",
		};
	}
	if (!latest || !canonicalReportExists(cwd, latest)) {
		return { allowed: false, reason: NO_LATEST_REPORT_REASON };
	}

	if (latest.verdict !== "pass") {
		return {
			allowed: false,
			reason: "EvalFly enforcement is active but the latest run did not pass.",
		};
	}

	if (latest.summary?.critical_regressions !== 0) {
		return {
			allowed: false,
			reason:
				"EvalFly enforcement is active but critical regressions are present.",
		};
	}

	return { allowed: true };
}

export function registerEvalFlyEnforcementGate(pi: ExtensionAPI): void {
	pi.on("session_stop", (_event, ctx) => {
		const cwd = (ctx as { cwd?: string } | undefined)?.cwd;
		if (!cwd) return;

		let result: EvalFlyGateResult;
		try {
			result = evaluateEvalFlyCompletionGate(cwd);
		} catch (error) {
			result = {
				allowed: false,
				reason: `EvalFly enforcement state is invalid: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		if (result.allowed) return;

		pi.logger.info(`[${HOOK_NAME}] blocking completion: ${result.reason}`);
		return {
			continue: true,
			additionalContext: `<system-directive type="evalfly-enforcement-gate">
EvalFly enforced mode is active, but this session is about to finish without valid passing evidence. Do NOT stop here.
${result.reason}
Run the required EvalFly suite, ensure the latest evals/runs/*.json verdict is pass, summary.critical_regressions is 0, and its context.eval_report_path points to an existing report before completing.
</system-directive>`,
		};
	});
}

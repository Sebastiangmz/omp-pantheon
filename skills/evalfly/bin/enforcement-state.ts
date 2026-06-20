import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export type EvalFlyEnforcementMode = "advisory" | "enforced";
export type EvalFlyEnforcementSuite = "smoke" | "regression" | "benchmark";

export type EvalFlyEnforcementState = {
	mode: EvalFlyEnforcementMode;
	suite?: EvalFlyEnforcementSuite;
	commitRange?: string;
	activatedAt?: string;
	activatedBy?: string;
	specSlice?: string;
	sessionId?: string;
};

const STATE_PATH = join(".pi", "evalfly", "enforcement.json");

export function evalFlyEnforcementStatePath(cwd: string): string {
	return join(cwd, STATE_PATH);
}

function assertInsideCwd(cwd: string, path: string): void {
	const realCwd = realpathSync(cwd);
	const realPath = realpathSync(path);
	const relativePath = relative(realCwd, realPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error("unsafe EvalFly enforcement state path");
	}
}

function assertNotSymlink(path: string): void {
	if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
		throw new Error("unsafe EvalFly enforcement state path");
	}
}

function ensureSafeStatePath(cwd: string): string {
	const path = evalFlyEnforcementStatePath(cwd);
	const piDir = join(cwd, ".pi");
	const evalflyDir = dirname(path);

	assertNotSymlink(piDir);
	assertNotSymlink(evalflyDir);
	assertNotSymlink(path);
	mkdirSync(evalflyDir, { recursive: true });
	assertInsideCwd(cwd, evalflyDir);
	assertNotSymlink(path);
	return path;
}

function readSafeStatePath(cwd: string): string | undefined {
	const path = evalFlyEnforcementStatePath(cwd);
	if (!existsSync(path)) return undefined;
	assertNotSymlink(join(cwd, ".pi"));
	assertNotSymlink(dirname(path));
	assertNotSymlink(path);
	assertInsideCwd(cwd, dirname(path));
	return path;
}

function validateEvalFlyEnforcementState(state: EvalFlyEnforcementState): void {
	if (state.mode !== "advisory" && state.mode !== "enforced") {
		throw new Error("invalid EvalFly enforcement mode");
	}
	if (state.mode === "enforced") {
		if (
			state.suite !== "smoke" &&
			state.suite !== "regression" &&
			state.suite !== "benchmark"
		) {
			throw new Error("invalid EvalFly enforcement suite");
		}
		if (
			typeof state.commitRange !== "string" ||
			state.commitRange.trim().length === 0
		) {
			throw new Error("invalid EvalFly enforcement commit range");
		}
	}
}

export function readEvalFlyEnforcementState(
	cwd: string,
): EvalFlyEnforcementState {
	const path = readSafeStatePath(cwd);
	if (!path) return { mode: "advisory" };

	const state = JSON.parse(
		readFileSync(path, "utf8"),
	) as EvalFlyEnforcementState;
	validateEvalFlyEnforcementState(state);
	return state;
}

export function writeEvalFlyEnforcementState(
	cwd: string,
	state: EvalFlyEnforcementState,
): void {
	validateEvalFlyEnforcementState(state);
	const path = ensureSafeStatePath(cwd);
	const tempPath = join(dirname(path), `.enforcement-${randomUUID()}.tmp`);
	writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	chmodSync(tempPath, 0o600);
	renameSync(tempPath, path);
	chmodSync(path, 0o600);
}

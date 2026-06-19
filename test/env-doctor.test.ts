/**
 * Black-box tests for skills/env-doctor/bin/env-doctor.ts.
 *
 * Test seam contract:
 *   - PI_ENVDOCTOR_LINEAR_CMD replaces the Linear viewer/list probe.
 *   - PI_ENVDOCTOR_GH_CMD replaces `gh auth status`.
 *   - PI_ENVDOCTOR_OMP_CMD replaces `omp --version`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const cliPath = path.resolve(
	process.cwd(),
	"skills/env-doctor/bin/env-doctor.ts",
);
const expectedChecklistKeys = ["a", "b", "c", "d", "e"] as const;

type StubName = "linear" | "gh" | "omp";

type StubSpec = {
	exitCode?: number;
	stdout?: string;
	stderr?: string;
};

type TestEnv = {
	root: string;
	cwd: string;
	home: string;
	stubs: Record<StubName, string>;
};

let envs: TestEnv[] = [];

beforeEach(() => {
	envs = [];
});

afterEach(() => {
	for (const env of envs) {
		fs.rmSync(env.root, { recursive: true, force: true });
	}
});

function cleanProcessEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (key.startsWith("LINEAR_")) continue;
		if (key.startsWith("PI_ENVDOCTOR_")) continue;
		env[key] = value;
	}
	return env;
}

function makeExecutableStub(filePath: string, spec: StubSpec = {}): string {
	const stdout = spec.stdout ?? "";
	const stderr = spec.stderr ?? "";
	const exitCode = spec.exitCode ?? 0;
	fs.writeFileSync(
		filePath,
		[
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			stdout ? `cat <<'STDOUT_EOF'` : "",
			stdout,
			stdout ? "STDOUT_EOF" : "",
			stderr ? `cat >&2 <<'STDERR_EOF'` : "",
			stderr,
			stderr ? "STDERR_EOF" : "",
			`exit ${exitCode}`,
		]
			.filter(Boolean)
			.join("\n"),
	);
	fs.chmodSync(filePath, 0o755);
	return filePath;
}

function createTestEnv(
	overrides: Partial<Record<StubName, StubSpec>> = {},
): TestEnv {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-env-doctor-"));
	const cwd = path.join(root, "repo");
	const home = path.join(root, "home");
	const stubsDir = path.join(root, "stubs");

	fs.mkdirSync(path.join(cwd, ".omp"), { recursive: true });
	fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	fs.mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
	fs.mkdirSync(stubsDir, { recursive: true });

	for (const name of ["hooks", "tools", "agents", "skills"] as const) {
		fs.mkdirSync(path.join(cwd, ".omp", name), { recursive: true });
		fs.symlinkSync(
			path.join(cwd, ".omp", name),
			path.join(home, ".omp", "agent", name),
		);
	}

	const specs: Record<StubName, StubSpec> = {
		linear: { stdout: "linear ok" },
		gh: { stdout: "gh ok" },
		omp: { stdout: "omp ok" },
		...overrides,
	};
	const stubs: Record<StubName, string> = {
		linear: makeExecutableStub(
			path.join(stubsDir, "linear-probe"),
			specs.linear,
		),
		gh: makeExecutableStub(path.join(stubsDir, "gh-probe"), specs.gh),
		omp: makeExecutableStub(path.join(stubsDir, "omp-probe"), specs.omp),
	};

	const env = { root, cwd, home, stubs };
	envs.push(env);
	return env;
}

function defaultDoctorEnv(
	testEnv: TestEnv,
	extraEnv: Record<string, string> = {},
): Record<string, string> {
	return {
		...cleanProcessEnv(),
		HOME: testEnv.home,
		LINEAR_API_KEY: "fake-linear-api-key-for-tests",
		PI_ENVDOCTOR_LINEAR_CMD: testEnv.stubs.linear,
		PI_ENVDOCTOR_GH_CMD: testEnv.stubs.gh,
		PI_ENVDOCTOR_OMP_CMD: testEnv.stubs.omp,
		...extraEnv,
	};
}

function runDoctor(
	testEnv: TestEnv,
	args: string[] = [],
	extraEnv: Record<string, string> = {},
): SpawnSyncReturns<string> {
	return spawnSync("bun", ["run", cliPath, ...args], {
		cwd: testEnv.cwd,
		env: defaultDoctorEnv(testEnv, extraEnv),
		encoding: "utf-8",
	});
}

function combinedOutput(result: SpawnSyncReturns<string>): string {
	return `${result.stdout}\n${result.stderr}`;
}

function unsetEnv(name: string): Record<string, string> {
	return { [name]: "" };
}

function writeSpecSafeState(cwd: string, content: string): void {
	const filePath = path.join(cwd, ".pi", ".specsafe-state.json");
	fs.writeFileSync(filePath, content, { mode: 0o600 });
}

describe("[unit] env-doctor CLI", () => {
	test("all configured probes pass", () => {
		const env = createTestEnv();

		const result = runDoctor(env);
		const output = combinedOutput(result);

		expect(result.status).toBe(0);
		expect(output).toContain("LINEAR_API_KEY: PASS");
		expect(output).toContain("gh auth: PASS");
		expect(output).toContain("omp config: PASS");
		expect(output).toContain("agent symlinks: PASS");
		expect(output).toContain("SpecSafe state: SKIP");
	});

	test("missing LINEAR_API_KEY in default mode skips", () => {
		const env = createTestEnv();

		const result = runDoctor(env, [], unsetEnv("LINEAR_API_KEY"));

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("LINEAR_API_KEY: SKIP");
	});

	test("strict mode turns missing LINEAR_API_KEY into failure", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--strict"], unsetEnv("LINEAR_API_KEY"));

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("LINEAR_API_KEY: FAIL");
	});

	test("failing gh auth exits 1", () => {
		const env = createTestEnv({ gh: { exitCode: 1, stderr: "not logged in" } });

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("gh auth: FAIL");
	});

	test("failing omp probe exits 1", () => {
		const env = createTestEnv({ omp: { exitCode: 1, stderr: "no omp" } });

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("omp config: FAIL");
	});

	test("broken agent symlink exits 1", () => {
		const env = createTestEnv();
		fs.rmSync(path.join(env.home, ".omp", "agent", "skills"));

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("agent symlinks: FAIL");
	});

	test("valid SpecSafe state passes", () => {
		const env = createTestEnv();
		writeSpecSafeState(
			env.cwd,
			JSON.stringify({ currentSlice: null, history: [] }),
		);

		const result = runDoctor(env);

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("SpecSafe state: PASS");
	});

	test("corrupt SpecSafe state fails", () => {
		const env = createTestEnv();
		writeSpecSafeState(env.cwd, "{not json");

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("SpecSafe state: FAIL");
	});

	test("strict mode turns absent SpecSafe state into failure", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--strict"]);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("SpecSafe state: FAIL");
	});

	test("json emits a-e checklist fields", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--json"]);

		expect(result.status).toBe(0);
		const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual([...expectedChecklistKeys]);
	});

	test("API key values are redacted from output", () => {
		const env = createTestEnv({
			linear: {
				exitCode: 1,
				stderr: "bad key fake-linear-redaction-secret rejected",
			},
		});

		const result = runDoctor(env, [], {
			LINEAR_API_KEY: "fake-linear-redaction-secret",
		});
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("LINEAR_API_KEY: FAIL");
		expect(output).not.toContain("fake-linear-redaction-secret");
	});

	test("unknown CLI flag exits 2", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--definitely-not-a-real-flag"]);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain("unknown flag");
	});
});

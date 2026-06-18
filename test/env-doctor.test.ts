/**
 * Black-box tests for skills/env-doctor/bin/env-doctor.ts.
 *
 * Test seam contract for the implementer:
 *   - PI_ENVDOCTOR_HONCHO_PROBE_CMD replaces the Honcho SDK round-trip probe.
 *   - PI_ENVDOCTOR_LINEAR_CMD replaces the Linear viewer/list probe.
 *   - PI_ENVDOCTOR_GH_CMD replaces `gh auth status`.
 *   - PI_ENVDOCTOR_OMP_CMD replaces `omp config get`.
 *
 * When any of these env vars is set, env-doctor must spawn that executable first
 * instead of reaching the real network or host tool. These tests intentionally use
 * temp HOME/cwd directories and stub executables only; they must never touch the
 * operator's real ~/.omp/agent, .pi/.honcho-state.json, registry, or audit logs.
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
const expectedChecklistKeys = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

type StubName = "honcho" | "linear" | "gh" | "omp";

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
		if (key.startsWith("HONCHO_")) continue;
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
		honcho: { stdout: "honcho ok" },
		linear: { stdout: "linear ok" },
		gh: { stdout: "gh ok" },
		omp: { stdout: "omp ok" },
		...overrides,
	};
	const stubs: Record<StubName, string> = {
		honcho: makeExecutableStub(
			path.join(stubsDir, "honcho-probe"),
			specs.honcho,
		),
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
		HONCHO_API_KEY: "fake-honcho-api-key-for-tests",
		HONCHO_WORKSPACE_ID: "ws-test",
		HONCHO_SESSION_ID: "sess-test",
		HONCHO_PEER_ID: "peer-test",
		LINEAR_API_KEY: "fake-linear-api-key-for-tests",
		PI_ENVDOCTOR_HONCHO_PROBE_CMD: testEnv.stubs.honcho,
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

function writeHonchoState(cwd: string, content: string): void {
	const filePath = path.join(cwd, ".pi", ".honcho-state.json");
	fs.writeFileSync(filePath, content, { mode: 0o600 });
}

function writeAgentHonchoConfig(home: string, content: string): void {
	const filePath = path.join(home, ".omp", "agent", "honcho.json");
	fs.writeFileSync(filePath, content, { mode: 0o600 });
}

describe("[unit] env-doctor CLI", () => {
	test("T-a full env and passing probes exits 0 and reports HONCHO_API_KEY PASS", () => {
		const env = createTestEnv();

		const result = runDoctor(env);

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("HONCHO_API_KEY: PASS");
	});

	test("T-b missing HONCHO_API_KEY exits 1, reports FAIL, and continues through later checks", () => {
		const env = createTestEnv();

		const result = runDoctor(env, [], unsetEnv("HONCHO_API_KEY"));
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("HONCHO_API_KEY: FAIL");
		expect(output).toContain("gh auth:");
		expect(output).toContain("omp config:");
	});

	test("T-c missing LINEAR_API_KEY in default mode exits 0 and reports SKIP", () => {
		const env = createTestEnv();

		const result = runDoctor(env, [], unsetEnv("LINEAR_API_KEY"));

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("LINEAR_API_KEY: SKIP");
	});

	test("T-d --strict turns missing LINEAR_API_KEY from SKIP into FAIL and exits 1", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--strict"], unsetEnv("LINEAR_API_KEY"));

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("LINEAR_API_KEY: FAIL");
	});

	test("T-e failing gh auth stub exits 1 and reports gh auth FAIL", () => {
		const env = createTestEnv({ gh: { exitCode: 1, stderr: "not logged in" } });

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("gh auth: FAIL");
	});

	test("T-f failing omp config stub exits 1 and reports omp config FAIL", () => {
		const env = createTestEnv({
			omp: { exitCode: 1, stderr: "missing config" },
		});

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("omp config: FAIL");
	});

	test("T-g agent symlink check resolves fake HOME links into cwd .omp directories", () => {
		const env = createTestEnv();

		const result = runDoctor(env);

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("agent symlinks: PASS");
	});

	test("T-g agent symlink check fails when a symlink resolves outside cwd .omp", () => {
		const env = createTestEnv();
		fs.rmSync(path.join(env.home, ".omp", "agent", "hooks"));
		const elsewhere = path.join(env.root, "elsewhere", ".omp", "hooks");
		fs.mkdirSync(elsewhere, { recursive: true });
		fs.symlinkSync(elsewhere, path.join(env.home, ".omp", "agent", "hooks"));

		const result = runDoctor(env);

		expect(result.status).toBe(1);
		expect(combinedOutput(result)).toContain("agent symlinks: FAIL");
	});

	test("T-h valid .pi/.honcho-state.json passes the state-file check", () => {
		const env = createTestEnv();
		writeHonchoState(
			env.cwd,
			JSON.stringify({ currentSlice: null, history: [] }),
		);

		const result = runDoctor(env);

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("honcho state: PASS");
	});

	test("T-h invalid .pi/.honcho-state.json fails with a parse error message", () => {
		const env = createTestEnv();
		writeHonchoState(env.cwd, "{not valid json");

		const result = runDoctor(env);
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("honcho state: FAIL");
		expect(output.toLowerCase()).toContain("parse");
	});

	test("T-h agent honcho config passes when present, 0600, and parseable", () => {
		const env = createTestEnv();
		writeAgentHonchoConfig(
			env.home,
			JSON.stringify({ workspaceId: "ws-test" }),
		);

		const result = runDoctor(env);

		expect(result.status).toBe(0);
		expect(combinedOutput(result)).toContain("agent honcho config: PASS");
	});

	test("T-h agent honcho config fails when present but not parseable", () => {
		const env = createTestEnv();
		writeAgentHonchoConfig(env.home, "{not valid json");

		const result = runDoctor(env);
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("agent honcho config: FAIL");
		expect(output.toLowerCase()).toContain("parse");
	});

	test("T-i honcho probe 401-style failure exits 1 and reports HONCHO_API_KEY FAIL", () => {
		const env = createTestEnv({
			honcho: { exitCode: 1, stderr: "401 unauthorized" },
		});

		const result = runDoctor(env);
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("HONCHO_API_KEY: FAIL");
		expect(output).toContain("401");
	});

	test("T-i honcho probe session-not-found stdout is PASS with an auth-ok note", () => {
		const env = createTestEnv({ honcho: { stdout: "session-not-found" } });

		const result = runDoctor(env);
		const output = combinedOutput(result);

		expect(result.status).toBe(0);
		expect(output).toContain("HONCHO_API_KEY: PASS");
		expect(output).toContain("auth OK");
		expect(output).toContain("session not found");
	});

	test("T-j --json emits parseable checklist fields with status and optional note", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--json"]);

		expect(result.status).toBe(0);
		const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
		for (const key of expectedChecklistKeys) {
			expect(parsed).toContainKey(key);
			const item = parsed[key] as { status?: unknown; note?: unknown };
			expect(["PASS", "FAIL", "SKIP"]).toContain(String(item.status));
			if ("note" in item) {
				expect(typeof item.note).toBe("string");
			}
		}
	});

	test("T-k API key values are redacted from stdout and stderr", () => {
		const env = createTestEnv({
			honcho: {
				exitCode: 1,
				stderr: "bad key fake-honcho-redaction-secret rejected",
			},
		});

		const result = runDoctor(env, [], {
			HONCHO_API_KEY: "fake-honcho-redaction-secret",
		});
		const output = combinedOutput(result);

		expect(result.status).toBe(1);
		expect(output).toContain("HONCHO_API_KEY: FAIL");
		expect(output).not.toContain("fake-honcho-redaction-secret");
	});

	test("T-l unknown CLI flag exits 2", () => {
		const env = createTestEnv();

		const result = runDoctor(env, ["--definitely-not-a-real-flag"]);

		expect(result.status).toBe(2);
	});
});

import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	evalFlyEnforcementStatePath,
	readEvalFlyEnforcementState,
	writeEvalFlyEnforcementState,
} from "../skills/evalfly/bin/enforcement-state";

function withTempProject(run: (cwd: string) => void): void {
	const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-state-"));
	try {
		run(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

describe("EvalFly enforcement state", () => {
	test("is advisory when no state file exists", () => {
		withTempProject((cwd) => {
			expect(evalFlyEnforcementStatePath(cwd)).toBe(
				join(cwd, ".pi", "evalfly", "enforcement.json"),
			);
			expect(readEvalFlyEnforcementState(cwd)).toEqual({ mode: "advisory" });
		});
	});

	test("persists enforced mode with suite, commit range, timestamps, and scope", () => {
		withTempProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
				activatedAt: "2026-06-20T00:00:00.000Z",
				activatedBy: "evalfly enforce start",
				specSlice: "SPEC-20260620-001",
				sessionId: "session-123",
			});

			expect(readEvalFlyEnforcementState(cwd)).toEqual({
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
				activatedAt: "2026-06-20T00:00:00.000Z",
				activatedBy: "evalfly enforce start",
				specSlice: "SPEC-20260620-001",
				sessionId: "session-123",
			});
			expect(statSync(evalFlyEnforcementStatePath(cwd)).mode & 0o777).toBe(
				0o600,
			);
		});
	});

	test("advisory state disables enforcement", () => {
		withTempProject((cwd) => {
			writeEvalFlyEnforcementState(cwd, { mode: "advisory" });

			expect(readEvalFlyEnforcementState(cwd)).toEqual({ mode: "advisory" });
		});
	});

	test("rejects invalid modes when writing", () => {
		withTempProject((cwd) => {
			expect(() =>
				writeEvalFlyEnforcementState(cwd, { mode: "mandatory" } as never),
			).toThrow("invalid EvalFly enforcement mode");
		});
	});

	test("rejects enforced mode without required evidence scope", () => {
		withTempProject((cwd) => {
			expect(() =>
				writeEvalFlyEnforcementState(cwd, {
					mode: "enforced",
					suite: "smoke",
				}),
			).toThrow("invalid EvalFly enforcement commit range");

			expect(() =>
				writeEvalFlyEnforcementState(cwd, {
					mode: "enforced",
					suite: "smoke",
					commitRange: "   ",
				}),
			).toThrow("invalid EvalFly enforcement commit range");

			expect(() =>
				writeEvalFlyEnforcementState(cwd, {
					mode: "enforced",
					commitRange: "main..HEAD",
				} as never),
			).toThrow("invalid EvalFly enforcement suite");
		});
	});

	test("rejects persisted enforced state without required evidence scope", () => {
		withTempProject((cwd) => {
			const path = evalFlyEnforcementStatePath(cwd);
			mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
			writeFileSync(
				path,
				`${JSON.stringify({
					mode: "enforced",
					suite: "",
					commitRange: "",
				})}\n`,
			);

			expect(() => readEvalFlyEnforcementState(cwd)).toThrow(
				"invalid EvalFly enforcement suite",
			);
		});
	});

	test("rejects invalid modes when reading persisted state", () => {
		withTempProject((cwd) => {
			const path = evalFlyEnforcementStatePath(cwd);
			mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
			writeFileSync(path, `${JSON.stringify({ mode: "mandatory" })}\n`);

			expect(() => readEvalFlyEnforcementState(cwd)).toThrow(
				"invalid EvalFly enforcement mode",
			);
		});
	});

	test("tightens permissions when rewriting existing state", () => {
		withTempProject((cwd) => {
			const path = evalFlyEnforcementStatePath(cwd);
			mkdirSync(join(cwd, ".pi", "evalfly"), { recursive: true });
			writeFileSync(path, `${JSON.stringify({ mode: "advisory" })}\n`, {
				mode: 0o644,
			});
			chmodSync(path, 0o644);

			writeEvalFlyEnforcementState(cwd, {
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});

			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(readEvalFlyEnforcementState(cwd)).toEqual({
				mode: "enforced",
				suite: "smoke",
				commitRange: "main..HEAD",
			});
		});
	});

	test("rejects symlinked state path components", () => {
		withTempProject((cwd) => {
			const outside = mkdtempSync(join(tmpdir(), "evalfly-enforce-outside-"));
			try {
				mkdirSync(join(cwd, ".pi"), { recursive: true });
				symlinkSync(outside, join(cwd, ".pi", "evalfly"));

				expect(() =>
					writeEvalFlyEnforcementState(cwd, {
						mode: "enforced",
						suite: "smoke",
						commitRange: "main..HEAD",
					}),
				).toThrow("unsafe EvalFly enforcement state path");
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		});
	});
});

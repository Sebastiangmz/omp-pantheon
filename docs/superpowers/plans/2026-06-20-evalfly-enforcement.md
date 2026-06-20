# EvalFly Enforced Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build explicit opt-in EvalFly enforcement for OMP without changing the default advisory behavior.

**Architecture:** Keep the current default as safe advisory mode. Add a project-local enforcement state file, slash command / CLI activation, capture hooks, and a pre-completion gate that blocks only when enforcement is explicitly active for the current project and commit range. CI enforcement stays a separate opt-in installer because GitHub billing/branch-protection availability depends on repo visibility and plan.

**Tech Stack:** OMP extension hooks in `extensions/oh-my-omp`, EvalFly CLI in `skills/evalfly/bin/evalfly.ts`, local state under `.pi/evalfly/`, GitHub Actions templates under `skills/evalfly/templates/github-actions/`, tests with Bun.

---

## Current baseline

Already implemented:

- EvalFly methodology skill: `skills/evaluation-flywheel/SKILL.md`.
- EvalFly CLI: `validate`, `run`, `check`, `latest`, `list`, `summary`, `compare`, `report`, `traces`, `audit-traces`, `curate-trace`, `normalize-trace`, `import-session-trace`.
- Project eval template: `skills/evalfly/templates/evals/`.
- Bootstrap opt-in: `bootstrap --with-evalfly`.
- Agent contracts for `spec-writer`, `test-writer`, `implementer`, `validator`, `reviewer`.
- Read-only SpecSafe linkage inside EvalFly runs.
- Optional non-blocking `evalfly-advisor` hook.
- Advisory and required GitHub Actions templates.
- Privacy guardrails for sanitized traces.

Implemented by this plan:

- Explicit enforced-mode state machine.
- Lifecycle/tool/agent trace capture hooks.
- Pre-completion enforcement gate.
- Automatic enforcement run/report validation.
- Local slash command to start/stop/status/explain enforcement.

Still outside this local-enforcement slice:

- CI installer/configurator and branch-protection automation.
- Automatic trace-to-eval candidate promotion.
- Run-level cost/latency/model comparison.
---

## File structure

Create or modify these units:

- Modify: `docs/evalfly/README.md`, `docs/evalfly/modes.md`, `docs/evalfly/manual-cli.md`, `docs/evalfly/artifacts-and-traces.md`, `docs/evalfly/enforcement-roadmap.md` — user-facing enforced-mode documentation.
- Create: `skills/evalfly/bin/enforcement-state.ts` — vendorable read/write project-local enforcement state.
- Create: `extensions/oh-my-omp/evalfly/enforcement-gate.ts` — checks whether a project may complete while enforcement is active.
- Create: `extensions/oh-my-omp/evalfly/trace-buffer.ts` — in-memory/session trace collector with explicit sanitization boundaries.
- Modify: `extensions/oh-my-omp/index.ts` — register enforced-mode hooks after tests prove default behavior unchanged.
- Create: `commands/evalfly-enforce.md` — slash command UX for `start`, `status`, `stop`, `explain`.
- Modify: `skills/evalfly/bin/evalfly.ts` — add `enforce status/start/stop/explain` using the vendorable state module.
- Create: `test/evalfly-enforcement-state.test.ts` — state-machine tests.
- Create: `test/evalfly-enforcement-gate.test.ts` — blocking/non-blocking gate tests.
- Create: `test/evalfly-trace-capture-hook.test.ts` — capture hooks are opt-in and redact/drop raw fields.
- Create: `test/evalfly-enforce-command.test.ts` — slash-command text and CLI behavior.
- Create: `skills/evalfly/templates/github-actions/evalfly-install-required-gate.md` — documentation for CI installer constraints.

Do not mutate global `~/.omp` state during implementation tests. Use temporary project directories.

---

### Task 1: Enforcement state model

**Files:**
- Create: `skills/evalfly/bin/enforcement-state.ts`
- Test: `test/evalfly-enforcement-state.test.ts`

- [ ] **Step 1: Write failing tests for explicit inactive default**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readEvalFlyEnforcementState,
  writeEvalFlyEnforcementState,
} from "../skills/evalfly/bin/enforcement-state";

describe("EvalFly enforcement state", () => {
  test("is inactive when no state file exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-state-"));
    try {
      expect(readEvalFlyEnforcementState(cwd)).toEqual({ mode: "advisory" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/evalfly-enforcement-state.test.ts`

Expected: FAIL because `enforcement-state` module does not exist.

- [ ] **Step 3: Implement minimal state reader/writer**

Create `skills/evalfly/bin/enforcement-state.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type EvalFlyEnforcementMode = "advisory" | "enforced";

export type EvalFlyEnforcementState = {
  mode: EvalFlyEnforcementMode;
  suite?: "smoke" | "regression" | "benchmark";
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

export function readEvalFlyEnforcementState(cwd: string): EvalFlyEnforcementState {
  const path = evalFlyEnforcementStatePath(cwd);
  if (!existsSync(path)) return { mode: "advisory" };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EvalFlyEnforcementState;
  if (parsed.mode !== "advisory" && parsed.mode !== "enforced") {
    throw new Error("invalid EvalFly enforcement mode");
  }
  return parsed;
}

export function writeEvalFlyEnforcementState(
  cwd: string,
  state: EvalFlyEnforcementState,
): void {
  if (state.mode !== "advisory" && state.mode !== "enforced") {
    throw new Error("invalid EvalFly enforcement mode");
  }
  const path = evalFlyEnforcementStatePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
```

- [ ] **Step 4: Add tests for start/stop state**

Extend the test:

```ts
test("persists enforced mode with suite and commit range", () => {
  const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-state-"));
  try {
    writeEvalFlyEnforcementState(cwd, {
      mode: "enforced",
      suite: "smoke",
      commitRange: "main..HEAD",
      activatedAt: "2026-06-20T00:00:00.000Z",
      activatedBy: "command",
    });
    expect(readEvalFlyEnforcementState(cwd)).toEqual({
      mode: "enforced",
      suite: "smoke",
      commitRange: "main..HEAD",
      activatedAt: "2026-06-20T00:00:00.000Z",
      activatedBy: "command",
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("advisory state disables enforcement", () => {
  const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-state-"));
  try {
    writeEvalFlyEnforcementState(cwd, { mode: "advisory" });
    expect(readEvalFlyEnforcementState(cwd)).toEqual({ mode: "advisory" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/evalfly-enforcement-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/evalfly/bin/enforcement-state.ts test/evalfly-enforcement-state.test.ts
git commit -m "Add EvalFly enforcement state"
```

---

### Task 2: Explicit activation command UX

**Files:**
- Create: `commands/evalfly-enforce.md`
- Modify: `skills/evalfly/bin/evalfly.ts`
- Test: `test/evalfly-enforce-command.test.ts`

- [ ] **Step 1: Write failing tests for CLI subcommands**

Create `test/evalfly-enforce-command.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../skills/evalfly/bin/evalfly";

describe("evalfly enforce command", () => {
  test("reports advisory when enforcement is inactive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-command-"));
    try {
      const result = await dispatch(["enforce", "status"], { cwd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("EvalFly enforcement: advisory");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("starts enforced mode explicitly", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-enforce-command-"));
    try {
      const result = await dispatch([
        "enforce",
        "start",
        "--suite",
        "smoke",
        "--commit-range",
        "main..HEAD",
      ], { cwd, now: () => new Date("2026-06-20T00:00:00.000Z") });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("EvalFly enforcement enabled");
      const status = await dispatch(["enforce", "status"], { cwd });
      expect(status.stdout).toContain("suite: smoke");
      expect(status.stdout).toContain("commit range: main..HEAD");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/evalfly-enforce-command.test.ts`

Expected: FAIL because `enforce` is unknown.

- [ ] **Step 3: Add `enforce` dispatch and state calls**

Modify `skills/evalfly/bin/evalfly.ts`:

```ts
if (command === "enforce") {
  return enforceCommand(args.slice(1), cwd, opts);
}
```

Add helper:

```ts
async function enforceCommand(
  args: string[],
  cwd: string,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const subcommand = args[0];
  if (subcommand === "status") {
    const state = readEvalFlyEnforcementState(cwd);
    const lines = [`EvalFly enforcement: ${state.mode}`];
    if (state.suite) lines.push(`suite: ${state.suite}`);
    if (state.commitRange) lines.push(`commit range: ${state.commitRange}`);
    return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  }
  if (subcommand === "start") {
    const suite = parseSuite(args.slice(1));
    const commitRange = parseOptionalFlag(args.slice(1), "--commit-range");
    writeEvalFlyEnforcementState(cwd, {
      mode: "enforced",
      suite,
      ...(commitRange ? { commitRange } : {}),
      activatedAt: (opts.now?.() ?? new Date()).toISOString(),
      activatedBy: "evalfly enforce start",
    });
    return {
      exitCode: 0,
      stdout: `EvalFly enforcement enabled\nsuite: ${suite}\n${commitRange ? `commit range: ${commitRange}\n` : ""}`,
      stderr: "",
    };
  }
  if (subcommand === "stop") {
    writeEvalFlyEnforcementState(cwd, { mode: "advisory" });
    return { exitCode: 0, stdout: "EvalFly enforcement disabled\n", stderr: "" };
  }
  return {
    exitCode: 1,
    stdout: "",
    stderr: "enforce requires status, start, or stop\n",
  };
}
```

- [ ] **Step 4: Write slash command documentation**

Create `commands/evalfly-enforce.md`:

```markdown
---
description: Enable, inspect, or disable explicit EvalFly enforcement for this project.
---

# /evalfly-enforce

Use this command when a change is load-bearing and you want EvalFly evidence to become mandatory for completion.

Modes:

- `/evalfly-enforce status` — show current mode.
- `/evalfly-enforce start --suite smoke --commit-range main..HEAD` — enable enforced mode.
- `/evalfly-enforce stop` — return to advisory mode.
- `/evalfly-enforce explain` — explain what enforced mode blocks.

Enforced mode is opt-in. It is not the default OMP behavior.
```

- [ ] **Step 5: Run tests**

Run: `bun test test/evalfly-enforce-command.test.ts test/evalfly-enforcement-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add commands/evalfly-enforce.md skills/evalfly/bin/evalfly.ts test/evalfly-enforce-command.test.ts
git commit -m "Add EvalFly enforcement command"
```

---

### Task 3: Pre-completion enforcement gate

**Files:**
- Create: `extensions/oh-my-omp/evalfly/enforcement-gate.ts`
- Modify: `extensions/oh-my-omp/index.ts`
- Test: `test/evalfly-enforcement-gate.test.ts`

- [ ] **Step 1: Write failing gate tests**

Create `test/evalfly-enforcement-gate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateEvalFlyCompletionGate } from "../extensions/oh-my-omp/evalfly/enforcement-gate";
import { writeEvalFlyEnforcementState } from "../skills/evalfly/bin/enforcement-state";

describe("EvalFly completion gate", () => {
  test("allows completion in advisory mode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-gate-"));
    try {
      expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({ allowed: true });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("blocks enforced mode without report evidence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-gate-"));
    try {
      writeEvalFlyEnforcementState(cwd, { mode: "enforced", suite: "smoke" });
      expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({
        allowed: false,
        reason: "EvalFly enforcement is active but no passing latest run report was found.",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/evalfly-enforcement-gate.test.ts`

Expected: FAIL because `enforcement-gate` module does not exist.

- [ ] **Step 3: Implement gate over latest run JSON**

Create `extensions/oh-my-omp/evalfly/enforcement-gate.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readEvalFlyEnforcementState } from "./enforcement-state";

export type EvalFlyGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function evaluateEvalFlyCompletionGate(cwd: string): EvalFlyGateResult {
  const state = readEvalFlyEnforcementState(cwd);
  if (state.mode !== "enforced") return { allowed: true };

  const runsDir = join(cwd, "evals", "runs");
  if (!existsSync(runsDir)) {
    return {
      allowed: false,
      reason: "EvalFly enforcement is active but no passing latest run report was found.",
    };
  }

  const latest = readdirSync(runsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(runsDir, name), "utf8")) as Record<string, unknown>)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

  if (!latest || latest.verdict !== "pass") {
    return {
      allowed: false,
      reason: "EvalFly enforcement is active but no passing latest run report was found.",
    };
  }

  const summary = latest.summary as Record<string, unknown> | undefined;
  if (!summary || summary.critical_regressions !== 0) {
    return {
      allowed: false,
      reason: "EvalFly enforcement is active but critical regressions are present.",
    };
  }

  return { allowed: true };
}
```

- [ ] **Step 4: Add passing-report test**

Extend gate test:

```ts
test("allows enforced mode with passing latest run", () => {
  const cwd = mkdtempSync(join(tmpdir(), "evalfly-gate-"));
  try {
    writeEvalFlyEnforcementState(cwd, { mode: "enforced", suite: "smoke" });
    mkdirSync(join(cwd, "evals", "runs"), { recursive: true });
    writeFileSync(join(cwd, "evals", "runs", "run-smoke.json"), JSON.stringify({
      created_at: "2026-06-20T00:00:00.000Z",
      verdict: "pass",
      summary: { critical_regressions: 0 },
    }));
    expect(evaluateEvalFlyCompletionGate(cwd)).toEqual({ allowed: true });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Register hook only after API is stable**

Modify `extensions/oh-my-omp/index.ts` to register a completion/stop hook that calls `evaluateEvalFlyCompletionGate(ctx.cwd)` and returns a blocking system message only when `{ allowed: false }`.

- [ ] **Step 6: Run tests**

Run: `bun test test/evalfly-enforcement-gate.test.ts test/evalfly-advisor-hook.test.ts`

Expected: PASS and advisor remains non-blocking when no enforcement state exists.

- [ ] **Step 7: Commit**

```bash
git add extensions/oh-my-omp/evalfly/enforcement-gate.ts extensions/oh-my-omp/index.ts test/evalfly-enforcement-gate.test.ts
git commit -m "Add EvalFly completion gate"
```

---

### Task 4: Trace capture hooks

**Files:**
- Create: `extensions/oh-my-omp/evalfly/trace-buffer.ts`
- Modify: `extensions/oh-my-omp/index.ts`
- Test: `test/evalfly-trace-capture-hook.test.ts`

- [ ] **Step 1: Write failing tests for opt-in trace capture**

Create `test/evalfly-trace-capture-hook.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvalFlyTraceEvent, readEvalFlyTraceBuffer } from "../extensions/oh-my-omp/evalfly/trace-buffer";
import { writeEvalFlyEnforcementState } from "../skills/evalfly/bin/enforcement-state";

describe("EvalFly trace buffer", () => {
  test("does not capture when enforcement is inactive", () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-trace-"));
    try {
      appendEvalFlyTraceEvent(cwd, { type: "tool", content: "secret" });
      expect(readEvalFlyTraceBuffer(cwd)).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("drops raw content fields when enforcement is active", () => {
    const cwd = mkdtempSync(join(tmpdir(), "evalfly-trace-"));
    try {
      writeEvalFlyEnforcementState(cwd, { mode: "enforced", suite: "smoke" });
      appendEvalFlyTraceEvent(cwd, {
        type: "tool",
        tool_name: "read",
        content: "raw payload",
        sanitized_input: "read README.md",
      });
      expect(readEvalFlyTraceBuffer(cwd)).toEqual([
        { type: "tool", tool_name: "read", sanitized_input: "read README.md" },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/evalfly-trace-capture-hook.test.ts`

Expected: FAIL because `trace-buffer` module does not exist.

- [ ] **Step 3: Implement sanitized buffer**

Create `extensions/oh-my-omp/evalfly/trace-buffer.ts`:

```ts
import { readEvalFlyEnforcementState } from "./enforcement-state";

const buffers = new Map<string, Record<string, unknown>[]>();
const RAW_KEYS = new Set(["input", "output", "content"]);

export function appendEvalFlyTraceEvent(cwd: string, event: Record<string, unknown>): void {
  if (readEvalFlyEnforcementState(cwd).mode !== "enforced") return;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (RAW_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  const existing = buffers.get(cwd) ?? [];
  existing.push(sanitized);
  buffers.set(cwd, existing);
}

export function readEvalFlyTraceBuffer(cwd: string): Record<string, unknown>[] {
  return buffers.get(cwd) ?? [];
}

export function clearEvalFlyTraceBuffer(cwd: string): void {
  buffers.delete(cwd);
}
```

- [ ] **Step 4: Register lifecycle/tool hooks conservatively**

Modify `extensions/oh-my-omp/index.ts` only after tests pass. Register capture points that store metadata and sanitized fields only. Do not store raw prompt, raw tool output, or file contents.

- [ ] **Step 5: Run tests**

Run: `bun test test/evalfly-trace-capture-hook.test.ts test/evalfly-advisor-hook.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/oh-my-omp/evalfly/trace-buffer.ts extensions/oh-my-omp/index.ts test/evalfly-trace-capture-hook.test.ts
git commit -m "Add opt-in EvalFly trace buffer"
```

---

### Task 5: CI enforcement installer plan

**Files:**
- Create: `docs/evalfly/ci-enforcement.md`
- Create: `skills/evalfly/templates/github-actions/evalfly-install-required-gate.md`

- [ ] **Step 1: Document GitHub cost and availability boundaries**

Create `docs/evalfly/ci-enforcement.md` with these facts:

```markdown
# EvalFly CI Enforcement

EvalFly CI enforcement is separate from local enforced mode.

GitHub Actions cost boundary:

- Public repositories: standard GitHub-hosted runners are free.
- Private repositories on GitHub Free: included minutes apply, commonly 2,000 minutes/month.
- EvalFly deterministic checks do not consume LLM tokens unless a future workflow explicitly calls an LLM API.
- Larger runners and macOS runners may cost more.

Branch protection boundary:

- Public repositories on GitHub Free can use branch protection.
- Private repositories on GitHub Free generally cannot use branch protection.
- Private repositories need GitHub Pro, Team, or Enterprise for protected branches/rulesets.
```

- [ ] **Step 2: Document automation design**

Append:

```markdown
Automation should be explicit and approval-gated:

1. Copy `skills/evalfly/templates/github-actions/evalfly-required-gate.yml` to `.github/workflows/evalfly-required-gate.yml`.
2. Run it once and verify the check name is `EvalFly required gate`.
3. Configure branch protection or rulesets to require that check.
4. Never configure branch protection without an explicit `--i-approve` style confirmation.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/evalfly/ci-enforcement.md skills/evalfly/templates/github-actions/evalfly-install-required-gate.md
git commit -m "Document EvalFly CI enforcement"
```

---

### Task 6: Final verification

**Files:**
- All changed files from prior tasks.

- [ ] **Step 1: Run targeted EvalFly tests**

Run:

```bash
bun test \
  test/evalfly-enforcement-state.test.ts \
  test/evalfly-enforce-command.test.ts \
  test/evalfly-enforcement-gate.test.ts \
  test/evalfly-trace-capture-hook.test.ts \
  test/evalfly-advisor-hook.test.ts \
  skills/evalfly/test/evalfly.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full repo verification**

Run:

```bash
bun run typecheck
bun run test
bun run format:check
```

Expected: PASS.

- [ ] **Step 3: Manual smoke in a temp project**

Run:

```bash
TMPDIR=$(mktemp -d)
cp -R skills/evalfly/templates/evals "$TMPDIR/evals"
printf '# smoke\n' > "$TMPDIR/README.md"
(
  cd "$TMPDIR" && \
  bun run /Users/sebastian/.omp/omp-pantheon/skills/evalfly/bin/evalfly.ts enforce start --suite smoke --commit-range main..HEAD && \
  bun run /Users/sebastian/.omp/omp-pantheon/skills/evalfly/bin/evalfly.ts check --suite smoke --commit-range main..HEAD && \
  bun run /Users/sebastian/.omp/omp-pantheon/skills/evalfly/bin/evalfly.ts enforce status
)
rm -rf "$TMPDIR"
```

Expected:

```txt
EvalFly enforcement enabled
evalfly check ... pass
EvalFly enforcement: enforced
```

- [ ] **Step 4: Verify default OMP behavior remains advisory**

Run:

```bash
OMP_TEST_NO_COLOR=1 omp -p --no-session --max-time=30 "/omomomo"
```

Expected: output still describes EvalFly as opt-in/advisory unless explicitly enabled.

- [ ] **Step 5: Commit final docs if needed**

```bash
git add docs/evalfly commands/evalfly-enforce.md skills/evalfly/README.md skills/evaluation-flywheel/SKILL.md
git commit -m "Document EvalFly enforced mode"
```

---

## Self-review

Spec coverage:

- Explicit opt-in activation: Tasks 1-2.
- Default advisory remains safe: Tasks 1, 3, 4, 6.
- Mandatory local gate when active: Task 3.
- Trace capture only when active: Task 4.
- CI enforcement as separate opt-in path: Task 5.
- Documentation for users from zero: Task 5 plus existing docs update.

Known deliberate exclusions for this plan:

- No default global enforcement.
- No automatic LLM judge execution.
- No automatic branch-protection mutation without a separate approval-gated command.
- No raw payload storage in trace capture.

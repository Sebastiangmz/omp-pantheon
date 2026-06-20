# EvalFly enforcement roadmap

This document explains what still needs to be built to turn the current EvalFly evidence stack into real enforcement.

---

## Current state

EvalFly currently provides:

- methodology skill;
- agent contracts;
- deterministic CLI runner;
- manual gate command;
- run/report evidence;
- trace curation/import/audit tooling;
- optional advisory hook;
- optional GitHub Actions templates;
- privacy guardrails.

This is useful, but it is not real enforcement.

Real enforcement means:

> if EvalFly evidence is required and missing/failing, the harness blocks completion or the PR cannot merge.

---

## Design principle

Enforcement should be explicit, not default.

Default OMP remains advisory/manual so daily work is not made heavy by accident.

A user or project should explicitly activate enforcement when the extra guarantees are worth the friction.

Expected future command:

```bash
evalfly enforce start --suite smoke --commit-range main..HEAD
```

Expected future slash command:

```txt
/evalfly-enforce start --suite smoke --commit-range main..HEAD
```

---

## Why not default enforcement?

Default global enforcement can break the development harness itself:

- every small task becomes slower;
- missing eval config can block unrelated work;
- a broken hook can block OMP completion;
- new projects may not have meaningful evals yet;
- private trace handling needs careful boundaries;
- GitHub Actions/branch protection availability differs by repo and plan.

The safer model is:

1. Advisory by default.
2. Manual evidence available now.
3. Explicit local enforced mode when requested.
4. Explicit CI enforcement when repo settings support it.

---

## Local enforced mode: not implemented yet

Local enforced mode should add these components:

### 1. Enforcement state

Project-local file:

```txt
.pi/evalfly/enforcement.json
```

Example:

```json
{
  "mode": "enforced",
  "suite": "smoke",
  "commitRange": "main..HEAD",
  "activatedAt": "2026-06-20T00:00:00.000Z",
  "activatedBy": "evalfly enforce start",
  "specSlice": "CUR-123",
  "sessionId": "session-abc"
}
```

This state makes enforcement explicit and reversible.

### 2. Activation/status/stop commands

Future CLI:

```bash
evalfly enforce status
evalfly enforce start --suite smoke --commit-range main..HEAD
evalfly enforce stop
```

Future slash command:

```txt
/evalfly-enforce status
/evalfly-enforce start --suite smoke --commit-range main..HEAD
/evalfly-enforce stop
```

### 3. Pre-completion gate

When enforcement is active, OMP should block completion unless:

- latest relevant EvalFly run exists;
- report path exists;
- verdict is `pass`;
- critical regressions are `0`;
- required suite matches the active state;
- commit range or SpecSafe slice matches current work when configured;
- trace audit passes when sanitized traces changed.

### 4. Trace capture hooks

When enforcement is active, OMP should capture sanitized metadata from lifecycle/tool/agent events.

The capture layer must not store raw payloads. It should only store safe fields such as:

- timestamp;
- event type;
- agent;
- model;
- tool name;
- status;
- verdict;
- latency;
- cost;
- explicit `sanitized_input` / `sanitized_output` when available.

Raw `input`, `output`, and `content` must be dropped or never captured.

### 5. Final evidence packet

When enforcement is active, completion should produce or require:

```txt
evals/runs/<run-id>.json
evals/reports/<run-id>.md
evals/traces/sanitized/<trace-id>.json
```

The final answer should cite:

- run id;
- report path;
- suite;
- verdict;
- critical regression count;
- trace audit status;
- SpecSafe slice/session if linked.

---

## CI enforced mode: partially implemented

Already present:

```txt
skills/evalfly/templates/github-actions/evalfly-required-gate.yml
```

This workflow runs:

```bash
bun run skills/evalfly/bin/evalfly.ts check --suite smoke --commit-range "$COMMIT_RANGE"
```

What remains:

1. Copy workflow into target repo.
2. Verify the workflow passes.
3. Configure branch protection/ruleset to require `EvalFly required gate`.
4. Make this automation approval-gated.

Branch protection is not always available:

- public repos on GitHub Free: available;
- private repos on GitHub Free: generally unavailable;
- private repos on GitHub Pro/Team/Enterprise: available.

GitHub Actions cost boundary:

- public repos: standard GitHub-hosted runners are free;
- private repos on Free: included minutes apply;
- EvalFly deterministic checks do not consume LLM tokens;
- future LLM judges would have separate API/token cost if enabled.

---

## What enforcement should not do

Enforced mode should not:

- become default globally;
- block projects without explicit activation;
- store raw traces;
- claim privacy proof;
- auto-configure GitHub branch protection without explicit approval;
- make LLM judges mandatory before deterministic evals are mature;
- mutate SpecSafe state with large EvalFly payloads.

---

## Implementation plan

Detailed implementation steps are in:

```txt
docs/superpowers/plans/2026-06-20-evalfly-enforcement.md
```

The plan builds enforcement incrementally:

1. State model.
2. Activation commands.
3. Completion gate.
4. Trace capture buffer.
5. CI enforcement docs/installer path.
6. Full verification.

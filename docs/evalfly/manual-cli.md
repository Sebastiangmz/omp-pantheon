# EvalFly manual CLI

EvalFly manual usage means a user or agent explicitly runs `evalfly` commands from a project root.

It is called “manual” because the current OMP harness does not force the commands to run. Manual EvalFly still produces real evidence; it just depends on the workflow choosing to invoke it.

---

## Project requirements

A project needs an `evals/config.json` file.

The template lives at:

```txt
skills/evalfly/templates/evals/
```

The template shape is:

```txt
evals/
  config.json
  cases/example-smoke.json
  rubrics/README.md
  runs/.gitkeep
  reports/.gitkeep
  traces/sanitized/.gitkeep
```

Current limitation: `evalfly` reads cases embedded in `evals/config.json`. The standalone `evals/cases/` directory is present as a future-friendly structure, but automatic case discovery from that directory is not implemented yet.

---

## Command path

From a project that has installed `omp-pantheon`, use:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts <command>
```

When developing inside this repository, use:

```bash
bun run skills/evalfly/bin/evalfly.ts <command>
```

---

## Commands

### `validate`

```bash
evalfly validate
```

Checks `evals/config.json` against the current EvalFly schema.

Use it before running a suite.

Output example:

```txt
evalfly config valid: EvalFly template smoke suite
```

Fails when:

- `evals/config.json` is missing;
- schema version is wrong;
- required fields are missing;
- judge/case/privacy fields are invalid.

---

### `run --suite <suite>`

```bash
evalfly run --suite smoke
```

Runs cases from the selected suite and writes evidence:

```txt
evals/runs/<run-id>.json
evals/reports/<run-id>.md
```

Supported suites today:

```txt
smoke
regression
benchmark
```

Current runtime support:

- deterministic `file_exists` assertions execute;
- LLM judge cases are schema-valid metadata but unsupported at runtime;
- human judge cases are schema-valid metadata but unsupported at runtime.

---

### `check --suite <suite>`

```bash
evalfly check --suite smoke --commit-range main..HEAD
```

Runs the suite and exits nonzero if the verdict fails.

This is the strongest current manual gate.

Use it when a PR/handoff needs explicit evidence.

It writes the same artifacts as `run` and prints the report path.

Output example:

```txt
evalfly check run-smoke-20260620081937: pass
report: evals/reports/run-smoke-20260620081937.md
```

Important: by itself this only gates the workflow that invokes it. To make OMP block completion locally, activate enforced mode with `evalfly enforce start`.


### `enforce status/start/stop`

```bash
evalfly enforce status
evalfly enforce start --suite smoke --commit-range main..HEAD
evalfly enforce stop
```

Controls explicit local enforcement.

`status` shows whether the project is currently advisory or enforced.

`start` writes:

```txt
.pi/evalfly/enforcement.json
```

After `start`, OMP's local `session_stop` gate blocks completion unless the latest saved EvalFly run:

- validates as `evalfly.run.v1`;
- matches the enforced suite;
- matches the enforced commit range when configured;
- has verdict `pass`;
- has `critical_regressions: 0`;
- points to its canonical report path `evals/reports/<run-id>.md`.

`stop` writes advisory state and returns the project to non-blocking mode.

Enforced mode is project-local. It is not a global OMP switch and does not configure GitHub branch protection.

---

### `latest`

```bash
evalfly latest
```

Shows the newest saved run.

Useful in handoffs and reviews.

Output example:

```txt
latest evalfly run: run-smoke-20260620081937
verdict: pass
suite: smoke
report: evals/reports/run-smoke-20260620081937.md
```

---

### `list`

```bash
evalfly list
```

Lists saved runs newest-first with their report paths.

Use it when you need to find a baseline run or audit recent evidence.

---

### `summary`

```bash
evalfly summary
```

Summarizes saved runs:

- total runs;
- passing runs;
- failing runs;
- total critical regressions;
- latest run;
- latest verdict;
- latest suite;
- latest report;
- latest SpecSafe slice if linked;
- latest commit range if provided.

Use it when the reviewer needs the current evidence packet.

---

### `compare <baseline-run-id> <after-run-id>`

```bash
evalfly compare run-smoke-before run-smoke-after
```

Compares two saved runs.

It reports deltas for:

- total cases;
- passed cases;
- failed cases;
- critical regressions.

It exits nonzero when:

- the after run has any critical regression;
- the after run has more failed cases than baseline;
- critical regression count worsens.

Current limitation: compare does not yet calculate semantic score percentages, cost deltas, latency deltas, model changes, or new eval count.

---

### `report <run-id>`

```bash
evalfly report run-smoke-20260620081937
```

Regenerates the Markdown report from the saved run JSON.

Use it when:

- the report was deleted accidentally;
- report formatting changed;
- a reviewer wants the human-readable evidence restored.

---

### `traces`

```bash
evalfly traces
```

Lists committed sanitized trace fixtures under:

```txt
evals/traces/sanitized/
```

It prints file paths and sizes. It does not inspect raw content and does not prove privacy.

It fails if no sanitized traces are present. That is expected: an empty template project has no trace evidence yet.

---

### `audit-traces`

```bash
evalfly audit-traces
```

Reads committed sanitized trace JSON and reports:

- number of traces;
- number of privacy issues;
- number of curation candidates.

Privacy issues are blocking and include:

- invalid JSON;
- raw `input`, `output`, or `content` fields;
- obvious secret/PII patterns such as bearer tokens, API keys, private keys, emails, local paths, private URLs, and localhost/private-network URLs.

Curation candidates are non-blocking and include:

- high cost: `summary.total_cost_usd >= 0.05`;
- high latency: `summary.total_latency_ms >= 60000`;
- events missing both `sanitized_input` and `sanitized_output`.

A passing audit is a guardrail, not a privacy proof.

---

### `curate-trace <raw-relative-path> <sanitized-name>`

```bash
evalfly curate-trace failing-session.json sanitized-failing-session.json
```

Copies a manually minimized raw trace from:

```txt
.pi/evalfly/raw/<raw-relative-path>
```

into:

```txt
evals/traces/sanitized/<sanitized-name>
```

It performs path containment checks and blocks obvious unsanitized content.

It does not automatically redact. You must manually minimize and sanitize before using it.

---

### `normalize-trace <raw-relative-path> <sanitized-name>`

```bash
evalfly normalize-trace session.jsonl sanitized-session.json
```

Reads local JSONL under `.pi/evalfly/raw/` and writes a normalized trace under `evals/traces/sanitized/`.

It whitelists metadata and explicit sanitized evidence fields:

- `trace_id`;
- `slice_id`;
- agent/model/tool metadata;
- status/verdict;
- cost/latency metadata;
- `sanitized_input`;
- `sanitized_output`.

It drops raw `input`, `output`, and `content` fields.

---

### `import-session-trace <raw-relative-path> <sanitized-name>`

```bash
evalfly import-session-trace session.json sanitized-session.json
```

Imports a sanitized session JSON object from `.pi/evalfly/raw/` into EvalFly trace format.

It maps:

- `messages[]`;
- `tool_calls[]`.

It preserves safe metadata:

- `trace_id`;
- `session_id`;
- `slice_id`;
- agent;
- model;
- tool name;
- cost;
- latency;
- verdict.

It drops raw `input`, `output`, and `content`.

---

## Manual workflow examples

### Basic smoke evidence

```bash
evalfly validate
evalfly check --suite smoke --commit-range main..HEAD
evalfly latest
```

Use this for a PR that needs one current EvalFly report.

### Baseline vs after

```bash
evalfly check --suite smoke --commit-range main..HEAD
# save run id from output
# make change
evalfly check --suite smoke --commit-range main..HEAD
evalfly compare <baseline-run-id> <after-run-id>
```

Use this when the reviewer needs proof that the after state did not regress versus a baseline.

### Trace fixture review

```bash
evalfly normalize-trace raw-session.jsonl sanitized-session.json
evalfly traces
evalfly audit-traces
```

Use this when trace evidence was added or changed.

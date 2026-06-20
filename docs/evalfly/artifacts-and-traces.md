# EvalFly artifacts and traces

EvalFly evidence is split into machine-readable runs, human-readable reports, and optional sanitized traces.

---

## Artifact tree

A project using EvalFly has this structure:

```txt
evals/
  config.json
  cases/
  rubrics/
  runs/
  reports/
  traces/
    sanitized/
.pi/
  evalfly/
    raw/
```

Version-control rule:

- Commit `evals/config.json`, eval cases, rubrics, runs, reports, and sanitized traces when they are useful review evidence.
- Do not commit `.pi/evalfly/raw/`.
- Do not commit raw traces, raw prompts, raw tool outputs, credentials, or PII.

---

## Run JSON

A run JSON is the machine-readable record of an EvalFly execution.

Path:

```txt
evals/runs/<run-id>.json
```

It records:

- schema version;
- run id;
- suite;
- config name;
- timestamp;
- optional context;
- result per eval case;
- summary counts;
- verdict.

Current summary fields:

```json
{
  "total": 1,
  "passed": 1,
  "failed": 0,
  "critical_regressions": 0
}
```

Current verdict values:

```txt
pass
fail
```

A run fails when at least one case fails. A critical regression is a failed case whose risk tier is `critical`.

---

## Report path

The report path is the location of the human-readable Markdown report for a run.

Format:

```txt
evals/reports/<run-id>.md
```

Example:

```txt
evals/reports/run-smoke-20260620081937.md
```

Agents should cite this path in handoffs, validation packets, and reviews when EvalFly evidence matters.

A report contains:

- suite;
- verdict;
- passed count;
- failed count;
- critical regression count;
- privacy status;
- SpecSafe slice if available;
- session id if available;
- commit range if provided;
- result list.

Current limitation: reports are intentionally minimal. They do not yet include rich dashboards, cost deltas, latency deltas, model comparisons, or a narrative of what changed.

---

## Regressions

A regression is a behavior that used to pass and now fails.

EvalFly currently models this through case results and compare output.

Example baseline:

```txt
passed: 5
failed: 0
critical_regressions: 0
```

Example after run:

```txt
passed: 4
failed: 1
critical_regressions: 1
```

This means a critical behavior protected by EvalFly broke.

`evalfly compare <baseline> <after>` exits nonzero when:

- after has any critical regression;
- failed count worsens;
- critical regression count worsens.

Current limitation: EvalFly does not yet compute nuanced quality scores or semantic LLM judging results. It compares deterministic pass/fail counts.

---

## Trace

A trace is a structured record of an execution or interaction that may help explain why an eval exists.

A sanitized EvalFly trace may include:

- trace id;
- session id;
- SpecSafe slice id;
- agent name;
- model name;
- role;
- tool name;
- status;
- verdict;
- cost metadata;
- latency metadata;
- `sanitized_input`;
- `sanitized_output`.

A sanitized trace must not include raw:

- `input`;
- `output`;
- `content`;
- secrets;
- credentials;
- user identifiers;
- private URLs;
- local absolute paths;
- unnecessary payloads.

---

## Raw vs sanitized traces

Raw traces belong only in local scratch:

```txt
.pi/evalfly/raw/
```

Sanitized traces belong in versionable evidence:

```txt
evals/traces/sanitized/
```

Raw traces may contain sensitive data. Sanitized traces are minimized examples that can support review or regression cases.

A sanitized trace is still not automatically safe. The tools catch obvious problems, not every possible leak.

---

## Trace audit

`evalfly audit-traces` reads committed sanitized trace JSON and reports privacy issues and curation candidates.

Privacy issues are blocking:

- invalid JSON;
- raw `input`, `output`, or `content` fields;
- obvious bearer/API/private-key patterns;
- email addresses;
- local absolute paths;
- private/local URLs.

Curation candidates are not automatically blocking:

- high cost: `summary.total_cost_usd >= 0.05`;
- high latency: `summary.total_latency_ms >= 60000`;
- event missing both `sanitized_input` and `sanitized_output`.

The audit answers:

> “Does this committed sanitized trace have obvious problems?”

It does not answer:

> “Is this trace guaranteed privacy-safe?”

---

## Retention policy

Raw files under `.pi/evalfly/raw/` are temporary local scratch. Delete them after producing the sanitized artifact or report.

Keep committed sanitized traces only while they serve one of these purposes:

- protect an active eval case;
- reproduce a current regression;
- document an active reviewer decision.

Remove sanitized traces when their eval case/report is removed or superseded.

---

## SpecSafe linkage

When `.pi/.specsafe-state.json` has an open current slice, `evalfly run` and `evalfly check` copy these fields into the run/report:

- `currentSlice.id`;
- `currentSlice.sessionId`.

EvalFly does not mutate SpecSafe state. It links by reference.

This keeps SpecSafe focused on slice lifecycle and keeps EvalFly evidence in `evals/`.

# evalfly

`evalfly` is the opt-in CLI for the Evaluation Flywheel contract MVP. It validates a project-local `evals/config.json`, runs deterministic suites, and writes run/report evidence under `evals/runs/` and `evals/reports/`.

For a beginner-oriented explanation of EvalFly modes, manual CLI usage, artifacts, traces, and future enforcement work, start with `docs/evalfly/README.md`.

## Templates

Copy the evals template into a project that needs evaluation evidence:

```bash
cp -R skills/evalfly/templates/evals ./evals
```

The template includes:

```text
evals/
  config.json
  cases/example-smoke.json
  rubrics/README.md
  runs/.gitkeep
  reports/.gitkeep
  traces/sanitized/.gitkeep
```

Two optional GitHub Actions templates live under `skills/evalfly/templates/github-actions/`. `evalfly-check.yml` is deliberately manual (`workflow_dispatch`) and `continue-on-error: true`; copy it only into a repository that vendors `skills/evalfly/` and wants advisory CI evidence. `evalfly-required-gate.yml` is a blocking pull-request template; copy it only after the project intentionally chooses EvalFly as a required check and then configure branch protection to require `EvalFly required gate`.

`evals/config.json` is the file read by the evalfly CLI. Keep any standalone files in `evals/cases/` synchronized with the cases embedded in `config.json` until a later loader supports case discovery.

## Adoption checklist

For a project that wants EvalFly evidence:

1. Copy `skills/evalfly/templates/evals/` to the project root as `evals/`.
2. Edit `evals/config.json` so the smoke suite covers the smallest deterministic regression that matters.
3. Keep raw private traces under ignored `.pi/evalfly/raw/`; commit only minimized sanitized fixtures under `evals/traces/sanitized/`.
4. Run `validate`, then `check --suite smoke --commit-range <base>..<head>` before citing EvalFly evidence in a PR or handoff.
5. Cite `summary`, `latest`, `list`, or `compare` output with the markdown report path. Use `compare <baseline-run-id> <after-run-id>` when a review needs baseline-to-after regression evidence. Do not claim EvalFly blocks merges unless the project explicitly copies the required-gate workflow or otherwise wires `check` into its own protected workflow.

## Commands

Run commands from the project root that contains `evals/config.json`. After installing `omp-pantheon`, use the installed skill path from any project:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts validate
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts check --suite smoke [--commit-range main..HEAD]
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts latest
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts list
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts summary
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts traces
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts audit-traces
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts compare <baseline-run-id> <after-run-id>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts report <run-id>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts curate-trace <raw-relative-path> <sanitized-name>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts normalize-trace <raw-relative-path> <sanitized-name>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts import-session-trace <raw-relative-path> <sanitized-name>
```

When developing this bundle itself, the repo-local path also works:

```bash
bun run skills/evalfly/bin/evalfly.ts validate
bun run skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run skills/evalfly/bin/evalfly.ts check --suite smoke [--commit-range main..HEAD]
bun run skills/evalfly/bin/evalfly.ts latest
bun run skills/evalfly/bin/evalfly.ts list
bun run skills/evalfly/bin/evalfly.ts report <run-id>
bun run skills/evalfly/bin/evalfly.ts summary
bun run skills/evalfly/bin/evalfly.ts traces
bun run skills/evalfly/bin/evalfly.ts audit-traces
bun run skills/evalfly/bin/evalfly.ts compare <baseline-run-id> <after-run-id>
bun run skills/evalfly/bin/evalfly.ts curate-trace <raw-relative-path> <sanitized-name>
bun run skills/evalfly/bin/evalfly.ts normalize-trace <raw-relative-path> <sanitized-name>
bun run skills/evalfly/bin/evalfly.ts import-session-trace <raw-relative-path> <sanitized-name>
```

- `validate` checks `evals/config.json` against the current schema.
- `run --suite smoke` executes deterministic cases in the smoke suite and writes `evals/runs/<run-id>.json` plus `evals/reports/<run-id>.md`.
- `run --suite smoke --commit-range main..HEAD` adds the commit range to the run context. When `.pi/.specsafe-state.json` has an open `currentSlice`, evalfly also copies `currentSlice.id` and `currentSlice.sessionId` into the run/report by reference without mutating SpecSafe state.
- `check --suite smoke` is the explicit local gate command: it validates config, runs the smoke suite, writes the same run/report evidence, prints the report path, and exits nonzero on a failing verdict. It is not wired into hooks, CI, or merges unless a project chooses to call it.
- `latest` reads `evals/runs/*.json`, validates saved run records, and prints the newest run id, verdict, suite, and report path for handoff or review.
- `list` reads `evals/runs/*.json`, validates saved run records, and prints all runs newest-first with canonical report paths for review triage.
- `summary` reads saved runs, validates them, and prints aggregate run counts, critical regressions, latest context, and the latest canonical report path.
- `traces` indexes committed sanitized fixtures under `evals/traces/sanitized/` without reading raw traces or file contents.
- `audit-traces` reads committed sanitized trace JSON under `evals/traces/sanitized/`, fails on privacy issues such as raw `input`, `output`, or `content` fields and obvious secret patterns, and reports non-blocking curation candidates for high cost (`total_cost_usd >= 0.05`), high latency (`total_latency_ms >= 60000`), or missing sanitized event evidence.
- `compare <baseline-run-id> <after-run-id>` validates saved run records and prints baseline-to-after deltas for total, passed, failed, and critical regressions. It exits nonzero if the after run has any critical regression or worsens failed/critical counts versus baseline.
- `report <run-id>` regenerates the markdown report from a saved run JSON.
- `curate-trace <raw-relative-path> <sanitized-name>` copies a local trace from ignored `.pi/evalfly/raw/` into `evals/traces/sanitized/` only after deterministic checks for path safety and obvious unsanitized content. It does not capture traces and does not redact automatically.
- `normalize-trace <raw-relative-path> <sanitized-name>` reads local JSONL from ignored `.pi/evalfly/raw/`, writes a normalized JSON trace under `evals/traces/sanitized/`, and whitelists only trace metadata plus `sanitized_input` / `sanitized_output`. It drops raw `input`, `output`, and `content` fields instead of redacting them.
- `import-session-trace <raw-relative-path> <sanitized-name>` reads a sanitized session JSON object from ignored `.pi/evalfly/raw/`, maps `messages[]` and `tool_calls[]` into the same normalized trace schema, preserves safe `trace_id`, `session_id`, `slice_id`, agent/model/tool/cost/latency/verdict metadata, and drops raw `input`, `output`, and `content` fields.

## Experimental judge metadata

`judge.type: "human"` is schema-valid only with a non-empty `rubric` and optional `reviewer`. Keep detailed rubric notes in `evals/rubrics/`, name the evidence a reviewer must inspect, and archive the decision in the PR or handoff; Evalfly records human-judge cases as unsupported at runtime and does not execute human judgment.

`judge.type: "llm"` is schema-valid only with a non-empty `rubric` and optional `model`. Evalfly records LLM-judge cases as unsupported at runtime; it does not call models, require LLM judges, or treat them as enforcement.

## Privacy boundary

Do not version raw traces. Keep raw local material in ignored `.pi/evalfly/raw/`. Commit only sanitized fixtures under `evals/traces/sanitized/`, and mark cases as `privacy.sanitized: true` only after removing secrets, credentials, user identifiers, private URLs, and unnecessary payloads.

Use `curate-trace` only after you have manually minimized the trace to the smallest evidence needed for review. The command blocks obvious leaks, but passing it is not a privacy proof.

Before review or release, run `audit-traces` when sanitized trace fixtures changed. Treat any privacy issue as blocking. Treat high-cost/high-latency/missing-evidence candidates as a curation queue: minimize the fixture, split it into a smaller case, or explain why that trace is intentionally retained.

Retention policy: raw files under `.pi/evalfly/raw/` are local scratch only and should be deleted after a sanitized artifact or report is committed. Keep committed sanitized traces only while they protect a live eval, reproduce a current regression, or document an active reviewer decision; prune stale traces when their eval case is removed or superseded.

## Current scope

Evalfly is evidence tooling, not ambient enforcement. The contract MVP does not install CI gates, blocking hook enforcement, automatic raw trace capture, required LLM-as-judge execution, or external-memory dependencies. Projects that deliberately want CI enforcement can copy `templates/github-actions/evalfly-required-gate.yml` and configure branch protection themselves. The optional `evalfly-advisor` extension hook is inactive unless a project opts in with `.pi/evalfly/hints-enabled` and `evals/config.json`; it only injects non-blocking reminder context.

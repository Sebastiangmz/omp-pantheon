# evalfly

`evalfly` is the opt-in CLI for the Evaluation Flywheel contract MVP. It validates a project-local `evals/config.json`, runs deterministic suites, and writes run/report evidence under `evals/runs/` and `evals/reports/`.

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

The optional GitHub Actions example lives at `skills/evalfly/templates/github-actions/evalfly-check.yml`. It is deliberately manual (`workflow_dispatch`) and `continue-on-error: true`; copy it only into a repository that vendors `skills/evalfly/` and wants advisory CI evidence.

`evals/config.json` is the file read by the evalfly CLI. Keep any standalone files in `evals/cases/` synchronized with the cases embedded in `config.json` until a later loader supports case discovery.

## Commands

Run commands from the project root that contains `evals/config.json`. After installing `omp-pantheon`, use the installed skill path from any project:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts validate
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts check --suite smoke [--commit-range main..HEAD]
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts latest
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts report <run-id>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts curate-trace <raw-relative-path> <sanitized-name>
```

When developing this bundle itself, the repo-local path also works:

```bash
bun run skills/evalfly/bin/evalfly.ts validate
bun run skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run skills/evalfly/bin/evalfly.ts check --suite smoke [--commit-range main..HEAD]
bun run skills/evalfly/bin/evalfly.ts latest
bun run skills/evalfly/bin/evalfly.ts report <run-id>
bun run skills/evalfly/bin/evalfly.ts curate-trace <raw-relative-path> <sanitized-name>
```

- `validate` checks `evals/config.json` against the current schema.
- `run --suite smoke` executes deterministic cases in the smoke suite and writes `evals/runs/<run-id>.json` plus `evals/reports/<run-id>.md`.
- `run --suite smoke --commit-range main..HEAD` adds the commit range to the run context. When `.pi/.specsafe-state.json` has an open `currentSlice`, evalfly also copies `currentSlice.id` and `currentSlice.sessionId` into the run/report by reference without mutating SpecSafe state.
- `check --suite smoke` is the explicit local gate command: it validates config, runs the smoke suite, writes the same run/report evidence, prints the report path, and exits nonzero on a failing verdict. It is not wired into hooks, CI, or merges unless a project chooses to call it.
- `latest` reads `evals/runs/*.json`, validates saved run records, and prints the newest run id, verdict, suite, and report path for handoff or review.
- `report <run-id>` regenerates the markdown report from a saved run JSON.
- `curate-trace <raw-relative-path> <sanitized-name>` copies a local trace from ignored `.pi/evalfly/raw/` into `evals/traces/sanitized/` only after deterministic checks for path safety and obvious unsanitized content. It does not capture traces and does not redact automatically.

## Privacy boundary

Do not version raw traces. Keep raw local material in ignored `.pi/evalfly/raw/`. Commit only sanitized fixtures under `evals/traces/sanitized/`, and mark cases as `privacy.sanitized: true` only after removing secrets, credentials, user identifiers, private URLs, and unnecessary payloads.

Use `curate-trace` only after you have manually minimized the trace to the smallest evidence needed for review. The command blocks obvious leaks, but passing it is not a privacy proof.

## Current scope

Evalfly is evidence tooling, not enforcement. The contract MVP does not add CI gates, blocking hook enforcement, automatic raw trace capture, LLM-judge requirements, or external-memory dependencies. The optional `evalfly-advisor` extension hook is inactive unless a project opts in with `.pi/evalfly/hints-enabled` and `evals/config.json`; it only injects non-blocking reminder context.

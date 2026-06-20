# evalfly

`evalfly` is the opt-in CLI for the Evaluation Flywheel contract MVP. It validates a project-local `evals/config.json`, runs deterministic suites, and writes run/report evidence under `evals/runs/` and `evals/reports/`.

## Template

Copy the template into a project that needs evaluation evidence:

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

`evals/config.json` is the file read by the evalfly CLI. Keep any standalone files in `evals/cases/` synchronized with the cases embedded in `config.json` until a later loader supports case discovery.

## Commands

Run commands from the project root that contains `evals/config.json`. After installing `omp-pantheon`, use the installed skill path from any project:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts validate
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts report <run-id>
```

When developing this bundle itself, the repo-local path also works:

```bash
bun run skills/evalfly/bin/evalfly.ts validate
bun run skills/evalfly/bin/evalfly.ts run --suite smoke [--commit-range main..HEAD]
bun run skills/evalfly/bin/evalfly.ts report <run-id>
```

- `validate` checks `evals/config.json` against the current schema.
- `run --suite smoke` executes deterministic cases in the smoke suite and writes `evals/runs/<run-id>.json` plus `evals/reports/<run-id>.md`.
- `run --suite smoke --commit-range main..HEAD` adds the commit range to the run context. When `.pi/.specsafe-state.json` has an open `currentSlice`, evalfly also copies `currentSlice.id` and `currentSlice.sessionId` into the run/report by reference without mutating SpecSafe state.
- `report <run-id>` regenerates the markdown report from a saved run JSON.

## Privacy boundary

Do not version raw traces. Keep raw local material in ignored `.pi/evalfly/raw/`. Commit only sanitized fixtures under `evals/traces/sanitized/`, and mark cases as `privacy.sanitized: true` only after removing secrets, credentials, user identifiers, private URLs, and unnecessary payloads.

## Current scope

Evalfly is evidence tooling, not enforcement. The contract MVP does not add CI gates, hooks, automatic raw trace capture, LLM-judge requirements, or external-memory dependencies.

---
name: evaluation-flywheel
description: This skill should be used when the user asks to add, update, or review evaluation coverage for agent behavior, LLM workflows, SpecSafe slices, harness prompts, or evalfly suites; when a PR changes agent instructions, slash commands, skills, schemas, or workflow-critical behavior; or when asked whether an eval is required.
---

# Evaluation Flywheel

Use the evaluation flywheel to make agentic changes reviewable with repeatable evidence. Prefer the smallest eval that would catch the regression that matters. Keep evals opt-in in the contract MVP: create and run them deliberately, record reports as evidence, and link them from SpecSafe or PR notes by reference.

## When evals are required

Add or update evals when a change alters behavior that can regress outside normal unit tests:

- Agent, command, or skill instructions that change planning, delegation, safety, review, or verification behavior.
- Schema, CLI, template, or report changes in `skills/evalfly/`.
- SpecSafe lifecycle behavior or public contract text that downstream agents rely on.
- Bug fixes where the failure mode can be expressed as a deterministic fixture, report expectation, or curated trace.
- High-risk prompt edits where reviewer confidence depends on seeing before/after behavior rather than only reading prose.

Treat an eval as required when the PR description or acceptance criteria depend on an agent doing the right thing repeatedly. If the behavior is important enough to cite as a guarantee, capture evidence for it.

## When evals are not required

Skip evals when they would add ceremony without improving confidence:

- Typo-only documentation edits that do not change instructions, public contracts, commands, or examples.
- Mechanical renames where existing tests already cover the behavior.
- Attribution, licensing, or README wording updates with no behavioral promise.
- One-off investigation notes that are not part of the distributed bundle.
- Changes already covered by a narrower deterministic test that directly exercises the risk.

When skipping evals for a non-trivial PR, state the reason in the handoff or PR notes. Do not invent placeholder evals to satisfy process.

## Deterministic-first policy

Start with deterministic checks. Prefer fixtures, file assertions, schema validation, generated report checks, and other reproducible signals before considering LLM or human judgment.

Use judge types in this order:

1. `deterministic` — required for smoke suites and first-line regression coverage.
2. `human` — acceptable for qualitative review when the rubric is explicit and the evidence is archived.
3. `llm` — reserve for later phases or explicitly approved experiments; do not make contract-MVP behavior depend on LLM-as-judge.

A deterministic eval that catches one important failure is better than a broad ambiguous rubric. Keep cases narrow enough that failures explain what broke.

## Report evidence

Run evals from the project root that owns the `evals/` directory. After installing `omp-pantheon`, use the installed skill path:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts validate
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts run --suite smoke --commit-range main..HEAD
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts check --suite smoke --commit-range main..HEAD
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts latest
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts list
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts summary
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts traces
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts compare <baseline-run-id> <after-run-id>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts normalize-trace <raw-relative-path> <sanitized-name>
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts report <run-id>
```

When developing this bundle itself, the repo-local `skills/evalfly/bin/evalfly.ts` path also works.

Use `validate` before `run`. Treat `evals/reports/<run-id>.md` as the human-readable evidence artifact and `evals/runs/<run-id>.json` as the machine-readable record. Cite the report path, run id, suite, verdict, critical regression count, SpecSafe slice id, session id, and commit range when present.

Use `check --suite smoke --commit-range <range>` when you want an explicit local gate command. It runs the same deterministic suite, writes the same evidence, prints the report path, and exits nonzero on a failing verdict. Do not present `check` as ambient enforcement: it only gates a workflow that explicitly calls it.

Use `latest` when a handoff or review needs the newest saved EvalFly evidence path. It validates saved run records before printing the latest run id, verdict, suite, and report path.

Use `list` when a review needs the saved evidence history rather than only the newest run. It validates saved run records and prints runs newest-first with canonical report paths.

Use `summary` when a reviewer needs a compact status packet: total runs, passing/failing runs, critical regressions, latest verdict, latest report path, and latest SpecSafe/commit-range context.

Use `traces` to inventory committed sanitized fixtures. It lists `evals/traces/sanitized/` paths and sizes only; it does not inspect `.pi/evalfly/raw/` and does not prove privacy.

Use `compare <baseline-run-id> <after-run-id>` when a review needs baseline-to-after regression evidence. It validates saved run records, prints total/passed/failed/critical-regression deltas, and exits nonzero if the after run has any critical regression or worsens failed/critical counts versus baseline.

Use `normalize-trace <raw-relative-path> <sanitized-name>` when a raw JSONL trace under `.pi/evalfly/raw/` should become committed review evidence. It writes `evals/traces/sanitized/<sanitized-name>` with whitelisted metadata (`trace_id`, `slice_id`, agent/model/tool/cost/latency/verdict) and explicit `sanitized_input` / `sanitized_output` fields only. Raw `input`, `output`, and `content` are dropped; this is normalization, not a privacy proof.

If a SpecSafe slice is open in `.pi/.specsafe-state.json`, `evalfly run` and `evalfly check` copy `currentSlice.id` and `currentSlice.sessionId` into the run/report by reference. Pass `--commit-range <range>` when the report should identify the reviewed commit span. Evalfly does not mutate `.pi/.specsafe-state.json`.
Do not claim runtime enforcement. Evalfly reports evidence; it does not block commits, hooks, CI, or merges unless a project explicitly invokes `check` in its own workflow.

## Trace curation and privacy

Never version raw traces. Store raw, local-only material under ignored `.pi/evalfly/raw/` and keep it out of `evals/`.

Version only sanitized examples under `evals/traces/sanitized/` when they are useful for review. Before committing a sanitized trace:

- Remove secrets, tokens, API keys, credentials, local absolute paths, user identifiers, private URLs, and unneeded payloads.
- Keep only the minimum request, response, tool-call, or transcript shape needed to reproduce the judgment.
- Mark cases with `privacy.sanitized: true` only after checking the sanitized artifact.
- Prefer synthetic fixtures when real traces are not necessary.


For local trace curation, keep the raw file under `.pi/evalfly/raw/`, manually minimize/redact it, then copy it into the versionable sanitized tree with:

```bash
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts curate-trace <raw-relative-path> <sanitized-name>
```

`curate-trace` performs path containment checks and blocks obvious unsanitized content such as bearer tokens, API keys, private keys, emails, private/local URLs, and local absolute paths. It does not capture traces and does not automatically redact; a passing command is a guardrail, not a privacy proof.
If a case depends on unsanitized private material, keep it local and do not present it as public bundle evidence.

Use `traces` before review when trace fixtures are part of the evidence packet. The command is an index, not a sanitizer: it confirms which sanitized files are present and refuses symlinked/non-regular entries, but it does not inspect content.

## SpecSafe linkage by reference

Link eval evidence from SpecSafe by reference, not by embedding reports into the state file. Use stable paths and run ids, for example:

- `evals/reports/run-smoke-20260619123000.md`
- `evals/runs/run-smoke-20260619123000.json`

Keep SpecSafe state focused on slice lifecycle. Do not add eval payloads, raw traces, or external memory dependencies to `.pi/.specsafe-state.json`.

## Experimental human and LLM judge metadata

LLM judge cases may be described with `judge: { "type": "llm", "rubric": "...", "model": "optional" }` for future/advisory review design. Evalfly validates that metadata but does not execute LLM judges; `evalfly run` records them as unsupported. Prefer deterministic assertions whenever possible.

Human judge cases may be described with `judge: { "type": "human", "rubric": "...", "reviewer": "optional" }` when the decision cannot be made deterministic. Put the detailed rubric in `evals/rubrics/`, state required evidence, exact pass/fail conditions, and privacy classification, then cite the human decision in the PR or handoff. Do not use `human` as a placeholder for unimplemented deterministic coverage.

## Optional advisory hook

The bundled `evalfly-advisor` extension hook is inactive by default. A project opts in by creating `.pi/evalfly/hints-enabled` and `evals/config.json`. When enabled, the hook injects non-blocking first-turn context reminding the agent to cite EvalFly evidence or explain why it is not applicable.

This hook never runs evals, never captures traces, never blocks completion, and never turns EvalFly into CI or merge enforcement.

The bundled GitHub Actions example at `skills/evalfly/templates/github-actions/evalfly-check.yml` is also opt-in. It is manual and `continue-on-error` by default, so copying it produces advisory evidence rather than a required CI gate.

## Current limits

The contract MVP intentionally provides evidence tooling only:

- No global hook enforcement. The optional `evalfly-advisor` hook is reminder-only and opt-in.
- No mandatory CI gate. The optional GitHub Actions example is advisory unless a project deliberately makes it required.
- No required LLM-as-judge. LLM judge metadata is experimental/advisory and not executed by Evalfly.
- No automatic raw trace capture.
- No mutation of existing project state during bootstrap.
- No external-memory dependency.
- No new eval-designer, judge, or trace-curator agents.

Keep changes boring: schemas, CLI usage, templates, deterministic smoke cases, and public documentation that says the flywheel is opt-in.

## Minimal eval project shape

Use `skills/evalfly/templates/evals/` as the starting point for a project-local `evals/` directory:

```text
evals/
  config.json
  cases/example-smoke.json
  rubrics/README.md
  runs/.gitkeep
  reports/.gitkeep
  traces/sanitized/.gitkeep
```

Keep raw traces in `.pi/evalfly/raw/`, not in this tree.

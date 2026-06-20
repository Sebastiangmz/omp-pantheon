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
bun run ~/.omp/agent/skills/evalfly/bin/evalfly.ts report <run-id>
```

When developing this bundle itself, the repo-local `skills/evalfly/bin/evalfly.ts` path also works.

Use `validate` before `run`. Treat `evals/reports/<run-id>.md` as the human-readable evidence artifact and `evals/runs/<run-id>.json` as the machine-readable record. Cite the report path, run id, suite, verdict, critical regression count, SpecSafe slice id, session id, and commit range when present.

If a SpecSafe slice is open in `.pi/.specsafe-state.json`, `evalfly run` copies `currentSlice.id` and `currentSlice.sessionId` into the run/report by reference. Pass `--commit-range <range>` when the report should identify the reviewed commit span. Evalfly does not mutate `.pi/.specsafe-state.json`.
Do not claim runtime enforcement. Evalfly reports evidence; it does not block commits, hooks, CI, or merges.

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

## SpecSafe linkage by reference

Link eval evidence from SpecSafe by reference, not by embedding reports into the state file. Use stable paths and run ids, for example:

- `evals/reports/run-smoke-20260619123000.md`
- `evals/runs/run-smoke-20260619123000.json`

Keep SpecSafe state focused on slice lifecycle. Do not add eval payloads, raw traces, or external memory dependencies to `.pi/.specsafe-state.json`.

## Optional advisory hook

The bundled `evalfly-advisor` extension hook is inactive by default. A project opts in by creating `.pi/evalfly/hints-enabled` and `evals/config.json`. When enabled, the hook adds non-blocking session-stop context reminding the agent to cite EvalFly evidence or explain why it is not applicable.

This hook never runs evals, never captures traces, never blocks completion, and never turns EvalFly into CI or merge enforcement.

## Current limits

The contract MVP intentionally provides evidence tooling only:

- No global hook enforcement. The optional `evalfly-advisor` hook is reminder-only and opt-in.
- No CI gate.
- No required LLM-as-judge.
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

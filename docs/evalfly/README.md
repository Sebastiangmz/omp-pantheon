# EvalFly in omp-pantheon

EvalFly is the evaluation-evidence layer added to `omp-pantheon`. It makes agentic work more reviewable by turning selected behavior checks into versioned eval cases, machine-readable runs, human-readable reports, and sanitized trace artifacts.

EvalFly is **not one single mode**. It is a set of layers:

1. Normal improved OMP behavior.
2. EvalFly advisory mode.
3. EvalFly manual CLI usage.
4. Future local enforced mode.
5. Optional CI enforcement.

The current shipped implementation is intentionally safe by default: advisory/manual, not globally enforced.

---

## What changed compared to earlier OMP

Earlier `omp-pantheon` already had strong agent discipline: skills, agents, SpecSafe, tests, review flows, and guarded external mutations.

EvalFly adds a project-local evaluation contract:

- agents plan whether eval evidence is required;
- deterministic eval cases live under `evals/`;
- `evalfly` commands validate, run, compare, report, and inspect evidence;
- reports are saved under `evals/reports/`;
- run records are saved under `evals/runs/`;
- sanitized traces are kept under `evals/traces/sanitized/`;
- raw traces stay local under `.pi/evalfly/raw/`;
- privacy audit tools detect obvious leaks and raw fields;
- optional GitHub Actions templates can be copied into consuming projects.

This moves OMP from “the agent says it tested” toward “the repo contains repeatable evidence.”

---

## Current modes and layers

| Layer | Current status | What it does | What it does not do |
|---|---:|---|---|
| Normal improved OMP | Implemented | Uses improved agent contracts, tests, review-work, SpecSafe, and existing harness discipline. | Does not require EvalFly by default. |
| EvalFly advisory | Implemented | Injects a non-blocking reminder when project opts in with `.pi/evalfly/hints-enabled` and `evals/config.json`. | Does not run evals, capture traces, or block PASS. |
| EvalFly manual | Implemented | User/agent runs `evalfly` commands explicitly to create evidence. | Does not force itself. If no one runs it, nothing blocks. |
| Local enforced mode | Planned, not implemented | Will explicitly activate blocking local EvalFly requirements for a project/session/slice. | Does not exist yet. Needs more code. |
| CI enforced mode | Partially implemented | Required-gate workflow template exists. | Not installed by default; branch protection must be configured separately. |

---

## Quick decision guide

Use normal OMP when:

- the change is trivial;
- deterministic tests are enough;
- no agent, prompt, workflow, command, hook, schema, or eval behavior changed.

Use advisory mode when:

- a project has EvalFly available and you want reminders without friction;
- you want OMP to nudge agents toward evidence but not block them.

Use EvalFly manual commands when:

- a change affects agent behavior, skills, hooks, slash commands, schemas, SpecSafe, or EvalFly itself;
- a reviewer needs a report path and run ID;
- you want before/after regression evidence;
- sanitized traces changed and need audit.

Use future enforced mode when:

- a change is load-bearing;
- missing evidence should block completion;
- the team wants EvalFly to be mandatory for this project/session/slice.

Use CI enforcement when:

- the repository should reject PRs without passing EvalFly evidence;
- GitHub Actions and branch protection are available for the repo.

---

## Existing user-facing files

Core docs:

- `skills/evaluation-flywheel/SKILL.md` — agent-facing methodology and rules.
- `skills/evalfly/README.md` — CLI reference and current implementation boundary.
- `docs/evalfly/manual-cli.md` — beginner explanation of manual EvalFly usage.
- `docs/evalfly/artifacts-and-traces.md` — run/report/trace/audit explanation.
- `docs/evalfly/modes.md` — mode comparison.
- `docs/evalfly/enforcement-roadmap.md` — what still needs to be built for real enforcement.
- `docs/evalfly/ci-enforcement.md` — GitHub Actions and branch-protection guidance.

Implementation plan:

- `docs/superpowers/plans/2026-06-20-evalfly-enforcement.md`.

---

## Current honest status

Current EvalFly is a strong opt-in evidence stack. It is not yet the full closed-loop enforcement target.

Implemented:

- methodology skill;
- agent contracts;
- deterministic EvalFly runner;
- local project eval template;
- manual gate command;
- run/report artifacts;
- baseline-vs-after compare;
- trace listing/audit/import/normalization;
- optional advisor hook;
- optional GitHub Actions templates;
- privacy and retention docs.

Still missing for full enforcement:

- explicit local enforced-mode state;
- hooks that capture lifecycle/tool/agent traces only when enforcement is active;
- pre-completion gate that blocks PASS when active evidence is missing;
- automatic trace-to-eval candidate workflow;
- run-level cost/latency/model comparison;
- actual LLM/human judge execution;
- installed required CI and branch protection automation.

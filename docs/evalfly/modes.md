# EvalFly modes

This document explains the practical modes around EvalFly in `omp-pantheon`.

The word “mode” can be confusing because not every layer is a switch. Some are runtime behavior, some are manual tools, and some are future enforcement.

---

## 1. Normal improved OMP

Status: **implemented**.

This is OMP without activating EvalFly-specific behavior.

It includes:

- improved agents;
- skills;
- SpecSafe discipline;
- tests;
- review-work;
- guarded GitHub/Linear/push flows;
- normal OMP hooks.

EvalFly still improves this layer indirectly because the agent contracts now mention evaluation planning. But no EvalFly command is automatically required.

Use this for:

- small edits;
- deterministic tasks already covered by tests;
- docs-only changes with no behavioral promise;
- routine work where EvalFly evidence would add ceremony without confidence.

Risk:

- The agent may still overclaim if no stronger review or eval evidence is requested.

---

## 2. EvalFly advisory mode

Status: **implemented**.

Advisory mode is a reminder, not a gate.

It activates only when a project has both:

```txt
.pi/evalfly/hints-enabled
evals/config.json
```

When those files exist, the `evalfly-advisor` hook injects non-blocking context into OMP. The reminder tells the agent:

- this project has opted into EvalFly hints;
- if the work changes agent behavior, skills, commands, schemas, hooks, or workflow-critical behavior, cite EvalFly evidence or explain why EvalFly does not apply;
- do not claim hook or CI enforcement unless it is actually wired.

What advisory mode does:

- reminds;
- improves agent attention;
- reduces forgotten EvalFly evidence;
- preserves daily OMP ergonomics.

What advisory mode does not do:

- does not run `evalfly` commands;
- does not capture traces;
- does not block PASS;
- does not install CI;
- does not guarantee evidence exists.

Use this for:

- most projects that want lightweight evaluation discipline;
- teams that are adopting EvalFly gradually;
- work where enforcement would be too heavy but reminders are useful.

---

## 3. EvalFly manual usage

Status: **implemented**.

Manual usage means a user or agent explicitly runs `evalfly` commands.

This is stronger than advisory because it creates real artifacts:

```txt
evals/runs/*.json
evals/reports/*.md
evals/traces/sanitized/*
```

But it is still manual because nothing external forces it to happen.

Use this when:

- the change is not trivial;
- a reviewer needs a report path;
- a spec marks EvalFly as required;
- agent, skill, hook, command, schema, SpecSafe, or EvalFly behavior changed;
- sanitized trace fixtures changed;
- you want baseline-vs-after evidence.

Manual usage can act like a local gate if the agent runs:

```bash
evalfly check --suite smoke --commit-range main..HEAD
```

But it is not true enforcement. A true enforcement layer would block completion when this command is missing or failing.

---

## 4. Local enforced mode

Status: **planned, not implemented**.

Local enforced mode is the missing layer that would make EvalFly mandatory after explicit activation.

Expected activation examples:

```bash
evalfly enforce start --suite smoke --commit-range main..HEAD
```

or an OMP slash command:

```txt
/evalfly-enforce start --suite smoke --commit-range main..HEAD
```

Expected behavior after activation:

- record a project/session/slice enforcement state under `.pi/evalfly/`;
- capture sanitized trace metadata only while active;
- require a passing EvalFly run before PASS;
- require zero critical regressions;
- require report path evidence;
- require trace audit when sanitized traces changed;
- block completion if evidence is missing or failing;
- allow explicit stop/rollback to advisory mode.

Important boundary:

- Enforced mode should not be default.
- It should not make every tiny task heavy.
- It should be explicit and reversible.

Use this future mode for:

- load-bearing changes;
- harness changes;
- agent/prompt/workflow changes;
- changes where regression evidence matters more than speed.

---

## 5. CI enforced mode

Status: **partially implemented**.

The repo includes a template:

```txt
skills/evalfly/templates/github-actions/evalfly-required-gate.yml
```

A consuming project can copy it to:

```txt
.github/workflows/evalfly-required-gate.yml
```

Then configure branch protection to require the `EvalFly required gate` check.

What already exists:

- required-gate workflow template;
- advisory workflow template;
- docs warning not to upload raw traces;
- deterministic `evalfly check` command used by the workflow.

What does not exist yet:

- automatic installer command;
- automatic branch-protection setup;
- repo-plan detection for whether branch protection is available;
- approval-gated GitHub API mutation flow.

Cost boundary:

- Public repos: standard GitHub-hosted Actions runners are free.
- Private repos on GitHub Free: included minutes apply.
- EvalFly current deterministic checks do not consume LLM tokens.
- If a future LLM judge calls an LLM API, that would be a separate token/API cost.

---

## Summary table

| Mode | Implemented | Blocks completion | Creates evidence | Default |
|---|---:|---:|---:|---:|
| Normal improved OMP | Yes | No | Only normal tests/reviews | Yes |
| EvalFly advisory | Yes | No | No | No, opt-in per project |
| EvalFly manual | Yes | Only if user/agent treats command failure as blocking | Yes | No |
| Local enforced | No | Yes, planned | Yes | No |
| CI enforced | Partial | Yes if workflow copied and branch protection configured | Yes | No |

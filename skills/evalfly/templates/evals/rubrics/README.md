# Eval rubrics

Keep rubrics small, explicit, and tied to the case they judge.

Prefer deterministic cases in `evals/config.json`. Use this directory only for human-review notes or experimental LLM-judge rubrics that cannot be reduced to deterministic assertions; Evalfly validates LLM judge metadata but does not execute model calls.

A good human-review rubric states:

- the behavior being judged;
- the exact evidence path a reviewer must inspect;
- the pass conditions;
- the fail conditions;
- the privacy classification of any referenced trace;
- who made the decision and where that decision is archived.

Use this shape:

```markdown
# <case-id> rubric

Evidence:
- `evals/reports/<run-id>.md`
- `evals/traces/sanitized/<trace-name>`

Pass when:
- <observable condition>

Fail when:
- <observable condition>

Decision archive:
- PR or handoff link: <link>
```

Do not place raw traces here. Keep raw local material in ignored `.pi/evalfly/raw/`. Only sanitized trace fixtures belong under `evals/traces/sanitized/`.

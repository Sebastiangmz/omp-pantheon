# Eval rubrics

Keep rubrics small, explicit, and tied to the case they judge.

For PR 1, prefer deterministic cases in `evals/config.json`. Use this directory only for human-review notes or future LLM-judge rubrics that cannot be reduced to deterministic assertions.

A good rubric states:

- the behavior being judged;
- the evidence required to pass;
- the exact failure conditions;
- the privacy classification of any referenced trace.

Do not place raw traces here. Keep raw local material in ignored `.pi/evalfly/raw/`. Only sanitized trace fixtures belong under `evals/traces/sanitized/`.

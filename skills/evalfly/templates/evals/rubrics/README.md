# Eval rubrics

Keep rubrics small, explicit, and tied to the case they judge.

Prefer deterministic cases in `evals/config.json`. Use this directory only for human-review notes or experimental LLM-judge rubrics that cannot be reduced to deterministic assertions; Evalfly validates LLM judge metadata but does not execute model calls.

A good rubric states:

- the behavior being judged;
- the evidence required to pass;
- the exact failure conditions;
- the privacy classification of any referenced trace.

Do not place raw traces here. Keep raw local material in ignored `.pi/evalfly/raw/`. Only sanitized trace fixtures belong under `evals/traces/sanitized/`.

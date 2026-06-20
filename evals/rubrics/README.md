# omp-pantheon EvalFly rubrics

This eval repo protects the first project-local EvalFly contract for `omp-pantheon`.

The initial `smoke` suite is intentionally deterministic. It checks that load-bearing files for EvalFly local enforcement, CLI execution, docs, CI verification, and regression tests still exist.

A passing smoke run means the critical EvalFly harness surface is present. It does not prove semantic quality, LLM judge behavior, branch protection, or production readiness.

When the EvalFly runner supports richer assertions, extend this suite with content checks before replacing these file-existence guards.

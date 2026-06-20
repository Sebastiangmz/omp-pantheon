# Installing the EvalFly required gate

This template is documentation for a future approval-gated installer. It does not mutate GitHub by itself.

## What the installer should do

An eventual command such as:

```bash
evalfly ci install-required-gate --branch main
```

should dry-run by default and report exactly what it would change:

```txt
would copy .github/workflows/evalfly-required-gate.yml
would require status check: EvalFly required gate
would update branch protection for: main
```

Execution must require explicit approval:

```bash
evalfly ci install-required-gate --branch main --i-approve
```

## Safe installation sequence

1. Copy `skills/evalfly/templates/github-actions/evalfly-required-gate.yml` to `.github/workflows/evalfly-required-gate.yml`.
2. Open a PR with that workflow.
3. Wait for the workflow to pass.
4. Confirm the check name is exactly `EvalFly required gate`.
5. Confirm the repository plan supports branch protection or rulesets.
6. Configure branch protection or a ruleset requiring `EvalFly required gate`.
7. Document the repo-specific enforcement policy.

Do not enable branch protection before the workflow has passed at least once.

## Cost boundary

- Public repositories: standard GitHub-hosted Actions runners are free.
- Private repositories on GitHub Free: included monthly minutes apply.
- Current deterministic EvalFly checks do not consume LLM tokens.
- Future LLM judges would consume separate LLM/API tokens only if explicitly enabled.

## Branch protection boundary

- Public repositories on GitHub Free can use protected branches.
- Private repositories on GitHub Free generally cannot use protected branches.
- Private repositories need GitHub Pro, Team, or Enterprise for protected branches/rulesets.

## Security boundary

The required-gate workflow should upload only:

```txt
evals/runs/*.json
evals/reports/*.md
```

It must not upload:

```txt
.pi/evalfly/raw/
raw traces
secrets
full prompt transcripts
local state files
unrelated logs
```

Run trace auditing when sanitized trace fixtures changed:

```bash
evalfly audit-traces
```

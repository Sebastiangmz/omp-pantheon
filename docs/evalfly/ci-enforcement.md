# EvalFly CI enforcement

CI enforcement is separate from local EvalFly usage.

Local manual EvalFly answers:

> Did this agent/user run evidence locally?

CI enforced EvalFly answers:

> Can this PR merge without passing EvalFly in GitHub Actions?

---

## Current status

Implemented:

- advisory GitHub Actions template;
- required-gate GitHub Actions template.

Not implemented yet:

- automatic installer command;
- automatic branch-protection/ruleset setup;
- plan/repo capability detection;
- approval-gated GitHub mutation flow.

Templates:

```txt
skills/evalfly/templates/github-actions/evalfly-check.yml
skills/evalfly/templates/github-actions/evalfly-required-gate.yml
```

---

## Advisory workflow template

File:

```txt
skills/evalfly/templates/github-actions/evalfly-check.yml
```

Behavior:

- manual `workflow_dispatch` only;
- `continue-on-error: true`;
- uploads EvalFly runs/reports if present;
- does not block PRs.

Use it when:

- the project wants CI evidence but no merge blocking;
- the team is still tuning evals;
- branch protection is unavailable.

---

## Required gate template

File:

```txt
skills/evalfly/templates/github-actions/evalfly-required-gate.yml
```

Behavior:

- runs on `pull_request` and `workflow_dispatch`;
- installs dependencies;
- runs `evalfly check --suite smoke`;
- fails when EvalFly fails;
- uploads only `evals/runs/*.json` and `evals/reports/*.md`;
- does not upload raw traces.

Copy target:

```txt
.github/workflows/evalfly-required-gate.yml
```

To actually block merges, the repo must require the check through branch protection or rulesets.

---

## Cost boundary

Current GitHub billing docs say:

- Public repositories: standard GitHub-hosted Actions runners are free.
- Private repositories on GitHub Free: included monthly minutes apply, commonly 2,000 minutes/month.
- Usage is billed to the repository owner.
- Larger runners and macOS runners may cost more.
- If no payment method is configured and included minutes are exhausted, GitHub can block additional usage instead of silently charging.

EvalFly current deterministic checks do not consume LLM tokens.

A workflow would consume LLM/API tokens only if a future EvalFly judge explicitly calls an LLM provider.

---

## Branch protection boundary

Branch protection/rulesets availability depends on repo visibility and GitHub plan.

Typical current boundary:

| Repo / plan | Branch protection available? |
|---|---:|
| Public repo on GitHub Free | Yes |
| Private repo on GitHub Free | No |
| Private repo on GitHub Pro | Yes |
| Private repo on GitHub Team | Yes |
| Enterprise | Yes |

If branch protection is unavailable, the required-gate workflow can still run, but it cannot be made a merge blocker through GitHub branch protection.

---

## Can the agent configure branch protection?

Yes, technically, if:

- the authenticated GitHub token has permission;
- the repo plan supports branch protection or rulesets;
- the target branch exists;
- the required check has run at least once or the exact check name is known.

But this is an external mutation. It must be approval-gated.

Expected future flow:

```bash
evalfly ci install-required-gate --branch main
```

Dry-run output should show:

```txt
would copy .github/workflows/evalfly-required-gate.yml
would require status check: EvalFly required gate
would update branch protection for: main
```

Execution should require explicit approval:

```bash
evalfly ci install-required-gate --branch main --i-approve
```

---

## Safe rollout sequence

1. Copy required-gate workflow to a branch.
2. Open PR.
3. Let GitHub Actions run.
4. Confirm the check name is exactly `EvalFly required gate`.
5. Confirm cost/plan constraints are acceptable.
6. Enable branch protection/ruleset requiring that check.
7. Document the repo-specific enforcement policy.

Do not enable branch protection before the workflow has passed at least once.

---

## Security notes

CI workflows must not upload:

- `.pi/evalfly/raw/`;
- raw traces;
- secrets;
- full prompt transcripts;
- local state files;
- unrelated logs.

Only upload:

```txt
evals/runs/*.json
evals/reports/*.md
```

Sanitized traces can be committed when intentionally curated, but they should still be audited with:

```bash
evalfly audit-traces
```

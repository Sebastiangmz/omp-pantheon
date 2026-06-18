---
name: github
description: Read and draft-mutate GitHub PRs, issues, and API endpoints via gh(1). All mutations require --i-approve. PR creation enforces a Linear-state invariant and is logged to .pi/.github-log.jsonl.
---

# github skill

A consent-gated bash wrapper around `gh` (the GitHub CLI).

**Reads** (`pr view`, `issue view`, `repo view`, `api <GET-route>`) pass through unchanged.

**Mutations** (PR/issue/API writes) are gated behind `--i-approve`. Without it, a full DRY-RUN preview is printed and the script exits 0 — dry-run is a successful preview, not an error.

With `--i-approve`, the mutation executes and one JSON line is appended to `.pi/.github-log.jsonl` (mode 0600, gitignored).

## Linear-state invariant on `pr create`

Before opening a pull request, the skill:

1. Extracts a Linear key from the current branch name (expects `<KEY>-<slug>` or `<KEY>__<slug>`, e.g. `CUR-92-login-fix`, `CUR-92__login-fix`).
2. If no key matches → refuses with a rename hint.
3. Otherwise, calls `linear get <KEY>` and checks the workflow state. Default PR-ready states: `in_progress`, `in_review`.
4. Any other state → refuses with a transition hint.
5. `--bypass-linear-check` together with `--i-approve` is the conscious-override path (e.g. hotfix with no ticket, or Linear-less repo).
6. If `LINEAR_API_KEY` is unset, the invariant auto-skips with a single-line notice (Q2 from the spec).

## Authentication

Uses `gh auth status`. If `gh` is not on PATH, the skill prints the install + auth commands and exits non-zero:

```bash
pacman -S github-cli         # or see https://cli.github.com
gh auth login --scopes repo,workflow
```

## Commands

### Reads (immediate pass-through)

```
github pr view <n>
github issue view <n>
github repo view
github api <GET-route>
```

### Mutations (require --i-approve)

```
github pr create [--title=T] [--body=B] [--base=main] [--draft|--ready]
                 [--bypass-linear-check]                         [--i-approve]
github pr comment <n> <body>                                      [--i-approve]
github pr edit <n> [--add-label=X] [--remove-label=Y]             [--i-approve]
github pr merge <n> [--squash|--rebase|--merge]                   [--i-approve]
github issue comment <n> <body>                                   [--i-approve]
github issue edit <n> [flags...]                                  [--i-approve]
github api <route> -X POST|PATCH|PUT|DELETE [...]                 [--i-approve]
```

`pr create` defaults to `--draft`. Pass `--ready` to open as ready-for-review.

### PR review commands

`gh pr review` is deliberately **not** wrapped. Human-authored reviews remain a human action.

## Audit log

Every approved mutation appends one JSON line to `.pi/.github-log.jsonl`:

```json
{"ts":"2026-04-24T12:00:00Z","action":"pr create","args":["pr","create","--title","...","--draft"],"exit":0,"result_url":"https://github.com/org/repo/pull/42","approver":"luci"}
```

`result_url` is derived from gh's stdout for PR/comment creation, or from a follow-up `gh pr view --json mergeCommit` for merges.

## Example invocations

```bash
# Reads (immediate)
./.omp/skills/github/bin/github.sh pr view 42
./.omp/skills/github/bin/github.sh repo view

# Dry-run mutations (safe, exit 0, prints preview + Linear context)
./.omp/skills/github/bin/github.sh pr create --title="Fix login bug"
./.omp/skills/github/bin/github.sh pr comment 42 "LGTM pending CI"

# Approved mutations (execute + log)
./.omp/skills/github/bin/github.sh pr create --title="Fix login bug" --i-approve
./.omp/skills/github/bin/github.sh pr merge 42 --squash --i-approve

# Conscious override of the Linear invariant
./.omp/skills/github/bin/github.sh pr create --title="hotfix" --bypass-linear-check --i-approve
```

## Env overrides (tests only)

- `PI_GITHUB_GH_CMD` — replace `gh` with an alternate command (used by the test harness for stubbing).
- `PI_GITHUB_LINEAR_CMD` — replace the default `bun run .omp/skills/linear/bin/linear.ts` invocation.
- `PI_GITHUB_APPROVER` — override the approver name recorded in the log (default: `luci`).

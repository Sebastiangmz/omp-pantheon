---
name: linear
description: Read and draft-mutate Linear issues, comments, and state transitions. All mutations require --i-approve and are logged to .pi/.linear-log.jsonl.
---

# linear skill

A thin Bun CLI wrapping `@linear/sdk` for reading and mutating Linear issues.

**Reads** execute immediately. **Mutations** are gated behind `--i-approve`.

Without `--i-approve`, every mutation prints a full DRY-RUN preview block showing:
- Resolved team/project/state IDs (not just names)
- The full mutation payload shape
- A line-by-line diff of what would change (before → after)

Exits 0 on dry-run — it is a successful preview, not an error.

With `--i-approve`, the mutation executes and one JSON line is appended to `.pi/.linear-log.jsonl` (mode 0600).

## Authentication

Set `LINEAR_API_KEY` in your environment:

```bash
export LINEAR_API_KEY="<LINEAR_API_KEY>"
# Add to ~/.bashrc for persistence
```

If the key is absent, the CLI exits non-zero with the exact export command to add.

## Commands

### list

```
linear list [--team=CUR] [--state=triage|todo|in_progress|in_review|done] [--assignee=me]
```

List issues. All filters are optional and stackable. State tokens map to Linear workflow state types and names — `in_progress` and `in_review` disambiguate by display name pattern.

### get

```
linear get <KEY>
```

Fetch a single issue by its human-readable key (e.g., `CUR-92`). Shows: key, title, state, assignee, team, priority, URL, description.

### comment

```
linear comment <KEY> <body>              # dry-run: prints preview
linear comment <KEY> <body> --i-approve  # executes: posts comment, logs
```

Post a comment on an issue. Without `--i-approve`, prints what would be posted. With `--i-approve`, calls Linear and logs to `.pi/.linear-log.jsonl`.

### transition

```
linear transition <KEY> <state>              # dry-run: resolves state ID, shows diff
linear transition <KEY> <state> --i-approve  # executes: changes state, logs before/after
```

State tokens: `triage`, `todo`, `in_progress`, `in_review`, `done`. State names are resolved to IDs via `team.states()` at call time and cached per invocation.

### create

```
linear create --team=<id> --title=<t> [--body=<b>]              # dry-run
linear create --team=<id> --title=<t> [--body=<b>] --i-approve  # executes: creates issue, logs
```

Create a new issue. `--team` and `--title` are required.

## Audit log

Every approved mutation appends one JSON line to `.pi/.linear-log.jsonl` (gitignored, mode 0600):

```json
{"ts":"2026-04-24T12:00:00.000Z","action":"comment","key":"CUR-92","before":{...},"after":{...},"approver":"luci"}
```

## Example invocations

```bash
# Read operations (immediate)
bun run .omp/skills/linear/bin/linear.ts list
bun run .omp/skills/linear/bin/linear.ts list --team=CUR --state=in_progress
bun run .omp/skills/linear/bin/linear.ts get CUR-92

# Dry-run mutations (safe, exit 0)
bun run .omp/skills/linear/bin/linear.ts comment CUR-92 "Looks good to me"
bun run .omp/skills/linear/bin/linear.ts transition CUR-92 in_review
bun run .omp/skills/linear/bin/linear.ts create --team=team-uuid --title="Fix the widget"

# Approved mutations (execute + log)
bun run .omp/skills/linear/bin/linear.ts comment CUR-92 "Looks good to me" --i-approve
bun run .omp/skills/linear/bin/linear.ts transition CUR-92 done --i-approve
bun run .omp/skills/linear/bin/linear.ts create --team=team-uuid --title="Fix the widget" --body="Details here" --i-approve
```

---
name: push
description: "Consent-gated git push with pre-flight checks and audit log. Use when pushing any branch. Dry-run by default; pass --i-approve to execute. Checks include clean tree, branch ahead of remote, not on main/master (use --allow-main to override), Spec-Slice trailer present in commit range, and no open SpecSafe slice. Appends JSON to .pi/.push-log.jsonl on success."
---

# push

The single authorized path for `git push` in this project. Runs five pre-flight checks before any push is executed; the actual push requires explicit `--i-approve` consent.

## Dry-run (default — no flags)

```bash
./bin/push.sh
```

Prints a per-check status report and exits 0. Does NOT push.
Read the output before approving.

## Execute push

```bash
./bin/push.sh --i-approve
```

Re-runs all checks and, if all pass, executes the push and appends one JSON line to `.pi/.push-log.jsonl`.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--i-approve` | No | Actually execute the push (without it: dry-run only) |
| `--remote=<name>` | No | Override remote name (default: `origin`) |
| `--allow-main` | No | Required when pushing `main` or `master` |

## Pre-flight checks

1. Working tree is clean (`git status --porcelain` is empty).
2. Local branch is ahead of remote tracking branch and not behind (not diverged, not at parity).
3. Not on `main`/`master` unless `--allow-main` is also passed.
4. At least one commit in the push range carries a `Spec-Slice:` trailer.
5. `.pi/.specsafe-state.json` has `currentSlice === null` (no open slice).

Any failed check aborts non-zero with a `[fail]` message. Fix each issue before re-running.

## Typical usage sequence

```bash
# Step 1: review pre-flight report
/skill:push

# Step 2: after verifying report is clean, approve and push
/skill:push --i-approve

# For pushing to main (with explicit override):
/skill:push --i-approve --allow-main
```

## Audit log

Every successful push appends one JSON line to `.pi/.push-log.jsonl` (mode 0600, gitignored):

```json
{"ts":"2026-04-24T10:00:00Z","branch":"feat/my-feature","remote":"origin","range":"abc123..def456","commits":3,"approver":"luci"}
```

# push skill

Consent-gated `git push` with pre-flight safety checks and a forensic audit log.

## Purpose

This is the **only** authorized way to push branches in this project. It enforces five checks before any push executes and requires explicit `--i-approve` consent. Every successful push is logged to `.pi/.push-log.jsonl`.

## Invocation forms

```bash
# Dry-run: print pre-flight report, exit 0, do NOT push
./bin/push.sh

# Execute push after all checks pass
./bin/push.sh --i-approve

# Explicit remote (default: origin)
./bin/push.sh --i-approve --remote=origin

# Allow pushing to main or master
./bin/push.sh --i-approve --allow-main
```

## Pre-flight checks

All five must pass; any failure aborts with a `[fail]` prefix on stderr and exits non-zero.

| # | Check | Failure cause |
|---|-------|---------------|
| 1 | Working tree clean | Uncommitted or staged changes exist |
| 2 | Ahead of remote, not diverged | Local is behind or at parity with remote tracking branch |
| 3 | Not on main/master | On a protected branch without `--allow-main` |
| 4 | Spec-Slice: trailer present | No commit in push range contains a `Spec-Slice:` git trailer |
| 5 | No open slice | `.pi/.honcho-state.json` has `currentSlice != null` |

## Exit behavior

- Exit 0: dry-run completed successfully **or** push succeeded.
- Exit non-zero: any pre-flight check failed **or** the push itself failed.

The dry-run output ends with either:

```
READY TO PUSH (rerun with --i-approve)
```

or:

```
NOT READY: N check(s) failed.
```

Each check line is prefixed with `[ok]` (stdout) or `[fail]` (stderr).

## Audit log

Location: `.pi/.push-log.jsonl` (mode 0600, gitignored)

One JSON line per successful push:

```json
{"ts":"<ISO8601>","branch":"<branch>","remote":"<remote>","range":"<old>..<new>","commits":<N>,"approver":"luci"}
```

The file is created on first push with mode 0600. On each append `chmod 600` is re-applied as a safety net.

## Implementation notes

- Pure bash with `set -euo pipefail`.
- External dependencies: `git`, `jq` (falls back to `printf` + `sed` escaping when `jq` is absent), standard coreutils.
- The push command (`git push`) is never printed with secrets; `set -x` is not used.
- If no tracking branch exists, push uses `--set-upstream origin <branch>`.
- The base commit for Spec-Slice trailer detection is the merge-base with `origin/main` or `origin/master` (falling back to the repository root commit).

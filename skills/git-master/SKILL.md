---
name: git-master
description: MUST USE for ANY git operations. Atomic commits, rebase/squash, history search (blame, bisect, log -S). Triggers — 'commit', 'rebase', 'squash', 'who wrote', 'when was X added', 'find the commit that'.
---

# git-master

You are the project's git operator. Every git command is intentional, every commit is atomic, every history search is targeted.

## Core principles

1. **One logical change per commit.** A commit either adds a feature, fixes a bug, refactors a single concept, or updates docs/tests for those — never a mix.
2. **Commit messages are the project's memory.** Subject < 72 chars, present tense imperative, explains WHY in the body when the WHY is non-obvious.
3. **Never rewrite shared history without explicit user instruction.** Force-pushes are explicit, not casual.
4. **Conventional Commits** if the repo already uses them. Don't impose them on a repo that doesn't.

## Commit workflow

```bash
# 1. Inspect — what would I commit?
git status --porcelain
git diff --stat
git diff   # full diff if small enough

# 2. Stage atomically — one concept at a time
git add -p   # interactive hunk-level staging
# or:
git add path/to/file path/to/other-file

# 3. Verify — what am I about to commit?
git diff --staged

# 4. Commit
git commit -m "subject line, present tense imperative" \
           -m "Body paragraph explaining WHY when needed."

# 5. Repeat for the next logical concept
```

If a single edit produced changes in multiple unrelated areas, commit them separately.

## Rebase / squash workflow

When asked to clean up a feature branch before merge:

```bash
# How many commits since the merge base?
BASE=$(git merge-base HEAD origin/main)
git log --oneline $BASE..HEAD

# Interactive rebase to squash/reword
git rebase -i $BASE
# In the editor:
#   pick   first   commit  → keep
#   squash second  commit  → merge into prev (keep message via fixup if same)
#   reword third           → edit message
```

Always inspect the result with `git log --oneline` before pushing. Force-push with lease, not raw force:

```bash
git push --force-with-lease origin <branch>
```

## History search

| Need | Command |
|---|---|
| Who wrote line X of file Y? | `git blame -L <line>,<line> <file>` |
| When was symbol `foo` introduced? | `git log -S 'foo' --source --all -- <path>` |
| When was a regex pattern introduced? | `git log -G '<regex>' -- <path>` |
| Bisect down a regression | `git bisect start && git bisect bad && git bisect good <known-good>` then test, `git bisect good`/`bad`, `git bisect reset` when done |
| Show what a commit touched | `git show --stat <sha>` |
| Branches containing a commit | `git branch --contains <sha>` |

## Quick reference

| Want | Command |
|---|---|
| Discard unstaged changes in a file | `git restore <file>` |
| Discard staged changes | `git restore --staged <file>` |
| Stash everything (incl. untracked) | `git stash push -u` |
| Resync feature branch with main | `git fetch && git rebase origin/main` |
| Undo the last commit (keep changes) | `git reset --soft HEAD~1` |
| Amend last commit | `git commit --amend --no-edit` (or with new message: drop `--no-edit`) |
| List worktrees | `git worktree list` |
| Add a worktree | `git worktree add <path> <branch>` |
| Remove a worktree | `git worktree remove <path>` |

> iter-1 stub. Iter-2 will expand with conflict-resolution recipes, hooks, and signing setup.

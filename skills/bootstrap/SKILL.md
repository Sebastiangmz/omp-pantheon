---
name: bootstrap
description: Initialize a foreign project to use the pi-seshat system. Symlinks .omp/, drops AGENTS.md and CLAUDE.md templates, scaffolds specs/ and .pi/, updates .gitignore. Dry-run by default; --i-approve gates all mutations.
---

# bootstrap skill

One-shot initializer that wires a foreign project (any directory outside the pi-seshat repo) into the Ghola/SpecSafe system.

## Invocation

```
bun run .omp/skills/bootstrap/bin/bootstrap.ts                  # preview
bun run .omp/skills/bootstrap/bin/bootstrap.ts --i-approve      # apply
bun run .omp/skills/bootstrap/bin/bootstrap.ts --with-evalfly        # preview + evals template
bun run .omp/skills/bootstrap/bin/bootstrap.ts --i-approve --with-evalfly
```

Run from the **target project's cwd**, not from inside pi-seshat. The skill refuses to bootstrap the source repo onto itself.

## Flags

| Flag                  | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `--i-approve`         | Required to perform any on-disk mutation. Without it, the skill previews. |
| `--force-symlink`     | Replace an existing regular `.omp/` directory with the symlink.         |
| `--with-evalfly`     | Also copy the EvalFly `evals/` template when `evals/` does not already exist. |

## What it applies

1. Creates `.pi/`, `specs/`, `specs/briefs/`, `specs/archive/`.
2. Symlinks `<cwd>/.omp` → `<PI_SESHAT_ROOT>/.omp` (absolute target).
3. Writes `AGENTS.md` from `templates/AGENTS.md` (skipped if file already exists).
4. Writes `CLAUDE.md` from `templates/CLAUDE.md` (skipped if file already exists).
5. If `--with-evalfly` is passed, copies `skills/evalfly/templates/evals/` to `<cwd>/evals/` (skipped if `evals/` already exists).
6. Appends nine `.pi/`-related patterns to `.gitignore` (idempotent, exact-line match).
7. Appends one JSONL line to `.pi/.bootstrap-log.jsonl` (mode `0600`, approver `luci`).

Re-running `--i-approve` on an already-bootstrapped project mutates only the audit log unless `--with-evalfly` is passed and `evals/` is still absent.

## Exit codes

| Code | Meaning                                                       |
|------|---------------------------------------------------------------|
| 0    | Success or successful dry-run (including idempotent no-op)   |
| 1    | Refuse-condition (pi-seshat self, `.omp` conflict, I/O error) |
| 2    | Unknown flag or argument                                      |

## Caveats

- **Absolute symlink target.** The `.omp` symlink stores the absolute path of the pi-seshat repo as it stood at bootstrap time. If you move pi-seshat (e.g. `mv ~/Code/pi ~/Code/pi-old`), every bootstrapped project's `.omp` becomes a dangling link. Re-run `bootstrap --i-approve --force-symlink` from each affected project.
- **Skip-if-exists for templates.** `AGENTS.md` and `CLAUDE.md` are written once. Subsequent runs preserve user edits — they are not re-rendered when templates change.
- **One-way.** There is no `unbootstrap` command. To decommission, manually remove `.omp`, `AGENTS.md`, `CLAUDE.md`, `.pi/`, and the `.gitignore` patterns you no longer want.

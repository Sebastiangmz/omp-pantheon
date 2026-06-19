---
name: env-doctor
description: Read-only pre-flight verifier. Checks Linear, gh, omp, agent symlinks, and SpecSafe state-file integrity before a dogfood session. No mutations, no --i-approve gate.
---

# env-doctor skill

Single-shot diagnostic: runs five checks in a fixed order and prints a PASS / FAIL / SKIP line per item. Read-only — touches no env vars or files and only shells out to the configured probe commands.

## Usage

```
bun run .omp/skills/env-doctor/bin/env-doctor.ts [--strict] [--json]
```

## Checklist (fixed order)

| Id  | Label            | Required? | Description |
|-----|------------------|-----------|-------------|
| (a) | `LINEAR_API_KEY` | optional  | Env present + `linear list --limit=1` exits 0. SKIP if env unset; FAIL under `--strict`. |
| (b) | `gh auth`        | yes       | `gh auth status` exits 0. |
| (c) | `omp config`     | yes       | `omp --version` exits 0. Searches PATH, `bun pm bin -g`, `$BUN_INSTALL/bin`, `~/.bun/bin`, `~/.cache/.bun/bin`, `~/.local/share/bun/bin`, and `/usr/local/bin`. |
| (d) | agent symlinks   | yes       | `~/.omp/agent/{hooks,tools,agents,skills}` each `realpath`-resolve to `$PWD/.omp/<name>`. |
| (e) | SpecSafe state   | optional  | `.pi/.specsafe-state.json` parses; absent → SKIP by default, FAIL under `--strict`. Corrupt file is always FAIL. |

A check classified as OPTIONAL with its prerequisite absent reports `SKIP` in default mode and `FAIL` under `--strict`. A present-but-broken optional check is always `FAIL`.

## Flags

| Flag       | Effect |
|------------|--------|
| `--strict` | Elevates OPTIONAL checks to REQUIRED — a missing prerequisite becomes `FAIL` instead of `SKIP`. |
| `--json`   | Emits a single JSON object to stdout. Top-level keys are `a`..`e`, each `{ status, note? }`. |

`--json` and `--strict` may be combined.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | All checks PASSed; optional checks may have SKIPped. |
| 1    | At least one check FAILed. |
| 2    | Invocation error (unknown flag). |

## Test seams

For black-box testing, spawn points can be replaced via env vars. When set, the skill spawns the named executable and uses its exit code/stdout/stderr in place of the real probe.

| Env var                   | Replaces |
|---------------------------|----------|
| `PI_ENVDOCTOR_LINEAR_CMD` | `bun run .omp/skills/linear/bin/linear.ts list --limit=1` |
| `PI_ENVDOCTOR_GH_CMD`     | `gh auth status` |
| `PI_ENVDOCTOR_OMP_CMD`    | `omp --version` |

## Secret hygiene

Every output line is filtered through a sanitizer that replaces literal occurrences of `LINEAR_API_KEY` with `<redacted>`. Lengths and hash digests are never printed; only `PASS` / `FAIL` / `SKIP` plus a redacted human note.

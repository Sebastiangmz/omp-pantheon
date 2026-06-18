---
name: env-doctor
description: Read-only pre-flight verifier. Checks Honcho/Linear/gh/omp connectivity, agent symlinks, and state-file integrity before a dogfood session. No mutations, no --i-approve gate.
---

# env-doctor skill

Single-shot diagnostic: runs eight checks in a fixed order and prints a PASS / FAIL / SKIP line per item. Read-only — touches no env vars, files, or remote resources beyond a single ephemeral round-trip per service.

## Usage

```
bun run .omp/skills/env-doctor/bin/env-doctor.ts [--strict] [--json]
```

## Checklist (fixed order)

| Id  | Label                  | Required? | Description                                                                                          |
|-----|------------------------|-----------|------------------------------------------------------------------------------------------------------|
| (a) | `HONCHO_API_KEY`       | yes       | Env var present + round-trip via `client.session(HONCHO_SESSION_ID).search('__envdoctor_probe__')`.  |
| (b) | HONCHO env vars        | yes       | `HONCHO_WORKSPACE_ID` and `HONCHO_PEER_ID` present. `HONCHO_SESSION_ID` is auto-derived as `<peer>-<basename-of-cwd>` (matches the omp shell function) when unset. |
| (c) | `LINEAR_API_KEY`       | optional  | Env present + `linear list --limit=1` exits 0. SKIP if env unset (FAIL under `--strict`).            |
| (d) | `gh auth`              | yes       | `gh auth status` exits 0.                                                                            |
| (e) | `omp config`           | yes       | `omp --version` exits 0 (probe is for binary aliveness, not config content). Searches PATH, `bun pm bin -g`, `$BUN_INSTALL/bin`, `~/.bun/bin`, `~/.cache/.bun/bin`, `~/.local/share/bun/bin`, and `/usr/local/bin` for the binary; FAIL if none found. |
| (f) | agent symlinks         | yes       | `~/.omp/agent/{hooks,tools,agents,skills}` each `realpath`-resolve to `$PWD/.omp/<name>`.            |
| (g) | honcho state           | optional  | `.pi/.honcho-state.json` parses (or is absent → SKIP). Corrupt file is always FAIL.                  |
| (h) | agent honcho config    | optional  | `~/.omp/agent/honcho.json` parses + is mode 0600 (or absent → SKIP). Corrupt file is always FAIL.    |

A check classified as OPTIONAL with its prerequisite **absent** reports `SKIP` in default mode and `FAIL` under `--strict`. A check that runs and fails (e.g. corrupt state file) is always `FAIL` regardless of `--strict`.

The honcho round-trip distinguishes:
- HTTP 401 / 403 → `FAIL` (auth rejected)
- HTTP 404 / "session not found" → `PASS` with note `auth OK (session not found)` — the goal is auth round-trip, not session validity.
- Any other non-zero → `FAIL` with sanitized first-line of the error.

## Flags

| Flag       | Effect                                                                                                  |
|------------|---------------------------------------------------------------------------------------------------------|
| `--strict` | Elevates OPTIONAL checks (c, g, h) to REQUIRED — a missing prerequisite becomes `FAIL` instead of `SKIP`. |
| `--json`   | Emits a single JSON object to stdout. Top-level keys are `a`..`h`, each `{ status, note? }`.            |

`--json` and `--strict` may be combined.

## Exit codes

| Code | Meaning                                                                       |
|------|-------------------------------------------------------------------------------|
| 0    | All checks PASSed (OPTIONAL may have SKIPped).                                |
| 1    | At least one check FAILed (REQUIRED, or OPTIONAL elevated by `--strict`, or any check whose prerequisite was present-but-broken). |
| 2    | Invocation error (unknown flag).                                              |

## Test seams

For black-box testing, the four spawn points can be replaced via env vars. When set, the skill spawns the named executable and uses its exit code / stdout / stderr in place of the real probe. This mirrors the `PI_GITHUB_GH_CMD` / `PI_GITHUB_LINEAR_CMD` idiom in `.omp/skills/github`.

| Env var                         | Replaces                                                                     |
|---------------------------------|------------------------------------------------------------------------------|
| `PI_ENVDOCTOR_HONCHO_PROBE_CMD` | The Honcho SDK round-trip in (a).                                            |
| `PI_ENVDOCTOR_LINEAR_CMD`       | `bun run .omp/skills/linear/bin/linear.ts list --limit=1` in (c).            |
| `PI_ENVDOCTOR_GH_CMD`           | `gh auth status` in (d).                                                     |
| `PI_ENVDOCTOR_OMP_CMD`          | `omp --version` in (e).                                                      |

## Secret hygiene

Every output line is filtered through a sanitizer that replaces literal occurrences of `HONCHO_API_KEY` and `LINEAR_API_KEY` with `<redacted>` (mirrors `sanitizeErrorForDisplay` in `.omp/tools/honcho/index.ts`). Lengths and hash digests are never printed; only `PASS` / `FAIL` / `SKIP` plus a redacted human note.

## Notes

- `gh auth status` exits 0 when at least one GitHub host is authenticated. The check passes as long as any host is logged in; it does not parse stdout for host names. If your repo targets a specific host, confirm separately.
- The honcho probe is a single read-only `search` call; it never writes messages, conclusions, or mutates session state. It is safe to run while another `omp` session is active against the same session id.
- On platforms that strip mode bits (e.g. some Windows filesystems), the 0600 spot-check on `~/.omp/agent/honcho.json` is skipped automatically.

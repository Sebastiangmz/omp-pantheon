---
name: coherence
description: Read-only cross-source consistency checker. Surfaces drift between Linear issue state, SpecSafe slice files, and commit Spec-Slice trailers. No mutations, no network writes.
---

# coherence skill

Provides read-only visibility into drift between three sources of truth:

- Linear issue state (queried via the `linear` skill)
- SpecSafe slice files under `specs/`
- Commit `Spec-Slice:` trailers in the local git history

The skill **never** mutates Linear, git, or files. There is no `--i-approve` flag.

## Prerequisites

- `LINEAR_API_KEY` — required for every subcommand. Absence is a config error
  (exit 2) with a single-line stderr notice; no stdout is emitted.
- A working `linear` skill at `.omp/skills/linear/bin/linear.ts`. Tests and CI
  may override the binary via `PI_COHERENCE_LINEAR_CMD`.

## Subcommands

### check linear-vs-specs

```
bun run .omp/skills/coherence/bin/coherence.ts check linear-vs-specs
```

Compares Linear `in_progress` / `in_review` tickets against `specs/<KEY>*.md`.
Emits one line per drift item:

- `[orphan-linear] <KEY> <state>, no spec` — open Linear ticket with no
  matching spec file.
- `[orphan-spec] <KEY> has spec but no matching Linear ticket` — spec file
  whose KEY does not appear in `linear list` output.

KEY matching uses the github skill regex `^([A-Z]+-[0-9]+)([-_].*)?$`, so
sub-slices like `CUR-92__login-fix.md` and `CUR-92__perf.md` both cover the
single Linear ticket `CUR-92`.

### check trailers-vs-linear [--range=\<git-range\>]

```
bun run .omp/skills/coherence/bin/coherence.ts check trailers-vs-linear
bun run .omp/skills/coherence/bin/coherence.ts check trailers-vs-linear --range=HEAD~10..HEAD
```

Scans commits in `<git-range>` (default `HEAD~50..HEAD`), extracts
`Spec-Slice:` trailers (last trailer per commit wins), and validates each
referenced ticket via `linear get`:

- `[orphan-trailer] <KEY> commit references unknown Linear ticket` — `linear
  get <KEY>` returns non-zero.
- `[stale-trailer] <KEY> commit trailer points to ticket in triage` — ticket
  is still in `triage`, meaning the trailer was committed before the ticket
  was promoted to active work.

Commits with no trailer or with malformed bodies are skipped silently.

### check brief-coverage

```
bun run .omp/skills/coherence/bin/coherence.ts check brief-coverage
```

For each Linear `in_progress` / `in_review` ticket, looks for a matching brief
file under `specs/briefs/<KEY>*.md`. Emits:

- `[orphan-brief] <KEY> <state>, no brief in specs/briefs/` — open ticket with
  no brief file. Repos lacking a `specs/briefs/` directory are tolerated; in
  that case every open ticket reports `orphan-brief`.

Brief matching only accepts `<KEY>.md`, `<KEY>-*`, `<KEY>__*`, or `<KEY>_*`
filenames so that `CUR-9` does not falsely match `CUR-92-brief.md`.

## Exit codes

| Code | Meaning                                                          |
|------|------------------------------------------------------------------|
| 0    | All sources are coherent — no drift items                        |
| 1    | Drift detected — one line per item on stdout                     |
| 2    | Config or usage error (missing `LINEAR_API_KEY`, bad subcommand) |

## Output format

Plain text. One drift item per line on stdout, prefixed with a category tag in
square brackets (e.g. `[orphan-linear]`). No JSON, no color codes. The format
is machine-greppable and human-readable; CI wrappers can pipe stdout through
`grep '^\['` to pull drift items.

## Implementation notes

- All Linear access goes through the `linear` skill — this skill never imports
  the linear-sdk package and makes no direct GraphQL calls. The upstream `linear list`
  table is parsed by header column position so multi-word state labels like
  `In Progress` survive intact before being normalized to `in_progress`.
- `LINEAR_API_KEY` is forwarded to every spawned `linear` invocation via the
  inherited environment.
- Tests under `.omp/test/coherence/` stub Linear by setting
  `PI_COHERENCE_LINEAR_CMD` to a shell script and providing fixture content
  through `PI_COHERENCE_LINEAR_LIST_FIXTURE` and
  `PI_COHERENCE_LINEAR_GET_FIXTURE_DIR`. Production code reads only
  `PI_COHERENCE_LINEAR_CMD`; the fixture variables are inert outside the test
  harness.
- The skill performs no network mutations and writes no files. It is safe to
  invoke from pre-commit hooks.

---
name: docs
description: Propose-review-apply flow for BMad artifacts (PRDs, UX specs, architecture, briefs). All applies require --i-approve and produce commits with Proposed-By/Approved-By trailers.
---

# docs

Safety gate for BMad-document edits. **Steward proposes; human (Luci) applies.**

Steward produces a unified diff + rationale and calls `docs propose`. The diff lands as a draft patch in `.pi/.doc-drafts/`. Luci reviews it with `docs list` and `docs show <id>`, then runs `docs apply <id> --i-approve` to land it as a structured commit. Rejected drafts are preserved under `.pi/.doc-drafts/.discarded/` for audit.

## Subcommands

### propose

```bash
# Read unified diff from stdin; require rationale explaining why
bun run .omp/skills/docs/bin/docs.ts propose docs/PRD.md --rationale="add onboarding section"
```

- Scope check: `<path>` must start with `docs/`, `specs/`, or `specs/briefs/`. Anything else is refused with a clear error.
- Validates that stdin is a well-formed unified diff (must contain `---` and `+++` headers).
- Writes `.pi/.doc-drafts/<ISO-timestamp>-<slug>.patch` (mode 0600).
- Prints the draft ID to stdout.

### list

```bash
bun run .omp/skills/docs/bin/docs.ts list
```

Lists all pending drafts as a table: `id | target | proposed_at | rationale (first 60 chars)`.
Prints `"no pending drafts"` when the queue is empty. Does not show discarded or applied drafts.

### show

```bash
bun run .omp/skills/docs/bin/docs.ts show 2026-04-24T14:02:11Z-prd-md
```

Prints the full patch file (rationale block + unified diff) to stdout. Exits non-zero if the ID is not found.

### apply

```bash
# Dry-run (default): preview what would be applied
bun run .omp/skills/docs/bin/docs.ts apply 2026-04-24T14:02:11Z-prd-md

# Approved apply: patch, stage, commit
bun run .omp/skills/docs/bin/docs.ts apply 2026-04-24T14:02:11Z-prd-md --i-approve
```

Without `--i-approve`: prints the full diff + `"NOT YET APPLIED (rerun with --i-approve)"`. Exit 0.

With `--i-approve`:
1. Verifies working tree is clean (`git status --porcelain` must be empty).
2. Applies the patch with `git apply --index`.
3. Reads `.pi/.specsafe-state.json` to determine if a SpecSafe slice is open.
4. Commits with structured trailers:
   ```
   docs: <rationale>

   <rationale>

   Proposed-By: steward
   Approved-By: luci
   Spec-Slice: <sliceId>     (omitted if no slice open)
   Rationale-From: <draft-id>
   ```
5. Moves the patch file to `.pi/.doc-drafts/.applied/<id>.patch` (forensic retention).

### discard

```bash
bun run .omp/skills/docs/bin/docs.ts discard 2026-04-24T14:02:11Z-prd-md
```

Moves the draft to `.pi/.doc-drafts/.discarded/<id>.patch`. Creates `.discarded/` if absent. Exits non-zero if the ID is not found.

## Allowed paths

Only paths beginning with one of these prefixes are accepted by `propose`:

| Prefix | Contains |
|--------|----------|
| `docs/` | PRDs, UX specs, architecture docs |
| `specs/` | SpecSafe spec slices |
| `specs/briefs/` | Linear-ticket briefs produced by Steward |

Any other path — including `README.md`, `src/`, etc. — is refused with:
```
docs skill is scoped to BMad artifacts (paths must start with docs/, specs/, or specs/briefs/)
```

## Typical workflow

```bash
# 1. Steward proposes a diff (run by Steward agent):
git diff HEAD docs/PRD.md | bun run .omp/skills/docs/bin/docs.ts propose docs/PRD.md \
  --rationale="add section 4 — onboarding flow per CUR-42"

# 2. Luci reviews:
bun run .omp/skills/docs/bin/docs.ts list
bun run .omp/skills/docs/bin/docs.ts show 2026-04-24T14:02:11Z-prd-md

# 3a. Luci approves:
bun run .omp/skills/docs/bin/docs.ts apply 2026-04-24T14:02:11Z-prd-md --i-approve

# 3b. Luci rejects:
bun run .omp/skills/docs/bin/docs.ts discard 2026-04-24T14:02:11Z-prd-md
```

## Storage

All draft files live under `.pi/.doc-drafts/` (gitignored, not committed to the repo):

```
.pi/.doc-drafts/
  2026-04-24T14:02:11Z-prd-md.patch     # pending
  .applied/
    2026-04-24T13:50:00Z-ux-spec-md.patch  # landed
  .discarded/
    2026-04-24T13:30:00Z-arch-md.patch     # rejected
```

## No Co-Authored-By

Commits created by `docs apply` carry **no** `Co-Authored-By` trailer. The commit represents a human decision (Luci's approval) on a Steward-proposed change. The `Proposed-By: steward` and `Approved-By: luci` trailers make the authorship chain explicit without attributing to any AI agent.

## Implementation notes

This skill carries inline copies of the `statePathFor` / `readStateFileOrNull` helpers from `.pi/extensions/specsafe-session` so that it runs identically under `pi` and `omp`. Pin tests under `.omp/test/specsafe.test.ts` enforce shape parity with the canonical extensions; see SPEC-008.2.

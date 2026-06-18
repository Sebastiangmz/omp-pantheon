# docs — Pi skill

Propose/review/apply safety gate for BMad artifacts (PRDs, UX specs, architecture, briefs). Steward drafts; human applies. Follows the project's `--i-approve` idiom: `propose` is a filesystem write to a draft queue, `apply --i-approve` is the only path that actually patches and commits.

See `SKILL.md` for the full subcommand reference. The sections below are for the human reader wandering in.

## Shape

```
docs/
  SKILL.md                 # model-facing capability doc
  README.md                # this file
  bin/docs.ts              # Bun CLI, exports dispatch(argv, opts)
  test/docs.test.ts        # unit tests (stub git) + integration tests (real git in temp repo)
```

## Why this skill exists

Agents draft prose well; agents should not commit prose directly to source-of-truth documents. The `docs` skill forces the flow through a human-reviewable queue, and the resulting commit carries trailers (`Proposed-By: steward`, `Approved-By: luci`, optional `Spec-Slice`, `Rationale-From`) so the authorship chain is legible forever.

## Path scoping

`propose` refuses any target path that does not start with `docs/`, `specs/`, or `specs/briefs/`. This is a structural guard — the skill is scoped to BMad artifacts, not source code or arbitrary files.

## Storage

```
.pi/.doc-drafts/                         # pending (gitignored, mode 0600 per file)
.pi/.doc-drafts/.applied/                # forensic retention of landed drafts
.pi/.doc-drafts/.discarded/              # forensic retention of rejected drafts
```

## Testability

`bin/docs.ts` exports `dispatch(argv, opts)` with an injectable `gitRunner`. Unit tests stub git for command-dispatch logic; integration tests run real git in a `fs.mkdtempSync` temp repo to verify the full propose → apply → commit → trailer chain.

## Commit trailers

`apply --i-approve` produces a commit like:

```
docs: <rationale first line>

<full rationale block>

Proposed-By: steward
Approved-By: luci
Spec-Slice: <sliceId>         (omitted when no slice is open)
Rationale-From: <draft-id>
```

No `Co-Authored-By` trailer — the commit represents Luci's decision on a Steward-drafted change, not agent authorship.

# github skill — operator notes

See [SKILL.md](./SKILL.md) for the canonical user-facing documentation. This file captures operator-level notes that don't belong in the skill description.

## Why bash

This skill shells out to `gh` and the sibling `linear` skill. Both are line-oriented CLIs; a TypeScript wrapper would add a dependency and a runtime without buying us anything. The push skill set the precedent for bash whenever the work is "resolve flags, call another CLI, log JSONL." We kept that.

## Cross-skill communication: github → linear

The Linear-state invariant on `pr create` is the first time two Pi skills communicate. Design choice: shell out to `linear get <KEY>` and parse stdout. Rationale:

- Pi-idiomatic (skills are process-level contracts, not libraries).
- The format — `state:       <Name> (<type>)` — is stable and locked to the linear skill's spec.
- Failure modes compose naturally: linear's exit 2 when `LINEAR_API_KEY` is unset is what we catch to implement Q2 (auto-skip).

The alternative — importing `linear.ts` as a module — would pull TypeScript into a bash skill and couple the two skills' type shapes. Rejected.

## State parsing

Branch → Linear key regex: `^([A-Z]+-[0-9]+)([-_].*)?$`. Matches `CUR-92-login-fix`, `CUR-92__login-fix`, `SPEC-12`.

State name → slug: lowercase + replace spaces with underscores. "In Progress" → `in_progress`, "In Review" → `in_review`. Linear's workflow state *names* are user-configured; this is a best-effort normalization. Teams that use non-default names must either match the pattern or use `--bypass-linear-check`.

PR-ready states default is hardcoded to `(in_progress in_review)` for v1. If Luci wants a teams-specific allowlist later, promote it to an env var; until then, YAGNI.

## Logging

- Path: `.pi/.github-log.jsonl` (mode 0600, gitignored).
- Format: one JSON object per line: `{ts, cmd, args, exit, result_url, approver}`.
- `result_url` is best-effort: scraped from gh's stdout for create/comment, looked up via `gh pr view --json mergeCommit` for merges.
- Safe JSON serialization uses `jq` when available; falls back to a minimal escape that handles backslash and double-quote.

## Edge cases handled

- `gh` not installed → exit 127 with install + auth hint (AC 9).
- Branch with no Linear key + no bypass → refuse with rename hint (AC 5).
- Ticket in non-ready state + no bypass → refuse with transition hint (AC 4).
- Missing `LINEAR_API_KEY` → auto-skip invariant with notice (Q2).
- `gh api` with no `-X` → GET → pass-through. With `-X POST|PATCH|...` → gated.

## Edge cases **not** handled (deliberate)

- `gh pr review` is out of scope per spec §2. Humans write reviews.
- Rate-limit header surfacing (spec Q3) is left as a future enhancement; `gh` already prints rate-limit errors when they happen.
- Branch names with the Linear key in the middle (e.g. `feat-CUR-92-foo`) are rejected — the key must be the prefix. This is intentional: we want the convention to be unambiguous.

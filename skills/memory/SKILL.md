---
name: memory
description: Read-side helpers for Honcho memory and SpecSafe slice cost/activity. Status, review, cost, history, search — all read-only.
---

# memory skill

Provides read-only visibility into SpecSafe slice state and Honcho memory. No mutations are made to Honcho or to the state file.

## Prerequisites

- `HONCHO_API_KEY` — required for `review` and `search` commands
- `HONCHO_WORKSPACE_ID` — required for `search`; optional for `review` (falls back to workspaceId stored in state)

## Subcommands

### status

Print a summary of the currently open slice, including cost counters.

```
bun run .omp/skills/memory/bin/memory.ts status
```

If no slice is open, prints "no slice currently open" and shows the last 3 history entries.

### review \<session-id\>

List all Honcho conclusions written during the given session, filtered to conclusions whose `created_at` falls within the session's `beganAt..endedAt` window (with a ±5 s grace band).

```
bun run .omp/skills/memory/bin/memory.ts review sess-xyz789
```

Iterates over the three conclusion-writer peers (validator, reviewer, steward) and aggregates results.

### cost [\<slice-id\>]

Print a human-readable cost breakdown for a slice.

```
bun run .omp/skills/memory/bin/memory.ts cost
bun run .omp/skills/memory/bin/memory.ts cost SPEC-20260424-003
```

If `<slice-id>` is omitted, uses the current open slice; if no slice is open, uses the most recent history entry.

### history [--limit=N]

Print recent finished slices with their outcome and cost. Default limit is 10.

```
bun run .omp/skills/memory/bin/memory.ts history
bun run .omp/skills/memory/bin/memory.ts history --limit=5
```

### search \<query\>

Semantic + text search across Honcho memory at workspace scope. Iterates over the conclusion-writer peers (validator, reviewer, steward) and merges results.

```
bun run .omp/skills/memory/bin/memory.ts search "login regression"
```

## Output format

All output is plain text — no JSON, no color codes. Numbers are right-aligned in their columns. Tables include a `total:` footer where appropriate.

## Error codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 0    | Success                                      |
| 1    | Usage error (wrong args, slice not found)    |
| 2    | State or network error (missing env, Honcho) |

## Implementation notes

This skill carries inline copies of the `statePathFor` / `readStateFileOrNull` helpers from `.pi/extensions/specsafe-session` (memory also inlines `CONCLUSION_WRITERS` from `.pi/extensions/honcho`) so that it runs identically under `pi` and `omp`. Pin tests under `.omp/test/specsafe.test.ts` and `.omp/test/honcho.test.ts` enforce shape parity with the canonical extensions; see SPEC-008.2.

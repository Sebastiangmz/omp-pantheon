# memory

Read-side helpers for Honcho memory and SpecSafe slice cost/activity. All commands are read-only — no mutations to Honcho or local state.

## Installation

No separate installation needed. Requires Bun and the `@honcho-ai/sdk` package (already in `package.json`).

## Env vars

| Variable | Required for | Notes |
|---|---|---|
| `HONCHO_API_KEY` | `review`, `search` | Exit 2 with clear message if missing |
| `HONCHO_WORKSPACE_ID` | `search` (required); `review` (optional) | `review` falls back to the workspaceId stored in the state file |

## Commands

### `status`

```
bun run .omp/skills/memory/bin/memory.ts status
```

Reads `.pi/.honcho-state.json`. If a slice is open, prints:

```
slice:                  SPEC-20260424-003
session:                sess-xyz789
workspace:              ws-abc123
began:                  2026-04-24T14:02:11Z
honcho_calls:                  42
subagent_turns:                 7
subagent_input_tok:         15230
subagent_output_tok:         3104
```

If no slice is open, prints "no slice currently open" and the last 3 history entries.

Exit 0 in both cases.

### `review <session-id>`

```
bun run .omp/skills/memory/bin/memory.ts review <session-id>
```

Looks up the session in the state file (current slice or history). Fetches conclusions from Honcho for each conclusion-writer peer (validator, reviewer, steward) and filters to those whose `created_at` falls within the session's `beganAt..endedAt` window, with a ±5 s grace band.

Output format per conclusion:
```
[2026-04-24T14:05:33Z] validator: The login regression is confirmed fixed...
```

Content is truncated to 200 characters per conclusion.

**Requires:** `HONCHO_API_KEY`

Exit codes:
- 0: success
- 1: no `<session-id>` argument supplied
- 2: session not found in state, missing `HONCHO_API_KEY`, or Honcho network error

### `cost [<slice-id>]`

```
bun run .omp/skills/memory/bin/memory.ts cost
bun run .omp/skills/memory/bin/memory.ts cost SPEC-20260424-003
```

Prints a cost breakdown table:

```
slice:                  SPEC-20260424-003
honcho_calls:                  42
honcho_cost:               $0.0084
subagent_turns:                 7
 input tokens:              15230
 output tokens:              3104
 cache read:                22400
 cache write:                 980
 subagent_cost:             $0.0412
total:                     $0.0496
```

If `<slice-id>` is omitted: uses the current open slice; if none is open, uses the most recent history entry.

Exit codes:
- 0: success
- 1: specified slice ID not found

### `history [--limit=N]`

```
bun run .omp/skills/memory/bin/memory.ts history
bun run .omp/skills/memory/bin/memory.ts history --limit=5
```

Prints recent finished slices. Default `N=10`. Columns: `sliceId | outcome | began | ended | cost`.

Exit 0 always (prints "(no history)" if empty).

### `search <query>`

```
bun run .omp/skills/memory/bin/memory.ts search "query text"
```

Searches Honcho at workspace scope by iterating over conclusion-writer peers (validator, reviewer, steward) and merging results. Output format:

```
- first result content truncated to 160 chars...
- second result
```

Prints "(no matches)" when there are no results.

**Requires:** `HONCHO_API_KEY`; `HONCHO_WORKSPACE_ID` (or falls back to state file)

Exit codes:
- 0: success (including no matches)
- 1: no query argument supplied
- 2: missing `HONCHO_API_KEY` or Honcho network error

## Architecture note

`bin/memory.ts` exports a pure `dispatch(argv, opts)` function that accepts a `honchoClientFactory` for full unit-testability without network calls. The `import.meta.main` block at the bottom is the only place `process.*` is referenced.

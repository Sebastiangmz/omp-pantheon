# Oh My Pi hook port — notes

Audit trail for what could be ported faithfully from `.pi/extensions/`
to `.omp/hooks/` and what required adaptation. Source-of-truth references
are in the header comments of each ported file.

## specsafe-session.ts

**Source:** `.pi/extensions/specsafe-session/index.ts`

**Ported faithfully**
- `StateFile`/`CurrentSlice`/`HistoryEntry`/`CostCounter` shapes
- `statePathFor(cwd)` — same `.pi/.specsafe-state.json` location
- `readStateFileOrNull` — same corrupt-quarantine semantics

**Dropped / adapted**
- The vanilla extension registered three Pi tools (`specsafe_begin`,
  `specsafe_end`, `specsafe_status`) via `ExtensionAPI.registerTool`. Oh
  My Pi hooks do not register tools the same way; they listen on lifecycle
  events. The slice-lifecycle tool surface stays in `.pi/` for the
  vanilla-Pi runtime. The `.omp/` hook only **reads** the state file and
  emits a trailer block on `session_shutdown` when a slice is open.
- **No CostCounter mutation.** The Oh My Pi port preserves the counter shape but
  does not introduce token or paid-memory accumulation: doing so would be a
  fabricated feature in this public bundle.

## specsafe-subagents.ts

**Source:** `.pi/extensions/specsafe-subagents/index.ts`

**Ported faithfully**
- `commitSubagentWork` — verbatim git porcelain + trailer-add flow
- The four trailers: `Co-Authored-By` / `Spec-Slice` / `Peer` / `Session`
- The runAgent guard (`exitCode === 0 && currentSlice` → only then commit)
  is reproduced via `tool_result` `isError !== true` + slice-open check
- `Co-Authored-By` uses the **agent/persona name**, NOT the resolved
  model — matches source line 96 (`<${agent}@seshat.local>`). The task
  description's "based on the resolved model" phrasing was inaccurate;
  the source is authoritative.

**Dropped — does not have a clean port**
- **Per-spawn child env injection** (`SPECSAFE_SLICE_ID` and per-agent
  identity). Vanilla Pi shipped its own `subagent` tool that called
  `child_process.spawn` with a per-call `env` object computed from the active
  slice + agent name. Oh My Pi has its own bundled `task` tool whose subprocess
  we do NOT control from a hook — there is no per-spawn env-injection seam
  exposed by `HookAPI`. Setting global process env at `session_start` is NOT
  equivalent: it would leak across every subprocess Oh My Pi spawns and lose
  per-agent identity. Per the porting rules, fabricating an API is forbidden;
  this piece is intentionally not ported.

  **Workarounds available to the operator:**
  1. Re-author the Oh My Pi `task` agents (`.omp/agents/*.md`) so each agent
     declares its own peer id in its final report.
  2. Patch upstream `@oh-my-pi/pi-coding-agent` to expose a pre-spawn-env hook.
     Out of scope for this port.

## Tests

`.omp/test/specsafe.test.ts` ports the `commitSubagentWork` cases
verbatim (clean tree, dirty tree with trailers, non-repo cwd). The
`buildChildEnv` tests from the vanilla suite are dropped: that helper
is not present in the Oh My Pi port (see env-injection note above).

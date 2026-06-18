# Honcho tool — pi-seshat → Oh My Pi port notes

Faithful port of `.pi/extensions/honcho/index.ts` onto the OMP
`CustomToolFactory` surface.

## Behavioral parity

All four tools (`honcho_recall`, `honcho_search`, `honcho_remember`,
`honcho_conclude`) preserve the original semantics. Critical invariants:

- Allowlist (`validator`/`reviewer`/`steward` only) on `honcho_conclude`.
- `product:` prefix required for steward conclusions.
- `HONCHO_API_KEY` redacted from error text via `sanitizeErrorForDisplay`.
- Workspace-scope search is rejected with `not yet wired`.

## Adaptations forced by the OMP API

- **No agent-identity field on the tool context.** OMP's `CustomToolContext`
  (see `@oh-my-pi/pi-coding-agent/src/extensibility/custom-tools/types.ts`)
  exposes `sessionManager`, `modelRegistry`, `model`, `settings`, but no
  per-call agent identity. Same as vanilla Pi. Identity is therefore read
  from `process.env` at call time, exactly as in the source. Optional
  hydration from `~/.omp/agent/honcho.json` is added — file shape is
  identical to `~/.pi/agent/honcho.json`, so the two MAY be symlinked.

## Identity model under the `as_peer` contract (SPEC-008.1)

As of SPEC-20260426-008.1, `honcho_conclude` requires an `as_peer` parameter
carrying the Ghola's declared peer identity. The allowlist (`validator`,
`reviewer`, `steward`) is validated against this declared value — NOT against
`process.env.HONCHO_PEER_ID`.

**This allowlist is model-trusted.** A misbehaving model can lie about
`as_peer` and bypass the gate. This trade-off is accepted explicitly for the
following reasons (see SPEC-008.1 §3.5):

1. The threat model for pi-seshat is not adversarial — Gholas are our own
   personas dispatched by our own orchestrator.
2. The Steward `product:` prefix is an independent, content-shape invariant
   that functions as a reviewer-visible audit trail.
3. Process-trusted enforcement requires a per-agent identity surface that
   v14.4.0 of `@oh-my-pi/pi-coding-agent` does not expose.

**§3.1 identity-spoofing prevention decision summary:**

- **(a) Read agent name from `ctx.sessionManager.getEntries()`** — INFEASIBLE.
  `SessionEntry` union has no agent-identity type; `SessionInitEntry` stores
  only `systemPrompt`, `task`, `tools`, `outputSchema`. No agent name field.
- **(b) Write active agent name to a session-scoped scratch file on spawn** —
  INFEASIBLE without a clean spawn seam. The `before_agent_start` and
  `agent_start` hook events are parent-side with no agent-name payload;
  `TASK_SUBAGENT_LIFECYCLE_CHANNEL` is private. Concurrent parallel dispatches
  would race on any shared scratch file; `CustomToolContext` exposes no task id
  to key per-task files.
- **(c) Accept model-trust degradation explicitly (PRIMARY PATH)** — adopted.
  Persona prompts instruct each Ghola to declare its identity via `as_peer`.
  The tool validates the declared value. Defense-in-depth: Steward prefix +
  reviewer audit.

**Follow-up trigger:** if upstream adds `ctx.activeAgent?.name`, a
`subagent_start` hook event with `agentName`, or any other in-process
agent-identity surface, switch to that as a hard cross-check and reject
`as_peer` mismatches as `isError`.
- **TypeBox injected via `pi.typebox`** instead of imported from the
  `typebox` package. Schemas are constructed inside the factory; the
  test-callable inner factory (`buildHonchoTools`) does not depend on
  TypeBox so unit tests stay framework-free.
- **`StringEnum` from `pi.pi`** is used instead of `Type.Union(...Literal)`
  for cross-provider (Google) compatibility, per OMP custom-tools README.
- **Factory returns an array of tools** (OMP supports
  `CustomTool | CustomTool[] | Promise<...>`); vanilla Pi registered them
  one-by-one via `pi.registerTool`.
- **Execute signature.** OMP uses
  `(toolCallId, params, onUpdate, ctx, signal)`; the source tests call the
  inner tools with the legacy
  `(id, params, signal, onUpdate, ctx)` ordering. The inner factory
  preserves the legacy ordering for test fidelity; the OMP-facing wrapper
  (`adapt(...)` inside the factory) translates to OMP's order.
- **Cost counter writes to `<cwd>/.pi/.honcho-state.json`** until the
  SpecSafe-session extension is itself ported (`slice-009`). Best-effort
  and silent on missing file. Drop / re-point when SpecSafe lands in
  `.omp/`.

## Test status

`bun test ./.omp/test/honcho.test.ts --test-name-pattern='\[unit\]'`
→ 14 pass, 4 skip (live), 0 fail. The live tests run when
`HONCHO_TESTS_LIVE=1` and a real `HONCHO_API_KEY` are present.

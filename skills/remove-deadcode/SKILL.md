---
name: remove-deadcode
description: "Remove unused code from this project with LSP-verified safety and parallel task subagents for atomic removal batches. Triggers: 'remove dead code', 'dead code', 'cleanup', 'remove unused'."
---

Dead code removal via massively parallel `task` subagents. You are the ORCHESTRATOR — you scan, verify, batch, then delegate ALL removals to parallel agents.

<rules>
- **LSP is law.** Verify with `lsp(action: "references")` before ANY removal decision.
- **Never remove entry points.** `src/index.ts`, `src/cli/index.ts`, test files, config files, `packages/` — off-limits.
- **You do NOT remove code yourself.** You scan, verify, batch, then fire `task` subagents. They do the work.
</rules>

<false-positive-guards>
NEVER mark as dead:
- Symbols in `src/index.ts` or barrel `index.ts` re-exports
- Symbols referenced in test files (tests are valid consumers)
- Symbols with `@public` / `@api` JSDoc tags
- Hook factories (`createXXXHook`), tool factories (`createXXXTool`), agent definitions in `agentSources`
- Command templates, skill definitions, config files
- Symbols in `package.json` exports
</false-positive-guards>

---

## PHASE 1: SCAN — Find Dead Code Candidates

Run ALL of these in parallel:

<parallel-scan>

**TypeScript strict mode (your primary scanner — run this FIRST):**
```bash
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1
```
This gives you the definitive list of unused locals, imports, parameters, and types with exact file:line locations.

**Explore agents (fire ALL simultaneously via one `task()` call):**

```
task(
  agent: "explore",
  context: "Dead code scan. Return file paths and symbol names for candidates.",
  tasks: [
    {
      id: "OrphanFiles",
      role: "Orphaned file finder",
      description: "Find orphaned files",
      assignment: "Find files in src/ NOT imported by any other file. Check all import statements using search and find. EXCLUDE: index.ts, *.test.ts, entry points, .md, packages/. Return: file paths."
    },
    {
      id: "UnusedExports",
      role: "Unused export symbol finder",
      description: "Find unused exported symbols",
      assignment: "Find exported functions/types/constants in src/ that are never imported by other files. Cross-reference: for each export, use search to find the symbol name across src/ — if it only appears in its own file, it's a candidate. EXCLUDE: src/index.ts exports, test files. Return: file path, line, symbol name, export type."
    }
  ]
)
```

</parallel-scan>

Collect all results into a master candidate list.

---

## PHASE 2: VERIFY — LSP Confirmation (Zero False Positives)

For EACH candidate from Phase 1:

```
lsp(action: "references", file: "<filePath>", line: <line>, character: <character>)
// 0 references → CONFIRMED dead
// 1+ references → NOT dead, drop from list
```

Also apply the false-positive-guards above. Produce a confirmed list:

```
| # | File | Symbol | Type | Action |
|---|------|--------|------|--------|
| 1 | src/foo.ts:42 | unusedFunc | function | REMOVE |
| 2 | src/bar.ts:10 | OldType | type | REMOVE |
| 3 | src/baz.ts:7 | ctx | parameter | PREFIX _ |
```

**Action types:**
- `REMOVE` — delete the symbol/import/file entirely
- `PREFIX _` — unused function parameter required by signature → rename to `_paramName`

If ZERO confirmed: report "No dead code found" and STOP.

---

## PHASE 3: BATCH — Group by File for Conflict-Free Parallelism

<batching-rules>

**Goal: maximize parallel agents with ZERO git conflicts.**

1. Group confirmed dead code items by FILE PATH
2. All items in the SAME file go to the SAME batch (prevents two agents editing the same file)
3. If a dead FILE (entire file deletion) exists, it's its own batch
4. Target 5-15 batches. If fewer than 5 items total, use 1 batch per item.

**Example batching:**
```
Batch A: [src/hooks/foo/hook.ts — 3 unused imports]
Batch B: [src/features/bar/manager.ts — 2 unused constants, 1 dead function]
Batch C: [src/tools/baz/tool.ts — 1 unused param, src/tools/baz/types.ts — 1 unused type]
Batch D: [src/dead-file.ts — entire file deletion]
```

Files in the same directory CAN be batched together (they won't conflict as long as no two agents edit the same file). Maximize batch count for parallelism.

</batching-rules>

---

## PHASE 4: EXECUTE — Fire Parallel Task Subagents

Fire ALL batches simultaneously in a single `task()` call:

```
task(
  agent: "task",
  context: "Dead code removal. Load and follow the git-master skill for commit discipline. Each agent handles one batch of files. Read the file, re-verify with lsp(action: 'references') that symbols are still dead, apply the removal, then run bash('bunx tsc --noEmit') to verify. If typecheck fails, revert with bash('git checkout -- [files]') and report failure. Stage ONLY your batch's files — NEVER git add -A.",
  tasks: [
    {
      id: "DeadcodeBatchA",
      role: "Dead code remover — batch A specialist",
      description: "Remove dead code batch A: [brief description]",
      assignment: "## TASK: Remove dead code from [file list]\n\n## DEAD CODE TO REMOVE\n\n### [file path] line [N]\n- Symbol: `[name]` — [type: unused import / unused constant / unused function / unused parameter / dead file]\n- Action: [REMOVE entirely / REMOVE from import list / PREFIX with _]\n\n## PROTOCOL\n\n1. Read each file to understand exact syntax at the target lines\n2. For each symbol, run lsp(action: 'references') to RE-VERIFY it's still dead (another agent may have changed things)\n3. Apply the change:\n   - Unused import (only symbol in line): remove entire import line\n   - Unused import (one of many): remove only that symbol from the import list\n   - Unused constant/function/type: remove the declaration. Clean up trailing blank lines.\n   - Unused parameter: prefix with `_` (do NOT remove — required by signature)\n   - Dead file: delete with bash('rm <file>')\n4. After ALL edits in this batch, run: bash('bunx tsc --noEmit')\n5. If typecheck fails: bash('git checkout -- [files]') and report failure\n6. If typecheck passes: report what you removed\n\n## CRITICAL\n- Stage ONLY your batch's files. NEVER git add -A — other agents are working in parallel.\n- If typecheck fails after your edits, REVERT all changes and report. Do not attempt to fix.\n- Pre-existing test failures in other files are expected. Only typecheck matters for your batch."
    },
    {
      id: "DeadcodeBatchB",
      role: "Dead code remover — batch B specialist",
      description: "Remove dead code batch B: [brief description]",
      assignment: "[same structure, different files]"
    }
    // ... one task per batch
  ]
)
```

Wait for all batch agents to complete.

---

## PHASE 5: FINAL VERIFICATION

After ALL agents complete:

```bash
bunx tsc --noEmit    # must pass
bun test             # note any NEW failures vs pre-existing
bun run build        # must pass
```

Produce summary:

```markdown
## Dead Code Removal Complete

### Removed
| # | Symbol | File | Type | Agent |
|---|--------|------|------|-------|
| 1 | unusedFunc | src/foo.ts | function | Batch A |

### Skipped (agent reported failure)
| # | Symbol | File | Reason |
|---|--------|------|--------|

### Verification
- Typecheck: PASS/FAIL
- Tests: X passing, Y failing (Z pre-existing)
- Build: PASS/FAIL
- Total removed: N symbols across M files
- Parallel agents used: P
```

---

## SCOPE CONTROL

If `$ARGUMENTS` is provided, narrow the scan:
- File path → only that file
- Directory → only that directory
- Symbol name → only that symbol
- `all` or empty → full project scan (default)

## ABORT CONDITIONS

STOP and report if:
- More than 50 candidates found (ask user to narrow scope or confirm proceeding)
- Build breaks and cannot be fixed by reverting

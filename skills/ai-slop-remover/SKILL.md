---
name: ai-slop-remover
description: Removes AI-generated code smells from a SINGLE file while preserving functionality. For multiple files, call in PARALLEL per file.
---

# ai-slop-remover

You are an expert code refactorer specializing in removing AI-generated "slop" patterns while STRICTLY preserving functionality.

## Mandate

- Remove only AI-generated noise. Preserve every behavior the file produces.
- Operate on ONE file at a time. Multi-file work is the orchestrator's job — they call this skill in parallel via `task`.
- Save a per-file rollback patch before editing so the change can be reverse-applied if review fails. Do **not** use `git checkout -- <file>` — that wipes pre-existing branch changes.

## What AI slop looks like

### Comment smells (highest signal — detect and remove aggressively)

| Pattern | Example | Action |
|---|---|---|
| Restating what code literally does | `// increment counter` above `counter++` | Delete |
| Filler phrases | `// obviously`, `// clearly`, `// simply` | Delete |
| Decorative separators without purpose | `// ========` between functions | Delete |
| JSDoc on trivially-named functions | `/** Gets the name. */ getName()` | Delete |
| `// TODO:` without actionable context | `// TODO: implement later` | Delete or make specific |
| Comments contradicting surrounding code | Comment says one thing, code does another | Delete the comment |
| Docstrings repeating the signature | `def add(a, b): """Add a and b."""` | Delete |

### Code smells

| Pattern | Example | Action |
|---|---|---|
| Defensive `try/except` around safe ops | `try { x = 5 } catch { … }` | Unwrap |
| Redundant null guards | `if (x === undefined && x === null)` | Simplify |
| "Clever" one-liners for no reason | rewrites of straightforward code | Revert to straightforward |
| Console / print noise | `console.log("entering function")` | Delete |
| Excessive type annotations on locals | `const sum: number = 1 + 2` | Drop |
| Unnecessary intermediate variables | `const result = foo(); return result;` | `return foo();` |
| Over-abstraction for a single call site | Wrapper function called once | Inline |

## What you MUST preserve

- Every public API signature
- Every observable side effect
- Every error-handling code path the surrounding code depends on
- Every test behavior
- Imports that other code in the file uses
- Comments that explain WHY (business logic, gotchas, workarounds)

## Workflow

1. `read` the target file.
2. Identify slop candidates. List them with line numbers and category.
3. Save a rollback patch:
   ```bash
   git diff <file> > /tmp/<file-basename>.preslop.patch
   ```
4. Apply minimal `edit` operations — one per slop site.
5. Verify:
   - `lsp(action: "diagnostics", file: "<file>")` — must be clean
   - File still parses (no syntax errors)
   - Related tests still run (if identifiable)
6. Report changes as a summary table: `| Line | Category | Action |`.

**If uncertain about any edit, KEEP THE ORIGINAL CODE.** False negatives (leaving slop) are acceptable; false positives (breaking behavior) are not.

## Bypass markers

The following markers indicate an intentional comment that should NOT be removed:
- `// @allow` — explicit bypass
- `// comment-checker-disable-file` at file top — file-level bypass
- `// eslint-disable` / `// @ts-ignore` / `// noinspection` — tool-specific markers

Use these sparingly — defeating the purpose of slop removal.

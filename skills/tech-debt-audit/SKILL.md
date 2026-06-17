---
name: tech-debt-audit
description: "Thorough, file-cited technical debt audit across 9 dimensions using ast_grep (tree-sitter), search, bash, and LSP. Produces TECH_DEBT_AUDIT.md with severity, effort estimates, and prioritized fixes. Use when asked for codebase health check, tech debt audit, architecture review, code quality assessment, or cleanup planning. Triggers: 'tech debt', 'technical debt', 'debt audit', 'code health', 'technical debt audit', 'codebase health check', 'find tech debt', 'debt analysis', 'audit code quality'."
---

# Tech Debt Audit Protocol

Technical debt audit using OMP tools (`search`, `find`, `bash`, `read`, `lsp`, `ast_grep`, `task`). Produces a grounded, citable `TECH_DEBT_AUDIT.md` artifact.

## Hard Preconditions

1. You are in the **main session**, not a background subagent — Phase 2 fans out parallel `task` subagents, which must not recurse. A parent `task` agent MUST NOT load this skill.
2. You have a concrete target (repo, path list, or subtree). Absent one, audit the current working tree.

> **Note:** The upstream skill supported optional [CodeGraph](https://github.com/colbymchenry/codegraph) MCP integration for enhanced code-graph analysis (symbol search, call graph, impact analysis, framework-aware routes). Those CodeGraph-specific sections (under Phase 0, dimensions 1, 5, and 7) are omitted from this port as CodeGraph MCP is not bundled. If CodeGraph is available in your environment, its `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, and `codegraph_explore` tools can augment the standard scans in those dimensions.

---

## Output

Write results to `TECH_DEBT_AUDIT.md` in the repo root with:

1. **Executive Summary** — 3-5 sentences: overall health, worst dimension, quick wins count
2. **Mental Model** — the repo's architecture in 1 paragraph (what it does, stack, module boundaries)
3. **Findings Table** — columns: ID, Category, File:Line, Severity (Critical/High/Medium/Low), Effort (Hours), Description, Recommendation
4. **Top 5 Priorities** — ranked by impact/effort ratio
5. **Quick Wins Checklist** — items under 30 minutes each
6. **"Looks Bad But Is Fine"** — patterns that look like debt but are intentional
7. **Open Questions** — things the maintainer should clarify

## Phase 0: Orient

1. `find("**/*.ts")` / `find("**/*.py")` / etc — map the language stack
2. `find("**/package.json")` + `read()` — dependencies and build tooling
3. `bash("git log --oneline -200")` — churn: find highest-change files
4. `find("**/*")` + basic math — find largest files (>300 LOC are candidates)
5. Cross-reference high-churn + large = debt hot zones
6. Write the mental model paragraph in your own working context

## Phase 1: Audit Across 9 Dimensions

Use OMP tools for each dimension. Run parallel tool calls within each dimension. Every finding MUST cite `file:line:col`.

### 1. Architectural Decay

- `ast_grep(pat: "import { $$$ } from '$SRC'", paths: ["src/"])` — map module graph, look for circular patterns
- `ast_grep(pat: "class $NAME { $$$ }", paths: ["src/"])` — check for god classes
- `search(pattern: "TODO|FIXME|HACK|XXX|WORKAROUND|TEMP")` — tagged debt markers
- `search(pattern: "async|await")` on sync-looking files — misplaced async boundaries
- `bash("wc -l <file>")` on each large file found in Phase 0

#### What to flag
- Files > 500 LOC (god files)
- Functions > 80 LOC or > 4 nesting levels
- Classes with > 15 methods or > 400 LOC
- Import cycles (A → B → A)
- Dead exports: function/class defined but never imported elsewhere
- Commented-out code blocks (>3 consecutive lines)

### 2. Consistency Rot

- `ast_grep(pat: "import $CLIENT from '$PKG'", paths: ["src/"])` — multiple HTTP clients
- `search(pattern: "console\\.log|console\\.error|console\\.warn")` — direct console use vs logger
- `ast_grep(pat: "try { $$$ } catch ($$$) { $$$ }", paths: ["src/"])` — error handling patterns
- `search(pattern: "as any|@ts-ignore|@ts-expect-error|as unknown")` — type escapes
- `search(pattern: "eslint-disable|prettier-ignore")` — lint suppressions

#### What to flag
- 3+ ways of doing the same thing (HTTP, logging, validation, config)
- Mixed naming conventions (camelCase + snake_case + PascalCase)
- Multiple date/time handling libraries
- Mixed error response shapes across modules

### 3. Type & Contract Debt

- `ast_grep(pat: "$VALUE as any", paths: ["src/"])` — runtime type escapes
- `search(pattern: "@ts-expect-error")` — suppressed errors
- `search(pattern: "@ts-ignore")` — suppressed errors (legacy)
- `ast_grep(pat: "$NAME: any", paths: ["src/"])` — typed as any
- `lsp(action: "diagnostics")` — current type errors

#### What to flag
- `any` types on public APIs and exported interfaces
- Untyped function parameters
- Missing schema validation at API/IO boundaries
- LSP type errors grouped by file

### 4. Test Debt

- `find("**/*.test.ts")` — find all test files
- `bash("bun test 2>&1 | grep -E '(fail|skip|todo)'")` — current test health
- Cross-reference Phase 0 high-churn files with test existence

#### What to flag
- Critical-path files with zero tests
- Skipped tests (`test.skip`, `describe.skip`)
- Tests asserting implementation details vs behavior
- Slow tests (>1s each)

### 5. Dependency & Config Debt

- `bash("npm audit --omit=dev 2>&1 | head -40")` — known CVEs (if node_modules present)
- `read("package.json")` — check dependency count and stale deps
- `search(pattern: "\\.env|process\\.env|Bun\\.env")` — env var usage
- `search(pattern: "API_KEY|SECRET|PASSWORD|TOKEN")` in non-config files — hardcoded config

#### What to flag
- Outdated major-version deps
- Dependencies that do the same thing (duplicate libraries)
- Referenced env vars not documented in README
- Hardcoded environment-specific values

### 6. Performance & Resource Hygiene

- `ast_grep(pat: "for ($_ of $_) { $$$ await $$$ }", paths: ["src/"])` — async-in-loop
- `search(pattern: "await.*map|await.*filter|await.*forEach")` — sequential async iteration
- `search(pattern: "Promise\\.all|Promise\\.allSettled")` — existing parallel patterns (good signal)
- `search(pattern: "addEventListener|on\\(|subscribe")` without `removeEventListener|off\\(|unsubscribe` nearby — listener hygiene

#### What to flag
- `await` inside `for/of` loops (sequential when parallel possible)
- N+1 query patterns
- Missing cleanup on event listeners, intervals, handles
- Unnecessary serialization/deserialization

### 7. Error Handling & Observability

- `ast_grep(pat: "catch ($$$) { $$$ }", paths: ["src/"])` — catch blocks
- `search(pattern: "catch.*\\{\\}|catch.*\\{\\s*\\}")` — empty catch blocks
- `search(pattern: "console\\.error|logger\\.error|log\\.error")` — actual error logging
- `ast_grep(pat: "throw new $ERR($$$)", paths: ["src/"])` — error types used

#### What to flag
- Empty catch blocks (worst offense)
- Generic `catch (e) { console.error(e) }` without recovery
- Inconsistent error shapes across modules
- Missing structured logging on critical paths
- Errors swallowed in promise chains (`.catch(() => {})`)

### 8. Security Hygiene

- `search(pattern: "api[Kk]ey|api_secret|password|secret|token|credential")` in source files (not config or env)
- `search(pattern: "SELECT .* FROM|INSERT INTO|UPDATE.*SET|DELETE FROM")` — SQL construction
- `search(pattern: "innerHTML|dangerouslySetInnerHTML")` — XSS vectors
- `search(pattern: "eval\\(|Function\\(|setTimeout\\(.*string|setInterval\\(.*string")` — code injection

#### What to flag
- Hardcoded secrets in source
- String-concatenated SQL
- `innerHTML` / `dangerouslySetInnerHTML` usage
- `eval()` or string-based `setTimeout`/`setInterval`
- Permissive CORS or auth middleware

### 9. Documentation Drift

- `read("README.md")` — check if claims match reality
- `search(pattern: "@param|@returns|@throws")` — docstring coverage
- `search(pattern: "FIXME|TODO|HACK|XXX|WORKAROUND")` — fixme density
- Compare README API examples with actual signatures

#### What to flag
- README claiming features that don't exist
- Public functions without any doc comment
- Comments that contradict the code
- Stale architecture decision records (ADRs) if present

## Phase 2: Deeper Dives (Parallel Sub-Agents)

For large codebases (>50k LOC), delegate heavy dimensions to parallel `task` subagents:

```
task(
  agent: "task",
  context: "Tech debt audit. Run ast_grep and search-based scans for the assigned dimensions. Report every finding with file:line:col. Tag severity: Critical/High/Medium/Low.",
  tasks: [
    {
      id: "DebtArchConsistency",
      role: "Architecture and consistency debt auditor",
      description: "Audit dimensions 1-2",
      assignment: "Audit dimensions 1 (Architectural Decay) and 2 (Consistency Rot) from the tech-debt-audit protocol. Run ast_grep and search scans. Report every finding with file:line:col. Tag severity: Critical/High/Medium/Low."
    },
    {
      id: "DebtTypeError",
      role: "Type safety and error handling auditor",
      description: "Audit dimensions 3 and 7",
      assignment: "Audit dimensions 3 (Type & Contract Debt) and 7 (Error Handling & Observability) from the tech-debt-audit protocol. Run ast_grep and search scans. Report every finding with file:line:col. Tag severity."
    },
    {
      id: "DebtPerfSecurity",
      role: "Performance and security hygiene auditor",
      description: "Audit dimensions 6 and 8",
      assignment: "Audit dimensions 6 (Performance & Resource Hygiene) and 8 (Security Hygiene) from the tech-debt-audit protocol. Run ast_grep and search scans. Report every finding with file:line:col. Tag severity."
    }
  ]
)
```

Spawn 2-3 sub-agents for the heaviest dimensions, collect results in parallel, then synthesize.

## Phase 3: Synthesize & Deliver

1. Collect all findings from direct tool calls and sub-agent results
2. Deduplicate — same issue mentioned by multiple dimensions
3. Classify severity:
   - **Critical** — Causes incorrect behavior, data loss, or security vulnerability
   - **High** — Will cause problems in production; blocks maintenance
   - **Medium** — Reduces maintainability; violates conventions
   - **Low** — Cosmetic; should fix when in the area
4. Estimate effort in hours per finding (conservative)
5. Write `TECH_DEBT_AUDIT.md` with all required sections
6. Report summary to the user

## Severity Rubric

```
Critical = actively causing bugs or security holes
High     = will cause problems under normal operation; blocks changes
Medium   = reduces maintainability; inconsistent; violates team conventions
Low      = cosmetic; would be nice to fix when nearby
```

## Quick Checks Before Finishing

- [ ] Every concrete finding has `file:line:col` citation
- [ ] No generic claims without evidence
- [ ] "Looks Bad But Is Fine" section explains at least 2-3 patterns
- [ ] Top 5 priorities ranked by impact/effort
- [ ] Quick wins are things that can be fixed in <30 minutes each

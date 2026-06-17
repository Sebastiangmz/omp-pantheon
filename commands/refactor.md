---
description: Intelligent refactoring with codemap, LSP, AST-grep, plan agent and TDD verification
---

<command-instruction>
# Intelligent Refactor Command

## Usage
```
/refactor <refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]

Arguments:
  refactoring-target: What to refactor. Can be:
    - File path: src/auth/handler.ts
    - Symbol name: "AuthService class"
    - Pattern: "all functions using deprecated API"
    - Description: "extract validation logic into separate module"

Options:
  --scope: Refactoring scope (default: module)
    - file: Single file only
    - module: Module/directory scope
    - project: Entire codebase

  --strategy: Risk tolerance (default: safe)
    - safe: Conservative, maximum test coverage required
    - aggressive: Allow broader changes with adequate coverage
```

## What This Command Does

Performs intelligent, deterministic refactoring with full codebase awareness. Unlike blind search-and-replace, this command:

1. **Understands your intent** — Analyzes what you actually want to achieve
2. **Maps the codebase** — Builds a definitive codemap before touching anything
3. **Assesses risk** — Evaluates test coverage and determines verification strategy
4. **Plans meticulously** — Creates a detailed plan via the `plan` agent
5. **Executes precisely** — Step-by-step refactoring with `lsp` and `ast_grep`
6. **Verifies constantly** — Runs tests after each change to ensure zero regression

---

# PHASE 0: INTENT GATE (MANDATORY FIRST STEP)

**BEFORE ANY ACTION, classify and validate the request.**

## Step 0.1: Parse Request Type

| Signal | Classification | Action |
|--------|----------------|--------|
| Specific file/symbol | Explicit | Proceed to codebase analysis |
| "Refactor X to Y" | Clear transformation | Proceed to codebase analysis |
| "Improve", "Clean up" | Open-ended | **MUST ask**: "What specific improvement?" |
| Ambiguous scope | Uncertain | **MUST ask**: "Which modules/files?" |
| Missing context | Incomplete | **MUST ask**: "What's the desired outcome?" |

## Step 0.2: Validate Understanding

Before proceeding, confirm:
- [ ] Target is clearly identified
- [ ] Desired outcome is understood
- [ ] Scope is defined (file/module/project)
- [ ] Success criteria can be articulated

**If ANY of above is unclear, ASK CLARIFYING QUESTION** with options A/B/C and your recommendation.

## Step 0.3: Create Initial Todos

Use the todo tool to register six phases:
- PHASE 1: Codebase Analysis — launch parallel `explore` agents
- PHASE 2: Build Codemap — map dependencies and impact zones
- PHASE 3: Test Assessment — analyze test coverage and verification strategy
- PHASE 4: Plan Generation — invoke `plan` agent for detailed refactoring plan
- PHASE 5: Execute Refactoring — step-by-step with continuous verification
- PHASE 6: Final Verification — full test suite and regression check

---

# PHASE 1: CODEBASE ANALYSIS (PARALLEL EXPLORATION)

**Mark phase-1 as in_progress.**

## 1.1: Launch Parallel Explore Agents

Fire ALL of these simultaneously via `task(agent: "explore", tasks: [...])`:

```
task(agent: "explore", tasks: [
  { id: "occurrences", description: "Find target", assignment: "Find all occurrences and definitions of [TARGET]. Report: file paths, line numbers, usage patterns." },
  { id: "depends",     description: "Find related code", assignment: "Find all code that imports, uses, or depends on [TARGET]. Report: dependency chains, import graphs." },
  { id: "patterns",    description: "Find similar patterns", assignment: "Find similar code patterns to [TARGET] in the codebase. Report: analogous implementations, established conventions." },
  { id: "tests",       description: "Find tests", assignment: "Find all test files related to [TARGET]. Report: test file paths, test case names, coverage indicators." },
  { id: "arch",        description: "Architecture context", assignment: "Find architectural patterns and module organization around [TARGET]. Report: module boundaries, layer structure, design patterns in use." }
])
```

## 1.2: Direct Tool Exploration (WHILE AGENTS RUN)

While background agents are running, use `lsp` directly:

- `lsp(action: "definition", file, line, symbol)` — where is it defined?
- `lsp(action: "references", file, line, symbol)` — find ALL usages
- `lsp(action: "symbols", file)` — file structure
- `lsp(action: "symbols", file: "*", query)` — search by name
- `lsp(action: "diagnostics", file)` — current errors/warnings (baseline)

### AST-Grep for Pattern Analysis

- `ast_grep(pat: "function $NAME($$$) { $$$ }", path: "src/")` — find structural patterns
- For replace: use `ast_edit({ ops: [{ pat, out }], path })` after pattern verified

### Grep for Text Patterns

- `grep(pattern: "[search_term]", path: "src/")` — text search

**Mark phase-1 as completed after all agents return.**

---

# PHASE 2: BUILD CODEMAP (DEPENDENCY MAPPING)

**Mark phase-2 as in_progress.**

## 2.1: Construct Definitive Codemap

```
## CODEMAP: [TARGET]

### Core Files (Direct Impact)
- `path/to/file.ts:L10-L50` - Primary definition
- `path/to/file2.ts:L25` - Key usage

### Dependency Graph
[TARGET]
├── imports from:
│   ├── module-a (types)
│   └── module-b (utils)
├── imported by:
│   ├── consumer-1.ts
│   ├── consumer-2.ts
│   └── consumer-3.ts
└── used by:
    ├── handler.ts (direct call)
    └── service.ts (dependency injection)

### Impact Zones
| Zone | Risk Level | Files Affected | Test Coverage |
|------|------------|----------------|---------------|
| Core | HIGH | 3 files | 85% covered |
| Consumers | MEDIUM | 8 files | 70% covered |
| Edge | LOW | 2 files | 50% covered |

### Established Patterns
- Pattern A: [description] - used in N places
- Pattern B: [description] - established convention
```

## 2.2: Identify Refactoring Constraints

- **MUST follow**: [existing patterns identified]
- **MUST NOT break**: [critical dependencies]
- **Safe to change**: [isolated code zones]
- **Requires migration**: [breaking changes impact]

**Mark phase-2 as completed.**

---

# PHASE 3: TEST ASSESSMENT (VERIFICATION STRATEGY)

**Mark phase-3 as in_progress.**

## 3.1: Detect Test Infrastructure

```bash
# Check for test commands
cat package.json | jq '.scripts | keys[] | select(test("test"))'
# Or for Python
ls -la pytest.ini pyproject.toml setup.cfg
# Or for Go
ls -la *_test.go
```

## 3.2: Analyze Test Coverage

Spawn one synchronous explore task asking specifically:
1. Which test files cover this code?
2. What test cases exist?
3. Are there integration tests?
4. What edge cases are tested?
5. Estimated coverage percentage?

## 3.3: Determine Verification Strategy

| Coverage Level | Strategy |
|----------------|----------|
| HIGH (>80%) | Run existing tests after each step |
| MEDIUM (50-80%) | Run tests + add safety assertions |
| LOW (<50%) | **PAUSE**: Propose adding tests first |
| NONE | **BLOCK**: Refuse aggressive refactoring |

**If coverage is LOW or NONE, ask user** for explicit choice between (1) tests-first, (2) extra-cautious manual verification, (3) abort.

## 3.4: Document Verification Plan

Capture: test commands, type-check command, regression indicators, behaviour invariants.

**Mark phase-3 as completed.**

---

# PHASE 4: PLAN GENERATION (PLAN AGENT)

**Mark phase-4 as in_progress.**

## 4.1: Invoke `plan` agent

```
task(agent: "plan", tasks: [{
  id: "refactor-plan",
  description: "Detailed refactoring plan",
  assignment: "Create a detailed refactoring plan.\n\n## Refactoring Goal\n[User's original request]\n\n## Codemap (from Phase 2)\n[Insert codemap here]\n\n## Test Coverage (from Phase 3)\n[Insert verification plan here]\n\n## Constraints\n- MUST follow existing patterns: [list]\n- MUST NOT break: [critical paths]\n- MUST run tests after each step\n\n## Requirements\n1. Break down into atomic refactoring steps\n2. Each step must be independently verifiable\n3. Order steps by dependency (what must happen first)\n4. Specify exact files and line ranges for each step\n5. Include rollback strategy for each step\n6. Define commit checkpoints"
}])
```

## 4.2: Review and Validate Plan

After receiving plan from `plan` agent:
1. **Verify completeness**: All identified files addressed?
2. **Verify safety**: Each step reversible?
3. **Verify order**: Dependencies respected?
4. **Verify verification**: Test commands specified?

## 4.3: Register Detailed Todos

Convert plan output into granular todos: each refactor step + its verification step.

**Mark phase-4 as completed.**

---

# PHASE 5: EXECUTE REFACTORING (DETERMINISTIC EXECUTION)

**Mark phase-5 as in_progress.**

## 5.1: Execution Protocol

For EACH refactoring step:

### Pre-Step
1. Mark step todo as `in_progress`
2. Read current file state
3. Verify `lsp(action: "diagnostics")` baseline

### Execute Step

**For Symbol Renames**: `lsp(action: "rename", file, line, symbol, new_name)` — atomic across the workspace.

**For Pattern Transformations**: `ast_edit({ ops: [{ pat, out }], path })` after verifying pattern with `ast_grep`.

**For Structural Changes**: `edit({ path, edits })` for precise line-anchored edits.

### Post-Step Verification (MANDATORY)

1. `lsp(action: "diagnostics", file)` → must be clean or same as baseline
2. Run test command via `bash`
3. Run type-check via `bash`

### Step Completion

- Verification passes → Mark step todo as `completed`
- Verification fails → **STOP AND FIX**

## 5.2: Failure Recovery Protocol

If ANY verification fails:

1. **STOP** immediately
2. **REVERT** the failed change
3. **DIAGNOSE** what went wrong
4. **OPTIONS**:
   - Fix the issue and retry
   - Skip this step (if optional)
   - Consult `oracle` agent for help
   - Ask user for guidance

**NEVER proceed to next step with broken tests.**

## 5.3: Commit Checkpoints

After each logical group of changes:

```bash
git add [changed-files]
git commit -m "refactor(scope): description

[details of what was changed and why]"
```

**Mark phase-5 as completed when all refactoring steps done.**

---

# PHASE 6: FINAL VERIFICATION (REGRESSION CHECK)

**Mark phase-6 as in_progress.**

1. Full test suite (`bun test` / `npm test` / `pytest` / etc.)
2. Type check (`tsc --noEmit` / equivalent)
3. Lint (`eslint .` / equivalent)
4. Build verification if applicable
5. Final `lsp diagnostics` on all changed files

## 6.6: Generate Summary

```markdown
## Refactoring Complete

### What Changed
- [List of changes made]

### Files Modified
- `path/to/file.ts` - [what changed]
- `path/to/file2.ts` - [what changed]

### Verification Results
- Tests: PASSED (X/Y passing)
- Type Check: CLEAN
- Lint: CLEAN
- Build: SUCCESS

### No Regressions Detected
All existing tests pass. No new errors introduced.
```

**Mark phase-6 as completed.**

---

# CRITICAL RULES

## NEVER DO
- Skip `lsp diagnostics` check after changes
- Proceed with failing tests
- Make changes without understanding impact
- Use `as any`, `@ts-ignore`, `@ts-expect-error`
- Delete tests to make them pass
- Commit broken code
- Refactor without understanding existing patterns

## ALWAYS DO
- Understand before changing
- Preview before applying (`ast_grep` then `ast_edit`)
- Verify after every change
- Follow existing codebase patterns
- Keep todos updated in real-time
- Commit at logical checkpoints
- Report issues immediately

## ABORT CONDITIONS
If any of these occur, **STOP and consult user**:
- Test coverage is zero for target code
- Changes would break public API
- Refactoring scope is unclear
- 3 consecutive verification failures
- User-defined constraints violated

---

# Tool Usage Philosophy

## LSP
- **Understand before changing**: `lsp(action: "definition")` to grasp context
- **Impact analysis**: `lsp(action: "references")` to map all usages
- **Safe refactoring**: `lsp(action: "rename")` for symbol renames
- **Continuous verification**: `lsp(action: "diagnostics")` after every change

## AST-Grep
Use `ast_grep` for discovery and `ast_edit` for codemods. Always verify the pattern matches what you expect before applying.

## Agents
- `explore`: Parallel codebase pattern discovery
- `plan`: Detailed refactoring plan generation
- `oracle`: Read-only consultation for complex architectural decisions and debugging
- `librarian`: **Use proactively** when encountering deprecated methods or library migration tasks

## Deprecated Code & Library Migration
When you encounter deprecated methods/APIs during refactoring:
1. Fire `librarian` to find the recommended modern alternative
2. **DO NOT auto-upgrade to latest version** unless user explicitly requests migration
3. If user requests library migration, use `librarian` to fetch latest API docs before making changes

---

**Remember: Refactoring without tests is reckless. Refactoring without understanding is destructive. This command ensures you do neither.**
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>

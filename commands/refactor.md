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

**If ANY of above is unclear, ASK CLARIFYING QUESTION:**

```
I want to make sure I understand the refactoring goal correctly.

**What I understood**: [interpretation]
**What I'm unsure about**: [specific ambiguity]

Options I see:
1. [Option A] - [implications]
2. [Option B] - [implications]

**My recommendation**: [suggestion with reasoning]

Should I proceed with [recommendation], or would you prefer differently?
```

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

Fire ALL of these simultaneously via a single `task` call:

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

### LSP Tools for Precise Analysis:

```
lsp(action: "definition", file, line, symbol)   // Where is it defined?
lsp(action: "references", file, line, symbol)    // Find ALL usages across workspace
lsp(action: "symbols", file)                     // Hierarchical file outline
lsp(action: "symbols", file: "*", query: "...")  // Search by name
lsp(action: "diagnostics", file)                 // Errors, warnings before we start
```

### AST-Grep for Pattern Analysis:

```
ast_grep(pat: "function $NAME($$$) { $$$ }", paths: ["src/"])

// Preview refactoring first
ast_grep(pat: "[old_pattern]", paths: ["src/"])
// Then apply via:
ast_edit(ops: [{ pat: "[old_pattern]", out: "[new_pattern]" }], paths: ["src/"])
```

### Search for Text Patterns:

```
search(pattern: "[search_term]", paths: ["src/"])
```

**Mark phase-1 as completed after all agents return.**

---

# PHASE 2: BUILD CODEMAP (DEPENDENCY MAPPING)

**Mark phase-2 as in_progress.**

## 2.1: Construct Definitive Codemap

Based on Phase 1 results, build:

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

Based on codemap:
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
# JS/TS: read the manifest and inspect `scripts` (use the read tool, not cat)
#   read("package.json")  → look at .scripts for a "test" entry
# Python: find . -maxdepth 2 \( -name pytest.ini -o -name pyproject.toml -o -name setup.cfg \)
# Go:     find . -name '*_test.go'
jq '.scripts | keys[] | select(test("test"))' package.json   # if package.json exists
```

## 3.2: Analyze Test Coverage

```
task(agent: "explore", tasks: [{
  id: "test-coverage",
  description: "Analyze test coverage for target",
  assignment: "Analyze test coverage for [TARGET]: 1. Which test files cover this code? 2. What test cases exist? 3. Are there integration tests? 4. What edge cases are tested? 5. Estimated coverage percentage?"
}])
```

## 3.3: Determine Verification Strategy

Based on test analysis:

| Coverage Level | Strategy |
|----------------|----------|
| HIGH (>80%) | Run existing tests after each step |
| MEDIUM (50-80%) | Run tests + add safety assertions |
| LOW (<50%) | **PAUSE**: Propose adding tests first |
| NONE | **BLOCK**: Refuse aggressive refactoring |

**If coverage is LOW or NONE, ask user:**

```
Test coverage for [TARGET] is [LEVEL].

**Risk Assessment**: Refactoring without adequate tests is dangerous.

Options:
1. Add tests first, then refactor (RECOMMENDED)
2. Proceed with extra caution, manual verification required
3. Abort refactoring

Which approach do you prefer?
```

## 3.4: Document Verification Plan

```
## VERIFICATION PLAN

### Test Commands
- Unit: `bun test` / `npm test` / `pytest` / etc.
- Integration: [command if exists]
- Type check: `tsc --noEmit` / `pyright` / etc.

### Verification Checkpoints
After each refactoring step:
1. lsp(action: "diagnostics") → zero new errors
2. Run test command → all pass
3. Type check → clean

### Regression Indicators
- [Specific test that must pass]
- [Behavior that must be preserved]
- [API contract that must not change]
```

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
Use appropriate tool:

**For Symbol Renames:**
```
lsp(action: "rename", file, line, symbol, new_name)
```

**For Pattern Transformations:**
```
// Preview first
ast_grep(pat: "[pattern]", paths: ["path/to/file.ts"])

// If preview looks good, execute
ast_edit(ops: [{ pat: "[pattern]", out: "[rewrite]" }], paths: ["path/to/file.ts"])
```

**For Structural Changes:**
```
edit(path, edits)
```

### Post-Step Verification (MANDATORY)

```
// 1. Check diagnostics
lsp(action: "diagnostics", file)  // Must be clean or same as baseline

// 2. Run tests
bash("bun test")  // Or appropriate test command

// 3. Type check
bash("tsc --noEmit")  // Or appropriate type check
```

### Step Completion
1. If verification passes → Mark step todo as `completed`
2. If verification fails → **STOP AND FIX**

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

# PHASE 5 (Parallel Variant): Parallel Task Execution

When the plan identifies 3+ file-independent refactoring steps, use parallel `task` agents instead of sequential execution:

## 5.1-P: Parallel Dispatch

Classify each plan step:
- **Mechanical** (LSP rename, extract variable, inline, simple move, signature change) → assign to `quick_task`
- **Reasoning-required** (extract function, restructure conditional, pattern transformation, cross-file API change) → assign to `task`

```
task(agent: "task", tasks: [
  { id: "refactor-step-1", description: "Step 1: [short]", assignment: "<per-step instructions from plan, including target files and line ranges, rollback strategy>" },
  { id: "refactor-step-2", description: "Step 2: [short]", assignment: "..." },
  { id: "refactor-step-3", description: "Step 3: [short]", assignment: "..." }
])
```

## 5.2-P: Verification After Each Completion

On each agent completion, dispatch an `oracle` for verification:

```
task(agent: "oracle", tasks: [{
  id: "verify-step-N",
  description: "Verify refactoring step N",
  assignment: "<files touched + test/typecheck/lint commands + instruction to return PASS or FAIL with specific error + suggested revert hunks>"
}])
```

- On PASS: proceed, commit the checkpoint for that step.
- On FAIL after 3 cycles on the same step: STOP and consult the user with full evidence.

Proceed to Phase 6 only when every step is completed AND every paired verifier returned PASS.

---

# PHASE 6: FINAL VERIFICATION (REGRESSION CHECK)

**Mark phase-6 as in_progress.**

## 6.1: Full Test Suite

```bash
# Run complete test suite
bun test  # or npm test, pytest, go test, etc.
```

## 6.2: Type Check

```bash
# Full type check
tsc --noEmit  # or equivalent
```

## 6.3: Lint Check

```bash
# Run linter
eslint .  # or equivalent
```

## 6.4: Build Verification (if applicable)

```bash
# Ensure build still works
bun run build  # or npm run build, etc.
```

## 6.5: Final Diagnostics

```
// Check all changed files
for each changedFile:
  lsp(action: "diagnostics", file: changedFile)  // Must all be clean
```

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

If the parallel variant (Phase 5-P) was used, append dispatch metrics (tasks created, verifier runs, total time).

**Mark phase-6 as completed.**

---

# CRITICAL RULES

## NEVER DO
- Skip `lsp(action: "diagnostics")` check after changes
- Proceed with failing tests
- Make changes without understanding impact
- Use `as any`, `@ts-ignore`, `@ts-expect-error`
- Delete tests to make them pass
- Commit broken code
- Refactor without understanding existing patterns

## ALWAYS DO
- Understand before changing
- Preview structural rewrites before applying them (`ast_grep` then `ast_edit`)
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

You already know these tools. Use them intelligently:

## LSP
Leverage LSP tools for precision analysis. Key patterns:
- **Understand before changing**: `lsp(action: "definition")` to grasp context
- **Impact analysis**: `lsp(action: "references")` to map all usages before modification
- **Safe refactoring**: `lsp(action: "rename")` for symbol renames
- **Continuous verification**: `lsp(action: "diagnostics")` after every change

## AST-Grep
Use `ast_grep` for discovery and `ast_edit` for codemods.
**Critical**: Always preview first, review, then execute.

## Agents
- `explore`: Parallel codebase pattern discovery
- `plan`: Detailed refactoring plan generation
- `oracle`: Read-only consultation for complex architectural decisions and debugging
- `librarian`: **Use proactively** when encountering deprecated methods or library migration tasks. Query official docs and OSS examples for modern replacements.

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

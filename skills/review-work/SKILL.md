---
name: review-work
description: Post-implementation review orchestrator. Launches parallel review sub-agents covering goal/constraint verification, code quality, security, hands-on QA, and context mining. ALL must pass for review to pass. MUST USE after completing significant implementation work.
---

# review-work

Five-agent parallel review orchestrator. Triggers: "review work", "review my work", "review changes", "QA my work", "verify implementation", "check my work", "validate changes", "post-implementation review".

## When to use

After ANY significant implementation work — feature, bug fix, refactor — before declaring it done.

## Workflow

Fire these five agents in parallel via `task` (independent, all read-only):

```
task(agent: "oracle", tasks: [
  { id: "rv-goal", description: "Goal & constraint verification", assignment: "<assignment 1 below>" },
  { id: "rv-quality", description: "Code quality review", assignment: "<assignment 2 below>" },
  { id: "rv-security", description: "Security review", assignment: "<assignment 3 below>" }
])

task(agent: "task", tasks: [
  { id: "rv-qa", description: "Hands-on QA execution", assignment: "<assignment 4 below>" },
  { id: "rv-context", description: "Context mining (git/PRs/issues)", assignment: "<assignment 5 below>" }
])
```

## Assignments (templates)

### 1. Goal & constraint verification (`oracle`)
Map the user's original request and explicit constraints to actual code changes. For each sub-requirement:
- [ACHIEVED / MISSED / PARTIAL] Requirement description
- Evidence: specific code reference or gap
For each explicit constraint (e.g. "no new dependencies", "preserve API"):
- [PASS / FAIL] Constraint
- Evidence

### 2. Code quality review (`oracle`)
Review the diff for:
- Naming clarity
- Function size & cohesion
- Error handling completeness
- Edge cases (null, empty, large, concurrent)
- Test coverage of new behavior
- Adherence to existing codebase patterns
- AI slop (see `ai-slop-remover` skill for patterns)
Flag findings as `critical` / `high` / `medium` / `low`.

### 3. Security review (`oracle`)
Review the diff for:
- Input validation at trust boundaries
- Authn / authz changes
- Secret handling
- Injection (SQL, command, prompt, path)
- SSRF / open-redirect / CSRF
- Information disclosure in errors / logs
- Dependency security (new deps only)
Flag findings as `critical` / `high` / `medium` / `low`.

### 4. Hands-on QA execution (`task`)
Run the actual feature end-to-end. For CLI: invoke it. For API: hit the endpoints. For UI: drive the browser. Show concrete output. Record:
- Happy path: works / doesn't
- Error path: works / doesn't
- Edge cases tested
- Diagnostics / build / tests: all green

### 5. Context mining (`task`)
Look at recent project context that might inform the review:
- Recent git commits — what conventions were established?
- Open / recently-closed issues — known gotchas in this area?
- Open PRs — any conflicting work in flight?
- Documentation / READMEs — anything the change should update?

## Pass criteria

ALL FIVE must pass:
- Goal: every requirement ACHIEVED, every constraint PASS
- Quality: no `critical` or `high` findings
- Security: no `critical` or `high` findings
- QA: happy path + error path + all relevant edge cases verified
- Context: change is consistent with recent project trajectory

If ANY fails → fix → re-run THE SAME review session for the failing agent, not a fresh one.

> iter-1 stub. Iter-2 will expand each assignment template with concrete checklists.

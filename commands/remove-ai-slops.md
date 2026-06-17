---
description: Remove AI-generated code smells from branch changes and critically review the results
---

<command-instruction>
# Remove AI Slops Command

## What this command does

Analyzes all files changed in the current branch (compared to parent commit), removes AI-generated code smells in parallel, then critically reviews the changes to ensure safety and behavior preservation. Fixes any issues found during review.

## Step 0: Task Planning

Use the todo tool to create the task list:
1. Get changed files from branch
2. Run ai-slop-remover on each file in parallel
3. Critically review all changes
4. Fix any issues found

## Role Definition

You are a senior code quality engineer specialized in identifying and removing AI-generated code patterns while preserving original functionality. You have deep expertise in code review, refactoring safety, and behavioral preservation.

## Process

### Phase 1: Identify Changed Files

Detect the repository base branch dynamically, then get all changed files in the current branch:
```bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff $(git merge-base "$BASE_BRANCH" HEAD)..HEAD --name-only
```

If `git symbolic-ref refs/remotes/origin/HEAD` is unavailable, detect the base branch at runtime using the repo's configured remote default branch. Only fall back to `main` as a last resort.

### Phase 2: Parallel AI Slop Removal

For each changed file, spawn a `task` agent in parallel via the `task` tool with `load_skills: ["ai-slop-remover"]` (or describe the slop-removal goal in the assignment if skills are not loaded automatically):

```
task(agent: "task", tasks: [
  { id: "slop-1", description: "Remove AI slops from <file1>", assignment: "Use the ai-slop-remover skill to remove AI-generated code smells from <file_path>. Preserve all functional logic, error handling, type hints, and imports. Do NOT use git checkout to rollback — save a per-file patch first so you can reverse-apply it cleanly if review fails." },
  { id: "slop-2", description: "Remove AI slops from <file2>", assignment: "..." }
])
```

**CRITICAL**: Launch ALL agents in a SINGLE `task` call (or one parallel batch) for maximum parallelism.

Before running the slop removal on each file, save a file-specific rollback artifact that captures only the delta introduced by the slop-removal pass. Use a safe pattern such as generating a per-file patch and reverse-applying it if review fails.

Do NOT use `git checkout -- {file_path}` or any rollback that discards pre-existing branch changes in the file.

### Phase 3: Critical Review

After all agents complete, perform a critical review with the following checklist:

**Safety Verification**:
- [ ] No functional logic was accidentally removed
- [ ] All error handling is preserved
- [ ] Type hints remain correct and complete
- [ ] Import statements are still valid
- [ ] No breaking changes to public APIs

**Behavior Preservation**:
- [ ] Return values unchanged
- [ ] Side effects unchanged
- [ ] Exception behavior unchanged
- [ ] Edge case handling preserved

**Code Quality**:
- [ ] Removed changes are genuinely AI slop (not intentional patterns)
- [ ] Remaining code follows project conventions
- [ ] No orphaned code or dead references

### Phase 4: Fix Issues

If any issues are found during critical review:
1. Identify the specific problem
2. Explain why it's a problem
3. Revert only the slop-removal delta using the saved per-file patch or an equivalent reverse-apply workflow
4. If remaining slops are found after reverting, remove them by editing the file yourself — with parallel tool calls, per-file
5. Verify the fix doesn't introduce new issues

## Output Format

### Summary Report
```
## AI Slop Removal Summary

### Files Processed
- file1.py: X changes
- file2.py: Y changes

### Critical Review Results
- Safety: PASS/FAIL
- Behavior: PASS/FAIL
- Quality: PASS/FAIL

### Issues Found & Fixed
1. [Issue description] -> [Fix applied]

### Final Status
[CLEAN / ISSUES FIXED / REQUIRES ATTENTION]
```

## Quality Assurance
- NEVER remove code that serves a functional purpose
- ALWAYS verify changes compile/parse correctly
- ALWAYS preserve test coverage
- If uncertain about a change, err on the side of keeping the original code
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>

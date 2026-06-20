---
description: Enable, inspect, explain, or disable explicit EvalFly enforcement for this project.
---

<command-instruction>
You are activating or inspecting explicit local EvalFly enforcement.

## ARGUMENTS

`$ARGUMENTS` must be one of:

- `status`
- `start --suite smoke --commit-range <range>`
- `stop`
- `explain`

## WHAT TO DO

1. Resolve the EvalFly CLI path:
   - Prefer the repo-local `skills/evalfly/bin/evalfly.ts` when it exists in the current project.
   - Otherwise use the installed `~/.omp/agent/skills/evalfly/bin/evalfly.ts`.
2. Run exactly:
   ```bash
   bun run <evalfly.ts path> enforce $ARGUMENTS
   ```
3. Report the observed stdout/stderr and exit code.
4. For `start` and `stop`, read `.pi/evalfly/enforcement.json` after the command and report the observed mode. Do not claim enforcement is active unless that file shows `"mode": "enforced"`.

## BOUNDARY

EvalFly enforcement is explicit opt-in. Advisory remains the default until `start` writes local state.
This command does not install CI, mutate branch protection, or change global OMP settings.
</command-instruction>

# /evalfly-enforce

Use this command when a change is load-bearing and EvalFly evidence should become mandatory before completion.

Examples:

```txt
/evalfly-enforce status
/evalfly-enforce start --suite smoke --commit-range main..HEAD
/evalfly-enforce stop
/evalfly-enforce explain
```

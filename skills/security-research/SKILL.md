---
name: security-research
description: "Parallel security research skill. Orchestrates 3 vulnerability hunters and 2 PoC engineers via parallel task() subagent batches to audit a codebase, prove exploitability, classify root causes, and calibrate severity by actual exploitability. Use for security review, vulnerability research, exploitability audit, pre-release security check, threat model validation. Triggers: 'security-research', 'security research', 'security review', 'vulnerability audit', 'exploitability audit'."
---

# Security Research — Parallel Vulnerability Audit

Use this skill to run a parallel security audit that separates real exploitability from generic concern. The team has 3 vulnerability hunters and 2 PoC engineers, all fired as parallel `task` subagents.

## Hard Preconditions

Before starting, verify:

1. You are in the main session, not a background subagent.
2. You have a concrete target: repository, diff range, PR, release candidate, path list, or threat surface.

If the user provided no target, audit the current repository and current branch diff against its upstream or merge base. If there is no diff, audit the security-sensitive surfaces in the working tree.

## Severity Standard

Use these references as the scoring frame:

- CWE for root-cause weakness classification: https://cwe.mitre.org/
- OWASP WSTG for test methodology: https://devguide.owasp.org/en/06-verification/01-guides/01-wstg/
- OWASP ASVS for control verification: https://owasp.org/www-project-application-security-verification-standard/
- CVSS v4.0 for exploitability and impact scoring: https://www.first.org/cvss/v4.0/specification-document

Rules:

- No severity without an attack path.
- No critical or high finding without concrete exploit preconditions and impact.
- Keep CWE category separate from severity.
- Prefer a small, reproducible PoC over theoretical language.
- Never run destructive exploits against real services or third-party systems.
- Use local fixtures, toy payloads, dry runs, or static proof when real execution would be unsafe.

## Team Roster

The 5 team members are spawned as parallel `task` subagents via a single `task()` call:

| Member | Role | Responsibility |
|--------|------|----------------|
| `surface-hunter` | Attack Surface Mapper | Map entry points, trust boundaries, and reachable attack surfaces. |
| `auth-data-hunter` | Auth & Data Isolation Hunter | Hunt auth, authorization, data isolation, injection, and secret handling flaws. |
| `runtime-supply-hunter` | Runtime & Supply Chain Hunter | Hunt filesystem, subprocess, archive, dependency, hook, config risks. |
| `poc-engineer-a` | PoC Engineer (Primary) | Build minimal PoCs for the strongest candidate findings. |
| `poc-engineer-b` | PoC Engineer (Verifier) | Independently reproduce, falsify, or downgrade candidate findings. |

## Workflow

### Phase 0: Scope and Baseline

Collect:

- Target scope and reason for audit.
- Branch, base ref, diff, and changed files if this is a change review.
- Security-sensitive directories and files if this is a full-repo audit.
- Existing tests and commands that exercise relevant surfaces.
- Any user-stated constraints, such as no network calls or no destructive tests.

Use `search`, `bash("git diff ...")`, `bash("git log ...")`, `lsp`, and existing tests before assigning work.

### Phase 1: Independent Hunter Pass

Fire 3 hunters in a single parallel `task()` call:

```
task(
  agent: "task",
  context: "Security research audit. Target: [target summary]. Context: [diff, file list, security-sensitive paths, known constraints].",
  tasks: [
    {
      id: "SurfaceHunter",
      role: "Attack surface mapper — entry points, trust boundaries, attacker-controlled inputs",
      description: "Map attack surface",
      assignment: "You map attack surface. Enumerate entry points, trust boundaries, attacker-controlled inputs, data sinks, privilege transitions, and sensitive assets. Use `search`, `find`, `read`, and `ast_grep` to locate these. Return evidence with file paths and exact functions. Do not assign severity unless you can name an attack path.\n\nFor each candidate include:\n- title\n- affected file/function\n- attacker capability\n- attack path\n- impact\n- CWE candidate\n- exact evidence\n- safe verification idea\n\nReject generic hardening advice. Return only candidates with a plausible path."
    },
    {
      id: "AuthDataHunter",
      role: "Auth, authorization, and data isolation vulnerability hunter",
      description: "Hunt auth/data flaws",
      assignment: "You hunt auth, authorization, tenant/data isolation, injection, SSRF, credential exposure, and confused-deputy flaws. Reason from attacker capability to impact. Use `search`, `find`, `read`, and `ast_grep` to locate vulnerabilities. Return only findings with concrete exploit preconditions, CWE candidates, and verification steps.\n\nFor each candidate include:\n- title\n- affected file/function\n- attacker capability\n- attack path\n- impact\n- CWE candidate\n- exact evidence\n- safe verification idea\n\nReject generic hardening advice. Return only candidates with a plausible path."
    },
    {
      id: "RuntimeSupplyHunter",
      role: "Runtime, filesystem, subprocess, and supply-chain vulnerability hunter",
      description: "Hunt runtime/supply-chain risks",
      assignment: "You hunt filesystem, subprocess, archive extraction, dependency, hook execution, config, and environment-variable risks. Check path traversal, command injection, unsafe downloads, permission boundaries, and supply-chain assumptions. Use `search`, `find`, `read`, `ast_grep`, and `bash` to locate vulnerabilities. Cite file paths and commands used.\n\nFor each candidate include:\n- title\n- affected file/function\n- attacker capability\n- attack path\n- impact\n- CWE candidate\n- exact evidence\n- safe verification idea\n\nReject generic hardening advice. Return only candidates with a plausible path."
    }
  ]
)
```

Collect all 3 hunter results.

### Phase 2: PoC Pass

Deduplicate hunter candidates. Send the strongest candidates to both PoC engineers via a parallel `task()` call:

```
task(
  agent: "task",
  context: "Security research — PoC pass. Candidate vulnerabilities from hunters are listed in the assignment. Build or falsify PoCs.",
  tasks: [
    {
      id: "PocEngineerA",
      role: "PoC engineer — prove exploitability with minimal safe exploits",
      description: "Build PoCs for candidate findings",
      assignment: "Build minimal safe PoCs for these candidate findings. Use toy inputs and local-only execution. Your job is to prove or disprove exploitability, not to broaden scope. Report exact reproduction steps and expected output.\n\n[insert deduplicated candidate list]\n\nFor each candidate return:\n- Reproduced, falsified, or unsafe-to-run.\n- Exact commands, fixtures, or static proof.\n- Observed output or reason it fails.\n- Severity recommendation using exploitability and impact.\n- Downgrade rationale for anything not reproduced."
    },
    {
      id: "PocEngineerB",
      role: "PoC verifier — independently reproduce or falsify candidate findings",
      description: "Verify/falsify candidate findings",
      assignment: "Independently reproduce candidate findings and try to falsify them. Downgrade anything without a working path. If a PoC is unsafe to run, design a safe static or dry-run proof and explain the limit.\n\n[insert deduplicated candidate list]\n\nFor each candidate return:\n- Reproduced, falsified, or unsafe-to-run.\n- Exact commands, fixtures, or static proof.\n- Observed output or reason it fails.\n- Severity recommendation using exploitability and impact.\n- Downgrade rationale for anything not reproduced."
    }
  ]
)
```

Collect both PoC results.

### Phase 3: Cross-Check

Send the PoC results back to all 5 members via a parallel `task()` call. Each member receives the full PoC results and answers:

- Which findings survive?
- Which findings should be downgraded or removed?
- What remediation is smallest and specific?
- What regression test would prevent recurrence?

```
task(
  agent: "task",
  context: "Security research — cross-check phase. PoC results are in the assignment. Evaluate surviving findings.",
  tasks: [
    {
      id: "CrossCheckSurface",
      role: "Attack surface mapper — cross-check evaluator",
      description: "Cross-check PoC results",
      assignment: "[PoC results from both engineers]\n\nEvaluate: Which findings survive? Which should be downgraded or removed? What remediation is smallest and specific? What regression test would prevent recurrence?"
    },
    {
      id: "CrossCheckAuth",
      role: "Auth/data hunter — cross-check evaluator",
      description: "Cross-check PoC results",
      assignment: "[same PoC results]\n\n[same questions]"
    },
    {
      id: "CrossCheckRuntime",
      role: "Runtime/supply-chain hunter — cross-check evaluator",
      description: "Cross-check PoC results",
      assignment: "[same PoC results]\n\n[same questions]"
    },
    {
      id: "CrossCheckPocA",
      role: "PoC engineer — cross-check evaluator",
      description: "Cross-check PoC results",
      assignment: "[same PoC results]\n\n[same questions]"
    },
    {
      id: "CrossCheckPocB",
      role: "PoC verifier — cross-check evaluator",
      description: "Cross-check PoC results",
      assignment: "[same PoC results]\n\n[same questions]"
    }
  ]
)
```

### Phase 4: Final Report

Produce this report:

```markdown
## Security Research Result

### Verdict
PASS | PASS WITH FINDINGS | BLOCK

### Scope
- Target:
- Base/diff:
- Commands run:

### Findings
| Severity | Title | CWE | Exploitability | Impact | PoC | Fix |
|----------|-------|-----|----------------|--------|-----|-----|

### Finding Details
For each finding:
- Evidence:
- Attack path:
- PoC:
- Severity rationale:
- Minimal fix:
- Regression check:

### Downgraded or Rejected Candidates
| Candidate | Reason |
|-----------|--------|

### Residual Risk
- What was not tested and why.
```

## Output Rules

- Lead with the verdict.
- Do not bury blocking issues.
- Do not report speculative findings as vulnerabilities.
- Do not claim CVSS precision unless you actually scored the metrics.
- Include exact file paths and commands for every surviving finding.
- If no findings survive PoC, say that plainly and list residual risk.

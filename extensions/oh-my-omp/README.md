# oh-my-omp

Iteration-1 port of [oh-my-openagent (OMO)](https://github.com/code-yeongyu/oh-my-openagent) onto the [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi) coding harness.

## What's in this iter

### Extension (`./index.ts`)
- Advertises `~/.omp/agent/skills/` via `resources_discover`.
- Owns the **Ralph / ULW loop runtime** (state-machine driven by `agent_end`).
- Registers four extension commands: `/ralph-loop`, `/ulw-loop`, `/cancel-ralph`, `/stop-continuation`.

### Markdown slash commands (`~/.omp/agent/commands/`)
- `/ulw`, `/ultrawork` — ULTRAWORK-mode prompt expansion
- `/init-deep` — hierarchical AGENTS.md generator
- `/refactor` — codemap-driven, plan-agent-backed refactor workflow
- `/handoff` — context-summary builder for new sessions
- `/start-work` — Sisyphus session entry, hands off to `atlas`
- `/remove-ai-slops` — parallel branch-wide slop removal
- `/omomomo` — easter egg

### Agents (`~/.omp/agent/agents/`)
- `sisyphus` — primary orchestrator
- `hephaestus` — autonomous deep worker
- `oracle` — read-only consultation specialist
- `atlas` — master orchestrator for plan execution

### Skills (`~/.omp/agent/skills/`)
- `ai-slop-remover`, `dev-browser`, `frontend-ui-ux`, `git-master`, `playwright`, `playwright-cli`, `review-work`

## Roadmap (later iterations)

- **iter-2**: full skill bodies (full sections from OMO, not stubs); `todo-enforcer` hook
- **iter-3**: `comment-checker` + `intent-gate` hooks; `metis`, `momus`, `multimodal-looker`, `sisyphus-junior`, `prometheus`, `librarian` agents
- **iter-4**: `bin/sync.ts` to canonicalise prompt sources; dynamic prompt assembly via `before_agent_start`

## Source attribution

Original prompt content and concept: [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (SUL-1.0).

This is a personal-config-tree port, not a redistribution. If this is ever published as an installable package, licensing will be re-evaluated then.

The OMO templates were adapted to OMP's tool grammar:

| OMO | OMP |
|---|---|
| `task(subagent_type=…, prompt=…)` | `task(agent: "…", tasks: [{ id, description, assignment }])` |
| `category="…", load_skills=[…]` | `agent: "task"` (with appropriate skill loads in the assignment) |
| `call_omo_agent` | `task` |
| `lsp_diagnostics` | `lsp(action: "diagnostics")` |
| `LspGotoDefinition` | `lsp(action: "definition")` |
| `LspFindReferences` | `lsp(action: "references")` |
| `lsp_rename` | `lsp(action: "rename")` |
| `ast_grep_search` / `ast_grep_replace` | `ast_grep` / `ast_edit` |
| `background_output` / `background_cancel` | OMP runs `task` synchronously by default; backgrounding semantics differ. Iter-2 will revisit. |

## How it loads

OMP discovers extensions in `~/.omp/agent/extensions/<name>/` automatically. The `package.json` `omp.extensions` field points the loader at `index.ts`. No manual registration needed.

Slash command markdown is discovered from `~/.omp/agent/commands/`.
Agent markdown is discovered from `~/.omp/agent/agents/`.
Skill `SKILL.md` files are discovered from `~/.omp/agent/skills/<name>/`.

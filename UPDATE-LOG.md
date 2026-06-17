# Update log — track upstream oh-my-openagent (OMO)

This branch refreshes the ported pieces against the current upstream
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (`dev`) and
adds the roadmap iter-2/3/4 pieces, all re-adapted to OMP's tool grammar.

## Scope

**Refresh (bring existing pieces to upstream's current content):**
- Agents: `sisyphus`, `hephaestus`, `oracle`, `atlas`
- Slash commands: `ultrawork`/`ulw`, `init-deep`, `refactor`, `handoff`, `start-work`, `remove-ai-slops`, `omomomo`
- Skills: `git-master`, `frontend-ui-ux`, `dev-browser`, `playwright`, `playwright-cli`, `ai-slop-remover`, `review-work`
- Loop: Ralph/ULW runtime review

**Expand (targeted, per the port's own roadmap):**
- Agents: `prometheus` (interview planner), `metis` (plan critic)
- Hooks: `todo-enforcer`, `comment-checker`, `intent-gate`
- Skills: `hyperplan`, `security-research`, `tech-debt-audit`, `remove-deadcode`

## Upstream source map (`packages/omo-opencode/src/`)

| Piece | Upstream source |
|---|---|
| sisyphus | `agents/sisyphus/default.ts` (+ model overlays) |
| hephaestus | `agents/hephaestus/` |
| oracle | `agents/oracle.ts` |
| atlas | `agents/atlas/` |
| prometheus | `agents/prometheus/` |
| metis | `agents/metis.ts` |
| commands | `features/builtin-commands/templates/*.ts` |
| skills | `features/builtin-skills/*` and `.agents/skills/*` |
| todo-enforcer | `hooks/todo-continuation-enforcer/` |
| comment-checker | `hooks/comment-checker/` |
| intent-gate | realized in agent prompts upstream; ported here as a `before_agent_start` hook |

Each commit below covers one domain.

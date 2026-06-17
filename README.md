# omp-pantheon

**OMP, supercharged.** A drop-in config bundle for [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi)
that adds a *pantheon* of elite agents, skills, hooks, slash-commands, and a
self-driving work loop — the best ideas ported from other top-tier agent
harnesses and re-adapted to OMP's native tool grammar.

OMP ships a fantastic engine (40+ providers, 32 built-in tools, LSP/DAP, native
`explore`/`plan`/`task` agents). `omp-pantheon` layers a curated discipline-agent
system on top of it, so a fresh OMP install behaves like a coordinated dev team
that doesn't stop until the work is done.

> This is a **personal-config-tree port**, not a redistribution of any upstream
> harness. Prompt content and concepts derived from
> [oh-my-openagent (OMO)](https://github.com/code-yeongyu/oh-my-openagent)
> (SUL-1.0) are adapted to OMP's tool grammar. See [ATTRIBUTION.md](./ATTRIBUTION.md).

## What you get

| Layer | Pieces |
|---|---|
| **Agents** | `sisyphus` (orchestrator), `hephaestus` (deep worker), `oracle` (read-only consult), `atlas` (plan executor), `prometheus` (interview planner), `metis` (plan critic) |
| **Slash commands** | `/ultrawork` · `/ulw` · `/init-deep` · `/refactor` · `/handoff` · `/start-work` · `/remove-ai-slops` · `/omomomo` |
| **Skills** | `git-master` · `frontend-ui-ux` · `dev-browser` · `playwright` · `playwright-cli` · `ai-slop-remover` · `review-work` · `hyperplan` · `security-research` · `tech-debt-audit` · `remove-deadcode` |
| **Hooks** | `todo-enforcer` (yank idle agents back to incomplete todos), `comment-checker` (no AI-slop comments), `intent-gate` (verbalize true intent before acting) |
| **Loop** | Ralph / ULW self-referential loop runtime (`/ralph-loop`, `/ulw-loop`, `/cancel-ralph`, `/stop-continuation`) |

## Layout

```
agents/                 OMP agent definitions (*.md)
commands/               OMP slash commands (*.md)
skills/<name>/SKILL.md  OMP skills
extensions/oh-my-omp/   the loop runtime + lifecycle hooks (TS extension)
install.sh              symlink/copy this bundle into ~/.omp/agent/
```

The directory tree mirrors `~/.omp/agent/`, so installation is just placing these
files where OMP's native discovery looks for them.

## Install

```bash
git clone https://github.com/Sebastiangmz/omp-pantheon
cd omp-pantheon
./install.sh            # symlinks the bundle into ~/.omp/agent/ (re-runnable)
```

Then start `omp` and the agents, commands, skills, hooks, and loop are live.

## Status

Actively updated to track upstream improvements. See commit history for the
per-piece update log.

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
> (SUL-1.0) are adapted to OMP's tool grammar. The Seshat/Ghola, SpecSafe,
> Linear/GitHub/docs, and discipline-hook layer is credited to
> [pi-seshat](https://github.com/Agentic-Engineering-Agency/pi-seshat), the
> public Seshat the Ghola harness integrated into this bundle. See
> [ATTRIBUTION.md](./ATTRIBUTION.md).

## What you get

| Layer | Pieces |
|---|---|
| **Agents** | Pantheon: `sisyphus`, `hephaestus`, `oracle`, `atlas`, `prometheus`, `metis`; Seshat: `steward`, `spec-writer`, `implementer`, `test-writer`, `reviewer`, `reviewer-kimi`, `validator`, `doc-scout` |
| **Slash commands** | `/ultrawork` · `/ulw` · `/init-deep` · `/refactor` · `/handoff` · `/start-work` · `/remove-ai-slops` · `/omomomo` |
| **Skills** | Pantheon skills plus Seshat/SpecSafe skills: `bootstrap`, `coherence`, `docs`, `env-doctor`, `evaluation-flywheel`, `github`, `latest-docs`, `linear`, `push`, `specsafe`; opt-in `evalfly` templates/CLI provide deterministic evaluation evidence |
| **Hooks** | Extension hooks: `todo-enforcer`, opt-in `evalfly-advisor`, `comment-checker`, `intent-gate`; agent hooks: `specsafe-session`, `specsafe-subagents`, `i-approve`, `fallback-audit` |
| **Loop** | Ralph / ULW self-referential loop runtime (`/ralph-loop`, `/ulw-loop`, `/cancel-ralph`, `/stop-continuation`) |

## Layout

```
agents/                 OMP agent definitions (*.md)
commands/               OMP slash commands (*.md)
skills/<name>/SKILL.md  OMP skills, including the opt-in evaluation flywheel
skills/evalfly/          opt-in evaluation template and CLI
hooks/*.ts              OMP lifecycle hooks from Seshat/SpecSafe
extensions/oh-my-omp/   the loop runtime + lifecycle hooks (TS extension)
test/                   integration and regression tests for Seshat/SpecSafe
docs/                   port notes and migration context
package.json            root test/typecheck runner for the integrated bundle
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

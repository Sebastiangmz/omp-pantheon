#!/usr/bin/env bash
# omp-pantheon installer — symlinks this bundle into ~/.omp/agent/.
# Re-runnable. Honors PI_CODING_AGENT_DIR / OMP profiles if AGENT_DIR is set.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${AGENT_DIR:-$HOME/.omp/agent}"

link() {
  # link <src-abs> <dest-abs>
  local s="$1" d="$2"
  mkdir -p "$(dirname "$d")"
  if [[ -e "$d" && ! -L "$d" ]]; then
    mv "$d" "$d.bak.$(date +%s)"
    echo "  backed up existing $d -> $d.bak.*"
  fi
  ln -sfn "$s" "$d"
  echo "  linked $d"
}

echo "omp-pantheon -> $AGENT_DIR"

echo "agents:"
for f in "$SRC"/agents/*.md; do link "$f" "$AGENT_DIR/agents/$(basename "$f")"; done

echo "commands:"
for f in "$SRC"/commands/*.md; do link "$f" "$AGENT_DIR/commands/$(basename "$f")"; done

echo "skills:"
for d in "$SRC"/skills/*/; do link "${d%/}" "$AGENT_DIR/skills/$(basename "${d%/}")"; done

echo "extensions:"
for d in "$SRC"/extensions/*/; do link "${d%/}" "$AGENT_DIR/extensions/$(basename "${d%/}")"; done

echo "done. Restart omp to load."

#!/usr/bin/env bash
# omp-pantheon installer — symlinks this bundle into ~/.omp/agent/.
# Re-runnable. Honors PI_CODING_AGENT_DIR / OMP profiles if AGENT_DIR is set.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${AGENT_DIR:-$HOME/.omp/agent}"
# Back up replaced files OUTSIDE the agent tree — a backup left inside
# agents/ commands/ skills/ hooks/ tools/ extensions/ gets re-discovered by OMP
# as a duplicate (double-loaded extension / shadow skill/tool).
BACKUP_DIR="${BACKUP_DIR:-$HOME/.omp/agent-backups/install-$(date +%s)}"

link() {
  # link <src-abs> <dest-abs> <category>
  local s="$1" d="$2" cat="$3"
  mkdir -p "$(dirname "$d")"
  if [[ -e "$d" && ! -L "$d" ]]; then
    mkdir -p "$BACKUP_DIR/$cat"
    mv "$d" "$BACKUP_DIR/$cat/"
    echo "  backed up existing $(basename "$d") -> $BACKUP_DIR/$cat/"
  fi
  ln -sfn "$s" "$d"
  echo "  linked $d"
}

echo "omp-pantheon -> $AGENT_DIR"

echo "agents:"
for f in "$SRC"/agents/*.md; do link "$f" "$AGENT_DIR/agents/$(basename "$f")" agents; done

echo "commands:"
for f in "$SRC"/commands/*.md; do link "$f" "$AGENT_DIR/commands/$(basename "$f")" commands; done

echo "skills:"
for d in "$SRC"/skills/*/; do link "${d%/}" "$AGENT_DIR/skills/$(basename "${d%/}")" skills; done

echo "hooks:"
for f in "$SRC"/hooks/*.ts; do link "$f" "$AGENT_DIR/hooks/$(basename "$f")" hooks; done

echo "tools:"
for d in "$SRC"/tools/*/; do link "${d%/}" "$AGENT_DIR/tools/$(basename "${d%/}")" tools; done

echo "extensions:"
for d in "$SRC"/extensions/*/; do link "${d%/}" "$AGENT_DIR/extensions/$(basename "${d%/}")" extensions; done

echo "done. Restart omp to load."

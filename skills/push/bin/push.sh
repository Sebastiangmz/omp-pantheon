#!/usr/bin/env bash
# push.sh — consent-gated git push with pre-flight checks and forensic audit log.
#
# Usage:
#   ./bin/push.sh                              # dry-run: report only, do NOT push
#   ./bin/push.sh --i-approve                  # execute push after all checks pass
#   ./bin/push.sh --i-approve --remote=origin  # explicit remote (default: origin)
#   ./bin/push.sh --i-approve --allow-main     # allow pushing main/master
#
# SpecSafe slice: SPEC-20260424-003

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
APPROVE=false
REMOTE="origin"
ALLOW_MAIN=false

for arg in "$@"; do
	case "$arg" in
		--i-approve)
			APPROVE=true
			;;
		--remote=*)
			REMOTE="${arg#--remote=}"
			;;
		--allow-main)
			ALLOW_MAIN=true
			;;
		*)
			echo "[fail] Unknown argument: $arg" >&2
			exit 1
			;;
	esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
CHECKS_FAILED=0

pass() {
	echo "[ok]  $1"
}

fail_check() {
	echo "[fail] $1" >&2
	CHECKS_FAILED=$(( CHECKS_FAILED + 1 ))
}

abort() {
	echo "[fail] $1" >&2
	exit 1
}

# Resolve the git repo root so we can find .pi/ regardless of cwd
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || abort "Not inside a git repository."

LOG_FILE="$REPO_ROOT/.pi/.push-log.jsonl"
STATE_FILE="$REPO_ROOT/.pi/.honcho-state.json"

# ---------------------------------------------------------------------------
# Gather branch info
# ---------------------------------------------------------------------------
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null) || abort "HEAD is detached. Cannot push a detached HEAD."

# ---------------------------------------------------------------------------
# Check 1: Working tree clean
# ---------------------------------------------------------------------------
PORCELAIN=$(git status --porcelain)
if [ -n "$PORCELAIN" ]; then
	fail_check "Working tree is not clean. Commit or stash your changes first."
else
	pass "Working tree is clean."
fi

# ---------------------------------------------------------------------------
# Check 2: Ahead of remote, not diverged, not at parity
# ---------------------------------------------------------------------------
TRACKING=$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)

if [ -z "$TRACKING" ]; then
	# No tracking branch — we will push with --set-upstream; treat as "ahead by all commits"
	AHEAD=$(git rev-list --count HEAD 2>/dev/null || echo 0)
	BEHIND=0
	pass "No tracking branch; will push with --set-upstream."
else
	COUNT=$(git rev-list --left-right --count "HEAD...@{u}" 2>/dev/null || echo "0	0")
	AHEAD=$(echo "$COUNT" | cut -f1)
	BEHIND=$(echo "$COUNT" | cut -f2)

	if [ "$BEHIND" -gt 0 ]; then
		fail_check "Local branch is behind or diverged from remote (behind=$BEHIND). Pull or rebase first."
	elif [ "$AHEAD" -eq 0 ]; then
		fail_check "Local branch is at parity with remote — nothing to push (ahead=0)."
	else
		pass "Branch is ahead by $AHEAD commit(s), not behind."
	fi
fi

# ---------------------------------------------------------------------------
# Check 3: Not on main/master unless --allow-main
# ---------------------------------------------------------------------------
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
	if [ "$ALLOW_MAIN" = true ]; then
		pass "On protected branch '$BRANCH' — --allow-main was provided."
	else
		fail_check "Refusing to push to protected branch '$BRANCH'. Pass --allow-main to override."
	fi
else
	pass "Branch '$BRANCH' is not a protected branch."
fi

# ---------------------------------------------------------------------------
# Check 4: At least one commit in range carries a Spec-Slice: trailer
# ---------------------------------------------------------------------------

# Find the base commit: merge-base with the remote's default branch
BASE=""
if [ -z "$BASE" ]; then
	BASE=$(git merge-base HEAD "$REMOTE/main" 2>/dev/null || true)
fi
if [ -z "$BASE" ]; then
	BASE=$(git merge-base HEAD "$REMOTE/master" 2>/dev/null || true)
fi
if [ -z "$BASE" ]; then
	# Last resort: the root commit
	BASE=$(git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1 || true)
fi

if [ -z "$BASE" ]; then
	fail_check "Could not determine a base commit to check for Spec-Slice trailers."
else
	# If we're on main/master and AHEAD > 0, check from tracking or computed base
	RANGE_END="HEAD"
	if git rev-list --quiet "$BASE..$RANGE_END" 2>/dev/null; then
		SPEC_SLICE_COUNT=$(git log "$BASE..$RANGE_END" --format="%B" 2>/dev/null | grep -c "^Spec-Slice:" || true)
	else
		SPEC_SLICE_COUNT=0
	fi

	if [ "${SPEC_SLICE_COUNT:-0}" -eq 0 ]; then
		fail_check "No Spec-Slice: trailer found in commits. Ensure at least one commit in range was made via Seshat."
	else
		pass "Found $SPEC_SLICE_COUNT commit(s) with Spec-Slice: trailer."
	fi
fi

# ---------------------------------------------------------------------------
# Check 5: .pi/.honcho-state.json has currentSlice === null
# ---------------------------------------------------------------------------
if [ -f "$STATE_FILE" ]; then
	# Use jq for safe JSON parsing; fall back to grep if jq unavailable
	if command -v jq >/dev/null 2>&1; then
		CURRENT_SLICE=$(jq -r '.currentSlice // "null"' "$STATE_FILE" 2>/dev/null || echo "null")
	else
		# Manual fallback: if "currentSlice" key exists and is not null
		CURRENT_SLICE=$(grep -o '"currentSlice":[^,}]*' "$STATE_FILE" 2>/dev/null | grep -v 'null' | head -1 || true)
		if [ -n "$CURRENT_SLICE" ]; then
			CURRENT_SLICE="open"
		else
			CURRENT_SLICE="null"
		fi
	fi

	if [ "$CURRENT_SLICE" != "null" ]; then
		fail_check "Slice still open: call specsafe_end first before pushing (currentSlice != null)."
	else
		pass "No open slice (currentSlice is null)."
	fi
else
	pass "No .honcho-state.json — treating as no open slice."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [ "$CHECKS_FAILED" -gt 0 ]; then
	echo "NOT READY: $CHECKS_FAILED check(s) failed." >&2
	exit 1
fi

if [ "$APPROVE" = false ]; then
	echo "READY TO PUSH (rerun with --i-approve)"
	exit 0
fi

# ---------------------------------------------------------------------------
# Execute push
# ---------------------------------------------------------------------------

# Capture old SHA before push (empty string if no tracking yet)
OLD_SHA=""
if [ -n "$TRACKING" ]; then
	OLD_SHA=$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || true)
fi

# Perform the push
if [ -n "$TRACKING" ]; then
	git push "$REMOTE" "$BRANCH"
else
	git push --set-upstream "$REMOTE" "$BRANCH"
fi

# Capture new SHA after push
NEW_SHA=$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || true)

# Compute commits in range
if [ -n "$OLD_SHA" ] && [ -n "$NEW_SHA" ]; then
	COMMIT_COUNT=$(git rev-list --count "$OLD_SHA..$NEW_SHA" 2>/dev/null || echo 0)
	RANGE_STR="${OLD_SHA}..${NEW_SHA}"
else
	COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo 0)
	RANGE_STR="..${NEW_SHA}"
fi

# Build the ISO8601 timestamp
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure the log directory exists and the file has mode 0600
mkdir -p "$(dirname "$LOG_FILE")"
if [ ! -f "$LOG_FILE" ]; then
	install -m 0600 /dev/null "$LOG_FILE"
fi

# Append JSON line (use jq for safe string escaping if available)
if command -v jq >/dev/null 2>&1; then
	BRANCH_JSON=$(jq -n --arg v "$BRANCH" '$v')
	REMOTE_JSON=$(jq -n --arg v "$REMOTE" '$v')
	RANGE_JSON=$(jq -n --arg v "$RANGE_STR" '$v')
	TS_JSON=$(jq -n --arg v "$TS" '$v')
	printf '{"ts":%s,"branch":%s,"remote":%s,"range":%s,"commits":%d,"approver":"luci"}\n' \
		"$TS_JSON" "$BRANCH_JSON" "$REMOTE_JSON" "$RANGE_JSON" "$COMMIT_COUNT" >> "$LOG_FILE"
else
	# Manual escaping for branch/remote — strip characters that could break JSON
	BRANCH_SAFE=$(printf '%s' "$BRANCH" | sed 's/["\]/\\&/g')
	REMOTE_SAFE=$(printf '%s' "$REMOTE" | sed 's/["\]/\\&/g')
	RANGE_SAFE=$(printf '%s' "$RANGE_STR" | sed 's/["\]/\\&/g')
	TS_SAFE=$(printf '%s' "$TS" | sed 's/["\]/\\&/g')
	printf '{"ts":"%s","branch":"%s","remote":"%s","range":"%s","commits":%d,"approver":"luci"}\n' \
		"$TS_SAFE" "$BRANCH_SAFE" "$REMOTE_SAFE" "$RANGE_SAFE" "$COMMIT_COUNT" >> "$LOG_FILE"
fi

# Safety net: ensure 0600
chmod 600 "$LOG_FILE"

echo "Push complete. Logged to .pi/.push-log.jsonl"
exit 0

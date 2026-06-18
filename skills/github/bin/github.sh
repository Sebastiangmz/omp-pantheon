#!/usr/bin/env bash
# github.sh — consent-gated gh(1) wrapper with Linear-state invariant.
#
# Reads (pr view, issue view, repo view, GET api) pass through unchanged.
# Mutations (pr create/comment/edit/merge, issue comment/edit, non-GET api)
# require --i-approve. Without it, a preview is printed and the script exits 0.
# Approved mutations are logged to .pi/.github-log.jsonl (mode 0600).
#
# `pr create` additionally enforces the Linear-state invariant: the current
# branch must begin with a Linear key (e.g. CUR-92-slug or CUR-92__slug) and
# the referenced ticket must be in an allowed state (default: in_progress,
# in_review). Override with --bypass-linear-check (requires --i-approve).
#
# Env overrides (tests):
#   PI_GITHUB_GH_CMD       — alt command in place of `gh` (space-separated OK).
#   PI_GITHUB_LINEAR_CMD   — alt command in place of the project linear skill.
#   PI_GITHUB_APPROVER     — approver name recorded in the log (default: luci).
#
# SpecSafe slice: SPEC-20260424-005 — github-skill

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants / helpers
# ---------------------------------------------------------------------------

PR_READY_STATES=(in_progress in_review)

usage() {
	cat <<'EOF'
github — safety-wrapped gh(1) wrapper.

Reads (pass-through):
  github pr view <n>
  github issue view <n>
  github repo view
  github api <route>                                # GET only without --i-approve

Mutations (require --i-approve):
  github pr create [--title=T] [--body=B] [--base=main] [--draft|--ready]
                   [--bypass-linear-check]                         [--i-approve]
  github pr comment <n> <body>                                      [--i-approve]
  github pr edit <n> [--add-label=X] [--remove-label=Y]             [--i-approve]
  github pr merge <n> [--squash|--rebase|--merge]                   [--i-approve]
  github issue comment <n> <body>                                   [--i-approve]
  github issue edit <n> [flags...]                                  [--i-approve]
  github api <route> -X POST|PATCH|PUT|DELETE [...]                 [--i-approve]

Draft mode (default): print the resolved gh command + Linear context.
Approve mode: execute gh and append an entry to .pi/.github-log.jsonl.
EOF
}

abort() {
	echo "[fail] $1" >&2
	exit 1
}

# ---------------------------------------------------------------------------
# Resolve gh binary (tests override via PI_GITHUB_GH_CMD)
# ---------------------------------------------------------------------------

GH_CMD=(gh)
if [ -n "${PI_GITHUB_GH_CMD:-}" ]; then
	# shellcheck disable=SC2206
	GH_CMD=($PI_GITHUB_GH_CMD)
fi

# Check that gh (or the override) resolves
if ! command -v "${GH_CMD[0]}" >/dev/null 2>&1; then
	cat >&2 <<EOF
[fail] gh CLI not found on PATH.

Install:   pacman -S github-cli   (or see https://cli.github.com)
Auth:      gh auth login --scopes repo,workflow
EOF
	exit 127
fi

# ---------------------------------------------------------------------------
# Resolve repo root (for log + linear skill path)
# ---------------------------------------------------------------------------

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || abort "Not inside a git repository."
LOG_FILE="$REPO_ROOT/.pi/.github-log.jsonl"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

if [ "$#" -lt 1 ]; then
	usage
	exit 1
fi

# Flag state (populated during classification)
APPROVE=false
BYPASS_LINEAR=false
READY_FLAG=false        # only meaningful for pr create

# Collect positional + passthrough args separately from our own meta-flags.
POSITIONAL=()
PASSTHROUGH=()

for arg in "$@"; do
	case "$arg" in
		--i-approve)
			APPROVE=true
			;;
		--bypass-linear-check)
			BYPASS_LINEAR=true
			;;
		--ready)
			READY_FLAG=true
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			POSITIONAL+=("$arg")
			PASSTHROUGH+=("$arg")
			;;
	esac
done

if [ "${#POSITIONAL[@]}" -lt 1 ]; then
	usage
	exit 1
fi

CMD="${POSITIONAL[0]}"
SUB="${POSITIONAL[1]:-}"

# ---------------------------------------------------------------------------
# Classification: read vs mutation
# ---------------------------------------------------------------------------

classify() {
	# Prints one of: read | mutate | invalid
	case "$CMD" in
		pr)
			case "$SUB" in
				view)
					echo read
					;;
				create|comment|edit|merge)
					echo mutate
					;;
				*)
					echo invalid
					;;
			esac
			;;
		issue)
			case "$SUB" in
				view)
					echo read
					;;
				comment|edit)
					echo mutate
					;;
				*)
					echo invalid
					;;
			esac
			;;
		repo)
			case "$SUB" in
				view)
					echo read
					;;
				*)
					echo invalid
					;;
			esac
			;;
		api)
			# Default GET is read; -X <anything but GET> is mutate.
			local seen_method="GET"
			local i=0
			for a in "${PASSTHROUGH[@]}"; do
				if [ "$a" = "-X" ] || [ "$a" = "--method" ]; then
					# Next token is the method
					local next_idx=$((i + 1))
					if [ "$next_idx" -lt "${#PASSTHROUGH[@]}" ]; then
						seen_method="${PASSTHROUGH[$next_idx]}"
					fi
				fi
				case "$a" in
					-X|--method)
						# handled by the if-branch above (next token is the method)
						;;
					-X*|--method=*)
						seen_method="${a#-X}"
						seen_method="${seen_method#--method=}"
						;;
				esac
				i=$((i + 1))
			done
			# Normalize to upper
			seen_method=$(printf '%s' "$seen_method" | tr '[:lower:]' '[:upper:]')
			if [ "$seen_method" = "GET" ]; then
				echo read
			else
				echo mutate
			fi
			;;
		*)
			echo invalid
			;;
	esac
}

KIND=$(classify)

if [ "$KIND" = "invalid" ]; then
	echo "[fail] Unknown or unsupported command: github ${POSITIONAL[*]}" >&2
	echo "" >&2
	usage >&2
	exit 1
fi

# ---------------------------------------------------------------------------
# Read commands — pure pass-through
# ---------------------------------------------------------------------------

if [ "$KIND" = "read" ]; then
	exec "${GH_CMD[@]}" "${PASSTHROUGH[@]}"
fi

# ---------------------------------------------------------------------------
# Mutations from here on
# ---------------------------------------------------------------------------

# Linear-state invariant applies only to `pr create`.
LINEAR_NOTICE=""

run_linear_get() {
	local key="$1"
	if [ -n "${PI_GITHUB_LINEAR_CMD:-}" ]; then
		# shellcheck disable=SC2086
		$PI_GITHUB_LINEAR_CMD get "$key" 2>&1
	else
		bun run "$REPO_ROOT/.pi/skills/linear/bin/linear.ts" get "$key" 2>&1
	fi
}

extract_linear_key() {
	# Echo the Linear key from the current branch, or empty string.
	local branch
	branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
	if [ -z "$branch" ]; then
		echo ""
		return
	fi
	# Accept: CUR-92-foo, CUR-92__foo-bar, SPEC-92_foo — uppercase key + dash + digits
	if [[ "$branch" =~ ^([A-Z]+-[0-9]+)([-_].*)?$ ]]; then
		echo "${BASH_REMATCH[1]}"
	else
		echo ""
	fi
}

normalize_state() {
	# Map "In Progress" -> in_progress; "In Review" -> in_review; etc.
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '_'
}

check_linear_invariant() {
	# Populates LINEAR_NOTICE. Returns 0 if OK (or skip), 1 if refused.
	local key
	key=$(extract_linear_key)
	if [ -z "$key" ]; then
		LINEAR_NOTICE="branch does not reference a Linear ticket."
		if [ "$BYPASS_LINEAR" = true ]; then
			LINEAR_NOTICE="$LINEAR_NOTICE (bypass active)"
			return 0
		fi
		echo "[fail] $LINEAR_NOTICE" >&2
		echo "[hint] Rename your branch to <KEY>-<slug> (e.g. CUR-92-login-fix) first, or pass --bypass-linear-check with --i-approve." >&2
		return 1
	fi

	local output
	local exit_code=0
	output=$(run_linear_get "$key") || exit_code=$?

	# Linear skill returns exit 2 when LINEAR_API_KEY is unset. Auto-skip (Q2).
	if [ "$exit_code" -eq 2 ] && printf '%s' "$output" | grep -q "LINEAR_API_KEY"; then
		LINEAR_NOTICE="Linear invariant skipped: LINEAR_API_KEY not set."
		return 0
	fi

	if [ "$exit_code" -ne 0 ]; then
		LINEAR_NOTICE="Linear lookup for $key failed (exit $exit_code): $(printf '%s' "$output" | head -1)"
		if [ "$BYPASS_LINEAR" = true ]; then
			LINEAR_NOTICE="$LINEAR_NOTICE (bypass active)"
			return 0
		fi
		echo "[fail] $LINEAR_NOTICE" >&2
		echo "[hint] Pass --bypass-linear-check with --i-approve to proceed anyway." >&2
		return 1
	fi

	local state_line state_name state_norm
	state_line=$(printf '%s\n' "$output" | grep -E '^state:' | head -1 || true)
	# state_line is e.g. "state:       In Progress (started)"
	# Strip "state:" prefix and trailing "(type)".
	state_name=$(printf '%s' "$state_line" | sed -E 's/^state:[[:space:]]+//; s/[[:space:]]*\([^)]*\)$//')
	state_norm=$(normalize_state "$state_name")

	local allowed=false
	for s in "${PR_READY_STATES[@]}"; do
		if [ "$state_norm" = "$s" ]; then
			allowed=true
			break
		fi
	done

	if [ "$allowed" = true ]; then
		LINEAR_NOTICE="Linear $key is in '$state_name' — PR-ready."
		return 0
	fi

	LINEAR_NOTICE="Linear $key is in '$state_name' (normalized: $state_norm); expected one of: ${PR_READY_STATES[*]}."
	if [ "$BYPASS_LINEAR" = true ]; then
		LINEAR_NOTICE="$LINEAR_NOTICE (bypass active)"
		return 0
	fi
	echo "[fail] $LINEAR_NOTICE" >&2
	echo "[hint] Transition the ticket via: ./.pi/skills/linear/bin/linear.ts transition $key in_review --i-approve" >&2
	echo "[hint] Or rerun with --bypass-linear-check --i-approve if you have a reason." >&2
	return 1
}

# Build gh argv for the mutation (strip our meta-flags which are already parsed).
GH_ARGS=("${PASSTHROUGH[@]}")

# For `pr create`, normalize draft/ready semantics: default to --draft unless --ready.
if [ "$CMD" = "pr" ] && [ "$SUB" = "create" ]; then
	if [ "$READY_FLAG" = false ]; then
		# Only add --draft if not already present
		has_draft=false
		for a in "${GH_ARGS[@]}"; do
			if [ "$a" = "--draft" ]; then
				has_draft=true
				break
			fi
		done
		if [ "$has_draft" = false ]; then
			GH_ARGS+=("--draft")
		fi
	fi

	if ! check_linear_invariant; then
		exit 1
	fi
fi

# ---------------------------------------------------------------------------
# Preview (no --i-approve): print resolved command + Linear context, exit 0.
# ---------------------------------------------------------------------------

if [ "$APPROVE" = false ]; then
	echo "DRAFT — would run:"
	printf '  %q' "${GH_CMD[@]}"
	for a in "${GH_ARGS[@]}"; do
		printf ' %q' "$a"
	done
	printf '\n'
	if [ -n "$LINEAR_NOTICE" ]; then
		echo ""
		echo "Linear: $LINEAR_NOTICE"
	fi
	echo ""
	echo "Rerun with --i-approve to execute."
	exit 0
fi

# ---------------------------------------------------------------------------
# Execute gh and capture output
# ---------------------------------------------------------------------------

set +e
GH_STDOUT=$("${GH_CMD[@]}" "${GH_ARGS[@]}" 2> >(tee /tmp/github-skill-stderr.$$ >&2))
GH_EXIT=$?
set -e
GH_STDERR_FILE="/tmp/github-skill-stderr.$$"
[ -f "$GH_STDERR_FILE" ] || GH_STDERR_FILE=""

# Echo gh's stdout so the user sees normal output.
if [ -n "$GH_STDOUT" ]; then
	printf '%s\n' "$GH_STDOUT"
fi

# Try to derive a result URL for the log.
RESULT_URL=""
case "$CMD-$SUB" in
	pr-create)
		# gh pr create prints the URL as the final line of stdout.
		RESULT_URL=$(printf '%s' "$GH_STDOUT" | grep -oE 'https://github\.com/[^ ]+' | tail -1 || true)
		;;
	pr-merge)
		# Capture merge commit SHA via a follow-up view.
		PR_NUM="${POSITIONAL[2]:-}"
		if [ -n "$PR_NUM" ] && [ "$GH_EXIT" -eq 0 ]; then
			RESULT_URL=$("${GH_CMD[@]}" pr view "$PR_NUM" --json mergeCommit --jq '.mergeCommit.oid' 2>/dev/null || true)
		fi
		;;
	pr-comment|issue-comment)
		RESULT_URL=$(printf '%s' "$GH_STDOUT" | grep -oE 'https://github\.com/[^ ]+' | tail -1 || true)
		;;
esac

# ---------------------------------------------------------------------------
# Append JSONL audit log (mode 0600)
# ---------------------------------------------------------------------------

APPROVER="${PI_GITHUB_APPROVER:-luci}"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CMD_LABEL="$CMD $SUB"

mkdir -p "$(dirname "$LOG_FILE")"
if [ ! -f "$LOG_FILE" ]; then
	install -m 0600 /dev/null "$LOG_FILE"
fi

# Build args array as JSON. Prefer jq for safety.
if command -v jq >/dev/null 2>&1; then
	ARGS_JSON=$(printf '%s\n' "${GH_ARGS[@]}" | jq -R . | jq -s .)
	ENTRY=$(jq -c -n \
		--arg ts "$TS" \
		--arg cmd "$CMD_LABEL" \
		--argjson args "$ARGS_JSON" \
		--argjson exit "$GH_EXIT" \
		--arg result_url "$RESULT_URL" \
		--arg approver "$APPROVER" \
		'{ts:$ts, action:$cmd, args:$args, exit:$exit, result_url:$result_url, approver:$approver}')
	printf '%s\n' "$ENTRY" >> "$LOG_FILE"
else
	# Minimal fallback: string-escape manually (best-effort).
	escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
	ARGS_STR=""
	for a in "${GH_ARGS[@]}"; do
		ARGS_STR+="\"$(escape "$a")\","
	done
	ARGS_STR="[${ARGS_STR%,}]"
	printf '{"ts":"%s","action":"%s","args":%s,"exit":%d,"result_url":"%s","approver":"%s"}\n' \
		"$(escape "$TS")" "$(escape "$CMD_LABEL")" "$ARGS_STR" "$GH_EXIT" "$(escape "$RESULT_URL")" "$(escape "$APPROVER")" \
		>> "$LOG_FILE"
fi

chmod 600 "$LOG_FILE"

[ -n "$GH_STDERR_FILE" ] && rm -f "$GH_STDERR_FILE"

exit "$GH_EXIT"

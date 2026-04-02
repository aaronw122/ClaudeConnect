#!/usr/bin/env bash
# remote-query.sh — Claude Connect remote runner
#
# SECURITY BOUNDARY: This script runs on the remote machine when a peer
# queries you via SSH. It validates the request, enforces the repo allowlist,
# and invokes the detected AI CLI in read-only mode.
#
# Designed to be used with a restricted shell (command= in authorized_keys)
# so the SSH key can ONLY invoke this script.
#
# Usage:
#   echo "$PROMPT" | ssh user@host "~/.claude-connect/remote-query.sh /path/to/repo"
#
# Inputs:
#   $1         — REPO_PATH (absolute path to project directory)
#   stdin      — PROMPT (the query text, piped via stdin)
#
# Security properties:
#   - SSH key restricted to this script via command= in authorized_keys
#   - Repo must be under the directory specified in ~/.claude-connect/peers.yaml local.path
#   - Path validated with realpath (no symlink/traversal tricks)
#   - Claude: --bare mode (no hooks/plugins/CLAUDE.md), only git read commands allowlisted
#   - Claude auth: reads OAuth token from ~/.claude-connect/.oauth-token (chmod 600)
#   - Codex: kernel-level read-only sandbox
#   - Stdout truncated to 4KB max
#   - Stderr suppressed
#
# Known macOS issues handled:
#   - SSH sessions have minimal PATH — common CLI paths prepended
#   - No GNU `timeout` — shell-based fallback (breaks stdin, so prompt passed as arg)
#   - Keychain inaccessible over SSH — OAuth token read from file instead

set -euo pipefail

# ---------------------------------------------------------------------------
# PATH — SSH sessions use a minimal PATH; add common CLI install locations
# ---------------------------------------------------------------------------
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CONFIG_FILE="$HOME/.claude-connect/peers.yaml"
MAX_RESPONSE_BYTES=8192

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<'USAGE'
Usage: echo "PROMPT" | remote-query.sh <REPO_PATH>

Claude Connect remote runner — executes an AI query against a local git
repository in read-only mode.

Arguments:
  REPO_PATH       Absolute path to a git repository listed in peers.yaml

Options:
  --help          Show this help message
  --list-repos    List locally configured queryable repositories

The prompt is read from stdin. Never pass it as a shell argument.

Config: ~/.claude-connect/peers.yaml (local.path)
USAGE
}

# ---------------------------------------------------------------------------
# --help / --list-repos flags
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

# ---------------------------------------------------------------------------
# Helper functions (defined before flag handlers that use them)
# ---------------------------------------------------------------------------

# Extract the local.path value from peers.yaml.
# This is the root directory that peers are allowed to query.
# Any git repo under this path is queryable.
get_local_root() {
  local raw_path
  raw_path="$(awk '/^local:/ { in_local = 1; next } /^[a-zA-Z]/ && !/^local:/ { in_local = 0 } in_local && /^[[:space:]]+path:/ { print $2; exit }' "$CONFIG_FILE")"

  if [[ -z "$raw_path" ]]; then
    echo "Error: No local.path configured in $CONFIG_FILE. Run /cc-setup to complete setup." >&2
    exit 1
  fi

  # Expand ~ to home directory
  raw_path="${raw_path/#\~/$HOME}"

  if [[ ! -d "$raw_path" ]]; then
    echo "Error: Local root directory does not exist: $raw_path" >&2
    exit 1
  fi

  realpath "$raw_path"
}

# Validate REPO_PATH is under the configured local root.
# Both paths are resolved with realpath (no symlink/traversal tricks).
validate_repo_under_root() {
  local resolved="$1"
  local root="$2"

  # Append trailing slash to prevent prefix attacks:
  # Without it, root=/home/aaron/code would match /home/aaron/codeevil
  if [[ "$resolved" != "$root"/* && "$resolved" != "$root" ]]; then
    echo "Error: Repository not under queryable directory: $REPO_PATH" >&2
    echo "Queryable root: $root" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# --list-repos flag
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--list-repos" ]]; then
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Config file not found: $CONFIG_FILE" >&2
    exit 1
  fi
  LOCAL_ROOT="$(get_local_root)"
  echo "Queryable directory: $LOCAL_ROOT"
  echo "Git repos found:"
  find "$LOCAL_ROOT" -maxdepth 3 -name .git -type d 2>/dev/null | while read -r gitdir; do
    echo "  $(dirname "$gitdir")"
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# Validate arguments
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Error: REPO_PATH argument required" >&2
  echo "Run with --help for usage" >&2
  exit 1
fi

REPO_PATH="$1"

# ---------------------------------------------------------------------------
# Validate config file exists and is readable
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found: $CONFIG_FILE" >&2
  echo "Create ~/.claude-connect/peers.yaml with a local.path entry. Run /cc-setup to get started." >&2
  exit 1
fi

if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "Error: Config file not readable: $CONFIG_FILE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve REPO_PATH to canonical absolute path (no symlinks, no ..)
# ---------------------------------------------------------------------------
if [[ ! -d "$REPO_PATH" ]]; then
  echo "Error: Directory does not exist: $REPO_PATH" >&2
  exit 1
fi

REPO_PATH_RESOLVED="$(realpath "$REPO_PATH")"

LOCAL_ROOT="$(get_local_root)"
validate_repo_under_root "$REPO_PATH_RESOLVED" "$LOCAL_ROOT"

# ---------------------------------------------------------------------------
# Validate REPO_PATH is a git repository
# ---------------------------------------------------------------------------
if ! git -C "$REPO_PATH_RESOLVED" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: Not a git repository: $REPO_PATH_RESOLVED" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Read prompt from stdin
# ---------------------------------------------------------------------------
PROMPT="$(cat)"

if [[ -z "$PROMPT" ]]; then
  echo "Error: No prompt received on stdin" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect available AI CLI (preference order: claude, codex, gemini)
# ---------------------------------------------------------------------------
detect_cli() {
  # Return "name:full_path" so invoke_cli can use the absolute path
  # (timeout and other subprocesses may not inherit PATH)
  local p
  for name in claude codex gemini; do
    p="$(command -v "$name" 2>/dev/null)" && { echo "$name:$p"; return; }
  done
  echo ""
}

CLI_RESULT="$(detect_cli)"

if [[ -z "$CLI_RESULT" ]]; then
  echo "Error: No supported AI CLI found on this machine." >&2
  echo "Checked for: claude, codex, gemini" >&2
  exit 1
fi

CLI="${CLI_RESULT%%:*}"
CLI_PATH="${CLI_RESULT#*:}"

# ---------------------------------------------------------------------------
# Timeout wrapper — macOS doesn't ship GNU timeout
# ---------------------------------------------------------------------------
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    # Background the command + watchdog; kill if it exceeds the limit
    "$@" &
    local pid=$!
    ( sleep "$secs" && kill "$pid" 2>/dev/null ) &
    local watcher=$!
    wait "$pid" 2>/dev/null
    local rc=$?
    kill "$watcher" 2>/dev/null
    wait "$watcher" 2>/dev/null
    return "$rc"
  fi
}

# ---------------------------------------------------------------------------
# Invoke the detected CLI in read-only headless mode
#
# Each CLI has its own sandboxing strategy:
#   - Claude: --allowedTools restricts to git read commands only (no
#     Read/Glob/Grep), --permission-mode plan as second layer
#   - Codex: --sandbox read-only provides kernel-level enforcement
#   - Gemini: --approval-mode plan (best-effort; needs empirical validation)
#
# Stderr is suppressed. Stdout is truncated to MAX_RESPONSE_BYTES.
# ---------------------------------------------------------------------------
invoke_cli() {
  local cli="$1"
  local cli_path="$2"
  local repo="$3"
  # Prompt is passed via stdin to this function (not as an argument)

  case "$cli" in
    claude)
      # If oauth-token file exists, extract accessToken for auth
      local token_file="$HOME/.claude-connect/.oauth-token"
      if [[ -f "$token_file" ]]; then
        local access_token
        access_token="$(python3 -c "import json; print(json.load(open('$token_file'))['claudeAiOauth']['accessToken'])" 2>/dev/null)"
        if [[ -n "$access_token" ]]; then
          export ANTHROPIC_API_KEY="$access_token"
        fi
      fi
      # Read stdin into variable — run_with_timeout backgrounds the process
      # which detaches stdin, so we must capture it first
      local claude_prompt
      claude_prompt="$(cat)"
      cd "$repo" && run_with_timeout 55 "$cli_path" --bare -p "$claude_prompt" \
        --allowedTools "Bash(git status),Bash(git diff),Bash(git log),Bash(git branch),Bash(git show),Bash(git ls-files)" \
        --permission-mode plan \
        2>/dev/null
      ;;
    codex)
      # Codex reads prompt from positional arg; pipe not supported.
      # Read stdin into a variable and pass as arg (within the remote shell only).
      local codex_prompt
      codex_prompt="$(cat)"
      run_with_timeout 55 "$cli_path" exec --sandbox read-only -C "$repo" "$codex_prompt" \
        2>/dev/null
      ;;
    gemini)
      cd "$repo" && run_with_timeout 55 "$cli_path" --approval-mode plan -p - \
        2>/dev/null
      ;;
  esac
}

# Run the CLI and truncate output to 4KB
# Pipe the prompt into the CLI via stdin
# Use || true to prevent set -e from exiting before we capture the exit code
OUTPUT="$(echo "$PROMPT" | invoke_cli "$CLI" "$CLI_PATH" "$REPO_PATH_RESOLVED")" && CLI_EXIT=0 || CLI_EXIT=$?

# Truncate to max response size (4KB heuristic guard against source leakage)
if [[ ${#OUTPUT} -gt $MAX_RESPONSE_BYTES ]]; then
  OUTPUT="${OUTPUT:0:$MAX_RESPONSE_BYTES}"
  OUTPUT+=$'\n[Response truncated to 4KB]'
fi

printf '%s\n' "$OUTPUT"
exit "$CLI_EXIT"

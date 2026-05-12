#!/usr/bin/env bash
# post-write.sh — Run after any Write/Edit on a file inside the vault.
#
# Claude Code passes the edited path on stdin as part of the hook payload
# (JSON: { tool_input: { file_path: "..." }, ... }). This script:
#   1. Confirms the path is inside the vault and ends in .md
#   2. Rebuilds 90-meta/graph/index.json
#   3. Runs propose-links.py against the changed file (apply mode)
#
# Designed to be wired as a PostToolUse hook in ~/.claude/settings.json:
#
#   {
#     "hooks": {
#       "PostToolUse": [
#         {
#           "matcher": "Write|Edit",
#           "hooks": [
#             { "type": "command",
#               "command": "/home/user/Obsidian/SecondBrain/90-meta/hooks/post-write.sh" }
#           ]
#         }
#       ]
#     }
#   }
#
# Output goes to stderr so it shows up in the Claude session as informational.
# Exit 0 always — never block a write.

set -u

VAULT="/home/user/Obsidian/SecondBrain"
SCRIPTS="$VAULT/90-meta/scripts"

# Read hook payload from stdin if present
payload=""
if [ ! -t 0 ]; then
  payload="$(cat)"
fi

# Extract file_path from JSON payload. Fallback: $1.
file_path=""
if [ -n "$payload" ] && command -v jq >/dev/null 2>&1; then
  file_path="$(echo "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
fi
if [ -z "$file_path" ] && [ $# -ge 1 ]; then
  file_path="$1"
fi

# Bail if file_path is empty, not in vault, or not .md
if [ -z "$file_path" ]; then exit 0; fi
case "$file_path" in
  "$VAULT"/*.md) : ;;
  *) exit 0 ;;
esac

# Skip writes inside .obsidian, templates, scripts, hooks, graph
case "$file_path" in
  *"/.obsidian/"*) exit 0 ;;
  *"/90-meta/templates/"*) exit 0 ;;
  *"/90-meta/scripts/"*) exit 0 ;;
  *"/90-meta/hooks/"*) exit 0 ;;
  *"/90-meta/graph/"*) exit 0 ;;
esac

# Run the index rebuild
if [ -x "$SCRIPTS/build-index.py" ]; then
  "$SCRIPTS/build-index.py" >&2 || true
fi

# Run auto-link in apply mode
if [ -x "$SCRIPTS/propose-links.py" ]; then
  "$SCRIPTS/propose-links.py" "$file_path" --apply >&2 || true
fi

exit 0

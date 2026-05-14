#!/usr/bin/env bash
# Second Brain — one-shot installer for macOS / Linux
# Runs from the kiaan99 repo root: `bash setup/install.sh`
#
# What it does (in order):
#   1. Detects OS (Mac vs Linux) for sed flavor
#   2. Verifies node + python3 + curl exist
#   3. Backs up any existing ~/.claude.json or ~/.claude/settings.json
#   4. Copies obsidian-vault/ → ~/Obsidian/SecondBrain/
#   5. Copies claude-config/{claude.json,settings.json} → ~/.claude/
#   6. Copies claude-config/commands/*.md → ~/.claude/commands/
#   7. Rewrites every /home/user reference to your real $HOME
#   8. Pins obsidian-mcp-server version based on detected Node version
#   9. Chmod +x on the post-write hook
#  10. Warms up the MCP server (npx -y) so first launch isn't a 30s download
#  11. Prompts for the Obsidian Local REST API key and wires it
#  12. Opens Obsidian to the vault (if Obsidian is installed)
#  13. Prints the 2 manual clicks left for you + verification commands
#
# Safe to re-run: backs up before overwriting, idempotent in all steps.

set -euo pipefail

# ---- pretty output helpers ----
GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
say()  { printf "%s==>%s %s\n" "$BLUE" "$RESET" "$*"; }
ok()   { printf "%s ✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn() { printf "%s !%s %s\n" "$YELLOW" "$RESET" "$*"; }
die()  { printf "%s ✗%s %s\n" "$RED" "$RESET" "$*" >&2; exit 1; }
ask()  { printf "%s?%s %s " "$BOLD" "$RESET" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---- 1. OS / sed flavor detection ----
case "$(uname -s)" in
  Darwin) SED_INPLACE=(sed -i '');;
  Linux)  SED_INPLACE=(sed -i);;
  *)      die "Unsupported OS: $(uname -s). This installer supports macOS and Linux only.";;
esac
say "Detected OS: $(uname -s)"

# ---- 2. Prereq binaries ----
for bin in node npm npx python3 curl; do
  command -v "$bin" >/dev/null 2>&1 || die "Missing prerequisite: $bin (install it, then re-run)"
done
ok "Prereqs present: node, npm, npx, python3, curl"

NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\)\..*/\1/')
say "Node v$NODE_MAJOR detected"

# ---- 3. Required source dirs ----
[ -d "$REPO_ROOT/obsidian-vault" ] || die "Missing $REPO_ROOT/obsidian-vault — are you on the right branch?"
[ -d "$REPO_ROOT/claude-config" ]   || die "Missing $REPO_ROOT/claude-config — are you on the right branch?"

VAULT_DEST="$HOME/Obsidian/SecondBrain"
CLAUDE_JSON="$HOME/.claude.json"
SETTINGS_JSON="$HOME/.claude/settings.json"
COMMANDS_DIR="$HOME/.claude/commands"
STAMP=$(date +%Y%m%d-%H%M%S)

# ---- 4. Backup any existing config ----
if [ -f "$CLAUDE_JSON" ]; then
  cp -p "$CLAUDE_JSON" "$CLAUDE_JSON.bak.$STAMP"
  warn "Backed up existing ~/.claude.json → $CLAUDE_JSON.bak.$STAMP"
fi
if [ -f "$SETTINGS_JSON" ]; then
  cp -p "$SETTINGS_JSON" "$SETTINGS_JSON.bak.$STAMP"
  warn "Backed up existing ~/.claude/settings.json → $SETTINGS_JSON.bak.$STAMP"
fi
if [ -d "$VAULT_DEST" ]; then
  mv "$VAULT_DEST" "$VAULT_DEST.bak.$STAMP"
  warn "Existing vault moved to $VAULT_DEST.bak.$STAMP (your old content is safe)"
fi

# ---- 5. Copy vault ----
mkdir -p "$HOME/Obsidian"
cp -R "$REPO_ROOT/obsidian-vault" "$VAULT_DEST"
ok "Vault installed at $VAULT_DEST"

# ---- 6. Copy claude config ----
mkdir -p "$COMMANDS_DIR"
cp "$REPO_ROOT/claude-config/claude.json"    "$CLAUDE_JSON"
cp "$REPO_ROOT/claude-config/settings.json"  "$SETTINGS_JSON"
cp "$REPO_ROOT"/claude-config/commands/*.md  "$COMMANDS_DIR/"
ok "Claude config installed at ~/.claude.json, ~/.claude/settings.json, ~/.claude/commands/"

# ---- 7. Path rewrite /home/user → $HOME ----
TARGETS=("$VAULT_DEST" "$CLAUDE_JSON" "$SETTINGS_JSON" "$COMMANDS_DIR")
FILES_TO_REWRITE=$(grep -rl "/home/user" "${TARGETS[@]}" 2>/dev/null || true)
if [ -n "$FILES_TO_REWRITE" ]; then
  echo "$FILES_TO_REWRITE" | tr '\n' '\0' | xargs -0 "${SED_INPLACE[@]}" "s|/home/user|$HOME|g"
  COUNT=$(echo "$FILES_TO_REWRITE" | wc -l | tr -d ' ')
  ok "Rewrote /home/user → $HOME in $COUNT files"
fi

# Verify zero leftovers
LEFTOVERS=$(grep -rl "/home/user" "${TARGETS[@]}" 2>/dev/null | wc -l | tr -d ' ')
[ "$LEFTOVERS" = "0" ] || die "Still found /home/user references after rewrite — bailing"

# ---- 8. Pin MCP server version ----
if [ "$NODE_MAJOR" -lt 24 ]; then
  "${SED_INPLACE[@]}" "s|obsidian-mcp-server@3.1.7|obsidian-mcp-server@2.0.7|" "$CLAUDE_JSON"
  ok "Pinned obsidian-mcp-server@2.0.7 (Node $NODE_MAJOR — upgrade to Node 24 later for @3.1.7)"
else
  ok "Keeping obsidian-mcp-server@3.1.7 (Node $NODE_MAJOR is fine)"
fi

# ---- 9. Chmod hook ----
chmod +x "$VAULT_DEST/90-meta/hooks/post-write.sh"
ok "Hook is executable"

# ---- 10. Warm up MCP server (download + cache) ----
say "Warming up obsidian-mcp-server (downloads to npx cache; ~30s first time, free thereafter)..."
MCP_VERSION=$(grep -o 'obsidian-mcp-server@[0-9.]*' "$CLAUDE_JSON" | head -1 | cut -d@ -f2)
if OBSIDIAN_API_KEY=warm-up MCP_TRANSPORT_TYPE=stdio timeout 20 npx -y "obsidian-mcp-server@$MCP_VERSION" </dev/null >/dev/null 2>&1; then
  ok "Server warmed up"
elif [ $? -eq 124 ] || [ $? -eq 143 ]; then
  # timeout = server was waiting for stdio = success
  ok "Server warmed up (started cleanly, killed after 20s)"
else
  warn "Server warm-up exited non-zero — may still work at runtime"
fi

# ---- 11. API key prompt ----
echo
say "${BOLD}Obsidian Local REST API key${RESET}"
echo "  Now switch to Obsidian and do these 2 clicks:"
echo "    1. Settings → Community plugins → Browse → install ${BOLD}'Local REST API'${RESET} → Enable"
echo "    2. Settings → Community plugins → Local REST API (gear icon) → ${BOLD}copy the API Key${RESET}"
echo
echo "  Paste it here. (Enter to skip and wire it manually later.)"
ask "API Key:"
read -r API_KEY

if [ -n "$API_KEY" ]; then
  # escape any pipe characters in the key (paranoia)
  ESCAPED_KEY=$(printf '%s' "$API_KEY" | sed 's/[\/&|]/\\&/g')
  "${SED_INPLACE[@]}" "s|REPLACE_ME_WITH_LOCAL_REST_API_KEY|$ESCAPED_KEY|" "$CLAUDE_JSON"
  ok "API key wired into ~/.claude.json"
else
  warn "Skipped key paste. Wire it later with:"
  warn "  sed -i '' \"s|REPLACE_ME_WITH_LOCAL_REST_API_KEY|YOUR_KEY|\" ~/.claude.json   # Mac"
  warn "  sed -i \"s|REPLACE_ME_WITH_LOCAL_REST_API_KEY|YOUR_KEY|\" ~/.claude.json      # Linux"
fi

# ---- 12. Open the vault in Obsidian (Mac only — Linux varies too much) ----
if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Obsidian.app" ]; then
  say "Opening Obsidian to the SecondBrain vault..."
  open -a "Obsidian" "$VAULT_DEST" 2>/dev/null || true
  ok "Obsidian launched — accept the 'Open as vault' prompt"
fi

# ---- 13. Final report ----
echo
echo "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
echo "${GREEN}${BOLD}  Second brain is installed.${RESET}"
echo "${GREEN}${BOLD}════════════════════════════════════════════════════════════════${RESET}"
echo
echo "  Vault:           $VAULT_DEST"
echo "  Claude config:   $CLAUDE_JSON"
echo "  Hook config:     $SETTINGS_JSON"
echo "  Slash commands:  $COMMANDS_DIR"
echo
echo "${BOLD}Still to do (only you can):${RESET}"
echo "  1. ${BOLD}Restart Claude Code${RESET} — close any running session, open a fresh one"
[ -z "$API_KEY" ] && echo "  2. ${BOLD}Wire the API key${RESET} — see the sed command above"
echo
echo "${BOLD}Then verify with these 3 prompts in a fresh Claude Code session:${RESET}"
echo "  /brain-search welcome"
echo "  /brain-health light"
echo "  \"List 3 notes from my Obsidian vault.\""
echo
echo "${BOLD}First real use:${RESET} /brain-start kiaan99"
echo

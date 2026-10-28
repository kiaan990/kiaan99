#!/usr/bin/env bash
# Agentic OS installer for macOS.
# Safe to run again at any time: it only adds what's missing and never deletes anything.
#
#   ./install.sh
#
# What it does (in order):
#   1. Checks your Mac has Node.js, git (Xcode tools) and Claude Code (and that you're logged in)
#   2. Finds your Obsidian vault "second brain" and asks you to confirm it
#   3. Creates raw/ wiki/ outputs/ in the vault if missing (never touches existing notes)
#   4. Offers to ADD filing rules to the vault's CLAUDE.md (your existing text is kept as-is)
#   5. Installs the app's packages and builds the dashboard
#   6. Writes .env (local token, vault path, optional OpenAI key)
#   7. Links the skills into ~/.claude/skills
#   8. Checks the connections and prints the one command to start

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; D=""; N=""
fi

step() { printf "\n${B}%s${N}\n" "$1"; }
ok()   { printf "  ${G}✓${N} %s\n" "$1"; }
warn() { printf "  ${Y}!${N} %s\n" "$1"; }
info() { printf "  ${D}%s${N}\n" "$1"; }
fail() {
  printf "\n  ${R}✗ %s${N}\n\n  ${B}How to fix:${N}\n" "$1"
  shift
  for line in "$@"; do printf "    %s\n" "$line"; done
  printf "\n  Then run ${B}./install.sh${N} again.\n\n"
  exit 1
}
# ask_yn "Question?" default(y|n)  -> returns 0 for yes
ask_yn() {
  local hint="[y/N]"; [ "$2" = "y" ] && hint="[Y/n]"
  local ans=""
  read -r -p "  $1 $hint " ans </dev/tty || ans=""
  ans="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  [ -z "$ans" ] && ans="$2"
  [ "$ans" = "y" ] || [ "$ans" = "yes" ]
}

printf "\n${B}Agentic OS — installer${N}\n"
info "Nothing here deletes or overwrites your files. You can stop at any time with Control + C."

# ---------------------------------------------------------------------------
step "1/8  Checking prerequisites"

if [ "$(uname)" = "Darwin" ]; then
  ok "macOS $(sw_vers -productVersion 2>/dev/null)"
else
  warn "This installer is written for macOS; continuing anyway."
fi

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed." \
    "1. Open https://nodejs.org and download the macOS installer marked \"LTS\"." \
    "2. Double-click it and follow the steps." \
    "3. Close this Terminal window and open a new one."
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit((a===20&&b>=19)||(a===22&&b>=12)||(a>=23&&a<=26)?0:1)'; then
  fail "Node.js $(node -v) is not supported (need 20.19+, 22.12+, or 23–26)." \
    "Download the current \"LTS\" installer from https://nodejs.org, install it," \
    "then close this Terminal window and open a new one."
fi
ok "Node.js $(node -v)"
command -v npm >/dev/null 2>&1 || fail "npm is missing (it normally comes with Node.js)." "Reinstall Node.js from https://nodejs.org (LTS)."

if [ "$(uname)" = "Darwin" ] && ! xcode-select -p >/dev/null 2>&1; then
  fail "Apple's command line tools (which include git) are not installed." \
    "Run:  xcode-select --install" \
    "A window pops up; click Install and wait for it to finish (a few minutes)."
fi
command -v git >/dev/null 2>&1 || fail "git is not installed." "Run:  xcode-select --install"
ok "$(git --version)"

if ! command -v claude >/dev/null 2>&1; then
  fail "Claude Code is not installed." \
    "Run:  curl -fsSL https://claude.ai/install.sh | bash" \
    "(or see https://docs.claude.com/en/docs/claude-code/setup)" \
    "Then close this Terminal window and open a new one."
fi
ok "Claude Code $(claude --version 2>/dev/null | head -n1)"

AUTH_JSON="$(claude auth status --json 2>/dev/null || true)"
LOGGED_IN="$(printf '%s' "$AUTH_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).loggedIn))}catch{process.stdout.write("unknown")}})')"
if [ "$LOGGED_IN" = "true" ]; then
  ok "Claude Code is logged in (jobs will use your Claude subscription)"
elif [ "$LOGGED_IN" = "false" ]; then
  fail "Claude Code is installed but not logged in." \
    "1. Type:  claude" \
    "2. It will ask you to log in and open your browser — use your Claude account." \
    "3. When it says you're logged in, type  /exit  and press Return."
else
  warn "Couldn't confirm your Claude login (older Claude Code?). Updating is recommended: claude update"
  ask_yn "Are you logged in to Claude Code (you've used it before)?" "y" || fail "Claude Code needs a login." "Type:  claude   and follow the login steps, then  /exit"
fi
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  warn "ANTHROPIC_API_KEY is set in your shell. Agentic OS ignores it so runs use your Claude login, not metered API billing."
fi

# ---------------------------------------------------------------------------
step "2/8  Finding your Obsidian vault"

VAULT=""
EXISTING="$(node scripts/get-env.js VAULT_PATH --value 2>/dev/null || true)"
if [ -n "$EXISTING" ] && [ -d "$EXISTING" ]; then
  info "Currently set to: $EXISTING"
  if ask_yn "Keep using this vault?" "y"; then VAULT="$EXISTING"; fi
fi

if [ -z "$VAULT" ]; then
  info "Searching your home folder for a folder named \"second brain\" (macOS may ask Terminal for permission to look in Documents/Desktop — that's expected)…"
  CANDIDATES="$( {
    find "$HOME" -maxdepth 5 \( -path "$HOME/Library" -o -name node_modules -o -name .Trash -o -name .git \) -prune -o -type d -iname "second brain" -print 2>/dev/null
    ICLOUD="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents"
    [ -d "$ICLOUD" ] && find "$ICLOUD" -maxdepth 2 -type d -iname "second brain" -print 2>/dev/null
  } | sort -u )"

  i=0
  if [ -n "$CANDIDATES" ]; then
    printf "\n"
    while IFS= read -r c; do
      i=$((i + 1))
      tag=""; [ -d "$c/.obsidian" ] && tag=" ${G}(Obsidian vault)${N}"
      printf "    ${B}%d)${N} %s%s\n" "$i" "$c" "$tag"
    done <<EOF
$CANDIDATES
EOF
    printf "\n"
  else
    warn "No folder named \"second brain\" found automatically."
    info "Tip: in Obsidian, right-click the vault name (bottom-left) → \"Reveal in Finder\", then drag that folder into this window."
  fi

  while [ -z "$VAULT" ]; do
    choice=""
    if [ "$i" -gt 0 ]; then
      read -r -p "  Type the number of your vault, or paste its full path: " choice </dev/tty || exit 1
    else
      read -r -p "  Paste (or drag in) the full path of your vault: " choice </dev/tty || exit 1
    fi
    choice="$(printf '%s' "$choice" | sed -e "s/^[[:space:]]*//" -e "s/[[:space:]]*$//" -e "s/^'\(.*\)'$/\1/" -e 's/\\ / /g')"
    if printf '%s' "$choice" | grep -Eq '^[0-9]+$' && [ "$i" -gt 0 ] && [ "$choice" -ge 1 ] && [ "$choice" -le "$i" ]; then
      choice="$(printf '%s\n' "$CANDIDATES" | sed -n "${choice}p")"
    fi
    case "$choice" in "~/"*) choice="$HOME/${choice#\~/}" ;; esac
    if [ -z "$choice" ] || [ ! -d "$choice" ]; then warn "That folder doesn't exist. Try again."; continue; fi
    case "$choice" in /*) ;; *) warn "Please give the full path (starting with /)."; continue ;; esac
    if printf '%s' "$choice" | grep -q '"'; then warn "Paths containing quote marks aren't supported."; continue; fi
    [ -d "$choice/.obsidian" ] || warn "No .obsidian folder inside — make sure this is your vault's top folder."
    if ask_yn "Use \"$choice\" as your vault?" "n"; then VAULT="$choice"; fi
  done
fi
VAULT="$(cd "$VAULT" && pwd -P)"
ok "Vault: $VAULT"

# ---------------------------------------------------------------------------
step "3/8  Vault folders (only creating what's missing)"
for d in raw raw/transcripts wiki wiki/lectures outputs outputs/briefs outputs/research outputs/reviews; do
  if [ -d "$VAULT/$d" ]; then
    info "exists: $d/"
  else
    mkdir -p "$VAULT/$d" && ok "created: $d/"
  fi
done

# ---------------------------------------------------------------------------
step "4/8  Filing rules in the vault's CLAUDE.md"
ADD="$ROOT/vault-template/CLAUDE.md.additions"
TARGET="$VAULT/CLAUDE.md"
if [ -f "$TARGET" ] && grep -q "agentic-os:filing-rules" "$TARGET"; then
  ok "CLAUDE.md already has the Agentic OS filing rules — leaving it unchanged."
else
  if [ -f "$TARGET" ]; then
    info "Your vault already has a CLAUDE.md. Nothing in it will be changed or removed."
    info "I can ADD this section at the very end (a backup copy is kept in agentic-os/backups/):"
  else
    info "Your vault has no CLAUDE.md yet. I can create one with these filing rules:"
  fi
  printf "${D}"; sed -n '1,14p' "$ADD" | sed 's/^/      | /'; printf "      | …${N}\n"
  if ask_yn "Add the filing rules?" "y"; then
    if [ -f "$TARGET" ]; then
      mkdir -p "$ROOT/backups"
      BK="$ROOT/backups/vault-CLAUDE.md.$(date +%Y%m%d-%H%M%S).bak"
      cp -p "$TARGET" "$BK"
      SIZE="$(wc -c <"$TARGET" | tr -d ' ')"
      cat "$ADD" >>"$TARGET"
      if cmp -s -n "$SIZE" "$BK" "$TARGET"; then
        ok "Added to the end of CLAUDE.md (your original text is unchanged; backup: backups/$(basename "$BK"))"
      else
        cp -p "$BK" "$TARGET"
        fail "Something went wrong while appending; your original CLAUDE.md was restored." "Run ./install.sh again, or answer 'n' to skip this step."
      fi
    else
      { printf "# Vault instructions\n"; cat "$ADD"; } >"$TARGET"
      ok "Created CLAUDE.md with the filing rules"
    fi
  else
    warn "Skipped. Skills still work; Claude just won't see the filing rules file."
  fi
fi

# ---------------------------------------------------------------------------
step "5/8  Installing packages and building the dashboard (1–3 minutes)"
info "This downloads the exact versions listed in package-lock.json into this folder only."
if ! npm ci --no-audit --no-fund --progress=false --loglevel=error; then
  fail "Installing the server packages failed." \
    "Most often the database library needs Apple's tools:  xcode-select --install" \
    "Also check your internet connection."
fi
ok "Server packages installed"
if ! npm ci --prefix web --no-audit --no-fund --progress=false --loglevel=error; then
  fail "Installing the dashboard packages failed." "Check your internet connection and try again."
fi
ok "Dashboard packages installed"
if ! npm run build --silent >/dev/null; then
  fail "Building the dashboard failed." "Run:  npm run build   to see the error."
fi
ok "Dashboard built"

# ---------------------------------------------------------------------------
step "6/8  Settings (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
fi
chmod 600 .env
if [ "$(node scripts/get-env.js LOCAL_TOKEN)" = "empty" ]; then
  node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' | node scripts/set-env.js LOCAL_TOKEN
  ok "Generated a new random local token"
else
  ok "Local token already set (kept)"
fi
printf '%s' "$VAULT" | node scripts/set-env.js VAULT_PATH
ok "Vault path saved"
[ "$(node scripts/get-env.js PORT --value)" = "" ] && printf '4777' | node scripts/set-env.js PORT

if [ "$(node scripts/get-env.js OPENAI_API_KEY)" = "empty" ]; then
  info "Optional: an OpenAI API key turns on voice and quick chat. Without it, everything else works."
  info "Get one at https://platform.openai.com/api-keys (OpenAI bills per use). Typing is hidden."
  KEY=""
  read -r -s -p "  Paste your OpenAI API key, or just press Return to skip: " KEY </dev/tty || KEY=""
  printf "\n"
  if [ -n "$KEY" ]; then
    printf '%s' "$KEY" | node scripts/set-env.js OPENAI_API_KEY
    ok "OpenAI key saved to .env (not shown)"
  else
    warn "Skipped — voice and quick chat will show \"not configured\". Add OPENAI_API_KEY to .env later if you want them."
  fi
  KEY=""
else
  ok "OpenAI key already set (kept)"
fi

# ---------------------------------------------------------------------------
step "7/8  Linking skills into ~/.claude/skills"
mkdir -p "$HOME/.claude/skills"
for dir in "$ROOT"/skills/*/; do
  name="$(basename "$dir")"
  src="$ROOT/skills/$name"
  dst="$HOME/.claude/skills/$name"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    ok "$name (already linked)"
  elif [ -e "$dst" ] || [ -L "$dst" ]; then
    warn "$name: ~/.claude/skills/$name already exists and isn't ours — left untouched."
  else
    ln -s "$src" "$dst" && ok "$name"
  fi
done

# ---------------------------------------------------------------------------
step "8/8  Checking connections"
node scripts/verify.js || fail "One of the checks above failed." "Follow the hint next to the ✗ above."

PORT="$(node scripts/get-env.js PORT --value)"
printf "\n${G}${B}All set.${N}\n\n"
printf "  To start Agentic OS, run:\n\n"
printf "      ${B}cd \"%s\" && npm start${N}\n\n" "$ROOT"
printf "  Then open ${B}http://127.0.0.1:%s${N} in your browser.\n" "${PORT:-4777}"
printf "  To stop it: press Control + C in that Terminal window.\n\n"

#!/usr/bin/env bash
# Agentic OS — one-time setup on your own server (Ubuntu 24.04, e.g. kiaan-cloud).
# Private by design: the app listens on 127.0.0.1 only and Tailscale Serve publishes it over HTTPS
# to YOUR tailnet devices. Nothing is opened to the public internet; your firewall is not changed.
#
# Run as root, in an interactive terminal (it asks questions):
#   bash setup-server.sh
#
# Safe to run again: every step checks what's already done and only adds what's missing.
# It does NOT touch your other services (dashboard, MCP server, Caddy, hermes, …).

set -euo pipefail
cd /

# ----------------------------------------------------------------- settings
APP_REPO="${APP_REPO:-kiaan990/kiaan99}"                      # GitHub repo holding the code
APP_BRANCH="${APP_BRANCH:-claude/vigilant-clarke-epb050}"      # branch with agentic-os/
APP_SUBDIR="${APP_SUBDIR:-agentic-os}"
SVC_USER="agentic"
SVC_HOME="/home/$SVC_USER"
SRC="/opt/agentic-os-src"
APP="$SRC/$APP_SUBDIR"
VAULT="$SVC_HOME/vault"
NODE_VERSION="v22.22.0"
NODE_DIR="/opt/agentic-node"
SERVE_PORT="8443"                                              # HTTPS port on your tailnet
GITHUB_ED25519="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

# ----------------------------------------------------------------- helpers
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; D=""; N=""; fi
step() { printf "\n${B}%s${N}\n" "$1"; }
ok()   { printf "  ${G}✓${N} %s\n" "$1"; }
warn() { printf "  ${Y}!${N} %s\n" "$1"; }
info() { printf "  ${D}%s${N}\n" "$1"; }
die()  { printf "\n  ${R}✗ %s${N}\n" "$1"; shift; for l in "$@"; do printf "    %s\n" "$l"; done; printf "\n  Fix that, then run this script again.\n\n"; exit 1; }
ask_yn() { local hint="[y/N]"; [ "$2" = y ] && hint="[Y/n]"; local a=""; read -r -p "  $1 $hint " a </dev/tty || a=""; a="$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')"; [ -z "$a" ] && a="$2"; [ "$a" = y ] || [ "$a" = yes ]; }
pause() { read -r -p "  $1 (press Return to continue) " _ </dev/tty || true; }
# Run a command as the service user, with its own HOME and the pinned Node on PATH.
as() { runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" PATH="$NODE_DIR/bin:$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" GIT_TERMINAL_PROMPT=0 "$@"; }
setenv() { printf '%s' "$2" | as "$NODE_DIR/bin/node" "$APP/scripts/set-env.js" "$1"; }
getenv() { as "$NODE_DIR/bin/node" "$APP/scripts/get-env.js" "$1" ${2:-}; }

printf "\n${B}Agentic OS — server setup${N}\n"
info "This sets up a private Agentic OS on this server, reachable only from your Tailscale devices."

# ----------------------------------------------------------------- 1. checks
step "1/11  Checking this server"
[ "$(id -u)" -eq 0 ] || die "Please run as root." "Type:  sudo -i   then run the script again."
[ -t 0 ] || die "This script asks questions; run it in an interactive terminal." "From your Mac:  ssh -t root@<server-ip> 'bash /root/setup-server.sh'"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "Written for Ubuntu; you have ${PRETTY_NAME:-unknown}. Continuing."
ok "${PRETTY_NAME:-Linux}"
MEM_MB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
if [ "$MEM_MB" -lt 1800 ]; then
  warn "This server has ${MEM_MB} MB of memory. Claude Code runs need more room alongside your other services."
  info "Resize first: DigitalOcean → your droplet → Resize → choose 2 GB (CPU and RAM only) → Resize."
  ask_yn "Continue anyway?" n || exit 1
else
  ok "Memory: ${MEM_MB} MB"
fi
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64) NODE_ARCH=arm64 ;; *) die "Unsupported CPU: $(uname -m)" ;; esac

# ----------------------------------------------------------------- 2. packages + Node
step "2/11  System packages and Node.js $NODE_VERSION"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates xz-utils build-essential python3 openssh-client >/dev/null
ok "git, curl, build tools"
if [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" -v)" = "$NODE_VERSION" ]; then
  ok "Node.js $NODE_VERSION already installed in $NODE_DIR"
else
  TMP="$(mktemp -d)"
  TARBALL="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$TMP/$TARBALL"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c --quiet) || die "Node.js download failed its checksum." "Run the script again."
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP"
  ok "Node.js $NODE_VERSION installed in $NODE_DIR (separate from any other Node on this server)"
fi

# ----------------------------------------------------------------- 3. service user
step "3/11  A dedicated, unprivileged user: $SVC_USER"
if id "$SVC_USER" >/dev/null 2>&1; then ok "User $SVC_USER exists"; else useradd --create-home --shell /bin/bash "$SVC_USER"; ok "Created user $SVC_USER (no sudo, no password login)"; fi
chmod 750 "$SVC_HOME"

# ----------------------------------------------------------------- 4. GitHub deploy keys
step "4/11  GitHub access keys (one read-only for the code, one for the vault)"
as mkdir -p "$SVC_HOME/.ssh"; chmod 700 "$SVC_HOME/.ssh"
for k in app vault; do
  [ -f "$SVC_HOME/.ssh/id_$k" ] || as ssh-keygen -q -t ed25519 -N "" -C "kiaan-cloud agentic-os $k" -f "$SVC_HOME/.ssh/id_$k"
done
cat > "$SVC_HOME/.ssh/config" <<EOF
Host github-app
  HostName github.com
  User git
  IdentityFile $SVC_HOME/.ssh/id_app
  IdentitiesOnly yes
  StrictHostKeyChecking yes
Host github-vault
  HostName github.com
  User git
  IdentityFile $SVC_HOME/.ssh/id_vault
  IdentitiesOnly yes
  StrictHostKeyChecking yes
EOF
# Pinned GitHub host key (from docs.github.com), so we never trust an impostor on first connect.
printf '%s\n' "$GITHUB_ED25519" > "$SVC_HOME/.ssh/known_hosts"
chown -R "$SVC_USER:$SVC_USER" "$SVC_HOME/.ssh"; chmod 600 "$SVC_HOME/.ssh/config" "$SVC_HOME/.ssh/known_hosts"

if ! as git ls-remote "git@github-app:$APP_REPO.git" >/dev/null 2>&1; then
  printf "\n  ${B}A) Code key — read-only${N}\n"
  info "GitHub → $APP_REPO → Settings → Deploy keys → Add deploy key"
  info "Title: kiaan-cloud agentic-os   ·   leave \"Allow write access\" OFF   ·   paste this key:"
  printf "\n    %s\n\n" "$(cat "$SVC_HOME/.ssh/id_app.pub")"
  until as git ls-remote "git@github-app:$APP_REPO.git" >/dev/null 2>&1; do pause "Add the key on GitHub, then"; done
fi
ok "Code repo reachable ($APP_REPO)"

VAULT_REPO="$( [ -d "$VAULT/.git" ] && as git -C "$VAULT" remote get-url origin 2>/dev/null | sed -E 's#^git@github-vault:##; s#\.git$##' || true )"
if [ -z "$VAULT_REPO" ]; then
  info "Your Obsidian vault needs to be in a PRIVATE GitHub repo (see the README: \"Put your vault on GitHub\")."
  read -r -p "  Vault repo (owner/name, e.g. kiaan990/second-brain): " VAULT_REPO </dev/tty
fi
if ! as git ls-remote "git@github-vault:$VAULT_REPO.git" >/dev/null 2>&1; then
  printf "\n  ${B}B) Vault key — read AND write${N}\n"
  info "GitHub → $VAULT_REPO → Settings → Deploy keys → Add deploy key"
  info "Title: kiaan-cloud agentic-os   ·   turn ON \"Allow write access\"   ·   paste this key:"
  printf "\n    %s\n\n" "$(cat "$SVC_HOME/.ssh/id_vault.pub")"
  until as git ls-remote "git@github-vault:$VAULT_REPO.git" >/dev/null 2>&1; do pause "Add the key on GitHub, then"; done
fi
ok "Vault repo reachable ($VAULT_REPO)"

# ----------------------------------------------------------------- 5. code
step "5/11  Getting the Agentic OS code"
if [ -d "$SRC/.git" ]; then
  as git -C "$SRC" fetch --quiet origin "$APP_BRANCH"
  as git -C "$SRC" checkout --quiet "$APP_BRANCH"
  as git -C "$SRC" pull --quiet --ff-only origin "$APP_BRANCH"
  ok "Code updated"
else
  mkdir -p "$SRC"; chown "$SVC_USER:$SVC_USER" "$SRC"
  as git clone --quiet --branch "$APP_BRANCH" --single-branch "git@github-app:$APP_REPO.git" "$SRC"
  ok "Code downloaded to $SRC"
fi
[ -f "$APP/package.json" ] || die "No $APP_SUBDIR/ folder on branch $APP_BRANCH." "Make sure the agentic-os code has been pushed to that branch."
as mkdir -p "$APP/data" "$APP/logs"

# ----------------------------------------------------------------- 6. vault
step "6/11  Your vault (a Git copy, kept in sync with your Mac)"
if [ -d "$VAULT/.git" ]; then
  as git -C "$VAULT" pull --quiet --rebase --autostash || warn "Couldn't pull the vault right now; continuing."
  ok "Vault present at $VAULT"
else
  as git clone --quiet "git@github-vault:$VAULT_REPO.git" "$VAULT"
  ok "Vault cloned to $VAULT"
fi
CHANGED=""
for d in raw raw/transcripts wiki wiki/lectures outputs outputs/briefs outputs/research outputs/reviews; do
  if [ ! -d "$VAULT/$d" ]; then
    as mkdir -p "$VAULT/$d"; as touch "$VAULT/$d/.gitkeep"; CHANGED=1; ok "created: $d/"
  fi
done
ADD="$APP/vault-template/CLAUDE.md.additions"
TARGET="$VAULT/CLAUDE.md"
if [ -f "$TARGET" ] && grep -q "agentic-os:filing-rules" "$TARGET"; then
  ok "Vault CLAUDE.md already has the filing rules — unchanged."
else
  if [ -f "$TARGET" ]; then info "Your vault has a CLAUDE.md. Nothing in it changes; I can ADD the filing-rules section at the end."; else info "Your vault has no CLAUDE.md; I can create one with the filing rules."; fi
  if ask_yn "Add the filing rules to the vault's CLAUDE.md?" y; then
    if [ -f "$TARGET" ]; then
      SIZE="$(wc -c <"$TARGET" | tr -d ' ')"; as cp -p "$TARGET" "$APP/data/vault-CLAUDE.md.bak"
      as bash -c "cat '$ADD' >> '$TARGET'"
      cmp -s -n "$SIZE" "$APP/data/vault-CLAUDE.md.bak" "$TARGET" || { as cp -p "$APP/data/vault-CLAUDE.md.bak" "$TARGET"; die "Appending to CLAUDE.md went wrong; original restored."; }
    else
      as bash -c "{ printf '# Vault instructions\n'; cat '$ADD'; } > '$TARGET'"
    fi
    as git -C "$VAULT" add -- CLAUDE.md; CHANGED=1; ok "Filing rules added (your original text is untouched)"
  fi
fi
if [ -n "$CHANGED" ]; then
  as git -C "$VAULT" add -- raw wiki outputs
  as git -C "$VAULT" -c user.name="Agentic OS" -c user.email="agentic-os@localhost" commit --quiet -m "agentic-os: add vault folders and filing rules" || true
  as git -C "$VAULT" push --quiet && ok "Pushed to $VAULT_REPO (your Mac gets it on the next Obsidian Git pull)"
fi

# ----------------------------------------------------------------- 7. install + build
step "7/11  Installing packages and building the dashboard (a few minutes)"
as npm --prefix "$APP" ci --no-audit --no-fund --progress=false --loglevel=error
as npm --prefix "$APP/web" ci --no-audit --no-fund --progress=false --loglevel=error
as npm --prefix "$APP" run build --silent >/dev/null
ok "Installed and built"

# ----------------------------------------------------------------- 8. Claude Code
step "8/11  Claude Code (uses your Claude subscription — no API key)"
if [ ! -x "$SVC_HOME/.local/bin/claude" ]; then
  as bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
fi
ok "Claude Code $(as "$SVC_HOME/.local/bin/claude" --version 2>/dev/null | head -n1)"

[ -f "$APP/.env" ] || { as cp "$APP/.env.example" "$APP/.env"; }
chmod 600 "$APP/.env"
if [ "$(getenv CLAUDE_CODE_OAUTH_TOKEN)" = "empty" ]; then
  info "Next, Claude Code shows a link. Open it on your Mac, approve, and paste the code back here."
  info "It then prints a long token starting with sk-ant-oat… — copy it."
  pause "Ready?"
  as "$SVC_HOME/.local/bin/claude" setup-token </dev/tty || true
  TOKEN=""
  until [ -n "$TOKEN" ]; do read -r -s -p "  Paste the token here (hidden): " TOKEN </dev/tty; printf "\n"; done
  setenv CLAUDE_CODE_OAUTH_TOKEN "$TOKEN"; TOKEN=""
  ok "Claude login token saved to .env (not shown)"
else
  ok "Claude login token already set (kept)"
fi

# ----------------------------------------------------------------- 9. settings
step "9/11  Settings (.env)"
[ "$(getenv LOCAL_TOKEN)" = "empty" ] && { setenv LOCAL_TOKEN "$("$NODE_DIR/bin/node" -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"; ok "Generated a local token"; }
setenv VAULT_PATH "$VAULT"
setenv VAULT_GIT_SYNC "true"
setenv CLAUDE_BIN "$SVC_HOME/.local/bin/claude"
PORT="$(getenv PORT --value)"; PORT="${PORT:-4777}"
if ss -ltnH "( sport = :$PORT )" | grep -q . && ! systemctl is-active --quiet agentic-os; then
  for p in 4778 4779 4780 4781 4782; do ss -ltnH "( sport = :$p )" | grep -q . || { PORT=$p; break; }; done
  warn "Port in use by another service; using $PORT"
fi
setenv PORT "$PORT"
if [ "$(getenv OPENAI_API_KEY)" = "empty" ]; then
  info "Optional: an OpenAI API key turns on voice and quick chat (billed per use by OpenAI). Return to skip."
  KEY=""; read -r -s -p "  OpenAI API key (hidden): " KEY </dev/tty || true; printf "\n"
  if [ -n "$KEY" ]; then setenv OPENAI_API_KEY "$KEY"; ok "OpenAI key saved"; else warn "Skipped — voice and quick chat will show \"not configured\"."; fi
  KEY=""
fi
if [ "$(getenv TAILSCALE_ALLOWED_USERS)" = "empty" ]; then
  EMAIL=""
  until printf '%s' "$EMAIL" | grep -Eq '^[^@ ]+@[^@ ]+$'; do read -r -p "  Your Tailscale login (the email/account you sign in to Tailscale with): " EMAIL </dev/tty; done
  setenv TAILSCALE_ALLOWED_USERS "$EMAIL"
fi
ok "Allowed Tailscale user(s): $(getenv TAILSCALE_ALLOWED_USERS --value 2>/dev/null || echo set)"

# ----------------------------------------------------------------- 10. Tailscale
step "10/11  Tailscale (private HTTPS access from your devices)"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
  ok "Tailscale installed"
fi
if ! tailscale status >/dev/null 2>&1; then
  info "Tailscale will show a login link — open it on your Mac and sign in with the SAME account you entered above."
  tailscale up
fi
DNSNAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
if [ -z "$DNSNAME" ] || [ "$DNSNAME" = "None" ]; then
  die "This server has no Tailscale DNS name yet." \
    "In the Tailscale admin console → DNS (https://login.tailscale.com/admin/dns):" \
    "  1. turn ON MagicDNS   2. turn ON HTTPS Certificates"
fi
ORIGIN="https://$DNSNAME:$SERVE_PORT"
setenv PUBLIC_ORIGIN "$ORIGIN"
tailscale serve --bg --https="$SERVE_PORT" "http://127.0.0.1:$PORT" >/dev/null \
  || die "Tailscale Serve failed." "Make sure HTTPS Certificates are enabled at https://login.tailscale.com/admin/dns"
ok "Published privately at $ORIGIN (tailnet only — not the public internet)"

# ----------------------------------------------------------------- 11. service
step "11/11  Running Agentic OS as a background service"
as mkdir -p "$SVC_HOME/.claude/skills"
for dir in "$APP"/skills/*/; do
  name="$(basename "$dir")"; dst="$SVC_HOME/.claude/skills/$name"
  [ -e "$dst" ] || [ -L "$dst" ] || as ln -s "$APP/skills/$name" "$dst"
done
sed -e "s#@USER@#$SVC_USER#g" -e "s#@HOME@#$SVC_HOME#g" -e "s#@APP@#$APP#g" -e "s#@NODE_DIR@#$NODE_DIR#g" \
  "$APP/deploy/agentic-os.service" > /etc/systemd/system/agentic-os.service
systemctl daemon-reload
systemctl enable --quiet agentic-os
systemctl restart agentic-os
sleep 3
systemctl is-active --quiet agentic-os || die "The service didn't start." "See why:  journalctl -u agentic-os -n 50 --no-pager"
ok "Service running (starts automatically after reboots)"
as bash -c "cd '$APP' && node scripts/verify.js" || warn "Some checks above need attention."
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
[ "$CODE" = 403 ] && ok "Identity check active (direct access without Tailscale is refused)" || warn "Unexpected response from the app: HTTP $CODE"

printf "\n${G}${B}Done.${N}\n\n"
printf "  On your Mac (and iPhone): install Tailscale, sign in with the same account, then open:\n\n"
printf "      ${B}%s${N}\n\n" "$ORIGIN"
printf "  Useful commands on this server:\n"
printf "    status:   systemctl status agentic-os\n"
printf "    logs:     journalctl -u agentic-os -f\n"
printf "    update:   bash %s/deploy/update.sh\n\n" "$APP"

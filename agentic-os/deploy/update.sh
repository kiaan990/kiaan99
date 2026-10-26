#!/usr/bin/env bash
# Update Agentic OS on your server to the latest code on its branch, rebuild, restart.
# Run as root:  bash /opt/agentic-os-src/agentic-os/deploy/update.sh
set -euo pipefail
cd /
SVC_USER=agentic; SVC_HOME=/home/agentic; SRC=/opt/agentic-os-src; APP="$SRC/agentic-os"; NODE_DIR=/opt/agentic-node
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i)."; exit 1; }
as() { runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" PATH="$NODE_DIR/bin:$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" GIT_TERMINAL_PROMPT=0 "$@"; }

echo "Pulling the latest code…"
as git -C "$SRC" pull --ff-only --quiet
echo "Installing packages and building…"
as npm --prefix "$APP" ci --no-audit --no-fund --progress=false --loglevel=error
as npm --prefix "$APP/web" ci --no-audit --no-fund --progress=false --loglevel=error
as npm --prefix "$APP" run build --silent >/dev/null
# Refresh the service file in case it changed.
sed -e "s#@USER@#$SVC_USER#g" -e "s#@HOME@#$SVC_HOME#g" -e "s#@APP@#$APP#g" -e "s#@NODE_DIR@#$NODE_DIR#g" \
  "$APP/deploy/agentic-os.service" > /etc/systemd/system/agentic-os.service
systemctl daemon-reload
systemctl restart agentic-os
sleep 3
systemctl is-active --quiet agentic-os && echo "✓ Updated and running." || { echo "✗ Didn't start. See: journalctl -u agentic-os -n 50 --no-pager"; exit 1; }

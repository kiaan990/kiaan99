#!/usr/bin/env bash
# One-time Mac setup. From the repo root:  brightspace-session/install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Projects/brightspace-session"
mkdir -p "$DEST" "$HOME/.brightspace" && chmod 700 "$HOME/.brightspace"
[ "$SRC" != "$DEST" ] && cp "$SRC"/{capture.py,refresh.py,common.py,requirements.txt,README.md,com.kiaan.brightspace-refresh.plist} "$DEST/"
cd "$DEST"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python -m playwright install chromium
PLIST="$HOME/Library/LaunchAgents/com.kiaan.brightspace-refresh.plist"
sed "s#__HOME__#$HOME#g" com.kiaan.brightspace-refresh.plist > "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
if [ -f "$HOME/.brightspace/state.json" ]; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "launchd job loaded"
else
  echo "Run capture.py first, then re-run install.sh to load the launchd job:"
  echo "  $DEST/.venv/bin/python $DEST/capture.py"
fi

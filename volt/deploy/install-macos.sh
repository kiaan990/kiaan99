#!/usr/bin/env bash
# Install Volt as a per-user launchd agent on macOS: starts at login, restarts if it crashes.
# Uninstall: launchctl bootout gui/$(id -u)/com.volt.scheduler; rm ~/Library/LaunchAgents/com.volt.scheduler.plist
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$PWD"; UV="$(command -v uv)"; mkdir -p logs
DEST="$HOME/Library/LaunchAgents/com.volt.scheduler.plist"
sed -e "s|__DIR__|$DIR|g" -e "s|__UV__|$UV|g" -e "s|__PATH__|$(dirname "$UV"):/usr/bin:/bin:/usr/sbin:/sbin|g" \
    deploy/com.volt.scheduler.plist > "$DEST"
launchctl bootout "gui/$(id -u)/com.volt.scheduler" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Volt installed. Watch it start: tail -f $DIR/logs/volt.log"

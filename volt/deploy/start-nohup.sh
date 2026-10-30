#!/usr/bin/env bash
# Start the Volt scheduler in the background without systemd.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
if [[ -f logs/volt.pid ]] && kill -0 "$(cat logs/volt.pid)" 2>/dev/null; then
  echo "volt already running (pid $(cat logs/volt.pid))"; exit 0
fi
umask 077
nohup uv run --frozen volt run >> logs/nohup.out 2>&1 &
echo $! > logs/volt.pid
echo "started volt (pid $!); follow with: tail -f logs/volt.log"

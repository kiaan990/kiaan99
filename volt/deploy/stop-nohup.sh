#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f logs/volt.pid ]] && kill -0 "$(cat logs/volt.pid)" 2>/dev/null; then
  kill "$(cat logs/volt.pid)" && rm -f logs/volt.pid && echo "stopped"
else
  echo "not running"; rm -f logs/volt.pid
fi

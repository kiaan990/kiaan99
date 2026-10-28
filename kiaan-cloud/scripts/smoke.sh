#!/usr/bin/env bash
# Calls brightspace_status and brightspace_upcoming through the LIVE kiaan-mcp server.
# Run on the droplet:  /opt/kiaan-cloud/scripts/smoke.sh
# Env: KIAAN_MCP_URL (default http://127.0.0.1:8000/mcp), KIAAN_MCP_TOKEN (optional bearer).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/brightspace.env" ] && set -a && . "$ROOT/brightspace.env" && set +a
PY="${KIAAN_PY:-$ROOT/.venv/bin/python}"
exec "$PY" "$ROOT/scripts/smoke.py" "$@"

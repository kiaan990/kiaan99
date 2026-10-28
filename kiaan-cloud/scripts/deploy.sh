#!/usr/bin/env bash
# Deploy the brightspace module to kiaan-cloud. Run from the Mac, at the repo root:
#   kiaan-cloud/scripts/deploy.sh
# Copies code (never touches cookies.json / brightspace.db / downloaded files),
# installs httpx if missing, installs + enables the systemd timers, records memory before/after.
set -euo pipefail
HOST="${KIAAN_HOST:-kiaan-cloud}"
ROOT="${KIAAN_ROOT:-/opt/kiaan-cloud}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo "== memory before"; ssh "$HOST" 'free -m | tee /root/.brightspace-mem-before.txt'

PY=$(ssh "$HOST" "systemctl show kiaan-mcp -p ExecStart --value | grep -oE '/[^ ;]*/python[0-9.]*' | head -1")
PY="${KIAAN_PY:-${PY:-$ROOT/.venv/bin/python}}"
echo "== using python $PY"

rsync -a --chmod=D750,F640 \
  --exclude '__pycache__' --exclude 'cookies.json' --exclude '*.db*' --exclude 'session.json' \
  "$SRC/brightspace/" "$HOST:$ROOT/brightspace/"
rsync -a "$SRC/scripts/" "$HOST:$ROOT/scripts/"
rsync -a "$SRC/tests/" "$HOST:$ROOT/tests/brightspace/"
rsync -a "$SRC/docs/" "$HOST:$ROOT/docs/"

ssh "$HOST" bash -s -- "$ROOT" "$PY" <<'REMOTE'
set -euo pipefail
ROOT="$1"; PY="$2"
cd "$ROOT"
chmod 700 brightspace
[ -f brightspace/cookies.json ] && chmod 600 brightspace/cookies.json
"$PY" -c 'import httpx' 2>/dev/null || "$PY" -m pip install -q httpx
if [ ! -f brightspace.env ]; then
  umask 077
  cat > brightspace.env <<ENV
BRIGHTSPACE_HOME=$ROOT/brightspace
BRIGHTSPACE_COURSES=CS 230,CS 240,FI 118,GLS 230,ST 113
ENV
fi
grep -q 'brightspace/cookies.json' .gitignore 2>/dev/null || cat >> .gitignore <<'GI'
# brightspace connector: secrets, cache and downloads stay out of git
brightspace/cookies.json
brightspace/session.json
brightspace/*.db*
brightspace/.sync.lock
brightspace/notifications.jsonl
brightspace/*/
brightspace.env
GI
for u in kiaan-brightspace-sync.service kiaan-brightspace-sync.timer kiaan-brightspace-keepalive.service kiaan-brightspace-keepalive.timer; do
  sed -e "s#@ROOT@#$ROOT#g" -e "s#@PYTHON@#$PY#g" "$ROOT/scripts/systemd/$u" > "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now kiaan-brightspace-sync.timer kiaan-brightspace-keepalive.timer
systemctl list-timers --no-pager | grep -i brightspace
REMOTE
echo "deployed. Next: wire register() into kiaan-mcp (see kiaan-cloud/brightspace/README.md), restart, run smoke.sh"

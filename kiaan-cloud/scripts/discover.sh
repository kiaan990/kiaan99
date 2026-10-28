#!/usr/bin/env bash
# Read-only dump of how kiaan-mcp is laid out, so the brightspace module can be wired
# in the same way as calendar/tasks/briefs/WHOOP. Prints no secrets (env values are masked).
# Usage from the Mac:  ssh kiaan-cloud 'bash -s' < kiaan-cloud/scripts/discover.sh > discover.txt
set -u
echo "== free -m"; free -m
echo "== service"; systemctl cat kiaan-mcp kiaan-dashboard 2>/dev/null | sed -E 's/(=[^ ]*(TOKEN|KEY|SECRET|PASS)[^=]*=).*/\1***masked***/I'
echo "== tree"; cd /opt/kiaan-cloud && find . -maxdepth 3 -not -path '*/.venv*' -not -path '*/node_modules*' -not -path '*/.git/*' -not -path '*/__pycache__*' | sort | head -200
echo "== git"; git -C /opt/kiaan-cloud log --oneline -5 2>&1; git -C /opt/kiaan-cloud status --short 2>&1 | head -20
echo "== tool registration"; grep -rnE "FastMCP\(|register\(|@mcp\.tool|mcp\.tool\(|import .*(calendar|tasks|briefs|whoop)" --include=*.py /opt/kiaan-cloud 2>/dev/null | grep -v '/.venv/' | head -60
echo "== activity log writer"; grep -rnE "def (activity|note|log_activity|activity_note)" --include=*.py /opt/kiaan-cloud | grep -v '/.venv/' | head
echo "== dashboard"; grep -rnliE "whoop|services|activity" --include=*.py --include=*.html /opt/kiaan-cloud 2>/dev/null | grep -iv venv | grep -i dash | head
echo "== python"; ls -la /opt/kiaan-cloud/.venv/bin/python* 2>/dev/null; systemctl show kiaan-mcp -p ExecStart
echo "== old brightspace job"; grep -rli brightspace /opt /etc/cron* /etc/systemd /var/spool/cron 2>/dev/null | grep -v '/.venv/' | grep -v '/opt/kiaan-cloud/brightspace/'; crontab -l 2>/dev/null | grep -i -n bright; systemctl list-timers --all --no-pager | grep -i -E "bright|d2l|scrape"
echo "== listening"; ss -ltnp | grep -E "python|uvicorn|caddy"

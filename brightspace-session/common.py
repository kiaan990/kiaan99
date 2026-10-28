"""Shared bits for capture.py / refresh.py. Cookie values are never printed or logged."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

HOST = os.environ.get("BRIGHTSPACE_HOST", "bentley.brightspace.com")
STATE_DIR = Path.home() / ".brightspace"
STATE = STATE_DIR / "state.json"
LOG = STATE_DIR / "refresh.log"
STATUS = STATE_DIR / "last_refresh.json"

SSH_HOST = os.environ.get("KIAAN_SSH", "kiaan-cloud")
REMOTE_ROOT = os.environ.get("KIAAN_ROOT", "/opt/kiaan-cloud")
REMOTE_PY = os.environ.get("KIAAN_PY", f"{REMOTE_ROOT}/.venv/bin/python")
REMOTE_COOKIES = f"{REMOTE_ROOT}/brightspace/cookies.json"
WHOAMI = "/d2l/api/lp/1.64/users/whoami"


def ensure_dir() -> None:
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)


def log(msg: str) -> None:
    ensure_dir()
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def save_state(ctx) -> None:
    ensure_dir()
    ctx.storage_state(path=str(STATE))
    os.chmod(STATE, 0o600)


def on_home(url: str, host: str) -> bool:
    u = urlparse(url)
    return u.hostname == host and u.path.startswith("/d2l/") and "/d2l/login" not in u.path


def whoami_ok(ctx, host: str) -> dict | None:
    r = ctx.request.get(f"https://{host}{WHOAMI}", max_redirects=0)
    if r.status != 200:
        return None
    try:
        return r.json()
    except Exception:
        return None


def extract(ctx, host: str, user_agent: str) -> dict:
    """All cookies valid for the Brightspace host (includes d2lSessionVal / d2lSecureSessionVal)."""
    cookies = {}
    for c in ctx.cookies(f"https://{host}/d2l/home"):
        cookies[c["name"]] = c["value"]
    missing = {"d2lSessionVal", "d2lSecureSessionVal"} - cookies.keys()
    if missing:
        raise RuntimeError(f"missing cookies: {', '.join(sorted(missing))}")
    return {
        "host": host,
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "user_agent": user_agent.replace("HeadlessChrome", "Chrome"),
        "cookies": cookies,
    }


def push(payload: dict) -> None:
    """Write cookies.json on the droplet atomically, root-only (0600)."""
    d = os.path.dirname(REMOTE_COOKIES)
    cmd = (f"umask 077 && mkdir -p {d} && cat > {REMOTE_COOKIES}.tmp && "
           f"chmod 600 {REMOTE_COOKIES}.tmp && mv -f {REMOTE_COOKIES}.tmp {REMOTE_COOKIES}")
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST, cmd],
                       input=json.dumps(payload).encode(), capture_output=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"ssh push failed (exit {r.returncode}): {r.stderr.decode()[-300:]}")
    log(f"pushed {len(payload['cookies'])} cookies to {SSH_HOST}:{REMOTE_COOKIES}")


def remote(cmd: str, timeout: int = 60) -> tuple[int, str]:
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", SSH_HOST,
                        f"cd {REMOTE_ROOT} && {cmd}"], capture_output=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr).decode().strip()


def remote_ping() -> bool:
    code, out = remote(f"{REMOTE_PY} -m brightspace.client ping")
    log(f"droplet check: {out.splitlines()[-1] if out else code}")
    return code == 0


def notify(message: str) -> None:
    """Mac notification + kiaan-cloud activity feed. Best effort."""
    log(f"NOTIFY {message}")
    try:
        subprocess.run(["osascript", "-e", f'display notification {json.dumps(message)} with title "Brightspace"'],
                       timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        remote(f"{REMOTE_PY} -m brightspace.notify warn {json.dumps(message)}", timeout=30)
    except (OSError, subprocess.SubprocessError):
        pass


def write_status(ok: bool, detail: str) -> None:
    ensure_dir()
    STATUS.write_text(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), "ok": ok, "detail": detail}))


def die(msg: str, code: int = 2):
    write_status(False, msg)
    notify(msg)
    sys.exit(code)

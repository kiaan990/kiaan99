"""Surface Brightspace events on the kiaan-cloud activity feed (dashboard).

`ACTIVITY_HOOK` is wired at deploy time to the same function the existing
`activity_note` MCP tool uses. If it can't be imported we still log to
journald and append to notifications.jsonl, so nothing is silently lost.

CLI (used by refresh.py on the Mac over ssh):
    python -m brightspace.notify warn "Brightspace session expired"
"""
from __future__ import annotations

import importlib
import json
import logging
import os
import sys

from . import config
from .store import now_iso

log = logging.getLogger("brightspace")

# "module:function" taking (message, source=..., level=...). Set by deploy.
ACTIVITY_HOOK = os.environ.get("BRIGHTSPACE_ACTIVITY_HOOK", "")


def note(message: str, level: str = "info") -> None:
    getattr(log, "warning" if level == "warn" else level, log.info)("%s", message)
    try:
        config.HOME.mkdir(parents=True, exist_ok=True)
        with open(config.NOTIFY_LOG, "a") as f:
            f.write(json.dumps({"ts": now_iso(), "level": level, "msg": message}) + "\n")
    except OSError:
        pass
    if ACTIVITY_HOOK:
        try:
            mod, fn = ACTIVITY_HOOK.split(":")
            func = getattr(importlib.import_module(mod), fn)
            try:
                func(message, source="brightspace", level=level)
            except TypeError:
                func(message, "brightspace")
        except Exception as e:  # never let notification break a sync
            log.warning("activity hook failed: %s", type(e).__name__)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if len(sys.argv) < 3:
        print("usage: python -m brightspace.notify info|warn|error MESSAGE")
        sys.exit(2)
    note(" ".join(sys.argv[2:])[:500], sys.argv[1])

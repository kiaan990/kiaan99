"""One-line Brightspace status for the kiaan-dashboard service.

The dashboard calls `summary()` (dict) or `line()` (str). It never makes a
network call: it only reads session.json and the SQLite cache.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from . import config
from . import store as st
from .client import cookie_age_hours
from .sync import parse_dt


def summary() -> dict:
    out = {"name": "brightspace", "session": "unknown", "last_sync": None, "minutes_since_sync": None,
           "counts": {}, "cookie_age_hours": cookie_age_hours()}
    try:
        s = json.loads(config.SESSION_PATH.read_text())
        out["session"] = "ok" if s.get("alive") else "expired"
    except (OSError, ValueError):
        pass
    if not config.DB_PATH.exists():
        return out
    con = st.connect()
    try:
        last = st.get_meta(con, "last_success")
        out["last_sync"] = last
        if last:
            out["minutes_since_sync"] = int((datetime.now(timezone.utc) - parse_dt(last)).total_seconds() // 60)
        c = st.counts(con)
        out["counts"] = {k: c[k] for k in ("courses", "assignments", "announcements", "content_topics", "calendar_events")}
        out["counts"]["files"] = con.execute("SELECT COUNT(*) FROM content_topics WHERE local_path IS NOT NULL").fetchone()[0]
    finally:
        con.close()
    return out


def line() -> str:
    s = summary()
    if s["last_sync"]:
        ago = s["minutes_since_sync"]
        when = f"{ago}m ago" if ago < 120 else f"{ago // 60}h ago"
    else:
        when = "never"
    c = s["counts"]
    return (f"Brightspace: session {s['session'].upper()} · synced {when} · "
            f"{c.get('courses', 0)} courses, {c.get('assignments', 0)} assignments, "
            f"{c.get('announcements', 0)} announcements, {c.get('files', 0)} files")


if __name__ == "__main__":
    print(line())

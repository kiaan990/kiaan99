"""FastMCP tools for Brightspace. Read-only; output is compact JSON for an LLM.

Registered from the kiaan-mcp server with `brightspace.tools.register(mcp)`.
Every tool reads the SQLite cache; `refresh=True` forces a live pull first.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import anyio

from . import config
from . import store as st
from .client import BrightspaceError, Client, SessionExpired, cookie_age_hours
from .sync import Sync, norm_code, parse_dt, run_sync

MAX_TEXT = 1200


# ---- formatting ----------------------------------------------------------
def compact(obj):
    """Drop None / '' / [] / {} recursively."""
    if isinstance(obj, dict):
        out = {k: compact(v) for k, v in obj.items()}
        return {k: v for k, v in out.items() if v not in (None, "", [], {})}
    if isinstance(obj, list):
        return [x for x in (compact(v) for v in obj) if x not in (None, "", [], {})]
    return obj


def out(obj) -> str:
    return json.dumps(compact(obj), separators=(",", ":"), ensure_ascii=False)


def local(ts: str | None) -> str | None:
    d = parse_dt(ts)
    return d.astimezone(config.TZ).strftime("%a %b %-d %Y %-I:%M %p %Z") if d else None


def clip(s: str | None, n: int = MAX_TEXT) -> str | None:
    if not s:
        return None
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _con():
    return st.connect()


def _course_map(con) -> dict[int, dict]:
    return {r["org_unit_id"]: dict(r) for r in con.execute("SELECT * FROM courses WHERE is_active=1")}


def resolve_course(con, course: str | int) -> dict:
    s = str(course).strip()
    rows = list(_course_map(con).values())
    if s.isdigit():
        for r in rows:
            if r["org_unit_id"] == int(s):
                return r
    for r in rows:
        if r["code_dir"] == norm_code(s):
            return r
    hits = [r for r in rows if s.lower() in (r["name"] or "").lower()]
    if len(hits) == 1:
        return hits[0]
    raise ValueError(f"unknown course '{course}'. Known: " + ", ".join(sorted(r["code"] for r in rows)))


def _live(course: str | None = None, download: bool = False) -> dict:
    return run_sync(download=download, course=course)


def _guard(fn):
    """Turn session/API errors into a readable JSON error instead of a stack trace."""
    try:
        return fn()
    except SessionExpired as e:
        return out({"error": "session_expired", "detail": str(e),
                    "fix": "Run `python3 ~/Projects/brightspace-session/refresh.py` on the Mac (or capture.py if MFA re-prompts)."})
    except (BrightspaceError, ValueError) as e:
        return out({"error": type(e).__name__, "detail": str(e)})


# ---- implementations (sync, called in a worker thread) ---------------------
def status_impl(refresh: bool = False) -> str:
    alive, detail = None, None
    if refresh:
        try:
            with Client() as c:
                c.whoami()
            alive = True
        except SessionExpired as e:
            alive, detail = False, str(e)
    else:
        try:
            s = json.loads(config.SESSION_PATH.read_text())
            alive, detail = s.get("alive"), f"checked {local(s.get('checked_at'))}"
        except (OSError, ValueError):
            detail = "never checked"
    con = _con()
    try:
        last_ok = st.get_meta(con, "last_success")
        last = con.execute("SELECT started_at, ok, error FROM sync_log ORDER BY id DESC LIMIT 1").fetchone()
        mins = None
        if last_ok:
            mins = int((datetime.now(timezone.utc) - parse_dt(last_ok)).total_seconds() // 60)
        files = con.execute("SELECT COUNT(*) FROM content_topics WHERE local_path IS NOT NULL").fetchone()[0]
        return out({
            "session_alive": alive, "session_detail": detail,
            "cookie_age_hours": cookie_age_hours(),
            "last_successful_sync": local(last_ok), "minutes_since_sync": mins,
            "last_attempt": dict(last) if last and not last["ok"] else None,
            "counts": {**st.counts(con), "downloaded_files": files},
            "unavailable_endpoints": st.get_meta(con, "unavailable_endpoints"),
            "host": st.get_meta(con, "host"),
        })
    finally:
        con.close()


def courses_impl(refresh: bool = False) -> str:
    if refresh:
        _live()
    con = _con()
    try:
        rows = con.execute("SELECT * FROM courses WHERE is_active=1 ORDER BY code").fetchall()
        return out([{"code": r["code"], "org_unit_id": r["org_unit_id"], "name": r["name"],
                     "ends": local(r["end_date"])} for r in rows])
    finally:
        con.close()


def upcoming_impl(days: int = 14, refresh: bool = False, _now: datetime | None = None) -> str:
    if refresh:
        _live()
    now = _now or datetime.now(timezone.utc)
    lo = (now - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")
    nowz = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    hi = (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    con = _con()
    try:
        cm = _course_map(con)
        items, seen_entities = [], set()
        for r in con.execute(
                "SELECT *, COALESCE(due_date, end_date) AS d FROM assignments "
                "WHERE is_hidden=0 AND COALESCE(due_date, end_date) BETWEEN ? AND ?", (lo, hi)):
            if r["d"] < nowz and r["submitted"]:
                continue  # only keep the past-48h items that are still unsubmitted
            seen_entities.add(("dropbox", r["folder_id"]))
            items.append({"date": r["d"], "kind": "assignment", "course": cm.get(r["org_unit_id"], {}).get("code"),
                          "title": r["title"], "due": local(r["d"]),
                          "submitted": bool(r["submitted"]) if r["submitted"] is not None else None,
                          "overdue": r["d"] < nowz or None, "points": r["points"]})
        for r in con.execute(
                "SELECT *, COALESCE(due_date, end_date) AS d FROM quizzes "
                "WHERE is_active=1 AND COALESCE(due_date, end_date) BETWEEN ? AND ?", (nowz, hi)):
            seen_entities.add(("quiz", r["quiz_id"]))
            items.append({"date": r["d"], "kind": "quiz", "course": cm.get(r["org_unit_id"], {}).get("code"),
                          "title": r["title"], "due": local(r["d"]), "opens": local(r["start_date"]),
                          "attempts": r["attempts_allowed"]})
        for r in con.execute("SELECT * FROM calendar_events WHERE start BETWEEN ? AND ?", (nowz, hi)):
            et = (r["entity_type"] or "").lower()
            kind = "dropbox" if "dropbox" in et else "quiz" if "quiz" in et else None
            if kind and (kind, r["entity_id"]) in seen_entities:
                continue
            items.append({"date": r["start"], "kind": "quiz" if kind == "quiz" else "event",
                          "course": cm.get(r["org_unit_id"], {}).get("code"), "title": r["title"],
                          "due": local(r["start"]), "all_day": bool(r["all_day"]) or None})
        items.sort(key=lambda x: x["date"])
        for i in items:
            i.pop("date")
        return out({"window_days": days, "count": len(items), "items": items,
                    "as_of": local(st.get_meta(con, "last_success"))})
    finally:
        con.close()


def assignments_impl(course: str, refresh: bool = False) -> str:
    con = _con()
    try:
        c = resolve_course(con, course)
        if refresh:
            con.close()
            _live(c["code"])
            con = _con()
        rows = con.execute("SELECT * FROM assignments WHERE org_unit_id=? AND is_hidden=0 "
                           "ORDER BY COALESCE(due_date, end_date, '9999')", (c["org_unit_id"],)).fetchall()
        return out({"course": c["code"], "assignments": [{
            "id": r["folder_id"], "title": r["title"], "due": local(r["due_date"]),
            "closes": local(r["end_date"]) if r["end_date"] != r["due_date"] else None,
            "points": r["points"], "submitted": bool(r["submitted"]) if r["submitted"] is not None else None,
            "submitted_at": local(r["last_submitted_at"]), "score": r["feedback_score"],
            "instructions": clip(r["instructions"])} for r in rows]})
    finally:
        con.close()


def grades_impl(course: str | None = None, refresh: bool = False) -> str:
    con = _con()
    try:
        target = resolve_course(con, course) if course else None
        if refresh:
            con.close()
            _live(target["code"] if target else None)
            con = _con()
        cm = _course_map(con)
        result = []
        for ou, c in sorted(cm.items(), key=lambda kv: kv[1]["code"]):
            if target and ou != target["org_unit_id"]:
                continue
            rows = con.execute("SELECT * FROM grades WHERE org_unit_id=? ORDER BY is_final DESC, name", (ou,)).fetchall()
            final = next((r for r in rows if r["is_final"]), None)
            items = [{"item": r["name"], "grade": r["displayed"],
                      "points": f"{r['points_num']:g}/{r['points_den']:g}" if r["points_num"] is not None and r["points_den"] else None,
                      "weighted": f"{r['weighted_num']:g}/{r['weighted_den']:g}" if r["weighted_num"] is not None and r["weighted_den"] else None,
                      "comment": clip(r["comments"], 300)} for r in rows if not r["is_final"]]
            result.append({"course": c["code"],
                           "running_total": (final["displayed"] or (f"{final['points_num']:g}/{final['points_den']:g}" if final["points_den"] else None)) if final else None,
                           "items": items})
        return out(result)
    finally:
        con.close()


def announcements_impl(course: str | None = None, days: int = 14, refresh: bool = False) -> str:
    con = _con()
    try:
        target = resolve_course(con, course) if course else None
        if refresh:
            con.close()
            _live(target["code"] if target else None)
            con = _con()
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        cm = _course_map(con)
        q = "SELECT * FROM announcements WHERE COALESCE(start_date, created_date) >= ?"
        args = [since]
        if target:
            q += " AND org_unit_id=?"
            args.append(target["org_unit_id"])
        rows = con.execute(q + " ORDER BY COALESCE(start_date, created_date) DESC", args).fetchall()
        return out([{"course": cm.get(r["org_unit_id"], {}).get("code"), "title": r["title"],
                     "posted": local(r["start_date"] or r["created_date"]), "body": clip(r["body"])}
                    for r in rows if r["org_unit_id"] in cm])
    finally:
        con.close()


def content_impl(course: str, refresh: bool = False) -> str:
    con = _con()
    try:
        c = resolve_course(con, course)
        if refresh:
            con.close()
            _live(c["code"], download=True)
            con = _con()
        mods = {r["module_id"]: dict(r, children=[], topics=[]) for r in con.execute(
            "SELECT * FROM content_modules WHERE org_unit_id=? ORDER BY sort_order", (c["org_unit_id"],))}
        for t in con.execute("SELECT * FROM content_topics WHERE org_unit_id=? ORDER BY sort_order", (c["org_unit_id"],)):
            if t["module_id"] in mods:
                mods[t["module_id"]]["topics"].append({
                    "topic_id": t["topic_id"], "title": t["title"],
                    "type": t["file_ext"] or (t["type"] or "").lower(), "local_path": t["local_path"]})
        roots = []
        for m in mods.values():
            (mods[m["parent_id"]]["children"] if m["parent_id"] in mods else roots).append(m)

        def shape(m):
            return {"module": m["title"], "topics": m["topics"], "modules": [shape(x) for x in m["children"]]}

        return out({"course": c["code"], "files_dir": str(config.HOME / c["code_dir"]),
                    "modules": [shape(m) for m in roots]})
    finally:
        con.close()


def download_impl(course: str, topic_id: int) -> str:
    con = _con()
    try:
        c = resolve_course(con, course)
        row = con.execute("SELECT * FROM content_topics WHERE topic_id=? AND org_unit_id=?",
                          (int(topic_id), c["org_unit_id"])).fetchone()
        if not row:
            return out({"error": "unknown_topic", "detail": f"topic {topic_id} not in {c['code']} cache; try brightspace_content(refresh=True)"})
        with Client() as client:
            path = Sync(client, con).fetch_file(c, row)
        con.commit()
        r = con.execute("SELECT local_path, local_size FROM content_topics WHERE topic_id=?", (int(topic_id),)).fetchone()
        return out({"course": c["code"], "topic_id": int(topic_id), "title": row["title"],
                    "local_path": path, "bytes": r["local_size"]})
    finally:
        con.close()


def search_impl(query: str, refresh: bool = False) -> str:
    if refresh:
        _live()
    q = f"%{query.strip()}%"
    con = _con()
    try:
        cm = _course_map(con)
        code = lambda ou: cm.get(ou, {}).get("code")
        hits = []
        for r in con.execute("SELECT * FROM assignments WHERE title LIKE ? OR instructions LIKE ? LIMIT 25", (q, q)):
            hits.append({"kind": "assignment", "course": code(r["org_unit_id"]), "title": r["title"],
                         "due": local(r["due_date"]), "id": r["folder_id"]})
        for r in con.execute("SELECT * FROM announcements WHERE title LIKE ? OR body LIKE ? LIMIT 25", (q, q)):
            hits.append({"kind": "announcement", "course": code(r["org_unit_id"]), "title": r["title"],
                         "posted": local(r["start_date"] or r["created_date"]), "snippet": _snippet(r["body"], query)})
        for r in con.execute("SELECT * FROM content_topics WHERE title LIKE ? OR module_path LIKE ? LIMIT 25", (q, q)):
            hits.append({"kind": "content", "course": code(r["org_unit_id"]), "title": r["title"],
                         "module": r["module_path"], "topic_id": r["topic_id"], "local_path": r["local_path"]})
        for r in con.execute("SELECT * FROM quizzes WHERE title LIKE ? LIMIT 25", (q,)):
            hits.append({"kind": "quiz", "course": code(r["org_unit_id"]), "title": r["title"], "due": local(r["due_date"] or r["end_date"])})
        return out({"query": query, "count": len(hits), "hits": hits[:60]})
    finally:
        con.close()


def _snippet(text: str | None, query: str, width: int = 160) -> str | None:
    if not text:
        return None
    i = text.lower().find(query.lower())
    if i < 0:
        return clip(text, width)
    a = max(0, i - width // 2)
    return ("…" if a else "") + text[a:a + width].strip() + "…"


def sync_impl() -> str:
    res = _live(download=True)
    keys = ["courses", "new_assignments", "changed_assignments", "new_quizzes", "new_announcements",
            "new_grades", "changed_grades", "new_files", "updated_files", "unavailable", "errors"]
    return out({k: res.get(k) for k in keys} | {"ok": True})


# ---- registration --------------------------------------------------------
def _run(fn, *a):
    return anyio.to_thread.run_sync(lambda: _guard(lambda: fn(*a)))


def register(mcp) -> None:
    @mcp.tool()
    async def brightspace_status(refresh: bool = False) -> str:
        """Brightspace connector health: is the session alive, last successful sync, row counts, cookie age.
        refresh=True does a live whoami check instead of reading the last result."""
        return await _run(status_impl, refresh)

    @mcp.tool()
    async def brightspace_courses(refresh: bool = False) -> str:
        """Current-term Brightspace courses with course codes and orgUnitIds."""
        return await _run(courses_impl, refresh)

    @mcp.tool()
    async def brightspace_upcoming(days: int = 14, refresh: bool = False) -> str:
        """Everything due in the next `days` days across all courses (assignments, quizzes, calendar events),
        sorted by date, with course code and whether each assignment is already submitted.
        Also lists unsubmitted assignments that went overdue in the last 48h. Times are America/New_York."""
        return await _run(upcoming_impl, days, refresh)

    @mcp.tool()
    async def brightspace_assignments(course: str, refresh: bool = False) -> str:
        """Assignments (dropbox folders) for one course: due dates, points, submission status, instructions.
        course = code like 'CS 240' or an orgUnitId."""
        return await _run(assignments_impl, course, refresh)

    @mcp.tool()
    async def brightspace_grades(course: str | None = None, refresh: bool = False) -> str:
        """My released grades, per item, with the running/final calculated grade where Brightspace exposes it.
        Omit course for all courses."""
        return await _run(grades_impl, course, refresh)

    @mcp.tool()
    async def brightspace_announcements(course: str | None = None, days: int = 14, refresh: bool = False) -> str:
        """Course announcements (news) from the last `days` days, newest first. Omit course for all courses."""
        return await _run(announcements_impl, course, days, refresh)

    @mcp.tool()
    async def brightspace_content(course: str, refresh: bool = False) -> str:
        """Content module tree for a course: topic ids, file types, and local server path if downloaded."""
        return await _run(content_impl, course, refresh)

    @mcp.tool()
    async def brightspace_download(course: str, topic_id: int) -> str:
        """Download one content file (pptx/pdf/docx...) to the server and return its local path."""
        return await _run(download_impl, course, topic_id)

    @mcp.tool()
    async def brightspace_search(query: str, refresh: bool = False) -> str:
        """Substring search across assignment titles/instructions, announcements, quiz and content topic titles."""
        return await _run(search_impl, query, refresh)

    @mcp.tool()
    async def brightspace_sync() -> str:
        """Run a full Brightspace sync now (including new file downloads) and summarise what changed."""
        return await _run(sync_impl)

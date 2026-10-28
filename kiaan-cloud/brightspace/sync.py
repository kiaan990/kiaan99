"""Pull everything for all active courses into SQLite and download new files.

Idempotent: re-running does not duplicate rows or re-download unchanged files.
Run: python -m brightspace.sync [--course "CS 240"] [--no-download]
Exit codes: 0 ok, 1 error, 3 session expired.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import config, notify
from . import store as st
from .client import BrightspaceError, Client, Forbidden, NotFound, SessionExpired, write_session_status

log = logging.getLogger("brightspace.sync")

CODE_RE = re.compile(r"\b([A-Z]{2,4})[\s\-_]?(\d{3}[A-Z]?)(?!\d)")
RECHECK_SUBMISSION_DAYS = 60


# ---- helpers -----------------------------------------------------------
def parse_dt(s) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def iso(s) -> str | None:
    d = parse_dt(s)
    return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


def course_code(org_unit: dict) -> str | None:
    for field in (org_unit.get("Code") or "", org_unit.get("Name") or ""):
        m = CODE_RE.search(field.upper())
        if m:
            return f"{m.group(1)} {m.group(2)}"
    return None


def norm_code(s: str) -> str:
    return re.sub(r"[\s\-_]", "", s or "").upper()


def select_courses(enrollments: list[dict], now: datetime) -> list[dict]:
    """Active, accessible, current-term course offerings that have a course code."""
    cands = []
    for e in enrollments:
        ou, acc = e.get("OrgUnit") or {}, e.get("Access") or {}
        if (ou.get("Type") or {}).get("Id", 3) != 3:
            continue
        if not acc.get("IsActive", True) or not acc.get("CanAccess", True):
            continue
        start, end = parse_dt(acc.get("StartDate")), parse_dt(acc.get("EndDate"))
        if end and end < now - timedelta(days=14):
            continue
        if start and start > now + timedelta(days=21):
            continue
        code = course_code(ou)
        if not code:
            continue
        cands.append({
            "org_unit_id": int(ou["Id"]), "code": code, "code_dir": norm_code(code),
            "name": ou.get("Name") or code, "d2l_code": ou.get("Code"),
            "start_date": iso(acc.get("StartDate")), "end_date": iso(acc.get("EndDate")),
            "last_accessed": iso(acc.get("LastAccessed")),
        })
    # The allowlist only narrows when it matches something, so a stale list
    # (next semester) falls back to the date heuristic instead of syncing nothing.
    allow = {norm_code(c) for c in config.COURSE_ALLOWLIST}
    if allow and any(c["code_dir"] in allow for c in cands):
        cands = [c for c in cands if c["code_dir"] in allow]
    return cands


def _submission_state(raw) -> tuple[int | None, int, str | None, str | None]:
    """Normalise mysubmissions output -> (submitted, count, last_at, feedback_score)."""
    subs, status, score = [], None, None
    for item in raw or []:
        if "Submissions" in item:  # EntityDropbox shape
            subs += item.get("Submissions") or []
            status = item.get("Status", status)
            fb = item.get("Feedback") or {}
            if fb.get("Score") is not None:
                score = f"{fb.get('Score')}/{fb.get('OutOf')}" if fb.get("OutOf") else str(fb.get("Score"))
        else:
            subs.append(item)
    dates = sorted(d for d in (iso(s.get("SubmissionDate")) for s in subs) if d)
    submitted = 1 if subs or status in (1, 3) else 0
    return submitted, len(subs), (dates[-1] if dates else None), score


# ---- per-endpoint syncs ------------------------------------------------
class Sync:
    def __init__(self, client: Client, con, download: bool = True, now: datetime | None = None):
        self.c, self.con, self.download = client, con, download
        self.now = now or datetime.now(timezone.utc)
        self.summary = {
            "new_assignments": [], "changed_assignments": [], "new_quizzes": [],
            "new_announcements": [], "new_grades": [], "changed_grades": [],
            "new_files": [], "updated_files": [], "unavailable": {}, "errors": [],
        }

    def _try(self, label: str, ou_code: str, fn, *a):
        """Run one endpoint. Forbidden/NotFound are recorded, not fatal."""
        try:
            return fn(*a), True
        except (Forbidden, NotFound) as e:
            self.summary["unavailable"].setdefault(label, []).append(ou_code)
            log.info("%s unavailable for %s: %s", label, ou_code, e)
            return None, False
        except SessionExpired:
            raise
        except BrightspaceError as e:
            self.summary["errors"].append(f"{label} {ou_code}: {e}")
            log.warning("%s failed for %s: %s", label, ou_code, e)
            return None, False

    def courses(self, only: str | None = None) -> list[dict]:
        sel = select_courses(self.c.enrollments(), self.now)
        ids = {c["org_unit_id"] for c in sel}
        self.con.execute(f"UPDATE courses SET is_active=0 WHERE org_unit_id NOT IN ({','.join('?' * len(ids)) or 'NULL'})", tuple(ids))
        for c in sel:
            fields = {k: v for k, v in c.items() if k != "org_unit_id"}
            fields["is_active"] = 1
            st.upsert(self.con, "courses", {"org_unit_id": c["org_unit_id"]}, fields, track_hash=False)
        if only:
            sel = [c for c in sel if norm_code(c["code"]) == norm_code(only) or str(c["org_unit_id"]) == str(only)]
        return sel

    def assignments(self, course: dict):
        ou, code = course["org_unit_id"], course["code"]
        folders, ok = self._try("dropbox", code, self.c.dropbox_folders, ou)
        if not ok:
            return
        seen = []
        for f in folders:
            fid = int(f["Id"])
            seen.append(fid)
            due = iso(f.get("DueDate"))
            avail = f.get("Availability") or {}
            prev = self.con.execute("SELECT submitted, submission_count, last_submitted_at, feedback_score FROM assignments WHERE folder_id=?", (fid,)).fetchone()
            sub = tuple(prev) if prev else (None, 0, None, None)
            due_dt = parse_dt(due)
            recent = due_dt is None or due_dt > self.now - timedelta(days=RECHECK_SUBMISSION_DAYS)
            if not f.get("IsHidden") and recent and not (prev and prev["submitted"] == 1 and prev["feedback_score"]):
                raw, ok2 = self._try("dropbox_mysubmissions", code, self.c.my_submissions, ou, fid)
                if ok2:
                    sub = _submission_state(raw)
            fields = {
                "org_unit_id": ou, "title": f.get("Name"),
                "instructions": st.rich_text(f.get("CustomInstructions")),
                "due_date": due, "start_date": iso(avail.get("StartDate")), "end_date": iso(avail.get("EndDate")),
                "points": (f.get("Assessment") or {}).get("ScoreDenominator"),
                "submitted": sub[0], "submission_count": sub[1], "last_submitted_at": sub[2],
                "feedback_score": sub[3], "is_hidden": 1 if f.get("IsHidden") else 0,
            }
            res = st.upsert(self.con, "assignments", {"folder_id": fid}, fields)
            if res == "new":
                self.summary["new_assignments"].append(f"{code}: {f.get('Name')} (due {due or 'n/a'})")
            elif res == "changed":
                self.summary["changed_assignments"].append(f"{code}: {f.get('Name')}")
        st.delete_missing(self.con, "assignments", "folder_id", ou, seen)

    def quizzes(self, course: dict):
        ou, code = course["org_unit_id"], course["code"]
        qs, ok = self._try("quizzes", code, self.c.quizzes, ou)
        if not ok:
            return
        seen = []
        for q in qs:
            qid = int(q["QuizId"])
            seen.append(qid)
            att = q.get("AttemptsAllowed") or {}
            instr = q.get("Instructions") or {}
            fields = {
                "org_unit_id": ou, "title": q.get("Name"),
                "instructions": st.rich_text(instr.get("Text") if isinstance(instr, dict) else instr),
                "start_date": iso(q.get("StartDate")), "end_date": iso(q.get("EndDate")),
                "due_date": iso(q.get("DueDate")),
                "attempts_allowed": "unlimited" if att.get("IsUnlimited") else str(att.get("NumberOfAttemptsAllowed") or ""),
                "is_active": 1 if q.get("IsActive", True) else 0,
            }
            if st.upsert(self.con, "quizzes", {"quiz_id": qid}, fields) == "new":
                self.summary["new_quizzes"].append(f"{code}: {q.get('Name')}")
        st.delete_missing(self.con, "quizzes", "quiz_id", ou, seen)

    def grades(self, course: dict):
        ou, code = course["org_unit_id"], course["code"]
        vals, ok = self._try("grades", code, self.c.grades, ou)
        if not ok:
            return
        final, _ = self._try("grades_final", code, self.c.final_grade, ou)
        rows = [(v, 0) for v in vals or []] + ([(final, 1)] if final else [])
        seen = []
        for v, is_final in rows:
            gid = int(v.get("GradeObjectIdentifier") or 0) if not is_final else -1
            seen.append(gid)
            fields = {
                "org_unit_id": ou, "name": "Final calculated grade" if is_final else v.get("GradeObjectName"),
                "type": v.get("GradeObjectTypeName"), "displayed": v.get("DisplayedGrade"),
                "points_num": v.get("PointsNumerator"), "points_den": v.get("PointsDenominator"),
                "weighted_num": v.get("WeightedNumerator"), "weighted_den": v.get("WeightedDenominator"),
                "comments": st.rich_text(v.get("Comments")), "last_modified": iso(v.get("LastModified")),
                "is_final": is_final,
            }
            res = st.upsert(self.con, "grades", {"org_unit_id": ou, "grade_object_id": gid}, fields)
            label = f"{code}: {fields['name']} = {fields['displayed'] or fields['points_num']}"
            if res == "new" and not is_final:
                self.summary["new_grades"].append(label)
            elif res == "changed":
                self.summary["changed_grades"].append(label)
        st.delete_missing(self.con, "grades", "grade_object_id", ou, seen)

    def announcements(self, course: dict):
        ou, code = course["org_unit_id"], course["code"]
        items, ok = self._try("news", code, self.c.news, ou)
        if not ok:
            return
        seen = []
        for n in items:
            if n.get("IsHidden") or n.get("IsPublished") is False:
                continue
            nid = int(n["Id"])
            seen.append(nid)
            fields = {
                "org_unit_id": ou, "title": n.get("Title"), "body": st.rich_text(n.get("Body")),
                "start_date": iso(n.get("StartDate")), "created_date": iso(n.get("CreatedDate")),
                "last_modified": iso(n.get("LastModifiedDate")),
            }
            if st.upsert(self.con, "announcements", {"id": nid}, fields) == "new":
                self.summary["new_announcements"].append(f"{code}: {n.get('Title')}")
        st.delete_missing(self.con, "announcements", "id", ou, seen)

    def content(self, course: dict):
        ou, code = course["org_unit_id"], course["code"]
        toc, ok = self._try("content_toc", code, self.c.toc, ou)
        if not ok:
            return
        seen_mod, seen_top = [], []

        def walk(mods, parent, path):
            for m in mods or []:
                mid = int(m["ModuleId"])
                seen_mod.append(mid)
                mpath = f"{path} / {m.get('Title')}" if path else m.get("Title")
                st.upsert(self.con, "content_modules", {"module_id": mid},
                          {"org_unit_id": ou, "parent_id": parent, "title": m.get("Title"),
                           "sort_order": m.get("SortOrder"), "path": mpath}, track_hash=False)
                for t in m.get("Topics") or []:
                    if t.get("IsHidden"):
                        continue
                    tid = int(t["TopicId"])
                    seen_top.append(tid)
                    url = t.get("Url") or ""
                    ext = Path(unquote(urlparse(url).path)).suffix.lower().lstrip(".")
                    fields = {
                        "org_unit_id": ou, "module_id": mid, "module_path": mpath, "title": t.get("Title"),
                        "type": t.get("TypeIdentifier"), "url": url, "file_ext": ext,
                        "last_modified": iso(t.get("LastModifiedDate")), "sort_order": t.get("SortOrder"),
                    }
                    st.upsert(self.con, "content_topics", {"topic_id": tid}, fields)
                walk(m.get("Modules"), mid, mpath)

        walk(toc.get("Modules"), None, "")
        st.delete_missing(self.con, "content_modules", "module_id", ou, seen_mod)
        st.delete_missing(self.con, "content_topics", "topic_id", ou, seen_top)
        if self.download:
            for row in self.con.execute(
                "SELECT * FROM content_topics WHERE org_unit_id=? AND type='File'", (ou,)).fetchall():
                if row["file_ext"] in config.DOWNLOAD_EXTS:
                    try:
                        self.fetch_file(course, row)
                    except SessionExpired:
                        raise
                    except BrightspaceError as e:
                        self.summary["errors"].append(f"download {code} {row['topic_id']}: {e}")

    def fetch_file(self, course: dict, row, force: bool = False) -> str | None:
        """Download one topic if new/changed. Returns the local path."""
        key = f"{row['url']}|{row['last_modified'] or ''}"
        if (not force and row["local_path"] and row["download_key"] == key
                and os.path.exists(row["local_path"])):
            return row["local_path"]
        dest_dir = config.HOME / course["code_dir"]
        fallback = Path(unquote(urlparse(row["url"] or "").path)).name or f"{row['topic_id']}.{row['file_ext'] or 'bin'}"
        got = self.c.download_topic(course["org_unit_id"], row["topic_id"], dest_dir, fallback)
        target = dest_dir / got["name"]
        clash = self.con.execute("SELECT 1 FROM content_topics WHERE local_path=? AND topic_id<>?",
                                 (str(target), row["topic_id"])).fetchone()
        if clash:
            target = dest_dir / f"{target.stem} [{row['topic_id']}]{target.suffix}"
        if row["local_path"] and row["local_path"] != str(target) and os.path.exists(row["local_path"]):
            os.unlink(row["local_path"])
        os.replace(got["tmp"], target)
        os.chmod(target, 0o640)
        is_new = not row["local_sha256"]
        changed = row["local_sha256"] and row["local_sha256"] != got["sha256"]
        self.con.execute(
            "UPDATE content_topics SET local_path=?, local_size=?, local_sha256=?, downloaded_at=?, download_key=? WHERE topic_id=?",
            (str(target), got["size"], got["sha256"], st.now_iso(), key, row["topic_id"]))
        if is_new:
            self.summary["new_files"].append(str(target))
        elif changed:
            self.summary["updated_files"].append(str(target))
        return str(target)

    def calendar(self, ou_ids: set[int]):
        start = self.now - timedelta(days=config.CAL_PAST_DAYS)
        end = self.now + timedelta(days=config.CAL_FUTURE_DAYS)
        events, ok = self._try("calendar", "all", self.c.calendar, start, end)
        if not ok:
            return
        seen = []
        for e in events:
            if ou_ids and e.get("OrgUnitId") and int(e["OrgUnitId"]) not in ou_ids:
                continue
            eid = int(e["CalendarEventId"])
            seen.append(eid)
            ent = e.get("AssociatedEntity") or {}
            st.upsert(self.con, "calendar_events", {"event_id": eid}, {
                "org_unit_id": e.get("OrgUnitId"), "title": e.get("Title"),
                "description": st.rich_text(e.get("Description")),
                "start": iso(e.get("StartDateTime") or e.get("StartDay")),
                "end": iso(e.get("EndDateTime") or e.get("EndDay")),
                "all_day": 1 if e.get("IsAllDayEvent") else 0,
                "entity_type": ent.get("AssociatedEntityType"), "entity_id": ent.get("AssociatedEntityId"),
            })
        q = "DELETE FROM calendar_events WHERE start>=? AND start<=?"
        if seen:
            q += f" AND event_id NOT IN ({','.join('?' * len(seen))})"
        self.con.execute(q, (iso(start.isoformat()), iso(end.isoformat()), *seen))




def run_sync(client: Client | None = None, con=None, download: bool = True, course: str | None = None,
             now: datetime | None = None) -> dict:
    """Locked wrapper so the timer and a tool-triggered sync never overlap."""
    import fcntl

    config.HOME.mkdir(parents=True, exist_ok=True)
    with open(config.HOME / ".sync.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fcntl.flock(lock, fcntl.LOCK_EX)  # wait for the running sync, then do ours (cheap: unchanged rows)
        return _run_sync(client, con, download, course, now)


def _run_sync(client, con, download, course, now) -> dict:
    own_client, own_con = client is None, con is None
    client = client or Client()
    con = con or st.connect()
    started = st.now_iso()
    log_id = con.execute("INSERT INTO sync_log(started_at, ok) VALUES (?, 0)", (started,)).lastrowid
    con.commit()
    s = Sync(client, con, download=download, now=now)
    try:
        me = client.whoami()
        write_session_status(True, "sync whoami ok", me.get("FirstName", ""))
        courses = s.courses(course)
        con.commit()
        for c in courses:
            for step in (s.assignments, s.quizzes, s.grades, s.announcements, s.content):
                step(c)
                con.commit()
        if not course:
            s.calendar({c["org_unit_id"] for c in courses})
        st.set_meta(con, "unavailable_endpoints", sorted(s.summary["unavailable"]))
        st.set_meta(con, "api_versions", client.versions())
        st.set_meta(con, "host", client.host)
        result = {"ok": True, "courses": [c["code"] for c in courses], **s.summary}
        con.execute("UPDATE sync_log SET finished_at=?, ok=1, summary=? WHERE id=?",
                    (st.now_iso(), json.dumps(result), log_id))
        if not course:
            st.set_meta(con, "last_success", st.now_iso())
        con.commit()
        return result
    except SessionExpired as e:
        con.rollback()
        write_session_status(False, str(e))
        con.execute("UPDATE sync_log SET finished_at=?, ok=0, error=? WHERE id=?",
                    (st.now_iso(), f"session expired: {e}", log_id))
        con.commit()
        raise
    except Exception as e:
        con.rollback()
        con.execute("UPDATE sync_log SET finished_at=?, ok=0, error=? WHERE id=?",
                    (st.now_iso(), f"{type(e).__name__}: {e}", log_id))
        con.commit()
        raise
    finally:
        if own_client:
            client.close()
        if own_con:
            con.close()


def headline(result: dict) -> str:
    bits = [f"{len(result.get('courses', []))} courses"]
    for k, label in (("new_assignments", "new assignments"), ("new_announcements", "new announcements"),
                     ("new_files", "new files"), ("new_grades", "new grades"), ("changed_grades", "grade changes")):
        if result.get(k):
            bits.append(f"{len(result[k])} {label}")
    return "Brightspace sync: " + ", ".join(bits)


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--course")
    ap.add_argument("--no-download", action="store_true")
    a = ap.parse_args(argv)
    try:
        res = run_sync(download=not a.no_download, course=a.course)
    except SessionExpired as e:
        notify.note(f"Brightspace session expired ({e}). Run refresh.py on the Mac.", "warn")
        return 3
    except Exception as e:
        notify.note(f"Brightspace sync failed: {type(e).__name__}: {e}", "error")
        return 1
    print(json.dumps(res, indent=1))
    interesting = any(res.get(k) for k in ("new_assignments", "new_announcements", "new_files", "new_grades", "changed_grades"))
    if interesting:
        notify.note(headline(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())

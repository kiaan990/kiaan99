"""SQLite cache. Upserts report whether a row is new, changed, or unchanged."""
from __future__ import annotations

import hashlib
import html
import json
import re
import sqlite3
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS courses (
  org_unit_id INTEGER PRIMARY KEY, code TEXT, code_dir TEXT, name TEXT, d2l_code TEXT,
  start_date TEXT, end_date TEXT, is_active INTEGER, last_accessed TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS assignments (
  folder_id INTEGER PRIMARY KEY, org_unit_id INTEGER, title TEXT, instructions TEXT,
  due_date TEXT, start_date TEXT, end_date TEXT, points REAL, submitted INTEGER,
  submission_count INTEGER, last_submitted_at TEXT, feedback_score TEXT, is_hidden INTEGER,
  hash TEXT, first_seen TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS quizzes (
  quiz_id INTEGER PRIMARY KEY, org_unit_id INTEGER, title TEXT, instructions TEXT,
  start_date TEXT, end_date TEXT, due_date TEXT, attempts_allowed TEXT, is_active INTEGER,
  hash TEXT, first_seen TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS grades (
  org_unit_id INTEGER, grade_object_id INTEGER, name TEXT, type TEXT, displayed TEXT,
  points_num REAL, points_den REAL, weighted_num REAL, weighted_den REAL, comments TEXT,
  last_modified TEXT, is_final INTEGER, hash TEXT, updated_at TEXT,
  PRIMARY KEY (org_unit_id, grade_object_id));
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY, org_unit_id INTEGER, title TEXT, body TEXT, start_date TEXT,
  created_date TEXT, last_modified TEXT, hash TEXT, first_seen TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS content_modules (
  module_id INTEGER PRIMARY KEY, org_unit_id INTEGER, parent_id INTEGER, title TEXT,
  sort_order INTEGER, path TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS content_topics (
  topic_id INTEGER PRIMARY KEY, org_unit_id INTEGER, module_id INTEGER, module_path TEXT,
  title TEXT, type TEXT, url TEXT, file_ext TEXT, last_modified TEXT, sort_order INTEGER,
  local_path TEXT, local_size INTEGER, local_sha256 TEXT, downloaded_at TEXT,
  download_key TEXT, hash TEXT, first_seen TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS calendar_events (
  event_id INTEGER PRIMARY KEY, org_unit_id INTEGER, title TEXT, description TEXT,
  start TEXT, end TEXT, all_day INTEGER, entity_type TEXT, entity_id INTEGER,
  hash TEXT, first_seen TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, ok INTEGER,
  error TEXT, summary TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS ix_assign_due ON assignments(due_date);
CREATE INDEX IF NOT EXISTS ix_cal_start ON calendar_events(start);
CREATE INDEX IF NOT EXISTS ix_topic_ou ON content_topics(org_unit_id);
"""

TABLES = ["courses", "assignments", "quizzes", "grades", "announcements",
          "content_topics", "calendar_events", "sync_log"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(path or config.DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def row_hash(*parts) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


def upsert(con, table: str, key: dict, fields: dict, track_hash: bool = True) -> str:
    """Insert or update one row. Returns 'new', 'changed' or 'same'."""
    where = " AND ".join(f"{k}=?" for k in key)
    existing = con.execute(f"SELECT * FROM {table} WHERE {where}", tuple(key.values())).fetchone()
    ts = now_iso()
    data = dict(fields)
    if track_hash:
        data["hash"] = row_hash(fields)
    if existing is None:
        if track_hash and "first_seen" in existing_cols(con, table):
            data["first_seen"] = ts
        data["updated_at"] = ts
        cols = list(key) + list(data)
        con.execute(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    tuple(key.values()) + tuple(data.values()))
        return "new"
    if track_hash and existing["hash"] == data["hash"]:
        return "same"
    if not track_hash and all(existing[k] == v for k, v in data.items()):
        return "same"
    data["updated_at"] = ts
    sets = ",".join(f"{k}=?" for k in data)
    con.execute(f"UPDATE {table} SET {sets} WHERE {where}", tuple(data.values()) + tuple(key.values()))
    return "changed"


_cols_cache: dict[str, set] = {}


def existing_cols(con, table: str) -> set:
    if table not in _cols_cache:
        _cols_cache[table] = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
    return _cols_cache[table]


def delete_missing(con, table: str, id_col: str, org_unit_id: int, keep_ids) -> int:
    keep = list(keep_ids)
    q = f"DELETE FROM {table} WHERE org_unit_id=?"
    if keep:
        q += f" AND {id_col} NOT IN ({','.join('?' * len(keep))})"
    return con.execute(q, (org_unit_id, *keep)).rowcount


def set_meta(con, key: str, value) -> None:
    con.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)))


def get_meta(con, key: str, default=None):
    r = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def counts(con) -> dict:
    return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}


# ---- text helpers ------------------------------------------------------
class _Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []

    def handle_data(self, d):
        self.out.append(d)

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "p", "li", "div", "tr", "h1", "h2", "h3"):
            self.out.append("\n")


def rich_text(obj) -> str:
    """D2L RichText {Text, Html} -> plain text."""
    if not obj:
        return ""
    if isinstance(obj, str):
        txt = obj
    else:
        txt = obj.get("Text") or ""
        if not txt and obj.get("Html"):
            s = _Strip()
            s.feed(obj["Html"])
            txt = "".join(s.out)
    txt = html.unescape(txt).replace("\xa0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    return re.sub(r"\n\s*\n+", "\n", txt).strip()

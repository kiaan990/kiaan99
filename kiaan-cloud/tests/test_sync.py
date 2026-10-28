import json
from datetime import datetime, timezone

import httpx

from brightspace import store as st
from brightspace.client import Client
from brightspace.sync import run_sync, select_courses
from conftest import fx

NOW = datetime(2026, 10, 28, 16, 0, tzinfo=timezone.utc)


def sync_once(fake, **kw):
    client = Client(transport=httpx.MockTransport(fake), retry_delay=0)
    try:
        return run_sync(client=client, now=NOW, **kw)
    finally:
        client.close()


def table_counts():
    con = st.connect()
    try:
        c = st.counts(con)
        c.pop("sync_log")
        return c
    finally:
        con.close()


def test_course_selection_filters_old_and_codeless():
    enr = fx("enrollments_p1.json")["Items"] + fx("enrollments_p2.json")["Items"]
    codes = [c["code"] for c in select_courses(enr, NOW)]
    assert codes == ["CS 240", "FI 118", "ST 113"]


def test_sync_is_idempotent(bs_home, fake_d2l):
    first = sync_once(fake_d2l)
    counts1 = table_counts()
    downloads1 = fake_d2l.downloads
    second = sync_once(fake_d2l)
    counts2 = table_counts()

    assert counts1 == counts2
    assert counts1["courses"] == 3 and counts1["assignments"] == 5
    assert counts1["calendar_events"] == 2  # old-course event dropped
    assert fake_d2l.downloads == downloads1 == 3  # pptx x2 + pdf, link skipped, nothing re-downloaded
    assert len(first["new_assignments"]) == 5 and len(first["new_files"]) == 3
    assert not any(second[k] for k in ("new_assignments", "changed_assignments", "new_announcements",
                                       "new_files", "updated_files", "new_grades", "changed_grades"))
    assert all(r.method == "GET" for r in fake_d2l.requests)


def test_files_land_in_course_dir(bs_home, fake_d2l):
    sync_once(fake_d2l)
    files = sorted(p.name for p in (bs_home / "CS240").iterdir())
    assert files == ["topic-1101.pptx", "topic-1102.pptx", "topic-1201.pptx"]


def test_quizzes_403_recorded_as_unavailable(bs_home, fake_d2l):
    res = sync_once(fake_d2l)
    assert set(res["unavailable"]["quizzes"]) == {"FI 118", "ST 113"}
    assert res["unavailable"]["grades_final"] == ["FI 118", "ST 113"]


def test_submission_status(bs_home, fake_d2l):
    sync_once(fake_d2l)
    con = st.connect()
    sub = dict(con.execute("SELECT folder_id, submitted FROM assignments").fetchall())
    assert sub[702] == 1 and sub[701] == 0


def test_upcoming_tool_merges_and_dedupes(bs_home, fake_d2l):
    from brightspace.tools import upcoming_impl, grades_impl, content_impl, search_impl

    sync_once(fake_d2l)
    up = json.loads(upcoming_impl(14, _now=NOW))
    titles = [i["title"] for i in up["items"]]
    assert "Lab 6: Network Diagram" in titles
    assert "Lab 6: Network Diagram - Due" not in titles  # calendar duplicate of the dropbox folder
    assert {i["course"] for i in up["items"]} == {"CS 240", "FI 118", "ST 113"}
    assert "Chapter 5A Reflection" not in titles  # past due but submitted
    assert "Hidden draft" not in titles
    g = json.loads(grades_impl("CS 240"))
    assert g[0]["running_total"] == "90 %"
    c = json.loads(content_impl("cs240"))
    assert c["modules"][0]["topics"][0]["local_path"].endswith("topic-1101.pptx")
    s = json.loads(search_impl("smith"))
    assert s["hits"][0]["kind"] == "announcement"

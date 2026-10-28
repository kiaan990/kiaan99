import json
import re
import sys
from pathlib import Path

import httpx
import pytest

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "brightspace" / "__init__.py").exists())
sys.path.insert(0, str(ROOT))
FIX = Path(__file__).parent / "fixtures"


def fx(name):
    return json.loads((FIX / name).read_text())


@pytest.fixture
def bs_home(tmp_path, monkeypatch):
    """Point the package at a temp dir with a fake cookie file."""
    from brightspace import config

    monkeypatch.setattr(config, "HOME", tmp_path)
    monkeypatch.setattr(config, "COOKIES_PATH", tmp_path / "cookies.json")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "brightspace.db")
    monkeypatch.setattr(config, "SESSION_PATH", tmp_path / "session.json")
    monkeypatch.setattr(config, "NOTIFY_LOG", tmp_path / "notifications.jsonl")
    monkeypatch.setattr(config, "LP_VERSION", "1.64")
    monkeypatch.setattr(config, "LE_VERSION", "1.100")
    monkeypatch.setattr(config, "COURSE_ALLOWLIST", [])
    (tmp_path / "cookies.json").write_text(json.dumps({
        "host": "bentley.brightspace.com", "captured_at": "2026-10-28T12:00:00+00:00",
        "cookies": {"d2lSessionVal": "SECRET-SESSION", "d2lSecureSessionVal": "SECRET-SECURE"}}))
    return tmp_path


class FakeD2L:
    """Routes recorded fixture responses; records every request seen."""

    def __init__(self):
        self.requests = []
        self.downloads = 0
        self.routes = [
            (r"/lp/[\d.]+/users/whoami$", lambda r: fx("whoami.json")),
            (r"/lp/[\d.]+/enrollments/myenrollments/$",
             lambda r: fx("enrollments_p2.json") if r.url.params.get("bookmark") else fx("enrollments_p1.json")),
            (r"/le/[\d.]+/(\d+)/dropbox/folders/702/submissions/mysubmissions/$", lambda r, ou: fx("mysub_702.json")),
            (r"/le/[\d.]+/(\d+)/dropbox/folders/\d+/submissions/mysubmissions/$", lambda r, ou: fx("mysub_none.json")),
            (r"/le/[\d.]+/(\d+)/dropbox/folders/$", lambda r, ou: fx(f"dropbox_{ou}.json")),
            (r"/le/[\d.]+/(\d+)/grades/final/values/myGradeValue$",
             lambda r, ou: fx("final_5001.json") if ou == "5001" else httpx.Response(404)),
            (r"/le/[\d.]+/(\d+)/grades/values/myGradeValues/$",
             lambda r, ou: fx(f"grades_{ou}.json") if ou in ("5001", "5002") else []),
            (r"/le/[\d.]+/(\d+)/news/$", lambda r, ou: fx("news_5001.json") if ou == "5001" else []),
            (r"/le/[\d.]+/(\d+)/content/toc$", lambda r, ou: fx("toc_5001.json") if ou == "5001" else fx("toc_empty.json")),
            (r"/le/[\d.]+/(\d+)/content/topics/(\d+)/file$", self._file),
            (r"/le/[\d.]+/(\d+)/quizzes/$", lambda r, ou: fx("quizzes_5001.json") if ou == "5001" else httpx.Response(403)),
            (r"/le/[\d.]+/calendar/events/myEvents/$", lambda r: fx("calendar.json")),
        ]

    def _file(self, r, ou, tid):
        self.downloads += 1
        return httpx.Response(200, content=f"deck {tid}".encode(), headers={
            "content-type": "application/octet-stream",
            "content-disposition": f'attachment; filename="topic-{tid}.pptx"'})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET", "connector must be read-only"
        self.requests.append(request)
        for pat, fn in self.routes:
            m = re.search(pat, request.url.path)
            if m:
                res = fn(request, *m.groups())
                return res if isinstance(res, httpx.Response) else httpx.Response(200, json=res)
        return httpx.Response(404)


@pytest.fixture
def fake_d2l():
    return FakeD2L()

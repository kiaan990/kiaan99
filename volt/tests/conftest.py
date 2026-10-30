from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 10, 30, 19, 0, tzinfo=UTC)  # Fri Oct 30 2026, 15:00 ET


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from volt import config

    for k in ("DB_PATH", "CACHE_DIR", "RAW_DIR", "DEBUG_DIR", "EXPORT_DIR", "BROWSER_PROFILES_DIR"):
        monkeypatch.setenv(k, str(tmp_path / k.lower()))
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("DELAY_MIN_S", "0")
    monkeypatch.setenv("DELAY_MAX_S", "0")
    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()


@pytest.fixture
def session(tmp_path: Path) -> Iterator[Session]:
    from volt import db
    from volt.matching import load_brands, load_venues

    db.init_db(f"sqlite:///{tmp_path / 'test.db'}")
    with db.session_scope() as s:
        load_venues(s)
        load_brands(s)
        s.flush()
        yield s


@pytest.fixture
def run_id(session: Session) -> int:
    from volt.db import CrawlRun

    r = CrawlRun(site="test", status="OK")
    session.add(r)
    session.flush()
    return r.id


def at(days: float = 0, hours: float = 0) -> datetime:
    return NOW + timedelta(days=days, hours=hours)


class FakeCtx:
    """Minimal CrawlContext stand-in: stamps crawl_run_id and adds to the session."""

    def __init__(self, session: Session, run_id: int):
        self.session, self.run_id = session, run_id

    def add(self, row):  # noqa: ANN001, ANN201
        if hasattr(row, "crawl_run_id"):
            row.crawl_run_id = self.run_id
        self.session.add(row)
        return row


@pytest.fixture
def ctx(session: Session, run_id: int) -> FakeCtx:
    return FakeCtx(session, run_id)

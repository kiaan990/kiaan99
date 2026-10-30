"""SQLite models and session handling (SQLAlchemy 2.x).

Snapshot tables are append-only: code only ever INSERTs into them.
"""

from __future__ import annotations

import enum
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

from volt.config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Store naive UTC in SQLite, always hand back tz-aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


class Base(DeclarativeBase):
    pass


class Provider(enum.StrEnum):
    RA = "RA"
    DICE = "DICE"
    POSH = "POSH"
    EVENTBRITE = "EVENTBRITE"
    TM = "TM"
    AXS = "AXS"
    OTHER = "OTHER"


class EventStatus(enum.StrEnum):
    ANNOUNCED = "ANNOUNCED"
    ON_SALE = "ON_SALE"
    SOLD_OUT = "SOLD_OUT"
    CANCELLED = "CANCELLED"
    PAST = "PAST"


class Side(enum.StrEnum):
    BID = "BID"
    ASK = "ASK"


class TradeStatus(enum.StrEnum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    NO_MARKET = "NO_MARKET"


class CrawlRun(Base):
    __tablename__ = "crawl_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    site: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(16), default="RUNNING")  # RUNNING/OK/PARTIAL/FAILED
    pages_fetched: Mapped[int] = mapped_column(Integer, default=0)
    rows_written: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)


class Venue(Base):
    __tablename__ = "venues"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    capacity: Mapped[int | None] = mapped_column(Integer)
    platform: Mapped[str | None] = mapped_column(String(64))
    flip_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)


class Brand(Base):
    __tablename__ = "brands"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    tier: Mapped[int] = mapped_column(Integer, default=3)
    title_prefix_only: Mapped[bool] = mapped_column(Boolean, default=False)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    venue_id: Mapped[int | None] = mapped_column(ForeignKey("venues.id"))
    venue_name_raw: Mapped[str | None] = mapped_column(String(200))
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id"))
    promoter: Mapped[str | None] = mapped_column(Text)
    lineup: Mapped[list[str]] = mapped_column(JSON, default=list)
    primary_provider: Mapped[Provider | None] = mapped_column(Enum(Provider, native_enum=False))
    face_value_cents: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[EventStatus] = mapped_column(
        Enum(EventStatus, native_enum=False), default=EventStatus.ANNOUNCED
    )
    first_sold_out_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    announced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # from Dice when available
    added_date_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    scarcity_flag: Mapped[bool] = mapped_column(Boolean, default=False)  # manual: finale/relocation/make-good
    cv_wallet_type: Mapped[str | None] = mapped_column(String(32))
    cv_listable: Mapped[bool | None] = mapped_column(Boolean)
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("events.id"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class EventSource(Base):
    __tablename__ = "event_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    site: Mapped[str] = mapped_column(String(32))
    url: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str] = mapped_column(String(300))
    match_confidence: Mapped[float] = mapped_column(Float, default=100.0)
    match_confirmed: Mapped[bool | None] = mapped_column(Boolean)
    __table_args__ = (Index("ux_event_sources_site_ext", "site", "external_id", unique=True),)


class RawCapture(Base):
    """Pointer to an archived raw response on disk (HTML, JSON, screenshot)."""

    __tablename__ = "raw_captures"
    id: Mapped[int] = mapped_column(primary_key=True)
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"), index=True)
    site: Mapped[str] = mapped_column(String(32))
    url: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))  # html/json/png
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class CvBookSnapshot(Base):
    __tablename__ = "cv_book_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"))
    side: Mapped[Side] = mapped_column(Enum(Side, native_enum=False))
    price_cents: Mapped[int | None] = mapped_column(Integer)
    quantity: Mapped[int | None] = mapped_column(Integer)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_cv_book_event_time", "event_id", text("captured_at DESC")),)


class CvEventSnapshot(Base):
    __tablename__ = "cv_event_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"))
    lowest_ask_cents: Mapped[int | None] = mapped_column(Integer)
    all_in_lowest_cents: Mapped[int | None] = mapped_column(Integer)
    highest_bid_cents: Mapped[int | None] = mapped_column(Integer)
    ask_count: Mapped[int | None] = mapped_column(Integer)
    bid_count: Mapped[int | None] = mapped_column(Integer)
    looking_to_go: Mapped[int | None] = mapped_column(Integer)
    looking_to_sell: Mapped[int | None] = mapped_column(Integer)
    last_sale_cents: Mapped[int | None] = mapped_column(Integer)
    ticket_limit: Mapped[int | None] = mapped_column(Integer)
    parse_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_cv_event_event_time", "event_id", text("captured_at DESC")),)


class TierSnapshot(Base):
    __tablename__ = "tier_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"))
    provider: Mapped[str] = mapped_column(String(16))
    tier_name: Mapped[str] = mapped_column(String(300))
    tier_index: Mapped[int | None] = mapped_column(Integer)  # 1-based order by price
    price_cents: Mapped[int | None] = mapped_column(Integer)
    available: Mapped[bool] = mapped_column(Boolean)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_tier_event_time", "event_id", text("captured_at DESC")),)


class SignalSnapshot(Base):
    __tablename__ = "signal_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    crawl_run_id: Mapped[int] = mapped_column(ForeignKey("crawl_runs.id"))
    signal_name: Mapped[str] = mapped_column(String(64))
    value: Mapped[float | None] = mapped_column(Float)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_signal_event_time", "event_id", text("captured_at DESC")),)


class Score(Base):
    __tablename__ = "scores"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    scored_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    gates_passed: Mapped[bool] = mapped_column(Boolean)
    gate_failures: Mapped[list[str]] = mapped_column(JSON, default=list)
    score: Mapped[float] = mapped_column(Float)
    components: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    days_to_event: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("ix_scores_event_time", "event_id", text("scored_at DESC")),)


class PaperTrade(Base):
    __tablename__ = "paper_trades"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), unique=True)
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    buy_tier_name: Mapped[str | None] = mapped_column(String(300))
    buy_price_cents: Mapped[int] = mapped_column(Integer)
    qty: Mapped[int] = mapped_column(Integer, default=4)
    target_sell_at: Mapped[datetime] = mapped_column(UTCDateTime)
    sell_price_cents: Mapped[int | None] = mapped_column(Integer)
    fee_pct: Mapped[float] = mapped_column(Float, default=0.04)
    pnl_cents: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[TradeStatus] = mapped_column(Enum(TradeStatus, native_enum=False), default=TradeStatus.OPEN)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Outcome(Base):
    __tablename__ = "outcomes"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), unique=True)
    resolved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    sold_out: Mapped[bool] = mapped_column(Boolean)
    sold_out_days_before: Mapped[float | None] = mapped_column(Float)
    added_date: Mapped[bool] = mapped_column(Boolean)
    peak_bid_cents: Mapped[int | None] = mapped_column(Integer)
    median_ask_t2_cents: Mapped[int | None] = mapped_column(Integer)
    median_ask_t1_cents: Mapped[int | None] = mapped_column(Integer)
    median_ask_t0_cents: Mapped[int | None] = mapped_column(Integer)
    last_sale_t2_cents: Mapped[int | None] = mapped_column(Integer)
    clearing_multiple: Mapped[float | None] = mapped_column(Float)
    book_depth_t2: Mapped[int | None] = mapped_column(Integer)


SNAPSHOT_MODELS = (CvBookSnapshot, CvEventSnapshot, TierSnapshot, SignalSnapshot)

_engine: Engine | None = None
_Session: sessionmaker[Session] | None = None


def get_engine(url: str | None = None) -> Engine:
    global _engine, _Session
    if _engine is None or url is not None:
        url = url or f"sqlite:///{get_settings().db_path}"
        _engine = create_engine(url, future=True)

        @event.listens_for(_engine, "connect")
        def _pragmas(dbapi_conn: Any, _rec: Any) -> None:
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=10000")
            cur.close()

        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def init_db(url: str | None = None) -> Engine:
    eng = get_engine(url)
    Base.metadata.create_all(eng)
    migrate(eng)
    return eng


def migrate(eng: Engine) -> list[str]:
    """Minimal forward-only migration: add any model column missing from an existing table."""
    added: list[str] = []
    insp = inspect(eng)
    with eng.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have:
                    ddl = col.type.compile(dialect=eng.dialect)
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl}'))
                    added.append(f"{table.name}.{col.name}")
    return added


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _Session is not None
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()

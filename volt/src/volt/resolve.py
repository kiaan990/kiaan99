"""Nightly resolution: one outcomes row per tracked event whose start has passed (all events, not just trades)."""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from volt.db import CvBookSnapshot, CvEventSnapshot, Event, EventStatus, Outcome, Side, SignalSnapshot, utcnow
from volt.paper import asks_around

HALF = timedelta(hours=6)


def _median_ask(session: Session, event_id: int, at: datetime) -> int | None:
    asks = asks_around(session, event_id, at, HALF)
    return int(statistics.median(asks)) if asks else None


def resolve_event(session: Session, ev: Event, now: datetime) -> Outcome:
    assert ev.starts_at is not None
    s = ev.starts_at
    t2, t1, t0 = s - timedelta(days=2), s - timedelta(days=1), s
    sold_signal = session.scalar(select(func.min(SignalSnapshot.captured_at)).where(
        SignalSnapshot.event_id == ev.id, SignalSnapshot.signal_name == "dice_sold_out", SignalSnapshot.value == 1.0))
    first_sold = ev.first_sold_out_at or sold_signal
    peak_bid = session.scalar(select(func.max(CvEventSnapshot.highest_bid_cents)).where(
        CvEventSnapshot.event_id == ev.id, CvEventSnapshot.captured_at <= s))
    peak_book_bid = session.scalar(select(func.max(CvBookSnapshot.price_cents)).where(
        CvBookSnapshot.event_id == ev.id, CvBookSnapshot.side == Side.BID, CvBookSnapshot.captured_at <= s))
    peaks = [p for p in (peak_bid, peak_book_bid) if p is not None]
    snap_t2 = session.scalar(select(CvEventSnapshot).where(
        CvEventSnapshot.event_id == ev.id, CvEventSnapshot.captured_at <= t2 + HALF)
        .order_by(CvEventSnapshot.captured_at.desc()).limit(1))
    last_sale_t2 = session.scalar(select(CvEventSnapshot.last_sale_cents).where(
        CvEventSnapshot.event_id == ev.id, CvEventSnapshot.captured_at <= t2,
        CvEventSnapshot.last_sale_cents.is_not(None)).order_by(CvEventSnapshot.captured_at.desc()).limit(1))
    med_t2 = _median_ask(session, ev.id, t2)
    ref = last_sale_t2 if last_sale_t2 is not None else med_t2
    multiple = (ref / ev.face_value_cents) if (ref is not None and ev.face_value_cents) else None
    depth = None
    if snap_t2 is not None and abs(snap_t2.captured_at - t2) <= timedelta(hours=12):
        depth = snap_t2.ask_count

    out = session.scalar(select(Outcome).where(Outcome.event_id == ev.id))
    if out is None:
        out = Outcome(event_id=ev.id, sold_out=False, added_date=False)
        session.add(out)
    out.resolved_at = now
    out.sold_out = first_sold is not None
    out.sold_out_days_before = (s - first_sold).total_seconds() / 86400 if first_sold else None
    out.added_date = bool(ev.added_date_flag)
    out.peak_bid_cents = max(peaks) if peaks else None
    out.median_ask_t2_cents = med_t2
    out.median_ask_t1_cents = _median_ask(session, ev.id, t1)
    out.median_ask_t0_cents = _median_ask(session, ev.id, t0)
    out.last_sale_t2_cents = last_sale_t2
    out.clearing_multiple = multiple
    out.book_depth_t2 = depth
    if ev.status != EventStatus.CANCELLED:
        ev.status = EventStatus.PAST
    return out


def resolve_all(session: Session, now: datetime | None = None) -> list[Outcome]:
    now = now or utcnow()
    evs = session.scalars(select(Event).where(Event.merged_into_id.is_(None), Event.starts_at.is_not(None),
                                              Event.starts_at < now))
    outs = [resolve_event(session, e, now) for e in evs]
    session.flush()
    return outs

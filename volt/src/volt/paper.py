"""Paper trades: open once per event when gates pass and score >= threshold; close at T-2 days.

No money moves and nothing is bought. These rows only measure what the model would have done.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from volt.config import get_settings
from volt.db import CvBookSnapshot, CvEventSnapshot, Event, PaperTrade, Side, TradeStatus, utcnow
from volt.scoring import ScoreResult, lowest_available_tier

CLOSE_HALF_WINDOW = timedelta(hours=6)  # "median ask observed in the 12 h around target_sell_at"


def open_trades(session: Session, results: list[ScoreResult], now: datetime | None = None) -> list[PaperTrade]:
    s = get_settings()
    now = now or utcnow()
    opened = []
    for r in results:
        if not r.gates_passed or r.score < s.score_threshold:
            continue
        if session.scalar(select(PaperTrade.id).where(PaperTrade.event_id == r.event_id)):
            continue  # once per event
        ev = session.get(Event, r.event_id)
        low = r.lowest_tier or lowest_available_tier(session, r.event_id)
        if ev is None or ev.starts_at is None or low is None or low["price_cents"] is None:
            continue
        t = PaperTrade(
            event_id=ev.id,
            opened_at=now,
            buy_tier_name=f"{low['provider']}: {low['name']}",
            buy_price_cents=int(low["price_cents"]),
            qty=s.paper_qty,
            target_sell_at=ev.starts_at - timedelta(days=2),
            fee_pct=s.paper_fee_pct,
            status=TradeStatus.OPEN,
        )
        session.add(t)
        opened.append(t)
    session.flush()
    return opened


def asks_around(session: Session, event_id: int, at: datetime, half: timedelta = CLOSE_HALF_WINDOW) -> list[int]:
    """Every CrowdVolt ask price seen in [at-half, at+half]; falls back to snapshot lowest asks."""
    lo, hi = at - half, at + half
    prices = [
        p
        for (p,) in session.execute(
            select(CvBookSnapshot.price_cents).where(
                CvBookSnapshot.event_id == event_id,
                CvBookSnapshot.side == Side.ASK,
                CvBookSnapshot.captured_at >= lo,
                CvBookSnapshot.captured_at <= hi,
                CvBookSnapshot.price_cents.is_not(None),
            )
        )
    ]
    if not prices:
        prices = [
            p
            for (p,) in session.execute(
                select(CvEventSnapshot.lowest_ask_cents).where(
                    CvEventSnapshot.event_id == event_id,
                    CvEventSnapshot.captured_at >= lo,
                    CvEventSnapshot.captured_at <= hi,
                    CvEventSnapshot.lowest_ask_cents.is_not(None),
                )
            )
        ]
    return [int(p) for p in prices if p is not None]


def close_due(session: Session, now: datetime | None = None) -> list[PaperTrade]:
    now = now or utcnow()
    closed = []
    for t in session.scalars(select(PaperTrade).where(PaperTrade.status == TradeStatus.OPEN)):
        if now < t.target_sell_at + CLOSE_HALF_WINDOW:
            continue  # wait until the whole 12 h window has been observed
        asks = asks_around(session, t.event_id, t.target_sell_at)
        t.closed_at = now
        if not asks:
            t.status = TradeStatus.NO_MARKET
        else:
            med = statistics.median(asks)
            t.sell_price_cents = int(round(med * (1 - t.fee_pct)))
            t.pnl_cents = (t.sell_price_cents - t.buy_price_cents) * t.qty
            t.status = TradeStatus.CLOSED
        closed.append(t)
    session.flush()
    return closed


def trade_multiple(t: PaperTrade) -> float | None:
    if t.sell_price_cents is None or not t.buy_price_cents:
        return None
    return t.sell_price_cents / t.buy_price_cents


def summary(session: Session) -> list[dict[str, Any]]:
    out = []
    for t in session.scalars(select(PaperTrade).order_by(PaperTrade.opened_at)):
        ev = session.get(Event, t.event_id)
        out.append({"trade": t, "event": ev, "multiple": trade_multiple(t)})
    return out

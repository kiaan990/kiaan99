"""Hard gates + 0-100 score. Formulas are documented in docs/SIGNALS.md; weights in config/weights.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from volt.config import load_yaml, weights
from volt.db import (
    Brand,
    CvEventSnapshot,
    Event,
    EventStatus,
    Score,
    SignalSnapshot,
    TierSnapshot,
    Venue,
    utcnow,
)

NY = ZoneInfo("America/New_York")


@dataclass
class ScoreResult:
    event_id: int
    gates_passed: bool
    gate_failures: list[str]
    score: float
    components: dict[str, Any]
    days_to_event: float | None
    note: str | None = None
    lowest_tier: dict[str, Any] | None = field(default=None)


# ------------------------------------------------------------ helpers


def local_night(starts_at: datetime, rollover_hour: int = 6) -> date:
    """Local calendar night of an event: a 02:00 start belongs to the previous evening."""
    loc = starts_at.astimezone(NY)
    if loc.hour < rollover_hour:
        loc -= timedelta(days=1)
    return loc.date()


def latest_tiers(session: Session, event_id: int) -> list[TierSnapshot]:
    """Tier rows from the most recent crawl, per provider (RA has full tier lists; Dice one summary row)."""
    out: list[TierSnapshot] = []
    for prov in session.scalars(select(TierSnapshot.provider).where(TierSnapshot.event_id == event_id).distinct()):
        last_run = session.scalar(
            select(TierSnapshot.crawl_run_id)
            .where(TierSnapshot.event_id == event_id, TierSnapshot.provider == prov)
            .order_by(TierSnapshot.captured_at.desc())
            .limit(1)
        )
        out += list(
            session.scalars(
                select(TierSnapshot).where(
                    TierSnapshot.event_id == event_id,
                    TierSnapshot.provider == prov,
                    TierSnapshot.crawl_run_id == last_run,
                )
            )
        )
    return out


def dice_price_steps(session: Session, event_id: int, since: datetime | None = None) -> int:
    """Number of times Dice's lowest available price went up (plus a final step to sold out)."""
    rows = list(
        session.execute(
            select(TierSnapshot.captured_at, TierSnapshot.price_cents, TierSnapshot.available)
            .where(TierSnapshot.event_id == event_id, TierSnapshot.provider == "DICE")
            .order_by(TierSnapshot.captured_at)
        )
    )
    steps, prev_price, prev_avail = 0, None, None
    for at, price, avail in rows:
        if prev_avail is not None and (since is None or at >= since):
            if prev_avail and not avail:
                steps += 1
            elif avail and prev_avail and price is not None and prev_price is not None and price > prev_price:
                steps += 1
        prev_price, prev_avail = (price if avail else prev_price), avail
    return steps


def lowest_available_tier(session: Session, event_id: int) -> dict[str, Any] | None:
    """Cheapest tier still on sale in the latest crawl, with a 1-based tier index."""
    tiers = latest_tiers(session, event_id)
    avail = [t for t in tiers if t.available and t.price_cents is not None]
    if not avail:
        return None
    t = min(avail, key=lambda x: x.price_cents or 0)
    idx = t.tier_index
    if idx is None and t.provider == "DICE":
        idx = 1 + dice_price_steps(session, event_id)
    return {"provider": t.provider, "name": t.tier_name, "price_cents": t.price_cents, "index": idx}


def tiers_sold_in_window(session: Session, event_id: int, now: datetime, days: int) -> int:
    since = now - timedelta(days=days)
    n = 0
    # RA (and any provider with named tiers): a tier counts when it is first seen unavailable after having
    # been seen available, and that flip happened inside the window.
    rows = session.execute(
        select(TierSnapshot.tier_name, TierSnapshot.captured_at, TierSnapshot.available)
        .where(TierSnapshot.event_id == event_id, TierSnapshot.provider != "DICE")
        .order_by(TierSnapshot.tier_name, TierSnapshot.captured_at)
    )
    state: dict[str, bool] = {}
    flipped: set[str] = set()
    for name, at, avail in rows:
        if state.get(name) is True and not avail and name not in flipped and at >= since:
            flipped.add(name)
            n += 1
        state[name] = avail
    n += dice_price_steps(session, event_id, since)
    return n


def latest_signal(session: Session, event_id: int, name: str) -> float | None:
    return session.scalar(
        select(SignalSnapshot.value)
        .where(
            SignalSnapshot.event_id == event_id, SignalSnapshot.signal_name == name, SignalSnapshot.value.is_not(None)
        )
        .order_by(SignalSnapshot.captured_at.desc())
        .limit(1)
    )


def latest_cv(session: Session, event_id: int) -> CvEventSnapshot | None:
    return session.scalar(
        select(CvEventSnapshot)
        .where(CvEventSnapshot.event_id == event_id)
        .order_by(CvEventSnapshot.captured_at.desc())
        .limit(1)
    )


def calendar_points(night: date, cal: dict[str, Any]) -> tuple[int, str]:
    for e in cal.get("peak_25") or []:
        if e["date"] == night:
            return 25, e.get("label", "peak")
    for e in cal.get("peak_18") or []:
        if e["date"] == night:
            return 18, e.get("label", "peak")
    if night.weekday() in (4, 5):
        return int(cal.get("ordinary_weekend_points", 8)), "Fri/Sat"
    return int(cal.get("other_points", 0)), "weeknight"


# ------------------------------------------------------------ core


def score_event(
    session: Session,
    ev: Event,
    now: datetime | None = None,
    w: dict[str, Any] | None = None,
    cal: dict[str, Any] | None = None,
) -> ScoreResult:
    now = now or utcnow()
    w = w or weights()
    cal = cal or load_yaml("calendar.yaml")
    g, c = w["gates"], w["components"]
    fails: list[str] = []
    days = (ev.starts_at - now).total_seconds() / 86400 if ev.starts_at else None
    venue = session.get(Venue, ev.venue_id) if ev.venue_id else None
    brand = session.get(Brand, ev.brand_id) if ev.brand_id else None
    brand_tier = brand.tier if brand else 3

    # gate 1: CrowdVolt listable with an allowed wallet
    if ev.cv_listable is not True:
        fails.append("G1: not listable on CrowdVolt")
    elif (ev.cv_wallet_type or "").upper() not in g["wallet_types"]:
        fails.append(f"G1: wallet {ev.cv_wallet_type or '?'} not in {'/'.join(g['wallet_types'])}")
    # gate 2: venue capacity and flip_ok
    if venue is None:
        fails.append("G2: venue unknown")
    else:
        if not venue.flip_ok:
            fails.append(f"G2: {venue.name} flip_ok=false")
        if venue.capacity is None or not (g["capacity_min"] <= venue.capacity <= g["capacity_max"]):
            fails.append(f"G2: capacity {venue.capacity} outside {g['capacity_min']}-{g['capacity_max']}")
    # gate 3: brand tier
    if brand_tier not in g["allowed_brand_tiers"]:
        fails.append(f"G3: brand tier {brand_tier}")
    # gate 4: added date / recent sell-out
    if ev.added_date_flag:
        fails.append("G4: added date")
    if ev.first_sold_out_at is not None and now - ev.first_sold_out_at <= timedelta(days=g["sold_out_min_age_days"]):
        fails.append(f"G4: sold out < {g['sold_out_min_age_days']}d ago")
    # gate 5: inventory still on sale at an early tier
    low = lowest_available_tier(session, ev.id)
    if low is None:
        fails.append("G5: no tier available (or no tier data)")
    elif low["index"] is None or low["index"] > g["max_lowest_available_tier_index"]:
        fails.append(f"G5: lowest available tier index {low['index']} > {g['max_lowest_available_tier_index']}")
    # gate 6: window
    if days is None:
        fails.append("G6: no start time")
    elif not (g["days_to_event_min"] <= days <= g["days_to_event_max"]):
        fails.append(f"G6: {days:.1f} days to event outside {g['days_to_event_min']}-{g['days_to_event_max']}")

    comp: dict[str, Any] = {}
    # calendar_peak
    if ev.starts_at:
        pts, why = calendar_points(local_night(ev.starts_at, int(cal.get("night_rollover_hour", 6))), cal)
    else:
        pts, why = 0, "no date"
    comp["calendar_peak"] = {"points": pts, "why": why}
    # tier_velocity
    tv = c["tier_velocity"]
    sold = tiers_sold_in_window(session, ev.id, now, tv["window_days"])
    comp["tier_velocity"] = {
        "points": tv["two_or_more"] if sold >= 2 else tv["one"] if sold == 1 else tv["zero"],
        "tiers_sold_7d": sold,
    }
    # brand_tier
    bt = c["brand_tier"]
    comp["brand_tier"] = {
        "points": {1: bt["tier1"], 2: bt["tier2"]}.get(brand_tier, bt.get("tier3", 0)),
        "tier": brand_tier,
        "brand": brand.name if brand else None,
    }
    # cv_book
    cb = c["cv_book"]
    cv = latest_cv(session, ev.id)
    face = ev.face_value_cents
    if (
        cv
        and face
        and cv.highest_bid_cents is not None
        and cv.highest_bid_cents >= face
        and (cv.ask_count is not None and cv.bid_count is not None and cv.ask_count <= cv.bid_count)
    ):
        cvp, cvwhy = cb["strong"], "bid >= face and asks <= bids"
    elif cv and face and cv.highest_bid_cents is not None and cv.highest_bid_cents >= cb["near_face_ratio"] * face:
        cvp, cvwhy = cb["near_face"], f"bid >= {cb['near_face_ratio']}x face"
    else:
        cvp, cvwhy = cb["weak"], "weak/no book" if cv else "no CrowdVolt snapshot"
    comp["cv_book"] = {
        "points": cvp,
        "why": cvwhy,
        "highest_bid": cv.highest_bid_cents if cv else None,
        "face": face,
        "asks": cv.ask_count if cv else None,
        "bids": cv.bid_count if cv else None,
    }
    # scarcity_event
    comp["scarcity_event"] = {"points": c["scarcity_event"]["flagged"] if ev.scarcity_flag else 0}
    # competing_supply
    cs = c["competing_supply"]
    pen, why_l = 0, []
    if latest_signal(session, ev.id, "dice_waitlist_on") == 1.0:
        pen += cs["dice_waitlist_on"]
        why_l.append("dice waitlist on")
    if ev.starts_at and has_same_night_tier1(session, ev):
        pen += cs["same_date_tier1"]
        why_l.append("another Tier-1 event same night")
    comp["competing_supply"] = {"points": pen, "why": why_l}

    total = sum(v["points"] for v in comp.values())
    total = max(0.0, min(100.0, float(total)))
    note = None
    if ev.status == EventStatus.CANCELLED:
        note = "cancelled"
    return ScoreResult(ev.id, not fails, fails, total, comp, days, note, low)


def has_same_night_tier1(session: Session, ev: Event) -> bool:
    assert ev.starts_at is not None
    night = local_night(ev.starts_at)
    lo, hi = ev.starts_at - timedelta(days=1), ev.starts_at + timedelta(days=1)
    rows = session.execute(
        select(Event)
        .join(Brand, Brand.id == Event.brand_id)
        .where(
            Event.id != ev.id,
            Event.merged_into_id.is_(None),
            Brand.tier == 1,
            Event.starts_at >= lo,
            Event.starts_at <= hi,
            Event.status != EventStatus.CANCELLED,
        )
    )
    return any(o.starts_at is not None and local_night(o.starts_at) == night for (o,) in rows)


def events_to_score(session: Session, now: datetime, days_ahead: int = 60) -> list[Event]:
    return list(
        session.scalars(
            select(Event)
            .where(
                Event.merged_into_id.is_(None),
                Event.starts_at.is_not(None),
                Event.starts_at >= now - timedelta(hours=12),
                Event.starts_at <= now + timedelta(days=days_ahead),
            )
            .order_by(Event.starts_at)
        )
    )


def score_all(session: Session, now: datetime | None = None) -> list[ScoreResult]:
    now = now or utcnow()
    w, cal = weights(), load_yaml("calendar.yaml")
    out = []
    for ev in events_to_score(session, now):
        r = score_event(session, ev, now, w, cal)
        session.add(
            Score(
                event_id=ev.id,
                scored_at=now,
                gates_passed=r.gates_passed,
                gate_failures=r.gate_failures,
                score=r.score,
                components=r.components,
                days_to_event=r.days_to_event,
                note=r.note,
            )
        )
        out.append(r)
    session.flush()
    return out


def latest_scores(session: Session) -> list[tuple[Event, Score]]:
    sub = select(Score.event_id, func.max(Score.id).label("mid")).group_by(Score.event_id).subquery()
    rows = session.execute(
        select(Event, Score)
        .join(sub, sub.c.event_id == Event.id)
        .join(Score, Score.id == sub.c.mid)
        .where(Event.merged_into_id.is_(None))
    )
    return [(e, s) for e, s in rows]

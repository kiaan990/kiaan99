from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from conftest import NOW, at
from volt import scoring
from volt.db import Brand, CvEventSnapshot, Event, EventStatus, SignalSnapshot, TierSnapshot, Venue


def venue(s, name: str) -> Venue:
    v = s.scalar(select(Venue).where(Venue.name == name))
    assert v is not None
    return v


def brand(s, name: str) -> Brand:
    b = s.scalar(select(Brand).where(Brand.name == name))
    assert b is not None
    return b


def make_event(
    s,
    run_id: int,
    *,
    starts: datetime | None = None,
    venue_name: str = "Knockdown Center",
    brand_name: str | None = "Circoloco",
    wallet: str | None = "DICE",
    tiers=((1, 5000, True),),
    face: int | None = 5000,
    title: str = "Test Night",
) -> Event:
    ev = Event(
        title=title,
        starts_at=starts or at(days=10),
        venue_id=venue(s, venue_name).id,
        brand_id=brand(s, brand_name).id if brand_name else None,
        cv_listable=wallet is not None,
        cv_wallet_type=wallet,
        face_value_cents=face,
        status=EventStatus.ON_SALE,
        lineup=[],
    )
    s.add(ev)
    s.flush()
    for idx, price, avail in tiers:
        s.add(
            TierSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                provider="RA",
                tier_name=f"tier {idx}",
                tier_index=idx,
                price_cents=price,
                available=avail,
                captured_at=NOW - timedelta(hours=1),
            )
        )
    s.flush()
    return ev


def score(s, ev: Event) -> scoring.ScoreResult:
    return scoring.score_event(s, ev, NOW)


def test_all_gates_pass(session, run_id) -> None:
    r = score(session, make_event(session, run_id))
    assert r.gates_passed, r.gate_failures


# ------------------------------------------------------------------ gates


@pytest.mark.parametrize(
    "wallet,listable,expect", [("DICE", True, None), ("POSH", True, None), ("AXS", True, "G1"), (None, False, "G1")]
)
def test_gate1_wallet(session, run_id, wallet, listable, expect) -> None:
    ev = make_event(session, run_id, wallet=wallet)
    ev.cv_listable = listable
    fails = score(session, ev).gate_failures
    assert any(f.startswith("G1") for f in fails) == bool(expect)


@pytest.mark.parametrize(
    "vname,ok",
    [
        ("Knockdown Center", True),
        ("Pacha New York", True),
        ("Brooklyn Pacha", False),
        ("Elsewhere", False),
        ("Basement", False),
    ],
)
def test_gate2_capacity_and_flip_ok(session, run_id, vname, ok) -> None:
    fails = score(session, make_event(session, run_id, venue_name=vname)).gate_failures
    assert (not any(f.startswith("G2") for f in fails)) == ok


def test_gate2_basement_flip_ok_false(session, run_id) -> None:
    fails = score(session, make_event(session, run_id, venue_name="Basement")).gate_failures
    assert any("flip_ok=false" in f for f in fails)


@pytest.mark.parametrize("bname,ok", [("Circoloco", True), ("Cityfox", True), (None, False)])
def test_gate3_brand_tier(session, run_id, bname, ok) -> None:
    fails = score(session, make_event(session, run_id, brand_name=bname)).gate_failures
    assert (not any(f.startswith("G3") for f in fails)) == ok


def test_gate4_added_date(session, run_id) -> None:
    ev = make_event(session, run_id)
    ev.added_date_flag = True
    assert any("added date" in f for f in score(session, ev).gate_failures)


@pytest.mark.parametrize("days_ago,ok", [(2, False), (5, False), (6, True)])
def test_gate4_recent_sellout(session, run_id, days_ago, ok) -> None:
    ev = make_event(session, run_id)
    ev.first_sold_out_at = NOW - timedelta(days=days_ago)
    fails = score(session, ev).gate_failures
    assert (not any(f.startswith("G4") for f in fails)) == ok


@pytest.mark.parametrize(
    "tiers,ok",
    [
        (((1, 5000, True), (2, 6000, True)), True),
        (((1, 5000, False), (2, 6000, True)), True),
        (((1, 5000, False), (2, 6000, False), (3, 7000, True)), False),
        (((1, 5000, False),), False),
        ((), False),
    ],
)
def test_gate5_tier_available(session, run_id, tiers, ok) -> None:
    fails = score(session, make_event(session, run_id, tiers=tiers)).gate_failures
    assert (not any(f.startswith("G5") for f in fails)) == ok


def test_gate5_dice_price_steps_as_index(session, run_id) -> None:
    ev = make_event(session, run_id, tiers=())
    for i, price in enumerate([3000, 4000, 5000]):  # two price rises → lowest available is tier 3
        session.add(
            TierSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                provider="DICE",
                tier_name="lowest available",
                price_cents=price,
                available=True,
                captured_at=NOW - timedelta(days=3 - i),
            )
        )
    session.flush()
    low = scoring.lowest_available_tier(session, ev.id)
    assert low is not None and low["index"] == 3
    assert any(f.startswith("G5") for f in score(session, ev).gate_failures)


@pytest.mark.parametrize("days,ok", [(2.5, False), (3.5, True), (27, True), (29, False)])
def test_gate6_window(session, run_id, days, ok) -> None:
    fails = score(session, make_event(session, run_id, starts=at(days=days))).gate_failures
    assert (not any(f.startswith("G6") for f in fails)) == ok


# ------------------------------------------------------------------ components


def comp(r: scoring.ScoreResult, name: str) -> int:
    return int(r.components[name]["points"])


@pytest.mark.parametrize(
    "local,pts",
    [
        (datetime(2026, 10, 31, 22, 0), 25),  # Halloween Sat
        (datetime(2026, 11, 1, 2, 0), 25),  # 2am Sunday still Halloween night
        (datetime(2026, 12, 31, 22, 0), 25),
        (datetime(2027, 1, 1, 22, 0), 18),
        (datetime(2026, 11, 25, 22, 0), 18),  # Thanksgiving Eve (Wed)
        (datetime(2026, 11, 6, 22, 0), 8),  # ordinary Friday
        (datetime(2026, 11, 4, 22, 0), 0),  # Wednesday
    ],
)
def test_calendar_peak(session, run_id, local, pts) -> None:
    from zoneinfo import ZoneInfo

    starts = local.replace(tzinfo=ZoneInfo("America/New_York")).astimezone(UTC)
    assert comp(score(session, make_event(session, run_id, starts=starts)), "calendar_peak") == pts


@pytest.mark.parametrize("flips,pts", [(0, 0), (1, 12), (2, 20), (3, 20)])
def test_tier_velocity(session, run_id, flips, pts) -> None:
    ev = make_event(session, run_id, tiers=())
    for i in range(1, 5):
        session.add(
            TierSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                provider="RA",
                tier_name=f"t{i}",
                tier_index=i,
                price_cents=1000 * i,
                available=True,
                captured_at=NOW - timedelta(days=6),
            )
        )
        session.add(
            TierSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                provider="RA",
                tier_name=f"t{i}",
                tier_index=i,
                price_cents=1000 * i,
                available=i > flips,
                captured_at=NOW - timedelta(days=1),
            )
        )
    session.flush()
    assert comp(score(session, ev), "tier_velocity") == pts


def test_tier_velocity_ignores_old_flips(session, run_id) -> None:
    ev = make_event(session, run_id, tiers=())
    for when, avail in ((12, True), (9, False), (1, False)):
        session.add(
            TierSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                provider="RA",
                tier_name="t1",
                tier_index=1,
                price_cents=1000,
                available=avail,
                captured_at=NOW - timedelta(days=when),
            )
        )
    session.flush()
    assert comp(score(session, ev), "tier_velocity") == 0


@pytest.mark.parametrize("bname,pts", [("Circoloco", 20), ("Cityfox", 10), (None, 0)])
def test_brand_tier(session, run_id, bname, pts) -> None:
    assert comp(score(session, make_event(session, run_id, brand_name=bname)), "brand_tier") == pts


@pytest.mark.parametrize(
    "bid,asks,bids,pts",
    [
        (5000, 3, 5, 15),  # bid >= face and asks <= bids
        (5000, 9, 5, 7),  # bid >= face but more asks than bids → falls to near-face rule
        (4100, 1, 5, 7),  # bid >= 0.8 face
        (3000, 1, 5, 3),
        (None, None, None, 3),
    ],
)
def test_cv_book(session, run_id, bid, asks, bids, pts) -> None:
    ev = make_event(session, run_id, face=5000)
    session.add(
        CvEventSnapshot(
            event_id=ev.id, crawl_run_id=run_id, highest_bid_cents=bid, ask_count=asks, bid_count=bids, captured_at=NOW
        )
    )
    session.flush()
    assert comp(score(session, ev), "cv_book") == pts


def test_cv_book_no_snapshot(session, run_id) -> None:
    assert comp(score(session, make_event(session, run_id)), "cv_book") == 3


def test_scarcity_flag(session, run_id) -> None:
    ev = make_event(session, run_id)
    assert comp(score(session, ev), "scarcity_event") == 0
    ev.scarcity_flag = True
    assert comp(score(session, ev), "scarcity_event") == 10


def test_competing_supply(session, run_id) -> None:
    ev = make_event(session, run_id, starts=at(days=8, hours=3))
    assert comp(score(session, ev), "competing_supply") == 0
    session.add(
        SignalSnapshot(event_id=ev.id, crawl_run_id=run_id, signal_name="dice_waitlist_on", value=1.0, captured_at=NOW)
    )
    session.flush()
    assert comp(score(session, ev), "competing_supply") == -5
    make_event(session, run_id, starts=at(days=8, hours=5), title="Other Tier 1", brand_name="Keinemusik")
    assert comp(score(session, ev), "competing_supply") == -10


def test_competing_supply_ignores_tier2_and_other_nights(session, run_id) -> None:
    ev = make_event(session, run_id, starts=at(days=8, hours=3))
    make_event(session, run_id, starts=at(days=8, hours=4), title="t2", brand_name="Cityfox")
    make_event(session, run_id, starts=at(days=9, hours=3), title="next night", brand_name="Keinemusik")
    assert comp(score(session, ev), "competing_supply") == 0


def test_total_and_clamp(session, run_id) -> None:
    from zoneinfo import ZoneInfo

    starts = datetime(2026, 11, 7, 22, 0, tzinfo=ZoneInfo("America/New_York"))  # Sat, 8 days out
    ev = make_event(session, run_id, starts=starts.astimezone(UTC))
    ev.scarcity_flag = True
    r = score(session, ev)
    assert r.score == 8 + 0 + 20 + 3 + 10 + 0
    assert 0 <= r.score <= 100


def test_score_all_appends_rows(session, run_id) -> None:
    from volt.db import Score

    make_event(session, run_id)
    scoring.score_all(session, NOW)
    scoring.score_all(session, NOW + timedelta(hours=1))
    assert len(list(session.scalars(select(Score)))) == 2

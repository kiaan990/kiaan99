"""Matching, paper trades, resolution, evaluation, digest, politeness plumbing."""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from conftest import NOW, at
from test_scoring import make_event
from volt import matching, paper, resolve, scoring
from volt.crawlers.base import FetchError, RateLimited, ResponseCache, TokenBucket, cents, with_backoff
from volt.db import (
    CvBookSnapshot,
    CvEventSnapshot,
    Event,
    EventSource,
    Outcome,
    PaperTrade,
    Side,
    TradeStatus,
)

# ------------------------------------------------------------------ matching


def test_venue_resolution(session) -> None:
    assert matching.resolve_venue(session, "Brooklyn Storehouse").name == "Brooklyn Storehouse"
    assert matching.resolve_venue(session, "Pacha NYC").name == "Pacha New York"
    assert matching.resolve_venue(session, "Pacha Brooklyn").name == "Brooklyn Pacha"
    assert matching.resolve_venue(session, "Knockdown Centre").name == "Knockdown Center"
    assert matching.resolve_venue(session, "Some Bar") is None


def test_brand_detection(session) -> None:
    assert matching.detect_brand(session, "Teksupport: Circoloco Halloween", None, None).name == "Circoloco"
    assert matching.detect_brand(session, "Night", "Cityfox", None).name == "Cityfox"
    assert matching.detect_brand(session, "Warehouse", None, ["Black Coffee"]).name == "Black Coffee"
    assert matching.detect_brand(session, "Moondog presents DISCO AFTERLIFE", None, None) is None  # prefix-only
    assert matching.detect_brand(session, "Afterlife NYC: Anyma", None, None).name == "Afterlife"
    assert matching.detect_brand(session, "Fisherman's Ball", None, None) is None


def test_day_discriminators_block_wrong_night() -> None:
    sat = at(days=1, hours=7)  # Sat Oct 31 22:00 ET = Nov 1 02:00 UTC
    sun = sat + timedelta(hours=17)
    assert matching.pair_confidence("CircoLoco New York", "Circoloco Halloween (Sunday)", sat, sun, 100)[0] == 0
    assert matching.pair_confidence("CircoLoco New York", "Circoloco Halloween (Sat)", sat, sat, 100)[0] == 100
    assert (
        matching.pair_confidence("Circoloco (Friday)", "Circoloco (Saturday)", sat - timedelta(days=1), sat, 100)[0]
        == 0
    )


def test_upsert_matches_across_sites_and_review(session) -> None:
    starts = at(days=5)
    a, _, created = matching.upsert_event_from_source(
        session,
        site="ra",
        external_id="1",
        url="u1",
        title="Keinemusik",
        starts_at=starts,
        venue_name="Knockdown Center",
    )
    b, src, created2 = matching.upsert_event_from_source(
        session,
        site="dice",
        external_id="d1",
        url="u2",
        title="Keinemusik NYC",
        starts_at=starts + timedelta(hours=1),
        venue_name="Knockdown",
    )
    assert created and not created2 and a.id == b.id and src.match_confidence >= matching.MATCH_THRESHOLD
    c, _, created3 = matching.upsert_event_from_source(
        session,
        site="dice",
        external_id="d2",
        url="u3",
        title="Totally Different",
        starts_at=starts,
        venue_name="Knockdown Center",
    )
    assert created3 and c.id != a.id


def test_run_matching_merges_and_relinks_snapshots(session, run_id) -> None:
    starts = at(days=5)
    e1 = Event(title="Solomun All Night Long", starts_at=starts, venue_name_raw="Knockdown Center", lineup=[])
    e2 = Event(title="Solomun - All Night Long", starts_at=starts, venue_name_raw="Knockdown Center", lineup=[])
    session.add_all([e1, e2])
    session.flush()
    session.add_all(
        [
            EventSource(event_id=e1.id, site="ra", external_id="r"),
            EventSource(event_id=e2.id, site="dice", external_id="d"),
            CvEventSnapshot(event_id=e2.id, crawl_run_id=run_id, lowest_ask_cents=100, captured_at=NOW),
        ]
    )
    session.flush()
    r = matching.run_matching(session)
    assert r["merged"] == 1
    assert e2.merged_into_id == e1.id
    snap = session.scalar(select(CvEventSnapshot))
    assert snap.event_id == e1.id and snap.lowest_ask_cents == 100
    assert e1.brand_id is not None  # Solomun detected


# ------------------------------------------------------------------ paper + resolve


def _gated(session, run_id):
    ev = make_event(session, run_id, starts=at(days=8), face=5000)
    ev.scarcity_flag = True
    return ev


def test_paper_opens_once_above_threshold(session, run_id, monkeypatch) -> None:
    ev = _gated(session, run_id)
    r = scoring.score_event(session, ev, NOW)
    r.score = 75.0  # force over threshold
    t = paper.open_trades(session, [r], NOW)
    assert len(t) == 1 and t[0].qty == 4 and t[0].buy_price_cents == 5000
    assert t[0].target_sell_at == ev.starts_at - timedelta(days=2)
    assert paper.open_trades(session, [r], NOW) == []  # once per event


def test_paper_not_opened_when_gates_fail_or_low(session, run_id) -> None:
    ev = _gated(session, run_id)
    r = scoring.score_event(session, ev, NOW)
    r.score = 69.9
    assert paper.open_trades(session, [r], NOW) == []
    r.score, r.gates_passed = 90, False
    assert paper.open_trades(session, [r], NOW) == []


def test_paper_close_median_minus_fee(session, run_id) -> None:
    ev = _gated(session, run_id)
    t = PaperTrade(
        event_id=ev.id,
        opened_at=NOW,
        buy_tier_name="RA: t1",
        buy_price_cents=5000,
        qty=4,
        target_sell_at=at(days=6),
        fee_pct=0.04,
    )
    session.add(t)
    for h, p in ((-5, 9000), (0, 10000), (4, 11000), (-8, 1)):  # last one outside the 12 h window
        session.add(
            CvBookSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                side=Side.ASK,
                price_cents=p,
                quantity=1,
                captured_at=at(days=6, hours=h),
            )
        )
    session.flush()
    assert paper.close_due(session, at(days=6, hours=1)) == []  # window not complete yet
    paper.close_due(session, at(days=6, hours=7))
    assert t.status == TradeStatus.CLOSED
    assert t.sell_price_cents == 9600 and t.pnl_cents == (9600 - 5000) * 4
    assert paper.trade_multiple(t) == pytest.approx(1.92)


def test_paper_no_market(session, run_id) -> None:
    ev = _gated(session, run_id)
    t = PaperTrade(event_id=ev.id, opened_at=NOW, buy_price_cents=5000, qty=4, target_sell_at=at(days=1), fee_pct=0.04)
    session.add(t)
    session.flush()
    paper.close_due(session, at(days=2))
    assert t.status == TradeStatus.NO_MARKET and t.pnl_cents is None


def test_resolve_outcome(session, run_id) -> None:
    ev = make_event(session, run_id, starts=at(days=-1), face=5000)
    ev.first_sold_out_at = at(days=-4)
    s = ev.starts_at
    for days, ask, bid, sale in ((2, 8000, 6000, 7500), (1, 9000, 7000, None), (0, 10000, 6500, None)):
        when = s - timedelta(days=days)
        session.add(
            CvEventSnapshot(
                event_id=ev.id,
                crawl_run_id=run_id,
                lowest_ask_cents=ask,
                highest_bid_cents=bid,
                last_sale_cents=sale,
                ask_count=12,
                bid_count=3,
                captured_at=when,
            )
        )
        session.add(
            CvBookSnapshot(
                event_id=ev.id, crawl_run_id=run_id, side=Side.ASK, price_cents=ask, quantity=1, captured_at=when
            )
        )
    session.flush()
    outs = resolve.resolve_all(session, NOW)
    o = session.scalar(select(Outcome).where(Outcome.event_id == ev.id))
    assert outs and o is not None
    assert o.sold_out and o.sold_out_days_before == pytest.approx(3)
    assert o.peak_bid_cents == 7000
    assert (o.median_ask_t2_cents, o.median_ask_t1_cents, o.median_ask_t0_cents) == (8000, 9000, 10000)
    assert o.last_sale_t2_cents == 7500
    assert o.clearing_multiple == pytest.approx(1.5)
    assert o.book_depth_t2 == 12
    assert ev.status.value == "PAST"
    resolve.resolve_all(session, NOW)  # idempotent: one row per event
    assert len(list(session.scalars(select(Outcome)))) == 1


def test_evaluate_and_export(session, run_id, tmp_path) -> None:
    from volt.evaluate import evaluate, export_all

    test_resolve_outcome(session, run_id)
    r = evaluate(session)
    assert r["resolved_events"] == 1 and len(r["missed_winners"]) == 1  # 1.5x, never flagged
    paths = export_all(session, tmp_path / "x")
    assert any(p.name == "outcomes.csv" for p in paths)


# ------------------------------------------------------------------ digest


def test_digest_builds_and_prints(session, run_id, capsys) -> None:
    from volt import digest

    make_event(session, run_id)
    scoring.score_all(session, NOW)
    text = digest.build_digest(session, NOW)
    assert "Top 5" in text and "Crawl health" in text and "no buy" in text
    assert digest.send(text) == "stdout"
    assert "Volt digest" in capsys.readouterr().out


def test_telegram_allow_list() -> None:
    from volt.digest import allowed_update

    ok = SimpleNamespace(effective_chat=SimpleNamespace(id=42))
    bad = SimpleNamespace(effective_chat=SimpleNamespace(id=7))
    assert allowed_update(ok, [42]) and not allowed_update(bad, [42])
    assert not allowed_update(SimpleNamespace(effective_chat=None), [42])


# ------------------------------------------------------------------ politeness plumbing


def test_token_bucket(tmp_path) -> None:
    b = TokenBucket(tmp_path / "b.json", per_hour=3)
    for _ in range(3):
        b.take(now=1000.0)
    with pytest.raises(RateLimited):
        b.take(now=1001.0)
    b.take(now=1000.0 + 3601)  # old stamps expire


def test_cache_one_hour(tmp_path) -> None:
    c = ResponseCache(tmp_path)
    c.put("u", "body", now=7200.0)
    assert c.get("u", now=7200.0 + 3599)["body"] == "body"
    assert c.get("u", now=7200.0 + 3601) is None


def test_backoff_retries_then_succeeds() -> None:
    calls = []

    def flaky() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise FetchError("503")
        return "ok"

    assert with_backoff(flaky, retries=4, sleep=lambda s: None) == "ok" and len(calls) == 3
    with pytest.raises(FetchError):
        with_backoff(lambda: (_ for _ in ()).throw(FetchError("x")), retries=2, sleep=lambda s: None)


def test_robots_respected_and_override(monkeypatch) -> None:
    from volt.crawlers import base

    class R:
        status_code = 200
        text = "User-agent: *\nDisallow: /\n"

    monkeypatch.setattr(base.httpx, "get", lambda *a, **k: R())
    pol = base.Politeness("x", ignore_robots=False, sleep=lambda s: None)
    with pytest.raises(base.RobotsDisallowed):
        pol.before_request("https://example.com/event/1")
    pol2 = base.Politeness("y", ignore_robots=True, sleep=lambda s: None)
    pol2.before_request("https://example.com/event/1")


def test_cents_parser() -> None:
    assert cents("$1,234.50") == 123450 and cents(12.5) == 1250 and cents("--") is None and cents(None) is None

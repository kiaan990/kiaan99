from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import select

from conftest import FIX, NOW, at
from volt.config import site_config
from volt.crawlers import crowdvolt as cv
from volt.db import CvBookSnapshot, CvEventSnapshot, Event, Side

URL = "https://www.crowdvolt.com/event/circoloco-halloween-saturday-new-york-oct-31-brooklyn-storehouse"


def _public() -> str:
    return (FIX / "crowdvolt_event_public.html").read_text()


def _loggedin() -> dict:
    return json.loads((FIX / "crowdvolt_event_loggedin.json").read_text())


def test_public_page_metadata_and_floor() -> None:
    html = _public()
    p = cv.parse_event_page(URL, html, cv._html_text(html), "", [], NOW)
    assert p.title == "Circoloco Halloween (Saturday)"
    assert p.starts_at is not None and p.starts_at.isoformat() == "2026-11-01T02:00:00+00:00"  # 10pm ET Sat
    assert p.venue_name == "Brooklyn Storehouse"
    assert p.is_nyc is True
    assert p.lineup == ["Aline Umber", "ANOTR", "Dixon"]
    assert p.floor_cents == 20000 and p.lowest_ask_cents == 20000
    # hidden prices ("--ea") still count as listings with quantities
    assert p.asks == [(None, 1), (None, 2), (None, 5)]
    assert p.ask_count == 3
    assert p.parse_ok


def test_text_layer_full_book() -> None:
    j = _loggedin()
    p = cv.parse_event_page(URL, _public(), j["text_buy"], j["text_sell"], [], NOW)
    assert p.wallet_type == "DICE"
    assert p.ticket_limit == 4
    assert (p.lowest_ask_cents, p.highest_bid_cents, p.last_sale_cents) == (20000, 18500, 24000)
    assert p.all_in_lowest_cents == 22150
    assert (p.looking_to_go, p.looking_to_sell) == (37, 12)
    assert p.asks == [(20000, 1), (21500, 2), (26000, 5)]
    assert p.bids == [(18500, 2), (15000, 1)]
    assert (p.ask_count, p.bid_count) == (3, 2)


def test_network_json_wins_over_text() -> None:
    j = _loggedin()
    p = cv.parse_event_page(URL, _public(), j["text_buy"], j["text_sell"], j["network_json"], NOW)
    assert p.sources["lowest_ask_cents"] == "network"
    assert p.lowest_ask_cents == 19900  # *_cents key → cents
    assert p.last_sale_cents == 24500  # dollars key → cents
    assert p.asks == [(19900, 2), (21500, 1)]
    assert p.bids == [(18600, 2), (15000, 1)]
    assert p.wallet_type == "DICE"


def test_money_units() -> None:
    assert cv._money("price", 200) == 20000
    assert cv._money("price_cents", 20000) == 20000
    assert cv._money("price", 20000) == 20000  # implausible dollars → already cents
    assert cv._money("price", "$1,250.50") == 125050
    assert cv._money("price", {"amount_cents": 1500}) == 1500


def test_wallet_normalization() -> None:
    assert cv.normalize_wallet("Posh") == "POSH"
    assert cv.normalize_wallet("DICE app") == "DICE"
    assert cv.normalize_wallet("Ticketmaster") == "TM"
    assert cv.normalize_wallet("nothing") is None


def test_cloudflare_block_detected() -> None:
    p = cv.parse_event_page(URL, (FIX / "crowdvolt_cloudflare_block.html").read_text())
    assert p.blocked and not p.parse_ok


def test_non_nyc_address() -> None:
    html = _public().replace("New York, NY 11205", "Chicago, IL 60611")
    p = cv.parse_event_page(URL, html, cv._html_text(html), "", [], NOW)
    assert p.is_nyc is False


def test_sitemap_filter() -> None:
    cfg = site_config()["crowdvolt"]
    urls = cv.sitemap_event_urls((FIX / "crowdvolt_sitemap.xml").read_text())
    keep = [u for u in urls if cv.url_is_candidate(u, cfg, NOW)]
    assert any("circoloco-halloween-saturday" in u for u in keep)
    assert not any("navy-pier" in u for u in keep)  # tagged "new-york" but it's Chicago
    assert not any("chicago" in u or "red-rocks" in u for u in keep)
    assert not any("/about" in u for u in keep)


def test_slug_date() -> None:
    assert str(cv.slug_date("https://x/event/kaytranada-pacha-fri-oct-30-new-york", NOW)) == "2026-10-30"
    assert str(cv.slug_date("https://x/event/a-b-november-1-2026", NOW)) == "2026-11-01"
    assert str(cv.slug_date("https://x/event/sosa-pacha-sat-jan-2-brooklyn", NOW)) == "2027-01-02"


def test_adaptive_cadence() -> None:
    assert cv.cadence_hours(at(days=20), NOW) == 24
    assert cv.cadence_hours(at(days=10), NOW) == 6
    assert cv.cadence_hours(at(days=2), NOW) == 1
    assert cv.cadence_hours(at(hours=-6), NOW) == 1  # in progress
    assert cv.cadence_hours(at(hours=-13), NOW) is None  # ended → stop
    assert cv.is_due(at(days=10), NOW - timedelta(hours=7), NOW)
    assert not cv.is_due(at(days=10), NOW - timedelta(hours=2), NOW)
    assert not cv.is_due(at(days=20), NOW - timedelta(hours=20), NOW)
    assert cv.is_due(at(days=1), NOW - timedelta(minutes=58), NOW)


def test_write_snapshot_append_only(session, run_id) -> None:
    j = _loggedin()
    p = cv.parse_event_page(URL, _public(), j["text_buy"], j["text_sell"], [], NOW)
    ev = cv.write_snapshot(session, None, p, run_id=run_id, now=NOW)
    ev2 = cv.write_snapshot(session, None, p, run_id=run_id, now=NOW + timedelta(hours=1))
    session.flush()
    assert ev is not None and ev2 is not None and ev.id == ev2.id
    assert ev.cv_listable is True and ev.cv_wallet_type == "DICE"
    snaps = list(session.scalars(select(CvEventSnapshot).where(CvEventSnapshot.event_id == ev.id)))
    assert len(snaps) == 2 and all(s.crawl_run_id == run_id for s in snaps)
    book = list(session.scalars(select(CvBookSnapshot).where(CvBookSnapshot.event_id == ev.id)))
    assert sum(b.side == Side.ASK for b in book) == 6 and sum(b.side == Side.BID for b in book) == 4
    assert session.scalar(select(Event).where(Event.id == ev.id)).venue_id is not None


def test_plan_urls_seeds_first(session) -> None:
    cfg = dict(site_config()["crowdvolt"])
    cfg["seed_urls"] = ["https://www.crowdvolt.com/event/seed-a"]
    order = cv.plan_urls(session, ["https://www.crowdvolt.com/event/other-b"], cfg, NOW, False, set())
    assert order[0].endswith("seed-a")
    skip = cv.plan_urls(
        session,
        ["https://www.crowdvolt.com/event/other-b"],
        cfg,
        NOW,
        False,
        {"https://www.crowdvolt.com/event/other-b"},
    )
    assert skip == ["https://www.crowdvolt.com/event/seed-a"]

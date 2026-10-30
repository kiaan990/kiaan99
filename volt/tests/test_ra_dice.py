from __future__ import annotations

import json

from sqlalchemy import select

from conftest import FIX, NOW
from volt.config import site_config
from volt.crawlers import dice, ra
from volt.db import EventSource, EventStatus, SignalSnapshot, TierSnapshot


def _ra_items() -> list[dict]:
    return json.loads((FIX / "ra_listings.json").read_text())["data"]["eventListings"]["data"]


# ---------------------------------------------------------------- RA


def test_ra_query_hash_pinned() -> None:
    assert site_config()["ra"]["query_sha256"] == ra.query_sha256()


def test_ra_payload_shape() -> None:
    p = ra.build_payload(8, NOW, 60, 1, 50)
    assert p["variables"]["filters"]["areas"] == {"eq": 8}
    assert p["variables"]["filters"]["listingDate"] == {"gte": "2026-10-30", "lte": "2026-12-29"}


def test_ra_response_shape() -> None:
    items = _ra_items()
    for it in items:
        ev = it["event"]
        for key in ("id", "title", "startTime", "interestedCount", "venue", "artists", "promoters", "tickets"):
            assert key in ev


def test_ra_parse_circoloco() -> None:
    recs = [ra.parse_listing(i) for i in _ra_items()]
    circ = [r for r in recs if r["title"] == "CircoLoco New York"]
    assert circ, "fixture should contain CircoLoco"
    r = circ[0]
    assert r["venue"] == "Brooklyn Storehouse"
    assert r["starts_at"].tzinfo is not None
    assert r["interested"] and r["interested"] > 0
    assert all(t["index"] == i + 1 for i, t in enumerate(r["tiers"]))
    prices = [t["price_cents"] for t in r["tiers"] if t["price_cents"] is not None]
    assert prices == sorted(prices)


def test_ra_apply_writes_signals_tiers_and_status(session, ctx) -> None:
    for it in _ra_items():
        rec = ra.parse_listing(it)
        ev = ra.apply_listing(session, ctx, rec, NOW)
    session.flush()
    rows = list(session.scalars(select(SignalSnapshot).where(SignalSnapshot.signal_name == "ra_interested")))
    assert rows
    nonstop = [ra.parse_listing(i) for i in _ra_items() if "Halloween Nonstop" in i["event"]["title"]][0]
    assert any(not t["available"] for t in nonstop["tiers"]) and any(t["available"] for t in nonstop["tiers"])
    tiers = list(session.scalars(select(TierSnapshot).where(TierSnapshot.provider == "RA")))
    assert tiers
    assert ev is not None


def test_ra_ticket_links() -> None:
    ev = {
        "promotionalLinks": [{"title": "Tix", "url": "https://dice.fm/event/abc-x"}],
        "content": "Tickets at https://posh.vip/e/foo. Also https://dice.fm/bundles/b1",
    }
    links = ra.ticket_links(ev)
    assert ("DICE", "https://dice.fm/event/abc-x") in links
    assert ("POSH", "https://posh.vip/e/foo") in links
    assert not any("bundles" in u for _, u in links)


def test_ra_all_tiers_sold_marks_sold_out(session, ctx) -> None:
    rec = {
        "external_id": "1",
        "url": "https://ra.co/events/1",
        "title": "Test Night",
        "starts_at": NOW,
        "venue": "Knockdown Center",
        "lineup": [],
        "promoter": None,
        "interested": 10,
        "is_ticketed": True,
        "provider": None,
        "ticket_links": [],
        "tiers": [{"name": "t1", "index": 1, "price_cents": 3000, "available": False, "state": "SOLDOUT"}],
    }
    ev = ra.apply_listing(session, ctx, rec, NOW)
    assert ev.status == EventStatus.SOLD_OUT and ev.first_sold_out_at == NOW and ev.face_value_cents == 3000


# ---------------------------------------------------------------- Dice


def test_dice_event_page_on_sale() -> None:
    r = dice.parse_event_page((FIX / "dice_event_circoloco_sunday.html").read_text())
    assert r is not None
    assert r["id"] == "6abc1441864aa20001f56c2f"
    assert r["name"] == "Teksupport: Circoloco Halloween (Sunday)"
    assert r["status"] == "on-sale"
    assert r["waiting_list_enabled"] is False
    assert r["max_tickets"] == 6
    assert r["price_from"] == 3090
    assert r["venue"] == "Brooklyn Storehouse"
    assert r["venue_url"].endswith("/venue/brooklyn-storehouse-ronv")
    assert r["transfer_enabled"] is None
    assert r["promoter"] == "Teksupport"


def test_dice_event_page_sold_out_waitlist() -> None:
    r = dice.parse_event_page((FIX / "dice_event_kaytranada.html").read_text())
    assert r is not None and r["status"] == "sold-out" and r["waiting_list_enabled"] is True
    assert r["venue"] == "Pacha New York"


def test_dice_venue_listing() -> None:
    evs = dice.listing_events((FIX / "dice_venue_storehouse.html").read_text())
    by = {e["name"]: e for e in evs}
    assert by["Teksupport: Circoloco Halloween (Sat)"]["status"] == "sold-out"  # "SOLD OUT" suffix stripped
    assert by["Teksupport: Circoloco Halloween (Sunday)"]["status"] == "on-sale"
    assert all(e["announced_at"] is not None for e in evs)


def test_dice_record_observation(session, ctx) -> None:
    from volt.matching import upsert_event_from_source

    r = dice.parse_event_page((FIX / "dice_event_kaytranada.html").read_text())
    assert r is not None
    ev, _, _ = upsert_event_from_source(
        session,
        site="dice",
        external_id=r["id"],
        url=r["url"],
        title=r["name"],
        starts_at=r["starts_at"],
        venue_name=r["venue"],
    )
    dice.record_observation(session, ctx, ev, r, NOW, include_page_signals=True)
    session.flush()
    sig = {
        s.signal_name: s.value for s in session.scalars(select(SignalSnapshot).where(SignalSnapshot.event_id == ev.id))
    }
    assert sig["dice_sold_out"] == 1.0 and sig["dice_waitlist_on"] == 1.0
    assert "dice_transfer_enabled" in sig and sig["dice_transfer_enabled"] is None
    assert ev.status == EventStatus.SOLD_OUT and ev.first_sold_out_at == NOW
    t = session.scalar(select(TierSnapshot).where(TierSnapshot.event_id == ev.id))
    assert t is not None and t.available is False
    assert session.scalar(select(EventSource).where(EventSource.event_id == ev.id)).site == "dice"


def test_face_value_precedence(session, ctx) -> None:
    """Dice 'from' price is provisional; RA tier prices replace it; a manual override is never replaced."""
    from volt.db import Event

    r = dice.parse_event_page((FIX / "dice_event_circoloco_sunday.html").read_text())
    assert r is not None
    ev = Event(title="x", starts_at=NOW, lineup=[])
    session.add(ev)
    session.flush()
    dice.record_observation(session, ctx, ev, r, NOW, include_page_signals=False)
    assert (ev.face_value_cents, ev.face_source) == (3090, "DICE")
    rec = {
        "external_id": "9",
        "url": "u",
        "title": "x",
        "starts_at": NOW,
        "venue": None,
        "lineup": [],
        "promoter": None,
        "interested": None,
        "is_ticketed": True,
        "provider": None,
        "ticket_links": [],
        "tiers": [{"name": "GA", "index": 1, "price_cents": 17240, "available": True, "state": "VALID"}],
    }
    from volt.db import EventSource

    session.add(EventSource(event_id=ev.id, site="ra", external_id="9"))
    session.flush()
    ra.apply_listing(session, ctx, rec, NOW)
    assert (ev.face_value_cents, ev.face_source) == (17240, "RA")
    ev.face_value_cents, ev.face_source = 15000, "MANUAL"
    ra.apply_listing(session, ctx, rec, NOW)
    dice.record_observation(session, ctx, ev, r, NOW, include_page_signals=False)
    assert (ev.face_value_cents, ev.face_source) == (15000, "MANUAL")

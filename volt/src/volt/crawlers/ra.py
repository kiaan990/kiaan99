"""Resident Advisor crawler: GraphQL eventListings for New York (area 8), next N days.

The query text below is pinned; config/sites.yaml stores its sha256 and the crawler refuses to run on a
mismatch, so changing what we ask RA for is always a deliberate, reviewed edit.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from volt.config import site_config
from volt.crawlers.base import CrawlContext, HttpFetcher, crawl_run
from volt.db import Event, EventSource, EventStatus, Provider, SignalSnapshot, TierSnapshot, utcnow
from volt.matching import upsert_event_from_source

log = logging.getLogger("volt.ra")
SITE = "ra"
NY = ZoneInfo("America/New_York")

RA_QUERY = (
    "query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $filterOptions: FilterOptionsInputDtoInput, "
    "$page: Int, $pageSize: Int, $sort: SortInputDtoInput) { eventListings(filters: $filters, "
    "filterOptions: $filterOptions, pageSize: $pageSize, page: $page, sort: $sort) { data { id listingDate "
    "event { id title date startTime endTime interestedCount isTicketed contentUrl content "
    "venue { id name contentUrl area { id name } } artists { id name } promoters { id name } "
    "promotionalLinks { title url } "
    "tickets(queryType: AVAILABLE) { id title validType onSaleFrom priceRetail isAddOn } } } totalResults } }"
)


def query_sha256() -> str:
    return hashlib.sha256(RA_QUERY.encode()).hexdigest()


def build_payload(area: int, start: datetime, days: int, page: int, page_size: int) -> dict[str, Any]:
    d0 = start.astimezone(NY).date()
    return {
        "operationName": "GET_EVENT_LISTINGS",
        "variables": {
            "filters": {"areas": {"eq": area},
                        "listingDate": {"gte": d0.isoformat(), "lte": (d0 + timedelta(days=days)).isoformat()}},
            "filterOptions": {"genre": True},
            "pageSize": page_size,
            "page": page,
            "sort": {"listingDate": {"order": "ASCENDING"}, "score": {"order": "DESCENDING"},
                     "titleKeyword": {"order": "ASCENDING"}},
        },
        "query": RA_QUERY,
    }


def _local(ts: str | None) -> datetime | None:
    """RA times are local wall-clock without offset."""
    if not ts:
        return None
    dt = datetime.fromisoformat(ts.replace("Z", ""))
    return dt.replace(tzinfo=NY).astimezone(UTC)


TICKET_HOSTS = {"dice.fm": "DICE", "link.dice.fm": "DICE", "posh.vip": "POSH", "eventbrite.com": "EVENTBRITE",
                "ticketmaster.com": "TM", "axs.com": "AXS", "tixr.com": "OTHER", "shotgun.live": "OTHER"}


def ticket_links(ev: dict[str, Any]) -> list[tuple[str, str]]:
    urls = [link.get("url") or "" for link in ev.get("promotionalLinks") or []]
    urls += re.findall(r"https?://[^\s)\]\"'<>]+", ev.get("content") or "")
    out = []
    for u in urls:
        host = re.sub(r"^https?://(www\.)?", "", u).split("/", 1)[0].lower()
        if "/bundles/" in u:
            continue
        for h, prov in TICKET_HOSTS.items():
            if host == h or host.endswith("." + h):
                out.append((prov, u.rstrip(".,")))
    return list(dict.fromkeys(out))


def parse_listing(item: dict[str, Any]) -> dict[str, Any]:
    ev = item["event"]
    tickets = [t for t in ev.get("tickets") or [] if not t.get("isAddOn")]
    tickets.sort(key=lambda t: (t.get("priceRetail") is None, t.get("priceRetail") or 0))
    tiers = []
    for i, t in enumerate(tickets, start=1):
        price = t.get("priceRetail")
        tiers.append({
            "name": t.get("title") or f"tier {i}", "index": i,
            "price_cents": int(round(price * 100)) if price is not None else None,
            "available": t.get("validType") == "VALID",
            "state": t.get("validType"),
        })
    links = ticket_links(ev)
    provider = Provider.RA if ev.get("isTicketed") else (Provider(links[0][0]) if links else None)
    return {
        "external_id": str(ev["id"]),
        "url": "https://ra.co" + (ev.get("contentUrl") or f"/events/{ev['id']}"),
        "title": (ev.get("title") or "").strip(),
        "starts_at": _local(ev.get("startTime") or ev.get("date")),
        "venue": (ev.get("venue") or {}).get("name"),
        "area_id": ((ev.get("venue") or {}).get("area") or {}).get("id"),
        "lineup": [a["name"] for a in ev.get("artists") or [] if a.get("name")],
        "promoter": ", ".join(p["name"] for p in ev.get("promoters") or [] if p.get("name")) or None,
        "interested": ev.get("interestedCount"),
        "is_ticketed": bool(ev.get("isTicketed")),
        "provider": provider,
        "ticket_links": links,
        "tiers": tiers,
    }


def apply_listing(session: Session, ctx: CrawlContext | None, rec: dict[str, Any], now: datetime,
                  write_snapshots: bool = True) -> Event:
    ev, _src, _ = upsert_event_from_source(
        session, site=SITE, external_id=rec["external_id"], url=rec["url"], title=rec["title"],
        starts_at=rec["starts_at"], venue_name=rec["venue"], promoter=rec["promoter"], lineup=rec["lineup"],
        provider=rec["provider"])

    def add(row: Any) -> None:
        if ctx:
            ctx.add(row)
        else:
            session.add(row)

    for prov, url in rec["ticket_links"]:  # remember Dice links so the Dice crawler can follow them
        if prov == "DICE":
            ext = "link:" + url
            if not session.query(EventSource).filter_by(site="dice_link", external_id=ext).first():
                session.add(EventSource(event_id=ev.id, site="dice_link", url=url, external_id=ext,
                                        match_confidence=100.0))
                session.flush()
    if not write_snapshots:
        return ev  # page came from the 1-hour cache: no new observation
    if rec["interested"] is not None:
        add(SignalSnapshot(event_id=ev.id, signal_name="ra_interested", value=float(rec["interested"]),
                           captured_at=now))
    if rec["is_ticketed"] and rec["tiers"]:
        for t in rec["tiers"]:
            add(TierSnapshot(event_id=ev.id, provider="RA", tier_name=t["name"], tier_index=t["index"],
                             price_cents=t["price_cents"], available=t["available"], captured_at=now))
        if ev.face_value_cents is None:
            prices = [t["price_cents"] for t in rec["tiers"] if t["price_cents"] is not None]
            if prices:
                ev.face_value_cents = min(prices)
        if all(not t["available"] for t in rec["tiers"]):
            if ev.status != EventStatus.SOLD_OUT:
                ev.status = EventStatus.SOLD_OUT
            if ev.first_sold_out_at is None:
                ev.first_sold_out_at = now
        elif ev.status == EventStatus.ANNOUNCED:
            ev.status = EventStatus.ON_SALE
    return ev


def crawl(force: bool = False, debug_dump: bool = False) -> dict[str, Any]:
    cfg = site_config()[SITE]
    if cfg.get("query_sha256") != query_sha256():
        raise RuntimeError(
            f"RA query hash mismatch: config has {cfg.get('query_sha256')}, code has {query_sha256()}. "
            "If the query change is intended, run `volt ra-query-hash --write`.")
    now = utcnow()
    stats = {"events": 0, "pages": 0}
    with crawl_run(SITE, force=force, debug_dump=debug_dump) as ctx:
        http = HttpFetcher(SITE, ctx)
        headers = {"Referer": cfg["referer"], "ra-content-language": "en", "Origin": "https://ra.co"}
        try:
            page = 1
            seen: set[str] = set()
            while True:
                payload = build_payload(cfg["area_id"], now, cfg["days_ahead"], page, cfg["page_size"])
                data = http.post_json(cfg["graphql_url"], payload, force=force, headers=headers)
                ctx.archive(f"{cfg['graphql_url']}#page={page}", json.dumps(data), "json")
                if data.get("errors"):
                    ctx.dump_debug(cfg["graphql_url"], json.dumps(data, indent=1), reason="graphql errors")
                    raise RuntimeError(f"RA GraphQL errors: {data['errors'][:2]}")
                listings = data["data"]["eventListings"]
                items = listings.get("data") or []
                stats["pages"] += 1
                for it in items:
                    try:
                        rec = parse_listing(it)
                    except Exception as e:  # noqa: BLE001
                        ctx.error(f"bad RA listing {it.get('id')}: {e}")
                        continue
                    if rec["external_id"] in seen:
                        continue  # multi-day events appear once per listing date
                    seen.add(rec["external_id"])
                    apply_listing(ctx.session, ctx, rec, now, write_snapshots=not http.last_from_cache)
                    stats["events"] += 1
                ctx.commit()
                total = listings.get("totalResults") or 0
                if not items or page * cfg["page_size"] >= total or page >= 40:
                    break
                page += 1
        finally:
            http.close()
    return stats

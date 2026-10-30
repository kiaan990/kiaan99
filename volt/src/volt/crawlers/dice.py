"""Dice crawler (plain HTTP; Dice server-renders event JSON into __NEXT_DATA__ and ld+json).

What the public, server-rendered pages expose (verified 2026-10-30):
  * listing pages (city browse, venue pages): id, name, status (on-sale / sold-out / ...), dates incl.
    announcement_date, price.amount (sold out) or price.amount_from (lowest price still on sale).
  * event page: the same plus waiting_list_enabled, max_tickets, venue URL, lineup.
  * NOT exposed without a browser session: the per-tier ticket list, and whether transfer is enabled.
So tiers are recorded as one "lowest available" row per crawl; a rising lowest price means a tier sold
through (see docs/SIGNALS.md, tier_velocity). dice_transfer_enabled is recorded as NULL.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from volt.config import get_settings, site_config
from volt.crawlers.base import CrawlContext, HttpFetcher, RateLimited, crawl_run
from volt.db import Event, EventSource, EventStatus, Provider, SignalSnapshot, TierSnapshot, utcnow
from volt.matching import detect_brand, find_match, norm, resolve_venue, upsert_event_from_source

log = logging.getLogger("volt.dice")
SITE = "dice"

STATUS_MAP = {
    "on-sale": EventStatus.ON_SALE, "sold-out": EventStatus.SOLD_OUT, "cancelled": EventStatus.CANCELLED,
    "off-sale": EventStatus.ON_SALE, "announced": EventStatus.ANNOUNCED, "pre-sale": EventStatus.ANNOUNCED,
    "past": EventStatus.PAST,
}


def next_data(html: str) -> dict[str, Any] | None:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        return dict(json.loads(m.group(1)))
    except ValueError:
        return None


def _dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def _event_record(e: dict[str, Any]) -> dict[str, Any]:
    dates = e.get("dates") or {}
    price = e.get("price") or {}
    venues = e.get("venues") or []
    status = (e.get("status") or "").lower()
    name = re.sub(r"\s+SOLD OUT\s*$", "", (e.get("name") or "").strip(), flags=re.I).strip()
    return {
        "id": str(e.get("id")),
        "name": name,
        "status": status,
        "starts_at": _dt(dates.get("event_start_date")),
        "announced_at": _dt(dates.get("announcement_date")),
        "price_amount": price.get("amount"),
        "price_from": price.get("amount_from"),
        "venue": venues[0].get("name") if venues and isinstance(venues[0], dict) else None,
        "perm_name": e.get("perm_name"),
    }


def listing_events(html: str) -> list[dict[str, Any]]:
    """All event objects on a browse/venue page (deduped by id)."""
    d = next_data(html)
    if d is None:
        return []
    found: dict[str, dict[str, Any]] = {}
    stack: list[Any] = [d.get("props", {}).get("pageProps", {})]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            if {"id", "name", "status", "dates"} <= o.keys() and isinstance(o.get("dates"), dict):
                rec = _event_record(o)
                found.setdefault(rec["id"], rec)
                continue
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)
        elif isinstance(o, str) and o.startswith("{") and '"event' in o:
            try:
                stack.append(json.loads(o))
            except ValueError:
                pass
    return list(found.values())


def parse_event_page(html: str) -> dict[str, Any] | None:
    d = next_data(html)
    if d is None:
        return None
    state = d.get("props", {}).get("pageProps", {}).get("initialState")
    if isinstance(state, str):
        try:
            state = json.loads(state)
        except ValueError:
            state = None
    ev = ((state or {}).get("event") or {}).get("event") or {}
    if not ev.get("id"):
        return None
    rec = _event_record(ev)
    lineup = [a.get("name") for a in (ev.get("summary_lineup") or {}).get("top_artists") or [] if a.get("name")]
    ld = None
    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            j = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(j, dict) and str(j.get("@type", "")).endswith("Event"):
            ld = j
            break
    venue_url = None
    if ld and isinstance(ld.get("location"), dict):
        venue_url = ld["location"].get("url")
        if not lineup:
            lineup = [p.get("name") for p in ld.get("performer") or [] if isinstance(p, dict) and p.get("name")]
    offers = (ld or {}).get("offers") or {}
    rec.update({
        "waiting_list_enabled": ev.get("waiting_list_enabled"),
        "max_tickets": ev.get("max_tickets"),
        "lineup": lineup,
        "promoter": re.sub(r"^presented by\s*", "", ev.get("presented_by") or "", flags=re.I).strip(" .") or None,
        "venue_url": venue_url,
        "url": f"https://dice.fm/event/{ev.get('perm_name')}" if ev.get("perm_name") else None,
        "ld_low": offers.get("lowPrice"), "ld_high": offers.get("highPrice"),
        "transfer_enabled": None,  # not exposed on the public page
    })
    return rec


def _price_cents(v: Any) -> int | None:
    """Dice listing prices are integer cents (e.g. 3090 = $30.90)."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def record_observation(session: Session, ctx: CrawlContext | None, ev: Event, rec: dict[str, Any],
                       now: datetime, include_page_signals: bool) -> None:
    def add(row: Any) -> None:
        if ctx:
            ctx.add(row)
        else:
            session.add(row)

    status = rec["status"]
    sold_out = status == "sold-out"
    add(SignalSnapshot(event_id=ev.id, signal_name="dice_sold_out", value=1.0 if sold_out else 0.0, captured_at=now))
    if include_page_signals:
        wl = rec.get("waiting_list_enabled")
        add(SignalSnapshot(event_id=ev.id, signal_name="dice_waitlist_on",
                           value=None if wl is None else (1.0 if wl else 0.0), captured_at=now))
        add(SignalSnapshot(event_id=ev.id, signal_name="dice_transfer_enabled", value=None, captured_at=now))
        if rec.get("max_tickets"):
            add(SignalSnapshot(event_id=ev.id, signal_name="dice_max_tickets", value=float(rec["max_tickets"]),
                               captured_at=now))
    from_c = _price_cents(rec.get("price_from"))
    amt_c = _price_cents(rec.get("price_amount"))
    if sold_out:
        add(TierSnapshot(event_id=ev.id, provider="DICE", tier_name="all tiers (sold out)", tier_index=None,
                         price_cents=amt_c, available=False, captured_at=now))
    elif from_c is not None or amt_c is not None:
        add(TierSnapshot(event_id=ev.id, provider="DICE", tier_name="lowest available", tier_index=None,
                         price_cents=from_c if from_c is not None else amt_c, available=True, captured_at=now))
    if ev.face_value_cents is None:
        ev.face_value_cents = from_c if from_c is not None else amt_c
    new_status = STATUS_MAP.get(status)
    if new_status is not None and ev.status != EventStatus.PAST:
        ev.status = new_status
    if sold_out and ev.first_sold_out_at is None:
        ev.first_sold_out_at = now
    if rec.get("announced_at") and ev.announced_at is None:
        ev.announced_at = rec["announced_at"]
    if ev.primary_provider is None:
        ev.primary_provider = Provider.DICE


class _VenueState:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> list[str]:
        try:
            return list(json.loads(self.path.read_text()))
        except (FileNotFoundError, ValueError):
            return []

    def save(self, paths: list[str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(sorted(set(paths)), indent=1))


def _relevant(session: Session, rec: dict[str, Any]) -> bool:
    if resolve_venue(session, rec.get("venue")) is not None:
        return True
    if detect_brand(session, rec["name"], rec.get("promoter"), rec.get("lineup")) is not None:
        return True
    m = find_match(session, rec["name"], rec["starts_at"], None, rec.get("venue"), exclude_site=SITE)
    return bool(m and m.confidence >= 85)


def crawl(force: bool = False, debug_dump: bool = False) -> dict[str, Any]:
    cfg = site_config()[SITE]
    s = get_settings()
    now = utcnow()
    horizon = now + timedelta(days=cfg.get("days_ahead", 60))
    vstate = _VenueState(s.cache_dir / "dice_venue_paths.json")
    venue_paths = list(dict.fromkeys(cfg.get("venue_paths", []) + vstate.load()))
    stats = {"listing_events": 0, "event_pages": 0, "observations": 0}
    with crawl_run(SITE, force=force, debug_dump=debug_dump) as ctx:
        http = HttpFetcher(SITE, ctx)
        sess = ctx.session
        try:
            # 1) listing pages
            listed: dict[str, dict[str, Any]] = {}
            for path in cfg.get("browse_paths", []) + venue_paths:
                url = cfg["base_url"] + path
                try:
                    html = http.get(url, force=force)
                except RateLimited:
                    raise
                except Exception as e:  # noqa: BLE001
                    ctx.error(f"listing {url}: {e}")
                    continue
                ctx.archive(url, html, "html")
                evs = listing_events(html)
                if not evs:
                    ctx.dump_debug(url, html, reason="no events parsed from listing")
                for r in evs:
                    listed.setdefault(r["id"], r)
            stats["listing_events"] = len(listed)

            # 2) upsert relevant listed events + listing-level observation
            page_targets: dict[str, str] = {}
            for r in listed.values():
                if r["starts_at"] is None or not (now - timedelta(hours=12) <= r["starts_at"] <= horizon):
                    continue
                if not _relevant(sess, r):
                    continue
                ev, src, _ = upsert_event_from_source(
                    sess, site=SITE, external_id=r["id"], url=f"https://dice.fm/event/{r['id']}",
                    title=r["name"], starts_at=r["starts_at"], venue_name=r["venue"], provider=Provider.DICE)
                page_targets[r["id"]] = src.url or f"https://dice.fm/event/{r['id']}"
                # Listing rows are superseded by the event-page observation below (same crawl).
            ctx.commit()

            for u in cfg.get("seed_event_urls", []):
                page_targets.setdefault(u, u)
            # 3) event pages: tracked Dice events, events CrowdVolt says are DICE-wallet, Dice links from RA
            for src in sess.scalars(select(EventSource).where(EventSource.site.in_(["dice", "dice_link"]))):
                ev = sess.get(Event, src.event_id)
                if ev and ev.starts_at and now - timedelta(hours=12) <= ev.starts_at <= horizon and src.url:
                    key = src.external_id if src.site == "dice" else src.url
                    page_targets.setdefault(key, src.url)
            for key, url in page_targets.items():
                try:
                    html = http.get(url, force=force)
                except RateLimited as e:
                    ctx.error(f"stopping event pages: {e}")
                    break
                except Exception as e:  # noqa: BLE001
                    ctx.error(f"event page {url}: {e}")
                    continue
                ctx.archive(url, html, "html")
                cached = http.last_from_cache
                rec = parse_event_page(html)
                if rec is None:
                    if "/event/" in url:
                        ctx.dump_debug(url, html, reason="could not parse Dice event page")
                        ctx.error(f"unparsed Dice page {url}")
                    else:
                        log.info("not a Dice event page (short link/bundle): %s", url)
                    continue
                stats["event_pages"] += 1
                ev, _src, _ = upsert_event_from_source(
                    sess, site=SITE, external_id=rec["id"], url=rec["url"] or url, title=rec["name"],
                    starts_at=rec["starts_at"], venue_name=rec["venue"], promoter=rec["promoter"],
                    lineup=rec["lineup"], provider=Provider.DICE)
                if not cached:
                    record_observation(sess, ctx, ev, rec, now, include_page_signals=True)
                    stats["observations"] += 1
                vu = rec.get("venue_url")
                if vu and resolve_venue(sess, rec.get("venue")) is not None:
                    path = "/" + vu.split("dice.fm/", 1)[-1].lstrip("/")
                    if path not in venue_paths:
                        venue_paths.append(path)
                        vstate.save([p for p in venue_paths if p not in cfg.get("venue_paths", [])])
                ctx.commit()
        except RateLimited as e:
            ctx.error(str(e))
        finally:
            http.close()
    detect_added_dates()
    return stats


def detect_added_dates(window_days: int = 4, min_gap_days: int = 7) -> int:
    """Flag an event as an added date when a sibling (same venue + brand, within ±window days) is sold out
    and was announced at least min_gap_days earlier. Only ever sets the flag, never clears a manual one."""
    from volt.db import session_scope

    n = 0
    with session_scope() as sess:
        evs = list(sess.scalars(select(Event).where(Event.merged_into_id.is_(None), Event.starts_at.is_not(None),
                                                    Event.venue_id.is_not(None))))
        for e in evs:
            if e.added_date_flag or e.announced_at is None or e.starts_at is None:
                continue
            for o in evs:
                if o.id == e.id or o.venue_id != e.venue_id or o.starts_at is None or o.announced_at is None:
                    continue
                same_brand = (e.brand_id is not None and e.brand_id == o.brand_id) or (
                    norm(e.promoter) and norm(e.promoter) == norm(o.promoter))
                if not same_brand or abs(o.starts_at - e.starts_at) > timedelta(days=window_days):
                    continue
                if o.status == EventStatus.SOLD_OUT and e.announced_at - o.announced_at >= timedelta(days=min_gap_days):
                    e.added_date_flag = True
                    n += 1
                    break
    return n

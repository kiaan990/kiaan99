"""Venue/brand resolution and cross-site event de-duplication."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from rapidfuzz import fuzz
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from volt.config import load_yaml
from volt.db import (
    SNAPSHOT_MODELS,
    Brand,
    Event,
    EventSource,
    EventStatus,
    PaperTrade,
    Provider,
    Score,
    Venue,
)

NY = ZoneInfo("America/New_York")
MATCH_THRESHOLD = 85.0
REVIEW_FLOOR = 60.0

_TITLE_NOISE = {
    "presents", "present", "pres", "tickets", "ticket", "nyc", "new", "york", "ny", "brooklyn", "queens",
    "the", "at", "w", "with", "and", "ft", "feat", "featuring", "b2b", "x", "live", "tba", "usa", "united",
    "states", "2026", "2027", "oct", "october", "nov", "november", "dec", "december", "jan", "january",
}
_DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
         "mon", "tue", "wed", "thu", "fri", "sat", "sun"}
_DAY_CANON = {d[:3]: d[:3] for d in _DAYS}


def norm(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_title(title: str, venue_name: str | None = None) -> str:
    t = norm(title)
    if venue_name:
        v = norm(venue_name)
        if v:
            t = t.replace(v, " ")
    toks = [w for w in t.split() if w not in _TITLE_NOISE]
    return " ".join(toks)


def discriminators(title: str) -> set[str]:
    """Tokens that make two otherwise-similar titles different events (Friday vs Saturday, Night 1 vs 2)."""
    t = norm(title)
    out: set[str] = set()
    for w in t.split():
        if w in _DAYS:
            out.add("day:" + _DAY_CANON[w[:3]])
    for m in re.finditer(r"\b(night|day|part|vol|chapter|week|weekend)\s+(\d+|one|two|three|i{1,3})\b", t):
        out.add(f"{m.group(1)}:{m.group(2)}")
    return out


# ---------------------------------------------------------------- config loaders

def load_venues(session: Session) -> int:
    data = load_yaml("venues.yaml")["venues"]
    n = 0
    for v in data:
        row = session.scalar(select(Venue).where(Venue.name == v["name"]))
        if row is None:
            row = Venue(name=v["name"])
            session.add(row)
        row.aliases = [norm(a) for a in v.get("aliases", [])] + [norm(v["name"])]
        row.capacity = v.get("capacity")
        row.platform = v.get("platform")
        row.flip_ok = bool(v.get("flip_ok", True))
        row.note = v.get("note")
        n += 1
    session.flush()
    return n


def load_brands(session: Session) -> int:
    data = load_yaml("brands.yaml")
    n = 0
    for key, tier in (("tier1", 1), ("tier2", 2), ("tier3", 3)):
        for b in data.get(key) or []:
            row = session.scalar(select(Brand).where(Brand.name == b["name"]))
            if row is None:
                row = Brand(name=b["name"])
                session.add(row)
            row.aliases = sorted({norm(a) for a in b.get("aliases", [])} | {norm(b["name"])})
            row.tier = tier
            row.title_prefix_only = bool(b.get("title_prefix_only", False))
            n += 1
    session.flush()
    return n


# ---------------------------------------------------------------- resolution

def resolve_venue(session: Session, name: str | None) -> Venue | None:
    n = norm(name)
    if not n:
        return None
    venues = list(session.scalars(select(Venue)))
    # 1) exact alias, 2) longest alias contained in the name, 3) fuzzy >= threshold
    for v in venues:
        if n in v.aliases:
            return v
    best: tuple[int, Venue] | None = None
    for v in venues:
        for a in v.aliases:
            if len(a) >= 5 and re.search(rf"\b{re.escape(a)}\b", n):
                if best is None or len(a) > best[0]:
                    best = (len(a), v)
    if best:
        return best[1]
    scored = [(max(fuzz.token_set_ratio(n, a) for a in v.aliases), v) for v in venues if v.aliases]
    scored.sort(key=lambda x: -x[0])
    if scored and scored[0][0] >= MATCH_THRESHOLD:
        return scored[0][1]
    return None


def detect_brand(session: Session, title: str, promoter: str | None, lineup: list[str] | None) -> Brand | None:
    t = norm(title)
    others = " | ".join([norm(promoter), *[norm(a) for a in (lineup or [])]])
    found: list[Brand] = []
    for b in session.scalars(select(Brand)):
        for a in b.aliases:
            if not a:
                continue
            rx = rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])"
            in_title = bool(re.match(rx, t)) if b.title_prefix_only else bool(re.search(rx, t))
            if in_title or re.search(rx, others):
                found.append(b)
                break
    if not found:
        return None
    return sorted(found, key=lambda b: (b.tier, b.name))[0]


# ---------------------------------------------------------------- matching

@dataclass
class MatchResult:
    event: Event
    confidence: float
    title_score: float
    venue_score: float


def _venue_score(a: Event, venue_id: int | None, venue_raw: str | None) -> float:
    if a.venue_id and venue_id:
        return 100.0 if a.venue_id == venue_id else 0.0
    if a.venue_name_raw and venue_raw:
        return float(fuzz.token_set_ratio(norm(a.venue_name_raw), norm(venue_raw)))
    return 50.0  # unknown on one side


def _night_day(start: datetime) -> str:
    loc = start.astimezone(NY)
    if loc.hour < 6:
        loc -= timedelta(days=1)
    return "day:" + loc.strftime("%a").lower()


def pair_confidence(title_a: str, title_b: str, start_a: datetime | None, start_b: datetime | None,
                    venue_score: float, venue_name: str | None = None) -> tuple[float, float]:
    """Return (confidence, title_score). confidence is 0 when hard constraints fail."""
    if start_a is None or start_b is None:
        return 0.0, 0.0
    delta = abs(start_a - start_b)
    if delta > timedelta(days=1, hours=1):
        return 0.0, 0.0
    da, db = discriminators(title_a), discriminators(title_b)
    if da and db and da != db:
        return 0.0, 0.0
    # A weekday in one title must agree with the other event's local night (Sunday title ≠ Saturday event).
    for disc, other_start in ((da, start_b), (db, start_a)):
        days = {d for d in disc if d.startswith("day:")}
        if days and _night_day(other_start) not in days:
            return 0.0, 0.0
    ta, tb = norm_title(title_a, venue_name), norm_title(title_b, venue_name)
    title_score = float(max(fuzz.token_set_ratio(ta, tb), fuzz.partial_ratio(ta, tb) if min(len(ta), len(tb)) >= 6 else 0))
    conf = min(title_score, venue_score)
    if delta > timedelta(hours=18):
        conf = min(conf, MATCH_THRESHOLD - 1)  # different calendar night: human review
    return conf, title_score


def find_match(session: Session, title: str, starts_at: datetime | None, venue_id: int | None,
               venue_raw: str | None, exclude_site: str | None = None) -> MatchResult | None:
    if starts_at is None:
        return None
    lo, hi = starts_at - timedelta(days=1, hours=1), starts_at + timedelta(days=1, hours=1)
    cands = session.scalars(
        select(Event).where(Event.starts_at >= lo, Event.starts_at <= hi, Event.merged_into_id.is_(None))
    )
    best: MatchResult | None = None
    best_rank = -1e9
    for ev in cands:
        if exclude_site and session.scalar(
            select(EventSource.id).where(EventSource.event_id == ev.id, EventSource.site == exclude_site)
        ):
            continue  # one event never holds two listings from the same site
        vs = _venue_score(ev, venue_id, venue_raw)
        conf, ts = pair_confidence(ev.title, title, ev.starts_at, starts_at, vs, venue_raw)
        if conf <= 0 or ev.starts_at is None:
            continue
        # rank by confidence, then by closeness of start time
        rank = conf - abs((ev.starts_at - starts_at).total_seconds()) / 36000
        if best is None or rank > best_rank:
            best, best_rank = MatchResult(ev, conf, ts, vs), rank
    return best


def upsert_event_from_source(
    session: Session,
    *,
    site: str,
    external_id: str,
    url: str | None,
    title: str,
    starts_at: datetime | None,
    venue_name: str | None,
    promoter: str | None = None,
    lineup: list[str] | None = None,
    provider: Provider | None = None,
) -> tuple[Event, EventSource, bool]:
    """Find the event for (site, external_id); else match an existing event; else create one.

    Returns (event, source, created). Descriptive fields are filled when empty, never clobbered.
    """
    src = session.scalar(select(EventSource).where(EventSource.site == site, EventSource.external_id == external_id))
    venue = resolve_venue(session, venue_name)
    if src is not None:
        ev = session.get(Event, src.event_id)
        assert ev is not None
        while ev.merged_into_id:
            nxt = session.get(Event, ev.merged_into_id)
            assert nxt is not None
            ev = nxt
        _fill(session, ev, title, starts_at, venue, venue_name, promoter, lineup, provider)
        if url and not src.url:
            src.url = url
        return ev, src, False

    m = find_match(session, title, starts_at, venue.id if venue else None, venue_name, exclude_site=site)
    created = False
    if m and m.confidence >= MATCH_THRESHOLD:
        ev = m.event
        conf = m.confidence
    else:
        ev = Event(title=title, starts_at=starts_at, status=EventStatus.ANNOUNCED, lineup=[])
        session.add(ev)
        created = True
        conf = 100.0
    _fill(session, ev, title, starts_at, venue, venue_name, promoter, lineup, provider)
    session.flush()
    src = EventSource(event_id=ev.id, site=site, url=url, external_id=external_id, match_confidence=conf)
    session.add(src)
    session.flush()
    return ev, src, created


def _fill(session: Session, ev: Event, title: str, starts_at: datetime | None, venue: Venue | None,
          venue_name: str | None, promoter: str | None, lineup: list[str] | None, provider: Provider | None) -> None:
    if not ev.title:
        ev.title = title
    if ev.starts_at is None and starts_at is not None:
        ev.starts_at = starts_at
    if ev.venue_id is None and venue is not None:
        ev.venue_id = venue.id
    if not ev.venue_name_raw and venue_name:
        ev.venue_name_raw = venue_name
    if not ev.promoter and promoter:
        ev.promoter = promoter
    if lineup and not ev.lineup:
        ev.lineup = list(lineup)
    if provider and ev.primary_provider is None:
        ev.primary_provider = provider
    if ev.brand_id is None:
        b = detect_brand(session, ev.title, ev.promoter, ev.lineup)
        if b:
            ev.brand_id = b.id


def merge_events(session: Session, keep: Event, drop: Event, confidence: float) -> None:
    """Re-link drop's sources and snapshots onto keep. Snapshot values are never modified."""
    session.execute(update(EventSource).where(EventSource.event_id == drop.id)
                    .values(event_id=keep.id, match_confidence=confidence))
    for model in (*SNAPSHOT_MODELS, Score):
        session.execute(update(model).where(model.event_id == drop.id).values(event_id=keep.id))  # type: ignore[attr-defined]
    if not session.scalar(select(PaperTrade.id).where(PaperTrade.event_id == keep.id)):
        session.execute(update(PaperTrade).where(PaperTrade.event_id == drop.id).values(event_id=keep.id))
    for attr in ("venue_id", "venue_name_raw", "brand_id", "promoter", "primary_provider", "face_value_cents",
                 "first_sold_out_at", "cv_wallet_type", "cv_listable"):
        if getattr(keep, attr) is None and getattr(drop, attr) is not None:
            setattr(keep, attr, getattr(drop, attr))
    if not keep.lineup and drop.lineup:
        keep.lineup = drop.lineup
    keep.added_date_flag = keep.added_date_flag or drop.added_date_flag
    keep.scarcity_flag = keep.scarcity_flag or drop.scarcity_flag
    drop.merged_into_id = keep.id
    session.flush()


def run_matching(session: Session) -> dict[str, Any]:
    """Pairwise pass over live events; auto-merge >= threshold, collect review candidates."""
    events = list(session.scalars(select(Event).where(Event.merged_into_id.is_(None), Event.starts_at.is_not(None))
                                  .order_by(Event.starts_at)))
    merged, review = 0, []
    sites_of: dict[int, set[str]] = {}
    for e in events:
        sites_of[e.id] = set(session.scalars(select(EventSource.site).where(EventSource.event_id == e.id)))
    gone: set[int] = set()
    for i, a in enumerate(events):
        if a.id in gone:
            continue
        for b in events[i + 1:]:
            if b.id in gone or a.starts_at is None or b.starts_at is None:
                continue
            if b.starts_at - a.starts_at > timedelta(days=1, hours=1):
                break
            if sites_of[a.id] & sites_of[b.id]:
                continue
            vs = _venue_score(a, b.venue_id, b.venue_name_raw)
            conf, ts = pair_confidence(a.title, b.title, a.starts_at, b.starts_at, vs, b.venue_name_raw)
            if conf >= MATCH_THRESHOLD:
                merge_events(session, a, b, conf)
                sites_of[a.id] |= sites_of[b.id]
                gone.add(b.id)
                merged += 1
            elif conf >= REVIEW_FLOOR or (ts >= MATCH_THRESHOLD and vs >= REVIEW_FLOOR):
                review.append({"a": a.id, "b": b.id, "a_title": a.title, "b_title": b.title,
                               "confidence": round(conf, 1), "title": round(ts, 1), "venue": round(vs, 1)})
    # brand is derived, so recompute it every pass (picks up brands.yaml edits, clears false positives)
    for e in events:
        if e.id not in gone:
            br = detect_brand(session, e.title, e.promoter, e.lineup)
            e.brand_id = br.id if br else None
    return {"merged": merged, "review": review}


def low_confidence_sources(session: Session, below: float = MATCH_THRESHOLD + 5) -> list[tuple[Event, EventSource]]:
    rows = session.execute(
        select(Event, EventSource).join(EventSource, EventSource.event_id == Event.id)
        .where(EventSource.match_confidence < below, EventSource.match_confirmed.is_(None))
    )
    return [(e, s) for e, s in rows]

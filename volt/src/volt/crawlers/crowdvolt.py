"""CrowdVolt crawler (logged-in persistent Playwright profile).

Parsing is layered and defensive because CrowdVolt is a client-rendered Next.js app:
  1. JSON responses the page itself loads (captured from the network),
  2. JSON embedded in the HTML (__NEXT_DATA__, self.__next_f flight chunks, ld+json),
  3. visible text on the Buy tab (asks) and Sell tab (bids).
The first layer that yields a value wins, per field. Every page's HTML, captured JSON and text are
archived under ./raw before parsing, so a parser bug never loses data: fix the parser, re-parse.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from volt.config import get_settings, site_config
from volt.crawlers.base import (
    CrawlContext,
    Politeness,
    RateLimited,
    RobotsDisallowed,
    cents,
    crawl_run,
)
from volt.db import CvBookSnapshot, CvEventSnapshot, Event, EventSource, Provider, Side, utcnow
from volt.matching import upsert_event_from_source

log = logging.getLogger("volt.crowdvolt")
SITE = "crowdvolt"
NY = ZoneInfo("America/New_York")

MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ],
        start=1,
    )
}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS["sept"] = 9

WALLETS = {
    "dice": "DICE",
    "posh": "POSH",
    "eventbrite": "EVENTBRITE",
    "ticketmaster": "TM",
    "axs": "AXS",
    "tixr": "TIXR",
    "shotgun": "SHOTGUN",
    "seetickets": "SEETICKETS",
    "see tickets": "SEETICKETS",
    "resident advisor": "RA",
    "ra": "RA",
    "etix": "ETIX",
    "venue pilot": "VENUEPILOT",
}


# ============================================================== parsing


@dataclass
class CvParsed:
    url: str
    title: str | None = None
    starts_at: datetime | None = None
    venue_name: str | None = None
    address: str | None = None
    is_nyc: bool | None = None
    lineup: list[str] = field(default_factory=list)
    wallet_type: str | None = None
    ticket_limit: int | None = None
    lowest_ask_cents: int | None = None
    all_in_lowest_cents: int | None = None
    highest_bid_cents: int | None = None
    last_sale_cents: int | None = None
    looking_to_go: int | None = None
    looking_to_sell: int | None = None
    ask_count: int | None = None
    bid_count: int | None = None
    asks: list[tuple[int | None, int | None]] = field(default_factory=list)
    bids: list[tuple[int | None, int | None]] = field(default_factory=list)
    floor_cents: int | None = None
    sources: dict[str, str] = field(default_factory=dict)  # field -> layer that supplied it
    blocked: bool = False

    @property
    def parse_ok(self) -> bool:
        return (
            bool(self.title)
            and any(v is not None for v in (self.lowest_ask_cents, self.highest_bid_cents, self.floor_cents))
            or bool(self.asks or self.bids)
        )

    def set(self, name: str, value: Any, layer: str) -> None:
        if value is None or value == "" or value == []:
            return
        if getattr(self, name) in (None, [], ""):
            setattr(self, name, value)
            self.sources[name] = layer


def _k(key: str) -> str:
    return re.sub(r"[^a-z]", "", key.lower())


def _money(key: str, value: Any) -> int | None:
    """JSON money → cents. Keys mentioning cents are cents; otherwise dollars, except implausible
    dollar values (>= 5000, i.e. a $5,000+ club ticket) which are taken to be cents."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, dict):
        for sub in ("cents", "amount_cents", "value", "amount"):
            if sub in value:
                return _money(sub if "cent" in sub else key, value[sub])
        return None
    if "cent" in key.lower():
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return None
    c = cents(value)
    if c is not None and isinstance(value, (int, float)) and value >= 5000:
        return int(round(float(value)))
    return c


def _int(v: Any) -> int | None:
    if isinstance(v, bool) or v is None:
        return None
    try:
        return int(float(str(v).replace(",", "")))
    except ValueError:
        return None


SCALAR_KEYS: dict[str, tuple[str, str]] = {
    # normalized key -> (field, kind)
    "lowestask": ("lowest_ask_cents", "money"),
    "lowestaskprice": ("lowest_ask_cents", "money"),
    "lowestaskcents": ("lowest_ask_cents", "money"),
    "minask": ("lowest_ask_cents", "money"),
    "lowestprice": ("lowest_ask_cents", "money"),
    "floorprice": ("lowest_ask_cents", "money"),
    "lowestlistingprice": ("lowest_ask_cents", "money"),
    "highestbid": ("highest_bid_cents", "money"),
    "highestbidprice": ("highest_bid_cents", "money"),
    "highestbidcents": ("highest_bid_cents", "money"),
    "maxbid": ("highest_bid_cents", "money"),
    "topbid": ("highest_bid_cents", "money"),
    "lastsale": ("last_sale_cents", "money"),
    "lastsaleprice": ("last_sale_cents", "money"),
    "lastsalecents": ("last_sale_cents", "money"),
    "lastsoldprice": ("last_sale_cents", "money"),
    "lasttradeprice": ("last_sale_cents", "money"),
    "allinprice": ("all_in_lowest_cents", "money"),
    "lowestallin": ("all_in_lowest_cents", "money"),
    "allinlowest": ("all_in_lowest_cents", "money"),
    "lowestallinprice": ("all_in_lowest_cents", "money"),
    "allinlowestcents": ("all_in_lowest_cents", "money"),
    "ticketlimit": ("ticket_limit", "int"),
    "maxtickets": ("ticket_limit", "int"),
    "purchaselimit": ("ticket_limit", "int"),
    "maxticketsperorder": ("ticket_limit", "int"),
    "lookingtogo": ("looking_to_go", "int"),
    "lookingtogocount": ("looking_to_go", "int"),
    "interestedcount": ("looking_to_go", "int"),
    "lookingtosell": ("looking_to_sell", "int"),
    "lookingtosellcount": ("looking_to_sell", "int"),
    "wallet": ("wallet_type", "wallet"),
    "wallettype": ("wallet_type", "wallet"),
    "ticketprovider": ("wallet_type", "wallet"),
    "ticketingplatform": ("wallet_type", "wallet"),
    "ticketplatform": ("wallet_type", "wallet"),
    "transfermethod": ("wallet_type", "wallet"),
    "ticketsource": ("wallet_type", "wallet"),
    "ticketingprovider": ("wallet_type", "wallet"),
    "asklistingcount": ("ask_count", "int"),
    "askcount": ("ask_count", "int"),
    "bidcount": ("bid_count", "int"),
}

PRICE_ITEM_KEYS = (
    "price_cents",
    "amount_cents",
    "unit_price_cents",
    "price",
    "amount",
    "unit_price",
    "price_per_ticket",
    "priceEach",
    "price_each",
    "ask",
    "bid",
    "ask_price",
    "bid_price",
    "value",
)
QTY_ITEM_KEYS = (
    "quantity",
    "qty",
    "count",
    "num_tickets",
    "ticket_count",
    "quantity_available",
    "max_quantity",
    "tickets",
    "numTickets",
    "quantityAvailable",
)


def normalize_wallet(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    for k in sorted(WALLETS, key=len, reverse=True):
        if re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", s):
            return WALLETS[k]
    return None


def _item_price_qty(item: dict[str, Any]) -> tuple[int | None, int | None]:
    price = None
    for k in PRICE_ITEM_KEYS:
        if k in item and not isinstance(item[k], (list, bool)):
            price = _money(k, item[k])
            if price is not None:
                break
    qty = None
    for k in QTY_ITEM_KEYS:
        if k in item and not isinstance(item[k], (list, dict)):
            qty = _int(item[k])
            if qty is not None:
                break
    return price, qty


def _side_of(item: dict[str, Any]) -> str | None:
    for k in ("side", "type", "order_type", "orderType", "kind"):
        v = item.get(k)
        if isinstance(v, str):
            s = v.lower()
            if s in ("bid", "bids", "buy", "buyer", "offer_to_buy"):
                return "BID"
            if s in ("ask", "asks", "sell", "seller", "listing"):
                return "ASK"
    return None


def walk_json(obj: Any, p: CvParsed, layer: str, parent_key: str = "") -> None:
    if isinstance(obj, dict):
        for key, val in obj.items():
            nk = _k(key)
            if nk in SCALAR_KEYS and not isinstance(val, list):
                fld, kind = SCALAR_KEYS[nk]
                if kind == "money":
                    p.set(fld, _money(key, val), layer)
                elif kind == "int":
                    p.set(fld, _int(val), layer)
                else:
                    p.set(fld, normalize_wallet(val), layer)
            if isinstance(val, list) and val and all(isinstance(x, dict) for x in val):
                side = None
                if "bid" in nk:
                    side = "BID"
                elif any(w in nk for w in ("ask", "listing", "sell")):
                    side = "ASK"
                rows = []
                for it in val:
                    s2 = _side_of(it) or side
                    pr, q = _item_price_qty(it)
                    if s2 and (pr is not None or q is not None):
                        rows.append((s2, pr, q))
                if rows:
                    asks = [(pr, q) for s2, pr, q in rows if s2 == "ASK"]
                    bids = [(pr, q) for s2, pr, q in rows if s2 == "BID"]
                    p.set("asks", asks, layer)
                    p.set("bids", bids, layer)
            walk_json(val, p, layer, key)
    elif isinstance(obj, list):
        for v in obj:
            walk_json(v, p, layer, parent_key)


def embedded_json(html: str) -> list[Any]:
    out: list[Any] = []
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if m:
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            pass
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            pass
    # Next.js app-router flight chunks: self.__next_f.push([1,"..."]) — decode and pull JSON objects out.
    for m in re.finditer(r'self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)', html, re.S):
        try:
            chunk = json.loads('"' + m.group(1) + '"')
        except ValueError:
            continue
        for line in chunk.splitlines():
            body = line.split(":", 1)[1] if re.match(r"^[0-9a-z]+:", line) else line
            body = body.strip()
            if body[:1] in "[{":
                try:
                    out.append(json.loads(body))
                except ValueError:
                    pass
    return out


def _ld_event(blobs: list[Any]) -> dict[str, Any] | None:
    stack = list(blobs)
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            t = o.get("@type")
            if isinstance(t, str) and t.endswith("Event"):
                return o
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)
    return None


DATE_RE = re.compile(
    r"\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?"
    r"(?:\s*[•·|,@-]\s*|\s+at\s+|\s+)(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?",
    re.I,
)
SLUG_DATE_RE = re.compile(
    r"(?:^|-)(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|"
    r"august|september|october|november|december)-(\d{1,2})(?:-(\d{4}))?(?=-|$)"
)


def infer_year(month: int, day: int, now: datetime, hint: int | None = None) -> int:
    if hint:
        return hint
    y = now.astimezone(NY).year
    cand = date(y, month, day)
    today = now.astimezone(NY).date()
    if cand < today - timedelta(days=180):
        return y + 1
    if cand > today + timedelta(days=300):
        return y - 1
    return y


def slug_date(url: str, now: datetime) -> date | None:
    slug = url.rstrip("/").rsplit("/", 1)[-1].lower()
    m = SLUG_DATE_RE.search(slug)
    if not m:
        return None
    mon = MONTHS[m.group(1)]
    try:
        day = int(m.group(2))
        return date(infer_year(mon, day, now, int(m.group(3)) if m.group(3) else None), mon, day)
    except ValueError:
        return None


def parse_date_text(text: str, now: datetime, year_hint: int | None = None) -> datetime | None:
    m = DATE_RE.search(text)
    if not m:
        return None
    mon = MONTHS.get(m.group(1).lower()[:3]) if m.group(1).lower() not in MONTHS else MONTHS[m.group(1).lower()]
    if not mon:
        return None
    day = int(m.group(2))
    year = int(m.group(3)) if m.group(3) else infer_year(mon, day, now, year_hint)
    hour = int(m.group(4)) % 12 + (12 if m.group(6).lower() == "p" else 0)
    minute = int(m.group(5) or 0)
    try:
        return datetime(year, mon, day, hour, minute, tzinfo=NY).astimezone(UTC)
    except ValueError:
        return None


MONEY = r"\$\s?(\d[\d,]*(?:\.\d{1,2})?)"
LABELS: list[tuple[str, str, str]] = [
    # (field, regex, kind) — regex group 1 is the value
    ("lowest_ask_cents", rf"lowest\s+ask[^$\d]{{0,30}}{MONEY}", "money"),
    ("highest_bid_cents", rf"highest\s+bid[^$\d]{{0,30}}{MONEY}", "money"),
    ("last_sale_cents", rf"last\s+(?:sale|sold)[^$\d]{{0,30}}{MONEY}", "money"),
    ("all_in_lowest_cents", rf"all[\s-]*in[^$\d]{{0,40}}{MONEY}", "money"),
    ("all_in_lowest_cents", rf"{MONEY}[^$\n]{{0,20}}all[\s-]*in", "money"),
    ("floor_cents", rf"tickets?\s+from\s+{MONEY}", "money"),
    ("floor_cents", rf"floor\s+price[^$\d]{{0,30}}{MONEY}", "money"),
    ("looking_to_go", r"(\d[\d,]*)\s+(?:people\s+)?looking\s+to\s+go", "int"),
    ("looking_to_go", r"looking\s+to\s+go[^\d\n]{0,10}(\d[\d,]*)", "int"),
    ("looking_to_sell", r"(\d[\d,]*)\s+(?:people\s+)?looking\s+to\s+sell", "int"),
    ("looking_to_sell", r"looking\s+to\s+sell[^\d\n]{0,10}(\d[\d,]*)", "int"),
    ("ticket_limit", r"(?:ticket\s+limit|limit)[^\d\n]{0,15}(\d{1,2})", "int"),
    ("ticket_limit", r"max(?:imum)?\s+(?:of\s+)?(\d{1,2})\s+tickets?", "int"),
    ("ask_count", r"(\d[\d,]*)\s+tickets?\s+available", "int"),
    ("ask_count", r"tickets?\s+available[^\d\n]{0,6}(\d[\d,]*)", "int"),
    ("bid_count", r"(\d[\d,]*)\s+interested\s+buyers?", "int"),
    ("bid_count", r"interested\s+buyers?[^\d\n]{0,6}(\d[\d,]*)", "int"),
]
WALLET_TEXT = [
    r"([a-z ]{2,20}?)\s+wallet",
    r"(?:transfer(?:red)?|delivered|sent)\s+(?:via|through|on|in)\s+(?:the\s+)?([a-z ]{2,20})",
    r"(?:ticket\s+(?:provider|platform|type|source))\s*[:\-]?\s*([a-z ]{2,20})",
    r"([a-z]{2,15})\s+(?:mobile\s+)?tickets?\s+(?:only|transfer)",
]
LISTING_QTY = re.compile(r"^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+tickets?$", re.I)
LISTING_PRICE = re.compile(r"(?:\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(--|—|-))\s*(?:/\s*)?ea(?:ch)?\b", re.I)


def parse_listing_rows(text: str) -> list[tuple[int | None, int | None]]:
    """Rows look like: <name> / <ticket type> / '1-2 Tickets' / '$250ea' (or '--ea' when hidden)."""
    rows: list[tuple[int | None, int | None]] = []
    pending_qty: int | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        mq = LISTING_QTY.match(line)
        if mq:
            pending_qty = int(mq.group(2) or mq.group(1))
            continue
        mp = LISTING_PRICE.search(line)
        if mp:
            price = cents(mp.group(1)) if mp.group(1) else None
            rows.append((price, pending_qty))
            pending_qty = None
    return rows


def parse_text_fields(text: str, p: CvParsed, layer: str) -> None:
    flat = re.sub(r"[ \t]+", " ", text)
    for fld, rx, kind in LABELS:
        m = re.search(rx, flat, re.I)
        if m:
            p.set(fld, cents(m.group(1)) if kind == "money" else _int(m.group(1)), layer)
    if p.wallet_type is None:
        low = flat.lower()
        for rx in WALLET_TEXT:
            for m in re.finditer(rx, low):
                w = normalize_wallet(m.group(1))
                if w:
                    p.set("wallet_type", w, layer)
                    break
            if p.wallet_type:
                break


def detect_block(html: str) -> bool:
    head = html[:4000].lower()
    return ("just a moment" in head or "attention required" in head) and "cloudflare" in html.lower()


def parse_event_page(
    url: str,
    html: str,
    text_buy: str = "",
    text_sell: str = "",
    network_json: list[Any] | None = None,
    now: datetime | None = None,
) -> CvParsed:
    now = now or utcnow()
    p = CvParsed(url=url)
    if detect_block(html):
        p.blocked = True
        return p
    for blob in network_json or []:
        walk_json(blob, p, "network")
    emb = embedded_json(html)
    for blob in emb:
        walk_json(blob, p, "embedded")

    # --- event metadata
    ld = _ld_event(emb)
    if ld:
        p.set("title", (ld.get("name") or "").strip() or None, "ldjson")
        sd = ld.get("startDate")
        if isinstance(sd, str):
            try:
                dt = datetime.fromisoformat(sd.replace("Z", "+00:00"))
                p.set("starts_at", (dt if dt.tzinfo else dt.replace(tzinfo=NY)).astimezone(UTC), "ldjson")
            except ValueError:
                pass
        loc = ld.get("location") or {}
        if isinstance(loc, dict):
            p.set("venue_name", loc.get("name"), "ldjson")
            addr = loc.get("address")
            if isinstance(addr, dict):
                addr = ", ".join(str(v) for k, v in addr.items() if not k.startswith("@") and v)
            p.set("address", addr if isinstance(addr, str) else None, "ldjson")
        perf = ld.get("performer")
        if isinstance(perf, list):
            p.set("lineup", [x.get("name") for x in perf if isinstance(x, dict) and x.get("name")], "ldjson")

    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', html) or re.search(
        r'<meta[^>]+content="([^"]+)"[^>]+property="og:title"', html
    )
    if m:
        p.set("title", _clean_title(_unescape(m.group(1))), "og")
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    if m:
        p.set("title", _unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() or None, "h1")
    if not p.title:
        m = re.search(r"<title>(.*?)</title>", html, re.S)
        if m:
            p.set("title", _clean_title(_unescape(m.group(1))), "title")

    year_hint = None
    ym = re.search(r"-(20\d\d)(?:-|$)", url)
    if ym:
        year_hint = int(ym.group(1))
    text_all = "\n".join(t for t in (text_buy, text_sell) if t) or _html_text(html)
    p.set("starts_at", parse_date_text(text_all, now, year_hint), "text")
    if p.venue_name is None:
        vm = re.search(r'href="/venue/[^"]+"[^>]*>(.*?)</a>', html, re.S)
        if vm:
            p.set("venue_name", _unescape(re.sub(r"<[^>]+>", "", vm.group(1))).strip() or None, "venue_link")
    if p.venue_name is None:
        dm = DATE_RE.search(text_all)
        if dm:
            rest = text_all[dm.end() :].split("\n", 1)[0]
            vm2 = re.match(r"\s*[•·|]\s*([^•·|\n]{3,60})", rest)
            if vm2:
                p.set("venue_name", vm2.group(1).strip(), "text")
    am = re.search(r"([^\n]{0,80}?\b[A-Z][a-zA-Z .]+,\s*([A-Z]{2})\s+(\d{5}))", text_all)
    if am:
        p.set("address", am.group(1).strip(), "text")
    if p.lineup == []:
        perf_links = re.findall(r'href="/performer/[^"]+"[^>]*>(.*?)</a>', html, re.S)
        names = [_unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in perf_links]
        p.set("lineup", list(dict.fromkeys(n for n in names if n)), "performer_links")
    p.is_nyc = _is_nyc(p.address, url)

    # --- market data from visible text
    if text_buy:
        parse_text_fields(text_buy, p, "text_buy")
        p.set("asks", parse_listing_rows(text_buy), "text_buy")
    if text_sell:
        parse_text_fields(text_sell, p, "text_sell")
        p.set("bids", parse_listing_rows(text_sell), "text_sell")
    if not text_buy and not text_sell:
        parse_text_fields(text_all, p, "html_text")

    # --- derived values
    ask_prices = [pr for pr, _ in p.asks if pr is not None]
    bid_prices = [pr for pr, _ in p.bids if pr is not None]
    if ask_prices:
        p.set("lowest_ask_cents", min(ask_prices), "derived_asks")
    if bid_prices:
        p.set("highest_bid_cents", max(bid_prices), "derived_bids")
    if p.asks:
        p.set("ask_count", len(p.asks), "derived_asks")
    if p.bids:
        p.set("bid_count", len(p.bids), "derived_bids")
    if p.lowest_ask_cents is None and p.floor_cents is not None:
        p.set("lowest_ask_cents", p.floor_cents, "floor")
    return p


def _unescape(s: str) -> str:
    import html as _h

    return _h.unescape(s)


def _clean_title(t: str) -> str | None:
    t = re.sub(r"\s*[|–-]\s*CrowdVolt.*$", "", t, flags=re.I).strip()
    t = re.sub(r"\s*(?:tickets?)$", "", t, flags=re.I).strip()
    return t or None


def _html_text(html: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</(?:p|div|li|h\d|span|a|button)>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    return _unescape(t)


def _is_nyc(address: str | None, url: str) -> bool | None:
    if address:
        a = address.lower()
        if re.search(r"\b(new york|brooklyn|queens|manhattan|bronx|staten island)\b", a) or re.search(r",\s*ny\b", a):
            return True
        if re.search(r",\s*[a-z]{2}\s+\d{5}", a):
            return False
    return None


# ============================================================== cadence


def cadence_hours(starts_at: datetime | None, now: datetime) -> float | None:
    """§1.3: daily >14 d out, every 6 h at 3-14 d, hourly inside 72 h, stop after the event ends.

    End time is not published consistently; an event counts as ended 12 h after its start."""
    if starts_at is None:
        return 24.0
    left = starts_at - now
    if left < -timedelta(hours=12):
        return None
    if left <= timedelta(hours=72):
        return 1.0
    if left <= timedelta(days=14):
        return 6.0
    return 24.0


def is_due(starts_at: datetime | None, last_captured: datetime | None, now: datetime) -> bool:
    h = cadence_hours(starts_at, now)
    if h is None:
        return False
    if last_captured is None:
        return True
    return now - last_captured >= timedelta(hours=h) - timedelta(minutes=5)


# ============================================================== discovery


def url_is_candidate(url: str, cfg: dict[str, Any], now: datetime) -> bool:
    u = url.lower()
    if "/event/" not in u:
        return False
    slug = u.rstrip("/").rsplit("/", 1)[-1]
    if any(k in slug for k in cfg.get("nyc_exclude_keywords", [])):
        return False
    if not any(k in slug for k in cfg.get("nyc_url_keywords", [])):
        return False
    d = slug_date(url, now)
    today = now.astimezone(NY).date()
    if d is not None and (d < today - timedelta(days=1) or d > today + timedelta(days=cfg.get("days_ahead", 60))):
        return False
    return True


def sitemap_event_urls(xml: str) -> list[str]:
    return [u.strip() for u in re.findall(r"<loc>\s*([^<]*/event/[^<]+?)\s*</loc>", xml)]


def links_in(html: str, base: str) -> list[str]:
    out = []
    for h in re.findall(r'href="(/event/[^"#?]+)"', html):
        out.append(base.rstrip("/") + h)
    for h in re.findall(r'href="(https://www\.crowdvolt\.com/event/[^"#?]+)"', html):
        out.append(h)
    return list(dict.fromkeys(out))


class _StateFile:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        try:
            return dict(json.loads(self.path.read_text()))
        except (FileNotFoundError, ValueError):
            return {}

    def save(self, d: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(d, indent=1, default=str))


# ============================================================== browser


def profile_dir() -> Path:
    d = get_settings().browser_profiles_dir / SITE
    d.mkdir(parents=True, exist_ok=True)
    os.chmod(d.parent, 0o700)
    os.chmod(d, 0o700)
    return d


def login() -> None:
    """Open a headed browser on the persistent profile; the user logs in by hand, then presses Enter."""
    from playwright.sync_api import sync_playwright

    s = get_settings()
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            str(profile_dir()),
            executable_path=s.chromium_executable,
            headless=False,
            user_agent=s.user_agent,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(site_config()[SITE]["base_url"], wait_until="domcontentloaded")
        input("Log in to CrowdVolt in the browser window, then press Enter here to save the session... ")
        ctx.close()
    print(f"Saved profile to {profile_dir()} (mode 700).")


@dataclass
class PageCapture:
    url: str
    html: str
    text_buy: str
    text_sell: str
    network_json: list[Any]
    screenshot: bytes | None
    status: int | None


class CrowdVoltBrowser:
    def __init__(self, ctx: CrawlContext, headless: bool | None = None):
        self.ctx = ctx
        self.s = ctx.settings
        self.cfg = site_config()[SITE]
        self.pol = Politeness(SITE, self.s, ignore_robots=self.s.crowdvolt_ignore_robots)
        self.headless = self.s.crowdvolt_headless if headless is None else headless
        self._pw: Any = None
        self.browser_ctx: Any = None

    def __enter__(self) -> CrowdVoltBrowser:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self.browser_ctx = self._pw.chromium.launch_persistent_context(
            str(profile_dir()),
            executable_path=self.s.chromium_executable,
            headless=self.headless,
            user_agent=self.s.user_agent,
            viewport={"width": 1280, "height": 1600},
            locale="en-US",
            timezone_id="America/New_York",
        )
        return self

    def __exit__(self, *exc: Any) -> None:
        try:
            if self.browser_ctx:
                self.browser_ctx.close()
        finally:
            if self._pw:
                self._pw.stop()

    def fetch_text(self, url: str) -> str:
        """Raw GET through the browser context (shares cookies); used for sitemap.xml."""
        self.pol.before_request(url)
        r = self.browser_ctx.request.get(url, timeout=45000)
        self.ctx.page()
        return str(r.text())

    def load(self, url: str, want_sell_tab: bool = True) -> PageCapture:
        self.pol.before_request(url)
        page = self.browser_ctx.new_page()
        captured: list[tuple[str, Any]] = []

        def on_response(resp: Any) -> None:
            try:
                ct = (resp.headers or {}).get("content-type", "")
                if "json" in ct and "crowdvolt" in resp.url:
                    captured.append((resp.url, resp.json()))
            except Exception:  # noqa: BLE001 - body may be gone; ignore
                pass

        page.on("response", on_response)
        status = None
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
            status = resp.status if resp else None
            self.ctx.page()
            # Give a normal browser time to finish a Cloudflare interstitial and hydrate the app.
            deadline = time.time() + 25
            while time.time() < deadline and detect_block(page.content()):
                page.wait_for_timeout(1500)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(int(self.cfg.get("page_settle_ms", 6000)))
            html = page.content()
            text_buy = page.inner_text("body") if not detect_block(html) else ""
            text_sell = ""
            if want_sell_tab and text_buy:
                text_sell = self._click_sell(page)
            shot = page.screenshot(full_page=True) if self.ctx.debug_dump else None
            return PageCapture(url, html, text_buy, text_sell, [c for _, c in captured], shot, status)
        finally:
            page.close()

    @staticmethod
    def _click_sell(page: Any) -> str:
        strategies = [
            lambda: page.get_by_role("tab", name=re.compile(r"^\s*sell\s*$", re.I)),
            lambda: page.get_by_role("button", name=re.compile(r"^\s*sell\s*$", re.I)),
            lambda: page.locator("text=/^\\s*Sell\\s*$/"),
            lambda: page.locator("[data-tab='sell'], [aria-controls*='sell' i]"),
        ]
        for strat in strategies:
            try:
                loc = strat()
                if loc.count() > 0:
                    loc.first.click(timeout=4000)
                    page.wait_for_timeout(2500)
                    return str(page.inner_text("body"))
            except Exception:  # noqa: BLE001 - try next strategy
                continue
        return ""


# ============================================================== crawl


def _last_cv_capture(session: Session, event_id: int) -> datetime | None:
    return session.scalar(select(func.max(CvEventSnapshot.captured_at)).where(CvEventSnapshot.event_id == event_id))


def plan_urls(
    session: Session, discovered: list[str], cfg: dict[str, Any], now: datetime, force: bool, non_nyc: set[str]
) -> list[str]:
    known: dict[str, EventSource] = {
        s.url: s for s in session.scalars(select(EventSource).where(EventSource.site == SITE)) if s.url
    }
    seeds = [u for u in cfg.get("seed_urls", [])]
    due: list[tuple[int, datetime, str]] = []
    for url in dict.fromkeys(seeds + discovered + list(known)):
        if url in non_nyc:
            continue
        src = known.get(url)
        if src is None:
            due.append((0 if url in seeds else 2, now, url))
            continue
        ev = session.get(Event, src.event_id)
        if ev is None:
            continue
        starts = ev.starts_at
        if force:
            if cadence_hours(starts, now) is not None:
                due.append((0 if url in seeds else 1, starts or now, url))
            continue
        if is_due(starts, _last_cv_capture(session, ev.id), now):
            due.append((0 if url in seeds else 1, starts or now, url))
    due.sort(key=lambda x: (x[0], x[1]))
    return [u for _, _, u in due]


def discover(br: CrowdVoltBrowser, cfg: dict[str, Any], now: datetime, force: bool) -> list[str]:
    state = _StateFile(br.s.cache_dir / "crowdvolt_discovery.json")
    st = state.load()
    if not force and st.get("at") and time.time() - float(st["at"]) < 20 * 3600:
        return list(st.get("urls", []))
    base = cfg["base_url"]
    urls: list[str] = []
    blocks = 0
    for path in cfg.get("listing_paths", []) + cfg.get("venue_paths", []):
        try:
            cap = br.load(base + path, want_sell_tab=False)
        except (RateLimited, RobotsDisallowed):
            raise
        except Exception as e:  # noqa: BLE001
            log.info("discovery page %s failed: %s", path, e)
            continue
        if detect_block(cap.html):
            blocks += 1
            br.ctx.error(f"discovery blocked by Cloudflare at {path}")
            if blocks >= 2:
                break
            continue
        br.ctx.archive(cap.url, cap.html, "html")
        found = links_in(cap.html, base)
        urls += found
        log.info("discovery %s → %d event links", path, len(found))
    try:
        xml = br.fetch_text(cfg["sitemap"])
        br.ctx.archive(cfg["sitemap"], xml, "xml")
        sm = [u for u in sitemap_event_urls(xml) if url_is_candidate(u, cfg, now)]
        log.info("sitemap → %d NYC candidates", len(sm))
        urls += sm
    except RateLimited:
        raise
    except Exception as e:  # noqa: BLE001
        br.ctx.error(f"sitemap fetch failed: {e}")
    urls = list(dict.fromkeys(urls))
    if urls:  # never cache an empty (e.g. blocked) discovery for 20 h
        state.save({"at": time.time(), "urls": urls})
    return urls


def write_snapshot(
    session: Session, ctx: CrawlContext | None, parsed: CvParsed, run_id: int | None = None, now: datetime | None = None
) -> Event | None:
    now = now or utcnow()
    if not parsed.title:
        return None
    ext = parsed.url.rstrip("/").rsplit("/", 1)[-1]
    ev, _src, _ = upsert_event_from_source(
        session,
        site=SITE,
        external_id=ext,
        url=parsed.url,
        title=parsed.title,
        starts_at=parsed.starts_at,
        venue_name=parsed.venue_name,
        lineup=parsed.lineup or None,
    )
    if parsed.wallet_type:
        ev.cv_wallet_type = parsed.wallet_type
        ev.cv_listable = True
        if ev.primary_provider is None and parsed.wallet_type in Provider.__members__:
            ev.primary_provider = Provider(parsed.wallet_type)

    def add(row: Any) -> None:
        if ctx is not None:
            ctx.add(row)
        else:
            row.crawl_run_id = run_id
            session.add(row)

    add(
        CvEventSnapshot(
            event_id=ev.id,
            lowest_ask_cents=parsed.lowest_ask_cents,
            all_in_lowest_cents=parsed.all_in_lowest_cents,
            highest_bid_cents=parsed.highest_bid_cents,
            ask_count=parsed.ask_count,
            bid_count=parsed.bid_count,
            looking_to_go=parsed.looking_to_go,
            looking_to_sell=parsed.looking_to_sell,
            last_sale_cents=parsed.last_sale_cents,
            ticket_limit=parsed.ticket_limit,
            parse_ok=parsed.parse_ok,
            captured_at=now,
        )
    )
    for pr, q in parsed.asks:
        add(CvBookSnapshot(event_id=ev.id, side=Side.ASK, price_cents=pr, quantity=q, captured_at=now))
    for pr, q in parsed.bids:
        add(CvBookSnapshot(event_id=ev.id, side=Side.BID, price_cents=pr, quantity=q, captured_at=now))
    return ev


def crawl(
    force: bool = False,
    debug_dump: bool = False,
    max_pages: int | None = None,
    urls: list[str] | None = None,
    headless: bool | None = None,
) -> dict[str, Any]:
    cfg = site_config()[SITE]
    now = utcnow()
    stats = {"pages": 0, "snapshots": 0, "parse_failures": 0, "blocked": 0, "skipped_non_nyc": 0}
    non_nyc_state = _StateFile(get_settings().cache_dir / "crowdvolt_non_nyc.json")
    non_nyc = set(non_nyc_state.load().get("urls", []))
    with crawl_run(SITE, force=force, debug_dump=debug_dump) as ctx, CrowdVoltBrowser(ctx, headless) as br:
        try:
            discovered = urls if urls is not None else discover(br, cfg, now, force)
        except (RateLimited, RobotsDisallowed) as e:
            ctx.error(str(e))
            return stats
        todo = urls if urls is not None else plan_urls(ctx.session, discovered, cfg, now, force, non_nyc)
        log.info("crowdvolt: %d pages due", len(todo))
        consecutive_blocks = 0
        for url in todo:
            if max_pages is not None and stats["pages"] >= max_pages:
                break
            if not force and br.pol.cache.get(url) is not None:
                continue  # fetched within the last hour
            try:
                cap = br.load(url)
            except RateLimited as e:
                ctx.error(f"stopping: {e}")
                break
            except RobotsDisallowed as e:
                ctx.error(str(e))
                break
            except Exception as e:  # noqa: BLE001
                ctx.error(f"load failed {url}: {e}")
                continue
            stats["pages"] += 1
            br.pol.cache.put(url, "", {"status": cap.status})
            html_path = ctx.archive(url, cap.html, "html")
            ctx.archive(
                url,
                json.dumps(
                    {
                        "url": url,
                        "status": cap.status,
                        "network_json": cap.network_json,
                        "text_buy": cap.text_buy,
                        "text_sell": cap.text_sell,
                    }
                ),
                "json",
                stem=html_path.with_suffix(""),
            )
            parsed = parse_event_page(url, cap.html, cap.text_buy, cap.text_sell, cap.network_json, now=utcnow())
            if parsed.blocked:
                stats["blocked"] += 1
                consecutive_blocks += 1
                ctx.dump_debug(url, cap.html, cap.screenshot, "blocked by Cloudflare")
                ctx.error(f"blocked by Cloudflare at {url}")
                if consecutive_blocks >= 2:
                    ctx.error("two consecutive blocks; aborting run (try `volt login crowdvolt` / headed mode)")
                    break
                continue
            consecutive_blocks = 0
            if parsed.is_nyc is False:
                non_nyc.add(url)
                non_nyc_state.save({"urls": sorted(non_nyc)})
                stats["skipped_non_nyc"] += 1
                continue
            if not parsed.parse_ok:
                stats["parse_failures"] += 1
                ctx.dump_debug(
                    url, cap.html, cap.screenshot, f"parse failed; fields={parsed.sources}\n\n{cap.text_buy[:5000]}"
                )
                ctx.error(f"parse incomplete for {url} (raw page archived; snapshot written with parse_ok=0)")
            ev = write_snapshot(ctx.session, ctx, parsed)
            if ev is not None:
                stats["snapshots"] += 1
            ctx.commit()
    return stats


def import_page(path: Path, url: str, text_path: Path | None = None) -> Event | None:
    """Parse a page saved by hand from a browser (fallback when automation is blocked)."""
    html = path.read_text(encoding="utf-8", errors="replace")
    text = text_path.read_text(encoding="utf-8") if text_path else _html_text(html)
    with crawl_run(SITE + "_import") as ctx:
        ctx.archive(url, html, "html")
        parsed = parse_event_page(url, html, text_buy=text, now=utcnow())
        if parsed.blocked:
            raise ValueError("saved page is a Cloudflare interstitial, not the event page")
        ev = write_snapshot(ctx.session, ctx, parsed)
        ctx.page()
        return ev


def reparse_raw(run_id: int | None = None) -> int:
    """Rebuild snapshots from archived raw captures into a NEW crawl run (old rows are left untouched)."""
    from volt.db import RawCapture

    n = 0
    with crawl_run(SITE + "_reparse") as ctx:
        q = select(RawCapture).where(RawCapture.site == SITE, RawCapture.kind == "json")
        if run_id:
            q = q.where(RawCapture.crawl_run_id == run_id)
        for rc in ctx.session.scalars(q):
            data = json.loads(Path(rc.path).read_text())
            html_path = Path(rc.path).with_suffix(".html")
            html = html_path.read_text() if html_path.exists() else ""
            parsed = parse_event_page(
                data["url"],
                html,
                data.get("text_buy", ""),
                data.get("text_sell", ""),
                data.get("network_json"),
                now=rc.captured_at,
            )
            if parsed.title and not parsed.blocked and parsed.is_nyc is not False:
                write_snapshot(ctx.session, ctx, parsed, now=rc.captured_at)
                n += 1
    return n

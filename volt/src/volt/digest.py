"""Daily digest: top 5 by score, open paper trades, crawl health. Telegram if configured, else stdout.

The bot is send-only: Volt never polls for updates, so there are no commands and no buttons. If a
listener is ever added, every update must pass `allowed_update` first.
"""

from __future__ import annotations

import asyncio
import statistics
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from volt.config import get_settings
from volt.db import CrawlRun, Event, PaperTrade, TradeStatus, Venue, utcnow
from volt.scoring import latest_cv, latest_scores, lowest_available_tier

NY = ZoneInfo("America/New_York")
SITES = ("crowdvolt", "dice", "ra")


def money(c: int | None) -> str:
    return "—" if c is None else f"${c / 100:,.0f}"


def allowed_update(update: Any, allowed: list[int]) -> bool:
    """Drop every incoming Telegram update whose chat id is not allow-listed."""
    chat = getattr(update, "effective_chat", None) or getattr(getattr(update, "message", None), "chat", None)
    cid = getattr(chat, "id", None)
    return cid is not None and int(cid) in set(allowed)


def crawl_health(session: Session, now: datetime) -> list[dict[str, Any]]:
    out = []
    for site in SITES:

        def rows(a: datetime, b: datetime, site: str = site) -> int:
            return int(
                session.scalar(
                    select(func.coalesce(func.sum(CrawlRun.rows_written), 0)).where(
                        CrawlRun.site == site, CrawlRun.started_at >= a, CrawlRun.started_at < b
                    )
                )
                or 0
            )

        last24 = rows(now - timedelta(days=1), now)
        prior = [rows(now - timedelta(days=d + 1), now - timedelta(days=d)) for d in range(1, 8)]
        med = statistics.median(prior)
        flag = med > 0 and last24 < 0.5 * med
        if med == 0 and last24 == 0:
            flag = True
        out.append({"site": site, "last24": last24, "median7": med, "flag": flag})
    return out


def build_digest(session: Session, now: datetime | None = None) -> str:
    now = now or utcnow()
    lines = [f"⚡ Volt digest — {now.astimezone(NY):%a %b %d, %H:%M} ET", "(data only: no buy recommendations)", ""]
    upcoming = [(e, s) for e, s in latest_scores(session) if e.starts_at and e.starts_at > now]
    upcoming.sort(key=lambda es: (-es[1].score, es[0].starts_at))
    lines.append("Top 5 by score")
    if not upcoming:
        lines.append("  (no scored events yet)")
    for e, s in upcoming[:5]:
        v = session.get(Venue, e.venue_id) if e.venue_id else None
        low = lowest_available_tier(session, e.id)
        cv = latest_cv(session, e.id)
        assert e.starts_at is not None
        parts = [
            e.title[:60],
            e.starts_at.astimezone(NY).strftime("%a %b %d"),
            v.name if v else (e.venue_name_raw or "?"),
            f"{s.score:.0f}{' ✅' if s.gates_passed else ''}",
            f"tier {money(low['price_cents']) if low else '—'}",
            f"CV bid/ask {money(cv.highest_bid_cents) if cv else '—'}/{money(cv.lowest_ask_cents) if cv else '—'}",
        ]
        line = "• " + " · ".join(parts)
        if s.gate_failures:
            line += "\n    gates: " + "; ".join(s.gate_failures)
        lines.append(line)
    lines += ["", "Open paper trades"]
    trades = list(session.scalars(select(PaperTrade).where(PaperTrade.status == TradeStatus.OPEN)))
    if not trades:
        lines.append("  (none)")
    for t in trades:
        e2 = session.get(Event, t.event_id)
        cv = latest_cv(session, t.event_id)
        lines.append(
            f"• {e2.title[:50] if e2 else t.event_id} · {t.qty}× {money(t.buy_price_cents)} · "
            f"sell {t.target_sell_at.astimezone(NY):%b %d} · CV ask {money(cv.lowest_ask_cents) if cv else '—'}"
        )
    lines += ["", "Crawl health (rows 24h vs 7-day median)"]
    for h in crawl_health(session, now):
        lines.append(f"• {h['site']}: {h['last24']} vs {h['median7']:.0f}{'  ⚠️ LOW' if h['flag'] else ''}")
    return "\n".join(lines)


def send(text: str) -> str:
    s = get_settings()
    token = s.telegram_bot_token.get_secret_value() if s.telegram_bot_token else None
    if not token or not s.telegram_allowed_chat_ids:
        print(text)
        return "stdout"

    async def _go() -> None:
        from telegram import Bot

        async with Bot(token) as bot:
            for cid in s.telegram_allowed_chat_ids:
                for chunk in [text[i : i + 3900] for i in range(0, len(text), 3900)]:
                    await bot.send_message(chat_id=cid, text=chunk, disable_web_page_preview=True)

    asyncio.run(_go())
    return "telegram"

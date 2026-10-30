"""`volt evaluate` metrics and `volt export` CSVs."""

from __future__ import annotations

import csv
import json
import statistics
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from volt.config import get_settings
from volt.db import Base, Event, Outcome, PaperTrade, Score, TradeStatus
from volt.paper import trade_multiple

WIN_MULTIPLE = 1.3
COMPONENTS = ("calendar_peak", "tier_velocity", "brand_tier", "cv_book", "scarcity_event", "competing_supply")


def _flagged_ids(session: Session, threshold: float) -> set[int]:
    return set(session.scalars(select(Score.event_id).where(Score.gates_passed.is_(True), Score.score >= threshold)))


def _pre_event_score(session: Session, ev: Event) -> Score | None:
    """Last score taken at or before T-2 (what the model knew when it would have had to act)."""
    assert ev.starts_at is not None
    return session.scalar(select(Score).where(Score.event_id == ev.id,
                                              Score.scored_at <= ev.starts_at - timedelta(days=2))
                          .order_by(Score.scored_at.desc()).limit(1))


def evaluate(session: Session) -> dict[str, Any]:
    thr = get_settings().score_threshold
    trades = list(session.scalars(select(PaperTrade)))
    closed = [t for t in trades if t.status == TradeStatus.CLOSED]
    mults = [m for m in (trade_multiple(t) for t in closed) if m is not None]
    res: dict[str, Any] = {
        "trades_total": len(trades),
        "trades_open": sum(t.status == TradeStatus.OPEN for t in trades),
        "trades_no_market": sum(t.status == TradeStatus.NO_MARKET for t in trades),
        "trades_closed": len(closed),
        "hit_rate": (sum(m >= WIN_MULTIPLE for m in mults) / len(mults)) if mults else None,
        "mean_multiple": statistics.mean(mults) if mults else None,
        "median_multiple": statistics.median(mults) if mults else None,
        "worst_loss_cents": min((t.pnl_cents for t in closed if t.pnl_cents is not None), default=None),
    }
    flagged = _flagged_ids(session, thr)
    outcomes = list(session.execute(select(Event, Outcome).join(Outcome, Outcome.event_id == Event.id)))
    res["resolved_events"] = len(outcomes)
    res["missed_winners"] = [e.title for e, o in outcomes
                             if o.clearing_multiple is not None and o.clearing_multiple >= WIN_MULTIPLE
                             and e.id not in flagged]
    res["flagged_dumped"] = [e.title for e, o in outcomes
                             if e.id in flagged and o.clearing_multiple is not None and o.clearing_multiple < 1.0]
    sep: dict[str, Any] = {}
    pairs: list[tuple[dict[str, Any], float]] = []
    for e, o in outcomes:
        if o.clearing_multiple is None:
            continue
        sc = _pre_event_score(session, e)
        if sc is not None:
            pairs.append((sc.components or {}, o.clearing_multiple))
    for comp in COMPONENTS:
        vals = [(float((c.get(comp) or {}).get("points", 0)), m) for c, m in pairs]
        if len(vals) < 4:
            sep[comp] = None
            continue
        vals.sort(key=lambda x: x[0])
        q = max(1, len(vals) // 4)
        bottom, top = [m for _, m in vals[:q]], [m for _, m in vals[-q:]]
        sep[comp] = {"top_q_mean": statistics.mean(top), "bottom_q_mean": statistics.mean(bottom),
                     "separation": statistics.mean(top) - statistics.mean(bottom), "n": len(vals)}
    res["component_separation"] = sep
    return res


def export_all(session: Session, out_dir: Path | None = None) -> list[Path]:
    out_dir = out_dir or get_settings().export_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for table in Base.metadata.sorted_tables:
        p = out_dir / f"{table.name}.csv"
        rows = session.execute(table.select())
        with open(p, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow([c.name for c in table.columns])
            for r in rows:
                w.writerow([json.dumps(v) if isinstance(v, (dict, list)) else v for v in r])
        paths.append(p)
    return paths

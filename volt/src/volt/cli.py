"""Volt CLI. Every scheduled job is also a command. There is no buy command anywhere."""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo

import typer
from rich.console import Console
from rich.table import Table
from sqlalchemy import select

from volt.db import init_db, session_scope, utcnow
from volt.scheduler import setup_logging

app = typer.Typer(help="Volt Phase 0 — NYC rave ticket market watcher. Data only: no buying, no buy advice.",
                  no_args_is_help=True)
console = Console(width=None if sys.stdout.isatty() else 200)
NY = ZoneInfo("America/New_York")
SITES = ["crowdvolt", "dice", "ra"]


def _money(c: int | None) -> str:
    return "—" if c is None else f"${c / 100:,.0f}"


def _ensure() -> None:
    """Create/migrate the DB and (re)load venues + brands so YAML edits always apply."""
    from volt.matching import load_brands, load_venues

    init_db()
    with session_scope() as s:
        load_venues(s)
        load_brands(s)


@app.callback()
def _main(verbose: Annotated[bool, typer.Option("--verbose", "-v")] = False) -> None:
    setup_logging(verbose)


@app.command()
def init() -> None:
    """Create/migrate volt.db and load venues + brands from config."""
    from volt.matching import load_brands, load_venues

    init_db()
    with session_scope() as s:
        nv, nb = load_venues(s), load_brands(s)
    console.print(f"[green]volt.db ready[/] · {nv} venues · {nb} brands")


@app.command()
def login(site: Annotated[str, typer.Argument(help="crowdvolt")] = "crowdvolt") -> None:
    """Open a headed browser so you can log in by hand; the session is saved to .browser_profiles/."""
    if site != "crowdvolt":
        raise typer.BadParameter("only crowdvolt needs a login")
    from volt.crawlers import crowdvolt

    crowdvolt.login()


@app.command()
def crawl(
    site: Annotated[str, typer.Argument(help="crowdvolt | dice | ra | all")] = "all",
    force: Annotated[bool, typer.Option("--force", help="ignore the 1-hour cache and the cadence")] = False,
    debug_dump: Annotated[bool, typer.Option("--debug-dump", help="save HTML+screenshot to ./debug on failures")] = False,
    max_pages: Annotated[int | None, typer.Option(help="crowdvolt: stop after N event pages")] = None,
    url: Annotated[list[str] | None, typer.Option(help="crowdvolt: crawl only these URLs")] = None,
    headed: Annotated[bool, typer.Option("--headed", help="crowdvolt: show the browser window")] = False,
) -> None:
    """Crawl one or all sites (RA first, then Dice, then CrowdVolt), then run matching."""
    from volt.scheduler import job_crawl, job_match

    _ensure()
    order = ["ra", "dice", "crowdvolt"] if site == "all" else [site]
    for s in order:
        if s not in SITES:
            raise typer.BadParameter(f"unknown site {s}")
        kw: dict[str, object] = {}
        if s == "crowdvolt":
            kw = {"max_pages": max_pages, "urls": url or None, "headless": False if headed else None}
        try:
            stats = job_crawl(s, force=force, debug_dump=debug_dump, **kw)
            console.print(f"[green]{s}[/]: {stats}")
        except Exception as e:  # noqa: BLE001
            console.print(f"[red]{s} failed:[/] {e}")
            if site != "all":
                raise typer.Exit(1) from e
    r = job_match()
    console.print(f"match: merged {r['merged']}, {len(r['review'])} pairs for review")


@app.command()
def match() -> None:
    """Merge the same event seen on several sites (title + date ±1 day + venue, rapidfuzz ≥ 85)."""
    from volt.scheduler import job_match

    r = job_match()
    console.print(f"merged {r['merged']}; {len(r['review'])} low-confidence pairs (see `volt review-matches`)")


@app.command("review-matches")
def review_matches() -> None:
    """Print low-confidence pairs and sources for manual confirmation."""
    from volt.matching import low_confidence_sources, run_matching

    with session_scope() as s:
        r = run_matching(s)
        t = Table(title="Candidate pairs (not merged)")
        for col in ("event A", "title A", "event B", "title B", "conf", "title", "venue"):
            t.add_column(col)
        for p in r["review"]:
            t.add_row(str(p["a"]), p["a_title"][:45], str(p["b"]), p["b_title"][:45], str(p["confidence"]),
                      str(p["title"]), str(p["venue"]))
        console.print(t)
        t2 = Table(title="Low-confidence source links")
        for col in ("event", "title", "site", "url", "conf"):
            t2.add_column(col)
        for e, src in low_confidence_sources(s):
            t2.add_row(str(e.id), e.title[:45], src.site, (src.url or "")[:60], f"{src.match_confidence:.0f}")
        console.print(t2)
        console.print("Merge a pair by hand with: volt merge KEEP_ID DROP_ID")


@app.command()
def merge(keep: int, drop: int) -> None:
    """Manually merge event DROP into KEEP."""
    from volt.db import Event
    from volt.matching import merge_events

    with session_scope() as s:
        a, b = s.get(Event, keep), s.get(Event, drop)
        if not a or not b:
            raise typer.BadParameter("unknown event id")
        merge_events(s, a, b, 100.0)
    console.print(f"merged {drop} → {keep}")


@app.command()
def flag(
    event_id: int,
    scarcity: Annotated[bool | None, typer.Option("--scarcity/--no-scarcity", help="finale/relocation/make-good")] = None,
    added_date: Annotated[bool | None, typer.Option("--added-date/--no-added-date")] = None,
) -> None:
    """Set manual flags on an event (these are inputs, not signals)."""
    from volt.db import Event

    with session_scope() as s:
        e = s.get(Event, event_id)
        if not e:
            raise typer.BadParameter("unknown event id")
        if scarcity is not None:
            e.scarcity_flag = scarcity
        if added_date is not None:
            e.added_date_flag = added_date
        console.print(f"{e.title}: scarcity={e.scarcity_flag} added_date={e.added_date_flag}")


@app.command()
def score() -> None:
    """Score every upcoming event, open/close paper trades."""
    from volt.scheduler import job_score

    _ensure()
    console.print(job_score())


@app.command()
def watchlist(limit: int = 30, all_events: Annotated[bool, typer.Option("--all")] = False) -> None:
    """Ranked watchlist (latest score per event). Informational only."""
    from volt.db import Venue
    from volt.scoring import latest_cv, latest_scores, lowest_available_tier

    now = utcnow()
    with session_scope() as s:
        rows = [(e, sc) for e, sc in latest_scores(s) if e.starts_at and e.starts_at > now - timedelta(hours=12)]
        if not all_events:
            rows = [(e, sc) for e, sc in rows if sc.gates_passed or sc.score >= 30]
        rows.sort(key=lambda x: (-x[1].gates_passed, -x[1].score))
        t = Table(title=f"Volt watchlist · {now.astimezone(NY):%Y-%m-%d %H:%M} ET (no buy advice)")
        for col in ("id", "event", "date", "venue", "score", "gates", "low tier", "face", "CV bid", "CV ask",
                    "wallet", "failures"):
            t.add_column(col, overflow="fold")
        for e, sc in rows[:limit]:
            v = s.get(Venue, e.venue_id) if e.venue_id else None
            low = lowest_available_tier(s, e.id)
            cv = latest_cv(s, e.id)
            assert e.starts_at is not None
            t.add_row(str(e.id), e.title[:40], e.starts_at.astimezone(NY).strftime("%a %m/%d %H:%M"),
                      (v.name if v else e.venue_name_raw or "?")[:20], f"{sc.score:.0f}",
                      "[green]PASS[/]" if sc.gates_passed else "[red]fail[/]",
                      _money(low["price_cents"]) + (f" (t{low['index']})" if low and low["index"] else "") if low
                      else "—", _money(e.face_value_cents),
                      _money(cv.highest_bid_cents) if cv else "—", _money(cv.lowest_ask_cents) if cv else "—",
                      e.cv_wallet_type or "—", "; ".join(sc.gate_failures)[:80])
        console.print(t)
        if not rows:
            console.print("Nothing scored yet; run `volt score` (or `--all` to include low scores).")


@app.command()
def paper() -> None:
    """Show paper trades (and close any that are due)."""
    from volt import paper as p

    with session_scope() as s:
        p.close_due(s)
        t = Table(title="Paper trades (simulated; nothing is bought)")
        for col in ("event", "opened", "tier", "buy", "qty", "sell at", "sell", "multiple", "pnl", "status"):
            t.add_column(col)
        for r in p.summary(s):
            tr, ev, m = r["trade"], r["event"], r["multiple"]
            t.add_row(ev.title[:40] if ev else str(tr.event_id), tr.opened_at.astimezone(NY).strftime("%m/%d"),
                      (tr.buy_tier_name or "")[:25], _money(tr.buy_price_cents), str(tr.qty),
                      tr.target_sell_at.astimezone(NY).strftime("%m/%d %H:%M"), _money(tr.sell_price_cents),
                      f"{m:.2f}x" if m else "—", _money(tr.pnl_cents), tr.status.value)
        console.print(t)


@app.command()
def resolve() -> None:
    """Compute outcomes for every event whose start has passed."""
    from volt.scheduler import job_resolve

    console.print(f"resolved {job_resolve()} events")


@app.command()
def evaluate() -> None:
    """Hit rate, multiples, misses, dumps, per-component separation."""
    from volt.evaluate import evaluate as ev

    with session_scope() as s:
        r = ev(s)
    t = Table(title="Paper trades")
    t.add_column("metric")
    t.add_column("value")
    for k in ("trades_total", "trades_open", "trades_closed", "trades_no_market"):
        t.add_row(k, str(r[k]))
    t.add_row("hit rate (≥1.3x after fees)", f"{r['hit_rate']:.0%}" if r["hit_rate"] is not None else "—")
    t.add_row("mean multiple", f"{r['mean_multiple']:.2f}x" if r["mean_multiple"] else "—")
    t.add_row("median multiple", f"{r['median_multiple']:.2f}x" if r["median_multiple"] else "—")
    t.add_row("worst loss", _money(r["worst_loss_cents"]))
    t.add_row("resolved events", str(r["resolved_events"]))
    t.add_row("winners the gates missed", str(len(r["missed_winners"])))
    t.add_row("flagged events that dumped below face", str(len(r["flagged_dumped"])))
    console.print(t)
    t2 = Table(title="Per-component separation (mean clearing multiple, top vs bottom quartile)")
    for col in ("component", "top Q", "bottom Q", "separation", "n"):
        t2.add_column(col)
    for comp, v in r["component_separation"].items():
        if v is None:
            t2.add_row(comp, "—", "—", "— (need ≥4 resolved)", "")
        else:
            t2.add_row(comp, f"{v['top_q_mean']:.2f}", f"{v['bottom_q_mean']:.2f}", f"{v['separation']:+.2f}",
                       str(v["n"]))
    console.print(t2)
    if r["missed_winners"]:
        console.print("Missed winners: " + "; ".join(r["missed_winners"][:20]))


@app.command()
def export(out: Annotated[Path | None, typer.Option(help="output directory")] = None) -> None:
    """Write every table to CSV."""
    from volt.evaluate import export_all

    with session_scope() as s:
        paths = export_all(s, out)
    console.print(f"wrote {len(paths)} CSVs to {paths[0].parent if paths else out}")


@app.command()
def digest() -> None:
    """Build and send the daily digest (stdout when Telegram is not configured)."""
    from volt.scheduler import job_digest

    job_digest()


@app.command()
def run() -> None:
    """Run the scheduler (CrowdVolt adaptive, Dice/RA 6-hourly, resolve 03:00, digest 10:30 ET)."""
    from volt.scheduler import run as run_sched

    run_sched()


@app.command("import-page")
def import_page(
    file: Path,
    url: Annotated[str, typer.Option(help="the CrowdVolt event URL the page was saved from")],
    text: Annotated[Path | None, typer.Option(help="optional copy-pasted visible text")] = None,
) -> None:
    """Parse a CrowdVolt page you saved by hand (fallback if automation is blocked)."""
    from volt.crawlers import crowdvolt

    init_db()
    ev = crowdvolt.import_page(file, url, text)
    console.print(f"imported → event {ev.id if ev else '?'}")


@app.command()
def reparse(run_id: Annotated[int | None, typer.Option(help="only this crawl run")] = None) -> None:
    """Re-run the CrowdVolt parser over archived raw pages into a new crawl run (old rows untouched)."""
    from volt.crawlers import crowdvolt

    console.print(f"re-parsed {crowdvolt.reparse_raw(run_id)} pages")


@app.command("ra-query-hash")
def ra_query_hash(write: bool = False) -> None:
    """Print (or --write to config/sites.yaml) the sha256 of the pinned RA GraphQL query."""
    import re

    from volt.config import CONFIG_DIR
    from volt.crawlers.ra import query_sha256

    h = query_sha256()
    console.print(h)
    if write:
        p = CONFIG_DIR / "sites.yaml"
        p.write_text(re.sub(r"query_sha256: \S+", f"query_sha256: {h}", p.read_text()))
        console.print("written")


@app.command()
def status() -> None:
    """Recent crawl runs and row counts."""
    from volt.db import CrawlRun

    with session_scope() as s:
        t = Table(title="Recent crawl runs")
        for col in ("id", "site", "started (ET)", "status", "pages", "rows", "error"):
            t.add_column(col, overflow="fold")
        for r in s.scalars(select(CrawlRun).order_by(CrawlRun.id.desc()).limit(15)):
            t.add_row(str(r.id), r.site, r.started_at.astimezone(NY).strftime("%m/%d %H:%M"), r.status,
                      str(r.pages_fetched), str(r.rows_written), (r.error or "")[:120])
        console.print(t)


@app.command()
def show(event_id: int) -> None:
    """Dump everything known about one event."""
    from volt.db import Event, EventSource
    from volt.scoring import latest_cv, latest_tiers

    with session_scope() as s:
        e = s.get(Event, event_id)
        if not e:
            raise typer.BadParameter("unknown event id")
        console.print({k: getattr(e, k) for k in e.__mapper__.c.keys()})
        for src in s.scalars(select(EventSource).where(EventSource.event_id == e.id)):
            console.print(f"source {src.site}: {src.url} ({src.match_confidence:.0f})")
        cv = latest_cv(s, e.id)
        if cv:
            console.print({k: getattr(cv, k) for k in cv.__mapper__.c.keys()})
        for t in latest_tiers(s, e.id):
            console.print(f"tier {t.provider} #{t.tier_index} {t.tier_name}: {_money(t.price_cents)} "
                          f"{'available' if t.available else 'gone'}")
        console.print(json.dumps({"note": "informational only"}))


if __name__ == "__main__":
    app()

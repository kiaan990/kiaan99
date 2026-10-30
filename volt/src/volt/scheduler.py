"""Jobs (shared with the CLI) and the APScheduler loop for `volt run`."""

from __future__ import annotations

import logging
import logging.handlers
from typing import Any

from volt.config import ROOT, get_settings
from volt.db import init_db, session_scope

log = logging.getLogger("volt.jobs")


def setup_logging(verbose: bool = False) -> None:
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    root = logging.getLogger()
    if any(isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers):
        return
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = logging.handlers.RotatingFileHandler(logs / "volt.log", maxBytes=5_000_000, backupCount=5)
    fh.setFormatter(fmt)
    root.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)
    for noisy in ("httpx", "httpcore", "apscheduler.executors.default"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def job_score() -> dict[str, Any]:
    from volt import paper, scoring

    with session_scope() as s:
        res = scoring.score_all(s)
        opened = paper.open_trades(s, res)
        closed = paper.close_due(s)
    out = {"scored": len(res), "gated": sum(r.gates_passed for r in res), "opened": len(opened), "closed": len(closed)}
    log.info("score: %s", out)
    return out


def job_match() -> dict[str, Any]:
    from volt.matching import run_matching

    with session_scope() as s:
        r = run_matching(s)
    log.info("match: merged=%d review=%d", r["merged"], len(r["review"]))
    return r


def job_crawl(site: str, force: bool = False, debug_dump: bool = False, **kw: Any) -> dict[str, Any]:
    from volt.crawlers import crowdvolt, dice, ra

    fn = {"crowdvolt": crowdvolt.crawl, "dice": dice.crawl, "ra": ra.crawl}[site]
    log.info("crawl %s start", site)
    try:
        stats = fn(force=force, debug_dump=debug_dump, **kw)
    except Exception:
        log.exception("crawl %s failed", site)
        raise
    log.info("crawl %s done: %s", site, stats)
    return stats


def job_crawl_then_score(site: str) -> None:
    try:
        job_crawl(site)
    except Exception:  # noqa: BLE001 - logged; still score with what we have
        pass
    job_match()
    job_score()


def job_resolve() -> int:
    from volt.resolve import resolve_all

    with session_scope() as s:
        n = len(resolve_all(s))
    log.info("resolve: %d outcomes", n)
    return n


def job_digest() -> str:
    from volt import digest

    with session_scope() as s:
        text = digest.build_digest(s)
    where = digest.send(text)
    log.info("digest sent via %s", where)
    return where


def run() -> None:
    from apscheduler.schedulers.blocking import BlockingScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    setup_logging()
    init_db()
    tz = get_settings().timezone
    sched = BlockingScheduler(
        timezone=tz, job_defaults={"max_instances": 1, "coalesce": True, "misfire_grace_time": 1800}
    )
    # CrowdVolt: wake every 15 min; the crawler only loads pages that are due under the adaptive cadence.
    sched.add_job(
        job_crawl_then_score, IntervalTrigger(minutes=15), args=["crowdvolt"], id="crowdvolt", next_run_time=_soon(30)
    )
    sched.add_job(job_crawl_then_score, IntervalTrigger(hours=6), args=["ra"], id="ra", next_run_time=_soon(5))
    sched.add_job(job_crawl_then_score, IntervalTrigger(hours=6), args=["dice"], id="dice", next_run_time=_soon(90))
    sched.add_job(job_resolve, CronTrigger(hour=3, minute=0, timezone=tz), id="resolve")
    sched.add_job(job_digest, CronTrigger(hour=10, minute=30, timezone=tz), id="digest")
    for j in sched.get_jobs():
        log.info("scheduled %s next=%s trigger=%s", j.id, getattr(j, "next_run_time", None), j.trigger)
    log.info("volt scheduler started (tz=%s)", tz)
    sched.start()


def _soon(seconds: int) -> Any:
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo(get_settings().timezone)) + timedelta(seconds=seconds)

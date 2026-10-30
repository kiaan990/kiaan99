"""Shared crawler plumbing: politeness, cache, retries, crawl_runs logging, raw archive, snapshots.

Politeness rules (all sites):
  * robots.txt checked per URL (CrowdVolt override is an explicit, logged setting).
  * 2-6 s randomized delay between page loads to the same site.
  * token bucket: at most N requests per rolling hour per site, persisted on disk so separate
    CLI invocations and the scheduler share one budget.
  * exponential backoff on 429/5xx/network errors.
  * on-disk response cache; a URL fetched in the last hour is served from cache unless force=True.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import time
import urllib.robotparser
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy.orm import Session

from volt.config import Settings, get_settings
from volt.db import CrawlRun, RawCapture, session_scope, utcnow

log = logging.getLogger("volt.crawl")


class RobotsDisallowed(Exception):
    pass


class RateLimited(Exception):
    pass


class FetchError(Exception):
    pass


def _slug(url: str, n: int = 80) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", url.split("://", 1)[-1]).strip("-")
    return s[-n:]


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:24]


class TokenBucket:
    """Rolling-hour request budget, persisted as a JSON list of timestamps."""

    def __init__(self, path: Path, per_hour: int):
        self.path = path
        self.per_hour = per_hour
        path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> list[float]:
        try:
            return [float(t) for t in json.loads(self.path.read_text())]
        except (FileNotFoundError, ValueError):
            return []

    def remaining(self, now: float | None = None) -> int:
        now = now or time.time()
        return self.per_hour - len([t for t in self._load() if now - t < 3600])

    def take(self, now: float | None = None) -> None:
        now = now or time.time()
        stamps = [t for t in self._load() if now - t < 3600]
        if len(stamps) >= self.per_hour:
            wait = 3600 - (now - min(stamps))
            raise RateLimited(f"hourly budget of {self.per_hour} used; next slot in {wait:.0f}s")
        stamps.append(now)
        self.path.write_text(json.dumps(stamps))


class ResponseCache:
    """Cache keyed by URL + UTC hour bucket. Entries younger than max_age are reused."""

    def __init__(self, root: Path, max_age_s: int = 3600):
        self.root = root
        self.max_age_s = max_age_s
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str, bucket: int) -> Path:
        return self.root / f"{_hash(key)}_{bucket}.json"

    def get(self, key: str, now: float | None = None) -> dict[str, Any] | None:
        now = now or time.time()
        bucket = int(now // 3600)
        for b in (bucket, bucket - 1):
            p = self._path(key, b)
            if p.exists():
                entry: dict[str, Any] = json.loads(p.read_text())
                if now - entry["fetched_at"] < self.max_age_s:
                    return entry
        return None

    def put(self, key: str, body: str, meta: dict[str, Any] | None = None, now: float | None = None) -> None:
        now = now or time.time()
        entry = {"key": key, "fetched_at": now, "body": body, "meta": meta or {}}
        self._path(key, int(now // 3600)).write_text(json.dumps(entry))


class Politeness:
    """Per-site gatekeeper shared by httpx and Playwright fetches."""

    def __init__(
        self,
        site: str,
        settings: Settings | None = None,
        ignore_robots: bool = False,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.site = site
        self.s = settings or get_settings()
        self.ignore_robots = ignore_robots
        self.bucket = TokenBucket(self.s.cache_dir / "ratelimit" / f"{site}.json", self.s.rate_limit_per_hour)
        self.cache = ResponseCache(self.s.cache_dir / "responses" / site)
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._last_load = 0.0
        self._sleep = sleep

    def robots_allowed(self, url: str) -> bool:
        if self.ignore_robots:
            return True
        origin = "/".join(url.split("/", 3)[:3])
        rp = self._robots.get(origin)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = httpx.get(
                    origin + "/robots.txt", headers={"User-Agent": self.s.user_agent}, timeout=20, follow_redirects=True
                )
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except httpx.HTTPError:
                rp.parse([])  # unreachable robots.txt: treat as no rules
            self._robots[origin] = rp
        return rp.can_fetch(self.s.robots_agent, url)

    def before_request(self, url: str) -> None:
        if not self.robots_allowed(url):
            raise RobotsDisallowed(f"robots.txt disallows {url}")
        gap = random.uniform(self.s.delay_min_s, self.s.delay_max_s)
        elapsed = time.time() - self._last_load
        if self._last_load and elapsed < gap:
            self._sleep(gap - elapsed)
        self.bucket.take()
        self._last_load = time.time()


def with_backoff[T](
    fn: Callable[[], T], retries: int, base: float = 2.0, sleep: Callable[[float], None] = time.sleep
) -> T:
    attempt = 0
    while True:
        try:
            return fn()
        except (FetchError, httpx.TransportError) as e:
            attempt += 1
            if attempt > retries:
                raise
            wait = base**attempt + random.uniform(0, 1)
            log.warning("fetch failed (%s); retry %d/%d in %.1fs", e, attempt, retries, wait)
            sleep(wait)


@dataclass
class CrawlContext:
    """One crawl_runs row plus counters, raw archive and debug dump helpers."""

    site: str
    session: Session
    run: CrawlRun
    settings: Settings
    debug_dump: bool = False
    force: bool = False
    errors: list[str] = field(default_factory=list)

    @property
    def run_id(self) -> int:
        return self.run.id

    def page(self) -> None:
        self.run.pages_fetched += 1

    def add(self, row: Any) -> Any:
        """Append one snapshot/entity row stamped with this crawl run where applicable."""
        if hasattr(row, "crawl_run_id"):
            row.crawl_run_id = self.run.id
        self.session.add(row)
        self.run.rows_written += 1
        return row

    def archive(self, url: str, body: str | bytes, kind: str, stem: Path | None = None) -> Path:
        """Write a raw capture to disk and index it. Pass the stem of a previous capture to pair files."""
        if stem is None:
            day = datetime.now(UTC).strftime("%Y%m%d")
            d = self.settings.raw_dir / self.site / day
            d.mkdir(parents=True, exist_ok=True)
            stem = d / f"{self.run.id}_{time.time_ns()}_{_slug(url)}"
        p = Path(f"{stem}.{kind}")
        if isinstance(body, bytes):
            p.write_bytes(body)
        else:
            p.write_text(body, encoding="utf-8")
        self.session.add(RawCapture(crawl_run_id=self.run.id, site=self.site, url=url, path=str(p), kind=kind))
        return p

    def dump_debug(self, url: str, html: str, screenshot: bytes | None = None, reason: str = "") -> Path | None:
        if not self.debug_dump:
            return None
        d = self.settings.debug_dir
        d.mkdir(parents=True, exist_ok=True)
        stem = d / f"{self.site}_{datetime.now(UTC):%Y%m%dT%H%M%S}_{_slug(url, 60)}"
        Path(f"{stem}.html").write_text(html, encoding="utf-8")
        if screenshot:
            Path(f"{stem}.png").write_bytes(screenshot)
        if reason:
            Path(f"{stem}.txt").write_text(reason)
        log.warning("debug dump written: %s.*", stem)
        return stem

    def commit(self) -> None:
        self.session.commit()

    def error(self, msg: str) -> None:
        log.error("[%s] %s", self.site, msg)
        self.errors.append(msg)


@contextmanager
def crawl_run(site: str, *, force: bool = False, debug_dump: bool = False) -> Iterator[CrawlContext]:
    """Open a crawl_runs row (committed immediately) and a work session.

    Crawlers should call ctx.commit() after each page so a crash keeps everything captured so far.
    """
    s = get_settings()
    with session_scope() as sess:
        run = CrawlRun(site=site, started_at=utcnow(), status="RUNNING")
        sess.add(run)
        sess.commit()
        ctx = CrawlContext(site=site, session=sess, run=run, settings=s, debug_dump=debug_dump, force=force)
        try:
            yield ctx
        except BaseException as e:  # record the failure, keep committed rows, re-raise
            sess.rollback()
            run.status = "FAILED"
            run.error = (f"{type(e).__name__}: {e}\n" + "\n".join(ctx.errors))[:4000]
            run.finished_at = utcnow()
            sess.commit()
            raise
        run.status = "PARTIAL" if ctx.errors else "OK"
        if ctx.errors:
            run.error = "\n".join(ctx.errors)[:4000]
        run.finished_at = utcnow()


class HttpFetcher:
    """Polite httpx client for RA and Dice."""

    def __init__(
        self, site: str, ctx: CrawlContext | None = None, settings: Settings | None = None, ignore_robots: bool = False
    ):
        self.s = settings or get_settings()
        self.ctx = ctx
        self.pol = Politeness(site, self.s, ignore_robots=ignore_robots)
        self.last_from_cache = False
        self.client = httpx.Client(
            headers={"User-Agent": self.s.user_agent, "Accept-Language": "en-US,en;q=0.9"},
            timeout=30,
            follow_redirects=True,
        )

    def _request(self, method: str, url: str, cache_key: str, force: bool, **kw: Any) -> str:
        if not force:
            hit = self.pol.cache.get(cache_key)
            if hit is not None:
                log.info("cache hit %s", url)
                self.last_from_cache = True
                return str(hit["body"])
        self.last_from_cache = False

        def go() -> str:
            self.pol.before_request(url)
            r = self.client.request(method, url, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                raise FetchError(f"HTTP {r.status_code} for {url}")
            if r.status_code >= 400:
                raise httpx.HTTPStatusError(f"HTTP {r.status_code} for {url}", request=r.request, response=r)
            return r.text

        body = with_backoff(go, self.s.max_retries)
        self.pol.cache.put(cache_key, body, {"url": url})
        if self.ctx:
            self.ctx.page()
        return body

    def get(self, url: str, force: bool = False, **kw: Any) -> str:
        return self._request("GET", url, url, force, **kw)

    def post_json(self, url: str, payload: dict[str, Any], force: bool = False, **kw: Any) -> Any:
        key = url + "#" + json.dumps(payload, sort_keys=True)
        return json.loads(self._request("POST", url, key, force, json=payload, **kw))

    def close(self) -> None:
        self.client.close()


def cents(value: Any) -> int | None:
    """Parse '$1,234.50', '1234.5', 1234.5 → 123450. None for blanks/placeholders."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value) * 100))
    m = re.search(r"(\d[\d,]*(?:\.\d{1,2})?)", str(value))
    if not m:
        return None
    return int(round(float(m.group(1).replace(",", "")) * 100))

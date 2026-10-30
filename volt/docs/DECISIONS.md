# Decisions and assumptions

Dated 2026-10-30 unless noted. Each entry: what was decided and why.

## Scope and safety

* **D-001 No buying.** There is no buy command, buy action or buy recommendation anywhere. Paper trades
  are simulation rows. The Telegram bot only sends; it never polls, so it has no commands or buttons.
  `digest.allowed_update()` is the allow-list filter any future listener must use, and messages go
  only to `TELEGRAM_ALLOWED_CHAT_IDS`.
* **D-002 CrowdVolt robots.txt override (accepted by the owner).** CrowdVolt's robots.txt allows only
  named search/AI bots and ends with `User-agent: * / Disallow: /`. That conflicts with the "respect
  robots.txt" rule. The owner was asked and chose to override it for CrowdVolt only
  (`CROWDVOLT_IGNORE_ROBOTS=true`, default). Every other politeness rule still applies to CrowdVolt:
  one logged-in session, 2–6 s delays, 120 page loads/hour, 1-hour cache, adaptive cadence. RA and
  Dice robots.txt are checked on every request (both allow the paths Volt uses). Set
  `CROWDVOLT_IGNORE_ROBOTS=false` to stop CrowdVolt crawling entirely.
* **D-003 No anti-bot evasion.** CrowdVolt and Dice sit behind Cloudflare. Volt uses a normal browser
  user agent and the user's own logged-in browser profile, and waits up to 25 s for a normal
  interstitial to clear. It does not use stealth plugins, CAPTCHA solvers or proxy rotation. On a
  block it saves a debug dump and stops the run after two consecutive blocks.

## Environment facts found during the build

* **D-004** The build sandbox (a cloud container) is blocked by CrowdVolt's Cloudflare ("Sorry, you
  have been blocked"), so **no CrowdVolt data could be collected from the build machine**. The Halloween
  CrowdVolt snapshots must be taken from the owner's host. RA and Dice were crawled live from the
  sandbox (876 RA events and 86 Dice listings on 2026-10-30).
* **D-005** CrowdVolt's public event page shows sellers, ticket type and quantity, with prices as
  "--ea", plus "Tickets from $X". Prices, bids, wallet and counts are expected to need the logged-in
  view. Their exact markup has not been seen, so `tests/fixtures/crowdvolt_event_*.{html,json}` are
  **synthetic**, modelled on the observed public layout. Replace them with a real `--debug-dump` page
  after the first run on the host. The parser is layered (network JSON → embedded JSON → text) so a
  markup change rarely breaks everything at once.
* **D-006** Dice: the city browse page, venue pages and event pages render `__NEXT_DATA__` server-side
  and work over plain HTTP. Dice search (`/search`) returns 403 and the browse `?cursor=` parameter is
  ignored, so discovery is: three NYC browse pages + Dice venue pages (seeded with Brooklyn Storehouse;
  Pacha and Knockdown learned automatically from event pages) + Dice links found on RA + seed event URLs.
* **D-007** RA: the public GraphQL endpoint `https://ra.co/graphql` accepts the `GET_EVENT_LISTINGS`
  query used by the ra.co event listings page. Rather than a persisted-query hash (RA does not require
  one), the full query text is pinned in `crawlers/ra.py` and its sha256 stored in `config/sites.yaml`.
  The crawler refuses to run if they differ. RA has no ticketing-URL field, so Dice/Posh links are
  pulled from `promotionalLinks` and the event description; RA-ticketed events use RA's own tiers.

## Data model

* **D-008 Pacha is two venue rows**: "Pacha New York" (outdoor, 6000) and "Brooklyn Pacha" (indoor,
  2776). RA and Dice already use both names. Plain "Pacha" resolves to Pacha New York; review indoor
  events listed under the generic name with `volt show` / `volt flag`.
* **D-009 One event row per real event.** Crawlers match against existing events at insert time
  (title + night + venue, rapidfuzz ≥ 85). `volt match` repeats the pass and, on merge, re-points the
  dropped event's sources and snapshot rows to the kept event (values unchanged) and sets
  `merged_into_id`. Snapshot values are never edited.
* **D-010 Same-name nights are never auto-merged.** "Circoloco Halloween (Sunday)" must not merge with
  RA's untitled-day "CircoLoco New York" on Saturday. A weekday or "night N" token in one title must
  agree with the other event's actual local night, and two different tokens always block. Starts more
  than 18 h apart are capped below the threshold (sent to `volt review-matches`).
* **D-011 Extra columns** beyond the spec: `events.venue_name_raw`, `scarcity_flag` (the spec's manual
  scarcity flag), `announced_at` (Dice; used for added-date detection), `face_source`, `merged_into_id`,
  `created_at`; `event_sources.match_confirmed`; `cv_event_snapshots.parse_ok`;
  `tier_snapshots.tier_index`; `paper_trades.closed_at`; `brands.title_prefix_only`; `venues.note`; and a
  `raw_captures` table indexing the raw archive. `db.migrate()` adds missing columns in place.
* **D-012 Raw archive.** Every fetched page (HTML, captured JSON, visible text) is written to
  `./raw/<site>/<day>/` and indexed in `raw_captures` before parsing. `volt reparse` rebuilds CrowdVolt
  snapshots from it into a new crawl run.
* **D-013 Cached pages write no snapshots.** A page served from the 1-hour cache is not a new
  observation, so RA/Dice skip signal/tier rows for it and CrowdVolt skips the page.

## Crawling

* **D-014 Rate limit** is per site, a rolling hour, persisted to `.cache/ratelimit/<site>.json` so
  the scheduler and ad-hoc CLI runs share one budget. One Playwright page load or one HTTP request = one
  token (sub-resources a browser loads are not counted).
* **D-015 CrowdVolt cadence:** the scheduler wakes every 15 min and loads only pages that are due
  (>14 d out: 24 h; 3–14 d: 6 h; ≤72 h: 1 h). An event counts as ended 12 h after its start, since end
  times are not reliably published. Unknown start: daily. Priority: seed URLs, then soonest events,
  then newly discovered URLs.
* **D-016 CrowdVolt discovery** runs at most every 20 h: candidate city listing paths (404s are fine),
  CrowdVolt venue pages for configured NYC venues, and `sitemap.xml` filtered by NYC slug keywords
  (excluding known non-NYC words such as "navy-pier", which is tagged "new-york" but is Chicago) and by
  date in the slug (−1 to +60 days). Each page's address is then checked; non-NYC pages are remembered
  in `.cache/crowdvolt_non_nyc.json` and skipped from then on.
* **D-017 CrowdVolt bids** are read by clicking the "Sell" tab (several selector strategies). If no
  tab is found, bids come only from JSON or labelled text.

## Scoring and outcomes

* **D-018 Tier index (G5)** is 1-based by price, among non-add-on tiers. "≤ 2" means the first or
  second tier must still be on sale. For Dice the index is 1 + the number of price rises observed
  (see SIGNALS.md), so an event first seen mid-sale starts at index 1. This understates the index.
* **D-019 Scores are computed for every event**, with gate failures recorded, so false negatives can
  be measured. Only gated events with score ≥ 70 open paper trades. `scores` is append-only.
* **D-020 `first_sold_out_at`** is the first *observed* sell-out; G4's "more than 5 days old" uses it.
* **D-021 Face value** priority MANUAL > RA > DICE. Dice's "from" price for the Circoloco Halloween
  events ($30.90–$32.96) is far below RA's $172.40 tier, probably because of an add-on. Check and
  override big-brand events with `volt flag ID --face`.
* **D-022 Brand detection** uses only brand/promoter names, not artist names (e.g. no "&ME" →
  Keinemusik), to avoid tagging solo sets as brand events. Ordinary-word brands (Afterlife, Fisher, Gray
  Area) match a title only at its start ("Disco Afterlife" is not Afterlife).
* **D-023 Paper close timing:** a trade closes once the full 12 h window around T-2 has been observed
  (at T-2 + 6 h), not at T-2 exactly.
* **D-024 Crawl health** compares rows written in the last 24 h with the median of the seven previous
  daily totals; < 50% is flagged, and so is 0 vs a median of 0 (a site that has never worked).

## Tooling

* **D-025** Python 3.12 pinned via `.python-version`. Ruff line length 120. `selectolax` was considered
  for HTML parsing and dropped to stay inside the specified stack (regex + JSON is enough here).
* **D-026** Volt lives in `volt/` inside the existing repository, self-contained, without touching the
  existing Next.js app.
* **D-027** `CHROMIUM_EXECUTABLE` (optional) points Playwright at a specific Chromium binary; normally
  `uv run playwright install chromium` is enough.

## Deployment

* **D-028 (2026-10-30)** Owner chose "run locally for now": the host is the owner's Mac Mini, running a
  per-user launchd agent (`deploy/install-macos.sh`) with `CROWDVOLT_HEADLESS=false`. The cloud build
  session could not reach that Mac, so the owner installs it and confirms the first scheduled run in
  `logs/volt.log`.

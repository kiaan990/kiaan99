# Volt — Phase 0 (NYC rave ticket market watcher)

Volt watches the NYC electronic-music ticket market (Resident Advisor, Dice, CrowdVolt), scores each
upcoming event with a fixed rule set, paper-trades the high scorers, and records what each event
actually resold for on CrowdVolt. A four-week experiment answers one question: **would the scoring
model have picked the events that later resold above face?**

> **Volt does not buy tickets, does not recommend buying tickets, and holds no money.**
> There is no BUY action anywhere in the code. Its only outputs are a ranked watchlist, simulated
> ("paper") trades, resolved outcomes, and one Telegram digest a day.

## Quick start

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
cd volt
uv sync
uv run playwright install chromium
cp .env.example .env            # optional: Telegram token + chat id
uv run volt init                # create volt.db, load venues/brands
uv run volt login crowdvolt     # headed browser: log in by hand, press Enter in the terminal
uv run volt crawl all           # RA → Dice → CrowdVolt, then cross-site matching
uv run volt score
uv run volt watchlist
```

`volt run` starts the scheduler (see `docs/RUNBOOK.md` for running it as a service).

### Halloween 2026 snapshots — run this first

`seed/volt_seed_2026-10-30.db` holds the RA and Dice snapshots taken on Fri Oct 30 2026 (889 events,
including Circoloco Fri/Sat/Sun and the Pacha Halloween shows). RA drops past events from its
listings, so start from it instead of an empty database:

```bash
cp seed/volt_seed_2026-10-30.db volt.db && uv run volt init
```

The Halloween CrowdVolt pages (Circoloco Fri/Sat/Sun at Brooklyn Storehouse, Kaytranada and Purple
Disco Machine at Pacha) are seeded at the front of the CrowdVolt queue. CrowdVolt is behind Cloudflare
and blocks datacenter IPs, so this must run from your own machine:

```bash
uv run volt login crowdvolt
uv run volt crawl crowdvolt --headed --debug-dump
uv run volt show <event id>     # check what was captured
```

Every page is archived raw under `./raw/` before parsing, so even if the parser misses a field the
data is kept and `volt reparse` can rebuild the snapshots later.

## Commands

| command | what it does |
| --- | --- |
| `volt init` | create/migrate `volt.db`, load `config/venues.yaml` and `config/brands.yaml` |
| `volt login crowdvolt` | one manual login in a headed browser; profile saved to `.browser_profiles/crowdvolt/` (mode 700) |
| `volt crawl [crowdvolt\|dice\|ra\|all] [--force] [--debug-dump]` | crawl, then match across sites |
| `volt match` / `volt review-matches` / `volt merge KEEP DROP` | cross-site de-duplication |
| `volt score` | score upcoming events, open/close paper trades |
| `volt watchlist [--all]` | ranked table (informational only) |
| `volt paper` | paper trades |
| `volt resolve` | outcomes for every event that has started |
| `volt evaluate` | hit rate, multiples, misses, per-component separation |
| `volt export` | every table to CSV in `./exports/` |
| `volt digest` | send the digest (prints to the terminal without a Telegram token) |
| `volt run` | scheduler |
| `volt flag ID [--scarcity] [--added-date] [--face 150]` | manual inputs |
| `volt status` / `volt show ID` | crawl health, one event's data |
| `volt import-page FILE --url URL` | parse a CrowdVolt page saved by hand (fallback) |
| `volt reparse` | rebuild CrowdVolt snapshots from `./raw/` after a parser fix |

## Docs

* `docs/SIGNALS.md`: every signal, gate and score formula
* `docs/DECISIONS.md`: every assumption made during the build
* `docs/RUNBOOK.md`: re-login, fixing a broken parser, adding a brand or venue, deployment

## Development

```bash
make check     # ruff + mypy + pytest (fixtures in tests/fixtures, no network)
```

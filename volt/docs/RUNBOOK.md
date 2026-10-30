# Runbook

All commands run from the `volt/` directory, prefixed with `uv run` (or activate `.venv`).

## First-time setup on the always-on host

```bash
git clone <repo> && cd <repo>/volt
uv sync
uv run playwright install --with-deps chromium
cp .env.example .env && chmod 600 .env     # add Telegram token + chat id (optional)
uv run volt init
uv run volt login crowdvolt                 # needs a display, see "Re-login" below
uv run volt crawl all --debug-dump
uv run volt score && uv run volt watchlist
```

## Run as a service

### systemd (Linux)

```bash
sed -e "s|__USER__|$USER|g" -e "s|__DIR__|$PWD|g" -e "s|__UV__|$(command -v uv)|g" \
    deploy/volt.service | sudo tee /etc/systemd/system/volt.service
sudo systemctl daemon-reload
sudo systemctl enable --now volt
journalctl -u volt -f               # or: tail -f logs/volt.log
```

### nohup (macOS or no root)

```bash
deploy/start-nohup.sh               # writes logs/nohup.out and logs/volt.pid
deploy/stop-nohup.sh
```

**Confirm the first scheduled run:** `logs/volt.log` should show `volt scheduler started`, one
`scheduled <job> next=…` line per job, then within ~2 minutes `crawl ra start`, `crawl ra done: {...}`,
`match: ...` and `score: {...}`. `uv run volt status` lists the crawl runs.

## Re-login to CrowdVolt

Symptoms: digest crawl-health line shows `crowdvolt … ⚠️ LOW`, `volt status` shows crowdvolt runs as
PARTIAL/FAILED with "blocked by Cloudflare", or snapshots have prices missing (`parse_ok = 0`).

```bash
uv run volt login crowdvolt       # browser opens; log in; press Enter in the terminal
uv run volt crawl crowdvolt --headed --max-pages 2 --debug-dump
```

On a headless server, run the login over SSH with X forwarding (`ssh -X`), or under a virtual display:
`xvfb-run -a uv run volt login crowdvolt` with VNC. Alternatively log in on a laptop and copy
`.browser_profiles/crowdvolt/` to the server (keep mode 700). If Cloudflare keeps blocking the headless
browser, set `CROWDVOLT_HEADLESS=false` in `.env` and run the service under `xvfb-run -a`.

No CrowdVolt password is ever stored in `.env`. The session lives only in the browser profile.

**Last resort** if automation is blocked: open the event in your browser, save the page (Cmd/Ctrl-S,
"Webpage, complete"), then `uv run volt import-page saved.html --url <event url>`.

## Fix a broken parser

1. Reproduce with a dump: `uv run volt crawl crowdvolt --url <event url> --force --debug-dump`
   (the same works for `dice` / `ra` without `--url`). Look in `./debug/`: `*.html` (DOM),
   `*.png` (screenshot), `*.txt` (which fields were found and the visible text).
2. Find the field in the dump. CrowdVolt's parser tries, in order: captured network JSON (also in
   `raw/crowdvolt/<day>/*.json` under `network_json`), embedded JSON, visible text.
   * New JSON key name: add it to `SCALAR_KEYS` / `PRICE_ITEM_KEYS` in `crawlers/crowdvolt.py`.
   * New label text: add or adjust a regex in `LABELS` / `WALLET_TEXT`.
   * Sell tab not clicked: add a locator strategy in `CrowdVoltBrowser._click_sell`.
3. Save the dump as a fixture in `tests/fixtures/`, add an assertion in `tests/test_crowdvolt.py`, and
   run `make check`.
4. Rebuild snapshots from the raw archive (old rows are kept; new rows go into a new crawl run):
   `uv run volt reparse` (or `--run-id N`).

RA: if `volt crawl ra` fails with "GraphQL errors", RA changed its schema. Open ra.co/events/us/newyork
in a browser, copy the `GET_EVENT_LISTINGS` query from the network tab, update `RA_QUERY` in
`crawlers/ra.py`, run `uv run volt ra-query-hash --write`, then update `tests/fixtures/ra_listings.json`.

## Add a brand

Edit `config/brands.yaml` under `tier1:` or `tier2:`:

```yaml
  - name: Ants
    aliases: [ants, ants ushuaia]
    # title_prefix_only: true   # only if the name is an ordinary word
```

Then `uv run volt init && uv run volt match` (brand is recomputed for every event).

## Add a venue

Edit `config/venues.yaml`:

```yaml
  - name: Avant Gardner
    aliases: [avant gardner, brooklyn mirage, the brooklyn mirage]
    capacity: 6000
    platform: DICE
    flip_ok: true
```

Then `uv run volt init`. New events resolve automatically. Existing events pick up the venue on their
next crawl. To make Volt read a venue's Dice page, add its path (from the venue link on any Dice event
page) to `dice.venue_paths` in `config/sites.yaml`; for CrowdVolt add `/venue/<slug>` to
`crowdvolt.venue_paths`.

## Calendar and manual flags

* Season open/close dates: add to `peak_18` in `config/calendar.yaml`.
* `uv run volt flag ID --scarcity` (venue finale, relocation, make-good), `--added-date`,
  `--face 150` (true lowest tier when Dice's "from" price includes an add-on).

## Useful checks

```bash
uv run volt status            # last 15 crawl runs, errors
uv run volt show ID           # everything about one event
uv run volt review-matches    # low-confidence pairs → volt merge KEEP DROP
uv run volt export            # CSVs for a spreadsheet
```

## Files that must stay private

`.env`, `volt.db*`, `.browser_profiles/`, `.cache/`, `raw/`, `debug/`, `exports/`, `logs/` are all
git-ignored.

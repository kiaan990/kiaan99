# Signals, gates and score

All money is stored as integer cents. All timestamps are stored in UTC. "Night" means the local
(America/New_York) calendar date, where a start before 06:00 counts as the previous evening.

## Raw signals (append-only, every row carries `crawl_run_id`)

| table / signal | source | meaning |
| --- | --- | --- |
| `signal_snapshots.ra_interested` | RA GraphQL `interestedCount` | RA "interested" count |
| `signal_snapshots.dice_sold_out` | Dice event page `status == "sold-out"` | 1 sold out, 0 otherwise |
| `signal_snapshots.dice_waitlist_on` | Dice event page `waiting_list_enabled` | 1 when the Dice waitlist is on |
| `signal_snapshots.dice_transfer_enabled` | **not on the public page** | always NULL (see below) |
| `signal_snapshots.dice_max_tickets` | Dice `max_tickets` | per-order ticket limit |
| `tier_snapshots` (provider RA) | RA `tickets(queryType: AVAILABLE)` | one row per tier per crawl: name, 1-based `tier_index` by price, price, `available = validType == VALID` |
| `tier_snapshots` (provider DICE) | Dice `price.amount_from` / `price.amount` | **one summary row per crawl**: "lowest available" (price = lowest price still on sale) or "all tiers (sold out)" |
| `cv_event_snapshots` | CrowdVolt event page | lowest ask, all-in lowest, highest bid, ask/bid counts, looking to go/sell, last sale, ticket limit, `parse_ok` |
| `cv_book_snapshots` | CrowdVolt Buy tab (asks) and Sell tab (bids) | every visible order: side, price (NULL if hidden as "--ea"), quantity |

### Dice limitations

* Dice's public, server-rendered pages give the lowest price still on sale, but **not the per-tier list**
  (that only loads in a live browser session, and Dice's Cloudflare check blocks headless browsers).
  So Dice tiers are inferred: **every time the lowest available price rises, one tier has sold
  through**, and a switch to sold out counts as one more.
* Dice's "from" price can include cheap add-ons. Circoloco Halloween shows "from $30.90" on Dice while
  RA lists $172.40 tiers. So `face_value_cents` has a source (`face_source`), with priority
  MANUAL > RA > DICE: RA tier prices replace a Dice face value, and `volt flag ID --face 150` overrides both.
* **Transfer enabled** is not shown on the public event page (only inside the app, after purchase), so
  `dice_transfer_enabled` is recorded as NULL on every crawl. It is not used in scoring.

### CrowdVolt parsing layers

For each field the first layer that yields a value wins: (1) JSON responses the page loads over the
network, (2) JSON embedded in the HTML (`__NEXT_DATA__`, Next.js flight chunks, ld+json),
(3) visible text (Buy tab → asks, Sell tab → bids). Derived values: lowest ask = min ask price, highest
bid = max bid price, counts = number of rows. If no ask price is visible, "Tickets from $X" is used as
the lowest ask. JSON money is dollars unless the key contains "cents"; dollar values ≥ 5000 are taken
to be cents already, since no club ticket costs $5,000. `cv_listable = True` once a wallet type is seen.

## Event fields derived from signals

* `face_value_cents`: lowest tier price at first sight (see source priority above).
* `status`: Dice status, or RA (all tiers unavailable → SOLD_OUT); PAST after `volt resolve`.
* `first_sold_out_at`: first crawl that **observed** a sell-out. An event already sold out on first
  sight gets that crawl's time, which is later than the real sell-out.
* `added_date_flag`: manual (`volt flag --added-date`) or detected. A Dice event is an added date when
  another event at the same venue with the same brand (or promoter), within ±4 days, is sold out and was
  announced at least 7 days earlier. Example: Circoloco Sunday was announced Sep 30, after Fri/Sat
  (Aug 10) had sold out.
* `brand_id`: alias match over title, promoter and lineup (`config/brands.yaml`), recomputed every
  matching pass; highest tier wins. Brands marked `title_prefix_only` match a title only at its start.

## Hard gates (all must pass; failures recorded in `scores.gate_failures`)

| gate | rule |
| --- | --- |
| G1 | `cv_listable == True` and `cv_wallet_type ∈ {DICE, POSH}` |
| G2 | venue known, `3000 ≤ capacity ≤ 6500`, `flip_ok` |
| G3 | brand tier ∈ {1, 2} (no brand = tier 3) |
| G4 | not `added_date_flag`; and if `first_sold_out_at` is set it is **more than 5 days** old |
| G5 | a tier is still available and the cheapest available tier has `tier_index ≤ 2`. RA: the index from RA's tier order. Dice: `1 + number of price rises observed` |
| G6 | `3 ≤ days_to_event ≤ 28` |

## Score (0–100, clamped)

Components are computed for **every** event (so `volt evaluate` can measure what the gates missed); only
events with all gates passed can trigger a paper trade.

| component | max | rule |
| --- | --- | --- |
| calendar_peak | 25 | night in `calendar.yaml peak_25` (Oct 31 2026, Dec 31 2026) = 25; `peak_18` (Nov 25–27 2026, Jan 1 2027, Jul 4, season open/close) = 18; other Fri/Sat = 8; else 0 |
| tier_velocity | 20 | tiers that went unavailable in the last 7 days: ≥2 → 20, 1 → 12, 0 → 0. RA: a tier counts when it is first seen unavailable after having been seen available, and the flip falls inside the window. Dice: price rises (and a switch to sold out) inside the window |
| brand_tier | 20 | tier 1 → 20, tier 2 → 10 |
| cv_book | 15 | latest CrowdVolt snapshot: `highest_bid ≥ face` and `ask_count ≤ bid_count` → 15; else `highest_bid ≥ 0.8 × face` → 7; else (incl. no snapshot / no face) → 3 |
| scarcity_event | 10 | manual `scarcity_flag` (venue finale, relocation, make-good) → 10 |
| competing_supply | −10 | latest `dice_waitlist_on == 1` → −5; another Tier-1 event on the same night (any venue) → −5 |

Threshold: **70** (`config/weights.yaml`). All numbers above live in `config/weights.yaml`.

## Paper trades

* Opened once per event, the first time gates pass and score ≥ 70: qty 4 at the cheapest available
  tier price, `target_sell_at = starts_at − 2 days`, fee 4%.
* Closed once `now ≥ target_sell_at + 6 h`: sell price = median of every CrowdVolt ask seen in the 12 h
  window centred on `target_sell_at` (book rows; falls back to snapshot lowest asks), × (1 − 0.04).
  `pnl = (sell − buy) × qty`. No asks in the window → `NO_MARKET`.

## Outcomes (`volt resolve`, nightly 03:00 ET, every event that has started)

| field | rule |
| --- | --- |
| sold_out / sold_out_days_before | `first_sold_out_at` (or first `dice_sold_out = 1`); days between it and start |
| added_date | `added_date_flag` |
| peak_bid_cents | max highest bid (snapshot or book) captured before start |
| median_ask_t2/t1/t0 | median CrowdVolt ask in ±6 h around start − 2 d / − 1 d / start |
| last_sale_t2_cents | last sale on the latest snapshot at or before T-2 |
| clearing_multiple | (last_sale_t2, else median_ask_t2) ÷ face |
| book_depth_t2 | ask count on the snapshot nearest T-2 (within 12 h) |

## Evaluation (`volt evaluate`)

* hit rate: share of closed paper trades with sell (after fees) ÷ buy ≥ 1.3
* mean / median multiple, worst loss (min pnl)
* winners the gates missed: resolved events with clearing multiple ≥ 1.3 that never had a score row
  with gates passed and score ≥ 70
* flagged events that dumped: ever flagged, clearing multiple < 1.0
* per-component separation: for each component, its points on the last score taken at or before T-2;
  mean clearing multiple of the top quartile minus the bottom quartile (needs ≥ 4 resolved events)

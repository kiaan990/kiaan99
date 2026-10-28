# brightspace: read-only Brightspace module for kiaan-mcp

Uses the session cookies that `~/Projects/brightspace-session/refresh.py` pushes from the Mac.
The droplet only makes HTTP GETs using httpx, the stdlib, and SQLite. It never runs a browser.

## Files

| path (on droplet) | what |
|---|---|
| `brightspace/client.py` | httpx client: cookies, UA, one retry on 5xx, `SessionExpired` / `Forbidden` |
| `brightspace/sync.py` | full pull into SQLite + downloads; idempotent; `python -m brightspace.sync` |
| `brightspace/tools.py` | the 10 FastMCP tools; `register(mcp)` |
| `brightspace/dashboard.py` | `summary()` / `line()` for kiaan-dashboard (no network) |
| `brightspace/notify.py` | activity-feed notes (journald + `notifications.jsonl` fallback) |
| `brightspace/cookies.json` | **0600**, written only by the Mac over ssh |
| `brightspace/brightspace.db` | cache: courses, assignments, quizzes, grades, announcements, content_topics, calendar_events, sync_log |
| `brightspace/{CS240,...}/` | downloaded decks / PDFs |
| `brightspace.env` | `BRIGHTSPACE_COURSES` allowlist (update each semester; ignored if it matches nothing) |

## Wiring

In the kiaan-mcp server, register the module the same way the other modules are registered:

```python
from brightspace import tools as brightspace_tools
brightspace_tools.register(mcp)
```

Then `systemctl restart kiaan-mcp`, then `scripts/smoke.sh`.

## Timers (systemd, times are America/New_York, the droplet is UTC)

- `kiaan-brightspace-sync.timer`: 02:00, 08:00, 09:40 (before the 10 AM brief), 12:00, 16:00, 20:00
- `kiaan-brightspace-keepalive.timer`: `whoami` every 40 min to keep the D2L session warm

Logs: `journalctl -u kiaan-brightspace-sync -n 50`. Exit code 3 means the session expired. That is
reported on the activity feed and is not counted as a unit failure.

## Commands

```bash
cd /opt/kiaan-cloud
.venv/bin/python -m brightspace.client ping          # is the session alive?
.venv/bin/python -m brightspace.client show-cookies  # names + lengths only, never values
.venv/bin/python -m brightspace.sync                 # full sync now
.venv/bin/python -m brightspace.dashboard            # dashboard line
.venv/bin/python -m pytest -q tests/brightspace      # unit + idempotency tests
scripts/smoke.sh                                     # live MCP smoke test
```

## Tools

`brightspace_status`, `brightspace_courses`, `brightspace_upcoming(days=14)`,
`brightspace_assignments(course)`, `brightspace_grades(course=None)`,
`brightspace_announcements(course=None, days=14)`, `brightspace_content(course)`,
`brightspace_download(course, topic_id)`, `brightspace_search(query)`, `brightspace_sync()`.
Every tool reads from the cache. `refresh=True` does a live pull first. `course` accepts `CS 240`,
`cs240`, or an orgUnitId.

## Supersedes

The old Brightspace scrape job (`lib/brightspace.ts` in kiaan99 drove Playwright with a stored
username/password). This module replaces it. See the deploy notes for which job was disabled.

# Brightspace (D2L) API: what works for a student session

Instance: **Bentley University**. `bentley.brightspace.com` and `brightspace.bentley.edu`
resolve to the same servers and use the same Microsoft Entra SAML tenant
(`9030beae-3cfc-4788-a9e2-130204ff1f10`). Cookies are host-scoped, so `cookies.json`
records which host they were issued for and the client uses that host.

Auth: browser session cookies (`d2lSessionVal`, `d2lSecureSessionVal`, plus the other
Brightspace-domain cookies), no Valence app key. **GET requests only.**

## Confirmed without a login (2026-10-28)

| check | result |
|---|---|
| `GET /d2l/api/versions/` | 200 JSON. `lp` latest **1.64** (1.0–1.64), `le` latest **1.100** (1.0–1.100) |
| `GET /d2l/api/lp/1.0/users/whoami` with no cookies | **403**: a dead session gives 403, not 401 |
| `GET /d2l/home` with no cookies | redirects to `login.microsoftonline.com/<tenant>/saml2` |

Because a dead session gives 403, `client.py` checks `whoami` on any 403. If whoami
also fails, it raises `SessionExpired`. Otherwise it raises `Forbidden`, meaning the
endpoint is blocked for students. The sync records blocked endpoints and keeps going.

## Endpoints used (live probe pending)

Status is **pending** until `scripts/probe.py` runs with a real cookie. Run it on the
droplet and paste its table over this one:

    cd /opt/kiaan-cloud && .venv/bin/python scripts/probe.py

| product | endpoint | version | result | used for |
|---|---|---|---|---|
| lp | `/users/whoami` | 1.64 | pending | liveness / keepalive |
| lp | `/enrollments/myenrollments/?orgUnitTypeId=3` | 1.64 | pending | courses (paged via `bookmark`) |
| le | `/{ou}/dropbox/folders/` | 1.100 | pending | assignments, due dates, instructions |
| le | `/{ou}/dropbox/folders/{id}/submissions/mysubmissions/` | 1.100 | pending | submitted? |
| le | `/{ou}/grades/values/myGradeValues/` | 1.100 | pending | my grades |
| le | `/{ou}/grades/final/values/myGradeValue` | 1.100 | pending | running total (404 if the instructor hides it) |
| le | `/{ou}/news/` | 1.100 | pending | announcements |
| le | `/{ou}/content/toc` | 1.100 | pending | module/topic tree |
| le | `/{ou}/content/topics/{id}/file` | 1.100 | pending | file download |
| le | `/calendar/events/myEvents/?startDateTime&endDateTime` | 1.100 | pending | quizzes / due dates across courses |
| le | `/{ou}/quizzes/` | 1.100 | pending (often 403 for students) | quiz windows |

If an endpoint comes back `Forbidden`, that feature is dropped. Nothing falls back to
scraping HTML. Quiz due dates still show up through the calendar.

## Notes

- Dates are UTC ISO strings with milliseconds (`2026-11-03T04:59:00.000Z`). They are
  stored in UTC and shown in America/New_York.
- Paging: `myenrollments` uses `PagingInfo.Bookmark` / `HasMoreItems`. `quizzes` and
  `calendar` use the `ObjectListPage` format (`Objects` / `Next`).
- A file counts as unchanged when its TOC `Url` and `LastModifiedDate` are the same.
  The sha256 is stored so a re-download with identical bytes is not reported as new.

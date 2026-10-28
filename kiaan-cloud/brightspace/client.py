"""httpx client for the D2L Valence API using browser session cookies.

All other code goes through this client. It only ever issues GET requests.
Cookie values are never logged or included in exceptions.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import httpx

from . import config

log = logging.getLogger("brightspace.client")

LOGIN_MARKERS = ("/d2l/login", "/d2l/lp/auth/login", "login.microsoftonline.com", "/saml")


class BrightspaceError(Exception):
    pass


class SessionExpired(BrightspaceError):
    """Cookies are missing, expired, or got bounced to the login page."""


class Forbidden(BrightspaceError):
    """The session is fine but this endpoint is not allowed for a student."""


class NotFound(BrightspaceError):
    pass


def redact(cookies: dict) -> dict:
    """Safe-to-print view of a cookie dict: names and value lengths only."""
    return {k: f"<{len(str(v))} chars>" for k, v in (cookies or {}).items()}


def load_cookie_file(path: Path | None = None) -> dict:
    path = Path(path or config.COOKIES_PATH)
    if not path.exists():
        raise SessionExpired(f"no cookie file at {path}; run refresh.py on the Mac")
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        raise SessionExpired(f"cookie file unreadable: {type(e).__name__}") from None
    if not isinstance(data.get("cookies"), dict) or not data["cookies"]:
        raise SessionExpired("cookie file has no cookies")
    return data


def cookie_age_hours(path: Path | None = None) -> float | None:
    try:
        data = load_cookie_file(path)
    except SessionExpired:
        return None
    ts = data.get("captured_at")
    if not ts:
        return None
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return round((datetime.now(timezone.utc) - dt).total_seconds() / 3600, 1)


class Client:
    def __init__(self, cookies_path=None, host=None, transport=None, timeout=30.0, retry_delay=1.0):
        data = load_cookie_file(cookies_path)
        self.host = host or data.get("host") or config.DEFAULT_HOST
        self.retry_delay = retry_delay
        self._versions: dict[str, str] | None = None
        self._alive_checked: bool | None = None
        self._http = httpx.Client(
            base_url=f"https://{self.host}",
            cookies=data["cookies"],
            headers={
                "User-Agent": data.get("user_agent") or config.USER_AGENT,
                "Accept": "application/json, */*;q=0.5",
            },
            follow_redirects=False,
            timeout=timeout,
            transport=transport,
        )

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    # ---- core ---------------------------------------------------------
    def _get(self, path: str, params: dict | None = None, stream: bool = False) -> httpx.Response:
        for attempt in (0, 1):
            try:
                req = self._http.build_request("GET", path, params=params)
                r = self._http.send(req, stream=stream)
            except httpx.TransportError as e:
                if attempt == 0:
                    log.warning("GET %s transport error (%s), retrying", path, type(e).__name__)
                    time.sleep(self.retry_delay)
                    continue
                raise BrightspaceError(f"GET {path}: {type(e).__name__}") from None
            if r.status_code >= 500 and attempt == 0:
                log.warning("GET %s -> %s, retrying once", path, r.status_code)
                r.close()
                time.sleep(self.retry_delay)
                continue
            break
        log.debug("GET %s -> %s", path, r.status_code)
        self._check(r, path)
        return r

    def _check(self, r: httpx.Response, path: str) -> None:
        code = r.status_code
        if code in (301, 302, 303, 307, 308):
            loc = r.headers.get("location", "")
            r.close()
            if any(m in loc.lower() for m in LOGIN_MARKERS):
                raise SessionExpired(f"redirected to login from {path}")
            raise BrightspaceError(f"unexpected redirect from {path}")
        if code == 401:
            r.close()
            raise SessionExpired(f"401 from {path}")
        if code == 403:
            r.close()
            # D2L returns 403 both for dead sessions and for student-blocked
            # endpoints. whoami tells them apart.
            if "/users/whoami" in path or not self.is_alive():
                raise SessionExpired(f"403 from {path}")
            raise Forbidden(f"403 from {path} (not permitted for this account)")
        if code == 404:
            r.close()
            raise NotFound(f"404 from {path}")
        if code >= 400:
            r.close()
            raise BrightspaceError(f"{code} from {path}")
        ctype = r.headers.get("content-type", "")
        if "/api/" in path and "text/html" in ctype and not path.endswith("/file"):
            r.close()
            raise SessionExpired(f"got an HTML page instead of JSON from {path}")

    def get_json(self, path: str, params: dict | None = None):
        r = self._get(path, params)
        try:
            return r.json()
        except ValueError:
            raise BrightspaceError(f"non-JSON response from {path}") from None

    def is_alive(self) -> bool:
        if self._alive_checked is None:
            try:
                self.whoami()
                self._alive_checked = True
            except SessionExpired:
                self._alive_checked = False
        return self._alive_checked

    # ---- versions -----------------------------------------------------
    def versions(self) -> dict[str, str]:
        if self._versions is None:
            v = {"lp": config.LP_VERSION, "le": config.LE_VERSION}
            if not (v["lp"] and v["le"]):
                try:
                    for p in self.get_json("/d2l/api/versions/"):
                        if p.get("ProductCode") in v and not v[p["ProductCode"]]:
                            v[p["ProductCode"]] = p.get("LatestVersion", "")
                except BrightspaceError:
                    pass
            v["lp"] = v["lp"] or config.LP_FALLBACK
            v["le"] = v["le"] or config.LE_FALLBACK
            self._versions = v
        return self._versions

    def lp(self, path: str) -> str:
        return f"/d2l/api/lp/{self.versions()['lp']}{path}"

    def le(self, path: str) -> str:
        return f"/d2l/api/le/{self.versions()['le']}{path}"

    # ---- endpoints (all GET) -------------------------------------------
    def whoami(self) -> dict:
        data = self.get_json(self.lp("/users/whoami"))
        self._alive_checked = True
        return data

    def enrollments(self) -> list[dict]:
        items, bookmark = [], None
        while True:
            params = {"orgUnitTypeId": 3}
            if bookmark:
                params["bookmark"] = bookmark
            page = self.get_json(self.lp("/enrollments/myenrollments/"), params)
            items += page.get("Items", [])
            paging = page.get("PagingInfo") or {}
            if not paging.get("HasMoreItems"):
                return items
            bookmark = paging.get("Bookmark")

    def _object_pages(self, path: str, params: dict | None = None) -> list[dict]:
        out, url, p = [], path, dict(params or {})
        for _ in range(50):
            page = self.get_json(url, p)
            if isinstance(page, list):
                return page
            out += page.get("Objects", [])
            nxt = page.get("Next")
            if not nxt:
                break
            url, p = nxt.replace(f"https://{self.host}", ""), None
        return out

    def dropbox_folders(self, ou: int) -> list[dict]:
        return self.get_json(self.le(f"/{ou}/dropbox/folders/"))

    def my_submissions(self, ou: int, folder_id: int) -> list[dict]:
        return self.get_json(self.le(f"/{ou}/dropbox/folders/{folder_id}/submissions/mysubmissions/"))

    def grades(self, ou: int) -> list[dict]:
        return self.get_json(self.le(f"/{ou}/grades/values/myGradeValues/"))

    def final_grade(self, ou: int) -> dict:
        return self.get_json(self.le(f"/{ou}/grades/final/values/myGradeValue"))

    def news(self, ou: int) -> list[dict]:
        return self.get_json(self.le(f"/{ou}/news/"))

    def toc(self, ou: int) -> dict:
        return self.get_json(self.le(f"/{ou}/content/toc"))

    def quizzes(self, ou: int) -> list[dict]:
        return self._object_pages(self.le(f"/{ou}/quizzes/"))

    def calendar(self, start: datetime, end: datetime) -> list[dict]:
        fmt = "%Y-%m-%dT%H:%M:%S.000Z"
        return self._object_pages(
            self.le("/calendar/events/myEvents/"),
            {"startDateTime": start.astimezone(timezone.utc).strftime(fmt),
             "endDateTime": end.astimezone(timezone.utc).strftime(fmt)},
        )

    def download_topic(self, ou: int, topic_id: int, dest_dir: Path, fallback_name: str) -> dict:
        """Stream a content topic's file into dest_dir. Returns name/path/size/sha256."""
        import hashlib

        dest_dir.mkdir(parents=True, exist_ok=True)
        r = self._get(self.le(f"/{ou}/content/topics/{topic_id}/file"), stream=True)
        try:
            name = _filename_from(r.headers.get("content-disposition", "")) or fallback_name
            name = safe_filename(name)
            size, h = 0, hashlib.sha256()
            fd, tmp = tempfile.mkstemp(dir=dest_dir, prefix=".part-")
            with os.fdopen(fd, "wb") as f:
                for chunk in r.iter_bytes(65536):
                    size += len(chunk)
                    if size > config.MAX_DOWNLOAD_BYTES:
                        raise BrightspaceError(f"topic {topic_id} larger than limit")
                    h.update(chunk)
                    f.write(chunk)
        except BaseException:
            if "tmp" in locals() and os.path.exists(tmp):
                os.unlink(tmp)
            raise
        finally:
            r.close()
        return {"name": name, "tmp": tmp, "size": size, "sha256": h.hexdigest()}


def _filename_from(disposition: str) -> str | None:
    m = re.search(r"filename\*=(?:UTF-8'')?([^;]+)", disposition, re.I)
    if m:
        return unquote(m.group(1).strip().strip('"'))
    m = re.search(r'filename="?([^";]+)"?', disposition, re.I)
    return m.group(1).strip() if m else None


def safe_filename(name: str) -> str:
    name = os.path.basename(name.replace("\\", "/"))
    name = re.sub(r"[^\w.\- ()&,+]", "_", name).strip(" .")
    return name[:180] or "file"


def write_session_status(alive: bool, detail: str = "", who: str = "") -> None:
    try:
        config.HOME.mkdir(parents=True, exist_ok=True)
        tmp = config.SESSION_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "alive": alive, "detail": detail, "user": who,
        }))
        tmp.replace(config.SESSION_PATH)
    except OSError as e:
        log.warning("could not write session status: %s", e)


def ping() -> int:
    """Cheap liveness check. Also keeps the D2L session warm between refreshes."""
    try:
        with Client() as c:
            me = c.whoami()
        who = me.get("FirstName", "")
        write_session_status(True, "whoami ok", who)
        print(f"session alive ({c.host}, user {who})")
        return 0
    except SessionExpired as e:
        write_session_status(False, str(e))
        print(f"session expired: {e}")
        return 3
    except BrightspaceError as e:
        print(f"error: {e}")
        return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if len(sys.argv) > 1 and sys.argv[1] == "ping":
        sys.exit(ping())
    if len(sys.argv) > 1 and sys.argv[1] == "show-cookies":
        d = load_cookie_file()
        print(json.dumps({"host": d.get("host"), "captured_at": d.get("captured_at"),
                          "cookies": redact(d["cookies"])}, indent=2))
        sys.exit(0)
    print("usage: python -m brightspace.client ping|show-cookies")
    sys.exit(2)

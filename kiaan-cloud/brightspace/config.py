"""Paths and settings. Everything can be overridden with env vars."""
import os
from pathlib import Path
from zoneinfo import ZoneInfo

HOME = Path(os.environ.get("BRIGHTSPACE_HOME", "/opt/kiaan-cloud/brightspace"))
COOKIES_PATH = Path(os.environ.get("BRIGHTSPACE_COOKIES", HOME / "cookies.json"))
DB_PATH = Path(os.environ.get("BRIGHTSPACE_DB", HOME / "brightspace.db"))
SESSION_PATH = HOME / "session.json"  # last liveness check result
NOTIFY_LOG = HOME / "notifications.jsonl"

# bentley.brightspace.com and brightspace.bentley.edu are the same tenant.
# cookies.json records the host the cookies were issued for; this is the fallback.
DEFAULT_HOST = os.environ.get("BRIGHTSPACE_HOST", "bentley.brightspace.com")

# Pinned fallbacks; the client prefers the latest versions from /d2l/api/versions/.
LP_VERSION = os.environ.get("BRIGHTSPACE_LP_VERSION", "")
LE_VERSION = os.environ.get("BRIGHTSPACE_LE_VERSION", "")
LP_FALLBACK = "1.64"
LE_FALLBACK = "1.100"

USER_AGENT = os.environ.get(
    "BRIGHTSPACE_UA",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
)

TZ = ZoneInfo("America/New_York")

# Optional allowlist, e.g. "CS 230,CS 240,FI 118,GLS 230,ST 113".
COURSE_ALLOWLIST = [c.strip() for c in os.environ.get("BRIGHTSPACE_COURSES", "").split(",") if c.strip()]

DOWNLOAD_EXTS = {"pptx", "ppt", "pdf", "docx", "doc", "xlsx", "xls"}
MAX_DOWNLOAD_BYTES = int(os.environ.get("BRIGHTSPACE_MAX_DOWNLOAD_MB", "200")) * 1024 * 1024

# Calendar window pulled on each sync.
CAL_PAST_DAYS = 7
CAL_FUTURE_DAYS = 120

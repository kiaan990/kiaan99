"""Settings (.env via pydantic-settings) and YAML config loaders."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_prefix="", extra="ignore")

    db_path: Path = ROOT / "volt.db"
    cache_dir: Path = ROOT / ".cache"
    raw_dir: Path = ROOT / "raw"  # append-only archive of every page/JSON we fetched
    debug_dir: Path = ROOT / "debug"
    export_dir: Path = ROOT / "exports"
    browser_profiles_dir: Path = ROOT / ".browser_profiles"

    timezone: str = "America/New_York"
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    )
    # Token used when matching robots.txt groups. We are not a named bot, so "*" applies.
    robots_agent: str = "volt"

    rate_limit_per_hour: int = 120
    delay_min_s: float = 2.0
    delay_max_s: float = 6.0
    max_retries: int = 4

    # The user explicitly accepted overriding CrowdVolt's robots.txt (see docs/DECISIONS.md D-002).
    crowdvolt_ignore_robots: bool = True
    crowdvolt_headless: bool = True
    # Optional path to a Chromium binary (only needed when Playwright's own download isn't available).
    chromium_executable: str | None = None

    telegram_bot_token: SecretStr | None = None
    telegram_allowed_chat_ids: list[int] = Field(default_factory=list)

    paper_qty: int = 4
    paper_fee_pct: float = 0.04
    score_threshold: float = 70.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_yaml(name: str) -> Any:
    with open(CONFIG_DIR / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def site_config() -> dict[str, Any]:
    return load_yaml("sites.yaml")


def weights() -> dict[str, Any]:
    return load_yaml("weights.yaml")

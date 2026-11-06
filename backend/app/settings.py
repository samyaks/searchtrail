"""Settings for the API and worker, from SEARCHTRAIL_* environment variables (see deploy/.env.example)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SEARCHTRAIL_", env_file=".env", extra="ignore")

    # Offline mode: no tenant is contacted; every Purview call goes to DryRunTransport.
    dry_run: bool = False
    database_url: str = "postgresql+psycopg://searchtrail:searchtrail@localhost:5432/searchtrail"
    storage_dir: Path = Path("storage")
    graph_base: str = "https://graph.microsoft.com/v1.0"
    # Origins allowed to call the API from a browser in development (the Vite dev server).
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    # Worker
    worker_poll_seconds: float = 2.0
    worker_heartbeat_file: Path | None = None


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()

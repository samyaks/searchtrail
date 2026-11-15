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
    # Other origins allowed to call the API from a browser, with the session cookie. Empty: same origin
    # only, which is all SearchTrail needs (the web image serves the app and passes /api on; in development
    # the Vite dev server proxies /api). Add an origin only for a front end served from somewhere else.
    cors_origins: list[str] = Field(default_factory=list)
    # The interactive API docs at /api/docs and /api/openapi.json. Unset: on in dry run, off in live mode
    # (the docs page loads its scripts from a public CDN, on the same origin as the session cookie).
    api_docs: bool | None = None
    # Worker
    worker_poll_seconds: float = 2.0
    worker_heartbeat_file: Path | None = None

    @property
    def api_docs_enabled(self) -> bool:
        return self.dry_run if self.api_docs is None else self.api_docs


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()

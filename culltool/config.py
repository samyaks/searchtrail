"""Settings, read from environment variables (and an optional .env file in the current folder)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Microsoft's "MicrosoftPurviewEDiscovery" app. It serves the download links for export
# packages and reports. Confirm the ID in your tenant with:
#   Get-MgServicePrincipal -Filter "displayName eq 'MicrosoftPurviewEDiscovery'"
DEFAULT_EDISCOVERY_DOWNLOAD_APP_ID = "b26e684c-5068-4120-a679-64a5d2c909d9"


def load_dotenv(path: str | os.PathLike = ".env") -> None:
    """Minimal .env loader (KEY=VALUE lines). Real environment variables win."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    tenant_id: str
    client_id: str
    auth_mode: str  # "delegated" (recommended) or "app"
    client_secret: str | None
    cert_path: str | None
    cert_thumbprint: str | None
    token_cache_path: str | None
    graph_base: str
    download_app_id: str
    state_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        mode = os.environ.get("AUTH_MODE", "delegated").strip().lower()
        if mode not in ("delegated", "app"):
            raise SystemExit("AUTH_MODE must be 'delegated' or 'app'")
        return cls(
            tenant_id=os.environ.get("TENANT_ID", "").strip(),
            client_id=os.environ.get("CLIENT_ID", "").strip(),
            auth_mode=mode,
            client_secret=os.environ.get("CLIENT_SECRET") or None,
            cert_path=os.environ.get("CERT_PATH") or None,
            cert_thumbprint=os.environ.get("CERT_THUMBPRINT") or None,
            token_cache_path=os.environ.get("TOKEN_CACHE_PATH") or None,
            graph_base=os.environ.get("GRAPH_BASE", "https://graph.microsoft.com/v1.0").rstrip("/"),
            download_app_id=os.environ.get("EDISCOVERY_DOWNLOAD_APP_ID", DEFAULT_EDISCOVERY_DOWNLOAD_APP_ID),
            state_dir=Path(os.environ.get("CULLTOOL_STATE_DIR", ".culltool")),
        )

    def require_credentials(self) -> None:
        missing = [name for name, value in (("TENANT_ID", self.tenant_id), ("CLIENT_ID", self.client_id)) if not value]
        if self.auth_mode == "app" and not (self.client_secret or self.cert_path):
            missing.append("CLIENT_SECRET or CERT_PATH")
        if self.auth_mode == "app" and self.cert_path and not self.cert_thumbprint:
            missing.append("CERT_THUMBPRINT")
        if missing:
            raise SystemExit(f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill it in.")

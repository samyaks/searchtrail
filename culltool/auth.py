"""Sign-in with MSAL.

Two token audiences are needed:
  * Microsoft Graph             -> cases, custodians, searches, exports, sensitivity labels
  * MicrosoftPurviewEDiscovery  -> downloading export packages and reports (eDiscovery.Download.Read)

Delegated sign-in (the default) is recommended for anything a person decides: Purview's own
audit log then shows the real person who ran each search and export, not just "the app".
"""
from __future__ import annotations

import os
from pathlib import Path

import msal

from .config import Settings

GRAPH_SCOPE = "https://graph.microsoft.com/.default"


class TokenProvider:
    def __init__(self, settings: Settings):
        settings.require_credentials()
        self.settings = settings
        authority = f"https://login.microsoftonline.com/{settings.tenant_id}"
        self._cache = msal.SerializableTokenCache()
        cache_path = settings.token_cache_path
        if cache_path and Path(cache_path).is_file():
            self._cache.deserialize(Path(cache_path).read_text(encoding="utf-8"))

        if settings.auth_mode == "app":
            if settings.cert_path:
                credential: object = {
                    "private_key": Path(settings.cert_path).read_text(encoding="utf-8"),
                    "thumbprint": settings.cert_thumbprint,
                }
            else:
                credential = settings.client_secret
            self._app = msal.ConfidentialClientApplication(
                settings.client_id, authority=authority, client_credential=credential, token_cache=self._cache
            )
        else:
            self._app = msal.PublicClientApplication(settings.client_id, authority=authority, token_cache=self._cache)

    @property
    def actor(self) -> str:
        """Who is acting, for the culling log: the signed-in person, or the app."""
        if self.settings.auth_mode == "app":
            return f"app:{self.settings.client_id}"
        accounts = self._app.get_accounts()
        return accounts[0].get("username", "unknown-user") if accounts else "unknown-user"

    def graph_token(self) -> str:
        return self._token([GRAPH_SCOPE])

    def download_token(self) -> str:
        return self._token([f"{self.settings.download_app_id}/.default"])

    def _token(self, scopes: list[str]) -> str:
        if self.settings.auth_mode == "app":
            result = self._app.acquire_token_for_client(scopes=scopes)
        else:
            result = None
            accounts = self._app.get_accounts()
            if accounts:
                result = self._app.acquire_token_silent(scopes, account=accounts[0])
            if not result:
                flow = self._app.initiate_device_flow(scopes=scopes)
                if "user_code" not in flow:
                    raise RuntimeError(f"Could not start sign-in: {flow.get('error_description', flow)}")
                print(flow["message"], flush=True)
                result = self._app.acquire_token_by_device_flow(flow)
        self._save_cache()
        if not result or "access_token" not in result:
            err = (result or {}).get("error"), (result or {}).get("error_description")
            raise RuntimeError(f"Token request failed: {err[0]}: {err[1]}")
        return result["access_token"]

    def _save_cache(self) -> None:
        path = self.settings.token_cache_path
        if path and self._cache.has_state_changed:
            Path(path).write_text(self._cache.serialize(), encoding="utf-8")
            os.chmod(path, 0o600)  # the cache holds refresh tokens

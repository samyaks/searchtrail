"""Microsoft integration for the web app: picks the PurviewGateway implementation.

The interface and both implementations live in the core package (searchtrail/gateway*.py) so the
CLI and the workflow can use them too; see docs/adr/0011-purview-gateway-location.md. WS-C owns
this package and adds the per-user token wiring (delegated tokens from app/auth).
"""
from __future__ import annotations

from app.settings import AppSettings
from searchtrail.gateway import PurviewGateway
from searchtrail.gateway_dryrun import DryRunPurviewGateway


def get_gateway(settings: AppSettings) -> PurviewGateway:
    if settings.dry_run:
        return DryRunPurviewGateway(log=lambda _msg: None, graph_base=settings.graph_base)
    # The live gateway acts as the signed-in user, so it is built per job from that user's
    # cached tokens (WS-C). Until then there is no live gateway to hand out.
    raise RuntimeError("Live Microsoft Graph access isn't wired up yet (WS-C). Set SEARCHTRAIL_DRY_RUN=1.")

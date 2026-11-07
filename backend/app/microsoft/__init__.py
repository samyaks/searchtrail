"""Microsoft integration for the web app: picks the PurviewGateway implementation.

The interface and both implementations live in the core package (searchtrail/gateway*.py) so the
CLI and the workflow can use them too; see docs/adr/0011-purview-gateway-location.md. WS-C owns
this package and adds the per-user token wiring (delegated tokens from app/auth).

  get_gateway(settings)        the gateway for a job or request (live: per user, WS-C later)
  directory.py                 labels and people, as the contract's models
  errors.py                    Graph failures as API errors
  deps.py                      the FastAPI dependency routers use to get a gateway
"""
from __future__ import annotations

from pathlib import Path

from app.db.models import UserRow
from app.schemas import contract
from app.settings import AppSettings
from searchtrail.gateway import PurviewGateway
from searchtrail.gateway_dryrun import DryRunPurviewGateway

# What the dry-run tenant says about itself: /me shows the name and roles (the contract's example).
DRY_RUN_TENANT_NAME = "Contoso Ltd"
DRY_RUN_PURVIEW_ROLES = ("eDiscovery Manager",)
# Where the simulated tenant is kept, under SEARCHTRAIL_STORAGE_DIR (the volume the API and the worker share).
DRY_RUN_TENANT_FILE = Path("dry-run") / "tenant.json"


def tenant_and_roles(settings: AppSettings, user: UserRow) -> tuple[contract.Tenant, list[str]]:
    """The tenant the user signed in to and the Purview roles found for them (for /me).

    Dry run says what the sample tenant says. Live has to ask Microsoft (the tenant's name from the
    directory, the roles from Purview, with /setup/check: a later WS-C PR), so until then it refuses
    rather than show the sample's name and role to a real person."""
    if settings.dry_run:
        return contract.Tenant(id=user.tenant_id, name=DRY_RUN_TENANT_NAME), list(DRY_RUN_PURVIEW_ROLES)
    raise RuntimeError("Reading the tenant and Purview roles from Microsoft isn't wired up yet (WS-C). "
                       "Set SEARCHTRAIL_DRY_RUN=1.")


def dry_run_tenant_file(settings: AppSettings) -> Path:
    return Path(settings.storage_dir) / DRY_RUN_TENANT_FILE


def get_gateway(settings: AppSettings) -> PurviewGateway:
    if settings.dry_run:
        # Every gateway built here (one per job, one per request) shares one simulated tenant: what one
        # creates (cases, searches, operations) is there for the next, in any process.
        return DryRunPurviewGateway(log=lambda _msg: None, graph_base=settings.graph_base,
                                    state_file=dry_run_tenant_file(settings))
    # The live gateway acts as the signed-in user, so it is built per job from that user's
    # cached tokens (WS-C). Until then there is no live gateway to hand out.
    raise RuntimeError("Live Microsoft Graph access isn't wired up yet (WS-C). Set SEARCHTRAIL_DRY_RUN=1.")

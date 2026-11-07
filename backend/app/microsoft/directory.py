"""Labels and people from the gateway, as the contract's models.

The gateway returns Graph's shapes (`displayName`, `mail`, sublabels nested or flat with a parent);
the API returns the contract's (`display_name`, `email`, one tree with `path`). Everything here is pure
conversion, so it works the same over the dry-run and the live gateway.
"""
from __future__ import annotations

from typing import Any

from app.schemas import contract
from app.schemas.matters import initials
from searchtrail.labels import LabelIndex

# People matches are for picking a custodian; a short list is what the Define screen shows.
MAX_PEOPLE = 25


def label_tree(items: list[dict[str, Any]]) -> list[contract.Label]:
    """Sensitivity labels as a tree, in Graph's order, each with its `Parent/Child` path.

    Accepts what LabelIndex accepts: sublabels nested inside parents, or a flat list whose children
    point at a parent. Sublabels of sublabels are kept."""
    descriptions: dict[str, str | None] = {}

    def collect(entries: list[dict[str, Any]]) -> None:
        for entry in entries:
            descriptions[str(entry["id"]).lower()] = entry.get("description") or None
            collect(entry.get("sublabels") or [])

    collect(items)
    labels = list(LabelIndex.from_graph_items(items).by_id.values())  # parents come before their children
    children: dict[str | None, list[Any]] = {}
    for label in labels:
        children.setdefault(label.parent_id, []).append(label)

    def build(label) -> contract.Label:
        return contract.Label(id=label.id, name=label.name, path=label.path, description=descriptions.get(label.id),
                              sublabels=[build(child) for child in children.get(label.id, [])])

    return [build(label) for label in children.get(None, [])]


def directory_users(people: list[dict[str, Any]]) -> list[contract.DirectoryUser]:
    """People from the directory. Anyone without a mailbox address is left out: they can't be
    custodians, and the contract needs an email."""
    users = [
        contract.DirectoryUser(id=person["id"], display_name=person["displayName"], email=person["mail"],
                               department=person.get("department") or None, initials=initials(person["displayName"]))
        for person in people if person.get("mail")
    ]
    return users[:MAX_PEOPLE]

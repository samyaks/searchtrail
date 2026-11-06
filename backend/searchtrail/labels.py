"""Sensitivity labels: fetch them from Purview, resolve names to IDs, and show IDs as names."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .query import GUID_RE

LABELS_PATH = "/security/dataSecurityAndGovernance/sensitivityLabels"


class LabelError(ValueError):
    pass


@dataclass(frozen=True)
class Label:
    id: str
    name: str
    path: str  # "Parent/Child" for sublabels
    parent_id: str | None = None


class LabelIndex:
    def __init__(self, labels: Iterable[Label]):
        self.by_id = {label.id: label for label in labels}

    @classmethod
    def fetch(cls, graph) -> LabelIndex:
        return cls.from_graph_items(list(graph.get_all(LABELS_PATH)))

    @classmethod
    def from_graph_items(cls, items: list[dict]) -> LabelIndex:
        """Accepts nested lists (sublabels inside parents) and flat lists (children point to a parent)."""
        labels: list[Label] = []

        def walk(item: dict, parent: Label | None) -> None:
            lid = str(item["id"]).lower()
            name = item.get("displayName") or item.get("name") or lid
            label = Label(lid, name, f"{parent.path}/{name}" if parent else name, parent.id if parent else None)
            labels.append(label)
            for sub in item.get("sublabels") or []:
                walk(sub, label)

        for item in items:
            walk(item, None)

        by_id = {label.id: label for label in labels}
        flat_parents = {
            str(item["id"]).lower(): str(item["parent"]["id"]).lower()
            for item in items
            if isinstance(item.get("parent"), dict) and item["parent"].get("id")
        }
        fixed = []
        for label in labels:
            pid = flat_parents.get(label.id)
            if label.parent_id is None and pid in by_id:
                label = Label(label.id, label.name, f"{by_id[pid].path}/{label.name}", pid)
            fixed.append(label)
        return cls(fixed)

    def resolve(self, ref: str) -> list[str]:
        """Label name, "Parent/Child" path or GUID -> label IDs.

        A parent label expands to itself plus all its sublabels: files carry the sublabel's ID,
        so filtering on the parent ID alone would silently miss them.
        """
        r = ref.strip()
        if GUID_RE.match(r):
            root = r.lower()
        else:
            key = r.lower()
            matches = [l for l in self.by_id.values() if l.path.lower() == key]
            if not matches:
                matches = [l for l in self.by_id.values() if l.name.lower() == key]
            if len(matches) > 1:
                raise LabelError(f"Label {ref!r} is ambiguous; use one of: {', '.join(sorted(l.path for l in matches))}")
            if not matches:
                known = ", ".join(sorted(l.path for l in self.by_id.values())) or "(none loaded)"
                raise LabelError(f"No sensitivity label named {ref!r}. Known labels: {known}")
            root = matches[0].id
        children = [l.id for l in self.by_id.values() if l.parent_id == root]
        return [root, *children]

    def name_for(self, label_id: str) -> str:
        label = self.by_id.get(label_id.strip().lower())
        return label.path if label else f"Unknown label ({label_id})"

    def display(self, value: str) -> str:
        """Report cells may hold a GUID or a name; show a name either way."""
        v = value.strip()
        return self.name_for(v) if GUID_RE.match(v) else v

"""Append-only, hash-chained log of every culling decision.

Each entry stores the SHA-256 hash of the entry before it, so editing or deleting a past
entry breaks the chain and verify() reports where. That makes the log tamper-evident, not
tamper-proof: in production, also copy entries to write-once storage, or sign them.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

GENESIS = "0" * 64


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _hash(record_without_hash: dict) -> str:
    return hashlib.sha256(canonical(record_without_hash).encode("utf-8")).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class AuditLog:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def entries(self) -> list[dict]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    def append(self, **fields) -> dict:
        entries = self.entries()
        record = {
            "seq": len(entries) + 1,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **fields,
            "prev_hash": entries[-1]["hash"] if entries else GENESIS,
        }
        record = json.loads(canonical(record))  # store exactly what gets hashed
        record["hash"] = _hash(record)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(canonical(record) + "\n")
        return record

    def last(self, action: str) -> dict | None:
        return next((e for e in reversed(self.entries()) if e.get("action") == action), None)

    def verify(self) -> tuple[bool, str]:
        prev = GENESIS
        entries = self.entries()
        for i, entry in enumerate(entries, 1):
            body = {k: v for k, v in entry.items() if k != "hash"}
            if entry.get("prev_hash") != prev:
                return False, f"Entry {i}: chain broken (an entry before it was changed, removed or reordered)"
            if _hash(body) != entry.get("hash"):
                return False, f"Entry {i}: contents were modified after it was written"
            prev = entry["hash"]
        return True, f"{len(entries)} entries verified, chain intact"

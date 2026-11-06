"""The matter's log: one hash chain per matter, in the same format as searchtrail/audit.py.

Each record is {seq, ts, action, actor, actor_email, matter_id, summary, version, ...fields, prev_hash},
normalised through canonical JSON, and `hash` is SHA-256 of that canonical JSON. Verifying the chain
is therefore the same check `searchtrail verify-log` runs on the CLI's audit.jsonl.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.contract import LogAction
from searchtrail.audit import GENESIS, canonical, sha256_text

from ..base import utcnow
from ..models import AuditEntryRow, MatterRow

# The actor for steps SearchTrail takes on its own (a job finishing, say); actor_email is then None.
SYSTEM_ACTOR = "SearchTrail"
_RESERVED = {"seq", "ts", "prev_hash", "hash", "matter_id"}


def append_log(session: Session, matter_id: str, action: LogAction | str, *, actor: str, actor_email: str | None,
               summary: str, version: int | None = None, **fields: Any) -> AuditEntryRow:
    """Append one entry to the matter's chain and return it (flushed, not committed).

    Locks the matter row first, so concurrent appends to one matter are serialised until the caller
    commits. `summary` is the plain-English line the Log screen shows; `version` is the query version
    the entry is about, if any; `fields` is the rest of the record (KQL, criteria, counts, settings).
    """
    clash = _RESERVED & fields.keys()
    if clash:
        raise ValueError(f"append_log: {sorted(clash)} are set by the log itself")
    locked = session.scalars(select(MatterRow.id).where(MatterRow.id == matter_id).with_for_update()).one_or_none()
    if locked is None:
        raise LookupError(f"append_log: no matter {matter_id!r}")

    last = session.execute(
        select(AuditEntryRow.seq, AuditEntryRow.hash)
        .where(AuditEntryRow.matter_id == matter_id)
        .order_by(AuditEntryRow.seq.desc())
        .limit(1)
    ).first()
    ts = utcnow().replace(microsecond=0)
    record = {
        "seq": last.seq + 1 if last else 1,
        "ts": ts.isoformat(timespec="seconds"),
        "action": LogAction(action).value,
        "actor": actor,
        "actor_email": actor_email,
        "matter_id": matter_id,
        "summary": summary,
        "version": version,
        **fields,
        "prev_hash": last.hash if last else GENESIS,
    }
    record = json.loads(canonical(record))  # store exactly what gets hashed
    row = AuditEntryRow(matter_id=matter_id, seq=record["seq"], ts=ts, action=record["action"], actor=actor,
                        record=record, prev_hash=record["prev_hash"], hash=sha256_text(canonical(record)))
    session.add(row)
    session.flush()
    return row

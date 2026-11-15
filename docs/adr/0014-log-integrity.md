# 0014. The log can't be changed, and its head is recorded outside the database

- Status: Accepted (anchors are built with the export and log endpoints)
- Date: 2026-11-15

## Context
Each matter's log is a hash chain: every entry holds the hash of the one before. That shows an entry
was edited, but not that the newest entries were deleted, or that someone edited an entry and
recomputed every hash after it: the chain still links from the genesis value. Anyone with the app's
database login could do either.

## Decision
- **Postgres refuses UPDATE, DELETE and TRUNCATE on `audit_entries`** (a trigger, migration 0004).
  Only the table's owner can drop the trigger, so in production SearchTrail logs in as a role that
  doesn't own the tables (the install guide, WS-G, sets that up).
- **The chain's head (newest `seq` and `hash`) is recorded outside SearchTrail's database**, where its
  database login can't reach:
  - in the Purview export's description, when an export starts (Purview keeps it with the case);
  - in the downloaded export package, as the log up to that entry (WS-B2, PR 7);
  - in the response of `POST /matters/{id}/log/verify`, so a reviewer can note it (WS-B1, PR 8).
  Verifying compares the chain with the latest anchor: a chain shorter than an anchor, or with a
  different hash at the anchored `seq`, fails.

## Consequences
- Nothing in SearchTrail may update or delete log entries, ever; corrections are new entries.
- A matter can't be deleted while it has log entries (the foreign key is RESTRICT).
- The anchors are only as strong as where they're kept: Purview's case history and the delivered
  export are outside SearchTrail's control, which is the point.

# 0013. Who may open a matter: Purview decides

- Status: Accepted (the Purview question is built by WS-C)
- Date: 2026-11-15

## Context
SearchTrail keeps its own copy of a lot about each matter: custodians, the KQL, preview item metadata
(subjects, senders, locations) and the log. Purview limits who can see a case to its members and
eDiscovery Administrators. If SearchTrail answered every signed-in person from its own tables, it
would show a restricted case's previewed emails to someone Purview would refuse. The V1 plan says to
use Purview roles rather than build matter teams, so the rule has to come from Purview.

## Decision
- **A person may open a matter if Purview lets them open its case.** SearchTrail asks with the
  person's own token (`GET .../ediscoveryCases/{id}`) and remembers the answer per person and case for
  a few minutes, so a removed member loses access within minutes, and a new one gains it the same way.
- **Before a matter has a Purview case** (before its first estimate), only the person who created it.
- **Dry run:** the sample user opens every matter (one simulated person, one simulated tenant).
- **A matter someone may not open is "not found" (404)**, the same as one that doesn't exist, so the
  API doesn't confirm a matter's existence to someone outside the case.
- **One check for every route:** `app/api/access.py` (`Access`). Matter routes call
  `access.matter(session, matter_id)`, never `get_matter` directly; lists keep only what
  `access.can_open` allows. Job endpoints check the job's matter the same way.

Until WS-C builds the Purview question, live access to a matter that has a case is refused. Live mode
can't sign anyone in yet either, so nobody is locked out in practice.

## Consequences
- Every new router in Phase 1 (custodians, drafts, runs, exports, the log, jobs) takes `Access`.
- Listing matters asks Purview about each matter with a case, through the cache. With many matters
  that needs batching (list the cases the person can see once, then filter): WS-C decides.
- Tenant scoping isn't needed in V1: each installation serves one tenant (customer-hosted).

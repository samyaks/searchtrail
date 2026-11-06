# culltool: cull in Purview, review in Everlaw

A starter culling tool for eDiscovery. A legal team narrows Microsoft 365 data down to the
documents that matter, previews the result, and hands exactly that set to Everlaw for review.

```
 culltool                              Microsoft Purview eDiscovery             Everlaw
 ────────                              ────────────────────────────             ───────
 matter.json (custodians, filters)
   │ kql      show query + methodology
   │ preview  ───────────────────────▶ case, custodians, search,
   │                                    estimate, item report (no content)
   │ terms    ───────────────────────▶ hits per search term
   │ export   ───────────────────────▶ export package ──── Purview Cloud ───▶ review
   ▼                                                       Connector
 hash-chained culling log
```

## Built-in defensibility rules

| Rule | How it's enforced |
|---|---|
| Purview does the collection | The tool never downloads document contents. Exports go from Purview to Everlaw through Everlaw's own connector. |
| The preview matches the export | Previews come from Purview's own report (`exportReport`) on the *same* search that gets exported, not from a separate search engine. |
| Only previewed sets get exported | `export` refuses unless the exact query and custodian/site list were previewed. This check runs before any API call, so a refused export changes nothing. |
| Data drift is caught | `export` re-runs the estimate. If counts changed since the preview (new mail arrived, say), it stops unless you pass `--accept-changes`, and that choice is logged. |
| Every filter applies to the right item type | Domain filters only touch emails and chats, and file-type filters only touch documents. A naive query would silently drop every document when you add a domain filter. |
| Parent labels include their sublabels | Picking "Confidential" also matches "Confidential/Finance" and "Confidential/Legal", because files carry the sublabel's ID. |
| Typos fail loudly | Unknown fields in the matter file are errors, never silently ignored. |
| Methodology in plain English | `kql` prints a statement of the culling method, ready for a meet-and-confer or a methodology memo. |
| Tamper-evident record | Every preview, term report and export is logged with the KQL, filters, counts and who ran it, in a SHA-256 hash chain. `verify-log` checks it. |
| Real names in Purview's audit log | Delegated sign-in is the default, so Purview records the actual person. |

## Try it offline (no tenant needed)

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[test]"
pytest
culltool --dry-run kql examples/matter.json
culltool --dry-run preview examples/matter.json
culltool --dry-run terms examples/matter.json
culltool --dry-run export examples/matter.json --confirm --wait
culltool --dry-run verify-log examples/matter.json
```

`--dry-run` prints every Graph call the tool would make and simulates the responses.
Dry runs keep their own state and log under `.culltool/dry-run/`, so they never mix with real records.

## Connect to a real tenant

1. **Licensing.** The Graph eDiscovery APIs work with eDiscovery (Premium) cases (E5 or E5 Compliance).
   Microsoft added Standard support in late 2025 through Purview pay-as-you-go billing (announced as
   50 GB a month free, then $10 per GB). Check the current terms.
2. **Register an app** in Microsoft Entra ID (single tenant).
   - *Delegated mode (recommended):* turn on **Allow public client flows** (needed for the device-code sign-in). Then add these delegated permissions:
     - Microsoft Graph `eDiscovery.ReadWrite.All` and `SensitivityLabel.Read`
     - **MicrosoftPurviewEDiscovery** `eDiscovery.Download.Read`
   - *App mode:* add the same permissions as **application** permissions (use `SensitivityLabels.Read.All` for labels) and a certificate.
     Then follow Microsoft's *"Set up app-only access for eDiscovery"* guide, which assigns the app's service principal Purview-level case and role permissions.
   - Grant admin consent.
   - If MicrosoftPurviewEDiscovery isn't listed under "APIs my organization uses", create its service principal:
     `New-MgServicePrincipal -AppId b26e684c-5068-4120-a679-64a5d2c909d9`. Everlaw's connector setup has the same step.
   - Community testing found that exports need `eDiscovery.ReadWrite.All`, even where the docs say read-only is enough.
3. **Purview roles.** The people running the tool need the **eDiscovery Manager** role in Purview.
4. Copy `.env.example` to `.env` and fill it in.
5. Run `culltool labels` to test the connection, then `culltool kql your-matter.json`.

## Commands

| Command | What it does |
|---|---|
| `labels` | Lists sensitivity labels (ID and `Parent/Child` name) |
| `kql MATTER` | Shows the KQL and the plain-English methodology. Only calls the label lookup. |
| `preview MATTER [--counts-only]` | Creates or updates the case, custodians and search. Shows counts plus an item report (by custodian, type, label and month) and writes `preview.csv`. |
| `terms MATTER` | Hits per search term, each within all other filters. Uses a separate search, so the main search is untouched. |
| `export MATTER [--confirm] [--wait] [--accept-changes]` | Without `--confirm`, shows what would be exported. With it, starts the Purview export for Everlaw. |
| `status OPERATION_URL` | Checks a running estimate, report or export |
| `verify-log MATTER` | Checks the culling log's hash chain |

## Matter file

See [`examples/matter.json`](examples/matter.json).

**Criteria fields:**

| Field | Applies to | Notes |
|---|---|---|
| `keywords`, `keyword_mode` (`any` or `all`) | everything | Phrases are quoted for you. `word*` = prefix match. Leading wildcards are rejected. |
| `exclude_keywords` | everything | |
| `date_from`, `date_to` (YYYY-MM-DD, inclusive) | everything | Emails and chats use the sent or received date. Documents use `doc_date_property` (`lastmodifiedtime` or `created`). |
| `kinds` | — | Any of `email`, `chats`, `docs` |
| `file_extensions` | documents only | |
| `participant_domains`, `exclude_participant_domains` | emails and chats only | |
| `labels`, `exclude_labels` | everything | Label names, `Parent/Child` paths or GUIDs. A label filter excludes unlabeled items. |
| `raw_kql` | everything | Expert escape hatch, ANDed onto the query |

**Export settings:** `include_partially_indexed` (default true; decide this deliberately, with counsel),
`partially_indexed_scope`, `format` (`pst` or `msg`), and `additional_options` (e.g.
`"cloudAttachments, htmlTranscripts"`; confirm what Everlaw wants).

## Verify against a real tenant before relying on it

The call sequence follows Microsoft's Graph eDiscovery reference. These details could not be
checked without a tenant:

- **KQL details:**
  - `kind:microsoftteams` / `kind:im` for Teams chats
  - `participants:` matching on a domain
  - `fileextension:`
  - The date properties `sent`, `received` and `lastmodifiedtime`

  Compare the counts with the same search built in the Purview portal. The portal's condition builder writes different syntax (`(c:c)` blocks, `MipSensitiveLabel`).
- **Report column names.** The first real `preview` prints any columns it didn't recognise. Add them to `COLUMN_CANDIDATES` in `culltool/report.py`.
- **Downloads.** Check the download app ID and whether the `X-AllowWithAADToken` header is needed (see `graph.py`).
- **exportReport.** Check that it accepts `exportLocation` when partially indexed items are included.
- **Everlaw.** Check which export format and `additionalOptions` Everlaw's Purview connector expects. Everlaw wants exports from a *search* (this tool does that), not from a review set.
- **Query length.** Purview's query-length limits. The tool warns past 4,000 characters (`query.py`).

## Roadmap to the best culling tool

1. **Web UI** with live counts as filters change, saved matter templates, and side-by-side query versions.
2. **Unique-hits term report.** Items hit *only* by each term, using item IDs from per-term reports, plus an Excel export for search-term negotiations.
3. **Item-level diffs between query versions** ("v4 adds 212 items, removes 37").
4. **Parallel term estimates** (one search per term), to cut term reports from hours to minutes.
5. **Label names in Everlaw.** A metadata overlay mapping each item's label ID to its name, once Everlaw confirms its API supports it.
6. **Volume and cost forecasting** for Everlaw hosting and Purview pay-as-you-go.
7. **Privilege early warning.** Flag items involving outside-counsel domains before export.
8. **Optional legal holds** on custodians when a matter is created.
9. **Write-once log storage** and a signed methodology report.
10. **AI-assisted query drafting.** Plain English to KQL, always shown, human-approved and logged.

## Code map

```
culltool/
  query.py       filters -> KQL, validation, plain-English methodology
  ediscovery.py  the Graph eDiscovery calls, one method per step
  workflow.py    prepare / preview / terms / export, with the defensibility checks
  report.py      reads Purview's item report, summarises it, writes preview.csv
  labels.py      sensitivity labels: names <-> IDs, sublabel expansion
  audit.py       hash-chained culling log
  graph.py       HTTP: retries (Retry-After), paging, polling, downloads
  auth.py        MSAL sign-in (delegated device code or app-only)
  dryrun.py      offline Graph stand-in used by --dry-run and the tests
  matter.py      matter file loading and validation
  cli.py         command line
```

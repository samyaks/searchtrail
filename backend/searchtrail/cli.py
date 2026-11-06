"""Command line: searchtrail [--dry-run] <command> ...

  labels                 list sensitivity labels
  kql MATTER             show the query and the plain-English methodology
  preview MATTER         counts plus an item-level preview (metadata only)
  terms MATTER           hits per search term
  export MATTER          send the previewed set to a Purview export for Everlaw
  status OPERATION_URL   check a running estimate/report/export
  verify-log MATTER      check the culling log hasn't been altered
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .audit import AuditLog
from .config import Settings
from .gateway import GatewayNotImplemented, PurviewGateway
from .graph import GraphClient, GraphError, OperationFailed
from .labels import LabelError, LabelIndex
from .matter import MatterError, load_matter
from .query import CriteriaError
from .workflow import CullWorkflow, ExportBlocked


def human_size(n: int | None) -> str:
    if n is None:
        return "?"
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:,.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} TB"


def _num(n) -> str:
    return f"{n:,}" if isinstance(n, int) else str(n)


def _context(args) -> tuple[PurviewGateway, str, Path]:
    """The Purview gateway, who is acting, and where state and the log are kept."""
    settings = Settings.from_env()
    if args.dry_run:
        from .gateway_dryrun import DryRunPurviewGateway

        # Dry runs keep their own state and log, so they never mix with real search records.
        root = settings.state_dir / "dry-run"
        gateway = DryRunPurviewGateway(verbose=not args.quiet, state_file=root / "simulated-tenant.json",
                                       graph_base=settings.graph_base)
        return gateway, os.environ.get("SEARCHTRAIL_ACTOR", "dry-run-user"), root
    from .auth import TokenProvider
    from .gateway_graph import GraphPurviewGateway

    tokens = TokenProvider(settings)
    graph = GraphClient(settings.graph_base, tokens.graph_token)
    tokens.graph_token()  # sign in up front, so the log knows who is acting
    return GraphPurviewGateway(graph, tokens.download_token), tokens.actor, settings.state_dir


def _workflow(args) -> CullWorkflow:
    gateway, actor, state_root = _context(args)
    labels = LabelIndex.from_graph_items(gateway.list_labels())
    return CullWorkflow(gateway, labels, state_root, actor)


def cmd_labels(args) -> None:
    gateway, *_ = _context(args)
    for label in sorted(LabelIndex.from_graph_items(gateway.list_labels()).by_id.values(), key=lambda l: l.path.lower()):
        print(f"{label.id}  {label.path}")


def cmd_kql(args) -> None:
    wf = _workflow(args)
    kql, _criteria, warnings, methodology = wf.plan(load_matter(args.matter))
    print("KQL:\n  " + kql)
    print("\nMethodology:\n  " + methodology.replace("\n", "\n  "))
    for w in warnings:
        print(f"\nNote: {w}")


def _print_counts(counts: dict, include_partial: bool) -> None:
    print(f"  Items matching:           {_num(counts.get('indexedItemCount')):>10}  ({human_size(counts.get('indexedItemsSize'))})")
    print(f"  Partially indexed items:  {_num(counts.get('unindexedItemCount')):>10}  ({human_size(counts.get('unindexedItemsSize'))})"
          f"  -> {'included' if include_partial else 'NOT included'} in export")
    print(f"  Locations searched:       {counts.get('mailboxCount')} mailboxes, {counts.get('siteCount')} sites")


def cmd_preview(args) -> None:
    wf = _workflow(args)
    matter = load_matter(args.matter)
    result = wf.preview(matter, with_report=not args.counts_only)
    print(f"\nSearch '{result['search_name']}'")
    print(f"KQL: {result['kql']}\n")
    _print_counts(result["counts"], matter.export.include_partially_indexed)
    for w in result["warnings"]:
        print(f"  Note: {w}")
    summary = result.get("report_summary")
    if summary:
        print(f"\nItem report: {_num(summary['items'])} items, {human_size(summary['total_size_bytes'])}, "
              f"{summary['encrypted_items']} encrypted")
        for title, key in (("By location", "by_location"), ("By type", "by_type"), ("By sensitivity label", "by_label")):
            print(f"  {title}:")
            for name, count in summary[key]:
                print(f"    {count:>7,}  {name}")
        if summary["by_month"]:
            print("  By month:  " + ", ".join(f"{m}: {c}" for m, c in summary["by_month"]))
        print(f"\nPreview table: {result['preview_csv']}")
        if result["unmapped_columns"]:
            print(f"Report columns not used (check report.COLUMN_CANDIDATES): {', '.join(result['unmapped_columns'])}")
    print("\nLogged. When the set looks right: searchtrail export", args.matter, "--confirm")


def cmd_terms(args) -> None:
    rows = _workflow(args).term_report(load_matter(args.matter))
    width = max(len(r["term"]) for r in rows)
    print(f"\n{'Term'.ljust(width)}  {'Items':>10}  Size")
    for r in rows:
        print(f"{r['term'].ljust(width)}  {_num(r['items']):>10}  {human_size(r['size_bytes'])}")
    print("\nEach count applies every other filter (custodians, dates, types, labels).")


def cmd_export(args) -> None:
    result = _workflow(args).export(load_matter(args.matter), confirm=args.confirm,
                                    accept_changes=args.accept_changes, wait=args.wait)
    counts = result["counts"]
    if not result["confirmed"]:
        print(f"\nReady to export {_num(counts.get('indexedItemCount'))} items "
              f"(+{_num(counts.get('unindexedItemCount'))} partially indexed) as '{result['export_name']}'.")
        print("Nothing was exported. Re-run with --confirm to start it.")
        return
    print(f"\nExport started: '{result['export_name']}'")
    print(f"Track it: searchtrail status '{result['operation_url']}'")
    if result.get("status"):
        print(f"Finished with status: {result['status']}")
    print("\nNext, in Everlaw: open the Purview Cloud Connector, pick the case "
          f"'{result['case_name']}' and the export '{result['export_name']}'.")
    print("Purview keeps export downloads for a limited time (about 30 days), so import it promptly.")


def cmd_status(args) -> None:
    gateway, *_ = _context(args)
    op = gateway.get_operation(args.operation_url)
    print(f"Status: {op.get('status')}  ({op.get('percentProgress')}%)")
    for f in op.get("exportFileMetadata") or []:
        print(f"  {f.get('fileName')}  {human_size(f.get('size'))}")


def cmd_verify_log(args) -> None:
    settings = Settings.from_env()
    root = settings.state_dir / "dry-run" if args.dry_run else settings.state_dir
    matter = load_matter(args.matter)
    ok, message = AuditLog(root / matter.matter_id / "audit.jsonl").verify()
    print(("OK: " if ok else "PROBLEM: ") + message)
    if not ok:
        raise SystemExit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="searchtrail", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="simulate Microsoft Graph offline and print every call")
    parser.add_argument("--quiet", action="store_true", help="in dry-run mode, don't print each simulated call")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("labels", help="list sensitivity labels").set_defaults(fn=cmd_labels)
    p = sub.add_parser("kql", help="show the query and methodology for a matter")
    p.add_argument("matter", type=Path)
    p.set_defaults(fn=cmd_kql)
    p = sub.add_parser("preview", help="counts and an item-level preview (metadata only)")
    p.add_argument("matter", type=Path)
    p.add_argument("--counts-only", action="store_true", help="skip the item report")
    p.set_defaults(fn=cmd_preview)
    p = sub.add_parser("terms", help="hits per search term")
    p.add_argument("matter", type=Path)
    p.set_defaults(fn=cmd_terms)
    p = sub.add_parser("export", help="export the previewed set for Everlaw")
    p.add_argument("matter", type=Path)
    p.add_argument("--confirm", action="store_true", help="actually start the export")
    p.add_argument("--accept-changes", action="store_true", help="export even if counts changed since the preview")
    p.add_argument("--wait", action="store_true", help="wait for the export to finish")
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser("status", help="check a running operation")
    p.add_argument("operation_url")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("verify-log", help="check the culling log's hash chain")
    p.add_argument("matter", type=Path)
    p.set_defaults(fn=cmd_verify_log)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.fn(args)
    except (CriteriaError, MatterError, LabelError, ExportBlocked, GatewayNotImplemented, ValueError) as exc:
        sys.stdout.flush()
        print(f"\nStopped: {exc}", file=sys.stderr)
        return 2
    except (GraphError, OperationFailed, TimeoutError) as exc:
        sys.stdout.flush()
        print(f"\nMicrosoft returned an error:\n{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

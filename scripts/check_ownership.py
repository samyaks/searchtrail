#!/usr/bin/env python3
"""Path ownership for SearchTrail, from .github/ownership.yml.

  python scripts/check_ownership.py --write-codeowners   regenerate .github/CODEOWNERS
  python scripts/check_ownership.py --check-codeowners   fail if CODEOWNERS is out of date
  python scripts/check_ownership.py --pr BASE_SHA        check a PR's changed files (CI)

The PR check reads the PR title from $PR_TITLE. Titles start with the workstream, e.g.
"[B1] Matters endpoints", or "[contract] Add matter archive" for contract changes. It:
  - fails if the contract (contracts/, backend/searchtrail/gateway.py) changes in a PR whose title
    doesn't start with "[contract]";
  - warns when a PR touches another workstream's paths, or generated files without the contract;
  - writes a table of which workstreams the PR touches to the job summary.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
OWNERSHIP = ROOT / ".github" / "ownership.yml"
CODEOWNERS = ROOT / ".github" / "CODEOWNERS"
SPECIAL = ("contract", "generated", "shared", "tests")


@dataclass(frozen=True)
class Area:
    key: str  # "B1", "contract", ...
    name: str
    owners: tuple[str, ...]
    paths: tuple[str, ...]


def load() -> list[Area]:
    data = yaml.safe_load(OWNERSHIP.read_text())
    default = tuple(data.get("default_owners", []))
    areas = []
    for key, ws in data["workstreams"].items():
        areas.append(Area(key, ws["name"], tuple(ws.get("owners", default)), tuple(ws["paths"])))
    for key in SPECIAL:
        section = data[key]
        areas.append(Area(key, key, tuple(section.get("owners", default)), tuple(section["paths"])))
    return areas


def _matches(pattern: str, path: str) -> bool:
    return path.startswith(pattern) if pattern.endswith("/") else path == pattern


def owner_of(path: str, areas: list[Area]) -> Area | None:
    """The area with the longest (most specific) matching pattern."""
    best: tuple[int, Area] | None = None
    for area in areas:
        for pattern in area.paths:
            if _matches(pattern, path) and (best is None or len(pattern) > best[0]):
                best = (len(pattern), area)
    return best[1] if best else None


def render_codeowners(areas: list[Area]) -> str:
    # In CODEOWNERS the last matching line wins, so write less specific patterns first.
    lines = [
        "# GENERATED from .github/ownership.yml by scripts/check_ownership.py --write-codeowners.",
        "# Do not edit by hand. GitHub requests a review from these owners on PRs touching their paths;",
        "# turn on 'Require review from Code Owners' in branch protection to make it required.",
        "",
    ]
    entries = [(pattern, area) for area in areas for pattern in area.paths]
    entries.sort(key=lambda e: (len(e[0]), e[0]))
    for pattern, area in entries:
        label = area.key if area.key in SPECIAL else f"WS-{area.key} {area.name}"
        # A pattern with no owner is valid CODEOWNERS: it overrides a broader earlier match.
        owners = " ".join(area.owners) if area.owners else ""
        lines.append(f"/{pattern:<48} {owners:<20} # {label}{'' if area.owners else ' (no owner)'}")
    return "\n".join(lines) + "\n"


def changed_files(base: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def check_pr(files: list[str], title: str, areas: list[Area]) -> tuple[list[str], list[str], str]:
    """Returns (errors, warnings, markdown summary)."""
    by_area: dict[str, list[str]] = {}
    for f in files:
        area = owner_of(f, areas)
        by_area.setdefault(area.key if area else "unowned", []).append(f)

    title = title.strip()
    declared = title[1:title.index("]")] if title.startswith("[") and "]" in title else None
    errors, warnings = [], []
    workstreams = [k for k in by_area if k not in SPECIAL and k != "unowned"]

    if "contract" in by_area and declared != "contract":
        errors.append("This PR changes the shared contract (" + ", ".join(by_area["contract"]) + "). Contract "
                      "changes go in their own PR titled \"[contract] ...\", approved by the integrator, with "
                      "regenerated code (scripts/codegen.sh). See CONTRIBUTING.md.")
    if "generated" in by_area and "contract" not in by_area:
        warnings.append("Generated files changed without a contract change. They are produced by "
                        "scripts/codegen.sh; edit contracts/openapi.yaml instead.")
    if declared is None:
        warnings.append("Start the PR title with the workstream, e.g. \"[B1] ...\", or \"[contract] ...\".")
    elif declared not in SPECIAL and declared != "integrator":
        others = [k for k in workstreams if k != declared]
        if others:
            warnings.append(f"This [{declared}] PR touches paths owned by {', '.join('WS-' + k for k in others)}. "
                            "Say why in the PR description and get that workstream's owner to review.")

    names = {a.key: a.name for a in areas}
    rows = ["| Area | Files |", "|---|---|"]
    for key, fs in sorted(by_area.items()):
        label = f"WS-{key} {names[key]}" if key in names and key not in SPECIAL else key
        shown = ", ".join(f"`{f}`" for f in fs[:6]) + (f" and {len(fs) - 6} more" if len(fs) > 6 else "")
        rows.append(f"| {label} | {shown} |")
    summary = "\n".join(["## Ownership check", "", f"PR title: `{title or '(none)'}`", "", *rows, ""]
                        + [f"- ❌ {e}" for e in errors] + [f"- ⚠️ {w}" for w in warnings])
    return errors, warnings, summary + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write-codeowners", action="store_true")
    group.add_argument("--check-codeowners", action="store_true")
    group.add_argument("--pr", metavar="BASE_SHA", help="check the files changed since BASE_SHA")
    args = parser.parse_args(argv)
    areas = load()

    if args.write_codeowners:
        CODEOWNERS.write_text(render_codeowners(areas))
        print(f"Wrote {CODEOWNERS.relative_to(ROOT)}")
        return 0
    if args.check_codeowners:
        if CODEOWNERS.read_text() != render_codeowners(areas):
            print("::error::.github/CODEOWNERS doesn't match .github/ownership.yml. "
                  "Run: python scripts/check_ownership.py --write-codeowners")
            return 1
        print("CODEOWNERS matches ownership.yml")
        return 0

    errors, warnings, summary = check_pr(changed_files(args.pr), os.environ.get("PR_TITLE", ""), areas)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary)
    for w in warnings:
        print(f"::warning::{w}")
    for e in errors:
        print(f"::error::{e}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

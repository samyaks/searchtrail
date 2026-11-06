"""One dry-run tenant shared by every gateway and process (searchtrail.dryrun, app.microsoft.get_gateway)."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import timedelta

import pytest
from jobs_helpers import KQL_V1, KQL_V2, add_version, calls, enqueue_estimate, job, run_all, seed_matter
from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import JobRow, MatterRow, RunRow
from app.jobs import queue, steps
from app.jobs.worker import run_one
from app.microsoft import dry_run_tenant_file, get_gateway
from app.settings import AppSettings
from searchtrail.dryrun import DryRunTransport
from searchtrail.gateway_dryrun import DryRunPurviewGateway


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(steps, "sleep", lambda _s: None)


@pytest.fixture
def settings(tmp_path):
    return AppSettings(dry_run=True, storage_dir=tmp_path / "storage")


def test_the_tenant_lives_under_the_storage_directory(settings, tmp_path):
    assert dry_run_tenant_file(settings) == tmp_path / "storage" / "dry-run" / "tenant.json"
    gw = get_gateway(settings)
    gw.ensure_case("M-1 test", "d")
    assert dry_run_tenant_file(settings).exists()
    assert get_gateway(settings) is not gw  # a gateway per job or request, one tenant


def test_what_one_gateway_creates_another_sees(settings):
    first, second = get_gateway(settings), get_gateway(settings)
    case = first.ensure_case("M-1 test", "d")
    search = first.create_search(case["id"], "cull v1", KQL_V1, [])
    url = first.start_estimate(case["id"], search["id"])

    assert second.ensure_case("M-1 test", "d", known_id=case["id"])["id"] == case["id"]
    op = second.get_operation(url)  # an operation another gateway started
    assert op["status"] == "succeeded" and op["indexedItemCount"] > 0
    other = second.create_search(case["id"], "cull v2", KQL_V2, [])
    assert other["id"] != search["id"]  # IDs keep counting instead of starting over
    # The counts follow each search's own query: patching one never changes the other.
    second.update_query(case["id"], other["id"], "kickback")
    assert first.get_operation(first.start_estimate(case["id"], search["id"]))["indexedItemCount"] == op["indexedItemCount"]


def test_downloads_review_sets_and_the_count_offset_are_shared_too(settings, tmp_path):
    first, second = get_gateway(settings), get_gateway(settings)
    case = first.ensure_case("M-1 test", "d")
    search = first.create_search(case["id"], "s", KQL_V1, [])
    report_url = first.start_report(case["id"], search["id"], "preview", include_partially_indexed=True)
    files = second.get_operation(report_url)["exportFileMetadata"]
    with open(tmp_path / "report.zip", "wb") as out:
        assert second.download_file(files[0]["downloadUrl"], out) > 100  # a real sample report, built by the other gateway's op

    review_op = first.add_to_review_set(case["id"], search["id"], "M-1 review")
    assert second.get_operation(review_op)["status"] == "succeeded"
    again = second.add_to_review_set(case["id"], search["id"], "M-1 review")  # reused by name, not duplicated
    assert again != review_op
    assert len(list(first.graph.get_all(f"/security/cases/ediscoveryCases/{case['id']}/reviewSets"))) == 1

    before = second.get_operation(first.start_estimate(case["id"], search["id"]))["indexedItemCount"]
    first.transport.count_offset = 17  # new mail arrives
    assert second.transport.count_offset == 17
    after = second.get_operation(second.start_estimate(case["id"], search["id"]))["indexedItemCount"]
    assert after == before + 17


def test_polling_changes_nothing_so_it_rewrites_nothing(settings):
    gw = get_gateway(settings)
    case = gw.ensure_case("M-1 test", "d")
    url = gw.start_estimate(case["id"], gw.create_search(case["id"], "s", KQL_V1, [])["id"])
    path = dry_run_tenant_file(settings)
    gw.get_operation(url)  # the first poll records the operation's download info, if any
    inode, text = path.stat().st_ino, path.read_text()
    for _ in range(3):
        gw.get_operation(url)
    assert (path.stat().st_ino, path.read_text()) == (inode, text)  # never replaced


def test_a_state_file_from_an_older_version_still_loads(tmp_path):
    path = tmp_path / "state.json"
    path.write_text(json.dumps({"next_id": 7, "queries": {"search-3": KQL_V1}, "emails": ["a@contoso.com"]}))
    transport = DryRunTransport(log=lambda _m: None, verbose=False, state_file=path)
    assert transport._next_id == 7 and transport._queries == {"search-3": KQL_V1} and transport.count_offset == 0
    assert DryRunPurviewGateway(transport=transport).create_search("case-1", "s", "x", [])["id"] == "search-7"


# -- several processes at once -----------------------------------------------------------------------
CREATE_SEARCHES = """
import sys
from searchtrail.gateway_dryrun import DryRunPurviewGateway
gw = DryRunPurviewGateway(log=lambda _m: None, state_file=sys.argv[1])
case = gw.ensure_case("M-1 shared", "d")
ids = [gw.create_search(case["id"], f"s{i}", "kickback", [])["id"] for i in range(int(sys.argv[2]))]
print(" ".join(ids))
"""


def test_processes_sharing_the_tenant_never_hand_out_the_same_id(tmp_path):
    state = str(tmp_path / "tenant.json")
    procs = [subprocess.Popen([sys.executable, "-c", CREATE_SEARCHES, state, "20"], stdout=subprocess.PIPE, text=True)
             for _ in range(4)]
    ids = [i for p in procs for i in p.communicate(timeout=60)[0].split()]
    assert all(p.returncode == 0 for p in procs)
    assert len(ids) == 80 and len(set(ids)) == 80  # no two processes got the same search ID
    saved = json.loads((tmp_path / "tenant.json").read_text())
    assert len(saved["queries"]) == 80 and saved["next_id"] > 80  # and none was lost


# -- the jobs, as the running stack runs them (a new gateway per job) -----------------------------------
def test_a_later_job_finds_the_search_an_earlier_job_made(sessions, settings):
    def gateway_for(_job):
        return get_gateway(settings)

    def run_everything(worker):
        with sessions() as s:
            while run_one(s, worker, gateway_for):
                pass

    with sessions() as s:
        matter = seed_matter(s)
        matter_id = matter.id
        first = enqueue_estimate(s, add_version(s, matter, KQL_V1))
    run_everything("w1")
    with sessions() as s:
        second = enqueue_estimate(s, add_version(s, s.get(MatterRow, matter_id), KQL_V2))
    run_everything("w2")

    done = [job(sessions, j) for j in (first, second)]
    assert [j.status for j in done] == ["succeeded", "succeeded"], [j.error for j in done]
    assert done[1].result["counts"]["items"] >= done[0].result["counts"]["items"] > 0  # more terms never find fewer
    state = json.loads(dry_run_tenant_file(settings).read_text())
    assert len(state["queries"]) == 1 and next(iter(state["queries"].values())) == KQL_V2  # one search, patched
    with sessions() as s:
        assert s.get(MatterRow, matter_id).purview_state["search"]["id"] in state["queries"]


def test_a_worker_takes_over_another_workers_operation_through_its_own_gateway(sessions, settings, monkeypatch):
    class Killed(BaseException):
        pass

    first_gateway, second_gateway = get_gateway(settings), get_gateway(settings)
    with sessions() as s:
        matter = seed_matter(s)
        job_id = enqueue_estimate(s, add_version(s, matter))

    monkeypatch.setattr(first_gateway, "get_operation", lambda _u: (_ for _ in ()).throw(Killed()))
    with sessions() as s, pytest.raises(Killed):
        run_one(s, "worker-1", lambda _j: first_gateway)
    monkeypatch.undo()
    with sessions() as s:
        s.get(JobRow, job_id).heartbeat_at = utcnow() - timedelta(minutes=10)
        s.commit()
        assert queue.requeue_stale(s) == 1

    run_all(sessions, second_gateway, worker="worker-2")  # a different process in the real stack
    done = job(sessions, job_id)
    assert done.status == "succeeded", done.error
    assert done.result["counts"]["items"] > 0  # not 0: worker 2 polled worker 1's operation
    assert len(calls(first_gateway, "POST", "/estimateStatistics")) == 1
    assert calls(second_gateway, "POST", "/estimateStatistics") == []  # never started its own
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "succeeded"

"""Background jobs: a `jobs` table in Postgres, claimed with SELECT ... FOR UPDATE SKIP LOCKED.

  queue.py     enqueue, claim, heartbeat, finish, fail, requeue stale jobs
  handlers.py  job kind -> task function: the registry, JobContext, JobFailed
  steps.py     the start, checkpoint, poll, finish pattern every Purview job follows
  purview.py   syncing a matter's case and search to the database (shared with the CLI)
  estimate.py  the `estimate` job (preview, term_report, export, download, review_set follow)
  export_checks.py  check_export(): the export checks, for POST .../exports/check and the export job
  worker.py    the worker process: `searchtrail-worker` or `python -m app.jobs.worker`

See docs/adr/0003-jobs-in-postgres.md. WS-B2 owns this package.
"""
from . import estimate  # noqa: F401  (registers the handler)

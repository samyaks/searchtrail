"""Background jobs: a `jobs` table in Postgres, claimed with SELECT ... FOR UPDATE SKIP LOCKED.

  queue.py     enqueue, claim, heartbeat, finish, fail, requeue stale jobs
  handlers.py  job kind -> task function (WS-B2 adds the six kinds)
  worker.py    the worker process: `searchtrail-worker` or `python -m app.jobs.worker`

See docs/adr/0003-jobs-in-postgres.md. WS-B2 owns this package.
"""

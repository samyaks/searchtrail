# 0010. Packaging: Docker images and Docker Compose

- Status: Accepted
- Date: 2026-11-06

## Decision
- `deploy/Dockerfile.backend` builds one image for the API, worker and migrations.
- `deploy/docker-compose.yml` runs `db` (Postgres 16), `migrate` (one-shot `alembic upgrade head`),
  `api` and `worker`, all with health checks. `SEARCHTRAIL_DRY_RUN=1` by default.
- Settings come from `deploy/.env` (template: `deploy/.env.example`). No secrets in the repo.
- The image build accepts an optional `extra_ca` build secret for TLS-inspecting proxies, common in
  customer networks; it is not kept in the image.

## Departure
The plan lists a `web` image too. Phase 0 doesn't add it (no screens to serve yet); WS-G adds the
web image, a reverse proxy serving the built frontend and `/api`, and TLS.

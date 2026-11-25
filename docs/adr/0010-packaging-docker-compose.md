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

Phase 1 added it: `deploy/Dockerfile.web` builds the frontend and serves it with Caddy
(`deploy/Caddyfile`), which passes `/api` to the `api` service unchanged, on `WEB_PORT` (8080, so it
doesn't clash with the Vite dev server on 5173).
Caddy over nginx: it streams request and response bodies without the buffering and size limits
nginx needs tuning for, finds the `api` container again after it restarts, and can manage TLS
certificates itself for the install guide. TLS and HSTS come with the install guide.

Caddy also answers for the API when it can't: a 502 with the contract's Error body (`internal_error`),
so the app shows its usual message. The API trusts Caddy's `X-Forwarded-*` headers
(`FORWARDED_ALLOW_IPS=*`), which is safe only while nothing else can reach it, so compose publishes the
API port on 127.0.0.1 only. Base images are pinned by digest (the multi-arch index); update them by hand
with `docker buildx imagetools inspect <tag>`.

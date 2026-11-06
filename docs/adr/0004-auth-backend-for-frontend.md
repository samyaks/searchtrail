# 0004. Auth: backend-for-frontend with delegated Entra sign-in

- Status: Accepted (to be built by WS-C)
- Date: 2026-11-06

## Context
Purview's audit log should name the real person who ran each search and export, so SearchTrail
acts with delegated permissions. Access tokens in the browser would be exposed to XSS.

## Decision
- The API runs the Entra authorization code flow with PKCE as an MSAL confidential client
  (`/auth/login`, `/auth/callback`, `/auth/logout`).
- Tokens (Graph and MicrosoftPurviewEDiscovery) stay server-side in `token_cache`, encrypted per user.
- The browser gets only an HTTP-only, Secure, SameSite=Lax cookie (`st_session`) naming a row in
  `sessions`.
- Jobs act as the user who started them, refreshing tokens from the cache (multi-hour exports).

## Consequences
- The CLI keeps its device-code flow; the web app doesn't use it.
- Expired sessions return `401 session_expired`; the frontend redirects to sign-in.
- Until WS-C lands, the app only runs in dry-run mode (`app/microsoft/get_gateway` refuses live mode).

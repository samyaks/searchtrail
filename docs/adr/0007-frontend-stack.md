# 0007. Frontend: React 18, TypeScript, Vite, React Router, TanStack Query

- Status: Accepted
- Date: 2026-11-06

## Context
Mainstream tools are easiest for agents to work in and for customers to audit.

## Decision
- React 18, TypeScript 5.9 (strict), Vite, React Router 7 (library mode, `createBrowserRouter`),
  TanStack Query 5 for server state, `openapi-fetch` as the typed client over the generated types.
- CSS Modules plus the design tokens in `src/styles/tokens.css` (V1_PLAN 5.6). Light theme only.
- Fonts (Libre Caslon Text, Public Sans, Courier Prime) are self-hosted from `@fontsource`, so the
  app makes no third-party requests from inside a customer network and a strict CSP is possible.
- ESLint (typescript-eslint, react-hooks).

## Departures
- TypeScript 7 was current but typescript-eslint doesn't support it yet, so 5.9 is pinned.
- The design files load Google Fonts; we self-host instead (above).

## Consequences
- One folder per screen in `src/screens/`; shared components in `src/components/` (WS-D).

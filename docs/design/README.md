# SearchTrail web app design source

These files are the source of the web app design canvas. Frontend agents should treat them as
the visual and behavioral spec for each screen.

| File | Screen |
|---|---|
| `Main.dc.html` | Matters list |
| `Define.dc.html` | Matter: Define (details, custodians, sites, holds) |
| `Scope.dc.html` | Matter: Scope (filters, live KQL and methodology, estimate) |
| `Preview.dc.html` | Matter: Preview (counts, breakdowns, item table) |
| `Terms.dc.html` | Matter: Terms (hits per term) |
| `Export.dc.html` | Matter: Export (checks, options, hand-off, history) |
| `Log.dc.html` | Matter: Log (versions, entries, comparison) |
| `canvas.json` | Canvas layout and artboard sizes |

How to read them:
- Each file is one screen. The markup inside `<x-dc>` is the layout, with inline styles holding
  the exact colors, spacing, sizes and fonts. `{{name}}` placeholders and `<sc-for>` / `<sc-if>`
  blocks are template bindings.
- The `<script type="text/x-dc">` block at the bottom holds the sample data and the prototype
  behavior (filters, toggles, typed confirmation). Use it to understand the interactions; in V1
  the data comes from the API instead.
- The files still say "culltool" in a few places; the product is now SearchTrail.
- The Terms screen's "Try without" and unique-hits column are out of scope for V1.

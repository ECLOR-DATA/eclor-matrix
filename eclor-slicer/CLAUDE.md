# Eclor Slicer — Claude Code operating manual

> Read this first. Created 2026-08-30.

## What this is

Power BI custom visual (`.pbiviz`) — all-in-one slicer: vertical list, chiclet
buttons, compact dropdown and hierarchy tree in ONE visual, with built-in
search, single/multi select, select all / invert / clear actions, and removable
selection badges (chips with a ×) that recap the active filter. Benchmarked
against ChicletSlicer, HierarchySlicer, Smart Filter — 100% free.
Third ECLOR visual, same shop as `eclor-waterfall` (certified 2026-07) and
`eclor-matrix`: workflows, agents, test harness, conventions.
Target: **AppSource certification** (Stage C from day one — retrofit costs 10x).

- **Current version:** 1.0.0.0 — see [CHANGELOG.md](CHANGELOG.md)
- **Stage status:** A ✅ (skeleton green) / B ⏳ / C ⏳
- **API:** `powerbi-visuals-api ~5.11.0`

## Commands

```powershell
npm install
npm run start              # pbiviz dev server (live reload, PBI dev mode required)
npm run lint               # eslint (plugin:powerbi-visuals/recommended)
npx tsc --noEmit           # type-check
npm test                   # jest (jsdom)
npm run package            # → dist/eclorSlicerECLOR2026.X.X.X.X.pbiviz
npm run snapshots          # jsdom render → HTML → Chromium PNGs (design review)
```

CI runs `lint → tsc → jest → package` on push to `main` / `certification`.

## Where to find context (read in this order)

1. This file — commands + project-specific gotchas
2. [docs/CLAUDE_PLAYBOOK.md](docs/CLAUDE_PLAYBOOK.md) — portable pbiviz patterns (cert standards, architecture, lessons)
3. [docs/WORKFLOW.md](docs/WORKFLOW.md) — the agent pipeline: dev loop, audit⇄fix loop, submission
4. [CONTEXT.md](CONTEXT.md) — design decisions and why
5. [CHANGELOG.md](CHANGELOG.md) — Keep-a-Changelog

## Architecture

- [src/visual.ts](src/visual.ts) — main `IVisual` class (constructor, update, parse, render, delegated interactions, filter application, destroy)
- [src/slicerModel.ts](src/slicerModel.ts) — PURE tree model (buildTree/flattenVisible/toggleNode tri-state/search/invert/normalizeSelection) — no host coupling, fully testable
- [src/filters.ts](src/filters.ts) — PURE JSON-filter builders (Basic/Tuple), filter-target extraction, applied-filter parsing for state restore
- [src/settings.ts](src/settings.ts) — `FormattingSettingsModel` (8 cards: selection, style, header, search, chips, items, hierarchy, value format)
- [src/format.ts](src/format.ts) — pure number/format-string helpers, copied verbatim from eclor-waterfall via eclor-matrix (scale-then-format pipeline, ~15 bugs already paid for — don't fork lightly)
- Tests in [test/](test/) — Jest + jsdom + ts-jest; shared harness [test/_harness.ts](test/_harness.ts) builds categorical DataViews
- [test/snapshots.test.ts](test/snapshots.test.ts) + [tools/screenshot.mjs](tools/screenshot.mjs) — pixel-true screenshots without PBI Desktop (jsdom DOM + compiled LESS → Chromium)

## Critical design decisions — don't redo

- **A slicer filters through `host.applyJsonFilter`, NOT SelectionManager.** The
  `general.filter` object in capabilities.json is load-bearing — remove it and
  applyJsonFilter silently stops persisting. Basic filter (1 field, no nulls),
  Tuple filter otherwise (hierarchy paths, blanks). Filter JSON is hand-rolled
  in `filters.ts` against the public powerbi-models schema — do NOT add the
  powerbi-models package for two object literals.
- **Filter echo protocol**: every applyJsonFilter triggers an update whose
  `jsonFilters` echoes our own filter. `pendingApplies` counter skips echoes;
  empty `jsonFilters` with no pending echo = external clear (native header
  button, bookmark) → drop local selection. Restoring from a persisted filter
  goes through `normalizeSelection` (leaf keys collapse onto parents).
- **HTML rendering, not SVG** — a slicer is interactive text UI. All
  construction via `createElement`/`textContent` — no string HTML anywhere, no
  `escapeXml` needed (would be dead code, do not add it).
- **No D3, no external deps beyond the PBI utils** — same posture as the other
  ECLOR visuals.
- **Selection is a Set of path keys** (`pathKey(rawPath)` = JSON of raw values,
  Dates ISO-serialised). Tri-state semantics live in `slicerModel.ts`
  (`toggleNode`: parent covers children, unticking a child splits the parent,
  completing children collapses onto the parent). Never duplicate this logic in
  the renderer.
- **Search filters DISPLAY only, never the data filter.** "Select all" and
  "Invert" operate on the visible (search-narrowed) root population.
- **`suppressDefaultTitle: true`** — the visual draws its own header (title +
  actions). Don't re-enable the host title.
- **Dropdown popover is in-flow**, not overlay — the visual's iframe cannot
  spill outside its viewport, so the open panel takes the remaining height.
- **Render cap `MAX_RENDER_ITEMS = 2000`** with `displayWarningIcon` — honest
  stopgap; windowed scrolling is the phase-2 backlog (mirror eclor-matrix
  virtualize.ts if needed).
- **Two empty-state branches** in `update()`: `dv.categorical === undefined` →
  page-switch transient → replay `lastValidRenderInput`; parsed but no field
  bound → user-cleared → wipe caches, `target.replaceChildren()` (host paints
  its native landing page).

## Project-specific gotchas

- The jest stub replaces `powerbi-visuals-api` with an empty object — code
  reading runtime enums (e.g. `powerbi.FilterAction`) must go through the
  guarded `filterAction()` helper in visual.ts.
- `chiclets` layout renders root-level items only (documented v1 limitation);
  `dropdown` + hierarchy reuses the tree body inside the popover.
- Screenshots: `npm run snapshots` needs `npm i --no-save playwright-core`
  once per machine (kept out of committed devDependencies on purpose).

## Workflow conventions

- One commit per feature/fix, message `X.Y.Z.W: short summary`
- Bump version in `pbiviz.json` AND `package.json` together; CHANGELOG entry per release
- Branch `certification` must match the submitted .pbiviz exactly
- CI is the gate: all 4 steps green before merge

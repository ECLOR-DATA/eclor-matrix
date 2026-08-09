# Eclor Matrix — Claude Code operating manual

> Read this first. Created 2026-08-09.

## What this is

Power BI custom visual (`.pbiviz`) — advanced matrix/cross-tab: hierarchical rows & columns, expand/collapse, engine-computed subtotals, dynamic number formats, rule-based conditional colours, heat maps and IBCS-ready variance reporting. Successor project to `eclor-waterfall` (certified 2026-07) — same shop: workflows, agents, test harness, conventions.
Target: **AppSource certification** (Stage C from day one — retrofit costs 10x).

- **Current version:** 1.0.0.0 — see [CHANGELOG.md](CHANGELOG.md)
- **Stage status:** A ⏳ (skeleton) / B ⏳ / C ⏳
- **API:** `powerbi-visuals-api ~5.11.0`

## Commands

```powershell
npm install
npm run start              # pbiviz dev server (live reload, PBI dev mode required)
npm run lint               # eslint (plugin:powerbi-visuals/recommended)
npx tsc --noEmit           # type-check
npm test                   # jest (jsdom)
npm run package            # → dist/eclorMatrixECLOR2026.X.X.X.X.pbiviz
```

CI runs `lint → tsc → jest → package` on push to `main` / `certification`.

## Where to find context (read in this order)

1. This file — commands + project-specific gotchas
2. [docs/CLAUDE_PLAYBOOK.md](docs/CLAUDE_PLAYBOOK.md) — portable pbiviz patterns (cert standards, architecture, lessons)
3. [docs/WORKFLOW.md](docs/WORKFLOW.md) — the agent pipeline: dev loop, audit⇄fix loop, submission
4. [CONTEXT.md](CONTEXT.md) — design decisions and why
5. [CHANGELOG.md](CHANGELOG.md) — Keep-a-Changelog

## Architecture (in 5 lines)

- [src/visual.ts](src/visual.ts) — main `IVisual` class (constructor, update, parseMatrix, renderFromInput, interactions, destroy)
- [src/matrixModel.ts](src/matrixModel.ts) — PURE matrix-tree flattening (flattenRows/flattenColumns/buildHeaderRows/computeMaxAbs) — no host coupling, fully testable
- [src/settings.ts](src/settings.ts) — `FormattingSettingsModel` (general / subTotals / values cards)
- [src/format.ts](src/format.ts) — pure number/format-string helpers, copied verbatim from eclor-waterfall (scale-then-format pipeline, ~15 bugs already paid for — don't fork lightly)
- Tests in [test/](test/) — Jest + jsdom + ts-jest; shared harness [test/_harness.ts](test/_harness.ts) builds matrix DataViews

## Agent workflow (see docs/WORKFLOW.md for detail)

- Audit: `/pbiviz-cert-audit` — 3 lanes (static / PBI Desktop screenshots / browser service),
  writes `audit/findings.json` + French report. `audit/test-report/` PBIP is pre-seeded (copied from eclor-waterfall — its 8 scenario pages still bind the WATERFALL visual; first audit run must rebind them to eclorMatrixECLOR2026).
- Fix: `/pbiviz-cert-fix` — consumes findings.json (CERT mode) or a described symptom (DEBUG mode).
  One commit per fix, version bumped, CHANGELOG updated. Never trusts itself: re-audit confirms.

## Critical design decisions — don't redo

- **HTML rendering, not SVG** (unlike eclor-waterfall): a matrix is text-dense, scrollable, sticky-headered — DOM `<table>` wins. All construction via `createElement`/`textContent` — no string HTML anywhere, no `escapeXml` needed (would be dead code, do not add it).
- **No D3** — same posture as eclor-waterfall. Nothing in a matrix needs scales/transitions; keep the bundle lean.
- **"Custom measures" are client-side calculated rows/columns** (Zebra BI/Inforiver model) — a custom visual CANNOT execute DAX. Never promise dynamic DAX in docs or UI copy. Expression engine (when it lands) must be a hand-rolled parser — `eval`/`new Function` are cert-fatal.
- **The `subtotals` capabilities block is load-bearing and complete** — all SIX switch mappings declared (`columnSubtotalsPerLevel` included). `rowSubtotalsPerLevel`/`perColumnLevel` default `false` (per-level route needs persisted per-field props we don't emit). Breaking this is SILENT (playbook §4.3.6). Never add a second `dataViewMappings` object (§4.3.5 — crashes the host query generator).
- **Two empty-state branches** in `update()`: `dv.matrix === undefined` → page-switch transient → replay `lastValidRenderInput`; parsed but 0 rows → user-cleared → wipe caches. Ghost-frame class of bugs (playbook §4.1.2).
- **Tooltip-only measures** (roles.tooltips without roles.values) are excluded from grid columns (`renderLeafIdxs`) but keep their global `cellKey` — cell keys are DFS ordinals over ALL column leaves, never re-indexed.
- **MAX_RENDER_ROWS = 5000** DOM cap with host warning — placeholder until virtual scrolling lands (phase 1 backlog). The 10k cert budget is tested on the pure pipeline.

## Project-specific gotchas

- `audit/test-report/` visuals reference `eclorWaterfallECLOR2026` until rebound (see Agent workflow above).
- `assets/icon.png` is the waterfall icon as placeholder — replace with a matrix-specific 20×20 PNG before Stage B.

## Workflow conventions

- One commit per feature/fix, message `X.Y.Z.W: short summary`
- Bump version in `pbiviz.json` AND `package.json` together; CHANGELOG entry per release
- Branch `certification` must match the submitted .pbiviz exactly
- CI is the gate: all 4 steps green before merge

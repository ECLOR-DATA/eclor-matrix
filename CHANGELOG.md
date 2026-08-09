# Changelog

All notable changes to Eclor Matrix are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning `X.Y.Z.W` (pbiviz four-part).

## [1.0.0.0] — 2026-08-09

### Added

- Project skeleton on the ECLOR shop (CI `lint → tsc → jest → package`, jest+jsdom harness, audit⇄fix agent skills, playbook) inherited from `eclor-waterfall`.
- Matrix DataView mapping (roles: Rows / Columns / Values / Tooltips) with the complete six-switch `subtotals` capabilities block, `drilldown` and `expandCollapse` (rows).
- Hierarchical row rendering with indentation, chevron expand/collapse via `selectionManager.toggleExpandCollapse`, engine-computed subtotal rows (styled), multi-level column headers with correct spans.
- HTML `<table>` renderer — sticky column headers, sticky row-header column, density modes (compact / normal / comfortable), text-size setting.
- Number formatting through the shared `format.ts` pipeline (model format strings honoured, display units + decimals on the Values card).
- Cross-filter selection (click, Ctrl/Shift multi, click-twice-to-clear, Esc), context menu, native tooltips (tooltip-role measures shown on hover), keyboard navigation (arrows, Home/End, Enter/Space, Esc), enriched aria-labels, high-contrast support.
- Playbook lifecycle hardening: constructor placeholder, `renderingStarted/Finished/Failed` triple, degenerate-viewport guard, page-switch replay vs user-cleared wipe (two-branch empty handling), `destroy()`.
- Localization en-US + fr-FR (resjson), FormattingSettingsService wired to the host localization manager.
- Test suites: matrixModel (flatten/headers/max-abs), lifecycle, format (inherited), perf budget (10k rows < 1 s).
- Assets imported: `sample/pnl-detailed-2y.csv` demo dataset, `template/Template V.1.0.0.pbix` + theme, `audit/test-report/` 8-page scenario PBIP (to be rebound to the matrix visual at first audit).

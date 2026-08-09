# CONTEXT — design decisions and why

> Living document. Every hard-won decision lands here with its rationale, so nobody
> (human or agent) re-litigates it blind. Newest sections at the bottom.

## 1. Genesis (2026-08-09)

Eclor Matrix is the second ECLOR visual, built on the shop extracted from
`eclor-waterfall` (certified by Microsoft 2026-07): same CI, same jest harness
patterns, same audit⇄fix agent pipeline (`pbiviz-agent-workflow`), same conventions.
Product goal: outclass the native Power BI matrix on flexibility — dynamic formats,
per-element colours, heat maps, IBCS variance reporting, client-side calculated
measures — benchmarked against Zebra BI, Inforiver Analytics+, Vari Matrix, Synaptrix.

## 2. HTML rendering, not SVG

The waterfall renders SVG because it's a chart. A matrix is a text grid: sticky
headers, natural scrolling, text selection, ellipsis, sub-pixel text rendering —
all free in HTML `<table>`, all painful in SVG. Construction is pure DOM API
(`createElement` + `textContent`), which is inherently injection-safe: there is no
`escapeXml` in this codebase **by design** (nothing builds markup strings).

## 3. Matrix DataView mapping from day one

`dataViewMappings.matrix` with roles rows/columns/values/tooltips. The complete
`subtotals` block (all six switch mappings) ships in v1.0.0.0 because the
Total/SubTotal API silently disables itself when any switch is missing — the
single most expensive lesson from the waterfall (its CONTEXT.md §20). Subtotal
rows/columns come from the ENGINE, not client-side summation: a client-side sum of
a non-additive measure (ratio, distinct count) is simply wrong.

## 4. Pure-module split

`matrixModel.ts` owns every tree-flattening rule (DFS leaf ordering = cell-key
ordering, measure level detection via `levelSourceIndex`, subtotal/collapsed
flags, header spans with filler under shallow branches). It imports nothing from
the API — tests feed plain object literals. `visual.ts` only orchestrates and
touches DOM. Same discipline as the waterfall's `format.ts`/`yRange.ts`, which is
what made 354 tests cheap there.

## 5. format.ts is imported wisdom, not new code

Copied verbatim from eclor-waterfall (scale-then-format pipeline, Excel
multi-pattern parsing, `[…]` bracket stripping, display-units interplay). Its
test suite came with it. Divergence policy: if Matrix needs a formatting
behaviour change, add it BEHIND a new option — never mutate the shared semantics —
and flag the delta for back-porting to the waterfall + playbook.

## 6. "Custom measures" = client-side calculated rows/columns

A custom visual receives one host-generated query; it cannot execute DAX. The
Zebra BI / Inforiver "formula" features are client-side arithmetic over the cells
already present. Ours will be the same (phase 5): a small hand-rolled expression
parser (tokenizer + shunting-yard; `eval`-free because cert forbids it),
operating on the flattened row/column model. True time-intelligence (YTD, PY at
arbitrary grain) stays in the semantic model — the docs must say so plainly.

## 7. Expand/collapse & drill

`expandCollapse` (rows role, `addDataViewFlags: true`) + `drilldown` declared in
capabilities. The visual calls `selectionManager.toggleExpandCollapse(selectionId)`
built with `withMatrixNode`; the HOST recomputes the DataView with `isCollapsed`
flags. We never fake collapse client-side — the host owns hierarchy state so
bookmarks/persistence work for free.

## 8. Rendering cap until virtualization

`MAX_RENDER_ROWS = 5000` with `displayWarningIcon` — an honest stopgap so first
paint stays inside the cert budget. Phase 1 backlog: windowed rendering (render
visible rows ± overscan into the scroll container, translate on scroll). The pure
pipeline (flatten 10k rows) is perf-tested at < 1 s from day one.

## 9. Test-report PBIP inherited from the waterfall

`audit/test-report/` is the 8-page hostile-scenario PBIP (Nominal, Interactions,
Nulls, Negatives, HostileLabels, MultiInstance, Huge10k, Tiny) with its synthetic
semantic model — copied as-is. Its visuals still bind `eclorWaterfallECLOR2026`;
the first `/pbiviz-cert-audit` run rebinds them to `eclorMatrixECLOR2026` with
matrix-shaped field wells (rows/columns/values). The demo dataset
`sample/pnl-detailed-2y.csv` (10 080-row P&L, 7 entities × 3 BUs × 20 lines ×
24 months) is shared with the waterfall — one dataset, both demos.

## 10. Template PBIX

`template/Template V.1.0.0.pbix` + its theme JSON are the ECLOR report template
used for demos and manual testing — same starting point as the waterfall's demo
reports, so branding and theme behaviour stay consistent across ECLOR visuals.

## 11. Default look = the "eclor — Light" theme (2026-08-09)

Reference designated by the user: the AppSource demo report
`eclorWaterfallECLOR2026.1.1.76.0.pbix`. Its embedded theme is vendored at
`template/eclor-light-theme.json`; the matrix DEFAULTS mirror its
`visualStyles.pivotTable`/`tableEx` blocks so an unformatted Eclor Matrix looks
native next to an ECLOR-themed native matrix:

| Token | Value | Theme source |
|---|---|---|
| Font | Arial 11 | `textClasses.label`, pivotTable fontFamily/fontSize |
| Foreground | `#091612` | `foreground` / `tableAccent` |
| Column headers | bg `rgba(9,22,18,.1)`, bold, centered | `columnHeaders.backColor #0916121A` |
| Grid | horizontal only, `#E5E7E6` | `grid.gridHorizontal(Color)` |
| Totals/subtotals | bg `#EFEFEF`, bold, applyToHeaders | `total`/`rowTotal`/`columnTotal` |
| Banded rows | `#F5F6F5` | `values.backColorSecondary` |
| Accent (hover/selection) | `#1EF5B1` emerald (14% / 28% alpha) | `dataColors[0]` / `good` |
| Semantic good/bad/neutral | `#1EF5B1` / `#FF4D6D` / `#8A9994` | theme `good`/`bad`/`neutral` — reserve for variance/IBCS phases |

These are CSS defaults in [style/visual.less](style/visual.less) — when the
matching Format-pane slices land (headers card, grid card…), their defaults must
quote the same values, and the report theme (visualStyles on our GUID) must stay
able to override them.

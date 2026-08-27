# Changelog

All notable changes to Eclor Matrix are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning `X.Y.Z.W` (pbiviz four-part).

## [1.8.2.0] — 2026-08-27

### Fixed

Hardening pass driven by the second adversarial review (38 findings on the comments/options diff, all triaged):

- **Multi-level column headers survive a comments/tooltips binding**: aux measure leaves are pruned from a copy of the column tree (`pruneColumnTree`) instead of collapsing the whole header to the flat fallback — the flagship 1.8 feature no longer degrades cross-tab headers.
- **Custom formula rows can no longer sprout phantom comments** (their formula cells at comment ordinals are numeric noise — extraction now skips woven rows, as docs/COMMENTS.md always claimed).
- **Clicks inside the 💬 panel no longer clear the row selection / cross-filter** (same guard as the layout editor).
- **`Show comments` off now also removes comments from hover tooltips**, and a panel left open no longer survives the toggle or the measure's removal.
- **Markup data-fidelity**: `*italic*` and `__underline__` only open at a word start — `2*3*4 = 24` and `MY__TABLE__NAME` stay literal; a colour tag counts only when its `[/#]` closer exists — ticket references like `[#123]` stay literal; comment text capped at 2000 chars (ellipsis), which also bounds the parser's hostile-input cost.
- **Comments panel truncation is announced** (« … +N autres lignes commentées ») and bounded per line count, not only per row count.
- **High-contrast**: panels/toolbar follow the host palette (no more white-on-white in HC Black), grid/header-rule structure toggles keep working, marker forced to HC foreground.
- **Grid colour token isolated** (`--em-hgrid-c`): the horizontal grid colour no longer repaints panel borders and variance-bar axes; custom group-row backgrounds hold on hover (no unreadable 14%-alpha swap).
- **Inline comment column clamp moved to an inner div** (max-width on a table cell is undefined in auto layout — Firefox ignored it); comment column header now honours the alignment/italic options.
- **`cellPaddingX` clamped (0-40) and applied to the row-header indent base** (was hardcoded 8px); persisted out-of-range grid widths clamped.
- **Dual-role (values + comments) measures render their markup in the grid** instead of raw asterisks.
- New guard tests: capabilities.json shape (single mapping, six subtotal switches, `privileges: []`), comments × column hierarchy, comments × calculated columns, comments × virtualization (window + spacer colSpan), high-contrast surfaces. 175 tests / 17 suites.

## [1.8.1.0] — 2026-08-27

### Fixed

Hardening pass driven by a 60-agent adversarial review of the 1.7.0.0 engine (every finding independently counter-verified):

- **Prefix `%` no longer silently binds to the previous operand** — `1 + %2` used to compile and evaluate to 2.01; now rejected (`misplaced '%'`), like every prefix/infix `%`.
- **Bare function names rejected everywhere** — `(5 MAX)`, `SUM([a] MAX; [b])` used to evaluate as implicit 1-arg calls; now `missing '(' after MAX`.
- **Empty/trailing argument slots rejected structurally** — `SUM(1 2,)` used to compile (a missing separator cancelling a trailing one); `SUM(1,,2)`, `SUM(1; 2;)`, `IF(1, , 2)` now fail with `empty function argument`.
- **`ROUND` half-away-from-zero now holds on decimal halves** — `ROUND(1.005; 2)` returned 1.00 (binary float noise); now 1.01, and `ROUND` can no longer return `-0`.
- **Variadic `MIN`/`MAX` no longer blow the call stack** on huge argument counts (loop instead of spread), and formulas are capped at **8192 characters — Excel's own limit** (hostile-input backstop).
- **Comparisons use Excel semantics**: operands normalized to 15 significant digits, so `10% + 20% = 30%` is now TRUE.

### Added

- **Unary `+` and leading-dot decimals accepted** (`=+[Réel]-[Budget]`, `[a]*.5`) — Lotus-era Excel habits.
- **`AVG`** documented as an `AVERAGE` alias (was implemented, untested).
- **Per-column "explicit sign" toggle** on calculated columns (default on, preserving the 1.4.0.0 behaviour) — turn it off for flag/rounded columns like `SI([Réel]>=[Budget];1;0)` where a leading `+` reads wrong.
- **Opaque sticky headers**: the 10%-alpha theme band is now composited over solid white, so rows no longer bleed through the column headers during virtualized scrolling.

## [1.8.0.0] — 2026-08-27

### Added

- **Data comments, Zebra-style** (`comments` data role + `src/comments.ts`): text measures fed from the MODEL (SharePoint list / Excel via Power Query, related to the dimensions) surface as row markers (●, configurable colour), an optional inline column, or the 💬 side panel. Inline rich markup — `**bold**`, `*italic*`, `__underline__`, `[#RRGGBB]colour[/#]` — parsed without any HTML string (DOM spans only), forgiving by design (unclosed markers style to the end, malformed tags stay literal). Card styling (bold/italic/underline/colour/column title) as the base, markup overrides locally. Comment text also lands in tooltips and aria-labels (markup stripped). Access management is the model's own (RLS + source permissions at refresh) — no network from the visual, certification-safe. **Full portable architecture documented in [docs/COMMENTS.md](docs/COMMENTS.md)** for reuse on other ECLOR visuals.
- **Grid & borders card**: horizontal grid (toggle/colour/width 1-4px), vertical grid (toggle/colour/width), outer border (toggle/colour/width), header bottom rule toggle. Disabled rules go transparent but keep their width, so row geometry — and the virtualization row-height math — never shifts.
- **Spacing**: horizontal cell padding (px) on the General card.
- **Hierarchy options** (Row headers card): bold group rows, group-row background (hover still wins), show/hide expand chevrons.
- **Subtotal style card** (`subtotalsStyle`, deliberately separate from the load-bearing `subTotals` switch mirror): background colour, font colour, bold toggle.

## [1.7.0.0] — 2026-08-27

### Added

- **Simplified Excel-style calculation engine** (`src/expressions.ts` v2) — powers BOTH calculated columns and custom formula rows, still 100% eval-free (hand-rolled tokenizer + shunting-yard, certification-safe):
  - operators `^` (power, Excel semantics: `-2^2 = 4`, left-associative) and postfix `%` (`[Actual] * 110%`);
  - comparisons `= <> < <= > >=` returning 1/0, so Excel idioms like `([Actual] > [Budget]) * 10` work;
  - functions `SUM`, `AVERAGE`, `MIN`, `MAX` (variadic, blanks ignored like Excel), `ABS`, `ROUND` (half away from zero, optional/negative digits), `IF`;
  - French aliases `SOMME`, `MOYENNE`, `ARRONDI`, `SI` and the Excel-FR `;` argument separator;
  - a leading `=` is tolerated (pasted-from-Excel habit);
  - null-safety unchanged: missing ref, null operand, ÷0, NaN/overflow → blank, never a crash.
- Formula hint line in the layout-editor panel (localized fr/en) listing the available operators and functions.

### Changed

- `MIN`/`MAX` are now variadic and skip null arguments (Excel blank-cell behaviour): `MIN([a], [b])` with `[a]` blank now returns `[b]` instead of blank; `MIN(1)` is now a valid formula.

## [1.6.0.0] — 2026-08-10

### Added

- **Excel-style custom rows + in-visual layout editor** (`✎` toolbar): insert rows anywhere, independent of the hierarchy and the model —
  - **ad-hoc subtotals**: select any rows in the grid, name the subtotal, it lands after the last selected row (sum per column);
  - **formula rows**: expressions over OTHER ROWS by label (`[Gross Sales] / [Revenue]`, ratios that exist nowhere in the model), scoped resolution (same group as the anchor first), inherit/number/percent formats;
  - definitions persist in the report via `host.persistProperties` (JSON in `customRows.state`), so they survive save/reopen/publish and travel with the report;
  - custom rows render distinct (italic label, dashed top rule; subtotal styling for Σ rows), are excluded from heat-map domains and painting, and formula errors render blank — never crash. Panel is DOM-built, localized (fr/en), and never steals the row selection.

## [1.5.1.0] — 2026-08-09

### Documentation

- `docs/BENCHMARK.md` — market positioning vs Zebra BI / Inforiver / Vari / Synaptrix (feature matrix, assumed differentiators, prioritized gaps; knowledge-based, to be refreshed online before public use).
- README roadmap updated (phases 1-6 shipped), CONTEXT.md §12-15 (virtualization, per-measure persistence pattern, calc engine, IBCS), CLAUDE.md architecture + decisions.

## [1.5.0.0] — 2026-08-09

### Added

- **IBCS styling** (Format → IBCS): scenario detection from measure names (EN/FR tokens — Actual/Réel, Prior/PY/N-1, Budget/Plan, Forecast/Prévision) with per-measure override on the Values card. Header semantics: AC solid underline, PY grey, BU outlined, FC hatched; PY/FC data cells styled accordingly.
- **In-cell variance bars**: calculated columns can display as IBCS bars on a shared zero axis (good `#1EF5B1` / bad `#FF4D6D`, formatted value alongside), domain = |max| per column over detail rows; high-contrast falls back to the HC foreground.

## [1.4.0.0] — 2026-08-09

### Added

- **Client-side calculated columns** (3 slots): eval-free expression engine (`src/expressions.ts`, tokenizer + shunting-yard) over measure references — `[Actual] - [Budget]`, `([Actual]-[Budget])/[Budget]`, ABS/MIN/MAX, unary minus. Null-safe (missing ref, null operand, ÷0 → blank). Columns interleave after each column-group's measures (flat header mode), formats inherit/number/percent with explicit sign, subtotal rows compute on engine subtotals (ratio-correct). Invalid formulas are skipped silently.

## [1.3.0.0] — 2026-08-09

### Added

- **Row headers card**: bold, italic, font colour, configurable indent per hierarchy level.
- **Column headers card**: bold, italic, font colour, background colour, alignment, rotation 0°/45°/90° (labels wrapped in rotatable spans).
- **Spacing**: General → row padding in px (0 = follow the density preset); paddings refactored to the `--em-pad-y` CSS variable.

## [1.2.0.0] — 2026-08-09

### Added

- **Cell colors card** (global + per-measure override groups): `Rules` mode (below-low / above-high thresholds → bad `#FF4D6D` / good `#1EF5B1`, optional middle colour) and `Heat map` mode (2- or 3-colour interpolation over each measure's min–max, subtotals excluded from domain and from painting). Text colour auto-contrasts via WCAG linearized luminance. High-contrast mode suppresses all painting. Pure engine in `src/cellColor.ts`.

## [1.1.0.0] — 2026-08-09

### Added

- **Virtual scrolling**: above 400 rows the tbody renders a window (overscan 20) between two spacer rows, re-windowed on scroll — replaces the MAX_RENDER_ROWS hard cap; 10k+ rows scroll fluidly. Pure math in `src/virtualize.ts`.
- **Per-measure format overrides**: the Values card is now a CompositeCard — an "All measures" global group plus one group per bound measure (Override format toggle, display units, decimals) persisted per measure via metadata selectors; renderer and tooltips resolve override-then-global.

## [1.0.1.0] — 2026-08-09

### Changed

- Default look now mirrors the ECLOR "eclor — Light" theme (reference: AppSource demo `eclorWaterfallECLOR2026.1.1.76.0.pbix`, vendored at `template/eclor-light-theme.json`): Arial 11, column headers on a 10% `#091612` band with strong bottom rule, horizontal-only `#E5E7E6` grid, `#EFEFEF` bold totals, `#F5F6F5` banded rows, `#1EF5B1` emerald hover/selection accent. Token mapping documented in CONTEXT.md §11.

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

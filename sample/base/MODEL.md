# The reference model + theme

Extracted from the pbix submitted & published with the **Eclor Waterfall
1.1.76.0** AppSource listing. Culture `en-US`, compatibility level 1601.
Full TOM ground truth in [model-dump.txt](model-dump.txt); drop-in TMDL in
[semantic-model/](semantic-model/).

## The star

```
FACT_ECLOR_FINANCIALS (Date) ──Many:One──> DIM_TIME (Date)      _MEASURES (measure table)
```

### FACT_ECLOR_FINANCIALS — M import from `Financial Sample.xlsx`

The Financial Sample sheet, transformed (full M in `model-dump.txt`):

- years remapped **2013→2026 / 2014→2025** (so the demo always looks current);
- **Discounts and COGS negated** — costs are negative in the data;
- leading space stripped from ` Sales`;
- the measure columns **unpivoted** into `Category` / `Amount`;
- sort key `Order_Category` added (text, so it sorts lexically as intended):
  Sale Price `0` → Units Sold `1000` → Manufacturing Price `2000` → Gross
  Sales `3000` → Discounts `4000` → Sales `5000` → COGS `6000` → Profit
  `7000`.

Columns: `Segment`, `Country`, `Product`, `Discount Band`, `Date`,
`Category` (**sortBy `Order_Category`**), `Order_Category`, `Amount`
(currency, `"€"` format).

The workbook is located through the **`DataFolder` parameter**
(`expressions.tmdl`). Neutral default `C:\pbiviz\sample-base` — repoint it in
**Transform data → Manage parameters**.

### DIM_TIME — M calendar 2025-01-01 → 2026-12-31

Year/Month/Day, `YearMonth` (`yyyy-MM`, the slicer field), YearMonthNumber,
Quarter/YearQuarter, ISO week + weekday, fiscal year/quarter (start-month
parameter), flags (IsWeekend / IsToday / IsCurrent\* / IsYTD),
MonthOffset / YearOffset, DateKey.

### _MEASURES — display folder `Financial`

| Measure | DAX | Format |
|---|---|---|
| `Actual` | `SUM(FACT_ECLOR_FINANCIALS[Amount])` | `#,0` |
| `Actual M-1` | `CALCULATE([Actual], DATEADD('DIM_TIME'[Date], -1, MONTH))` | `#,0.###############\ "€"` (3-part) |
| `Δ M-1` | `[Actual] - [Actual M-1]` | idem € |
| `Δ M-1 %` | `DIVIDE([Δ M-1], ABS([Actual M-1]), 0)` | `0.0\ %` (3-part) |
| `Ratio to Gross Sales` | `ABS(IF(SELECTEDVALUE(…Category) IN {"Gross Sales"}, BLANK(), DIVIDE([Actual], CALCULATE([Actual], REMOVEFILTERS(FACT), Category="Gross Sales", KEEPFILTERS(DIM_TIME)), 0)))` | `#,0.00\ %` |

Display folder `UI & UX` — **fx colour measures**, bound as field-value
conditional formatting on the visual:

- `_Color_Category`: SWITCH on Category → Gross Sales `#1EF5B1`, Sales
  `#46EAFF`, Profit `#8958FE`, else `#808080`
- `_Color_Country`: SWITCH on Country → Canada `#8958FE`, France `#FFB454`,
  Germany `#46EAFF`, else `#808080`

## The theme — « eclor — Light »

[eclor-light.theme.json](eclor-light.theme.json): emerald `#1EF5B1`, ink
`#091612`, Arial, radius-16 cards, top legends, dotted gridlines.
[logo.svg](logo.svg) goes top-left of every page. Let the theme supply
backgrounds, cards and fonts — avoid per-visual overrides it already covers.

## Conventions to carry into any new demo work

- **Costs negative in the data.** A waterfall / variance / bridge visual then
  needs no sign hacks, and negative-value code paths get exercised for free.
- **Sort `Category` by `Order_Category`** at model level, never per report.
- **Colour through the `_Color_*` measures** (fx field value), not hard-coded
  per-point fills. One place to change, and it exercises the fx persistence
  cascade the way real users do — the single most bug-prone surface in a
  custom visual.
- **Format strings live on the measures** (`€`, `%`, multi-pattern). A visual
  that respects them verbatim is tested against real formats rather than a
  clean `#,0`.
- **Theme first**, per-visual formatting second.

## PBIR / TMDL authoring notes (learned building this)

- TMDL: a `formatString` containing quote markers must be emitted fully
  quoted with doubled inner quotes (`"""TRUE"";""TRUE"";""FALSE"""`).
- Multi-line DAX in TMDL needs the **triple-backtick** delimiter — an
  unterminated block makes Desktop fail to open the project entirely.
- `tableEx`: do NOT set `"active": true` on a `Values` projection — the table
  then renders only that column. `active` is for grouping roles
  (category/legend) and slicers.
- Don't carry a pbix's persisted `columnWidth`-style objects into a rebuilt
  `tableEx` — stale metadata selectors blank the columns.
- A raw `Column` reference inside a PBIR `Conditional` fill is rejected by the
  query generator ("The top level Projections must be a valid measure or
  aggregation expression"). Bind a **DAX colour measure** instead — that is
  what the `_Color_*` measures are for.
- Engine (TMSL) refresh right after a `pbir desktop refresh` hot-reload
  deadlocks; refresh only on a freshly opened instance.
- **MAX_PATH**: a PBIP tree eats ~95 characters before your own names. Open
  agent-driven PBIPs from a SHORT root (`C:\wf-test\`), never from a session
  scratchpad (~160 chars on its own) or a deep OneDrive path — Desktop
  enforces the limit strictly and dies at open.

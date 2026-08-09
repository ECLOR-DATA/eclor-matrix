# Sample dataset & demo report

`pnl-detailed-2y.csv` is the shared ECLOR demo dataset (same file as
eclor-waterfall's): a 10 080-row monthly P&L (2024-01 → 2025-12), 7 entities ×
3 business units × 20 P&L lines, with three measures `Prior_Year` / `Budget` /
`Actual` and a `PnL_Order` sort column. Static, self-contained — just import it.

## How to build the demo `.pbix`

1. Start from `template/Template V.1.0.0.pbix` (ECLOR-branded template) — or a
   blank report with `template/Template V.1.0.0.json` applied as theme.
2. **File → Get data → Text/CSV** → `sample/pnl-detailed-2y.csv` → **Load**.
3. Sort `PnL_Line` by `PnL_Order` (**Column tools → Sort by column**).
4. **Insert → More visuals → From a file** → latest `dist/eclorMatrixECLOR2026.X.X.X.X.pbiviz`.
5. Field wells:
   - `Entity`, `PnL_Line` → **Rows** (two-level hierarchy)
   - `Date` (Year/Quarter) → **Columns**
   - `Actual`, `Budget` → **Values**
   - `Prior_Year` → **Tooltips**
6. Format pane: **Subtotals** → check row subtotals ON, position Top; **Values**
   → display units Auto; **General** → density Normal.
7. Exercise: expand/collapse entities, click rows to cross-filter a companion
   bar chart, hover cells for Prior_Year tooltips.
8. **File → Save as** → `sample/Eclor Matrix – PnL.pbix`.

## The certification test report

`audit/test-report/` is the 8-page hostile-scenario PBIP (Nominal, Interactions,
Nulls, Negatives, HostileLabels, MultiInstance, Huge10k, Tiny) inherited from
eclor-waterfall. Its visuals still reference the WATERFALL guid — the first
`/pbiviz-cert-audit` run rebinds them to `eclorMatrixECLOR2026`.

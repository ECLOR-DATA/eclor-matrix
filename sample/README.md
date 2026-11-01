# Sample data & demo report

Every demo report, screenshot and listing asset starts from the shared ECLOR base
in [base/](base/): Microsoft Financial Sample (700 rows), star schema, measures,
theme and logo. Read [base/MODEL.md](base/MODEL.md) first. Never invent a dataset.

## How to build a demo report

1. Create a PBIP from [base/semantic-model/](base/semantic-model/) and apply
   `base/eclor-light.theme.json`.
2. **Transform data → Manage parameters**: point `DataFolder` at your copy of
   `sample/base` before the first refresh. Grep for your local username before
   committing anything derived from it: this repo is public.
3. **Insert → More visuals → From a file** → latest `dist/eclorMatrixECLOR2026.X.X.X.X.pbiviz`.
4. Field wells for a P&L view: `Category` → **Rows**, `Year` → **Columns**,
   `Actual` → **Values**.

## IBCS templates T01-T04

The templates need an AC measure plus a PY and/or PL one. The test report adds two
measures on top of the base (Financial Sample's 2026 only covers Sep–Dec, so PY
compares the same months):

```dax
PY = CALCULATE([Actual], SAMEPERIODLASTYEAR(CALCULATETABLE(VALUES('DIM_TIME'[Date]), FACT_ECLOR_FINANCIALS)))
Plan = ROUND([PY] * 1.05, 0)
```

`Plan` is a synthetic demo measure, not real budget data. Format → IBCS → Table
template then picks T01-T04. T03/T04 expect an additive calculation scheme, e.g.
`Category` filtered to Gross Sales, Discounts and COGS, whose total is Profit.

## The certification test report

`audit/test-report/` is generated: run `node audit/tools/build-test-report.mjs`
after `npm run package`. It holds the IBCS, nominal, interaction and format pages
on the demo base, plus the hostile scenario tables (Nulls, Negatives, HostileLabels,
OneRow, TwoRows, Huge10k).

`pnl-detailed-2y.csv` is the older demo dataset, kept for reference only.

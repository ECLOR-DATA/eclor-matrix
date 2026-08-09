# Eclor Matrix

Power BI custom visual — an advanced matrix/cross-tab built to outclass the native
matrix on flexibility: hierarchical rows & columns with expand/collapse,
engine-computed subtotals, dynamic number formats, rule-based conditional colours,
heat maps and IBCS-ready variance reporting.

Sibling of [Eclor Waterfall](https://github.com/ECLOR-DATA/eclor-waterfall)
(Microsoft-certified, AppSource) — same engineering shop: CI, test harness,
audit⇄fix agent pipeline, certification conventions.

## Status

`1.5.0.0` — feature-complete core (Stage A, cert prep underway). Hierarchical
matrix with engine subtotals and expand/collapse, virtual scrolling (10k+ rows),
per-measure format overrides, rule-based colours + heat maps, custom headers
(rotation 0/45/90°), client-side calculated columns (eval-free formula engine),
IBCS scenarios (AC/PY/BU/FC, EN+FR detection) with in-cell variance bars,
selection/tooltips/keyboard/high-contrast, en-US + fr-FR.
Market positioning: [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Data roles

| Role | Kind | Purpose |
|---|---|---|
| Rows | Grouping (multi) | Row hierarchy, drill levels in order |
| Columns | Grouping (multi) | Optional column hierarchy (cross-tab) |
| Values | Measure (multi) | Measures at each intersection |
| Tooltips | Measure (multi) | Extra measures shown on hover only |

## Develop

```powershell
npm install
npm run start              # pbiviz dev server (requires PBI developer mode)
npm run lint               # eslint (powerbi-visuals plugin)
npx tsc --noEmit           # type-check (strict)
npm test                   # jest (jsdom)
npm run package            # → dist/eclorMatrixECLOR2026.X.X.X.X.pbiviz
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the same chain on
`main` and `certification` and uploads the packaged `.pbiviz` artifact.

## Architecture

| File | Responsibility |
|---|---|
| `src/visual.ts` | `IVisual` orchestration: host wiring, update pipeline, DOM render, interactions |
| `src/matrixModel.ts` | Pure matrix-tree flattening (rows, column leaves, header spans) — fully unit-tested |
| `src/settings.ts` | Format-pane model (8 cards incl. dynamic per-measure groups) |
| `src/format.ts` | Pure number/format-string pipeline, shared with Eclor Waterfall |
| `src/virtualize.ts` | Pure windowed-scrolling math |
| `src/cellColor.ts` | Pure rules/heat-map colour engine (WCAG auto text contrast) |
| `src/expressions.ts` | Eval-free formula engine for calculated columns |
| `src/ibcs.ts` | IBCS scenario detection (EN/FR) + variance-bar math |

Design decisions and their rationale: [CONTEXT.md](CONTEXT.md).
Portable pbiviz patterns and certification standards: [docs/CLAUDE_PLAYBOOK.md](docs/CLAUDE_PLAYBOOK.md).

## Roadmap

1. ~~Core matrix skeleton~~ (1.0)
2. ~~Virtual scrolling + per-measure dynamic formats~~ (1.1)
3. ~~Rule-based colours + heat maps~~ (1.2)
4. ~~Custom headers (styling, rotation) + spacing controls~~ (1.3)
5. ~~Client-side calculated columns (no-DAX expression engine)~~ (1.4)
6. ~~IBCS scenarios, semantic styling, variance bars~~ (1.5)
7. Top-N + comments + in-cell charts (see [docs/BENCHMARK.md](docs/BENCHMARK.md) gaps)
8. AppSource listing + Microsoft certification (audit⇄fix loop)

## Demo data

`sample/pnl-detailed-2y.csv` — 10 080-row monthly P&L (2024–2025), 7 entities ×
3 business units × 20 P&L lines with `Actual` / `Budget` / `Prior_Year` measures.
Import it in Power BI Desktop, drop `PnL_Line` (and `Entity`) into **Rows**, a
date hierarchy into **Columns**, the three measures into **Values**.
`template/Template V.1.0.0.pbix` is the ECLOR-branded starting report.

## License

MIT — see [LICENSE](LICENSE). Privacy: [docs/PRIVACY.md](docs/PRIVACY.md)
(no data collection, no network, no storage, `privileges: []`).

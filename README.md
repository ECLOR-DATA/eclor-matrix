# Eclor Matrix

Power BI custom visual — an advanced matrix/cross-tab built to outclass the native
matrix on flexibility: hierarchical rows & columns with expand/collapse,
engine-computed subtotals, dynamic number formats, rule-based conditional colours,
heat maps and IBCS-ready variance reporting.

Sibling of [Eclor Waterfall](https://github.com/ECLOR-DATA/eclor-waterfall)
(Microsoft-certified, AppSource) — same engineering shop: CI, test harness,
audit⇄fix agent pipeline, certification conventions.

## Status

Feature-complete core, certification audit loop running (current version in
[CHANGELOG.md](CHANGELOG.md), latest audit verdict in
[audit/findings.json](audit/findings.json)). Hierarchical matrix with engine
subtotals and expand/collapse, virtual scrolling (10k+ rows), per-measure format
overrides, rule-based colours + heat maps, custom headers (rotation 0/45/90°),
column widths, frames and per-row styling, client-side calculated rows and
columns (eval-free Excel-style formula engine), IBCS scenarios (AC/PY/BU/FC,
EN+FR detection), table templates T01-T04 with variance bars, pins and
waterfalls, model-fed data comments ([docs/COMMENTS.md](docs/COMMENTS.md)),
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
7. ~~Excel-style custom rows + in-visual layout editor~~ (1.6)
8. ~~Simplified calc engine, data comments, IBCS templates T01-T04, layout options~~ (1.7–1.11)
9. AppSource listing + Microsoft certification (audit⇄fix loop — in progress)
10. Top-N + in-cell sparklines (see [docs/BENCHMARK.md](docs/BENCHMARK.md) gaps)

## Demo data

Every demo starts from the shared ECLOR base in [sample/base/](sample/base/)
(Microsoft Financial Sample, star schema, theme — see its `MODEL.md`).
[sample/README.md](sample/README.md) explains how to build a demo report on it.

## License

MIT — see [LICENSE](LICENSE). Privacy: [docs/PRIVACY.md](docs/PRIVACY.md)
(no data collection, no network, no storage, `privileges: []`).

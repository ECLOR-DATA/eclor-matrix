# sample-base — the one demo dataset for every custom visual

> **Standing decision (2026-08-17, Nicolas): every demo report, sample pbix,
> screenshot, listing asset and doc example — for ANY ECLOR custom visual —
> starts from this model and this theme.** Don't invent a dataset. Don't
> invent a palette.

This is the model and theme of the pbix actually submitted to Partner Center
and published on AppSource for **Eclor Waterfall 1.1.76.0**. It survived a
Microsoft certification review, so it is known-good material: small enough to
embed in a pbix, rich enough to exercise signs, sort keys, multi-pattern
format strings and fx conditional formatting.

## Why one shared base (the part that only becomes obvious at visual #2)

- **Reviewers compare.** A submission whose sample looks like the rest of the
  catalogue reads as a product line, not a hobby project.
- **Screenshots and page compositions stay reusable.** Same fields, same
  palette, same page frame ⇒ a layout proven on one visual transfers to the
  next for free.
- **Agents stop inventing.** Left free, an agent fabricates a new CSV and a
  new colour scheme per task. With the base, "which data?" is a non-question
  and any rendering oddity is diffable against a known-good reference.

## Files

| File | Role |
|---|---|
| `Financial Sample.xlsx` | The single source workbook — Microsoft's *Financial Sample*, 700 rows, sheet table `financials`. Public sample data, safe to ship in a public repo and inside a pbix. |
| `MODEL.md` | The synthesis: star schema, every transformation, every measure + DAX, the conventions to carry into new work. **Read this before building anything.** |
| `model-dump.txt` | Full TOM dump of the published model — every M partition, column, measure DAX, relationship. Ground truth when `MODEL.md` is not precise enough. |
| `semantic-model/` | The TMDL definition, ready to drop into a fresh PBIP (`<Name>.SemanticModel/definition/`). Repoint the `DataFolder` parameter, refresh, done. |
| `eclor-light.theme.json` | The **« eclor — Light »** report theme (emerald `#1EF5B1`, ink `#091612`, Arial, radius-16 cards, top legends, dotted gridlines). Apply to every report. |
| `logo.svg` | ECLOR mark (ink `#091612`) — image visual, top-left of every page. |
| `reference-waterfall/` | What a *shipped* sample looks like: the submitted pbix + the full layout of its 4 pages. Reference material, **not** copied into new repos by `install.ps1` — it is waterfall-specific. |

## Bootstrapping a new visual's demo report

1. `pwsh .\install.ps1 -TargetRepo C:\path\to\my-visual` — copies everything
   except `reference-waterfall/` into `<repo>/sample/base/`.
2. `pbip new` (or copy an existing PBIP shell), then drop
   `sample/base/semantic-model/*` into `<Name>.SemanticModel/definition/`.
3. **Repoint the `DataFolder` parameter** (Transform data → Manage
   parameters) at the folder holding `Financial Sample.xlsx`. It ships with a
   neutral default (`C:\pbiviz\sample-base`) precisely so nobody's local path
   travels into a public repo.
4. Refresh. Apply `eclor-light.theme.json`, add `logo.svg` top-left.
5. Compose pages against `reference-waterfall/layout-reference.json` — it
   holds the published report's real geometry and every visual's persisted
   format-pane objects, per-point selectors and fx rules included.

## Keeping this in sync

The canonical copy is here. The per-repo copies under `<repo>/sample/base/`
exist so **cloud and remote agents get the base from the clone** — they have
no access to `Dev/`. When the base changes, update here first, then re-run
`install.ps1` on each visual repo.

Path-hygiene rule for anything that lands in a **public** repo (cert mirrors
included): grep for the local username before committing. The `DataFolder`
parameter is the one place a machine path hides.

# Eclor Slicer

**All-in-one Power BI slicer — free.** Vertical list, chiclet buttons, compact
dropdown and hierarchy tree in a single custom visual, with built-in search,
single/multi select, select all / invert / clear actions, and removable
selection badges that recap the active filter at a glance.

Third visual from the ECLOR shop, sharing the toolchain of
[eclor-waterfall](https://github.com/ECLOR-DATA/eclor-waterfall) (Microsoft-certified)
and [eclor-matrix](https://github.com/ECLOR-DATA/eclor-matrix).

## Features

- **4 layouts, 1 visual** — vertical list, chiclet grid (1–8 columns), compact
  dropdown, hierarchy tree (bind 2–6 fields; expand/collapse, tri-state
  checkboxes).
- **Filter recap badges** — every selection becomes a chip with a ×; remove one
  filter with one click, or everything with *Clear all*. Overflow folds into `+N`.
- **Search** — accent-insensitive, keeps ancestors as context, auto-expands
  matches; combine with *Select all* to select every search result.
- **Selection modes** — multiple (checkboxes) or single (radios,
  click-twice-to-clear), *Invert* for quick complements.
- **Values next to items** — bind an optional measure (respects the model
  format string, display units, decimals) or show leaf counts.
- **Native behaviour** — persists as a real report filter (filter pane,
  bookmarks, "clear filter" header button all work), landing page, keyboard
  navigation, high-contrast themes, EN/FR localization.

## Data roles

| Role | Kind | Notes |
|---|---|---|
| Field | Grouping (1–6) | 1 field = flat modes · 2+ fields = hierarchy tree |
| Values | Measure (0–1) | Optional per-item value; leaf counts otherwise |

## Develop

```bash
npm install
npm run start        # pbiviz dev server
npm run lint         # eslint (powerbi-visuals plugin)
npx tsc --noEmit     # type-check
npm test             # jest (jsdom)
npm run package      # dist/eclorSlicerECLOR2026.X.X.X.X.pbiviz
npm run snapshots    # design-review PNGs (needs: npm i --no-save playwright-core)
```

CI (GitHub Actions) runs `lint → tsc → jest → package` on `main` and
`certification`.

Agent/contributor context: [CLAUDE.md](CLAUDE.md), design rationale:
[CONTEXT.md](CONTEXT.md), portable pbiviz patterns:
[docs/CLAUDE_PLAYBOOK.md](docs/CLAUDE_PLAYBOOK.md).

## Privacy

The visual runs entirely inside the Power BI sandbox — no network calls, no
storage, no telemetry. Full policy: [docs/PRIVACY.md](docs/PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

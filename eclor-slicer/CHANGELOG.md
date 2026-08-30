# Changelog

All notable changes to Eclor Slicer are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · versions follow the pbiviz `X.Y.Z.W` scheme.

## [1.0.0.0] — 2026-08-30

### Added
- Initial Stage-A skeleton, cert-ready posture from day one (playbook §7 walked top-to-bottom).
- Four layouts in one visual: vertical list, chiclet button grid, compact dropdown (in-flow panel), hierarchy tree (auto when 2+ fields bound, up to 6 levels).
- Filtering through the JSON-filter API: BasicFilter (single field) / TupleFilter (hierarchy paths, blanks) with state restore from persisted filters, echo-skip protocol and external-clear detection.
- Tri-state hierarchy selection (parent covers children, child untick splits the parent, sibling completion collapses onto the parent) in a pure, fully-tested model.
- Built-in search (accent-folded, ancestors kept as context, auto-expand of matched branches) — display narrowing only, composable with Select all / Invert.
- Selection recap badges (chips) with one-click ×, overflow `+N`, and a "Clear all" chip.
- Header actions: Select all, Invert, Clear (mode-aware), custom title.
- Optional measure display next to items (scale-then-format pipeline from eclor-waterfall) or leaf counts.
- Single/multi selection modes (radios vs checkboxes, click-twice-to-clear in single mode).
- Full keyboard navigation (arrows, Home/End, Enter/Space, Escape, Ctrl+A), enriched aria labels, focus-visible rings, high-contrast mode.
- en-US + fr-FR localization; i18n parity + capabilities↔settings sync enforced by tests.
- Jest + jsdom suite (7 suites) incl. 10k-row perf budget; snapshot→Chromium screenshot pipeline (`npm run snapshots`).
- CI: lint → tsc → jest → pbiviz package on `main`/`certification`.

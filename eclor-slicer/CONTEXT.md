# CONTEXT — design decisions and why

> Living document. Every hard-won decision lands here with its rationale, so
> nobody (human or agent) re-litigates it blind. Newest sections at the bottom.

## 1. Genesis (2026-08-30)

Eclor Slicer is the third ECLOR visual, built on the shop extracted from
`eclor-waterfall` (certified by Microsoft 2026-07) and refined on
`eclor-matrix`: same CI, same jest harness patterns, same audit⇄fix agent
pipeline, same conventions, same "eclor — Light" default look. Product goal:
one free visual that replaces ChicletSlicer + HierarchySlicer + the native
dropdown slicer, and adds what none of them have out of the box — a
filter-recap chip row with one-click removal.

## 2. Filtering through the JSON-filter API, not SelectionManager

A slicer's contract with the host is `host.applyJsonFilter(filter, "general",
"filter", action)` against a declared `general.filter` capabilities object —
that's what makes the filter persist in the report, show in the filter pane,
sync with bookmarks and be clearable from the visual header. SelectionManager
cross-highlighting is the wrong tool (it doesn't persist and competes with
other visuals' selections). Consequences:

- **Basic vs Tuple routing** (`filters.ts`): 1 bound field with no blank
  selected → `IBasicFilter` (portable, readable in the filter pane); anything
  else (hierarchy paths, blanks) → `ITupleFilter` over the selected LEAF
  tuples. Selecting a parent expands to its leaves — bounded by the 10k data
  reduction cap, deduped, and semantically identical to filtering the parent.
- **Hand-rolled filter JSON.** The powerbi-models package would add a real
  dependency for two object literals with a public, frozen schema. We type
  them ourselves and test the shapes.
- **Filter target extraction** mirrors interactivityutils'
  `extractFilterColumnTarget` fallback chain: `expr.ref` / `expr.level` +
  `expr.source.entity` (nested `arg` for hierarchy levels), falling back to
  queryName/displayName. `expr` is undocumented-but-stable; the fallbacks keep
  us alive if it ever moves.

## 3. The echo protocol (state sync with the host)

Every applyJsonFilter fires an update() whose `jsonFilters` echoes our filter
back. Naively adopting it would fight the user's in-flight interactions;
ignoring it would break bookmarks and the native "clear filter" button. The
contract (all in `syncSelectionWithHost`):

1. `pendingApplies` counter — one decrement per update; while > 0 the echo is
   ours, skip.
2. `jsonFilters === undefined` → host didn't say → keep local state.
3. `jsonFilters === []` with no pending echo → external clear → drop selection.
4. A parseable Basic/Tuple filter → `normalizeSelection` rebuilds the minimal
   key set (leaf keys covering a whole parent collapse onto the parent, so a
   restored selection is indistinguishable from the original clicks).

Known accepted limit: a restored parent selection re-expresses as its leaves
when data changed underneath (rows gone) — the filter stays correct.

## 4. Tri-state selection lives in the pure model

`toggleNode` implements the full checkbox-tree semantics: selecting a node
prunes covered descendants; selecting the last missing sibling collapses the
set onto the parent; unticking a node under a selected ancestor SPLITS the
ancestor into "everything except this path". `checkState` derives on/partial/
off. The renderer only reads. This is the single hardest part of a hierarchy
slicer and it is 100% unit-tested with zero DOM.

## 5. HTML rendering, pure DOM construction

Same reasoning as eclor-matrix §2: a slicer is text UI (ellipsis, sticky
zones, native scroll, focus). `createElement` + `textContent` everywhere means
injection is structurally impossible — there is no `escapeXml` in this
codebase **by design** (nothing builds markup strings).

## 6. One visual, four layouts — routed, not forked

`list` (flat or tree body — the same renderer handles both), `chiclets`
(grid of root-level buttons), `dropdown` (field + in-flow panel reusing the
list body), `auto` (= list). The playbook §4.3.3 lesson applies: the user's
layout pick is INTENT; the renderer routes to a small set of primitives.
Chiclets with a hierarchy render EVERY element, grouped in one section per
level (field-name header + button grid, parent shown as a muted prefix on
each button) — the market pattern users expect from hierarchy-capable button
slicers; indentation on buttons stays a UX lie we avoid.

The dropdown panel is **in-flow**, not an overlay: the visual lives in a
sandboxed iframe and cannot spill outside its viewport, so the open state
consumes the remaining height (native PBI dropdown slicers cheat with host
chrome we don't have).

## 7. Search is display-narrowing, never a data filter

Typing narrows the visible tree (accent-folded, `subtreeMatches` keeps
ancestors as context and force-expands them). It never touches
applyJsonFilter. "Select all" and "Invert" operate on the visible root
population — that composition (search then select-all) is the power feature
that replaces Smart Filter's "filter by search". Search state is transient by
design in v1 (no `selfFilter` persistence yet — phase 2).

## 8. Chips = the filter recap

The chip row is the product's signature: selected nodes in display order
(pruned of covered descendants — `selectedNodesInOrder`), each a real
`<button>` with a ×, `maxChips` overflow (`+N`), and a dashed "Clear all"
chip. Chips double as the a11y summary (each carries a localized
"Remove filter X" aria-label).

## 9. Default look = the "eclor — Light" theme

Same tokens as eclor-matrix CONTEXT §11: Arial 11, ink `#091612`, hairline
`#E5E7E6`, muted `#8A9994`, emerald accent `#1EF5B1` (selected bg, dark text
on top — 8.7:1 contrast), chip bg `#D9FDF1`. All colours flow through CSS
custom properties set from visual.ts, so high-contrast mode overrides every
one in a single code path (`applyCssVars`).

## 10. Render cap before virtualization

`MAX_RENDER_ITEMS = 2000` + `displayWarningIcon` + an in-body cap note. The
pure pipeline is perf-tested at 10k rows < 1 s; the DOM is the bottleneck.
Phase 2: windowed rendering (port eclor-matrix `virtualize.ts` — its math is
layout-agnostic). Not shipped in v1 to avoid dead code in a cert audit.

## 11. Screenshot pipeline without PBI Desktop

`RENDER_SNAPSHOTS=1 jest test/snapshots.test.ts` drives the REAL visual in
jsdom (real clicks, real update()) and serialises `target.outerHTML` + the
compiled LESS into standalone HTML; `tools/screenshot.mjs` rasterises them in
headless Chromium at 2× DPI. Pixel-true because the DOM and CSS are the
production artefacts — only jsdom's layout is fake, and Chromium redoes
layout. This is the design-review loop's input; PBI Desktop lanes stay for
the cert audit.

## 12. Round-2 decisions (2026-08-30, boucle design/QA/audit)

Issues du premier cycle multi-agents (design-review-r1, qa-hardening-r1,
cert-audit-r1) :

- **Dérogation capabilities assumée (audit CAP-01)** : pas de
  `supportsHighlight`, `supportsMultiVisualSelection` ni bloc `tooltips` —
  un slicer n'a pas de data points à surligner ni à infobuller ; le filtrage
  passe par applyJsonFilter (§2). Ne pas « corriger » : c'est intentionnel.
- **Gris informatif AA** : `--es-muted #5E6E68` (5.38:1). `#8A9994` survit en
  `--es-muted-soft` pour le décoratif pur (loupe, caret fantôme). Tout gris
  porteur de sens passe par `--es-muted`.
- **Sélection calme en liste** (`--es-selected-soft-bg` + barre inset 3px +
  case remplie émeraude) ; le plein-émeraude reste sur les chiclets (état
  bouton légitime). En HC les deux tokens pointent sur `hyperlink`.
- **Chips** : masquées en mode single (redondantes), TOUJOURS sous le champ
  en mode dropdown, cap auto une-ligne `min(maxChips, ⌊largeur/90⌋)`,
  contexte parent (`Paris` → `France · Paris`) + title = chemin complet.
- **Footer unifié** : recherche → « X of Y items » ; sinon plat « X / Y
  selected », hiérarchie « X selected · Y values », vide « N items ».
- **Valeur de mesure lazy-init** (`value: null`, QA BUG-1) : une mesure 100 %
  non numérique retombe sur les compteurs, jamais un « 0.0 » trompeur.
- **Écho de filtre durci** (audit LIF-02) : le compteur `pendingApplies` ne
  se consomme que sur un update porteur de `jsonFilters` ; retrait du champ
  → libération explicite du filtre persisté (LIF-01).
- **ARIA** : conteneur `group`/`radiogroup` (pas listbox), caret décoratif
  `aria-hidden`, état porté par `aria-expanded` sur l'item.

## 13. Options v1.2 — indicateurs, wrap, boutons hiérarchiques (2026-08-30)

Demandes produit intégrées :
- **Indicateur de sélection paramétrable** (carte Items) : case (carrée ou
  ronde), interrupteur toggle, coche seule, pastille, ou aucun (le fond
  porte l'état). Emplacement gauche / droite / centré (flex order + variantes
  CSS `es-pos-*`). L'état on/partial reste porté par les classes de la ligne,
  jamais dupliqué dans l'indicateur. Mode single + case = look radio conservé.
- **Retour à la ligne des libellés** (`wrapLabels`) pour les hiérarchies aux
  libellés longs — incompatible virtualisation à hauteur uniforme : si la
  phase 2 virtualise, wrap la désactivera (à documenter alors).
- **Chiclets hiérarchiques** : `nodesByLevel` (modèle pur, search-aware) fait
  des sections par niveau ; la sélection reste le même Set tri-état, un clic
  sur un bouton profond applique le tuple du chemin complet.

## 14. fx & typographie v1.3 (2026-08-30)

- **fx partout** : `makeFxColorPicker` (wildcard + ConstantOrRule) sur les 8
  couleurs ; `patchFxSlices` applique la cascade §6.9 après chaque populate.
  Garde d'homogénéité STRICTE : le slot ligne-0 n'est promu en global que si
  TOUTES les lignes portent le même fill — un résultat de règle épars ou
  hétérogène reste par élément (`readRowFills` → `itemFills`, listes plates,
  niveau 0). Sélection et high-contrast écrasent toujours les fills.
- **FontControl par zone** (items/header) + bold badges ; les variables CSS
  `--es-item-*`/`--es-header-*` restent le seul canal (HC intact).
- **Accordéon** (`singleExpand`) : `expandNode` referme les sœurs — l'état
  profond d'une branche refermée est conservé (réouverture = même sous-arbre).
- Marges : `--es-inner-pad` (root) et `--es-item-gap` (items + gap chiclets).

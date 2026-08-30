# Changelog

All notable changes to Eclor Slicer are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) · versions follow the pbiviz `X.Y.Z.W` scheme.

## [1.3.1.0] — 2026-08-30

### Changed — « breathing pass » (bonnes pratiques des filtres web, validée par revue design R3)
- **Espacements par défaut recalibrés** sur les standards de facettes web (Linear/Stripe/e-commerce) : gouttières extérieures 12 px, lignes ≥ 28 px (densité normale 6 px, confortable 10 px), champ de recherche ~32 px, badges 3×10 + gap 6, espace interne des lignes 8 px, grille chiclets 8 px, coins arrondis 8 px par défaut. La densité « Compacte » reste le mode serré.
- **Indicateurs 15 px** (cases/coche/radio taille web standard), toggle 26×15, pastille 10 px.
- **Rangée de badges une-ligne garantie** (pattern Notion/Linear) : rail clippé `nowrap` + « Tout effacer » ancré à droite — plus jamais d'orphelin sur une 2e ligne ; budget de chips réaliste (plat et groupé, étiquettes de niveau comprises).
- **Le titre du header rétrécit en dernier** (min-width 40 %) — plus de « Région / … » tronqué pendant que les actions gardent leurs marges.
- **Tri-état lisible sur les chiclets** : branche partiellement couverte = bordure accent 1,5 px + « – » devant le libellé (même vocabulaire que le tiret des cases).
- Footer : singulier « 1 value » / « 1 valeur » ; contraste du préfixe parent remonté sur chiclet sélectionné.

## [1.3.0.0] — 2026-08-30

### Added (demandes produit)
- **Mise en forme conditionnelle (fx) sur toutes les couleurs** : les 8 sélecteurs de couleur (éléments, en-tête, badges) portent l'affordance fx (constante OU règle). Une règle produit des **couleurs par élément** (fond et/ou texte de chaque ligne/bouton selon la donnée, parité ChicletSlicer) ; une constante répartie sur toutes les lignes est promue en global via la cascade de persistance du playbook (§6.9), avec garde d'homogénéité stricte. L'état sélectionné et le mode high-contrast gardent toujours la main.
- **Typographie par zone** : contrôle de police complet (famille, taille, gras, italique, souligné) sur les Éléments et l'En-tête ; gras sur les Badges. Le tout via `FontControl` natif du volet Format.
- **Marges** : marge intérieure du visuel (0–24 px) et espacement entre éléments (0–12 px), appliqués aussi à la grille de chiclets.
- **Interactions hiérarchie** : boutons « Tout développer » / « Tout réduire » dans l'en-tête (chevrons doubles, hiérarchie uniquement) ; **mode accordéon** (option) : ouvrir une branche referme ses sœurs au même niveau — clic et clavier (→).

### Fixed
- **Bulle du toggle centrée verticalement** (`top:50% + translateY`) — elle collait en haut.
- Réintroduction assumée de `powerbi-visuals-utils-dataviewutils` (sélecteurs wildcard fx — l'usage qui manquait en 1.0.1.0).
- 7 tests + 2 snapshots (11 typo/fx, 12 interactions arbre) — 141 tests au total.

## [1.2.0.0] — 2026-08-30

### Added (demandes produit)
- **Indicateur de sélection paramétrable** (carte Éléments) : case à cocher, **interrupteur toggle**, coche seule, pastille ou aucun ; **forme** carrée/ronde ; **emplacement** gauche / droite / centré. Tri-état respecté par chaque variante (toggle mi-course, tiret, pastille semi).
- **Retour à la ligne des libellés** (option) — les libellés longs des hiérarchies passent sur plusieurs lignes au lieu de l'ellipse.
- **Boutons chiclets avec toute la hiérarchie** : une section par niveau (en-tête = nom du champ), chaque élément de chaque niveau devient un bouton avec son parent en préfixe ; tri-état visible (branche partiellement couverte = teinte + bordure accent) ; un clic sur un bouton profond filtre le chemin complet ; recherche et cap de rendu respectés (`nodesByLevel` pur et testé).
- 4 tests + 2 snapshots (09 chiclets hiérarchiques, 10 toggle+wrap) — 134 tests au total.

## [1.1.0.0] — 2026-08-30

### Added
- **Récapitulatif des filtres par niveau de hiérarchie** (demande produit) : les badges sont groupés par niveau et étiquetés du nom du champ (« Pays : France × · Ville : Paris × »), avec une croix DE NIVEAU qui vide toutes les sélections de ce niveau en un clic (affichée dès 2 sélections au niveau) ; aria-labels enrichis du nom de niveau ; nouvelle clé `Visual_ClearLevel` (en/fr).

### Fixed (revue design R2)
- Artefact « croissant » émeraude : la barre accent est un `::before` clippé par `overflow: hidden`, plus un inset box-shadow qui fuyait autour du border-radius.
- High-contrast : la case cochée garde une bordure contrastée (`--es-selected-fg`) au lieu de fondre dans la ligne.
- Le cap « chips une ligne » réserve ~80 px pour « Tout effacer » (fini le wrap en slicer étroit) ; préfixe parent des chips borné à 64 px avec ellipse.
- Chips masquées sous le panneau dropdown ouvert (le panneau montre déjà la sélection).

## [1.0.1.0] — 2026-08-30

Round 2 — intégration de la boucle multi-agents (revue design, durcissement QA, audit cert statique).

### Fixed
- **i18n du volet Format** (audit I18N-01, major) : `displayNameKey` sur chaque propriété, slice et membre d'énumération (capabilities + formatting model), descriptions des dataRoles localisées ; 80 clés en/fr en miroir strict, verrouillées par tests.
- **High-contrast** (audit HC-01, major) : fond du popover dropdown tokenisé (`--es-popover-bg`), ombre neutralisée, bordure de chips en HC — plus aucune couleur hors du chemin `applyCssVars`.
- Mesure 100 % non numérique → retombe sur les compteurs au lieu d'un « 0.0 » (QA BUG-1, lazy-init des valeurs de nœuds).
- Retrait du champ → libération explicite du filtre persisté (plus de filtre orphelin) et purge complète de l'état (audit LIF-01) ; compteur d'écho consommé uniquement sur les updates porteurs de `jsonFilters` (LIF-02).
- ARIA : conteneurs `group`/`radiogroup`, caret décoratif `aria-hidden`, état `aria-expanded` porté par l'item, focus non-couleur-seule sur la recherche (audit A11Y-01/02/03).

### Changed (revue design R1)
- Gris informatif AA `#5E6E68` (5.38:1) partout ; `#8A9994` réservé au décoratif.
- Sélection « calme » en liste : teinte douce + barre accent 3 px + case remplie émeraude ; plein-émeraude conservé sur les chiclets.
- Chiclets sur 2 lignes (le label ne perd plus contre sa valeur), bordure visible + ombre de levage, plus de bold au clic, tooltip natif.
- Chips : une seule ligne (cap auto ⌊largeur/90⌋), contexte parent sur les nœuds profonds, title = chemin complet, « Tout effacer » en bordure pleine + × ; masquées en mode single ; sous le champ en mode dropdown.
- Footer unifié : « X of Y items » en recherche, « X / Y selected » à plat, « X selected · Y values » en hiérarchie.
- Surlignage du terme cherché, carets 16 px lisibles, rotation du caret dropdown, grille 8 px, focus 2 px solid, cases 14 px, micro-transitions, scrollbar fine.
- Suppression de 2 dépendances jamais importées (dataviewutils, tooltiputils).

### Added
- 34 tests (129 au total, 8 suites) : hardening QA adversarial + régressions i18n/capabilities ; snapshots high-contrast et fr-FR.

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

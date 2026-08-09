# Benchmark marché — matrices avancées Power BI

> Établi le 2026-08-09 sur base de connaissances arrêtées à janvier 2026.
> **À rafraîchir par une veille en ligne avant toute citation publique**
> (fiches AppSource, pricing et features évoluent vite).

## Les quatre références analysées

### Zebra BI Tables

Le leader IBCS (certifié IBCS Institute). Forces : colonnes de variance
automatiques (ΔPY, ΔPY%, ΔBU…) dès que les scénarios sont détectés,
graphiques in-cell (barres, waterfalls, lollipops), commentaires dynamiques
liés aux données, top-N + "others", scaling groups inter-visuels.
Limites : payant par utilisateur (coût significatif à l'échelle),
personnalisation fine du style hors canon IBCS volontairement bridée,
courbe d'apprentissage des "chart sliders".

### Inforiver Analytics+ / Inforiver Matrix

Le plus riche fonctionnellement : édition type tableur dans le visuel
(saisie manuelle, what-if, forecasting), moteur de formules visuel, notes et
annotations, templates IBCS et financiers, export paginé. Limites : très
lourd (bundle et UX), modèle de licence complexe (Standard/Premium/
Enterprise), beaucoup de fonctions dépassent le cadre d'une matrice de
reporting et supposent l'écriture différée (writeback) vers des services
externes — à l'opposé de notre posture zéro-réseau certifiable.

### Vari (financial matrix)

Positionnement reporting financier : P&L pré-structurés, sous-totaux
personnalisés, styles de lignes par type (titre, sous-total, KPI). Moins
riche que Zebra/Inforiver, mais simple. Limites : flexibilité cross-tab
réduite (orienté états financiers verticaux), écosystème plus confidentiel.

### Synaptrix / cross-tabs avancés

Créneau "cross-tab avancé" (en-têtes composés, cellules multi-mesures,
mise en forme par zone). Limites : adoption faible, certification et
accessibilité inégales, documentation mince. À re-vérifier — le nom et le
périmètre exact demandent une veille en ligne.

## Où Eclor Matrix se situe après la phase 6 (1.5.0.0)

| Capacité | Zebra BI | Inforiver | Eclor Matrix 1.5 |
|---|---|---|---|
| Hiérarchies lignes/colonnes + expand/collapse hôte | ✔ | ✔ | ✔ |
| Sous-totaux moteur (non-additifs corrects) | ✔ | ✔ | ✔ |
| Formats par mesure (unités/décimales) | ✔ | ✔ | ✔ |
| Règles de couleurs + heat map | ✔ | ✔ | ✔ |
| Colonnes calculées client-side | ✔ | ✔ (éditeur) | ✔ (formules texte) |
| Scénarios IBCS (AC/PY/BU/FC) + sémantique visuelle | ✔ (certifié) | ✔ | ✔ (détection EN/FR + override) |
| Barres de variance in-cell | ✔ | ✔ | ✔ |
| Virtualisation grands volumes | ✔ | ✔ | ✔ (fenêtrage 400+) |
| En-têtes stylables + rotation | partiel | ✔ | ✔ (0/45/90°) |
| Commentaires/annotations liés aux données | ✔ | ✔ | ✘ (backlog) |
| Top-N + "Autres" | ✔ | ✔ | ✘ (backlog) |
| Waterfall/sparkline in-cell | ✔ | ✔ | ✘ (backlog — synergie eclor-waterfall) |
| Édition/writeback | ✘ | ✔ | ✘ (hors périmètre — cert zéro réseau) |
| Gratuit | ✘ | ✘ | ✔ |
| Zéro réseau / zéro stockage (privacy certifiable) | ✔ | partiel (writeback) | ✔ |

## Différenciateurs assumés

1. **Gratuit + certifiable** — même pipeline de cert que eclor-waterfall
   (déjà certifié) ; aucun privilège, aucun réseau, bundle < 60 KB là où les
   concurrents dépassent le méga-octet.
2. **Bilingue FR/EN natif** — détection de scénarios IBCS sur vocabulaire
   français (Réel, N-1, Prévision), volet Format localisé, formats fr-FR.
3. **Thème ECLOR intégré** — rendu par défaut aligné sur le template maison,
   zéro configuration pour les rapports ECLOR.
4. **Transparence du calcul** — les colonnes calculées sont des formules
   texte lisibles (pas un éditeur propriétaire opaque) et les sous-totaux
   restent ceux du moteur Power BI (jamais de somme client fausse sur
   ratio).

## Gaps prioritaires (backlog phase suivante)

1. **Top-N + regroupement "Autres"** — la demande n° 1 sur les matrices.
2. **Commentaires par cellule/ligne** (persistés via l'API du rapport).
3. **Graphiques in-cell** : sparklines, et mini-waterfalls réutilisant la
   géométrie d'eclor-waterfall.
4. **Templates préconfigurés** (P&L, budget vs actual) livrés comme pages du
   PBIX de démo + recettes documentées.
5. **fx (règles pilotées par mesure) sur les couleurs** — cascade de
   persistance à 4 niveaux du playbook (§4.2) à implémenter.

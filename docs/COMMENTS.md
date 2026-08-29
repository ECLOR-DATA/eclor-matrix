# Commentaires de données — architecture complète & guide de portage

> Documentation de référence de la couche « commentaires » d'Eclor Matrix
> (1.8.0.0), écrite pour être **réutilisée telle quelle sur d'autres visuels
> customs ECLOR** (waterfall, futurs visuels). Le module cœur est portable :
> [`src/comments.ts`](../src/comments.ts) n'importe rien d'autre que les
> types structurels du modèle aplati.

## 1. Le principe en une phrase

Les commentaires **voyagent par le modèle sémantique** — jamais par un appel
réseau du visuel : une liste SharePoint (ou un tableau Excel sur
SharePoint/OneDrive) est chargée par Power Query, reliée aux clés de
dimension, exposée par une **mesure texte** liée au rôle de données
`comments` du visuel. Le visuel ne fait qu'afficher.

```
SharePoint list / Excel  ──Power Query──▶  table Commentaires (modèle)
                                                 │  relation sur la clé
                                                 ▼
                                    mesure texte [Commentaire]
                                                 │  rôle "comments"
                                                 ▼
                                   Eclor Matrix (marqueurs ● / colonne / panneau 💬)
```

### Pourquoi ce choix est le seul possible en visuel certifié

Un visuel custom **certifié AppSource ne peut faire aucune requête
externe** : pas de `fetch`, pas d'API SharePoint/Graph, pas de WebAccess
(`privileges: []` dans capabilities.json — vérifié par Microsoft à la
certification). Toute solution « le visuel lit/écrit la liste SharePoint
lui-même » est donc disqualifiée d'office. C'est exactement le modèle des
« data comments » de Zebra BI : lecture par le modèle ; l'**écriture se fait
dans la source** (la liste SharePoint, le fichier Excel), et un
rafraîchissement du dataset ramène les nouveautés. Même famille de
contrainte que « pas de DAX dynamique » (CONTEXT.md §6) : on le documente
plainement au lieu de le promettre à tort.

### Écriture : les options réalistes

| Option | Latence | Effort |
| --- | --- | --- |
| Éditer la liste SharePoint (lien depuis le rapport) | au prochain refresh du dataset | nul |
| Formulaire Power Apps posé à côté du visuel dans le rapport | au prochain refresh du dataset | faible |
| Power Automate (bouton → création d'élément de liste) | idem | faible |

> Attention : le bouton « Actualiser » d'un rapport ne re-requête que le
> modèle déjà chargé — en mode import, un commentaire tout juste écrit dans
> SharePoint n'apparaît qu'après un **refresh du dataset** (planifié, ou
> déclenché par API comme ci-dessous).

Le refresh peut être planifié (jusqu'à 48×/jour en Premium) ou déclenché
via l'API REST par le flux qui écrit le commentaire — c'est l'architecture
« quasi temps réel » raisonnable.

## 2. Gestion des accès — identique au reste du rapport

Aucun mécanisme d'accès spécifique au visuel : la sécurité est **celle du
modèle**, ce qui est précisément ce qu'on veut.

- **Lecture côté consommateurs du rapport** : la table Commentaires est une
  table du modèle comme les autres — la **RLS** s'y applique. Relier
  Commentaires aux tables de dimension (Entité, BU…) suffit pour que les
  filtres RLS existants la restreignent ; pour des commentaires sensibles,
  ajouter une colonne `Audience` et une règle RLS dédiée
  (`[Audience] = "ALL" || [Audience] = LOOKUPVALUE(...)`).
- **Accès à la source au refresh** : c'est l'identité de connexion du
  dataset (compte de service / passerelle) qui lit la liste SharePoint —
  les permissions SharePoint des lecteurs du rapport ne sont **pas**
  évaluées à la lecture du rapport ; elles gouvernent qui peut **écrire**
  dans la liste. Résumé : *écrire = permissions SharePoint ; lire =
  RLS du modèle.*
- **Le visuel ne voit que le texte déjà autorisé** : le DataView reçu est
  post-RLS. Le visuel n'a ni identité, ni réseau, ni stockage — il ne peut
  pas fuiter davantage que ce que la page affiche déjà.

## 3. Mise en place côté modèle (pas à pas)

1. **La source.** Liste SharePoint avec au minimum : `CléLigne` (texte —
   la valeur EXACTE du membre de dimension commenté, p. ex. le nom de la
   ligne P&L), `Commentaire` (texte, balisage §5 autorisé), et
   optionnellement `Période`, `Scénario`, `Auteur`, `Audience`.
2. **Power Query.** `SharePoint.Tables(url)` (le connecteur des LISTES —
   `SharePoint.Contents` ne lit que les fichiers/bibliothèques) ou
   `OData.Feed` de la liste → table `Commentaires` ; pour la variante
   « fichier Excel sur SharePoint », `SharePoint.Files`/`Contents` +
   `Excel.Workbook`. Typage texte, trim, suppression des vides.
3. **Relation.** `Commentaires[CléLigne]` → `Dim[Membre]` (n:1, filtre de
   Dim vers Commentaires). Pour un commentaire par croisement
   ligne × période, une clé composée ou deux relations (dont une au besoin
   via `TREATAS` dans la mesure).
4. **La mesure texte.**

   ```dax
   Commentaire :=
   VAR t = CALCULATETABLE ( VALUES ( Commentaires[Commentaire] ) )
   RETURN CONCATENATEX ( t, Commentaires[Commentaire], " · " )
   ```

   `CONCATENATEX` plutôt que `SELECTEDVALUE` : aux niveaux agrégés
   (sous-totaux), plusieurs commentaires remontent — on les concatène au
   lieu de rendre BLANK. Pour ne commenter que les feuilles :
   `IF ( ISINSCOPE ( Dim[Membre] ), ... )`.
5. **Binding.** Glisser la mesure dans le puits **Commentaires** du visuel.
   C'est tout — pas de configuration réseau, rien à déployer.

## 4. Côté visuel — ce que fait Eclor Matrix

- **Rôle `comments`** (kind Measure) déclaré dans `capabilities.json`, dans
  le **même** `dataViewMappings.matrix` (3ᵉ entrée du `values.select`, même
  pattern que `tooltips` — ne JAMAIS ajouter un second objet de mapping,
  playbook §4.3.5).
- Les mesures `comments` sont **exclues des colonnes de la grille**
  (`renderLeafIdxs`) mais gardent leur `cellKey` DFS global — l'invariant
  cell-keys du visuel (voir CLAUDE.md) s'applique tel quel.
- **Trois surfaces d'affichage** :
  - *Marqueurs* (défaut) : pastille ● sur l'en-tête de ligne commentée,
    couleur paramétrable, texte en `title` + tooltip natif + aria-label ;
  - *Colonne inline* : dernière colonne de la grille (titre paramétrable),
    texte riche rendu, ellipse au-delà de 280 px (les lignes restent
    single-line — contrainte de la virtualisation) ;
  - *Panneau 💬* : liste des lignes commentées de la vue courante
    (plafonnée à 200 entrées), ouvert par la barre d'outils.
- **Carte de format « Commentaires »** : affichage, couleur du marqueur,
  gras / italique / souligné / couleur du texte (base), titre de colonne.
- **Haut contraste** : marqueur forcé à la couleur de premier plan du
  thème HC, couleurs inline ignorées.

## 5. Mise en forme des commentaires (balisage inline)

Les auteurs tapent dans SharePoint/Excel — le balisage est volontairement
minuscule et tolérant :

| Balise | Rendu |
| --- | --- |
| `**texte**` | **gras** |
| `*texte*` | *italique* |
| `__texte__` | souligné |
| `[#FF4D6D]texte[/#]` | couleur (hex 6 ou 3 digits, fermeture obligatoire) |

Règles, pensées « fidélité aux données d'abord » :

- `*italique*` et `__souligné__` ne s'ouvrent qu'en **début de mot**
  (précédés du début du texte, d'un espace ou d'une autre balise) —
  `2*3*4 = 24` et `MY__TABLE__NAME` restent donc littéraux, jamais
  corrompus ;
- `**gras**`, `*…*`, `__…__` non fermés = style jusqu'à la fin (tolérance
  assumée, les auteurs oublient) ;
- `[#hex]` ne devient une couleur que si son `[/#]` fermant existe — une
  référence de ticket `[#123]` sans fermeture reste littérale ;
- tag couleur mal formé = texte littéral ; jamais d'erreur ;
- le texte d'un commentaire est plafonné à **2000 caractères** (ellipse) —
  garde-fou contre les mesures DAX hostiles ou accidentelles.

La carte de format donne le style de **base**, le balisage le surcharge
localement. Le rendu est construit en `createElement`/`textContent`
**exclusivement** — aucune chaîne HTML, donc aucune surface d'injection,
quelle que soit la malveillance du texte source (certification,
CONTEXT.md §2).

## 6. API du module portable (`src/comments.ts`)

```ts
commentMeasureIndexes(valueSources): Set<number>
// mesures dont roles.comments === true (et pas values) — le rôle values
// gagne si une mesure est liée aux deux puits.

extractRowComments(rows, leaves, commentIdxs): RowComment[][]
// par ligne : textes non vides, dédupliqués, avec le libellé du groupe de
// colonnes (pathLabel) quand un arbre de colonnes existe.

parseCommentMarkup(text): CommentSegment[]
// segments plats { text, bold, italic, underline, color } — le moteur de
// rendu construit un <span> par segment.

plainCommentText(text): string
// balisage retiré — pour aria-labels, tooltips, titles.
```

Le module est **pur** (aucun import d'API Power BI, aucun DOM) : testable
en Node, portable dans n'importe quel visuel qui possède un modèle aplati
`rows × leaves` — sinon, seul `extractRowComments` est à adapter.

## 7. Checklist de portage sur un autre visuel custom

1. Copier `src/comments.ts` (et sa suite `test/comments.test.ts`).
2. `capabilities.json` : ajouter le dataRole `comments` (kind Measure) et
   l'entrée `{"for": {"in": "comments"}}` dans le `select` du mapping
   EXISTANT (jamais un second mapping).
3. Ajouter l'objet `comments` (show / display / markerColor / fontColor /
   bold / italic / underline / columnTitle) + la carte de format
   correspondante (copier `CommentsCardSettings` de `settings.ts`).
4. Exclure les mesures `comments` du rendu de valeurs du visuel (l'analogue
   local de `renderLeafIdxs`) **sans ré-indexer les clés de cellules**.
5. Brancher les trois surfaces (ou celles qui ont du sens pour le visuel) :
   marqueur, rendu inline via `parseCommentMarkup` → spans, panneau.
6. `plainCommentText` partout où du texte nu est requis (aria, tooltips).
7. Haut contraste : neutraliser les couleurs, garder gras/italique.
8. Localisation : `Visual_Comments`, `Visual_NoComments`,
   `Visual_MoreComments` et `Visual_Close` (fr + en).
9. Tests : reprendre les cas de `test/phase9.test.ts` (exclusion de
   colonnes, marqueurs, colonne inline, panneau, show=false, aucun binding).
10. Documentation utilisateur : pointer vers CE document ; ne jamais
    promettre d'écriture depuis le visuel.

## 8. Limites connues (et assumées)

- **Pas de writeback** depuis le visuel (certification) — l'écriture vit
  dans la source, voir §1.
- **Latence = cycle de refresh** du dataset.
- **Granularité** : un commentaire est porté par un croisement de filtres ;
  au niveau cellule précise (ligne × colonne × mesure), prévoir la clé
  composée côté modèle (§3.3).
- **Lignes single-line** : la colonne inline tronque avec ellipse (le texte
  complet est dans le title, le tooltip et le panneau) — ne pas passer les
  cellules en multi-ligne sans revisiter la virtualisation (CONTEXT.md §12).
- Les **lignes personnalisées** (customRows) n'ont pas de commentaires :
  elles n'existent pas dans le modèle, donc aucune clé ne peut les cibler —
  et l'extraction les ignore explicitement (leurs cellules formule aux
  ordinaux commentaires sont du bruit numérique, jamais des commentaires).
- Le **panneau** liste au plus 200 lignes commentées / 400 commentaires et
  l'indique (« … +N autres lignes commentées ») au-delà.

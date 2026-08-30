# Privacy Policy — Eclor Slicer

**Version 1.0 — Last updated: 2026-08-30**

> Version publique : https://eclor-data.github.io/privacy.html (anglais — à maintenir en sync avec ce fichier)

> 🇫🇷 Version française ci-dessous · 🇬🇧 English version below

---

## 🇫🇷 Politique de confidentialité (français)

### 1. Éditeur

`Eclor Slicer` (ci-après "le Visuel") est édité par **[ECLOR]** (ci-après "l'Éditeur").

- Adresse : *[à compléter]*
- Contact : contact@eclor-data.com
- Représentant légal : *[à compléter]*

### 2. Description du Visuel

Le Visuel est un *Power BI custom visual* distribué via Microsoft AppSource. Il s'exécute exclusivement à l'intérieur du *sandbox iframe* fourni par le hôte Power BI (Power BI Desktop, Power BI Service, Power BI Mobile, Power BI Embedded). Sa seule fonction est de **transformer en composant de filtrage (slicer) HTML les données déjà présentes dans le rapport Power BI de l'utilisateur**.

### 3. Engagement central : aucune collecte de données

**L'Éditeur n'a accès à aucune donnée du rapport, ni à aucune information sur l'utilisateur.** Aucune donnée n'est collectée, transmise, stockée, partagée, vendue ou louée à un tiers, par le Visuel ou par l'Éditeur, dans aucune circonstance.

Concrètement, le Visuel ne fait **aucun** des éléments suivants :

| # | Catégorie | Garantie |
|---|---|---|
| 1 | **Communication réseau sortante** | Aucun appel `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `Worker`, ni aucun chargement de ressource externe (CDN, image, script, font). |
| 2 | **Stockage persistant côté client** | Aucun usage de `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `Cache API`, `BroadcastChannel`. |
| 3 | **Télémétrie tierce** | Aucun SDK de type Google Analytics, Mixpanel, Amplitude, Sentry, Datadog, LogRocket, FullStory, Segment, ou équivalent. Aucun *tracker* ni *pixel*. |
| 4 | **Fingerprinting** | Aucune lecture de `navigator.userAgent`, `navigator.platform`, `navigator.languages`, `screen.*`, `Date.getTimezoneOffset()`, `WebGLRenderingContext`, `AudioContext`, `RTCPeerConnection`, ou de toute autre signature destinée à identifier l'utilisateur ou son équipement. |
| 5 | **Cookies** | Aucun cookie, premier ni tiers, n'est lu ni écrit par le Visuel. |
| 6 | **Export sortant** | Aucun appel à `host.exportContent`, `host.fileDownload`, `host.launchUrl`, ni à aucune autre API du hôte Power BI permettant de faire sortir des données du sandbox. |
| 7 | **Privilèges étendus** | Le manifeste `capabilities.json` déclare `"privileges": []` — le Visuel ne demande **aucun** privilège étendu (ni `WebAccess`, ni `ExportContent`, ni `LocalStorage`). |

### 4. Données du rapport

Les données du rapport Power BI sont reçues par le Visuel via l'API officielle Microsoft (`VisualUpdateOptions.dataViews`). Ces données sont **uniquement** :

- transformées en mémoire pour construire le modèle de rendu (`parseMatrix`),
- restituées sous forme d'éléments HTML (table) dans le DOM du sandbox iframe,
- affichées dans des info-bulles natives Power BI (`host.tooltipService.show/move/hide`).

Les données ne quittent **jamais** le sandbox iframe. Elles ne sont ni journalisées, ni sérialisées, ni transmises à un tiers. Elles restent **sous le contrôle exclusif de Microsoft** (au titre de l'opérateur Power BI) et de l'utilisateur (au titre du propriétaire du rapport).

### 5. Conformité RGPD / GDPR

L'Éditeur ne réalise **aucun traitement de données à caractère personnel** au sens de l'article 4(2) du RGPD via le Visuel. En conséquence :

- Aucun registre des activités de traitement (article 30 RGPD) n'est requis pour ce Visuel.
- Aucune base légale (article 6) n'a à être invoquée puisqu'il n'y a pas de traitement.
- Aucun *Data Processing Agreement* (DPA) entre l'Éditeur et l'utilisateur n'est nécessaire.
- L'Éditeur n'est ni *responsable de traitement*, ni *sous-traitant* au sens du RGPD pour les données affichées dans le Visuel.

L'utilisateur reste responsable de la conformité RGPD de son rapport Power BI dans son ensemble (qualité, durée de conservation, droits des personnes concernées). L'utilisation du Visuel n'altère pas cette responsabilité.

### 6. Sécurité

Le Visuel respecte les exigences de sécurité du Microsoft Power BI Custom Visual SDK :

- Aucun usage de `eval`, `new Function`, `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`.
- Toutes les valeurs textuelles d'origine utilisateur sont échappées avant injection dans les attributs ou textes SVG (`escapeXml`).
- Toutes les valeurs `ColorPicker` sont validées par expression régulière `^#[0-9a-fA-F]{3,6}$` avant injection.
- Le code est livré sous TypeScript strict (`strictNullChecks`, `noImplicitAny`).

### 7. Persistance des réglages

Les choix de mise en forme effectués par l'utilisateur dans le volet Format (couleurs, polices, sous-totaux, densité, unités d'affichage, etc.) sont **persistés par Power BI lui-même** dans la **définition du rapport** (fichier `.pbix`, ou artefact de rapport sur le service Power BI), via l'API officielle de persistance du hôte.

- Cette persistance est **gérée intégralement par Microsoft** ; le Visuel se contente d'écrire ces objets de configuration via l'API du hôte. Il n'écrit nulle part ailleurs.
- Ces réglages **ne sont jamais transmis à l'Éditeur ni à un tiers**, et ne contiennent **aucune donnée du rapport** — uniquement des préférences d'affichage.
- Lorsqu'un rapport est **publié sur le service Power BI**, ces réglages voyagent avec le rapport et restent dans le tenant Power BI de l'utilisateur, sous la gouvernance de Microsoft et de l'organisation de l'utilisateur. Le Visuel n'ajoute **aucun** stockage ni transfert supplémentaire.

### 8. Acquisition du Visuel via Microsoft AppSource

Le Visuel est distribué via Microsoft AppSource. Lors de son acquisition, **Microsoft — et non l'Éditeur** — collecte les informations décrites dans la [Déclaration de confidentialité Microsoft](https://privacy.microsoft.com/fr-fr/privacystatement).

Microsoft peut mettre à la disposition de l'Éditeur, via le Microsoft Partner Center, des **statistiques agrégées et non identifiantes** (nombre de téléchargements, notes). L'Éditeur les utilise uniquement pour comprendre l'adoption du Visuel. Elles ne contiennent aucune donnée de rapport et n'identifient aucun utilisateur.

### 9. Demandes de support

Si vous contactez l'Éditeur à contact@eclor-data.com, l'Éditeur traite les données personnelles que vous incluez volontairement dans votre message (typiquement : nom, adresse email, contenu de la demande) — dans le **seul but de vous répondre**.

- **Base légale** : intérêt légitime de l'Éditeur à répondre aux demandes (article 6(1)(f) RGPD).
- **Durée de conservation** : la correspondance est conservée le temps nécessaire au traitement de la demande et de ses suites, puis supprimée.
- **Aucun autre usage** : les emails de support ne sont jamais utilisés à des fins marketing, jamais ajoutés à une liste de diffusion, jamais partagés avec des tiers.

### 10. Le site web

Le site public (`eclor-data.github.io`) est un site statique : **aucun cookie**, **aucun script d'analyse ou de tracking**, **aucune ressource tierce**, aucun formulaire.

Il est hébergé par **GitHub Pages**, un service opéré par GitHub, Inc. Comme tout hébergeur, GitHub peut journaliser des données techniques telles que les adresses IP des visiteurs à des fins de sécurité et d'exploitation — voir la [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). L'Éditeur n'a pas accès à ces journaux.

Le site contient des liens vers des sites externes (Microsoft, GitHub) ; leurs pratiques de confidentialité leur sont propres et l'Éditeur n'en est pas responsable.

### 11. Vos droits

Pour le traitement limité décrit à la section 9, vous pouvez exercer vos droits RGPD — accès, rectification, effacement, limitation, opposition, portabilité — en écrivant à contact@eclor-data.com.

Vous pouvez également introduire une réclamation auprès de votre autorité de contrôle ; en France, la CNIL ([www.cnil.fr](https://www.cnil.fr)).

### 12. Vie privée des enfants

Ni le Visuel ni le site web ne collectent de données personnelles de quiconque — enfants compris. La boîte de support ne s'adresse pas aux enfants ; toute donnée personnelle d'enfant reçue par email sera supprimée sur demande.

### 13. Modifications

L'Éditeur peut mettre à jour cette politique. La version courante est toujours disponible à l'URL fournie dans la fiche AppSource du Visuel (https://eclor-data.github.io/privacy.html) et dans le fichier `docs/PRIVACY.md` du dépôt source. La date de "Last updated" en tête de document fait foi.

### 14. Contact

Pour toute question concernant cette politique : contact@eclor-data.com.

---

## 🇬🇧 Privacy Policy (English)

### 1. Publisher

`Eclor Slicer` (the "Visual") is published by **[ECLOR]** (the "Publisher").

- Address: *[to be completed]*
- Contact: contact@eclor-data.com
- Legal representative: *[to be completed]*

### 2. About the Visual

The Visual is a *Power BI custom visual* distributed through Microsoft AppSource. It runs exclusively inside the *sandbox iframe* provided by the Power BI host (Power BI Desktop, Power BI Service, Power BI Mobile, Power BI Embedded). Its sole function is to **render the data already present in the user's Power BI report as an HTML matrix table**.

### 3. Core commitment: no data collection

**The Publisher has access to no data from the report and no information about the user.** No data is collected, transmitted, stored, shared, sold, or rented to any third party — by the Visual or by the Publisher — under any circumstance.

In concrete terms, the Visual does **none** of the following:

| # | Category | Guarantee |
|---|---|---|
| 1 | **Outbound network traffic** | No `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `Worker`, nor any external resource load (CDN, image, script, font). |
| 2 | **Persistent client-side storage** | No use of `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `Cache API`, `BroadcastChannel`. |
| 3 | **Third-party telemetry** | No SDK such as Google Analytics, Mixpanel, Amplitude, Sentry, Datadog, LogRocket, FullStory, Segment, or equivalent. No tracker, no pixel. |
| 4 | **Fingerprinting** | No reading of `navigator.userAgent`, `navigator.platform`, `navigator.languages`, `screen.*`, `Date.getTimezoneOffset()`, `WebGLRenderingContext`, `AudioContext`, `RTCPeerConnection`, or any other signature intended to identify the user or their device. |
| 5 | **Cookies** | No cookie, first-party or third-party, is read or written by the Visual. |
| 6 | **Outbound export** | No call to `host.exportContent`, `host.fileDownload`, `host.launchUrl`, nor to any other Power BI host API that would let data leave the sandbox. |
| 7 | **Elevated privileges** | The manifest `capabilities.json` declares `"privileges": []` — the Visual requests **no** extended privilege (no `WebAccess`, no `ExportContent`, no `LocalStorage`). |

### 4. Report data

Power BI report data reaches the Visual through the official Microsoft API (`VisualUpdateOptions.dataViews`). That data is **only**:

- transformed in memory to build the render model (`parseMatrix`),
- rendered as HTML table nodes inside the sandbox iframe DOM,
- shown in native Power BI tooltips (`host.tooltipService.show/move/hide`).

The data **never** leaves the sandbox iframe. It is not logged, serialized, or transmitted to any third party. It remains **under the exclusive control of Microsoft** (as the operator of Power BI) and of the user (as the owner of the report).

### 5. GDPR compliance

The Publisher carries out **no processing of personal data** within the meaning of Article 4(2) GDPR through the Visual. As a result:

- No record of processing activities (Article 30 GDPR) is required for this Visual.
- No legal basis (Article 6) needs to be invoked, since there is no processing.
- No Data Processing Agreement (DPA) between the Publisher and the user is required.
- The Publisher is neither *controller* nor *processor* in the GDPR sense for the data displayed in the Visual.

The user remains responsible for the GDPR compliance of their Power BI report as a whole (data quality, retention, data-subject rights). Using the Visual does not change this responsibility.

### 6. Security

The Visual follows the Microsoft Power BI Custom Visual SDK security requirements:

- No use of `eval`, `new Function`, `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`.
- The DOM is built exclusively through the DOM API (`createElement`, `textContent`) — no HTML/SVG string injection.
- All `ColorPicker` values are validated against `^#[0-9a-fA-F]{3,6}$` before being injected.
- The code is shipped under strict TypeScript (`strictNullChecks`, `noImplicitAny`).

### 7. Settings persistence

The formatting choices the user makes in the Format pane (colors, fonts, subtotals, density, display units, etc.) are **persisted by Power BI itself** inside the **report definition** (the `.pbix` file, or the report artifact on the Power BI Service), through the host's official persistence API.

- This persistence is **handled entirely by Microsoft**; the Visual only writes these configuration objects via the host API. It writes nowhere else.
- These settings are **never transmitted to the Publisher or any third party**, and contain **no report data** — only display preferences.
- When a report is **published to the Power BI Service**, these settings travel with the report and stay within the user's Power BI tenant, under Microsoft's and the user's organization's governance. The Visual adds **no** extra storage or transfer.

### 8. Acquiring the Visual through Microsoft AppSource

The Visual is distributed through Microsoft AppSource. When you acquire it there, **Microsoft — not the Publisher** — collects the information described in the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

Microsoft may make **aggregated, non-identifying statistics** (such as download counts and ratings) available to the Publisher through the Microsoft Partner Center. The Publisher uses these statistics solely to understand how the Visual is adopted. They contain no report data and do not identify individual users.

### 9. Support requests

If you contact the Publisher at contact@eclor-data.com, the Publisher processes the personal data you voluntarily include in your message (typically your name, email address, and the content of your request) — for the **sole purpose of answering you**.

- **Legal basis:** the Publisher's legitimate interest in responding to enquiries (Article 6(1)(f) GDPR).
- **Retention:** correspondence is kept no longer than necessary to handle the request and any follow-up, then deleted.
- **No other use:** support emails are never used for marketing, never added to any mailing list, and never shared with third parties.

### 10. This website

The public website (`eclor-data.github.io`) is a static site. It sets **no cookies**, runs **no analytics or tracking script**, loads **no third-party resource**, and contains no form.

It is hosted by **GitHub Pages**, a service operated by GitHub, Inc. Like any web host, GitHub may log technical data such as visitor IP addresses for security and operational purposes, as described in the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The Publisher has no access to those logs.

The site contains links to external sites (Microsoft, GitHub). Their privacy practices are their own; the Publisher is not responsible for them.

### 11. Your rights

For the limited processing described in section 9, you may exercise your GDPR rights — access, rectification, erasure, restriction, objection and portability — by writing to contact@eclor-data.com.

You also have the right to lodge a complaint with your supervisory authority. In France, this is the CNIL ([www.cnil.fr](https://www.cnil.fr)).

### 12. Children's privacy

Neither the Visual nor this website collects personal data from anyone — children included. The support mailbox is not directed at children; any personal data of a child received by email will be deleted on request.

### 13. Changes

The Publisher may update this policy. The current version is always available at the URL provided in the Visual's AppSource listing (https://eclor-data.github.io/privacy.html) and in the `docs/PRIVACY.md` file of the source repository. The "Last updated" date at the top of this document is authoritative.

### 14. Contact

For any question regarding this policy: contact@eclor-data.com.

---

## AppSource listing snippet — copy/paste

> **🇫🇷 (à coller dans la fiche AppSource si la langue est le français)**
>
> Politique de confidentialité — Eclor Slicer ne collecte, ne transmet, ne stocke et ne partage **aucune donnée**. Le visuel s'exécute exclusivement dans le sandbox Power BI et n'effectue aucune communication réseau sortante, aucun stockage persistant, aucune télémétrie ni aucun fingerprinting. Aucun privilège étendu n'est demandé. Les données du rapport restent sous le contrôle exclusif de Microsoft et de l'utilisateur. Politique complète : https://eclor-data.github.io/privacy.html.

> **🇬🇧 (drop into the AppSource listing if English is used)**
>
> Privacy — Eclor Slicer collects, transmits, stores and shares **no data**. The visual runs entirely inside the Power BI sandbox and performs no outbound network traffic, no persistent storage, no telemetry, and no fingerprinting. No extended privilege is requested. Report data stays under the exclusive control of Microsoft and the user. Full policy: https://eclor-data.github.io/privacy.html.

---

## Audit trail (developer-only — not part of the published policy)

To be regenerated for eclor-matrix by the first /pbiviz-cert-audit run — the grep-based verification table from eclor-waterfall does not carry over claims across codebases.

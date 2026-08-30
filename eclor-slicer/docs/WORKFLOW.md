# Workflow pbiviz de A à Z — cadrage → certification → soumission

> Doc de référence du pipeline multi-agents pour visuels Power BI custom (copie eclor-slicer).
> Compagnon du playbook (`~/.claude/powerbi-visuals-playbook.md` / `<repo>/docs/CLAUDE_PLAYBOOK.md`).
> Créé 2026-07-25 après la certification d'eclor-slicer (première exécution complète du pipeline).

## Le pipeline

```
IDÉE
 ├─ 1. Cadrage (/pbiviz-scope, à créer)        → SPEC.md + CONTEXT.md + GO/NO-GO
 ├─ 2. Bootstrap Stage A (/pbiviz-bootstrap,   → squelette v0.1 conforme playbook §7
 │      à créer — en attendant : playbook §6/§7 à la main)
 │
 ├─ BOUCLE DEV (minutes, quotidienne)
 │    3. coder une feature (playbook §3 = patterns, §6 = snippets)
 │    4. "see" : ouvrir le test-report PBIP + screenshot + analyse
 │    5. /pbiviz-cert-fix mode DEBUG (symptôme → test rouge → fix → gate)
 │
 ├─ BOUCLE CERT (demi-journée par itération, dès que les features se stabilisent)
 │    6. /pbiviz-cert-audit         → audit/findings.json + rapport FR + captures
 │    7. /pbiviz-cert-fix           → outcomes fixed-claimed / needs-decision
 │    8. /pbiviz-cert-audit (incrémental) → PASS confirmés ou regressed
 │    └─ répéter jusqu'à 0 finding + file manuelle purgée
 │
 ├─ 9. Soumission Partner Center (/pbiviz-submit, à créer — manuel aujourd'hui :
 │      branche certification ff + CI verte + .pbiviz byte-identique + assets listing)
 │
 └─ 10. Retours reviewer Microsoft → convertis en findings EXT-* dans findings.json
        → retour étape 7. (Fait pour eclor : EXT-1180.2.3.1-a, hints & tips du sample.)
```

Principe qui tient tout : **méfiance mutuelle + artefacts comme contrats**. L'auditeur ne
corrige jamais ; le correcteur ne se note jamais (`fixed-claimed`, jamais PASS) ; seul un
re-audit transforme une claim en PASS. Le contrat = `audit/findings.json`
(schema `pbiviz-cert-audit/v1`, défini dans `pbiviz-cert-audit/references/report-format.md`).

## Les briques et où elles vivent

| Brique | Emplacement | Rôle |
|---|---|---|
| Playbook | `<repo>/docs/CLAUDE_PLAYBOOK.md` (+ fallback `~/.claude/powerbi-visuals-playbook.md`) | standards cert, patterns, leçons |
| Skill auditeur | `~/.claude/skills/pbiviz-cert-audit/` | 3 lanes (Static/Desktop/Browser), ~87 cas, itératif |
| — sa checklist | `…/references/checklist.md` | matrice IDs SEC/CAP/MAN/GATE/GEN/DATA/LIF/A11Y/HC/PERF/DESK/BROW/I18N |
| — le contrat | `…/references/report-format.md` | schéma findings.json + outcomes fixer |
| — ses scripts | `…/scripts/` : `pbi-drive.ps1`, `screenshot.ps1`, `click.ps1`, `browser-harness.mjs` | piloter PBI Desktop, capturer, cliquer, automatiser le service |
| Skill correcteur | `~/.claude/skills/pbiviz-cert-fix/` | rouge→vert par finding, modes CERT et DEBUG |
| Workspace projet | `<repo>/audit/` | test-report PBIP, findings.json, state.json, rapports FR, screens/, harnais browser local + scénarios |

## Setup

### Une fois par machine (fait sur celle-ci)
- Node + `pbiviz` (powerbi-visuals-tools), PBI Desktop (**noter le chemin exe** : ici
  `E:\bin\PBIDesktop.exe` — le trouver via `(Get-StartApps | Where Name -eq "Power BI Desktop").AppID`),
  Edge et/ou Chrome (Firefox optionnel : `npx playwright install firefox` dans `audit/`).
- Les deux skills dans `~/.claude/skills/`.

### Une fois par projet
1. Repo pbiviz avec `CLAUDE.md` projet + playbook committé.
2. **Premier `/pbiviz-cert-audit`** : bootstrap automatique — crée `audit/`, génère le
   test-report PBIP (tables scénarios DAX pures : nulls, négatifs, labels hostiles, 10k…),
   patch `.gitignore`. Pièges connus : table `Measures` = nom réservé Desktop ; une étape
   manuelle possible pour importer le .pbiviz dans le rapport.
3. **Débloquer la lane Browser** (une fois) :
   ```
   # publier audit/test-report sur app.powerbi.com (bouton Publish de Desktop)
   cd <repo>\audit
   npm init -y && npm i -D playwright        # si pas déjà fait
   node .\browser-harness.mjs --login        # se connecter dans la fenêtre ouverte
   # coller l'URL du rapport publié dans audit\browser.config.json
   ```

## Run

### Boucle dev (quotidienne)
- « Montre-moi ce que ça donne » → n'importe quelle session Claude réutilise les scripts :
  `pbi-drive.ps1 -Action open -File audit\test-report\test-report.pbip -Exe <exe>` puis
  `screenshot.ps1` + lecture du PNG.
- Bug ? → `/pbiviz-cert-fix` + description du symptôme (mode DEBUG).

### Boucle cert
```
/pbiviz-cert-audit          # full la 1re fois, incrémental ensuite (auto via state.json)
# → lire audit/report-<date>-itN.md (humain) ; audit/findings.json (machine)
/pbiviz-cert-fix            # traite les findings par sévérité, un commit par fix
/pbiviz-cert-audit          # re-test incrémental : confirme ou regressed
```
Règles de cadence : incrémental par défaut (ne re-teste que les non-PASS + ce que le diff
touche) ; full tous les ~5 runs et systématiquement avant une soumission. Les `needs-decision`
du correcteur remontent à l'humain — jamais tranchés par les agents.

### Soumission
Aujourd'hui manuel (Partner Center n'a pas d'API visuals) : audit 🟢 exigé, branche
`certification` fast-forwardée au commit soumis, CI verte, `.pbiviz` byte-identique,
assets listing (5 screenshots 1280×720, logo 300×300, sample avec **hints & tips** —
politique 1180.2.3.1, descriptions, privacy/EULA). `/pbiviz-submit` encapsulera ces
vérifications + runbook quand le besoin se représentera.

### Retours Microsoft
Chaque point du rapport reviewer devient un finding `EXT-<policy>-<lettre>` dans
findings.json (source externe, même cycle fix → re-audit → prochaine soumission).

## Mémoire du pipeline
- Verdicts et itérations : `audit/state.json` (resumable, mode incrémental).
- Leçons machine/runtime : section « Field notes » du SKILL.md auditeur.
- Statut projet : mémoire Claude (`project_eclor_waterfall.md` et fiches skills).

# Power BI Custom Visual Playbook

A portable field guide for building Power BI custom visuals (`.pbiviz`). Extracted from a Stage-C-hardened production visual after ~100 commits of cert-readiness work. Every pattern, bug fix, and snippet here is generic — copy into any new pbiviz project.

**How to use this document:**
- New project? Start with §0 (quick reference) then §1 (project stages) to scope the work.
- Adding a feature? Check §3 (architecture patterns) for the canonical shape.
- Hit a bug? Search §4 (lessons learned) — there's a good chance someone hit it already.
- Heading to AppSource? §2 (cert requirements) is your checklist.
- About to write code? §6 (reference snippets) has copy-paste-ready templates.

---

## 0. Quick reference

### 0.1 Decision tree at session start

```
Is `pbiviz.json` at repo root?
├── No → not a pbiviz project, ignore this playbook
└── Yes → load project's `CLAUDE.md`, then this playbook applies
        ├── Stage A only (private import) → §1.1 + §3 (architecture)
        ├── Stage B target (AppSource public) → §1.2 + §3 + §6
        └── Stage C target (Microsoft cert) → ALL sections apply
```

### 0.2 One-page checklist (any pbiviz, any stage)

- [ ] Constructor renders an empty placeholder into `target` (never visually blank before first `update()`)
- [ ] `update()` wrapped in try/catch with `eventService.renderingStarted/Finished/Failed`
- [ ] `update()` no-ops on `viewport.width <= 0 || viewport.height <= 0`
- [ ] `parseDataView` distinguishes `null` (transient/page-switch) from empty `ParseResult` (user-cleared)
- [ ] `lastValidRenderInput` cache + `renderFromInput` replay on null DataView
- [ ] `destroy()` clears caches + `target.replaceChildren()`
- [ ] No-category mode (measures only) is a tested branch
- [ ] fx slices have all three descriptors (`selector`, `altConstantSelector`, `instanceKind: ConstantOrRule`)
- [ ] fx persistence patch cascades through three locations: `firstRowObjects` → `metadata.objects` → `values[i].source.objects`
- [ ] Every `Group.name` and `Card.name` is globally unique (avoid PBI UID cache collisions)
- [ ] Every static slice has `displayNameKey` + a resjson entry in every locale; `pbiviz.json` `stringResources` populated
- [ ] `host.createLocalizationManager()` passed to `FormattingSettingsService`
- [ ] `column.source.format` (model format string) honoured by every label formatter
- [ ] Format parser strips `[…]` Excel bracket codes; handles `+;-;0`, parenthesised negatives, `%`, currency
- [ ] `displayUnits` and `decimals` use a scale-then-format pipeline (not "user override wins everything")
- [ ] Every interactive element has `tabindex="0"`, `role="button"`, enriched `aria-label`
- [ ] Keyboard handler: ←→↑↓, Home, End, Enter, Space, Esc, Ctrl/Shift+Enter (multi)
- [ ] Focus ring as SVG rect toggled via `:focus-visible` (never `outline:none` without alternative)
- [ ] `host.colorPalette.isHighContrast` overrides every user-picked colour
- [ ] Selection dispatcher implements click-twice-to-clear; used uniformly by mouse + keyboard + legend
- [ ] `host.allowInteractions` guards cross-filter calls (but keep visual feedback)
- [ ] Math invariants asserted in tests for every mode (Σ cells = bar.actual, etc.)
- [ ] Extract format/parser/layout logic to pure modules; Jest + jsdom + ts-jest harness
- [ ] CI runs `lint → tsc --noEmit → jest → pbiviz package` on push + PR

---

## 1. Project stages

The path from "I have an idea" to "Microsoft-certified" runs in three stages. Each adds requirements on top of the previous.

### 1.1 Stage A — Private import (minimum viable `.pbiviz`)

The minimum to package and let a user side-load via Power BI Desktop → "Import a visual from a file":

- `pbiviz.json` with `visual.{name, displayName, guid, visualClassName, version}`, `apiVersion`, `author`, `assets.icon`, `style`, `capabilities`
- `capabilities.json` with at least one `dataRole`, one `dataViewMappings` entry, and an `objects` block
- `src/visual.ts` exporting a `Visual` class implementing `IVisual` (`constructor`, `update`, optional `destroy`, optional `getFormattingModel`)
- `assets/icon.png` — **20×20 PNG**, RGBA/transparent background. This is the **Visualizations-pane icon** (Microsoft spec: exactly 20×20). Do NOT confuse it with the **300×300 AppSource commercial logo**, which is a separate Partner Center upload — a wrong-sized `assets/icon.png` renders blank in the pane
- `style/visual.less` (can be near-empty)
- `package.json` with `powerbi-visuals-tools` as a devDep and a `package` script (`pbiviz package`)
- `tsconfig.json` targeting ES2020 with DOM lib
- `npm run package` produces `dist/<name>.pbiviz`

That's it. Everything below is the road to AppSource and certification.

### 1.2 Stage B — AppSource public listing

Stack on top of Stage A:

**Partner Center / publisher setup**
- Microsoft Partner Center account (CSP or ISV), Power BI custom-visuals publisher onboarded
- Stable publisher email + support URL — same one in `pbiviz.json.supportUrl` and the listing

**Listing assets**
- Pane icon: `assets/icon.png` (20×20, referenced from manifest — the in-package icon)
- Commercial logo: 300×300 PNG uploaded in **Partner Center** (Offer listing) — this is the marketplace logo, NOT `assets/icon.png`
- Screenshots: 5 PNGs, 1280×720 or 1920×1080
- Short description (≤100 chars) + long description (≤1300 chars)
- Sample report: `sample/*.pbix` with the visual already bound to data, demonstrating each major mode/feature
- Promotional video (optional, but raises conversion)

**Privacy policy** — public URL, also vendored as `docs/PRIVACY.md`. The policy must explicitly cover:
1. Outbound network traffic (typically "none")
2. Persistent client storage ("none")
3. Third-party telemetry SDKs ("none")
4. Fingerprinting surfaces ("none")
5. Cookies ("none")
6. Outbound export host APIs ("none unless declared")
7. Elevated privileges declared in `capabilities.json` (state explicitly: `"privileges": []` is recommended)

**Terms of use / EULA** — required even if minimal; can be `LICENSE` (MIT/Apache) plus a short "AS-IS, no warranty" paragraph.

### 1.3 Stage C — Microsoft certification

This is where most submissions fail. The bar isn't "does it work"; the bar is **"could a hostile dataView crash it, leak data, or violate sandbox?"**. Concrete checklist in §2.

Additional repo-level requirements:
- **Public** GitHub repo
- A branch named **`certification`** (lowercase, mandatory)
- Code on `certification` must compile to a `.pbiviz` byte-identical to what you submit through Partner Center
- CI runs the same `lint → tsc → jest → pbiviz package` chain on `certification`
- `README.md` should document: what the visual does, install, develop, test, package — reviewers read it

---

## 2. Cert requirements (Stage C deep-dive)

### 2.1 Security constraints

Hard rules — any violation fails review:

- **No `eval`, `new Function`, `Function(…)(...)`** — `.eslintrc.json` enforces `no-eval`, `no-implied-eval`, `no-new-func` at `error` level
- **No `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML`** — the lint plugin `eslint-plugin-powerbi-visuals` ships the `no-inner-outer-html` rule (turned on via `plugin:powerbi-visuals/recommended`). Use the DOM API: `document.createElement`, `document.createElementNS(SVG_NS, …)`, `node.setAttribute(...)`
- **No external network calls** — no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `new Worker(...)`, no CDN `<script>`, no Google Fonts, no remote images
- **No client-side persistent storage** — `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches.*`, `BroadcastChannel` are all sandbox-blocked anyway, but reviewers grep for them. Use `host.persistProperties()` if you genuinely need to persist state in the report definition
- **Validate every `ColorPicker` value before injection** — see `safeHex` in §6.2
- **Escape every user-derived string** going into an SVG attribute or text node — see `escapeXml` in §6.1
- **If you build SVG as a string**, parse it via `new DOMParser().parseFromString(svgString, "image/svg+xml")` and `replaceChildren`. Reviewers accept this because the parser doesn't execute scripts. Pure DOM construction is even safer

### 2.2 TypeScript strictness

Copy these `tsconfig.json` settings verbatim:

```json
{
  "compilerOptions": {
    "allowJs": false,
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noEmitOnError": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "files": ["./src/visual.ts"]
}
```

Do NOT include `"types": ["node"]` — the sandbox is browser-only. Run `npx tsc --noEmit` in CI.

### 2.3 Performance budget

The published cert budget is **10 000 data points rendered in < 1 s**. Concretely:

- Raise `dataReductionAlgorithm.top.count` to **10000** in `capabilities.json` (default is 1000; pbiviz scaffold sets 200)
- Ship a `test/perf.test.ts` that materialises 10 000 synthetic categories, runs your parse + layout, and asserts `< 1000` ms. Aim for `~30 ms` (~33× margin) — that's the kind of headroom reviewers like to see
- Keep `update()` allocation-free in the hot path where possible: precompute scales, avoid per-bar `new Date()`, reuse arrays

### 2.4 Host services wiring

All instantiated in the constructor, **re-read** on every `update()` (locale/HC can flip without a fresh instance):

```ts
constructor(options: VisualConstructorOptions) {
  this.host = options.host;
  this.target = options.element;
  const localizationManager = options.host.createLocalizationManager();
  this.formattingSettingsService = new FormattingSettingsService(localizationManager);
  this.selectionManager = options.host.createSelectionManager();
  this.tooltipService = options.host.tooltipService;
  this.locale = options.host.locale || "en-US";
  this.allowInteractions =
    (options.host as any).hostCapabilities?.allowInteractions ?? true;
}
```

Inside `update()`:

```ts
public update(options: VisualUpdateOptions): void {
  const eventService = this.host.eventService;
  eventService?.renderingStarted(options);
  try {
    // ... full render pipeline ...
    eventService?.renderingFinished(options);
  } catch (e) {
    eventService?.renderingFailed(options, (e as Error)?.message ?? String(e));
  }
}
```

Reviewers look for:
- `renderingStarted/Finished/Failed` triple wired around `update()` (gating telemetry, export-to-PDF, etc.)
- `host.allowInteractions` honoured — skip `selectionManager.select()`, `tooltipService.show()` calls when `false`
- `host.createLocalizationManager()` passed to `FormattingSettingsService(...)` so resjson `displayNameKey` actually resolves
- `host.colorPalette` reads instead of hard-coded hexes
- `host.tooltipService` (native Power BI tooltips, not your own `<div>`)
- `host.createSelectionManager()` for cross-filter, with `Ctrl/Shift/Cmd+click` for multi-select and `selectionManager.showContextMenu(...)` for right-click

### 2.5 capabilities.json flags expected

The minimum cert-ready footer:

```json
"supportsHighlight": true,
"supportsLandingPage": true,
"supportsKeyboardFocus": true,
"supportsMultiVisualSelection": true,
"tooltips": {
  "supportedTypes": { "default": true, "canvas": true },
  "roles": ["actual", "tooltips"]
},
"sorting": { "default": {} },
"privileges": []
```

- **`supportsHighlight: true`** — when an external slicer cross-filters your visual, dataView arrives with `categorical.values[i].highlights[]` populated. Dim non-highlighted bars to ~35% opacity (don't drop them)
- **`supportsLandingPage: true`** — the host paints its native "Add data to this visual" overlay. Don't render your own onboarding screen; render nothing or a faded silhouette
- **`supportsKeyboardFocus: true`** + **`supportsMultiVisualSelection: true`** — these unlock features only if you actually implement them (see §2.8 a11y)
- **`privileges: []`** — declare zero unless you genuinely need `WebAccess` (allow-listed domains) or `ExportContent`. Each privilege you request adds review friction

Do NOT declare `supportsLocalization` — it's not in the 5.11 schema. Localization works through resjson + `displayNameKey` alone.

### 2.6 i18n (localization)

Mandatory for cert. Pattern:

1. `pbiviz.json` declares an array of locales:
   ```json
   "stringResources": [
     "stringResources/en-US/resources.resjson",
     "stringResources/fr-FR/resources.resjson"
   ]
   ```
2. Each resjson is flat key/value JSON. Convention: `Visual_<Card>` / `Visual_<Card>_<Property>`:
   ```json
   { "Visual_General": "General", "Visual_XAxis": "X axis" }
   ```
3. Every card/slice/enum item in `capabilities.json` and in the formatting model gets a `displayNameKey` pointing at one of those keys:
   ```json
   "general": { "displayName": "General", "displayNameKey": "Visual_General", "properties": { … } }
   ```
4. ARIA labels and tooltip text also route through `localizationManager.getDisplayName("Visual_Some_Key")` — never embed user-facing English literals in `src/`
5. Keys must be 1:1 mirrored between every locale. CI tip: add a Jest test that loads both resjsons and asserts `Object.keys(en).sort() === Object.keys(fr).sort()`

`en-US` is mandatory; one second locale (fr-FR, es-ES, de-DE, ja-JP, zh-CN…) is enough to satisfy the "i18n exists" criterion.

### 2.7 High-contrast mode

Read on every `update()`:

```ts
const palette = this.host.colorPalette as any;
this.isHighContrast = palette?.isHighContrast === true;
this.hcForeground = safeHex(palette?.foreground?.value, "#000000");
this.hcBackground = safeHex(palette?.background?.value, "#ffffff");
this.hcHyperlink  = safeHex(palette?.hyperlink?.value,  "#0078d4");
```

When `isHighContrast`:
- Override every user-picked fill with `hcForeground` (bars), `hcBackground` (canvas), `hcHyperlink` (selected/focused)
- Focus ring colour = `hcHyperlink`
- Strokes ≥ 1 px
- Test in Windows Settings → Accessibility → Contrast themes → Aquatic / Desert / Dusk / Night sky

Outside HC, do a luminance check on report background (`< 0.4` → assume dark theme) and auto-promote axis/label colours.

### 2.8 Accessibility (a11y)

- Every interactive element gets `role="button"`, `tabindex="0"`, and an `aria-label` resolved through the localization manager:
  ```html
  <g class="my-bar" tabindex="0" role="button" aria-label="Pillar Q1: $1.2 M" data-cat-idx="0">
  ```
- Root SVG gets `role="img"`, `aria-roledescription="<chart type>"`, `aria-label="<user altText OR generated summary>"`. Add `<title>` and `<desc>` children — NVDA/VoiceOver read these before bar-level labels
- Expose an "Alt text" Format-pane slice (with a generated fallback summarising category count, mode, measures) so the user can override
- Keyboard nav (single delegated `keydown` listener on `target`):
  - `Tab` / `Shift+Tab` — between focusable elements
  - `←` `→` `Home` `End` — move focus along bars
  - `Enter` / `Space` — select (with Ctrl/Shift for multi-select)
  - `Esc` — clear selection
- Visible focus ring. **Never** `outline: none` without an alternative — WCAG 2.4.7 violation. Use a custom dashed SVG `<rect class="focus-ring">` toggled via `:focus-visible` so mouse clicks don't trigger it (only keyboard nav does)
- **Enriched aria-labels** — a screen-reader user shouldn't have to tab through every cell to learn what a row contains. Embed the formatted total in the row's aria-label:
  - `"Region: EMEA, total 1.2K"` (not just `"Region: EMEA"`)
  - `"Pillar Q1 2026, $1.2M"` (kind + label + value)
- Tooltips must have a non-pointer trigger: focus reveals them too, not only hover

### 2.9 Visual.destroy()

The host may reconstruct on page switch. Implement `destroy()` even if it's tiny:

```ts
public destroy(): void {
  this.lastValidRenderInput = null;
  this.target.replaceChildren();
  // If you attached window-level listeners or timers, remove them here.
}
```

Drop cached render so a fresh visual instance starts clean. Don't unbind delegated handlers on `target` — the target element is being torn down too.

### 2.10 CI pipeline

`.github/workflows/ci.yml` template:

```yaml
name: CI
on:
  push: { branches: [main, certification] }
  pull_request: { branches: [main, certification] }
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test -- --ci --reporters=default
      - run: npx pbiviz package
      - uses: actions/upload-artifact@v4
        if: success()
        with:
          name: <visual-name>-pbiviz
          path: dist/*.pbiviz
          if-no-files-found: error
          retention-days: 30
```

Trigger on both `main` and `certification` branches.

### 2.11 Test patterns expected

Reviewers want "tests exist and run", not Karma specifically. Karma + `karma-typescript` is the legacy stack; **Jest + jsdom + ts-jest** is now equally accepted and far less brittle.

`jest.config.js` canonical setup:

```js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testRegex: "(/test/.*\\.test)\\.ts$",
  setupFiles: ["<rootDir>/test/_jest-setup.js"],
  moduleNameMapper: {
    "^powerbi-visuals-api$": "<rootDir>/test/_powerbi-stub.ts",
    "\\.(less|css|scss|sass)$": "<rootDir>/test/_style-stub.js"
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
    "^.+\\.js$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }]
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(powerbi-visuals-utils-formattingmodel|powerbi-visuals-utils-dataviewutils)/)"
  ]
};
```

Polyfills (`test/_jest-setup.js`) — jsdom < 22 lacks WebCrypto + TextEncoder:

```js
const { webcrypto } = require("node:crypto");
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
const { TextEncoder, TextDecoder } = require("node:util");
if (typeof globalThis.TextEncoder === "undefined") globalThis.TextEncoder = TextEncoder;
```

Mandatory test surfaces:
- `escapeXml` — all 5 entities + pass-through for safe strings
- Hex validation — accept `#abc`, `#aabbcc`, reject `red`, `#zzz`, `<script>`, empty, undefined
- Number formatting — display units (auto/k/M/B), decimal places, locale
- **Parser robustness** — NaN / Infinity / null / undefined in actuals, variances, sort orders, flags → coerced to safe defaults, never throw
- Layout edge cases — empty dataView, single category, all-zero values, all-negative, viewport < 100 px
- **Performance budget** — `test/perf.test.ts` materialises 10 000 categories and asserts `< 1 s`

Aim for 50+ tests across 8–10 suites.

### 2.12 GitHub repo for certification

- **Public** repo
- A branch named **`certification`** (lowercase, mandatory)
- Code on `certification` must compile to a `.pbiviz` byte-identical to what you submit through Partner Center
- CI runs the same chain on `certification`
- `README.md` documents what the visual does + install/develop/test/package

---

## 3. Architecture patterns

### 3.1 File structure

```
/
├── src/
│   ├── visual.ts        Main IVisual class + parse/layout/render orchestration
│   ├── settings.ts      FormattingSettingsModel + Card classes
│   ├── format.ts        Pure number/locale/format-string helpers
│   ├── tooltip.ts       Pure tooltip-payload builder (testable)
│   └── yRange.ts        Pure axis-range computation (testable)
├── style/visual.less    Container + hover + a11y CSS
├── test/
│   ├── _jest-setup.js          crypto + TextEncoder polyfills
│   ├── _powerbi-stub.ts        Minimal `powerbi-visuals-api` runtime shim
│   ├── _style-stub.js          `.less` import resolver
│   ├── format.test.ts
│   ├── formatting-model.test.ts
│   ├── scenarios.test.ts       parseDataView matrix
│   ├── tooltip.test.ts
│   ├── yRange.test.ts
│   └── perf.test.ts
├── tools/
│   ├── audit-render.mjs        Offline SVG → PNG render (no PBI Desktop)
│   └── generate-sample-csv.mjs Demo CSVs for the .pbix sample
├── stringResources/
│   ├── en-US/resources.resjson
│   └── fr-FR/resources.resjson
├── docs/PRIVACY.md
├── assets/icon.png
├── capabilities.json
├── pbiviz.json
├── jest.config.js
├── tsconfig.json        pbiviz build (single entry: src/visual.ts)
├── tsconfig.jest.json   tests (includes src/**/* + test/**/*)
├── package.json
├── CLAUDE.md            Operating manual for AI agents (this project)
├── CONTEXT.md           Design decisions / why
├── CHANGELOG.md         Keep-a-Changelog
└── README.md
```

**Flat `src/` works** when there are only ~5 modules. Deep folders (`utils/`, `data/`, `layout/`, `render/`) add zero discoverability and double the import-path noise. The split is **by purity, not by category**: `visual.ts` is the only stateful file; the other four are pure functions importable from anywhere (incl. tests) without touching `IVisualHost`.

### 3.2 Visual class skeleton

#### Constructor

```ts
constructor(options?: VisualConstructorOptions) {
  if (!options) throw new Error("Visual constructor: options were not provided by the host.");
  this.host = options.host;
  this.target = options.element;

  const localizationManager = options.host.createLocalizationManager();
  this.formattingSettingsService = new FormattingSettingsService(localizationManager);
  this.selectionManager = options.host.createSelectionManager();
  this.tooltipService = options.host.tooltipService;
  this.locale = options.host.locale || "en-US";
  this.allowInteractions = (options.host as any).hostCapabilities?.allowInteractions ?? true;
  this.target.classList.add("my-visual-root");

  // Attach delegated handlers ONCE — survives across SVG rewrites because
  // they live on `target`, not the SVG nodes.
  this.target.addEventListener("click", this.handleClick);
  this.target.addEventListener("contextmenu", this.handleContextMenu);
  this.target.addEventListener("mousemove", this.handleMouseMove);
  this.target.addEventListener("mouseleave", this.handleMouseLeave);
  this.target.addEventListener("keydown", this.handleKeydown);

  // Initial placeholder so the visual is never visually blank before update().
  this.renderEmpty("Select or drag fields to populate this visual");
}
```

Wire order: localization manager → FormattingSettingsService → SelectionManager → TooltipService → locale → interaction capability → delegated handlers → placeholder render.

#### `update()` pipeline

```ts
public update(options: VisualUpdateOptions): void {
  const eventService = this.host.eventService;
  eventService?.renderingStarted(options);
  try {
    const dataView = options.dataViews?.[0];
    this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
      VisualFormattingSettingsModel, dataView);

    // Re-read host-level capabilities every update (theme/HC/locale can flip).
    this.locale = this.host.locale || "en-US";
    const palette = this.host.colorPalette as any;
    this.isHighContrast = palette?.isHighContrast === true;
    // ... re-read every themed colour ...

    const { width, height } = options.viewport;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      eventService?.renderingFinished(options); return;
    }

    const parsed = this.parseDataView(dataView, defaultColor);

    // Two distinct empty branches with different semantics:
    if (!parsed) {
      // Page-switch transient: dv.categorical undefined. Replay last frame.
      if (this.lastValidRenderInput) {
        this.renderFromInput(this.lastValidRenderInput);
        eventService?.renderingFinished(options);
        return;
      }
      this.renderEmpty("...");
      eventService?.renderingFinished(options);
      return;
    }

    if (parsed.points.length === 0) {
      // User explicitly emptied buckets: drop caches + null lastValidRenderInput.
      this.lastValidRenderInput = null;
      this.cachedCategoryDisplay = [];
      this.renderEmpty("...");
      eventService?.renderingFinished(options);
      return;
    }

    const layout = this.computeLayout(parsed.points, internalMode);
    this.lastValidRenderInput = { layout, width, height, mode, userMode };
    this.renderFromInput(this.lastValidRenderInput);
    eventService?.renderingFinished(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eventService?.renderingFailed(options, message);
  }
}
```

The **two-branch empty handling** is the fix for the "ghost X-axis after dim removal" bug (see §4.1.2). Page-switch yields `dv.categorical === undefined` → null → replay. User-cleared yields a non-null `ParseResult` with `points.length === 0` → wipe caches + null `lastValidRenderInput`.

#### `destroy()`

```ts
public destroy(): void {
  this.lastValidRenderInput = null;
  this.target.replaceChildren();
}
```

Drop cached render so a fresh instance starts clean. Don't unbind delegated handlers on `target` — the target element is being torn down too.

#### Delegated handler pattern

```ts
private handleClick = (e: MouseEvent): void => {
  if (!this.allowInteractions) return;
  // Closest-with-data-attribute pattern — survives any SVG rewrite
  const node = (e.target as Element)?.closest?.("[data-cat-idx]") as Element | null;
  if (!node) {
    this.selectionManager.clear().then(() => this.applySelectionVisuals());
    return;
  }
  const catIdx = parseInt(node.getAttribute("data-cat-idx") || "-1", 10);
  const dp = this.cachedCategoryDisplay[catIdx];
  if (!dp?.selectionId) return;
  const multi = e.ctrlKey || e.metaKey;
  this.selectOrToggle(dp.selectionId, multi);
};
```

`data-cat-idx` (or analogous attribute) on each interactive `<g>` is the bridge from "DOM event" to "domain index". The handler uses `.closest()` so nested children (rects, text, focus rings) all bubble correctly.

### 3.3 Format pane patterns

#### Standard Card with slices

```ts
class GeneralCardSettings extends FormattingSettingsCard {
  mode = new formattingSettings.ItemDropdown({
    name: "mode",
    displayName: "Mode",
    items: [
      { value: "cumulative", displayName: "Cumulative" },
      { value: "comparison", displayName: "Comparison" }
    ],
    value: { value: "cumulative", displayName: "Cumulative" }
  });
  name: string = "general";
  displayName: string = "General";
  displayNameKey: string = "Visual_General";
  slices: FormattingSettingsSlice[] = [this.mode];
}
```

#### CompositeCard with sub-blocks

A `CompositeCard` exposes `groups` (collapsible sub-sections) instead of `slices` directly. Static groups are constructed up-front; dynamic per-data-row groups are appended in `getFormattingModel`.

```ts
class PillarsCardSettings extends formattingSettings.CompositeCard {
  showDataLabels = new formattingSettings.ToggleSwitch({ /* ... */ });
  pillarColor = makeFxColorPicker({ name: "pillarColor", displayName: "Pillar color",
    value: { value: "" } });
  generalGroup: formattingSettings.Group = new formattingSettings.Group({
    name: "pillarsGeneral",   // unique across the whole capabilities — see §4.2.3
    displayName: "General",
    slices: [this.showDataLabels, this.pillarColor]
  });
  groups: formattingSettings.Group[] = [this.generalGroup];
}
```

#### fx-enabled colour slice

The three magic descriptors that surface the **fx (conditional formatting) affordance** next to a colour picker:

```ts
function makeFxColorPicker(opts): formattingSettings.ColorPicker {
  const cp = new formattingSettings.ColorPicker(opts);
  cp.selector = dataViewWildcard.createDataViewWildcardSelector(
    dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
  );
  cp.instanceKind = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;
  return cp;
}
```

`altConstantSelector` is **intentionally omitted** for global slices (no per-row anchor); when the chosen constant should be scoped to a specific data point (e.g. per legend value, per measure), attach **after** construction:

```ts
itemColor.selector = dataViewWildcard.createDataViewWildcardSelector(/* ... */);
if (lv.selectionId) itemColor.altConstantSelector = lv.selectionId.getSelector();
itemColor.instanceKind = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;
```

⚠️ **Caveat** — see §4.2.1 / §4.2.2 for the fx-persistence cascade you must implement to make the picker survive Format-pane round-trips.

#### Dynamic Groups (per-row sub-blocks)

```ts
let selector: powerbi.data.Selector | undefined;
if (cat.identity) {
  selector = { data: [cat.identity] };          // per-row in normal mode
} else if (this.cachedIsNoCategoryMode && cat.selectionId) {
  selector = cat.selectionId.getSelector();     // per-measure in no-category mode
}
const toggle = new formattingSettings.ToggleSwitch({ name: "isPillar", value: cat.isPillar });
toggle.selector = selector;
this.formattingSettings.pillars.groups.push(new formattingSettings.Group({
  name: `cat_${cat.categoryIndex}`, displayName: cat.label, slices: [toggle]
}));
```

### 3.4 SVG rendering patterns

#### Pure DOM API (for lint-clean tree construction)

```ts
const SVG_NS = "http://www.w3.org/2000/svg";
const iconSvg = document.createElementNS(SVG_NS, "svg");
iconSvg.setAttribute("width", "14");
iconSvg.setAttribute("aria-hidden", "true");
const iconCircle = document.createElementNS(SVG_NS, "circle");
iconCircle.setAttribute("cx", "8");
iconCircle.setAttribute("fill", "none");
iconSvg.appendChild(iconCircle);
this.target.replaceChildren(iconSvg);
```

The PBI lint rule `powerbi-visuals/no-inner-outer-html` flags `innerHTML`. `createElementNS` + `setAttribute` is the safe path.

#### String SVG + DOMParser (for the hot path)

For the main chart, building a string then parsing once is faster than per-element `createElementNS` calls and still lint-clean (no `innerHTML` assignment):

```ts
const svgString = this.buildSVG(layout, width, height, mode, userMode);
const parsedSvg = new DOMParser().parseFromString(svgString, "image/svg+xml");
const svgEl = parsedSvg.documentElement;
if (!svgEl || svgEl.nodeName.toLowerCase() === "parsererror") return;
this.target.replaceChildren(svgEl);
this.applySelectionVisuals();
```

The DOMParser does not execute scripts and is reviewer-accepted.

#### escapeXml — every user-derived string

```ts
private escapeXml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

Use on **every** user-derived string injected into SVG strings (labels, tooltips, aria-labels). A category named `<A & B>` corrupts the SVG parser otherwise.

#### Hex validation before injection

```ts
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHORT_HEX_RE = /^#[0-9a-fA-F]{3}$/;
function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (HEX_RE.test(value) || SHORT_HEX_RE.test(value)) return value;
  return fallback;
}
```

Wrap every `ColorPicker.value.value` read with `safeHex(value, themedFallback)`. Empty strings, theme tokens, or stray whitespace all fall through to fallback so the SVG attribute always receives a syntactically valid colour.

#### Scale-then-format label pipeline

```ts
export function formatLabel(opts: {
  value, modelFormat, cardUnits, cardDecimals, autoDecimals, locale, dataMaxAbs, withSign?
}) {
  const isAutoUnits = !cardUnits || cardUnits === "auto";
  const hasModelFormat = !!modelFormat && modelFormat.length > 0;
  const respectFormatVerbatim = isAutoUnits && hasModelFormat;
  // "auto" + a model format ⇒ NO auto-scaling (avoids "5.00%K" or "$1.50M €")
  // getDisplayScale("auto", dataMaxAbs) derives the K/M/bn tier from magnitude.
  const scale = respectFormatVerbatim ? { scale: 1, suffix: "" }
              : getDisplayScale(cardUnits, dataMaxAbs);
  const scaledValue = value / scale.scale;
  let body = hasModelFormat
    ? formatVarianceValue(scaledValue, modelFormat, locale, cardDecimals > 0 ? cardDecimals : undefined)
    : scaledValue.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  body = body + scale.suffix;
  return withSign && value > 0 && !body.startsWith("+") ? "+" + body : body;
}
```

### 3.5 Pure layout helpers (testability)

Extract layout math into pure modules. Shape (`src/yRange.ts` template):

```ts
export interface YRangeItem { type, y0, y1, actualVal }
export interface YRangeOptions { maxVisual, minVisual, marginPct, yMinOffsetPct, userMode }
export interface YRangeResult { yMin, yMax, allPillarsPositive, allPillarsNegative }
export function computeYRange(items: YRangeItem[], opts: YRangeOptions): YRangeResult { /* ... */ }
```

Why this wins:
1. **No host coupling** — input is plain numbers, output is plain numbers. The test builds a synthetic input without ever touching a `dataView` or `IVisualHost`
2. **Captures domain rules in isolation** — a 4-line algorithm becomes untestable inside a 4000-line render function
3. **Regression tests are surgical** — each test is one assertion (`expect(result.yMin).toBeCloseTo(525, 1)`)

Every time you write a branch with conditional math inside `buildSVG`, ask "can I extract this into a pure helper?". The answer is yes for axis ranges, label scale picks, tooltip payloads, and any geometry computation that doesn't write to the DOM.

`src/tooltip.ts` follows the same shape: pure inputs (`TooltipBuildContext`), pure output (`VisualTooltipDataItem[]`).

### 3.6 Test architecture

#### Minimal `IVisualHost` mock

```ts
function makeMockHost() {
  return {
    createLocalizationManager: () => ({ getDisplayName: (k) => k }),
    createSelectionManager: () => ({
      select: () => Promise.resolve([]),
      hasSelection: () => false,
      getSelectionIds: () => [],
      clear: () => Promise.resolve(),
      showContextMenu: () => Promise.resolve()
    }),
    createSelectionIdBuilder: makeSelectionIdBuilder,
    colorPalette: { getColor: (k) => ({ value: hashToHex(k) }) },
    tooltipService: { enabled: () => true, show: () => {}, hide: () => {}, move: () => {} },
    eventService: { renderingStarted: () => {}, renderingFinished: () => {}, renderingFailed: () => {} },
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    displayWarningIcon: () => {}
  };
}
```

#### Construct the Visual + bypass private

```ts
function makeVisual() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const v = new Visual({ host: makeMockHost(), element: target } as any);
  (v as any).formattingSettings = new VisualFormattingSettingsModel(); // bypass populate
  return v;
}
function parse(v: any, dv: unknown) { return v.parseDataView(dv, "#cccccc"); }
```

#### Test taxonomy

- **Parser tests** — every DataView shape combination → assert `ParseResult` structural integrity. Catches the ghost-frame class of bugs (§4.1.2)
- **Format-model populate/read** — instantiate model, populate from fake `dataView.metadata.objects`, assert slice values + descriptor triplets (`instanceKind`, `selector`)
- **Pure-helper tests** — direct call, plain assertions
- **Performance budget** — materialise 10 000 categories, assert `< 1 s`

### 3.7 Tooling worth keeping

#### `tools/generate-sample-csv.mjs`

Generates hand-tuned CSVs (typically: one cumulative-mode dataset, one comparison-with-legend dataset) so the sample `.pbix` always demos the visual against deterministic, visually-pleasant data. Run via `node tools/generate-sample-csv.mjs`. The constants at the top double as documentation for "the canonical use case".

#### `tools/audit-render.mjs`

Replicates `buildSVG`'s geometry for a representative scenario and writes `audit-render.svg` (always) plus `audit-render.png` when the optional `@resvg/resvg-js` is installed (one-off `npm i -D @resvg/resvg-js` — keep native-binary packages out of the committed devDependencies so `npm ci` stays lean). Lets you eyeball geometry tweaks **outside Power BI Desktop** — no pbiviz reload cycle, no `.pbix` open, no theme noise. Useful any time you change pixel-budget constants.

---

## 4. Lessons learned (portable bug fixes)

### 4.1 Host lifecycle

#### 4.1.1 Page-switch blank — target wiped while hidden

**Problem:** Switching report pages in PBI Desktop and switching back renders an empty visual until the user touches a filter.

**Generic lesson:** PBI Desktop may clear your `target` element during the hide phase of a page-switch and fire `update()` with a partial/null DataView when the page becomes visible again. A "render-only-when-data-arrives" pipeline leaves `target` blank.

The robust fix is a three-layer pattern:
1. **Constructor placeholder** — render a minimal empty SVG into `target` immediately so it's never visually empty before the first `update()`
2. **Cache the last successful render input** (`{ layout, width, height, mode }`) on the instance
3. **Replay-from-cache on `update()`** when the DataView is null/partial. Re-build the SVG from cached inputs using **current** formatting settings

**Symptom:** Visual goes blank on page-switch. F5 / refresh fixes it. Native PBI charts don't do this — they make the same trade-off (sticky last frame).

**Detection:** A jsdom test that calls `update()` with a valid DataView, then immediately with `{ ...options, dataViews: [] }`, then asserts `target.querySelector('svg')` still has content.

#### 4.1.2 The ghost frame — null DataView ≠ user-cleared DataView

**Problem:** After enabling the replay-from-cache fix (4.1.1), removing the Category bucket leaves the previous chart on screen forever — "ghost X-axis".

**Generic lesson:** Your `parseDataView()` returns `null` for **multiple** distinct user states (page-switch, empty buckets, filter eliminates all rows). The cache-replay branch then replays a stale frame even when the user explicitly emptied the buckets.

Distinguish at the parser:
- `dv.categorical === undefined` → **page-switch signal** → return `null` → replay cache
- Buckets empty / no rows → return a **well-formed empty result** (`buildEmptyParseResult()`) → `update()` drops caches + shows empty banner

```ts
if (!dv?.categorical) return null;              // genuine page-switch
const cats = dv.categorical.categories || [];
const vals = dv.categorical.values || [];
if (cats.length === 0 && vals.length === 0)
  return this.buildEmptyParseResult();          // user-cleared
if (actualCols.length === 0)
  return this.buildEmptyParseResult();          // no measure bound
```

Also **clear `lastValidRenderInput`** in the layout-failure branch — otherwise the next empty update resurrects a "good" frame on top of your error banner.

**Detection:** Unit test the parser: `expect(parse(undefined)).toBeNull()` vs `expect(parse({categorical:{categories:[],values:[]}}).points).toHaveLength(0)`.

#### 4.1.3 Viewport collapses to 0×0

**Problem:** During page transitions, `update()` may fire with `viewport.width === 0`.

**Generic lesson:** Guard the whole pipeline (do not `replaceChildren()`) when the viewport is degenerate. Let the previous frame stay on screen until PBI fires a real-sized update.

**Detection:** Assert your visual no-ops on `viewport.width === 0 || viewport.height === 0`.

#### 4.1.4 Constructor callback leaks across rebinds

**Problem:** Async work registered in the constructor (license check, network calls, observers) accumulates with each rebind and tries to mutate detached DOM nodes.

**Generic lesson:** Implement `destroy()` and unsubscribe from every observable / clear every cache. PBI rebinds the visual on report-level changes; callbacks scoped to the previous instance must die there.

**Detection:** In a test, instantiate → `destroy()` → instantiate again → assert your subscriber count didn't grow.

### 4.2 Format pane gotchas

#### 4.2.1 fx ColorPicker reverts to theme default in the Format pane

**Problem:** User picks a non-default constant colour on an fx-enabled slice. The chart renders it, but the Format pane picker snaps back to the theme colour.

**Generic lesson:** With `selector: dataViewWildcard` + `instanceKind: ConstantOrRule` and **no** `altConstantSelector`, PBI persists the constant on `categorical.categories[0].objects[i].<obj>.<prop>` instead of `metadata.objects.<obj>.<prop>`. `populateFormattingSettingsModel` reads `metadata.objects` and sees nothing → `applyThemeDefault` overwrites the picker.

Fix: after `applyThemeDefault`, manually patch the slice value by reading the first row's persisted Fill.

```ts
const firstRowObjects = dv?.categorical?.categories?.[0]?.objects?.[0];
const patchFx = (slice, objName, propName) => {
  const persisted = extractFill(firstRowObjects?.[objName]?.[propName]);
  if (persisted) slice.value = { value: persisted };
};
patchFx(fs.bridges.colorBridge, "bridges", "colorBridge");
```

**Detection:** Manual — enable fx slice as plain constant → pick red → close/reopen Format pane → verify picker still shows red.

#### 4.2.2 fx values lost in no-category mode (measures-only)

**Problem:** Same fx ColorPicker that works with a dim breaks when only measures are bound — the chart silently falls back to the theme default.

**Generic lesson:** When no category column exists, PBI has nowhere to persist a per-row constant. It chooses from **three** candidate slots depending on mode and selector. Your patch must cascade:

```ts
// Order matters: first valid hex wins.
let persisted = extractFill(firstRowObjects?.[obj]?.[prop]);          // with-dim
if (!persisted) persisted = extractFill(rootObjects?.[obj]?.[prop]);  // metadata.objects
if (!persisted) {
  for (const vso of valueSourceObjectsArr) {                          // values[i].source.objects
    const v = extractFill(vso?.[obj]?.[prop]);
    if (v) { persisted = v; break; }
  }
}
```

**Detection:** Test with `categorical.categories = undefined` + `categorical.values = [...]` + the same fx slice values — assert the chart renders the picked colour.

#### 4.2.3 Sub-block UID collisions across CompositeCards

**Problem:** User sees the wrong card's slices leaking into another card's "General" sub-block.

**Generic lesson:** PBI caches Format-pane state by an internal UID derived from `Group.name`. Two CompositeCards both using `name: "general"` produce `general-group` UID collisions. Rename internal `name` keys to be **unique across the whole capabilities** (e.g., `bridgesGeneral`, `pillarsGeneral`); keep `displayName: "General"` so the user-visible label is unchanged.

```ts
// Bad — collides with any other card using "general"
new formattingSettings.Group({ name: "general", displayName: "General", ... })
// Good — unique internal key, same user label
new formattingSettings.Group({ name: "bridgesGeneral", displayName: "General", ... })
```

**Detection:** A formattingModel snapshot test that asserts every `Group.name` and `Card.name` is globally unique.

#### 4.2.4 fx-on-TextInput — needs the full descriptor triplet

**Problem:** Trying to expose the fx affordance on a TextInput (so users can wire a measure to a text label). Microsoft docs say "color only", but the API surface is exposed uniformly.

**Generic lesson:** Set **all three** descriptors on the slice:

```ts
tx.selector = dataViewWildcard.createDataViewWildcardSelector(
  dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals);
tx.altConstantSelector = /* same wildcard */;   // critical — without it
                                                 // the shell may refuse to
                                                 // render an fx affordance
                                                 // because it has no place
                                                 // to persist the constant
tx.instanceKind = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;
```

Zero risk: if the shell doesn't honour fx for the slice type, it falls back to a plain TextInput.

**Detection:** Build, sideload, manually verify the fx button appears next to the field.

#### 4.2.5 Cap is for the host, not for you

**Problem:** Adding a static slice without a `displayNameKey` and resjson entry → label appears in English regardless of locale.

**Generic lesson:** Two parallel registries must agree: `capabilities.json` objects (with `displayName` + `displayNameKey`) AND `src/settings.ts` cards (with the same `displayNameKey`). Either one missing the key → no translation. `host.createLocalizationManager()` must be passed to `FormattingSettingsService`.

`pbiviz.json` also needs `stringResources` to reference your resjson files. An empty array means **all** keys silently fall through to displayName.

**Detection:** A pre-commit script that loads every resjson, then greps `displayNameKey:` mentions in TS and `displayNameKey":` in capabilities.json and asserts the key sets match.

### 4.3 Data binding edge cases

#### 4.3.1 The over-strict early return

**Problem:** A `if (!dv?.categorical?.categories) return null` pattern looks defensive but rejects the legitimate "measures-only" DataView shape PBI sends when no dim is bound.

**Generic lesson:** `categories` is `undefined` whenever no column is bound to a categorical role — measures-only mode is a real, supported state. The correct gate is:

```ts
if (!dv?.categorical) return null;
const cats = dv.categorical.categories || [];
const vals = dv.categorical.values || [];
if (cats.length === 0 && vals.length === 0) return buildEmpty();
```

Also handle `if (!categoryColumn) return this.parseNoCategory(...)` — render the N measures as the X-axis ticks.

**Detection:** A "DataView shape coverage" test matrix: every combination of (categories: present/empty/undef) × (values: present/empty/undef) × (highlights: present/absent) should produce a deterministic ParseResult, not a `null`.

#### 4.3.2 Role iteration — measures dropped into multiple roles

**Problem:** A measure dropped into both `actual` and `variance` roles is only seen as `actual`.

**Generic lesson:** Iterate **every** role flag on `column.source.roles`, not just the first key. A single column instance can fan out to multiple internal roles.

```ts
for (const role of Object.keys(col.source.roles || {})) {
  if (col.source.roles[role]) bucket[role].push(col);
}
```

**Detection:** Test — bind one measure to two roles via the unit-test DataView builder, assert both buckets contain it.

#### 4.3.3 Internal mode vs user mode — don't trust `userMode` in the renderer

**Problem:** User picks "comparison" but data only has 2 measures-only / no dim → renderer's comparison branch hardcodes "first+last = pillars, everything else = bridge" and ignores per-point flags.

**Generic lesson:** Keep the user's `mode` setting as a high-level intent; **route internally** to one of a small set of layout primitives. Edge cases (no-category + comparison, comparison with M < 2) become "force internal cumulative" routing decisions, not branches inside the layout engine.

```ts
let internalMode = userMode;
if (userMode === "comparison" && isNoCategoryMode) internalMode = "cumulative";
const layout = computeLayout(points, internalMode);
```

**Detection:** Mode × DataView shape compatibility matrix as a test grid.

#### 4.3.4 `supportsHighlight` semantics

**Problem:** Selecting a bar dims others — but only when the dataset has highlight metadata.

**Generic lesson:** Set `supportsHighlight: true` in `capabilities.json`, then read `values[i].highlights` in `parseDataView`. Highlight arrays are sparse (null = excluded). Store `highlightedCatIdxs: Set<number> | null` — `null` means "no active highlight, render all at 100%".

**Detection:** Test with highlights array including nulls, assert dimmed-categories set matches.

#### 4.3.5 Multiple `dataViewMappings` are ALTERNATIVES — never simultaneous queries

**Problem:** Needing the same data at two grains (e.g. leaf rows AND a per-category aggregate), a second `dataViewMappings` object referencing the same roles looks like the way to get a second query. It isn't: the host either picks ONE mapping via `conditions`, or — when both match — the query generator can crash outright (`TypeError ... reading 'additionalProjections'` in `QueryGenerator.rewriteQuery`), killing the visual entirely.

**Generic lesson:** One query per visual, period ("Each valid mapping will produce a DataView, but currently we only support performing one query per visual" — the docs' own fine print). Facets co-resident in one mapping (`categorical` + `matrix`) share that single query and therefore its grain. The only host-computed coarser grain available to a visual is the **Total/SubTotal API** on a matrix mapping (see 4.3.6). A non-additive measure (ratio) at a coarser grain can NEVER be reconstructed client-side from leaves.

**Detection:** Any capabilities change touching `dataViewMappings` must be runtime-smoke-tested in PBI Desktop before committing — the crash happens in the host's query generator, invisible to jest.

#### 4.3.6 Total/SubTotal API — an incomplete `subtotals` block disables the WHOLE API, silently

**Problem:** A matrix-mapped visual declares `subtotals` in capabilities with sensible-looking switches, yet the engine ships ZERO `isSubtotal` nodes — not even a grand total. Nothing errors, nothing logs; every downstream consumer silently takes its fallback path.

**Generic lesson:** Two contract details, both from the official doc/sample and both easy to miss:
1. *"The API is automatically enabled for a visual whenever the subtotals structure and **all switch mappings** are defined."* ALL means all six: `rowSubtotals`, `rowSubtotalsPerLevel`, `columnSubtotals`, `columnSubtotalsPerLevel`, `levelSubtotalEnabled`, (`rowSubtotalsType` optional, API 5.1+). Omitting one (e.g. `columnSubtotalsPerLevel` — even if the mapping has no `columns` select!) keeps the whole API dormant. Every referenced `propertyName` must also exist in the `objects` section.
2. `rowSubtotalsPerLevel` should default `false` unless the format pane actually exposes and persists per-level toggles: `true` routes the decision through per-field properties that a visual not enumerating them never persists. `false` lets the global `rowSubtotals: true` default drive the query ROLLUP directly.

Reference shape (matches the sampleMatrix visual): defaults `rowSubtotals: true`, `rowSubtotalsPerLevel: false`, `columnSubtotals: false`*, `columnSubtotalsPerLevel: false`, `levelSubtotalEnabled: true`, `rowSubtotalsType: "Top"`. (*true if the visual actually uses column subtotals.)

**Detection:** the failure is runtime-only and silent — jest stubs can't catch it. Ship a dev-only on-screen dump of `matrix.rows.root` (node count, `isSubtotal` children, their cell values) behind a format-pane toggle and check it in PBI Desktop: with the API active you must see one `isSubtotal` child per group node (or a root-level grand total). If group nodes show `subChild=none` everywhere, the capabilities contract is broken — not the reader code.

### 4.4 Number formatting / display units

#### 4.4.1 Respect the model format on every label

**Problem:** Changing "Format de données" on the measure in the PBI model has no effect on the visual's labels.

**Generic lesson:** Read `column.source.format` (Excel-style format string set in the model) and pipe it through your label formatter. Precedence:
1. User override on the card (`displayUnits ≠ "auto"` or `decimals > 0`) wins
2. Model format string (`column.source.format`) — Currency, %, custom
3. Auto fallback (Y-axis-derived scale + 0 decimals)

`$#,##0` should render `$1,234`, `0%` should render `42.5%`, etc.

**Detection:** Unit test the formatter with each common model format string.

#### 4.4.2 Scale-then-format pipeline — `displayUnits=None` keeps the format

**Problem:** Setting `Display units = None` on a card was meant to **respect** the model format; instead the format was dropped entirely.

**Generic lesson:** Display-units pick the **divisor + suffix** (1, K, M, bn) but don't override the format string. The pipeline is four ordered stages:

```
1. SCALE   — displayUnits → { scale, suffix }. "none" = {1, ""}; "auto"
             inherits from Y axis or variance magnitude.
2. FORMAT  — apply model format to the SCALED value (with decimal override).
3. APPEND  — concatenate the unit suffix.
4. PREFIX  — "+" for variances/bridges if not already in body.
```

So Currency + `displayUnits=None` produces `$1,234,567`; `displayUnits=Millions, decimals=1` produces `$1.2M`.

**Detection:** Unit test the 4-stage pipeline with each `(unit, modelFormat)` combination.

#### 4.4.3 Three real bugs in Excel format-string parsing

**Problem:** Custom formats render gibberish like `5.00%K`, `[Red]+5.00%`, `-(1,234)`.

**Generic lessons (three bugs, each common):**

1. **Auto-scale collides with format suffix.** When `displayUnits = "auto"` AND a model format is present, **respect the format verbatim** — do not append your own K/M/bn (format already has its own suffix like `%`, `€`, `$`)
2. **Strip Excel bracket codes.** Patterns like `[Red]+5.00%` or `[$-409]` leak literally into labels. Pre-strip with `formatStr.replace(/\[[^\]]*\]/g, "")` before parsing
3. **Parenthesised-negative double-marks the sign.** Format `+#,##0;(#,##0);0` for `-1234` produces `-(1,234)` because the parser prepends `-` and the pattern also wraps in parens. Detect `prefix.endsWith("(") && suffix.startsWith(")")` and skip the sign prepend

**Detection:** Extract the parser to its own module (e.g. `src/format.ts`) and write unit tests for each format-string family.

### 4.5 Selection / interaction

#### 4.5.1 Native click-twice-to-clear toggle

**Problem:** Clicking the same selected bar a second time is a no-op. Users expect it to release the cross-filter (native PBI behaviour).

**Generic lesson:** Centralise selection in a single dispatcher that recognises "single-click on the already-sole selection → clear":

```ts
private isAlreadySelected(target: ISelectionId | ISelectionId[]): boolean {
  const current = this.selectionManager.getSelectionIds();
  if (current.length === 0) return false;
  const targets = Array.isArray(target) ? target : [target];
  if (current.length !== targets.length) return false;
  return targets.every(t => current.some(c => c.equals(t)));
}
private selectOrToggle(target, multi: boolean) {
  if (!multi && this.isAlreadySelected(target)) {
    this.selectionManager.clear().then(() => this.applySelectionVisuals());
    return;
  }
  this.selectionManager.select(target, multi).then(() => this.applySelectionVisuals());
}
```

Wire it through **every** selection path (bar click, legend click, keyboard Enter/Space). Identical UX or users notice.

**Detection:** Stateful mock of `SelectionManager.getSelectionIds()` in tests. Drive a sequence of clicks and assert toggle behaviour.

#### 4.5.2 `allowInteractions` guard

**Generic lesson:** Read `host.allowInteractions` once per `update()`. Skip cross-filter logic when false — but **keep** the visual feedback (cursor, hover, focus ring) so the chart still feels alive. This is the "view-only" mode used when the visual is embedded in dashboards.

**Detection:** Toggle `allowInteractions` in a mock host, click a bar, assert `selectionManager.select` was not called.

### 4.6 Accessibility hardening

#### 4.6.1 SVG aria scaffolding

Set on the root `<svg>`:
```
aria-roledescription="<chart type>"
aria-label="<user altText OR generated summary>"
```
Add `<title>` and `<desc>` children — NVDA/VoiceOver read these before bar-level labels.

Expose an "Alt text" Format-pane slice (with a generated fallback summarising category count, mode, measures) so the user can override.

#### 4.6.2 Keyboard navigation pattern

Every interactive element needs:
```
tabindex="0"  role="button"  aria-label="…"  data-<idx>="…"
```

Delegate keydown on `target`. For each interactive element class:
- **↑↓ ←→** — move focus prev/next with wrap-around
- **Home / End** — first / last
- **Enter / Space** — activate (cross-filter via `selectOrToggle`)
- **Esc** — clear selection
- **Ctrl/Shift + Enter** — multi-select

**Detection:** Unit test asserting every `tabindex="0"` element appears in a keydown branch.

#### 4.6.3 Focus ring — never `outline:none` without an alternative (WCAG 2.4.7)

**Problem:** SVG `<g>` elements get an ugly browser focus outline; setting `outline: none` to hide it removes the visible focus indicator — a WCAG 2.4.7 violation.

**Generic lesson:** Replace the native outline with a dashed `<rect class="focus-ring">` inside each interactive group, hidden by default, shown via `:focus-visible`:

```less
.my-bar:focus-visible .focus-ring,
.my-row:focus-visible .focus-ring { opacity: 1; }
```

Match the focus ring stroke colour to the host's `hyperlink` colour in **high-contrast mode**.

#### 4.6.4 High-contrast mode (HC)

**Generic lesson:** Read `host.colorPalette.isHighContrast` every update. When true, **override every visual colour** with the host's `foreground` / `background` / `foregroundSelected` / `hyperlink` — user picks are ignored to comply with forced-color OS themes.

**Detection:** Force `isHighContrast: true` in your mock host; snapshot the SVG colours and assert no user-picked hex leaks through.

#### 4.6.5 Enriched aria-labels — first focus must be useful

**Generic lesson:** A screen-reader user shouldn't have to tab through every cell to learn what a row contains. Embed the formatted total in the row's aria-label:
- `"Region: EMEA, total 1.2K"` (not just `"Region: EMEA"`)
- `"Legend value: EMEA"`
- `"Pillar Q1 2026, $1.2M"` (kind + label + value)

#### 4.6.6 Localization (cert requirement)

Cert sprint blockers:
- `pbiviz.json` → `stringResources: ["stringResources/en-US/resources.resjson", ...]` must be populated (empty array = no translation)
- `host.createLocalizationManager()` instantiated and passed to `FormattingSettingsService`
- Every static card + capabilities object carries a `displayNameKey`
- **Prune resjson aggressively** — obsolete keys (referencing removed features) are warnings and clutter the audit

#### 4.6.7 `host.displayWarningIcon`

Use for user-actionable conditions: data reduction cap hit (≥ 10000 rows), expired license, configuration mismatch. The native PBI warning icon appears in the visual header.

### 4.7 Math / rendering invariants

#### 4.7.1 Σ cells = bar total

**Problem:** A footnote/analysis table below the chart sums per-row breakdowns; cells should sum to the bar value above. In a complex layout (comparison mode, M ≥ 3 measures, N categories), intermediate columns drift.

**Generic lesson:** When your layout multiplexes multiple measures × multiple categories into a flat column array, the column-index mapping is the bug source. Make the mapping explicit:

```
For M measures, N original cats, the synth layout has M + (M-1)·N cols,
structured as (M-1) blocks of (1 pillar + N bridges) + 1 trailing pillar.
  blockSize = 1 + N
  col % blockSize === 0 → pillar for measure (col / blockSize)
  else → bridge: k = ⌊col / blockSize⌋ (measure transition k → k+1),
                 j = col - k·blockSize - 1 (original cat index)
```

A check like `pointsToRender.length === origCatCount + 2` is a brittle special case for M=2 that fails silently for M=3.

**Detection:** **Invariant tests** per mode: `expect(sum(cells[*][col])).toBeCloseTo(bar.actual)` for every column. The M=3 test catches the bug; M=2 alone misses it.

#### 4.7.2 Symmetric label-background padding — text baseline is not text top

**Problem:** Background pills behind text labels look balanced horizontally but asymmetric vertically.

**Generic lesson:** SVG text baseline is **not** the top of the glyph. Common UI fonts (Segoe UI, Arial, Helvetica) place glyph extents at ~0.78×fontSize above the baseline, ~0.22×fontSize below. Assuming `ascent === fontSize` over-pads the bottom.

```ts
const ascent  = fontSize * 0.78;
const descent = fontSize * 0.22;
const bgY = y - ascent - padY;
const bgH = ascent + descent + 2 * padY;
```

**Detection:** Visual diff / golden snapshot on label-bg rendering.

#### 4.7.3 Mutation immunity — clone before aggregating

**Problem:** Aggregating per-category segments into a grand-total bar — later mutations to the per-category segments poison the grand total.

**Generic lesson:** When you derive an aggregated view from per-row data, **shallow-clone (`{...s}`) before storing**. Especially important for arrays handed to a renderer that may sort/style in place.

**Detection:** Mutation-immunity test: aggregate → mutate source → assert derived value unchanged.

---

## 5. Anti-patterns (what fails review or causes pain)

| Anti-pattern | Why it bites | Use instead |
|---|---|---|
| `target.innerHTML = "<svg>…</svg>"` | Fails `powerbi-visuals/no-inner-outer-html` lint; required for cert | DOM API (`createElementNS`) for small trees; string + `DOMParser` + `replaceChildren` for the hot path |
| Unescaped category text in SVG strings | `<A & B>` corrupts the SVG parser | `escapeXml(label)` before every `<text>` and `aria-label` |
| Unvalidated colour → `fill="${value}"` | Empty string / whitespace / non-hex produces invalid SVG attrs | `safeHex(value, themedFallback)` at every read site |
| Hard-coded `"#50be87"` for positive | Breaks under report themes / high-contrast | `host.colorPalette.positive.value`, fall through `FALLBACK_POSITIVE` only when palette doesn't expose it |
| Hard-coded `"Arial"` font | Visual stands out from native PBI visuals | `formattingSettings.FontControl` with `value: "Segoe UI"` default |
| Hard-coded `"en-US"` | Locale-dependent grouping/decimal separator | `this.locale = host.locale` re-read every `update()` |
| One `addEventListener` per bar | Attached after every render → leaks; lost when SVG is replaced | Five listeners on `target` in constructor, demultiplexed by `.closest("[data-cat-idx]")` |
| `--no-verify` on pre-commit hooks | Bypasses format/lint guarantees that ship to AppSource | Fix the underlying issue |
| Empty render on transient null dataView | Visual blanks during page-switch | `lastValidRenderInput` cache + null-vs-empty branching |
| `parseDataView` returns `null` for "no measure bound" | Page-switch logic resurrects the ghost frame | Two empty signals: `null` (transient) vs `buildEmptyParseResult()` (user-cleared) |
| Mouse hover via per-element `:hover` filter on `<g>` | `filter: brightness` blurs `<text>` subpixel rendering | Hover toggles a soft fill on a sibling `<rect>` |
| Native browser focus outline | Either invisible or clashing with selection blue | Custom dashed focus ring SVG rect under `:focus-visible` |
| `setTimeout(stringExpr, …)` / `setInterval(stringExpr, …)` | Counts as implied eval | Pass function references |
| `<img src="https://…">`, `<script src="//cdn…">`, `@import url(https://fonts...)` | External resource = cert fail | Bundle locally |
| Hard-coded English literals in `src/` for user-facing strings | Fails i18n review | `localizationManager.getDisplayName("Visual_Key")` |
| Catching exceptions but never calling `renderingFailed` | Silent failures break host telemetry | Wrap `update()` in try/catch with the triple |
| Implementing your own context menu | Fails native-experience review | `selectionManager.showContextMenu(point)` |
| Requesting `WebAccess` or `ExportContent` privilege "just in case" | Every privilege has to be justified in writing | `privileges: []` until proven needed |
| Declaring `supportsLocalization` in `capabilities.json` 5.11 | Not in schema | Just use resjson + `displayNameKey` |
| `console.log/error/warn` in production | ESLint warns; clutters review | Remove before submission |
| Custom landing page instead of `supportsLandingPage: true` | Host's native overlay must win | Render nothing when no data |
| Karma + karma-typescript on flaky stack | Bundler unstable | Jest + jsdom + ts-jest |
| Missing `Visual.destroy()` | Host can leak memory on page churn | Implement, even if it's 2 lines |

---

## 6. Reference snippets (copy-paste ready)

### 6.1 `escapeXml`

```ts
function escapeXml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

### 6.2 Hex colour validation

```ts
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHORT_HEX_RE = /^#[0-9a-fA-F]{3}$/;
function safeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (HEX_RE.test(value) || SHORT_HEX_RE.test(value)) return value;
  return fallback;
}
```

### 6.3 Pure-DOM SVG creation (no innerHTML)

```ts
const SVG_NS = "http://www.w3.org/2000/svg";
const svg = document.createElementNS(SVG_NS, "svg");
svg.setAttribute("width", String(width));
svg.setAttribute("height", String(height));
svg.setAttribute("role", "img");
svg.setAttribute("aria-label", escapeXml(ariaLabel));
const rect = document.createElementNS(SVG_NS, "rect");
rect.setAttribute("x", x.toFixed(1));
rect.setAttribute("fill", safeHex(userColor, "#595959"));
svg.appendChild(rect);
target.replaceChildren(svg);
```

### 6.4 Host service init in constructor

```ts
constructor(options: VisualConstructorOptions) {
  this.host = options.host;
  this.target = options.element;
  const localizationManager = options.host.createLocalizationManager();
  this.formattingSettingsService = new FormattingSettingsService(localizationManager);
  this.selectionManager = options.host.createSelectionManager();
  this.tooltipService = options.host.tooltipService;
  this.locale = options.host.locale || "en-US";
  this.allowInteractions =
    (options.host as any).hostCapabilities?.allowInteractions ?? true;
}
```

### 6.5 High-contrast / theme resolver

```ts
const palette = this.host.colorPalette as any;
this.isHighContrast = palette?.isHighContrast === true;
this.hcForeground = safeHex(palette?.foreground?.value, "#000000");
this.hcBackground = safeHex(palette?.background?.value, "#ffffff");
this.hcHyperlink  = safeHex(palette?.hyperlink?.value,  "#0078d4");
const themePositive = safeHex(palette?.positive?.value, "#50be87");
const themeNegative = safeHex(palette?.negative?.value, "#dd3f3f");

function resolveBarFill(userPick: string, sentiment: "pos"|"neg"|"neutral"): string {
  if (this.isHighContrast) return this.hcForeground;
  if (userPick) return safeHex(userPick, themePositive);
  return sentiment === "pos" ? themePositive
       : sentiment === "neg" ? themeNegative
       : this.hcForeground;
}
```

### 6.6 `update()` with rendering events

```ts
public update(options: VisualUpdateOptions): void {
  const eventService = this.host.eventService;
  eventService?.renderingStarted(options);
  try {
    const dataView = options.dataViews?.[0];
    if (!dataView) {           // empty state: host paints native landing
      this.target.replaceChildren();
      eventService?.renderingFinished(options);
      return;
    }
    // … parse, layout, render …
    eventService?.renderingFinished(options);
  } catch (e) {
    eventService?.renderingFailed(options, (e as Error)?.message ?? String(e));
  }
}
```

### 6.7 Selection toggle (click-twice-to-clear)

```ts
private isAlreadySelected(target: ISelectionId | ISelectionId[]): boolean {
  const current = this.selectionManager.getSelectionIds();
  if (current.length === 0) return false;
  const targets = Array.isArray(target) ? target : [target];
  if (current.length !== targets.length) return false;
  return targets.every(t => current.some(c => c.equals(t)));
}
private selectOrToggle(target, multi: boolean): void {
  if (!multi && this.isAlreadySelected(target)) {
    this.selectionManager.clear().then(() => this.applySelectionVisuals());
    return;
  }
  this.selectionManager.select(target, multi).then(() => this.applySelectionVisuals());
}
```

### 6.8 fx ColorPicker factory

```ts
function makeFxColorPicker(opts): formattingSettings.ColorPicker {
  const cp = new formattingSettings.ColorPicker(opts);
  cp.selector = dataViewWildcard.createDataViewWildcardSelector(
    dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
  );
  cp.instanceKind = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;
  return cp;
}
```

### 6.9 fx persistence cascade (no-category mode safe)

```ts
function extractFill(obj: any): string | null {
  const v = obj?.solid?.color ?? obj?.value;
  return typeof v === "string" && /^#[0-9a-fA-F]{3,6}$/.test(v) ? v : null;
}

function readPersistedFx(
  dv: powerbi.DataView,
  objName: string,
  propName: string
): string | null {
  // 1) per-row constant (with-dim mode)
  const firstRow = dv?.categorical?.categories?.[0]?.objects?.[0];
  let v = extractFill(firstRow?.[objName]?.[propName]);
  if (v) return v;
  // 2) global metadata
  v = extractFill(dv?.metadata?.objects?.[objName]?.[propName]);
  if (v) return v;
  // 3) values[i].source.objects (no-category mode)
  const valuesArr = dv?.categorical?.values || [];
  for (const grp of valuesArr) {
    v = extractFill((grp as any)?.source?.objects?.[objName]?.[propName]);
    if (v) return v;
  }
  return null;
}
```

### 6.10 Minimal `IVisualHost` mock for tests

```ts
function makeMockHost() {
  return {
    createLocalizationManager: () => ({ getDisplayName: (k: string) => k }),
    createSelectionManager: () => ({
      select: () => Promise.resolve([]),
      hasSelection: () => false,
      getSelectionIds: () => [],
      clear: () => Promise.resolve(),
      showContextMenu: () => Promise.resolve(),
      registerOnSelectCallback: () => {},
    }),
    createSelectionIdBuilder: () => ({
      withCategory: () => this,
      withMeasure: () => this,
      createSelectionId: () => ({ equals: (other: any) => other === this }),
    }),
    colorPalette: {
      getColor: (k: string) => ({ value: "#" + k.slice(0, 6).padEnd(6, "0") }),
      isHighContrast: false,
      foreground: { value: "#000000" },
      background: { value: "#ffffff" },
      hyperlink:  { value: "#0078d4" },
    },
    tooltipService: { enabled: () => true, show: () => {}, hide: () => {}, move: () => {} },
    eventService: { renderingStarted: () => {}, renderingFinished: () => {}, renderingFailed: () => {} },
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    displayWarningIcon: () => {},
  };
}
```

---

## 7. Master checklist for a new pbiviz project

When you start a fresh `npx pbiviz new`, walk this list top-to-bottom. Each item is in §1–§6.

### Project bootstrap
- [ ] `npx pbiviz new <name>` → adjust `pbiviz.json` (`guid`, `displayName`, `description`, `supportUrl`, `gitHubUrl`)
- [ ] Set `apiVersion` to current (5.11+ at time of writing)
- [ ] `pbiviz.json` → `stringResources: ["stringResources/en-US/resources.resjson", "stringResources/fr-FR/resources.resjson"]`
- [ ] `pbiviz.json` → `ignorePackageWarnings: false`
- [ ] Create the recommended file structure (§3.1)
- [ ] Add `CLAUDE.md`, `CONTEXT.md`, `CHANGELOG.md`, `README.md`

### Config files
- [ ] `tsconfig.json` strict settings (§2.2)
- [ ] `tsconfig.jest.json` for the test build (includes `src/**/*` + `test/**/*`)
- [ ] `.eslintrc.json` with `plugin:powerbi-visuals/recommended` + `no-eval` / `no-implied-eval` / `no-new-func` at error
- [ ] `.editorconfig` + `.prettierrc`
- [ ] `jest.config.js` (§2.11)
- [ ] `package.json` scripts: `lint`, `test`, `start`, `package`

### Visual class
- [ ] Constructor wires host services in order (§3.2)
- [ ] Constructor renders empty placeholder before first `update()`
- [ ] `update()` wrapped in try/catch with `renderingStarted/Finished/Failed`
- [ ] Two-branch empty handling (null vs empty ParseResult) (§4.1.2)
- [ ] `lastValidRenderInput` cache for page-switch replay
- [ ] `destroy()` clears caches
- [ ] Delegated handlers on `target`, attached once

### Format pane (settings.ts)
- [ ] Every card has `name`, `displayName`, `displayNameKey`
- [ ] `Group.name` and `Card.name` globally unique
- [ ] fx slices use `makeFxColorPicker` factory (§6.8)
- [ ] `readPersistedFx` cascade implemented for any fx slice that might appear in no-category mode (§6.9)

### Capabilities
- [ ] `supportsHighlight: true`
- [ ] `supportsLandingPage: true`
- [ ] `supportsKeyboardFocus: true`
- [ ] `supportsMultiVisualSelection: true`
- [ ] `privileges: []`
- [ ] `tooltips.supportedTypes: { default: true, canvas: true }`
- [ ] `sorting.default: {}`
- [ ] `dataReductionAlgorithm.top.count: 10000`
- [ ] Every object has `displayName` + `displayNameKey`

### i18n
- [ ] `stringResources/en-US/resources.resjson` (mandatory)
- [ ] At least one second locale
- [ ] CI test asserts key sets match across locales

### Accessibility
- [ ] SVG root has `role="img"`, `aria-label`, `aria-roledescription`
- [ ] Every interactive `<g>` has `tabindex="0"`, `role="button"`, enriched `aria-label`
- [ ] Keyboard handler covers ←→↑↓, Home, End, Enter, Space, Esc, Ctrl/Shift+Enter
- [ ] Custom focus ring (SVG `<rect>`) toggled by `:focus-visible`
- [ ] HC mode overrides all colours via `host.colorPalette`
- [ ] Tooltips reveal on focus, not just hover

### Tests
- [ ] Jest + jsdom + ts-jest configured (§2.11)
- [ ] `test/_jest-setup.js` with crypto + TextEncoder polyfills
- [ ] `test/_powerbi-stub.ts` for `powerbi-visuals-api`
- [ ] `test/_style-stub.js` for `.less`/`.css`
- [ ] Parser tests (DataView shape matrix)
- [ ] Formatting-model tests (slice descriptors + populate-from-objects)
- [ ] Pure-helper tests (`format.ts`, `yRange.ts`, `tooltip.ts`)
- [ ] **Math invariant tests** per mode (`Σ cells = bar` etc., per §4.7.1)
- [ ] **Perf test** — 10 000 categories < 1 s

### CI
- [ ] `.github/workflows/ci.yml` with lint → tsc → jest → pbiviz package → artifact upload
- [ ] Triggers on `main` + `certification`

### Documentation
- [ ] `README.md` — install/develop/test/package + AppSource stage status
- [ ] `CONTEXT.md` — design decisions, why-not-otherwise, project-specific math
- [ ] `CHANGELOG.md` — Keep-a-Changelog format
- [ ] `docs/PRIVACY.md` — bilingual privacy policy with the 7-point coverage (§1.2)

### Pre-AppSource
- [ ] Public GitHub repo, branch `certification` (lowercase)
- [ ] Sample `.pbix` files in `sample/` covering every major mode
- [ ] 20×20 pane icon at `assets/icon.png` (300×300 commercial logo is a separate Partner Center upload)
- [ ] Listing assets: short desc, long desc, screenshots, video (optional)
- [ ] Privacy policy URL public + linked in Partner Center

If every box checks, you have a fighting chance of passing first-round review.

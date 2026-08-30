/**
 * Integration render pass over every layout/state. Always asserts DOM
 * structure; with RENDER_SNAPSHOTS=1 it additionally serialises each state
 * (real DOM + compiled LESS) into tools/snapshots/*.html so
 * tools/screenshot.mjs can rasterise pixel-true PNGs in Chromium — the
 * screenshot pipeline used by the design-review loop (docs/WORKFLOW.md).
 */

import * as fs from "fs";
import * as path from "path";

import { makeMockHost, makeVisual, makeUpdateOptions, buildSlicerDV } from "./_harness";
import { Visual } from "../src/visual";

const WRITE = process.env.RENDER_SNAPSHOTS === "1";
const OUT_DIR = path.resolve(__dirname, "../tools/snapshots");

let compiledCss = "";

beforeAll(async () => {
  if (!WRITE) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const less = require("less");
  const src = fs.readFileSync(path.resolve(__dirname, "../style/visual.less"), "utf8");
  const out = await less.render(src, { filename: "visual.less" });
  compiledCss = out.css;
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

function snapshot(name: string, target: HTMLElement, width: number, height: number, caption: string): void {
  if (!WRITE) return;
  const html = [
    "<!doctype html><html><head><meta charset='utf-8'><style>",
    "body{margin:0;background:#f3f4f4;font-family:Arial,sans-serif;padding:0;}",
    ".stage{display:inline-block;padding:24px 28px;}",
    ".frame{width:" + width + "px;height:" + height + "px;background:#ffffff;",
    "border-radius:6px;box-shadow:0 1px 6px rgba(9,22,18,.14);overflow:hidden;}",
    ".caption{color:#8a9994;font-size:11px;margin:0 0 8px 2px;}",
    compiledCss,
    "</style></head><body><div class='stage shot'>",
    "<p class='caption'>" + caption.replace(/</g, "&lt;") + "</p>",
    "<div class='frame'>" + target.outerHTML + "</div>",
    "</div></body></html>"
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), html);
}

function fixtureCountries(objects?: Record<string, Record<string, unknown>>) {
  return buildSlicerDV(
    [
      {
        name: "Pays",
        column: "Pays",
        table: "Geo",
        values: ["France", "Allemagne", "Espagne", "Italie", "Portugal", "Belgique", "Suisse", "Irlande"]
      }
    ],
    { name: "CA", values: [1250000, 980000, 640000, 590000, 210000, 450000, 380000, 175000], format: "#,##0  \"€\"" },
    objects
  );
}

function fixtureHierarchy() {
  return buildSlicerDV(
    [
      {
        name: "Région",
        column: "Region",
        table: "Geo",
        values: ["Europe", "Europe", "Europe", "Europe", "Europe", "Amériques", "Amériques", "Amériques", "Asie", "Asie"]
      },
      {
        name: "Pays",
        column: "Pays",
        table: "Geo",
        values: ["France", "France", "Allemagne", "Espagne", "Italie", "USA", "USA", "Canada", "Japon", "Chine"]
      },
      {
        name: "Ville",
        column: "Ville",
        table: "Geo",
        values: ["Paris", "Lyon", "Berlin", "Madrid", "Rome", "New York", "Austin", "Toronto", "Tokyo", "Shanghai"]
      }
    ],
    { name: "CA", values: [520, 180, 460, 250, 210, 830, 120, 260, 390, 610], format: "#,##0 \"k€\"" }
  );
}

function clickEl(el: Element | null): void {
  if (!el) throw new Error("snapshot click target missing");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Re-query on every use — each click re-renders, detaching old nodes. */
function itemByLabel(target: HTMLElement, selector: string, label: string): Element {
  const el = Array.from(target.querySelectorAll(selector)).find((e) => e.textContent?.includes(label));
  if (!el) throw new Error(`item not found: ${label}`);
  return el;
}

describe("render snapshots", () => {
  test("01 — vertical list with selection + badges", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(fixtureCountries(), 260, 380));
    clickEl(itemByLabel(target, ".es-item", "France"));
    clickEl(itemByLabel(target, ".es-item", "Espagne"));
    clickEl(itemByLabel(target, ".es-item", "Portugal"));
    // Width 260 → one-line chip cap = floor(260/90) = 2 chips + "+1".
    expect(target.querySelectorAll(".es-chip[data-chip-key]")).toHaveLength(2);
    expect(target.querySelector(".es-chip-more")?.textContent).toBe("+1");
    snapshot("01-list-selection", target, 260, 380, "Liste verticale — multi-sélection, badges retirables, valeurs formatées");
  });

  test("02 — hierarchy tree, partial selection", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(fixtureHierarchy(), 280, 430));
    clickEl(itemByLabel(target, ".es-item", "Europe").querySelector("[data-exp-key]"));
    clickEl(itemByLabel(target, ".es-item", "France").querySelector("[data-exp-key]"));
    clickEl(itemByLabel(target, ".es-item", "Paris"));
    clickEl(itemByLabel(target, ".es-item", "Italie"));
    expect(target.querySelector('.es-item[aria-checked="mixed"]')).not.toBeNull();
    snapshot("02-hierarchy-partial", target, 280, 430, "Hiérarchie 3 niveaux — tri-état, sélection partielle, chevrons");
  });

  test("03 — chiclet grid", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(fixtureCountries({ slicerStyle: { layout: "chiclets", chicletColumns: 2 } }), 260, 380)
    );
    clickEl(itemByLabel(target, ".es-chiclet", "France"));
    clickEl(itemByLabel(target, ".es-chiclet", "Italie"));
    expect(target.querySelectorAll(".es-chiclet.es-on")).toHaveLength(2);
    snapshot("03-chiclets", target, 260, 380, "Boutons chiclets — grille 2 colonnes, états sélectionnés");
  });

  test("04 — dropdown open with search", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(fixtureCountries({ slicerStyle: { layout: "dropdown" } }), 260, 380));
    expect(target.querySelector(".es-popover")).toBeNull();
    clickEl(target.querySelector("[data-action='ddToggle']"));
    clickEl(itemByLabel(target, ".es-item", "Allemagne"));
    clickEl(itemByLabel(target, ".es-item", "Suisse"));
    expect(target.querySelector(".es-popover")).not.toBeNull();
    snapshot("04-dropdown-open", target, 260, 380, "Mode dropdown — panneau ouvert, résumé de sélection dans le champ");
  });

  test("05 — active search narrows the tree", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(fixtureHierarchy(), 280, 430));
    const input = target.querySelector<HTMLInputElement>(".es-search-input");
    if (!input) throw new Error("no search input");
    input.value = "to";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(target.querySelectorAll(".es-item").length).toBeGreaterThan(0);
    snapshot("05-search", target, 280, 430, "Recherche — descendants dépliés automatiquement, ancêtres conservés");
  });

  test("06 — single-select radios, badge unique", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(fixtureCountries({ selection: { selectionMode: "single" } }), 260, 380));
    clickEl(itemByLabel(target, ".es-item", "Allemagne"));
    expect(target.querySelectorAll(".es-radio")).not.toHaveLength(0);
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(1);
    snapshot("06-single-select", target, 260, 380, "Sélection unique — radios, boutons Tout/Inverser masqués");
  });

  test("07 — high-contrast mode (Night-sky-like palette)", () => {
    const { visual, target, host } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const palette = host.colorPalette as any;
    palette.isHighContrast = true;
    palette.foreground = { value: "#ffffff" };
    palette.background = { value: "#0d1117" };
    palette.hyperlink = { value: "#75b6e7" };
    visual.update(makeUpdateOptions(fixtureCountries(), 260, 380));
    clickEl(itemByLabel(target, ".es-item", "France"));
    clickEl(itemByLabel(target, ".es-item", "Espagne"));
    expect(target.style.getPropertyValue("--es-selected-bg")).toBe("#75b6e7");
    snapshot("07-high-contrast", target, 260, 380, "Mode high-contrast — tous les tokens écrasés par la palette hôte");
  });

  test("08 — locale fr-FR (chaînes localisées)", () => {
    const frDict = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../stringResources/fr-FR/resources.resjson"), "utf8")
    ) as Record<string, string>;
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = makeMockHost();
    host.createLocalizationManager = () => ({ getDisplayName: (k: string) => frDict[k] ?? k });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visual = new Visual({ host, element: target } as any);
    visual.update(makeUpdateOptions(fixtureCountries(), 260, 380));
    clickEl(itemByLabel(target, ".es-item", "France"));
    expect(target.querySelector(".es-footer")?.textContent).toContain("sélectionné");
    snapshot("08-locale-fr", target, 260, 380, "Locale fr-FR — recherche, actions, footer et badges localisés");
  });
});

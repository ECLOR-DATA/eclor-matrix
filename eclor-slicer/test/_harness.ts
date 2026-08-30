/**
 * Shared test harness — mock host, Visual factory and categorical DataView
 * builders for the slicer. Every suite builds its fixtures the same way
 * (same discipline as eclor-matrix / eclor-waterfall).
 */

import { Visual } from "../src/visual";
import { VisualFormattingSettingsModel } from "../src/settings";

// ---------- Mocking ----------

export interface AppliedFilterCall {
  filter: unknown;
  objectName: string;
  propertyName: string;
  action: number;
}

export function makeMockHost() {
  const applied: AppliedFilterCall[] = [];
  const host = {
    createLocalizationManager: () => ({
      getDisplayName: (k: string) => k
    }),
    createSelectionManager: () => ({
      select: () => Promise.resolve([]),
      showContextMenu: () => Promise.resolve(),
      hasSelection: () => false,
      getSelectionIds: () => [],
      clear: () => Promise.resolve(),
      registerOnSelectCallback: () => {}
    }),
    createSelectionIdBuilder: () => {
      const builder: Record<string, unknown> = {};
      builder.withCategory = () => builder;
      builder.withMeasure = () => builder;
      builder.createSelectionId = () => ({ getSelector: () => ({}), equals: () => false });
      return builder;
    },
    applyJsonFilter: (filter: unknown, objectName: string, propertyName: string, action: number) => {
      applied.push({ filter, objectName, propertyName, action });
    },
    colorPalette: {
      getColor: (k: string) => ({ value: `#${k.slice(0, 6).padEnd(6, "0")}` }),
      isHighContrast: false,
      foreground: { value: "#000000" },
      background: { value: "#ffffff" },
      hyperlink: { value: "#0078d4" }
    },
    tooltipService: { enabled: () => true, show: () => {}, hide: () => {}, move: () => {} },
    eventService: {
      renderingStarted: () => {},
      renderingFinished: () => {},
      renderingFailed: () => {}
    },
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    displayWarningIcon: () => {},
    persistProperties: () => {},
    applied
  };
  return host;
}

export function makeVisual() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const host = makeMockHost();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = new Visual({ host, element: target } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (v as any).formattingSettings = new VisualFormattingSettingsModel();
  return { visual: v, target, host };
}

// ---------- Categorical DataView builders ----------

export interface LevelSpec {
  name: string;
  values: (string | number | boolean | null)[];
  table?: string;
  column?: string;
}

/** Build a slicer DataView: N parallel category columns (hierarchy levels at
 *  leaf grain) + optional measure. Mirrors what the host emits for the
 *  `field` role with `"for": {"in": "field"}`. */
export function buildSlicerDV(
  levels: LevelSpec[],
  measure?: { name: string; values: (number | null)[]; format?: string },
  objects?: Record<string, Record<string, unknown>>
) {
  const categories = levels.map((l, i) => ({
    source: {
      displayName: l.name,
      queryName: `${l.table ?? "T"}.${l.column ?? l.name}`,
      roles: { field: true },
      expr: { ref: l.column ?? l.name, source: { entity: l.table ?? "T" } },
      index: i
    },
    values: l.values
  }));
  const values = measure
    ? [
        {
          source: {
            displayName: measure.name,
            queryName: `Measures.${measure.name}`,
            roles: { values: true },
            format: measure.format
          },
          values: measure.values
        }
      ]
    : [];
  return {
    categorical: { categories, values },
    metadata: { columns: [], objects }
  };
}

/** Update-options factory. `jsonFilters` mimics the host echoing persisted
 *  filters back (undefined = host didn't send the field at all). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeUpdateOptions(dv: unknown, width = 300, height = 400, jsonFilters?: unknown[]): any {
  return {
    dataViews: dv ? [dv] : [],
    viewport: { width, height },
    jsonFilters,
    type: 2
  };
}

/** Standard 2-level fixture: 3 countries × products, 8 leaf rows. */
export function twoLevelFixture() {
  return buildSlicerDV(
    [
      {
        name: "Country",
        column: "Country",
        table: "Geo",
        values: ["France", "France", "France", "Germany", "Germany", "Spain", "Spain", "Spain"]
      },
      {
        name: "Product",
        column: "Product",
        table: "Prod",
        values: ["Alpha", "Beta", "Gamma", "Alpha", "Delta", "Beta", "Delta", "Epsilon"]
      }
    ],
    { name: "Sales", values: [100, 200, 50, 300, 120, 80, 60, 40], format: "#,##0" }
  );
}

export function oneLevelFixture(
  labels: string[] = ["Alpha", "Beta", "Gamma", "Delta"],
  objects?: Record<string, Record<string, unknown>>
) {
  return buildSlicerDV([{ name: "Product", column: "Product", table: "Prod", values: labels }], undefined, objects);
}

/**
 * Shared test harness — mock host, Visual factory and matrix DataView
 * builders. Every suite builds its fixtures the same way.
 */

import { Visual } from "../src/visual";
import { VisualFormattingSettingsModel } from "../src/settings";

// ---------- Mocking ----------

let selectionKeyCounter = 0;

export function makeSelectionIdBuilder() {
  const builder: Record<string, unknown> = {};
  builder.withCategory = () => builder;
  builder.withMeasure = () => builder;
  builder.withSeries = () => builder;
  builder.withMatrixNode = () => builder;
  builder.createSelectionId = () => {
    const key = `k${selectionKeyCounter++}`;
    return {
      getSelector: () => ({ data: [] }),
      getKey: () => key,
      equals: () => false,
      includes: () => false,
      getSelectorsByColumn: () => ({})
    };
  };
  return builder;
}

export function makeMockHost() {
  return {
    createLocalizationManager: () => ({
      getDisplayName: (k: string) => k
    }),
    createSelectionManager: () => ({
      select: () => Promise.resolve([]),
      showContextMenu: () => Promise.resolve(),
      toggleExpandCollapse: () => Promise.resolve(),
      hasSelection: () => false,
      getSelectionIds: () => [],
      clear: () => Promise.resolve(),
      registerOnSelectCallback: () => {},
      applyJsonFilter: () => {}
    }),
    createSelectionIdBuilder: makeSelectionIdBuilder,
    colorPalette: {
      getColor: (k: string) => {
        let h = 0;
        for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
        const hex = (h & 0xffffff).toString(16).padStart(6, "0");
        return { value: `#${hex}` };
      }
    },
    tooltipService: {
      enabled: () => true,
      show: () => {},
      hide: () => {},
      move: () => {}
    },
    eventService: {
      renderingStarted: () => {},
      renderingFinished: () => {},
      renderingFailed: () => {}
    },
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    displayWarningIcon: () => {},
    persistProperties: () => {}
  };
}

export function makeVisual() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = new Visual({ host: makeMockHost(), element: target } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (v as any).formattingSettings = new VisualFormattingSettingsModel();
  return { visual: v, target };
}

// ---------- Matrix DataView builders ----------

export interface MeasureSpec {
  name: string;
  values: (number | string | null)[];
  format?: string;
  role?: "values" | "tooltips";
  /** Persisted per-measure objects (e.g. { values: { useCustom: true } }). */
  objects?: Record<string, unknown>;
}

/**
 * Flat matrix: one row level, no column grouping — one column leaf per
 * measure, exactly what the host emits for Rows + Values only.
 */
export function buildSimpleMatrixDV(rowLabels: string[], measures: MeasureSpec[]) {
  const rowRoot = {
    children: rowLabels.map((label, i) => ({
      level: 0,
      levelValues: [{ value: label }],
      value: label,
      identity: { key: `row${i}` },
      values: Object.fromEntries(
        measures.map((m, mi) => [mi, { value: m.values[i], valueSourceIndex: mi }])
      )
    }))
  };
  const valueSources = measures.map((m, i) => ({
    displayName: m.name,
    queryName: `Measures.${m.name.replace(/\s+/g, "_")}_${i}`,
    format: m.format,
    roles: { [m.role ?? "values"]: true },
    objects: m.objects
  }));
  return {
    matrix: {
      rows: {
        root: rowRoot,
        levels: [{ sources: [{ displayName: "Row", roles: { rows: true } }] }]
      },
      columns: { root: { children: [] } },
      valueSources
    },
    metadata: { columns: [] }
  };
}

/** Update-options factory. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeUpdateOptions(dv: unknown, width = 800, height = 600): any {
  return {
    dataViews: dv ? [dv] : [],
    viewport: { width, height },
    type: 2
  };
}

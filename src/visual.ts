"use strict";

import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";

import DataView = powerbi.DataView;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import DataViewHierarchyLevel = powerbi.DataViewHierarchyLevel;
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import ITooltipService = powerbi.extensibility.ITooltipService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

import {
  DISPLAY_UNIT_VALUES,
  makePerMeasureColorGroup,
  makePerMeasureValueGroup,
  MeasureFormatOverride,
  VisualFormattingSettingsModel
} from "./settings";
import { formatActualLabel, safeHex, safeHexOrEmpty } from "./format";
import { computeWindow, estimateRowHeight, WindowSpec } from "./virtualize";
import {
  CellColorMode,
  CellColorOpts,
  MeasureStats,
  resolveCellColor
} from "./cellColor";
import { compileExpression } from "./expressions";
import { barWidthPct, detectScenario, IbcsScenario } from "./ibcs";

interface CalcDef {
  name: string;
  format: string;
  display: string;
  refs: string[];
  evaluate: (lookup: (ref: string) => number | null) => number | null;
}

type RenderCol =
  | { kind: "leaf"; leafIdx: number }
  | { kind: "calc"; calcIdx: number; path: string[]; pathKey: string };
import {
  buildHeaderRows,
  computeMaxAbs,
  flattenColumns,
  flattenRows,
  ColumnLeaf,
  HeaderCell,
  MatrixNodeLike,
  RowModel
} from "./matrixModel";

/** Below this row count everything renders at once; above it the tbody is
 *  virtualized (windowed slice + spacer rows) so 10k+ rows stay fluid. */
const VIRTUALIZE_THRESHOLD = 400;
const OVERSCAN_ROWS = 20;

interface ParseResult {
  rows: RowModel[];
  leaves: ColumnLeaf[];
  headerRows: HeaderCell[][];
  /** Indexes into `leaves` that render as grid columns (tooltip-only
   *  measures are excluded — they surface in hover tooltips instead). */
  renderLeafIdxs: number[];
  valueSources: DataViewMetadataColumn[];
  rowLevels: DataViewHierarchyLevel[];
  /** Per-measure format override persisted on valueSources[i].objects.values. */
  measureOverrides: MeasureFormatOverride[];
  /** Per-measure min/max over non-subtotal rows (heat-map domain). */
  measureStats: MeasureStats[];
  /** Per-measure colour override persisted on valueSources[i].objects.cellColors. */
  measureColorOverrides: (CellColorOpts & { useCustom: boolean })[];
  /** Ordered grid columns: measure leaves + client-side calculated columns. */
  renderCols: RenderCol[];
  calcDefs: CalcDef[];
  /** pathKey → measureName(lower) → leafIdx, for calc-formula lookups. */
  calcLookups: Map<string, Map<string, number>>;
  /** Resolved IBCS scenario per measure (override else name detection). */
  measureScenarios: (IbcsScenario | null)[];
  /** |max| per calc column over non-subtotal rows — variance-bar domain. */
  calcMaxAbs: number[];
}

interface RenderInput {
  parsed: ParseResult;
  width: number;
  height: number;
}

export class Visual implements IVisual {
  private host: IVisualHost;
  private target: HTMLElement;
  private formattingSettingsService: FormattingSettingsService;
  private formattingSettings: VisualFormattingSettingsModel;
  private selectionManager: ISelectionManager;
  private tooltipService: ITooltipService;
  private localizationManager: ILocalizationManager;
  private locale: string;
  private allowInteractions: boolean;

  private isHighContrast: boolean = false;
  private hcForeground: string = "#000000";
  private hcBackground: string = "#ffffff";
  private hcHyperlink: string = "#0078d4";

  private lastValidRenderInput: RenderInput | null = null;
  private rowSelectionIds: (ISelectionId | null)[] = [];
  private selectedRowKeys: Set<string> = new Set();
  private scrollEl: HTMLDivElement | null = null;
  private tbodyEl: HTMLTableSectionElement | null = null;
  private currentWindow: WindowSpec | null = null;
  private rowHeightPx: number = 17;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Visual constructor: options were not provided by the host.");
    }
    this.host = options.host;
    this.target = options.element;

    this.localizationManager = options.host.createLocalizationManager();
    this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);
    this.formattingSettings = new VisualFormattingSettingsModel();
    this.selectionManager = options.host.createSelectionManager();
    this.tooltipService = options.host.tooltipService;
    this.locale = options.host.locale || "en-US";
    this.allowInteractions =
      (options.host as unknown as { hostCapabilities?: { allowInteractions?: boolean } })
        .hostCapabilities?.allowInteractions ?? true;

    this.target.classList.add("eclor-matrix-root");

    // Delegated handlers attached ONCE on target — they survive re-renders.
    this.target.addEventListener("click", this.handleClick);
    this.target.addEventListener("contextmenu", this.handleContextMenu);
    this.target.addEventListener("mousemove", this.handleMouseMove);
    this.target.addEventListener("mouseleave", this.handleMouseLeave);
    this.target.addEventListener("keydown", this.handleKeydown);

    // Never visually blank before the first update().
    this.renderEmpty(this.localize("Visual_Empty", "Select or drag fields to populate this visual"));
  }

  public update(options: VisualUpdateOptions): void {
    const eventService = this.host.eventService;
    eventService?.renderingStarted(options);
    try {
      const dataView: DataView | undefined = options.dataViews?.[0];
      this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
        VisualFormattingSettingsModel,
        dataView
      );

      // Host-level capabilities can flip without a fresh instance.
      this.locale = this.host.locale || "en-US";
      const palette = this.host.colorPalette as unknown as {
        isHighContrast?: boolean;
        foreground?: { value?: string };
        background?: { value?: string };
        hyperlink?: { value?: string };
      };
      this.isHighContrast = palette?.isHighContrast === true;
      this.hcForeground = safeHex(palette?.foreground?.value, "#000000");
      this.hcBackground = safeHex(palette?.background?.value, "#ffffff");
      this.hcHyperlink = safeHex(palette?.hyperlink?.value, "#0078d4");

      const { width, height } = options.viewport;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        eventService?.renderingFinished(options);
        return;
      }

      const parsed = this.parseMatrix(dataView);

      if (!parsed) {
        // Page-switch transient (matrix undefined): replay the last frame.
        if (this.lastValidRenderInput) {
          this.renderFromInput(this.lastValidRenderInput);
        } else {
          this.renderEmpty(
            this.localize("Visual_Empty", "Select or drag fields to populate this visual")
          );
        }
        eventService?.renderingFinished(options);
        return;
      }

      if (parsed.rows.length === 0) {
        // User explicitly emptied the buckets: drop caches.
        this.lastValidRenderInput = null;
        this.rowSelectionIds = [];
        this.selectedRowKeys.clear();
        this.renderEmpty(
          this.localize("Visual_Empty", "Select or drag fields to populate this visual")
        );
        eventService?.renderingFinished(options);
        return;
      }

      this.buildRowSelectionIds(parsed);
      this.buildPerMeasureValueGroups(parsed);
      this.lastValidRenderInput = { parsed, width, height };
      this.renderFromInput(this.lastValidRenderInput);
      eventService?.renderingFinished(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventService?.renderingFailed(options, message);
    }
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
  }

  public destroy(): void {
    this.lastValidRenderInput = null;
    this.rowSelectionIds = [];
    this.selectedRowKeys.clear();
    this.scrollEl = null;
    this.tbodyEl = null;
    this.currentWindow = null;
    this.target.replaceChildren();
  }

  // ---------- Parsing ----------

  private parseMatrix(dv: DataView | undefined): ParseResult | null {
    if (!dv?.matrix) return null; // genuine page-switch transient

    const matrix = dv.matrix;
    const valueSources: DataViewMetadataColumn[] = matrix.valueSources ?? [];
    const rowLevels: DataViewHierarchyLevel[] = matrix.rows?.levels ?? [];
    const totalLabel = this.localize("Visual_Total", "Total");

    if (valueSources.length === 0) {
      return this.buildEmptyParseResult();
    }

    const measureNames = valueSources.map((s) => s.displayName ?? "");
    const colRoot = matrix.columns?.root as MatrixNodeLike | undefined;
    const rowRoot = matrix.rows?.root as MatrixNodeLike | undefined;

    const leaves = flattenColumns(colRoot, measureNames, totalLabel);
    const rows = flattenRows(rowRoot, leaves, totalLabel);
    if (rows.length === 0) {
      return this.buildEmptyParseResult();
    }

    const isTooltipOnly = (mi: number): boolean => {
      const roles = valueSources[mi]?.roles;
      return roles?.tooltips === true && roles?.values !== true;
    };
    const renderLeafIdxs: number[] = [];
    for (let i = 0; i < leaves.length; i++) {
      if (!isTooltipOnly(leaves[i].measureIndex)) renderLeafIdxs.push(i);
    }

    // Header rows come from the tree; when tooltip-only measures hide some
    // leaves the tree spans no longer match, so fall back to a flat header.
    let headerRows: HeaderCell[][];
    if (renderLeafIdxs.length === leaves.length) {
      headerRows = buildHeaderRows(colRoot, measureNames, totalLabel);
    } else {
      headerRows = [
        renderLeafIdxs.map((i) => {
          const leaf = leaves[i];
          const parts = [...leaf.path, measureNames[leaf.measureIndex] ?? ""];
          return {
            label: parts.filter((p) => p.length > 0).join(" · "),
            span: 1,
            isSubtotal: leaf.isSubtotal
          };
        })
      ];
    }

    const calcDefs = this.readCalcDefs();
    const rc = this.buildRenderColumns(leaves, renderLeafIdxs, measureNames, calcDefs);
    const renderCols = rc.renderCols;
    const calcLookups = rc.calcLookups;
    if (rc.flatHeader) headerRows = [rc.flatHeader];

    const measureOverrides = valueSources.map((vs) => this.readMeasureOverride(vs));
    const measureColorOverrides = valueSources.map((vs) => this.readMeasureColorOverride(vs));

    const { measureScenarios, calcMaxAbs } = this.resolveIbcsDomains(
      valueSources,
      measureOverrides,
      calcDefs,
      renderCols,
      calcLookups,
      rows
    );

    const measureStats: MeasureStats[] = valueSources.map(() => ({ min: Infinity, max: -Infinity }));
    for (const r of rows) {
      if (r.isSubtotal) continue;
      for (let li = 0; li < leaves.length; li++) {
        const v = r.cells[li];
        if (typeof v === "number" && Number.isFinite(v)) {
          const s = measureStats[leaves[li].measureIndex];
          if (s) {
            if (v < s.min) s.min = v;
            if (v > s.max) s.max = v;
          }
        }
      }
    }
    for (const s of measureStats) {
      if (s.min === Infinity) {
        s.min = 0;
        s.max = 0;
      }
    }

    return {
      rows,
      leaves,
      headerRows,
      renderLeafIdxs,
      valueSources,
      rowLevels,
      measureOverrides,
      measureStats,
      measureColorOverrides,
      renderCols,
      calcDefs,
      calcLookups,
      measureScenarios,
      calcMaxAbs
    };
  }

  /** Interleave calc columns after each column-group's measure leaves.
   *  When calc columns are active the header collapses to the flat shape
   *  (tree spans no longer match the widened groups). */
  private buildRenderColumns(
    leaves: ColumnLeaf[],
    renderLeafIdxs: number[],
    measureNames: string[],
    calcDefs: CalcDef[]
  ): {
    renderCols: RenderCol[];
    calcLookups: Map<string, Map<string, number>>;
    flatHeader: HeaderCell[] | null;
  } {
    const renderCols: RenderCol[] = [];
    const calcLookups = new Map<string, Map<string, number>>();
    if (calcDefs.length === 0) {
      for (const li of renderLeafIdxs) renderCols.push({ kind: "leaf", leafIdx: li });
      return { renderCols, calcLookups, flatHeader: null };
    }
    for (let li = 0; li < leaves.length; li++) {
      const key = leaves[li].path.join(" ");
      let m = calcLookups.get(key);
      if (!m) {
        m = new Map();
        calcLookups.set(key, m);
      }
      const nm = (measureNames[leaves[li].measureIndex] ?? "").toLowerCase();
      if (!m.has(nm)) m.set(nm, li);
    }
    let i = 0;
    while (i < renderLeafIdxs.length) {
      const path = leaves[renderLeafIdxs[i]].path;
      const key = path.join(" ");
      while (i < renderLeafIdxs.length && leaves[renderLeafIdxs[i]].path.join(" ") === key) {
        renderCols.push({ kind: "leaf", leafIdx: renderLeafIdxs[i] });
        i++;
      }
      calcDefs.forEach((_c, ci) => renderCols.push({ kind: "calc", calcIdx: ci, path, pathKey: key }));
    }
    const flatHeader: HeaderCell[] = renderCols.map((col) => {
      if (col.kind === "leaf") {
        const leaf = leaves[col.leafIdx];
        const parts = [...leaf.path, measureNames[leaf.measureIndex] ?? ""];
        return {
          label: parts.filter((p) => p.length > 0).join(" · "),
          span: 1,
          isSubtotal: leaf.isSubtotal
        };
      }
      const parts = [...col.path, calcDefs[col.calcIdx].name];
      return { label: parts.filter((p) => p.length > 0).join(" · "), span: 1, isSubtotal: false };
    });
    return { renderCols, calcLookups, flatHeader };
  }

  private readCalcDefs(): CalcDef[] {
    const out: CalcDef[] = [];
    const card = this.formattingSettings.calculatedColumns;
    card.slots.forEach((slot, i) => {
      if (slot.show.value !== true) return;
      const formula = String(slot.formula.value ?? "").trim();
      if (!formula) return;
      const compiled = compileExpression(formula);
      if (!compiled.ok) return; // invalid formula → column silently skipped
      out.push({
        name: String(slot.label.value ?? "").trim() || `Calc ${i + 1}`,
        format: String(slot.format.value?.value ?? "inherit"),
        display: String(slot.display.value?.value ?? "number"),
        refs: compiled.refs,
        evaluate: compiled.evaluate
      });
    });
    return out;
  }

  private resolveIbcsDomains(
    valueSources: DataViewMetadataColumn[],
    measureOverrides: MeasureFormatOverride[],
    calcDefs: CalcDef[],
    renderCols: RenderCol[],
    calcLookups: Map<string, Map<string, number>>,
    rows: RowModel[]
  ): { measureScenarios: (IbcsScenario | null)[]; calcMaxAbs: number[] } {
    const measureScenarios: (IbcsScenario | null)[] = valueSources.map((vs, i) => {
      const ov = measureOverrides[i].scenario;
      if (ov === "none") return null;
      if (ov === "AC" || ov === "PY" || ov === "BU" || ov === "FC") return ov;
      return detectScenario(vs.displayName);
    });

    const calcMaxAbs = calcDefs.map(() => 0);
    if (calcDefs.some((d) => d.display === "bar")) {
      for (const row of rows) {
        if (row.isSubtotal) continue;
        for (const col of renderCols) {
          if (col.kind !== "calc") continue;
          const v = this.evalCalc(calcDefs[col.calcIdx], calcLookups.get(col.pathKey), row);
          if (v !== null) {
            const a = Math.abs(v);
            if (a > calcMaxAbs[col.calcIdx]) calcMaxAbs[col.calcIdx] = a;
          }
        }
      }
    }
    return { measureScenarios, calcMaxAbs };
  }

  private evalCalc(
    def: CalcDef | undefined,
    lookupMap: Map<string, number> | undefined,
    row: RowModel
  ): number | null {
    if (!def || !lookupMap) return null;
    return def.evaluate((ref) => {
      const li = lookupMap.get(ref.toLowerCase());
      if (li === undefined) return null;
      const cv = row.cells[li];
      return typeof cv === "number" && Number.isFinite(cv) ? cv : null;
    });
  }

  private evalCalcCell(parsed: ParseResult, row: RowModel, col: { calcIdx: number; pathKey: string }): number | null {
    return this.evalCalc(parsed.calcDefs[col.calcIdx], parsed.calcLookups.get(col.pathKey), row);
  }

  private formatCalcValue(
    parsed: ParseResult,
    col: { calcIdx: number; pathKey: string },
    value: number
  ): string {
    const def = parsed.calcDefs[col.calcIdx];
    let modelFormat = "";
    let units = "none";
    let decimals = Number(this.formattingSettings.values.decimals.value) || 0;
    if (def.format === "percent") {
      modelFormat = "0.0%";
      decimals = 0;
    } else if (def.format === "inherit") {
      const m = parsed.calcLookups.get(col.pathKey);
      const firstRef = def.refs[0];
      const li = firstRef !== undefined ? m?.get(firstRef.toLowerCase()) : undefined;
      if (li !== undefined) {
        const mi = parsed.leaves[li].measureIndex;
        modelFormat = parsed.valueSources[mi]?.format ?? "";
        const fmt = this.measureFormat(parsed, mi);
        units = fmt.units;
        decimals = fmt.decimals;
      }
    }
    return formatActualLabel({
      value,
      modelFormat,
      cardUnits: units,
      cardDecimals: decimals,
      autoDecimals: 0,
      locale: this.locale,
      dataMaxAbs: computeMaxAbs(parsed.rows),
      withSign: true
    });
  }

  private buildCalcCell(
    parsed: ParseResult,
    row: RowModel,
    col: { calcIdx: number; path: string[]; pathKey: string },
    ariaParts: string[]
  ): HTMLTableCellElement {
    const td = document.createElement("td");
    td.setAttribute("data-calccol", "1");
    td.classList.add("em-calc");
    const def = parsed.calcDefs[col.calcIdx];
    const v = this.evalCalcCell(parsed, row, col);
    if (v === null) return td;
    const formatted = this.formatCalcValue(parsed, col, v);
    ariaParts.push(`${def.name} ${formatted}`);

    if (def.display !== "bar") {
      td.textContent = formatted;
      return td;
    }

    // IBCS variance bar: shared zero axis, good/bad semantic colours.
    td.classList.add("em-barcell");
    const flex = document.createElement("div");
    flex.className = "em-barflex";
    const wrap = document.createElement("div");
    wrap.className = "em-barwrap";
    const bar = document.createElement("div");
    bar.className = v >= 0 ? "em-bar em-bar-pos" : "em-bar em-bar-neg";
    bar.style.width = `${barWidthPct(v, parsed.calcMaxAbs[col.calcIdx]) / 2}%`;
    if (this.isHighContrast) bar.style.backgroundColor = this.hcForeground;
    wrap.appendChild(bar);
    const label = document.createElement("span");
    label.className = "em-barlabel";
    label.textContent = formatted;
    flex.appendChild(wrap);
    flex.appendChild(label);
    td.appendChild(flex);
    return td;
  }

  private readMeasureColorOverride(
    vs: DataViewMetadataColumn
  ): CellColorOpts & { useCustom: boolean } {
    const readFill = (v: unknown, fallback: string): string => {
      if (v === undefined) return fallback;
      const c = (v as { solid?: { color?: unknown } })?.solid?.color;
      return safeHexOrEmpty(typeof c === "string" ? c : "");
    };
    const p = (vs.objects as unknown as {
      cellColors?: Record<string, unknown>;
    })?.cellColors;
    const mode = String(p?.mode ?? "none");
    const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      useCustom: p?.useCustom === true,
      mode: (["none", "rules", "heatmap"] as const).includes(mode as CellColorMode)
        ? (mode as CellColorMode)
        : "none",
      thresholdLow: num(p?.thresholdLow),
      thresholdHigh: num(p?.thresholdHigh),
      colorLow: readFill(p?.colorLow, "#FF4D6D"),
      colorMid: readFill(p?.colorMid, ""),
      colorHigh: readFill(p?.colorHigh, "#1EF5B1")
    };
  }

  private globalColorOpts(): CellColorOpts {
    const c = this.formattingSettings.cellColors;
    const mode = String(c.mode.value?.value ?? "none");
    return {
      mode: (["none", "rules", "heatmap"] as const).includes(mode as CellColorMode)
        ? (mode as CellColorMode)
        : "none",
      thresholdLow: Number(c.thresholdLow.value) || 0,
      thresholdHigh: Number(c.thresholdHigh.value) || 0,
      colorLow: safeHexOrEmpty(c.colorLow.value?.value),
      colorMid: safeHexOrEmpty(c.colorMid.value?.value),
      colorHigh: safeHexOrEmpty(c.colorHigh.value?.value)
    };
  }

  private measureColorOpts(parsed: ParseResult, mi: number): CellColorOpts {
    const ov = parsed.measureColorOverrides[mi];
    return ov?.useCustom ? ov : this.globalColorOpts();
  }

  private readMeasureOverride(vs: DataViewMetadataColumn): MeasureFormatOverride {
    const persisted = (vs.objects as unknown as {
      values?: { useCustom?: unknown; displayUnits?: unknown; decimals?: unknown };
    })?.values;
    const units = String(persisted?.displayUnits ?? "auto");
    const decimals = Number(persisted?.decimals);
    const scenario = String(
      (persisted as { scenario?: unknown } | undefined)?.scenario ?? "auto"
    );
    return {
      useCustom: persisted?.useCustom === true,
      units: (DISPLAY_UNIT_VALUES as readonly string[]).includes(units) ? units : "auto",
      decimals: Number.isFinite(decimals) ? Math.min(6, Math.max(0, decimals)) : 0,
      scenario: ["auto", "AC", "PY", "BU", "FC", "none"].includes(scenario) ? scenario : "auto"
    };
  }

  /** Resolve the (units, decimals) pair for a measure: its override when
   *  enabled, otherwise the global Values-card settings. */
  private measureFormat(parsed: ParseResult, mi: number): { units: string; decimals: number } {
    const ov = parsed.measureOverrides[mi];
    if (ov?.useCustom) return { units: ov.units, decimals: ov.decimals };
    const fs = this.formattingSettings;
    return {
      units: String(fs.values.displayUnits.value?.value ?? "auto"),
      decimals: Number(fs.values.decimals.value) || 0
    };
  }

  /** Rebuild the dynamic per-measure groups on the Values + Cell colors cards. */
  private buildPerMeasureValueGroups(parsed: ParseResult): void {
    const card = this.formattingSettings.values;
    card.groups = [card.globalGroup];
    const colorCard = this.formattingSettings.cellColors;
    colorCard.groups = [colorCard.globalGroup];
    parsed.valueSources.forEach((vs, i) => {
      if (!vs.queryName) return;
      const label = vs.displayName ?? `Measure ${i + 1}`;
      card.groups.push(makePerMeasureValueGroup(i, label, vs.queryName, parsed.measureOverrides[i]));
      colorCard.groups.push(
        makePerMeasureColorGroup(i, label, vs.queryName, parsed.measureColorOverrides[i])
      );
    });
  }

  private buildEmptyParseResult(): ParseResult {
    return {
      rows: [],
      leaves: [],
      headerRows: [],
      renderLeafIdxs: [],
      valueSources: [],
      rowLevels: [],
      measureOverrides: [],
      measureStats: [],
      measureColorOverrides: [],
      renderCols: [],
      calcDefs: [],
      calcLookups: new Map(),
      measureScenarios: [],
      calcMaxAbs: []
    };
  }

  private buildRowSelectionIds(parsed: ParseResult): void {
    this.rowSelectionIds = parsed.rows.map((r) => {
      if (r.isSubtotal || !r.node.identity) return null;
      try {
        const builder = this.host.createSelectionIdBuilder() as unknown as {
          withMatrixNode?: (node: unknown, levels: unknown) => { createSelectionId: () => ISelectionId };
        };
        if (typeof builder.withMatrixNode !== "function") return null;
        return builder.withMatrixNode(r.node, parsed.rowLevels).createSelectionId();
      } catch {
        return null;
      }
    });
    this.selectedRowKeys.clear();
  }

  // ---------- Rendering ----------

  private renderEmpty(message: string): void {
    const div = document.createElement("div");
    div.className = "em-empty";
    div.textContent = message;
    this.applyThemeVars();
    this.target.replaceChildren(div);
  }

  private renderFromInput(input: RenderInput): void {
    const { parsed } = input;
    const fs = this.formattingSettings;

    this.applyThemeVars();

    const density = String(fs.general.density.value?.value ?? "normal");
    this.target.classList.toggle("em-density-compact", density === "compact");
    this.target.classList.toggle("em-density-comfortable", density === "comfortable");

    const scroll = document.createElement("div");
    scroll.className = "em-scroll";
    scroll.addEventListener("scroll", this.handleScroll);

    const table = document.createElement("table");
    table.className = "em-table";
    const textSize = Number(fs.general.textSize.value) || 11;
    table.style.fontSize = `${textSize}px`;
    table.setAttribute("aria-label", this.localize("Visual_AriaMatrix", "Matrix"));

    const rotation = String(fs.columnHeaders.rotation.value?.value ?? "0");
    if (rotation === "45") table.classList.add("em-rot45");
    else if (rotation === "90") table.classList.add("em-rot90");

    const rowPadding = Number(fs.general.rowPadding.value) || 0;
    if (rowPadding > 0) {
      this.target.style.setProperty("--em-pad-y", `${rowPadding}px`);
      this.rowHeightPx = Math.round(textSize * 1.45) + rowPadding * 2 + 1;
    } else {
      this.target.style.removeProperty("--em-pad-y");
      this.rowHeightPx = estimateRowHeight(textSize, density);
    }
    const tbody = document.createElement("tbody");
    this.scrollEl = scroll;
    this.tbodyEl = tbody;
    this.currentWindow = this.windowFor(input, 0);
    this.fillTbody(tbody, parsed, this.currentWindow);

    table.appendChild(this.buildThead(parsed));
    table.appendChild(tbody);
    scroll.appendChild(table);
    this.target.replaceChildren(scroll);
    this.applySelectionVisuals();
  }

  private windowFor(input: RenderInput, scrollTop: number): WindowSpec {
    const total = input.parsed.rows.length;
    if (total <= VIRTUALIZE_THRESHOLD) {
      return { start: 0, end: total, topPad: 0, bottomPad: 0 };
    }
    return computeWindow(scrollTop, input.height, this.rowHeightPx, total, OVERSCAN_ROWS);
  }

  private handleScroll = (): void => {
    const input = this.lastValidRenderInput;
    if (!input || !this.scrollEl || !this.tbodyEl) return;
    if (input.parsed.rows.length <= VIRTUALIZE_THRESHOLD) return;
    const next = this.windowFor(input, this.scrollEl.scrollTop);
    if (this.currentWindow && next.start === this.currentWindow.start && next.end === this.currentWindow.end) {
      return;
    }
    this.currentWindow = next;
    this.fillTbody(this.tbodyEl, input.parsed, next);
    this.applySelectionVisuals();
  };

  private buildThead(parsed: ParseResult): HTMLTableSectionElement {
    const ch = this.formattingSettings.columnHeaders;
    const hc = this.isHighContrast;
    const chColor = hc ? "" : safeHexOrEmpty(ch.fontColor.value?.value);
    const chBg = hc ? "" : safeHexOrEmpty(ch.backColor.value?.value);
    const chBold = ch.bold.value === true;
    const chItalic = ch.italic.value === true;
    const alignment = String(ch.alignment.value?.value ?? "center");

    const thead = document.createElement("thead");
    const headerRowCount = Math.max(parsed.headerRows.length, 1);
    parsed.headerRows.forEach((cells, levelIdx) => {
      const tr = document.createElement("tr");
      if (levelIdx === 0) {
        const corner = document.createElement("th");
        corner.className = "em-rowheader em-corner";
        corner.rowSpan = headerRowCount;
        if (chBg) corner.style.backgroundColor = chBg;
        tr.appendChild(corner);
      }
      for (const cell of cells) {
        const th = document.createElement("th");
        const label = document.createElement("span");
        label.className = "em-hlabel";
        label.textContent = cell.label;
        th.appendChild(label);
        if (cell.span > 1) th.colSpan = cell.span;
        th.setAttribute("scope", "col");
        th.style.textAlign = alignment;
        th.style.fontWeight = chBold ? "700" : "400";
        if (chItalic) th.style.fontStyle = "italic";
        if (chColor) th.style.color = chColor;
        if (chBg) th.style.backgroundColor = chBg;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    });

    // IBCS scenario decorations on the measure-level header row (only when
    // its cells map 1:1 onto the grid columns).
    if (this.formattingSettings.ibcs.enabled.value === true && !this.isHighContrast) {
      const lastRow = thead.lastElementChild;
      const cells = lastRow ? Array.from(lastRow.querySelectorAll("th:not(.em-corner)")) : [];
      if (cells.length === parsed.renderCols.length) {
        cells.forEach((cell, idx) => {
          const col = parsed.renderCols[idx];
          if (col.kind === "leaf") {
            const sc = parsed.measureScenarios[parsed.leaves[col.leafIdx].measureIndex];
            if (sc) cell.classList.add(`ibcs-${sc.toLowerCase()}`);
          }
        });
      }
    }
    return thead;
  }

  private makeSpacerRow(height: number, colCount: number): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "em-spacer";
    const td = document.createElement("td");
    td.colSpan = colCount;
    td.style.height = `${height}px`;
    td.style.padding = "0";
    td.style.border = "none";
    tr.appendChild(td);
    return tr;
  }

  private fillTbody(tbody: HTMLTableSectionElement, parsed: ParseResult, spec: WindowSpec): void {
    const dataMaxAbs = computeMaxAbs(parsed.rows);
    const colCount = parsed.renderCols.length + 1;
    const rh = this.formattingSettings.rowHeaders;
    const indentRaw = Number(rh.indent.value);
    const indent = Number.isFinite(indentRaw) ? Math.max(0, indentRaw) : 16;
    const rhColor = this.isHighContrast ? "" : safeHexOrEmpty(rh.fontColor.value?.value);
    const rhBold = rh.bold.value === true;
    const rhItalic = rh.italic.value === true;
    const ibcsOn = this.formattingSettings.ibcs.enabled.value === true && !this.isHighContrast;
    tbody.replaceChildren();
    if (spec.topPad > 0) tbody.appendChild(this.makeSpacerRow(spec.topPad, colCount));

    for (let rIdx = spec.start; rIdx < spec.end; rIdx++) {
      const row = parsed.rows[rIdx];
      const tr = document.createElement("tr");
      tr.setAttribute("data-row-idx", String(rIdx));
      tr.setAttribute("tabindex", "0");
      if (row.isSubtotal) tr.classList.add("em-subtotal");
      if (row.isExpandable) {
        tr.setAttribute("aria-expanded", row.isCollapsed ? "false" : "true");
      }

      const th = document.createElement("th");
      th.className = "em-rowheader";
      th.setAttribute("scope", "row");
      th.style.paddingLeft = `${8 + row.level * indent}px`;
      if (rhBold) th.style.fontWeight = "700";
      if (rhItalic) th.style.fontStyle = "italic";
      if (rhColor) th.style.color = rhColor;
      if (row.isExpandable) {
        const chevron = document.createElement("span");
        chevron.className = "em-chevron";
        chevron.setAttribute("data-toggle-idx", String(rIdx));
        chevron.setAttribute("role", "button");
        chevron.setAttribute("tabindex", "-1");
        chevron.textContent = row.isCollapsed ? "▸" : "▾";
        th.appendChild(chevron);
      }
      th.appendChild(document.createTextNode(row.label));
      tr.appendChild(th);

      const ariaParts: string[] = [row.label];
      for (const col of parsed.renderCols) {
        if (col.kind === "calc") {
          tr.appendChild(this.buildCalcCell(parsed, row, col, ariaParts));
          continue;
        }
        const leafIdx = col.leafIdx;
        const leaf = parsed.leaves[leafIdx];
        const td = document.createElement("td");
        td.setAttribute("data-cell", "1");
        td.setAttribute("data-leaf-idx", String(leafIdx));
        if (ibcsOn) {
          const sc = parsed.measureScenarios[leaf.measureIndex];
          if (sc === "PY" || sc === "FC") td.classList.add(`ibcs-${sc.toLowerCase()}`);
        }
        const raw = row.cells[leafIdx];
        if (typeof raw === "number") {
          const fmt = this.measureFormat(parsed, leaf.measureIndex);
          const formatted = formatActualLabel({
            value: raw,
            modelFormat: parsed.valueSources[leaf.measureIndex]?.format ?? "",
            cardUnits: fmt.units,
            cardDecimals: fmt.decimals,
            autoDecimals: 0,
            locale: this.locale,
            dataMaxAbs
          });
          td.textContent = formatted;
          ariaParts.push(formatted);
          if (!row.isSubtotal && !this.isHighContrast) {
            const copts = this.measureColorOpts(parsed, leaf.measureIndex);
            if (copts.mode !== "none") {
              const paint = resolveCellColor(raw, parsed.measureStats[leaf.measureIndex], copts);
              if (paint.bg) {
                td.style.backgroundColor = paint.bg;
                if (paint.fg) td.style.color = paint.fg;
              }
            }
          }
        } else if (raw !== null) {
          td.textContent = String(raw);
        }
        tr.appendChild(td);
      }
      tr.setAttribute("aria-label", ariaParts.join(", "));
      tbody.appendChild(tr);
    }
    if (spec.bottomPad > 0) tbody.appendChild(this.makeSpacerRow(spec.bottomPad, colCount));
  }

  private applyThemeVars(): void {
    this.target.classList.toggle("em-hc", this.isHighContrast);
    if (this.isHighContrast) {
      this.target.style.setProperty("--em-fg", this.hcForeground);
      this.target.style.setProperty("--em-bg", this.hcBackground);
      this.target.style.setProperty("--em-accent", this.hcHyperlink);
    } else {
      this.target.style.removeProperty("--em-fg");
      this.target.style.removeProperty("--em-bg");
      this.target.style.removeProperty("--em-accent");
    }
  }

  private applySelectionVisuals(): void {
    const rows = this.target.querySelectorAll("tr[data-row-idx]");
    rows.forEach((tr) => {
      const idx = parseInt(tr.getAttribute("data-row-idx") || "-1", 10);
      const id = this.rowSelectionIds[idx];
      const key = id ? this.selectionKey(id) : null;
      const selected = key !== null && this.selectedRowKeys.has(key);
      tr.classList.toggle("em-selected", selected);
      tr.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  private selectionKey(id: ISelectionId): string {
    const withKey = id as unknown as { getKey?: () => string };
    return typeof withKey.getKey === "function" ? withKey.getKey() : String(id);
  }

  // ---------- Interactions ----------

  private handleClick = (e: MouseEvent): void => {
    if (!this.allowInteractions) return;

    const toggle = (e.target as Element)?.closest?.("[data-toggle-idx]") as Element | null;
    if (toggle) {
      const idx = parseInt(toggle.getAttribute("data-toggle-idx") || "-1", 10);
      const id = this.rowSelectionIds[idx];
      if (id) {
        const sm = this.selectionManager as unknown as {
          toggleExpandCollapse?: (id: ISelectionId) => Promise<void>;
        };
        sm.toggleExpandCollapse?.(id);
      }
      e.stopPropagation();
      return;
    }

    const rowEl = (e.target as Element)?.closest?.("tr[data-row-idx]") as Element | null;
    if (!rowEl) {
      if (this.selectedRowKeys.size > 0) {
        this.selectedRowKeys.clear();
        this.selectionManager.clear().then(() => this.applySelectionVisuals());
      }
      return;
    }
    const idx = parseInt(rowEl.getAttribute("data-row-idx") || "-1", 10);
    const id = this.rowSelectionIds[idx];
    if (!id) return;
    this.selectOrToggle(id, e.ctrlKey || e.metaKey || e.shiftKey);
  };

  private selectOrToggle(id: ISelectionId, multi: boolean): void {
    const key = this.selectionKey(id);
    const alreadySelected = this.selectedRowKeys.has(key);

    if (alreadySelected && !multi && this.selectedRowKeys.size === 1) {
      // Click-twice-to-clear.
      this.selectedRowKeys.clear();
      this.selectionManager.clear().then(() => this.applySelectionVisuals());
      return;
    }
    if (!multi) this.selectedRowKeys.clear();
    if (alreadySelected && multi) {
      this.selectedRowKeys.delete(key);
    } else {
      this.selectedRowKeys.add(key);
    }
    this.selectionManager.select(id, multi).then(() => this.applySelectionVisuals());
  }

  private handleContextMenu = (e: MouseEvent): void => {
    const rowEl = (e.target as Element)?.closest?.("tr[data-row-idx]") as Element | null;
    const idx = rowEl ? parseInt(rowEl.getAttribute("data-row-idx") || "-1", 10) : -1;
    const id = idx >= 0 ? this.rowSelectionIds[idx] : null;
    e.preventDefault();
    this.selectionManager.showContextMenu(id ?? ({} as ISelectionId), {
      x: e.clientX,
      y: e.clientY
    });
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.tooltipService?.enabled()) return;
    const cell = (e.target as Element)?.closest?.("td[data-cell]") as Element | null;
    if (!cell) {
      this.tooltipService.hide({ immediately: false, isTouchEvent: false });
      return;
    }
    const rowEl = cell.closest("tr[data-row-idx]") as Element | null;
    const rIdx = rowEl ? parseInt(rowEl.getAttribute("data-row-idx") || "-1", 10) : -1;
    const leafIdx = parseInt(cell.getAttribute("data-leaf-idx") || "-1", 10);
    const input = this.lastValidRenderInput;
    if (!input || rIdx < 0 || leafIdx < 0) return;

    const items = this.buildTooltipItems(input.parsed, rIdx, leafIdx);
    if (items.length === 0) return;
    const id = this.rowSelectionIds[rIdx];
    this.tooltipService.show({
      dataItems: items,
      identities: id ? [id] : [],
      coordinates: [e.clientX, e.clientY],
      isTouchEvent: false
    });
  };

  private handleMouseLeave = (): void => {
    if (this.tooltipService?.enabled()) {
      this.tooltipService.hide({ immediately: true, isTouchEvent: false });
    }
  };

  private buildTooltipItems(
    parsed: ParseResult,
    rIdx: number,
    leafIdx: number
  ): VisualTooltipDataItem[] {
    const row = parsed.rows[rIdx];
    const leaf = parsed.leaves[leafIdx];
    if (!row || !leaf) return [];
    const items: VisualTooltipDataItem[] = [];
    if (row.label) {
      items.push({ displayName: "", value: row.label });
    }
    const dataMaxAbs = computeMaxAbs(parsed.rows);

    const pushMeasure = (mi: number, cellKeyLeafIdx: number): void => {
      const raw = row.cells[cellKeyLeafIdx];
      if (raw === null) return;
      const name = parsed.valueSources[mi]?.displayName ?? "";
      const fmt = this.measureFormat(parsed, mi);
      const value =
        typeof raw === "number"
          ? formatActualLabel({
              value: raw,
              modelFormat: parsed.valueSources[mi]?.format ?? "",
              cardUnits: fmt.units,
              cardDecimals: fmt.decimals,
              autoDecimals: 0,
              locale: this.locale,
              dataMaxAbs
            })
          : String(raw);
      items.push({ displayName: name, value });
    };

    pushMeasure(leaf.measureIndex, leafIdx);

    // Tooltip-role measures sharing the same column-group path.
    for (let i = 0; i < parsed.leaves.length; i++) {
      if (parsed.renderLeafIdxs.includes(i)) continue;
      const other = parsed.leaves[i];
      if (other.path.join(" ") === leaf.path.join(" ")) {
        pushMeasure(other.measureIndex, i);
      }
    }
    return items;
  }

  private handleKeydown = (e: KeyboardEvent): void => {
    const rowEl = (e.target as Element)?.closest?.("tr[data-row-idx]") as HTMLElement | null;
    if (!rowEl) return;
    const idx = parseInt(rowEl.getAttribute("data-row-idx") || "-1", 10);

    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const next = this.target.querySelector(
          `tr[data-row-idx="${e.key === "ArrowDown" ? idx + 1 : idx - 1}"]`
        ) as HTMLElement | null;
        if (next) {
          next.focus();
          e.preventDefault();
        }
        break;
      }
      case "Home":
      case "End": {
        const rows = this.target.querySelectorAll("tr[data-row-idx]");
        const next = (e.key === "Home" ? rows[0] : rows[rows.length - 1]) as HTMLElement | null;
        if (next) {
          next.focus();
          e.preventDefault();
        }
        break;
      }
      case "Enter":
      case " ": {
        if (!this.allowInteractions) break;
        const id = this.rowSelectionIds[idx];
        if (id) {
          this.selectOrToggle(id, e.ctrlKey || e.metaKey || e.shiftKey);
          e.preventDefault();
        }
        break;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        if (!this.allowInteractions) break;
        const input = this.lastValidRenderInput;
        const row = input?.parsed.rows[idx];
        if (row?.isExpandable) {
          const wantsExpand = e.key === "ArrowRight";
          if (wantsExpand === row.isCollapsed) {
            const id = this.rowSelectionIds[idx];
            if (id) {
              const sm = this.selectionManager as unknown as {
                toggleExpandCollapse?: (id: ISelectionId) => Promise<void>;
              };
              sm.toggleExpandCollapse?.(id);
              e.preventDefault();
            }
          }
        }
        break;
      }
      case "Escape": {
        if (this.selectedRowKeys.size > 0) {
          this.selectedRowKeys.clear();
          this.selectionManager.clear().then(() => this.applySelectionVisuals());
          e.preventDefault();
        }
        break;
      }
      default:
        break;
    }
  };

  // ---------- Helpers ----------

  private localize(key: string, fallback: string): string {
    const resolved = this.localizationManager?.getDisplayName?.(key);
    return resolved && resolved !== key ? resolved : fallback;
  }
}

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
import {
  barWidthPct,
  detectScenario,
  IbcsScenario,
  IbcsTemplate,
  pinPosPct,
  scenarioRank,
  segmentGeometry,
  templateVarianceSpecs,
  waterfallMaxAbs,
  waterfallStarts
} from "./ibcs";
import {
  CustomRowDef,
  parseCustomRowsState,
  serializeCustomRowsState,
  weaveCustomRows,
  WovenRow
} from "./customRows";
import {
  commentMeasureIndexes,
  extractRowComments,
  parseCommentMarkup,
  plainCommentText,
  RowComment
} from "./comments";
import {
  columnKeyForCalc,
  columnKeyForLeaf,
  COMMENTS_COL_KEY,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  parseColumnWidthsState,
  parseRowStylesState,
  ROW_HEADER_COL_KEY,
  RowAlign,
  RowBorderDef,
  RowStyleDef,
  serializeColumnWidthsState,
  serializeRowStylesState
} from "./layout";

interface CalcDef {
  name: string;
  format: string;
  display: string;
  /** Explicit +/- sign on formatted values (IBCS-style, default on). */
  signed: boolean;
  refs: string[];
  evaluate: (lookup: (ref: string) => number | null) => number | null;
}

type RenderCol =
  | { kind: "leaf"; leafIdx: number }
  | { kind: "calc"; calcIdx: number; path: string[]; pathKey: string }
  | { kind: "gap" };

/** Expand/collapse icon pairs (collapsed, expanded) — Format → Row headers. */
const EXPAND_ICONS: Record<string, [string, string]> = {
  chevron: ["▸", "▾"],
  plusminus: ["+", "−"],
  boxed: ["⊞", "⊟"],
  arrows: ["►", "▼"]
};
import {
  buildHeaderRows,
  computeMaxAbs,
  flattenColumns,
  flattenRows,
  pruneColumnTree,
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
  /** T04 waterfall runs: start offset per row, keyed `${calcIdx}|${pathKey}`. */
  calcWaterfall: Map<string, (number | null)[]>;
  /** Per-row data comments (comments-role measures) — aligned with rows. */
  rowComments: RowComment[][];
  hasComments: boolean;
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

  private customRows: CustomRowDef[] = [];
  private customRowsDirty: boolean = false;
  private rowPathKeys: string[] = [];
  private editPanelOpen: boolean = false;
  private commentsPanelOpen: boolean = false;
  private lastUpdateOptions: VisualUpdateOptions | null = null;

  private rowStyles: RowStyleDef[] = [];
  private rowStylesDirty: boolean = false;
  private colWidths: Record<string, number> = {};
  private colWidthsDirty: boolean = false;
  /** colgroup cols of the current render, keyed by column identity. */
  private colEls: Map<string, HTMLTableColElement> = new Map();
  private tableEl: HTMLTableElement | null = null;
  private drag: {
    key: string;
    startX: number;
    startWidth: number;
    startTableWidth: number;
    colEl: HTMLTableColElement;
  } | null = null;

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
    this.target.addEventListener("mousedown", this.handleGripDown);
    this.target.addEventListener("dblclick", this.handleDblClick);

    // Never visually blank before the first update().
    this.renderEmpty(this.localize("Visual_Empty", "Select or drag fields to populate this visual"));
  }

  public update(options: VisualUpdateOptions): void {
    const eventService = this.host.eventService;
    eventService?.renderingStarted(options);
    this.lastUpdateOptions = options;
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
    document.removeEventListener("mousemove", this.handleGripMove);
    document.removeEventListener("mouseup", this.handleGripUp);
    this.drag = null;
    this.colEls.clear();
    this.tableEl = null;
    this.lastValidRenderInput = null;
    this.rowSelectionIds = [];
    this.selectedRowKeys.clear();
    this.scrollEl = null;
    this.tbodyEl = null;
    this.currentWindow = null;
    this.target.replaceChildren();
  }

  private handleDblClick = (e: MouseEvent): void => {
    const grip = (e.target as Element)?.closest?.(".em-colgrip") as HTMLElement | null;
    if (grip) this.handleGripReset(grip);
  };

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
    let rows: RowModel[] = flattenRows(rowRoot, leaves, totalLabel);
    if (rows.length === 0) {
      return this.buildEmptyParseResult();
    }

    rows = this.applyCustomRows(dv, rows, leaves.length);

    // Tooltip-only and comments-role measures never render as grid columns
    // (they surface in tooltips / markers / the comments layer instead) but
    // keep their global DFS cellKey — cell keys are never re-indexed.
    const isAuxOnly = (mi: number): boolean => {
      const roles = valueSources[mi]?.roles;
      return (roles?.tooltips === true || roles?.comments === true) && roles?.values !== true;
    };
    const renderLeafIdxs: number[] = [];
    for (let i = 0; i < leaves.length; i++) {
      if (!isAuxOnly(leaves[i].measureIndex)) renderLeafIdxs.push(i);
    }

    const commentIdxs = commentMeasureIndexes(valueSources);
    const rowComments = extractRowComments(rows, leaves, commentIdxs);
    const hasComments = rowComments.some((c) => c.length > 0);

    let headerRows = this.buildHeaderRowsFor(
      colRoot,
      leaves,
      renderLeafIdxs,
      valueSources,
      measureNames,
      totalLabel,
      isAuxOnly
    );

    const measureOverrides = valueSources.map((vs) => this.readMeasureOverride(vs));
    const measureColorOverrides = valueSources.map((vs) => this.readMeasureColorOverride(vs));
    const { measureScenarios, templateDefs, orderedLeafIdxs } = this.resolveTemplatePlan(
      valueSources,
      measureOverrides,
      leaves,
      renderLeafIdxs,
      measureNames,
      isAuxOnly
    );

    const calcDefs = [...templateDefs, ...this.readCalcDefs()];
    const rc = this.buildRenderColumns(leaves, orderedLeafIdxs, measureNames, calcDefs);
    const renderCols = rc.renderCols;
    const calcLookups = rc.calcLookups;
    if (rc.flatHeader) headerRows = [rc.flatHeader];

    const { calcMaxAbs, calcWaterfall } = this.computeCalcDomains(
      calcDefs,
      renderCols,
      calcLookups,
      rows
    );

    const measureStats = this.computeMeasureStats(valueSources, leaves, rows);

    return {
      rows,
      leaves,
      headerRows,
      renderLeafIdxs: orderedLeafIdxs,
      valueSources,
      rowLevels,
      measureOverrides,
      measureStats,
      measureColorOverrides,
      renderCols,
      calcDefs,
      calcLookups,
      measureScenarios,
      calcMaxAbs,
      calcWaterfall,
      rowComments,
      hasComments
    };
  }

  /** Per-measure min/max over detail rows — the heat-map domain (subtotal
   *  and custom rows excluded). */
  private computeMeasureStats(
    valueSources: DataViewMetadataColumn[],
    leaves: ColumnLeaf[],
    rows: RowModel[]
  ): MeasureStats[] {
    const measureStats: MeasureStats[] = valueSources.map(() => ({ min: Infinity, max: -Infinity }));
    for (const r of rows) {
      if (r.isSubtotal || (r as WovenRow).customDef) continue;
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
    return measureStats;
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
    const groupCount = new Set(renderLeafIdxs.map((li) => leaves[li].path.join(" "))).size;
    const gapsOn =
      this.formattingSettings.grid.gapColumns.value === true && groupCount > 1;
    if (calcDefs.length === 0 && !gapsOn) {
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
      // Aeration: a blank column between column groups (never after the last).
      if (gapsOn && i < renderLeafIdxs.length) renderCols.push({ kind: "gap" });
    }
    const flatHeader: HeaderCell[] = renderCols.map((col) => {
      if (col.kind === "gap") {
        return { label: "", span: 1, isSubtotal: false, isGap: true };
      }
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

  /** Custom rows (Excel-style ad-hoc subtotals / formula rows) — persisted
   *  as JSON in the report definition, woven after their anchor rows. */
  private applyCustomRows(dv: DataView, rows: RowModel[], cellCount: number): RowModel[] {
    const objects = dv.metadata?.objects as unknown as {
      customRows?: { state?: unknown };
      rowStyles?: { state?: unknown };
      columnWidths?: { state?: unknown };
    };
    const persistedState = objects?.customRows?.state;
    if (this.customRowsDirty) {
      if (
        typeof persistedState === "string" &&
        persistedState === serializeCustomRowsState(this.customRows)
      ) {
        this.customRowsDirty = false;
      }
    } else {
      this.customRows = parseCustomRowsState(persistedState);
    }

    // Per-row style overrides + column widths follow the same
    // persist/echo/dirty pattern as the custom rows.
    const rsRaw = objects?.rowStyles?.state;
    if (this.rowStylesDirty) {
      if (typeof rsRaw === "string" && rsRaw === serializeRowStylesState(this.rowStyles)) {
        this.rowStylesDirty = false;
      }
    } else {
      this.rowStyles = parseRowStylesState(rsRaw);
    }
    const cwRaw = objects?.columnWidths?.state;
    if (this.colWidthsDirty) {
      if (typeof cwRaw === "string" && cwRaw === serializeColumnWidthsState(this.colWidths)) {
        this.colWidthsDirty = false;
      }
    } else {
      this.colWidths = parseColumnWidthsState(cwRaw);
    }

    const woven = weaveCustomRows(rows, this.customRows, cellCount);
    let outRows: RowModel[] = woven.rows;
    let outKeys = woven.keys;

    // Aeration: a blank spacer row before every top-level group.
    if (this.formattingSettings.general.blankRowBeforeGroups.value === true) {
      const rowsOut: RowModel[] = [];
      const keysOut: string[] = [];
      let n = 0;
      outRows.forEach((row, i) => {
        const isBlank = (row as { blankRow?: boolean }).blankRow === true;
        if (i > 0 && row.level === 0 && !row.isSubtotal && !isBlank && row.isExpandable) {
          rowsOut.push(this.makeBlankRow(cellCount, ++n));
          keysOut.push(`blank:${n}`);
        }
        rowsOut.push(row);
        keysOut.push(outKeys[i]);
      });
      outRows = rowsOut;
      outKeys = keysOut;
    }

    this.rowPathKeys = outKeys;
    return outRows;
  }

  private makeBlankRow(cellCount: number, n: number): RowModel {
    const row: RowModel & { blankRow?: boolean } = {
      label: "",
      level: 0,
      isSubtotal: false,
      isCollapsed: false,
      isExpandable: false,
      node: {},
      cells: Array.from({ length: cellCount }, () => null)
    };
    row.blankRow = true;
    void n;
    return row;
  }

  /** Blank rows: the automatic before-group spacers and the user-inserted
   *  "spacer" custom rows render the same airy way. */
  private isBlankRow(row: RowModel): boolean {
    return (
      (row as { blankRow?: boolean }).blankRow === true ||
      (row as WovenRow).customDef?.kind === "spacer"
    );
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
        signed: slot.sign.value !== false,
        refs: compiled.refs,
        evaluate: compiled.evaluate
      });
    });
    return out;
  }

  /** Header rows come from the tree. When tooltip-only / comment measures
   *  hide some leaves, prune those measure leaves from a COPY of the tree
   *  so the multi-level header survives; the flat fallback only remains
   *  for shapes pruning can't reconcile (e.g. no measure level at all). */
  private buildHeaderRowsFor(
    colRoot: MatrixNodeLike | undefined,
    leaves: ColumnLeaf[],
    renderLeafIdxs: number[],
    valueSources: DataViewMetadataColumn[],
    measureNames: string[],
    totalLabel: string,
    isAuxOnly: (mi: number) => boolean
  ): HeaderCell[][] {
    if (renderLeafIdxs.length === leaves.length) {
      return buildHeaderRows(colRoot, measureNames, totalLabel);
    }
    const excluded = new Set<number>();
    for (let mi = 0; mi < valueSources.length; mi++) {
      if (isAuxOnly(mi)) excluded.add(mi);
    }
    const pruned = buildHeaderRows(pruneColumnTree(colRoot, excluded), measureNames, totalLabel);
    const width = pruned.length ? pruned[0].reduce((s, c) => s + c.span, 0) : 0;
    if (width === renderLeafIdxs.length) return pruned;
    return [
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

  /** Scenario resolution + IBCS-template column plan: synthesized variance
   *  defs (T01-T04) and the AC·PY·PL leaf order per column group. Needs a
   *  detected AC and at least one PY/PL base among the values-role
   *  measures; otherwise the template is silently inert. */
  private resolveTemplatePlan(
    valueSources: DataViewMetadataColumn[],
    measureOverrides: MeasureFormatOverride[],
    leaves: ColumnLeaf[],
    renderLeafIdxs: number[],
    measureNames: string[],
    isAuxOnly: (mi: number) => boolean
  ): {
    measureScenarios: (IbcsScenario | null)[];
    templateDefs: CalcDef[];
    orderedLeafIdxs: number[];
  } {
    const measureScenarios: (IbcsScenario | null)[] = valueSources.map((vs, i) => {
      const ov = measureOverrides[i].scenario;
      if (ov === "none") return null;
      if (ov === "AC" || ov === "PY" || ov === "BU" || ov === "FC") return ov;
      return detectScenario(vs.displayName);
    });

    const templateDefs = this.buildTemplateDefs(
      this.ibcsTemplate(),
      measureScenarios,
      measureNames,
      (mi) => !isAuxOnly(mi)
    );
    if (templateDefs.length === 0) {
      return { measureScenarios, templateDefs, orderedLeafIdxs: renderLeafIdxs };
    }

    const byGroup = new Map<string, number[]>();
    for (const li of renderLeafIdxs) {
      const k = leaves[li].path.join(" ");
      const bucket = byGroup.get(k);
      if (bucket) bucket.push(li);
      else byGroup.set(k, [li]);
    }
    const orderedLeafIdxs: number[] = [];
    for (const idxs of byGroup.values()) {
      orderedLeafIdxs.push(
        ...idxs.sort(
          (a, b) =>
            scenarioRank(measureScenarios[leaves[a].measureIndex]) -
              scenarioRank(measureScenarios[leaves[b].measureIndex]) || a - b
        )
      );
    }
    return { measureScenarios, templateDefs, orderedLeafIdxs };
  }

  /** The IBCS table template chosen on the Format pane. */
  private ibcsTemplate(): IbcsTemplate {
    const t = String(this.formattingSettings.ibcs.template.value?.value ?? "none");
    return t === "t01" || t === "t02" || t === "t03" || t === "t04" ? t : "none";
  }

  /** IBCS decorations (header semantics, PY/FC cell styling) are on when
   *  explicitly enabled OR implied by an active table template. */
  private ibcsActive(): boolean {
    return (
      (this.formattingSettings.ibcs.enabled.value === true || this.ibcsTemplate() !== "none") &&
      !this.isHighContrast
    );
  }

  /** Compile the variance columns a template synthesizes (ΔPY, ΔPY %, ΔPL,
   *  ΔPL %) from the FIRST values-role measure detected per scenario. */
  private buildTemplateDefs(
    template: IbcsTemplate,
    scenarios: (IbcsScenario | null)[],
    measureNames: string[],
    eligible: (mi: number) => boolean
  ): CalcDef[] {
    if (template === "none") return [];
    const nameOf = (s: IbcsScenario): string | undefined => {
      for (let i = 0; i < scenarios.length; i++) {
        if (scenarios[i] === s && eligible(i)) return measureNames[i];
      }
      return undefined;
    };
    const specs = templateVarianceSpecs(template, nameOf("AC"), nameOf("PY"), nameOf("BU"));
    const out: CalcDef[] = [];
    for (const spec of specs) {
      const compiled = compileExpression(spec.formula);
      if (!compiled.ok) continue;
      out.push({
        name: spec.name,
        format: spec.format,
        display: spec.display,
        signed: true,
        refs: compiled.refs,
        evaluate: compiled.evaluate
      });
    }
    return out;
  }

  /** Domains of the graphical calc displays: |max| per column for bars and
   *  pins, cumulative run + edge domain for T04 waterfalls. */
  private computeCalcDomains(
    calcDefs: CalcDef[],
    renderCols: RenderCol[],
    calcLookups: Map<string, Map<string, number>>,
    rows: RowModel[]
  ): { calcMaxAbs: number[]; calcWaterfall: Map<string, (number | null)[]> } {
    const calcMaxAbs = calcDefs.map(() => 0);
    const calcWaterfall = new Map<string, (number | null)[]>();
    if (!calcDefs.some((d) => d.display !== "number")) {
      return { calcMaxAbs, calcWaterfall };
    }
    for (const col of renderCols) {
      if (col.kind !== "calc") continue;
      const def = calcDefs[col.calcIdx];
      if (def.display === "bar" || def.display === "pin") {
        for (const row of rows) {
          if (row.isSubtotal || (row as WovenRow).customDef) continue;
          const v = this.evalCalc(def, calcLookups.get(col.pathKey), row);
          if (v !== null) {
            const a = Math.abs(v);
            if (a > calcMaxAbs[col.calcIdx]) calcMaxAbs[col.calcIdx] = a;
          }
        }
      } else if (def.display === "waterfall") {
        const values = rows.map((row) =>
          (row as WovenRow).customDef ? null : this.evalCalc(def, calcLookups.get(col.pathKey), row)
        );
        const starts = waterfallStarts(
          values,
          rows.map((r) => r.isSubtotal)
        );
        calcWaterfall.set(`${col.calcIdx}|${col.pathKey}`, starts);
        const m = waterfallMaxAbs(values, starts);
        if (m > calcMaxAbs[col.calcIdx]) calcMaxAbs[col.calcIdx] = m;
      }
    }
    return { calcMaxAbs, calcWaterfall };
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
      withSign: def.signed
    });
  }

  private buildCalcCell(
    parsed: ParseResult,
    row: RowModel,
    rIdx: number,
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

    const maxAbs = parsed.calcMaxAbs[col.calcIdx];
    const wfStart =
      def.display === "waterfall"
        ? parsed.calcWaterfall.get(`${col.calcIdx}|${col.pathKey}`)?.[rIdx] ?? null
        : null;
    if (def.display === "number" || (def.display === "waterfall" && wfStart === null)) {
      td.textContent = formatted;
      return td;
    }

    // Graphical variance (IBCS): bar / pin / waterfall on a shared zero
    // axis, good/bad semantic colours (Format → IBCS).
    td.classList.add("em-barcell");
    const flex = document.createElement("div");
    flex.className = "em-barflex";
    const wrap = document.createElement("div");
    wrap.className = "em-barwrap";

    if (def.display === "bar") {
      const bar = document.createElement("div");
      bar.className = v >= 0 ? "em-bar em-bar-pos" : "em-bar em-bar-neg";
      bar.style.width = `${barWidthPct(v, maxAbs) / 2}%`;
      if (this.isHighContrast) bar.style.backgroundColor = this.hcForeground;
      wrap.appendChild(bar);
    } else if (def.display === "pin") {
      const pos = pinPosPct(v, maxAbs);
      wrap.classList.add(v >= 0 ? "em-pin-pos" : "em-pin-neg");
      const line = document.createElement("div");
      line.className = "em-pinline";
      line.style.left = `${Math.min(50, pos)}%`;
      line.style.width = `${Math.abs(pos - 50)}%`;
      const dot = document.createElement("div");
      dot.className = "em-pindot";
      dot.style.left = `${pos}%`;
      if (this.isHighContrast) {
        line.style.backgroundColor = this.hcForeground;
        dot.style.backgroundColor = this.hcForeground;
      }
      wrap.appendChild(line);
      wrap.appendChild(dot);
    } else {
      // T04 waterfall: detail bars cascade, subtotal bars re-anchor at zero.
      const geo = segmentGeometry(wfStart as number, v, maxAbs);
      const bar = document.createElement("div");
      bar.className = v >= 0 ? "em-bar em-bar-wf em-bar-wf-pos" : "em-bar em-bar-wf em-bar-wf-neg";
      bar.style.left = `${geo.leftPct}%`;
      bar.style.width = `${geo.widthPct}%`;
      if (this.isHighContrast) bar.style.backgroundColor = this.hcForeground;
      wrap.appendChild(bar);
    }

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
    const alignment = String(
      (persisted as { alignment?: unknown } | undefined)?.alignment ?? "auto"
    );
    const fcRaw = (persisted as { fontColor?: unknown } | undefined)?.fontColor;
    const fontColor = safeHexOrEmpty(
      typeof (fcRaw as { solid?: { color?: unknown } })?.solid?.color === "string"
        ? String((fcRaw as { solid: { color: string } }).solid.color)
        : ""
    );
    return {
      useCustom: persisted?.useCustom === true,
      units: (DISPLAY_UNIT_VALUES as readonly string[]).includes(units) ? units : "auto",
      decimals: Number.isFinite(decimals) ? Math.min(6, Math.max(0, decimals)) : 0,
      scenario: ["auto", "AC", "PY", "BU", "FC", "none"].includes(scenario) ? scenario : "auto",
      alignment: ["auto", "left", "center", "right"].includes(alignment) ? alignment : "auto",
      fontColor
    };
  }

  /** Column text alignment: per-measure override, else the global Values
   *  choice, else "" (theme default — right for numbers). */
  private measureAlignment(parsed: ParseResult, mi: number): string {
    const per = parsed.measureOverrides[mi]?.alignment ?? "auto";
    if (per !== "auto") return per;
    const global = String(this.formattingSettings.values.alignment.value?.value ?? "auto");
    return global !== "auto" ? global : "";
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
      calcMaxAbs: [],
      calcWaterfall: new Map(),
      rowComments: [],
      hasComments: false
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
    // The estimate bakes in a 1px rule; a thicker horizontal grid adds the
    // difference (the rule stays transparent-but-present when disabled, so
    // row geometry — and the virtualization math — never shifts).
    this.rowHeightPx += this.applyGridOptions();
    // Wrapped row labels: N clamped lines, every row forced to the same
    // height so the virtualization math stays exact.
    const wrapLines = this.rowWrapLines();
    if (wrapLines > 1) this.rowHeightPx += Math.round(textSize * 1.45) * (wrapLines - 1);
    const tbody = document.createElement("tbody");
    this.scrollEl = scroll;
    this.tbodyEl = tbody;
    this.tableEl = table;
    this.currentWindow = this.windowFor(input, 0);

    const colgroup = this.buildColgroup(parsed, table);
    if (colgroup) table.appendChild(colgroup);
    this.fillTbody(tbody, parsed, this.currentWindow);

    table.appendChild(this.buildThead(parsed));
    table.appendChild(tbody);
    scroll.appendChild(table);
    this.target.replaceChildren(scroll);
    this.renderChrome();
    this.applySelectionVisuals();
  }

  /** Push the Grid & borders / spacing / hierarchy / subtotal-style options
   *  onto the root as CSS custom properties + toggle classes. Returns the
   *  extra px the horizontal rule adds to the uniform row height. */
  private applyGridOptions(): number {
    const fs = this.formattingSettings;
    const root = this.target;
    const hc = this.isHighContrast;
    const setVar = (name: string, value: string): void => {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    };
    const clampW = (v: unknown): number => Math.min(4, Math.max(1, Number(v) || 1));

    const g = fs.grid;
    const hWidth = clampW(g.horizontalWidth.value);
    root.classList.toggle("em-nohgrid", g.horizontal.value !== true);
    // Dedicated token: --em-grid also colours panel borders / bar axes,
    // the option must only touch the table's horizontal rules.
    setVar("--em-hgrid-c", hc ? "" : safeHexOrEmpty(g.horizontalColor.value?.value));
    setVar("--em-grid-w", hWidth !== 1 ? `${hWidth}px` : "");
    root.classList.toggle("em-vgrid", g.vertical.value === true);
    setVar("--em-vgrid-c", hc ? "" : safeHexOrEmpty(g.verticalColor.value?.value));
    setVar("--em-vgrid-w", `${clampW(g.verticalWidth.value)}px`);
    root.classList.toggle("em-outer", g.outerBorder.value === true);
    setVar("--em-outer-c", hc ? "" : safeHexOrEmpty(g.outerColor.value?.value));
    setVar("--em-outer-w", `${clampW(g.outerWidth.value)}px`);
    root.classList.toggle("em-noheadrule", g.headerRule.value !== true);

    const padX = this.cellPaddingX();
    setVar("--em-pad-x", padX !== 8 ? `${padX}px` : "");

    const st = fs.subtotalsStyle;
    setVar("--em-total-bg", hc ? "" : safeHexOrEmpty(st.backColor.value?.value));
    setVar("--em-total-fg", hc ? "" : safeHexOrEmpty(st.fontColor.value?.value));
    root.classList.toggle("em-stnobold", st.bold.value !== true);

    const rh = fs.rowHeaders;
    root.classList.toggle("em-nochev", rh.showChevrons.value !== true);
    root.classList.toggle("em-groupbold", rh.groupBold.value === true);
    const groupBg = hc ? "" : safeHexOrEmpty(rh.groupBackColor.value?.value);
    root.classList.toggle("em-groupbg", groupBg !== "");
    setVar("--em-group-bg", groupBg);

    setVar("--em-cmark", hc ? "" : safeHexOrEmpty(fs.comments.markerColor.value?.value));

    // Header separators / top rule / wrapped headers / wrapped row labels.
    const ch = fs.columnHeaders;
    root.classList.toggle("em-hsep", ch.separators.value === true);
    setVar("--em-hsep-c", hc ? "" : safeHexOrEmpty(ch.borderColor.value?.value));
    setVar("--em-hsep-w", `${clampW(ch.borderWidth.value)}px`);
    root.classList.toggle("em-htop", ch.topRule.value === true);
    setVar("--em-htop-c", hc ? "" : safeHexOrEmpty(ch.topColor.value?.value));
    setVar("--em-htop-w", `${clampW(ch.topWidth.value)}px`);
    root.classList.toggle("em-hwrap", ch.wrapText.value === true);
    const wrapLines = this.rowWrapLines();
    root.classList.toggle("em-rwrap", wrapLines > 1);
    setVar("--em-rwrap-lines", wrapLines > 1 ? String(wrapLines) : "");

    // IBCS semantic colours — variance bars, pins, waterfalls, PY styling.
    const ib = fs.ibcs;
    setVar("--em-good", hc ? "" : safeHexOrEmpty(ib.goodColor.value?.value));
    setVar("--em-bad", hc ? "" : safeHexOrEmpty(ib.badColor.value?.value));
    setVar("--em-py", hc ? "" : safeHexOrEmpty(ib.pyColor.value?.value));

    // Banding + sticky row-header column background.
    root.classList.toggle("em-nobands", fs.general.banded.value !== true);
    setVar("--em-band-bg", hc ? "" : safeHexOrEmpty(fs.general.bandColor.value?.value));
    setVar("--em-rowh-bg", hc ? "" : safeHexOrEmpty(rh.backColor.value?.value));

    return hWidth - 1;
  }

  /** Wrapped row labels: 1 (off) to 3 clamped lines. */
  private rowWrapLines(): number {
    const rh = this.formattingSettings.rowHeaders;
    if (rh.wrapText.value !== true) return 1;
    const n = Number(rh.maxLines.value);
    return Number.isFinite(n) ? Math.min(3, Math.max(1, Math.round(n))) : 2;
  }

  /** Horizontal cell padding, clamped — persisted values arrive raw. */
  private cellPaddingX(): number {
    const raw = Number(this.formattingSettings.general.cellPaddingX.value);
    return Number.isFinite(raw) ? Math.min(40, Math.max(0, raw)) : 8;
  }

  // ---------- Column widths (auto / uniform / custom drag) ----------

  private columnWidthMode(): "auto" | "uniform" | "custom" {
    const m = String(this.formattingSettings.columnWidths.mode.value?.value ?? "auto");
    return m === "uniform" || m === "custom" ? m : "auto";
  }

  private uniformWidth(): number {
    const w = Number(this.formattingSettings.columnWidths.uniformWidth.value);
    return Number.isFinite(w) ? Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w)) : 110;
  }

  /** Stable identity of a render column (drag persistence key). */
  private columnKeyFor(parsed: ParseResult, col: RenderCol): string | null {
    if (col.kind === "gap") return null;
    if (col.kind === "calc") return columnKeyForCalc(parsed.calcDefs[col.calcIdx].name);
    const leaf = parsed.leaves[col.leafIdx];
    return columnKeyForLeaf(leaf.path, parsed.valueSources[leaf.measureIndex]?.displayName ?? "");
  }

  /** Fixed-layout colgroup for the uniform/custom modes; null in auto. */
  private buildColgroup(parsed: ParseResult, table: HTMLTableElement): HTMLTableColElement | null {
    this.colEls.clear();
    const mode = this.columnWidthMode();
    if (mode === "auto") return null;
    table.classList.add("em-fixed");
    const gapWidth = Number(this.formattingSettings.grid.gapWidth.value) || 14;
    const colgroup = document.createElement("colgroup");
    let total = 0;
    const addCol = (key: string | null, width: number): void => {
      const col = document.createElement("col");
      col.style.width = `${width}px`;
      colgroup.appendChild(col);
      total += width;
      if (key) this.colEls.set(key, col);
    };
    addCol(ROW_HEADER_COL_KEY, this.colWidths[ROW_HEADER_COL_KEY] ?? 220);
    for (const col of parsed.renderCols) {
      if (col.kind === "gap") {
        addCol(null, Math.min(80, Math.max(2, gapWidth)));
        continue;
      }
      const key = this.columnKeyFor(parsed, col) as string;
      const width =
        mode === "uniform" ? this.uniformWidth() : this.colWidths[key] ?? this.uniformWidth();
      addCol(key, width);
    }
    if (this.commentColumnOn(parsed)) {
      addCol(COMMENTS_COL_KEY, this.colWidths[COMMENTS_COL_KEY] ?? 240);
    }
    table.style.width = `${total}px`;
    return colgroup;
  }

  private handleGripDown = (e: MouseEvent): void => {
    const grip = (e.target as Element)?.closest?.(".em-colgrip") as HTMLElement | null;
    if (!grip || !this.tableEl) return;
    const key = grip.getAttribute("data-col-key");
    const colEl = key ? this.colEls.get(key) : undefined;
    if (!key || !colEl) return;
    e.preventDefault();
    e.stopPropagation();
    this.drag = {
      key,
      startX: e.clientX,
      startWidth: parseFloat(colEl.style.width) || MIN_COL_WIDTH,
      startTableWidth: parseFloat(this.tableEl.style.width) || 0,
      colEl
    };
    document.addEventListener("mousemove", this.handleGripMove);
    document.addEventListener("mouseup", this.handleGripUp);
  };

  private handleGripMove = (e: MouseEvent): void => {
    if (!this.drag || !this.tableEl) return;
    const w = Math.min(
      MAX_COL_WIDTH,
      Math.max(MIN_COL_WIDTH, Math.round(this.drag.startWidth + e.clientX - this.drag.startX))
    );
    this.drag.colEl.style.width = `${w}px`;
    this.tableEl.style.width = `${this.drag.startTableWidth + (w - this.drag.startWidth)}px`;
  };

  private handleGripUp = (): void => {
    document.removeEventListener("mousemove", this.handleGripMove);
    document.removeEventListener("mouseup", this.handleGripUp);
    if (!this.drag) return;
    const w = parseFloat(this.drag.colEl.style.width);
    if (Number.isFinite(w)) {
      this.colWidths[this.drag.key] = Math.round(w);
      this.persistColumnWidths();
    }
    this.drag = null;
  };

  /** Double-click a grip: forget that column's custom width. */
  private handleGripReset(el: HTMLElement): void {
    const key = el.getAttribute("data-col-key");
    if (!key || this.colWidths[key] === undefined) return;
    delete this.colWidths[key];
    this.persistColumnWidths();
    if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);
  }

  private persistColumnWidths(): void {
    this.colWidthsDirty = true;
    (this.host as unknown as { persistProperties?: (changes: unknown) => void }).persistProperties?.({
      merge: [
        {
          objectName: "columnWidths",
          selector: null,
          properties: { state: serializeColumnWidthsState(this.colWidths) }
        }
      ]
    });
  }

  private commentOpts(): {
    show: boolean;
    column: boolean;
    fontColor: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    columnTitle: string;
  } {
    const c = this.formattingSettings.comments;
    return {
      show: c.show.value === true,
      column: String(c.display.value?.value ?? "markers") === "column",
      fontColor: this.isHighContrast ? "" : safeHexOrEmpty(c.fontColor.value?.value),
      bold: c.bold.value === true,
      italic: c.italic.value === true,
      underline: c.underline.value === true,
      columnTitle:
        String(c.columnTitle.value ?? "").trim() || this.localize("Visual_Comments", "Comments")
    };
  }

  /** Render one comment's rich text into `el` — DOM spans only, never HTML
   *  strings. Card styling is the base; inline markup overrides per segment. */
  private renderCommentInto(
    el: HTMLElement,
    text: string,
    base: { fontColor: string; bold: boolean; italic: boolean; underline: boolean }
  ): void {
    for (const seg of parseCommentMarkup(text)) {
      const span = document.createElement("span");
      span.textContent = seg.text;
      if (base.bold || seg.bold) span.style.fontWeight = "700";
      if (base.italic || seg.italic) span.style.fontStyle = "italic";
      if (base.underline || seg.underline) span.style.textDecoration = "underline";
      const color = this.isHighContrast ? "" : seg.color || base.fontColor;
      if (color) span.style.color = color;
      el.appendChild(span);
    }
  }

  // ---------- In-visual layout editor (custom rows) ----------

  private renderChrome(): void {
    if (!this.allowInteractions) return;
    const toolbar = document.createElement("div");
    toolbar.className = "em-toolbar";

    const commentsAvailable =
      this.lastValidRenderInput?.parsed.hasComments === true && this.commentOpts().show;
    if (!commentsAvailable) this.commentsPanelOpen = false;

    if (commentsAvailable) {
      const cbtn = document.createElement("button");
      cbtn.type = "button";
      cbtn.className = "em-toolbtn";
      cbtn.setAttribute("data-em-action", "toggle-comments");
      cbtn.setAttribute("aria-label", this.localize("Visual_Comments", "Comments"));
      cbtn.setAttribute("title", this.localize("Visual_Comments", "Comments"));
      cbtn.textContent = "💬";
      toolbar.appendChild(cbtn);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "em-toolbtn";
    btn.setAttribute("data-em-action", "toggle-panel");
    btn.setAttribute("aria-label", this.localize("Visual_Edit", "Edit layout"));
    btn.setAttribute("title", this.localize("Visual_Edit", "Edit layout"));
    btn.textContent = "✎";
    toolbar.appendChild(btn);
    this.target.appendChild(toolbar);
    if (this.editPanelOpen) this.target.appendChild(this.buildEditPanel());
    if (this.commentsPanelOpen) this.target.appendChild(this.buildCommentsPanel());
  }

  /** Side panel listing every commented row of the current DataView. */
  private buildCommentsPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "em-commentspanel";

    const title = document.createElement("div");
    title.className = "em-paneltitle";
    title.textContent = this.localize("Visual_Comments", "Comments");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "em-panelclose";
    close.setAttribute("data-em-action", "close-comments");
    close.setAttribute("aria-label", this.localize("Visual_Close", "Close"));
    close.textContent = "✕";
    title.appendChild(close);
    panel.appendChild(title);

    const parsed = this.lastValidRenderInput?.parsed;
    if (!parsed) return panel;
    const copts = this.commentOpts();
    const MAX_ROWS = 200;
    const MAX_LINES = 400;
    const totalCommented = parsed.rowComments.reduce((n, c) => n + (c.length > 0 ? 1 : 0), 0);
    let shown = 0;
    let lines = 0;
    for (let r = 0; r < parsed.rows.length && shown < MAX_ROWS && lines < MAX_LINES; r++) {
      const comments = parsed.rowComments[r] ?? [];
      if (comments.length === 0) continue;
      shown++;
      const item = document.createElement("div");
      item.className = "em-citem";
      const rowLabel = document.createElement("div");
      rowLabel.className = "em-crow";
      rowLabel.textContent = parsed.rows[r].label || "·";
      item.appendChild(rowLabel);
      for (const c of comments) {
        if (lines >= MAX_LINES) break;
        lines++;
        const line = document.createElement("div");
        line.className = "em-ctext";
        this.renderCommentInto(line, c.text, copts);
        if (c.pathLabel) {
          const path = document.createElement("span");
          path.className = "em-cpath";
          path.textContent = c.pathLabel;
          line.appendChild(path);
        }
        item.appendChild(line);
      }
      panel.appendChild(item);
    }
    if (shown === 0) {
      const empty = document.createElement("div");
      empty.className = "em-panelhint";
      empty.textContent = this.localize("Visual_NoComments", "No comments in the current view.");
      panel.appendChild(empty);
    } else if (shown < totalCommented) {
      // Never truncate silently: say how many commented rows are not listed.
      const more = document.createElement("div");
      more.className = "em-panelhint";
      more.textContent = `… +${totalCommented - shown} ${this.localize(
        "Visual_MoreComments",
        "more commented rows"
      )}`;
      panel.appendChild(more);
    }
    return panel;
  }

  private panelRow(label: string, input: HTMLElement): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "em-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  private buildEditPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "em-editpanel";

    const title = document.createElement("div");
    title.className = "em-paneltitle";
    title.textContent = this.localize("Visual_CustomRows", "Custom rows");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "em-panelclose";
    close.setAttribute("data-em-action", "close-panel");
    close.setAttribute("aria-label", this.localize("Visual_Close", "Close"));
    close.textContent = "✕";
    title.appendChild(close);
    panel.appendChild(title);

    // Existing definitions.
    for (const def of this.customRows) panel.appendChild(this.buildCustomDefItem(def));

    // Add: subtotal of current selection.
    const stSection = document.createElement("div");
    stSection.className = "em-panelsection";
    const stInput = document.createElement("input");
    stInput.type = "text";
    stInput.id = "em-st-label";
    stInput.placeholder = this.localize("Visual_SubtotalName", "Subtotal name");
    stSection.appendChild(this.panelRow("Σ", stInput));
    const stBtn = document.createElement("button");
    stBtn.type = "button";
    stBtn.setAttribute("data-em-action", "add-subtotal");
    stBtn.textContent = this.localize("Visual_AddSubtotal", "Add subtotal of selected rows");
    stSection.appendChild(stBtn);
    panel.appendChild(stSection);

    // Add: formula row.
    const fSection = document.createElement("div");
    fSection.className = "em-panelsection";
    const fName = document.createElement("input");
    fName.type = "text";
    fName.id = "em-f-label";
    fName.placeholder = this.localize("Visual_FormulaName", "Row name");
    const fFormula = document.createElement("input");
    fFormula.type = "text";
    fFormula.id = "em-f-formula";
    fFormula.placeholder = "[Gross Sales] / [Revenue]";
    const fFormat = document.createElement("select");
    fFormat.id = "em-f-format";
    for (const [v, t] of [
      ["inherit", this.localize("Visual_FormatInherit", "Inherit format")],
      ["number", this.localize("Visual_FormatNumber", "Number")],
      ["percent", this.localize("Visual_FormatPercent", "Percent")]
    ]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = t;
      fFormat.appendChild(opt);
    }
    fSection.appendChild(this.panelRow("ƒ", fName));
    fSection.appendChild(this.panelRow("=", fFormula));
    fSection.appendChild(this.panelRow("#", fFormat));
    const fHint = document.createElement("div");
    fHint.className = "em-panelhint";
    fHint.textContent = this.localize(
      "Visual_FormulaHint",
      "Operators + - * / ^ %, comparisons = <> < <= > >= — functions SUM, AVERAGE, MIN, MAX, ABS, ROUND, IF."
    );
    fSection.appendChild(fHint);
    const fBtn = document.createElement("button");
    fBtn.type = "button";
    fBtn.setAttribute("data-em-action", "add-formula");
    fBtn.textContent = this.localize("Visual_AddFormula", "Add formula row");
    fSection.appendChild(fBtn);
    panel.appendChild(fSection);

    panel.appendChild(this.buildRowStyleSection());
    for (const st of this.rowStyles) panel.appendChild(this.buildRowStyleItem(st));

    const hint = document.createElement("div");
    hint.className = "em-panelhint";
    hint.textContent = this.localize(
      "Visual_PositionHint",
      "New rows are inserted after the last selected row (or appended at the end)."
    );
    panel.appendChild(hint);
    return panel;
  }

  private buildCustomDefItem(def: CustomRowDef): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "em-defitem";
    const kind = document.createElement("span");
    kind.className = "em-defkind";
    kind.textContent = def.kind === "subtotal" ? "Σ" : def.kind === "spacer" ? "␣" : "ƒ";
    const name = document.createElement("span");
    name.className = "em-defname";
    name.textContent =
      def.kind === "spacer" ? this.localize("Visual_BlankRow", "Blank row") : def.label;
    name.setAttribute("title", def.kind === "formula" ? def.formula ?? "" : (def.refs ?? []).join(", "));
    const del = document.createElement("button");
    del.type = "button";
    del.setAttribute("data-em-action", "del-custom");
    del.setAttribute("data-def-id", def.id);
    del.setAttribute("aria-label", this.localize("Visual_Delete", "Delete"));
    del.textContent = "🗑";
    item.appendChild(kind);
    item.appendChild(name);
    item.appendChild(del);
    return item;
  }

  /** Per-row styles panel section: alignment + indent for the SELECTED
   *  rows, plus the blank-row insertion. */
  private buildRowStyleSection(): HTMLDivElement {
    const rsSection = document.createElement("div");
    rsSection.className = "em-panelsection";
    const rsTitle = document.createElement("div");
    rsTitle.className = "em-panelhint";
    rsTitle.textContent = this.localize(
      "Visual_RowStyleTitle",
      "Selected rows — alignment and indent:"
    );
    rsSection.appendChild(rsTitle);
    const rsAlign = document.createElement("select");
    rsAlign.id = "em-rs-align";
    for (const [v, t] of [
      ["inherit", this.localize("Visual_AlignInherit", "Inherited alignment")],
      ["left", this.localize("Visual_AlignLeft", "Left")],
      ["center", this.localize("Visual_AlignCenter", "Center")],
      ["right", this.localize("Visual_AlignRight", "Right")]
    ]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = t;
      rsAlign.appendChild(opt);
    }
    const rsIndent = document.createElement("input");
    rsIndent.type = "number";
    rsIndent.id = "em-rs-indent";
    rsIndent.min = "0";
    rsIndent.max = "400";
    rsIndent.placeholder = this.localize("Visual_IndentPlaceholder", "Indent px (blank = inherited)");
    rsSection.appendChild(this.panelRow("¶", rsAlign));
    rsSection.appendChild(this.panelRow("⇤", rsIndent));

    this.appendBorderControls(rsSection);

    for (const [action, key, fallback] of [
      ["apply-rowstyle", "Visual_ApplyRowStyle", "Apply to selected rows"],
      ["clear-rowstyle", "Visual_ClearRowStyle", "Reset selected rows"],
      ["add-spacer", "Visual_AddSpacer", "Insert blank row after selection"]
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-em-action", action);
      btn.textContent = this.localize(key, fallback);
      rsSection.appendChild(btn);
    }
    return rsSection;
  }

  /** Financial-communication frame controls: mode, line style, width,
   *  colour, TARGET (whole row / label cell / one precise column = the
   *  exact cell) and a bold toggle. */
  private appendBorderControls(rsSection: HTMLDivElement): void {
    const select = (id: string, items: [string, string][]): HTMLSelectElement => {
      const sel = document.createElement("select");
      sel.id = id;
      for (const [v, t] of items) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = t;
        sel.appendChild(opt);
      }
      return sel;
    };
    const rsBorder = select("em-rs-border", [
      ["none", this.localize("Visual_BorderNone", "No frame")],
      ["box", this.localize("Visual_BorderBox", "Full frame")],
      ["top", this.localize("Visual_BorderTop", "Top rule")],
      ["bottom", this.localize("Visual_BorderBottom", "Bottom rule")],
      ["topbottom", this.localize("Visual_BorderTopBottom", "Top + bottom rules")]
    ]);
    const targets: [string, string][] = [
      ["all", this.localize("Visual_TargetRow", "Whole row")],
      ["label", this.localize("Visual_TargetLabel", "Label cell")]
    ];
    const parsedNow = this.lastValidRenderInput?.parsed;
    if (parsedNow) {
      const seen = new Set<string>();
      for (const col of parsedNow.renderCols) {
        const key = this.columnKeyFor(parsedNow, col);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        targets.push([key, key.replace("calc:", "ƒ ").replace("·", " · ").replace(/\|/g, " ▸ ")]);
      }
    }
    const rsTarget = select("em-rs-btarget", targets);
    const rsBStyle = select("em-rs-bstyle", [
      ["solid", this.localize("Visual_LineSolid", "Solid")],
      ["dashed", this.localize("Visual_LineDashed", "Dashed")],
      ["dotted", this.localize("Visual_LineDotted", "Dotted")]
    ]);
    const rsBWidth = document.createElement("input");
    rsBWidth.type = "number";
    rsBWidth.id = "em-rs-bwidth";
    rsBWidth.min = "1";
    rsBWidth.max = "4";
    rsBWidth.value = "1";
    const rsBColor = document.createElement("input");
    rsBColor.type = "color";
    rsBColor.id = "em-rs-bcolor";
    rsBColor.value = "#091612";
    const rsBold = document.createElement("input");
    rsBold.type = "checkbox";
    rsBold.id = "em-rs-bold";
    rsSection.appendChild(this.panelRow("▣", rsBorder));
    rsSection.appendChild(this.panelRow("◎", rsTarget));
    rsSection.appendChild(this.panelRow("─", rsBStyle));
    rsSection.appendChild(this.panelRow("↔", rsBWidth));
    rsSection.appendChild(this.panelRow("🎨", rsBColor));
    rsSection.appendChild(this.panelRow("𝐁", rsBold));
  }

  private buildRowStyleItem(st: RowStyleDef): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "em-defitem";
    const kind = document.createElement("span");
    kind.className = "em-defkind";
    kind.textContent = "¶";
    const name = document.createElement("span");
    name.className = "em-defname";
    const bits: string[] = [];
    if (st.align) bits.push(st.align);
    if (st.indent !== undefined) bits.push(`${st.indent}px`);
    if (st.bold) bits.push("B");
    if (st.border) {
      bits.push(
        `${st.border.mode}${st.border.target !== "all" ? `@${st.border.target.split("·").pop()}` : ""}`
      );
    }
    name.textContent = `${st.key.split("▸").pop() ?? st.key} · ${bits.join(" · ")}`;
    name.setAttribute("title", st.key);
    const del = document.createElement("button");
    del.type = "button";
    del.setAttribute("data-em-action", "del-rowstyle");
    del.setAttribute("data-def-id", st.key);
    del.setAttribute("aria-label", this.localize("Visual_Delete", "Delete"));
    del.textContent = "🗑";
    item.appendChild(kind);
    item.appendChild(name);
    item.appendChild(del);
    return item;
  }

  /** Path keys of the currently selected data rows — read from the internal
   *  selection state (DOM classes are applied asynchronously). */
  private selectedDataRowKeys(): string[] {
    const out: string[] = [];
    this.rowSelectionIds.forEach((id, idx) => {
      if (!id || !this.selectedRowKeys.has(this.selectionKey(id))) return;
      const key = this.rowPathKeys[idx];
      if (key && !key.startsWith("custom:")) out.push(key);
    });
    return out;
  }

  private nextCustomId(): string {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `cr-${buf[0].toString(36)}${buf[1].toString(36)}`;
  }

  private handleEditAction(el: HTMLElement): void {
    const action = el.getAttribute("data-em-action");
    switch (action) {
      case "toggle-panel":
        this.editPanelOpen = !this.editPanelOpen;
        if (this.editPanelOpen) this.commentsPanelOpen = false;
        this.refreshChrome();
        break;
      case "close-panel":
        this.editPanelOpen = false;
        this.refreshChrome();
        break;
      case "toggle-comments":
        this.commentsPanelOpen = !this.commentsPanelOpen;
        if (this.commentsPanelOpen) this.editPanelOpen = false;
        this.refreshChrome();
        break;
      case "close-comments":
        this.commentsPanelOpen = false;
        this.refreshChrome();
        break;
      case "del-custom": {
        const id = el.getAttribute("data-def-id");
        this.customRows = this.customRows.filter((d) => d.id !== id);
        this.mutateCustomRows();
        break;
      }
      case "add-subtotal": {
        const refs = this.selectedDataRowKeys();
        if (refs.length === 0) return;
        const input = this.target.querySelector("#em-st-label") as HTMLInputElement | null;
        this.customRows = [
          ...this.customRows,
          {
            id: this.nextCustomId(),
            kind: "subtotal",
            label: input?.value.trim() || this.localize("Visual_Total", "Total"),
            anchor: refs[refs.length - 1],
            refs
          }
        ];
        this.mutateCustomRows();
        break;
      }
      case "add-spacer": {
        const sel = this.selectedDataRowKeys();
        this.customRows = [
          ...this.customRows,
          {
            id: this.nextCustomId(),
            kind: "spacer",
            label: "",
            anchor: sel.length > 0 ? sel[sel.length - 1] : ""
          }
        ];
        this.mutateCustomRows();
        break;
      }
      case "apply-rowstyle":
      case "clear-rowstyle":
      case "del-rowstyle":
        this.handleRowStyleAction(action, el);
        break;
      case "add-formula": {
        const name = (this.target.querySelector("#em-f-label") as HTMLInputElement | null)?.value.trim();
        const formulaEl = this.target.querySelector("#em-f-formula") as HTMLInputElement | null;
        const formula = formulaEl?.value.trim() ?? "";
        const format = (this.target.querySelector("#em-f-format") as HTMLSelectElement | null)?.value ?? "inherit";
        if (!formula || !compileExpression(formula).ok) {
          formulaEl?.classList.add("em-invalid");
          return;
        }
        const sel = this.selectedDataRowKeys();
        this.customRows = [
          ...this.customRows,
          {
            id: this.nextCustomId(),
            kind: "formula",
            label: name || "ƒ",
            anchor: sel.length > 0 ? sel[sel.length - 1] : "",
            formula,
            format
          }
        ];
        this.mutateCustomRows();
        break;
      }
      default:
        break;
    }
  }

  private refreshChrome(): void {
    this.target
      .querySelectorAll(".em-toolbar, .em-editpanel, .em-commentspanel")
      .forEach((n) => n.remove());
    this.renderChrome();
  }

  private handleRowStyleAction(action: string, el: HTMLElement): void {
    if (action === "del-rowstyle") {
      const key = el.getAttribute("data-def-id");
      this.rowStyles = this.rowStyles.filter((s) => s.key !== key);
      this.mutateRowStyles();
      return;
    }
    const keys = this.selectedDataRowKeys();
    if (keys.length === 0) return;
    if (action === "clear-rowstyle") {
      this.rowStyles = this.rowStyles.filter((s) => !keys.includes(s.key));
      this.mutateRowStyles();
      return;
    }
    const alignRaw =
      (this.target.querySelector("#em-rs-align") as HTMLSelectElement | null)?.value ?? "inherit";
    const align: RowAlign | undefined =
      alignRaw === "left" || alignRaw === "center" || alignRaw === "right" ? alignRaw : undefined;
    const indentRaw =
      (this.target.querySelector("#em-rs-indent") as HTMLInputElement | null)?.value ?? "";
    const indentN = Number(indentRaw);
    const indent =
      indentRaw.trim() !== "" && Number.isFinite(indentN)
        ? Math.min(400, Math.max(0, Math.round(indentN)))
        : undefined;
    const bold =
      (this.target.querySelector("#em-rs-bold") as HTMLInputElement | null)?.checked === true
        ? true
        : undefined;
    const border = this.readPanelBorder();
    if (align === undefined && indent === undefined && bold === undefined && border === undefined) {
      return;
    }
    const rest = this.rowStyles.filter((s) => !keys.includes(s.key));
    this.rowStyles = [...rest, ...keys.map((key) => ({ key, align, indent, bold, border }))];
    this.mutateRowStyles();
  }

  private readPanelBorder(): RowBorderDef | undefined {
    const q = (id: string): string =>
      (this.target.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement | null)?.value ??
      "";
    const mode = q("em-rs-border");
    if (mode !== "box" && mode !== "top" && mode !== "bottom" && mode !== "topbottom") {
      return undefined;
    }
    const styleRaw = q("em-rs-bstyle");
    const widthN = Number(q("em-rs-bwidth"));
    const color = safeHex(q("em-rs-bcolor"), "#091612");
    return {
      mode,
      style: styleRaw === "dashed" || styleRaw === "dotted" ? styleRaw : "solid",
      width: Number.isFinite(widthN) ? Math.min(4, Math.max(1, Math.round(widthN))) : 1,
      color,
      target: q("em-rs-btarget") || "all"
    };
  }

  private mutateRowStyles(): void {
    this.rowStylesDirty = true;
    (this.host as unknown as { persistProperties?: (changes: unknown) => void }).persistProperties?.({
      merge: [
        {
          objectName: "rowStyles",
          selector: null,
          properties: { state: serializeRowStylesState(this.rowStyles) }
        }
      ]
    });
    if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);
  }

  private mutateCustomRows(): void {
    this.customRowsDirty = true;
    (this.host as unknown as { persistProperties?: (changes: unknown) => void }).persistProperties?.({
      merge: [
        {
          objectName: "customRows",
          selector: null,
          properties: { state: serializeCustomRowsState(this.customRows) }
        }
      ]
    });
    // Re-render immediately with the local definitions (the host echoes the
    // persisted state on a later update, which clears the dirty flag).
    if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);
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
    const headerTextSize = Number(ch.textSize.value) || 0;
    if (headerTextSize > 0) thead.style.fontSize = `${Math.min(32, headerTextSize)}px`;
    const headerRowCount = Math.max(parsed.headerRows.length, 1);
    parsed.headerRows.forEach((cells, levelIdx) => {
      const tr = document.createElement("tr");
      if (levelIdx === 0) {
        const corner = document.createElement("th");
        corner.className = "em-rowheader em-corner";
        corner.rowSpan = headerRowCount;
        if (chBg) {
          corner.style.backgroundColor = chBg;
          corner.style.backgroundImage = "none";
        }
        tr.appendChild(corner);
      }
      for (const cell of cells) {
        const th = document.createElement("th");
        if (cell.isGap) th.classList.add("em-gapcol");
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
        if (chBg) {
          th.style.backgroundColor = chBg;
          th.style.backgroundImage = "none";
        }
        tr.appendChild(th);
      }
      if (levelIdx === 0 && this.commentColumnOn(parsed)) {
        const th = document.createElement("th");
        th.className = "em-commentth";
        th.rowSpan = headerRowCount;
        th.setAttribute("scope", "col");
        const label = document.createElement("span");
        label.className = "em-hlabel";
        label.textContent = this.commentOpts().columnTitle;
        th.appendChild(label);
        th.style.textAlign = alignment;
        th.style.fontWeight = chBold ? "700" : "400";
        if (chItalic) th.style.fontStyle = "italic";
        if (chColor) th.style.color = chColor;
        if (chBg) {
          th.style.backgroundColor = chBg;
          th.style.backgroundImage = "none";
        }
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    });

    // Measure-level header decorations — IBCS scenario semantics and
    // per-measure font colours (only when cells map 1:1 onto the columns).
    {
      const ibcsOn = this.ibcsActive();
      const lastRow = thead.lastElementChild;
      const cells = lastRow
        ? Array.from(lastRow.querySelectorAll("th:not(.em-corner):not(.em-commentth)"))
        : [];
      if (cells.length === parsed.renderCols.length) {
        cells.forEach((cell, idx) => {
          const col = parsed.renderCols[idx];
          if (col.kind !== "leaf") return;
          const mi = parsed.leaves[col.leafIdx].measureIndex;
          if (ibcsOn) {
            const sc = parsed.measureScenarios[mi];
            if (sc) cell.classList.add(`ibcs-${sc.toLowerCase()}`);
          }
          const fc = this.isHighContrast ? "" : parsed.measureOverrides[mi]?.fontColor ?? "";
          if (fc) (cell as HTMLElement).style.color = fc;
        });
      }
    }

    this.attachColumnGrips(thead, parsed);
    return thead;
  }

  /** Custom column widths: resize grips on the corner, the leaf-level
   *  header cells (when they map 1:1 onto the grid columns) and the
   *  comment column. */
  private attachColumnGrips(thead: HTMLTableSectionElement, parsed: ParseResult): void {
    if (this.columnWidthMode() !== "custom") return;
    const corner = thead.querySelector("th.em-corner");
    if (corner) corner.appendChild(this.makeGrip(ROW_HEADER_COL_KEY));
    const lastRow = thead.lastElementChild;
    const cells = lastRow
      ? Array.from(lastRow.querySelectorAll("th:not(.em-corner):not(.em-commentth)"))
      : [];
    if (cells.length === parsed.renderCols.length) {
      cells.forEach((cell, idx) => {
        const key = this.columnKeyFor(parsed, parsed.renderCols[idx]);
        if (key) cell.appendChild(this.makeGrip(key));
      });
    }
    const cth = thead.querySelector("th.em-commentth");
    if (cth) cth.appendChild(this.makeGrip(COMMENTS_COL_KEY));
  }

  private makeGrip(key: string): HTMLSpanElement {
    const grip = document.createElement("span");
    grip.className = "em-colgrip";
    grip.setAttribute("data-col-key", key);
    grip.setAttribute("title", "Drag to resize · double-click to reset");
    grip.setAttribute("aria-hidden", "true");
    return grip;
  }

  private buildLeafCell(
    parsed: ParseResult,
    row: RowModel,
    leafIdx: number,
    dataMaxAbs: number,
    ibcsOn: boolean,
    ariaParts: string[]
  ): HTMLTableCellElement {
    const leaf = parsed.leaves[leafIdx];
    const td = document.createElement("td");
    td.setAttribute("data-cell", "1");
    td.setAttribute("data-leaf-idx", String(leafIdx));
    const align = this.measureAlignment(parsed, leaf.measureIndex);
    if (align) td.style.textAlign = align;
    const mfc = this.isHighContrast ? "" : parsed.measureOverrides[leaf.measureIndex]?.fontColor ?? "";
    if (mfc) td.style.color = mfc;
    if (ibcsOn) {
      const sc = parsed.measureScenarios[leaf.measureIndex];
      if (sc === "PY" || sc === "FC") td.classList.add(`ibcs-${sc.toLowerCase()}`);
    }
    const raw = row.cells[leafIdx];
    if (typeof raw === "number") {
      const fmt = this.measureFormat(parsed, leaf.measureIndex);
      let modelFormat = parsed.valueSources[leaf.measureIndex]?.format ?? "";
      let cardUnits = fmt.units;
      let cardDecimals = fmt.decimals;
      const custom = (row as WovenRow).customDef;
      if (custom?.kind === "formula") {
        if (custom.format === "percent") {
          modelFormat = "0.0%";
          cardUnits = "none";
          cardDecimals = 0;
        } else if (custom.format === "number") {
          modelFormat = "";
          cardUnits = "none";
        }
      }
      const formatted = formatActualLabel({
        value: raw,
        modelFormat,
        cardUnits,
        cardDecimals,
        autoDecimals: 0,
        locale: this.locale,
        dataMaxAbs
      });
      td.textContent = formatted;
      ariaParts.push(formatted);
      if (!row.isSubtotal && !custom && !this.isHighContrast) {
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
      if (parsed.valueSources[leaf.measureIndex]?.roles?.comments === true) {
        // Dual-role (values + comments) text measure: render the markup
        // instead of showing raw asterisks in the grid.
        td.classList.add("em-commentcell");
        this.renderCommentInto(td, String(raw), this.commentOpts());
        ariaParts.push(plainCommentText(String(raw)));
      } else {
        td.textContent = String(raw);
      }
    }
    return td;
  }

  /** Financial-communication frames: apply a RowBorderDef to the row —
   *  the whole row as ONE frame ("all"), the label cell, or every cell of
   *  one column identity (each framed individually). Inline styles win
   *  over the theme grid; high contrast repaints with the HC foreground. */
  private applyRowBorder(
    tr: HTMLTableRowElement,
    border: RowBorderDef,
    parsed: ParseResult
  ): void {
    const color = this.isHighContrast ? this.hcForeground : border.color;
    const line = `${border.width}px ${border.style} ${color}`;
    const cells = Array.from(tr.cells) as HTMLElement[];
    let targets: HTMLElement[];
    if (border.target === "all") {
      targets = cells;
    } else if (border.target === "label") {
      targets = cells.slice(0, 1);
    } else {
      targets = [];
      parsed.renderCols.forEach((col, i) => {
        if (this.columnKeyFor(parsed, col) === border.target && cells[i + 1]) {
          targets.push(cells[i + 1]);
        }
      });
    }
    if (targets.length === 0) return;
    const top = border.mode !== "bottom";
    const bottom = border.mode !== "top";
    const box = border.mode === "box";
    const rowFrame = border.target === "all";
    targets.forEach((el, i) => {
      if (top) el.style.borderTop = line;
      if (bottom) el.style.borderBottom = line;
      if (box) {
        if (!rowFrame || i === 0) el.style.borderLeft = line;
        if (!rowFrame || i === targets.length - 1) el.style.borderRight = line;
      }
    });
  }

  private buildRowHeaderTh(
    row: RowModel,
    rIdx: number,
    opts: {
      rowStyle: RowStyleDef | undefined;
      wrapLines: number;
      icons: [string, string];
      indent: number;
      rhBold: boolean;
      rhItalic: boolean;
      rhColor: string;
      markerComments: RowComment[];
    }
  ): HTMLTableCellElement {
    const th = document.createElement("th");
    th.className = "em-rowheader";
    th.setAttribute("scope", "row");
    th.style.paddingLeft =
      opts.rowStyle?.indent !== undefined
        ? `${opts.rowStyle.indent}px`
        : `${this.cellPaddingX() + row.level * opts.indent}px`;
    if (opts.rhBold) th.style.fontWeight = "700";
    if (opts.rhItalic) th.style.fontStyle = "italic";
    if (opts.rhColor) th.style.color = opts.rhColor;
    if (opts.rowStyle?.align) th.style.textAlign = opts.rowStyle.align;
    const labelHost = opts.wrapLines > 1 ? document.createElement("div") : th;
    if (opts.wrapLines > 1) {
      labelHost.className = "em-rlabelclamp";
      th.appendChild(labelHost);
    }
    if (row.isExpandable) {
      const chevron = document.createElement("span");
      chevron.className = "em-chevron";
      chevron.setAttribute("data-toggle-idx", String(rIdx));
      chevron.setAttribute("role", "button");
      chevron.setAttribute("tabindex", "-1");
      chevron.textContent = row.isCollapsed ? opts.icons[0] : opts.icons[1];
      labelHost.appendChild(chevron);
    }
    labelHost.appendChild(document.createTextNode(row.label));
    if (opts.markerComments.length > 0) {
      const mark = document.createElement("span");
      mark.className = "em-cmark";
      mark.setAttribute(
        "title",
        opts.markerComments.map((c) => plainCommentText(c.text)).join(" · ")
      );
      th.appendChild(mark);
    }
    return th;
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

  /** Comments render as a dedicated grid column when the card says so. */
  private commentColumnOn(parsed: ParseResult): boolean {
    const c = this.commentOpts();
    return parsed.hasComments && c.show && c.column;
  }

  private fillTbody(tbody: HTMLTableSectionElement, parsed: ParseResult, spec: WindowSpec): void {
    const dataMaxAbs = computeMaxAbs(parsed.rows);
    const copts = this.commentOpts();
    const commentCol = this.commentColumnOn(parsed);
    const colCount = parsed.renderCols.length + 1 + (commentCol ? 1 : 0);
    const rh = this.formattingSettings.rowHeaders;
    const indentRaw = Number(rh.indent.value);
    const indent = Number.isFinite(indentRaw) ? Math.max(0, indentRaw) : 16;
    const rhColor = this.isHighContrast ? "" : safeHexOrEmpty(rh.fontColor.value?.value);
    const rhBold = rh.bold.value === true;
    const rhItalic = rh.italic.value === true;
    const ibcsOn = this.ibcsActive();
    const wrapLines = this.rowWrapLines();
    const icons =
      EXPAND_ICONS[String(rh.expandIcon.value?.value ?? "chevron")] ?? EXPAND_ICONS.chevron;
    const styleByKey = new Map(this.rowStyles.map((s) => [s.key, s]));
    tbody.replaceChildren();
    if (spec.topPad > 0) tbody.appendChild(this.makeSpacerRow(spec.topPad, colCount));

    for (let rIdx = spec.start; rIdx < spec.end; rIdx++) {
      const row = parsed.rows[rIdx];
      const blank = this.isBlankRow(row);
      const rowStyle = blank ? undefined : styleByKey.get(this.rowPathKeys[rIdx]);
      const tr = document.createElement("tr");
      tr.setAttribute("data-row-idx", String(rIdx));
      if (wrapLines > 1) tr.style.height = `${this.rowHeightPx}px`;
      if (blank) {
        tr.classList.add("em-blankrow");
        tr.setAttribute("aria-hidden", "true");
      } else {
        tr.setAttribute("tabindex", "0");
      }
      if (row.isSubtotal) tr.classList.add("em-subtotal");
      if ((row as WovenRow).customDef && !blank) tr.classList.add("em-customrow");
      if (row.isExpandable) {
        tr.classList.add("em-grouprow");
        tr.setAttribute("aria-expanded", row.isCollapsed ? "false" : "true");
      }

      const comments = copts.show && !blank ? parsed.rowComments[rIdx] ?? [] : [];
      tr.appendChild(
        this.buildRowHeaderTh(row, rIdx, {
          rowStyle,
          wrapLines,
          icons,
          indent,
          rhBold,
          rhItalic,
          rhColor,
          markerComments: commentCol ? [] : comments
        })
      );

      const ariaParts: string[] = [row.label];
      for (const col of parsed.renderCols) {
        if (col.kind === "gap") {
          const gap = document.createElement("td");
          gap.className = "em-gapcol";
          tr.appendChild(gap);
          continue;
        }
        if (col.kind === "calc") {
          tr.appendChild(this.buildCalcCell(parsed, row, rIdx, col, ariaParts));
          continue;
        }
        tr.appendChild(this.buildLeafCell(parsed, row, col.leafIdx, dataMaxAbs, ibcsOn, ariaParts));
      }
      if (commentCol) {
        const td = document.createElement("td");
        td.className = "em-commentcell";
        // The width clamp lives on an inner block div — max-width on a
        // table cell is undefined in auto layout (Firefox ignores it).
        const clamp = document.createElement("div");
        clamp.className = "em-commentclamp";
        comments.forEach((c, ci) => {
          if (ci > 0) clamp.appendChild(document.createTextNode(" · "));
          this.renderCommentInto(clamp, c.text, copts);
        });
        td.appendChild(clamp);
        if (comments.length > 0) {
          td.setAttribute("title", comments.map((c) => plainCommentText(c.text)).join(" · "));
        }
        tr.appendChild(td);
      }
      if (comments.length > 0) {
        ariaParts.push(...comments.map((c) => plainCommentText(c.text)));
      }
      if (rowStyle?.align) {
        const align = rowStyle.align;
        tr.querySelectorAll("td").forEach((td) => {
          (td as HTMLElement).style.textAlign = align;
        });
      }
      if (rowStyle?.bold) tr.style.fontWeight = "700";
      if (rowStyle?.border) this.applyRowBorder(tr, rowStyle.border, parsed);
      tr.setAttribute("aria-label", blank ? "" : ariaParts.join(", "));
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
      return;
    }
    // Normal theme: the General card can recolour the global font,
    // background and accent (hover/selection); empty = theme defaults.
    const g = this.formattingSettings.general;
    const setOrRemove = (name: string, value: string): void => {
      if (value) this.target.style.setProperty(name, value);
      else this.target.style.removeProperty(name);
    };
    setOrRemove("--em-fg", safeHexOrEmpty(g.fontColor.value?.value));
    setOrRemove("--em-bg", safeHexOrEmpty(g.backColor.value?.value));
    setOrRemove("--em-accent", safeHexOrEmpty(g.accentColor.value?.value));
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

    // Resize grips never touch the selection.
    if ((e.target as Element)?.closest?.(".em-colgrip")) return;

    // Layout-editor chrome first: actions, then inert panel clicks (typing
    // in the panel must never clear the row selection).
    const actionEl = (e.target as Element)?.closest?.("[data-em-action]") as HTMLElement | null;
    if (actionEl) {
      this.handleEditAction(actionEl);
      e.stopPropagation();
      return;
    }
    if ((e.target as Element)?.closest?.(".em-editpanel, .em-commentspanel")) return;

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
      const isComment = parsed.valueSources[mi]?.roles?.comments === true;
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
          : isComment
            ? plainCommentText(String(raw))
            : String(raw);
      items.push({ displayName: name, value });
    };

    pushMeasure(leaf.measureIndex, leafIdx);

    // Tooltip-role and comment measures sharing the same column-group path
    // (comments only while the card shows them).
    const showComments = this.commentOpts().show;
    for (let i = 0; i < parsed.leaves.length; i++) {
      if (parsed.renderLeafIdxs.includes(i)) continue;
      const other = parsed.leaves[i];
      const roles = parsed.valueSources[other.measureIndex]?.roles;
      if (roles?.comments === true && roles?.values !== true && !showComments) continue;
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

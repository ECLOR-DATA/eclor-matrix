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
  makePerMeasureValueGroup,
  MeasureFormatOverride,
  VisualFormattingSettingsModel
} from "./settings";
import { formatActualLabel, safeHex } from "./format";
import { computeWindow, estimateRowHeight, WindowSpec } from "./virtualize";
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

    const measureOverrides = valueSources.map((vs) => this.readMeasureOverride(vs));
    return { rows, leaves, headerRows, renderLeafIdxs, valueSources, rowLevels, measureOverrides };
  }

  private readMeasureOverride(vs: DataViewMetadataColumn): MeasureFormatOverride {
    const persisted = (vs.objects as unknown as {
      values?: { useCustom?: unknown; displayUnits?: unknown; decimals?: unknown };
    })?.values;
    const units = String(persisted?.displayUnits ?? "auto");
    const decimals = Number(persisted?.decimals);
    return {
      useCustom: persisted?.useCustom === true,
      units: (DISPLAY_UNIT_VALUES as readonly string[]).includes(units) ? units : "auto",
      decimals: Number.isFinite(decimals) ? Math.min(6, Math.max(0, decimals)) : 0
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

  /** Rebuild the dynamic per-measure groups on the Values card. */
  private buildPerMeasureValueGroups(parsed: ParseResult): void {
    const card = this.formattingSettings.values;
    card.groups = [card.globalGroup];
    parsed.valueSources.forEach((vs, i) => {
      if (!vs.queryName) return;
      card.groups.push(
        makePerMeasureValueGroup(i, vs.displayName ?? `Measure ${i + 1}`, vs.queryName, parsed.measureOverrides[i])
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
      measureOverrides: []
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
    table.style.fontSize = `${Number(fs.general.textSize.value) || 11}px`;
    table.setAttribute("aria-label", this.localize("Visual_AriaMatrix", "Matrix"));

    this.rowHeightPx = estimateRowHeight(Number(fs.general.textSize.value) || 11, density);
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
    const thead = document.createElement("thead");
    const headerRowCount = Math.max(parsed.headerRows.length, 1);
    parsed.headerRows.forEach((cells, levelIdx) => {
      const tr = document.createElement("tr");
      if (levelIdx === 0) {
        const corner = document.createElement("th");
        corner.className = "em-rowheader em-corner";
        corner.rowSpan = headerRowCount;
        tr.appendChild(corner);
      }
      for (const cell of cells) {
        const th = document.createElement("th");
        th.textContent = cell.label;
        if (cell.span > 1) th.colSpan = cell.span;
        th.setAttribute("scope", "col");
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    });
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
    const colCount = parsed.renderLeafIdxs.length + 1;
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
      th.style.paddingLeft = `${8 + row.level * 16}px`;
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
      for (const leafIdx of parsed.renderLeafIdxs) {
        const leaf = parsed.leaves[leafIdx];
        const td = document.createElement("td");
        td.setAttribute("data-cell", "1");
        td.setAttribute("data-leaf-idx", String(leafIdx));
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
      if (other.path.join(" ") === leaf.path.join(" ")) {
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

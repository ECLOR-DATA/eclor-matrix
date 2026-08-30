"use strict";

import "../style/visual.less";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;

import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";

import { VisualFormattingSettingsModel } from "./settings";
import { formatActualLabel, safeHex, safeHexOrEmpty } from "./format";
import {
  buildTree,
  flattenVisible,
  invertSelection,
  normalizeSelection,
  pathKey,
  selectedLeafTuples,
  selectedNodesInOrder,
  toggleNode,
  visibleRootKeys,
  RawValue,
  SlicerNode,
  SlicerTree,
  VisibleItem
} from "./slicerModel";
import {
  buildSlicerFilter,
  extractFilterTarget,
  parseAppliedFilter,
  FilterTarget
} from "./filters";

/** Honest render cap until windowed scrolling lands (CONTEXT.md §8 posture
 *  inherited from eclor-matrix): parsing handles the full 10k reduction cap,
 *  rendering stops here with the native warning icon. */
const MAX_RENDER_ITEMS = 2000;

type LayoutMode = "list" | "chiclets" | "dropdown";

interface RenderInput {
  tree: SlicerTree;
  targets: FilterTarget[];
  fieldNames: string[];
  measureFormat: string;
  hasMeasure: boolean;
  width: number;
  height: number;
}

interface ParseResult {
  tree: SlicerTree;
  targets: FilterTarget[];
  fieldNames: string[];
  measureFormat: string;
  hasMeasure: boolean;
}

/** FilterAction enum with a runtime fallback — the jest stub replaces the
 *  api module with an empty object, and the values are stable public API. */
function filterAction(merge: boolean): powerbi.FilterAction {
  const fa = (powerbi as unknown as { FilterAction?: { merge: number; remove: number } }).FilterAction;
  if (fa) return (merge ? fa.merge : fa.remove) as powerbi.FilterAction;
  return (merge ? 0 : 1) as powerbi.FilterAction;
}

export class Visual implements IVisual {
  private host: IVisualHost;
  private target: HTMLElement;
  private formattingSettingsService: FormattingSettingsService;
  private formattingSettings: VisualFormattingSettingsModel;
  private localizationManager: powerbi.extensibility.ILocalizationManager;
  private locale: string = "en-US";
  private allowInteractions: boolean = true;

  private isHighContrast: boolean = false;
  private hcForeground: string = "#000000";
  private hcBackground: string = "#ffffff";
  private hcHyperlink: string = "#0078d4";

  // Interaction state — survives re-renders, dies with the instance.
  private selectedKeys: Set<string> = new Set();
  private expandedKeys: Set<string> = new Set();
  private searchText: string = "";
  private dropdownOpen: boolean = false;
  private focusKey: string | null = null;
  /** applyJsonFilter echoes back as an update; don't re-adopt our own echo. */
  private pendingApplies: number = 0;
  private expandAllApplied: boolean = false;

  private lastValidRenderInput: RenderInput | null = null;

  constructor(options?: VisualConstructorOptions) {
    if (!options) throw new Error("Visual constructor: options were not provided by the host.");
    this.host = options.host;
    this.target = options.element;

    this.localizationManager = options.host.createLocalizationManager();
    this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);
    this.formattingSettings = new VisualFormattingSettingsModel();
    this.locale = options.host.locale || "en-US";
    this.allowInteractions =
      (options.host as unknown as { hostCapabilities?: { allowInteractions?: boolean } }).hostCapabilities
        ?.allowInteractions ?? true;

    this.target.classList.add("eclor-slicer-root");

    // Delegated handlers attached ONCE on target — they survive every
    // re-render because renders only replace target's children.
    this.target.addEventListener("click", this.handleClick);
    this.target.addEventListener("input", this.handleInput);
    this.target.addEventListener("keydown", this.handleKeydown);

    // Placeholder so the visual is never visually blank before update().
    this.renderEmpty();
  }

  // ------------------------------------------------------------------ update

  public update(options: VisualUpdateOptions): void {
    const eventService = this.host.eventService;
    eventService?.renderingStarted(options);
    try {
      const dataView = options.dataViews?.[0];
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

      const parsed = this.parseDataView(dataView);

      if (!parsed) {
        // Page-switch transient — replay the last good frame.
        if (this.lastValidRenderInput) {
          this.lastValidRenderInput = { ...this.lastValidRenderInput, width, height };
          this.renderFromInput(this.lastValidRenderInput);
        } else {
          this.renderEmpty();
        }
        eventService?.renderingFinished(options);
        return;
      }

      if (parsed.tree.leafCount === 0 && parsed.fieldNames.length === 0) {
        // User emptied the buckets — drop caches AND release any persisted
        // filter (audit LIF-01: an orphaned filter would keep constraining
        // the page with no visible slicer to clear it), then let the host
        // paint its native landing page overlay (supportsLandingPage: true).
        if (this.selectedKeys.size > 0 && this.allowInteractions) {
          this.host.applyJsonFilter(null as unknown as powerbi.IFilter, "general", "filter", filterAction(false));
        }
        this.lastValidRenderInput = null;
        this.selectedKeys = new Set();
        this.expandedKeys = new Set();
        this.searchText = "";
        this.dropdownOpen = false;
        this.focusKey = null;
        this.pendingApplies = 0;
        this.expandAllApplied = false;
        this.target.replaceChildren();
        eventService?.renderingFinished(options);
        return;
      }

      this.syncSelectionWithHost(options, parsed.tree);
      this.applyDefaultExpansion(parsed.tree);

      this.lastValidRenderInput = { ...parsed, width, height };
      this.renderFromInput(this.lastValidRenderInput);
      eventService?.renderingFinished(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventService?.renderingFailed(options, message);
    }
  }

  /** null = transient (page switch); a ParseResult with empty fieldNames =
   *  user-cleared buckets (two-branch contract, playbook §4.1.2). */
  private parseDataView(dv: DataView | undefined): ParseResult | null {
    if (!dv?.categorical) return null;
    const cats = dv.categorical.categories || [];
    const vals = dv.categorical.values || [];
    const fieldCats = cats.filter((c) => c.source?.roles?.field);
    if (fieldCats.length === 0) {
      return {
        tree: buildTree([]),
        targets: [],
        fieldNames: [],
        measureFormat: "",
        hasMeasure: false
      };
    }

    const levels = fieldCats.map((c) => (c.values || []) as RawValue[]);
    const measureCol = vals.find((v) => v.source?.roles?.values);
    const measure = measureCol ? ((measureCol.values || []) as (number | null)[]) : undefined;

    const tree = buildTree(levels, measure);
    const targets = fieldCats.map((c) => extractFilterTarget(c.source));
    const fieldNames = fieldCats.map((c) => c.source.displayName || "");
    return {
      tree,
      targets,
      fieldNames,
      measureFormat: measureCol?.source?.format || "",
      hasMeasure: !!measureCol
    };
  }

  /** Adopt / release selection state from the host's echoed jsonFilters so
   *  bookmarks, report reload and the native "clear filter" header button
   *  all round-trip. Our own applyJsonFilter echoes are skipped by counter. */
  private syncSelectionWithHost(options: VisualUpdateOptions, tree: SlicerTree): void {
    const jsonFilters = (options as unknown as { jsonFilters?: unknown[] }).jsonFilters;
    // Updates that carry no jsonFilters at all (resize, format change on
    // some hosts) must not consume the echo counter (audit LIF-02).
    if (jsonFilters === undefined) return;
    if (this.pendingApplies > 0) {
      this.pendingApplies--;
      return;
    }
    if (jsonFilters.length === 0) {
      if (this.selectedKeys.size > 0) this.selectedKeys = new Set();
      return;
    }
    const tuples = parseAppliedFilter(jsonFilters[0]);
    if (!tuples) return;
    this.selectedKeys = normalizeSelection(
      tree,
      tuples.map((t) => pathKey(t))
    );
  }

  private applyDefaultExpansion(tree: SlicerTree): void {
    if (this.expandAllApplied) return;
    this.expandAllApplied = true;
    if (!this.getSettings().hierarchy.expandAll.value || tree.levelCount <= 1) return;
    const walk = (node: { children: { key: string; children: unknown[] }[] }): void => {
      for (const c of node.children) {
        if (c.children.length > 0) {
          this.expandedKeys.add(c.key);
          walk(c as { children: { key: string; children: unknown[] }[] });
        }
      }
    };
    walk(tree.root);
  }

  private getSettings(): VisualFormattingSettingsModel {
    return this.formattingSettings ?? new VisualFormattingSettingsModel();
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return this.formattingSettingsService.buildFormattingModel(this.getSettings());
  }

  public destroy(): void {
    this.lastValidRenderInput = null;
    this.selectedKeys = new Set();
    this.expandedKeys = new Set();
    this.target.replaceChildren();
  }

  // ------------------------------------------------------------------ i18n

  private str(key: string, fallback: string): string {
    const v = this.localizationManager?.getDisplayName(key);
    return v && v !== key ? v : fallback;
  }

  private template(key: string, fallback: string, ...args: (string | number)[]): string {
    let s = this.str(key, fallback);
    args.forEach((a, i) => {
      s = s.replace(`{${i}}`, String(a));
    });
    return s;
  }

  private blankLabel(): string {
    return this.str("Visual_Blank", "(Blank)");
  }

  // ------------------------------------------------------------------ render

  private renderEmpty(): void {
    const wrap = document.createElement("div");
    wrap.className = "es-empty";
    const text = document.createElement("div");
    text.className = "es-empty-text";
    text.textContent = this.str("Visual_Empty", "Add a field to start filtering");
    wrap.appendChild(text);
    this.target.replaceChildren(wrap);
  }

  private resolveLayout(_levelCount: number): LayoutMode {
    const userLayout = String(this.getSettings().slicerStyle.layout.value.value);
    if (userLayout === "list" || userLayout === "chiclets" || userLayout === "dropdown") {
      return userLayout;
    }
    return "list"; // auto: the list body renders flat or tree by itself
  }

  private applyCssVars(): void {
    const s = this.getSettings();
    const st = this.target.style;
    const textSize = Math.max(8, Math.min(24, Number(s.slicerStyle.textSize.value) || 11));
    const density = String(s.slicerStyle.density.value.value);
    const padY = density === "compact" ? 2 : density === "comfortable" ? 8 : 4;
    st.setProperty("--es-font-size", `${textSize}px`);
    st.setProperty("--es-pad-y", `${padY}px`);
    st.setProperty("--es-radius", `${Math.max(0, Math.min(24, Number(s.items.borderRadius.value) || 0))}px`);
    st.setProperty("--es-indent", `${Math.max(0, Math.min(60, Number(s.hierarchy.indent.value) || 16))}px`);

    if (this.isHighContrast) {
      st.setProperty("--es-fg", this.hcForeground);
      st.setProperty("--es-bg", this.hcBackground);
      st.setProperty("--es-item-bg", this.hcBackground);
      st.setProperty("--es-selected-bg", this.hcHyperlink);
      st.setProperty("--es-selected-soft-bg", this.hcHyperlink);
      st.setProperty("--es-selected-fg", this.hcBackground);
      st.setProperty("--es-hover-bg", this.hcBackground);
      st.setProperty("--es-chip-bg", this.hcBackground);
      st.setProperty("--es-chip-fg", this.hcForeground);
      st.setProperty("--es-chip-border", this.hcForeground);
      st.setProperty("--es-header-fg", this.hcForeground);
      st.setProperty("--es-header-bg", this.hcBackground);
      st.setProperty("--es-border", this.hcForeground);
      st.setProperty("--es-chiclet-border", this.hcForeground);
      st.setProperty("--es-muted", this.hcForeground);
      st.setProperty("--es-muted-soft", this.hcForeground);
      st.setProperty("--es-focus", this.hcHyperlink);
      st.setProperty("--es-popover-bg", this.hcBackground);
      st.setProperty("--es-popover-shadow", "none");
      st.setProperty("--es-btn-disabled", this.hcForeground);
      return;
    }

    const setOr = (name: string, pick: string, fallback: string): void => {
      st.setProperty(name, safeHexOrEmpty(pick) || fallback);
    };
    setOr("--es-fg", String(s.items.fontColor.value.value ?? ""), "#091612");
    setOr("--es-bg", "", "transparent");
    setOr("--es-item-bg", String(s.items.backColor.value.value ?? ""), "transparent");
    setOr("--es-selected-bg", String(s.items.selectedColor.value.value ?? ""), "#1ef5b1");
    // Soft selected background derives from the user pick when set (design
    // P2.1: calm rows, accent carried by the inset bar + filled check).
    const userSelected = safeHexOrEmpty(String(s.items.selectedColor.value.value ?? ""));
    st.setProperty("--es-selected-soft-bg", userSelected || "#d9fdf1");
    setOr("--es-selected-fg", String(s.items.selectedFontColor.value.value ?? ""), "#091612");
    st.setProperty("--es-hover-bg", "rgba(30, 245, 177, 0.14)");
    setOr("--es-chip-bg", String(s.chips.chipColor.value.value ?? ""), "#d9fdf1");
    setOr("--es-chip-fg", String(s.chips.chipTextColor.value.value ?? ""), "#091612");
    setOr("--es-header-fg", String(s.slicerHeader.fontColor.value.value ?? ""), "#091612");
    setOr("--es-header-bg", String(s.slicerHeader.backColor.value.value ?? ""), "transparent");
    st.setProperty("--es-border", "#e5e7e6");
    st.setProperty("--es-chiclet-border", "#d6dad8");
    // AA-compliant informational grey (5.38:1 on white); the softer #8A9994
    // is reserved for purely decorative glyphs (design P1.1).
    st.setProperty("--es-muted", "#5e6e68");
    st.setProperty("--es-muted-soft", "#8a9994");
    st.setProperty("--es-focus", "#091612");
    st.setProperty("--es-popover-bg", "#ffffff");
    st.setProperty("--es-popover-shadow", "0 4px 14px rgba(9, 22, 18, 0.12)");
    st.setProperty("--es-chip-border", "transparent");
    st.setProperty("--es-btn-disabled", "#b3bdb9");
  }

  private renderFromInput(input: RenderInput): void {
    const s = this.getSettings();
    this.applyCssVars();
    const layout = this.resolveLayout(input.tree.levelCount);
    const frag = document.createDocumentFragment();

    if (s.slicerHeader.show.value) frag.appendChild(this.buildHeader(input));
    if (s.search.show.value && layout !== "dropdown") frag.appendChild(this.buildSearch());

    // Chips are redundant noise in single mode (one row already shows the
    // state), and in dropdown mode they must sit BELOW the master field,
    // never above it (design P1.5).
    // In dropdown layout the open panel already lists the selection —
    // chips below it would triple the redundancy (review R2).
    const chipsWanted =
      s.chips.show.value && this.isMulti() && !(layout === "dropdown" && this.dropdownOpen);
    const chipsTop = String(s.chips.position.value.value) !== "bottom" && layout !== "dropdown";
    if (chipsWanted && chipsTop) frag.appendChild(this.buildChips(input));

    if (layout === "dropdown") {
      frag.appendChild(this.buildDropdown(input));
    } else {
      frag.appendChild(this.buildBody(input, layout));
    }

    if (chipsWanted && !chipsTop) frag.appendChild(this.buildChips(input));
    frag.appendChild(this.buildFooter(input));

    this.target.setAttribute("role", "group");
    this.target.setAttribute(
      "aria-label",
      `${this.str("Visual_AriaSlicer", "Slicer")}: ${input.fieldNames.join(" / ")}`
    );
    this.target.replaceChildren(frag);
    this.restoreFocus();
  }

  private buildHeader(input: RenderInput): HTMLElement {
    const s = this.getSettings();
    const header = document.createElement("div");
    header.className = "es-header";
    if (s.slicerHeader.bold.value) header.classList.add("es-bold");

    const title = document.createElement("div");
    title.className = "es-title";
    const userTitle = (s.slicerHeader.title.value || "").trim();
    title.textContent = userTitle || input.fieldNames.join(" / ");
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "es-actions";
    const mkBtn = (action: string, label: string, cls: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `es-btn ${cls}`;
      b.dataset.action = action;
      b.textContent = label;
      b.title = label;
      return b;
    };
    if (String(s.selection.selectionMode.value.value) === "multi") {
      if (s.selection.showSelectAll.value) {
        actions.appendChild(mkBtn("selectAll", this.str("Visual_SelectAll", "All"), "es-btn-all"));
      }
      if (s.selection.showInvert.value) {
        actions.appendChild(mkBtn("invert", this.str("Visual_Invert", "Invert"), "es-btn-invert"));
      }
    }
    if (s.selection.showClear.value) {
      const clear = mkBtn("clear", this.str("Visual_Clear", "Clear"), "es-btn-clear");
      clear.disabled = this.selectedKeys.size === 0;
      actions.appendChild(clear);
    }
    header.appendChild(actions);
    return header;
  }

  private buildSearch(): HTMLElement {
    const s = this.getSettings();
    const wrap = document.createElement("div");
    wrap.className = "es-search";
    const icon = document.createElement("span");
    icon.className = "es-search-icon";
    icon.setAttribute("aria-hidden", "true");
    wrap.appendChild(icon);
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "es-search-input";
    inputEl.value = this.searchText;
    // Mirror into the attribute too: the live DOM only needs the property,
    // but serialised snapshots (screenshot pipeline) read the attribute.
    inputEl.setAttribute("value", this.searchText);
    inputEl.placeholder = (s.search.placeholder.value || "").trim() || this.str("Visual_SearchPlaceholder", "Search…");
    inputEl.setAttribute("aria-label", this.str("Visual_Search", "Search"));
    wrap.appendChild(inputEl);
    if (this.searchText) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "es-search-clear";
      clear.dataset.action = "clearSearch";
      clear.textContent = "×";
      clear.setAttribute("aria-label", this.str("Visual_ClearSearch", "Clear search"));
      wrap.appendChild(clear);
    }
    return wrap;
  }

  private buildChips(input: RenderInput): HTMLElement {
    const s = this.getSettings();
    const row = document.createElement("div");
    row.className = "es-chips";
    const nodes = selectedNodesInOrder(input.tree, this.selectedKeys);
    if (nodes.length === 0) {
      row.classList.add("es-chips-empty");
      // While searching, the footer's "X of Y" is the useful signal — an
      // orphan "No filter" label would just add noise (design P2.10).
      if (!this.searchText.trim()) {
        const hint = document.createElement("span");
        hint.className = "es-chips-hint";
        hint.textContent = this.str("Visual_NoFilter", "No filter");
        row.appendChild(hint);
      }
      return row;
    }
    // Effective cap = user setting ∩ what roughly fits on ONE line (~90px a
    // chip) — keeps the recap to a single row in narrow slicers (P1.5).
    const userMax = Math.max(1, Math.min(30, Number(s.chips.maxChips.value) || 6));
    // ~80px reserved for the "Clear all" chip so the row truly holds ONE
    // line (review R2: it wrapped in narrow hierarchies).
    const fitMax = Math.max(1, Math.floor((input.width - 80) / 90));
    const maxChips = Math.min(userMax, fitMax);

    if (input.tree.levelCount > 1) {
      // Hierarchy recap is organised BY LEVEL, labelled with the hierarchy
      // field name ("Pays : France ×  ·  Ville : Paris ×"), each level with
      // its own clear-× when it holds several selections.
      let budget = maxChips;
      let overflow = 0;
      for (let lvl = 0; lvl < input.tree.levelCount; lvl++) {
        const levelNodes = nodes.filter((n) => n.level === lvl);
        if (levelNodes.length === 0) continue;
        const group = document.createElement("div");
        group.className = "es-chip-group";
        const label = document.createElement("span");
        label.className = "es-chip-group-label";
        label.textContent = input.fieldNames[lvl] || "";
        group.appendChild(label);
        const take = Math.max(0, Math.min(levelNodes.length, budget));
        for (const n of levelNodes.slice(0, take)) {
          group.appendChild(this.makeChip(n, input.fieldNames[lvl]));
        }
        budget -= take;
        overflow += levelNodes.length - take;
        if (levelNodes.length > 1) {
          const clearLvl = document.createElement("button");
          clearLvl.type = "button";
          clearLvl.className = "es-chip-level-clear";
          clearLvl.dataset.clearLevel = String(lvl);
          const lvlName = input.fieldNames[lvl] || "";
          clearLvl.title = this.template("Visual_ClearLevel", "Clear {0}", lvlName);
          clearLvl.setAttribute("aria-label", clearLvl.title);
          clearLvl.textContent = "×";
          group.appendChild(clearLvl);
        }
        row.appendChild(group);
      }
      if (overflow > 0) {
        const more = document.createElement("span");
        more.className = "es-chip-more";
        more.textContent = this.template("Visual_MoreChips", "+{0}", overflow);
        row.appendChild(more);
      }
    } else {
      const shown = nodes.slice(0, maxChips);
      for (const n of shown) row.appendChild(this.makeChip(n));
      if (nodes.length > shown.length) {
        const more = document.createElement("span");
        more.className = "es-chip-more";
        more.textContent = this.template("Visual_MoreChips", "+{0}", nodes.length - shown.length);
        row.appendChild(more);
      }
    }

    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "es-chip es-chip-clear";
    clearAll.dataset.action = "clear";
    clearAll.textContent = this.str("Visual_ClearAll", "Clear all");
    row.appendChild(clearAll);
    return row;
  }

  private makeChip(n: SlicerNode, levelName?: string): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "es-chip";
    chip.dataset.chipKey = n.key;
    const pathLabels = n.rawPath.map((_, i) => {
      let anc: SlicerNode | null = n;
      for (let up = n.level; up > i; up--) anc = anc && anc.parent;
      return anc ? anc.label || this.blankLabel() : "";
    });
    chip.title = pathLabels.join(" / ");
    const ariaTarget = levelName ? `${levelName} : ${chip.title}` : chip.title;
    chip.setAttribute("aria-label", this.template("Visual_RemoveFilter", "Remove filter {0}", ariaTarget));
    // Deep nodes get their parent as context — "Paris" alone is ambiguous
    // in a multi-country model (design P2.6).
    if (n.level > 0 && n.parent && n.parent.level >= 0) {
      const pathSpan = document.createElement("span");
      pathSpan.className = "es-chip-path";
      pathSpan.textContent = `${n.parent.label || this.blankLabel()} · `;
      chip.appendChild(pathSpan);
    }
    const label = document.createElement("span");
    label.className = "es-chip-label";
    label.textContent = n.label || this.blankLabel();
    chip.appendChild(label);
    const x = document.createElement("span");
    x.className = "es-chip-x";
    x.setAttribute("aria-hidden", "true");
    x.textContent = "×";
    chip.appendChild(x);
    return chip;
  }

  private buildBody(input: RenderInput, layout: LayoutMode): HTMLElement {
    const body = document.createElement("div");
    body.className = "es-body";
    const items = flattenVisible(input.tree, this.expandedKeys, this.searchText, this.selectedKeys);
    const capped = items.length > MAX_RENDER_ITEMS;
    const toRender = capped ? items.slice(0, MAX_RENDER_ITEMS) : items;
    if (capped) {
      this.host.displayWarningIcon?.(
        this.str("Visual_DataCapTitle", "Too many items"),
        this.str("Visual_DataCap", "Item limit reached — showing the first items only. Use search to narrow down.")
      );
    }

    if (toRender.length === 0) {
      const noRes = document.createElement("div");
      noRes.className = "es-no-results";
      noRes.textContent = this.str("Visual_NoResults", "No matching items");
      body.appendChild(noRes);
      return body;
    }

    if (layout === "chiclets") {
      body.classList.add("es-chiclet-grid");
      const cols = Math.max(1, Math.min(8, Number(this.getSettings().slicerStyle.chicletColumns.value) || 3));
      body.style.setProperty("--es-chiclet-cols", String(cols));
      // Chiclets read best flat — render root level only.
      for (const it of toRender) {
        if (it.depth === 0) body.appendChild(this.buildChiclet(input, it));
      }
      return body;
    }

    body.classList.add("es-list");
    // checkbox/radio children need a group/radiogroup container, not a
    // listbox (which expects role=option) — audit A11Y-01.
    body.setAttribute("role", this.isMulti() ? "group" : "radiogroup");
    for (const it of toRender) {
      body.appendChild(this.buildItem(input, it));
    }
    if (capped) {
      const note = document.createElement("div");
      note.className = "es-cap-note";
      note.textContent = this.str("Visual_DataCap", "Item limit reached — showing the first items only. Use search to narrow down.");
      body.appendChild(note);
    }
    return body;
  }

  private isMulti(): boolean {
    return String(this.getSettings().selection.selectionMode.value.value) === "multi";
  }

  private buildItem(input: RenderInput, it: VisibleItem): HTMLElement {
    const s = this.getSettings();
    const el = document.createElement("div");
    el.className = "es-item";
    el.dataset.key = it.node.key;
    el.tabIndex = 0;
    el.setAttribute("role", this.isMulti() ? "checkbox" : "radio");
    el.setAttribute("aria-checked", it.state === "partial" ? "mixed" : it.state === "on" ? "true" : "false");
    if (it.state === "on") el.classList.add("es-on");
    if (it.state === "partial") el.classList.add("es-partial");
    el.style.paddingLeft = `calc(${it.depth} * var(--es-indent) + 6px)`;

    if (input.tree.levelCount > 1) {
      // The caret is decorative for AT — the expansion state lives on the
      // item itself as aria-expanded (audit A11Y-02); ←/→ toggle it.
      const exp = document.createElement("span");
      exp.className = "es-caret";
      exp.setAttribute("aria-hidden", "true");
      if (it.hasChildren) {
        exp.classList.add(it.expanded ? "es-caret-open" : "es-caret-closed");
        exp.dataset.expKey = it.node.key;
        el.setAttribute("aria-expanded", String(it.expanded));
      } else {
        exp.classList.add("es-caret-leaf");
      }
      el.appendChild(exp);
    }

    const check = document.createElement("span");
    check.className = this.isMulti() ? "es-check" : "es-radio";
    check.setAttribute("aria-hidden", "true");
    el.appendChild(check);

    el.appendChild(this.buildLabelSpan(it.node.label || this.blankLabel()));

    if (s.items.showCounts.value) {
      const count = document.createElement("span");
      count.className = "es-count";
      count.textContent = this.itemValueText(input, it);
      el.appendChild(count);
    }

    const ariaValue = s.items.showCounts.value ? `, ${this.itemValueText(input, it)}` : "";
    el.setAttribute("aria-label", `${it.node.label || this.blankLabel()}${ariaValue}`);
    return el;
  }

  private buildChiclet(input: RenderInput, it: VisibleItem): HTMLElement {
    const s = this.getSettings();
    const b = document.createElement("button");
    b.type = "button";
    b.className = "es-chiclet";
    b.dataset.key = it.node.key;
    b.setAttribute("aria-pressed", it.state === "on" ? "true" : "false");
    if (it.state === "on") b.classList.add("es-on");
    const labelText = it.node.label || this.blankLabel();
    b.appendChild(this.buildLabelSpan(labelText));
    if (s.items.showCounts.value) {
      const valueText = this.itemValueText(input, it);
      const count = document.createElement("span");
      count.className = "es-count";
      count.textContent = valueText;
      b.appendChild(count);
      // Native tooltip recovers the full text when the label truncates.
      b.title = `${labelText} — ${valueText}`;
    } else {
      b.title = labelText;
    }
    return b;
  }

  /** Label span with the searched substring emphasised (design P3.1) —
   *  100% createElement/textContent, no markup strings. Accent-different
   *  matches simply skip the emphasis. */
  private buildLabelSpan(text: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "es-label";
    const needle = this.searchText.trim().toLowerCase();
    const idx = needle ? text.toLowerCase().indexOf(needle) : -1;
    if (idx < 0) {
      span.textContent = text;
      return span;
    }
    span.append(text.slice(0, idx));
    const match = document.createElement("span");
    match.className = "es-match";
    match.textContent = text.slice(idx, idx + needle.length);
    span.appendChild(match);
    span.append(text.slice(idx + needle.length));
    return span;
  }

  private itemValueText(input: RenderInput, it: VisibleItem): string {
    const s = this.getSettings();
    if (input.hasMeasure && it.node.value !== null) {
      return formatActualLabel({
        value: it.node.value,
        modelFormat: input.measureFormat,
        cardUnits: String(s.valuesFormat.displayUnits.value.value),
        cardDecimals: Number(s.valuesFormat.decimals.value) || 0,
        autoDecimals: 1,
        locale: this.locale,
        dataMaxAbs: input.tree.maxAbsValue
      });
    }
    try {
      return it.node.count.toLocaleString(this.locale);
    } catch {
      return String(it.node.count);
    }
  }

  private buildDropdown(input: RenderInput): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "es-dd";

    const field = document.createElement("button");
    field.type = "button";
    field.className = "es-dd-field";
    field.dataset.action = "ddToggle";
    field.setAttribute("aria-expanded", String(this.dropdownOpen));
    field.setAttribute("aria-haspopup", "listbox");
    const summary = document.createElement("span");
    summary.className = "es-dd-summary";
    const nodes = selectedNodesInOrder(input.tree, this.selectedKeys);
    if (nodes.length === 0) {
      summary.textContent = this.str("Visual_All", "All");
      summary.classList.add("es-dd-all");
    } else if (nodes.length <= 2) {
      summary.textContent = nodes.map((n) => n.label || this.blankLabel()).join(", ");
    } else {
      summary.textContent = this.template("Visual_NSelected", "{0} selected", nodes.length);
    }
    field.appendChild(summary);
    const caret = document.createElement("span");
    caret.className = "es-dd-caret";
    caret.setAttribute("aria-hidden", "true");
    field.appendChild(caret);
    wrap.appendChild(field);

    if (this.dropdownOpen) {
      const pop = document.createElement("div");
      pop.className = "es-popover";
      if (this.getSettings().search.show.value) pop.appendChild(this.buildSearch());
      pop.appendChild(this.buildBody(input, "list"));
      wrap.appendChild(pop);
    }
    return wrap;
  }

  /** One grammar per state (design P2.7 / P1.4): active search shows the
   *  narrowed population ("3 of 47 items"), otherwise selection counts. */
  private buildFooter(input: RenderInput): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "es-footer";
    const rootTotal = input.tree.root.children.length;
    if (this.searchText.trim()) {
      const visible = visibleRootKeys(input.tree, this.searchText).length;
      footer.textContent = this.template("Visual_CountFiltered", "{0} of {1} items", visible, rootTotal);
      return footer;
    }
    const leaves = selectedLeafTuples(input.tree, this.selectedKeys).length;
    const selectedRoots = selectedNodesInOrder(input.tree, this.selectedKeys).length;
    footer.textContent =
      this.selectedKeys.size === 0
        ? this.template("Visual_CountAll", "{0} items", rootTotal)
        : input.tree.levelCount > 1
          ? this.template("Visual_CountSelectedLeaves", "{0} selected · {1} values", selectedRoots, leaves)
          : this.template("Visual_CountSelected", "{0} / {1} selected", leaves, rootTotal);
    return footer;
  }

  private restoreFocus(): void {
    if (!this.focusKey) return;
    const items = this.target.querySelectorAll<HTMLElement>("[data-key]");
    for (const el of Array.from(items)) {
      if (el.dataset.key === this.focusKey) {
        el.focus();
        return;
      }
    }
  }

  private rerender(): void {
    if (this.lastValidRenderInput) this.renderFromInput(this.lastValidRenderInput);
  }

  // -------------------------------------------------------------- interaction

  private applyFilter(): void {
    const input = this.lastValidRenderInput;
    if (!input || !this.allowInteractions) return;
    const tuples = selectedLeafTuples(input.tree, this.selectedKeys);
    const filter = buildSlicerFilter(input.targets, tuples);
    this.pendingApplies++;
    // The typings don't admit null, but the runtime contract does: a null
    // filter with FilterAction.remove releases the persisted filter.
    this.host.applyJsonFilter(
      filter as unknown as powerbi.IFilter,
      "general",
      "filter",
      filterAction(filter !== null)
    );
  }

  private setSelection(next: Set<string>): void {
    this.selectedKeys = next;
    this.applyFilter();
    this.rerender();
  }

  private toggleItem(key: string): void {
    const input = this.lastValidRenderInput;
    if (!input) return;
    const node = this.findNode(input.tree, key);
    if (!node) return;
    this.focusKey = key;
    if (this.isMulti()) {
      this.setSelection(toggleNode(node, this.selectedKeys));
    } else {
      // Single mode: replace; clicking the sole selected item releases the
      // filter (click-twice-to-clear, same UX contract as the waterfall).
      if (this.selectedKeys.size === 1 && this.selectedKeys.has(key)) {
        this.setSelection(new Set());
      } else {
        this.setSelection(new Set([key]));
      }
    }
  }

  private findNode(tree: SlicerTree, key: string): SlicerNode | null {
    let found: SlicerNode | null = null;
    const walk = (node: SlicerNode): void => {
      if (found) return;
      for (const c of node.children) {
        if (c.key === key) {
          found = c;
          return;
        }
        walk(c);
      }
    };
    walk(tree.root);
    return found;
  }

  private handleClick = (e: MouseEvent): void => {
    const t = e.target as Element | null;
    if (!t) return;

    const expander = t.closest?.("[data-exp-key]") as HTMLElement | null;
    if (expander?.dataset.expKey) {
      const key = expander.dataset.expKey;
      if (this.expandedKeys.has(key)) this.expandedKeys.delete(key);
      else this.expandedKeys.add(key);
      this.focusKey = key;
      this.rerender();
      e.stopPropagation();
      return;
    }

    const chip = t.closest?.("[data-chip-key]") as HTMLElement | null;
    if (chip?.dataset.chipKey) {
      const next = new Set(this.selectedKeys);
      next.delete(chip.dataset.chipKey);
      this.focusKey = null;
      this.setSelection(next);
      return;
    }

    const levelClear = t.closest?.("[data-clear-level]") as HTMLElement | null;
    if (levelClear?.dataset.clearLevel !== undefined) {
      const lvl = parseInt(levelClear.dataset.clearLevel || "-1", 10);
      const input = this.lastValidRenderInput;
      if (input && lvl >= 0) {
        const next = new Set(this.selectedKeys);
        for (const n of selectedNodesInOrder(input.tree, this.selectedKeys)) {
          if (n.level === lvl) next.delete(n.key);
        }
        this.focusKey = null;
        this.setSelection(next);
      }
      return;
    }

    const actionEl = t.closest?.("[data-action]") as HTMLElement | null;
    if (actionEl?.dataset.action) {
      this.runAction(actionEl.dataset.action);
      return;
    }

    const item = t.closest?.("[data-key]") as HTMLElement | null;
    if (item?.dataset.key) {
      this.toggleItem(item.dataset.key);
      const input = this.lastValidRenderInput;
      if (input && !this.isMulti() && this.dropdownOpen) {
        this.dropdownOpen = false;
        this.rerender();
      }
    }
  };

  private runAction(action: string): void {
    const input = this.lastValidRenderInput;
    switch (action) {
      case "selectAll": {
        if (!input) return;
        const keys = visibleRootKeys(input.tree, this.searchText);
        const next = new Set(this.selectedKeys);
        for (const k of keys) next.add(k);
        this.setSelection(normalizeSelection(input.tree, next));
        break;
      }
      case "invert": {
        if (!input) return;
        this.setSelection(invertSelection(input.tree, this.searchText, this.selectedKeys));
        break;
      }
      case "clear": {
        this.focusKey = null;
        this.setSelection(new Set());
        break;
      }
      case "clearSearch": {
        this.searchText = "";
        this.rerender();
        break;
      }
      case "ddToggle": {
        this.dropdownOpen = !this.dropdownOpen;
        this.rerender();
        break;
      }
    }
  }

  private handleInput = (e: Event): void => {
    const t = e.target as HTMLInputElement | null;
    if (!t || !t.classList.contains("es-search-input")) return;
    this.searchText = t.value;
    // Re-render the body only would be nicer; full re-render keeps focus via
    // the input's value + explicit restore below.
    const pos = t.selectionStart ?? t.value.length;
    this.rerender();
    const fresh = this.target.querySelector<HTMLInputElement>(".es-search-input");
    if (fresh) {
      fresh.focus();
      try {
        fresh.setSelectionRange(pos, pos);
      } catch {
        /* type=search quirks — ignore */
      }
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (!t) return;

    if (t.classList.contains("es-search-input")) {
      if (e.key === "Escape") {
        this.searchText = "";
        this.rerender();
        e.preventDefault();
      }
      return;
    }

    const item = t.closest?.("[data-key]") as HTMLElement | null;
    if (!item) return;
    const items = Array.from(this.target.querySelectorAll<HTMLElement>("[data-key]"));
    const idx = items.indexOf(item);

    switch (e.key) {
      case "ArrowDown":
        items[Math.min(items.length - 1, idx + 1)]?.focus();
        e.preventDefault();
        break;
      case "ArrowUp":
        items[Math.max(0, idx - 1)]?.focus();
        e.preventDefault();
        break;
      case "Home":
        items[0]?.focus();
        e.preventDefault();
        break;
      case "End":
        items[items.length - 1]?.focus();
        e.preventDefault();
        break;
      case "ArrowRight": {
        const key = item.dataset.key;
        if (key && !this.expandedKeys.has(key) && this.hasChildrenFor(key)) {
          this.expandedKeys.add(key);
          this.focusKey = key;
          this.rerender();
        }
        e.preventDefault();
        break;
      }
      case "ArrowLeft": {
        const key = item.dataset.key;
        if (key && this.expandedKeys.has(key)) {
          this.expandedKeys.delete(key);
          this.focusKey = key;
          this.rerender();
        }
        e.preventDefault();
        break;
      }
      case "Enter":
      case " ":
        if (item.dataset.key) this.toggleItem(item.dataset.key);
        e.preventDefault();
        break;
      case "Escape":
        if (this.dropdownOpen) {
          this.dropdownOpen = false;
          this.rerender();
        } else if (this.selectedKeys.size > 0) {
          this.setSelection(new Set());
        }
        e.preventDefault();
        break;
      case "a":
      case "A":
        if ((e.ctrlKey || e.metaKey) && this.isMulti()) {
          this.runAction("selectAll");
          e.preventDefault();
        }
        break;
    }
  };

  private hasChildrenFor(key: string): boolean {
    const input = this.lastValidRenderInput;
    if (!input) return false;
    const node = this.findNode(input.tree, key);
    return !!node && node.children.length > 0;
  }
}

export default Visual;

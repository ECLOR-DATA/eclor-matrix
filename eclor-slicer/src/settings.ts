"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** ColorPicker with the fx (conditional formatting) affordance — wildcard
 *  selector + ConstantOrRule instanceKind (playbook §3.3/§6.8). The enum is
 *  read defensively because the jest stub ships no runtime (ConstantOrRule=3). */
function makeFxColorPicker(opts: {
  name: string;
  displayName: string;
  displayNameKey: string;
  value: { value: string };
}): formattingSettings.ColorPicker {
  const cp = new formattingSettings.ColorPicker(opts);
  cp.selector = dataViewWildcard.createDataViewWildcardSelector(
    dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
  );
  cp.instanceKind = ((powerbi as unknown as { VisualEnumerationInstanceKinds?: { ConstantOrRule: number } })
    .VisualEnumerationInstanceKinds?.ConstantOrRule ?? 3) as powerbi.VisualEnumerationInstanceKinds;
  return cp;
}

function extractFill(obj: unknown): string | null {
  const o = obj as { solid?: { color?: unknown }; value?: unknown } | undefined;
  const v = o?.solid?.color ?? o?.value;
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

/** fx persistence cascade (playbook §4.2.1/§4.2.2/§6.9): a wildcard fx
 *  constant/rule result may land on the first category row's objects, on
 *  metadata.objects, or on values[i].source.objects — first valid fill wins.
 *  populateFormattingSettingsModel only reads metadata.objects, so update()
 *  patches every fx slice through this after populate. */
export function readPersistedFx(dv: powerbi.DataView | undefined, objName: string, propName: string): string | null {
  const cat0 = dv?.categorical?.categories?.[0] as { objects?: Record<string, Record<string, unknown>>[] } | undefined;
  // The first-row slot only counts as a GLOBAL constant when every row that
  // carries a fill agrees — heterogeneous fills are fx RULE results and stay
  // per-item (readRowFills), never promoted to the global slice.
  const rowCount = (dv?.categorical?.categories?.[0]?.values ?? []).length;
  const rowFills = (cat0?.objects ?? []).map((o) => extractFill(o?.[objName]?.[propName])).filter((x) => x !== null);
  const homogeneous = rowCount > 0 && rowFills.length === rowCount && rowFills.every((x) => x === rowFills[0]);
  let v = homogeneous ? rowFills[0] : null;
  if (v) return v;
  v = extractFill((dv?.metadata?.objects as Record<string, Record<string, unknown>> | undefined)?.[objName]?.[propName]);
  if (v) return v;
  for (const grp of dv?.categorical?.values || []) {
    v = extractFill(
      (grp as { source?: { objects?: Record<string, Record<string, unknown>> } }).source?.objects?.[objName]?.[propName]
    );
    if (v) return v;
  }
  return null;
}

/** Per-row fills persisted by fx RULES on the first field's category rows —
 *  feeds per-item conditional colours (flat lists; ChicletSlicer parity). */
export function readRowFills(
  dv: powerbi.DataView | undefined,
  objName: string,
  propName: string
): (string | null)[] {
  const cat0 = dv?.categorical?.categories?.[0] as { objects?: Record<string, Record<string, unknown>>[] } | undefined;
  const objects = cat0?.objects;
  if (!objects) return [];
  return objects.map((o) => extractFill(o?.[objName]?.[propName]));
}

function makeFont(prefix: string, defaultSize: number, defaultBold: boolean): formattingSettings.FontControl {
  return new formattingSettings.FontControl({
    name: `${prefix}Font`,
    displayName: "Font",
    displayNameKey: "Visual_Font",
    fontFamily: new formattingSettings.FontPicker({
      name: "fontFamily",
      value: "Arial, 'Segoe UI', wf_segoe-ui_normal, helvetica, sans-serif"
    }),
    fontSize: new formattingSettings.NumUpDown({
      name: "fontSize",
      value: defaultSize,
      options: {
        minValue: { type: 0, value: 8 },
        maxValue: { type: 1, value: 32 }
      }
    }),
    bold: new formattingSettings.ToggleSwitch({ name: "bold", value: defaultBold }),
    italic: new formattingSettings.ToggleSwitch({ name: "italic", value: false }),
    underline: new formattingSettings.ToggleSwitch({ name: "underline", value: false })
  });
}

/** Localized dropdown item — the FormattingSettingsService resolves
 *  `displayNameKey` through the host localization manager; `displayName`
 *  stays as the en-US fallback (playbook §2.6 / audit I18N-01). */
interface LocItem {
  value: string;
  displayName: string;
  displayNameKey: string;
}

/** The five canonical display-unit values — shared with visual.ts so the
 *  list can never drift between the pane and its readers (same contract as
 *  eclor-matrix / eclor-waterfall). */
export const DISPLAY_UNIT_VALUES = ["auto", "none", "thousands", "millions", "billions"] as const;

const DISPLAY_UNIT_ITEMS: LocItem[] = [
  { value: "auto", displayName: "Auto", displayNameKey: "Visual_UnitsAuto" },
  { value: "none", displayName: "None", displayNameKey: "Visual_UnitsNone" },
  { value: "thousands", displayName: "Thousands", displayNameKey: "Visual_UnitsThousands" },
  { value: "millions", displayName: "Millions", displayNameKey: "Visual_UnitsMillions" },
  { value: "billions", displayName: "Billions", displayNameKey: "Visual_UnitsBillions" }
];

class SelectionCardSettings extends FormattingSettingsCard {
  selectionMode = new formattingSettings.ItemDropdown({
    name: "selectionMode",
    displayName: "Selection mode",
    displayNameKey: "Visual_SelectionMode",
    items: [
      { value: "multi", displayName: "Multiple", displayNameKey: "Visual_ModeMulti" },
      { value: "single", displayName: "Single", displayNameKey: "Visual_ModeSingle" }
    ] as LocItem[],
    value: { value: "multi", displayName: "Multiple" }
  });

  showSelectAll = new formattingSettings.ToggleSwitch({
    name: "showSelectAll",
    displayName: "Show \"Select all\"",
    displayNameKey: "Visual_ShowSelectAll",
    value: true
  });

  showInvert = new formattingSettings.ToggleSwitch({
    name: "showInvert",
    displayName: "Show \"Invert\"",
    displayNameKey: "Visual_ShowInvert",
    value: true
  });

  showClear = new formattingSettings.ToggleSwitch({
    name: "showClear",
    displayName: "Show \"Clear\"",
    displayNameKey: "Visual_ShowClear",
    value: true
  });

  name: string = "selection";
  displayName: string = "Selection";
  displayNameKey: string = "Visual_Selection";
  slices: FormattingSettingsSlice[] = [this.selectionMode, this.showSelectAll, this.showInvert, this.showClear];
}

class StyleCardSettings extends FormattingSettingsCard {
  layout = new formattingSettings.ItemDropdown({
    name: "layout",
    displayName: "Layout",
    displayNameKey: "Visual_Layout",
    items: [
      { value: "auto", displayName: "Auto", displayNameKey: "Visual_LayoutAuto" },
      { value: "list", displayName: "Vertical list", displayNameKey: "Visual_LayoutList" },
      { value: "chiclets", displayName: "Chiclet buttons", displayNameKey: "Visual_LayoutChiclets" },
      { value: "dropdown", displayName: "Dropdown", displayNameKey: "Visual_LayoutDropdown" }
    ] as LocItem[],
    value: { value: "auto", displayName: "Auto" }
  });

  chicletColumns = new formattingSettings.NumUpDown({
    name: "chicletColumns",
    displayName: "Chiclet columns",
    displayNameKey: "Visual_ChicletColumns",
    value: 3,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 8 }
    }
  });

  textSize = new formattingSettings.NumUpDown({
    name: "textSize",
    displayName: "Text size",
    displayNameKey: "Visual_TextSize",
    value: 11,
    options: {
      minValue: { type: 0, value: 8 },
      maxValue: { type: 1, value: 24 }
    }
  });

  density = new formattingSettings.ItemDropdown({
    name: "density",
    displayName: "Item density",
    displayNameKey: "Visual_Density",
    items: [
      { value: "compact", displayName: "Compact", displayNameKey: "Visual_DensityCompact" },
      { value: "normal", displayName: "Normal", displayNameKey: "Visual_DensityNormal" },
      { value: "comfortable", displayName: "Comfortable", displayNameKey: "Visual_DensityComfortable" }
    ] as LocItem[],
    value: { value: "normal", displayName: "Normal" }
  });

  innerPadding = new formattingSettings.NumUpDown({
    name: "innerPadding",
    displayName: "Inner padding (px)",
    displayNameKey: "Visual_InnerPadding",
    value: 0,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 24 }
    }
  });

  itemSpacing = new formattingSettings.NumUpDown({
    name: "itemSpacing",
    displayName: "Item spacing (px)",
    displayNameKey: "Visual_ItemSpacing",
    value: 0,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 12 }
    }
  });

  name: string = "slicerStyle";
  displayName: string = "Style";
  displayNameKey: string = "Visual_Style";
  slices: FormattingSettingsSlice[] = [
    this.layout,
    this.chicletColumns,
    this.textSize,
    this.density,
    this.innerPadding,
    this.itemSpacing
  ];
}

class HeaderCardSettings extends FormattingSettingsCard {
  show = new formattingSettings.ToggleSwitch({
    name: "show",
    displayName: "Show header",
    displayNameKey: "Visual_ShowHeader",
    value: true
  });

  title = new formattingSettings.TextInput({
    name: "title",
    displayName: "Title",
    displayNameKey: "Visual_Title",
    value: "",
    placeholder: "Field name"
  });

  font = makeFont("header", 11, true);

  fontColor = makeFxColorPicker({
    name: "fontColor",
    displayName: "Font color",
    displayNameKey: "Visual_FontColor",
    value: { value: "" }
  });

  backColor = makeFxColorPicker({
    name: "backColor",
    displayName: "Background color",
    displayNameKey: "Visual_BackColor",
    value: { value: "" }
  });

  name: string = "slicerHeader";
  displayName: string = "Header";
  displayNameKey: string = "Visual_Header";
  slices: FormattingSettingsSlice[] = [this.show, this.title, this.font, this.fontColor, this.backColor];
}

class SearchCardSettings extends FormattingSettingsCard {
  show = new formattingSettings.ToggleSwitch({
    name: "show",
    displayName: "Show search box",
    displayNameKey: "Visual_ShowSearch",
    value: true
  });

  placeholder = new formattingSettings.TextInput({
    name: "placeholder",
    displayName: "Placeholder text",
    displayNameKey: "Visual_Placeholder",
    value: "",
    placeholder: "Search…"
  });

  name: string = "search";
  displayName: string = "Search";
  displayNameKey: string = "Visual_Search";
  slices: FormattingSettingsSlice[] = [this.show, this.placeholder];
}

class ChipsCardSettings extends FormattingSettingsCard {
  show = new formattingSettings.ToggleSwitch({
    name: "show",
    displayName: "Show badges",
    displayNameKey: "Visual_ShowChips",
    value: true
  });

  position = new formattingSettings.ItemDropdown({
    name: "position",
    displayName: "Position",
    displayNameKey: "Visual_Position",
    items: [
      { value: "top", displayName: "Top", displayNameKey: "Visual_PositionTop" },
      { value: "bottom", displayName: "Bottom", displayNameKey: "Visual_PositionBottom" }
    ] as LocItem[],
    value: { value: "top", displayName: "Top" }
  });

  maxChips = new formattingSettings.NumUpDown({
    name: "maxChips",
    displayName: "Max visible badges",
    displayNameKey: "Visual_MaxChips",
    value: 6,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 30 }
    }
  });

  chipColor = makeFxColorPicker({
    name: "chipColor",
    displayName: "Badge color",
    displayNameKey: "Visual_ChipColor",
    value: { value: "" }
  });

  chipTextColor = makeFxColorPicker({
    name: "chipTextColor",
    displayName: "Badge text color",
    displayNameKey: "Visual_ChipTextColor",
    value: { value: "" }
  });

  bold = new formattingSettings.ToggleSwitch({
    name: "bold",
    displayName: "Bold",
    displayNameKey: "Visual_Bold",
    value: false
  });

  name: string = "chips";
  displayName: string = "Selection badges";
  displayNameKey: string = "Visual_Chips";
  slices: FormattingSettingsSlice[] = [
    this.show,
    this.position,
    this.maxChips,
    this.chipColor,
    this.chipTextColor,
    this.bold
  ];
}

class ItemsCardSettings extends FormattingSettingsCard {
  font = makeFont("items", 11, false);

  fontColor = makeFxColorPicker({
    name: "fontColor",
    displayName: "Font color",
    displayNameKey: "Visual_FontColor",
    value: { value: "" }
  });

  backColor = makeFxColorPicker({
    name: "backColor",
    displayName: "Background color",
    displayNameKey: "Visual_BackColor",
    value: { value: "" }
  });

  selectedColor = makeFxColorPicker({
    name: "selectedColor",
    displayName: "Selected background",
    displayNameKey: "Visual_SelectedColor",
    value: { value: "" }
  });

  selectedFontColor = makeFxColorPicker({
    name: "selectedFontColor",
    displayName: "Selected font color",
    displayNameKey: "Visual_SelectedFontColor",
    value: { value: "" }
  });

  borderRadius = new formattingSettings.NumUpDown({
    name: "borderRadius",
    displayName: "Border radius (px)",
    displayNameKey: "Visual_BorderRadius",
    value: 8,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 24 }
    }
  });

  indicator = new formattingSettings.ItemDropdown({
    name: "indicator",
    displayName: "Selection indicator",
    displayNameKey: "Visual_Indicator",
    items: [
      { value: "check", displayName: "Checkbox", displayNameKey: "Visual_IndicatorCheck" },
      { value: "toggle", displayName: "Toggle switch", displayNameKey: "Visual_IndicatorToggle" },
      { value: "tick", displayName: "Tick only", displayNameKey: "Visual_IndicatorTick" },
      { value: "dot", displayName: "Dot", displayNameKey: "Visual_IndicatorDot" },
      { value: "none", displayName: "None (background only)", displayNameKey: "Visual_IndicatorNone" }
    ] as LocItem[],
    value: { value: "check", displayName: "Checkbox" }
  });

  indicatorShape = new formattingSettings.ItemDropdown({
    name: "indicatorShape",
    displayName: "Indicator shape",
    displayNameKey: "Visual_IndicatorShape",
    items: [
      { value: "square", displayName: "Square", displayNameKey: "Visual_ShapeSquare" },
      { value: "round", displayName: "Round", displayNameKey: "Visual_ShapeRound" }
    ] as LocItem[],
    value: { value: "square", displayName: "Square" }
  });

  indicatorPosition = new formattingSettings.ItemDropdown({
    name: "indicatorPosition",
    displayName: "Indicator position",
    displayNameKey: "Visual_IndicatorPosition",
    items: [
      { value: "left", displayName: "Left", displayNameKey: "Visual_PosLeft" },
      { value: "right", displayName: "Right", displayNameKey: "Visual_PosRight" },
      { value: "center", displayName: "Center", displayNameKey: "Visual_PosCenter" }
    ] as LocItem[],
    value: { value: "left", displayName: "Left" }
  });

  wrapLabels = new formattingSettings.ToggleSwitch({
    name: "wrapLabels",
    displayName: "Wrap long labels",
    displayNameKey: "Visual_WrapLabels",
    value: false
  });

  showCounts = new formattingSettings.ToggleSwitch({
    name: "showCounts",
    displayName: "Show counts / values",
    displayNameKey: "Visual_ShowCounts",
    value: true
  });

  name: string = "items";
  displayName: string = "Items";
  displayNameKey: string = "Visual_Items";
  slices: FormattingSettingsSlice[] = [
    this.font,
    this.fontColor,
    this.backColor,
    this.selectedColor,
    this.selectedFontColor,
    this.borderRadius,
    this.indicator,
    this.indicatorShape,
    this.indicatorPosition,
    this.wrapLabels,
    this.showCounts
  ];
}

class HierarchyCardSettings extends FormattingSettingsCard {
  expandAll = new formattingSettings.ToggleSwitch({
    name: "expandAll",
    displayName: "Expand all by default",
    displayNameKey: "Visual_ExpandAll",
    value: false
  });

  singleExpand = new formattingSettings.ToggleSwitch({
    name: "singleExpand",
    displayName: "Accordion (one branch open per level)",
    displayNameKey: "Visual_SingleExpand",
    value: false
  });

  indent = new formattingSettings.NumUpDown({
    name: "indent",
    displayName: "Indent per level (px)",
    displayNameKey: "Visual_Indent",
    value: 16,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 60 }
    }
  });

  name: string = "hierarchy";
  displayName: string = "Hierarchy";
  displayNameKey: string = "Visual_Hierarchy";
  slices: FormattingSettingsSlice[] = [this.expandAll, this.singleExpand, this.indent];
}

class ValuesFormatCardSettings extends FormattingSettingsCard {
  displayUnits = new formattingSettings.ItemDropdown({
    name: "displayUnits",
    displayName: "Display units",
    displayNameKey: "Visual_DisplayUnits",
    items: DISPLAY_UNIT_ITEMS,
    value: DISPLAY_UNIT_ITEMS[0]
  });

  decimals = new formattingSettings.NumUpDown({
    name: "decimals",
    displayName: "Decimal places",
    displayNameKey: "Visual_Decimals",
    value: 0,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 6 }
    }
  });

  name: string = "valuesFormat";
  displayName: string = "Value format";
  displayNameKey: string = "Visual_ValuesFormat";
  slices: FormattingSettingsSlice[] = [this.displayUnits, this.decimals];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
  selection = new SelectionCardSettings();
  slicerStyle = new StyleCardSettings();
  slicerHeader = new HeaderCardSettings();
  search = new SearchCardSettings();
  chips = new ChipsCardSettings();
  items = new ItemsCardSettings();
  hierarchy = new HierarchyCardSettings();
  valuesFormat = new ValuesFormatCardSettings();

  cards = [
    this.selection,
    this.slicerStyle,
    this.slicerHeader,
    this.search,
    this.chips,
    this.items,
    this.hierarchy,
    this.valuesFormat
  ];
}

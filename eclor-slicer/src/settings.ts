"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

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

  name: string = "slicerStyle";
  displayName: string = "Style";
  displayNameKey: string = "Visual_Style";
  slices: FormattingSettingsSlice[] = [this.layout, this.chicletColumns, this.textSize, this.density];
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

  bold = new formattingSettings.ToggleSwitch({
    name: "bold",
    displayName: "Bold",
    displayNameKey: "Visual_Bold",
    value: true
  });

  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    displayNameKey: "Visual_FontColor",
    value: { value: "" }
  });

  backColor = new formattingSettings.ColorPicker({
    name: "backColor",
    displayName: "Background color",
    displayNameKey: "Visual_BackColor",
    value: { value: "" }
  });

  name: string = "slicerHeader";
  displayName: string = "Header";
  displayNameKey: string = "Visual_Header";
  slices: FormattingSettingsSlice[] = [this.show, this.title, this.bold, this.fontColor, this.backColor];
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

  chipColor = new formattingSettings.ColorPicker({
    name: "chipColor",
    displayName: "Badge color",
    displayNameKey: "Visual_ChipColor",
    value: { value: "" }
  });

  chipTextColor = new formattingSettings.ColorPicker({
    name: "chipTextColor",
    displayName: "Badge text color",
    displayNameKey: "Visual_ChipTextColor",
    value: { value: "" }
  });

  name: string = "chips";
  displayName: string = "Selection badges";
  displayNameKey: string = "Visual_Chips";
  slices: FormattingSettingsSlice[] = [this.show, this.position, this.maxChips, this.chipColor, this.chipTextColor];
}

class ItemsCardSettings extends FormattingSettingsCard {
  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    displayNameKey: "Visual_FontColor",
    value: { value: "" }
  });

  backColor = new formattingSettings.ColorPicker({
    name: "backColor",
    displayName: "Background color",
    displayNameKey: "Visual_BackColor",
    value: { value: "" }
  });

  selectedColor = new formattingSettings.ColorPicker({
    name: "selectedColor",
    displayName: "Selected background",
    displayNameKey: "Visual_SelectedColor",
    value: { value: "" }
  });

  selectedFontColor = new formattingSettings.ColorPicker({
    name: "selectedFontColor",
    displayName: "Selected font color",
    displayNameKey: "Visual_SelectedFontColor",
    value: { value: "" }
  });

  borderRadius = new formattingSettings.NumUpDown({
    name: "borderRadius",
    displayName: "Border radius (px)",
    displayNameKey: "Visual_BorderRadius",
    value: 6,
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
  slices: FormattingSettingsSlice[] = [this.expandAll, this.indent];
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

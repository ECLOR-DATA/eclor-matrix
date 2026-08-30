"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** The five canonical display-unit values — shared with visual.ts so the
 *  list can never drift between the pane and its readers (same contract as
 *  eclor-matrix / eclor-waterfall). */
export const DISPLAY_UNIT_VALUES = ["auto", "none", "thousands", "millions", "billions"] as const;

const DISPLAY_UNIT_ITEMS: powerbi.IEnumMember[] = [
  { value: "auto", displayName: "Auto" },
  { value: "none", displayName: "None" },
  { value: "thousands", displayName: "Thousands" },
  { value: "millions", displayName: "Millions" },
  { value: "billions", displayName: "Billions" }
];

class SelectionCardSettings extends FormattingSettingsCard {
  selectionMode = new formattingSettings.ItemDropdown({
    name: "selectionMode",
    displayName: "Selection mode",
    items: [
      { value: "multi", displayName: "Multiple" },
      { value: "single", displayName: "Single" }
    ],
    value: { value: "multi", displayName: "Multiple" }
  });

  showSelectAll = new formattingSettings.ToggleSwitch({
    name: "showSelectAll",
    displayName: "Show \"Select all\"",
    value: true
  });

  showInvert = new formattingSettings.ToggleSwitch({
    name: "showInvert",
    displayName: "Show \"Invert\"",
    value: true
  });

  showClear = new formattingSettings.ToggleSwitch({
    name: "showClear",
    displayName: "Show \"Clear\"",
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
    items: [
      { value: "auto", displayName: "Auto" },
      { value: "list", displayName: "Vertical list" },
      { value: "chiclets", displayName: "Chiclet buttons" },
      { value: "dropdown", displayName: "Dropdown" }
    ],
    value: { value: "auto", displayName: "Auto" }
  });

  chicletColumns = new formattingSettings.NumUpDown({
    name: "chicletColumns",
    displayName: "Chiclet columns",
    value: 3,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 8 }
    }
  });

  textSize = new formattingSettings.NumUpDown({
    name: "textSize",
    displayName: "Text size",
    value: 11,
    options: {
      minValue: { type: 0, value: 8 },
      maxValue: { type: 1, value: 24 }
    }
  });

  density = new formattingSettings.ItemDropdown({
    name: "density",
    displayName: "Item density",
    items: [
      { value: "compact", displayName: "Compact" },
      { value: "normal", displayName: "Normal" },
      { value: "comfortable", displayName: "Comfortable" }
    ],
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
    value: true
  });

  title = new formattingSettings.TextInput({
    name: "title",
    displayName: "Title",
    value: "",
    placeholder: "Field name"
  });

  bold = new formattingSettings.ToggleSwitch({
    name: "bold",
    displayName: "Bold",
    value: true
  });

  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    value: { value: "" }
  });

  backColor = new formattingSettings.ColorPicker({
    name: "backColor",
    displayName: "Background color",
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
    value: true
  });

  placeholder = new formattingSettings.TextInput({
    name: "placeholder",
    displayName: "Placeholder text",
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
    value: true
  });

  position = new formattingSettings.ItemDropdown({
    name: "position",
    displayName: "Position",
    items: [
      { value: "top", displayName: "Top" },
      { value: "bottom", displayName: "Bottom" }
    ],
    value: { value: "top", displayName: "Top" }
  });

  maxChips = new formattingSettings.NumUpDown({
    name: "maxChips",
    displayName: "Max visible badges",
    value: 6,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 30 }
    }
  });

  chipColor = new formattingSettings.ColorPicker({
    name: "chipColor",
    displayName: "Badge color",
    value: { value: "" }
  });

  chipTextColor = new formattingSettings.ColorPicker({
    name: "chipTextColor",
    displayName: "Badge text color",
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
    value: { value: "" }
  });

  backColor = new formattingSettings.ColorPicker({
    name: "backColor",
    displayName: "Background color",
    value: { value: "" }
  });

  selectedColor = new formattingSettings.ColorPicker({
    name: "selectedColor",
    displayName: "Selected background",
    value: { value: "" }
  });

  selectedFontColor = new formattingSettings.ColorPicker({
    name: "selectedFontColor",
    displayName: "Selected font color",
    value: { value: "" }
  });

  borderRadius = new formattingSettings.NumUpDown({
    name: "borderRadius",
    displayName: "Border radius (px)",
    value: 6,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 24 }
    }
  });

  showCounts = new formattingSettings.ToggleSwitch({
    name: "showCounts",
    displayName: "Show counts / values",
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
    this.showCounts
  ];
}

class HierarchyCardSettings extends FormattingSettingsCard {
  expandAll = new formattingSettings.ToggleSwitch({
    name: "expandAll",
    displayName: "Expand all by default",
    value: false
  });

  indent = new formattingSettings.NumUpDown({
    name: "indent",
    displayName: "Indent per level (px)",
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
    items: DISPLAY_UNIT_ITEMS,
    value: DISPLAY_UNIT_ITEMS[0]
  });

  decimals = new formattingSettings.NumUpDown({
    name: "decimals",
    displayName: "Decimal places",
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

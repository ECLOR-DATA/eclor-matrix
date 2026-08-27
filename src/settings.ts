"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** The five canonical display-unit values — consumed by visual.ts too so the
 *  list can never drift between the pane and its readers. */
export const DISPLAY_UNIT_VALUES = ["auto", "none", "thousands", "millions", "billions"] as const;

const DISPLAY_UNIT_ITEMS: powerbi.IEnumMember[] = [
  { value: "auto", displayName: "Auto" },
  { value: "none", displayName: "None" },
  { value: "thousands", displayName: "Thousands" },
  { value: "millions", displayName: "Millions" },
  { value: "billions", displayName: "Billions" }
];

class GeneralCardSettings extends FormattingSettingsCard {
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
    displayName: "Row density",
    items: [
      { value: "compact", displayName: "Compact" },
      { value: "normal", displayName: "Normal" },
      { value: "comfortable", displayName: "Comfortable" }
    ],
    value: { value: "normal", displayName: "Normal" }
  });

  rowPadding = new formattingSettings.NumUpDown({
    name: "rowPadding",
    displayName: "Row padding (px, 0 = density)",
    value: 0,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 30 }
    }
  });

  cellPaddingX = new formattingSettings.NumUpDown({
    name: "cellPaddingX",
    displayName: "Cell padding (px, horizontal)",
    value: 8,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 40 }
    }
  });

  name: string = "general";
  displayName: string = "General";
  displayNameKey: string = "Visual_General";
  slices: FormattingSettingsSlice[] = [this.textSize, this.density, this.rowPadding, this.cellPaddingX];
}

/** Grid & borders — every rule of the table chrome is now an option (the
 *  theme defaults stay: horizontal-only #E5E7E6, header bottom rule). */
class GridCardSettings extends FormattingSettingsCard {
  horizontal = new formattingSettings.ToggleSwitch({
    name: "horizontal",
    displayName: "Horizontal grid",
    value: true
  });
  horizontalColor = new formattingSettings.ColorPicker({
    name: "horizontalColor",
    displayName: "Horizontal color",
    value: { value: "" }
  });
  horizontalWidth = new formattingSettings.NumUpDown({
    name: "horizontalWidth",
    displayName: "Horizontal width (px)",
    value: 1,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 4 }
    }
  });
  vertical = new formattingSettings.ToggleSwitch({
    name: "vertical",
    displayName: "Vertical grid",
    value: false
  });
  verticalColor = new formattingSettings.ColorPicker({
    name: "verticalColor",
    displayName: "Vertical color",
    value: { value: "" }
  });
  verticalWidth = new formattingSettings.NumUpDown({
    name: "verticalWidth",
    displayName: "Vertical width (px)",
    value: 1,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 4 }
    }
  });
  outerBorder = new formattingSettings.ToggleSwitch({
    name: "outerBorder",
    displayName: "Outer border",
    value: false
  });
  outerColor = new formattingSettings.ColorPicker({
    name: "outerColor",
    displayName: "Outer border color",
    value: { value: "" }
  });
  outerWidth = new formattingSettings.NumUpDown({
    name: "outerWidth",
    displayName: "Outer border width (px)",
    value: 1,
    options: {
      minValue: { type: 0, value: 1 },
      maxValue: { type: 1, value: 4 }
    }
  });
  headerRule = new formattingSettings.ToggleSwitch({
    name: "headerRule",
    displayName: "Header bottom rule",
    value: true
  });

  name: string = "grid";
  displayName: string = "Grid & borders";
  displayNameKey: string = "Visual_Grid";
  slices: FormattingSettingsSlice[] = [
    this.horizontal,
    this.horizontalColor,
    this.horizontalWidth,
    this.vertical,
    this.verticalColor,
    this.verticalWidth,
    this.outerBorder,
    this.outerColor,
    this.outerWidth,
    this.headerRule
  ];
}

class RowHeadersCardSettings extends FormattingSettingsCard {
  bold = new formattingSettings.ToggleSwitch({ name: "bold", displayName: "Bold", value: false });
  italic = new formattingSettings.ToggleSwitch({ name: "italic", displayName: "Italic", value: false });
  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    value: { value: "" }
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
  groupBold = new formattingSettings.ToggleSwitch({
    name: "groupBold",
    displayName: "Bold group rows",
    value: false
  });
  groupBackColor = new formattingSettings.ColorPicker({
    name: "groupBackColor",
    displayName: "Group row background",
    value: { value: "" }
  });
  showChevrons = new formattingSettings.ToggleSwitch({
    name: "showChevrons",
    displayName: "Show expand icons",
    value: true
  });

  name: string = "rowHeaders";
  displayName: string = "Row headers";
  displayNameKey: string = "Visual_RowHeaders";
  slices: FormattingSettingsSlice[] = [
    this.bold,
    this.italic,
    this.fontColor,
    this.indent,
    this.groupBold,
    this.groupBackColor,
    this.showChevrons
  ];
}

class ColumnHeadersCardSettings extends FormattingSettingsCard {
  bold = new formattingSettings.ToggleSwitch({ name: "bold", displayName: "Bold", value: true });
  italic = new formattingSettings.ToggleSwitch({ name: "italic", displayName: "Italic", value: false });
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
  alignment = new formattingSettings.ItemDropdown({
    name: "alignment",
    displayName: "Alignment",
    items: [
      { value: "left", displayName: "Left" },
      { value: "center", displayName: "Center" },
      { value: "right", displayName: "Right" }
    ],
    value: { value: "center", displayName: "Center" }
  });
  rotation = new formattingSettings.ItemDropdown({
    name: "rotation",
    displayName: "Rotation",
    items: [
      { value: "0", displayName: "0°" },
      { value: "45", displayName: "45°" },
      { value: "90", displayName: "90°" }
    ],
    value: { value: "0", displayName: "0°" }
  });

  name: string = "columnHeaders";
  displayName: string = "Column headers";
  displayNameKey: string = "Visual_ColumnHeaders";
  slices: FormattingSettingsSlice[] = [
    this.bold,
    this.italic,
    this.fontColor,
    this.backColor,
    this.alignment,
    this.rotation
  ];
}

/** Mirrors the capabilities `subtotals` switch mappings 1:1 — all six
 *  properties must exist and persist or the host silently disables the
 *  whole Total/SubTotal API (playbook §4.3.6). */
class SubTotalsCardSettings extends FormattingSettingsCard {
  rowSubtotals = new formattingSettings.ToggleSwitch({
    name: "rowSubtotals",
    displayName: "Row subtotals",
    value: true
  });

  perRowLevel = new formattingSettings.ToggleSwitch({
    name: "perRowLevel",
    displayName: "Per row level",
    value: false
  });

  levelSubtotalEnabled = new formattingSettings.ToggleSwitch({
    name: "levelSubtotalEnabled",
    displayName: "Per level",
    value: true
  });

  columnSubtotals = new formattingSettings.ToggleSwitch({
    name: "columnSubtotals",
    displayName: "Column subtotals",
    value: true
  });

  perColumnLevel = new formattingSettings.ToggleSwitch({
    name: "perColumnLevel",
    displayName: "Per column level",
    value: false
  });

  rowSubtotalsType = new formattingSettings.ItemDropdown({
    name: "rowSubtotalsType",
    displayName: "Row subtotal position",
    items: [
      { value: "Top", displayName: "Top" },
      { value: "Bottom", displayName: "Bottom" }
    ],
    value: { value: "Top", displayName: "Top" }
  });

  name: string = "subTotals";
  displayName: string = "Subtotals";
  displayNameKey: string = "Visual_SubTotals";
  slices: FormattingSettingsSlice[] = [
    this.rowSubtotals,
    this.perRowLevel,
    this.levelSubtotalEnabled,
    this.columnSubtotals,
    this.perColumnLevel,
    this.rowSubtotalsType
  ];
}

/** Subtotal STYLING lives in its own object — the `subTotals` card above is
 *  the load-bearing mirror of the capabilities switch mappings and must not
 *  grow unrelated properties (playbook §4.3.6). */
class SubtotalsStyleCardSettings extends FormattingSettingsCard {
  backColor = new formattingSettings.ColorPicker({
    name: "backColor",
    displayName: "Background color",
    value: { value: "" }
  });
  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    value: { value: "" }
  });
  bold = new formattingSettings.ToggleSwitch({
    name: "bold",
    displayName: "Bold",
    value: true
  });

  name: string = "subtotalsStyle";
  displayName: string = "Subtotal style";
  displayNameKey: string = "Visual_SubtotalsStyle";
  slices: FormattingSettingsSlice[] = [this.backColor, this.fontColor, this.bold];
}

/** Data comments (Zebra-style): text measures on the `comments` role,
 *  fed from the model (SharePoint list / Excel via Power Query). See
 *  docs/COMMENTS.md for the full portable architecture. */
class CommentsCardSettings extends FormattingSettingsCard {
  show = new formattingSettings.ToggleSwitch({
    name: "show",
    displayName: "Show comments",
    value: true
  });
  display = new formattingSettings.ItemDropdown({
    name: "display",
    displayName: "Display",
    items: [
      { value: "markers", displayName: "Markers only" },
      { value: "column", displayName: "Inline column" }
    ],
    value: { value: "markers", displayName: "Markers only" }
  });
  markerColor = new formattingSettings.ColorPicker({
    name: "markerColor",
    displayName: "Marker color",
    value: { value: "#1EF5B1" }
  });
  fontColor = new formattingSettings.ColorPicker({
    name: "fontColor",
    displayName: "Font color",
    value: { value: "" }
  });
  bold = new formattingSettings.ToggleSwitch({ name: "bold", displayName: "Bold", value: false });
  italic = new formattingSettings.ToggleSwitch({ name: "italic", displayName: "Italic", value: false });
  underline = new formattingSettings.ToggleSwitch({
    name: "underline",
    displayName: "Underline",
    value: false
  });
  columnTitle = new formattingSettings.TextInput({
    name: "columnTitle",
    displayName: "Inline column title",
    value: "",
    placeholder: "Comments"
  });

  name: string = "comments";
  displayName: string = "Comments";
  displayNameKey: string = "Visual_Comments";
  slices: FormattingSettingsSlice[] = [
    this.show,
    this.display,
    this.markerColor,
    this.fontColor,
    this.bold,
    this.italic,
    this.underline,
    this.columnTitle
  ];
}

/** Values card — a CompositeCard: one static "All measures" group plus one
 *  dynamic group per bound measure (built each update() in visual.ts with
 *  `selector: { metadata: queryName }`; persisted instances come back on
 *  `valueSources[i].objects`, patched by parseMatrix — NOT by populate). */
class ValuesCardSettings extends formattingSettings.CompositeCard {
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

  globalGroup: formattingSettings.Group = new formattingSettings.Group({
    name: "valuesGlobal",
    displayName: "All measures",
    slices: [this.displayUnits, this.decimals]
  });

  name: string = "values";
  displayName: string = "Values";
  displayNameKey: string = "Visual_Values";
  groups: formattingSettings.Group[] = [this.globalGroup];
}

/** Per-measure format override persisted on the measure's metadata objects. */
export interface MeasureFormatOverride {
  useCustom: boolean;
  units: string;
  decimals: number;
  /** IBCS scenario override: auto | AC | PY | BU | FC | none. */
  scenario: string;
}

const SCENARIO_ITEMS: powerbi.IEnumMember[] = [
  { value: "auto", displayName: "Auto (detect from name)" },
  { value: "AC", displayName: "AC — Actual" },
  { value: "PY", displayName: "PY — Prior year" },
  { value: "BU", displayName: "BU — Budget/Plan" },
  { value: "FC", displayName: "FC — Forecast" },
  { value: "none", displayName: "None" }
];

/** Build the dynamic per-measure group slices (phase-2 pattern reused by
 *  later per-measure cards). `selector` targets the measure's metadata. */
export function makePerMeasureValueGroup(
  index: number,
  displayName: string,
  queryName: string,
  persisted: MeasureFormatOverride
): formattingSettings.Group {
  const selector = { metadata: queryName } as powerbi.data.Selector;
  const useCustom = new formattingSettings.ToggleSwitch({
    name: "useCustom",
    displayName: "Override format",
    value: persisted.useCustom
  });
  useCustom.selector = selector;
  const unitItem = DISPLAY_UNIT_ITEMS.find((i) => i.value === persisted.units) ?? DISPLAY_UNIT_ITEMS[0];
  const units = new formattingSettings.ItemDropdown({
    name: "displayUnits",
    displayName: "Display units",
    items: DISPLAY_UNIT_ITEMS,
    value: unitItem
  });
  units.selector = selector;
  const decimals = new formattingSettings.NumUpDown({
    name: "decimals",
    displayName: "Decimal places",
    value: persisted.decimals,
    options: {
      minValue: { type: 0, value: 0 },
      maxValue: { type: 1, value: 6 }
    }
  });
  decimals.selector = selector;
  const scenarioItem = SCENARIO_ITEMS.find((i) => i.value === persisted.scenario) ?? SCENARIO_ITEMS[0];
  const scenario = new formattingSettings.ItemDropdown({
    name: "scenario",
    displayName: "IBCS scenario",
    items: SCENARIO_ITEMS,
    value: scenarioItem
  });
  scenario.selector = selector;
  return new formattingSettings.Group({
    name: `valuesM${index}`,
    displayName: displayName,
    slices: [useCustom, units, decimals, scenario]
  });
}

const CELL_COLOR_MODE_ITEMS: powerbi.IEnumMember[] = [
  { value: "none", displayName: "None" },
  { value: "rules", displayName: "Rules" },
  { value: "heatmap", displayName: "Heat map" }
];

function makeCellColorSlices(persisted: {
  mode: string;
  thresholdLow: number;
  thresholdHigh: number;
  colorLow: string;
  colorMid: string;
  colorHigh: string;
}): FormattingSettingsSlice[] {
  const modeItem = CELL_COLOR_MODE_ITEMS.find((i) => i.value === persisted.mode) ?? CELL_COLOR_MODE_ITEMS[0];
  return [
    new formattingSettings.ItemDropdown({
      name: "mode",
      displayName: "Mode",
      items: CELL_COLOR_MODE_ITEMS,
      value: modeItem
    }),
    new formattingSettings.NumUpDown({
      name: "thresholdLow",
      displayName: "Low threshold",
      value: persisted.thresholdLow
    }),
    new formattingSettings.NumUpDown({
      name: "thresholdHigh",
      displayName: "High threshold",
      value: persisted.thresholdHigh
    }),
    new formattingSettings.ColorPicker({
      name: "colorLow",
      displayName: "Low color",
      value: { value: persisted.colorLow }
    }),
    new formattingSettings.ColorPicker({
      name: "colorMid",
      displayName: "Middle color",
      value: { value: persisted.colorMid }
    }),
    new formattingSettings.ColorPicker({
      name: "colorHigh",
      displayName: "High color",
      value: { value: persisted.colorHigh }
    })
  ];
}

/** Cell colors card — global group + per-measure overrides, same persistence
 *  pattern as the Values card. */
class CellColorsCardSettings extends formattingSettings.CompositeCard {
  mode = new formattingSettings.ItemDropdown({
    name: "mode",
    displayName: "Mode",
    items: CELL_COLOR_MODE_ITEMS,
    value: CELL_COLOR_MODE_ITEMS[0]
  });

  thresholdLow = new formattingSettings.NumUpDown({
    name: "thresholdLow",
    displayName: "Low threshold",
    value: 0
  });

  thresholdHigh = new formattingSettings.NumUpDown({
    name: "thresholdHigh",
    displayName: "High threshold",
    value: 0
  });

  colorLow = new formattingSettings.ColorPicker({
    name: "colorLow",
    displayName: "Low color",
    value: { value: "#FF4D6D" }
  });

  colorMid = new formattingSettings.ColorPicker({
    name: "colorMid",
    displayName: "Middle color",
    value: { value: "" }
  });

  colorHigh = new formattingSettings.ColorPicker({
    name: "colorHigh",
    displayName: "High color",
    value: { value: "#1EF5B1" }
  });

  globalGroup: formattingSettings.Group = new formattingSettings.Group({
    name: "cellColorsGlobal",
    displayName: "All measures",
    slices: [this.mode, this.thresholdLow, this.thresholdHigh, this.colorLow, this.colorMid, this.colorHigh]
  });

  name: string = "cellColors";
  displayName: string = "Cell colors";
  displayNameKey: string = "Visual_CellColors";
  groups: formattingSettings.Group[] = [this.globalGroup];
}

/** Per-measure cell-colour override group (selector = measure metadata). */
export function makePerMeasureColorGroup(
  index: number,
  displayName: string,
  queryName: string,
  persisted: {
    useCustom: boolean;
    mode: string;
    thresholdLow: number;
    thresholdHigh: number;
    colorLow: string;
    colorMid: string;
    colorHigh: string;
  }
): formattingSettings.Group {
  const selector = { metadata: queryName } as powerbi.data.Selector;
  const useCustom = new formattingSettings.ToggleSwitch({
    name: "useCustom",
    displayName: "Override rules",
    value: persisted.useCustom
  });
  useCustom.selector = selector;
  const slices = makeCellColorSlices(persisted);
  for (const s of slices) (s as { selector?: powerbi.data.Selector }).selector = selector;
  return new formattingSettings.Group({
    name: `cellColorsM${index}`,
    displayName: displayName,
    slices: [useCustom, ...slices]
  });
}

export interface CalcSlot {
  show: formattingSettings.ToggleSwitch;
  label: formattingSettings.TextInput;
  formula: formattingSettings.TextInput;
  format: formattingSettings.ItemDropdown;
  display: formattingSettings.ItemDropdown;
}

const CALC_FORMAT_ITEMS: powerbi.IEnumMember[] = [
  { value: "inherit", displayName: "Inherit (first measure)" },
  { value: "number", displayName: "Number" },
  { value: "percent", displayName: "Percent" }
];

const CALC_DISPLAY_ITEMS: powerbi.IEnumMember[] = [
  { value: "number", displayName: "Number" },
  { value: "bar", displayName: "Variance bar" }
];

export const CALC_SLOT_COUNT = 3;

/** Client-side calculated columns — 3 static slots (Zebra-style formulas
 *  over the measures already in the visual, e.g. "[Actual] - [Budget]"). */
class CalculatedColumnsCardSettings extends FormattingSettingsCard {
  slots: CalcSlot[] = [];

  name: string = "calculatedColumns";
  displayName: string = "Calculated columns";
  displayNameKey: string = "Visual_CalculatedColumns";
  slices: FormattingSettingsSlice[] = [];

  constructor() {
    super();
    for (let n = 1; n <= CALC_SLOT_COUNT; n++) {
      const slot: CalcSlot = {
        show: new formattingSettings.ToggleSwitch({
          name: `calc${n}Show`,
          displayName: `Column ${n}`,
          value: false
        }),
        label: new formattingSettings.TextInput({
          name: `calc${n}Name`,
          displayName: `Column ${n} name`,
          value: n === 1 ? "Δ" : "",
          placeholder: "Δ vs Budget"
        }),
        formula: new formattingSettings.TextInput({
          name: `calc${n}Formula`,
          displayName: `Column ${n} formula`,
          value: "",
          placeholder: "[Actual] - [Budget]"
        }),
        format: new formattingSettings.ItemDropdown({
          name: `calc${n}Format`,
          displayName: `Column ${n} format`,
          items: CALC_FORMAT_ITEMS,
          value: CALC_FORMAT_ITEMS[0]
        }),
        display: new formattingSettings.ItemDropdown({
          name: `calc${n}Display`,
          displayName: `Column ${n} display`,
          items: CALC_DISPLAY_ITEMS,
          value: CALC_DISPLAY_ITEMS[0]
        })
      };
      this.slots.push(slot);
      this.slices.push(slot.show, slot.label, slot.formula, slot.format, slot.display);
    }
  }
}

class IbcsCardSettings extends FormattingSettingsCard {
  enabled = new formattingSettings.ToggleSwitch({
    name: "enabled",
    displayName: "Enable IBCS styling",
    value: false
  });

  name: string = "ibcs";
  displayName: string = "IBCS";
  displayNameKey: string = "Visual_IBCS";
  slices: FormattingSettingsSlice[] = [this.enabled];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
  general = new GeneralCardSettings();
  grid = new GridCardSettings();
  subTotals = new SubTotalsCardSettings();
  subtotalsStyle = new SubtotalsStyleCardSettings();
  rowHeaders = new RowHeadersCardSettings();
  columnHeaders = new ColumnHeadersCardSettings();
  values = new ValuesCardSettings();
  cellColors = new CellColorsCardSettings();
  calculatedColumns = new CalculatedColumnsCardSettings();
  ibcs = new IbcsCardSettings();
  comments = new CommentsCardSettings();

  cards = [
    this.general,
    this.grid,
    this.subTotals,
    this.subtotalsStyle,
    this.rowHeaders,
    this.columnHeaders,
    this.values,
    this.cellColors,
    this.calculatedColumns,
    this.ibcs,
    this.comments
  ];
}

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

  name: string = "general";
  displayName: string = "General";
  displayNameKey: string = "Visual_General";
  slices: FormattingSettingsSlice[] = [this.textSize, this.density];
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

class ValuesCardSettings extends FormattingSettingsCard {
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

  name: string = "values";
  displayName: string = "Values";
  displayNameKey: string = "Visual_Values";
  slices: FormattingSettingsSlice[] = [this.displayUnits, this.decimals];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
  general = new GeneralCardSettings();
  subTotals = new SubTotalsCardSettings();
  values = new ValuesCardSettings();

  cards = [this.general, this.subTotals, this.values];
}

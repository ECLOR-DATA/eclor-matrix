"use strict";

/**
 * IBCS scenario semantics — pure helpers.
 * AC (actual) solid · PY (prior year) grey · BU (budget/plan) outlined ·
 * FC (forecast) hatched. Detection is token-based on the measure name,
 * overridable per measure from the Format pane.
 */

export type IbcsScenario = "AC" | "PY" | "BU" | "FC";

const TOKENS: Record<IbcsScenario, string[]> = {
  AC: ["ac", "actual", "actuals", "act", "reel", "réel", "real", "ist"],
  PY: ["py", "prior", "previous", "n-1", "m-1", "ly", "lastyear", "précédent", "precedent"],
  BU: ["bu", "budget", "plan", "target", "objectif", "cible"],
  FC: ["fc", "fcst", "forecast", "prevision", "prévision", "projection", "outlook"]
};

/** Detect the IBCS scenario from a measure display name (null = none). */
export function detectScenario(measureName: string | undefined): IbcsScenario | null {
  if (!measureName) return null;
  const words = measureName
    .toLowerCase()
    .split(/[^a-zà-ÿ0-9-]+/)
    .filter((w) => w.length > 0);
  for (const scenario of ["PY", "BU", "FC", "AC"] as IbcsScenario[]) {
    if (words.some((w) => TOKENS[scenario].includes(w))) return scenario;
  }
  return null;
}

/** Bar length as a percentage of the half-track (signed values share a
 *  common zero axis; |maxAbs| maps to 100). */
export function barWidthPct(value: number, maxAbs: number): number {
  if (!Number.isFinite(value) || maxAbs <= 0) return 0;
  const pct = (Math.abs(value) / maxAbs) * 100;
  return pct > 100 ? 100 : Math.round(pct * 10) / 10;
}

// ---------- IBCS table templates (T01-T04, ibcs.com table templates) ----------
//
// T01  AC · PY · PL + ΔPY, ΔPY%, ΔPL, ΔPL% as FIGURES (rows = structure)
// T02  same data, Δ as BARS and Δ% as PINS
// T03  same columns as T01, rows = calculation scheme (P&L)
// T04  same data as T03, Δ as WATERFALL bars and Δ% as PINS
//
// The row content comes from the Rows bucket either way — what the visual
// derives from the template is the column composition (scenario order +
// synthesized variance columns) and the variance visualisation.

export type IbcsTemplate = "none" | "t01" | "t02" | "t03" | "t04";

export type VarianceDisplay = "number" | "bar" | "pin" | "waterfall";

export interface TemplateVarianceSpec {
  /** IBCS notation column title (ΔPY, ΔPY %, ΔPL, ΔPL %). */
  name: string;
  /** Engine formula over measure display names. */
  formula: string;
  format: "inherit" | "percent";
  display: VarianceDisplay;
}

/** Scenario ordering inside each column group when a template is active:
 *  AC · PY · PL(BU) · FC, other measures after, stable otherwise. */
export function scenarioRank(s: IbcsScenario | null): number {
  return s === "AC" ? 0 : s === "PY" ? 1 : s === "BU" ? 2 : s === "FC" ? 3 : 4;
}

/**
 * The variance columns a template synthesizes, given the detected scenario
 * measures. Needs an AC base; each present comparison (PY, then PL/BU)
 * contributes Δ and Δ% (Δ% divides by ABS(base) so cost lines keep a
 * meaningful sign, the usual IBCS practice). Measure names containing ']'
 * cannot be referenced by the formula grammar and are skipped.
 */
export function templateVarianceSpecs(
  template: IbcsTemplate,
  acName: string | undefined,
  pyName: string | undefined,
  buName: string | undefined
): TemplateVarianceSpec[] {
  if (template === "none" || !acName || acName.includes("]")) return [];
  const withBars = template === "t02" || template === "t04";
  const deltaDisplay: VarianceDisplay = !withBars ? "number" : template === "t04" ? "waterfall" : "bar";
  const pctDisplay: VarianceDisplay = withBars ? "pin" : "number";
  const out: TemplateVarianceSpec[] = [];
  const bases: [string | undefined, string][] = [
    [pyName, "PY"],
    [buName, "PL"]
  ];
  for (const [baseName, label] of bases) {
    if (!baseName || baseName.includes("]")) continue;
    out.push({
      name: `Δ${label}`,
      formula: `[${acName}] - [${baseName}]`,
      format: "inherit",
      display: deltaDisplay
    });
    out.push({
      name: `Δ${label} %`,
      formula: `([${acName}] - [${baseName}]) / ABS([${baseName}])`,
      format: "percent",
      display: pctDisplay
    });
  }
  return out;
}

/**
 * Waterfall run for a variance column (T04): detail rows cascade — each
 * bar starts where the previous ended — while subtotal rows re-anchor at
 * zero and show the running total as a plain bar. Null values (blank
 * cells, custom rows) produce no bar and do not move the cursor.
 * Returns the start offset per row (null = no bar).
 */
export function waterfallStarts(
  values: (number | null)[],
  isSubtotal: boolean[]
): (number | null)[] {
  let cum = 0;
  return values.map((v, i) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (isSubtotal[i]) return 0;
    const start = cum;
    cum += v;
    return start;
  });
}

/** Domain of a waterfall run: the largest |offset| any bar edge reaches. */
export function waterfallMaxAbs(
  values: (number | null)[],
  starts: (number | null)[]
): number {
  let max = 0;
  values.forEach((v, i) => {
    const s = starts[i];
    if (v === null || s === null) return;
    max = Math.max(max, Math.abs(s), Math.abs(s + v));
  });
  return max;
}

/** Geometry of a [start, start+value] segment on the shared zero-axis
 *  track (axis at 50%, ±maxAbs maps to the track edges). */
export function segmentGeometry(
  start: number,
  value: number,
  maxAbs: number
): { leftPct: number; widthPct: number } {
  if (maxAbs <= 0 || !Number.isFinite(start) || !Number.isFinite(value)) {
    return { leftPct: 50, widthPct: 0 };
  }
  const lo = Math.min(start, start + value);
  const hi = Math.max(start, start + value);
  const clamp = (p: number): number => Math.min(100, Math.max(0, p));
  const leftPct = clamp(50 + (lo / maxAbs) * 50);
  const rightPct = clamp(50 + (hi / maxAbs) * 50);
  const round = (p: number): number => Math.round(p * 10) / 10;
  return { leftPct: round(leftPct), widthPct: round(rightPct - leftPct) };
}

/** Position of a pin head on the shared zero-axis track. */
export function pinPosPct(value: number, maxAbs: number): number {
  if (maxAbs <= 0 || !Number.isFinite(value)) return 50;
  const p = Math.min(100, Math.max(0, 50 + (value / maxAbs) * 50));
  return Math.round(p * 10) / 10;
}

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

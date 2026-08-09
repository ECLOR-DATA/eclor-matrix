"use strict";

/**
 * Pure cell-colouring engine — threshold rules and heat maps.
 * No host coupling; visual.ts resolves options + stats and calls in.
 */

import { safeHex } from "./format";

export type CellColorMode = "none" | "rules" | "heatmap";

export interface CellColorOpts {
  mode: CellColorMode;
  /** Rules: value < thresholdLow → colorLow; value > thresholdHigh → colorHigh; else colorMid. */
  thresholdLow: number;
  thresholdHigh: number;
  /** Empty string = "no colour" for that slot. */
  colorLow: string;
  colorMid: string;
  colorHigh: string;
}

export interface MeasureStats {
  min: number;
  max: number;
}

export const DEFAULT_CELL_COLOR_OPTS: CellColorOpts = {
  mode: "none",
  thresholdLow: 0,
  thresholdHigh: 0,
  // ECLOR theme semantics: bad / (none) / good.
  colorLow: "#FF4D6D",
  colorMid: "",
  colorHigh: "#1EF5B1"
};

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function interpolateHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(safeHex(a, "#ffffff"));
  const [r2, g2, b2] = hexToRgb(safeHex(b, "#ffffff"));
  const k = clamp01(t);
  const mix = (x: number, y: number): string =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

/** WCAG relative luminance (sRGB linearized). Threshold 0.3 keeps the
 *  designer convention of white text on saturated reds while staying close
 *  to the contrast-ratio optimum. */
export function autoTextColor(bgHex: string): string {
  const [r, g, b] = hexToRgb(safeHex(bgHex, "#ffffff"));
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum < 0.3 ? "#FFFFFF" : "#091612";
}

export function heatColor(value: number, stats: MeasureStats, opts: CellColorOpts): string | null {
  if (!Number.isFinite(value)) return null;
  const span = stats.max - stats.min;
  const t = span > 0 ? clamp01((value - stats.min) / span) : 0.5;
  const low = opts.colorLow || "#FFFFFF";
  const high = opts.colorHigh || "#1EF5B1";
  if (opts.colorMid) {
    return t < 0.5
      ? interpolateHex(low, opts.colorMid, t * 2)
      : interpolateHex(opts.colorMid, high, (t - 0.5) * 2);
  }
  return interpolateHex(low, high, t);
}

export function ruleColor(value: number, opts: CellColorOpts): string | null {
  if (!Number.isFinite(value)) return null;
  if (value < opts.thresholdLow) return opts.colorLow || null;
  if (value > opts.thresholdHigh) return opts.colorHigh || null;
  return opts.colorMid || null;
}

export interface CellPaint {
  bg: string | null;
  fg: string | null;
}

export function resolveCellColor(
  value: number,
  stats: MeasureStats,
  opts: CellColorOpts
): CellPaint {
  let bg: string | null = null;
  if (opts.mode === "rules") bg = ruleColor(value, opts);
  else if (opts.mode === "heatmap") bg = heatColor(value, stats, opts);
  if (!bg) return { bg: null, fg: null };
  return { bg, fg: autoTextColor(bg) };
}

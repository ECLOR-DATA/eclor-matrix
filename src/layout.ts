"use strict";

/**
 * Layout layer — pure state parsing for the user-driven layout options:
 *
 *  - COLUMN WIDTHS (à la Power BI matrix 2025): mode auto / uniform /
 *    custom; custom widths are dragged in the visual and persisted as JSON
 *    in objects.columnWidths.state, keyed by a stable column identity.
 *  - PER-ROW STYLES: alignment and absolute indent overrides for rows the
 *    user picked in the grid, persisted in objects.rowStyles.state keyed by
 *    the same stable row path keys the custom-rows layer uses.
 *
 * Both states travel with the report (host.persistProperties), both parse
 * forgivingly: anything malformed is dropped, never a crash.
 */

export const MIN_COL_WIDTH = 24;
export const MAX_COL_WIDTH = 1200;

/** Stable identity of a grid column across renders. */
export function columnKeyForLeaf(path: string[], measureName: string): string {
  return `${path.filter((p) => p.length > 0).join("|")}·${measureName}`;
}

export function columnKeyForCalc(name: string): string {
  return `calc:${name}`;
}

export const ROW_HEADER_COL_KEY = "rowheader";
export const COMMENTS_COL_KEY = "comments";

export function parseColumnWidthsState(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const n = Number(v);
    if (typeof k === "string" && k.length > 0 && Number.isFinite(n)) {
      out[k] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(n)));
    }
  }
  return out;
}

export function serializeColumnWidthsState(state: Record<string, number>): string {
  return JSON.stringify(state);
}

export type RowAlign = "left" | "center" | "right";

export type BorderMode = "box" | "top" | "bottom" | "topbottom";
export type BorderLineStyle = "solid" | "dashed" | "dotted";

/** A financial-communication style frame: which edges, which line, and on
 *  which cells of the row ("all" = the whole row as one frame, "label" =
 *  the row-header cell, otherwise a column identity → that ONE cell). */
export interface RowBorderDef {
  mode: BorderMode;
  style: BorderLineStyle;
  width: number;
  color: string;
  target: string;
}

export interface RowStyleDef {
  /** Row path key (customRows.computeRowPathKeys) or custom:<id>. */
  key: string;
  align?: RowAlign;
  /** Absolute label indent in px (overrides level × indent). */
  indent?: number;
  bold?: boolean;
  border?: RowBorderDef;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseBorder(raw: unknown): RowBorderDef | undefined {
  const o = raw as Partial<RowBorderDef> | undefined;
  if (!o || typeof o !== "object") return undefined;
  const mode =
    o.mode === "box" || o.mode === "top" || o.mode === "bottom" || o.mode === "topbottom"
      ? o.mode
      : undefined;
  if (!mode) return undefined;
  const style =
    o.style === "dashed" || o.style === "dotted" ? o.style : "solid";
  const widthN = Number(o.width);
  const width = Number.isFinite(widthN) ? Math.min(4, Math.max(1, Math.round(widthN))) : 1;
  const color = typeof o.color === "string" && HEX_COLOR.test(o.color) ? o.color : "#091612";
  const target = typeof o.target === "string" && o.target.length > 0 ? o.target : "all";
  return { mode, style, width, color, target };
}

export function parseRowStylesState(raw: unknown): RowStyleDef[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RowStyleDef[] = [];
  for (const d of data) {
    const o = d as Partial<RowStyleDef>;
    if (typeof o?.key !== "string" || o.key.length === 0) continue;
    const align =
      o.align === "left" || o.align === "center" || o.align === "right" ? o.align : undefined;
    const indentN = Number(o.indent);
    const indent = Number.isFinite(indentN)
      ? Math.min(400, Math.max(0, Math.round(indentN)))
      : undefined;
    const bold = o.bold === true ? true : undefined;
    const border = parseBorder(o.border);
    if (align === undefined && indent === undefined && bold === undefined && border === undefined) {
      continue;
    }
    out.push({ key: o.key, align, indent, bold, border });
  }
  return out;
}

export function serializeRowStylesState(defs: RowStyleDef[]): string {
  return JSON.stringify(defs);
}

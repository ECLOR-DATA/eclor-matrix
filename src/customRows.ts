"use strict";

/**
 * Excel-style custom rows — the "financial statement builder" layer.
 *
 * Two kinds, both independent from the model and the hierarchy:
 *  - "subtotal": the sum of an arbitrary set of existing rows (chosen by the
 *    user), inserted wherever they want. Additive by definition — for
 *    non-additive combinations users create a formula row instead.
 *  - "formula": a computed row whose expression references OTHER ROWS by
 *    label ("[Gross Sales] / [Revenue]") — evaluated per grid column with
 *    the shared eval-free engine (expressions.ts).
 *
 * Definitions are persisted as JSON in the report definition through
 * host.persistProperties (objects.customRows.state) — they never leave the
 * Power BI sandbox. Rows are referenced by a stable "path key" built from
 * the row-label chain, deduplicated with #n suffixes.
 */

import { compileExpression } from "./expressions";
import { RowModel } from "./matrixModel";

export interface CustomRowDef {
  id: string;
  kind: "subtotal" | "formula" | "spacer";
  label: string;
  /** Path key of the row this custom row is inserted AFTER ("" = append). */
  anchor: string;
  /** subtotal: path keys of the summed rows. */
  refs?: string[];
  /** formula: expression with [Row label] references. */
  formula?: string;
  /** formula: inherit | number | percent. */
  format?: string;
  /** Indent level to render at (defaults to the anchor's level). */
  level?: number;
}

/** Stable per-row keys: label chain joined by '▸', deduped with #n. */
export function computeRowPathKeys(rows: RowModel[]): string[] {
  const stack: string[] = [];
  const seen = new Map<string, number>();
  return rows.map((r) => {
    stack.length = r.level;
    stack[r.level] = r.label || "·";
    let key = stack.slice(0, r.level + 1).join("▸");
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}#${n + 1}`;
    return key;
  });
}

/** Parse + validate a persisted JSON state; anything malformed → []. */
export function parseCustomRowsState(raw: unknown): CustomRowDef[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CustomRowDef[] = [];
  for (const d of data) {
    const o = d as Partial<CustomRowDef>;
    if (typeof o?.id !== "string" || typeof o?.label !== "string") continue;
    if (o.kind !== "subtotal" && o.kind !== "formula" && o.kind !== "spacer") continue;
    if (o.kind === "subtotal" && !Array.isArray(o.refs)) continue;
    if (o.kind === "formula" && typeof o.formula !== "string") continue;
    out.push({
      id: o.id,
      kind: o.kind,
      label: o.label,
      anchor: typeof o.anchor === "string" ? o.anchor : "",
      refs: Array.isArray(o.refs) ? o.refs.filter((r): r is string => typeof r === "string") : undefined,
      formula: typeof o.formula === "string" ? o.formula : undefined,
      format: typeof o.format === "string" ? o.format : "inherit",
      level: Number.isFinite(Number(o.level)) ? Number(o.level) : undefined
    });
  }
  return out;
}

export function serializeCustomRowsState(defs: CustomRowDef[]): string {
  return JSON.stringify(defs);
}

/** A woven custom row carries its definition for styling/format. */
export interface WovenRow extends RowModel {
  customDef?: CustomRowDef;
}

function computeSubtotalCells(
  def: CustomRowDef,
  rows: RowModel[],
  keys: string[],
  cellCount: number
): (number | string | null)[] {
  const wanted = new Set(def.refs ?? []);
  const cells: (number | string | null)[] = Array.from({ length: cellCount }, () => null);
  for (let r = 0; r < rows.length; r++) {
    if (!wanted.has(keys[r])) continue;
    for (let c = 0; c < cellCount; c++) {
      const v = rows[r].cells[c];
      if (typeof v === "number" && Number.isFinite(v)) {
        cells[c] = (typeof cells[c] === "number" ? (cells[c] as number) : 0) + v;
      }
    }
  }
  return cells;
}

function computeFormulaCells(
  def: CustomRowDef,
  rows: RowModel[],
  keys: string[],
  cellCount: number,
  anchorIdx: number
): (number | string | null)[] {
  const compiled = compileExpression(def.formula ?? "");
  const cells: (number | string | null)[] = Array.from({ length: cellCount }, () => null);
  if (!compiled.ok) return cells;

  // Ref resolution: exact path key first; then bare label, preferring rows
  // that share the anchor's parent scope; then first global label match.
  const anchorParent = anchorIdx >= 0 ? keys[anchorIdx].split("▸").slice(0, -1).join("▸") : "";
  const resolveRef = (ref: string): number | null => {
    const lower = ref.toLowerCase();
    let global: number | null = null;
    let scoped: number | null = null;
    for (let r = 0; r < rows.length; r++) {
      if (keys[r].toLowerCase() === lower) return r;
      if (rows[r].label.toLowerCase() === lower) {
        if (global === null) global = r;
        const parent = keys[r].split("▸").slice(0, -1).join("▸");
        if (scoped === null && parent === anchorParent) scoped = r;
      }
    }
    return scoped ?? global;
  };
  const refRows = new Map<string, number | null>();
  for (const ref of compiled.refs) refRows.set(ref.toLowerCase(), resolveRef(ref));

  for (let c = 0; c < cellCount; c++) {
    cells[c] = compiled.evaluate((ref) => {
      const r = refRows.get(ref.toLowerCase());
      if (r === null || r === undefined) return null;
      const v = rows[r].cells[c];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    });
  }
  return cells;
}

/** Weave the custom rows into the flattened row list. Order: defs are
 *  inserted after their anchor (or appended); each def sees the ORIGINAL
 *  rows for refs (custom rows cannot reference each other yet). */
export function weaveCustomRows(
  rows: RowModel[],
  defs: CustomRowDef[],
  cellCount: number
): { rows: WovenRow[]; keys: string[] } {
  const keys = computeRowPathKeys(rows);
  if (defs.length === 0) return { rows, keys };

  const insertions = defs.map((def) => {
    const anchorIdx = def.anchor ? keys.indexOf(def.anchor) : -1;
    const cells =
      def.kind === "subtotal"
        ? computeSubtotalCells(def, rows, keys, cellCount)
        : def.kind === "formula"
          ? computeFormulaCells(def, rows, keys, cellCount, anchorIdx)
          : Array.from({ length: cellCount }, () => null); // spacer: blank row
    const level = def.level ?? (anchorIdx >= 0 ? rows[anchorIdx].level : 0);
    const woven: WovenRow = {
      label: def.label,
      level,
      isSubtotal: def.kind === "subtotal",
      isCollapsed: false,
      isExpandable: false,
      node: {},
      cells,
      customDef: def
    };
    return { anchorIdx, woven };
  });

  const out: WovenRow[] = [];
  const outKeys: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    out.push(rows[r]);
    outKeys.push(keys[r]);
    for (const ins of insertions) {
      if (ins.anchorIdx === r) {
        out.push(ins.woven);
        outKeys.push(`custom:${ins.woven.customDef?.id}`);
      }
    }
  }
  for (const ins of insertions) {
    if (ins.anchorIdx < 0) {
      out.push(ins.woven);
      outKeys.push(`custom:${ins.woven.customDef?.id}`);
    }
  }
  return { rows: out, keys: outKeys };
}

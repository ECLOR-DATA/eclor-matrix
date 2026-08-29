"use strict";

/**
 * Pure helpers that flatten a DataView matrix tree into renderable models.
 *
 * No powerbi-visuals-api runtime import — every input type is structural so
 * tests can feed plain object literals without touching IVisualHost. This is
 * the module where the matrix-DataView domain rules live; visual.ts only
 * orchestrates.
 *
 * DataView matrix contract (playbook §4.3.5–4.3.6):
 *  - rows.root / columns.root are synthetic roots (no level, no value).
 *  - Row leaf + subtotal nodes carry `values`, keyed by the DFS ordinal of
 *    the column leaves. Cell objects may carry `valueSourceIndex` (measure
 *    index, omitted when 0).
 *  - When several measures are bound, the deepest column level IS the
 *    measure level: those nodes have `levelSourceIndex` into valueSources.
 *  - Subtotal nodes have `isSubtotal: true`; collapsed row nodes have
 *    `isCollapsed: true` and no children in the DataView.
 */

export interface MatrixNodeLike {
  level?: number;
  levelValues?: { value?: unknown }[];
  value?: unknown;
  levelSourceIndex?: number;
  children?: MatrixNodeLike[];
  isSubtotal?: boolean;
  isCollapsed?: boolean;
  values?: Record<number, { value?: unknown; valueSourceIndex?: number }>;
  identity?: unknown;
}

export interface ColumnLeaf {
  /** Group-value labels from root to this leaf (measure level excluded). */
  path: string[];
  /** Index into valueSources for the measure this leaf carries. */
  measureIndex: number;
  /** Key into rowNode.values for this intersection (DFS ordinal). */
  cellKey: number;
  isSubtotal: boolean;
}

export interface HeaderCell {
  label: string;
  span: number;
  isSubtotal: boolean;
  /** Blank aeration column (flat-header mode only). */
  isGap?: boolean;
}

export interface RowModel {
  label: string;
  level: number;
  isSubtotal: boolean;
  isCollapsed: boolean;
  /** True when the node can expand/collapse (has children server-side). */
  isExpandable: boolean;
  node: MatrixNodeLike;
  /** Raw cell values aligned with the ColumnLeaf[] order (null = blank). */
  cells: (number | string | null)[];
}

const nodeLabel = (node: MatrixNodeLike, measureNames: string[], totalLabel: string): string => {
  if (node.isSubtotal) return totalLabel;
  if (
    node.levelSourceIndex !== undefined &&
    node.levelSourceIndex !== null &&
    node.value === undefined &&
    (node.levelValues === undefined || node.levelValues.length === 0)
  ) {
    return measureNames[node.levelSourceIndex] ?? "";
  }
  const raw = node.levelValues?.[0]?.value ?? node.value;
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw);
};

/**
 * Flatten the columns tree into leaf descriptors in DFS order — the order
 * Power BI uses to key row-node `values`.
 */
export function flattenColumns(
  root: MatrixNodeLike | undefined,
  measureNames: string[],
  totalLabel: string = "Total"
): ColumnLeaf[] {
  const leaves: ColumnLeaf[] = [];
  // No column grouping bound: the host still emits one leaf per measure
  // (or nothing at all when there are no measures).
  if (!root || !root.children || root.children.length === 0) {
    for (let i = 0; i < measureNames.length; i++) {
      leaves.push({ path: [], measureIndex: i, cellKey: i, isSubtotal: false });
    }
    return leaves;
  }

  const walk = (node: MatrixNodeLike, path: string[], subtotal: boolean): void => {
    const isSub = subtotal || node.isSubtotal === true;
    if (!node.children || node.children.length === 0) {
      const measureIndex =
        node.levelSourceIndex !== undefined && node.levelSourceIndex !== null
          ? node.levelSourceIndex
          : 0;
      const isMeasureLeaf =
        node.levelSourceIndex !== undefined &&
        node.levelSourceIndex !== null &&
        node.value === undefined &&
        (node.levelValues === undefined || node.levelValues.length === 0);
      const label = nodeLabel(node, measureNames, totalLabel);
      leaves.push({
        path: isMeasureLeaf ? path : [...path, label],
        measureIndex,
        cellKey: leaves.length,
        isSubtotal: isSub
      });
      return;
    }
    const label = nodeLabel(node, measureNames, totalLabel);
    for (const child of node.children) walk(child, [...path, label], isSub);
  };
  for (const child of root.children) walk(child, [], false);
  return leaves;
}

/**
 * Build one header row per column level. A childless node sitting above the
 * deepest level (e.g. a subtotal column) contributes filler cells to every
 * deeper row so the grid stays rectangular.
 */
export function buildHeaderRows(
  root: MatrixNodeLike | undefined,
  measureNames: string[],
  totalLabel: string = "Total"
): HeaderCell[][] {
  if (!root || !root.children || root.children.length === 0) {
    if (measureNames.length === 0) return [];
    return [measureNames.map((m) => ({ label: m, span: 1, isSubtotal: false }))];
  }

  const depthOf = (node: MatrixNodeLike): number => {
    if (!node.children || node.children.length === 0) return 1;
    let max = 0;
    for (const c of node.children) max = Math.max(max, depthOf(c));
    return 1 + max;
  };
  let depth = 0;
  for (const c of root.children) depth = Math.max(depth, depthOf(c));

  const leafCount = (node: MatrixNodeLike): number => {
    if (!node.children || node.children.length === 0) return 1;
    let n = 0;
    for (const c of node.children) n += leafCount(c);
    return n;
  };

  const rows: HeaderCell[][] = Array.from({ length: depth }, () => []);
  const walk = (node: MatrixNodeLike, levelIdx: number, subtotal: boolean): void => {
    const isSub = subtotal || node.isSubtotal === true;
    const span = leafCount(node);
    rows[levelIdx].push({ label: nodeLabel(node, measureNames, totalLabel), span, isSubtotal: isSub });
    if (node.children && node.children.length > 0) {
      for (const c of node.children) walk(c, levelIdx + 1, isSub);
    } else {
      // Filler below shallow branches keeps deeper header rows aligned.
      for (let l = levelIdx + 1; l < depth; l++) {
        rows[l].push({ label: "", span, isSubtotal: isSub });
      }
    }
  };
  for (const c of root.children) walk(c, 0, false);
  return rows;
}

/**
 * Flatten the rows tree in display order. Every node becomes a RowModel;
 * only nodes carrying `values` get cells (group-header rows render blank).
 */
export function flattenRows(
  root: MatrixNodeLike | undefined,
  leaves: ColumnLeaf[],
  totalLabel: string = "Total"
): RowModel[] {
  const out: RowModel[] = [];
  if (!root || !root.children) return out;

  const cellsOf = (node: MatrixNodeLike): (number | string | null)[] => {
    const vals = node.values;
    if (!vals) return leaves.map(() => null);
    return leaves.map((leaf) => {
      const cell = vals[leaf.cellKey];
      const v = cell?.value;
      if (v === undefined || v === null) return null;
      if (typeof v === "number" || typeof v === "string") return v;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    });
  };

  const walk = (node: MatrixNodeLike, level: number): void => {
    out.push({
      label: nodeLabel(node, [], totalLabel),
      level,
      isSubtotal: node.isSubtotal === true,
      isCollapsed: node.isCollapsed === true,
      isExpandable: (node.children !== undefined && node.children.length > 0) || node.isCollapsed === true,
      node,
      cells: cellsOf(node)
    });
    if (node.children) {
      for (const c of node.children) walk(c, level + 1);
    }
  };
  for (const c of root.children) walk(c, 0);
  return out;
}

/**
 * Copy of the columns tree without the measure-level leaves of the given
 * measures (tooltip-only / comments-only). Groups left empty disappear.
 * Lets buildHeaderRows keep the REAL multi-level header when auxiliary
 * measures are bound, instead of collapsing to the flat fallback — DFS
 * order of the remaining leaves matches the filtered render columns.
 */
export function pruneColumnTree(
  root: MatrixNodeLike | undefined,
  excludeMeasures: Set<number>
): MatrixNodeLike | undefined {
  if (!root || !root.children || excludeMeasures.size === 0) return root;
  const prune = (node: MatrixNodeLike): MatrixNodeLike | null => {
    if (!node.children || node.children.length === 0) {
      const isMeasureLeaf =
        node.levelSourceIndex !== undefined &&
        node.levelSourceIndex !== null &&
        node.value === undefined &&
        (node.levelValues === undefined || node.levelValues.length === 0);
      if (isMeasureLeaf && excludeMeasures.has(node.levelSourceIndex as number)) return null;
      return node;
    }
    const children = node.children
      .map(prune)
      .filter((c): c is MatrixNodeLike => c !== null);
    if (children.length === 0) return null;
    return { ...node, children };
  };
  const children = root.children.map(prune).filter((c): c is MatrixNodeLike => c !== null);
  return { ...root, children };
}

/** Largest |numeric cell| across rendered rows — drives auto display units. */
export function computeMaxAbs(rows: RowModel[]): number {
  let max = 0;
  for (const r of rows) {
    for (const c of r.cells) {
      if (typeof c === "number" && Number.isFinite(c)) {
        const a = Math.abs(c);
        if (a > max) max = a;
      }
    }
  }
  return max;
}

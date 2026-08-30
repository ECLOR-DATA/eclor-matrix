// PURE JSON-filter builders — the slicer's only way to filter other visuals
// is host.applyJsonFilter with a Basic (1 column) or Tuple (hierarchy) filter.
// The JSON shapes are hand-rolled against the public powerbi-models schema so
// we don't ship the whole powerbi-models package for two object literals.

import type { RawValue } from "./slicerModel";

export interface FilterTarget {
  table: string;
  column: string;
}

export interface BasicFilter {
  // The $schema values below are canonical powerbi-models identifiers (IDs,
  // not fetchable pages) — they MUST stay http:// to match the host contract.
  // eslint-disable-next-line powerbi-visuals/no-http-string
  $schema: "http://powerbi.com/product/schema#basic";
  filterType: 1;
  target: FilterTarget;
  operator: "In";
  values: (string | number | boolean)[];
}

export interface TupleFilter {
  // eslint-disable-next-line powerbi-visuals/no-http-string
  $schema: "http://powerbi.com/product/schema#tuple";
  filterType: 6;
  target: FilterTarget[];
  operator: "In";
  values: { value: string | number | boolean | null }[][];
}

export type SlicerFilter = BasicFilter | TupleFilter;

/** Column-metadata shape we read the filter target from. `expr` is the host's
 *  internal SQExpr — undocumented but stable, and the only place hierarchy
 *  levels expose their underlying column (same fallback chain as
 *  powerbi-visuals-utils-interactivityutils' extractFilterColumnTarget). */
export interface FilterSourceColumn {
  queryName?: string;
  displayName?: string;
  expr?: {
    ref?: string;
    level?: string;
    source?: { entity?: string };
    arg?: { source?: { entity?: string }; arg?: { source?: { entity?: string } } };
  };
}

export function extractFilterTarget(source: FilterSourceColumn): FilterTarget {
  const expr = source.expr;
  const table =
    expr?.source?.entity ??
    expr?.arg?.source?.entity ??
    expr?.arg?.arg?.source?.entity ??
    (source.queryName ?? "").split(".")[0] ??
    "";
  const column = expr?.ref ?? expr?.level ?? source.displayName ?? (source.queryName ?? "").split(".").pop() ?? "";
  return { table, column };
}

/** Filters can't carry Date objects — serialise to ISO like the service does. */
function toFilterValue(v: RawValue): string | number | boolean | null {
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function buildBasicFilter(target: FilterTarget, values: RawValue[]): BasicFilter {
  return {
    // eslint-disable-next-line powerbi-visuals/no-http-string
    $schema: "http://powerbi.com/product/schema#basic",
    filterType: 1,
    target,
    operator: "In",
    // Basic-filter schema forbids null values; blank rows are expressed
    // through the tuple path (single-level trees with a null still work
    // because buildSlicerFilter routes them to a 1-tuple TupleFilter).
    values: values.filter((v) => v !== null).map((v) => toFilterValue(v) as string | number | boolean)
  };
}

export function buildTupleFilter(targets: FilterTarget[], tuples: RawValue[][]): TupleFilter {
  return {
    // eslint-disable-next-line powerbi-visuals/no-http-string
    $schema: "http://powerbi.com/product/schema#tuple",
    filterType: 6,
    target: targets,
    operator: "In",
    values: tuples.map((t) => t.map((v) => ({ value: toFilterValue(v) })))
  };
}

/** Route to the cheapest correct filter:
 *  - nothing selected → null (caller removes the filter)
 *  - single level, no nulls → BasicFilter (most portable)
 *  - anything else → TupleFilter over the leaf tuples. */
export function buildSlicerFilter(targets: FilterTarget[], leafTuples: RawValue[][]): SlicerFilter | null {
  if (leafTuples.length === 0) return null;
  if (targets.length === 1) {
    const flat = leafTuples.map((t) => t[0]);
    if (!flat.some((v) => v === null)) {
      return buildBasicFilter(targets[0], flat);
    }
  }
  return buildTupleFilter(targets, leafTuples);
}

/** Rebuild the selected leaf tuples from a filter the host echoes back in
 *  VisualUpdateOptions.jsonFilters — state restore across reloads. Returns
 *  null when the filter isn't one of ours. */
export function parseAppliedFilter(filter: unknown): RawValue[][] | null {
  const f = filter as { filterType?: number; values?: unknown[] } | null;
  if (!f || typeof f !== "object") return null;
  if (f.filterType === 1 && Array.isArray(f.values)) {
    return (f.values as (string | number | boolean)[]).map((v) => [v]);
  }
  if (f.filterType === 6 && Array.isArray(f.values)) {
    const tuples: RawValue[][] = [];
    for (const tuple of f.values as { value: RawValue }[][]) {
      if (!Array.isArray(tuple)) return null;
      tuples.push(tuple.map((c) => (c && typeof c === "object" ? c.value : null)));
    }
    return tuples;
  }
  return null;
}

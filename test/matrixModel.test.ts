import {
  buildHeaderRows,
  computeMaxAbs,
  flattenColumns,
  flattenRows,
  MatrixNodeLike,
  pickAutoUnits,
  pruneColumnTree
} from "../src/matrixModel";

describe("flattenColumns", () => {
  test("no column grouping → one leaf per measure, sequential cell keys", () => {
    const leaves = flattenColumns(undefined, ["Actual", "Budget"]);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toMatchObject({ measureIndex: 0, cellKey: 0, path: [] });
    expect(leaves[1]).toMatchObject({ measureIndex: 1, cellKey: 1, path: [] });
  });

  test("empty children behaves like no grouping", () => {
    const leaves = flattenColumns({ children: [] }, ["M1"]);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].measureIndex).toBe(0);
  });

  test("column group × measure level → DFS order with group paths", () => {
    const root: MatrixNodeLike = {
      children: [
        {
          level: 0,
          value: "Q1",
          children: [
            { level: 1, levelSourceIndex: 0 },
            { level: 1, levelSourceIndex: 1 }
          ]
        },
        {
          level: 0,
          value: "Q2",
          children: [
            { level: 1, levelSourceIndex: 0 },
            { level: 1, levelSourceIndex: 1 }
          ]
        }
      ]
    };
    const leaves = flattenColumns(root, ["Actual", "Budget"]);
    expect(leaves).toHaveLength(4);
    expect(leaves.map((l) => l.cellKey)).toEqual([0, 1, 2, 3]);
    expect(leaves[0]).toMatchObject({ path: ["Q1"], measureIndex: 0 });
    expect(leaves[1]).toMatchObject({ path: ["Q1"], measureIndex: 1 });
    expect(leaves[2]).toMatchObject({ path: ["Q2"], measureIndex: 0 });
    expect(leaves[3]).toMatchObject({ path: ["Q2"], measureIndex: 1 });
  });

  test("subtotal column node flags its leaves", () => {
    const root: MatrixNodeLike = {
      children: [
        { level: 0, value: "Q1", children: [{ level: 1, levelSourceIndex: 0 }] },
        { level: 0, isSubtotal: true, children: [{ level: 1, levelSourceIndex: 0 }] }
      ]
    };
    const leaves = flattenColumns(root, ["Actual"], "Total");
    expect(leaves[0].isSubtotal).toBe(false);
    expect(leaves[1].isSubtotal).toBe(true);
    expect(leaves[1].path[0]).toBe("Total");
  });

  test("single measure with column groups → group leaves carry measureIndex 0", () => {
    const root: MatrixNodeLike = {
      children: [
        { level: 0, value: "Q1" },
        { level: 0, value: "Q2" }
      ]
    };
    const leaves = flattenColumns(root, ["Actual"]);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toMatchObject({ path: ["Q1"], measureIndex: 0, cellKey: 0 });
    expect(leaves[1]).toMatchObject({ path: ["Q2"], measureIndex: 0, cellKey: 1 });
  });
});

describe("buildHeaderRows", () => {
  test("no grouping → single measure-name row", () => {
    const rows = buildHeaderRows(undefined, ["Actual", "Budget"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].map((c) => c.label)).toEqual(["Actual", "Budget"]);
  });

  test("group level spans its measure leaves", () => {
    const root: MatrixNodeLike = {
      children: [
        {
          level: 0,
          value: "Q1",
          children: [
            { level: 1, levelSourceIndex: 0 },
            { level: 1, levelSourceIndex: 1 }
          ]
        }
      ]
    };
    const rows = buildHeaderRows(root, ["Actual", "Budget"]);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({ label: "Q1", span: 2 });
    expect(rows[1].map((c) => c.label)).toEqual(["Actual", "Budget"]);
  });

  test("shallow subtotal branch gets filler cells below", () => {
    const root: MatrixNodeLike = {
      children: [
        {
          level: 0,
          value: "Q1",
          children: [{ level: 1, levelSourceIndex: 0 }]
        },
        { level: 0, isSubtotal: true }
      ]
    };
    const rows = buildHeaderRows(root, ["Actual"], "Total");
    expect(rows).toHaveLength(2);
    expect(rows[0].map((c) => c.label)).toEqual(["Q1", "Total"]);
    // Filler keeps the second header row rectangular.
    expect(rows[1]).toHaveLength(2);
    expect(rows[1][1].label).toBe("");
  });
});

// The host omits `levelSourceIndex` when it is 0 (audit GEN-25-a): the first
// measure node arrives as a bare `{ level }` with no value.
describe("measure 0 without levelSourceIndex", () => {
  test("flat measures: every header carries its measure name", () => {
    const root: MatrixNodeLike = {
      children: [{ level: 0 }, { level: 0, levelSourceIndex: 1 }, { level: 0, levelSourceIndex: 2 }]
    };
    const rows = buildHeaderRows(root, ["Total Actual", "Pct", "Precise"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].map((c) => c.label)).toEqual(["Total Actual", "Pct", "Precise"]);
    const leaves = flattenColumns(root, ["Total Actual", "Pct", "Precise"]);
    expect(leaves.map((l) => l.path)).toEqual([[], [], []]);
    expect(leaves.map((l) => l.measureIndex)).toEqual([0, 1, 2]);
  });

  test("single measure: the lone measure node is labelled", () => {
    const rows = buildHeaderRows({ children: [{ level: 0 }] }, ["Sum of Actual"]);
    expect(rows[0].map((c) => c.label)).toEqual(["Sum of Actual"]);
  });

  test("under a column group, measure 0 stays in its group's path", () => {
    const root: MatrixNodeLike = {
      children: [
        {
          level: 0,
          value: 2025,
          levelValues: [{ value: 2025 }],
          children: [{ level: 1 }, { level: 1, levelSourceIndex: 1 }]
        }
      ]
    };
    const rows = buildHeaderRows(root, ["Actual", "PY"]);
    expect(rows[1].map((c) => c.label)).toEqual(["Actual", "PY"]);
    const leaves = flattenColumns(root, ["Actual", "PY"]);
    expect(leaves.map((l) => l.path)).toEqual([["2025"], ["2025"]]);
  });

  test("a value-less subtotal leaf is still the Total column, not a measure", () => {
    const root: MatrixNodeLike = {
      children: [{ level: 0, value: "Q1", levelValues: [{ value: "Q1" }] }, { level: 0, isSubtotal: true }]
    };
    const leaves = flattenColumns(root, ["Actual"], "Total");
    expect(leaves.map((l) => l.path)).toEqual([["Q1"], ["Total"]]);
  });

  test("pruneColumnTree drops measure 0 when it is auxiliary", () => {
    const root: MatrixNodeLike = {
      children: [{ level: 0 }, { level: 0, levelSourceIndex: 1 }]
    };
    const pruned = pruneColumnTree(root, new Set([0]));
    expect(pruned?.children).toEqual([{ level: 0, levelSourceIndex: 1 }]);
  });
});

describe("flattenRows", () => {
  const leaves = flattenColumns(undefined, ["Actual"]);

  test("nested rows flatten in display order with levels", () => {
    const root: MatrixNodeLike = {
      children: [
        {
          level: 0,
          value: "EMEA",
          children: [
            { level: 1, value: "France", values: { 0: { value: 10 } } },
            { level: 1, value: "Germany", values: { 0: { value: 20 } } },
            { level: 1, isSubtotal: true, values: { 0: { value: 30 } } }
          ]
        }
      ]
    };
    const rows = flattenRows(root, leaves, "Total");
    expect(rows.map((r) => r.label)).toEqual(["EMEA", "France", "Germany", "Total"]);
    expect(rows.map((r) => r.level)).toEqual([0, 1, 1, 1]);
    expect(rows[0].isExpandable).toBe(true);
    expect(rows[3].isSubtotal).toBe(true);
    expect(rows[1].cells).toEqual([10]);
    // Group-header row has no values dictionary → blank cells.
    expect(rows[0].cells).toEqual([null]);
  });

  test("collapsed node stays expandable without children", () => {
    const root: MatrixNodeLike = {
      children: [{ level: 0, value: "EMEA", isCollapsed: true, values: { 0: { value: 42 } } }]
    };
    const rows = flattenRows(root, leaves);
    expect(rows).toHaveLength(1);
    expect(rows[0].isExpandable).toBe(true);
    expect(rows[0].isCollapsed).toBe(true);
  });

  test("null / undefined / missing cells coerce to null", () => {
    const root: MatrixNodeLike = {
      children: [
        { level: 0, value: "A", values: { 0: { value: null } } },
        { level: 0, value: "B", values: {} },
        { level: 0, value: "C" }
      ]
    };
    const rows = flattenRows(root, leaves);
    expect(rows.map((r) => r.cells[0])).toEqual([null, null, null]);
  });

  test("empty root → empty list", () => {
    expect(flattenRows(undefined, leaves)).toEqual([]);
    expect(flattenRows({ children: [] }, leaves)).toEqual([]);
  });
});

describe("computeMaxAbs", () => {
  const leaves = flattenColumns(undefined, ["Actual"]);

  test("ignores strings, nulls, NaN and Infinity", () => {
    const root: MatrixNodeLike = {
      children: [
        { level: 0, value: "A", values: { 0: { value: -1200 } } },
        { level: 0, value: "B", values: { 0: { value: "text" } } },
        { level: 0, value: "C", values: { 0: { value: NaN } } },
        { level: 0, value: "D", values: { 0: { value: Infinity } } },
        { level: 0, value: "E", values: { 0: { value: 800 } } }
      ]
    };
    const rows = flattenRows(root, leaves);
    expect(computeMaxAbs(rows)).toBe(1200);
  });

  test("no numeric cells → 0", () => {
    expect(computeMaxAbs([])).toBe(0);
  });
});

// Audit GEN-26-a: auto units were picked from the grid-wide max (grand total
// included) — 320,000 rendered "0M". The unit is now per column, bounded by
// the SMALLEST non-zero detail value, so no non-zero cell can round to 0.
describe("pickAutoUnits", () => {
  test("unit bounded by the smallest non-zero magnitude", () => {
    expect(pickAutoUnits([320000, 450000, 275000, 510000])).toBe("thousands");
    expect(pickAutoUnits([15000, 22000, -18000, -9500, 31000])).toBe("thousands");
    expect(pickAutoUnits([2e6, -5e6])).toBe("millions");
    expect(pickAutoUnits([3e9, 4e9])).toBe("billions");
  });

  test("mixed magnitudes or small values keep full numbers", () => {
    expect(pickAutoUnits([3, 2e6])).toBe("none");
    expect(pickAutoUnits([999, 5000])).toBe("none");
  });

  test("zeros, NaN and empty input are ignored", () => {
    expect(pickAutoUnits([0, 2000, NaN])).toBe("thousands");
    expect(pickAutoUnits([])).toBe("none");
    expect(pickAutoUnits([0])).toBe("none");
  });
});

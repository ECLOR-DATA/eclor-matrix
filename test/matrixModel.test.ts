import {
  buildHeaderRows,
  computeMaxAbs,
  flattenColumns,
  flattenRows,
  MatrixNodeLike
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

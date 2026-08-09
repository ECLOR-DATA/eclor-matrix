import {
  computeRowPathKeys,
  parseCustomRowsState,
  serializeCustomRowsState,
  weaveCustomRows,
  CustomRowDef
} from "../src/customRows";
import { RowModel } from "../src/matrixModel";

const row = (label: string, level: number, cells: (number | null)[], isSubtotal = false): RowModel => ({
  label,
  level,
  isSubtotal,
  isCollapsed: false,
  isExpandable: false,
  node: {},
  cells
});

const ROWS: RowModel[] = [
  row("France", 0, [null, null]),
  row("Gross Sales", 1, [100, 200]),
  row("COGS", 1, [-40, -80]),
  row("Total", 1, [60, 120], true),
  row("Iberia", 0, [null, null]),
  row("Gross Sales", 1, [50, 60]),
  row("COGS", 1, [-20, -30])
];

describe("computeRowPathKeys", () => {
  test("hierarchical keys with duplicate-label dedupe", () => {
    const keys = computeRowPathKeys(ROWS);
    expect(keys[1]).toBe("France▸Gross Sales");
    expect(keys[5]).toBe("Iberia▸Gross Sales");
    // Same chain twice would get a #2 suffix.
    const dup = computeRowPathKeys([row("A", 0, []), row("X", 1, []), row("X", 1, [])]);
    expect(dup[1]).toBe("A▸X");
    expect(dup[2]).toBe("A▸X#2");
  });
});

describe("parse / serialize state", () => {
  test("roundtrip keeps valid defs, drops malformed entries", () => {
    const defs: CustomRowDef[] = [
      { id: "a", kind: "subtotal", label: "S", anchor: "", refs: ["France▸COGS"] },
      { id: "b", kind: "formula", label: "R", anchor: "", formula: "[COGS] / [Gross Sales]", format: "percent" }
    ];
    expect(parseCustomRowsState(serializeCustomRowsState(defs))).toHaveLength(2);
    expect(parseCustomRowsState("not json")).toEqual([]);
    expect(parseCustomRowsState(JSON.stringify([{ id: 1 }, { id: "x", kind: "subtotal", label: "ok", refs: [] }]))).toHaveLength(1);
    expect(parseCustomRowsState(undefined)).toEqual([]);
  });
});

describe("weaveCustomRows — subtotal of arbitrary rows", () => {
  test("sums the chosen rows per column and inserts after the anchor", () => {
    const def: CustomRowDef = {
      id: "s1",
      kind: "subtotal",
      label: "Ventes groupe",
      anchor: "Iberia▸Gross Sales",
      refs: ["France▸Gross Sales", "Iberia▸Gross Sales"]
    };
    const { rows } = weaveCustomRows(ROWS, [def], 2);
    const idx = rows.findIndex((r) => r.label === "Ventes groupe");
    expect(idx).toBe(6); // right after Iberia▸Gross Sales
    expect(rows[idx].cells).toEqual([150, 260]);
    expect(rows[idx].isSubtotal).toBe(true);
    expect(rows).toHaveLength(8);
  });

  test("missing anchor → appended at the end", () => {
    const def: CustomRowDef = { id: "s2", kind: "subtotal", label: "S", anchor: "Nope", refs: ["France▸COGS"] };
    const { rows } = weaveCustomRows(ROWS, [def], 2);
    expect(rows[rows.length - 1].label).toBe("S");
    expect(rows[rows.length - 1].cells).toEqual([-40, -80]);
  });
});

describe("weaveCustomRows — formula rows", () => {
  test("ratio row computed per column with scoped label resolution", () => {
    const def: CustomRowDef = {
      id: "f1",
      kind: "formula",
      label: "Marge %",
      anchor: "Iberia▸COGS",
      formula: "1 + [COGS] / [Gross Sales]",
      format: "percent"
    };
    const { rows } = weaveCustomRows(ROWS, [def], 2);
    const r = rows.find((x) => x.label === "Marge %");
    // Anchored under Iberia → [COGS]/[Gross Sales] resolve to IBERIA rows.
    expect(r?.cells[0]).toBeCloseTo(1 - 20 / 50, 10);
    expect(r?.cells[1]).toBeCloseTo(1 - 30 / 60, 10);
  });

  test("exact path-key refs bypass scoping", () => {
    const def: CustomRowDef = {
      id: "f2",
      kind: "formula",
      label: "X",
      anchor: "",
      formula: "[France▸Gross Sales] - [Iberia▸Gross Sales]"
    };
    const { rows } = weaveCustomRows(ROWS, [def], 2);
    const r = rows.find((x) => x.label === "X");
    expect(r?.cells).toEqual([50, 140]);
  });

  test("invalid formula → blank row, never a crash", () => {
    const def: CustomRowDef = { id: "f3", kind: "formula", label: "bad", anchor: "", formula: "[a] +" };
    const { rows } = weaveCustomRows(ROWS, [def], 2);
    expect(rows.find((x) => x.label === "bad")?.cells).toEqual([null, null]);
  });
});

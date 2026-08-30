import {
  buildBasicFilter,
  buildSlicerFilter,
  buildTupleFilter,
  extractFilterTarget,
  parseAppliedFilter,
  BasicFilter,
  TupleFilter
} from "../src/filters";

const geo = { table: "Geo", column: "Country" };
const prod = { table: "Prod", column: "Product" };

describe("extractFilterTarget", () => {
  test("reads entity + ref from the column expr", () => {
    expect(
      extractFilterTarget({
        queryName: "Geo.Country",
        displayName: "Country",
        expr: { ref: "Country", source: { entity: "Geo" } }
      })
    ).toEqual(geo);
  });

  test("hierarchy level: uses expr.level and the nested entity", () => {
    expect(
      extractFilterTarget({
        queryName: "Geo.GeoHierarchy.Country",
        displayName: "Country",
        expr: { level: "Country", arg: { source: { entity: "Geo" } } }
      })
    ).toEqual(geo);
  });

  test("falls back to queryName / displayName when expr is missing", () => {
    expect(extractFilterTarget({ queryName: "Sales.Region", displayName: "Region" })).toEqual({
      table: "Sales",
      column: "Region"
    });
  });
});

describe("buildSlicerFilter routing", () => {
  test("no selection → null (caller removes the filter)", () => {
    expect(buildSlicerFilter([geo], [])).toBeNull();
  });

  test("single level, no nulls → BasicFilter In", () => {
    const f = buildSlicerFilter([geo], [["France"], ["Spain"]]) as BasicFilter;
    expect(f.filterType).toBe(1);
    expect(f.operator).toBe("In");
    expect(f.target).toEqual(geo);
    expect(f.values).toEqual(["France", "Spain"]);
  });

  test("single level with a null value → TupleFilter (basic forbids nulls)", () => {
    const f = buildSlicerFilter([geo], [["France"], [null]]) as TupleFilter;
    expect(f.filterType).toBe(6);
    expect(f.values).toEqual([[{ value: "France" }], [{ value: null }]]);
  });

  test("two levels → TupleFilter over full paths", () => {
    const f = buildSlicerFilter(
      [geo, prod],
      [
        ["France", "Alpha"],
        ["Spain", "Delta"]
      ]
    ) as TupleFilter;
    expect(f.filterType).toBe(6);
    expect(f.target).toEqual([geo, prod]);
    expect(f.values).toEqual([
      [{ value: "France" }, { value: "Alpha" }],
      [{ value: "Spain" }, { value: "Delta" }]
    ]);
  });

  test("Date values serialise to ISO strings", () => {
    const d = new Date("2026-03-01T00:00:00Z");
    const basic = buildBasicFilter(geo, [d]);
    expect(basic.values).toEqual(["2026-03-01T00:00:00.000Z"]);
    const tuple = buildTupleFilter([geo], [[d]]);
    expect(tuple.values[0][0].value).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("parseAppliedFilter (state restore)", () => {
  test("basic filter round-trips to 1-tuples", () => {
    const f = buildBasicFilter(geo, ["France", "Spain"]);
    expect(parseAppliedFilter(f)).toEqual([["France"], ["Spain"]]);
  });

  test("tuple filter round-trips to full paths", () => {
    const f = buildTupleFilter(
      [geo, prod],
      [
        ["France", "Alpha"],
        ["Spain", null]
      ]
    );
    expect(parseAppliedFilter(f)).toEqual([
      ["France", "Alpha"],
      ["Spain", null]
    ]);
  });

  test("foreign or malformed filters return null", () => {
    expect(parseAppliedFilter(null)).toBeNull();
    expect(parseAppliedFilter({})).toBeNull();
    expect(parseAppliedFilter({ filterType: 2, values: [] })).toBeNull();
    expect(parseAppliedFilter("advanced")).toBeNull();
  });
});

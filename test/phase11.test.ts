/**
 * Phase 11 — column widths, header options, per-row styles, expand icons,
 * wrap and aeration (1.10.0.0).
 */

import {
  columnKeyForCalc,
  columnKeyForLeaf,
  parseColumnWidthsState,
  parseRowStylesState,
  serializeColumnWidthsState
} from "../src/layout";
import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dv(labels: string[] = ["Revenue", "COGS"], objects?: Record<string, unknown>) {
  const d = buildSimpleMatrixDV(labels, [
    { name: "Actual", values: labels.map((_l, i) => 100 + i) },
    { name: "Budget", values: labels.map((_l, i) => 90 + i) }
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (objects) (d as any).metadata.objects = objects;
  return d;
}

describe("layout state parsing (pure)", () => {
  test("column widths: clamped, malformed dropped", () => {
    expect(parseColumnWidthsState(JSON.stringify({ a: 120, b: 5, c: 99999, d: "x" }))).toEqual({
      a: 120,
      b: 24,
      c: 1200
    });
    expect(parseColumnWidthsState("not json")).toEqual({});
    expect(parseColumnWidthsState(JSON.stringify([1, 2]))).toEqual({});
    expect(columnKeyForLeaf(["2025", ""], "Réel")).toBe("2025·Réel");
    expect(columnKeyForCalc("ΔPL")).toBe("calc:ΔPL");
  });

  test("row styles: validated entries only", () => {
    const raw = JSON.stringify([
      { key: "A", align: "center" },
      { key: "B", indent: 999 },
      { key: "C", align: "diagonal" },
      { key: "", align: "left" },
      { key: "D" }
    ]);
    expect(parseRowStylesState(raw)).toEqual([
      { key: "A", align: "center", indent: undefined },
      { key: "B", align: undefined, indent: 400 }
    ]);
    expect(parseRowStylesState(42)).toEqual([]);
  });
});

describe("column widths", () => {
  test("uniform mode: fixed layout + colgroup widths", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(dv(undefined, { columnWidths: { mode: "uniform", uniformWidth: 90 } }))
    );
    const table = target.querySelector("table.em-table") as HTMLTableElement;
    expect(table.classList.contains("em-fixed")).toBe(true);
    const cols = table.querySelectorAll("colgroup col");
    expect(cols).toHaveLength(3); // row header + 2 measures
    expect((cols[0] as HTMLElement).style.width).toBe("220px");
    expect((cols[1] as HTMLElement).style.width).toBe("90px");
    expect(table.style.width).toBe("400px");
    expect(target.querySelectorAll(".em-colgrip")).toHaveLength(0); // uniform: no grips
  });

  test("custom mode: persisted widths win, grips attached everywhere", () => {
    const { visual, target } = makeVisual();
    const state = serializeColumnWidthsState({ "·Actual": 150, rowheader: 180 });
    visual.update(
      makeUpdateOptions(
        dv(undefined, { columnWidths: { mode: "custom", uniformWidth: 100, state } })
      )
    );
    const cols = target.querySelectorAll("colgroup col");
    expect((cols[0] as HTMLElement).style.width).toBe("180px"); // row header from state
    expect((cols[1] as HTMLElement).style.width).toBe("150px"); // Actual from state
    expect((cols[2] as HTMLElement).style.width).toBe("100px"); // Budget falls back
    const grips = target.querySelectorAll(".em-colgrip");
    expect(grips).toHaveLength(3); // corner + 2 measure headers
    expect(grips[0].getAttribute("data-col-key")).toBe("rowheader");
  });

  test("auto mode: no colgroup, no fixed layout", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv()));
    expect(target.querySelector("colgroup")).toBeNull();
    expect(target.querySelector("table.em-fixed")).toBeNull();
  });
});

describe("header options", () => {
  test("separators, wrap and dedicated text size", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dv(undefined, {
          columnHeaders: {
            separators: true,
            borderColor: { solid: { color: "#123456" } },
            borderWidth: 2,
            wrapText: true,
            textSize: 15
          }
        })
      )
    );
    expect(target.classList.contains("em-hsep")).toBe(true);
    expect(target.classList.contains("em-hwrap")).toBe(true);
    expect(target.style.getPropertyValue("--em-hsep-c")).toBe("#123456");
    expect(target.style.getPropertyValue("--em-hsep-w")).toBe("2px");
    expect((target.querySelector("thead") as HTMLElement).style.fontSize).toBe("15px");
  });
});

describe("per-row styles + alignment", () => {
  test("persisted row style overrides indent and alignment on that row only", () => {
    const state = JSON.stringify([{ key: "Revenue", align: "center", indent: 40 }]);
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv(undefined, { rowStyles: { state } })));
    const rows = target.querySelectorAll("tbody tr");
    const th0 = rows[0].querySelector("th") as HTMLElement;
    expect(th0.style.paddingLeft).toBe("40px");
    expect(th0.style.textAlign).toBe("center");
    expect((rows[0].querySelector("td") as HTMLElement).style.textAlign).toBe("center");
    const th1 = rows[1].querySelector("th") as HTMLElement;
    expect(th1.style.paddingLeft).toBe("8px"); // untouched sibling
    expect(th1.style.textAlign).toBe("");
  });

  test("per-measure alignment beats the global Values alignment", () => {
    const d = buildSimpleMatrixDV(
      ["Revenue"],
      [
        { name: "Actual", values: [100], objects: { values: { alignment: "left" } } },
        { name: "Budget", values: [90] }
      ]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d as any).metadata.objects = { values: { alignment: "center" } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(d));
    const tds = target.querySelectorAll("tbody tr:first-child td");
    expect((tds[0] as HTMLElement).style.textAlign).toBe("left"); // per-measure
    expect((tds[1] as HTMLElement).style.textAlign).toBe("center"); // global
  });
});

describe("expand icons, wrap and aeration", () => {
  const hierDv = (objects?: Record<string, unknown>) => {
    const d = {
      matrix: {
        rows: {
          root: {
            children: [
              {
                levelValues: [{ value: "France" }],
                identity: { key: "g0" },
                children: [
                  { levelValues: [{ value: "Paris" }], identity: { key: "r0" }, values: { 0: { value: 1 } } }
                ]
              },
              {
                levelValues: [{ value: "Italie" }],
                identity: { key: "g1" },
                children: [
                  { levelValues: [{ value: "Rome" }], identity: { key: "r1" }, values: { 0: { value: 2 } } }
                ]
              }
            ]
          },
          levels: [{ sources: [{ displayName: "Zone", roles: { rows: true } }] }]
        },
        columns: { root: { children: [] } },
        valueSources: [{ displayName: "Actual", queryName: "M.A_0", roles: { values: true } }]
      },
      metadata: { columns: [], objects }
    };
    return d;
  };

  test("expand icon set is configurable", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(hierDv({ rowHeaders: { expandIcon: "boxed" } })));
    expect((target.querySelector(".em-chevron") as HTMLElement).textContent).toBe("⊟");
  });

  test("wrapped labels: clamp wrapper + uniform forced row height", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv(undefined, { rowHeaders: { wrapText: true, maxLines: 3 } })));
    expect(target.classList.contains("em-rwrap")).toBe(true);
    expect(target.style.getPropertyValue("--em-rwrap-lines")).toBe("3");
    const tr = target.querySelector("tbody tr") as HTMLElement;
    expect(tr.style.height).not.toBe("");
    expect(tr.querySelector(".em-rlabelclamp")).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withWrap = (visual as any).rowHeightPx as number;
    const { visual: v2 } = makeVisual();
    v2.update(makeUpdateOptions(dv()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(withWrap).toBe(((v2 as any).rowHeightPx as number) + 2 * Math.round(11 * 1.45));
  });

  test("blank row before groups + spacer custom rows render airy and inert", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        hierDv({
          general: { blankRowBeforeGroups: true },
          customRows: {
            state: JSON.stringify([{ id: "sp1", kind: "spacer", label: "", anchor: "France▸Paris" }])
          }
        })
      )
    );
    const rows = Array.from(target.querySelectorAll("tbody tr"));
    const blanks = rows.filter((r) => r.classList.contains("em-blankrow"));
    expect(blanks).toHaveLength(2); // before Italie + the user spacer after Paris
    expect(blanks[0].getAttribute("tabindex")).toBeNull();
    expect(blanks[0].getAttribute("aria-hidden")).toBe("true");
    expect(blanks[0].querySelector("th")!.textContent).toBe("");
    // Order: France, Paris, spacer, blank-before-group, Italie, Rome.
    expect(rows.map((r) => (r.querySelector("th") as HTMLElement).textContent)).toEqual([
      "▾France",
      "Paris",
      "",
      "",
      "▾Italie",
      "Rome"
    ]);
  });

  test("gap columns between groups (flat header) stay empty and unstyled", () => {
    const measureLeaves = () => [{ levelSourceIndex: 0 }];
    const d = {
      matrix: {
        rows: {
          root: {
            children: [
              {
                levelValues: [{ value: "A" }],
                identity: { key: "r0" },
                values: { 0: { value: 1 }, 1: { value: 2 } }
              }
            ]
          },
          levels: [{ sources: [{ displayName: "L", roles: { rows: true } }] }]
        },
        columns: {
          root: {
            children: [
              { levelValues: [{ value: "2025" }], children: measureLeaves() },
              { levelValues: [{ value: "2026" }], children: measureLeaves() }
            ]
          }
        },
        valueSources: [{ displayName: "Actual", queryName: "M.A_0", roles: { values: true } }]
      },
      metadata: { columns: [], objects: { grid: { gapColumns: true, gapWidth: 20 } } }
    };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(d));
    const gaps = target.querySelectorAll("tbody td.em-gapcol");
    expect(gaps).toHaveLength(1); // between the two groups, none after the last
    expect((gaps[0] as HTMLElement).textContent).toBe("");
    expect(target.querySelectorAll("thead th.em-gapcol")).toHaveLength(1);
    // Spacer rows span the gap too.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((visual as any).lastValidRenderInput.parsed.renderCols).toHaveLength(3);
  });
});

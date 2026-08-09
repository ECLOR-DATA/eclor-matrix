/**
 * Phase 3 — rule colours + heat map integration.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

const HEAT = { cellColors: { useCustom: true, mode: "heatmap" } };

describe("heat map per measure", () => {
  test("low and high cells get different backgrounds; overridden measure only", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["A", "B", "C"],
      [
        { name: "Actual", values: [0, 50, 100], objects: HEAT },
        { name: "Budget", values: [0, 50, 100] }
      ]
    );
    visual.update(makeUpdateOptions(dv));
    const rows = Array.from(target.querySelectorAll("tbody tr"));
    const bgOf = (r: Element, i: number) =>
      (r.querySelectorAll("td")[i] as HTMLElement).style.backgroundColor;
    expect(bgOf(rows[0], 0)).not.toBe("");
    expect(bgOf(rows[2], 0)).not.toBe("");
    expect(bgOf(rows[0], 0)).not.toBe(bgOf(rows[2], 0));
    // Budget (no override, global mode none) stays unpainted.
    expect(bgOf(rows[0], 1)).toBe("");
  });

  test("subtotal rows are never painted", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A", "B"], [{ name: "Actual", values: [10, 90], objects: HEAT }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv.matrix.rows.root.children as any[]).push({
      level: 0,
      isSubtotal: true,
      values: { 0: { value: 100 } }
    });
    visual.update(makeUpdateOptions(dv));
    const subtotal = target.querySelector("tr.em-subtotal td") as HTMLElement;
    expect(subtotal.style.backgroundColor).toBe("");
  });
});

describe("rules mode", () => {
  test("below-low painted bad, above-high painted good, middle untouched", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["neg", "mid", "pos"],
      [
        {
          name: "Δ",
          values: [-5, 3, 20],
          objects: {
            cellColors: { useCustom: true, mode: "rules", thresholdLow: 0, thresholdHigh: 10 }
          }
        }
      ]
    );
    visual.update(makeUpdateOptions(dv));
    const tds = Array.from(target.querySelectorAll("tbody td")) as HTMLElement[];
    expect(tds[0].style.backgroundColor).not.toBe("");
    expect(tds[1].style.backgroundColor).toBe("");
    expect(tds[2].style.backgroundColor).not.toBe("");
    expect(tds[0].style.backgroundColor).not.toBe(tds[2].style.backgroundColor);
  });
});

describe("high contrast", () => {
  test("HC mode suppresses all rule/heat painting", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    host.colorPalette.isHighContrast = true;
    host.colorPalette.foreground = { value: "#ffffff" };
    host.colorPalette.background = { value: "#000000" };
    const dv = buildSimpleMatrixDV(["A", "B"], [{ name: "Actual", values: [0, 100], objects: HEAT }]);
    visual.update(makeUpdateOptions(dv));
    const tds = Array.from(target.querySelectorAll("tbody td")) as HTMLElement[];
    expect(tds.every((td) => td.style.backgroundColor === "")).toBe(true);
  });
});

describe("format pane groups", () => {
  test("cell-colour per-measure groups exist with unique names", () => {
    const { visual } = makeVisual();
    const dv = buildSimpleMatrixDV(["A"], [
      { name: "Actual", values: [1] },
      { name: "Budget", values: [2] }
    ]);
    visual.update(makeUpdateOptions(dv));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groups = (visual as any).formattingSettings.cellColors.groups;
    expect(groups.map((g: { name: string }) => g.name)).toEqual([
      "cellColorsGlobal",
      "cellColorsM0",
      "cellColorsM1"
    ]);
  });
});

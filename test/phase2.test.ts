/**
 * Phase 2 — virtual scrolling + per-measure format overrides.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function bigLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Row ${i}`);
}

describe("virtual scrolling", () => {
  test("small datasets render every row, no spacers", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(bigLabels(50), [{ name: "Actual", values: bigLabels(50).map((_, i) => i) }]);
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelectorAll("tbody tr[data-row-idx]")).toHaveLength(50);
    expect(target.querySelectorAll("tr.em-spacer")).toHaveLength(0);
  });

  test("large datasets render a window plus a bottom spacer", () => {
    const { visual, target } = makeVisual();
    const n = 2000;
    const dv = buildSimpleMatrixDV(bigLabels(n), [{ name: "Actual", values: bigLabels(n).map((_, i) => i) }]);
    visual.update(makeUpdateOptions(dv, 800, 400));
    const rendered = target.querySelectorAll("tbody tr[data-row-idx]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(n / 2);
    // At scrollTop 0: no top spacer, one bottom spacer.
    expect(target.querySelectorAll("tr.em-spacer")).toHaveLength(1);
    expect(rendered[0].getAttribute("data-row-idx")).toBe("0");
  });

  test("scrolling re-windows the tbody", () => {
    const { visual, target } = makeVisual();
    const n = 2000;
    const dv = buildSimpleMatrixDV(bigLabels(n), [{ name: "Actual", values: bigLabels(n).map((_, i) => i) }]);
    visual.update(makeUpdateOptions(dv, 800, 400));
    const scroll = target.querySelector(".em-scroll") as HTMLElement;
    scroll.scrollTop = 5000;
    scroll.dispatchEvent(new Event("scroll"));
    const rendered = target.querySelectorAll("tbody tr[data-row-idx]");
    expect(parseInt(rendered[0].getAttribute("data-row-idx") || "0", 10)).toBeGreaterThan(0);
    // Mid-list: top AND bottom spacers present.
    expect(target.querySelectorAll("tr.em-spacer")).toHaveLength(2);
  });
});

describe("per-measure format overrides", () => {
  test("override with useCustom applies units to that measure only", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["A"],
      [
        {
          name: "Actual",
          values: [2500000],
          objects: { values: { useCustom: true, displayUnits: "millions", decimals: 1 } }
        },
        { name: "Budget", values: [2500000] }
      ]
    );
    visual.update(makeUpdateOptions(dv));
    const cells = Array.from(target.querySelectorAll("tbody td")).map((td) => td.textContent);
    // Override: millions + 1 decimal → "2.5M". Global auto + 0 decimals → "3M".
    expect(cells[0]).toBe("2.5M");
    expect(cells[1]).toBe("3M");
  });

  test("override present but useCustom false → global settings win", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["A"],
      [
        {
          name: "Actual",
          values: [2500000],
          objects: { values: { useCustom: false, displayUnits: "millions", decimals: 1 } }
        }
      ]
    );
    visual.update(makeUpdateOptions(dv));
    const cell = target.querySelector("tbody td") as HTMLElement;
    // The stored 1-decimal override must NOT apply: global auto → "3M", not "2.5M".
    expect(cell.textContent).toBe("3M");
  });

  test("per-measure groups are appended to the Values card", () => {
    const { visual } = makeVisual();
    const dv = buildSimpleMatrixDV(["A"], [
      { name: "Actual", values: [1] },
      { name: "Budget", values: [2] }
    ]);
    visual.update(makeUpdateOptions(dv));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groups = (visual as any).formattingSettings.values.groups;
    expect(groups.map((g: { name: string }) => g.name)).toEqual(["valuesGlobal", "valuesM0", "valuesM1"]);
    // Dynamic slices carry the per-measure metadata selector.
    expect(groups[1].slices[0].selector).toEqual({ metadata: "Measures.Actual_0" });
  });
});

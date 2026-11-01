/**
 * Audit GEN-26-a — auto display units in the grid. The audit's Nulls page
 * (demo base scenario table, no model format string) rendered 320,000 as
 * "0M" and -18,000 as "0M": the scale came from the grand total and was
 * applied to every column with 0 decimals.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

const NULLS = () => {
  const dv = buildSimpleMatrixDV(
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
    [
      { name: "Sum of Actual", values: [320000, null, 450000, null, 275000, 510000] },
      { name: "Sum of Variance", values: [15000, 22000, null, -18000, -9500, 31000] }
    ] as never
  );
  // The host appends the grand-total row (engine subtotal).
  dv.matrix.rows.root.children.push({
    isSubtotal: true,
    values: { 0: { value: 1555000, valueSourceIndex: 0 }, 1: { value: 40500, valueSourceIndex: 1 } }
  } as never);
  return dv;
};

const cellTexts = (target: HTMLElement): string[][] =>
  Array.from(target.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "")
  );

describe("auto display units (GEN-26-a)", () => {
  test("no non-zero cell renders as a zero, signs survive", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NULLS()));
    const cells = cellTexts(target);
    expect(cells[0]).toEqual(["320K", "15K"]);
    expect(cells[3][1]).toBe("-18K");
    for (const row of cells) {
      for (const text of row) expect(text).not.toMatch(/^-?0[KMB]?$/);
    }
  });

  test("a column whose detail values span magnitudes keeps full numbers", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A", "B"], [{ name: "Units", values: [7, 2500000] }] as never);
    visual.update(makeUpdateOptions(dv));
    const cells = cellTexts(target);
    expect(cells[0][0]).toBe("7");
    // Unscaled and unrounded (grouping depends on the host formatter).
    expect(cells[1][0]).toMatch(/^2,?500,?000$/);
  });

  // Audit GEN-26-b: scaled values above 999K lost their separator ("1555K").
  test("scaled cells keep their group separator", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NULLS()));
    const cells = cellTexts(target);
    expect(cells[cells.length - 1][0]).toBe("1,555K");
  });

  test("a model format string still renders verbatim", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A", "B"], [
      { name: "Sales", values: [320000, 450000], format: "#,0" }
    ]);
    visual.update(makeUpdateOptions(dv));
    expect(cellTexts(target)[0][0]).toBe("320,000");
  });

  // Residual of GEN-26-a: calc columns kept the grid-wide scale, so a variance
  // far smaller than its measures still collapsed to "+0M".
  test("an inherit-format calc column resolves its own unit", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A", "B"], [
      { name: "Actual", values: [1000000, 2000000] },
      { name: "Budget", values: [999000, 1995000] }
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = {
      calculatedColumns: { calc1Show: true, calc1Name: "Delta", calc1Formula: "[Actual] - [Budget]" }
    };
    visual.update(makeUpdateOptions(dv));
    const cells = cellTexts(target);
    expect(cells[0][2]).toBe("+1K");
    expect(cells[1][2]).toBe("+5K");
  });
});

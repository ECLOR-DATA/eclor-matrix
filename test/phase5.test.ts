/**
 * Phase 5 — client-side calculated columns integration.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dvWithCalc(objects: Record<string, unknown>) {
  const dv = buildSimpleMatrixDV(
    ["Revenue", "COGS"],
    [
      { name: "Actual", values: [120, -60] },
      { name: "Budget", values: [100, -50] }
    ]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dv as any).metadata.objects = objects;
  return dv;
}

const CALC_DELTA = {
  calculatedColumns: {
    calc1Show: true,
    calc1Name: "Δ",
    calc1Formula: "[Actual] - [Budget]",
    calc1Format: "number"
  }
};

describe("calculated columns", () => {
  test("Δ column appears after the measures with computed values", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithCalc(CALC_DELTA)));
    const headers = Array.from(target.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toContain("Δ");
    const firstRow = Array.from(
      target.querySelectorAll("tbody tr:first-child td")
    ) as HTMLElement[];
    expect(firstRow).toHaveLength(3); // Actual, Budget, Δ
    expect(firstRow[2].textContent).toBe("+20");
    expect(firstRow[2].classList.contains("em-calc")).toBe(true);
  });

  test("percent format multiplies and suffixes", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvWithCalc({
          calculatedColumns: {
            calc1Show: true,
            calc1Name: "Δ%",
            calc1Formula: "([Actual] - [Budget]) / [Budget]",
            calc1Format: "percent"
          }
        })
      )
    );
    const firstRow = Array.from(target.querySelectorAll("tbody tr:first-child td")) as HTMLElement[];
    expect(firstRow[2].textContent).toBe("+20.0%");
  });

  test("invalid formula → column silently skipped", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvWithCalc({
          calculatedColumns: { calc1Show: true, calc1Name: "bad", calc1Formula: "[Actual] +" }
        })
      )
    );
    expect(target.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
  });

  test("division by zero renders blank, not Infinity", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["A"],
      [
        { name: "Actual", values: [10] },
        { name: "Budget", values: [0] }
      ]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = {
      calculatedColumns: {
        calc1Show: true,
        calc1Name: "ratio",
        calc1Formula: "[Actual] / [Budget]",
        calc1Format: "number"
      }
    };
    visual.update(makeUpdateOptions(dv));
    const tds = Array.from(target.querySelectorAll("tbody td")) as HTMLElement[];
    expect(tds[2].textContent).toBe("");
  });

  test("subtotal rows compute the formula on subtotal values (ratio-safe)", () => {
    const { visual, target } = makeVisual();
    const dv = dvWithCalc({
      calculatedColumns: {
        calc1Show: true,
        calc1Name: "Δ%",
        calc1Formula: "([Actual] - [Budget]) / [Budget]",
        calc1Format: "percent"
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv.matrix.rows.root.children as any[]).push({
      level: 0,
      isSubtotal: true,
      values: { 0: { value: 60, valueSourceIndex: 0 }, 1: { value: 50, valueSourceIndex: 1 } }
    });
    visual.update(makeUpdateOptions(dv));
    const subtotalTds = Array.from(target.querySelectorAll("tr.em-subtotal td")) as HTMLElement[];
    // (60-50)/50 = +20.0% — computed on the engine subtotals, not summed from leaves.
    expect(subtotalTds[2].textContent).toBe("+20.0%");
  });
});

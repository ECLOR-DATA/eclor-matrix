/**
 * Phase 6 — IBCS styling + variance bars integration.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dvIbcs(extraObjects: Record<string, unknown> = {}) {
  const dv = buildSimpleMatrixDV(
    ["Revenue", "COGS"],
    [
      { name: "Actual", values: [120, -60] },
      { name: "Budget", values: [100, -50] },
      { name: "Forecast", values: [130, -70] }
    ]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dv as any).metadata.objects = { ibcs: { enabled: true }, ...extraObjects };
  return dv;
}

describe("IBCS header + cell semantics", () => {
  test("scenario classes land on measure header cells", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvIbcs()));
    expect(target.querySelector("thead th.ibcs-ac")).not.toBeNull();
    expect(target.querySelector("thead th.ibcs-bu")).not.toBeNull();
    expect(target.querySelector("thead th.ibcs-fc")).not.toBeNull();
  });

  test("FC data cells get the hatch class, AC cells stay clean", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvIbcs()));
    const firstRowTds = Array.from(target.querySelectorAll("tbody tr:first-child td"));
    expect(firstRowTds[2].classList.contains("ibcs-fc")).toBe(true);
    expect(firstRowTds[0].classList.contains("ibcs-ac")).toBe(false);
  });

  test("per-measure scenario override beats name detection", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A"], [
      { name: "Actual", values: [1], objects: { values: { scenario: "PY" } } }
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { ibcs: { enabled: true } };
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelector("thead th.ibcs-py")).not.toBeNull();
    expect(target.querySelector("thead th.ibcs-ac")).toBeNull();
  });

  test("IBCS off → no scenario classes anywhere", () => {
    const { visual, target } = makeVisual();
    const dv = dvIbcs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = {};
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelector("[class*=ibcs-]")).toBeNull();
  });
});

describe("variance bars", () => {
  const BAR_CALC = {
    calculatedColumns: {
      calc1Show: true,
      calc1Name: "ΔBU",
      calc1Formula: "[Actual] - [Budget]",
      calc1Format: "number",
      calc1Display: "bar"
    }
  };

  test("bars render with sign classes and proportional widths", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvIbcs(BAR_CALC)));
    const bars = Array.from(target.querySelectorAll(".em-bar")) as HTMLElement[];
    expect(bars).toHaveLength(2);
    // Revenue: +20 → positive; COGS: -10 → negative.
    expect(bars[0].classList.contains("em-bar-pos")).toBe(true);
    expect(bars[1].classList.contains("em-bar-neg")).toBe(true);
    // maxAbs = 20 → widths 50% (full half-track) and 25%.
    expect(bars[0].style.width).toBe("50%");
    expect(bars[1].style.width).toBe("25%");
    // The formatted value label is kept next to the bar.
    const labels = Array.from(target.querySelectorAll(".em-barlabel")).map((l) => l.textContent);
    expect(labels[0]).toBe("+20");
    expect(labels[1]).toBe("-10");
  });

  // Audit GEN-25-c: the domain covered detail rows only, so a total of +10
  // next to details of +20/-10 was drawn clamped like the largest detail;
  // with a 3x total every total bar was the same full length.
  test("subtotal rows share the scale instead of saturating", () => {
    const { visual, target } = makeVisual();
    const dv = dvIbcs(BAR_CALC);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).matrix.rows.root.children.push({
      isSubtotal: true,
      values: {
        0: { value: 360, valueSourceIndex: 0 },
        1: { value: 300, valueSourceIndex: 1 },
        2: { value: 390, valueSourceIndex: 2 }
      }
    });
    visual.update(makeUpdateOptions(dv));
    const bars = Array.from(target.querySelectorAll(".em-bar")) as HTMLElement[];
    expect(bars).toHaveLength(3);
    // maxAbs = 60 (the total) → Revenue +20 = 1/3 of the half-track.
    expect(bars[0].style.width).toBe("16.65%");
    expect(bars[2].style.width).toBe("50%");
  });
});

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
});

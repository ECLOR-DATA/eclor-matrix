/**
 * Phase 8 — in-visual layout editor + persisted custom rows.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

const STATE = JSON.stringify([
  {
    id: "s1",
    kind: "subtotal",
    label: "Cash lines",
    anchor: "COGS",
    refs: ["Gross Sales", "COGS"]
  },
  {
    id: "f1",
    kind: "formula",
    label: "Marge %",
    anchor: "",
    formula: "([Gross Sales] + [COGS]) / [Gross Sales]",
    format: "percent"
  }
]);

function dvWithState() {
  const dv = buildSimpleMatrixDV(["Gross Sales", "COGS"], [{ name: "Actual", values: [100, -40] }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dv as any).metadata.objects = { customRows: { state: STATE } };
  return dv;
}

describe("persisted custom rows", () => {
  test("subtotal and formula rows render at their positions", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithState()));
    const labels = Array.from(target.querySelectorAll("tbody th.em-rowheader")).map(
      (th) => th.textContent
    );
    expect(labels).toEqual(["Gross Sales", "COGS", "Cash lines", "Marge %"]);
    const customRows = target.querySelectorAll("tr.em-customrow");
    expect(customRows).toHaveLength(2);
    // Subtotal: 100 + (-40) = 60 ; formula percent: 60/100 = 60.0%
    // (formula ROWS don't force the +sign — that's for variance columns).
    expect(customRows[0].querySelector("td")?.textContent).toBe("60");
    expect(customRows[1].querySelector("td")?.textContent).toBe("60.0%");
  });

  test("custom rows are excluded from heat-map stats and painting", () => {
    const { visual, target } = makeVisual();
    const dv = dvWithState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).matrix.valueSources[0].objects = { cellColors: { useCustom: true, mode: "heatmap" } };
    visual.update(makeUpdateOptions(dv));
    const custom = target.querySelectorAll("tr.em-customrow td") as NodeListOf<HTMLElement>;
    expect(Array.from(custom).every((td) => td.style.backgroundColor === "")).toBe(true);
  });
});

describe("layout editor", () => {
  test("toolbar renders; panel opens on click", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(buildSimpleMatrixDV(["A"], [{ name: "M", values: [1] }])));
    const btn = target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(target.querySelector(".em-editpanel")).not.toBeNull();
  });

  test("subtotal from selection persists and renders immediately", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    const dv = buildSimpleMatrixDV(["Gross Sales", "COGS", "OpEx"], [{ name: "M", values: [100, -40, -20] }]);
    visual.update(makeUpdateOptions(dv));

    // Select two rows (multi), open the panel, add the subtotal.
    const rows = target.querySelectorAll("tbody tr[data-row-idx]");
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    (target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const input = target.querySelector("#em-st-label") as HTMLInputElement;
    input.value = "Somme libre";
    (target.querySelector('[data-em-action="add-subtotal"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(persisted).toHaveLength(1);
    const state = JSON.parse(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (persisted[0] as any).merge[0].properties.state
    );
    expect(state[0].kind).toBe("subtotal");
    expect(state[0].refs).toEqual(["Gross Sales", "COGS"]);
    // Local re-render without waiting for the host echo:
    const labels = Array.from(target.querySelectorAll("tbody th.em-rowheader")).map(
      (th) => th.textContent
    );
    expect(labels).toContain("Somme libre");
    const custom = target.querySelector("tr.em-customrow td") as HTMLElement;
    expect(custom.textContent).toBe("60");
  });

  test("invalid formula in the panel is rejected without persisting", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    visual.update(makeUpdateOptions(buildSimpleMatrixDV(["A"], [{ name: "M", values: [1] }])));
    (target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const formula = target.querySelector("#em-f-formula") as HTMLInputElement;
    formula.value = "[A] +";
    (target.querySelector('[data-em-action="add-formula"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(persisted).toHaveLength(0);
    expect(formula.classList.contains("em-invalid")).toBe(true);
  });

  test("delete removes the definition and its row", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    host.persistProperties = () => {};
    visual.update(makeUpdateOptions(dvWithState()));
    (target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const del = target.querySelector('[data-em-action="del-custom"][data-def-id="s1"]') as HTMLElement;
    del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const labels = Array.from(target.querySelectorAll("tbody th.em-rowheader")).map(
      (th) => th.textContent
    );
    expect(labels).not.toContain("Cash lines");
    expect(labels).toContain("Marge %");
  });
});

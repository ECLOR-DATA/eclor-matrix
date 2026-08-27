/**
 * Phase 4 — custom headers + spacing.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";
import { VisualFormattingSettingsModel } from "../src/settings";

const DV = () =>
  buildSimpleMatrixDV(["A"], [{ name: "Actual", values: [1] }]);

function withObjects(objects: Record<string, unknown>) {
  const dv = DV();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dv as any).metadata.objects = objects;
  return dv;
}

describe("column header styling", () => {
  test("backColor, fontColor, italic and alignment apply inline", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        withObjects({
          columnHeaders: {
            backColor: { solid: { color: "#112233" } },
            fontColor: { solid: { color: "#FFEE00" } },
            italic: true,
            alignment: "left"
          }
        })
      )
    );
    const th = target.querySelector("thead th:not(.em-corner)") as HTMLElement;
    expect(th.style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(th.style.color).toBe("rgb(255, 238, 0)");
    expect(th.style.fontStyle).toBe("italic");
    expect(th.style.textAlign).toBe("left");
  });

  test("rotation adds the table-level class and wraps labels in spans", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(withObjects({ columnHeaders: { rotation: "90" } })));
    expect(target.querySelector("table.em-rot90")).not.toBeNull();
    expect(target.querySelector("thead th .em-hlabel")).not.toBeNull();
  });
});

describe("row header styling and indent", () => {
  test("bold + custom indent per level", () => {
    const { visual, target } = makeVisual();
    const dv = withObjects({ rowHeaders: { bold: true, indent: 30 } });
    // Two-level hierarchy to observe the indent multiplier.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).matrix.rows.root.children = [
      {
        level: 0,
        value: "G",
        children: [{ level: 1, value: "leaf", values: { 0: { value: 1 } } }]
      }
    ];
    visual.update(makeUpdateOptions(dv));
    const headers = Array.from(target.querySelectorAll("tbody th.em-rowheader")) as HTMLElement[];
    expect(headers[0].style.paddingLeft).toBe("8px");
    expect(headers[1].style.paddingLeft).toBe("38px");
    expect(headers[1].style.fontWeight).toBe("700");
  });
});

describe("spacing", () => {
  test("rowPadding > 0 sets the CSS var on the root", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(withObjects({ general: { rowPadding: 12 } })));
    expect(target.style.getPropertyValue("--em-pad-y")).toBe("12px");
  });

  test("rowPadding 0 leaves density in charge (no var)", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(DV()));
    expect(target.style.getPropertyValue("--em-pad-y")).toBe("");
  });
});

describe("settings model", () => {
  test("new cards are registered with unique names", () => {
    const m = new VisualFormattingSettingsModel();
    const names = m.cards.map((c) => c.name);
    expect(names).toEqual([
      "general",
      "grid",
      "subTotals",
      "subtotalsStyle",
      "rowHeaders",
      "columnHeaders",
      "values",
      "cellColors",
      "calculatedColumns",
      "ibcs",
      "comments"
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});

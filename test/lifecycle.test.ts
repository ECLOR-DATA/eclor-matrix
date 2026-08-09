/**
 * Host-lifecycle coverage — the playbook §4.1 class of bugs:
 * placeholder-before-first-update, page-switch replay, user-cleared wipe,
 * degenerate viewport no-op, destroy.
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

const NOMINAL = () =>
  buildSimpleMatrixDV(
    ["Revenue", "COGS", "OpEx"],
    [
      { name: "Actual", values: [1000, -400, -250] },
      { name: "Budget", values: [900, -380, -260] }
    ]
  );

describe("constructor", () => {
  test("renders a placeholder before the first update()", () => {
    const { target } = makeVisual();
    expect(target.querySelector(".em-empty")).not.toBeNull();
  });
});

describe("update — nominal render", () => {
  test("renders one tr per row and one td per rendered leaf", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    const rows = target.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll("td")).toHaveLength(2);
    expect(target.querySelector(".em-empty")).toBeNull();
  });

  test("header shows measure names when no column grouping is bound", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    const headers = Array.from(target.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toContain("Actual");
    expect(headers).toContain("Budget");
  });

  test("tooltip-only measures are excluded from the grid", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(
      ["A", "B"],
      [
        { name: "Actual", values: [1, 2] },
        { name: "Detail", values: [10, 20], role: "tooltips" }
      ]
    );
    visual.update(makeUpdateOptions(dv));
    const firstRowCells = target.querySelectorAll("tbody tr:first-child td");
    expect(firstRowCells).toHaveLength(1);
  });
});

describe("update — page-switch replay vs user-cleared", () => {
  test("null DataView after a valid frame replays the cached render", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    visual.update(makeUpdateOptions(null));
    expect(target.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(target.querySelector(".em-empty")).toBeNull();
  });

  test("user-cleared rows wipe the cache — no ghost frame", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    // Matrix present but no rows and no measures → user emptied the buckets.
    const cleared = {
      matrix: {
        rows: { root: { children: [] }, levels: [] },
        columns: { root: { children: [] } },
        valueSources: []
      },
      metadata: { columns: [] }
    };
    visual.update(makeUpdateOptions(cleared));
    expect(target.querySelector(".em-empty")).not.toBeNull();
    // A subsequent transient must NOT resurrect the old frame.
    visual.update(makeUpdateOptions(null));
    expect(target.querySelector(".em-empty")).not.toBeNull();
    expect(target.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("update — degenerate viewport", () => {
  test("0×0 viewport no-ops and keeps the previous frame", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    visual.update(makeUpdateOptions(NOMINAL(), 0, 0));
    expect(target.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});

describe("subtotal rows", () => {
  test("engine subtotal renders with the em-subtotal class", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A", "B"], [{ name: "Actual", values: [1, 2] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv.matrix.rows.root.children as any[]).push({
      level: 0,
      isSubtotal: true,
      values: { 0: { value: 3 } }
    });
    visual.update(makeUpdateOptions(dv));
    const subtotalRows = target.querySelectorAll("tbody tr.em-subtotal");
    expect(subtotalRows).toHaveLength(1);
  });
});

describe("destroy", () => {
  test("clears the DOM and the render cache", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    visual.destroy();
    expect(target.children).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((visual as any).lastValidRenderInput).toBeNull();
  });
});

describe("accessibility", () => {
  test("rows are focusable and carry enriched aria-labels", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(NOMINAL()));
    const row = target.querySelector("tbody tr") as HTMLElement;
    expect(row.getAttribute("tabindex")).toBe("0");
    const aria = row.getAttribute("aria-label") ?? "";
    expect(aria).toContain("Revenue");
    // The formatted Actual value is embedded, not just the label.
    expect(aria.length).toBeGreaterThan("Revenue".length);
  });
});

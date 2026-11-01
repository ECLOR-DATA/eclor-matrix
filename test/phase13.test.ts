/**
 * Phase 13 — hardening from the 1.9→1.11 adversarial review (1.11.1.0):
 * keyboard vs blank rows, uniform heights under aeration/frames/virtualization,
 * bold row labels, frame priority in HC, gap columns in auto mode, grips on
 * repeated identities.
 */

import { serializeColumnWidthsState } from "../src/layout";
import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

const hierDv = (objects?: Record<string, unknown>) => ({
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
  metadata: { columns: [], objects: { general: { blankRowBeforeGroups: true }, ...objects } }
});

const key = (k: string) => new KeyboardEvent("keydown", { key: k, bubbles: true });

describe("keyboard navigation skips blank rows", () => {
  test("ArrowDown/ArrowUp walk past a blank row instead of dead-ending on it", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(hierDv()));
    const rows = Array.from(target.querySelectorAll("tbody tr")) as HTMLElement[];
    // France, Paris, blank, Italie, Rome
    expect(rows[2].classList.contains("em-blankrow")).toBe(true);
    rows[1].focus();
    expect(document.activeElement).toBe(rows[1]);
    rows[1].dispatchEvent(key("ArrowDown"));
    expect(document.activeElement).toBe(rows[3]); // Italie — blank skipped
    rows[3].dispatchEvent(key("ArrowUp"));
    expect(document.activeElement).toBe(rows[1]); // back to Paris
  });

  test("Home/End land on focusable rows only", () => {
    const { visual, target } = makeVisual();
    // A user spacer AFTER the last row would otherwise catch End.
    visual.update(
      makeUpdateOptions(
        hierDv({
          customRows: {
            state: JSON.stringify([{ id: "sp1", kind: "spacer", label: "", anchor: "Italie▸Rome" }])
          }
        })
      )
    );
    const rows = Array.from(target.querySelectorAll("tbody tr")) as HTMLElement[];
    const last = rows[rows.length - 1];
    expect(last.classList.contains("em-blankrow")).toBe(true);
    rows[0].focus();
    rows[0].dispatchEvent(key("End"));
    expect((document.activeElement as HTMLElement).querySelector("th")!.textContent).toBe("Rome");
  });
});

describe("uniform row heights (virtualization contract)", () => {
  test("blank rows get a forced height even with wrap off", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(hierDv()));
    const blank = target.querySelector("tr.em-blankrow") as HTMLElement;
    expect(blank.style.height).not.toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(blank.style.height).toBe(`${(visual as any).rowHeightPx}px`);
  });

  test("every row gets a forced height once virtualization is active", () => {
    const labels = Array.from({ length: 450 }, (_v, i) => `L${i}`);
    const dv = buildSimpleMatrixDV(labels, [{ name: "M", values: labels.map((_l, i) => i) }]);
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    const rows = Array.from(target.querySelectorAll("tbody tr[data-row-idx]")) as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.style.height !== "")).toBe(true);

    // Below the threshold (and wrap off) natural heights still rule.
    const { visual: v2, target: t2 } = makeVisual();
    v2.update(makeUpdateOptions(buildSimpleMatrixDV(["A"], [{ name: "M", values: [1] }])));
    expect((t2.querySelector("tbody tr") as HTMLElement).style.height).toBe("");
  });
});

describe("row style hardening", () => {
  test("bold applies to the row-header label cell, not only the value cells", () => {
    const state = JSON.stringify([{ key: "Revenue", bold: true }]);
    const dv = buildSimpleMatrixDV(["Revenue", "COGS"], [{ name: "M", values: [1, 2] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { rowStyles: { state } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    const rows = target.querySelectorAll("tbody tr");
    expect((rows[0].querySelector("th") as HTMLElement).style.fontWeight).toBe("700");
    expect((rows[1].querySelector("th") as HTMLElement).style.fontWeight).toBe("");
  });

  test("frame edges are painted with !important so HC structure toggles cannot erase them", () => {
    const state = JSON.stringify([
      { key: "Revenue", border: { mode: "topbottom", width: 2, color: "#141414" } }
    ]);
    const dv = buildSimpleMatrixDV(["Revenue"], [{ name: "M", values: [1] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { rowStyles: { state }, grid: { horizontal: false } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    const td = target.querySelector("tbody td") as HTMLElement;
    expect(td.style.getPropertyValue("border-bottom")).toContain("2px");
    expect(td.style.getPropertyPriority("border-bottom")).toBe("important");
    expect(td.style.getPropertyPriority("border-top")).toBe("important");
  });
});

describe("gap columns", () => {
  const gapDv = (objects: Record<string, unknown>) => ({
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
            { levelValues: [{ value: "2025" }], children: [{ levelSourceIndex: 0 }] },
            { levelValues: [{ value: "2026" }], children: [{ levelSourceIndex: 0 }] }
          ]
        }
      },
      valueSources: [{ displayName: "Actual", queryName: "M.A_0", roles: { values: true } }]
    },
    metadata: { columns: [], objects }
  });

  test("gapWidth is honoured in the default auto width mode", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(gapDv({ grid: { gapColumns: true, gapWidth: 20 } })));
    expect((target.querySelector("tbody td.em-gapcol") as HTMLElement).style.width).toBe("20px");
    expect((target.querySelector("thead th.em-gapcol") as HTMLElement).style.width).toBe("20px");
  });

  test("custom header background never paints the gap headers", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        gapDv({
          grid: { gapColumns: true },
          columnHeaders: { backColor: { solid: { color: "#DFF7EE" } } }
        })
      )
    );
    const ths = Array.from(target.querySelectorAll("thead th:not(.em-corner)")) as HTMLElement[];
    const gap = ths.find((t) => t.classList.contains("em-gapcol")) as HTMLElement;
    const painted = ths.filter((t) => !t.classList.contains("em-gapcol"));
    expect(gap.style.backgroundColor).toBe("");
    expect(painted.every((t) => t.style.backgroundColor !== "")).toBe(true);
  });
});

describe("column grips", () => {
  test("drag resizes the col, persists the width, and dblclick resets it", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    const dv = buildSimpleMatrixDV(["A"], [{ name: "Actual", values: [1] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = {
      columnWidths: {
        mode: "custom",
        uniformWidth: 100,
        state: serializeColumnWidthsState({ "·Actual": 120 })
      }
    };
    visual.update(makeUpdateOptions(dv));
    const grip = target.querySelector('.em-colgrip[data-col-key="·Actual"]') as HTMLElement;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 300 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 340 }));
    document.dispatchEvent(new MouseEvent("mouseup", {}));
    const cols = target.querySelectorAll("colgroup col");
    expect((cols[1] as HTMLElement).style.width).toBe("160px"); // 120 + 40
    expect(persisted).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse((persisted[0] as any).merge[0].properties.state);
    expect(state["·Actual"]).toBe(160);

    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(persisted).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state2 = JSON.parse((persisted[1] as any).merge[0].properties.state);
    expect(state2["·Actual"]).toBeUndefined();
  });

  const customDv = (state: Record<string, number> = {}) => {
    const dv = buildSimpleMatrixDV(["A"], [{ name: "Actual", values: [1] }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = {
      columnWidths: { mode: "custom", uniformWidth: 100, state: serializeColumnWidthsState(state) }
    };
    return dv;
  };

  // PR 1 review: a plain click pinned the uniform width as a custom override,
  // so raising the uniform width later left that column behind.
  test("a click without moving neither pins the width nor persists", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    visual.update(makeUpdateOptions(customDv()));
    const grip = target.querySelector('.em-colgrip[data-col-key="·Actual"]') as HTMLElement;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 300 }));
    document.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(persisted).toHaveLength(0);
  });

  // Audit A11Y-02-a: column widths could only be set with the mouse.
  describe("keyboard", () => {
    const key = (el: HTMLElement, type: string, k: string): void => {
      el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
    };
    const gripOf = (target: HTMLElement): HTMLElement =>
      target.querySelector('.em-colgrip[data-col-key="·Actual"]') as HTMLElement;

    test("grips are focusable separators named after their column", () => {
      const { visual, target } = makeVisual();
      visual.update(makeUpdateOptions(customDv({ "·Actual": 120 })));
      const grip = gripOf(target);
      expect(grip.getAttribute("tabindex")).toBe("0");
      expect(grip.getAttribute("role")).toBe("separator");
      expect(grip.getAttribute("aria-hidden")).toBeNull();
      expect(grip.getAttribute("aria-orientation")).toBe("vertical");
      expect(grip.getAttribute("aria-valuenow")).toBe("120");
      expect(grip.getAttribute("aria-label")).toContain("Actual");
    });

    test("arrows resize live, keyup persists once, focus survives the re-render", () => {
      const { visual, target } = makeVisual();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const host = (visual as any).host;
      const persisted: unknown[] = [];
      host.persistProperties = (c: unknown) => persisted.push(c);
      visual.update(makeUpdateOptions(customDv({ "·Actual": 120 })));
      const grip = gripOf(target);
      grip.focus();
      key(grip, "keydown", "ArrowRight");
      key(grip, "keydown", "ArrowRight");
      const cols = target.querySelectorAll("colgroup col");
      expect((cols[1] as HTMLElement).style.width).toBe("140px");
      expect(grip.getAttribute("aria-valuenow")).toBe("140");
      expect(persisted).toHaveLength(0);

      key(grip, "keyup", "ArrowRight");
      expect(persisted).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = JSON.parse((persisted[0] as any).merge[0].properties.state);
      expect(state["·Actual"]).toBe(140);

      // The host echoes the state back: thead is rebuilt, focus must follow.
      visual.update(makeUpdateOptions(customDv({ "·Actual": 140 })));
      expect(gripOf(target)).not.toBe(grip);
      expect(document.activeElement).toBe(gripOf(target));
    });

    test("left arrow shrinks, clamped at the minimum, without persisting a no-op", () => {
      const { visual, target } = makeVisual();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const host = (visual as any).host;
      const persisted: unknown[] = [];
      host.persistProperties = (c: unknown) => persisted.push(c);
      visual.update(makeUpdateOptions(customDv({ "·Actual": 24 })));
      const grip = gripOf(target);
      key(grip, "keydown", "ArrowLeft");
      key(grip, "keyup", "ArrowLeft");
      expect(grip.getAttribute("aria-valuenow")).toBe("24");
      expect(persisted).toHaveLength(0);
    });

    test("Delete resets the column, like a double-click", () => {
      const { visual, target } = makeVisual();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const host = (visual as any).host;
      const persisted: unknown[] = [];
      host.persistProperties = (c: unknown) => persisted.push(c);
      visual.update(makeUpdateOptions(customDv({ "·Actual": 120 })));
      key(gripOf(target), "keydown", "Delete");
      expect(persisted).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = JSON.parse((persisted[0] as any).merge[0].properties.state);
      expect(state["·Actual"]).toBeUndefined();
    });
  });
});

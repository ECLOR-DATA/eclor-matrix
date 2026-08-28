/**
 * Phase 12 — financial-communication framing (1.11.0.0): per-row / per-cell
 * frames, header top rule, per-measure font colour, bold rows.
 */

import { parseRowStylesState } from "../src/layout";
import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dv(objects?: Record<string, unknown>) {
  const d = buildSimpleMatrixDV(
    ["Revenue", "COGS"],
    [
      { name: "Actual", values: [100, 101] },
      { name: "Budget", values: [90, 91] }
    ]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (objects) (d as any).metadata.objects = objects;
  return d;
}

describe("border state parsing (pure)", () => {
  test("defaults, clamps and whitelists", () => {
    const raw = JSON.stringify([
      { key: "A", border: { mode: "box" } },
      {
        key: "B",
        border: { mode: "topbottom", style: "dashed", width: 9, color: "#FF7900", target: "·Actual" }
      },
      { key: "C", border: { mode: "diagonal", width: 2 } },
      { key: "D", bold: true },
      { key: "E", bold: "yes" },
      { key: "F", border: { mode: "top", style: "wavy", width: 0, color: "red" } }
    ]);
    expect(parseRowStylesState(raw)).toEqual([
      {
        key: "A",
        align: undefined,
        indent: undefined,
        bold: undefined,
        border: { mode: "box", style: "solid", width: 1, color: "#091612", target: "all" }
      },
      {
        key: "B",
        align: undefined,
        indent: undefined,
        bold: undefined,
        border: { mode: "topbottom", style: "dashed", width: 4, color: "#FF7900", target: "·Actual" }
      },
      { key: "D", align: undefined, indent: undefined, bold: true, border: undefined },
      {
        key: "F",
        align: undefined,
        indent: undefined,
        bold: undefined,
        border: { mode: "top", style: "solid", width: 1, color: "#091612", target: "all" }
      }
    ]);
  });
});

describe("header top rule", () => {
  test("class + colour/width variables", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dv({
          columnHeaders: { topRule: true, topColor: { solid: { color: "#FF7900" } }, topWidth: 3 }
        })
      )
    );
    expect(target.classList.contains("em-htop")).toBe(true);
    expect(target.style.getPropertyValue("--em-htop-c")).toBe("#FF7900");
    expect(target.style.getPropertyValue("--em-htop-w")).toBe("3px");
  });

  test("off by default; high contrast strips the custom colour", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv()));
    expect(target.classList.contains("em-htop")).toBe(false);

    const { visual: v2, target: t2 } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((v2 as any).host.colorPalette as any).isHighContrast = true;
    v2.update(
      makeUpdateOptions(
        dv({ columnHeaders: { topRule: true, topColor: { solid: { color: "#FF7900" } } } })
      )
    );
    expect(t2.classList.contains("em-htop")).toBe(true); // structure survives
    expect(t2.style.getPropertyValue("--em-htop-c")).toBe(""); // colour does not
  });
});

describe("per-measure font colour", () => {
  const colouredDv = () => {
    const d = buildSimpleMatrixDV(
      ["Revenue"],
      [
        {
          name: "Actual",
          values: [100],
          objects: { values: { fontColor: { solid: { color: "#FF7900" } } } }
        },
        { name: "Budget", values: [90] }
      ]
    );
    return d;
  };

  test("applies to the data cells AND the 1:1 header cell of that measure only", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(colouredDv()));
    const tds = target.querySelectorAll("tbody td");
    expect((tds[0] as HTMLElement).style.color).not.toBe("");
    expect((tds[1] as HTMLElement).style.color).toBe("");
    const ths = target.querySelectorAll("thead th:not(.em-corner)");
    expect((ths[0] as HTMLElement).style.color).not.toBe("");
    expect((ths[1] as HTMLElement).style.color).toBe("");
  });

  test("high contrast ignores the per-measure colour", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visual as any).host.colorPalette as any).isHighContrast = true;
    visual.update(makeUpdateOptions(colouredDv()));
    expect((target.querySelector("tbody td") as HTMLElement).style.color).toBe("");
  });
});

describe("row frames (financial-communication style)", () => {
  const styled = (border: Record<string, unknown>, bold = false) =>
    dv({ rowStyles: { state: JSON.stringify([{ key: "Revenue", bold, border }]) } });

  test("bold + full frame around the whole row: outer edges only", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(styled({ mode: "box", width: 2, color: "#091612" }, true)));
    const rows = target.querySelectorAll("tbody tr");
    const tr = rows[0] as HTMLTableRowElement;
    expect(tr.style.fontWeight).toBe("700");
    const cells = Array.from(tr.cells) as HTMLElement[];
    expect(cells).toHaveLength(3); // label + Actual + Budget
    for (const c of cells) {
      expect(c.style.borderTop).toContain("2px");
      expect(c.style.borderTop).toContain("solid");
      expect(c.style.borderBottom).not.toBe("");
    }
    expect(cells[0].style.borderLeft).not.toBe(""); // frame opens…
    expect(cells[2].style.borderRight).not.toBe(""); // …and closes
    expect(cells[1].style.borderLeft).toBe(""); // no inner verticals
    expect(cells[1].style.borderRight).toBe("");
    expect(cells[0].style.borderRight).toBe("");
    // Sibling row untouched.
    const other = Array.from((rows[1] as HTMLTableRowElement).cells) as HTMLElement[];
    expect(other.every((c) => c.style.borderTop === "" && c.style.borderBottom === "")).toBe(true);
  });

  test("label target frames the label cell alone; exact-cell target boxes one cell fully", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(styled({ mode: "box", target: "label" })));
    let cells = Array.from(
      (target.querySelector("tbody tr") as HTMLTableRowElement).cells
    ) as HTMLElement[];
    expect(cells[0].style.borderLeft).not.toBe("");
    expect(cells[0].style.borderRight).not.toBe(""); // its own closed frame
    expect(cells[1].style.borderTop).toBe("");

    const { visual: v2, target: t2 } = makeVisual();
    v2.update(makeUpdateOptions(styled({ mode: "box", target: "·Budget" })));
    cells = Array.from((t2.querySelector("tbody tr") as HTMLTableRowElement).cells) as HTMLElement[];
    expect(cells[0].style.borderTop).toBe("");
    expect(cells[1].style.borderTop).toBe("");
    for (const edge of ["borderTop", "borderBottom", "borderLeft", "borderRight"] as const) {
      expect(cells[2].style[edge]).not.toBe("");
    }
  });

  test("top/bottom rules follow the mode; dashed/dotted styles pass through", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(styled({ mode: "topbottom", style: "dashed" })));
    const cells = Array.from(
      (target.querySelector("tbody tr") as HTMLTableRowElement).cells
    ) as HTMLElement[];
    expect(cells[1].style.borderTop).toContain("dashed");
    expect(cells[1].style.borderBottom).toContain("dashed");
    expect(cells[0].style.borderLeft).toBe(""); // not a box
    expect(cells[2].style.borderRight).toBe("");

    const { visual: v2, target: t2 } = makeVisual();
    v2.update(makeUpdateOptions(styled({ mode: "top", style: "dotted" })));
    const c2 = Array.from((t2.querySelector("tbody tr") as HTMLTableRowElement).cells) as HTMLElement[];
    expect(c2[0].style.borderTop).toContain("dotted");
    expect(c2[0].style.borderBottom).toBe(""); // top only
  });

  test("high contrast repaints the frame with the HC foreground", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visual as any).host.colorPalette as any).isHighContrast = true;
    visual.update(makeUpdateOptions(styled({ mode: "top", color: "#FF7900" })));
    const cell = (target.querySelector("tbody tr") as HTMLTableRowElement).cells[0] as HTMLElement;
    expect(cell.style.borderTop).not.toBe(""); // structure kept
    const norm = cell.style.borderTop.replace(/\s+/g, "").toLowerCase();
    expect(norm.includes("#ff7900") || norm.includes("rgb(255,121,0)")).toBe(false);
  });
});

describe("edit panel — border controls round trip", () => {
  test("apply persists the full border definition and renders it immediately", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    visual.update(makeUpdateOptions(dv()));

    const rows = target.querySelectorAll("tbody tr[data-row-idx]");
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    // The target dropdown lists the whole row, the label cell and every column.
    const targetSel = target.querySelector("#em-rs-btarget") as HTMLSelectElement;
    const values = Array.from(targetSel.options).map((o) => o.value);
    expect(values).toEqual(["all", "label", "·Actual", "·Budget"]);

    (target.querySelector("#em-rs-border") as HTMLSelectElement).value = "box";
    targetSel.value = "·Actual";
    (target.querySelector("#em-rs-bstyle") as HTMLSelectElement).value = "dashed";
    (target.querySelector("#em-rs-bwidth") as HTMLInputElement).value = "3";
    (target.querySelector("#em-rs-bcolor") as HTMLInputElement).value = "#ff7900";
    (target.querySelector("#em-rs-bold") as HTMLInputElement).checked = true;
    (target.querySelector('[data-em-action="apply-rowstyle"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(persisted).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = JSON.parse((persisted[0] as any).merge[0].properties.state);
    expect(state).toEqual([
      {
        key: "Revenue",
        bold: true,
        border: { mode: "box", style: "dashed", width: 3, color: "#ff7900", target: "·Actual" }
      }
    ]);
    // Local re-render without waiting for the host echo:
    const tr = target.querySelector("tbody tr") as HTMLTableRowElement;
    expect(tr.style.fontWeight).toBe("700");
    expect((tr.cells[1] as HTMLElement).style.borderTop).toContain("dashed");
  });

  test("border mode 'none' with nothing else selected applies nothing", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host = (visual as any).host;
    const persisted: unknown[] = [];
    host.persistProperties = (c: unknown) => persisted.push(c);
    visual.update(makeUpdateOptions(dv()));
    const rows = target.querySelectorAll("tbody tr[data-row-idx]");
    rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (target.querySelector('[data-em-action="toggle-panel"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    (target.querySelector('[data-em-action="apply-rowstyle"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(persisted).toHaveLength(0);
  });
});

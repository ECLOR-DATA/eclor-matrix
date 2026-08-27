/**
 * Phase 9 — data comments integration + Grid & borders / hierarchy /
 * subtotal-style options (1.8.0.0).
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dvWithComments(objects?: Record<string, unknown>) {
  const dv = buildSimpleMatrixDV(
    ["Revenue", "COGS", "Margin"],
    [
      { name: "Actual", values: [120, -60, 60] },
      { name: "Budget", values: [100, -50, 50] },
      {
        name: "Commentaire",
        values: ["**Très bon** trimestre", null, "[#FF4D6D]à surveiller[/#]"],
        role: "comments"
      }
    ]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (objects) (dv as any).metadata.objects = objects;
  return dv;
}

describe("comments role", () => {
  test("comment measures never render as grid columns, markers appear", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithComments()));
    const headers = Array.from(target.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).not.toContain("Commentaire");
    const firstRowTds = target.querySelectorAll("tbody tr:first-child td");
    expect(firstRowTds).toHaveLength(2); // Actual + Budget only
    const marks = target.querySelectorAll(".em-cmark");
    expect(marks).toHaveLength(2); // Revenue + Margin, not COGS
    // Marker title carries the markup-stripped text.
    expect((marks[0] as HTMLElement).getAttribute("title")).toBe("Très bon trimestre");
  });

  test("inline column mode renders styled segments (DOM spans, no innerHTML)", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvWithComments({
          comments: { display: "column", columnTitle: "Notes" }
        })
      )
    );
    const headers = Array.from(target.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toContain("Notes");
    const cell = target.querySelector("tbody tr:first-child td.em-commentcell") as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell.textContent).toBe("Très bon trimestre");
    const boldSpan = cell.querySelector("span") as HTMLElement;
    expect(boldSpan.style.fontWeight).toBe("700");
    // Row 3: colour markup applied.
    const cells = target.querySelectorAll("tbody td.em-commentcell");
    const margin = cells[2] as HTMLElement;
    const colored = margin.querySelector("span") as HTMLElement;
    expect(colored.style.color).toBe("rgb(255, 77, 109)");
    // No markers in column mode.
    expect(target.querySelectorAll(".em-cmark")).toHaveLength(0);
  });

  test("card styling is the base; show=false removes everything", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvWithComments({
          comments: { display: "column", underline: true, fontColor: { solid: { color: "#123456" } } }
        })
      )
    );
    const span = target.querySelector("td.em-commentcell span") as HTMLElement;
    expect(span.style.textDecoration).toBe("underline");
    expect(span.style.color).toBe("rgb(18, 52, 86)"); // card colour (no markup override)

    visual.update(makeUpdateOptions(dvWithComments({ comments: { show: false } })));
    expect(target.querySelectorAll(".em-cmark")).toHaveLength(0);
    expect(target.querySelectorAll("td.em-commentcell")).toHaveLength(0);
  });

  test("comments panel opens via the 💬 button and lists commented rows", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithComments()));
    const btn = target.querySelector('[data-em-action="toggle-comments"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.click();
    const panel = target.querySelector(".em-commentspanel");
    expect(panel).not.toBeNull();
    const items = panel!.querySelectorAll(".em-citem");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".em-crow")!.textContent).toBe("Revenue");
    expect(items[0].querySelector(".em-ctext")!.textContent).toBe("Très bon trimestre");
    // Close.
    (panel!.querySelector('[data-em-action="close-comments"]') as HTMLElement).click();
    expect(target.querySelector(".em-commentspanel")).toBeNull();
  });

  test("no comments bound → no button, no marker", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A"], [{ name: "Actual", values: [1] }]);
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelector('[data-em-action="toggle-comments"]')).toBeNull();
    expect(target.querySelectorAll(".em-cmark")).toHaveLength(0);
  });
});

describe("grid & borders / hierarchy / subtotal-style options", () => {
  const dvPlain = (objects: Record<string, unknown>) => {
    const dv = buildSimpleMatrixDV(
      ["Revenue", "COGS"],
      [{ name: "Actual", values: [120, -60] }]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = objects;
    return dv;
  };

  test("grid toggles land as root classes and CSS variables", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvPlain({
          grid: {
            horizontal: false,
            vertical: true,
            verticalColor: { solid: { color: "#112233" } },
            verticalWidth: 2,
            outerBorder: true,
            outerWidth: 3,
            headerRule: false
          },
          general: { cellPaddingX: 14 }
        })
      )
    );
    expect(target.classList.contains("em-nohgrid")).toBe(true);
    expect(target.classList.contains("em-vgrid")).toBe(true);
    expect(target.classList.contains("em-outer")).toBe(true);
    expect(target.classList.contains("em-noheadrule")).toBe(true);
    expect(target.style.getPropertyValue("--em-vgrid-c")).toBe("#112233");
    expect(target.style.getPropertyValue("--em-vgrid-w")).toBe("2px");
    expect(target.style.getPropertyValue("--em-outer-w")).toBe("3px");
    expect(target.style.getPropertyValue("--em-pad-x")).toBe("14px");
  });

  test("defaults leave the theme untouched (no classes, no vars)", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvPlain({})));
    for (const cls of ["em-nohgrid", "em-vgrid", "em-outer", "em-noheadrule", "em-stnobold", "em-nochev"]) {
      expect(target.classList.contains(cls)).toBe(false);
    }
    expect(target.style.getPropertyValue("--em-grid")).toBe("");
    expect(target.style.getPropertyValue("--em-pad-x")).toBe("");
  });

  test("thicker horizontal rule widens the virtualization row estimate", () => {
    const { visual } = makeVisual();
    visual.update(makeUpdateOptions(dvPlain({ grid: { horizontalWidth: 3 } })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withThick = (visual as any).rowHeightPx as number;
    const { visual: v2 } = makeVisual();
    v2.update(makeUpdateOptions(dvPlain({})));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (v2 as any).rowHeightPx as number;
    expect(withThick).toBe(base + 2);
  });

  test("subtotal style + hierarchy options", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvPlain({
          subtotalsStyle: {
            backColor: { solid: { color: "#091612" } },
            fontColor: { solid: { color: "#FFFFFF" } },
            bold: false
          },
          rowHeaders: {
            showChevrons: false,
            groupBold: true,
            groupBackColor: { solid: { color: "#DFF7EE" } }
          }
        })
      )
    );
    expect(target.style.getPropertyValue("--em-total-bg")).toBe("#091612");
    expect(target.style.getPropertyValue("--em-total-fg")).toBe("#FFFFFF");
    expect(target.classList.contains("em-stnobold")).toBe(true);
    expect(target.classList.contains("em-nochev")).toBe(true);
    expect(target.classList.contains("em-groupbold")).toBe(true);
    expect(target.classList.contains("em-groupbg")).toBe(true);
    expect(target.style.getPropertyValue("--em-group-bg")).toBe("#DFF7EE");
  });
});

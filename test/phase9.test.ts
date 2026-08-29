/**
 * Phase 9 — data comments integration + Grid & borders / hierarchy /
 * subtotal-style options (1.8.0.0).
 */

import * as fs from "fs";
import * as path from "path";
import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

/** Column tree: 2 year groups × (Actual, Note[comments]) — 4 leaves. */
function buildTreeDVWithComments() {
  const measureLeaves = () => [{ levelSourceIndex: 0 }, { levelSourceIndex: 1 }];
  return {
    matrix: {
      rows: {
        root: {
          children: [
            {
              levelValues: [{ value: "Revenue" }],
              identity: { key: "r0" },
              values: {
                0: { value: 100 },
                1: { value: "note 2025" },
                2: { value: 130 },
                3: { value: "note 2026" }
              }
            },
            {
              levelValues: [{ value: "COGS" }],
              identity: { key: "r1" },
              values: {
                0: { value: -60 },
                1: { value: "idem" },
                2: { value: -70 },
                3: { value: "idem" }
              }
            }
          ]
        },
        levels: [{ sources: [{ displayName: "Ligne", roles: { rows: true } }] }]
      },
      columns: {
        root: {
          children: [
            { levelValues: [{ value: "2025" }], children: measureLeaves() },
            { levelValues: [{ value: "2026" }], children: measureLeaves() }
          ]
        }
      },
      valueSources: [
        { displayName: "Actual", queryName: "M.Actual_0", roles: { values: true } },
        { displayName: "Note", queryName: "M.Note_1", roles: { comments: true } }
      ]
    },
    metadata: { columns: [] }
  };
}

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

  test("column hierarchy survives a comments binding (pruned tree, no flat fallback)", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(buildTreeDVWithComments()));
    const headerTrs = target.querySelectorAll("thead tr");
    expect(headerTrs).toHaveLength(2); // year row + measure row — NOT flattened
    const yearRow = Array.from(headerTrs[0].querySelectorAll("th:not(.em-corner)")).map(
      (th) => th.textContent
    );
    expect(yearRow).toEqual(["2025", "2026"]);
    const measureRow = Array.from(headerTrs[1].querySelectorAll("th")).map((th) => th.textContent);
    expect(measureRow).toEqual(["Actual", "Actual"]); // Note pruned from both groups
    // Grid cells: 2 rendered leaves per row, comment cellKeys untouched.
    expect(target.querySelectorAll("tbody tr:first-child td")).toHaveLength(2);
    // Per-group distinct texts keep their group badge…
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (visual as any).lastValidRenderInput.parsed;
    expect(parsed.rowComments[0].map((c: { pathLabel: string }) => c.pathLabel)).toEqual([
      "2025",
      "2026"
    ]);
    // …while a text repeated across groups is row-level (no badge).
    expect(parsed.rowComments[1]).toHaveLength(1);
    expect(parsed.rowComments[1][0].pathLabel).toBe("");
  });

  test("comments + calculated columns coexist; calc over a comment name stays blank", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvWithComments({
          comments: { display: "column" },
          calculatedColumns: {
            calc1Show: true,
            calc1Name: "Δ",
            calc1Formula: "[Actual] - [Budget]",
            calc1Format: "number",
            calc2Show: true,
            calc2Name: "SurNote",
            calc2Formula: "[Commentaire] * 2",
            calc2Format: "number"
          }
        })
      )
    );
    const headers = Array.from(target.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toContain("Δ");
    expect(headers[headers.length - 1]).toBe("Comments"); // comment column stays last
    const tds = target.querySelectorAll("tbody tr:first-child td");
    // Actual, Budget, Δ, SurNote, comment column
    expect(tds).toHaveLength(5);
    expect((tds[2] as HTMLElement).textContent).toBe("+20");
    expect((tds[3] as HTMLElement).textContent).toBe(""); // string ref → blank, no crash
    expect((tds[4] as HTMLElement).classList.contains("em-commentcell")).toBe(true);
  });

  test("comments align through virtualization (window + spacer colSpan)", () => {
    const labels = Array.from({ length: 600 }, (_v, i) => `L${i}`);
    const dv = buildSimpleMatrixDV(labels, [
      { name: "Actual", values: labels.map((_l, i) => i) },
      { name: "Note", values: labels.map((_l, i) => (i === 450 ? "ici" : null)), role: "comments" }
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { comments: { display: "column" } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = visual as any;
    v.scrollEl.scrollTop = 450 * v.rowHeightPx;
    v.handleScroll();
    const row450 = target.querySelector('tr[data-row-idx="450"]') as HTMLElement;
    expect(row450).not.toBeNull();
    expect(row450.querySelector(".em-commentclamp")!.textContent).toBe("ici");
    const spacer = target.querySelector("tr.em-spacer td") as HTMLTableCellElement;
    expect(spacer.colSpan).toBe(3); // row header + Actual + comment column
  });

  test("no comments bound → no button, no marker", () => {
    const { visual, target } = makeVisual();
    const dv = buildSimpleMatrixDV(["A"], [{ name: "Actual", values: [1] }]);
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelector('[data-em-action="toggle-comments"]')).toBeNull();
    expect(target.querySelectorAll(".em-cmark")).toHaveLength(0);
  });
});

describe("capabilities.json shape guard (load-bearing blocks)", () => {
  const cap = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "capabilities.json"), "utf8")
  );

  test("single matrix mapping; values.select = values, tooltips, comments", () => {
    expect(cap.dataViewMappings).toHaveLength(1);
    const select = cap.dataViewMappings[0].matrix.values.select.map(
      (s: { for: { in: string } }) => s.for.in
    );
    expect(select).toEqual(["values", "tooltips", "comments"]);
  });

  test("all six subtotal switch mappings intact and pointing at subTotals", () => {
    const st = cap.subtotals.matrix;
    const keys = Object.keys(st).sort();
    expect(keys).toEqual([
      "columnSubtotals",
      "columnSubtotalsPerLevel",
      "levelSubtotalEnabled",
      "rowSubtotals",
      "rowSubtotalsPerLevel",
      "rowSubtotalsType"
    ]);
    for (const k of keys) {
      expect(st[k].propertyIdentifier.objectName).toBe("subTotals");
      expect(cap.objects.subTotals.properties[st[k].propertyIdentifier.propertyName]).toBeDefined();
    }
  });

  test("no privileges (certification) and comments role declared as Measure", () => {
    expect(cap.privileges).toEqual([]);
    const role = cap.dataRoles.find((r: { name: string }) => r.name === "comments");
    expect(role.kind).toBe("Measure");
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
    // Row headers share the horizontal padding base (option, not 8px).
    const rowTh = target.querySelector("tbody th.em-rowheader") as HTMLElement;
    expect(rowTh.style.paddingLeft).toBe("14px");
  });

  test("horizontal colour lands on the dedicated token, not the shared --em-grid", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(dvPlain({ grid: { horizontalColor: { solid: { color: "#FF0000" } } } }))
    );
    expect(target.style.getPropertyValue("--em-hgrid-c")).toBe("#FF0000");
    expect(target.style.getPropertyValue("--em-grid")).toBe("");
  });

  test("out-of-range persisted numerics are clamped", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvPlain({ grid: { horizontalWidth: 99, verticalWidth: 0, vertical: true }, general: { cellPaddingX: 10000 } })
      )
    );
    expect(target.style.getPropertyValue("--em-grid-w")).toBe("4px");
    expect(target.style.getPropertyValue("--em-vgrid-w")).toBe("1px");
    expect(target.style.getPropertyValue("--em-pad-x")).toBe("40px");
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

  test("comments panel clicks never clear the row selection", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithComments()));
    (target.querySelector('[data-em-action="toggle-comments"]') as HTMLElement).click();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = visual as any;
    v.selectedRowKeys.add("k-fake");
    (target.querySelector(".em-commentspanel .em-ctext") as HTMLElement).click();
    expect(v.selectedRowKeys.size).toBe(1); // untouched
  });

  test("show=false also keeps comments out of tooltips; panel state resets", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvWithComments()));
    (target.querySelector('[data-em-action="toggle-comments"]') as HTMLElement).click();
    expect(target.querySelector(".em-commentspanel")).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = visual as any;
    let items = v.buildTooltipItems(v.lastValidRenderInput.parsed, 0, 0);
    expect(items.some((i: { displayName: string }) => i.displayName === "Commentaire")).toBe(true);

    visual.update(makeUpdateOptions(dvWithComments({ comments: { show: false } })));
    expect(target.querySelector(".em-commentspanel")).toBeNull(); // stale open state reset
    items = v.buildTooltipItems(v.lastValidRenderInput.parsed, 0, 0);
    expect(items.some((i: { displayName: string }) => i.displayName === "Commentaire")).toBe(false);
  });

  test("panel truncation is announced, never silent", () => {
    const labels = Array.from({ length: 260 }, (_v, i) => `Ligne ${i}`);
    const dv = buildSimpleMatrixDV(labels, [
      { name: "Actual", values: labels.map((_l, i) => i) },
      { name: "Note", values: labels.map((_l, i) => `c${i}`), role: "comments" }
    ]);
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    (target.querySelector('[data-em-action="toggle-comments"]') as HTMLElement).click();
    const panel = target.querySelector(".em-commentspanel")!;
    expect(panel.querySelectorAll(".em-citem")).toHaveLength(200);
    const hint = panel.querySelector(".em-panelhint") as HTMLElement;
    expect(hint.textContent).toContain("+60");
  });

  test("dual-role (values + comments) measure renders markup, not raw asterisks", () => {
    const dv = buildSimpleMatrixDV(
      ["Revenue"],
      [
        { name: "Actual", values: [120] },
        { name: "Note", values: ["**ok**"] }
      ]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).matrix.valueSources[1].roles = { values: true, comments: true };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    const cell = target.querySelectorAll("tbody tr:first-child td")[1] as HTMLElement;
    expect(cell.textContent).toBe("ok");
    expect((cell.querySelector("span") as HTMLElement).style.fontWeight).toBe("700");
    expect(target.querySelectorAll(".em-cmark")).toHaveLength(0); // not comments-only
  });

  test("high contrast: no custom colours anywhere on the new surfaces", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visual as any).host.colorPalette as any).isHighContrast = true;
    visual.update(
      makeUpdateOptions(
        dvWithComments({
          comments: { display: "column", markerColor: { solid: { color: "#FF0000" } }, fontColor: { solid: { color: "#FF0000" } } },
          grid: { horizontalColor: { solid: { color: "#FF0000" } } },
          subtotalsStyle: { backColor: { solid: { color: "#FF0000" } } },
          rowHeaders: { groupBackColor: { solid: { color: "#FF0000" } } }
        })
      )
    );
    expect(target.style.getPropertyValue("--em-cmark")).toBe("");
    expect(target.style.getPropertyValue("--em-hgrid-c")).toBe("");
    expect(target.style.getPropertyValue("--em-total-bg")).toBe("");
    expect(target.classList.contains("em-groupbg")).toBe(false);
    const span = target.querySelector("td.em-commentcell span") as HTMLElement;
    expect(span.style.color).toBe(""); // no inline nor card colour in HC
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

/**
 * Phase 10 — IBCS table templates (T01-T04) + full colour options (1.9.0.0).
 */

import { buildSimpleMatrixDV, makeUpdateOptions, makeVisual } from "./_harness";

function dvScenarios(objects?: Record<string, unknown>) {
  // Bound out of IBCS order on purpose: the template must reorder AC·PY·PL.
  const dv = buildSimpleMatrixDV(
    ["Chiffre d'affaires", "Coûts", "Marge"],
    [
      { name: "Budget", values: [100, -60, 40], format: "#,0" },
      { name: "Réel", values: [120, -70, 50], format: "#,0" },
      { name: "N-1", values: [110, -65, 45], format: "#,0" }
    ]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (objects) (dv as any).metadata.objects = objects;
  return dv;
}

const headerTexts = (target: HTMLElement): (string | null)[] =>
  Array.from(target.querySelectorAll("thead th:not(.em-corner)")).map((th) => th.textContent);

describe("IBCS table templates", () => {
  test("T01: AC·PY·PL order + ΔPY, ΔPY %, ΔPL, ΔPL % as figures", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvScenarios({ ibcs: { template: "t01" } })));
    expect(headerTexts(target)).toEqual([
      "Réel",
      "N-1",
      "Budget",
      "ΔPY",
      "ΔPY %",
      "ΔPL",
      "ΔPL %"
    ]);
    const tds = Array.from(
      target.querySelectorAll("tbody tr:first-child td")
    ) as HTMLElement[];
    expect(tds).toHaveLength(7);
    expect(tds[3].textContent).toBe("+10"); // 120 - 110
    expect(tds[4].textContent).toBe("+9.1%"); // 10 / |110|
    expect(tds[5].textContent).toBe("+20"); // 120 - 100
    expect(tds[6].textContent).toBe("+20.0%");
    // Figures, not bars.
    expect(target.querySelectorAll(".em-bar, .em-pindot")).toHaveLength(0);
    // Template implies the IBCS header semantics without the toggle.
    const acTh = Array.from(target.querySelectorAll("thead th")).find(
      (th) => th.textContent === "Réel"
    );
    expect(acTh!.classList.contains("ibcs-ac")).toBe(true);
  });

  test("Δ% keeps a meaningful sign on cost rows (ABS base)", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvScenarios({ ibcs: { template: "t01" } })));
    const costRow = Array.from(
      target.querySelectorAll("tbody tr")[1].querySelectorAll("td")
    ) as HTMLElement[];
    expect(costRow[3].textContent).toBe("-5"); // -70 - -65
    expect(costRow[4].textContent).toBe("-7.7%"); // -5 / |-65| — worse, negative
  });

  test("T02: Δ as bars, Δ% as pins", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvScenarios({ ibcs: { template: "t02" } })));
    const firstRow = target.querySelector("tbody tr")!;
    expect(firstRow.querySelectorAll(".em-bar-pos, .em-bar-neg")).toHaveLength(2); // ΔPY, ΔPL
    expect(firstRow.querySelectorAll(".em-pindot")).toHaveLength(2); // the two Δ%
    const pin = firstRow.querySelector(".em-pin-pos .em-pindot") as HTMLElement;
    expect(pin.style.left).not.toBe(""); // positioned on the track
  });

  test("T04: waterfall bars cascade, subtotal re-anchors at zero", () => {
    const dv = buildSimpleMatrixDV(
      ["CA", "Coûts", "Total"],
      [
        { name: "Réel", values: [100, -30, 70] },
        { name: "Budget", values: [80, -20, 60] }
      ]
    );
    // Mark the third row as an engine subtotal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).matrix.rows.root.children[2].isSubtotal = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { ibcs: { template: "t04" } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    const rows = target.querySelectorAll("tbody tr");
    const wf = (tr: Element): HTMLElement => tr.querySelector(".em-bar-wf") as HTMLElement;
    // ΔPL values: +20, -10, +10 → starts 0, 20, 0(subtotal); domain 20.
    expect(wf(rows[0]).style.left).toBe("50%"); // [0, 20] → 50..100
    expect(wf(rows[0]).style.width).toBe("50%");
    expect(wf(rows[1]).style.left).toBe("75%"); // [20, 10] → lo 10
    expect(wf(rows[1]).style.width).toBe("25%");
    expect(wf(rows[2]).style.left).toBe("50%"); // subtotal from zero: [0, 10]
    expect(wf(rows[2]).style.width).toBe("25%");
    expect(wf(rows[1]).classList.contains("em-bar-wf-neg")).toBe(true);
  });

  test("no AC detected → template silently inert", () => {
    const dv = buildSimpleMatrixDV(
      ["A"],
      [
        { name: "Montant", values: [10] },
        { name: "Quantité", values: [3] }
      ]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv as any).metadata.objects = { ibcs: { template: "t02" } };
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dv));
    expect(headerTexts(target)).toEqual(["Montant", "Quantité"]);
    expect(target.querySelectorAll("[data-calccol]")).toHaveLength(0);
  });

  test("user calculated columns come after the template columns", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvScenarios({
          ibcs: { template: "t01" },
          calculatedColumns: {
            calc1Show: true,
            calc1Name: "Perso",
            calc1Formula: "[Réel] * 2",
            calc1Format: "number"
          }
        })
      )
    );
    const heads = headerTexts(target);
    expect(heads[heads.length - 1]).toBe("Perso");
    expect(heads).toContain("ΔPL %");
  });
});

describe("colour options for every visible element", () => {
  test("IBCS good/bad/PY + general font/back/accent + banding + row-header bg", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        dvScenarios({
          ibcs: {
            template: "t02",
            goodColor: { solid: { color: "#0000FF" } },
            badColor: { solid: { color: "#FF8800" } },
            pyColor: { solid: { color: "#777777" } }
          },
          general: {
            fontColor: { solid: { color: "#101010" } },
            backColor: { solid: { color: "#FFFDF5" } },
            accentColor: { solid: { color: "#AA00AA" } },
            banded: false,
            bandColor: { solid: { color: "#EEEEEE" } }
          },
          rowHeaders: { backColor: { solid: { color: "#F0FFF8" } } }
        })
      )
    );
    const s = target.style;
    expect(s.getPropertyValue("--em-good")).toBe("#0000FF");
    expect(s.getPropertyValue("--em-bad")).toBe("#FF8800");
    expect(s.getPropertyValue("--em-py")).toBe("#777777");
    expect(s.getPropertyValue("--em-fg")).toBe("#101010");
    expect(s.getPropertyValue("--em-bg")).toBe("#FFFDF5");
    expect(s.getPropertyValue("--em-accent")).toBe("#AA00AA");
    expect(s.getPropertyValue("--em-rowh-bg")).toBe("#F0FFF8");
    expect(target.classList.contains("em-nobands")).toBe(true);
  });

  test("defaults leave every colour on the theme (no vars set)", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(dvScenarios()));
    for (const v of ["--em-good", "--em-bad", "--em-py", "--em-fg", "--em-bg", "--em-accent", "--em-rowh-bg", "--em-band-bg"]) {
      expect(target.style.getPropertyValue(v)).toBe("");
    }
    expect(target.classList.contains("em-nobands")).toBe(false);
  });

  test("high contrast wins over every custom colour", () => {
    const { visual, target } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visual as any).host.colorPalette as any).isHighContrast = true;
    visual.update(
      makeUpdateOptions(
        dvScenarios({
          ibcs: { template: "t02", goodColor: { solid: { color: "#0000FF" } } },
          general: { fontColor: { solid: { color: "#101010" } } }
        })
      )
    );
    expect(target.style.getPropertyValue("--em-good")).toBe("");
    expect(target.style.getPropertyValue("--em-fg")).toBe("#000000"); // HC palette, not the option
    // Template bars/pins forced to HC foreground inline.
    const bar = target.querySelector(".em-bar") as HTMLElement;
    expect(bar.style.backgroundColor).not.toBe("");
  });
});

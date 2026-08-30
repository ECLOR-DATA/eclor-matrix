/**
 * Hardening suite — adversarial edge-cases in the spirit of the AppSource
 * certification bar: hostile dataViews, hostile values, hostile jsonFilters,
 * repeated / out-of-order updates, keyboard edge keys, render caps and
 * post-destroy behaviour must NEVER crash the visual.
 *
 * Constraint: this file is additive only — no src/ or existing test/ file is
 * modified. Any test revealing a real src/ bug is kept but `test.skip`-ped
 * with a `// BUG-FINDING:` note (see qa-hardening-r1.md report).
 */

import { makeVisual, makeUpdateOptions, oneLevelFixture, twoLevelFixture, buildSlicerDV } from "./_harness";

function click(el: Element | null): void {
  if (!el) throw new Error("click target not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function key(el: Element | null, k: string, mods: Partial<KeyboardEventInit> = {}): void {
  if (!el) throw new Error("keydown target not found");
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...mods }));
}

function labels(target: HTMLElement): (string | null)[] {
  return Array.from(target.querySelectorAll(".es-item .es-label")).map((e) => e.textContent);
}

// ------------------------------------------------------------------ malformed dataViews

describe("hardening: malformed dataViews", () => {
  test("category column without a values array renders the empty-results state, no crash", () => {
    const { visual, target } = makeVisual();
    const dv = oneLevelFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dv.categorical.categories[0] as any).values = undefined;
    expect(() => visual.update(makeUpdateOptions(dv))).not.toThrow();
    expect(target.querySelector(".es-no-results")).not.toBeNull();
    expect(target.querySelectorAll(".es-item")).toHaveLength(0);
  });

  test("unequal level lengths (level 1 shorter) pad with (Blank), no crash", () => {
    const { visual, target } = makeVisual();
    const dv = buildSlicerDV([
      { name: "Country", values: ["France", "France", "Germany", "Germany"] },
      { name: "Product", values: ["Alpha", "Beta"] } // 2 rows short
    ]);
    expect(() => visual.update(makeUpdateOptions(dv))).not.toThrow();
    // Root level still shows both countries; missing leaf cells became null.
    expect(labels(target)).toEqual(["France", "Germany"]);
    click(target.querySelectorAll("[data-exp-key]")[1]); // expand Germany
    expect(labels(target)).toContain("(Blank)");
  });

  test("category source without roles is ignored → user-cleared branch, no crash", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const dv = {
      categorical: {
        categories: [{ source: { displayName: "X", queryName: "T.X" }, values: ["a", "b"] }],
        values: []
      },
      metadata: {}
    };
    expect(() => visual.update(makeUpdateOptions(dv))).not.toThrow();
    // No `field` role bound = user-cleared → visual wiped for the landing page.
    expect(target.childElementCount).toBe(0);
  });

  test("measure column full of strings / NaN / null never crashes; items still render", () => {
    const { visual, target } = makeVisual();
    const dv = buildSlicerDV(
      [{ name: "P", values: ["a", "b", "c", "d"] }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: "M", values: ["abc", NaN, null, Infinity] as any }
    );
    expect(() => visual.update(makeUpdateOptions(dv))).not.toThrow();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    // Hostile measure cells are coerced to null — no "NaN" ever reaches the DOM.
    expect(target.textContent).not.toContain("NaN");
  });

  // BUG-1 (qa-hardening-r1): fixed — buildTree now lazy-inits node values,
  // so an all-non-numeric measure leaves value=null and counts take over.
  test("nodes with only non-numeric measure cells fall back to counts, not a fake 0", () => {
    const { visual, target } = makeVisual();
    const dv = buildSlicerDV(
      [{ name: "P", values: ["a", "b"] }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: "M", values: ["abc", NaN] as any }
    );
    visual.update(makeUpdateOptions(dv));
    const counts = Array.from(target.querySelectorAll(".es-count")).map((e) => e.textContent);
    expect(counts).toEqual(["1", "1"]);
  });

  test("NaN viewport no-ops and keeps the previous frame; missing viewport is survived", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    expect(() => visual.update(makeUpdateOptions(oneLevelFixture(), NaN, NaN))).not.toThrow();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    // Viewport object missing entirely: swallowed by the update() try/catch
    // (renderingFailed), previous frame stays up.
    const opts = makeUpdateOptions(oneLevelFixture());
    delete opts.viewport;
    expect(() => visual.update(opts)).not.toThrow();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
  });

  test("dataView without metadata does not throw", () => {
    const { visual } = makeVisual();
    const dv = oneLevelFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (dv as any).metadata;
    expect(() => visual.update(makeUpdateOptions(dv))).not.toThrow();
  });
});

// ------------------------------------------------------------------ hostile values

describe("hardening: hostile values", () => {
  test("500-character label renders verbatim as text", () => {
    const { visual, target } = makeVisual();
    const long = "x".repeat(500);
    visual.update(makeUpdateOptions(oneLevelFixture([long, "short"])));
    expect(labels(target)).toContain(long);
  });

  test("emoji and RTL labels render verbatim and stay clickable", () => {
    const { visual, target, host } = makeVisual();
    const rtl = "مرحبا بالعالم";
    visual.update(makeUpdateOptions(oneLevelFixture(["🚀🔥💯", rtl, "ok"])));
    expect(labels(target)).toEqual(["🚀🔥💯", rtl, "ok"]);
    click(target.querySelectorAll(".es-item")[1]);
    expect((host.applied[0].filter as { values: string[] }).values).toEqual([rtl]);
  });

  test("numeric category values keep their type through the filter (1, not \"1\")", () => {
    const { visual, target, host } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visual.update(makeUpdateOptions(buildSlicerDV([{ name: "Year", values: [2024, 2025, 2026] as any }])));
    expect(labels(target)).toEqual(["2024", "2025", "2026"]);
    click(target.querySelectorAll(".es-item")[0]);
    const values = (host.applied[0].filter as { values: unknown[] }).values;
    expect(values).toEqual([2024]);
    expect(typeof values[0]).toBe("number");
  });

  test("boolean category values render and filter with boolean type", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(buildSlicerDV([{ name: "Flag", values: [true, false] }])));
    expect(labels(target)).toEqual(["true", "false"]);
    click(target.querySelectorAll(".es-item")[1]);
    const values = (host.applied[0].filter as { values: unknown[] }).values;
    expect(values).toEqual([false]); // must survive the null-filter (falsy trap)
  });

  test("Date category values label as ISO date and filter as ISO string (Tuple-safe)", () => {
    const { visual, target, host } = makeVisual();
    const d1 = new Date(Date.UTC(2026, 0, 15));
    const d2 = new Date(Date.UTC(2026, 5, 1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visual.update(makeUpdateOptions(buildSlicerDV([{ name: "Day", values: [d1, d2] as any }])));
    expect(labels(target)).toEqual(["2026-01-15", "2026-06-01"]);
    click(target.querySelectorAll(".es-item")[0]);
    expect((host.applied[0].filter as { values: unknown[] }).values).toEqual([d1.toISOString()]);
  });

  test("null category value renders (Blank) and routes to a TupleFilter (Basic forbids null)", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(["A", null as unknown as string, "B"])));
    expect(labels(target)).toContain("(Blank)");
    const blank = Array.from(target.querySelectorAll<HTMLElement>(".es-item")).find(
      (e) => e.querySelector(".es-label")?.textContent === "(Blank)"
    );
    click(blank ?? null);
    const f = host.applied[0].filter as { filterType: number; values: { value: unknown }[][] };
    expect(f.filterType).toBe(6);
    expect(f.values).toEqual([[{ value: null }]]);
  });

  test("massive duplicates collapse to one item with the aggregated count", () => {
    const { visual, target } = makeVisual();
    const vals = new Array(1000).fill("Same");
    visual.update(makeUpdateOptions(buildSlicerDV([{ name: "P", values: vals }])));
    const items = target.querySelectorAll(".es-item");
    expect(items).toHaveLength(1);
    expect(items[0].querySelector(".es-count")?.textContent).toBe("1,000");
  });
});

// ------------------------------------------------------------------ repeated updates

describe("hardening: repeated / shifting updates", () => {
  test("same dataView applied twice is idempotent", () => {
    const { visual, target } = makeVisual();
    const dv = oneLevelFixture();
    visual.update(makeUpdateOptions(dv));
    visual.update(makeUpdateOptions(dv));
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    expect(target.querySelectorAll(".es-header")).toHaveLength(1);
    expect(target.querySelectorAll(".es-footer")).toHaveLength(1);
  });

  test("selection on a key that disappears from the next dataView does not crash", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelectorAll(".es-item")[0]); // select "Alpha"
    expect(host.applied).toHaveLength(1);
    // New data no longer contains Alpha (jsonFilters undefined = host silent).
    visual.update(makeUpdateOptions(oneLevelFixture(["X", "Y", "Z"])));
    expect(target.querySelectorAll(".es-item")).toHaveLength(3);
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(0);
    // The visual must remain interactive on the new population.
    click(target.querySelectorAll(".es-item")[0]);
    expect(host.applied.length).toBeGreaterThanOrEqual(2);
  });

  test("alternating null / valid dataViews replays cleanly every time", () => {
    const { visual, target } = makeVisual();
    for (let i = 0; i < 3; i++) {
      visual.update(makeUpdateOptions(oneLevelFixture()));
      expect(target.querySelectorAll(".es-item")).toHaveLength(4);
      visual.update(makeUpdateOptions(null));
      expect(target.querySelectorAll(".es-item")).toHaveLength(4); // replayed frame
    }
  });
});

// ------------------------------------------------------------------ hostile jsonFilters

describe("hardening: hostile jsonFilters", () => {
  test("foreign filter type (advanced, filterType 0) is ignored, no crash", () => {
    const { visual, target } = makeVisual();
    const advanced = {
      $schema: "http://powerbi.com/product/schema#advanced",
      filterType: 0,
      logicalOperator: "And",
      conditions: [{ operator: "Contains", value: "Al" }]
    };
    expect(() => visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, [advanced]))).not.toThrow();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(0);
  });

  test("tuple filter with short / non-object / empty cells: valid cells restore, junk is dropped", () => {
    const { visual, target } = makeVisual();
    const hostile = {
      $schema: "http://powerbi.com/product/schema#tuple",
      filterType: 6,
      operator: "In",
      values: [
        [{ value: "France" }], // 1-cell tuple on a 2-level tree → matches the France branch key
        ["rawstring"], // cell is not an object → coerced to null, unknown key dropped
        [{}] // cell without .value → undefined, unknown key dropped
      ]
    };
    expect(() => visual.update(makeUpdateOptions(twoLevelFixture(), 300, 400, [hostile]))).not.toThrow();
    const on = Array.from(target.querySelectorAll(".es-item.es-on .es-label")).map((e) => e.textContent);
    expect(on).toEqual(["France"]);
  });

  test("filters with non-array values / null / garbage shapes never crash or select", () => {
    const { visual, target } = makeVisual();
    const garbage = [
      { filterType: 1, values: { not: "an array" } },
      { filterType: 6, values: "nope" },
      { filterType: 6, values: [42] }, // tuple entry is not an array
      null,
      "a string filter",
      12345
    ];
    for (const g of garbage) {
      expect(() => visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, [g]))).not.toThrow();
      expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(0);
    }
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
  });
});

// ------------------------------------------------------------------ keyboard edges

describe("hardening: keyboard edge keys", () => {
  test("Home / End jump to first / last item", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const items = target.querySelectorAll<HTMLElement>(".es-item");
    items[1].focus();
    key(items[1], "End");
    expect(document.activeElement?.textContent).toContain("Delta");
    key(document.activeElement, "Home");
    expect(document.activeElement?.textContent).toContain("Alpha");
  });

  test("ArrowRight on a leaf (flat list) is a no-op — no expansion, no crash", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const items = target.querySelectorAll<HTMLElement>(".es-item");
    items[0].focus();
    key(items[0], "ArrowRight");
    key(items[0], "ArrowLeft"); // not expanded either — also a no-op
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    expect(host.applied).toHaveLength(0);
  });

  test("Ctrl+A in single mode is a no-op (no select-all filter)", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(undefined, { selection: { selectionMode: "single" } })));
    const items = target.querySelectorAll<HTMLElement>(".es-item");
    items[0].focus();
    key(items[0], "a", { ctrlKey: true });
    expect(host.applied).toHaveLength(0);
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(0);
    // Sanity: the same chord in multi mode DOES select all.
    const multi = makeVisual();
    multi.visual.update(makeUpdateOptions(oneLevelFixture()));
    const mItems = multi.target.querySelectorAll<HTMLElement>(".es-item");
    mItems[0].focus();
    key(mItems[0], "a", { ctrlKey: true });
    expect((multi.host.applied[0].filter as { values: string[] }).values).toHaveLength(4);
  });

  test("ArrowUp on first / ArrowDown on last item clamp without wrapping or throwing", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const items = target.querySelectorAll<HTMLElement>(".es-item");
    items[0].focus();
    key(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    items[3].focus();
    key(items[3], "ArrowDown");
    expect(document.activeElement).toBe(items[3]);
  });
});

// ------------------------------------------------------------------ render caps & chips

describe("hardening: render caps and chip overflow", () => {
  test("2001 items → capped at 2000, native warning raised, cap note rendered", () => {
    const { visual, target, host } = makeVisual();
    const warn = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (host as any).displayWarningIcon = warn;
    const many = Array.from({ length: 2001 }, (_, i) => `Item ${String(i).padStart(4, "0")}`);
    visual.update(makeUpdateOptions(buildSlicerDV([{ name: "P", values: many }])));
    expect(target.querySelectorAll(".es-item")).toHaveLength(2000);
    expect(warn).toHaveBeenCalled();
    expect(target.querySelector(".es-cap-note")).not.toBeNull();
  });

  test("maxChips overflow shows the cap plus a +N badge", () => {
    const { visual, target } = makeVisual();
    const all = Array.from({ length: 12 }, (_, i) => `L${String(i).padStart(2, "0")}`);
    const persisted = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      target: { table: "Prod", column: "Product" },
      operator: "In",
      values: all.slice(0, 10) // 10 of 12 selected (11/12 would still not collapse)
    };
    visual.update(makeUpdateOptions(oneLevelFixture(all), 300, 400, [persisted]));
    // One-line rail auto-fit (R3.2): min(user maxChips 6, floor((300-122)/100)=1).
    expect(target.querySelectorAll(".es-chip[data-chip-key]")).toHaveLength(1);
    expect(target.querySelector(".es-chip-more")?.textContent).toBe("+9");
    expect(target.querySelector(".es-chip-clear")).not.toBeNull();
  });

  test("chips position=bottom renders the badge row after the body", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(undefined, { chips: { position: "bottom" } })));
    const children = Array.from(target.children);
    const bodyIdx = children.findIndex((c) => c.classList.contains("es-body"));
    const chipsIdx = children.findIndex((c) => c.classList.contains("es-chips"));
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(chipsIdx).toBeGreaterThan(bodyIdx);
  });
});

// ------------------------------------------------------------------ destroy

describe("hardening: destroy lifecycle", () => {
  test("update() after destroy() re-renders from scratch without crashing", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.destroy();
    expect(target.childElementCount).toBe(0);
    expect(() => visual.update(makeUpdateOptions(oneLevelFixture()))).not.toThrow();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
  });

  test("destroy() twice in a row is safe", () => {
    const { visual } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.destroy();
    expect(() => visual.destroy()).not.toThrow();
  });
});

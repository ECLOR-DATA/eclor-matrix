/**
 * Host-lifecycle + interaction tests: constructor placeholder, two-branch
 * empty handling, filter application/echo, chips, actions, a11y contract.
 */

import { makeVisual, makeUpdateOptions, oneLevelFixture, twoLevelFixture, buildSlicerDV } from "./_harness";

function click(el: Element | null): void {
  if (!el) throw new Error("click target not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("lifecycle", () => {
  test("constructor renders a placeholder before first update", () => {
    const { target } = makeVisual();
    expect(target.querySelector(".es-empty")).not.toBeNull();
  });

  test("valid update renders header, search, chips row, items and footer", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    expect(target.querySelector(".es-header")).not.toBeNull();
    expect(target.querySelector(".es-search-input")).not.toBeNull();
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
    expect(target.querySelector(".es-footer")).not.toBeNull();
    expect(target.getAttribute("role")).toBe("group");
  });

  test("null dataView after a valid one replays the cached frame", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.update(makeUpdateOptions(null));
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
  });

  test("user-cleared buckets wipe the visual for the host landing page", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.update(makeUpdateOptions({ categorical: { categories: [], values: [] }, metadata: {} }));
    expect(target.childElementCount).toBe(0);
  });

  test("degenerate viewport no-ops and keeps the previous frame", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.update(makeUpdateOptions(oneLevelFixture(), 0, 0));
    expect(target.querySelectorAll(".es-item")).toHaveLength(4);
  });

  test("destroy clears the DOM and caches", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    visual.destroy();
    expect(target.childElementCount).toBe(0);
  });

  test("hostile labels render as text, never markup", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(['<img src=x onerror="x">', "ok & fine"])));
    expect(target.querySelector("img")).toBeNull();
    const labels = Array.from(target.querySelectorAll(".es-item .es-label")).map((e) => e.textContent);
    expect(labels).toContain('<img src=x onerror="x">');
  });
});

describe("selection → filter", () => {
  test("clicking an item applies a BasicFilter and re-renders it selected", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelectorAll(".es-item")[1]);
    expect(host.applied).toHaveLength(1);
    const call = host.applied[0];
    expect(call.objectName).toBe("general");
    expect(call.propertyName).toBe("filter");
    expect((call.filter as { values: string[] }).values).toEqual(["Beta"]);
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(1);
  });

  test("clicking the sole selected item releases the filter (action=remove)", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(undefined, { selection: { selectionMode: "single" } })));
    expect(target.querySelector(".es-radio")).not.toBeNull();
    click(target.querySelectorAll(".es-item")[0]);
    click(target.querySelectorAll(".es-item.es-on")[0]);
    expect(host.applied).toHaveLength(2);
    expect(host.applied[1].filter).toBeNull();
    expect(host.applied[1].action).toBe(1); // FilterAction.remove
  });

  test("multi mode accumulates; chips row shows removable badges", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelectorAll(".es-item")[0]);
    click(target.querySelectorAll(".es-item")[2]);
    expect((host.applied[1].filter as { values: string[] }).values).toEqual(["Alpha", "Gamma"]);
    const chips = target.querySelectorAll(".es-chip[data-chip-key]");
    expect(chips).toHaveLength(2);
    click(chips[0]); // remove "Alpha" badge
    expect((host.applied[2].filter as { values: string[] }).values).toEqual(["Gamma"]);
  });

  test("hierarchy selection applies a TupleFilter over leaf paths", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(twoLevelFixture()));
    click(target.querySelectorAll(".es-item")[0]); // France (3 leaves)
    const f = host.applied[0].filter as { filterType: number; values: unknown[][] };
    expect(f.filterType).toBe(6);
    expect(f.values).toHaveLength(3);
  });

  test("hierarchy: chips grouped by level name, per-level clear removes only that level", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(twoLevelFixture(), 700, 400));
    // Expand France, select two of its products + all of Germany.
    click(target.querySelector("[data-exp-key]"));
    const byLabel = (label: string) =>
      Array.from(target.querySelectorAll(".es-item")).find((e) => e.textContent?.includes(label)) ?? null;
    click(byLabel("Alpha"));
    click(byLabel("Gamma"));
    click(byLabel("Germany"));

    const groups = target.querySelectorAll(".es-chip-group");
    expect(groups).toHaveLength(2);
    const labels = Array.from(target.querySelectorAll(".es-chip-group-label")).map((e) => e.textContent);
    expect(labels).toEqual(["Country", "Product"]);
    // Country group: 1 chip (Germany), no level-clear (single chip).
    expect(groups[0].querySelectorAll(".es-chip[data-chip-key]")).toHaveLength(1);
    expect(groups[0].querySelector("[data-clear-level]")).toBeNull();
    // Product group: 2 chips with parent context + a level-clear ×.
    expect(groups[1].querySelectorAll(".es-chip[data-chip-key]")).toHaveLength(2);
    expect(groups[1].querySelector(".es-chip-path")?.textContent).toBe("France · ");
    const lvlClear = groups[1].querySelector("[data-clear-level]");
    expect(lvlClear).not.toBeNull();

    const before = host.applied.length;
    click(lvlClear);
    // Only Germany survives → tuple filter over its 2 leaves.
    const f = host.applied[before].filter as { filterType: number; values: unknown[][] };
    expect(f.filterType).toBe(6);
    expect(f.values).toHaveLength(2);
    expect(target.querySelectorAll(".es-chip-group")).toHaveLength(1);
  });

  test("select all / invert / clear header actions", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelector('[data-action="selectAll"]'));
    expect((host.applied[0].filter as { values: string[] }).values).toHaveLength(4);
    click(target.querySelector('[data-action="invert"]'));
    expect(host.applied[1].filter).toBeNull();
    click(target.querySelectorAll(".es-item")[0]);
    click(target.querySelector('[data-action="clear"]'));
    expect(host.applied[3].filter).toBeNull();
  });

  test("allowInteractions=false blocks filter calls but keeps visuals alive", () => {
    const { visual, target, host } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (visual as any).allowInteractions = false;
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelectorAll(".es-item")[0]);
    expect(host.applied).toHaveLength(0);
  });
});

describe("filter echo / state restore", () => {
  test("own applyJsonFilter echo does not clobber local selection", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    click(target.querySelectorAll(".es-item")[1]);
    // Host echoes our own filter back:
    const echo = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      target: { table: "Prod", column: "Product" },
      operator: "In",
      values: ["Beta"]
    };
    visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, [echo]));
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(1);
  });

  test("persisted filter restores selection on a fresh instance", () => {
    const { visual, target } = makeVisual();
    const persisted = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      target: { table: "Prod", column: "Product" },
      operator: "In",
      values: ["Gamma", "Delta"]
    };
    visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, [persisted]));
    const on = Array.from(target.querySelectorAll(".es-item.es-on .es-label")).map((e) => e.textContent);
    expect(on).toEqual(["Gamma", "Delta"]);
  });

  test("external clear (empty jsonFilters, no pending echo) resets selection", () => {
    const { visual, target } = makeVisual();
    const persisted = {
      $schema: "http://powerbi.com/product/schema#basic",
      filterType: 1,
      target: { table: "Prod", column: "Product" },
      operator: "In",
      values: ["Gamma"]
    };
    visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, [persisted]));
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(1);
    visual.update(makeUpdateOptions(oneLevelFixture(), 300, 400, []));
    expect(target.querySelectorAll(".es-item.es-on")).toHaveLength(0);
  });
});

describe("search & hierarchy interactions", () => {
  test("typing in search narrows the list without applying a filter", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const input = target.querySelector<HTMLInputElement>(".es-search-input");
    if (!input) throw new Error("no search input");
    input.value = "ga";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const labels = Array.from(target.querySelectorAll(".es-item .es-label")).map((e) => e.textContent);
    expect(labels).toEqual(["Gamma"]);
    expect(host.applied).toHaveLength(0);
  });

  test("expander caret reveals children; second click collapses", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(twoLevelFixture()));
    expect(target.querySelectorAll(".es-item")).toHaveLength(3);
    click(target.querySelector("[data-exp-key]"));
    expect(target.querySelectorAll(".es-item").length).toBeGreaterThan(3);
    click(target.querySelector("[data-exp-key]"));
    expect(target.querySelectorAll(".es-item")).toHaveLength(3);
  });

  test("partial state renders as aria-checked=mixed", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(twoLevelFixture()));
    click(target.querySelector("[data-exp-key]")); // expand France
    const items = target.querySelectorAll(".es-item");
    click(items[1]); // France > Alpha
    const france = target.querySelectorAll(".es-item")[0];
    expect(france.getAttribute("aria-checked")).toBe("mixed");
  });
});

describe("layouts", () => {
  test("chiclet layout renders buttons in a grid", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(undefined, { slicerStyle: { layout: "chiclets" } })));
    expect(target.querySelector(".es-chiclet-grid")).not.toBeNull();
    expect(target.querySelectorAll("button.es-chiclet")).toHaveLength(4);
  });

  test("dropdown layout: closed field, opens on click, item click filters", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture(undefined, { slicerStyle: { layout: "dropdown" } })));
    expect(target.querySelector(".es-popover")).toBeNull();
    click(target.querySelector('[data-action="ddToggle"]'));
    expect(target.querySelector(".es-popover")).not.toBeNull();
    click(target.querySelectorAll(".es-item")[0]);
    expect(host.applied).toHaveLength(1);
  });
});

describe("a11y contract", () => {
  test("every item is keyboard-reachable with a role and aria-checked", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    for (const el of Array.from(target.querySelectorAll(".es-item"))) {
      expect(el.getAttribute("tabindex")).toBe("0");
      expect(["checkbox", "radio"]).toContain(el.getAttribute("role"));
      expect(el.getAttribute("aria-checked")).not.toBeNull();
      expect(el.getAttribute("aria-label")).toBeTruthy();
    }
  });

  test("ArrowDown moves focus, Enter toggles, Escape clears", () => {
    const { visual, target, host } = makeVisual();
    visual.update(makeUpdateOptions(oneLevelFixture()));
    const items = target.querySelectorAll<HTMLElement>(".es-item");
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("Beta");
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    expect(host.applied).toHaveLength(1);
    const focused = target.querySelector<HTMLElement>(".es-item.es-on");
    focused?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.applied[1].filter).toBeNull();
  });

  test("high-contrast palette overrides the selected colours", () => {
    const { visual, target, host } = makeVisual();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (host.colorPalette as any).isHighContrast = true;
    visual.update(makeUpdateOptions(oneLevelFixture()));
    expect(target.style.getPropertyValue("--es-selected-bg")).toBe("#0078d4");
    expect(target.style.getPropertyValue("--es-fg")).toBe("#000000");
  });
});

describe("measure display", () => {
  test("bound measure renders formatted values next to items", () => {
    const { visual, target } = makeVisual();
    visual.update(makeUpdateOptions(twoLevelFixture()));
    const counts = Array.from(target.querySelectorAll(".es-item .es-count")).map((e) => e.textContent);
    expect(counts[0]).toBe("350"); // France sum, format #,##0
  });

  test("no measure → leaf counts", () => {
    const { visual, target } = makeVisual();
    visual.update(
      makeUpdateOptions(
        buildSlicerDV([{ name: "P", column: "P", values: ["a", "a", "b"] }])
      )
    );
    const counts = Array.from(target.querySelectorAll(".es-item .es-count")).map((e) => e.textContent);
    expect(counts).toEqual(["2", "1"]);
  });
});

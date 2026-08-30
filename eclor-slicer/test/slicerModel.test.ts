import {
  buildTree,
  checkState,
  flattenVisible,
  invertSelection,
  normalizeSelection,
  nodeMatches,
  normalizeSearch,
  pathKey,
  selectedLeafTuples,
  selectedNodesInOrder,
  toggleNode,
  visibleRootKeys,
  SlicerNode,
  SlicerTree
} from "../src/slicerModel";

function twoLevelTree(): SlicerTree {
  return buildTree(
    [
      ["France", "France", "France", "Germany", "Germany", "Spain", "Spain", "Spain"],
      ["Alpha", "Beta", "Gamma", "Alpha", "Delta", "Beta", "Delta", "Epsilon"]
    ],
    [100, 200, 50, 300, 120, 80, 60, 40]
  );
}

function node(tree: SlicerTree, ...path: string[]): SlicerNode {
  let n: SlicerNode = tree.root;
  for (const label of path) {
    const child = n.children.find((c) => c.label === label);
    if (!child) throw new Error(`node not found: ${path.join("/")}`);
    n = child;
  }
  return n;
}

describe("buildTree", () => {
  test("groups leaf rows into a tree with counts and measure sums", () => {
    const tree = twoLevelTree();
    expect(tree.levelCount).toBe(2);
    expect(tree.leafCount).toBe(8);
    expect(tree.root.children.map((c) => c.label)).toEqual(["France", "Germany", "Spain"]);
    expect(node(tree, "France").count).toBe(3);
    expect(node(tree, "France").value).toBe(350);
    expect(node(tree, "Spain", "Delta").value).toBe(60);
    expect(tree.maxAbsValue).toBe(300);
  });

  test("empty input produces an empty tree, never throws", () => {
    const tree = buildTree([]);
    expect(tree.leafCount).toBe(0);
    expect(tree.root.children).toHaveLength(0);
  });

  test("null and hostile values become nodes, no crash", () => {
    const tree = buildTree([[null, "<A & B>", "null", null]]);
    expect(tree.root.children.map((c) => c.label)).toEqual(["", "<A & B>", "null"]);
    // literal string "null" and real null stay DIFFERENT nodes
    expect(tree.root.children).toHaveLength(3);
    expect(node(tree, "").count).toBe(2);
  });

  test("NaN / Infinity measures are ignored in sums; all-invalid stays null", () => {
    const tree = buildTree([["A", "A", "B"]], [NaN, 5, Infinity]);
    expect(node(tree, "A").value).toBe(5);
    // B only saw non-numeric values → null (renderer falls back to count),
    // never a misleading 0 (QA hardening BUG-1).
    expect(node(tree, "B").value).toBeNull();
  });

  test("non-adjacent duplicate branches merge (host sort not assumed)", () => {
    const tree = buildTree([
      ["FR", "DE", "FR"],
      ["a", "a", "b"]
    ]);
    expect(tree.root.children.map((c) => c.label)).toEqual(["FR", "DE"]);
    expect(node(tree, "FR").count).toBe(2);
  });
});

describe("selection tri-state + toggle", () => {
  test("selecting a parent covers descendants", () => {
    const tree = twoLevelTree();
    const sel = toggleNode(node(tree, "France"), new Set());
    expect(checkState(node(tree, "France"), sel)).toBe("on");
    expect(checkState(node(tree, "France", "Beta"), sel)).toBe("on");
    expect(checkState(node(tree, "Germany"), sel)).toBe("off");
  });

  test("selecting all children collapses onto the parent", () => {
    const tree = twoLevelTree();
    let sel = new Set<string>();
    sel = toggleNode(node(tree, "Germany", "Alpha"), sel);
    expect(checkState(node(tree, "Germany"), sel)).toBe("partial");
    sel = toggleNode(node(tree, "Germany", "Delta"), sel);
    expect(sel.has(node(tree, "Germany").key)).toBe(true);
    expect(sel.has(node(tree, "Germany", "Alpha").key)).toBe(false);
  });

  test("unticking one leaf under a ticked parent splits the parent", () => {
    const tree = twoLevelTree();
    let sel = toggleNode(node(tree, "France"), new Set());
    sel = toggleNode(node(tree, "France", "Beta"), sel);
    expect(checkState(node(tree, "France", "Beta"), sel)).toBe("off");
    expect(checkState(node(tree, "France", "Alpha"), sel)).toBe("on");
    expect(checkState(node(tree, "France", "Gamma"), sel)).toBe("on");
    expect(checkState(node(tree, "France"), sel)).toBe("partial");
  });

  test("toggle twice returns to empty", () => {
    const tree = twoLevelTree();
    const n = node(tree, "Spain");
    const sel = toggleNode(n, toggleNode(n, new Set()));
    expect(sel.size).toBe(0);
  });
});

describe("selectedLeafTuples / selectedNodesInOrder", () => {
  test("parent selection expands to its leaf tuples", () => {
    const tree = twoLevelTree();
    const sel = toggleNode(node(tree, "France"), new Set());
    expect(selectedLeafTuples(tree, sel)).toEqual([
      ["France", "Alpha"],
      ["France", "Beta"],
      ["France", "Gamma"]
    ]);
  });

  test("chips list prunes covered descendants and keeps display order", () => {
    const tree = twoLevelTree();
    let sel = toggleNode(node(tree, "Spain", "Delta"), new Set());
    sel = toggleNode(node(tree, "France"), sel);
    expect(selectedNodesInOrder(tree, sel).map((n) => n.label)).toEqual(["France", "Delta"]);
  });
});

describe("search", () => {
  test("normalizeSearch folds case and accents", () => {
    expect(normalizeSearch("Électronique")).toBe("electronique");
    expect(nodeMatches({ label: "Électro" } as SlicerNode, "elec")).toBe(true);
  });

  test("flattenVisible keeps ancestors of matches and force-expands them", () => {
    const tree = twoLevelTree();
    const items = flattenVisible(tree, new Set(), "epsilon", new Set());
    expect(items.map((i) => i.node.label)).toEqual(["Spain", "Epsilon"]);
    expect(items[0].expanded).toBe(true);
  });

  test("empty search + no expansion shows roots only", () => {
    const tree = twoLevelTree();
    const items = flattenVisible(tree, new Set(), "", new Set());
    expect(items.map((i) => i.node.label)).toEqual(["France", "Germany", "Spain"]);
  });

  test("expanded key reveals children in order", () => {
    const tree = twoLevelTree();
    const items = flattenVisible(tree, new Set([node(tree, "Germany").key]), "", new Set());
    expect(items.map((i) => i.node.label)).toEqual(["France", "Germany", "Alpha", "Delta", "Spain"]);
    expect(items[2].depth).toBe(1);
  });
});

describe("invert / select-all population", () => {
  test("invert flips root selections, search-aware", () => {
    const tree = twoLevelTree();
    const sel = toggleNode(node(tree, "France"), new Set());
    const inverted = invertSelection(tree, "", sel);
    expect(checkState(node(tree, "France"), inverted)).toBe("off");
    expect(checkState(node(tree, "Germany"), inverted)).toBe("on");
    expect(checkState(node(tree, "Spain"), inverted)).toBe("on");
  });

  test("visibleRootKeys narrows to search matches", () => {
    const tree = twoLevelTree();
    expect(visibleRootKeys(tree, "delta")).toEqual([node(tree, "Germany").key, node(tree, "Spain").key]);
  });

  test("invert treats partially-selected branches as unselected", () => {
    const tree = twoLevelTree();
    const sel = toggleNode(node(tree, "France", "Beta"), new Set());
    const inverted = invertSelection(tree, "", sel);
    expect(checkState(node(tree, "France"), inverted)).toBe("on");
    expect(sel.has(node(tree, "France", "Beta").key)).toBe(true);
    expect(inverted.has(node(tree, "France", "Beta").key)).toBe(false);
  });
});

describe("normalizeSelection", () => {
  test("leaf keys covering a whole parent collapse to the parent", () => {
    const tree = twoLevelTree();
    const keys = [
      node(tree, "Germany", "Alpha").key,
      node(tree, "Germany", "Delta").key,
      node(tree, "Spain", "Beta").key
    ];
    const sel = normalizeSelection(tree, keys);
    expect(sel.has(node(tree, "Germany").key)).toBe(true);
    expect(sel.has(node(tree, "Spain", "Beta").key)).toBe(true);
    expect(sel.size).toBe(2);
  });

  test("unknown keys are dropped silently", () => {
    const tree = twoLevelTree();
    const sel = normalizeSelection(tree, [pathKey(["Atlantis"])]);
    expect(sel.size).toBe(0);
  });

  test("all leaves selected collapses to all roots", () => {
    const tree = buildTree([
      ["A", "B"],
      ["x", "y"]
    ]);
    const sel = normalizeSelection(tree, [pathKey(["A", "x"]), pathKey(["B", "y"])]);
    expect(sel.has(node(tree, "A").key)).toBe(true);
    expect(sel.has(node(tree, "B").key)).toBe(true);
  });
});

describe("pathKey", () => {
  test("distinguishes types and serialises dates stably", () => {
    expect(pathKey(["1"])).not.toBe(pathKey([1]));
    expect(pathKey([null])).not.toBe(pathKey(["null"]));
    const d = new Date("2026-01-15T00:00:00Z");
    expect(pathKey([d])).toBe(pathKey([new Date(d.getTime())]));
  });
});

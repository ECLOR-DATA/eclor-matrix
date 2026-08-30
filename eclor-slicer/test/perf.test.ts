/**
 * Cert performance budget (playbook §2.3): 10 000 data points through the
 * full pure pipeline (tree build + flatten + filter build) in < 1 s.
 */

import { buildTree, flattenVisible, selectedLeafTuples, toggleNode } from "../src/slicerModel";
import { buildSlicerFilter } from "../src/filters";

describe("performance budget", () => {
  test("10k rows: build + flatten + search + filter < 1s", () => {
    const countries: string[] = [];
    const products: string[] = [];
    const measure: number[] = [];
    for (let i = 0; i < 10000; i++) {
      countries.push(`Country ${i % 50}`);
      products.push(`Product ${i % 200}-${Math.floor(i / 2000)}`);
      measure.push((i * 37) % 1000);
    }

    const t0 = Date.now();
    const tree = buildTree([countries, products], measure);
    const flatRoots = flattenVisible(tree, new Set(), "", new Set());
    const searched = flattenVisible(tree, new Set(), "product 42", new Set());
    let sel = new Set<string>();
    sel = toggleNode(tree.root.children[0], sel);
    sel = toggleNode(tree.root.children[10], sel);
    const tuples = selectedLeafTuples(tree, sel);
    const filter = buildSlicerFilter(
      [
        { table: "Geo", column: "Country" },
        { table: "Prod", column: "Product" }
      ],
      tuples
    );
    const elapsed = Date.now() - t0;

    expect(tree.leafCount).toBe(10000);
    expect(flatRoots.length).toBe(50);
    expect(searched.length).toBeGreaterThan(0);
    expect(filter).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  test("10k flat single-level rows build < 1s", () => {
    const labels: string[] = [];
    for (let i = 0; i < 10000; i++) labels.push(`Item ${i}`);
    const t0 = Date.now();
    const tree = buildTree([labels]);
    const flat = flattenVisible(tree, new Set(), "", new Set());
    expect(flat).toHaveLength(10000);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

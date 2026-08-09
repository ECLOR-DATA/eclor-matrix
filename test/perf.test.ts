/**
 * Cert performance budget — 10 000 data points parsed in < 1 s
 * (playbook §2.3). Targets the pure pipeline: flatten + max-abs scan.
 */

import { computeMaxAbs, flattenColumns, flattenRows, MatrixNodeLike } from "../src/matrixModel";

describe("performance budget", () => {
  test("10 000 rows × 3 measures flatten in under 1 s", () => {
    const measureNames = ["Actual", "Budget", "Prior Year"];
    const root: MatrixNodeLike = { children: [] };
    for (let g = 0; g < 100; g++) {
      const group: MatrixNodeLike = {
        level: 0,
        value: `Group ${g}`,
        children: []
      };
      for (let i = 0; i < 100; i++) {
        group.children!.push({
          level: 1,
          value: `Item ${g}-${i}`,
          identity: { key: `${g}-${i}` },
          values: {
            0: { value: Math.sin(g * 100 + i) * 1e6 },
            1: { value: Math.cos(g * 100 + i) * 1e6, valueSourceIndex: 1 },
            2: { value: (g * 100 + i) % 977, valueSourceIndex: 2 }
          }
        });
      }
      root.children!.push(group);
    }

    const t0 = performance.now();
    const leaves = flattenColumns(undefined, measureNames);
    const rows = flattenRows(root, leaves);
    const maxAbs = computeMaxAbs(rows);
    const elapsed = performance.now() - t0;

    expect(rows).toHaveLength(10100); // 100 groups + 10 000 leaves
    expect(maxAbs).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });
});

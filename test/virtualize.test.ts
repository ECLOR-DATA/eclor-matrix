import { computeWindow, estimateRowHeight } from "../src/virtualize";

describe("computeWindow", () => {
  test("top of the list — window starts at 0 with no top pad", () => {
    const w = computeWindow(0, 400, 20, 10000, 10);
    expect(w.start).toBe(0);
    expect(w.topPad).toBe(0);
    expect(w.end).toBe(0 + Math.ceil(400 / 20) + 1 + 10);
    expect(w.bottomPad).toBe((10000 - w.end) * 20);
  });

  test("mid-scroll — window brackets the visible slice with overscan", () => {
    const w = computeWindow(2000, 400, 20, 10000, 10);
    // first visible = 100, overscan 10 → start 90
    expect(w.start).toBe(90);
    expect(w.topPad).toBe(90 * 20);
    expect(w.end).toBe(100 + 21 + 10);
  });

  test("bottom of the list — end clamps to total, no bottom pad", () => {
    const w = computeWindow(10000 * 20, 400, 20, 10000, 10);
    expect(w.end).toBe(10000);
    expect(w.bottomPad).toBe(0);
    expect(w.start).toBeLessThanOrEqual(10000);
  });

  test("fewer rows than the viewport — whole list, no pads", () => {
    const w = computeWindow(0, 4000, 20, 50, 10);
    expect(w.start).toBe(0);
    expect(w.end).toBe(50);
    expect(w.topPad).toBe(0);
    expect(w.bottomPad).toBe(0);
  });

  test("degenerate inputs never produce negative or NaN bounds", () => {
    const w = computeWindow(-50, 0, 0, 100, 5);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(w.end).toBeGreaterThanOrEqual(w.start);
    expect(Number.isFinite(w.topPad)).toBe(true);
    expect(Number.isFinite(w.bottomPad)).toBe(true);
  });
});

describe("estimateRowHeight", () => {
  test("density paddings mirror visual.less", () => {
    const normal = estimateRowHeight(11, "normal");
    const compact = estimateRowHeight(11, "compact");
    const comfy = estimateRowHeight(11, "comfortable");
    expect(compact).toBeLessThan(normal);
    expect(normal).toBeLessThan(comfy);
    expect(normal).toBe(Math.round(11 * 1.45) + 8 + 1);
  });
});

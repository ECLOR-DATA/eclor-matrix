import {
  autoTextColor,
  DEFAULT_CELL_COLOR_OPTS,
  heatColor,
  interpolateHex,
  resolveCellColor,
  ruleColor
} from "../src/cellColor";

const opts = (over: Partial<typeof DEFAULT_CELL_COLOR_OPTS>) => ({
  ...DEFAULT_CELL_COLOR_OPTS,
  ...over
});

describe("interpolateHex", () => {
  test("endpoints and midpoint", () => {
    expect(interpolateHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(interpolateHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(interpolateHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("clamps t outside [0,1] and survives bad hex", () => {
    expect(interpolateHex("#102030", "#405060", -3)).toBe("#102030");
    expect(interpolateHex("#102030", "#405060", 9)).toBe("#405060");
    expect(interpolateHex("garbage", "#000000", 1)).toBe("#000000");
  });
});

describe("autoTextColor", () => {
  test("dark backgrounds get white text, light get near-black", () => {
    expect(autoTextColor("#091612")).toBe("#FFFFFF");
    expect(autoTextColor("#FF4D6D")).toBe("#FFFFFF");
    expect(autoTextColor("#F5F6F5")).toBe("#091612");
    expect(autoTextColor("#1EF5B1")).toBe("#091612");
  });
});

describe("ruleColor", () => {
  const o = opts({ mode: "rules", thresholdLow: 0, thresholdHigh: 100 });

  test("below / between / above", () => {
    expect(ruleColor(-1, o)).toBe("#FF4D6D");
    expect(ruleColor(50, o)).toBeNull(); // colorMid empty → no colour
    expect(ruleColor(101, o)).toBe("#1EF5B1");
  });

  test("boundary values fall in the middle band", () => {
    expect(ruleColor(0, o)).toBeNull();
    expect(ruleColor(100, o)).toBeNull();
  });

  test("NaN / Infinity → null", () => {
    expect(ruleColor(NaN, o)).toBeNull();
    expect(ruleColor(Infinity, o)).toBeNull();
  });
});

describe("heatColor", () => {
  const o = opts({ mode: "heatmap", colorLow: "#ffffff", colorMid: "", colorHigh: "#1ef5b1" });

  test("min → low, max → high, degenerate span → midpoint", () => {
    expect(heatColor(0, { min: 0, max: 100 }, o)).toBe("#ffffff");
    expect(heatColor(100, { min: 0, max: 100 }, o)).toBe("#1ef5b1");
    const mid = heatColor(5, { min: 5, max: 5 }, o);
    expect(mid).toBe(interpolateHex("#ffffff", "#1ef5b1", 0.5));
  });

  test("three-colour diverging path goes through the middle", () => {
    const d = opts({ mode: "heatmap", colorLow: "#ff4d6d", colorMid: "#ffffff", colorHigh: "#1ef5b1" });
    expect(heatColor(0, { min: -100, max: 100 }, d)).toBe("#ffffff");
    expect(heatColor(-100, { min: -100, max: 100 }, d)).toBe("#ff4d6d");
    expect(heatColor(100, { min: -100, max: 100 }, d)).toBe("#1ef5b1");
  });
});

describe("resolveCellColor", () => {
  test("mode none → no paint", () => {
    const p = resolveCellColor(50, { min: 0, max: 100 }, opts({ mode: "none" }));
    expect(p).toEqual({ bg: null, fg: null });
  });

  test("paint includes a readable text colour", () => {
    const p = resolveCellColor(-5, { min: -10, max: 10 }, opts({ mode: "rules" }));
    expect(p.bg).toBe("#FF4D6D");
    expect(p.fg).toBe("#FFFFFF");
  });
});

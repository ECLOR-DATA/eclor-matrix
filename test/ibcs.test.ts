import {
  barWidthPct,
  detectScenario,
  pinPosPct,
  scenarioRank,
  segmentGeometry,
  templateVarianceSpecs,
  waterfallMaxAbs,
  waterfallStarts
} from "../src/ibcs";

describe("detectScenario", () => {
  test("common English and French measure names", () => {
    expect(detectScenario("Actual")).toBe("AC");
    expect(detectScenario("AC")).toBe("AC");
    expect(detectScenario("Réel")).toBe("AC");
    expect(detectScenario("Prior Year")).toBe("PY");
    expect(detectScenario("PY Sales")).toBe("PY");
    expect(detectScenario("Sales N-1")).toBe("PY");
    expect(detectScenario("Budget")).toBe("BU");
    expect(detectScenario("Plan 2026")).toBe("BU");
    expect(detectScenario("Forecast Q4")).toBe("FC");
    expect(detectScenario("Prévision")).toBe("FC");
  });

  test("PY/BU/FC win over AC when combined (\"Actual vs Budget\" is a variance vs budget)", () => {
    expect(detectScenario("Actual vs Budget")).toBe("BU");
  });

  test("no token → null", () => {
    expect(detectScenario("Montant")).toBeNull();
    expect(detectScenario("")).toBeNull();
    expect(detectScenario(undefined)).toBeNull();
    // 'Factory' must NOT match 'ac' inside the word.
    expect(detectScenario("Factory output")).toBeNull();
  });
});

describe("barWidthPct", () => {
  test("linear scale, clamped at 100", () => {
    expect(barWidthPct(50, 100)).toBe(50);
    expect(barWidthPct(-50, 100)).toBe(50);
    expect(barWidthPct(100, 100)).toBe(100);
    expect(barWidthPct(250, 100)).toBe(100);
  });

  test("degenerate inputs → 0", () => {
    expect(barWidthPct(10, 0)).toBe(0);
    expect(barWidthPct(NaN, 100)).toBe(0);
    expect(barWidthPct(Infinity, 100)).toBe(0);
  });
});

describe("templateVarianceSpecs (IBCS T01-T04)", () => {
  test("T01: Δ and Δ% as figures for each present base, PY before PL", () => {
    const specs = templateVarianceSpecs("t01", "Réel", "N-1", "Budget");
    expect(specs.map((s) => s.name)).toEqual(["ΔPY", "ΔPY %", "ΔPL", "ΔPL %"]);
    expect(specs.every((s) => s.display === "number")).toBe(true);
    expect(specs[0].formula).toBe("[Réel] - [N-1]");
    expect(specs[1].formula).toBe("([Réel] - [N-1]) / ABS([N-1])");
    expect(specs[1].format).toBe("percent");
    expect(specs[2].formula).toBe("[Réel] - [Budget]");
  });

  test("T02: Δ as bars, Δ% as pins; T03 figures; T04 waterfall + pins", () => {
    const t02 = templateVarianceSpecs("t02", "AC", "PY", "PL");
    expect(t02.map((s) => s.display)).toEqual(["bar", "pin", "bar", "pin"]);
    const t03 = templateVarianceSpecs("t03", "AC", "PY", "PL");
    expect(t03.every((s) => s.display === "number")).toBe(true);
    const t04 = templateVarianceSpecs("t04", "AC", "PY", "PL");
    expect(t04.map((s) => s.display)).toEqual(["waterfall", "pin", "waterfall", "pin"]);
  });

  test("missing pieces: no AC → empty; single base → 2 columns; ']' skipped", () => {
    expect(templateVarianceSpecs("t01", undefined, "PY", "PL")).toEqual([]);
    expect(templateVarianceSpecs("none", "AC", "PY", "PL")).toEqual([]);
    const only = templateVarianceSpecs("t02", "AC", undefined, "Budget");
    expect(only.map((s) => s.name)).toEqual(["ΔPL", "ΔPL %"]);
    expect(templateVarianceSpecs("t01", "we]ird", "PY", undefined)).toEqual([]);
    expect(templateVarianceSpecs("t01", "AC", "b]ad", "Budget").map((s) => s.name)).toEqual([
      "ΔPL",
      "ΔPL %"
    ]);
  });

  test("scenarioRank orders AC · PY · PL · FC · others", () => {
    expect([null, "FC", "BU", "PY", "AC"].map((s) => scenarioRank(s as never))).toEqual([
      4, 3, 2, 1, 0
    ]);
  });
});

describe("waterfall math (T04)", () => {
  test("detail rows cascade, subtotals re-anchor at zero, nulls skip", () => {
    const values = [10, -4, null, 6, 12];
    const isSub = [false, false, false, false, true];
    expect(waterfallStarts(values, isSub)).toEqual([0, 10, null, 6, 0]);
    // Domain covers the farthest bar edge (10 → 12 at the peak).
    expect(waterfallMaxAbs(values, waterfallStarts(values, isSub))).toBe(12);
  });

  test("negative runs go below zero", () => {
    const values = [-5, -3, -8];
    const starts = waterfallStarts(values, [false, false, true]);
    expect(starts).toEqual([0, -5, 0]);
    expect(waterfallMaxAbs(values, starts)).toBe(8);
  });

  test("segmentGeometry maps to the shared half-track, clamped", () => {
    expect(segmentGeometry(0, 50, 100)).toEqual({ leftPct: 50, widthPct: 25 });
    expect(segmentGeometry(50, -30, 100)).toEqual({ leftPct: 60, widthPct: 15 });
    expect(segmentGeometry(0, -100, 100)).toEqual({ leftPct: 0, widthPct: 50 });
    expect(segmentGeometry(80, 80, 100)).toEqual({ leftPct: 90, widthPct: 10 }); // clamp
    expect(segmentGeometry(0, 10, 0)).toEqual({ leftPct: 50, widthPct: 0 });
  });

  test("pinPosPct: axis at 50, clamped ends", () => {
    expect(pinPosPct(50, 100)).toBe(75);
    expect(pinPosPct(-100, 100)).toBe(0);
    expect(pinPosPct(300, 100)).toBe(100);
    expect(pinPosPct(NaN, 100)).toBe(50);
  });
});

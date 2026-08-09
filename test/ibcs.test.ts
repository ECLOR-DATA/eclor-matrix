import { barWidthPct, detectScenario } from "../src/ibcs";

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

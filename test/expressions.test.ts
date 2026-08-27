import { compileExpression } from "../src/expressions";

const evalWith = (formula: string, env: Record<string, number | null>) => {
  const c = compileExpression(formula);
  if (!c.ok) throw new Error(`compile failed: ${c.error}`);
  return c.evaluate((ref) => env[ref.toLowerCase()] ?? null);
};

describe("compileExpression — valid formulas", () => {
  test("basic arithmetic and precedence", () => {
    expect(evalWith("1 + 2 * 3", {})).toBe(7);
    expect(evalWith("(1 + 2) * 3", {})).toBe(9);
    expect(evalWith("10 - 4 - 3", {})).toBe(3); // left associative
    expect(evalWith("8 / 2 / 2", {})).toBe(2);
  });

  test("measure references and refs list", () => {
    const c = compileExpression("[Actual] - [Budget]");
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.refs.sort()).toEqual(["Actual", "Budget"]);
      expect(c.evaluate((r) => ({ actual: 120, budget: 100 })[r.toLowerCase()] ?? null)).toBe(20);
    }
  });

  test("unary minus", () => {
    expect(evalWith("-3 + 5", {})).toBe(2);
    expect(evalWith("2 * -3", {})).toBe(-6);
    expect(evalWith("-(2 + 3)", {})).toBe(-5);
  });

  test("functions ABS / MIN / MAX", () => {
    expect(evalWith("ABS(0 - 7)", {})).toBe(7);
    expect(evalWith("MIN(3, 8)", {})).toBe(3);
    expect(evalWith("MAX([a], [b])", { a: 4, b: 9 })).toBe(9);
    expect(evalWith("abs(-2)", {})).toBe(2); // case-insensitive fn names
  });

  test("classic variance percentage", () => {
    const v = evalWith("([Actual] - [Budget]) / [Budget]", { actual: 110, budget: 100 });
    expect(v).toBeCloseTo(0.1, 10);
  });
});

describe("compileExpression — Excel-style operators", () => {
  test("power ^: Excel semantics", () => {
    expect(evalWith("2 ^ 10", {})).toBe(1024);
    expect(evalWith("-2 ^ 2", {})).toBe(4); // unary minus binds tighter (Excel)
    expect(evalWith("2 ^ -3", {})).toBe(0.125);
    expect(evalWith("2 ^ 3 ^ 2", {})).toBe(64); // left associative (Excel)
    expect(evalWith("2 + 3 ^ 2", {})).toBe(11); // ^ above * /
  });

  test("power overflow / NaN → null", () => {
    expect(evalWith("10 ^ 400", {})).toBeNull();
    expect(evalWith("(0 - 8) ^ 0.5", {})).toBeNull();
  });

  test("postfix percent", () => {
    expect(evalWith("10%", {})).toBeCloseTo(0.1, 12);
    expect(evalWith("200 * 10%", {})).toBeCloseTo(20, 12);
    expect(evalWith("[a] * 110%", { a: 100 })).toBeCloseTo(110, 12);
    expect(evalWith("(2 + 3)%", {})).toBeCloseTo(0.05, 12);
    expect(evalWith("[a]% - 1", { a: 250 })).toBeCloseTo(1.5, 12); // '-' stays binary after %
    expect(evalWith("5%%", {})).toBeCloseTo(0.0005, 12);
  });

  test("comparisons yield 1/0 and sit below arithmetic", () => {
    expect(evalWith("[a] > [b]", { a: 5, b: 3 })).toBe(1);
    expect(evalWith("[a] < [b]", { a: 5, b: 3 })).toBe(0);
    expect(evalWith("[a] >= 5", { a: 5 })).toBe(1);
    expect(evalWith("[a] <= 4", { a: 5 })).toBe(0);
    expect(evalWith("[a] = 5", { a: 5 })).toBe(1);
    expect(evalWith("[a] <> 5", { a: 5 })).toBe(0);
    expect(evalWith("[a] - [b] > 0", { a: 5, b: 3 })).toBe(1); // arithmetic first
    expect(evalWith("([a] > [b]) * 10", { a: 5, b: 3 })).toBe(10); // Excel TRUE*10
  });

  test("null comparisons propagate", () => {
    expect(evalWith("[missing] > 0", {})).toBeNull();
  });
});

describe("compileExpression — Excel-style functions", () => {
  test("SUM / AVERAGE variadic", () => {
    expect(evalWith("SUM(1, 2, 3)", {})).toBe(6);
    expect(evalWith("SUM([a])", { a: 42 })).toBe(42);
    expect(evalWith("AVERAGE(2, 4, 6)", {})).toBe(4);
    expect(evalWith("AVERAGE([a], [b], [c], [d])", { a: 1, b: 2, c: 3, d: 6 })).toBe(3);
  });

  test("variadic MIN / MAX (single arg now valid, like Excel)", () => {
    expect(evalWith("MIN(1)", {})).toBe(1);
    expect(evalWith("MIN(5, 2, 8, 3)", {})).toBe(2);
    expect(evalWith("MAX(5, 2, 8, 3)", {})).toBe(8);
  });

  test("aggregates ignore nulls; all-null → null (blank)", () => {
    expect(evalWith("SUM([a], [b], [c])", { a: 5, b: null, c: 7 })).toBe(12);
    expect(evalWith("AVERAGE([a], [b], [c])", { a: 5, b: null, c: 7 })).toBe(6);
    expect(evalWith("MIN([a], [b])", { a: null, b: 5 })).toBe(5);
    expect(evalWith("MAX([a], [b])", { a: null, b: null })).toBeNull();
    expect(evalWith("SUM([x], [y])", {})).toBeNull();
  });

  test("ROUND: half away from zero, optional digits, negative digits", () => {
    expect(evalWith("ROUND(2.5)", {})).toBe(3);
    expect(evalWith("ROUND(0 - 2.5)", {})).toBe(-3); // Excel, not banker's/JS
    expect(evalWith("ROUND(3.14159, 2)", {})).toBeCloseTo(3.14, 12);
    expect(evalWith("ROUND(1234, -2)", {})).toBe(1200);
    expect(evalWith("ROUND([a], [n])", { a: 1005, n: -1 })).toBe(1010);
  });

  test("IF with comparison condition", () => {
    expect(evalWith("IF([a] > [b], 1, 2)", { a: 5, b: 3 })).toBe(1);
    expect(evalWith("IF([a] > [b], 1, 2)", { a: 3, b: 5 })).toBe(2);
    expect(evalWith("IF([missing] > 0, 1, 2)", {})).toBeNull(); // null condition
    expect(evalWith("IF([b] = 0, 0, [a] / [b])", { a: 5, b: 0 })).toBe(0); // safe branch
    expect(evalWith("IF(1, [x], 5)", {})).toBeNull(); // chosen branch may be null
  });

  test("French aliases and ; separator (Excel-FR)", () => {
    expect(evalWith("SOMME(1; 2; 3)", {})).toBe(6);
    expect(evalWith("MOYENNE(2; 4)", {})).toBe(3);
    expect(evalWith("ARRONDI(2.345; 1)", {})).toBeCloseTo(2.3, 12);
    expect(evalWith("SI([a] >= 100; 1; 0)", { a: 250 })).toBe(1);
    expect(evalWith("si(0; 1; 2)", {})).toBe(2); // case-insensitive
  });

  test("leading '=' tolerated (pasted Excel habit)", () => {
    expect(evalWith("=[a] - [b]", { a: 7, b: 2 })).toBe(5);
    expect(evalWith(" = SUM(1, 2)", {})).toBe(3);
  });

  test("nested calls", () => {
    expect(
      evalWith("IF(SUM([a], [b]) > 10, ROUND(AVERAGE([a], [b]), 1), 0)", { a: 8, b: 5 })
    ).toBeCloseTo(6.5, 12);
  });
});

describe("compileExpression — null semantics", () => {
  test("missing ref, null operand, division by zero → null", () => {
    expect(evalWith("[Missing] + 1", {})).toBeNull();
    expect(evalWith("[a] * 2", { a: null })).toBeNull();
    expect(evalWith("1 / 0", {})).toBeNull();
    expect(evalWith("[a] / [b]", { a: 5, b: 0 })).toBeNull();
  });
});

describe("compileExpression — rejected formulas", () => {
  const bad = (f: string) => {
    const c = compileExpression(f);
    expect(c.ok).toBe(false);
  };

  test("syntax errors", () => {
    bad("");
    bad("1 +");
    bad("(1 + 2");
    bad("1 + 2)");
    bad("[Unclosed");
    bad("[]");
    bad("FOO(1)");
    bad("1 2");
    bad("@#!");
    bad("=");
  });

  test("arity errors", () => {
    bad("ABS(1, 2)");
    bad("ROUND(1, 2, 3)");
    bad("IF(1, 2)");
    bad("IF(1, 2, 3, 4)");
    bad("SUM()");
    bad("MIN 3");
  });

  test("operator misuse", () => {
    bad("%5"); // percent is postfix only
    bad("2 % 3"); // no infix modulo
    bad("1 < ");
    bad("<> 2");
    bad("1 ^");
    bad("(1, 2)"); // comma outside a function call
    bad("1 + ()");
  });

  test("no eval smuggling — braces and rogue words rejected", () => {
    bad("constructor");
    bad("1; alert(1)");
    bad("`${x}`");
    bad("hasOwnProperty");
    bad("toString(1)");
  });
});

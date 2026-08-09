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
    bad("MIN(1)"); // wrong arity
    bad("1 2");
    bad("@#!");
  });

  test("no eval smuggling — braces and semicolons rejected", () => {
    bad("constructor");
    bad("1; alert(1)");
    bad("`${x}`");
  });
});

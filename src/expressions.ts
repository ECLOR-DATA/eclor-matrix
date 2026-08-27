"use strict";

/**
 * Hand-rolled expression engine for client-side calculated columns and
 * custom formula rows — an ultra-simplified Excel formula language.
 *
 * Grammar:
 *  - numbers (dot decimal), measure/row refs in brackets ([Actual]);
 *  - operators + - * / ^ (power, Excel semantics: left-associative and
 *    -2^2 = 4 because unary minus binds tighter), postfix % (÷ 100),
 *    comparisons = <> < <= > >= (→ 1/0), unary minus, ( ) and , or ;
 *    as the argument separator (Excel-FR types ;);
 *  - functions (case-insensitive, EN + FR aliases):
 *      SUM/SOMME(a, …)          variadic sum    — nulls ignored
 *      AVERAGE/AVG/MOYENNE(a,…) variadic mean   — nulls ignored
 *      MIN(a, …) MAX(a, …)      variadic        — nulls ignored
 *      ABS(x)                   absolute value
 *      ROUND/ARRONDI(x[,n])     half away from zero, n decimals (default 0,
 *                               negative n rounds to tens/hundreds…)
 *      IF/SI(cond, a, b)        cond ≠ 0 → a else b
 *  - a single leading '=' and a unary '+' are tolerated (Excel habits);
 *  - formulas are capped at 8192 characters (Excel's own cell limit).
 *
 * NO eval / new Function — certification forbids dynamic code. Tokenizer +
 * shunting-yard → RPN, evaluated against a caller-provided lookup.
 * Null semantics: missing ref, null operand, division by zero, NaN and
 * non-finite results all yield null (rendered blank) — never a crash,
 * never Infinity. The variadic aggregates are the one Excel-style
 * exception: they skip null arguments (blank cells) and only return null
 * when EVERY argument is null — which also means an error-derived null
 * (÷0, overflow) inside an aggregate is skipped like a blank, not
 * propagated like Excel's #DIV/0!; documented trade-off of a blank-only
 * error channel. Comparisons normalize both operands to 15 significant
 * digits first (Excel semantics: 10% + 20% = 30% is TRUE).
 */

type FnName = "SUM" | "AVERAGE" | "MIN" | "MAX" | "ABS" | "ROUND" | "IF";

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "u-" | "%" | "=" | "<>" | "<" | "<=" | ">" | ">=" }
  | { t: "fn"; v: FnName; argc?: number }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" }
  | { t: ","; v: "," };

export type CompiledExpression =
  | {
      ok: true;
      refs: string[];
      evaluate: (lookup: (ref: string) => number | null) => number | null;
    }
  | { ok: false; error: string };

/** EN + FR spellings → canonical function name. */
const FN_ALIASES: Record<string, FnName> = {
  SUM: "SUM",
  SOMME: "SUM",
  AVERAGE: "AVERAGE",
  AVG: "AVERAGE",
  MOYENNE: "AVERAGE",
  MIN: "MIN",
  MAX: "MAX",
  ABS: "ABS",
  ROUND: "ROUND",
  ARRONDI: "ROUND",
  IF: "IF",
  SI: "IF"
};

const FN_ARITY: Record<FnName, { min: number; max: number }> = {
  SUM: { min: 1, max: Infinity },
  AVERAGE: { min: 1, max: Infinity },
  MIN: { min: 1, max: Infinity },
  MAX: { min: 1, max: Infinity },
  ABS: { min: 1, max: 1 },
  ROUND: { min: 1, max: 2 },
  IF: { min: 3, max: 3 }
};

const PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  "<=": 1,
  ">": 1,
  ">=": 1,
  "+": 2,
  "-": 2,
  "*": 3,
  "/": 3,
  "^": 4,
  "u-": 5
};

const hasOwn = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

function tokenize(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  // Excel habit: formulas pasted with their leading '='.
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  if (src[i] === "=") i++;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "[") {
      const close = src.indexOf("]", i + 1);
      if (close < 0) return "unclosed measure reference '['";
      const name = src.slice(i + 1, close).trim();
      if (!name) return "empty measure reference []";
      out.push({ t: "ref", v: name });
      i = close + 1;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) return `invalid number '${src.slice(i, j)}'`;
      out.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (c === "<" || c === ">" || c === "=") {
      const two = src.slice(i, i + 2);
      if (two === "<>" || two === "<=" || two === ">=") {
        out.push({ t: "op", v: two });
        i += 2;
      } else {
        out.push({ t: "op", v: c });
        i++;
      }
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "^" || c === "%") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "(", v: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: ")", v: ")" });
      i++;
      continue;
    }
    if (c === "," || c === ";") {
      out.push({ t: ",", v: "," });
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      if (!hasOwn(FN_ALIASES, word)) return `unknown function '${src.slice(i, j)}'`;
      out.push({ t: "fn", v: FN_ALIASES[word] });
      i = j;
      continue;
    }
    return `unexpected character '${c}'`;
  }
  return out;
}

/** A token that ends an operand — postfix '%' counts ("[a]% - 1" stays a
 *  binary minus, "% 5" is a misplaced percent). */
function endsOperand(tok: Token | undefined): boolean {
  return (
    tok !== undefined &&
    (tok.t === "num" || tok.t === "ref" || tok.t === ")" || (tok.t === "op" && tok.v === "%"))
  );
}

/** Mark unary minus ('-' with no operand before it) and DROP unary plus —
 *  "=+5", "+[a]-[b]", "2*+3" are Lotus-era Excel habits, no-ops here. */
function markUnary(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const tok of tokens) {
    const prevIsOperand = endsOperand(out[out.length - 1]);
    if (tok.t === "op" && tok.v === "-" && !prevIsOperand) {
      out.push({ t: "op", v: "u-" });
      continue;
    }
    if (tok.t === "op" && tok.v === "+" && !prevIsOperand) {
      continue;
    }
    out.push(tok);
  }
  return out;
}

function toRpn(tokens: Token[]): Token[] | string {
  const out: Token[] = [];
  const stack: Token[] = [];
  /** Innermost-first open parens: is it a function's, how many args so far. */
  const parens: { fn: boolean; args: number }[] = [];
  let prev: Token | undefined;
  for (const tok of tokens) {
    switch (tok.t) {
      case "num":
      case "ref":
        out.push(tok);
        break;
      case "fn":
        stack.push(tok);
        break;
      case ",": {
        if (!endsOperand(prev)) return "empty function argument";
        while (stack.length && stack[stack.length - 1].t !== "(") {
          const top = stack.pop() as Token;
          if (top.t === "fn") return `missing '(' after ${top.v}`;
          out.push(top);
        }
        if (!stack.length || !parens.length || !parens[parens.length - 1].fn) return "misplaced ','";
        parens[parens.length - 1].args++;
        break;
      }
      case "op": {
        if (tok.v === "%") {
          // Postfix percent binds tighter than everything: straight to
          // output — but ONLY right after an operand ("1 + %2" is invalid).
          if (!endsOperand(prev)) return "misplaced '%'";
          out.push(tok);
          break;
        }
        const p = PRECEDENCE[tok.v];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t === "op" && (PRECEDENCE[top.v] > p || (PRECEDENCE[top.v] === p && tok.v !== "u-"))) {
            out.push(stack.pop() as Token);
          } else break;
        }
        stack.push(tok);
        break;
      }
      case "(":
        parens.push({ fn: stack.length > 0 && stack[stack.length - 1].t === "fn", args: 1 });
        stack.push(tok);
        break;
      case ")": {
        if (prev !== undefined && prev.t === ",") return "empty function argument";
        while (stack.length && stack[stack.length - 1].t !== "(") {
          const top = stack.pop() as Token;
          if (top.t === "fn") return `missing '(' after ${top.v}`;
          out.push(top);
        }
        if (!stack.length) return "unbalanced ')'";
        stack.pop();
        const info = parens.pop();
        const emptyParens = prev !== undefined && prev.t === "(";
        if (stack.length && stack[stack.length - 1].t === "fn") {
          const fn = stack.pop() as Token & { t: "fn" };
          const argc = emptyParens ? 0 : info?.args ?? 1;
          const arity = FN_ARITY[fn.v];
          if (argc < arity.min || argc > arity.max) {
            return `wrong argument count for ${fn.v}`;
          }
          out.push({ t: "fn", v: fn.v, argc });
        } else if (emptyParens) {
          return "empty '()'";
        }
        break;
      }
    }
    prev = tok;
  }
  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.t === "(") return "unbalanced '('";
    if (top.t === "fn") return `missing '(' after ${top.v}`;
    out.push(top);
  }
  if (out.length === 0) return "empty expression";
  return out;
}

/** Excel-style ROUND: half away from zero, n decimals (n < 0 → tens…).
 *  Negative digits multiply back by an integer factor so ROUND(1005, -1)
 *  is exactly 1010 (dividing by 0.1 would leak float noise). Positive
 *  digits nudge the scaled value by a few ulps before rounding — binary
 *  floats put 1.005×100 at 100.4999…, which would otherwise round DOWN
 *  and betray the documented half-away-from-zero contract. */
function roundExcel(x: number, digits: number): number {
  const n = Math.max(-12, Math.min(12, Math.trunc(digits)));
  const f = Math.pow(10, Math.abs(n));
  const a = Math.abs(x);
  const s = n >= 0 ? a * f : a / f;
  const rounded = Math.round(s * (1 + 4 * Number.EPSILON));
  const r = n >= 0 ? rounded / f : rounded * f;
  return r === 0 ? 0 : Math.sign(x) * r;
}

/** Excel comparison semantics: operands normalized to 15 significant
 *  digits, so 10% + 20% = 30% is TRUE despite binary float noise. */
function cmpNorm(x: number): number {
  return Number(x.toPrecision(15));
}

/** Excel's own cell-formula limit — also the hostile-input backstop. */
const MAX_FORMULA_LENGTH = 8192;

export function compileExpression(formula: string): CompiledExpression {
  if (formula.length > MAX_FORMULA_LENGTH) {
    return { ok: false, error: `formula longer than ${MAX_FORMULA_LENGTH} characters` };
  }
  const raw = tokenize(formula);
  if (typeof raw === "string") return { ok: false, error: raw };
  const rpn = toRpn(markUnary(raw));
  if (typeof rpn === "string") return { ok: false, error: rpn };

  // Static arity check with a symbolic stack depth.
  let depth = 0;
  for (const tok of rpn) {
    if (tok.t === "num" || tok.t === "ref") depth++;
    else if (tok.t === "op") {
      depth -= tok.v === "u-" || tok.v === "%" ? 0 : 1;
      if (depth < 1) return { ok: false, error: "malformed expression" };
    } else if (tok.t === "fn") {
      depth -= (tok.argc ?? 1) - 1;
      if (depth < 1) return { ok: false, error: `wrong argument count for ${tok.v}` };
    }
  }
  if (depth !== 1) return { ok: false, error: "malformed expression" };

  const refs = [...new Set(rpn.filter((t) => t.t === "ref").map((t) => (t as { v: string }).v))];

  const evaluate = (lookup: (ref: string) => number | null): number | null => {
    const st: (number | null)[] = [];
    const num = (v: number | null | undefined): number | null =>
      v === null || v === undefined || !Number.isFinite(v) ? null : v;
    for (const tok of rpn) {
      if (tok.t === "num") st.push(tok.v);
      else if (tok.t === "ref") st.push(num(lookup(tok.v)));
      else if (tok.t === "op") {
        if (tok.v === "u-") {
          const a = num(st.pop());
          st.push(a === null ? null : -a);
        } else if (tok.v === "%") {
          const a = num(st.pop());
          st.push(a === null ? null : a / 100);
        } else {
          const b = num(st.pop());
          const a = num(st.pop());
          if (a === null || b === null) st.push(null);
          else if (tok.v === "+") st.push(a + b);
          else if (tok.v === "-") st.push(a - b);
          else if (tok.v === "*") st.push(a * b);
          else if (tok.v === "/") st.push(b === 0 ? null : a / b);
          else if (tok.v === "^") st.push(num(Math.pow(a, b)));
          else if (tok.v === "=") st.push(cmpNorm(a) === cmpNorm(b) ? 1 : 0);
          else if (tok.v === "<>") st.push(cmpNorm(a) !== cmpNorm(b) ? 1 : 0);
          else if (tok.v === "<") st.push(cmpNorm(a) < cmpNorm(b) ? 1 : 0);
          else if (tok.v === "<=") st.push(cmpNorm(a) <= cmpNorm(b) ? 1 : 0);
          else if (tok.v === ">") st.push(cmpNorm(a) > cmpNorm(b) ? 1 : 0);
          else st.push(cmpNorm(a) >= cmpNorm(b) ? 1 : 0);
        }
      } else if (tok.t === "fn") {
        const argc = tok.argc ?? 1;
        const args: (number | null)[] = new Array(argc);
        for (let k = argc - 1; k >= 0; k--) args[k] = num(st.pop());
        if (tok.v === "ABS") {
          st.push(args[0] === null ? null : Math.abs(args[0] as number));
        } else if (tok.v === "ROUND") {
          const x = args[0];
          const d = argc >= 2 ? args[1] : 0;
          st.push(x === null || d === null ? null : num(roundExcel(x, d)));
        } else if (tok.v === "IF") {
          const c = args[0];
          st.push(c === null ? null : c !== 0 ? args[1] : args[2]);
        } else {
          // Variadic aggregates skip nulls (Excel ignores blank cells).
          const vals = args.filter((v): v is number => v !== null);
          if (vals.length === 0) st.push(null);
          else if (tok.v === "SUM") st.push(vals.reduce((s, v) => s + v, 0));
          else if (tok.v === "AVERAGE") st.push(vals.reduce((s, v) => s + v, 0) / vals.length);
          else {
            // Loop, not spread: Math.min(...vals) blows the call stack on
            // very large argument counts.
            let m = vals[0];
            for (const v of vals) m = tok.v === "MIN" ? Math.min(m, v) : Math.max(m, v);
            st.push(m);
          }
        }
      }
    }
    const r = st.pop();
    return r === undefined || r === null || !Number.isFinite(r) ? null : r;
  };

  return { ok: true, refs, evaluate };
}

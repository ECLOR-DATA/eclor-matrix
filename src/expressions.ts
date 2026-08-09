"use strict";

/**
 * Hand-rolled expression engine for client-side calculated columns.
 * Grammar: numbers, measure refs in brackets ([Actual]), + - * / ( ),
 * unary minus, functions ABS(x), MIN(a,b), MAX(a,b).
 *
 * NO eval / new Function — certification forbids dynamic code. Tokenizer +
 * shunting-yard → RPN, evaluated against a caller-provided lookup.
 * Null semantics: missing ref, null operand, division by zero and NaN all
 * yield null (rendered blank) — never a crash, never Infinity.
 */

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "u-" }
  | { t: "fn"; v: "ABS" | "MIN" | "MAX" }
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

const FN_ARITY: Record<string, number> = { ABS: 1, MIN: 2, MAX: 2 };
const PRECEDENCE: Record<string, number> = { "+": 2, "-": 2, "*": 3, "/": 3, "u-": 4 };

function tokenize(src: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
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
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) return `invalid number '${src.slice(i, j)}'`;
      out.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
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
    if (c === ",") {
      out.push({ t: ",", v: "," });
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      if (!(word in FN_ARITY)) return `unknown function '${src.slice(i, j)}'`;
      out.push({ t: "fn", v: word as "ABS" | "MIN" | "MAX" });
      i = j;
      continue;
    }
    return `unexpected character '${c}'`;
  }
  return out;
}

/** Mark unary minus: '-' at start, after an operator, '(' or ','. */
function markUnary(tokens: Token[]): Token[] {
  return tokens.map((tok, idx) => {
    if (tok.t === "op" && tok.v === "-") {
      const prev = tokens[idx - 1];
      if (!prev || prev.t === "op" || prev.t === "(" || prev.t === ",") {
        return { t: "op", v: "u-" } as Token;
      }
    }
    return tok;
  });
}

function toRpn(tokens: Token[]): Token[] | string {
  const out: Token[] = [];
  const stack: Token[] = [];
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
        while (stack.length && stack[stack.length - 1].t !== "(") out.push(stack.pop() as Token);
        if (!stack.length) return "misplaced ','";
        break;
      }
      case "op": {
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
        stack.push(tok);
        break;
      case ")": {
        while (stack.length && stack[stack.length - 1].t !== "(") out.push(stack.pop() as Token);
        if (!stack.length) return "unbalanced ')'";
        stack.pop();
        if (stack.length && stack[stack.length - 1].t === "fn") out.push(stack.pop() as Token);
        break;
      }
    }
  }
  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.t === "(") return "unbalanced '('";
    out.push(top);
  }
  if (out.length === 0) return "empty expression";
  return out;
}

export function compileExpression(formula: string): CompiledExpression {
  const raw = tokenize(formula);
  if (typeof raw === "string") return { ok: false, error: raw };
  const rpn = toRpn(markUnary(raw));
  if (typeof rpn === "string") return { ok: false, error: rpn };

  // Static arity check with a symbolic stack depth.
  let depth = 0;
  for (const tok of rpn) {
    if (tok.t === "num" || tok.t === "ref") depth++;
    else if (tok.t === "op") {
      depth -= tok.v === "u-" ? 0 : 1;
      if (depth < 1) return { ok: false, error: "malformed expression" };
    } else if (tok.t === "fn") {
      depth -= FN_ARITY[tok.v] - 1;
      if (depth < 1) return { ok: false, error: `wrong argument count for ${tok.v}` };
    }
  }
  if (depth !== 1) return { ok: false, error: "malformed expression" };

  const refs = [...new Set(rpn.filter((t) => t.t === "ref").map((t) => (t as { v: string }).v))];

  const evaluate = (lookup: (ref: string) => number | null): number | null => {
    const st: (number | null)[] = [];
    const num = (v: number | null): number | null =>
      v === null || !Number.isFinite(v) ? null : v;
    for (const tok of rpn) {
      if (tok.t === "num") st.push(tok.v);
      else if (tok.t === "ref") st.push(num(lookup(tok.v)));
      else if (tok.t === "op") {
        if (tok.v === "u-") {
          const a = num(st.pop() as number | null);
          st.push(a === null ? null : -a);
        } else {
          const b = num(st.pop() as number | null);
          const a = num(st.pop() as number | null);
          if (a === null || b === null) st.push(null);
          else if (tok.v === "+") st.push(a + b);
          else if (tok.v === "-") st.push(a - b);
          else if (tok.v === "*") st.push(a * b);
          else st.push(b === 0 ? null : a / b);
        }
      } else if (tok.t === "fn") {
        if (tok.v === "ABS") {
          const a = num(st.pop() as number | null);
          st.push(a === null ? null : Math.abs(a));
        } else {
          const b = num(st.pop() as number | null);
          const a = num(st.pop() as number | null);
          if (a === null || b === null) st.push(null);
          else st.push(tok.v === "MIN" ? Math.min(a, b) : Math.max(a, b));
        }
      }
    }
    const r = st.pop();
    return r === undefined || r === null || !Number.isFinite(r) ? null : r;
  };

  return { ok: true, refs, evaluate };
}

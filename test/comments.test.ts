/**
 * comments.ts — pure extraction + inline-markup parser.
 */

import {
  commentMeasureIndexes,
  extractRowComments,
  MAX_COMMENT_LENGTH,
  parseCommentMarkup,
  plainCommentText
} from "../src/comments";
import { ColumnLeaf, RowModel } from "../src/matrixModel";

const row = (label: string, cells: (number | string | null)[]): RowModel => ({
  label,
  level: 0,
  isSubtotal: false,
  isCollapsed: false,
  isExpandable: false,
  node: {},
  cells
});

const leaf = (measureIndex: number, cellKey: number, path: string[] = []): ColumnLeaf => ({
  path,
  measureIndex,
  cellKey,
  isSubtotal: false
});

describe("commentMeasureIndexes", () => {
  test("comments-only measures detected; dual-role values win", () => {
    const idxs = commentMeasureIndexes([
      { roles: { values: true } },
      { roles: { comments: true } },
      { roles: { comments: true, values: true } },
      { roles: { tooltips: true } },
      {}
    ]);
    expect([...idxs]).toEqual([1]);
  });
});

describe("extractRowComments", () => {
  test("collects non-empty texts, keeps global cellKeys, dedupes per row", () => {
    // leaves: M0 (values) at key 0, M1 (comments) at key 1 — flat matrix.
    const leaves = [leaf(0, 0), leaf(1, 1)];
    const rows = [
      row("Revenue", [120, "**En avance** sur le plan"]),
      row("COGS", [-60, null]),
      row("Blank", [10, "   "])
    ];
    const out = extractRowComments(rows, leaves, new Set([1]));
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].text).toBe("**En avance** sur le plan");
    expect(out[0][0].measureIndex).toBe(1);
    expect(out[1]).toHaveLength(0);
    expect(out[2]).toHaveLength(0); // whitespace-only → no comment
  });

  test("column groups: distinct texts kept with path labels, duplicates dropped", () => {
    // 2 groups × (M0 values, M1 comments): keys 0..3.
    const leaves = [
      leaf(0, 0, ["2025"]),
      leaf(1, 1, ["2025"]),
      leaf(0, 2, ["2026"]),
      leaf(1, 3, ["2026"])
    ];
    const rows = [
      row("A", [1, "retard", 2, "rattrapé"]),
      row("B", [1, "idem", 2, "idem"])
    ];
    const out = extractRowComments(rows, leaves, new Set([1]));
    expect(out[0].map((c) => c.text)).toEqual(["retard", "rattrapé"]);
    expect(out[0].map((c) => c.pathLabel)).toEqual(["2025", "2026"]);
    expect(out[1]).toHaveLength(1); // identical text deduped
  });

  test("numeric comment cells are stringified, empty comment set is cheap", () => {
    const leaves = [leaf(0, 0), leaf(1, 1)];
    const rows = [row("A", [1, 42])];
    expect(extractRowComments(rows, leaves, new Set([1]))[0][0].text).toBe("42");
    expect(extractRowComments(rows, leaves, new Set())[0]).toEqual([]);
  });

  test("custom (woven) rows never sprout comments", () => {
    const leaves = [leaf(0, 0), leaf(1, 1)];
    const woven = { ...row("Marge", [220, 100]), customDef: { id: "x", kind: "formula" } };
    const out = extractRowComments([row("A", [1, "vrai"]), woven], leaves, new Set([1]));
    expect(out[0]).toHaveLength(1);
    expect(out[1]).toEqual([]); // the formula's numeric 100 is NOT a comment
  });

  test("same text across every group = row-level comment (no group badge)", () => {
    const leaves = [leaf(1, 0, ["2025"]), leaf(1, 1, ["2026"])];
    const out = extractRowComments([row("A", ["pareil", "pareil"])], leaves, new Set([1]));
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].pathLabel).toBe("");
  });
});

describe("parseCommentMarkup", () => {
  test("plain text is one unstyled segment", () => {
    expect(parseCommentMarkup("hello world")).toEqual([
      { text: "hello world", bold: false, italic: false, underline: false, color: "" }
    ]);
  });

  test("bold / italic / underline toggles", () => {
    const segs = parseCommentMarkup("a **b** *c* __d__");
    expect(segs.map((s) => [s.text, s.bold, s.italic, s.underline])).toEqual([
      ["a ", false, false, false],
      ["b", true, false, false],
      [" ", false, false, false],
      ["c", false, true, false],
      [" ", false, false, false],
      ["d", false, false, true]
    ]);
  });

  test("colour tags, valid and invalid", () => {
    const segs = parseCommentMarkup("ok [#FF4D6D]alerte[/#] fin");
    expect(segs[1]).toEqual({
      text: "alerte",
      bold: false,
      italic: false,
      underline: false,
      color: "#FF4D6D"
    });
    // 3-digit hex accepted, uppercased.
    expect(parseCommentMarkup("[#f00]x[/#]")[0].color).toBe("#F00");
    // Malformed tag → literal text, no crash.
    expect(plainCommentText("[#GGGGGG]x[/#]")).toBe("[#GGGGGG]x[/#]");
    expect(plainCommentText("[#FF4D6D x")).toBe("[#FF4D6D x");
  });

  test("colour needs its closer — ticket references stay literal", () => {
    expect(plainCommentText("voir ticket [#123] pour le détail")).toBe(
      "voir ticket [#123] pour le détail"
    );
    expect(plainCommentText("[#404] introuvable")).toBe("[#404] introuvable");
    // With a closer, 3-digit colours still work.
    const segs = parseCommentMarkup("[#123]x[/#]");
    expect(segs[0].color).toBe("#123");
  });

  test("data fidelity: multiplication and snake_case never corrupted", () => {
    expect(plainCommentText("2*3*4 = 24")).toBe("2*3*4 = 24");
    expect(plainCommentText("2 * 3 = 6")).toBe("2 * 3 = 6");
    expect(plainCommentText("MY__TABLE__NAME")).toBe("MY__TABLE__NAME");
    // Word-start markers still style.
    const segs = parseCommentMarkup("vrai *italique* et __souligné__");
    expect(segs[1]).toMatchObject({ text: "italique", italic: true });
    expect(segs[3]).toMatchObject({ text: "souligné", underline: true });
    // Bold+italic combo via *** still works (marker-adjacent opening).
    const combo = parseCommentMarkup("***les deux***");
    expect(combo[0]).toMatchObject({ text: "les deux", bold: true, italic: true });
  });

  test("comment text capped with an ellipsis", () => {
    const long = "x".repeat(MAX_COMMENT_LENGTH + 500);
    expect(plainCommentText(long)).toHaveLength(MAX_COMMENT_LENGTH + 1);
    const leaves = [leaf(0, 0), leaf(1, 1)];
    const out = extractRowComments([row("A", [1, long])], leaves, new Set([1]));
    expect(out[0][0].text.endsWith("…")).toBe(true);
    expect(out[0][0].text).toHaveLength(MAX_COMMENT_LENGTH + 1);
  });

  test("nesting and unclosed markers style to the end (forgiving)", () => {
    const segs = parseCommentMarkup("**gras *et italique*** reste");
    expect(segs[0]).toMatchObject({ text: "gras ", bold: true, italic: false });
    expect(segs[1]).toMatchObject({ text: "et italique", bold: true, italic: true });
    const open = parseCommentMarkup("**jamais fermé");
    expect(open[0]).toMatchObject({ text: "jamais fermé", bold: true });
    // Stray colour closer stays literal.
    expect(plainCommentText("x[/#]y")).toBe("x[/#]y");
  });

  test("plainCommentText strips every marker", () => {
    expect(plainCommentText("**a** *b* __c__ [#FF4D6D]d[/#]")).toBe("a b c d");
    expect(plainCommentText("")).toBe("");
  });
});

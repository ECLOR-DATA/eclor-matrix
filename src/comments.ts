"use strict";

/**
 * Data comments — the Zebra-style commenting layer, fed from the MODEL.
 *
 * A certified custom visual cannot call any external service (SharePoint,
 * Graph, anything): comments therefore travel through the semantic model —
 * a SharePoint list or Excel table loaded by Power Query, related to the
 * dimension keys, exposed as a TEXT MEASURE bound to the `comments` data
 * role. RLS and the source's own permissions apply upstream; the visual
 * only ever sees the already-authorized text. Writing happens in the
 * source (list/Excel), a dataset refresh brings it in. Full portable
 * architecture, DAX patterns and access-management notes: docs/COMMENTS.md.
 *
 * This module is PURE (no host, no DOM): extraction of per-row comments
 * from the flattened matrix model, and a forgiving inline-markup parser
 * that outputs styled SEGMENTS. The renderer builds spans from segments
 * with createElement/textContent only: no HTML string ever, by design.
 *
 * Markup rules (data-fidelity first — authors type free text in Excel):
 *  - `**bold**` toggles anywhere;
 *  - `*italic*` and `__underline__` OPEN only at a word start (preceded by
 *    start-of-text, whitespace or another marker, followed by non-space) —
 *    so "2*3*4 = 24" and "MY__TABLE__NAME" stay literal;
 *  - `[#RRGGBB]…[/#]` colours only when the CLOSING `[/#]` exists — a
 *    ticket reference like "[#123]" without a closer stays literal;
 *  - unclosed **­/*­/__ markers style to the end (authors forget closers);
 *  - comment text is capped at MAX_COMMENT_LENGTH characters (ellipsis).
 */

import { ColumnLeaf, RowModel } from "./matrixModel";

/** Hostile-input backstop — also bounds the markup parser's worst case. */
export const MAX_COMMENT_LENGTH = 2000;

export interface CommentSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Hex colour from [#RRGGBB] / [#RGB] markup, "" = inherit. */
  color: string;
}

export interface RowComment {
  /** Index into valueSources of the comment measure. */
  measureIndex: number;
  /** Column-group path of the leaf that carried the text — "" when flat OR
   *  when the same text repeats across groups (a row-level comment). */
  pathLabel: string;
  text: string;
}

/** Measure indexes whose role is comments (and not values). */
export function commentMeasureIndexes(
  valueSources: { roles?: Record<string, boolean> }[]
): Set<number> {
  const out = new Set<number>();
  valueSources.forEach((vs, i) => {
    if (vs.roles?.comments === true && vs.roles?.values !== true) out.add(i);
  });
  return out;
}

/**
 * Collect the comments of every row: for each comment-role leaf, the row's
 * cell text (non-empty, deduplicated per row; a text repeated across
 * column groups is a row-level comment and loses its group badge). Custom
 * rows (woven client-side) never carry comments — they don't exist in the
 * model, and their formula cells at comment ordinals are numeric noise.
 * Cell keys are the DFS ordinals over ALL column leaves — comment leaves
 * keep their global cellKey exactly like tooltip-only leaves.
 */
export function extractRowComments(
  rows: RowModel[],
  leaves: ColumnLeaf[],
  commentIdxs: Set<number>
): RowComment[][] {
  if (commentIdxs.size === 0) return rows.map(() => []);
  const commentLeaves: { leafIdx: number; leaf: ColumnLeaf }[] = [];
  leaves.forEach((leaf, leafIdx) => {
    if (commentIdxs.has(leaf.measureIndex)) commentLeaves.push({ leafIdx, leaf });
  });
  return rows.map((row) => {
    if ((row as { customDef?: unknown }).customDef) return [];
    const byText = new Map<string, RowComment & { count: number }>();
    for (const { leafIdx, leaf } of commentLeaves) {
      const raw = row.cells[leafIdx];
      if (raw === null || raw === undefined) continue;
      let text = String(raw).trim();
      if (!text) continue;
      if (text.length > MAX_COMMENT_LENGTH) text = text.slice(0, MAX_COMMENT_LENGTH) + "…";
      const existing = byText.get(text);
      if (existing) {
        existing.count++;
        continue;
      }
      byText.set(text, {
        measureIndex: leaf.measureIndex,
        pathLabel: leaf.path.filter((p) => p.length > 0).join(" · "),
        text,
        count: 1
      });
    }
    return [...byText.values()].map((c) => ({
      measureIndex: c.measureIndex,
      pathLabel: c.count > 1 ? "" : c.pathLabel,
      text: c.text
    }));
  });
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isSpace = (c: string | undefined): boolean =>
  c === " " || c === "\t" || c === "\r" || c === "\n" || c === " ";

/** Word-flanking test for the *italic* / __underline__ markers: opens only
 *  at a word start, closes only right after a non-space. */
function flanked(
  src: string,
  i: number,
  markerLen: number,
  active: boolean,
  atWordStart: boolean
): boolean {
  if (active) return !isSpace(src[i - 1]);
  return atWordStart && src[i + markerLen] !== undefined && !isSpace(src[i + markerLen]);
}

/**
 * Parse the inline markup into flat styled segments. Forgiving by design
 * (authors type in Excel/SharePoint): unclosed bold/italic/underline
 * style to the end, a colour tag without its `[/#]` closer is literal,
 * nesting of bold/italic/underline/colour is free.
 */
export function parseCommentMarkup(src: string): CommentSegment[] {
  if (src.length > MAX_COMMENT_LENGTH) src = src.slice(0, MAX_COMMENT_LENGTH) + "…";
  const segments: CommentSegment[] = [];
  let buf = "";
  let bold = false;
  let italic = false;
  let underline = false;
  const colors: string[] = [];
  /** True right after consuming a marker — lets "***x" open bold+italic. */
  let prevWasMarker = false;

  const flush = (): void => {
    if (buf.length > 0) {
      segments.push({
        text: buf,
        bold,
        italic,
        underline,
        color: colors.length > 0 ? colors[colors.length - 1] : ""
      });
      buf = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const atWordStart = i === 0 || isSpace(src[i - 1]) || prevWasMarker;
    if (src.startsWith("**", i)) {
      flush();
      bold = !bold;
      prevWasMarker = true;
      i += 2;
      continue;
    }
    if (src.startsWith("__", i)) {
      // Word-flanking rule: "MY__TABLE__NAME" stays literal.
      if (flanked(src, i, 2, underline, atWordStart)) {
        flush();
        underline = !underline;
        prevWasMarker = true;
      } else {
        buf += "__";
        prevWasMarker = false;
      }
      i += 2;
      continue;
    }
    if (src[i] === "*") {
      // Word-flanking rule: "2*3*4 = 24" stays literal.
      if (flanked(src, i, 1, italic, atWordStart)) {
        flush();
        italic = !italic;
        prevWasMarker = true;
      } else {
        buf += "*";
        prevWasMarker = false;
      }
      i += 1;
      continue;
    }
    if (src.startsWith("[/#]", i)) {
      if (colors.length > 0) {
        flush();
        colors.pop();
        prevWasMarker = true;
        i += 4;
        continue;
      }
      // Stray closer with no open colour: literal.
      buf += "[/#]";
      prevWasMarker = false;
      i += 4;
      continue;
    }
    if (src.startsWith("[#", i)) {
      const close = src.indexOf("]", i + 1);
      const candidate = close > i ? src.slice(i + 1, close) : "";
      // A colour tag counts only when its [/#] closer exists — "[#123]"
      // ticket references stay literal.
      if (close > i && HEX_RE.test(candidate) && src.indexOf("[/#]", close) >= 0) {
        flush();
        colors.push(candidate.toUpperCase());
        prevWasMarker = true;
        i = close + 1;
        continue;
      }
      buf += src[i];
      prevWasMarker = false;
      i += 1;
      continue;
    }
    buf += src[i];
    prevWasMarker = false;
    i += 1;
  }
  flush();
  return segments;
}

/** Markup stripped — for aria-labels, tooltips and marker titles. */
export function plainCommentText(src: string): string {
  return parseCommentMarkup(src)
    .map((s) => s.text)
    .join("");
}

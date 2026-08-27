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
 * from the flattened matrix model, and a forgiving inline-markup parser —
 * **bold**, *italic*, __underline__, [#RRGGBB]colored[/#] — that outputs
 * styled SEGMENTS. The renderer builds spans from segments with
 * createElement/textContent only: no HTML string ever, by design.
 */

import { ColumnLeaf, RowModel } from "./matrixModel";

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
  /** Column-group path of the leaf that carried the text ("" when flat). */
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
 * cell text (non-empty, deduplicated per row). Cell keys are the DFS
 * ordinals over ALL column leaves — comment leaves keep their global
 * cellKey exactly like tooltip-only leaves, never re-indexed.
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
    const out: RowComment[] = [];
    const seen = new Set<string>();
    for (const { leafIdx, leaf } of commentLeaves) {
      const raw = row.cells[leafIdx];
      if (raw === null || raw === undefined) continue;
      const text = String(raw).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({
        measureIndex: leaf.measureIndex,
        pathLabel: leaf.path.filter((p) => p.length > 0).join(" · "),
        text
      });
    }
    return out;
  });
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parse the inline markup into flat styled segments. Forgiving by design
 * (authors type in Excel/SharePoint): an unclosed marker styles the text
 * to the end; a malformed colour tag is kept as literal text; nesting of
 * bold/italic/underline/colour is free.
 */
export function parseCommentMarkup(src: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let buf = "";
  let bold = false;
  let italic = false;
  let underline = false;
  const colors: string[] = [];

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
    if (src.startsWith("**", i)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (src.startsWith("__", i)) {
      flush();
      underline = !underline;
      i += 2;
      continue;
    }
    if (src[i] === "*") {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    if (src.startsWith("[/#]", i)) {
      if (colors.length > 0) {
        flush();
        colors.pop();
        i += 4;
        continue;
      }
      // Stray closer with no open colour: literal.
      buf += "[/#]";
      i += 4;
      continue;
    }
    if (src.startsWith("[#", i)) {
      const close = src.indexOf("]", i + 1);
      const candidate = close > i ? src.slice(i + 1, close) : "";
      if (close > i && HEX_RE.test(candidate)) {
        flush();
        colors.push(candidate.toUpperCase());
        i = close + 1;
        continue;
      }
      // Not a valid colour tag: literal '['.
      buf += src[i];
      i += 1;
      continue;
    }
    buf += src[i];
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

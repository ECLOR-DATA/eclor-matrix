"use strict";

/**
 * Pure windowed-rendering math for virtual scrolling. Rows are single-line
 * (`white-space: nowrap`) so a uniform row height holds; the window is a
 * contiguous slice padded by spacer heights above and below.
 */

export interface WindowSpec {
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  topPad: number;
  bottomPad: number;
}

export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan: number
): WindowSpec {
  const safeRowHeight = rowHeight > 0 ? rowHeight : 1;
  const safeScroll = Math.max(0, scrollTop);
  const first = Math.floor(safeScroll / safeRowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / safeRowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(totalRows, first + visible + overscan);
  return {
    start,
    end: Math.max(start, end),
    topPad: start * safeRowHeight,
    bottomPad: Math.max(0, totalRows - Math.max(start, end)) * safeRowHeight
  };
}

/** Uniform row-height estimate from the density/text settings — mirrors the
 *  paddings in style/visual.less (compact 1px, normal 4px, comfortable 8px)
 *  plus the 1px horizontal grid rule. */
export function estimateRowHeight(textSize: number, density: string): number {
  const padY = density === "compact" ? 1 : density === "comfortable" ? 8 : 4;
  return Math.round(textSize * 1.45) + padY * 2 + 1;
}

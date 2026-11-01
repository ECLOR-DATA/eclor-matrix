/**
 * Manifest / listing guards (audit MAN-05): the pane icon must be a 20×20
 * RGBA PNG of its own — the 1.0 placeholder was the Eclor Waterfall icon.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ICON = fs.readFileSync(path.join(__dirname, "..", "assets", "icon.png"));
const WATERFALL_ICON_MD5 = "99a8a60fd72b9db25d7182438fadb5d3";

const readLocale = (locale: string): Record<string, string> =>
  JSON.parse(
    fs
      .readFileSync(path.join(__dirname, "..", "stringResources", locale, "resources.resjson"), "utf8")
      .replace(/^﻿/, "")
  );

// Audit I18N-01 / I18N-03: nothing guarded the locales, and a literal slipped
// through in the column grips.
describe("localization", () => {
  const en = readLocale("en-US");
  const fr = readLocale("fr-FR");

  test("en-US and fr-FR carry the same keys", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  test("every localize() key used by the visual exists", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "visual.ts"), "utf8");
    const used = [...src.matchAll(/localize\(\s*"(Visual_\w+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((k) => !(k in en))).toEqual([]);
  });

  test("column grip tooltip is localized in both locales", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "visual.ts"), "utf8");
    expect(src).not.toContain('setAttribute("title", "Drag');
    expect(en.Visual_ColumnGripTitle).toBeTruthy();
    expect(fr.Visual_ColumnGripTitle).toBeTruthy();
    expect(fr.Visual_ColumnGripTitle).not.toBe(en.Visual_ColumnGripTitle);
  });
});

describe("assets/icon.png", () => {
  test("is a 20×20 RGBA PNG", () => {
    expect(ICON.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(ICON.readUInt32BE(16)).toBe(20); // IHDR width
    expect(ICON.readUInt32BE(20)).toBe(20); // IHDR height
    expect(ICON[25]).toBe(6); // colour type 6 = RGBA
  });

  test("is not the Eclor Waterfall placeholder", () => {
    expect(crypto.createHash("md5").update(ICON).digest("hex")).not.toBe(WATERFALL_ICON_MD5);
  });
});

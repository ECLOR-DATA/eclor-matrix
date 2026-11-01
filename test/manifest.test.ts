/**
 * Manifest / listing guards (audit MAN-05): the pane icon must be a 20×20
 * RGBA PNG of its own — the 1.0 placeholder was the Eclor Waterfall icon.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ICON = fs.readFileSync(path.join(__dirname, "..", "assets", "icon.png"));
const WATERFALL_ICON_MD5 = "99a8a60fd72b9db25d7182438fadb5d3";

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

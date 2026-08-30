// Rasterise tools/snapshots/*.html (written by `RENDER_SNAPSHOTS=1 jest
// test/snapshots.test.ts`) into tools/screens/*.png with headless Chromium.
// Dev-only tooling — playwright-core is NOT a committed dependency; install
// on demand with `npm i --no-save playwright-core` (or have Playwright's
// browser at PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH).

import { readdirSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const SNAP_DIR = resolve(new URL(".", import.meta.url).pathname, "snapshots");
const OUT_DIR = resolve(new URL(".", import.meta.url).pathname, "screens");

async function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  const { existsSync, statSync, readdirSync: rd } = await import("node:fs");
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (statSync(c).isFile()) return c;
    // PLAYWRIGHT_BROWSERS_PATH-style directory: find the binary inside.
    const stack = [c];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of rd(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === "chrome" || e.name === "chromium" || e.name === "headless_shell") return p;
      }
    }
  }
  return null;
}

const { chromium } = await import("playwright-core");
const executablePath = await findChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ deviceScaleFactor: 2 });
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith(".html")).sort();
if (files.length === 0) {
  console.error("No snapshots found — run: RENDER_SNAPSHOTS=1 npx jest test/snapshots.test.ts");
  process.exit(1);
}
for (const f of files) {
  await page.goto("file://" + join(SNAP_DIR, f));
  await page.waitForTimeout(80);
  const name = f.replace(/\.html$/, ".png");
  await page.locator(".shot").screenshot({ path: join(OUT_DIR, name) });
  console.log("✓", name);
}
await browser.close();

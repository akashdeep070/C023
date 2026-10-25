// Builds the pitch deck from docs/deck/index.html:
//   docs/pitch-deck.html  one self-contained file (screenshots and fonts inlined)
//   docs/pitch-deck.pdf   printed by Chromium, one 1280 × 720 page per slide
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "docs/deck/index.html");
const htmlOut = path.join(root, "docs/pitch-deck.html");
const pdfOut = path.join(root, "docs/pitch-deck.pdf");
const MIME = { ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

/** A local file as a data: URL, so the deck is one file that opens anywhere. */
function inline(rel) {
  const file = path.resolve(path.dirname(source), rel);
  return `data:${MIME[path.extname(file)]};base64,${readFileSync(file).toString("base64")}`;
}

const html = readFileSync(source, "utf8")
  .replace(/src="([^"]+\.(?:jpg|png|svg))"/g, (_, rel) => `src="${inline(rel)}"`)
  .replace(/url\("([^"]+\.woff2)"\)/g, (_, rel) => `url("${inline(rel)}")`);
writeFileSync(htmlOut, html);
console.log(`Wrote ${path.relative(root, htmlOut)} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);

// Resolved like require(), so a global install found through NODE_PATH works too
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Playwright isn't installed, so no PDF was made. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlOut).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: pdfOut, preferCSSPageSize: true, printBackground: true });
await browser.close();
console.log(`Wrote ${path.relative(root, pdfOut)}`);

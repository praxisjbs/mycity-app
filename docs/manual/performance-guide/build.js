"use strict";
/**
 * The Performance training and test guide: one A4 document for trainers and for MyCity, built from
 * template.html, the screenshots in img/ and the brand files in brand/ into a single standalone
 * page that opens offline and prints to PDF.
 *
 *   node docs/manual/performance-guide/build.js           dist/MyCity-PMS-Training-Guide.html
 *   node docs/manual/performance-guide/build.js --check   also measures every page against A4,
 *                                                         fails when one overflows or the guide
 *                                                         passes 17 pages, and prints the PDF
 *
 * It states only what is built. A change to a screen it shows updates its page here, with a new
 * screenshot from the hub on the staging seed, cropped to what the page needs.
 */
const fs = require("node:fs");
const path = require("node:path");

const HERE = __dirname;
const OUT = path.join(HERE, "dist");
const NAME = "MyCity-PMS-Training-Guide";
const MAX_PAGES = 17;

const uri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;

function build() {
  let html = fs.readFileSync(path.join(HERE, "template.html"), "utf8");
  html = html
    .replaceAll("{{FONTS}}", () => fs.readFileSync(path.join(HERE, "brand", "fonts.css"), "utf8"))
    .replaceAll("{{LOGO_GREY}}", () => uri(path.join(HERE, "brand", "logo-grey.png"), "image/png"))
    .replaceAll("{{LOGO_FULL}}", () => uri(path.join(HERE, "brand", "logo-full.png"), "image/png"));
  const missing = [];
  html = html.replace(/\{\{img:([a-z0-9-]+)\}\}/g, (tag, name) => {
    const file = path.join(HERE, "img", `${name}.jpg`);
    if (!fs.existsSync(file)) {
      missing.push(name);
      return tag;
    }
    return uri(file, "image/jpeg");
  });
  if (missing.length) throw new Error(`missing screenshots: ${missing.join(", ")}`);
  const left = html.match(/\{\{[^}]*\}\}/g);
  if (left) throw new Error(`unreplaced placeholders: ${left.join(", ")}`);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${NAME}.html`);
  fs.writeFileSync(file, html);
  return file;
}

/** Each page's spare height in print, the PDF, and a refusal when a page overflows. */
async function check(file) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1.5 });
    await page.goto(`file://${file}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print" });
    const pages = await page.evaluate(() =>
      [...document.querySelectorAll(".page")].map((pg) => {
        const body = pg.querySelector(".pc") || pg.querySelector(".cover");
        const inner = pg.querySelector(".inner") || body;
        const available = body.getBoundingClientRect().height;
        // Measured at its natural height: the page's flex layout would otherwise stretch it to fit.
        const natural = document.createElement("style");
        natural.textContent = `#${pg.id} .inner,#${pg.id} .cover{flex:none!important;height:auto!important}#${pg.id} .grow{flex:none!important}#${pg.id} .meta-grid{margin-top:0!important}`;
        document.head.appendChild(natural);
        const needed = inner.getBoundingClientRect().height;
        natural.remove();
        return { page: pg.id, spare_px: Math.round(available - needed) };
      }),
    );
    console.table(pages);
    const pdf = path.join(OUT, `${NAME}.pdf`);
    await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
    console.log(pdf);
    const over = pages.filter((p) => p.spare_px < 0).map((p) => p.page);
    if (over.length) throw new Error(`overflowing A4: ${over.join(", ")}`);
    if (pages.length > MAX_PAGES) throw new Error(`${pages.length} pages, more than ${MAX_PAGES}`);
  } finally {
    await browser.close();
  }
}

(async () => {
  const file = build();
  console.log(file, `${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
  if (process.argv.includes("--check")) await check(file);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

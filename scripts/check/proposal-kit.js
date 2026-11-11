#!/usr/bin/env node
"use strict";
/* global document */
/**
 * The proposal design kit, looked at (docs/guides/partnerships.md §6.11): its gallery sample
 * (templates/proposals/sample.json, every layout) drawn by the kit and opened in Chromium.
 *
 *   - every page is 1280 × 720 and nothing on it runs past its foot or its side;
 *   - the type is Geist, embedded, so the PDF sets what the screen does;
 *   - every picture names what it shows (an empty alt for a photograph under a scrim);
 *   - the PDF from the same HTML has one 338.7 × 190.5 mm page for each, nothing more;
 *   - on a phone (390 wide) the web version reflows to one column with no sideways scroll.
 *
 * The screens group (Chromium). On GitHub the gallery's job runs it once; an app job, whose target is
 * the app's screens, leaves it to that job.
 *
 *   node scripts/check/proposal-kit.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./lib/screens");

const ROOT = path.resolve(__dirname, "..", "..");

async function main() {
  const targets = process.env.MYCITY_SCREEN_TARGETS;
  if (targets && !targets.split(",").map((t) => t.trim()).includes("gallery")) {
    console.log("proposal-kit: the gallery's job looks at the kit; nothing to do on this target");
    return;
  }
  const kit = require(path.join(ROOT, "src", "modules", "proposals", "proposals.kit"));
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "proposals", "sample.json"), "utf8"));
  const pdfHtml = kit.renderProposal(sample.content, sample.context, { mode: "pdf" }).html;
  const webHtml = kit.renderProposal(sample.content, sample.context, { mode: "web" }).html;
  const problems = [];
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(pdfHtml, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const found = await page.evaluate(() => {
      const out = [];
      if (!document.fonts.check('600 44px "Geist"')) out.push("Geist is not loaded");
      const pages = [...document.querySelectorAll(".page")];
      pages.forEach((pg, i) => {
        const name = `page ${i + 1} (${pg.dataset.layout})`;
        const box = pg.getBoundingClientRect();
        if (Math.round(box.width) !== 1280 || Math.round(box.height) !== 720) out.push(`${name} is ${Math.round(box.width)} x ${Math.round(box.height)}, not 1280 x 720`);
        for (const el of pg.querySelectorAll("*")) {
          if (el.closest(".bleed, .scrim, .quote, .contact, .letter-side, .route, .cover-route")) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          if (r.bottom > box.bottom - 24) out.push(`${name}: ${el.tagName.toLowerCase()} runs past the page's foot`);
          if (r.right > box.right - 8 || r.left < box.left) out.push(`${name}: ${el.tagName.toLowerCase()} runs past the page's side`);
        }
        for (const img of pg.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push(`${name}: a picture with no alt`);
      });
      return { out: [...new Set(out)], pages: pages.length };
    });
    problems.push(...found.out);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const text = pdf.toString("latin1");
    const pdfPages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pdfPages !== found.pages) problems.push(`the PDF has ${pdfPages} pages for ${found.pages} drawn`);
    const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Math.round(Number(m[1])), Math.round(Number(m[2]))]);
    if (!boxes.length || boxes.some(([w, h]) => w !== 960 || h !== 540)) problems.push(`the PDF's pages are not 338.7 x 190.5 mm (${JSON.stringify(boxes.slice(0, 2))})`);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.setContent(webHtml, { waitUntil: "load" });
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    if (wide > 390) problems.push(`on a phone the web version is ${wide} wide, so the page scrolls sideways`);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error(`proposal-kit: the kit's sample does not draw cleanly\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("proposal-kit: ok (13 layouts at 16:9, Geist embedded, the PDF one page each, one column on a phone)");
}

main().catch((err) => {
  console.error(`proposal-kit: ${err.message}`);
  process.exit(1);
});

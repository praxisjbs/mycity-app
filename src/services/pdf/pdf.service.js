"use strict";
/**
 * HTML to PDF, in the worker, through Chromium (services/pdf/chromium.js).
 *
 *   const buffer = await pdf.render(html, { footer: "QRY-0028" });
 *
 * The HTML comes from our own templates with escaped values, but it is still treated
 * as untrusted when it is rendered:
 *  - JavaScript is off in the page;
 *  - every network request is refused except data: URLs, so a template (or a value in
 *    it) cannot make the server fetch anything, and every PDF renders the same offline;
 *  - fonts and images are embedded as data: URLs by the caller (shared/documents/generate.js).
 *
 * A4, backgrounds printed, the page's own @page margins honoured, and a small footer with
 * the page number ("Page 2 of 3") and an optional reference on every page.
 * The return value is always a Node Buffer of exactly the PDF's bytes.
 */
const chromium = require("./chromium");
const { escapeHtml } = require("../../shared/documents/markdown");

const RENDER_TIMEOUT_MS = 45_000;

function footerTemplate(ref) {
  const left = ref ? `<span>${escapeHtml(ref)}</span>` : "<span></span>";
  return `<div style="width:100%;font-size:7.5pt;color:#71717A;padding:0 18mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif;">
    ${left}<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

/**
 * @param {string} html  a complete HTML document
 * @param {{footer?: string|null, landscape?: boolean}} [opts]
 *   footer  a reference printed bottom-left on every page (the document number)
 * @returns {Promise<Buffer>}
 */
async function render(html, { footer = null, landscape = false } = {}) {
  if (typeof html !== "string" || !html.trim())
    throw new Error("pdf.render: give the HTML");
  return chromium.withPage(async (page) => {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") req.continue();
      else req.abort("blockedbyclient");
    });
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setContent(html, {
      waitUntil: "load",
      timeout: RENDER_TIMEOUT_MS,
    });
    await page.emulateMediaType("print");
    const bytes = await page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footerTemplate(footer),
      timeout: RENDER_TIMEOUT_MS,
    });
    return Buffer.from(bytes);
  });
}

module.exports = { render, health: chromium.health, close: chromium.close };

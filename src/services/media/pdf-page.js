"use strict";
/**
 * Draw a PDF's first page to a PNG, in a process of its own (services/media/pdf-pipeline.js
 * starts it with a time and memory limit, so a PDF that is broken, huge or hostile can only
 * stop this process, never the worker).
 *
 *   node src/services/media/pdf-page.js <in.pdf> <out.png> <width>
 *   // prints one line of JSON: {"page_count":3,"width":595,"height":842}
 *
 * width and height are the first page's size in points, its rotation applied. The picture
 * is `width` pixels wide, on white, and at most four times as tall as it is wide. Nothing
 * in the PDF runs: no scripts, no eval, fonts drawn from their outlines.
 */
const fs = require("node:fs");
const path = require("node:path");

async function drawFirstPage(input, output, width) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const data = new Uint8Array(await fs.promises.readFile(input));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: `${path.join(root, "standard_fonts")}${path.sep}`,
    cMapUrl: `${path.join(root, "cmaps")}${path.sep}`,
    cMapPacked: true,
    wasmUrl: `${path.join(root, "wasm")}${path.sep}`,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    let scale = width / base.width;
    if (base.height * scale > width * 4) scale = (width * 4) / base.height;
    const viewport = page.getViewport({ scale });
    const { canvas, context } = doc.canvasFactory.create(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    await fs.promises.writeFile(output, canvas.toBuffer("image/png"));
    return {
      page_count: doc.numPages,
      width: Math.max(1, Math.round(base.width)),
      height: Math.max(1, Math.round(base.height)),
    };
  } finally {
    await doc.destroy();
  }
}

if (require.main === module) {
  const [input, output, width] = process.argv.slice(2);
  drawFirstPage(input, output, Number(width) || 960)
    .then((info) => {
      process.stdout.write(`${JSON.stringify(info)}\n`);
    })
    .catch((err) => {
      process.stderr.write(`${err && err.name ? err.name : "Error"}: ${err && err.message ? err.message : err}\n`);
      process.exitCode = 1;
    });
}

module.exports = { drawFirstPage };

"use strict";
/**
 * A PDF's first page as pictures, and its page count (BACKEND_STRUCTURE §5.3;
 * docs/guides/community.md §3 step 17). Runs in the worker (media-derive), never in a
 * request: a PDF can take a second or more to draw.
 *
 *   const out = await pdf.derive({ document_id, storage_key });
 *   // { page_count, width, height (the first page, in points),
 *   //   variants: [{ kind: "webp-960", key, mime, bytes, width, height }, { kind: "webp-320", ... }] }
 *
 * The page is drawn by PDF.js (pdfjs-dist, the same library the app's viewer uses) in a
 * child process of its own (pdf-page.js) with a 60 second limit and 512 MB of memory, so a
 * broken, huge or hostile PDF stops that process and never the worker. The two sizes are
 * the ones a photo has (image-pipeline), so a screen shows a PDF's first page the way it
 * shows a photo. The original stays the master; these are variants beside it.
 */
const path = require("node:path");
const sharp = require("sharp");
const storage = require("../storage/storage.service");
const { variantKey } = require("../../shared/files/variant-key");
const { run } = require("./av-pipeline");

const RUN_TIMEOUT_MS = 60_000;
const MEMORY_MB = 512;
const WIDTHS = Object.freeze([960, 320]);
const PAGE_SCRIPT = path.join(__dirname, "pdf-page.js");

/**
 * Draw a stored PDF's first page and count its pages.
 * @param {{document_id: string, storage_key: string}} doc
 */
async function derive({ document_id: id, storage_key: key }) {
  const input = storage.absPath(key);
  const { dir, cleanup } = await storage.scratch();
  try {
    const png = path.join(dir, "page-1.png");
    const out = await run(
      process.execPath,
      [`--max-old-space-size=${MEMORY_MB}`, PAGE_SCRIPT, input, png, String(WIDTHS[0])],
      { timeoutMs: RUN_TIMEOUT_MS },
    );
    const info = JSON.parse(String(out).trim().split("\n").pop());
    const variants = [];
    for (const width of WIDTHS) {
      const file = path.join(dir, `page-${width}.webp`);
      const made = await sharp(png)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(file);
      const k = variantKey(id, `webp-${width}`, "webp");
      const { bytes } = await storage.putFile(k, file, { overwrite: true });
      variants.push({ kind: `webp-${width}`, key: k, mime: "image/webp", bytes, width: made.width, height: made.height });
    }
    return { page_count: info.page_count, width: info.width, height: info.height, variants };
  } finally {
    await cleanup();
  }
}

module.exports = { derive, WIDTHS, RUN_TIMEOUT_MS };

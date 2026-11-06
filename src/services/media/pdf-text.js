"use strict";
/**
 * The text of a PDF, for a model to read (a CV for Score With AI, docs/guides/recruitment.md
 * §6.4). PDF.js reads it in a child process of its own with a 30 second limit and 256 MB of
 * memory, as pdf-page.js draws a first page, so a broken, huge or hostile PDF stops that process
 * and never the worker. Nothing in the PDF runs.
 *
 *   const text = await pdfText.read(doc.storage_key);   // the text, or null when it has none
 *
 * At most the first 10 pages and 20,000 characters are kept: enough for any CV, and a bound on
 * what is sent. A scanned page has no text; it answers null, and the caller says so.
 *
 *   node src/services/media/pdf-text.js <in.pdf>   // prints one line of JSON: {"text":"..."}
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_PAGES = 10;
const MAX_CHARS = 20_000;
const RUN_TIMEOUT_MS = 30_000;
const MEMORY_MB = 256;

async function textOf(input) {
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
    const parts = [];
    let length = 0;
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && length < MAX_CHARS; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => (item.str || "") + (item.hasEOL ? "\n" : " "))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      parts.push(line);
      length += line.length;
    }
    const text = parts.join("\n\n").slice(0, MAX_CHARS).trim();
    return text.length >= 20 ? text : null;
  } finally {
    await doc.destroy();
  }
}

/**
 * Read a stored PDF's text in a child process. Null when it has none, or when it cannot be read.
 * @param {string} storageKey
 * @returns {Promise<string|null>}
 */
async function read(storageKey) {
  const storage = require("../storage/storage.service");
  const { run } = require("./av-pipeline");
  try {
    const out = await run(process.execPath, [`--max-old-space-size=${MEMORY_MB}`, __filename, storage.absPath(storageKey)], {
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const parsed = JSON.parse(String(out).trim().split("\n").pop());
    return typeof parsed.text === "string" && parsed.text ? parsed.text : null;
  } catch {
    // A PDF that cannot be read is scored without its text, and the summary says so.
    return null;
  }
}

if (require.main === module) {
  textOf(process.argv[2])
    .then((text) => process.stdout.write(`${JSON.stringify({ text })}\n`))
    .catch((err) => {
      process.stderr.write(`${err && err.name ? err.name : "Error"}: ${err && err.message ? err.message : err}\n`);
      process.exitCode = 1;
    });
}

module.exports = { read, textOf, MAX_CHARS, MAX_PAGES };

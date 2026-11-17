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
 * The Document Centre reads further (docs/guides/document-centre.md §6.7): its limits are given,
 * and `detail` answers what happened, so a scanned page (empty) is told from a PDF that could not
 * be read (failed):
 *
 *   const { status, text, pages } = await pdfText.read(key, { pages: 200, chars: 500_000, detail: true });
 *
 *   node src/services/media/pdf-text.js <in.pdf> [pages] [chars]   // one line of JSON: {"text":"...","pages":n}
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_PAGES = 10;
const MAX_CHARS = 20_000;
const RUN_TIMEOUT_MS = 30_000;
const MEMORY_MB = 256;

async function textOf(input, { pages: maxPages = MAX_PAGES, chars: maxChars = MAX_CHARS } = {}) {
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
    let read = 0;
    for (let n = 1; n <= Math.min(doc.numPages, maxPages) && length < maxChars; n += 1) {
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
      read = n;
    }
    const text = parts.join("\n\n").slice(0, maxChars).trim();
    return { text: text.length >= 20 ? text : null, pages: read };
  } finally {
    await doc.destroy();
  }
}

/**
 * Read a stored PDF's text in a child process. Null when it has none, or when it cannot be read;
 * with `detail`, { status: "done"|"empty"|"failed", text, pages } instead.
 * @param {string} storageKey
 * @param {{pages?: number, chars?: number, timeoutMs?: number, memoryMb?: number, detail?: boolean}} [opts]
 * @returns {Promise<string|null|{status: string, text: string|null, pages: number|null}>}
 */
async function read(storageKey, { pages = MAX_PAGES, chars = MAX_CHARS, timeoutMs = RUN_TIMEOUT_MS, memoryMb = MEMORY_MB, detail = false } = {}) {
  const storage = require("../storage/storage.service");
  const { run } = require("./av-pipeline");
  try {
    const out = await run(process.execPath, [`--max-old-space-size=${memoryMb}`, __filename, storage.absPath(storageKey), String(pages), String(chars)], {
      timeoutMs,
    });
    const parsed = JSON.parse(String(out).trim().split("\n").pop());
    const text = typeof parsed.text === "string" && parsed.text ? parsed.text : null;
    if (!detail) return text;
    return { status: text ? "done" : "empty", text, pages: Number.isInteger(parsed.pages) ? parsed.pages : null };
  } catch {
    // A PDF that cannot be read is scored without its text, and the summary says so.
    return detail ? { status: "failed", text: null, pages: null } : null;
  }
}

if (require.main === module) {
  const limit = (arg, fallback) => (Number.isInteger(Number(arg)) && Number(arg) > 0 ? Number(arg) : fallback);
  textOf(process.argv[2], { pages: limit(process.argv[3], MAX_PAGES), chars: limit(process.argv[4], MAX_CHARS) })
    .then(({ text, pages }) => process.stdout.write(`${JSON.stringify({ text, pages })}\n`))
    .catch((err) => {
      process.stderr.write(`${err && err.name ? err.name : "Error"}: ${err && err.message ? err.message : err}\n`);
      process.exitCode = 1;
    });
}

module.exports = { read, textOf, MAX_CHARS, MAX_PAGES };

"use strict";
/**
 * What the User Guide's gate (scripts/check/user-guide.js) and its picture script
 * (scripts/guide/shoot.js) share: the chapters on disk, and the two hashes that say whether a
 * picture still shows its screen (docs/guides/user-guide.md §6.5).
 *
 *   spec    the picture's own spec (open, as, device, do, marks, crop, sources), as written
 *   source  the screen's code when it was taken: its feature folder (app/src/features/<module>,
 *           tests aside) and every path the spec lists under `sources`
 *
 * A picture whose hashes differ from the ones in its chapter's shots.json is stale: the screen
 * or the spec changed after it was taken, and `npm run guide:shots -- --stale` retakes it.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseChapter } = require("../../packages/contract/guide");

const ROOT = path.resolve(__dirname, "..", "..");
const MANUAL = path.join(ROOT, "docs", "manual");
const IMG = path.join(MANUAL, "img");

/** A chapter file opens with its front matter; a file that does not is not in the guide yet. */
const isChapter = (text) => /^---\r?\n/.test(text);

/**
 * Every chapter file under docs/manual, parsed, and the files not yet in the guide's format.
 * @returns {{chapters: Array<{file: string, chapter: object, problems: string[]}>, waiting: string[], empty: string[]}}
 */
function readChapters(dir = MANUAL) {
  const chapters = [];
  const waiting = [];
  const empty = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (!text.trim()) empty.push(file);
    else if (!isChapter(text)) waiting.push(file);
    else chapters.push({ file, ...parseChapter(text, file) });
  }
  return { chapters, waiting, empty };
}

/** "/people?tab=employees" → "people" (the module key). */
const moduleOfOpen = (open) => {
  const m = /^\/([a-z-]+)/.exec(String(open || ""));
  return m ? m[1].replace(/-/g, "_") : null;
};

/** Every file a picture depends on, repo-relative, sorted: its screen's feature folder and its sources. */
function sourcesOf(spec, root = ROOT) {
  const out = new Set();
  const walk = (rel) => {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      out.add(`${rel} (missing)`);
      return;
    }
    if (fs.statSync(full).isDirectory()) {
      for (const e of fs.readdirSync(full).sort()) walk(`${rel}/${e}`);
    } else if (!/\.test\.[jt]sx?$/.test(rel)) out.add(rel);
  };
  const module = moduleOfOpen(spec.open);
  if (module && fs.existsSync(path.join(root, "app/src/features", module))) walk(`app/src/features/${module}`);
  for (const s of spec.sources || []) walk(s.replace(/\/$/, ""));
  return [...out].sort();
}

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The two hashes of a picture, as shots.json keeps them. */
function hashesOf(spec, root = ROOT) {
  const { line: _line, ...own } = spec;
  const files = sourcesOf(spec, root);
  const source = crypto.createHash("sha256");
  for (const f of files) {
    source.update(f);
    if (!f.endsWith("(missing)")) source.update(fs.readFileSync(path.join(root, f)));
  }
  return { spec: sha(JSON.stringify(own)), source: source.digest("hex").slice(0, 16) };
}

/** A chapter's shots.json, or {}. */
function readShots(chapterSlug, dir = IMG) {
  const file = path.join(dir, chapterSlug, "shots.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

module.exports = { ROOT, MANUAL, IMG, isChapter, readChapters, moduleOfOpen, sourcesOf, hashesOf, readShots };

#!/usr/bin/env node
"use strict";
/**
 * Gates 8 (backend half) and 17: no dashes in what a person reads (CLAUDE.md, README §8).
 *
 * An em dash in product copy is nearly always a sentence doing two jobs: a statement,
 * a dash, then the aside the writer could not drop. It reads as machine-written, and it
 * is the over-explaining the five-second rule removes. Use a colon when the second half
 * explains the first, a full stop for a second thought, a comma for an aside. If none
 * fits, it is two sentences, or the second half belongs behind an ⓘ.
 *
 * What is scanned, because a person reads it:
 *   templates/**                    email and document templates (front matter included:
 *                                   the subject line is copy), import templates
 *   src/services/ai/prompts/**      prompts: the model copies the style it is given
 *   string literals in src/ and packages/   error messages, notification text, labels,
 *                                   validation messages, log lines
 * Comments and docs/ are not scanned.
 *
 * What counts: an em dash, an en dash or a horizontal bar anywhere, and "--" used as
 * punctuation (" -- " or word--word). Not counted: a string that is only a dash (the
 * empty-value marker in a cell), "--" inside SQL (a comment there), CLI flags (--check),
 * CSS custom properties (var(--x)), HTML comments, and a line marked
 *   @dash:keep <reason>
 * on the line or in the comment directly above it (a value that genuinely is a dash).
 *
 * Usage: node scripts/check/dashes.js     exit 0 clean, 1 with the list
 */
const fs = require("node:fs");
const path = require("node:path");
const { mask, waived, walk, relTo } = require("./lib/source");

const ROOT = path.resolve(__dirname, "..", "..");
const SELF = "scripts/check/dashes.js";

const DASH = /[–—―]/;
const DOUBLE = /(?:(?:^|\s)--(?:\s|$)|\w--\w)/;
const KEEP = /@dash:keep\s+\S/;
const SQL =
  /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH|LIMIT|CREATE|ALTER|DROP)\b/;

/** A string that is only a dash, or a word wrapped in two: an empty-value marker, not copy. */
const emptyValueGlyph = (t) =>
  /^\s*[–—―]\s*$/.test(t) || /^\s*[–—―][^–—―]{0,24}[–—―]\s*$/.test(t);

/** Does this piece of copy carry a dash? */
function hasDash(text, { sql = false } = {}) {
  if (emptyValueGlyph(text)) return false;
  if (DASH.test(text)) return true;
  if (sql || SQL.test(text)) return false;
  const t = text
    .replace(/var\(\s*--[\w-]+/g, "")
    .replace(/(^|\s)--[a-z][\w-]*/gi, "$1");
  return DOUBLE.test(t);
}

/**
 * Dashes in a JavaScript file's string literals.
 * @returns {Array<{line: number, text: string}>}
 */
function scanJs(source) {
  const m = mask(source);
  const lines = String(source).split("\n");
  const codeLines = m.code.split("\n");
  const hits = [];
  const whole = new Map();
  for (const s of m.strings)
    if (s.template !== undefined)
      whole.set(s.template, `${whole.get(s.template) || ""} ${s.text}`);
  for (const s of m.strings) {
    const sql = s.template !== undefined && SQL.test(whole.get(s.template));
    if (!hasDash(s.text, { sql })) continue;
    const offset = s.text.search(/[–—―]|--/);
    const line = m.lineOf(s.start + Math.max(offset, 0));
    if (waived(lines, codeLines, line - 1, KEEP)) continue;
    hits.push({ line, text: s.text.trim().slice(0, 90) });
  }
  return hits;
}

/**
 * Dashes in a text file a person reads (HTML template, prompt, JSON). HTML comments,
 * <style> and <script> are blanked first; front matter rules (---) are not copy.
 * @returns {Array<{line: number, text: string}>}
 */
function scanText(source) {
  const keep = (s) => s.replace(/[^\n]/g, " ");
  const text = String(source)
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, keep)
    .replace(/<style\b[\s\S]*?<\/style>/gi, keep)
    .replace(/<script\b[\s\S]*?<\/script>/gi, keep);
  const lines = text.split("\n");
  const original = String(source).replace(/\r\n/g, "\n").split("\n");
  const hits = [];
  lines.forEach((l, i) => {
    if (/^\s*-{3,}\s*$/.test(l)) return;
    if (KEEP.test(original[i] || "") || KEEP.test(original[i - 1] || ""))
      return;
    if (hasDash(l, { sql: false }) && !/^\s*$/.test(l))
      hits.push({ line: i + 1, text: l.trim().slice(0, 90) });
  });
  return hits;
}

const isJs = (n) =>
  /\.(c|m)?js$/.test(n) && !/\.(test|spec)\.(c|m)?js$/.test(n);
const isText = (n) => /\.(html?|txt|md|json)$/.test(n);

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT } = {}) {
  const files = [
    ...walk(path.join(root, "templates"), isText).map((f) => [f, scanText]),
    ...walk(path.join(root, "src", "services", "ai", "prompts"), isText).map(
      (f) => [f, scanText],
    ),
    ...["src", "packages"].flatMap((d) =>
      walk(path.join(root, d), isJs).map((f) => [f, scanJs]),
    ),
  ];
  const problems = [];
  const seen = new Set();
  for (const [file, scan] of files) {
    const rel = relTo(root, file);
    if (rel === SELF || seen.has(rel)) continue;
    seen.add(rel);
    for (const h of scan(fs.readFileSync(file, "utf8")))
      problems.push(`${rel}:${h.line}  ${h.text}`);
  }
  return { problems, notes: [], count: seen.size };
}

if (require.main === module) {
  const { problems, count } = check();
  if (!problems.length) {
    console.log(
      `dashes: ok (${count} files, no dashes in copy a person reads)`,
    );
    process.exit(0);
  }
  console.error('dashes: no em dashes or " -- " in copy a person reads\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nUse a colon, a full stop or a comma; if none fits, it is two sentences.",
  );
  console.error("A value that genuinely is a dash: @dash:keep <reason>.");
  process.exit(1);
}

module.exports = { check, scanJs, scanText, hasDash, emptyValueGlyph };

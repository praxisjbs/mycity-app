#!/usr/bin/env node
"use strict";
/**
 * Gate 17, no dashes in copy a person reads (FRONTEND_GUIDE §5.4, MILESTONES §3),
 * and the backend half of gate 8: what the API, mail and PDFs say is copy too.
 *
 * Refuses an em dash, an en dash or a spaced double hyphen in:
 *   demo.html          string literals in its scripts and the text of its markup
 *   app/, public-app/  source outside comments (JSX text and strings)
 *   src/, packages/    string literals (errors, mail subjects, notifications,
 *                      contract validation messages)
 *   src/services/ai/prompts/  the prompt files: the model copies the style it is given
 *   templates/         the text of mail and document templates
 *   docs/manual/       the user manual
 *
 * The one allowed dash is the empty-value marker, a value that is nothing but
 * the dash, which the shared table and detail components draw (§6).
 * Comments are code, not copy, and are skipped.
 *
 * Usage: node scripts/check/dashes.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { hasDash, clean } = require("./lib/copy");
const { ROOT, readDemo, scan, stripTags, lineOf, frontendFiles, read } = require("./lib/sources");

const problems = [];
const add = (file, line, text) => problems.push(`  ${file}:${line}: "${clean(text).slice(0, 90)}"`);

function walk(dir, test, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, test, out);
    else if (test(e.name)) out.push(rel);
  }
  return out;
}

/** Text nodes of markup, one per line of output. */
function markupText(file, html) {
  const re = />([^<]+)</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (hasDash(m[1])) add(file, lineOf(html, m.index), m[1]);
  }
}

/** A literal that is SQL: its `--` starts a comment (the pagination gate reads one), not copy. */
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|LIMIT|RETURNING|JOIN)\b/;
const sqlComments = (v) => (SQL.test(v) ? v.replace(/--[^\n]*/g, "") : v);

/** String literals of a script (HTML inside a literal is reduced to its text). */
function scriptLiterals(file, code, base, whole) {
  for (const l of scan(code).literals) {
    const value = sqlComments(l.value);
    const text = /</.test(value) ? stripTags(value) : value;
    for (const piece of text.split(/\s{2,}/)) {
      if (hasDash(piece)) add(file, lineOf(whole, base + l.start), piece);
    }
  }
}

const demo = readDemo();
if (demo) {
  for (const s of demo.scripts) scriptLiterals(demo.file, s.code, s.offset, demo.html);
  markupText(demo.file, demo.markup);
}

for (const file of frontendFiles()) {
  const src = scan(read(file)).code; // comments blanked
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    const pieces = l.split(/[<>{}"'`]/);
    if (pieces.some((p) => hasDash(p))) add(file, i + 1, l);
  });
}

for (const file of walk("src", (n) => n.endsWith(".js") && !n.endsWith(".test.js"))) {
  const code = read(file);
  scriptLiterals(file, code, 0, code);
}

for (const file of walk("packages", (n) => n.endsWith(".js") && !n.endsWith(".test.js"))) {
  const code = read(file);
  scriptLiterals(file, code, 0, code);
}

for (const file of walk("src/services/ai/prompts", (n) => n.endsWith(".md"))) {
  read(file)
    .split("\n")
    .forEach((l, i) => {
      if (!/^-{3,}\s*$/.test(l) && hasDash(l)) add(file, i + 1, l);
    });
}

for (const file of walk("templates", (n) => /\.(html|hbs|txt)$/.test(n))) {
  const html = read(file).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  markupText(file, `>${html}<`);
}

for (const file of walk("docs/manual", (n) => n.endsWith(".md"))) {
  const text = read(file).replace(/```[\s\S]*?```/g, (c) => c.replace(/[^\n]/g, " "));
  text.split("\n").forEach((l, i) => {
    if (hasDash(l)) add(file, i + 1, l);
  });
}

if (problems.length) {
  console.error(`dashes: ${problems.length} problem(s): an em dash, en dash or double hyphen in copy\n`);
  for (const p of problems) console.error(p);
  console.error("\nUse a comma, a colon, a full stop or two sentences instead (FRONTEND_GUIDE §5.4).");
  process.exit(1);
}
console.log("dashes: ok");

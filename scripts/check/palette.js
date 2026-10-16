#!/usr/bin/env node
"use strict";
/**
 * Gate 13, palette (MILESTONES §3, §5.1, §5.2; FRONTEND_FOUNDATION F3, F4).
 *
 * Colours exist in one file, packages/ui/src/styles/tokens.css, and everything
 * else names a token. A hex value anywhere else is a second copy of the
 * palette that drifts the day the brand changes. This gate refuses:
 *
 *   - a hex colour in frontend source (packages/ui/src and gallery, app/ and
 *     public-app/ source, public files and root html/config) outside
 *     tokens.css, except the files on HEX_ALLOWED below, each with its reason;
 *     an allowed file may hold only colours that are token values, and an
 *     entry whose file no longer holds a hex is stale and fails too
 *   - #FFCD05 or #004F70 anywhere in frontend source, comments and tokens.css
 *     included: they are in the client's CSS but are not brand (MILESTONES §5)
 *   - in app/src and public-app/src, an arbitrary-value class (`w-[317px]`,
 *     `bg-[#fff]`) or a `style=` prop, anywhere, with no exemptions. The
 *     exemption list every screen was converged off in PR 3 (Build kit) is
 *     gone: a runtime value belongs in a shared component, where a class can
 *     read it from a CSS variable (F4).
 *
 * The hex and arbitrary-value patterns are the linter's own, exported by
 * packages/ui/eslint.shared.js, so the gate and `npm run fe:lint` agree.
 *
 * Usage: node scripts/check/palette.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ROOT, scan, lineOf } = require("./lib/sources");

const TOKENS = "packages/ui/src/styles/tokens.css";
const NOT_BRAND = /#(?:FFCD05|004F70)(?![0-9a-z])/gi;

/**
 * Files outside tokens.css that may name a colour, because what reads them
 * cannot read a CSS variable. Each colour in them must be a token value.
 */
const HEX_ALLOWED = [
  { file: "app/vite.config.ts", why: "the PWA manifest (theme_color, background_color): the phone paints it before any CSS loads" },
  { file: "app/index.html", why: '<meta name="theme-color">: the browser colours its bar before the stylesheet arrives' },
  { file: "app/public/favicon.svg", why: "the tab icon: the browser draws it outside the page, without the page's CSS" },
  { file: "app/public/favicon-staging.svg", why: "the staging tab icon, drawn the same way" },
  { file: "public-app/public/favicon.svg", why: "the tab icon: the browser draws it outside the page, without the page's CSS" },
  { file: "public-app/public/favicon-staging.svg", why: "the staging tab icon, drawn the same way" },
];

/** Where frontend source lives: folders walked whole, and the apps' root files. */
const DIRS = ["packages/ui/src", "packages/ui/gallery", "app/src", "app/public", "public-app/src", "public-app/public"];
const ROOT_FILES = /^(index\.html|vite\.config\.ts)$/;
const TEXT = /\.(tsx?|jsx?|mjs|css|html|svg|json|webmanifest)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-gallery", "dev-dist", "coverage"]);

function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else if (TEXT.test(e.name)) out.push(child);
  }
  return out;
}

function sourceFiles() {
  const out = [];
  for (const d of DIRS) walk(d, out);
  for (const app of ["app", "public-app"]) {
    const abs = path.join(ROOT, app);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) if (ROOT_FILES.test(name)) out.push(`${app}/${name}`);
  }
  return out.sort();
}

/** The text with its comments blanked (same length, so offsets and lines hold). */
function withoutComments(file, text) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (/\.(tsx?|jsx?|mjs)$/.test(file)) return scan(text).code;
  if (/\.css$/.test(file)) return text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (/\.(html|svg)$/.test(file)) return text.replace(/<!--[\s\S]*?-->/g, blank);
  return text;
}

/** Hex colours in text: the linter's pattern, not inside a word, an entity (&#123;) or a private name (this.#add). */
const hexPattern = (HEX) => new RegExp(`(?<![\\w&.#/])${HEX.source}`, "g");

/** Pure: every hex colour in `text`, as { value, index }. */
function findHex(text, HEX) {
  const re = hexPattern(HEX);
  const out = [];
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ value: m[0], index: m.index });
  return out;
}

/** Pure: the token values in tokens.css, upper case. */
function tokenValues(css) {
  return new Set([...css.matchAll(/--[a-z0-9-]+:\s*(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1].toUpperCase()));
}

/**
 * Pure: arbitrary-value classes and `style=` props in a TS/TSX source, as
 * [{ index, what }]. Strings are tested with the linter's ARBITRARY pattern;
 * `style=` is a JSX attribute in the code with comments and strings blanked.
 */
function findStyling(src, ARBITRARY) {
  const out = [];
  const { literals, code } = scan(src);
  const blanked = code.split("");
  for (const l of literals) {
    const m = ARBITRARY.exec(l.value);
    if (m) out.push({ index: l.start, what: `arbitrary value "${m[1]}"` });
    for (let i = l.start + 1; i < l.end - 1; i += 1) if (blanked[i] !== "\n") blanked[i] = " ";
  }
  const flat = blanked.join("");
  const style = /(?<=[\s{(])style=(?=[{"'])/g;
  for (let m = style.exec(flat); m; m = style.exec(flat)) out.push({ index: m.index, what: "inline style= prop" });
  return out.sort((a, b) => a.index - b.index);
}

async function main() {
  const { HEX, ARBITRARY } = await import(pathToFileURL(path.join(ROOT, "packages", "ui", "eslint.shared.js")).href);
  const problems = [];
  const notes = [];
  const add = (where, message) => problems.push(`  ${where}: ${message}`);
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  const tokensCss = fs.existsSync(path.join(ROOT, TOKENS)) ? read(TOKENS) : "";
  if (!tokensCss) add(TOKENS, "missing: every colour is defined here (F3)");
  const tokens = tokenValues(tokensCss);
  const allowed = new Map(HEX_ALLOWED.map((a) => [a.file, a]));
  const files = sourceFiles();

  // Raw hex outside tokens.css; not-brand colours everywhere.
  for (const file of files) {
    const text = read(file);
    for (let m = NOT_BRAND.exec(text); m; m = NOT_BRAND.exec(text)) {
      add(`${file}:${lineOf(text, m.index)}`, `${m[0]} is not a MyCity colour (MILESTONES §5); use the token (--primary is #FFDF55)`);
    }
    NOT_BRAND.lastIndex = 0;
    if (file === TOKENS) continue;
    const hexes = findHex(withoutComments(file, text), HEX);
    const entry = allowed.get(file);
    if (entry) {
      if (!hexes.length) add(file, "is on HEX_ALLOWED in scripts/check/palette.js but holds no colour now; take it off the list");
      for (const h of hexes) {
        if (!tokens.has(h.value.toUpperCase())) {
          add(`${file}:${lineOf(text, h.index)}`, `${h.value} is allowed here only as a token value from tokens.css; it is not one`);
        }
      }
      continue;
    }
    for (const h of hexes) {
      add(`${file}:${lineOf(text, h.index)}`, `raw colour ${h.value}: colours live only in ${TOKENS}; use a token class (bg-primary, text-muted-foreground)`);
    }
  }
  for (const a of HEX_ALLOWED) if (!fs.existsSync(path.join(ROOT, a.file))) add(a.file, "is on HEX_ALLOWED in scripts/check/palette.js but does not exist; take it off the list");

  // Arbitrary values and inline styles in the apps. No exemptions: a runtime
  // value belongs in a shared component, where a class reads it from a CSS
  // variable (F4; PR 3 converged the last of #18's screens off the old list).
  for (const app of ["app", "public-app"]) {
    for (const file of walk(`${app}/src`).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = read(file);
      for (const f of findStyling(text, ARBITRARY)) {
        add(`${file}:${lineOf(text, f.index)}`, `${f.what} (F4): use the token scale (text-sm, h-control, gap-3) or a component from @mycity/ui (docs/COMPONENTS.md)`);
      }
    }
  }

  if (problems.length) {
    console.error(`palette: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error(
      "\nColours are tokens only (FRONTEND_FOUNDATION F3, F4; MILESTONES §5.1, §5.2): name a token class, or add the colour\n" +
        `to ${TOKENS} with its contrast ratio (gate 14). Anything visual beyond tokens is a shared component: npm run new:component.`,
    );
    process.exit(1);
  }
  console.log(`palette: ok (${files.length} frontend file(s); colours only in ${TOKENS}, no F4 exemptions)`);
  for (const n of notes) console.log(`  note: ${n}`);
}

module.exports = { findHex, findStyling, tokenValues, HEX_ALLOWED };

if (require.main === module) {
  main().catch((err) => {
    console.error(`palette: could not run\n  ${err.stack || err.message}`);
    process.exit(1);
  });
}

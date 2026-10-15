"use strict";
/**
 * Reading source text for the gates, without a parser.
 *
 *   const { mask, walk, waived } = require("./lib/source");
 *   const m = mask(text);
 *   m.code      comments blanked, strings kept       patterns that live in strings ("en-US", SQL)
 *   m.bare      comments and string bodies blanked   operators and calls (a + b, parseFloat())
 *   m.strings   every string and template-literal text: [{ text, start, line, template }]
 *               (`template`: the offset of the opening backtick, shared by every text
 *               piece of one template literal, so the pieces can be read together)
 *   m.lineOf(offset)                                 1-based line of an offset
 *
 * Each view has the same length and the same newlines as the source, so an offset or a
 * line number found in a view points at the real file.
 *
 * Regex literals are recognised, because a quote inside /["']/ must not open a string;
 * they are kept in `code` and blanked in `bare`. A template literal's text is a string
 * and each ${ } inside it is code.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Is the `/` at `i` the start of a regex literal rather than a division? */
function startsRegex(source, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  const prev = source[j];
  if (/[)\]]/.test(prev)) return false;
  if (/[\w$]/.test(prev)) {
    const word = /[\w$]+$/.exec(source.slice(0, j + 1));
    return (
      Boolean(word) &&
      /^(return|typeof|case|in|of|new|delete|void|do|else|yield|await|throw)$/.test(
        word[0],
      )
    );
  }
  return true;
}

/** End offset (exclusive) of the regex literal starting at `i`, or -1 when it is not one. */
function regexEnd(source, i) {
  let k = i + 1;
  let inClass = false;
  while (k < source.length) {
    const c = source[k];
    if (c === "\n") return -1;
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") inClass = true;
    else if (c === "/") {
      k += 1;
      while (k < source.length && /[a-z]/i.test(source[k])) k += 1;
      return k;
    }
    k += 1;
  }
  return -1;
}

/**
 * @param {string} source
 * @returns {{code: string, bare: string, strings: Array<{text: string, start: number, line: number, template?: number}>, lineOf: (offset: number) => number}}
 */
function mask(source) {
  const src = String(source);
  const n = src.length;
  const code = src.split("");
  const bare = src.split("");
  const raw = [];
  const blank = (arr, a, b) => {
    for (let k = a; k < b; k += 1) if (arr[k] !== "\n") arr[k] = " ";
  };
  const text = (a, b, template) => {
    if (b > a)
      raw.push(
        template === undefined
          ? { text: src.slice(a, b), start: a }
          : { text: src.slice(a, b), start: a, template },
      );
    blank(bare, a, b);
  };

  const templates = []; // brace depth and opening backtick of each open ${
  let opened = 0;
  let depth = 0;
  let inTemplate = false;
  let segment = 0;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (inTemplate) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        text(segment, i, opened);
        inTemplate = false;
        i += 1;
        continue;
      }
      if (c === "$" && next === "{") {
        text(segment, i, opened);
        templates.push([depth, opened]);
        depth += 1;
        inTemplate = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = n;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
      continue;
    }
    if (c === "/" && startsRegex(src, i)) {
      const end = regexEnd(src, i);
      if (end !== -1) {
        blank(bare, i, end);
        i = end;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n")
        k += src[k] === "\\" ? 2 : 1;
      text(i + 1, Math.min(k, n));
      i = k + 1;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      opened = i;
      segment = i + 1;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (templates.length && depth === templates[templates.length - 1][0]) {
        opened = templates.pop()[1];
        inTemplate = true;
        segment = i + 1;
      }
    }
    i += 1;
  }
  if (inTemplate) text(segment, n, opened);

  const breaks = [];
  for (let k = 0; k < n; k += 1) if (src[k] === "\n") breaks.push(k);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  return {
    code: code.join(""),
    bare: bare.join(""),
    strings: raw.map((s) => ({ ...s, line: lineOf(s.start) })),
    lineOf,
  };
}

/** The balanced (...) argument text after the `(` at `open`, or "" when unbalanced. */
function argsAt(text, open) {
  let d = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === "(") d += 1;
    else if (text[k] === ")") {
      d -= 1;
      if (d === 0) return text.slice(open + 1, k);
    }
  }
  return "";
}

/**
 * Is a waiver marker on this line, or in the comment lines directly above it? Walks up
 * through comment-only and blank lines (at most `span`), so a reason may run to a second
 * line but a marker cannot drift up the file.
 * @param {string[]} lines      the source, split on \n
 * @param {string[]} codeLines  mask(source).code, split on \n
 * @param {number} index        0-based line
 * @param {RegExp} marker       e.g. /@money:ok\s+\S/
 */
function waived(lines, codeLines, index, marker, span = 8) {
  if (marker.test(lines[index] || "")) return true;
  for (let k = index - 1; k >= 0 && index - k <= span; k -= 1) {
    if ((codeLines[k] || "").trim()) return false;
    if (marker.test(lines[k] || "")) return true;
  }
  return false;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "coverage",
  "dist",
  "dist-gallery",
  "build",
  "__snapshots__",
]);

/**
 * Files under `dir` whose name passes `keep`, depth first, sorted.
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 */
function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, keep, out);
    else if (keep(e.name)) out.push(full);
  }
  return out;
}

/** Repo-relative path with forward slashes. */
const relTo = (root, file) =>
  path.relative(root, file).split(path.sep).join("/");

module.exports = { mask, argsAt, waived, walk, relTo, startsRegex, SKIP_DIRS };

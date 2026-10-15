"use strict";
/**
 * Reading copy out of source for the static halves of the screen gates
 * (five-second.js, forms.js, dashes.js): the string literals in a script with
 * comments and regular expressions skipped, the arguments of a call, and the
 * frontend files to scan.
 *
 * A tokenizer, not a parser: it is exact about quotes, comments and regex
 * literals, which is all the gates need, and it never executes the source.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEMO = "docs/MyCity-ERP-Documents/demo.html";

/** Characters after which a `/` starts a regular expression, not a division. */
const REGEX_BEFORE = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/**
 * Walk JavaScript source. Returns the string literals (quotes, and the static
 * parts of template literals) with their offsets, and the code with comments
 * blanked out (same length, so offsets still line up).
 */
function scan(code) {
  const literals = [];
  const out = code.split("");
  let i = 0;
  let prev = "";
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && code[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && d === "*") {
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] !== "\n") out[i] = " ";
        i += 1;
      }
      if (i < n) out[i] = out[i + 1] = " ";
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const start = i;
      let value = "";
      i += 1;
      while (i < n && code[i] !== c) {
        if (code[i] === "\\") {
          value += code[i + 1] === "n" ? "\n" : code[i + 1];
          i += 2;
          continue;
        }
        if (c === "`" && code[i] === "$" && code[i + 1] === "{") {
          // skip the expression; its own literals are not copy of this one
          let depth = 1;
          i += 2;
          while (i < n && depth) {
            if (code[i] === "{") depth += 1;
            else if (code[i] === "}") depth -= 1;
            i += 1;
          }
          value += " ";
          continue;
        }
        value += code[i];
        i += 1;
      }
      literals.push({ value, start, end: i + 1 });
      i += 1;
      prev = "a";
      continue;
    }
    if (c === "/" && REGEX_BEFORE.has(prev)) {
      // a regular expression literal: skip to its closing slash, minding classes
      i += 1;
      let inClass = false;
      while (i < n && (code[i] !== "/" || inClass) && code[i] !== "\n") {
        if (code[i] === "\\") i += 1;
        else if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        i += 1;
      }
      i += 1;
      while (i < n && /[a-z]/i.test(code[i])) i += 1;
      prev = "a";
      continue;
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$)\]]/.test(c) ? "a" : c;
    i += 1;
  }
  return { literals, code: out.join("") };
}

/**
 * The top-level arguments of the call whose `(` is at `open`, as source slices.
 * Strings, brackets and nested calls are respected.
 */
function callArgs(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i += 1;
      while (i < code.length && code[i] !== q) i += code[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i));
        return args;
      }
    } else if (c === "," && depth === 1) {
      args.push(code.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** The literal text of an argument: its string parts joined, expressions dropped. */
function literalText(arg) {
  return scan(arg)
    .literals.map((l) => l.value)
    .join(" ");
}

/** Is the argument nothing but string literals (no variables)? */
const isPureLiteral = (arg) => /^\s*(['"`])[\s\S]*\1\s*$/.test(arg) && !/\+\s*[A-Za-z_$(]/.test(arg);

const stripTags = (html) => String(html).replace(/<[^>]*>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ");

/** Line number of an offset. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/** The demo's scripts (with offsets into the file) and its static markup. */
function readDemo() {
  const file = path.join(ROOT, DEMO);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  const scripts = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    scripts.push({ code: m[1], offset: m.index + m[0].indexOf(m[1]) });
  }
  const markup = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, (s) => s.replace(/[^\n]/g, " "))
    .replace(/<style\b[\s\S]*?<\/style>/gi, (s) => s.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, " "));
  return { file: DEMO, html, scripts, markup };
}

/** The [start, end) ranges of the bodies of the named functions in a script. */
function functionRanges(code, names) {
  const ranges = [];
  for (const name of names) {
    const re = new RegExp(`function\\s+${name}\\s*\\(`, "g");
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const brace = code.indexOf("{", m.index);
      let depth = 0;
      for (let i = brace; i < code.length; i += 1) {
        if (code[i] === "{") depth += 1;
        else if (code[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            ranges.push([m.index, i + 1, name]);
            break;
          }
        }
      }
    }
  }
  return ranges;
}

/** Frontend source files of both apps (not node_modules, not builds). */
function frontendFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", "build", ".vite", "coverage"].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx|jsx|ts|js)$/.test(e.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(e.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, "app", "src"));
  walk(path.join(ROOT, "public-app", "src"));
  return out.map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

module.exports = {
  ROOT,
  DEMO,
  scan,
  callArgs,
  literalText,
  isPureLiteral,
  stripTags,
  lineOf,
  readDemo,
  functionRanges,
  frontendFiles,
  read,
};

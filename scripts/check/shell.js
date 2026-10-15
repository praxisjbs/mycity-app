#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: shell scripts are LF and parse, and every JavaScript file parses
 * (BACKEND_STRUCTURE §10).
 *
 * A shell script saved with Windows line endings fails on the server with "bad
 * interpreter" or "$'\r': command not found", and only when it runs: during a deploy, a
 * backup, a provision. .gitattributes keeps the repository LF; this catches a file that
 * slipped past it, and a script that would not even parse.
 *
 * Fails the build on:
 *  1. a shell script (*.sh, or a file whose first line is a sh/bash shebang) with a
 *     carriage return, without a #! first line, or that `bash -n` rejects;
 *  2. a .js, .cjs or .mjs file under src/, scripts/, packages/, tests/, ops/ or the
 *     repository root that does not parse (the same check as `node --check`).
 * An empty shell script is a file the repository map created and nobody has written
 * yet: listed as a note, not a failure.
 *
 * `bash -n` needs bash. Without it (a Windows machine with no Git Bash on the PATH) the
 * parse step is skipped with a note locally, and fails in CI.
 *
 * Usage: node scripts/check/shell.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const { walk, relTo, SKIP_DIRS } = require("./lib/source");

const ROOT = path.resolve(__dirname, "..", "..");
const JS_ROOTS = ["src", "scripts", "packages", "tests", "ops"];
const SHEBANG =
  /^#!\s*\S*\b(?:ba|da|z)?sh\b|^#!\s*\/usr\/bin\/env\s+(?:ba|da|z)?sh\b/;

/** Shell scripts anywhere in the repository (not node_modules, .git, coverage). */
function shellFiles(root) {
  return walk(root, () => true).filter((f) => {
    if (f.endsWith(".sh")) return true;
    if (path.extname(f)) return false;
    try {
      const fd = fs.openSync(f, "r");
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, 64, 0);
      fs.closeSync(fd);
      return SHEBANG.test(buf.subarray(0, n).toString("utf8"));
    } catch {
      return false;
    }
  });
}

let bashChecked;
function hasBash() {
  if (bashChecked === undefined) {
    const r = spawnSync("bash", ["--version"], { encoding: "utf8" });
    bashChecked = r.status === 0;
  }
  return bashChecked;
}

/**
 * Does this JavaScript parse? CommonJS is compiled the way Node wraps a module; an .mjs
 * file, or a .js file with import/export, is handed to `node --check`.
 * @returns {string|null} the error, or null
 */
function jsError(file, source) {
  const text = String(source).replace(/^#!.*/, "");
  const esm =
    file.endsWith(".mjs") ||
    /^\s*(?:import\s+[\w{*"']|export\s+(?:default|const|function|class|\{|\*))/m.test(
      text,
    );
  if (esm) {
    const r = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    return r.status === 0
      ? null
      : (r.stderr || "").trim().split("\n").slice(0, 5).join(" ");
  }
  try {
    new vm.Script(Module.wrap(text), { filename: file });
    return null;
  } catch (err) {
    return `${err.name}: ${err.message}`;
  }
}

/**
 * @param {{root?: string, bash?: boolean, inCi?: boolean}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT, bash, inCi = process.env.CI === "true" } = {}) {
  const problems = [];
  const notes = [];
  const withBash = bash === undefined ? hasBash() : bash;
  const empty = [];
  const shells = shellFiles(root);
  for (const f of shells) {
    const rel = relTo(root, f);
    const text = fs.readFileSync(f, "utf8");
    if (!text.trim()) {
      empty.push(rel);
      continue;
    }
    if (text.includes("\r"))
      problems.push(`${rel}: Windows line endings (CR); save it with LF`);
    if (!text.startsWith("#!"))
      problems.push(
        `${rel}: the first line is the interpreter, e.g. #!/usr/bin/env bash`,
      );
    if (withBash && !text.includes("\r")) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      if (r.status !== 0)
        problems.push(
          `${rel}: bash -n: ${(r.stderr || "").trim().split("\n")[0]}`,
        );
    }
  }
  if (shells.length > empty.length && !withBash) {
    if (inCi)
      problems.push(
        "bash is not on the PATH, so the scripts could not be parsed",
      );
    else
      notes.push(
        "bash is not on the PATH: line endings checked, bash -n skipped",
      );
  }
  if (empty.length) notes.push(`empty, not written yet: ${empty.join(", ")}`);

  const js = [
    ...JS_ROOTS.flatMap((d) =>
      walk(path.join(root, d), (n) => /\.(c|m)?js$/.test(n)),
    ),
    ...fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() && /\.(c|m)?js$/.test(e.name) && !SKIP_DIRS.has(e.name),
      )
      .map((e) => path.join(root, e.name)),
  ];
  for (const f of js) {
    const err = jsError(f, fs.readFileSync(f, "utf8"));
    if (err) problems.push(`${relTo(root, f)}: does not parse: ${err}`);
  }
  return { problems, notes, count: shells.length + js.length };
}

if (require.main === module) {
  const { problems, notes, count } = check();
  for (const n of notes) console.log(`  note: ${n}`);
  if (!problems.length) {
    console.log(
      `shell: ok (${count} files: shell scripts LF and parse, JavaScript parses)`,
    );
    process.exit(0);
  }
  console.error(
    "shell: shell scripts are LF and parse; every JavaScript file parses\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, shellFiles, jsError };

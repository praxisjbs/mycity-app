#!/usr/bin/env node
"use strict";
/**
 * Gate 16, no native dialogs (FRONTEND_GUIDE §8.4, MILESTONES §3).
 *
 * The browser's alert, confirm and prompt block the page, cannot be styled,
 * read badly on a phone and say "this page says" above our words. A decision
 * is a ConfirmDialog (`const confirm = useConfirm()`), a message is a toast,
 * a question is a Modal, all from @mycity/ui. The linter refuses the plain
 * forms; this static scan of packages/ui/src, app/src and public-app/src also
 * catches the doors round it:
 *
 *   - a bare alert(...), confirm(...) or prompt(...) whose name the file does
 *     not bind itself (`const confirm = useConfirm()` is the right way and passes)
 *   - window.alert, globalThis.confirm, self.prompt, top/parent too, with `.`,
 *     `?.` or brackets (window["confirm"]), called or only referenced (an alias:
 *     `const ask = window.confirm`)
 *   - destructuring one off the global object: `const { confirm } = window`
 *
 * The rendered half is in lib/screens.js: a dialog that opens while a gallery
 * page or a screen is crawled fails gate 11 as a script error.
 *
 * Usage: node scripts/check/native-dialogs.js     exit 0 ok, 1 problems
 */
const { scan, callArgs, frontendFiles, read, lineOf } = require("./lib/sources");

const NAMES = "alert|confirm|prompt";
const GLOBALS = "window|globalThis|self|top|parent";

/** The code with comments and string contents blanked (same length). */
function codeOnly(src) {
  const { literals, code } = scan(src);
  const out = code.split("");
  for (const l of literals) for (let i = l.start + 1; i < l.end - 1; i += 1) if (out[i] !== "\n") out[i] = " ";
  return { code, bare: out.join("") };
}

/** Does the file bind `name` itself (a declaration, an import, a parameter, a destructured local)? */
function bindsName(bare, name) {
  const n = `\\b${name}\\b`;
  return [
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`),
    new RegExp(`\\bimport\\b[^;]*${n}`),
    new RegExp(`\\{[^{}]*${n}[^{}]*\\}\\s*=\\s*(?!\\s*(?:${GLOBALS})\\b)`),
    new RegExp(`[(,]\\s*${name}\\s*[,):=]`),
  ].some((re) => re.test(bare));
}

/**
 * Pure: native dialog uses in a source file, as [{ index, what }].
 * @param {string} src
 */
function findDialogs(src) {
  const { code, bare } = codeOnly(src);
  const out = [];
  const member = new RegExp(`\\b(${GLOBALS})\\s*(?:\\?\\.|\\.)\\s*(${NAMES})\\b`, "g");
  for (let m = member.exec(bare); m; m = member.exec(bare)) out.push({ index: m.index, what: `${m[1]}.${m[2]}` });
  const bracket = new RegExp(`\\b(${GLOBALS})\\s*(?:\\?\\.)?\\[\\s*(["'\`])(${NAMES})\\2\\s*\\]`, "g");
  for (let m = bracket.exec(code); m; m = bracket.exec(code)) out.push({ index: m.index, what: `${m[1]}["${m[3]}"]` });
  const destructure = new RegExp(`\\{([^{}]*)\\}\\s*=\\s*(${GLOBALS})\\b`, "g");
  for (let m = destructure.exec(bare); m; m = destructure.exec(bare)) {
    const hit = new RegExp(`\\b(${NAMES})\\b`).exec(m[1]);
    if (hit) out.push({ index: m.index, what: `${hit[1]} taken off ${m[2]}` });
  }
  const call = new RegExp(`(?<![\\w$.#])(${NAMES})\\s*\\(`, "g");
  for (let m = call.exec(bare); m; m = call.exec(bare)) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(bare, open);
    const after = bare.slice(open + 1 + args.join(",").length + 1).trimStart();
    if (/^[{:]/.test(after)) continue; // a method definition, `confirm() { ... }`, not a call
    if (bindsName(bare, m[1])) continue;
    out.push({ index: m.index, what: `${m[1]}()` });
  }
  return out.sort((a, b) => a.index - b.index);
}

function main() {
  const problems = [];
  const files = frontendFiles();
  for (const file of files) {
    const src = read(file);
    for (const f of findDialogs(src)) problems.push(`  ${file}:${lineOf(src, f.index)}: native dialog ${f.what}`);
  }
  if (problems.length) {
    console.error(`native-dialogs: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error(
      "\nNo browser dialogs (gate 16, FRONTEND_GUIDE §8.4). From @mycity/ui: a decision is useConfirm() / ConfirmDialog,\n" +
        "a message is toast(), a question is a Modal (docs/COMPONENTS.md, Overlays and Feedback).",
    );
    process.exit(1);
  }
  console.log(`native-dialogs: ok (${files.length} frontend file(s))`);
}

module.exports = { findDialogs };

if (require.main === module) main();

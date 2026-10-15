#!/usr/bin/env node
"use strict";
/**
 * Gate 12, inline validation and the one form system (FRONTEND_GUIDE §8,
 * MILESTONES §3).
 *
 * Nobody builds their own form. Fields come only from the form components, so
 * every field validates as it is filled (useContractForm, mode onTouched) and
 * looks and behaves the same everywhere. This gate refuses:
 *
 * packages/ui/src, app/src and public-app/src
 *   - a raw <form>, <input>, <select>, <textarea> or <label> outside
 *     packages/ui/src/form/ (and the #18 form files on LEGACY in
 *     check/components.js, until they move there)
 *   - importing react-hook-form outside the same places
 *   - a native date input (gate 15 too), an instruction as a placeholder,
 *     a Submit or OK button
 *
 * docs/MyCity-ERP-Documents/demo.html (the client sees it; same rules)
 *   - a <label> written by hand instead of field(), choice(), check() or fsel()
 *   - an <input>, <select> or <textarea> outside those helpers (a lone search
 *     box with an aria-label is allowed)
 *   - a field label over LIMITS.fieldLabel words, not Title Case, or with an
 *     asterisk; a field error over LIMITS.fieldError words
 *   - a placeholder over LIMITS.placeholder words or ending in a full stop
 *   - a modal footer that carries text, or a footer button that is not a
 *     short Title Case verb
 *
 * Usage: node scripts/check/forms.js     exit 0 ok, 1 problems
 */
const { LIMITS, wordCount, titleCaseViolation, bannedButton, clean } = require("./lib/copy");
const { readDemo, scan, callArgs, literalText, isPureLiteral, stripTags, lineOf, functionRanges, frontendFiles, read } = require("./lib/sources");
const { LEGACY } = require("./components");

/** The demo's form helpers: the only places a label or a raw field may be written. */
const DEMO_FORM_HELPERS = ["field", "choice", "check", "fsel"];

const problems = [];
const add = (where, message) => problems.push(`  ${where}: ${message}`);

function placeholderProblem(value) {
  const v = clean(value);
  if (!v || /^[•.*·\s]+$/.test(v)) return null;
  if (wordCount(v) > LIMITS.placeholder) return `placeholder "${v}" is ${wordCount(v)} words (a format example of at most ${LIMITS.placeholder}, §8.2)`;
  if (/\.$/.test(v) && !/\.\.\.$|…$/.test(v)) return `placeholder "${v}" is an instruction (a format example only, §8.2)`;
  return null;
}

function checkDemo() {
  const demo = readDemo();
  if (!demo) return;
  for (const s of demo.scripts) {
    const { literals, code } = scan(s.code);
    const at = (offset) => `${demo.file}:${lineOf(demo.html, s.offset + offset)}`;
    const helperBodies = functionRanges(code, DEMO_FORM_HELPERS);

    // Where the helpers are called: their arguments may hold the raw field.
    const callRanges = [];
    const callRe = new RegExp(`\\b(${DEMO_FORM_HELPERS.join("|")})\\(`, "g");
    for (let m = callRe.exec(code); m; m = callRe.exec(code)) {
      if (code.slice(Math.max(0, m.index - 9), m.index).includes("function")) continue;
      const open = m.index + m[0].length - 1;
      const args = callArgs(code, open);
      const end = open + 1 + args.join(",").length + 1;
      callRanges.push([open, end, m[1], args, m.index]);
    }
    const inside = (pos, ranges) => ranges.some(([a, b]) => pos >= a && pos < b);

    for (const l of literals) {
      const v = l.value;
      if (/<label\b/i.test(v) && !inside(l.start, helperBodies)) {
        add(at(l.start), `hand-made <label>; use field(), choice(), check() or fsel() (§8.6): ${clean(v).slice(0, 70)}`);
      }
      const raw = /<(input|select|textarea)\b([^>]*)/gi;
      for (let m = raw.exec(v); m; m = raw.exec(v)) {
        const attrs = m[2];
        if (/type="date"/i.test(attrs)) add(at(l.start), "native date input; use the day-first date field (§8.2, gate 15)");
        if (/type="(hidden|file)"/i.test(attrs)) continue;
        if (/aria-label=/i.test(attrs) || inside(l.start, helperBodies) || inside(l.start, callRanges)) continue;
        add(at(l.start), `<${m[1]}> outside the form helpers; wrap it in field() (§8.6)`);
      }
      const ph = /placeholder="([^"]*)"/gi;
      for (let m = ph.exec(v); m; m = ph.exec(v)) {
        const p = placeholderProblem(m[1]);
        if (p) add(at(l.start), p);
      }
    }

    // field(id, label, inner, error): the label and the error are copy.
    for (const [, , name, args, pos] of callRanges) {
      if (name !== "field" && name !== "choice" && name !== "check" && name !== "fsel") continue;
      const label = args[1];
      if (label && isPureLiteral(label)) {
        const t = clean(literalText(label));
        const bare = t.replace(/\s*\(?optional\)?$/i, ""); // field() turns a trailing "(Optional)" into the tag
        if (/\*/.test(t)) add(at(pos), `label "${t}" has an asterisk; mark optional fields "Optional" instead (§8.2)`);
        if (wordCount(bare) > LIMITS.fieldLabel) add(at(pos), `label "${t}" is ${wordCount(bare)} words (limit ${LIMITS.fieldLabel})`);
        const w = titleCaseViolation(bare);
        if (w) add(at(pos), `label "${t}" is not Title Case ("${w}")`);
      }
      const err = name === "field" ? args[3] : null;
      if (err && isPureLiteral(err)) {
        const t = clean(literalText(err));
        if (wordCount(t) > LIMITS.fieldError) add(at(pos), `field error "${t}" is ${wordCount(t)} words (limit ${LIMITS.fieldError}, §8.3)`);
      }
    }

    // Modal footers: buttons only, each a short Title Case verb.
    const footRe = /\bfoot\s*:/g;
    for (let m = footRe.exec(code); m; m = footRe.exec(code)) {
      let depth = 0;
      let i = m.index + m[0].length;
      for (; i < code.length; i += 1) {
        const c = code[i];
        if (c === "'" || c === '"' || c === "`") {
          const q = c;
          i += 1;
          while (i < code.length && code[i] !== q) i += code[i] === "\\" ? 2 : 1;
          continue;
        }
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth -= 1;
        } else if (c === "," && depth === 0) break;
      }
      // An icon call, ic('send'), names a glyph, not a word on the button.
      const expr = code.slice(m.index + m[0].length, i).replace(/\bic\(\s*(['"])[^'"]*\1\s*\)/g, "''");
      const html = literalText(expr);
      const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((b) => clean(stripTags(b[1])));
      const rest = clean(stripTags(html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, " ")));
      if (/\p{L}/u.test(rest)) add(at(m.index), `modal footer carries text "${rest.slice(0, 70)}" (buttons only, §8.4)`);
      for (const b of buttons) {
        if (!b) continue;
        if (bannedButton(b)) add(at(m.index), `footer button "${b}" says nothing; use Verb Noun (§5.4)`);
        if (wordCount(b) > LIMITS.button) add(at(m.index), `footer button "${b}" is ${wordCount(b)} words (limit ${LIMITS.button})`);
        const w = titleCaseViolation(b);
        if (w) add(at(m.index), `footer button "${b}" is not Title Case ("${w}")`);
      }
    }
  }
}

/**
 * Where a raw form element and react-hook-form may be written: the form system
 * in packages/ui/src/form/, and the #18 form files still in the apps until they
 * move there (LEGACY in check/components.js, components/form/ entries only).
 */
const FORM_HOME = /^packages\/ui\/src\/form\//;
const LEGACY_FORM_FILES = new Set(LEGACY.map(([file]) => file).filter((f) => /^(app|public-app)\/src\/components\/form\//.test(f)));
const formHome = (file) => FORM_HOME.test(file) || LEGACY_FORM_FILES.has(file);

function checkApps() {
  for (const file of frontendFiles()) {
    const inForm = formHome(file);
    const src = scan(read(file)).code;
    const line = (i) => `${file}:${src.slice(0, i).split("\n").length}`;
    if (!inForm) {
      const raw = /<(form|input|select|textarea|label)\b/g;
      for (let m = raw.exec(src); m; m = raw.exec(src)) {
        add(line(m.index), `raw <${m[1]}> outside packages/ui/src/form/; use a field from @mycity/ui (docs/COMPONENTS.md, Forms; §8.6)`);
      }
      const rhf = /from\s+["']react-hook-form["']|require\(\s*["']react-hook-form["']\s*\)/g;
      for (let m = rhf.exec(src); m; m = rhf.exec(src)) add(line(m.index), "react-hook-form imported outside packages/ui/src/form/; use useContractForm from @mycity/ui (§8.6)");
    }
    const date = /type=["']date["']/g;
    for (let m = date.exec(src); m; m = date.exec(src)) add(line(m.index), "native date input; use DateField (§8.2, gate 15)");
    const ph = /placeholder=["']([^"']*)["']/g;
    for (let m = ph.exec(src); m; m = ph.exec(src)) {
      const p = placeholderProblem(m[1]);
      if (p) add(line(m.index), p);
    }
    const btn = /<Button\b[^>]*>\s*([^<{]+?)\s*<\/Button>/g;
    for (let m = btn.exec(src); m; m = btn.exec(src)) {
      if (bannedButton(m[1])) add(line(m.index), `button "${m[1]}" says nothing; use Verb Noun (§5.4)`);
    }
  }
}

checkDemo();
checkApps();

if (problems.length) {
  console.error(`forms: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(p);
  console.error("\nRules: docs/FRONTEND_GUIDE.md §8 (one form system). Fields: docs/COMPONENTS.md (Forms);");
  console.error("a field that does not exist yet is added to packages/ui/src/form with npm run new:component.");
  process.exit(1);
}
console.log(`forms: ok (demo.html and ${frontendFiles().length} frontend file(s))`);

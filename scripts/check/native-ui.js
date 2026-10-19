#!/usr/bin/env node
"use strict";
/**
 * Gate 21, nothing the browser styles for itself (FRONTEND_GUIDE §8.8,
 * FRONTEND_FOUNDATION F25). No exemptions.
 *
 * Every control, list, tooltip, toast and message a person sees is drawn in
 * the brand's tokens by a packages/ui component. The browser's own picker,
 * spinner, tooltip, validation bubble or toast never shows, on either shell:
 * a phone's grey native select in the middle of a branded sheet is a defect.
 *
 * Static half, this scan of packages/ui/src, app/src and public-app/src
 * (packages/ui included: the shared components are held to it too):
 *
 *   - a native-chrome element: <select>, <option>, <optgroup>, <datalist>,
 *     <progress>, <meter>, <dialog> (SelectMenu, ProgressBar, Modal instead)
 *   - an <input> whose type the browser draws: date, time, datetime-local,
 *     month, week, number, range, color, checkbox, radio (DateField, TimeField,
 *     NumberField, Switch, CheckboxField, ChoiceField instead); a `list=`
 *     attribute (a datalist)
 *   - a `title=` on an HTML element: the browser's tooltip (Tooltip instead;
 *     IconButton draws one from its label)
 *   - a <form> without noValidate: the browser's validation bubble (Form)
 *   - the same built through the DOM: createElement("select"),
 *     setAttribute("title", ...), a Leaflet marker's `title` option (an
 *     `el.title =` cannot be told from a record's title in source; the
 *     rendered half catches it)
 *   - sonner imported outside packages/ui/src/feedback: a toast that skips
 *     the branded Toaster
 *
 * Rendered half, in lib/screens.js (`collect`, the `native` list) and read
 * here: on every gallery page and every app screen, at phone and desktop size,
 * a visible native-chrome element or browser-drawn input, an element carrying
 * a title, a form without novalidate, a text control the reset in base.css did
 * not reach (computed `appearance` not none), or a toast sonner styled itself.
 *
 * Usage:
 *   node scripts/check/native-ui.js            static and rendered (needs Chromium)
 *   node scripts/check/native-ui.js --static   the source scan only
 */
const { scan, frontendFiles, read, lineOf } = require("./lib/sources");

const NATIVE_TAGS = ["select", "option", "optgroup", "datalist", "progress", "meter", "dialog"];
const NATIVE_TYPES = ["date", "time", "datetime-local", "month", "week", "number", "range", "color", "checkbox", "radio"];
/** Lowercase names TypeScript writes between angle brackets that are not elements. */
const TS_TYPES = new Set(["string", "number", "boolean", "unknown", "any", "never", "object", "null", "undefined", "void", "bigint", "symbol"]);
const SONNER_HOME = /^packages\/ui\/src\/feedback\//;

const REPLACEMENT = {
  select: "SelectField, FilterSelect or InlineSelect (SelectMenu)",
  option: "SelectField, FilterSelect or InlineSelect (SelectMenu)",
  optgroup: "SelectField (SelectMenu)",
  datalist: "SelectField, PersonPicker or RecordPicker",
  progress: "ProgressBar",
  meter: "ProgressBar",
  dialog: "Modal, Sheet or ConfirmDialog",
};

/**
 * The opening JSX tags of lowercase (HTML) elements in comment-free code,
 * as [{ tag, attrs, index }]. Attribute values may hold `>` (an arrow
 * function) or braces, so the tag is walked, not cut at the first `>`.
 */
function htmlTags(code) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const tag = m[1];
    if (TS_TYPES.has(tag)) continue;
    // `a<b` and `useState<string>`: a comparison or a type argument, not JSX.
    let p = m.index - 1;
    while (p >= 0 && /\s/.test(code[p])) p -= 1;
    if (p >= 0 && /[\w$)\]]/.test(code[p])) continue;
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
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag, attrs: code.slice(m.index + m[0].length, i), index: m.index });
  }
  return out;
}

/** The literal value of a JSX attribute (`type="date"`, `type={"date"}`), or null. */
function attrValue(attrs, name) {
  const m = new RegExp(`(?<![\\w.$-])${name}\\s*=\\s*(?:\\{\\s*)?(["'\`])([^"'\`]*)\\1`).exec(attrs);
  return m ? m[2] : null;
}
const hasAttr = (attrs, name) => new RegExp(`(?<![\\w.$-])${name}(?![\\w-])\\s*(=|\\s|/|$)`).test(attrs);

/** Pure: browser-styled UI in a source file, as [{ index, what, fix }]. Comments are skipped. */
function findNativeUi(src, file = "") {
  const { code } = scan(src);
  const out = [];
  for (const t of htmlTags(code)) {
    if (NATIVE_TAGS.includes(t.tag)) out.push({ index: t.index, what: `<${t.tag}>`, fix: REPLACEMENT[t.tag] });
    if (t.tag === "input") {
      const type = attrValue(t.attrs, "type");
      if (type && NATIVE_TYPES.includes(type.toLowerCase())) out.push({ index: t.index, what: `<input type="${type}">`, fix: "the typed field from @mycity/ui" });
      if (hasAttr(t.attrs, "list")) out.push({ index: t.index, what: "<input list>", fix: "SelectField, PersonPicker or RecordPicker" });
    }
    if (t.tag === "form" && !hasAttr(t.attrs, "noValidate")) out.push({ index: t.index, what: "<form> without noValidate", fix: "Form" });
    if (t.tag !== "svg" && t.tag !== "title" && hasAttr(t.attrs, "title")) out.push({ index: t.index, what: `<${t.tag} title>`, fix: "Tooltip (IconButton has one built in)" });
  }
  const dom = [
    [new RegExp(`createElement\\(\\s*(["'\`])(${NATIVE_TAGS.join("|")})\\1`, "g"), (m) => `createElement("${m[2]}")`, "a packages/ui component"],
    [/setAttribute\(\s*(["'`])title\1/g, () => 'setAttribute("title")', "Tooltip"],
    [/\bL\.marker\((?:[^()]|\([^()]*\))*\btitle\s*:/g, () => "a Leaflet marker's title option", "bindTooltip with the map-tip class"],
  ];
  for (const [re, what, fix] of dom) for (let m = re.exec(code); m; m = re.exec(code)) out.push({ index: m.index, what: what(m), fix });
  if (!SONNER_HOME.test(file)) {
    const re = /(?:from\s*|import\s*\(\s*|require\(\s*)(["'`])sonner\1/g;
    for (let m = re.exec(code); m; m = re.exec(code)) out.push({ index: m.index, what: "sonner imported directly", fix: "toast and Toaster from @mycity/ui" });
  }
  return out.sort((a, b) => a.index - b.index);
}

function staticProblems() {
  const problems = [];
  const files = frontendFiles();
  for (const file of files) {
    const src = read(file);
    for (const f of findNativeUi(src, file)) problems.push(`  ${file}:${lineOf(src, f.index)}: ${f.what} is drawn by the browser; use ${f.fix}`);
  }
  return { problems, files: files.length };
}

/** The rendered findings a crawled screen carries (lib/screens.js collect, `native`). */
function renderedMessages(sc) {
  return (sc.native || []).map((n) => `${n.what}${n.label ? ` "${n.label}"` : ""} is drawn by the browser (gate 21)${n.state ? ` in state "${n.state}"` : ""}`);
}

const HINT =
  "\nEvery control, tooltip, toast and message is a packages/ui component in the brand's tokens (gate 21,\n" +
  "FRONTEND_GUIDE §8.8; docs/COMPONENTS.md). A missing one is added in packages/ui with npm run new:component.";

async function main() {
  const { problems, files } = staticProblems();
  if (process.argv.includes("--static")) {
    if (problems.length) {
      console.error(`native-ui: ${problems.length} problem(s)\n`);
      for (const p of problems) console.error(p);
      console.error(HINT);
      process.exit(1);
    }
    console.log(`native-ui: ok (static, ${files} frontend file(s))`);
    return;
  }
  const { crawl, finish, run } = require("./lib/screens");
  run("native-ui", async () => {
    const result = await crawl();
    const findings = [];
    for (const sc of result.screens) for (const message of renderedMessages(sc)) findings.push({ width: sc.width, screen: sc.screen, message });
    finish("native-ui", findings, result, problems.length ? [...problems, HINT] : []);
  });
}

module.exports = { findNativeUi, htmlTags, renderedMessages, NATIVE_TAGS, NATIVE_TYPES };

if (require.main === module) main();

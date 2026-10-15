#!/usr/bin/env node
"use strict";
/**
 * Add a screen (a tab) to the staff app, the one way (FRONTEND_FOUNDATION §4, PR 2):
 *
 *   npm run new:screen -- --module people --tab "Work Patterns" --m M1 --owner LA [--slug work-patterns] [--name WorkPatterns] [--dry-run]
 *
 * A screen is more than a component: the shell's catalogue, the backend's route
 * map, the delivery plan and the screen gates all read it. This writes every
 * piece at once, so none drifts:
 *
 *   app/src/shell/catalogue.ts           the tab in its module (the shell, the URL, screens.json)
 *   src/shared/route-map.js              the slug in SCREENS (links the backend derives land on it)
 *   app/src/features/<folder>/<Name>.tsx  the screen, from @mycity/ui only, with its page header
 *   app/src/features/<folder>/index.tsx   its case in the module's switch
 *   app/src/shell/coming-soon.ts         its Coming Soon entry (fill in what it will do)
 *   docs/PROGRESS.md                     its row (Not started), the Summary and the screen count
 *   scripts/check/progress.js            the inventory size the progress gate holds
 *   tests/unit/foundation/events-workflow.test.js   the staff-app screen count
 *
 * The screen gates (8, 11, a11y) crawl it from the next build: it is in
 * app/dist/screens.json. What it leaves to you, printed at the end: the
 * screen's rows in its feature guide's §10, the Coming Soon lines, and the
 * screen itself. A new screen changes the approved inventory (MILESTONES §18):
 * agree it first.
 *
 * Exit 0 written (or planned, with --dry-run), 1 refused.
 */
const fs = require("node:fs");
const path = require("node:path");
const { formatDate } = require("../src/shared/time/day-first");

const ROOT = path.resolve(__dirname, "..");
const OWNERS = ["GE", "TB", "LA", "AJ"];
const FILES = {
  catalogue: "app/src/shell/catalogue.ts",
  screens: "app/src/shell/screens.tsx",
  routeMap: "src/shared/route-map.js",
  coming: "app/src/shell/coming-soon.ts",
  progress: "docs/PROGRESS.md",
  progressGate: "scripts/check/progress.js",
  routeTest: "tests/unit/foundation/events-workflow.test.js",
};

/** PROGRESS.md's section heading for each module key (the same map as app/src/lib/plan.ts). */
const SECTION = {
  home: "Home", workspace: "My Workspace", ess: "Employee Self-Service", community: "Staff Community", mailbox: "Mailbox",
  people: "People", performance: "Performance", queries: "Queries & Sanctions", recruitment: "Recruitment", payroll: "Payroll",
  partnerships: "Partnerships", expenses: "Expenses", knowledge: "Knowledge Hub", praxis_ai: "Praxis AI", settings: "Settings",
};

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);
const slugOf = (label) => label.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pascalOf = (label) => label.replace(/&/g, "And").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const titleCase = (label) => label.split(/\s+/).every((w, i) => !/[a-z]/i.test(w[0]) || w[0] === w[0].toUpperCase() || (i > 0 && SMALL.has(w)));

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

/* ───── pure edits: text in, text out ───── */

/**
 * Appends an item to the array body between `open` and the next "]", keeping
 * its shape: a one-line array stays on one line; a multi-line one gets the item
 * on its own line (`ownLine`) or after the last item, with the trailing comma
 * kept.
 */
function appendTo(text, open, item, ownLine) {
  const close = text.indexOf("]", open);
  const inner = text.slice(open, close);
  const trail = /\s*$/.exec(inner)[0];
  const comma = /,\s*$/.test(inner);
  const core = inner.slice(0, inner.length - trail.length).replace(/,$/, "");
  let next;
  if (inner.includes("\n") && ownLine) {
    const indent = (/\n([ \t]*)\S[^\n]*$/.exec(core) || ["", "    "])[1];
    next = `${core},\n${indent}${item}${comma ? "," : ""}${trail}`;
  } else {
    next = `${core}, ${item}${comma ? "," : ""}${trail}`;
  }
  return text.slice(0, open) + next + text.slice(close);
}

/** The module's `tabs: [...]` in the catalogue, with the new tab last. */
function addToCatalogue(text, moduleKey, label, slug) {
  const at = text.search(new RegExp(`key: "${moduleKey}",`));
  if (at < 0) refuse(`no module "${moduleKey}" in ${FILES.catalogue}`);
  const open = text.indexOf("tabs: [", at) + "tabs: [".length;
  if (text.slice(open, text.indexOf("]", open)).includes(`"${slug}"`)) refuse(`${moduleKey} already has a tab "${slug}"`);
  return appendTo(text, open, `t("${label}", "${slug}")`, false);
}

/** The module's slug list in route-map.js SCREENS, with the new slug last. */
function addToRouteMap(text, moduleKey, slug) {
  const m = new RegExp(`\\n  ${moduleKey}: \\[`).exec(text);
  if (!m) refuse(`no "${moduleKey}" in SCREENS in ${FILES.routeMap}`);
  const open = m.index + m[0].length;
  if (text.slice(open, text.indexOf("]", open)).includes(`"${slug}"`)) refuse(`${FILES.routeMap} already lists "${slug}" for ${moduleKey}`);
  return appendTo(text, open, `"${slug}"`, true);
}

/** The module's feature folder, from its lazy import in app/src/shell/screens.tsx. */
function folderOf(screensText, moduleKey) {
  const m = new RegExp(`\\n  ${moduleKey}: lazy\\(\\(\\) => import\\("@/features/([a-z0-9_-]+)"\\)\\)`).exec(screensText);
  if (!m) refuse(`no lazy import for "${moduleKey}" in ${FILES.screens}`);
  return m[1];
}

/** The screen file: a page header and nothing invented; the work starts from here. */
function screenSource({ name, label, moduleKey, slug, m }) {
  return `import { EmptyState, PageHeader } from "@mycity/ui";

/**
 * ${SECTION[moduleKey]} · ${label} (\`${slug}\`, ${m}). What it shows open, behind help
 * and on a phone is its feature guide's §10; build it from @mycity/ui only
 * (docs/COMPONENTS.md), on the API through the contract, lists 25 to a page
 * (FRONTEND_GUIDE §3, §4).
 */
export function ${name}() {
  return (
    <>
      <PageHeader title="${label}" />
      <EmptyState title="Nothing Here Yet" text="Records appear here once added." />
    </>
  );
}
`;
}

/** The module's index: the import, and a case before `default:`. */
function addToIndex(text, name, slug) {
  if (new RegExp(`case "${slug}":`).test(text)) refuse(`the module's index already has a case "${slug}"`);
  const imports = [...text.matchAll(/^import .*;$/gm)];
  if (!imports.length) refuse("the module's index has no imports to follow");
  const last = imports[imports.length - 1];
  const withImport = text.slice(0, last.index + last[0].length) + `\nimport { ${name} } from "./${name}";` + text.slice(last.index + last[0].length);
  const d = /\n(\s*)default:/.exec(withImport);
  if (!d) refuse("the module's index has no `default:` in its switch; add the case by hand");
  const pad = d[1];
  return withImport.slice(0, d.index) + `\n${pad}case "${slug}":\n${pad}  return <${name} />;` + withImport.slice(d.index);
}

/** An empty Coming Soon entry, before the map's end. */
function addToComing(text, moduleKey, slug) {
  const key = `${moduleKey}/${slug}`;
  if (text.includes(`"${key}"`)) return text;
  const end = text.lastIndexOf("};");
  if (end < 0) refuse(`no end to COMING in ${FILES.coming}`);
  return text.slice(0, end).replace(/\s*$/, "") + `\n  "${key}": [],\n` + text.slice(end);
}

/** Today, day-first in Lagos, for the PROGRESS note (the one date format, src/shared/time). */
const today = (now = new Date()) => formatDate(now);

/** The row, its dated note, the Summary and the count in PROGRESS.md; returns the text and the row's number. */
function addToProgress(text, moduleKey, label, slug, m, owner, date = today()) {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => l.startsWith("### ") && l.slice(4).split(" · ")[0].trim() === SECTION[moduleKey]);
  if (head < 0) refuse(`no "### ${SECTION[moduleKey]}" section in ${FILES.progress}`);
  const row = /^\| (\d+) \| [^|]+ \| `([^`]+)` \|/;
  let last = -1;
  for (let i = head + 1; i < lines.length && !lines[i].startsWith("### "); i += 1) {
    const r = row.exec(lines[i]);
    if (r) {
      if (r[2] === slug) refuse(`${FILES.progress} already has ${SECTION[moduleKey]} · \`${slug}\``);
      last = i;
    }
  }
  if (last < 0) refuse(`the ${SECTION[moduleKey]} section has no screen rows`);
  const numbers = lines.map((l) => row.exec(l)).filter(Boolean).map((r) => Number(r[1]));
  const n = Math.max(...numbers) + 1;
  lines.splice(last + 1, 0, `| ${n} | ${label} | \`${slug}\` | ${m} | ${owner} | ☐ | ☐ | ☐ | Not started | |`);

  // Its note, newest first under the section's Notes.
  const notes = lines.findIndex((l, i) => i > last && l.trim() === "**Notes**");
  const next = lines.findIndex((l, i) => i > last && l.startsWith("### "));
  if (notes < 0 || (next >= 0 && notes > next)) refuse(`the ${SECTION[moduleKey]} section has no **Notes**`);
  const note = `- ${date} · ${owner} · ${label} added with npm run new:screen (catalogue, route map, screen file, Coming Soon); not started.`;
  let at = notes + 1;
  while (at < lines.length && lines[at].trim() === "") at += 1;
  if (lines[at] && lines[at].trim() === "_None yet._") lines[at] = note;
  else lines.splice(at, 0, note);

  const ms = m === "M0" ? "M1" : m;
  const bump = (line) => {
    const cells = line.split("|");
    const inc = (i) => {
      cells[i] = cells[i].replace(/\d+/, (d) => String(Number(d) + 1));
    };
    inc(2);
    inc(3);
    return cells.join("|");
  };
  let summary = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(`^\\| ${ms} [^|]+ \\| \\d+ \\|`).test(lines[i]) || /^\| \*\*Total\*\* \|/.test(lines[i])) {
      lines[i] = bump(lines[i]);
      summary += 1;
    }
  }
  if (summary !== 2) refuse(`could not find the Summary rows for ${ms} and Total in ${FILES.progress}`);
  let out = lines.join("\n");
  out = out.replace(/(\*\*The single record of what is built\.\*\* )(\d+) screens \((\d+) in the staff app/, (_, a, t, s) => `${a}${Number(t) + 1} screens (${Number(s) + 1} in the staff app`);
  return { text: out, n };
}

/** The inventory size in the progress gate. */
const bumpProgressGate = (text) => text.replace(/const SCREENS = (\d+);/, (_, d) => `const SCREENS = ${Number(d) + 1};`);
/** The staff-app screen count in the route map's test. */
const bumpRouteTest = (text) => text.replace(/(Object\.values\(routeMap\.SCREENS\)\.flat\(\)\)\.toHaveLength\()(\d+)\)/, (_, a, d) => `${a}${Number(d) + 1})`);

/* ───── the command ───── */

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

function plan(argv, root = ROOT) {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const moduleKey = arg(argv, "module");
  const label = (arg(argv, "tab") || "").trim();
  const m = arg(argv, "m");
  const owner = arg(argv, "owner");
  if (!moduleKey || !SECTION[moduleKey]) refuse(`--module must be one of ${Object.keys(SECTION).join(", ")}`);
  if (!label) refuse('--tab is the tab\'s label, like --tab "Work Patterns"');
  const words = label.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length > 3) refuse(`"${label}" is ${words.length} words; a tab is at most 3 (FRONTEND_GUIDE §5.3)`);
  if (!titleCase(label)) refuse(`"${label}" is not Title Case (FRONTEND_GUIDE §5.4)`);
  if (/[—–]|--/.test(label)) refuse(`"${label}" has a dash (gate 17)`);
  if (!m || !/^M(?:[0-9]|1[01])$/.test(m)) refuse("--m is the milestone, M0 to M11");
  if (!owner || !OWNERS.includes(owner)) refuse(`--owner is one of ${OWNERS.join(", ")}`);
  const slug = arg(argv, "slug") || slugOf(label);
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) refuse(`slug "${slug}" must be lower-case words joined by hyphens`);
  const name = arg(argv, "name") || pascalOf(label);
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name)) refuse(`--name "${name}" must be PascalCase`);

  const folder = folderOf(read(FILES.screens), moduleKey);
  const screenFile = `app/src/features/${folder}/${name}.tsx`;
  const indexFile = `app/src/features/${folder}/index.tsx`;
  if (fs.existsSync(path.join(root, screenFile))) refuse(`${screenFile} already exists`);

  const progress = addToProgress(read(FILES.progress), moduleKey, label, slug, m, owner);
  const writes = [
    [FILES.catalogue, addToCatalogue(read(FILES.catalogue), moduleKey, label, slug)],
    [FILES.routeMap, addToRouteMap(read(FILES.routeMap), moduleKey, slug)],
    [screenFile, screenSource({ name, label, moduleKey, slug, m })],
    [indexFile, addToIndex(read(indexFile), name, slug)],
    [FILES.coming, addToComing(read(FILES.coming), moduleKey, slug)],
    [FILES.progress, progress.text],
    [FILES.progressGate, bumpProgressGate(read(FILES.progressGate))],
    [FILES.routeTest, bumpRouteTest(read(FILES.routeTest))],
  ];
  return { moduleKey, label, slug, name, m, owner, n: progress.n, folder, writes };
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry-run");
  let p;
  try {
    p = plan(argv);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    console.error(`new:screen: ${err.message}`);
    console.error('Usage: npm run new:screen -- --module people --tab "Work Patterns" --m M1 --owner LA [--slug work-patterns] [--name WorkPatterns] [--dry-run]');
    process.exit(1);
  }
  for (const [file, text] of p.writes) {
    if (!dry) fs.writeFileSync(path.join(ROOT, file), text);
    console.log(`  ${dry ? "would write" : "wrote"} ${file}`);
  }
  console.log(`\n${dry ? "Planned" : "Added"} ${SECTION[p.moduleKey]} · ${p.label} (\`${p.slug}\`, #${p.n}, ${p.m}, ${p.owner}): /${p.moduleKey.replace(/_/g, "-")}?tab=${p.slug}`);
  console.log("\nLeft to you:");
  console.log(`  1. Its rows in the feature guide's §10 (docs/guides/<feature>.md): open, behind help, phone layout.`);
  console.log(`  2. What it will do, in app/src/shell/coming-soon.ts ("${p.moduleKey}/${p.slug}"), three short lines.`);
  console.log(`  3. The screen: app/src/features/${p.folder}/${p.name}.tsx, from @mycity/ui (docs/COMPONENTS.md, npm run gallery).`);
  console.log("  4. npm run ci: gates 8, 11 and a11y crawl it from the next build (app/dist/screens.json).");
}

module.exports = { today, addToCatalogue, addToRouteMap, addToIndex, addToComing, addToProgress, bumpProgressGate, bumpRouteTest, folderOf, screenSource, slugOf, pascalOf, titleCase, plan, Refusal };
if (require.main === module) main();

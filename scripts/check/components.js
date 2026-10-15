#!/usr/bin/env node
"use strict";
/**
 * The component catalogue gate (FRONTEND_FOUNDATION F8, F11). One design system
 * for both apps works only if every shared component lives in packages/ui, is
 * documented and tested, and no feature quietly builds its own. This refuses:
 *
 *   - a stale docs/COMPONENTS.md (npm run gen:components)
 *   - a component file in packages/ui/src without a full header (@component,
 *     @group, @summary, @use, @avoid, @phone, @a11y, @status; a known group and
 *     status; no TODO left from the scaffold; @component equal to the file name)
 *   - a component (or a name in its @exports) without an exported `<Name>Props`
 *     interface in its file, or with a prop that has no JSDoc line (SPEC §2;
 *     the catalogue's props table is read from it)
 *   - a component without its X.test.tsx and X.gallery.tsx beside it
 *   - a component, or a name in its @exports, missing from the package barrel
 *   - a file in app/src/components or public-app/src/components that is not on
 *     LEGACY below (nothing new is added there; shared components go to packages/ui)
 *   - a LEGACY entry whose file is gone (take it off the list)
 *   - docs/FRONTEND_FOUNDATION.md §7 not listing exactly the LEGACY files
 *   - a PascalCase component declared in app/src or public-app/src with the name
 *     of a packages/ui component (a feature shadowing a shared one)
 *
 * Usage: node scripts/check/components.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const gen = require("../gen/components");

const { ROOT, GROUPS, STATUSES, REQUIRED } = gen;

/**
 * Components from #18 still inside the apps, and the PR that moves each into
 * packages/ui (FRONTEND_FOUNDATION §7 mirrors this list). Entries only leave.
 */
const LEGACY = [
  ["app/src/components/form/index.ts", "the barrel for PersonPicker and Upload", "PR 3 (pickers, upload engine)"],
  ["app/src/components/form/PersonPicker.tsx", "PersonPicker", "PR 3 (pickers)"],
  ["app/src/components/form/Upload.tsx", "Upload", "PR 3 (upload engine)"],
  ["app/src/components/ui/layout.tsx", "Sub", "PR 3 (display)"],
  ["app/src/components/ui/data.tsx", "Kpi, StatStrip, Timeline, Bars, Chain, Accordion, TapList", "PR 3 (display)"],
  ["app/src/components/ui/Table.tsx", "Table, Pager, Toolbar, LoadingRows", "PR 3 (DataView)"],
  ["app/src/components/ui/Board.tsx", "Board", "PR 3 (kanban)"],
  ["app/src/components/ui/Calendar.tsx", "Calendar", "PR 3 (calendar)"],
  ["app/src/components/ui/charts.tsx", "AreaChart, Donut, Bands", "PR 3 (charts)"],
  ["app/src/components/ui/Paper.tsx", "documents", "PR 3 (PDF and document preview)"],
  ["app/src/components/ui/Profile.tsx", "360 header", "PR 3 (profile header)"],
  ["app/src/components/ui/Reader.tsx", "articles", "PR 3 (reader)"],
  ["app/src/components/ui/StagingBar.tsx", "staging bar", "PR 2 (shell)"],
  ["public-app/src/components/ui.tsx", "Sub", "PR 3 (display)"],
  ["public-app/src/components/form/index.ts", "the barrel for Upload", "PR 3 (upload engine)"],
  ["public-app/src/components/form/Upload.tsx", "Upload", "PR 3 (upload engine)"],
  ["public-app/src/components/SignaturePad.tsx", "SignaturePad", "PR 3 (signature field)"],
  ["public-app/src/components/StagingBar.tsx", "staging bar", "PR 2 (shell)"],
  ["public-app/src/components/Layout.tsx", "Page, Brand, Message, demo strip", "PR 2 (public shell)"],
  ["public-app/src/components/Planned.tsx", "Coming Soon page", "PR 2 (public shell)"],
];

const problems = [];
const add = (where, message) => problems.push(`  ${where}: ${message}`);

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

/** Comments and strings blanked, so a name in either is not a declaration. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => " ".repeat(m.length));
}

function checkPackage() {
  const collected = gen.collect();
  const { components, exported } = collected;
  const names = new Set();
  for (const c of components) {
    const h = c.header;
    if (!h) {
      add(c.rel, "no component header; open the file with /** @component ... */ (run npm run new:component for the template)");
      continue;
    }
    for (const tag of REQUIRED) if (!h[tag]) add(c.rel, `header has no @${tag}`);
    if (h.group && !GROUPS.includes(h.group)) add(c.rel, `@group "${h.group}" is not one of ${GROUPS.join(", ")}`);
    if (h.status && !STATUSES.includes(h.status)) add(c.rel, `@status "${h.status}" is not one of ${STATUSES.join(", ")}`);
    if (h.component && h.component !== c.base) add(c.rel, `@component "${h.component}" does not match the file name ${c.base}.tsx`);
    for (const tag of [...REQUIRED, "example"]) {
      const v = Array.isArray(h[tag]) ? h[tag].join(" ") : h[tag];
      if (v && /\bTODO\b/.test(v)) add(c.rel, `@${tag} still says TODO; write it`);
    }
    if (!c.test) add(c.rel, `no ${c.base}.test.tsx beside it`);
    if (!c.gallery) add(c.rel, `no ${c.base}.gallery.tsx beside it`);
    for (const { component, props } of c.props) {
      if (!props) {
        add(c.rel, `${component} has no ${component}Props; declare \`export interface ${component}Props\` with a JSDoc line on every prop`);
        continue;
      }
      if (!props.exported) add(c.rel, `${props.name} is not exported; write \`export interface ${props.name}\``);
      else if (!exported.has(props.name)) add(c.rel, `${props.name} is not exported from @mycity/ui (export the type from the group barrel)`);
      for (const p of props.props) if (!p.doc) add(c.rel, `${props.name}.${p.name} has no JSDoc line; say what the prop does in /** ... */ above it`);
    }
    for (const n of [c.name, ...h.exports]) {
      names.add(n);
      if (!exported.has(n)) add(c.rel, `${n} is not exported from @mycity/ui (add it to the group barrel, packages/ui/src/<group>/index.ts)`);
    }
  }
  const fresh = gen.render(collected);
  const current = fs.existsSync(gen.OUT) ? fs.readFileSync(gen.OUT, "utf8") : null;
  if (current !== fresh) add("docs/COMPONENTS.md", "stale; run npm run gen:components");
  return names;
}

function checkApps(shared) {
  const allowed = new Map(LEGACY.map(([file, holds, pr]) => [file, { holds, pr }]));
  const present = [...listFiles(path.join(ROOT, "app", "src", "components")), ...listFiles(path.join(ROOT, "public-app", "src", "components"))];
  for (const file of present) {
    if (!allowed.has(file)) add(file, "new file in an app's components folder; shared components live in packages/ui (npm run new:component, docs/COMPONENTS.md)");
  }
  for (const [file] of LEGACY) if (!present.includes(file)) add(file, "on LEGACY but no longer exists; remove it from LEGACY in scripts/check/components.js");

  const sources = [...listFiles(path.join(ROOT, "app", "src")), ...listFiles(path.join(ROOT, "public-app", "src"))].filter((f) => /\.(tsx|ts)$/.test(f));
  const decl = /\b(?:function|const|let|var|class)\s+([A-Z][A-Za-z0-9]*)\b/g;
  for (const file of sources) {
    const src = code(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const seen = new Set();
    for (let m = decl.exec(src); m; m = decl.exec(src)) {
      if (shared.has(m[1]) && !seen.has(m[1])) {
        seen.add(m[1]);
        const line = src.slice(0, m.index).split("\n").length;
        add(`${file}:${line}`, `declares ${m[1]}, which is a @mycity/ui component; import it from "@mycity/ui" instead (docs/COMPONENTS.md)`);
      }
    }
  }
}

/** FRONTEND_FOUNDATION §7 lists exactly the LEGACY files, one table row each. */
function checkFoundationTable() {
  const doc = path.join(ROOT, "docs", "FRONTEND_FOUNDATION.md");
  if (!fs.existsSync(doc)) return add("docs/FRONTEND_FOUNDATION.md", "missing");
  const text = fs.readFileSync(doc, "utf8");
  const start = text.indexOf("\n## 7 ");
  if (start < 0) return add("docs/FRONTEND_FOUNDATION.md", "no §7 (components still in the apps)");
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end < 0 ? undefined : end);
  const listed = new Set();
  for (const m of section.matchAll(/^\| `((?:app|public-app)\/src\/components\/[^`]+)` \|/gm)) listed.add(m[1]);
  const legacy = new Set(LEGACY.map(([file]) => file));
  for (const f of legacy) if (!listed.has(f)) add("docs/FRONTEND_FOUNDATION.md §7", `${f} is on LEGACY but not in the table; add its row`);
  for (const f of listed) if (!legacy.has(f)) add("docs/FRONTEND_FOUNDATION.md §7", `${f} is in the table but not on LEGACY; remove its row`);
}

function main() {
  const shared = checkPackage();
  checkApps(shared);
  checkFoundationTable();

  if (problems.length) {
    console.error(`components: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error("\nShared components live in packages/ui: npm run new:component -- --name <Name> --group <Group>.");
    console.error("Catalogue: docs/COMPONENTS.md (npm run gen:components). Rules: docs/FRONTEND_FOUNDATION.md F8.");
    process.exit(1);
  }
  console.log(`components: ok (${shared.size} component(s) in packages/ui, ${LEGACY.length} legacy file(s) in the apps)`);
  console.log("\nStill in the apps, and the PR that moves each into packages/ui:");
  for (const [file, holds, pr] of LEGACY) console.log(`  ${file.padEnd(46)} ${pr.padEnd(34)} ${holds}`);
}

// LEGACY is read by other gates (forms.js, upload.js): the checks run only when called directly.
module.exports = { LEGACY };
if (require.main === module) main();

#!/usr/bin/env node
"use strict";
/**
 * The User Guide gate (docs/guides/user-guide.md §6.6; JBS Praxis, 25/10/2026): what the guide
 * tells a person is what the hub does, so nobody reads a step and cannot find the button.
 *
 * Every run, over every chapter in docs/manual (a file that opens with front matter):
 *
 *   1. it parses (packages/contract/guide.js): front matter, attributes, no stray syntax; and
 *      every section and task slug is unique across the whole guide
 *   2. every screen link (/module?tab=x) and every section's `screen` is a tab the hub has
 *      (src/shared/route-map.js SCREENS)
 *   3. every #slug link names a section or task that exists
 *   4. every `needs` names a real module and action, or a catalogued capability
 *      (src/shared/access/access.catalog.js), and every icon is one of the hub's
 *   5. a task or step that names one of ⌘K's actions in bold (**Add Employee**, **Invite User**)
 *      declares that action's grant, itself or in its section, so a reader without it never
 *      receives the step
 *   6. every bold name is found in the hub's own source (the app, the shared components, the
 *      API's messages, the contract, the reference seeds, the emails): a button renamed on screen fails the
 *      chapter that still names the old one. A link's words are its screen's name, not checked
 *   7. every picture has its spec, every file its devices need, and an entry in its chapter's
 *      shots.json whose hashes are today's (scripts/guide/lib.js): a picture whose screen or
 *      spec changed after it was taken is stale. A picture file no spec names is an orphan
 *   8. for every milestone a chapter names in `milestones`, every screen of that milestone in
 *      docs/PROGRESS.md (Dropped aside) has a section about it
 *   9. a file that is neither a chapter nor empty waits for its milestone's guide pull request,
 *      named in WAITING below with why; an entry for a file that is now a chapter is stale
 *
 * On a change (scripts/check/lib/changes.js):
 *
 *  10. a change to code a chapter covers (its sections' feature folders, its `covers`, its
 *      pictures' sources; tests aside) changes the chapter or its pictures too. The one way
 *      out, with its reason, in the PR description or a commit message:
 *        User-guide-unchanged: <reason>
 *      Stale pictures (7) fail whatever the trailer says.
 *
 * Usage: node scripts/check/user-guide.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { slugsOf, linksOf } = require("../../packages/contract/guide");
const { ROOT, IMG, readChapters, hashesOf, readShots, sourcesOf, moduleOfOpen } = require("../guide/lib");
const { changedFiles, trailer } = require("./lib/changes");

const problems = [];
const notes = [];
const say = (p) => problems.push(p);

/**
 * Files in docs/manual written before the guide had its format, each converted by its own
 * milestone's guide pull request (JBS Praxis, 25/10/2026: PR 2 is Milestone 1). Remove a line
 * when its file becomes a chapter; the gate fails a line whose file no longer needs it.
 */
const WAITING = {};

/** docs/PROGRESS.md's module headings, as module keys (scripts/new-screen.js SECTION). */
const SECTION_KEYS = {
  Home: "home",
  "My Workspace": "workspace",
  "Employee Self-Service": "ess",
  "Staff Community": "community",
  Mailbox: "mailbox",
  People: "people",
  Performance: "performance",
  "Queries & Sanctions": "queries",
  Recruitment: "recruitment",
  Payroll: "payroll",
  Partnerships: "partnerships",
  Expenses: "expenses",
  "Knowledge Hub": "knowledge",
  "Praxis AI": "praxis_ai",
  "AI Control": "ai_control",
  Settings: "settings",
};

/* ------------------------------------------------------------------ *
 * What the hub has
 * ------------------------------------------------------------------ */

const routeMap = require("../../src/shared/route-map");
const catalog = require("../../src/shared/access/access.catalog");
const { ACTIONS } = require("../../src/shared/search/actions");

const hasTab = (module, tab) => Array.isArray(routeMap.SCREENS[module]) && routeMap.SCREENS[module].includes(tab);
const hasModule = (module) => Object.prototype.hasOwnProperty.call(routeMap.SCREENS, module);

const ICONS = (() => {
  const src = fs.readFileSync(path.join(ROOT, "packages/ui/src/icons/Icon.tsx"), "utf8");
  const body = src.slice(src.indexOf("export const ICONS = {"), src.indexOf("} as const", src.indexOf("export const ICONS = {")));
  return new Set([...body.matchAll(/^\s+([a-z][a-z0-9]*):/gm)].map((m) => m[1]));
})();

/** Every text the hub carries: where a bold name must be found (6). */
const CORPUS = (() => {
  const roots = ["app/src", "packages/ui/src", "src", "packages/contract/schemas", "seeds/reference", "templates"];
  const parts = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!["node_modules", "dist", "mock"].includes(e.name)) walk(full);
      } else if (/\.(tsx?|jsx?|sql|json|html)$/.test(e.name) && !/\.test\.|\.gallery\./.test(e.name)) parts.push(fs.readFileSync(full, "utf8"));
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  /* The screens' own words are often in JSX text broken over lines: one space between words. */
  return parts.join("\n").replace(/\s+/g, " ");
})();

/* ------------------------------------------------------------------ *
 * 1 to 6: every chapter
 * ------------------------------------------------------------------ */

const { chapters, waiting } = readChapters();

for (const c of chapters) for (const p of c.problems) say(p);

const slugOwner = new Map();
for (const { file, chapter } of chapters)
  for (const s of slugsOf(chapter)) {
    if (slugOwner.has(s)) say(`${file}: slug #${s} is also used in ${slugOwner.get(s)}; every section and task has its own`);
    else slugOwner.set(s, file);
  }
if (slugOwner.has("quick-start")) say(`${slugOwner.get("quick-start")}: #quick-start is the Quick Start's own name`);

/** A need as the gate reads it, or a problem. */
function checkNeed(file, line, need) {
  if (need.kind === "grant") {
    if (!catalog.isModule(need.module)) say(`${file}:${line + 1}: needs "${need.module} ${need.action}": ${need.module} is not a module key`);
    else if (!catalog.ACTIONS.includes(need.action)) say(`${file}:${line + 1}: needs "${need.module} ${need.action}": the actions are ${catalog.ACTIONS.join(", ")}`);
  } else if (need.kind === "cap" && !catalog.isCapability(need.code)) say(`${file}:${line + 1}: needs "cap ${need.code}": not a catalogued capability`);
}

/** The needs of every part of a chapter, with where each sits. */
function* partsOf(chapter) {
  const blocks = function* (list, line, inherited) {
    for (const b of list) {
      if (b.kind === "steps") for (const s of b.items) yield { line: s.line, needs: [...inherited, ...s.needs], spans: s.spans };
      else if (b.kind === "bullets") for (const s of b.items) yield { line, needs: [...inherited, ...s.needs], spans: s.spans };
      else if (b.kind === "table") for (const r of b.rows) yield { line, needs: [...inherited, ...r.needs], spans: r.cells.flat() };
      else yield { line, needs: [...inherited, ...(b.needs || [])], spans: b.spans || [] };
    }
  };
  yield* blocks(chapter.intro, 0, []);
  for (const s of chapter.sections) {
    yield { line: s.line, needs: s.needs, spans: [] };
    yield* blocks(s.blocks, s.line, s.needs);
    for (const t of s.tasks) {
      yield { line: t.line, needs: [...s.needs, ...t.needs], spans: [] };
      yield* blocks(t.blocks, t.line, [...s.needs, ...t.needs]);
    }
  }
}

const ACTION_BY_LABEL = new Map(ACTIONS.filter((a) => a.need && a.need[1] !== "view").map((a) => [a.label, a]));

for (const { file, chapter } of chapters) {
  if (chapter.module && !catalog.isModule(chapter.module)) say(`${file}: module "${chapter.module}" is not a module key`);
  if (chapter.icon && !ICONS.has(chapter.icon)) say(`${file}: icon "${chapter.icon}" is not one of the hub's icons (packages/ui/src/icons/Icon.tsx)`);
  if (!chapter.summary) say(`${file}: front matter needs a summary, one line`);
  for (const s of chapter.sections) {
    if (s.screen && !hasTab(s.screen.module, s.screen.tab)) say(`${file}:${s.line + 1}: screen=${s.screen.module}/${s.screen.tab} is not a tab of the hub (src/shared/route-map.js)`);
    if (s.icon && !ICONS.has(s.icon)) say(`${file}:${s.line + 1}: icon "${s.icon}" is not one of the hub's icons`);
    if (chapter.kind === "quick-start" && s.title.split(/\s+/).length > 4) say(`${file}:${s.line + 1}: a Quick Start card's title is at most 4 words`);
  }
  for (const part of partsOf(chapter)) {
    for (const need of part.needs) checkNeed(file, part.line, need);
    for (const span of part.spans) {
      // 6: a bold name is on screen (a link's words are its screen's name, not checked here).
      if (span.bold && !span.href && !CORPUS.includes(span.text))
        say(`${file}:${part.line + 1}: **${span.text}** is not in the hub's source: write it as the screen reads it, or not in bold`);
      // 5: an action named in bold carries its grant.
      const action = span.bold && !span.href ? ACTION_BY_LABEL.get(span.text) : null;
      if (!action) continue;
      const [module, act] = action.need;
      const held = part.needs.some((n) => (n.kind === "grant" && n.module === module && n.action === act) || n.kind === "ceo");
      if (!held) say(`${file}:${part.line + 1}: **${span.text}** needs "${module} ${act}": put needs="${module} ${act}" on the step, its task or its section`);
    }
  }
  // 2 and 3: links.
  for (const link of linksOf(chapter)) {
    const at = `${file}:${link.line + 1}`;
    if (link.href.startsWith("#")) {
      if (!slugOwner.has(link.href.slice(1))) say(`${at}: link ${link.href} names no section or task of the guide`);
    } else if (link.href.startsWith("/")) {
      const m = /^\/([a-z-]+)(?:\?(.*))?$/.exec(link.href);
      const module = m ? m[1].replace(/-/g, "_") : null;
      const tab = m ? new URLSearchParams(m[2] || "").get("tab") : null;
      if (!module || !hasModule(module)) say(`${at}: link ${link.href} is not a module of the hub`);
      else if (tab && !hasTab(module, tab)) say(`${at}: link ${link.href}: ${tab} is not a tab of ${module}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 7: pictures
 * ------------------------------------------------------------------ */

const known = new Set(chapters.map((c) => c.chapter.slug));
const stale = [];
for (const { file, chapter } of chapters) {
  const shots = readShots(chapter.slug);
  for (const [id, spec] of Object.entries(chapter.shots)) {
    const module = moduleOfOpen(spec.open);
    if (module && !hasModule(module)) say(`${file}: picture ${id} opens ${spec.open}, which is not a module of the hub`);
    const missing = spec.devices.filter((d) => !fs.existsSync(path.join(IMG, chapter.slug, `${id}.${d}.png`)));
    if (missing.length) {
      say(`${file}: picture ${id} has no ${missing.join(" or ")} file yet: npm run guide:shots -- --chapter ${chapter.slug}`);
      continue;
    }
    const now = hashesOf(spec);
    const was = shots[id];
    if (!was) say(`${file}: picture ${id} is not in img/${chapter.slug}/shots.json: npm run guide:shots -- --chapter ${chapter.slug}`);
    else if (was.spec !== now.spec || was.source !== now.source) stale.push({ file, id, chapter: chapter.slug, why: was.spec !== now.spec ? "its spec changed" : "its screen's code changed" });
    for (const s of sourcesOf(spec)) if (s.endsWith("(missing)")) say(`${file}: picture ${id} names a source that is not there: ${s.replace(" (missing)", "")}`);
  }
}
for (const s of stale) say(`${s.file}: picture ${s.id} is stale (${s.why}): npm run guide:shots -- --shot ${s.id}`);
if (fs.existsSync(IMG))
  for (const dir of fs.readdirSync(IMG)) {
    const full = path.join(IMG, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    if (!known.has(dir)) {
      say(`docs/manual/img/${dir}: no chapter is called ${dir}`);
      continue;
    }
    const specs = chapters.find((c) => c.chapter.slug === dir).chapter.shots;
    for (const f of fs.readdirSync(full)) {
      if (f === "shots.json") continue;
      const m = /^([a-z0-9-]+)\.(desktop|phone)\.png$/.exec(f);
      if (!m || !specs[m[1]] || !specs[m[1]].devices.includes(m[2])) say(`docs/manual/img/${dir}/${f}: no picture spec names it; remove it, or write its spec`);
    }
  }

/* ------------------------------------------------------------------ *
 * 8: every screen of a milestone the guide covers
 * ------------------------------------------------------------------ */

const covered = new Set(chapters.flatMap((c) => c.chapter.sections.filter((s) => s.screen).map((s) => `${s.screen.module}/${s.screen.tab}`)));
const milestones = new Set(chapters.flatMap((c) => c.chapter.milestones));
if (milestones.size) {
  const progress = fs.readFileSync(path.join(ROOT, "docs/PROGRESS.md"), "utf8").split("\n");
  let module = null;
  for (const line of progress) {
    const h = /^### (.+?)\s*$/.exec(line);
    if (h) module = SECTION_KEYS[h[1]] || null;
    const row = /^\| (\d+) \| ([^|]+) \| `([a-z0-9-]+)` \| (M\d+) \|.*\| ([A-Za-z ]+) \| [^|]* \|$/.exec(line);
    if (!row || !module) continue;
    const [, n, name, tab, m, status] = row;
    if (!milestones.has(m) || status.trim() === "Dropped") continue;
    if (!covered.has(`${module}/${tab}`))
      say(`docs/PROGRESS.md #${n} ${name.trim()} (${m}) has no section in the guide: add "## ${name.trim()} {#a-slug screen=${module}/${tab}}" to its chapter`);
  }
}

/* ------------------------------------------------------------------ *
 * 9: files waiting for their milestone
 * ------------------------------------------------------------------ */

for (const f of waiting) if (!WAITING[f]) say(`docs/manual/${f} does not open with front matter: write it as a chapter (docs/manual/README.md)`);
for (const f of Object.keys(WAITING))
  if (!waiting.includes(f)) say(`scripts/check/user-guide.js WAITING names docs/manual/${f}, which no longer waits: take its line out`);
for (const f of waiting) if (WAITING[f]) notes.push(`docs/manual/${f} waits: ${WAITING[f]}`);

/* ------------------------------------------------------------------ *
 * 10: a change to what a chapter covers changes the chapter
 * ------------------------------------------------------------------ */

let changed = [];
try {
  changed = changedFiles().map((c) => c.path);
} catch (err) {
  say(`could not read the change from git: ${err.message}`);
}
const exemption = trailer("User-guide-unchanged");
if (changed.length && !exemption) {
  const isTest = (p) => /\.test\.[jt]sx?$|\.gallery\.tsx$/.test(p);
  for (const { file, chapter } of chapters) {
    const paths = new Set(chapter.covers);
    for (const s of chapter.sections) if (s.screen) paths.add(`app/src/features/${s.screen.module}`);
    for (const spec of Object.values(chapter.shots)) for (const s of spec.sources) paths.add(s.replace(/\/$/, ""));
    const under = (p) => [...paths].some((root) => p === root || p.startsWith(`${root}/`));
    const hit = changed.filter((p) => !isTest(p) && under(p));
    if (!hit.length) continue;
    const own = changed.some((p) => p === `docs/manual/${file}` || p.startsWith(`docs/manual/img/${chapter.slug}/`));
    if (!own)
      say(
        `This change touches code the User Guide's ${chapter.title} chapter covers (${hit.slice(0, 3).join(", ")}${hit.length > 3 ? `, +${hit.length - 3} more` : ""}) but not docs/manual/${file} or its pictures.\n` +
          "    Check every step still reads as the screen does, change the chapter, retake its pictures (npm run guide:shots).\n" +
          '    If nothing a person sees changed, add "User-guide-unchanged: <reason>" to the PR description.',
      );
  }
}

if (problems.length) {
  console.error(`user-guide: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nHow to write a chapter: docs/manual/README.md. The rules: docs/guides/user-guide.md §6.");
  process.exit(1);
}
const pictures = chapters.reduce((n, c) => n + Object.keys(c.chapter.shots).length, 0);
console.log(`user-guide: ok (${chapters.length} chapter(s), ${pictures} picture(s)${exemption ? `; unchanged: ${exemption}` : ""})`);
for (const n of notes) console.log(`  note: ${n}`);

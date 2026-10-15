#!/usr/bin/env node
"use strict";
/**
 * Process gate: a change to a feature passes through its engineering guide.
 *
 * 1. COMPLETE, every run.
 *    - Every guide in docs/guides/ (other than README.md and _TEMPLATE.md) is
 *      listed in the index, docs/guides/README.md, and every guide the index
 *      marks Written ☑ exists.
 *    - Every guide keeps the template's header rows and all of its numbered
 *      section headings, in order, so no guide quietly drops "Edge cases" or
 *      "Permissions".
 *    - Status is Draft, Agreed, Built or Accepted; Last changed and every
 *      Change log line carry a real day-first date.
 *    - §10 On screen and mobile carries both tables, each with at least one
 *      filled row: the content tiers (what is open, what is behind help, what
 *      never reaches a screen) and the phone layout (FRONTEND_GUIDE §5, §7).
 *      Without them a guide's rules get built as explainer cards.
 *
 * 2. FOLLOWED. A guide's header names the code it covers:
 *      | Backend modules | `attendance`, `devices` |
 *      | Frontend paths  | `app/src/features/attendance/` |
 *    Backend modules cover src/modules/<m>/ and packages/contract/schemas/<m>.js.
 *    When a change touches covered code, the guide must change too and gain a
 *    Change log line. Escape hatch, in the PR description or a commit message:
 *
 *      Guide-unchanged: <reason>     e.g. "test-only change, behaviour as described"
 *
 * Usage: node scripts/check/guides.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  ROOT,
  changedFiles,
  addedLines,
  trailer,
  isDayFirstDate,
} = require("./lib/changes");

const DIR = "docs/guides";
const INDEX = `${DIR}/README.md`;
const TEMPLATE = `${DIR}/_TEMPLATE.md`;
const STATUSES = ["Draft", "Agreed", "Built", "Accepted"];
const LOG_LINE = /^- (\d{2}\/\d{2}\/\d{4}) · ([A-Z]{2}) · \S/;
/** §10's two tables, by the first cells of their header rows. */
const SCREEN_TABLES = [
  ["| Screen | Open (tier 1) |", "content tiers"],
  ["| Screen | First on a phone |", "phone layout"],
];

const problems = [];
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);

/* The template decides what every guide must contain. */
const templateLines = read(TEMPLATE);
const SECTIONS = templateLines.filter((l) => /^## \d+ · /.test(l));
const firstSection = templateLines.findIndex((l) => /^## /.test(l));
const HEADER_ROWS = templateLines
  .slice(0, firstSection === -1 ? templateLines.length : firstSection)
  .map((l) => /^\| ([A-Z][^|]+?) \| /.exec(l))
  .filter(Boolean)
  .map((m) => m[1].trim());

/* Index */
const indexed = new Map();
for (const line of read(INDEX)) {
  const m = /^\| `([^`]+\.md)` \|.*\| ([☐☑]) \|$/.exec(line);
  if (m) indexed.set(m[1], m[2] === "☑");
}
const files = fs
  .readdirSync(path.join(ROOT, DIR))
  .filter(
    (f) => f.endsWith(".md") && f !== "README.md" && f !== "_TEMPLATE.md",
  );

for (const f of files)
  if (!indexed.has(f)) problems.push(`${DIR}/${f} is not listed in ${INDEX}`);
for (const [f, written] of indexed) {
  if (written && !files.includes(f))
    problems.push(
      `${INDEX} marks ${f} as written, but ${DIR}/${f} does not exist`,
    );
}

/* Each guide */
const guides = [];
for (const f of files) {
  const rel = `${DIR}/${f}`;
  const lines = read(rel);
  const header = {};
  for (const l of lines) {
    const m = /^\| ([A-Z][^|]+?) \| (.*) \|$/.exec(l);
    if (m && !(m[1].trim() in header)) header[m[1].trim()] = m[2].trim();
    if (/^## /.test(l)) break;
  }
  for (const row of HEADER_ROWS)
    if (!(row in header))
      problems.push(`${rel}: header row "${row}" is missing`);

  let at = 0;
  for (const s of SECTIONS) {
    const idx = lines.indexOf(s, at);
    if (idx === -1)
      problems.push(
        `${rel}: section "${s.slice(3)}" is missing or out of order`,
      );
    else at = idx + 1;
  }

  const status = (header.Status || "").trim();
  if (header.Status !== undefined && !STATUSES.includes(status)) {
    problems.push(
      `${rel}: Status "${status}" must be one of ${STATUSES.join(", ")}`,
    );
  }
  const last = (header["Last changed"] || "").trim();
  if (header["Last changed"] !== undefined && !isDayFirstDate(last)) {
    problems.push(
      `${rel}: Last changed "${last}" is not a day-first date like 13/10/2026`,
    );
  }

  const onScreen = lines.findIndex((l) => /^## \d+ · On screen and mobile/.test(l));
  if (onScreen !== -1) {
    let end = lines.findIndex((l, i) => i > onScreen && /^## /.test(l));
    if (end === -1) end = lines.length;
    const body = lines.slice(onScreen + 1, end);
    for (const [head, what] of SCREEN_TABLES) {
      const headAt = body.findIndex((l) => l.startsWith(head));
      if (headAt === -1) {
        problems.push(`${rel}: §10 has no ${what} table (header "${head} …", see ${TEMPLATE})`);
        continue;
      }
      const rows = [];
      for (let i = headAt + 2; i < body.length && body[i].startsWith("|"); i += 1) rows.push(body[i]);
      if (!rows.some((r) => !/^\|\s*</.test(r))) problems.push(`${rel}: §10 ${what} table has no filled row (only the template's <placeholder>)`);
    }
  }

  const logStart = lines.findIndex((l) => /^## \d+ · Change log/.test(l));
  if (logStart !== -1) {
    for (
      let i = logStart + 1;
      i < lines.length && !/^## /.test(lines[i]);
      i += 1
    ) {
      const l = lines[i];
      if (!l.trim() || /^ {2,}\S/.test(l)) continue;
      const m = LOG_LINE.exec(l);
      if (!m)
        problems.push(
          `${rel}:${i + 1}: change log line must read "- dd/mm/yyyy · XX · what changed and why"`,
        );
      else if (!isDayFirstDate(m[1]))
        problems.push(`${rel}:${i + 1}: "${m[1]}" is not a real date`);
    }
  }

  const ticks = (cell) =>
    [...(cell || "").matchAll(/`([^`<>]+)`/g)].map((m) => m[1].trim());
  const modules = ticks(header["Backend modules"]);
  const frontend = ticks(header["Frontend paths"]).map((p) =>
    p.replace(/\/?$/, "/"),
  );
  const covers = (p) =>
    modules.some(
      (m) =>
        p.startsWith(`src/modules/${m}/`) ||
        p === `packages/contract/schemas/${m}.js`,
    ) || frontend.some((prefix) => p.startsWith(prefix));
  guides.push({ rel, covers, modules, frontend });
}

/* Followed */
let changed = [];
try {
  changed = changedFiles();
} catch (err) {
  problems.push(`could not read the change from git: ${err.message}`);
}
const exemption = trailer("Guide-unchanged");
for (const g of guides) {
  const hits = changed.filter((c) => c.path !== g.rel && g.covers(c.path));
  if (!hits.length || exemption) continue;
  const touched = changed.some((c) => c.path === g.rel);
  if (!touched) {
    problems.push(
      `This change touches code covered by ${g.rel} (${hits
        .slice(0, 3)
        .map((c) => c.path)
        .join(", ")}` +
        `${hits.length > 3 ? `, +${hits.length - 3} more` : ""}) but not the guide.\n` +
        "    Update the guide to match what was built and add a Change log line, or add\n" +
        '    "Guide-unchanged: <reason>" to the PR description.',
    );
  } else if (!addedLines(g.rel).some((l) => LOG_LINE.test(l))) {
    problems.push(
      `${g.rel} changed but no Change log line was added ("- dd/mm/yyyy · XX · what changed and why").`,
    );
  }
}

if (problems.length) {
  console.error(`guides: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nTemplate and rules: ${TEMPLATE}, ${INDEX}.`);
  process.exit(1);
}
console.log(`guides: ok (${guides.length} guide(s), ${indexed.size} indexed)`);

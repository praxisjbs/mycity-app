#!/usr/bin/env node
"use strict";
/**
 * Process gate: docs/PROGRESS.md is kept up to date and stays readable.
 *
 * 1. FORMAT, every run. The file is the team's single record of what is built,
 *    so it has to stay parseable:
 *      - 85 screen rows, numbered 1 to 85, each number once
 *      - Status is one of the six allowed values, and agrees with the ticks
 *        (Built and later need API, UI and Mobile all ticked; a ticked row is
 *        not "Not started"); a row that has moved has an Updated date
 *      - dates are real day-first dates (13/10/2026), never in the future
 *      - every note is "- dd/mm/yyyy · XX · text" (continuation lines indented)
 *      - the Summary counts equal the rows
 *      - a ticked M0 item has a date
 *
 * 2. UPDATED WITH THE WORK. When the change touches product code (src/,
 *    packages/contract/schemas/, migrations/, seeds/, templates/, app/,
 *    public-app/), PROGRESS.md must change too, and the change must add at
 *    least one dated note. Escape hatch for a change that moves nothing on the
 *    tracker (a refactor, a typo): a trailer in the PR description or a commit
 *    message, with a reason:
 *
 *      Progress-unchanged: renamed a private helper, no screen affected
 *
 * Usage: node scripts/check/progress.js     exit 0 ok, 1 problems
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

const FILE = "docs/PROGRESS.md";
const SCREENS = 100;
const STATUSES = [
  "Not started",
  "In progress",
  "Built",
  "On staging",
  "Accepted",
  "Dropped",
];
const NEEDS_ALL_TICKS = new Set(["Built", "On staging", "Accepted"]);
const PRODUCT = [
  /^src\//,
  /^packages\/contract\/schemas\//,
  /^migrations\//,
  /^seeds\//,
  /^templates\//,
  /^app\//,
  /^public-app\//,
];
const NOTE = /^- (\d{2}\/\d{2}\/\d{4}) · ([A-Z]{2}(?: · [A-Z]{2})?) · \S/;
const SCREEN_ROW =
  /^\| (\d+) \| ([^|]+?) \| `([^`]+)` \| (M\d+) \| ([^|]+?) \| ([☐☑]) \| ([☐☑]) \| ([☐☑]) \| ([^|]+?) \|\s*([^|]*?)\s*\|$/;

const problems = [];
const today = new Date();
const tomorrow = Date.UTC(
  today.getUTCFullYear(),
  today.getUTCMonth(),
  today.getUTCDate() + 1,
);

function checkDate(value, where) {
  if (!isDayFirstDate(value)) {
    problems.push(
      `${where}: "${value}" is not a day-first date like 13/10/2026`,
    );
    return;
  }
  const [dd, mm, yyyy] = value.split("/").map(Number);
  if (Date.UTC(yyyy, mm - 1, dd) > tomorrow)
    problems.push(`${where}: ${value} is in the future`);
}

/* ------------------------------------------------------------------ *
 * 1. Format
 * ------------------------------------------------------------------ */
const full = path.join(ROOT, FILE);
if (!fs.existsSync(full)) {
  console.error(`progress: ${FILE} is missing`);
  process.exit(1);
}
const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);

const rows = [];
const seen = new Map();
let section = "";
let inNotes = false;
let m0Section = false;

lines.forEach((line, i) => {
  const at = `${FILE}:${i + 1}`;
  if (/^#{2,3} /.test(line)) {
    section = line.replace(/^#+ /, "");
    inNotes = false;
    m0Section = /^M0 · Foundation/.test(section);
    return;
  }
  if (line.trim() === "---") {
    inNotes = false;
    return;
  }
  if (line.trim() === "**Notes**") {
    inNotes = true;
    return;
  }

  if (inNotes) {
    if (!line.trim() || line.trim() === "_None yet._" || /^ {2,}\S/.test(line))
      return;
    const m = NOTE.exec(line);
    if (!m)
      problems.push(
        `${at}: note must read "- dd/mm/yyyy · XX · what was done, what is left"`,
      );
    else checkDate(m[1], at);
    return;
  }

  const r = SCREEN_ROW.exec(line);
  if (r) {
    const [, n, name, , ms, , api, ui, mobile, statusRaw, updatedRaw] = r;
    const status = statusRaw.trim();
    const updated = updatedRaw.trim();
    const num = Number(n);
    if (seen.has(num))
      problems.push(
        `${at}: screen #${num} appears twice (also line ${seen.get(num)})`,
      );
    seen.set(num, i + 1);
    const ticks = [api, ui, mobile].filter((t) => t === "☑").length;
    if (!STATUSES.includes(status))
      problems.push(
        `${at}: #${num} ${name}: status "${status}" is not one of ${STATUSES.join(", ")}`,
      );
    if (NEEDS_ALL_TICKS.has(status) && ticks < 3)
      problems.push(
        `${at}: #${num} ${name}: "${status}" needs API, UI and Mobile all ticked`,
      );
    if (status === "Not started" && ticks > 0)
      problems.push(
        `${at}: #${num} ${name}: has ticks but is still "Not started"`,
      );
    if (status !== "Not started" && !updated)
      problems.push(
        `${at}: #${num} ${name}: status moved but Updated is empty`,
      );
    if (updated) checkDate(updated, `${at} #${num}`);
    rows.push({ num, ms: ms === "M0" ? "M1" : ms, status });
    return;
  }

  if (m0Section) {
    const item = /^\| (.+?) \| ([^|]+?) \| ([☐☑]) \|\s*([^|]*?)\s*\|$/.exec(
      line,
    );
    if (item && item[1] !== "Item") {
      const date = item[4].trim();
      if (item[3] === "☑" && !date)
        problems.push(`${at}: M0 item "${item[1]}" is ticked but has no date`);
      if (date) checkDate(date, at);
    }
  }
});

for (let n = 1; n <= SCREENS; n += 1)
  if (!seen.has(n)) problems.push(`${FILE}: screen #${n} is missing`);
if (seen.size > SCREENS)
  problems.push(
    `${FILE}: ${seen.size} screen rows; the inventory has ${SCREENS}`,
  );

/* Summary counts */
const COLS = ["Not started", "In progress", "Built", "On staging", "Accepted"];
const expected = {};
for (const r of rows) {
  if (r.status === "Dropped") continue;
  const e = (expected[r.ms] ||= {
    total: 0,
    ...Object.fromEntries(COLS.map((c) => [c, 0])),
  });
  e.total += 1;
  if (COLS.includes(r.status)) e[r.status] += 1;
}
const grand = { total: 0, ...Object.fromEntries(COLS.map((c) => [c, 0])) };
for (const e of Object.values(expected))
  for (const k of Object.keys(grand)) grand[k] += e[k];

lines.forEach((line, i) => {
  const s =
    /^\| (\*\*Total\*\*|M(\d+) [^|]+?) \| \**(\d+)\** \| \**(\d+)\** \| \**(\d+)\** \| \**(\d+)\** \| \**(\d+)\** \| \**(\d+)\** \|$/.exec(
      line,
    );
  if (!s) return;
  const key = s[2] ? `M${s[2]}` : "Total";
  const want =
    key === "Total"
      ? grand
      : expected[key] || {
          total: 0,
          ...Object.fromEntries(COLS.map((c) => [c, 0])),
        };
  const got = s.slice(3).map(Number);
  const exp = [want.total, ...COLS.map((c) => want[c])];
  if (got.join() !== exp.join()) {
    problems.push(
      `${FILE}:${i + 1}: Summary for ${key} says ${got.join("/")}, the rows say ${exp.join("/")} (screens/${COLS.join("/")})`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 2. Updated with the work
 * ------------------------------------------------------------------ */
let changed = [];
try {
  changed = changedFiles();
} catch (err) {
  problems.push(`could not read the change from git: ${err.message}`);
}
const product = changed.filter(
  (c) => PRODUCT.some((re) => re.test(c.path)) && !c.path.endsWith(".gitkeep"),
);
if (product.length) {
  const touched = changed.some((c) => c.path === FILE);
  const exemption = trailer("Progress-unchanged");
  if (!exemption) {
    if (!touched) {
      problems.push(
        `This change touches product code (${product
          .slice(0, 3)
          .map((c) => c.path)
          .join(", ")}` +
          `${product.length > 3 ? `, +${product.length - 3} more` : ""}) but not ${FILE}.\n` +
          "    Tick the screens it moved, set Status and Updated, and add a note under the module.\n" +
          '    If it moves nothing on the tracker, add "Progress-unchanged: <reason>" to the PR description.',
      );
    } else if (!addedLines(FILE).some((l) => NOTE.test(l))) {
      problems.push(
        `${FILE} changed but no dated note was added. Add "- dd/mm/yyyy · XX · what was done, what is left" under the module.`,
      );
    }
  }
}

if (problems.length) {
  console.error(`progress: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nHow to update the file: the top of docs/PROGRESS.md. Rules: CLAUDE.md step 5.",
  );
  process.exit(1);
}
console.log(
  `progress: ok (${rows.length} screens${product.length ? `, ${product.length} product file(s) in this change` : ""})`,
);

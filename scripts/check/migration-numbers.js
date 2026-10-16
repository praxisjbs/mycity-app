#!/usr/bin/env node
"use strict";
/**
 * Gate 3: schema and reference-seed numbering (README §6.3, BACKEND_STRUCTURE §10).
 *
 * The ledger keys on the file name and files apply in number order, so a number is an identity.
 * Each milestone owns a block (M0 0001 to 0999, M1 1000 to 1999, ... M11 11000 to 11999).
 * Schema files and reference seeds share those blocks and may not reuse a number across folders.
 *
 * Fails the build on:
 *  1. a SQL file that is not NNNN_lower_snake.sql, a subfolder, or number 0000;
 *  2. duplicate numbers across the two folders;
 *  3. a number outside every milestone block;
 *  4. on a milestone branch, a new file outside that milestone's block;
 *  5. a seed outside seeds/reference/ or a non-seed inside it.
 *
 * Usage: node scripts/check/migration-numbers.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { FILE_RE, numberOf } = require("../db/migrate");

const ROOT = path.resolve(__dirname, "..", "..");
const LAST_MILESTONE = 11;
const IGNORED = new Set([".gitkeep", "README.md"]);

const blockOf = (m) => [m === 0 ? 1 : m * 1000, m * 1000 + 999];

function milestoneOf(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const m = Math.floor(n / 1000);
  return m <= LAST_MILESTONE ? m : null;
}

function branchMilestone(name) {
  const m = /^m(\d{1,2})(?:[/_-]|$)/i.exec(String(name || ""));
  if (!m) return null;
  const n = Number(m[1]);
  return n <= LAST_MILESTONE ? n : null;
}

function currentBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  try {
    const { git } = require("./lib/changes");
    return git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return null;
  }
}

function changedMigrationFiles() {
  try {
    const { changedFiles } = require("./lib/changes");
    return changedFiles().filter((c) =>
      /^(?:migrations|seeds\/reference)\/[^/]+\.sql$/.test(c.path),
    );
  } catch {
    return [];
  }
}

/**
 * @param {{root?: string, branch?: string|null, changes?: Array<{path: string, status: string}>}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT, branch, changes } = {}) {
  const problems = [];
  const notes = [];
  const sources = [
    { dir: path.join(root, "migrations"), label: "migrations", seed: false },
    { dir: path.join(root, "seeds", "reference"), label: "seeds/reference", seed: true },
  ];
  const byNum = new Map();
  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;
    for (const e of fs.readdirSync(source.dir, { withFileTypes: true })) {
      const name = e.name;
      const relative = `${source.label}/${name}`;
      if (IGNORED.has(name)) continue;
      if (e.isDirectory()) {
        problems.push(`${relative}/: ${source.label}/ is flat, no subfolders`);
        continue;
      }
      const m = FILE_RE.exec(name);
      if (!m) {
        problems.push(`${relative}: name it NNNN_lower_snake.sql (README §6.3)`);
        continue;
      }
      if (source.seed !== /_seed_/.test(name)) {
        problems.push(
          `${relative}: reference seed files use _seed_ in seeds/reference/; schema files do not`,
        );
      }
      const n = Number(m[1]);
      if (m[1].length === 5 && n < 10000) {
        problems.push(
          `${relative}: four digits below 10000 (${String(n).padStart(4, "0")})`,
        );
        continue;
      }
      if (milestoneOf(n) === null) {
        problems.push(
          `${relative}: ${m[1]} is in no milestone block (0001 to ${LAST_MILESTONE * 1000 + 999})`,
        );
        continue;
      }
      if (!byNum.has(n)) byNum.set(n, []);
      byNum.get(n).push(relative);
    }
  }
  for (const [n, names] of byNum) {
    if (names.length > 1)
      problems.push(
        `sequence number ${String(n).padStart(4, "0")} is used ${names.length} times: ${names.sort().join(", ")}`,
      );
  }
  const added = (changes === undefined ? changedMigrationFiles() : changes)
    .filter((c) => c.status === "A")
    .map((c) => ({ path: c.path, file: path.posix.basename(c.path) }))
    .filter((c) => FILE_RE.test(c.file));
  const ms = branchMilestone(branch === undefined ? currentBranch() : branch);
  const addedPaths = new Set(added.map((c) => c.path));
  for (const item of added) {
    const n = numberOf(item.file);
    if (ms !== null && milestoneOf(n) !== ms) {
      const [a, b] = blockOf(ms);
      problems.push(
        `${item.path}: this is an M${ms} branch, so a new file is numbered ${String(a).padStart(4, "0")} to ${b}`,
      );
      continue;
    }
    const later = [...byNum.entries()]
      .filter(
        ([number, names]) =>
          number > n &&
          milestoneOf(number) === milestoneOf(n) &&
          names.some((name) => !addedPaths.has(name)),
      )
      .map(([, names]) => names[0]);
    if (later.length)
      notes.push(
        `${item.path} is numbered below ${later[0]}, which is already merged; a server that has it applies this one out of order`,
      );
  }
  const count = [...byNum.values()].reduce((s, v) => s + v.length, 0);
  return { problems, notes, count };
}

if (require.main === module) {
  const { problems, notes, count } = check();
  for (const n of notes) console.log(`  note: ${n}`);
  if (problems.length === 0) {
    console.log(
      `migration-numbers: ok (${count} file${count === 1 ? "" : "s"}, numbers unique and in their milestone blocks across migrations/ and seeds/reference/)`,
    );
    process.exit(0);
  }
  console.error(
    "migration-numbers: a migration's number is its identity (README §6.3)\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, blockOf, milestoneOf, branchMilestone };

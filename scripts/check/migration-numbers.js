#!/usr/bin/env node
"use strict";
/**
 * Gate 3: migration numbering (README §6.3, BACKEND_STRUCTURE §10).
 *
 * The ledger keys on the file name and files apply in number order, so a number is an
 * identity. Each milestone owns a block (M0 0001 to 0999, M1 1000 to 1999, ... M11 11000
 * to 11999) so two teams working in parallel can never pick the same one.
 *
 * Fails the build on:
 *  1. a file in migrations/ that is not NNNN_lower_snake.sql (five digits from 10000),
 *     a subfolder, or a number of 0000;
 *  2. two files with the same number;
 *  3. a number outside every milestone block;
 *  4. on a milestone branch (m1/..., m3-...), a NEW file outside that milestone's block.
 * Notes, without failing: a new file numbered below a file already merged in the same
 * block (it applies out of order on a server that already has the later one; migrate.js
 * warns too).
 *
 * Usage: node scripts/check/migration-numbers.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { FILE_RE, numberOf } = require("../db/migrate");

const ROOT = path.resolve(__dirname, "..", "..");
const LAST_MILESTONE = 11;
const IGNORED = new Set([".gitkeep", "README.md"]);

/** The block a milestone owns: [first, last]. */
const blockOf = (m) => [m === 0 ? 1 : m * 1000, m * 1000 + 999];

/** The milestone whose block holds `n`, or null. */
function milestoneOf(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  const m = Math.floor(n / 1000);
  return m <= LAST_MILESTONE ? m : null;
}

/** The milestone a branch name belongs to (m0-foundation-build, m4/proposals), or null. */
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

function changedMigrations() {
  try {
    const { changedFiles } = require("./lib/changes");
    return changedFiles().filter((c) =>
      /^migrations\/[^/]+\.sql$/.test(c.path),
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
  const dir = path.join(root, "migrations");
  if (!fs.existsSync(dir))
    return { problems, notes: ["no migrations/ folder yet"], count: 0 };

  const byNum = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = e.name;
    if (IGNORED.has(name)) continue;
    if (e.isDirectory()) {
      problems.push(`migrations/${name}/: migrations/ is flat, no subfolders`);
      continue;
    }
    const m = FILE_RE.exec(name);
    if (!m) {
      problems.push(
        `migrations/${name}: name it NNNN_lower_snake.sql (README §6.3)`,
      );
      continue;
    }
    const n = Number(m[1]);
    if (m[1].length === 5 && n < 10000) {
      problems.push(
        `migrations/${name}: four digits below 10000 (${String(n).padStart(4, "0")})`,
      );
      continue;
    }
    if (milestoneOf(n) === null) {
      problems.push(
        `migrations/${name}: ${m[1]} is in no milestone block (0001 to ${LAST_MILESTONE * 1000 + 999})`,
      );
      continue;
    }
    if (!byNum.has(n)) byNum.set(n, []);
    byNum.get(n).push(name);
  }
  for (const [n, names] of byNum) {
    if (names.length > 1)
      problems.push(
        `migration number ${n} is used ${names.length} times: ${names.sort().join(", ")}`,
      );
  }

  const added = (changes === undefined ? changedMigrations() : changes)
    .filter((c) => c.status === "A")
    .map((c) => path.posix.basename(c.path))
    .filter((f) => FILE_RE.test(f));
  const ms = branchMilestone(branch === undefined ? currentBranch() : branch);
  const addedSet = new Set(added);
  for (const f of added) {
    const n = numberOf(f);
    if (ms !== null && milestoneOf(n) !== ms) {
      const [a, b] = blockOf(ms);
      problems.push(
        `migrations/${f}: this is an M${ms} branch, so a new migration is numbered ${String(a).padStart(4, "0")} to ${b}`,
      );
      continue;
    }
    const later = [...byNum.entries()]
      .filter(
        ([k, names]) =>
          k > n &&
          milestoneOf(k) === milestoneOf(n) &&
          names.some((x) => !addedSet.has(x)),
      )
      .map(([, names]) => names[0]);
    if (later.length)
      notes.push(
        `migrations/${f} is numbered below ${later[0]}, which is already merged; a server that has it applies this one out of order`,
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
      `migration-numbers: ok (${count} file${count === 1 ? "" : "s"}, numbers unique and in their milestone blocks)`,
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

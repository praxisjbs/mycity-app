#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: the 25-per-page rule (BACKEND_STRUCTURE §16).
 *
 * Fails the build when anything could load more than one page of a list:
 *
 *  1. Backend SQL that writes its own LIMIT / OFFSET / FETCH FIRST instead of
 *     going through shared/http/paged.js. `LIMIT 1` (a single-row lookup) is
 *     allowed, and so is a worker's batch claim that says so on the same line
 *     with a SQL comment: `LIMIT $1 -- pagination:batch <why>`. A batch is
 *     how much work one tick takes, never rows a person or the AI reads.
 *  2. A completeQuery() call without a `// pagination:complete <reason>`
 *     marker on one of the two lines above it.
 *  3. A page-size key (limit, offset, per_page, page_size, pageSize, perPage)
 *     in the contract outside schemas/common.js, or in an AI manifest.
 *  4. Frontend code (app/, public-app/) sending a page-size parameter or
 *     declaring its own page size.
 *
 * Usage: node scripts/check/pagination.js        exit 0 clean, 1 on violations
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);

const PAGED_HELPER = path.join("src", "shared", "http", "paged.js");
const CONTRACT_COMMON = path.join(
  "packages",
  "contract",
  "schemas",
  "common.js",
);

const SQL_LIMIT = /\b(limit|offset)\s+(\$\{|\$\d+|\d+)/i;
const SQL_LIMIT_ONE = /\blimit\s+1\b(?!\d)/i;
const SQL_FETCH = /\bfetch\s+(first|next)\b/i;
const SIZE_KEY = /\b(limit|offset|per_page|page_size|pageSize|perPage)\s*:/;
const FE_SIZE_PARAM = /[?&](limit|offset|per_page|page_size|pageSize|perPage)=/;
const FE_SIZE_KEY = /\b(per_page|page_size|pageSize|perPage)\b/;
const FE_SIZE_CONST = /\b(const|let|var)\s+[A-Z_]*PAGE_SIZE\s*=/;
const COMPLETE_CALL = /\bcompleteQuery\s*\(/;
const COMPLETE_MARK = /\/\/\s*pagination:complete\s+\S/;
const BATCH_MARK = /--\s*pagination:batch\s+\S/;

/** @param {string} dir @param {(f: string) => boolean} want @returns {string[]} */
function walk(dir, want) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, want));
    else if (want(full)) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f);
const lines = (f) => fs.readFileSync(f, "utf8").split(/\r?\n/);
/** Strip a trailing // comment so prose in comments is not read as SQL. */
const code = (line) => line.replace(/(^|[^:])\/\/.*$/, "$1");

const problems = [];
const report = (file, n, msg) => problems.push(`${rel(file)}:${n}  ${msg}`);

/* 1 and 2: backend source */
const backend = walk(path.join(ROOT, "src"), (f) => f.endsWith(".js"));
for (const file of backend) {
  const r = rel(file);
  const src = lines(file);
  src.forEach((raw, i) => {
    const line = code(raw);
    if (r !== PAGED_HELPER) {
      const batch =
        BATCH_MARK.test(line) &&
        !/(\.routes|\.controller|\.ai)\.js$/.test(file);
      if (
        ((SQL_LIMIT.test(line) && !SQL_LIMIT_ONE.test(line)) ||
          SQL_FETCH.test(line)) &&
        !batch
      ) {
        report(
          file,
          i + 1,
          "SQL LIMIT/OFFSET outside shared/http/paged.js; use pageQuery()",
        );
      }
    }
    if (COMPLETE_CALL.test(line) && r !== PAGED_HELPER) {
      const above = [src[i - 1] || "", src[i - 2] || ""];
      if (!above.some((l) => COMPLETE_MARK.test(l))) {
        report(
          file,
          i + 1,
          "completeQuery() without `// pagination:complete <reason>` above it",
        );
      }
    }
    if (/\.ai\.js$/.test(file) && SIZE_KEY.test(line)) {
      report(
        file,
        i + 1,
        "page-size key in an AI manifest; AI reads page at 25 through PageQuery",
      );
    }
  });
}

/* 3: contract */
const schemas = walk(path.join(ROOT, "packages", "contract", "schemas"), (f) =>
  f.endsWith(".js"),
);
for (const file of schemas) {
  if (rel(file) === CONTRACT_COMMON) continue;
  lines(file).forEach((raw, i) => {
    if (SIZE_KEY.test(code(raw))) {
      report(
        file,
        i + 1,
        "page-size key in the contract; lists use listQuery() from common.js",
      );
    }
  });
}

/* 4: frontend */
const isFe = (f) => /\.(js|jsx|ts|tsx)$/.test(f) && !/\.gen\.ts$/.test(f);
const frontend = [
  ...walk(path.join(ROOT, "app"), isFe),
  ...walk(path.join(ROOT, "public-app"), isFe),
];
for (const file of frontend) {
  lines(file).forEach((raw, i) => {
    const line = code(raw);
    if (FE_SIZE_PARAM.test(line) || FE_SIZE_KEY.test(line)) {
      report(
        file,
        i + 1,
        "frontend sends or names a page size; the API pages at 25, send `page` only",
      );
    }
    if (FE_SIZE_CONST.test(line)) {
      report(
        file,
        i + 1,
        "frontend declares its own PAGE_SIZE; import it from @mycity/contract",
      );
    }
  });
}

if (problems.length) {
  console.error(`pagination: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nEvery list pages at 25 through src/shared/http/paged.js. See docs/BACKEND_STRUCTURE.md §16.",
  );
  process.exit(1);
}
console.log(
  `pagination: ok (${backend.length} backend, ${schemas.length} contract, ${frontend.length} frontend files)`,
);

#!/usr/bin/env node
"use strict";
/**
 * Guard: .github/CODEOWNERS is complete and cannot silently stop working.
 *
 * GitHub ignores a CODEOWNERS line it cannot resolve: a misspelt username or a
 * placeholder simply means "no owner", and the required code-owner review
 * quietly disappears for those paths. So:
 *
 *  - every owner is a syntactically valid @username or @org/team (a
 *    placeholder like @LA_GITHUB_USERNAME fails until it is replaced)
 *  - every line has at least TWO owners. GitHub does not count the author's
 *    own approval, so a path whose only owner opens the PR can never be merged
 *  - every concrete path a line names exists (a rename would orphan it)
 *  - every module folder in src/modules/ and every guide in docs/guides/ has
 *    its own line, so a new module or guide arrives with its owners
 *
 * Usage: node scripts/check/codeowners.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./lib/changes");

const FILE = ".github/CODEOWNERS";
const OWNER =
  /^@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?|[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)$/;
const problems = [];

const full = path.join(ROOT, FILE);
if (!fs.existsSync(full) || !fs.readFileSync(full, "utf8").trim()) {
  console.error(`codeowners: ${FILE} is missing or empty`);
  process.exit(1);
}

const patterns = new Set();
fs.readFileSync(full, "utf8")
  .split(/\r?\n/)
  .forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const [pattern, ...owners] = line.split(/\s+/);
    const at = `${FILE}:${i + 1}`;
    patterns.add(pattern);
    if (owners.length < 2)
      problems.push(
        `${at}: ${pattern} needs at least two owners (an author cannot approve their own PR)`,
      );
    for (const o of owners) {
      if (!OWNER.test(o))
        problems.push(
          `${at}: "${o}" is not a GitHub username; replace it with the person's real @username`,
        );
    }
    if (!/[*?[]/.test(pattern)) {
      const target = path.join(
        ROOT,
        pattern.replace(/^\//, "").replace(/\/$/, ""),
      );
      if (!fs.existsSync(target))
        problems.push(`${at}: ${pattern} does not exist in the repository`);
    }
  });

const modulesDir = path.join(ROOT, "src", "modules");
if (fs.existsSync(modulesDir)) {
  for (const m of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (m.isDirectory() && !patterns.has(`/src/modules/${m.name}/`)) {
      problems.push(
        `${FILE}: module src/modules/${m.name}/ has no owner line ("/src/modules/${m.name}/ @owner @backup")`,
      );
    }
  }
}
const guidesDir = path.join(ROOT, "docs", "guides");
if (fs.existsSync(guidesDir)) {
  for (const g of fs.readdirSync(guidesDir)) {
    if (
      g.endsWith(".md") &&
      g !== "README.md" &&
      g !== "_TEMPLATE.md" &&
      !patterns.has(`/docs/guides/${g}`)
    ) {
      problems.push(
        `${FILE}: guide docs/guides/${g} has no owner line ("/docs/guides/${g} @owner @backup")`,
      );
    }
  }
}

if (problems.length) {
  console.error(`codeowners: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`codeowners: ok (${patterns.size} patterns)`);

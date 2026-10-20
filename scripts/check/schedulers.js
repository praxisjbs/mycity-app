#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: every scheduler file is actually started by the worker.
 *
 * `src/jobs/registry.js` holds an explicit SCHEDULERS list and the worker starts what
 * that list names. A file in `src/jobs/schedulers/` that is not on it is dead code
 * that looks alive: it has a name, an interval and a run function, its tests pass, and
 * it never executes. The first release of Settings · System Health shipped three such
 * files, and nothing said so until a person noticed an empty chart an hour later.
 *
 * Fails when:
 *  - a non-empty file in src/jobs/schedulers/ is missing from SCHEDULERS;
 *  - SCHEDULERS names a file that does not exist, or one that is still empty;
 *  - a file's exported `name` is not its own file name (the worker looks ticks up by
 *    name, so a mismatch is a tick that matches nothing).
 *
 * Usage: node scripts/check/schedulers.js     exit 0 ok, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
const ROOT = path.resolve(__dirname, "..", "..");
const DIR = path.join("src", "jobs", "schedulers");

const problems = [];
const registry = fs.readFileSync(path.join(ROOT, "src", "jobs", "registry.js"), "utf8");

/** The SCHEDULERS array, read from the source so this gate never boots the worker. */
const block = /const SCHEDULERS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(registry);
if (!block) {
  console.error("schedulers: could not find the SCHEDULERS list in src/jobs/registry.js");
  process.exit(1);
}
const listed = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const files = fs
  .readdirSync(path.join(ROOT, DIR))
  .filter((f) => f.endsWith(".js"))
  .filter((f) => fs.statSync(path.join(ROOT, DIR, f)).size > 0)
  .map((f) => f.replace(/\.js$/, ""));

for (const name of files) {
  if (!listed.includes(name)) {
    problems.push(
      `${DIR}/${name}.js is not in SCHEDULERS (src/jobs/registry.js), so the worker never runs it`,
    );
  }
}
for (const name of listed) {
  const file = path.join(ROOT, DIR, `${name}.js`);
  if (!fs.existsSync(file)) {
    problems.push(`SCHEDULERS names "${name}", but ${DIR}/${name}.js does not exist`);
  } else if (fs.statSync(file).size === 0) {
    problems.push(`SCHEDULERS names "${name}", but ${DIR}/${name}.js is still empty`);
  }
}

/** Each file's own `name`, read from its source: it must match the file. */
for (const name of files) {
  const src = fs.readFileSync(path.join(ROOT, DIR, `${name}.js`), "utf8");
  const declared = /name:\s*"([^"]+)"/.exec(src);
  if (declared && declared[1] !== name) {
    problems.push(
      `${DIR}/${name}.js declares name "${declared[1]}"; the worker looks a tick up by name, so it must be "${name}"`,
    );
  }
}

if (problems.length) {
  console.error(`schedulers: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nAdd the file to SCHEDULERS in src/jobs/registry.js (README §5.15).");
  process.exit(1);
}
console.log(`schedulers: ok (${files.length} scheduler(s), each started by the worker)`);

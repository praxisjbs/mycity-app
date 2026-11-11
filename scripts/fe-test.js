#!/usr/bin/env node
"use strict";
/**
 * `npm run fe:test`: the three frontend workspaces' tests (packages/ui, app, public-app) at the
 * same time instead of one after the other. Each workspace runs its own `vitest run` in its own
 * process; their output is printed whole, one workspace after another, once each finishes, so the
 * logs never interleave. Exit 1 when any of them failed.
 *
 * The workspaces share nothing at test time (each has its own vitest config and jsdom), so running
 * them side by side changes no result, only the wall clock: the gallery's 800 component tests no
 * longer wait for the app's, or the other way round.
 *
 * MYCITY_TEST_WORKERS=<n> caps the machine's share: the workspaces run one after another, each on
 * at most n workers. `npm run ci` sets it while its other groups run beside this one (the backend's
 * tests, the browser of the screens group), since the screens' tests wait on a clock and fail
 * when three workspaces' workers starve them of the processor.
 *
 * SHARDS (CI only). On GitHub each workspace's files are split across jobs, since one 4-core runner
 * took 16 minutes over all three (GE, 06/11/2026). A piece is a workspace, or a workspace and a
 * shard, `app:1/2`. vitest's own --shard deals by count, and one shard drew app's three slowest
 * files (438 s against 180 for the others), so the files are dealt here instead: `vitest list`
 * names them exactly as `vitest run` would find them, scripts/lib/deal.js deals them by size, and
 * this shard's files are handed to `vitest run` by path. The n shards together run every file once. MYCITY_FE_TESTS names this job's pieces (scripts/check/lib/scope.js plan()
 * chooses them); unset, as on a laptop, it is all three workspaces, whole.
 *
 *   node scripts/fe-test.js                 all three
 *   node scripts/fe-test.js app             just the named ones (ui, app, public-app)
 *   node scripts/fe-test.js ui:2/3 app:1/2  a shard of each
 *   MYCITY_FE_TESTS="app:2/2 public-app" node scripts/fe-test.js   the same, from CI's matrix
 */
const { spawn, spawnSync } = require("node:child_process");
const { shardFiles, kb } = require("./lib/deal");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES = Object.freeze({ ui: "@mycity/ui", app: "@mycity/app", "public-app": "@mycity/public-app" });
const DIRS = Object.freeze({ ui: "packages/ui", app: "app", "public-app": "public-app" });
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

const args = process.argv.slice(2);
const wanted = args.length ? args : (process.env.MYCITY_FE_TESTS || "").split(/\s+/).filter(Boolean);
const PIECE = /^(ui|app|public-app)(?::([1-9]\d*)\/([1-9]\d*))?$/;
const pieces = (wanted.length ? wanted : Object.keys(WORKSPACES)).map((w) => {
  const m = PIECE.exec(w);
  if (!m || (m[2] && Number(m[2]) > Number(m[3]))) {
    console.error(`fe-test: "${w}" is not a workspace (ui, app, public-app), or a workspace and a shard (app:1/2)`);
    process.exit(2);
  }
  return { name: m[1], shard: m[2] ? `${m[2]}/${m[3]}` : null };
});
const cap = Number.parseInt(process.env.MYCITY_TEST_WORKERS || "", 10);
const WORKERS = Number.isInteger(cap) && cap > 0 ? cap : null;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** Every test file vitest would run in a workspace, by absolute path, as `vitest list` names them. */
function testFiles(name) {
  const r = spawnSync(process.execPath, [VITEST, "list", "--filesOnly", "--json"], { cwd: path.join(ROOT, DIRS[name]), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const json = r.status === 0 ? r.stdout.slice(r.stdout.indexOf("[")) : "";
  let files;
  try {
    files = JSON.parse(json).map((x) => x.file);
  } catch {
    throw new Error(`fe-test: vitest could not list ${WORKSPACES[name]}'s test files\n${r.stderr || r.stdout}`);
  }
  if (!files.length) throw new Error(`fe-test: vitest lists no test files in ${WORKSPACES[name]}`);
  return files.sort();
}

function run({ name, shard }) {
  const label = shard ? `${WORKSPACES[name]} shard ${shard}` : WORKSPACES[name];
  let mine = [];
  if (shard) {
    const [i, n] = shard.split("/").map(Number);
    try {
      mine = shardFiles(testFiles(name), i, n, kb);
    } catch (err) {
      return Promise.resolve({ name, label, code: 1, out: err.message, secs: "0.0" });
    }
    // No paths would make `vitest run` run every file: an empty shard runs nothing.
    if (!mine.length) return Promise.resolve({ name, label, code: 0, out: "no files in this shard", secs: "0.0" });
  }
  const extra = [...(WORKERS ? [`--maxWorkers=${WORKERS}`] : []), ...mine];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(npm, ["run", "test", "-w", WORKSPACES[name], ...(extra.length ? ["--", ...extra] : [])], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ name, label, code, out, secs: ((Date.now() - started) / 1000).toFixed(1) }));
  });
}

(async () => {
  const results = [];
  if (WORKERS) for (const p of pieces) results.push(await run(p));
  else results.push(...(await Promise.all(pieces.map(run))));
  for (const r of results) {
    console.log(`\n──── ${r.label}: ${r.code === 0 ? "ok" : "FAILED"} (${r.secs}s) ────`);
    console.log(r.out.trim());
  }
  const failed = results.filter((r) => r.code !== 0).map((r) => r.label);
  if (failed.length) {
    console.error(`\nfe-test: failed in ${failed.join(", ")}`);
    // Not process.exit(): into a pipe (CI) a long report is still being written, and exit drops
    // the rest, so the failing test's own lines never reached the log.
    process.exitCode = 1;
  }
})();

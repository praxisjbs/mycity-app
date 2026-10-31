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
 *   node scripts/fe-test.js            all three
 *   node scripts/fe-test.js app        just the named ones (ui, app, public-app)
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES = Object.freeze({ ui: "@mycity/ui", app: "@mycity/app", "public-app": "@mycity/public-app" });

const wanted = process.argv.slice(2);
for (const w of wanted)
  if (!WORKSPACES[w]) {
    console.error(`fe-test: "${w}" is not a workspace (ui, app, public-app)`);
    process.exit(2);
  }
const names = wanted.length ? wanted : Object.keys(WORKSPACES);
const cap = Number.parseInt(process.env.MYCITY_TEST_WORKERS || "", 10);
const WORKERS = Number.isInteger(cap) && cap > 0 ? cap : null;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(npm, ["run", "test", "-w", WORKSPACES[name], ...(WORKERS ? ["--", `--maxWorkers=${WORKERS}`] : [])], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ name, code, out, secs: ((Date.now() - started) / 1000).toFixed(1) }));
  });
}

(async () => {
  const results = [];
  if (WORKERS) for (const n of names) results.push(await run(n));
  else results.push(...(await Promise.all(names.map(run))));
  for (const r of results) {
    console.log(`\n──── ${WORKSPACES[r.name]}: ${r.code === 0 ? "ok" : "FAILED"} (${r.secs}s) ────`);
    console.log(r.out.trim());
  }
  const failed = results.filter((r) => r.code !== 0).map((r) => WORKSPACES[r.name]);
  if (failed.length) {
    console.error(`\nfe-test: failed in ${failed.join(", ")}`);
    // Not process.exit(): into a pipe (CI) a long report is still being written, and exit drops
    // the rest, so the failing test's own lines never reached the log.
    process.exitCode = 1;
  }
})();

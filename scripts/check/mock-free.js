#!/usr/bin/env node
"use strict";
/**
 * Mock-free release builds (FRONTEND_FOUNDATION F12, F14).
 *
 * The in-browser mock lives only on laptops (`npm run dev`) and in CI (tests,
 * gallery, crawl). Staging and production run the same live build on the real
 * API; a release build that still carried the mock could answer a person with
 * invented records. This gate builds both apps exactly as a release does
 * (`vite build --mode production`, VITE_API_MODE unset) into a temporary
 * folder and searches every output file for the mock's sentinel, the
 * MOCK_SENTINEL string constant in app/src/api/mock/core.ts and
 * public-app/src/api/mock/core.ts. It refuses:
 *
 *   - a release build whose output contains the sentinel (the mock, or a
 *     piece of it, was bundled: an import that is not behind VITE_API_MODE)
 *   - a mock core without its sentinel (the gate would then prove nothing)
 *   - a build that fails
 *
 * Usage:
 *   node scripts/check/mock-free.js                exit 0 ok, 1 problems
 *   node scripts/check/mock-free.js --mode=demo    build the mock-backed demo
 *                                                  instead; it MUST fail (the
 *                                                  proof that the gate sees a mock)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const APPS = ["app", "public-app"];
const CORE = "src/api/mock/core.ts";
const modeArg = process.argv.slice(2).find((a) => a.startsWith("--mode="));
const MODE = modeArg ? modeArg.slice(7) : "production";

/** Pure: the sentinel a mock core declares, or null. */
function sentinelOf(source) {
  const m = /\bexport\s+const\s+MOCK_SENTINEL\s*=\s*(["'])([^"']+)\1/.exec(source);
  return m ? m[2] : null;
}

function filesIn(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) filesIn(full, out);
    else out.push(full);
  }
  return out;
}

/** Pure: the output files (relative) whose text contains the sentinel. */
function filesWith(dir, sentinel) {
  const needle = Buffer.from(sentinel);
  return filesIn(dir)
    .filter((f) => fs.readFileSync(f).includes(needle))
    .map((f) => path.relative(dir, f).split(path.sep).join("/"));
}

function build(app, outDir) {
  const cwd = path.join(ROOT, app);
  const vite = path.join(path.dirname(require.resolve("vite/package.json", { paths: [cwd] })), "bin", "vite.js");
  const env = { ...process.env, NODE_ENV: "production" };
  delete env.VITE_API_MODE; // a release build sets nothing: the app's own config decides
  return spawnSync(process.execPath, [vite, "build", "--mode", MODE, "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main() {
  const problems = [];
  const checked = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-mock-free-"));
  try {
    for (const app of APPS) {
      const corePath = path.join(ROOT, app, CORE);
      if (!fs.existsSync(corePath)) {
        checked.push(`${app} (no mock)`);
        continue;
      }
      const sentinel = sentinelOf(fs.readFileSync(corePath, "utf8"));
      if (!sentinel) {
        problems.push(`  ${app}/${CORE}: no \`export const MOCK_SENTINEL = "..."\`; put it back (and keep it used) so a bundled mock can be found`);
        continue;
      }
      const out = path.join(tmp, app);
      const r = build(app, out);
      if (r.status !== 0) {
        problems.push(`  ${app}: the ${MODE} build failed\n${`${r.stdout || ""}${r.stderr || ""}`.trim().replace(/^/gm, "      ")}`);
        continue;
      }
      const hits = filesWith(out, sentinel);
      for (const f of hits) problems.push(`  ${app} (${MODE} build): ${f} contains the mock ("${sentinel}")`);
      checked.push(`${app} (${filesIn(out).length} files)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (problems.length) {
    console.error(`mock-free: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error(
      "\nNo release build carries the in-browser mock (FRONTEND_FOUNDATION F12). Load it only through the\n" +
        'VITE_API_MODE === "mock" branch in src/api/client.ts (a dynamic import), never by a static import.',
    );
    process.exit(1);
  }
  console.log(`mock-free: ok (${MODE} builds of ${checked.join(", ")} carry no mock)`);
}

module.exports = { sentinelOf, filesWith };

if (require.main === module) main();

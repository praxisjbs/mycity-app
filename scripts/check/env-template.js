#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: .env.example is exactly what src/config/env.js would generate.
 *
 * A variable added to the app but not to the example is the one nobody sets on
 * the server; one left in the example after the app stopped reading it is the
 * one somebody keeps "fixing". Both are refused.
 *
 * Runs the generator in --check mode in a clean child process, so the developer's
 * own .env and shell cannot change the answer.
 *
 * Usage: node scripts/check/env-template.js     exit 0 ok, 1 stale
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const env = { PATH: process.env.PATH, MYCITY_SKIP_DOTENV: "1" };
const r = spawnSync(
  process.execPath,
  [path.join(__dirname, "..", "gen", "env-example.js"), "--check"],
  {
    env,
    encoding: "utf8",
  },
);
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status === 0 ? 0 : 1);

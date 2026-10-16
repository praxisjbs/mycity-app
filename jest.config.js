"use strict";
/**
 * Gate 2: the WHOLE backend suite, every time (`npm test`, `npm run ci`).
 *
 * Unit tests sit beside the code (`src/modules/<m>/<m>.test.js`) and under
 * tests/unit. Integration tests (tests/integration) need a real Postgres and
 * Redis and run only with RUN_DB_TESTS=1. tests/staging runs against the
 * staging hosts from verify-staging, never here.
 *
 * EMPTY TEST FILES. The repository map creates `<module>.test.js` for every
 * module before the module exists, and Jest fails a file that contains no
 * test ("Your test suite must contain at least one test"). So files that are
 * still empty are left out of the run, by name, computed fresh every time:
 * the moment someone writes a test into one, it runs. Nothing with content
 * is ever skipped.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const SKIP = new Set(["node_modules", ".git", "coverage", "dist", "app", "public-app", "docs"]);

function emptyTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) emptyTestFiles(full, out);
    else if (entry.name.endsWith(".test.js") && fs.readFileSync(full, "utf8").trim() === "") out.push(full);
  }
  return out;
}

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ignored = ["/node_modules/", "<rootDir>/tests/staging/"];
if (process.env.RUN_DB_TESTS !== "1") ignored.push("<rootDir>/tests/integration/");
for (const file of emptyTestFiles(ROOT)) ignored.push(`^${escape(file)}$`);

module.exports = {
  testEnvironment: "node",
  rootDir: ROOT,
  testMatch: ["<rootDir>/src/**/*.test.js", "<rootDir>/tests/**/*.test.js", "<rootDir>/scripts/**/*.test.js"],
  testPathIgnorePatterns: ignored,
  passWithNoTests: true,
  testTimeout: 15000,
  // APP_ENV=test: responses are checked against their contract and a mismatch fails the test.
  setupFiles: ["<rootDir>/tests/setup-env.js"],
  // The error reporter's batch timer never outlives the file that started it.
  setupFilesAfterEnv: ["<rootDir>/tests/settle-reporter.js"],
  // The integration files share one test database and rebuild its schema: one at a time.
  maxWorkers: process.env.RUN_DB_TESTS === "1" ? 1 : 2,
};

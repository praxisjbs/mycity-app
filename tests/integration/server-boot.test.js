"use strict";
/**
 * The API process boots and reports ready, as a release does on the server.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/server-boot
 *
 * Every other test builds the Express app with buildApp() and never runs src/server.js, so a
 * fault in the boot itself passed the whole suite and failed only on staging, where deploy-gate
 * waited 120 s for a readiness answer that never came and switched back. This file starts
 * src/server.js as its own process and waits for the answer deploy-gate waits for:
 * /api/health/ready with ok true and this build's sha (scripts/deploy/deploy-gate, wait_ready).
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema.
 */
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { rebuild } = require("./helpers/schema");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const ROOT = path.resolve(__dirname, "..", "..");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const READY_WITHIN_MS = 45_000;

/** A port nothing is listening on. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

describeDb("src/server.js boots", () => {
  let child;
  let output = "";
  let exited = null;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
  });

  afterAll(async () => {
    if (child && exited === null) {
      const gone = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      let timer;
      await Promise.race([gone, new Promise((r) => (timer = setTimeout(r, 12_000)))]);
      clearTimeout(timer);
      if (exited === null) child.kill("SIGKILL");
    }
    await pool.end();
  });

  test(
    "answers /api/health/ready with ok and the build it was started with",
    async () => {
      const port = await freePort();
      child = spawn(process.execPath, ["src/server.js"], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          BUILD_SHA: SHA,
          LOG_LEVEL: "info",
          // The developer's .env never reaches the process under test.
          MYCITY_SKIP_DOTENV: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (b) => (output += b));
      child.stderr.on("data", (b) => (output += b));
      child.on("exit", (code, signal) => (exited = { code, signal }));

      const deadline = Date.now() + READY_WITHIN_MS;
      let body = null;
      while (Date.now() < deadline && exited === null) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            body = await res.json();
            if (body.ok === true && body.build && body.build.sha === SHA) break;
          }
        } catch {
          // Not listening yet: the loop asks again.
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      const last = output.split("\n").slice(-15).join("\n");
      if (exited !== null)
        throw new Error(`src/server.js exited (${JSON.stringify(exited)}) before it was ready:\n${last}`);
      if (!body || body.ok !== true || !body.build || body.build.sha !== SHA)
        throw new Error(
          `src/server.js was not ready within ${READY_WITHIN_MS / 1000}s. Last answer: ${JSON.stringify(body)}\n${last}`,
        );
      expect(body.status).toMatch(/^(ready|degraded)$/);
    },
    READY_WITHIN_MS + 60_000,
  );
});

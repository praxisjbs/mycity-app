#!/usr/bin/env node
"use strict";
/**
 * Gate 7: every route has a contract; every write route has a body.
 *
 * http/route.js refuses a bad route when it is DEFINED, and the module loader
 * refuses a router carrying a route defined any other way. So the gate is: load
 * every module strictly, the way the API does at boot, without a database or
 * Redis (neither connects until used), and report what fails.
 *
 * What that covers (BACKEND_STRUCTURE §6.4):
 *  - a route with no response schema (or no_content), a write with no body;
 *  - a schema that is not exported from packages/contract;
 *  - a staff route with no permission check (or self / anonymous);
 *  - a route added to a router without route(), so with no contract at all;
 *  - a surface that disagrees with its file name; a duplicate path;
 *  - a module that throws on load.
 *
 * Usage: node scripts/check/route-contracts.js     exit 0 ok, 1 on a problem
 */
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");

try {
  const { buildApp } = require(path.join(ROOT, "src", "app"));
  const { report } = buildApp({ strict: true, accessLog: false });
  const writes = report.routes.filter((r) =>
    ["POST", "PUT", "PATCH"].includes(r.method),
  ).length;
  console.log(
    `route-contracts: ok (${report.mounted.length} modules, ${report.routes.length} routes, ${writes} writes, all with contracts)`,
  );
  process.exit(0);
} catch (err) {
  console.error(
    "route-contracts: a module does not load with a valid contract\n",
  );
  console.error(
    `  ${String(err && err.message)
      .split("\n")
      .join("\n  ")}`,
  );
  console.error(
    "\nEvery route is defined with route() or publicRoute(). See docs/BACKEND_GUIDE.md §3.2.",
  );
  process.exit(1);
}

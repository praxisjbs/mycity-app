"use strict";
/**
 * @mycity/contract — the one definition of every shape that crosses the wire.
 *
 * Re-exports each file in ./schemas by its basename, so a new domain file is
 * available as `contract.<name>` without editing this index:
 *
 *   const c = require("@mycity/contract");
 *   c.common.PAGE_SIZE      // 25
 *   c.organisation.EmployeeCreate
 *
 * The backend require()s this file. The frontend never does: it imports the
 * GENERATED contract.gen.ts (BACKEND_STRUCTURE §6).
 */
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "schemas");
const contract = {};

for (const file of fs.readdirSync(dir).sort()) {
  if (!file.endsWith(".js")) continue;
  const name = path.basename(file, ".js");
  contract[name] = require(path.join(dir, file));
}

module.exports = contract;

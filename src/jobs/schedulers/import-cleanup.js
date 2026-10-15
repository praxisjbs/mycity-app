"use strict";
/**
 * Imports started and left unfinished for two weeks are closed once a night at 03:00
 * Lagos time: their per-row copies of the spreadsheet are removed and the batch is
 * marked failed (shared/import/engine.expireAbandoned). Committed imports keep their
 * rows, because revert needs them.
 */
const { defineSchedule } = require("../registry");
const engine = require("../../shared/import/engine");

module.exports = defineSchedule({
  name: "import-cleanup",
  pattern: "0 3 * * *",
  summary: "Closes imports that were started and left",
  run: () => engine.expireAbandoned(),
});

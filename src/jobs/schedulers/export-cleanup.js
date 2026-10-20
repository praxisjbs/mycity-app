"use strict";
/**
 * Export files (Export and Download buttons: shared/documents/exports.js) are kept in the vault
 * for a day, long enough to download again, then removed every hour at twenty past: the vault
 * row with `document.removed` on the record, then the file. Nothing was emailed, so no copy
 * outlives it.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "export-cleanup",
  pattern: "20 * * * *",
  summary: "Removes export files a day after they were made",
  run: () => require("../../shared/documents/exports").purgeExpired(),
});

"use strict";
/**
 * Download My Data workbooks are kept in the vault for seven days, then removed once a night
 * at 03:30 Lagos time (modules/ess/ess.export.js purgeExpired): the vault row with
 * `document.removed` on the record, then the file. The copy already emailed stays in the
 * Mailbox of whoever asked.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "data-export-cleanup",
  pattern: "30 3 * * *",
  summary: "Removes Download My Data files after seven days",
  run: () => require("../../modules/ess/ess.export").purgeExpired(),
});

"use strict";
/**
 * Export files (Export and Download buttons: shared/documents/exports.js) are kept in the vault
 * for a day, long enough to download again, then removed every hour at twenty past: the vault
 * row with `document.removed` on the record, then the file. Nothing was emailed, so no copy
 * outlives it. The same pass removes any transient file (a mail dictation's recording) its
 * request left behind for an hour (vault.purgeTransient).
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "export-cleanup",
  pattern: "20 * * * *",
  summary: "Removes export files a day after they were made, and transient files left an hour",
  run: async () => {
    const exported = await require("../../shared/documents/exports").purgeExpired();
    const transient = await require("../../shared/documents/vault").purgeTransient();
    return { removed: exported.removed, transient_removed: transient.removed };
  },
});

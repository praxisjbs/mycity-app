"use strict";
/**
 * What System Health keeps: occurrences for 90 days; snapshots, the minutes of traffic,
 * the server's samples, the routes' quarter hours and silent processes for 30. Cleared
 * nightly at ten past two, before the backup.
 *
 * The fault groups themselves are never purged. A fault's history, and the decision
 * somebody took on it, outlive the rows that raised it: a group whose occurrences have
 * gone still says when it was first seen, who marked it fixed and whether it came back.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "system-health-purge",
  pattern: "10 2 * * *",
  summary: "Clears fault occurrences after 90 days; snapshots, traffic, samples and process beats after 30",
  run: async () => require("../../modules/system_health/system_health.repo").purge(require("../../config/db").pool),
});

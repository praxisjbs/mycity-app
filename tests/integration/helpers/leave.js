"use strict";
/**
 * Leave in suites that test something else (an approval, a card, a figure). Annual needs a relief
 * officer and a handover note on every request (docs/guides/ess.md §6, TB 17/11/2026); a suite
 * whose short Annual requests are only the way to its subject takes that rule off first, on its
 * own rebuilt database, as People could on Leave Types. tests/integration/leave.test.js holds the
 * rule itself.
 */
const annualWithoutCover = (db) =>
  db.query("UPDATE leave_type SET handover_every_request = false WHERE code = 'annual'");

module.exports = { annualWithoutCover };

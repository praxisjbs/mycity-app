"use strict";
/**
 * Staging demonstration data, people first (docs/guides/foundation.md §6.2, F13).
 *
 * The people on staging are MyCity's real staff, never the mock's invented ones, so a
 * demonstration shows the organisation the client knows: the same names, the same
 * reporting lines, the same two open seats. They load through the staff importer and the
 * organisation service, exactly as the deploy loads them, so numbering, audit and events
 * are right.
 *
 * This file is only ever run by `scripts/db/seed.js --staging`, which refuses production
 * three times over. The same roster reaches production through the deploy step instead
 * (scripts/deploy/deploy-gate), where it is the real staff list rather than a
 * demonstration (A5, and TB's exception of 16/10/2026).
 *
 * It is idempotent: a second run finds the sheet already loaded and changes nothing.
 *
 * Every later module writes its own staging seed when its routes land, and hangs its
 * records off these people.
 */
const { loadStaff } = require("../../scripts/db/load-staff");

module.exports = async function seed({ pool, log }) {
  const result = await loadStaff({ db: pool, log: (m) => log(`staff: ${m}`) });
  if (result.status === "no_sheet") {
    log("staff: seeds/staff/staff-list.xlsx is not in this build, so there is nobody to load");
    return;
  }
  const counts = result.stats || {};
  log(
    `staff: ${result.status} (${counts.create || 0} created, ${counts.unchanged || 0} unchanged); ` +
      `logins ${result.logins ? result.logins.created : 0} invited`,
  );
};

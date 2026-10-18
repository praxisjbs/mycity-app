"use strict";
/**
 * Payroll, as Home will read it: the runs not yet finished behind the Payroll In Progress
 * card.
 *
 * OWNED BY the `payroll` module, M6 Payroll & Notifications, LA (no migration yet: the
 * 6000 block is empty).
 *
 * No payroll table exists, so Home reads nothing here: the card is hidden in the catalogue,
 * declared with no query, and this adapter declares no tables. The M6 pull request that
 * builds payroll MUST, in the same PR, add the query here (runs not in a finished state, in
 * the reader's scope), declare its tables and columns, clear `owes`, and make the card live
 * with its records (docs/guides/home.md §4.1, docs/DATABASE_SCHEMA.md M6 Owes). The card
 * keeps `sensitive_field: "employee.salary"`: a reader who may not see pay sees no payroll
 * card at all.
 */

/** No forward table exists to read. */
const TABLES = Object.freeze({});

/** What M6 owes before the card can be live. */
const OWES = Object.freeze([
  "All of payroll (DATABASE_SCHEMA M6): payroll_run with its statuses, so a run not yet disbursed can be counted.",
  "The statuses that end a run, so a run stuck from an older month still counts as in progress.",
]);

module.exports = {
  module: "payroll",
  milestone: "M6",
  owner: "LA",
  tables: TABLES,
  owes: OWES,
};

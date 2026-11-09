"use strict";
/**
 * Payroll, as Home reads it: the runs not yet finished behind the Payroll In Progress card
 * (docs/guides/payroll.md §3.8, §10.1).
 *
 * OWNED BY the `payroll` module, M6 Payroll & Notifications, TB (migration 6000, the run table; built
 * in M6 PR 2). A pull request that changes what the run table holds MUST, in the same PR, keep these
 * reads and `tables` true to every column they name (docs/guides/home.md §4.1). A unit test holds
 * `tables` to the migrated schema and the queries to `tables`.
 *
 * A run is in progress while it is a Draft, Computed, Submitted or Approved: only Paid ends it, so a
 * run stuck from an older month still counts and an unpaid October is visible in December. A run is
 * the organisation's, not one person's: it is read by a reader whose `payroll` view reaches everyone
 * (scope `all`) and by no one narrower. The card keeps `sensitive_field: "employee.salary"`: a reader
 * who may not see pay sees no payroll card at all, so a net total here is only ever shown to someone
 * who may read it.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  payroll_run: ["payroll_run_id", "number", "period", "status", "headcount", "net_total", "submitted_at"],
});

/** What M6 still owes these queries: nothing, the run table is built. */
const OWES = Object.freeze([]);

const IN_PROGRESS = "r.status IN ('draft', 'computed', 'submitted', 'approved')";

/** How many runs are not yet paid. A reader whose view is narrower than everyone counts none. */
async function inProgressCount(client, scope) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM payroll_run r WHERE ${IN_PROGRESS} AND $1::text = 'all'`,
    [scope.scope],
  );
  return rows[0].n;
}

/** The newest month first; a status sorts the open ones before an approved run. */
const SORTS = { period: "r.period" };

/** One page of the runs not yet paid, the newest month first. */
function inProgressPage(client, scope, query) {
  const params = [scope.scope, query.q || null];
  const newest = query.sort ? query : { ...query, sort: { field: "period", dir: "desc" } };
  return pageQuery(
    client,
    `SELECT r.payroll_run_id, r.number::text AS number, r.period::text AS period, r.status, r.headcount,
            r.net_total::text AS net_total, r.submitted_at, ${TOTAL_COL}
       FROM payroll_run r
      WHERE ${IN_PROGRESS} AND $1::text = 'all'
        AND ($2::text IS NULL OR search_fold(r.number::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(newest, SORTS, "r.payroll_run_id")}`,
    params,
    newest,
  );
}

module.exports = {
  module: "payroll",
  milestone: "M6",
  owner: "TB",
  tables: TABLES,
  owes: OWES,
  inProgressCount,
  inProgressPage,
};

"use strict";
/**
 * Performance reviews, as Home reads them: the reviews still to be filed behind the Reviews
 * Due card (whose review it is, in the reader's scope) and the My Reviews Due card (the
 * reviews the reader must write).
 *
 * OWNED BY the `reviews` module, M2 Productivity & Performance, AJ (migrations 2000, 2100,
 * 2300; docs/guides/performance.md §6.12).
 *
 * Home reads these tables through this one file. A pull request that changes what the reviews
 * module writes MUST, in the same PR, keep these queries and `tables` true to every column they
 * name (docs/guides/home.md §4.1). A unit test holds `tables` to the migrated schema and the
 * queries to `tables`.
 *
 * A monthly review is due until its reviewer submits it: while the employee checks in, while it
 * is with the reviewer, and when the chain returns it to them. It counts once its round closes
 * before the end of the thirtieth day from today (Lagos), so a review whose round has passed its
 * close date is still due. My Reviews Due are those with the reader to score now.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const lagos = require("../../../shared/time/lagos");
const { PERSON } = require("../kpi-catalog/shared");

/** The tables and the columns these queries read. */
const TABLES = Object.freeze({
  performance_review: [
    "performance_review_id",
    "performance_cycle_id",
    "employee_id",
    "reviewer_employee_id",
    "review_type",
    "status",
  ],
  performance_cycle: ["performance_cycle_id", "name", "closes_at"],
});

/** What M2 still owes these queries: nothing since Performance PR 3 built the stages and their statuses. */
const OWES = Object.freeze([]);

/** Days ahead a round's close makes its reviews due. */
const DUE_WITHIN_DAYS = 30;

/** Not yet through its reviewer, its round closing before `$1`. */
const DUE = "pr.status IN ('check_in', 'with_reviewer', 'returned') AND pc.closes_at < $1::timestamptz";

/** With the reviewer to score now. */
const TO_WRITE = "pr.status IN ('with_reviewer', 'returned') AND pc.closes_at < $1::timestamptz";

/** The instant a review's round must close before for it to be due, from a Lagos date. */
const cutoff = (today) => lagos.endOfDayExclusive(lagos.addDays(today, DUE_WITHIN_DAYS));

const FROM = `FROM performance_review pr
  JOIN performance_cycle pc ON pc.performance_cycle_id = pr.performance_cycle_id`;

const ROW = `pr.performance_review_id, pr.review_type, pc.name AS cycle, pc.closes_at,
  ${PERSON("e", "d")} AS employee, btrim(r.first_name || ' ' || r.last_name) AS reviewer`;

const JOINS = `JOIN employee e ON e.employee_id = pr.employee_id
  LEFT JOIN department d ON d.department_id = e.department_id
  JOIN employee r ON r.employee_id = pr.reviewer_employee_id`;

const SORTS = { closes_at: "pc.closes_at" };

/**
 * How many reviews are due, counted by whose review it is, within the scope.
 * @param {{query: Function}} client
 * @param {{today: string}} on  YYYY-MM-DD in Lagos
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<number>}
 */
async function dueCount(client, { today }, scope) {
  const params = [cutoff(today)];
  const s = scopeClause(scope, { column: "pr.employee_id" }, params);
  const { rows } = await client.query(`SELECT count(*)::int AS n ${FROM} WHERE ${DUE} ${s.and}`, params);
  return rows[0].n;
}

/** One page of the reviews due, within the scope, soonest closing first. */
function duePage(client, { today }, scope, query) {
  const params = [cutoff(today), query.q || null];
  const s = scopeClause(scope, { column: "pr.employee_id" }, params);
  return pageQuery(
    client,
    `SELECT ${ROW}, ${TOTAL_COL}
       ${FROM}
       ${JOINS}
      WHERE ${DUE}
        AND ($2::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "pr.performance_review_id")}`,
    params,
    query,
  );
}

/**
 * How many due reviews a person must write now.
 * @param {{query: Function}} client
 * @param {{today: string, employee_id: string}} who
 * @returns {Promise<number>}
 */
async function reviewerDueCount(client, { today, employee_id: employeeId }) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n ${FROM} WHERE ${TO_WRITE} AND pr.reviewer_employee_id = $2`,
    [cutoff(today), employeeId],
  );
  return rows[0].n;
}

/** One page of the due reviews a person must write now, soonest closing first. */
function reviewerDuePage(client, { today, employee_id: employeeId }, query) {
  return pageQuery(
    client,
    `SELECT ${ROW}, ${TOTAL_COL}
       ${FROM}
       ${JOINS}
      WHERE ${TO_WRITE} AND pr.reviewer_employee_id = $2
        AND ($3::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, SORTS, "pr.performance_review_id")}`,
    [cutoff(today), employeeId, query.q || null],
    query,
  );
}

module.exports = {
  module: "reviews",
  milestone: "M2",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  DUE_WITHIN_DAYS,
  dueCount,
  duePage,
  reviewerDueCount,
  reviewerDuePage,
};

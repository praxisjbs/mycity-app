"use strict";
/**
 * Performance reviews, as Home reads them: the reviews still to be filed behind the Reviews
 * Due card (whose review it is, in the reader's scope) and the My Reviews Due card (the
 * reviews the reader must write).
 *
 * OWNED BY the `reviews` module, M2 Productivity & Performance, AJ (migration 2000).
 *
 * Home reads these tables before the module that owns them is built, so this file is the
 * one place Home names them. The M2 pull request that builds `reviews` MUST, in the same PR,
 * move or replace these queries with its own reads, keep `tables` true to every column they
 * name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M2 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`.
 *
 * Due: not yet submitted, in a cycle that closes before the end of the thirtieth day from
 * today (Lagos), so a review whose cycle has already closed is still due.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const lagos = require("../../../shared/time/lagos");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  performance_review: [
    "performance_review_id",
    "performance_cycle_id",
    "employee_id",
    "reviewer_employee_id",
    "review_type",
    "submitted_at",
  ],
  performance_cycle: ["performance_cycle_id", "name", "closes_at"],
});

/** What M2 still owes these queries. */
const OWES = Object.freeze([
  "The second level and HR stages of a review and their workflow (DATABASE_SCHEMA M2).",
  "A cycle's statuses: until they are agreed, an unfiled review of a cycle that closed long ago still counts as due.",
]);

/** Days ahead a cycle's close makes its reviews due. */
const DUE_WITHIN_DAYS = 30;

/** Not submitted, its cycle closing before `$1`. */
const DUE = "pr.submitted_at IS NULL AND pc.closes_at < $1::timestamptz";

/** The instant a review's cycle must close before for it to be due, from a Lagos date. */
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
 * How many due reviews a person must write.
 * @param {{query: Function}} client
 * @param {{today: string, employee_id: string}} who
 * @returns {Promise<number>}
 */
async function reviewerDueCount(client, { today, employee_id: employeeId }) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n ${FROM} WHERE ${DUE} AND pr.reviewer_employee_id = $2`,
    [cutoff(today), employeeId],
  );
  return rows[0].n;
}

/** One page of the due reviews a person must write, soonest closing first. */
function reviewerDuePage(client, { today, employee_id: employeeId }, query) {
  return pageQuery(
    client,
    `SELECT ${ROW}, ${TOTAL_COL}
       ${FROM}
       ${JOINS}
      WHERE ${DUE} AND pr.reviewer_employee_id = $2
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

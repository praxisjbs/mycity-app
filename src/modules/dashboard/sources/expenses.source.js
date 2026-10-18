"use strict";
/**
 * Expense requests, as Home reads them: the requests awaiting approval behind the Expenses
 * Awaiting Approval card.
 *
 * OWNED BY the `expenses` module, M8 Expenses & Budget Control, AJ (migration 8000).
 *
 * Home reads these tables before the module that owns them is built, so this file is the
 * one place Home names them. The M8 pull request that builds `expenses` MUST, in the same
 * PR, move or replace these queries with its own reads, keep `tables` true to every column
 * they name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M8 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`.
 *
 * A request is its requester's: scope runs on er.employee_id. Awaiting approval is the
 * status `submitted` (reference data 8099). Money is Naira only (shared/money): the sum
 * counts requests in `NGN` and leaves other currencies out, while the count and the list
 * hold every request (docs/guides/home.md §13).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  expense_request: [
    "expense_request_id",
    "number",
    "employee_id",
    "expense_category_id",
    "purpose",
    "amount",
    "currency",
    "status",
    "needed_on",
    "submitted_at",
  ],
  expense_category: ["expense_category_id", "name"],
});

/** What M8 still owes these queries. */
const OWES = Object.freeze([
  "Statuses as the M8 approval chain has them, and workflow_instance_id (DATABASE_SCHEMA M8): Home reads `submitted` " +
    "as awaiting approval.",
  "The currency rule for sums: Naira only until the owner decides (home.md §13).",
  "Index expense_request (status) and (employee_id), for the awaiting count (asked by Home).",
]);

const AWAITING = "er.status = 'submitted'";

/**
 * The requests awaiting approval, within the scope: their Naira sum and how many there are
 * in every currency.
 * @param {{query: Function}} client
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<{amount: string, n: number}>} amount as numeric(18,2) text
 */
async function awaiting(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "er.employee_id" }, params);
  const { rows } = await client.query(
    `SELECT COALESCE(sum(er.amount) FILTER (WHERE er.currency = 'NGN'), 0)::numeric(18,2) AS amount,
            count(*)::int AS n
       FROM expense_request er
      WHERE ${AWAITING} ${s.and}`,
    params,
  );
  return rows[0];
}

/** One page of the requests awaiting approval, within the scope, the longest waiting first. */
function awaitingPage(client, scope, query) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "er.employee_id" }, params);
  return pageQuery(
    client,
    `SELECT er.expense_request_id, er.number, er.purpose, ec.name AS category, er.amount, er.currency,
            er.needed_on, er.submitted_at, ${PERSON("e", "d")} AS employee, ${TOTAL_COL}
       FROM expense_request er
       JOIN expense_category ec ON ec.expense_category_id = er.expense_category_id
       JOIN employee e ON e.employee_id = er.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ${AWAITING}
        AND ($1::text IS NULL OR search_fold(er.purpose || ' ' || e.first_name || ' ' || e.last_name)
                                 LIKE '%' || search_fold($1) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { submitted_at: "er.submitted_at" }, "er.expense_request_id")}`,
    params,
    query,
  );
}

module.exports = {
  module: "expenses",
  milestone: "M8",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  awaiting,
  awaitingPage,
};

"use strict";
/**
 * Budgets, as Home reads them: how much of the budgets running today has been spent,
 * behind the Budget Used card, and the budgets past a share spent, for Home's Budget
 * Threshold alert rules.
 *
 * OWNED BY the `budgets` module, M8 Expenses & Budget Control, AJ (migration 8000).
 *
 * Home reads these tables before the module that owns them is built, so this file is the
 * one place Home names them. The M8 pull request that builds `budgets` MUST, in the same
 * PR, move or replace these queries with its own reads, keep `tables` true to every column
 * they name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M8 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`.
 *
 * A budget is its owner's: scope runs on b.owner_id. Running today: approved, and today
 * (Lagos) falls between its first and last day. Used is spent over allocated, as a whole
 * percentage worked out in SQL so no amount passes through JavaScript arithmetic. Naira
 * budgets only (shared/money): a budget in another currency is left out of the figure and
 * the list, since its percentage cannot be pooled with a Naira one (docs/guides/home.md §13).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  budget: [
    "budget_id",
    "number",
    "name",
    "department_id",
    "owner_id",
    "currency",
    "starts_on",
    "ends_on",
    "approved_at",
  ],
  budget_line: ["budget_id", "amount", "spent_amount"],
});

/** What M8 still owes these queries. */
const OWES = Object.freeze([
  "Budget statuses as the M8 chain has them (DATABASE_SCHEMA M8): Home reads a budget with approved_at as approved.",
  "Whether committed spend counts as used: Home counts spent_amount only.",
  "The currency rule: Naira budgets only until the owner decides (home.md §13).",
  "Index budget (owner_id), for the scoped figure (asked by Home).",
]);

/** Approved, running on `$1`, in Naira. */
const RUNNING = `b.approved_at IS NOT NULL AND b.starts_on <= $1::date AND b.ends_on >= $1::date
  AND b.currency = 'NGN'`;

/**
 * Spent over allocated across the budgets running on a Lagos date, within the scope, as a
 * whole percentage, and how many budgets that is over (the figure is not measurable over
 * none). A total allocation of nothing reads as 0 used.
 * @param {{query: Function}} client
 * @param {{today: string}} on
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<{value: number, denominator: number}>}
 */
async function used(client, { today }, scope) {
  const params = [today];
  const s = scopeClause(scope, { column: "b.owner_id" }, params);
  const { rows } = await client.query(
    `SELECT COALESCE(round(100 * sum(bl.spent_amount) / NULLIF(sum(bl.amount), 0)), 0)::int AS value,
            count(DISTINCT b.budget_id)::int AS denominator
       FROM budget b
       LEFT JOIN budget_line bl ON bl.budget_id = b.budget_id
      WHERE ${RUNNING} ${s.and}`,
    params,
  );
  return rows[0];
}

/** One page of the budgets running on a Lagos date, within the scope, the most used first. */
function usedPage(client, { today }, scope, query) {
  const params = [today, query.q || null];
  const s = scopeClause(scope, { column: "u.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT u.budget_id, u.number, u.name, u.department, u.allocated, u.spent, u.used, ${PERSON("e", "d")} AS owner,
            ${TOTAL_COL}
       FROM (SELECT b.budget_id, b.number, b.name, b.owner_id, bd.name AS department,
                    COALESCE(sum(bl.amount), 0)::numeric(18,2) AS allocated,
                    COALESCE(sum(bl.spent_amount), 0)::numeric(18,2) AS spent,
                    COALESCE(round(100 * sum(bl.spent_amount) / NULLIF(sum(bl.amount), 0)), 0)::int AS used
               FROM budget b
               LEFT JOIN department bd ON bd.department_id = b.department_id
               LEFT JOIN budget_line bl ON bl.budget_id = b.budget_id
              WHERE ${RUNNING}
              GROUP BY b.budget_id, bd.name) u
       LEFT JOIN employee e ON e.employee_id = u.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ($2::text IS NULL OR search_fold(u.name) LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { used: "u.used DESC" }, "u.budget_id")}`,
    params,
    query,
  );
}

/**
 * The budgets running on a Lagos date with at least `percent` of their allocation spent, a
 * batch of at most `size` after the budget `after` (by id): Home's Budget Threshold alert
 * rules read them in their daily sweep. Spent over allocated is a percentage to two places,
 * worked out in SQL, so no amount passes through JavaScript arithmetic. Naira budgets only.
 * @param {{query: Function}} client
 * @param {{today: string, percent: string, after?: string|null, size: number}} batch
 * @returns {Promise<Array<{budget_id: string, name: string, starts_on: string, allocated: string, spent: string, used: string}>>}
 */
async function spentBatch(client, { today, percent, after = null, size }) {
  const { rows } = await client.query(
    `SELECT u.budget_id, u.name, u.starts_on, u.allocated, u.spent, u.used
       FROM (SELECT b.budget_id, b.name, b.starts_on,
                    COALESCE(sum(bl.amount), 0)::numeric(18,2) AS allocated,
                    COALESCE(sum(bl.spent_amount), 0)::numeric(18,2) AS spent,
                    COALESCE(round(100 * sum(bl.spent_amount) / NULLIF(sum(bl.amount), 0), 2), 0)::numeric(18,2) AS used
               FROM budget b
               LEFT JOIN budget_line bl ON bl.budget_id = b.budget_id
              WHERE ${RUNNING} AND ($3::uuid IS NULL OR b.budget_id > $3::uuid)
              GROUP BY b.budget_id) u
      WHERE u.used >= $2::numeric
      ORDER BY u.budget_id
      LIMIT $4 -- pagination:batch the budgets one step of Home's alert sweep reads`,
    [today, percent, after, size],
  );
  return rows;
}

module.exports = {
  module: "budgets",
  milestone: "M8",
  owner: "AJ",
  tables: TABLES,
  owes: OWES,
  used,
  usedPage,
  spentBatch,
};

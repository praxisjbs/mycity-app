"use strict";
/**
 * The monthly expenses report (docs/guides/expenses.md §6.6 rule 8): a calendar month's spend by
 * department, by project and by category, for Home's report runner (the `expenses_monthly` source,
 * src/modules/reports/reports.sources.js). Read in the reader's `expenses` scope, on the requests'
 * requesters, so a file never holds a request its reader could not open.
 *
 * For each group, over the month: the requests sent, their amount, what was paid (disbursed in the
 * month) and what is committed now (approved, not yet paid). A department also shows its budget for
 * the month's year and what it has left. Sums are worked out in SQL: no amount passes through
 * JavaScript arithmetic.
 */
const { scopeClause } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const { COMMITTED } = require("./budgets.repo");

/** At most this many groups in one table: a department, project and category list is short. */
const GROUP_CEILING = 200;

const IN_MONTH = (col) => `(${col} AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date`;

/** The month's figures grouped by `by` (department, project or category), in the scope. */
async function grouped(db, by, month, scope) {
  const params = by === "department" ? [month.from, month.to, COMMITTED, month.from.slice(0, 4)] : [month.from, month.to, COMMITTED];
  const s = scopeClause(scope, { column: "er.employee_id" }, params);
  const KEY = {
    department: { id: "er.department_id", name: "COALESCE(d.name, 'No Department')", join: "LEFT JOIN department d ON d.department_id = er.department_id" },
    project: { id: "er.project_id", name: "COALESCE(p.number || ' ' || p.name, 'No Project')", join: "LEFT JOIN project p ON p.project_id = er.project_id" },
    category: { id: "er.expense_category_id", name: "ec.name", join: "JOIN expense_category ec ON ec.expense_category_id = er.expense_category_id" },
  }[by];
  // A department's budget as /budgets reads it (audit F18): approved, in naira, and within the
  // reader's scope on the department's head, so a team reader sees no other department's figures.
  const b = by === "department" ? scopeClause(scope, { column: "COALESCE(bd.head_employee_id, b.owner_id)" }, params) : null;
  const BUDGET_OF = `FROM budget b JOIN budget_line bl ON bl.budget_id = b.budget_id LEFT JOIN department bd ON bd.department_id = b.department_id
             WHERE b.department_id = g.id AND date_part('year', b.starts_on)::int = $4::int
               AND b.status = 'approved' AND b.currency = 'NGN' ${b ? b.and : ""}`;
  const budget =
    by === "department"
      ? `, (SELECT sum(bl.amount)::numeric(18,2) ${BUDGET_OF}) AS allocated,
           (SELECT sum(bl.amount - bl.committed_amount - bl.spent_amount)::numeric(18,2) ${BUDGET_OF}) AS remaining`
      : "";
  const { rows } = await db.query(
    `SELECT g.name, g.sent, g.sent_amount, g.paid, g.committed ${budget}
       FROM (SELECT ${KEY.id} AS id, ${KEY.name} AS name,
                    count(*) FILTER (WHERE er.submitted_at IS NOT NULL AND ${IN_MONTH("er.submitted_at")})::int AS sent,
                    COALESCE(sum(er.amount) FILTER (WHERE er.submitted_at IS NOT NULL AND ${IN_MONTH("er.submitted_at")}), 0)::numeric(18,2) AS sent_amount,
                    COALESCE(sum(er.amount) FILTER (WHERE er.status = 'disbursed' AND ${IN_MONTH("er.disbursed_at")}), 0)::numeric(18,2) AS paid,
                    COALESCE(sum(er.amount) FILTER (WHERE er.status = ANY($3::text[])), 0)::numeric(18,2) AS committed
               FROM expense_request er
               ${KEY.join}
              WHERE er.status <> 'draft' ${s.and}
              GROUP BY 1, 2) g
      WHERE g.sent > 0 OR g.paid > 0 OR g.committed > 0
      ORDER BY g.paid DESC, g.sent_amount DESC, g.name
      LIMIT ${GROUP_CEILING} -- pagination:batch a report's groups for one month, never a list a person pages`,
    params,
  );
  return rows;
}

/**
 * The month's three tables.
 * @param {{query: Function}} db
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {{from: string, to: string}} month  its first and last Lagos day
 */
async function monthly(db, scope, month) {
  return {
    month,
    departments: await grouped(db, "department", month, scope),
    projects: await grouped(db, "project", month, scope),
    categories: await grouped(db, "category", month, scope),
  };
}

/**
 * The calendar month a report made at `at` describes: the month before, so a report scheduled on
 * the first of the month covers the month just ended.
 * @param {string} today  the Lagos day the report is made, YYYY-MM-DD
 */
function monthBefore(today) {
  const { first, last } = lagos.monthBounds(lagos.addMonths(today, -1));
  return { from: first, to: last };
}

module.exports = { GROUP_CEILING, monthly, monthBefore };

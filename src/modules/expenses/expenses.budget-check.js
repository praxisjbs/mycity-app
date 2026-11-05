"use strict";
/**
 * The budget line a request counts against, and whether it is over (docs/guides/expenses.md §6.6).
 *
 * A request counts against its department's budget for the year it is sent in, on the line for its
 * category. It is Over Budget when its amount is more than that line has left (allocated less
 * committed and spent). A flag the approvers see before they decide, never a block.
 *
 * Until the budgets module recounts committed and spent (handoff PR 5), a request with no line for
 * its department, category and year is not flagged: there is nothing yet to be over.
 */
const m = require("../../shared/money/money");

/**
 * @param {{query: Function}} db
 * @param {{department_id: string|null, expense_category_id: string, amount: string}} request
 * @param {string} sentOn  the day it is sent, YYYY-MM-DD in Lagos
 * @returns {Promise<{budget_line_id: string|null, over_budget: boolean}>}
 */
async function check(db, request, sentOn) {
  if (!request.department_id) return { budget_line_id: null, over_budget: false };
  const { rows } = await db.query(
    `SELECT bl.budget_line_id, (bl.amount - bl.committed_amount - bl.spent_amount)::numeric(18,2) AS remaining
       FROM budget b
       JOIN budget_line bl ON bl.budget_id = b.budget_id
      WHERE b.department_id = $1 AND bl.expense_category_id = $2
        AND b.starts_on <= $3::date AND b.ends_on >= $3::date AND b.status <> 'closed'
      ORDER BY b.starts_on DESC, bl.budget_line_id
      LIMIT 1`,
    [request.department_id, request.expense_category_id, sentOn],
  );
  if (!rows[0]) return { budget_line_id: null, over_budget: false };
  return { budget_line_id: rows[0].budget_line_id, over_budget: m.compare(request.amount, rows[0].remaining) > 0 };
}

module.exports = { check };

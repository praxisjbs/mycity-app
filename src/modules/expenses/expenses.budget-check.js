"use strict";
/**
 * The budget line a request counts against, and whether it is over (docs/guides/expenses.md §6.6).
 *
 * A request counts against its department's budget for the year it is sent in, on the line for its
 * category. It is Over Budget when its amount is more than that line has left (allocated less
 * committed and spent). A flag the approvers see before they decide, never a block.
 *
 * A request with no line for its department, category and year (or with no department) is flagged
 * too: nothing was set aside for it. Committed and spent on the line are recounted by the budgets
 * module whenever a request on it moves, and the flag of a request still deciding is worked out
 * again with them (expenses.service countIn), so it is never older than the line.
 *
 * preview() answers the same question for New Request before anything is saved, with the figures the
 * approvers will see beside the flag, so the requester sees them before Send Request.
 */
const m = require("../../shared/money/money");

/** The line for a department, category and day, with what it has left; null when there is none. */
async function lineOf(db, departmentId, categoryId, sentOn) {
  const { rows } = await db.query(
    `SELECT bl.budget_line_id, (bl.amount - bl.committed_amount - bl.spent_amount)::numeric(18,2) AS remaining
       FROM budget b
       JOIN budget_line bl ON bl.budget_id = b.budget_id
      WHERE b.department_id = $1 AND bl.expense_category_id = $2
        AND b.starts_on <= $3::date AND b.ends_on >= $3::date AND b.status <> 'closed'
      ORDER BY b.starts_on DESC, bl.budget_line_id
      LIMIT 1`,
    [departmentId, categoryId, sentOn],
  );
  return rows[0] || null;
}

/**
 * @param {{query: Function}} db
 * @param {{department_id: string|null, expense_category_id: string, amount: string}} request
 * @param {string} sentOn  the day it is sent, YYYY-MM-DD in Lagos
 * @returns {Promise<{budget_line_id: string|null, over_budget: boolean}>}
 */
async function check(db, request, sentOn) {
  if (!request.department_id) return { budget_line_id: null, over_budget: true };
  const line = await lineOf(db, request.department_id, request.expense_category_id, sentOn);
  if (!line) return { budget_line_id: null, over_budget: true };
  return { budget_line_id: line.budget_line_id, over_budget: m.compare(request.amount, line.remaining) > 0 };
}

/**
 * What New Request shows before it is sent (guide §6.6 rule 3): the line's remaining, the
 * department's remaining for the year across every line (as a request's modal reads it), and the
 * flag check() would set if it were sent on `sentOn`. Reads only.
 * @returns {Promise<{department_id: string|null, budget_remaining: string|null, department_remaining: string|null, over_budget: boolean}>}
 */
async function preview(db, request, sentOn) {
  const departmentId = request.department_id || null;
  if (!departmentId) return { department_id: null, budget_remaining: null, department_remaining: null, over_budget: true };
  const line = await lineOf(db, departmentId, request.expense_category_id, sentOn);
  const { rows } = await db.query(
    `SELECT sum(x.amount - x.committed_amount - x.spent_amount)::numeric(18,2) AS remaining
       FROM budget b JOIN budget_line x ON x.budget_id = b.budget_id
      WHERE b.department_id = $1 AND b.status <> 'closed' AND $2::date BETWEEN b.starts_on AND b.ends_on`,
    [departmentId, sentOn],
  );
  return {
    department_id: departmentId,
    budget_remaining: line ? m.toWire(line.remaining) : null,
    department_remaining: rows[0] && rows[0].remaining !== null ? m.toWire(rows[0].remaining) : null,
    over_budget: !line || m.compare(request.amount, line.remaining) > 0,
  };
}

module.exports = { check, preview };

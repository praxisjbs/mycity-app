"use strict";
/**
 * Self first, and who reads what (A17; docs/guides/performance.md §6 Review sequence, §8).
 *
 *   - A manager review shows nothing to its reviewer, and cannot be saved, until the employee's
 *     self review is submitted (409 SELF_REVIEW_FIRST).
 *   - The employee reads their manager's review only once it is closed.
 *   - A review's content is read by the employee, the reviewer, the reviewer's own line manager
 *     (the second level), Operations & People and the CEO; nobody else, whatever their scope.
 */
const { AppError } = require("../../shared/errors");
const approvers = require("../../shared/workflow/approvers");

const selfFirst = () =>
  new AppError("SELF_REVIEW_FIRST", "Waiting for the self review", 409);

/** The reviewer's own line manager that day, or null. */
async function secondLevelOf(client, reviewerId) {
  const { rows } = await client.query("SELECT manager_id FROM employee_effective_manager WHERE employee_id = $1", [reviewerId]);
  return rows[0] ? rows[0].manager_id : null;
}

async function isOperationsPeople(client, actor) {
  const held = await approvers.roleCodesOf(client, actor.role_ids || []);
  return held.includes("operations_people");
}

/**
 * How the caller stands to a review: the employee, the reviewer, a reader (second level,
 * Operations & People, the CEO), or nobody.
 */
async function standing(client, review, actor) {
  if (!actor) return null;
  if (actor.employee_id && actor.employee_id === review.reviewer_employee_id) return "reviewer";
  if (actor.employee_id && actor.employee_id === review.employee_id) return "employee";
  if (actor.is_ceo === true) return "reader";
  if (await isOperationsPeople(client, actor)) return "reader";
  const managerReviewer = review.review_type === "self" ? null : review.reviewer_employee_id;
  if (managerReviewer && actor.employee_id && (await secondLevelOf(client, managerReviewer)) === actor.employee_id)
    return "reader";
  return null;
}

module.exports = { selfFirst, secondLevelOf, standing };

"use strict";
/**
 * The review's sequence and who sees what (docs/guides/performance.md §6.12, §8; A17, P12).
 *
 *   check_in       the employee fills their check-in; nobody else sees it, and the reviewer is
 *                  answered 409 CHECK_IN_FIRST on read and save until it is submitted
 *   with_reviewer  the reviewer scores (returned: the same, after a refusal further up the chain)
 *   second_level   the reviewer's own line manager approves or sends it back
 *   with_hr        Operations & People close it (their approval), and may mark conduct
 *   closed         the employee sees the reviewer's scores, comments and actions, and the PDF
 *   withdrawn      closed at HR's stage without a score: its person left, or Operations & People
 *                  withdrew it with a reason (§11)
 *
 * Once the check-in's due date has passed and it is still not in, the reviewer opens the review
 * without it (nothing of the employee's drafts, not even a proposed score) and may Score Without
 * Check-In, with a reason: the drafts stay the employee's for good, and their own lines are Not
 * Assessable unless the reviewer scores them with a reason (§11).
 *
 * The parts of a review are restricted (§8): a check-in's actions, evidence notes and transcripts,
 * the reviewer's comments, the dotted manager's input and conduct reach only the employee (their
 * check-in always, the reviewer's parts once closed), the reviewer, the dotted manager (the
 * check-in and their own input), the second level, Operations & People and the CEO. Anyone else
 * the reader's scope reaches sees the stage and, once closed, the scores. Nothing here writes.
 */
const { AppError } = require("../../shared/errors");
const { assertInScope } = require("../../shared/rbac/scope");
const authority = require("../goals/goals.authority");
const targetsRepo = require("../targets/targets.repo");
const repo = require("./reviews.repo");

/** The stages a reviewer works in. */
const WITH_REVIEWER = Object.freeze(["with_reviewer", "returned"]);
/** The stages the approval engine holds. */
const IN_APPROVAL = Object.freeze(["second_level", "with_hr"]);
/** The stages a review ends in. */
const ENDED = Object.freeze(["closed", "withdrawn"]);

const checkInFirst = () =>
  new AppError("CHECK_IN_FIRST", "Waiting for the check-in", 409);
const notFound = () => new AppError("NOT_FOUND", "That review does not exist", 404);

/** Is the actor Operations & People: the role, or whoever runs the cycle (performance.manage)? */
async function isHr(db, actor) {
  if (!actor || !actor.user_id) return false;
  if (await authority.runsTheCycle(actor)) return true;
  return (await repo.roleCodesOfUser(db, actor.user_id)).includes("operations_people");
}

/** Does a review name the actor as its reviewer: by name, or as a holder of its reviewing role? */
async function isReviewer(db, review, actor) {
  if (!actor || !actor.employee_id) return false;
  if (review.reviewer_employee_id === actor.employee_id) return true;
  if (!review.reviewer_role_code || review.employee_id === actor.employee_id) return false;
  return targetsRepo.holdsRole(db, actor.employee_id, review.reviewer_role_code);
}

/**
 * Who the actor is to a review.
 * @returns {Promise<{employee: boolean, reviewer: boolean, dotted: boolean, second_level: boolean,
 *   hr: boolean, ceo: boolean, in_scope: boolean, named: boolean, full: boolean}>}
 */
async function rolesOf(db, review, actor, scope = null) {
  const me = actor && actor.employee_id;
  const roles = {
    employee: Boolean(me) && review.employee_id === me,
    reviewer: await isReviewer(db, review, actor),
    dotted: Boolean(me) && review.dotted_employee_id === me,
    second_level: Boolean(me) && review.second_level_employee_id === me,
    hr: await isHr(db, actor),
    ceo: Boolean(actor && actor.is_ceo === true),
    in_scope: false,
  };
  if (scope) {
    try {
      assertInScope(scope, review.employee_id);
      roles.in_scope = true;
    } catch {
      roles.in_scope = false;
    }
  }
  // Operations & People and the CEO read every review; the employee's own is never "HR" to them.
  roles.full = !roles.employee && (roles.second_level || roles.hr || roles.ceo);
  roles.named = roles.employee || roles.reviewer || roles.dotted || roles.second_level || roles.full;
  return roles;
}

/**
 * Refuse a reader the review does not name and their scope does not reach (404), and the reviewer
 * before the check-in is in (409 CHECK_IN_FIRST, A17) unless its due date has passed (`late`).
 */
function assertMayRead(review, roles, { late = false } = {}) {
  if (!roles.named && !roles.in_scope) throw notFound();
  if (roles.reviewer && !roles.employee && review.status === "check_in" && !late) throw checkInFirst();
}

/** Which parts of a review a reader is sent (§6.12, §8). */
function partsFor(review, roles) {
  const closed = review.status === "closed";
  // Not yet in, or scored without it: the employee's drafts are theirs alone (A17, §11).
  const unsent = !review.check_in_submitted_at && (review.status === "check_in" || Boolean(review.no_check_in_at));
  const team = roles.reviewer || roles.full;
  // A reviewer opening a late check-in sees no proposed or self score worked out from the drafts.
  const waiting = review.status === "check_in" && roles.reviewer && !roles.employee;
  return {
    check_in: roles.employee || (!unsent && (team || roles.dotted)),
    self: roles.employee || !unsent,
    scores: (team && !waiting) || (closed && (roles.employee || roles.in_scope)),
    reviewer_notes: team || (closed && roles.employee),
    input: team || roles.dotted || (closed && roles.employee),
    conduct: team || (closed && roles.employee),
    context: team,
  };
}

/** An item as a reader is sent it: what they may not see arrives as null. */
function itemFor(item, parts) {
  const out = { ...item };
  if (!parts.check_in) {
    for (const k of [
      "actual_value", "actual_text", "achieved_on", "evidence_kind", "evidence_entity_type", "evidence_entity_id",
      "evidence_document_id", "evidence_url", "evidence_note", "evidence_link", "action_text", "action_transcript",
      "action_document_id", "self_reason",
    ])
      out[k] = null;
    if (!parts.scores) {
      out.proposed_score = null;
      out.self_score = null;
    }
  }
  if (!parts.self) out.self_score = null;
  if (!parts.scores) out.score = null;
  if (!parts.reviewer_notes) {
    out.override_reason = null;
    out.comment = null;
  }
  return out;
}

/**
 * What the reader may do to the review now.
 * @param {object} review
 * @param {object} roles   rolesOf()
 * @param {{decide: boolean, has_pip: boolean, late: boolean}} extra  whether the reader may decide its
 *   approval's stage now (the engine's canAct), whether a PIP was started from it, and whether its
 *   check-in's due date has passed
 */
function allowed(review, roles, { decide = false, has_pip: hasPip = false, late = false } = {}) {
  const scoring = roles.reviewer && WITH_REVIEWER.includes(review.status);
  return {
    check_in: roles.employee && review.status === "check_in",
    score: scoring,
    submit: scoring,
    return_check_in: scoring,
    ask_input: scoring && Boolean(review.dotted_employee_id) && !review.dotted_input,
    give_input:
      roles.dotted && Boolean(review.check_in_submitted_at) && WITH_REVIEWER.includes(review.status),
    mark_conduct: roles.hr && !roles.employee && review.status !== "check_in" && review.status !== "withdrawn",
    decide_probation: roles.hr && !roles.employee && review.review_kind === "probation" && review.status === "with_hr",
    decide: decide && IN_APPROVAL.includes(review.status) && !roles.employee,
    start_pip: roles.hr && !roles.employee && review.status === "closed" && review.rating === "below" && !hasPip,
    score_without_check_in: roles.reviewer && !roles.employee && review.status === "check_in" && late,
    withdraw: roles.hr && !roles.employee && !ENDED.includes(review.status),
  };
}

/** The vault's rule for a review's files: the people it names, Operations & People and the CEO. */
async function mayOpenFile(client, user, doc) {
  if (user && user.is_ceo === true) return true;
  const review = await repo.get(client, doc.entity_id);
  if (!review) return false;
  const roles = await rolesOf(client, review, user);
  // The closed review's PDF is the employee's once it is made; evidence and dictation are theirs throughout.
  return roles.named;
}

module.exports = {
  WITH_REVIEWER,
  IN_APPROVAL,
  ENDED,
  checkInFirst,
  notFound,
  isHr,
  isReviewer,
  rolesOf,
  assertMayRead,
  partsFor,
  itemFor,
  allowed,
  mayOpenFile,
};

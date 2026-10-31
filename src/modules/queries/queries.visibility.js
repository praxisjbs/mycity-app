"use strict";
/**
 * Who sees a query: the one rule (docs/guides/queries.md §6.1, MILESTONES §8).
 *
 *   scope `all` on `queries`, and the CEO     every query, and every sanction that follows one
 *   anyone else                               only the queries they raised (raised_by = them),
 *                                             whatever their scope says: `team` does not widen it
 *   a query a rule raised (raised_by null)    scope `all` and the CEO only
 *
 * The repo, the search provider, the AI reads, the summaries and the sanctions module
 * all ask here, so the rule has one spelling. A record outside it is a 404.
 */
const { AppError } = require("../../shared/errors");

/**
 * @param {{scope: string}} scope   scopeOf(req), or the AI's actor.scope
 * @param {{user_id: string, is_ceo?: boolean}} user
 * @returns {{all: boolean, user_id: string}}
 */
function readerOf(scope, user) {
  return {
    all: Boolean(user && user.is_ceo === true) || Boolean(scope && scope.scope === "all"),
    user_id: user ? user.user_id : null,
    employee_id: (user && user.employee_id) || null,
  };
}

/**
 * The SQL that keeps a list to what the reader may see. Pushes its parameter.
 * @param {{all: boolean, user_id: string}} reader
 * @param {Array} params
 * @param {string} [column]  the raiser column, qualified
 */
function clause(reader, params, column = "q.raised_by") {
  if (reader.all) return { and: "" };
  params.push(reader.user_id);
  return { and: `AND ${column} = $${params.length}::uuid` };
}

/** May the reader see this row (anything carrying raised_by)? */
function canSee(reader, row) {
  return Boolean(row) && (reader.all || (Boolean(row.raised_by) && row.raised_by === reader.user_id));
}

/** The row, or 404 when the reader may not see it. */
function assertVisible(reader, row, what = "query") {
  if (!canSee(reader, row)) throw new AppError("NOT_FOUND", `That ${what} does not exist`, 404);
  return row;
}

module.exports = { readerOf, clause, canSee, assertVisible };

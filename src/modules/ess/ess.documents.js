"use strict";
/**
 * ESS · My Documents: the employee's own vault (docs/guides/ess.md §5, §10).
 *
 * Everything here is the caller's own record. There is no parameter that names
 * another employee, and the queries are the same ones People's Documents tab
 * runs, narrowed to one employee id taken from the session rather than from the
 * request. A document People marked restricted (an ID, a bank letter) is still
 * the employee's own to read, which is the vault's rule, not this module's
 * (shared/documents/vault.js canRead).
 */
const { AppError } = require("../../shared/errors");
const documents = require("../documents/documents.service");

/** The caller's employee record, or a refusal: there is no ESS without one. */
function meOf(user) {
  if (!user || !user.employee_id)
    throw new AppError(
      "NO_EMPLOYEE_RECORD",
      "This login has no employee record yet",
      409,
    );
  return user.employee_id;
}

const list = (user, query) => documents.listFor([meOf(user)], query);

const summary = (user) => documents.summaryFor([meOf(user)]);

/**
 * The employee files their own document. `document_request_id` answers what
 * People asked for, so the Missing row becomes this upload.
 */
const add = (user, file, body) =>
  documents.addEmployeeDocument({
    employeeId: meOf(user),
    file,
    body,
    actor: user,
    requestId: body.document_request_id,
  });

module.exports = { meOf, list, summary, add };

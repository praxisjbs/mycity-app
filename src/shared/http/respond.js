"use strict";
/**
 * Sending a success, the same way everywhere.
 *
 *   ok(res, employee)              200 { ...employee }
 *   created(res, employee)         201 { ...employee }
 *   accepted(res, { job_id })      202, work continues in the worker
 *   noContent(res)                 204, no body
 *   sendPaged(res, page)           200 { data, page }   (shared/http/paged.js; every list)
 *
 * A single record is sent as itself, not wrapped: the contract's response schema
 * for `GET /employees/:id` is `Employee`, and the body IS an Employee. Lists are
 * the one envelope, because a page has to say which page it is.
 *
 * Errors are not sent from here: throw an AppError and middleware/error-handler.js
 * answers.
 */

/** @param {import("express").Response} res */
function ok(res, body) {
  return res.status(200).json(body);
}

function created(res, body) {
  return res.status(201).json(body);
}

function accepted(res, body) {
  return res.status(202).json(body);
}

function noContent(res) {
  return res.status(204).end();
}

module.exports = { ok, created, accepted, noContent };

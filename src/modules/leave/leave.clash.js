"use strict";
/**
 * Cover: who else in the same department is away, or waiting to be, on the days a
 * request asks for (People · Leave). It reads only what the caller's `people` scope
 * already shows, so a line manager sees their own team's clashes and nobody else's.
 *
 * And the relief officer a request names (docs/guides/ess.md §6): someone who works here now,
 * not the person asking, and not away on any of the request's days, held to the same overlap
 * a person's own request is (leave.repo.overlapping: waiting or approved leave).
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { assertInScope } = require("../../shared/rbac/scope");
const repo = require("./leave.repo");

/** One page of the requests that overlap request `id` in its department. */
async function clashesOf(id, query, scope) {
  const of = await repo.get(pool, id);
  if (!of) throw new AppError("NOT_FOUND", "That leave request does not exist", 404);
  assertInScope(scope, of.employee_id);
  return repo.clashes(pool, of, query, scope);
}

/**
 * Refuse a relief officer who cannot cover: on the transaction's client, after the person's lock.
 * @param {{query: Function}} client
 * @param {string} employeeId   the person asking
 * @param {{relief_employee_id?: string, starts_on: string, ends_on: string}} body
 */
async function reliefClash(client, employeeId, body) {
  const reliefId = body.relief_employee_id;
  if (!reliefId) return;
  const refuse = (message) =>
    new AppError("LEAVE_RELIEF_UNAVAILABLE", "Pick another relief officer", 422, { relief_employee_id: [message] });
  if (reliefId === employeeId) throw refuse("Pick someone else");
  const person = await repo.employeeOf(client, reliefId);
  if (!person) throw refuse("Not on the staff");
  if (person.status !== "active") throw refuse("Not active");
  if (await repo.overlapping(client, reliefId, body.starts_on, body.ends_on)) throw refuse("Away on those days");
}

module.exports = { clashesOf, reliefClash };

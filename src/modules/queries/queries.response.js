"use strict";
/**
 * The employee's answer to a query, from ESS · My Queries (docs/guides/queries.md §3
 * step 3). One response a query, never edited: disagreement goes in the response, and
 * it is read before any decision. The query moves to Under Review and whoever raised it
 * is told (People, when a rule raised it).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const repo = require("./queries.repo");
const { EVENTS } = require("./queries.events");

/**
 * @param {object} user        the caller (req.user)
 * @param {string} employeeId  the caller's own employee id (ESS meOf), never from the request
 */
async function respond(user, employeeId, id, body) {
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const row = await repo.lock(client, id);
      if (!row || row.employee_id !== employeeId)
        throw new AppError("NOT_FOUND", "That query does not exist", 404);
      if (row.status !== "awaiting_response")
        throw new AppError("QUERY_NOT_OPEN", "This query no longer takes a response", 409);
      const saved = await repo.insertResponse(client, {
        employee_query_id: id,
        employee_id: employeeId,
        body: body.body,
      });
      if (!saved) throw new AppError("QUERY_ALREADY_ANSWERED", "You have already responded", 409);
      const full = await repo.get(client, id);
      await emit(client, {
        key: EVENTS.QUERY_RESPONDED,
        entity: { type: "query", id },
        actor: user,
        after: { status: "under_review" },
        payload: {
          employee_query_id: id,
          number: full.number,
          employee_id: employeeId,
          subject_employee_id: employeeId,
          raised_by: row.raised_by,
        },
      });
    });
  } finally {
    client.release();
  }
  return require("./queries.service").getMine(employeeId, id);
}

module.exports = { respond };

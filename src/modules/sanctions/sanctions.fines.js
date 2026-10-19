"use strict";
/**
 * Fines: an outcome attached to a sanction, never a rung (docs/guides/queries.md §6.6).
 * A fine is pending once its sanction is issued and reaches a payroll run only when
 * payroll (M6) accepts it, then settles it when the run is paid; it may be waived with a
 * reason instead. Nothing here deducts anything by itself.
 *
 *   pending(query)                 fines waiting for payroll, a page of 25
 *   accept(client, id, actor)      M6: taken into a run
 *   settle(client, id, actor)      M6: deducted, the run paid
 *   waive(client, id, actor, why)  M6 or People: not deducted
 *
 * M6 calls these inside its own transaction; each writes its event and refuses a move
 * the fine is not in a state for.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const repo = require("./sanctions.repo");
const { EVENTS } = require("./sanctions.events");

const pending = (query = {}) => repo.pendingFines(pool, query);

async function move(client, id, from, to, key, actor, reason = null) {
  if (!(await repo.settleFine(client, id, from, to)))
    throw new AppError("FINE_NOT_MOVABLE", `This fine cannot be ${to} now`, 409);
  await emit(client, {
    key,
    entity: { type: "sanction_fine", id },
    actor,
    before: { settlement_status: from },
    after: { settlement_status: to, reason },
    payload: { sanction_fine_id: id, settlement_status: to },
  });
}

const accept = (client, id, actor) => move(client, id, "pending", "accepted", EVENTS.SANCTION_FINE_ACCEPTED, actor);
const settle = (client, id, actor) => move(client, id, "accepted", "settled", EVENTS.SANCTION_FINE_SETTLED, actor);
const waive = (client, id, actor, reason) => move(client, id, "pending", "waived", EVENTS.SANCTION_FINE_WAIVED, actor, reason);

module.exports = { pending, accept, settle, waive };

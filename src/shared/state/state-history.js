"use strict";
/**
 * Stages, and how long things sit in them: a candidate's pipeline (M4), a
 * partner deal (M7), an expense through approval (M8). One record of every
 * move, so "time at stage", "stuck for 10 days" and funnel conversion all read
 * the same history instead of each module keeping its own timestamps.
 *
 * A module declares its states and the moves allowed between them:
 *
 *   const machine = defineMachine("candidate", {
 *     applied:     ["screening", "rejected", "withdrawn"],
 *     screening:   ["assessment", "rejected", "withdrawn"],
 *     assessment:  ["interview", "rejected", "withdrawn"],
 *     interview:   ["offer", "rejected", "withdrawn"],
 *     offer:       ["hired", "rejected", "withdrawn"],
 *     hired: [], rejected: [], withdrawn: [],
 *   });
 *
 * and moves a record inside its own transaction:
 *
 *   await transition(client, machine, { entity_id, from: row.stage, to: "interview", actor_id, reason });
 *   await repo.setStage(client, entity_id, "interview");      // the record's own column, same transaction
 *
 * transition() refuses a move the machine does not allow (409, naming both
 * states) and writes one history row. The record's current stage stays on the
 * record itself (fast lists, simple filters); this table is its history.
 *
 * Table (migration 0070): entity_state_history (entity_state_history_id, entity_type,
 * entity_id, from_state, to_state, actor_id, reason, changed_at)
 */
const { AppError } = require("../errors");

/**
 * @param {string} entityType
 * @param {Record<string, string[]>} moves  state → states it may move to; terminal states map to []
 */
function defineMachine(entityType, moves) {
  if (!/^[a-z][a-z0-9_]*$/.test(entityType)) throw new Error("defineMachine: entity type is snake_case");
  const states = new Set(Object.keys(moves));
  for (const [from, tos] of Object.entries(moves)) {
    for (const to of tos) {
      if (!states.has(to)) throw new Error(`defineMachine(${entityType}): "${from}" moves to unknown state "${to}"`);
    }
  }
  return Object.freeze({ entityType, states, moves: Object.freeze({ ...moves }) });
}

const canMove = (machine, from, to) => Boolean(machine.moves[from] && machine.moves[from].includes(to));

/** Refuse a move the machine does not allow. A null `from` is the record's first state. */
function assertMove(machine, from, to) {
  if (!machine.states.has(to)) throw new AppError("INVALID_STATE", `"${to}" is not a ${machine.entityType} state`, 422);
  if (from === null || from === undefined) return;
  if (!canMove(machine, from, to)) {
    throw new AppError("MOVE_NOT_ALLOWED", `A ${machine.entityType.replace(/_/g, " ")} cannot move from ${from} to ${to}`, 409);
  }
}

/**
 * Record a move. Run inside the caller's transaction, beside the update of the
 * record's own state column.
 * @param {import("pg").PoolClient} client
 * @param {object} machine  from defineMachine
 * @param {{entity_id: string, from: string|null, to: string, actor_id?: string|null, reason?: string|null}} move
 */
async function transition(client, machine, { entity_id, from = null, to, actor_id = null, reason = null }) {
  assertMove(machine, from, to);
  const { rows } = await client.query(
    `INSERT INTO entity_state_history (entity_type, entity_id, from_state, to_state, actor_id, reason, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING entity_state_history_id, changed_at`,
    [machine.entityType, entity_id, from, to, actor_id, reason],
  );
  return rows[0];
}

/**
 * Pure: turn ordered history rows into time spent per stage.
 * @param {Array<{to_state: string, changed_at: Date|string}>} rows  oldest first
 * @param {Date} [now]
 * @returns {Array<{state: string, entered_at: Date, left_at: Date|null, seconds: number}>}
 */
function stagesFrom(rows, now = new Date()) {
  return rows.map((r, i) => {
    const entered = new Date(r.changed_at);
    const left = rows[i + 1] ? new Date(rows[i + 1].changed_at) : null;
    return { state: r.to_state, entered_at: entered, left_at: left, seconds: Math.max(0, Math.round(((left || now) - entered) / 1000)) };
  });
}

/**
 * SQL for "how long has each record been in its current stage", to join in a
 * list query: one row per entity with its latest move.
 *
 *   LEFT JOIN (${currentStageSince(2)}) cs ON cs.entity_id = c.candidate_id      -- $2 = "candidate"
 */
function currentStageSince(paramIndex) {
  return `SELECT DISTINCT ON (entity_id) entity_id, to_state, changed_at AS stage_since
            FROM entity_state_history WHERE entity_type = $${paramIndex}
           ORDER BY entity_id, changed_at DESC`;
}

module.exports = { defineMachine, canMove, assertMove, transition, stagesFrom, currentStageSince };

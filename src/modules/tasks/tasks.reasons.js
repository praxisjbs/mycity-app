"use strict";
/**
 * Why Late's reasons (docs/guides/workspace.md §6 Late reasons): the list every overdue task
 * offers, kept by holders of `workspace.late_reasons` from the settings icon on Tasks.
 *
 *   list()       the reasons switched on, in order; every one for a holder who asks `all`
 *   add()        a new reason at the foot, its code made from its words
 *   setActive()  switch one off or on; a reason is never deleted, so answers keep it
 *   assertOn()   the check Why Late's answers pass: a reason switched on
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const grantsCache = require("../../shared/rbac/grants-cache");
const c = require("@mycity/contract");
const repo = require("./tasks.repo");
const { EVENTS } = require("./tasks.events");

const CAPABILITY = "workspace.late_reasons";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Does the caller keep the list? The CEO holds every capability. */
async function keeps(actor) {
  if (!actor) return false;
  if (actor.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(pool, actor.user_id)).includes(CAPABILITY);
}

const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });

/** A reason's code from its words: "Waiting on Client" is waiting_on_client. */
function codeOf(label) {
  const code = String(label)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 60)
    .replace(/_+$/, "");
  return code;
}

async function list(query, actor) {
  const all = query.all === "true" && (await keeps(actor));
  return repo.lateReasons(pool, { all }, query);
}

async function add(actor, { label }) {
  const words = String(label).trim();
  const code = codeOf(words);
  if (!code) throw invalid("label", "Use some letters");
  return tx(async (client) => {
    const { total, taken } = await repo.lateReasonClash(client, code, words);
    if (taken) throw invalid("label", "Already a reason");
    if (total >= c.tasks.LATE_REASONS_MAX)
      throw new AppError("TOO_MANY_REASONS", `Why Late holds at most ${c.tasks.LATE_REASONS_MAX} reasons`, 409);
    const row = await repo.insertLateReason(client, { code, label: words, created_by: actor.user_id });
    if (!row) throw invalid("label", "Already a reason");
    await emit(client, {
      key: EVENTS.TASK_LATE_REASON_CREATED,
      entity: { type: "task_late_reason", id: row.task_late_reason_id },
      actor,
      after: row,
      payload: { code: row.code, label: row.label },
    });
    return row;
  });
}

async function setActive(actor, id, { active }) {
  return tx(async (client) => {
    const before = await repo.lateReason(client, id);
    if (!before) throw new AppError("NOT_FOUND", "That reason does not exist", 404);
    if (before.active === active) return before;
    const row = await repo.setLateReasonActive(client, id, active);
    await emit(client, {
      key: EVENTS.TASK_LATE_REASON_CHANGED,
      entity: { type: "task_late_reason", id },
      actor,
      before: { active: before.active },
      after: { active },
      payload: { code: row.code, label: row.label, active },
    });
    return row;
  });
}

/** Why Late's answer must be a reason switched on (422 otherwise). */
async function assertOn(db, code) {
  if (code && !(await repo.lateReasonOn(db, code))) throw invalid("late_reason", "Pick a reason");
}

module.exports = { CAPABILITY, keeps, codeOf, list, add, setActive, assertOn };

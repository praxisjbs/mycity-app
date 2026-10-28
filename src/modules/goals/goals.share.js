"use strict";
/**
 * Sharing a company goal (docs/guides/performance.md §6.24, P26; JBS Praxis, 28/10/2026).
 *
 * The CEO shares an organisational goal, and Management a company objective with its key results, with all
 * staff or chosen departments, read only. One share per goal and one per objective; saving again changes
 * the audience and Stop Sharing removes it. Sharing one item shares nothing else. Who reads what the share
 * opens is goals.visibility.js; this file writes and describes the shares.
 *
 * Saving tells the people it newly reaches, once: the event carries who they are (`notify`), and the
 * notification declared in goals.events.js finds their logins.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { completeQuery } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const authority = require("./goals.authority");
const repo = require("./goals.repo");
const { EVENTS } = require("./goals.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/** What differs between the two things that can be shared. */
const KINDS = Object.freeze({
  goal: {
    column: "organisational_goal_id",
    entity: "organisational_goal",
    capability: "goals.organisation",
    missing: "That goal does not exist",
    saved: () => EVENTS.ORGANISATIONAL_GOAL_SHARED,
    removed: () => EVENTS.ORGANISATIONAL_GOAL_UNSHARED,
  },
  objective: {
    column: "okr_objective_id",
    entity: "objective",
    capability: "goals.company",
    missing: "That objective does not exist",
    saved: () => EVENTS.OBJECTIVE_SHARED,
    removed: () => EVENTS.OBJECTIVE_UNSHARED,
  },
});

/** A goal_share row (with its departments and sharer) as GoalShare. */
function shareView(r) {
  return {
    goal_share_id: r.goal_share_id,
    organisational_goal_id: r.organisational_goal_id,
    okr_objective_id: r.okr_objective_id,
    audience: r.audience,
    departments: r.departments || [],
    shared_by: r.shared_by || null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/**
 * How some goals or objectives are shared, by id (a page's worth at most): a Map of id to GoalShare, none
 * for one not shared.
 * @param {{query: Function}} db
 * @param {"goal"|"objective"} kind
 * @param {string[]} ids
 */
async function sharesOf(db, kind, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { column } = KINDS[kind];
  // pagination:complete the shares of one page of goals or objectives: at most one each
  const { rows } = await completeQuery(
    db,
    `SELECT gs.goal_share_id, gs.organisational_goal_id, gs.okr_objective_id, gs.audience, gs.created_at, gs.updated_at,
            ${personJson("se", "sd")} AS shared_by,
            COALESCE((SELECT json_agg(json_build_object('department_id', d.department_id, 'code', d.code::text, 'name', d.name)
                                      ORDER BY d.name, d.department_id)
                        FROM goal_share_department gd JOIN department d ON d.department_id = gd.department_id
                       WHERE gd.goal_share_id = gs.goal_share_id), '[]'::json) AS departments
       FROM goal_share gs
       LEFT JOIN app_user su ON su.user_id = gs.shared_by
       LEFT JOIN employee se ON se.employee_id = su.employee_id
       LEFT JOIN department sd ON sd.department_id = se.department_id
      WHERE gs.${column} = ANY($1::uuid[])
      ORDER BY gs.goal_share_id`,
    [ids],
    { label: "the shares of a page" },
  );
  for (const r of rows) out.set(r[column], shareView(r));
  return out;
}

/**
 * The `share` and `can_share` of each item, as the contract gives them: the share only to a reader who may
 * share the item (what a reader of a shared goal sees of how, and to whom, is not theirs to know).
 * @param {object} actor
 * @param {"goal"|"objective"} kind
 * @param {Array<object>} items  rows with their id and, for an objective, `department_id`
 * @returns {Promise<Map<string, {can_share: boolean, share: object|null}>>}
 */
async function sharingOf(actor, kind, items) {
  const { column, capability } = KINDS[kind];
  const holds = await authority.holds(actor, capability);
  const shareable = items.filter((i) => holds && (kind === "goal" || !i.department_id));
  const shares = shareable.length ? await sharesOf(pool, kind, shareable.map((i) => i[column])) : new Map();
  return new Map(
    items.map((i) => {
      const can = shareable.includes(i);
      return [i[column], { can_share: can, share: can ? shares.get(i[column]) || null : null }];
    }),
  );
}

/** The existing share of an item, with its departments' ids; null when it is not shared. */
async function heldShare(db, kind, id) {
  const { column } = KINDS[kind];
  const { rows } = await db.query(
    `SELECT gs.goal_share_id, gs.audience,
            COALESCE((SELECT array_agg(gd.department_id) FROM goal_share_department gd WHERE gd.goal_share_id = gs.goal_share_id),
                     '{}'::uuid[]) AS department_ids
       FROM goal_share gs WHERE gs.${column} = $1`,
    [id],
  );
  return rows[0] || null;
}

/** The item being shared, its code and title for the event; 404 when it does not exist. */
async function itemOf(kind, id) {
  const row = kind === "goal" ? await repo.getGoal(pool, id) : await repo.getObjective(pool, id);
  if (!row) throw new AppError("NOT_FOUND", KINDS[kind].missing, 404);
  return row;
}

/** Refuse (422 on `department_ids`) a department that is not an active one. */
async function assertDepartments(db, ids) {
  if (!ids.length) return;
  const { rows } = await db.query("SELECT department_id FROM department WHERE department_id = ANY($1::uuid[]) AND active", [ids]);
  if (rows.length !== ids.length)
    throw new AppError("VALIDATION_FAILED", "Pick active departments", 422, { department_ids: ["Not a department"] });
}

/**
 * Who a share newly reaches, from what it reached before (§6.24): nobody new once it reached all staff;
 * all staff, less the departments it already reached; or the departments added.
 */
function newlyReached(before, after) {
  if (before && before.audience === "all") return { all: false, department_ids: [], except_department_ids: [] };
  const held = before ? before.department_ids : [];
  if (after.audience === "all") return { all: true, department_ids: [], except_department_ids: held };
  return { all: false, department_ids: after.department_ids.filter((d) => !held.includes(d)), except_department_ids: [] };
}

/**
 * PUT /performance/goals/:id/share and /objectives/:id/share. The route holds the capability; this checks
 * what the capability cannot see: that a function's objective is not shared.
 * @param {object} actor
 * @param {"goal"|"objective"} kind
 * @param {string} id
 * @param {{audience: "all"|"departments", department_ids: string[]}} body
 */
async function save(actor, kind, id, body) {
  const spec = KINDS[kind];
  const item = await itemOf(kind, id);
  if (kind === "objective" && item.department_id)
    throw new AppError("NOT_A_COMPANY_OBJECTIVE", "Only a company objective is shared", 409);
  const wanted = body.audience === "departments" ? [...new Set(body.department_ids)] : [];
  await tx(async (client) => {
    await assertDepartments(client, wanted);
    const before = await heldShare(client, kind, id);
    let shareId;
    if (before) {
      shareId = before.goal_share_id;
      await client.query("UPDATE goal_share SET audience = $2, shared_by = $3 WHERE goal_share_id = $1", [shareId, body.audience, actor.user_id]);
      await client.query("DELETE FROM goal_share_department WHERE goal_share_id = $1", [shareId]);
    } else {
      const { rows } = await client.query(
        `INSERT INTO goal_share (${spec.column}, audience, shared_by) VALUES ($1, $2, $3) RETURNING goal_share_id`,
        [id, body.audience, actor.user_id],
      );
      shareId = rows[0].goal_share_id;
    }
    for (const departmentId of wanted)
      await client.query("INSERT INTO goal_share_department (goal_share_id, department_id) VALUES ($1, $2)", [shareId, departmentId]);
    const after = { audience: body.audience, department_ids: wanted };
    await emit(client, {
      key: spec.saved(),
      entity: { type: spec.entity, id },
      actor,
      before: before ? { audience: before.audience, department_ids: before.department_ids } : null,
      after,
      payload: {
        [spec.column]: id,
        code: item.code,
        title: item.title,
        audience: body.audience,
        department_ids: wanted,
        notify: newlyReached(before, after),
      },
    });
  });
  return (await sharesOf(pool, kind, [id])).get(id);
}

/** DELETE /performance/goals/:id/share and /objectives/:id/share: Stop Sharing. Nothing shared is nothing to do. */
async function remove(actor, kind, id) {
  const spec = KINDS[kind];
  const item = await itemOf(kind, id);
  await tx(async (client) => {
    const before = await heldShare(client, kind, id);
    if (!before) return;
    await client.query("DELETE FROM goal_share WHERE goal_share_id = $1", [before.goal_share_id]);
    await emit(client, {
      key: spec.removed(),
      entity: { type: spec.entity, id },
      actor,
      before: { audience: before.audience, department_ids: before.department_ids },
      payload: { [spec.column]: id, code: item.code, title: item.title },
    });
  });
}

module.exports = {
  KINDS,
  sharesOf,
  sharingOf,
  newlyReached,
  save,
  remove,
  saveGoal: (actor, id, body) => save(actor, "goal", id, body),
  removeGoal: (actor, id) => remove(actor, "goal", id),
  saveObjective: (actor, id, body) => save(actor, "objective", id, body),
  removeObjective: (actor, id) => remove(actor, "objective", id),
};

"use strict";
/**
 * Who reads what of the OKR tree (docs/guides/performance.md §6.23, P25; JBS Praxis, 28/10/2026).
 *
 * What a person sets is goals.authority.js. This is what a person reads, and it is the one place that
 * says so: Goals, KPIs, ⌘K, the assistant, Home and My Performance all ask it, so none can show more than
 * Goals does. A reader's reach is worked out once from their grant, their capabilities and their records:
 *
 *   whole plan      the CEO; whoever holds `goals.view_all`, `goals.company` or `goals.organisation`
 *   every function  the whole plan, and a `performance` grant whose scope is `all` (Operations & People)
 *   own departments everyone else: the department on their record, any they head or act for, and the
 *                   departments of the scorecards they review (a manager of someone in another function
 *                   drafts that scorecard's lines against that function's key results)
 *
 * A record outside the reader's reach is 404, never 403, as outside a record scope. The SQL builders
 * below push their own parameters onto the caller's list and return a condition, so a repo adds one
 * `AND ${objectiveReadable(reach, "o", params)}` and is done.
 */
const { AppError } = require("../../shared/errors");
const { completeQuery } = require("../../shared/http/paged");
const approvers = require("../../shared/workflow/approvers");
const { scopeFor } = require("../../middleware/rbac");
const authority = require("./goals.authority");

/** The capabilities that read the whole plan: whoever sets the company's goals reads what they set. */
const WHOLE_PLAN = Object.freeze(["goals.view_all", "goals.company", "goals.organisation"]);

/** Nobody: no `performance` grant, or no login. Every condition reads FALSE. */
const NOBODY = Object.freeze({ none: true, full: false, all_functions: false, department_ids: [], employee_id: null, user: null });

/** The reach that reads everything: for the system's own work (an importer, a job). */
const EVERYTHING = Object.freeze({ none: false, full: true, all_functions: true, department_ids: [], employee_id: null, user: null });

/**
 * The departments a person reads as their own: the one on their record, the ones they head, the ones they
 * act for while a head role is open (organisation.headOf), and those of the scorecards they review.
 * @param {{query: Function}} db
 * @param {string} employeeId
 * @returns {Promise<string[]>}
 */
async function departmentsOf(db, employeeId) {
  const organisation = require("../organisation/organisation.service");
  // pagination:complete the departments a person belongs to or heads: a handful of the organisation's few
  const { rows } = await completeQuery(
    db,
    `SELECT e.department_id, 'own' AS kind FROM employee e WHERE e.employee_id = $1 AND e.department_id IS NOT NULL
      UNION
     SELECT d.department_id, CASE WHEN d.head_employee_id = $1 THEN 'head' ELSE 'seat' END
       FROM department d
      WHERE d.active AND (d.head_employee_id = $1 OR (d.head_employee_id IS NULL AND d.head_seat_id IS NOT NULL))
      UNION
     SELECT s.department_id, 'review' FROM scorecard s WHERE s.reviewer_employee_id = $1 AND s.department_id IS NOT NULL`,
    [employeeId],
    { label: "a reader's departments" },
  );
  const out = new Set();
  for (const r of rows) {
    // An open head role is acted for by the person above it: theirs to read only when that is the reader.
    if (r.kind !== "seat" || (await organisation.headOf(db, r.department_id)) === employeeId) out.add(r.department_id);
  }
  return [...out];
}

/**
 * A reader's reach in the tree.
 * @param {{query: Function}} db
 * @param {object|null} actor  req.user: user_id, employee_id, role_ids, is_ceo
 * @returns {Promise<{none: boolean, full: boolean, all_functions: boolean, department_ids: string[], employee_id: string|null, user: object|null}>}
 */
async function readerOf(db, actor) {
  if (!actor || (!actor.user_id && actor.is_ceo !== true)) return NOBODY;
  const grant = await scopeFor(actor, "performance", "view");
  if (!grant) return NOBODY;
  let full = actor.is_ceo === true;
  for (const code of full ? [] : WHOLE_PLAN) {
    if (await authority.holds(actor, code)) {
      full = true;
      break;
    }
  }
  const employeeId = actor.employee_id || null;
  return {
    none: false,
    full,
    all_functions: full || grant.scope === "all",
    department_ids: employeeId ? await departmentsOf(db, employeeId) : [],
    employee_id: employeeId,
    user: actor,
  };
}

const notFound = (what) => new AppError("NOT_FOUND", `${what} does not exist`, 404);

/* ------------------------------------------------------------------ *
 * SQL: each builder pushes what it needs onto `params` and returns a condition
 * ------------------------------------------------------------------ */

/** Is the item (`ref`, a goal's or an objective's id column) shared with the reader's departments? */
function sharedWithReader(reach, kind, ref, params) {
  const column = kind === "goal" ? "organisational_goal_id" : "okr_objective_id";
  params.push(reach.department_ids);
  return `EXISTS (SELECT 1 FROM goal_share gs
           WHERE gs.${column} = ${ref}
             AND (gs.audience = 'all'
                  OR EXISTS (SELECT 1 FROM goal_share_department gd
                              WHERE gd.goal_share_id = gs.goal_share_id AND gd.department_id = ANY($${params.length}::uuid[]))))`;
}

/** Does the reader own or co-own a key result of the objective `o`? */
function ownsKeyResultOf(reach, o, params) {
  if (!reach.employee_id) return "FALSE";
  params.push(reach.employee_id);
  return `EXISTS (SELECT 1 FROM okr_key_result ok
           WHERE ok.okr_objective_id = ${o}.okr_objective_id
             AND $${params.length}::uuid IN (ok.accountable_employee_id, ok.co_accountable_employee_id))`;
}

/**
 * May the reader read the whole of the objective `o` (an alias of okr_objective): a function's of theirs,
 * or a company objective shared with them, or any of them for the whole plan?
 */
function objectiveOpen(reach, o, params) {
  if (reach.none) return "FALSE";
  if (reach.full) return "TRUE";
  // A comparison with the company's null department is null, not false: coalesced, so a reader's answer is a yes or a no.
  const own = reach.all_functions
    ? `${o}.department_id IS NOT NULL`
    : (params.push(reach.department_ids), `COALESCE(${o}.department_id = ANY($${params.length}::uuid[]), false)`);
  return `(${own} OR (${o}.department_id IS NULL AND ${sharedWithReader(reach, "objective", `${o}.okr_objective_id`, params)}))`;
}

/** May the reader read the objective `o` at all: open to them, or holding a key result they own? */
function objectiveReadable(reach, o, params) {
  if (reach.none) return "FALSE";
  if (reach.full) return "TRUE";
  return `(${objectiveOpen(reach, o, params)} OR ${ownsKeyResultOf(reach, o, params)})`;
}

/** May the reader read the key result `kr` of the objective `o`: its objective is open to them, or they own it? */
function keyResultReadable(reach, kr, o, params) {
  if (reach.none) return "FALSE";
  if (reach.full) return "TRUE";
  const open = objectiveOpen(reach, o, params);
  if (!reach.employee_id) return open;
  params.push(reach.employee_id);
  return `(${open} OR $${params.length}::uuid IN (${kr}.accountable_employee_id, ${kr}.co_accountable_employee_id))`;
}

/** May the reader read the organisational goal `g`: the whole plan, or shared with them? */
function goalReadable(reach, g, params) {
  if (reach.none) return "FALSE";
  if (reach.full) return "TRUE";
  return sharedWithReader(reach, "goal", `${g}.organisational_goal_id`, params);
}

/**
 * May the reader read what belongs to a department (`column`, null for the company): a plan, a KPI. The
 * company's is the whole plan's alone.
 */
function departmentReadable(reach, column, params) {
  if (reach.none) return "FALSE";
  if (reach.full) return "TRUE";
  if (reach.all_functions) return `${column} IS NOT NULL`;
  params.push(reach.department_ids);
  return `COALESCE(${column} = ANY($${params.length}::uuid[]), false)`;
}

/** May the reader read this department's functions (a plain check, for a screen's choices)? */
const readsFunction = (reach, departmentId) =>
  !reach.none && (departmentId ? reach.all_functions || reach.department_ids.includes(departmentId) : reach.full);

/* ------------------------------------------------------------------ *
 * One record: its access, or 404
 * ------------------------------------------------------------------ */

/**
 * How the reader stands to an objective: `readable`, and `open` (the whole of it, not only the key results
 * they own). Null when the objective does not exist.
 */
async function objectiveAccess(db, reach, id) {
  const params = [id];
  const open = objectiveOpen(reach, "o", params);
  const readable = objectiveReadable(reach, "o", params);
  const { rows } = await db.query(
    `SELECT ${open} AS open, ${readable} AS readable FROM okr_objective o WHERE o.okr_objective_id = $1`,
    params,
  );
  return rows[0] ? { open: rows[0].open === true, readable: rows[0].readable === true } : null;
}

/** Refuse (404) unless the reader may read the objective; says how they stand to it. */
async function assertObjective(db, reach, id) {
  const access = await objectiveAccess(db, reach, id);
  if (!access || !access.readable) throw notFound("That objective");
  return access;
}

/** Refuse (404) unless the reader may read the key result (its objective, or as its owner). */
async function assertKeyResult(db, reach, id) {
  const params = [id];
  const readable = keyResultReadable(reach, "kr", "o", params);
  const { rows } = await db.query(
    `SELECT ${readable} AS readable FROM okr_key_result kr JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      WHERE kr.okr_key_result_id = $1`,
    params,
  );
  if (!rows[0] || rows[0].readable !== true) throw notFound("That key result");
}

/** Refuse (404) unless the reader may read the organisational goal. */
async function assertGoal(db, reach, id) {
  const params = [id];
  const readable = goalReadable(reach, "g", params);
  const { rows } = await db.query(
    `SELECT ${readable} AS readable FROM organisational_goal g WHERE g.organisational_goal_id = $1 AND g.level = 'organisation'`,
    params,
  );
  if (!rows[0] || rows[0].readable !== true) throw notFound("That goal");
}

/** Is a decision of this approval instance waiting on the reader? An approver reads what they decide. */
async function waitsOn(db, actor, workflowInstanceId) {
  if (!actor || !workflowInstanceId) return false;
  const roleCodes = await approvers.roleCodesOf(db, actor.role_ids || []);
  const params = [workflowInstanceId];
  const named = approvers.waitingOnClause("wi", actor, roleCodes, params);
  const { rows } = await db.query(
    `SELECT 1 AS found FROM workflow_instance wi WHERE wi.workflow_instance_id = $1 AND wi.state = 'pending' AND ${named} LIMIT 1`,
    params,
  );
  return rows.length > 0;
}

/**
 * Refuse (404) unless the reader reaches the plan's department, or its approval waits on them.
 * @param {{department_id: string|null, workflow_instance_id?: string|null}} plan
 */
async function assertPlan(db, reach, actor, plan) {
  if (readsFunction(reach, plan.department_id) || (await waitsOn(db, actor, plan.workflow_instance_id))) return;
  throw notFound("That plan");
}

module.exports = {
  NOBODY,
  EVERYTHING,
  readerOf,
  departmentsOf,
  readsFunction,
  objectiveOpen,
  objectiveReadable,
  keyResultReadable,
  goalReadable,
  departmentReadable,
  objectiveAccess,
  assertObjective,
  assertKeyResult,
  assertGoal,
  assertPlan,
  waitsOn,
};

"use strict";
/**
 * The Plans settings (docs/guides/offers.md §3 step 8, §4): a department's onboarding steps, each
 * with the role that owns it, the day it is due counted from the start date, and an SOP when one
 * applies. The plan with no department is the company's default (MyCity's Your First 30 Days, seed
 * 5399), used for a department without an active plan of its own.
 *
 *   plans(), plan()          the settings' list (25 a page) and one plan with its steps
 *   createPlan(), savePlan() a plan saved whole: its steps replace the earlier ones in the order given
 *
 * One plan a department, and one default. A case keeps the steps it was given when it reached
 * onboarding (onboarding_case_step), so a plan changed later never changes a hire's steps.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const repo = require("./onboarding.repo");
const sop = require("./onboarding.sop");
const { EVENTS } = require("./onboarding.events");

const iso = (v) => (v ? new Date(v).toISOString() : null);
const notFound = () => new AppError("NOT_FOUND", "That plan does not exist", 404);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** OnboardingPlanRow. */
const rowOf = (p) => ({
  onboarding_plan_id: p.onboarding_plan_id,
  department_id: p.department_id || null,
  department: p.department || null,
  name: p.name,
  active: p.active,
  step_count: Number(p.step_count || 0),
  updated_at: iso(p.updated_at),
});

/** OnboardingPlan: the row and its steps, each SOP as it stands now (null once it is archived). */
async function planOf(db, p) {
  const steps = await repo.steps(db, p.onboarding_plan_id);
  const sops = await sop.sopsById(db, steps.map((s) => s.sop_id));
  const { step_count: _count, ...row } = rowOf(p);
  return {
    ...row,
    steps: steps.map((s) => ({
      onboarding_plan_step_id: s.onboarding_plan_step_id,
      position: Number(s.position),
      title: s.title,
      description: s.description || null,
      owner_role: s.owner_role,
      due_offset_days: Number(s.due_offset_days),
      sop: (s.sop_id && sops.get(s.sop_id)) || null,
    })),
  };
}

async function plans(query) {
  const page = await repo.plans(pool, query);
  return { ...page, data: page.data.map(rowOf) };
}

async function plan(id) {
  const p = await repo.plan(pool, id);
  if (!p) throw notFound();
  return planOf(pool, p);
}

/** The department exists, has no other plan, and every SOP named is in force. */
async function assertSavable(client, body, id = null) {
  if (body.department_id && !(await repo.departmentExists(client, body.department_id)))
    throw new AppError("DEPARTMENT_NOT_FOUND", "Pick a department in use", 422, { department_id: ["Pick a department in use"] });
  const holder = await repo.planOfDepartment(client, body.department_id);
  if (holder && holder !== id)
    throw new AppError(
      "PLAN_EXISTS",
      body.department_id ? "This department already has a plan" : "There is already a default plan",
      409,
      { department_id: ["Already has a plan"] },
    );
  await sop.assertInForce(client, body.steps, body.department_id || null);
}

async function saved(client, actor, id, before) {
  const p = await planOf(client, await repo.plan(client, id));
  await emit(client, {
    key: EVENTS.ONBOARDING_PLAN_SAVED,
    entity: { type: "onboarding_plan", id },
    actor,
    before: before ? { name: before.name, active: before.active, department_id: before.department_id, step_count: before.step_count } : null,
    after: { name: p.name, active: p.active, department_id: p.department_id, step_count: p.steps.length },
    payload: { onboarding_plan_id: id, department_id: p.department_id },
  });
  return p;
}

async function createPlan(actor, body) {
  return tx(async (client) => {
    await assertSavable(client, body);
    const id = await repo.insertPlan(client, body, actor.user_id);
    await repo.replaceSteps(client, id, body.steps);
    return saved(client, actor, id, null);
  });
}

async function savePlan(actor, id, body) {
  return tx(async (client) => {
    const before = await repo.plan(client, id);
    if (!before) throw notFound();
    await assertSavable(client, body, id);
    await repo.updatePlan(client, id, body, actor.user_id);
    await repo.replaceSteps(client, id, body.steps);
    return saved(client, actor, id, before);
  });
}

module.exports = { plans, plan, createPlan, savePlan };

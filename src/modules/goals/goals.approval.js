"use strict";
/**
 * What an approval's outcome does to a plan or a target (docs/guides/performance.md §6.4, §6.7).
 *
 *   performance.plan approved           the plan binds: its codes freeze, its function's scorecards
 *                                       bind and their people and reviewers are asked to agree; an
 *                                       amendment holding one mid-quarter scorecard binds it alone
 *   performance.plan rejected           the plan returns to its head with the reason (Request
 *                                       Changes on a plan is a refusal with a reason)
 *   performance.target_change approved  the new target applies from its month; earlier months keep
 *                                       their scores; the original stays in the history
 *   performance.target_change rejected  nothing changes but the request
 *   performance.plan_change approved    a request to unbind a binding plan: the plan is unbound, live and
 *                                       open for changes (§6.22); the changes an unbound plan then sends:
 *                                       the plan is binding again
 *   performance.plan_change rejected    the request is refused and the plan stays binding; the changes
 *                                       are returned and the plan stays unbound, with the reason
 *
 * Each runs once, after the decision commits, as an outbox handler (workflow.onCompleted); each is
 * safe to run again.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const workflow = require("../../shared/workflow/engine");
const repo = require("./goals.repo");
const { EVENTS } = require("./goals.events");

const PLAN_FLOW = "performance.plan";
const CHANGE_FLOW = "performance.target_change";
const PLAN_CHANGE_FLOW = "performance.plan_change";

const isApproved = (state) => state === "approved" || state === "timeout_approved";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The employee behind a user id, for telling them. */
async function employeeOfUser(db, userId) {
  if (!userId) return null;
  const { rows } = await db.query("SELECT employee_id FROM app_user WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].employee_id : null;
}

/**
 * Settle a plan's approval. `state` is the instance's: approved, rejected, cancelled or a timeout.
 * @param {string} planId
 * @param {{state: string, reason?: string|null}} outcome
 */
async function settlePlan(planId, { state, reason = null }) {
  return tx(async (client) => {
    const plan = await repo.getPlan(client, planId);
    if (!plan || plan.status !== "submitted") return null;
    const targets = require("../targets/targets.service");
    if (state === "approved" || state === "timeout_approved") {
      await repo.updatePlan(client, planId, { status: "binding", binding_at: new Date() });
      const bound = plan.department_id ? await targets.bindDepartment(client, { ...plan, period: plan.period_name }) : [];
      const agree = [...new Set(bound.flatMap((s) => [s.employee_id, s.reviewer_employee_id]).filter(Boolean))];
      await emit(client, {
        key: EVENTS.PLAN_BINDING,
        entity: { type: "performance_plan", id: planId },
        actor: null,
        payload: {
          performance_plan_id: planId,
          department: plan.department,
          period: plan.period_name,
          scorecards: bound.length,
          agree_employee_ids: agree,
        },
      });
      return "binding";
    }
    await repo.updatePlan(client, planId, { status: "returned", returned_reason: reason || null });
    await emit(client, {
      key: EVENTS.PLAN_RETURNED,
      entity: { type: "performance_plan", id: planId },
      actor: null,
      payload: {
        performance_plan_id: planId,
        department: plan.department,
        reason,
        submitted_by_employee_id: await employeeOfUser(client, plan.submitted_by),
      },
    });
    return "returned";
  });
}

/** Settle a target change: apply it on approval, record the refusal otherwise. */
async function settleChange(changeId, { state }) {
  return tx(async (client) => {
    const change = await repo.getChangeRow(client, changeId);
    if (!change || change.status !== "pending") return null;
    const approved = state === "approved" || state === "timeout_approved";
    if (approved) {
      const target = { target_value: change.to_value ?? null, target_text: change.to_text ?? null };
      if (change.okr_key_result_id) {
        await repo.updateKeyResult(client, change.okr_key_result_id, { ...target, target_provisional: false });
        await require("./goals.okrs").rescoreFrom(client, change.okr_key_result_id, change.from_month);
      } else {
        await require("../targets/targets.service").applyTargetChange(client, { ...change, ...target });
      }
    }
    await repo.updateChange(client, changeId, { status: approved ? "approved" : "rejected", decided_at: new Date() });
    await emit(client, {
      key: EVENTS.TARGET_CHANGE_DECIDED,
      entity: { type: "target_change", id: changeId },
      actor: null,
      payload: {
        target_change_id: changeId,
        status: approved ? "approved" : "rejected",
        okr_key_result_id: change.okr_key_result_id,
        employee_target_id: change.employee_target_id,
        label: `New target ${change.to_text || change.to_value} from ${String(change.from_month).slice(0, 7)}`,
        requested_by_employee_id: await employeeOfUser(client, change.requested_by),
      },
    });
    return approved ? "approved" : "rejected";
  });
}

/**
 * Settle a request to unbind a plan: approved, the plan is unbound; refused, it stays as it is. A plan
 * that is no longer binding when the CEO approves (it was reset meanwhile) has nothing to unbind: the
 * request is closed refused, saying so. Either way the request keeps the decision, and its sender is told.
 */
async function settleUnbind(unbindId, { state, reason = null }) {
  return tx(async (client) => {
    const request = await repo.getUnbindRow(client, unbindId);
    if (!request || request.status !== "pending") return null;
    const plan = await repo.getPlan(client, request.performance_plan_id);
    const unbound = isApproved(state) && Boolean(plan) && plan.status === "binding";
    if (unbound) await repo.updatePlan(client, plan.performance_plan_id, { status: "unbound", returned_reason: null });
    const why = unbound ? null : isApproved(state) ? "The plan is no longer binding" : reason;
    await repo.updateUnbind(client, unbindId, { status: unbound ? "approved" : "rejected", decided_at: new Date(), decision_reason: why });
    await emit(client, {
      key: EVENTS.PLAN_UNBIND_DECIDED,
      entity: { type: "plan_unbind", id: unbindId },
      actor: null,
      payload: {
        plan_unbind_id: unbindId,
        performance_plan_id: request.performance_plan_id,
        status: unbound ? "approved" : "rejected",
        department: plan ? plan.department : null,
        period: plan ? plan.period_name : null,
        reason: why,
        requested_by_employee_id: await employeeOfUser(client, request.requested_by),
      },
    });
    return unbound ? "approved" : "rejected";
  });
}

/**
 * Settle an unbound plan's changes: approved, the plan is binding again (its first approval date
 * stays); returned, it is unbound with the reason, for its head to change and send again.
 */
async function settleRevision(planId, { state, reason = null }) {
  return tx(async (client) => {
    const plan = await repo.getPlan(client, planId);
    if (!plan || plan.status !== "revising") return null;
    const approved = isApproved(state);
    await repo.updatePlan(client, planId, approved ? { status: "binding", returned_reason: null } : { status: "unbound", returned_reason: reason || null });
    await emit(client, {
      key: approved ? EVENTS.PLAN_REVISED : EVENTS.PLAN_REVISION_RETURNED,
      entity: { type: "performance_plan", id: planId },
      actor: null,
      payload: {
        performance_plan_id: planId,
        department: plan.department,
        period: plan.period_name,
        reason,
        submitted_by_employee_id: await employeeOfUser(client, plan.submitted_by),
      },
    });
    return approved ? "binding" : "unbound";
  });
}

// A plan, or a mid-quarter scorecard sent on its own as an amendment of its plan (§11).
workflow.onCompleted(PLAN_FLOW, "goals.settle_plan", (event) =>
  event.entity.type === "scorecard"
    ? require("../targets/targets.service").settleAmendment(event.entity.id, {
        state: event.payload.state,
        reason: event.payload.reason || null,
        opened_by: event.payload.opened_by || null,
      })
    : settlePlan(event.entity.id, { state: event.payload.state, reason: event.payload.reason || null }),
);

workflow.onCompleted(CHANGE_FLOW, "goals.settle_target_change", (event) =>
  settleChange(event.entity.id, { state: event.payload.state }),
);

// A request to unbind a plan, or the changes made to the plan once it is unbound (§6.22).
workflow.onCompleted(PLAN_CHANGE_FLOW, "goals.settle_plan_change", (event) => {
  const outcome = { state: event.payload.state, reason: event.payload.reason || null };
  return event.entity.type === "plan_unbind" ? settleUnbind(event.entity.id, outcome) : settleRevision(event.entity.id, outcome);
});

module.exports = { PLAN_FLOW, CHANGE_FLOW, PLAN_CHANGE_FLOW, settlePlan, settleChange, settleUnbind, settleRevision };

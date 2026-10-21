"use strict";
/**
 * The `performance.goal` approval (A16; docs/guides/performance.md §6 "The approval route"):
 * Management, then Operations & People, then the CEO, whose approval alone makes a goal,
 * or a department's month of targets and KPIs, binding.
 *
 * Shared by annual and monthly goals (entity `goal`) and a department's month (entity
 * `performance_plan`, the targets module). Return is the engine's reject: the request
 * closes and the record goes back to `returned` with the reason in its trail; submitting
 * again opens a new request.
 *
 *   submit()    opens the request inside the caller's transaction
 *   decide()    approve or return the current stage; answers the record's new status
 *   view()      the route, decisions and can_decide for the record's screen
 *   statusFor() the record status an engine state means
 */
const engine = require("../../shared/workflow/engine");

const DEFINITION_KEY = "performance.goal";

/** What a finished request means for the record it approved. */
const OUTCOME = Object.freeze({
  pending: "pending_approval",
  approved: "active",
  timeout_approved: "active",
  rejected: "returned",
  timeout_rejected: "returned",
  cancelled: "draft",
});

const statusFor = (state) => OUTCOME[state] || null;

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{entity: {type: string, id: string}, actor: object}} opts
 * @returns {Promise<object>} the instance
 */
function submit(client, { entity, actor }) {
  return engine.openInstance(client, {
    definition_key: DEFINITION_KEY,
    entity,
    subject_employee_id: actor.employee_id || null,
    context: {},
    actor,
  });
}

/**
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{instance_id: string, actor: object, decision: "approve"|"return", reason?: string|null}} opts
 * @returns {Promise<object>} the instance after the decision
 */
function decide(client, { instance_id: id, actor, decision, reason = null }) {
  return engine.act(client, {
    instance_id: id,
    actor,
    decision: decision === "return" ? "reject" : "approve",
    reason,
  });
}

/** The route, decisions and whether the caller may decide, for a record's screen. */
async function view(client, instanceId, actor) {
  const workflow = require("../workflow/workflow.service");
  const v = await workflow.approvalOf(client, instanceId, actor);
  if (!v) return { route: [], decisions: [], can_decide: false, waiting_on: null };
  return {
    route: v.route,
    decisions: v.decisions,
    can_decide: v.can_decide,
    waiting_on: v.state === "pending" ? v.stage_name : null,
  };
}

module.exports = { DEFINITION_KEY, OUTCOME, statusFor, submit, decide, view };

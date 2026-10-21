"use strict";
/**
 * What the goals module records, and who it tells (docs/guides/performance.md §7).
 *
 * The approval engine tells each stage's approvers when a goal reaches them. This file
 * tells the goal's owner how it ended, and applies the outcome of a request that ended
 * without a decision on the goal's own screen (a stage that timed out, a request withdrawn
 * from My Approvals). Plans (a department's month) are settled by the targets module.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const workflow = require("../../shared/workflow/engine");
const outbox = require("../../shared/events/outbox");
const { DEFINITION_KEY } = require("./goals.approval");

const EVENTS = defineEvents("performance", {
  "goal.created": { summary: "A goal or target was set" },
  "goal.edited": { summary: "A goal was changed" },
  "goal.submitted": { summary: "A goal was sent for approval" },
  "goal.approved": { summary: "A goal was approved and is binding" },
  "goal.returned": { summary: "A goal was returned to its owner" },
});

/** The owner's login, when it is not the person who acted. */
async function ownerLogin(e, client) {
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = $1 AND status = 'active'",
    [e.payload.owner_employee_id],
  );
  return rows.map((r) => r.user_id);
}

defineNotification(EVENTS.GOAL_APPROVED, {
  to: [{ users: ownerLogin }],
  title: (e) => `Approved: ${e.payload.code || e.payload.title}`,
  body: (e) => e.payload.title,
});

defineNotification(EVENTS.GOAL_RETURNED, {
  to: [{ users: ownerLogin }],
  title: (e) => `Returned: ${e.payload.code || e.payload.title}`,
  body: (e) => e.payload.reason || e.payload.title,
});

/*
 * The service is required when a handler runs: it requires this file for its keys.
 */
const settle = (id, state) => require("./goals.service").settle(id, state);

workflow.onCompleted(DEFINITION_KEY, "goals.apply_decision", async (event) => {
  if (event.entity.type !== "goal") return;
  await settle(event.entity.id, event.payload.state);
});

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "goals.apply_withdrawal", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY || event.entity.type !== "goal") return;
  await settle(event.entity.id, "cancelled");
});

module.exports = { EVENTS };

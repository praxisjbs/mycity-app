"use strict";
/**
 * What the goals module records, and who it tells (docs/guides/performance.md §7).
 *
 * Quarters, organisational goals, the OKR tree, monthly reports, plans and target changes. The
 * approval engine tells each stage of a plan, an unbind request or a target change itself; this tells
 * the people a decision concerns: a binding plan's employees and reviewers that their scorecard is
 * ready to agree, a returned plan's sender, an unbound plan's sender of its changes, and the requester
 * of an unbind request or a target change.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { loginsOf } = require("../tasks/tasks.events");

const EVENTS = defineEvents("performance", {
  "period.created": { summary: "A quarter was set up, with the last quarter's rules" },
  "period.changed": { summary: "A quarter's dates, rules or status were changed" },
  "organisational_goal.saved": { summary: "An organisational goal was recorded or changed" },
  "organisational_goal.deleted": { summary: "An organisational goal no company objective served was removed" },
  "objective.saved": { summary: "An objective was set or changed" },
  "objective.deleted": { summary: "A draft objective was removed" },
  "key_result.saved": { summary: "A key result was set or changed" },
  "key_result.deleted": { summary: "A draft key result was removed" },
  "key_result.reported": { summary: "A key result's month was reported" },
  "key_result.score_confirmed": { summary: "The CEO confirmed a key result's monthly score" },
  "plan.submitted": { summary: "A quarter plan was sent for approval" },
  "plan.binding": { summary: "A quarter plan was approved and is binding" },
  "plan.returned": { summary: "A quarter plan was returned for changes" },
  "plan.reopened": { summary: "A quarter plan went back to draft when the import of its objectives was reverted" },
  "plan.revision_submitted": { summary: "An unbound plan's changes were sent to the CEO" },
  "plan.revised": { summary: "An unbound plan's changes were approved and the plan is binding again" },
  "plan.revision_returned": { summary: "An unbound plan's changes were returned, and the plan stays unbound" },
  "plan_unbind.requested": { summary: "A request to unbind a binding plan was made" },
  "plan_unbind.decided": { summary: "A request to unbind a binding plan was approved or refused" },
  "target_change.requested": { summary: "A change to a binding target was asked for" },
  "target_change.decided": { summary: "A target change was approved or refused" },
  "analytics.export_requested": { summary: "Performance Analytics' people table was asked for as a workbook" },
});

defineNotification(EVENTS.PLAN_BINDING, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.agree_employee_ids || []) }],
  title: (e) => `Your ${e.payload.period || ""} scorecard is ready to agree`.replace("  ", " "),
  body: (e) => `The ${e.payload.department || "company"} plan is approved.`,
  include_actor: true,
});

defineNotification(EVENTS.PLAN_RETURNED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.submitted_by_employee_id]) }],
  title: (e) => `The ${e.payload.department || "company"} plan needs changes`,
  body: (e) => e.payload.reason || "",
  include_actor: true,
});

defineNotification(EVENTS.PLAN_UNBIND_DECIDED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.requested_by_employee_id]) }],
  title: (e) => (e.payload.status === "approved" ? "Unbind request approved" : "Unbind request refused"),
  body: (e) =>
    e.payload.status === "approved" ? `The ${e.payload.department || "company"} plan is open for changes.` : e.payload.reason || "",
  include_actor: true,
});

defineNotification(EVENTS.PLAN_REVISED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.submitted_by_employee_id]) }],
  title: (e) => `The ${e.payload.department || "company"} plan is binding`,
  body: () => "The CEO approved your changes.",
  include_actor: true,
});

defineNotification(EVENTS.PLAN_REVISION_RETURNED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.submitted_by_employee_id]) }],
  title: (e) => `The ${e.payload.department || "company"} plan needs changes`,
  body: (e) => e.payload.reason || "",
  include_actor: true,
});

defineNotification(EVENTS.TARGET_CHANGE_DECIDED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.requested_by_employee_id]) }],
  title: (e) => (e.payload.status === "approved" ? "Target change approved" : "Target change refused"),
  body: (e) => e.payload.label || "",
  include_actor: true,
});

module.exports = { EVENTS };

// The plan's and the target change's outcomes, and the Analytics export, registered with the worker's
// outbox here because the worker loads each module's events file (src/worker.js).
require("./goals.approval");
require("./goals.analytics");

"use strict";
/**
 * What the targets module records, and who it tells (docs/guides/performance.md §7).
 *
 * A department's month goes through `performance.goal` as one plan. The engine tells each
 * stage's approvers; this file tells the department's head how it ended, tells each person
 * "Your KPIs for October are set" once the CEO has approved it (`kpis.dispatched`), and applies
 * the outcome of a request that ended away from the Targets screen.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const workflow = require("../../shared/workflow/engine");
const outbox = require("../../shared/events/outbox");
const { DEFINITION_KEY } = require("../goals/goals.approval");

const EVENTS = defineEvents("performance", {
  "plan.submitted": { summary: "A department's month was sent for approval" },
  "plan.approved": { summary: "A department's month was approved and is binding" },
  "plan.returned": { summary: "A department's month was returned" },
  "kpis.dispatched": { summary: "Someone's KPIs for the month were set" },
  "kpi.progress_changed": { summary: "A KPI's progress was recounted" },
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m) => (m ? MONTHS[Number(m.slice(5, 7)) - 1] : "the month");

async function loginsOf(client, employeeIds) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = ANY($1::uuid[]) AND status = 'active'",
    [ids],
  );
  return rows.map((r) => r.user_id);
}

/** Whoever submitted the month hears how it ended. */
const submitter = async (e) => (e.payload.submitted_by ? [e.payload.submitted_by] : []);

defineNotification(EVENTS.PLAN_APPROVED, {
  to: [{ users: submitter }],
  title: (e) => `${monthName(e.payload.month)} approved: ${e.payload.department}`,
  body: () => "Targets and KPIs are binding",
});

defineNotification(EVENTS.PLAN_RETURNED, {
  to: [{ users: submitter }],
  title: (e) => `${monthName(e.payload.month)} returned: ${e.payload.department}`,
  body: (e) => e.payload.reason || "",
});

defineNotification(EVENTS.KPIS_DISPATCHED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: (e) => `Your KPIs for ${monthName(e.payload.month)} are set`,
  body: (e) => `${e.payload.kpis} KPI${e.payload.kpis === 1 ? "" : "s"}`,
  include_actor: true,
});

const service = () => require("./targets.service");

workflow.onCompleted(DEFINITION_KEY, "targets.apply_decision", async (event) => {
  if (event.entity.type !== "performance_plan") return;
  await service().settle(event.entity.id, event.payload.state);
});

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "targets.apply_withdrawal", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY || event.entity.type !== "performance_plan") return;
  await service().settle(event.entity.id, "cancelled");
});

outbox.register(EVENTS.PLAN_APPROVED, "targets.dispatch_kpis", async (event) => {
  await service().dispatch(event.entity.id);
});

module.exports = { EVENTS, loginsOf };

// Done tasks recount the KPIs they count towards.
require("./targets.progress");

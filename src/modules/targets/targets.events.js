"use strict";
/**
 * What the scorecards module records, and who it tells (docs/guides/performance.md §7).
 *
 * Agreement tells the other party; a disagreement tells the reviewer. A scorecard ready to agree
 * is told when its plan binds (goals.approval.js), and asked again each working day from 3
 * business days after binding until both sides agree (§6.6). The person who acted is never told
 * (fanout).
 *
 * Commitments (§6.11, PR 4): a month sent, approved or returned tells its person (the approver
 * hears from the engine); a rescope's outcome tells its person; the person with no month sent is
 * asked on the 2nd business day (`commitments_due`). The outcome of `performance.commitments`,
 * for a set or a rescope, is settled after commit by targets.commitments.js; Export Report's file
 * is made here, in the worker.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");
const { completeQuery } = require("../../shared/http/paged");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const reminders = require("../notifications/notifications.reminders");
const { loginsOf } = require("../tasks/tasks.events");

const EVENTS = defineEvents("performance", {
  "scorecard.created": { summary: "A scorecard was drafted" },
  "scorecard.lines_saved": { summary: "A scorecard's lines were saved" },
  "scorecard.updated": { summary: "A scorecard's scope, reviewer or dotted manager was changed" },
  "scorecard.agreed": { summary: "The employee or the reviewer agreed a scorecard" },
  "scorecard.disagreed": { summary: "The employee or the reviewer disagreed with a scorecard" },
  "scorecard.agree_due": { summary: "A binding scorecard is still waiting for an agreement" },
  "scorecard.bound": { summary: "A scorecard became binding with its function's plan" },
  "scorecard.line_target_changed": { summary: "A scorecard line's target changed on an approved target change" },
  "scorecard.sent": { summary: "A scorecard drafted after its plan bound was sent for approval on its own" },
  "scorecard.amendment_decided": { summary: "A scorecard sent on its own was approved or returned" },
  "scorecard.closed": { summary: "A leaver's scorecard closed: no round reviews it again" },
  "commitments.submitted": { summary: "A person's commitments for a month were sent for approval" },
  "commitments.approved": { summary: "A person's commitments for a month were approved" },
  "commitments.returned": { summary: "A person's commitments for a month were returned with a reason" },
  "commitments.due": { summary: "A person has not sent their commitments for the month" },
  "commitments.report_requested": { summary: "A month-end delivery report was asked for" },
  "commitment.rescope_requested": { summary: "A rescope of an approved commitment was asked for" },
  "commitment.rescoped": { summary: "A commitment was rescoped on approval" },
  "commitment.rescope_refused": { summary: "A rescope of a commitment was refused" },
  "commitment.recovery_set": { summary: "A recovery owner and date were set for a missed commitment" },
});

defineNotification(EVENTS.SCORECARD_AMENDMENT_DECIDED, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.tell_employee_ids || []) }],
  who: "The employee and the reviewer on approval; the sender on a return",
  title: (e) => (e.payload.approved ? `Your ${e.payload.period || ""} scorecard is ready to agree`.replace("  ", " ") : e.payload.employee_name ? `${e.payload.employee_name}'s scorecard needs changes` : "A scorecard needs changes"),
  body: (e) => (e.payload.approved ? "It was approved." : e.payload.reason || ""),
  include_actor: true,
});

defineNotification(EVENTS.SCORECARD_AGREED, {
  to: [
    {
      users: (e, client) =>
        loginsOf(client, [e.payload.by === "employee" ? e.payload.reviewer_employee_id : e.payload.employee_id]),
    },
  ],
  title: (e) => (e.payload.agreed ? `${e.payload.period || "The"} scorecard is agreed` : "A scorecard was agreed"),
  body: (e) => (e.payload.by === "employee" ? "The employee agreed it." : "The reviewer agreed it."),
});

defineNotification(EVENTS.SCORECARD_DISAGREED, {
  to: [
    {
      // The employee's disagreement tells the reviewer: the person, or a reviewing role's holders.
      users: (e, client) =>
        loginsOf(
          client,
          e.payload.by === "employee"
            ? e.payload.reviewer_employee_ids || [e.payload.reviewer_employee_id].filter(Boolean)
            : [e.payload.employee_id],
        ),
    },
  ],
  title: "A scorecard was disagreed",
  body: (e) => e.payload.reason || "",
});

defineNotification(EVENTS.SCORECARD_AGREE_DUE, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.waiting_employee_ids || []) }],
  who: "The employee and the reviewer, whoever has not agreed",
  title: "Agree your scorecard",
  body: (e) => `${e.payload.employee_name}'s scorecard for ${e.payload.period} is waiting for your agreement.`,
});

/* ------------------------------------------------------------------ *
 * Commitments (§6.11)
 * ------------------------------------------------------------------ */

defineNotification(EVENTS.COMMITMENTS_SUBMITTED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  who: "The person, when their manager sent their commitments",
  title: "Your commitments were sent",
  body: (e) => `${e.payload.count} for ${e.payload.month_label} went for approval.`,
});

defineNotification(EVENTS.COMMITMENTS_APPROVED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: "Your commitments are approved",
  body: (e) => `${e.payload.month_label}: their dates are now fixed.`,
});

defineNotification(EVENTS.COMMITMENTS_RETURNED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: "Your commitments came back",
  body: (e) => e.payload.reason || "",
});

defineNotification(EVENTS.COMMITMENTS_DUE, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  who: "Each person with no commitments sent for the month",
  title: "Send your commitments",
  body: (e) => `Your commitments for ${e.payload.month_label} are due by ${e.payload.due_label}.`,
});

defineNotification(EVENTS.COMMITMENT_RESCOPED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: "Commitment rescoped",
  body: (e) => e.payload.title || "",
});

defineNotification(EVENTS.COMMITMENT_RESCOPE_REFUSED, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.employee_id]) }],
  title: "Rescope not approved",
  body: (e) => e.payload.reason || e.payload.title || "",
});

/** Export Report's file (shared/documents/exports). */
const REPORT_DOC_TYPE = "commitments_report";

defineDocumentType(REPORT_DOC_TYPE, {
  label: "Month-end delivery report",
  module: "performance",
  sensitivity: "restricted",
  export: true,
});

outbox.register(EVENTS.COMMITMENTS_REPORT_REQUESTED, "performance.build_commitments_report", (event, ctx) =>
  require("./targets.commitments").buildReport(event, ctx),
);

workflow.onCompleted("performance.commitments", "performance.settle_commitments", (event) =>
  require("./targets.commitments").settle(event.entity, {
    state: event.payload.state,
    reason: event.payload.reason || null,
    instance_id: event.payload.instance_id,
  }),
);

// A withdrawn set goes back to draft; a withdrawn rescope is as if it was never asked.
outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "performance.withdraw_commitments", async (event) => {
  if (event.payload.definition_key !== "performance.commitments") return;
  await require("./targets.commitments").settle(event.entity, {
    state: "cancelled",
    reason: event.payload.reason || null,
    instance_id: event.payload.instance_id,
  });
});

/** The reminder that asks for the month's commitments (§7). */
const COMMITMENTS_REMINDER = "commitments_due";

reminders.defineReminder(COMMITMENTS_REMINDER, {
  event: EVENTS.COMMITMENTS_DUE,
  module: "performance",
  // From 09:00 Lagos on the 2nd business day until the 3rd ends: each active person with a login
  // and nothing sent or approved for the month, once.
  find: async (client, { now }) => {
    const cal = await workingWeek.loadCalendar(client);
    const today = lagos.today(now);
    const month = today.slice(0, 7);
    const second = workingWeek.nthBusinessDay(month, 2, cal);
    const third = workingWeek.nthBusinessDay(month, 3, cal);
    if (today < second || today > third || (today === second && lagos.timeOf(now) < "09:00")) return [];
    // pagination:complete the staff a reminder is found for: one occurrence each, once a month
    const { rows } = await completeQuery(
      client,
      `SELECT e.employee_id FROM employee e
        WHERE e.status = 'active'
          AND EXISTS (SELECT 1 FROM app_user u WHERE u.employee_id = e.employee_id AND u.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM commitment_set cs WHERE cs.employee_id = e.employee_id
                           AND cs.month = $1 AND cs.status IN ('submitted', 'approved'))
        ORDER BY e.employee_id`,
      [`${month}-01`],
      { label: "people with no commitments sent", ceiling: 2000 },
    );
    return rows.map((r) => ({
      entity_type: "employee",
      entity_id: r.employee_id,
      occurrence: month,
      due_at: lagos.instant(second, "09:00"),
      work_hours: true,
      payload: { month: `${month}-01`, due_on: third },
    }));
  },
  check: (client, row) => require("./targets.commitments").dueCheck(client, row),
});

/** The reminder's key: scheduled when a plan binds, ended once both sides agree. */
const AGREE_REMINDER = "scorecard_agree_due";

/*
 * The agreement reminder (guide §6.6) runs on the one reminder engine
 * (docs/guides/notifications.md §7.1). The service is required when the engine calls it: it
 * requires this file for its event keys.
 */
reminders.defineReminder(AGREE_REMINDER, {
  event: EVENTS.SCORECARD_AGREE_DUE,
  module: "performance",
  check: (client, row) => require("./targets.service").agreementCheck(client, row),
});

module.exports = { EVENTS, AGREE_REMINDER, COMMITMENTS_REMINDER, REPORT_DOC_TYPE };

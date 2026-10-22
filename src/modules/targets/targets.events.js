"use strict";
/**
 * What the scorecards module records, and who it tells (docs/guides/performance.md §7).
 *
 * Agreement tells the other party; a disagreement tells the reviewer. A scorecard ready to agree
 * is told when its plan binds (goals.approval.js), and asked again each working day from 3
 * business days after binding until both sides agree (§6.6). The person who acted is never told
 * (fanout).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
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

module.exports = { EVENTS, AGREE_REMINDER };

"use strict";
/**
 * The workflow module's own events. The engine declares and notifies its moves
 * (workflow.opened, advanced, completed, changes_requested, escalated, cancelled;
 * shared/events/catalogue.js and shared/notifications/fanout.js). What is left to
 * this module is what Settings and Operations & People do around it:
 *
 *   workflow.definition_created a flow made on screen, saved as version 1 (audit only)
 *   workflow.definition_saved   a flow's stages saved as a new version (audit only)
 *   workflow.reassigned         a stage given to someone else; they are told
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("settings", {
  "workflow.definition_created": { summary: "An approval flow was made" },
  "workflow.definition_saved": { summary: "An approval flow was saved as a new version" },
  "workflow.reassigned": { summary: "An approval stage was given to someone else" },
});

defineNotification(EVENTS.WORKFLOW_REASSIGNED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${e.payload.definition_name || "A request"}`,
  body: (e) => `${e.payload.stage_name || "A stage"} is now waiting on you.`,
  copy: { body: (e) => `${e.payload.stage_name || "A stage"} was given to someone else.` },
});

module.exports = { EVENTS };

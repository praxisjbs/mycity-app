"use strict";
/**
 * What the partner_pipeline module records (docs/guides/partnerships.md §7). Loaded by the API
 * (through the service) and the worker.
 *
 * Categories and their lists (M7 PR 2):
 *   category.*              a category, its agreement templates and its delivery checklist
 *   partnership_field.*     a custom field for leads, partners or deals
 *   list_value.*            a stage, impact, source or document kind of MyCity's lists
 *   partnership_setup.*     Start From Tracker applied
 *
 * Deals (M7 PR 3):
 *   deal.created          New Deal, or a lead's or partner's first deal
 *   deal.updated          Edit Deal: its terms, options, team, dates or custom values
 *   deal.stage_changed    the stage switcher, Close as Lost, Close Partner or a conversion
 *   deal.health_changed   Set Health (Stalled carries its blockers)
 *   deal.signed           a deal entered a signed meaning: a lead's converts in the same transaction
 *   deal.lost             a deal entered Closed Lost
 *   deal_return.saved     Enter Returns, a month at a time, or the Partnership Returns import (money: partnerships.money)
 *   deal_return.removed   a month the Partnership Returns import made, its import reverted
 *
 * Work on signing (M7 PR 5, §6.7, §6.16), outbox handlers after the change commits:
 *   partner_pipeline.deliverables   deal.signed: the category's delivery checklist raised as tasks
 *                                   (deal.deliverables_raised), never for an import or "signed
 *                                   before the hub"
 *   partner_pipeline.event_days     deal.signed, deal.updated, deal.stage_changed, deal.lost: the
 *                                   deal's event days on its team's calendar, moved and called off
 *                                   with the deal
 * The morning's follow-up (§6.12, the partner-inactivity scheduler): follow_up.raised
 *
 * Payloads carry ids, numbers and codes, never money or a contact's details. Who is told about
 * which (the owner when someone else moved a deal, the owner's Head of Department on Stalled) is
 * declared with the module's views and notification types (§7, M7 PR 8).
 *
 * A deal's venue is picked, never typed (F27), and kept as a place row by this module (owner
 * deal.venue). The deal keeps no copy of its line: the deal and its calendar event read it through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const places = require("../../shared/places/owners");

const EVENTS = defineEvents("partnerships", {
  "category.created": { summary: "A partnership category was added" },
  "category.updated": { summary: "A partnership category was changed, retired or restored" },
  "category.template_added": { summary: "An agreement template was added to a category" },
  "category.template_updated": { summary: "A category's agreement template was changed, retired or made the default" },
  "category.template_saved": { summary: "An agreement template's wording was saved as its next version" },
  "category.checklist_item_added": { summary: "A delivery checklist item was added to a category" },
  "category.checklist_item_updated": { summary: "A delivery checklist item was changed, moved or retired" },
  "partnership_field.created": { summary: "A custom field was added" },
  "partnership_field.updated": { summary: "A custom field was changed, retired or restored" },
  "list_value.created": { summary: "A value was added to one of the partnership lists" },
  "list_value.updated": { summary: "A value of the partnership lists was changed, retired or restored" },
  "partnership_setup.applied": { summary: "The partnership lists were set up from MyCity's tracker" },
  "deal.created": { summary: "A partnership deal was opened" },
  "deal.updated": { summary: "A partnership deal was changed" },
  "deal.stage_changed": { summary: "A partnership deal moved stage" },
  "deal.health_changed": { summary: "A partnership deal's health was set" },
  "deal.signed": { summary: "A partnership deal was signed" },
  "deal.lost": { summary: "A partnership deal was closed as lost" },
  "deal.completed": { summary: "A signed deal ran past its validity and its event, and was completed" },
  "deal.deliverables_raised": { summary: "A signed deal's delivery checklist was raised as tasks" },
  "follow_up.raised": { summary: "A quiet partner or lead was followed up: its deals Follow-Up Required, a task for its owner" },
  "deal_return.saved": { summary: "A month of a deal's returns was entered" },
  "deal_return.removed": { summary: "A month of a deal's returns was removed by reverting its import" },
});

places.owner("deal.venue", { rename: async () => {} });

// Work on signing, after the change commits (§6.7, §6.16). Required when called, so loading the
// catalogue never loads the services.
const deliverables = (event) => require("./partner_pipeline.deliverables").raise(event);
const daysSigned = (event) => require("./partner_pipeline.calendar").onSigned(event);
const daysUpdated = (event) => require("./partner_pipeline.calendar").onUpdated(event);
const daysMoved = (event) => require("./partner_pipeline.calendar").onMoved(event);
outbox.register(EVENTS.DEAL_SIGNED, "partner_pipeline.deliverables", deliverables);
outbox.register(EVENTS.DEAL_SIGNED, "partner_pipeline.event_days", daysSigned);
outbox.register(EVENTS.DEAL_UPDATED, "partner_pipeline.event_days", daysUpdated);
outbox.register(EVENTS.DEAL_STAGE_CHANGED, "partner_pipeline.event_days", daysMoved);
outbox.register(EVENTS.DEAL_LOST, "partner_pipeline.event_days", daysMoved);

/* ------------------------------------------------------------------ *
 * Who is told (§7). Settings · Notifications lists each under Partnerships.
 * ------------------------------------------------------------------ */

/** The active logins of these employees. */
async function usersOf(db, employeeIds) {
  const ids = employeeIds.filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await db.query("SELECT user_id FROM app_user WHERE employee_id = ANY($1::uuid[]) AND status = 'active' ORDER BY user_id", [ids]);
  return rows.map((r) => r.user_id);
}

/** A deal's owner, from the event's payload. */
const dealOwner = (e, db) => usersOf(db, [e.payload.owner_id]);

/** The Head of Department of the deal owner's department. */
async function ownersHead(e, db) {
  if (!e.payload.owner_id) return [];
  const { rows } = await db.query(
    "SELECT d.head_employee_id FROM employee e JOIN department d ON d.department_id = e.department_id WHERE e.employee_id = $1 AND d.head_employee_id IS DISTINCT FROM e.employee_id",
    [e.payload.owner_id],
  );
  return usersOf(db, rows.map((r) => r.head_employee_id));
}

// The owner, when someone else moved their deal by hand (the actor is never told of their own move).
defineNotification(EVENTS.DEAL_STAGE_CHANGED, {
  to: [{ users: (e, db) => (e.payload.source === "person" ? dealOwner(e, db) : []) }],
  title: "Deal Moved",
  body: (e) => `${e.payload.number} ${e.payload.title || ""} moved to ${e.payload.to_label || e.payload.to}.`.replace(/\s+/g, " "),
  who: "The deal's owner, when someone else moved it",
});

// Stalled tells the owner's Head of Department, with what is in the way.
defineNotification(EVENTS.DEAL_HEALTH_CHANGED, {
  to: [{ users: (e, db) => (e.payload.to === "stalled" ? ownersHead(e, db) : []) }],
  title: "Deal Stalled",
  body: (e) => `${e.payload.number} ${e.payload.title || ""} is stalled: ${e.payload.blockers || "no blockers given"}`.replace(/\s+/g, " "),
  priority: "high",
  who: "The Head of Department of the deal's owner",
});

module.exports = { EVENTS, usersOf };

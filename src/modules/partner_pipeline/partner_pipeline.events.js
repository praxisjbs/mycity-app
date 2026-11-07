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
 * Payloads carry ids, numbers and codes, never money or a contact's details. Who is told about
 * which (the owner when someone else moved a deal, the owner's Head of Department on Stalled) is
 * declared with the module's views and notification types (§7, M7 PR 8).
 *
 * A deal's venue is picked, never typed (F27), and kept as a place row by this module (owner
 * deal.venue). The deal keeps no copy of its line: the deal and its calendar event read it through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const { defineEvents } = require("../../shared/events/catalogue");
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
  "deal_return.saved": { summary: "A month of a deal's returns was entered" },
  "deal_return.removed": { summary: "A month of a deal's returns was removed by reverting its import" },
});

places.owner("deal.venue", { rename: async () => {} });

module.exports = { EVENTS };

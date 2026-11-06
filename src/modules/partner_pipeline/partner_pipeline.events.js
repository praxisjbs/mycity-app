"use strict";
/**
 * What the partner_pipeline module records (docs/guides/partnerships.md §7). Categories and their lists
 * are written in M7 PR 2; deals arrive with PR 3 and their event keys with them.
 *
 *   category.*              a category, its agreement templates and its delivery checklist
 *   partnership_field.*     a custom field for leads, partners or deals
 *   list_value.*            a stage, impact, source or document kind of MyCity's lists
 *   partnership_setup.*     Start From Tracker applied
 *
 * A deal's venue is picked, never typed (F27), and kept as a place row by this module (owner
 * deal.venue). The deal keeps no copy of its line: the deal and its calendar event read it through
 * places.view, so a place named by the places-name job has nothing else to rewrite.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");

places.owner("deal.venue", { rename: async () => {} });

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
});

module.exports = { EVENTS };

"use strict";
/**
 * What the assistant may do about partnership categories (docs/guides/partnerships.md §9): it sends the
 * person to Categories to set one up. Categories, their templates, checklists, custom fields, MyCity's
 * lists and Start From Tracker are designed on their screen with the whole set in view (praxis-ai.md
 * decision 33's design word), so none is a card. A deal's forms and a month's returns share this contract
 * file and so are accounted for here until M7 PR 8 declares their cards, with the deals' reads (§9).
 */
const { defineManifest } = require("../../shared/ai/manifest");

module.exports = defineManifest({
  module: "partnerships",
  not_offered: {
    CategoryCreate: "design: a category is set up on Categories with its defaults, templates, checklist and fields in view",
    CategoryUpdate: "design: a category's defaults, retiring and restoring are made on Categories with what it holds in view",
    CategoryTemplateCreate: "design: an agreement template is written in the template editor with its fields beside the wording",
    CategoryTemplateUpdate: "design: which template is the default, and retiring one, is decided on Categories with the others in view",
    TemplateWordingSave: "design: an agreement's wording is edited in the template editor, never from the chat",
    ChecklistItemCreate: "design: a delivery checklist is ordered on Categories with every item in view",
    ChecklistItemUpdate: "design: a checklist item is moved and retired on Categories with the whole checklist in view",
    FieldCreate: "design: a custom field is defined on Categories with the category's other fields in view",
    FieldUpdate: "design: a custom field is changed and retired on Categories with the category's other fields in view",
    ListValueCreate: "design: the pipeline's stages and lists are arranged on Categories with the whole list in view",
    ListValueUpdate: "design: a stage's meaning, order and retiring are changed on Categories with the whole list in view",
    DealCreate: "design: until M7 PR 8 declares deals.create, a deal is created on a lead or a partner with its options, team and dates in view",
    DealUpdate: "design: until M7 PR 8 declares deals.update, a deal is changed on its 360 with its options, team and dates in view",
    ReturnSave: "design: until M7 PR 8 declares deal_returns.save, a month's returns are entered on the partner's 360 beside the year's figures",
  },
  routes: [{ intent: "set up a category", screen: "partnerships.categories" }],
});

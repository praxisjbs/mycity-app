"use strict";
/**
 * What the assistant may read and do about deals (docs/guides/partnerships.md §9): the deals the
 * asker may see, a page of 25 at a time, one deal whole (money left out without
 * `partnerships.money`), and the categories a lead or partner is filed under, by the rule the
 * screens keep (§6.1); and, as cards the person confirms (docs/guides/praxis-ai.md §6.11, decision
 * 33), New Deal, Edit Deal, the stage switcher, Set Health and Enter Returns, each through the
 * screen's own service function.
 *
 * A move into a signed stage needs the signed copy, a file, so its card sends the person to the
 * deal's 360. Categories, their templates, checklists and custom fields, MyCity's lists and Start
 * From Tracker are designed on Categories with the whole set in view (praxis-ai.md decision 33's
 * design word), never in the chat; the assistant sends the person there.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const service = require("./partner_pipeline.service");
const stages = require("./partner_pipeline.stages");
const health = require("./partner_pipeline.health");
const returns = require("./partner_pipeline.returns");
const lists = require("./partner_pipeline.lists");

const link = (d) => (routeMap.linkFor(d.partner_id ? "partner" : "lead", d.partner_id || d.lead_id) || {}).path || null;
/** The deal a card made or changed, read back as a line that opens its record's 360. */
const dealLine = (status) => (d) => [{ type: "partner_deal", id: d.deal_id, label: `${d.number} ${d.title}`, status, link: link(d) }];
const cite = (row) => ({ type: "partner_deal", id: row.deal_id, label: row.title });
const names = (values, _actor, db) => service.cardNames(db, values);
const whichDeal = { field: "deal_id", question: "Which deal is it?", read: "deals.list" };

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "deals.create",
      label: "Create Deal",
      description: "Open a new deal with a partner: its title, event and dates, objective, projected value, expected close, next action and owner",
      input: c.partner_pipeline.DealAdd,
      permission: ["partnerships", "create"],
      risk: "standard",
      form: "none: New Deal's form also takes the venue, options, team and custom values; the card is the deal's own fields (DealAdd)",
      picks: { owner_id: "employee" },
      resolve: { stage: (value, _actor, db) => lists.stageCodeOf(db, value) },
      names,
      asks: [
        { field: "partner_id", question: "Which partner is it with?", read: "partners.list" },
        { field: "title", question: "What is the deal?" },
        { field: "owner_id", question: "Who owns the deal?", read: "employees.list" },
      ],
      run: (values, actor) => service.create(actor, actor.scope, parseBody(c.partner_pipeline.DealCreate, values)),
      readback: dealLine("opened"),
      labels: { partner_id: "Partner", title: "Title", owner_id: "Owner", estimated_value: "Projected Value", expected_close_on: "Expected Close" },
    },
    {
      key: "deals.update",
      label: "Save Deal",
      description: "Change a deal's details: title, event and dates, attendance, objective, projected value, expected close, next action, owner, impact or comments; only what changes",
      input: c.partner_pipeline.DealChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Edit Deal's form changes the deal open on its 360 and never names it; the card names the deal (DealChange)",
      picks: { owner_id: "employee" },
      names,
      asks: [whichDeal],
      records: (values) => (values.deal_id ? [{ type: "partner_deal", id: values.deal_id }] : []),
      check: async (client, values, actor) => {
        if (values.deal_id) await service.assertSeen(client, values.deal_id, actor.scope);
      },
      run: (values, actor) => {
        const { deal_id: id, ...changes } = values;
        return service.update(actor, actor.scope, id, parseBody(c.partner_pipeline.DealUpdate, changes));
      },
      readback: dealLine("saved"),
      labels: { deal_id: "Deal", title: "Title", owner_id: "Owner", estimated_value: "Projected Value", expected_close_on: "Expected Close" },
    },
    {
      key: "deals.move_stage",
      label: "Move Stage",
      description: "Move a deal to another of MyCity's stages; going back, On Hold and Closed Lost need why (10 characters or more); a signed stage is moved on the deal's 360",
      input: c.partner_pipeline.DealStageChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: the stage switcher is a press on the deal's 360 and never names the deal; the card names it (DealStageChange)",
      resolve: { stage: (value, _actor, db) => lists.stageCodeOf(db, value) },
      names,
      asks: [whichDeal, { field: "stage", question: "Which stage?", options: ({ db }) => lists.stageLabels(db) }],
      records: (values) => (values.deal_id ? [{ type: "partner_deal", id: values.deal_id }] : []),
      check: (client, values, actor) => stages.assertCard(client, values, actor.scope),
      run: (values, actor) => stages.move(actor, actor.scope, values.deal_id, { stage: values.stage, reason: values.reason }),
      readback: dealLine("moved"),
      labels: { deal_id: "Deal", stage: "Stage", reason: "Why" },
    },
    {
      key: "deals.set_health",
      label: "Set Health",
      description: "Set how a deal is going: On Track, Follow-up Required or Stalled; Stalled needs what is in the way (10 characters or more)",
      input: c.partner_pipeline.DealHealthChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Set Health changes the deal open on its 360 and never names it; the card names the deal (DealHealthChange)",
      names,
      asks: [whichDeal, { field: "health", question: "How is it going?", choices: ["On Track", "Follow-up Required", "Stalled"] }],
      records: (values) => (values.deal_id ? [{ type: "partner_deal", id: values.deal_id }] : []),
      check: async (client, values, actor) => {
        if (values.deal_id) await service.assertSeen(client, values.deal_id, actor.scope);
      },
      run: (values, actor) => health.set(actor, actor.scope, values.deal_id, { health: values.health, blockers: values.blockers }),
      readback: dealLine("set"),
      labels: { deal_id: "Deal", health: "Health", blockers: "Blockers" },
    },
    {
      key: "deal_returns.save",
      label: "Save Returns",
      description: "Enter a month of a deal's returns: units sold, gross sales, MyCity's commission, paid to the partner, downloads and a note; a month entered again replaces it",
      input: c.partner_pipeline.DealReturnChange,
      permission: ["partnerships", "edit"],
      capability: "partnerships.money",
      risk: "money",
      form: "none: Enter Returns saves the month open on the deal's 360 and never names the deal; the card names the deal and the month (DealReturnChange)",
      names,
      asks: [whichDeal, { field: "month", question: "Which month, as YYYY-MM?" }],
      records: (values) => (values.deal_id ? [{ type: "partner_deal", id: values.deal_id }] : []),
      check: async (client, values, actor) => {
        if (values.deal_id) await service.assertSeen(client, values.deal_id, actor.scope);
      },
      run: async (values, actor) => {
        const { deal_id: id, month, ...figures } = values;
        await returns.save(actor, actor.scope, id, month, parseBody(c.partner_pipeline.ReturnSave, figures));
        return service.get(id, actor.scope, actor);
      },
      readback: dealLine("returns saved"),
      labels: { deal_id: "Deal", month: "Month", units_sold: "Units Sold", gross_sales: "Gross Sales", mycity_commission: "MyCity Commission", paid_to_partner: "Paid to Partner", downloads: "Downloads" },
    },
  ],
  // Every create and edit form of the pipeline contract, and how the chat reaches it (gate 23, decision 33).
  not_offered: {
    DealCreate: "via deals.create: New Deal's own request, with its venue, options, team and custom values; the card is DealAdd",
    DealUpdate: "via deals.update: Edit Deal's own request, which never names its deal; the card is DealChange",
    ReturnSave: "via deal_returns.save: Enter Returns' own request, which never names its deal or month; the card is DealReturnChange",
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
  },
  reads: [
    {
      key: "deals.list",
      summary: "partnerships.summary",
      description: "List partnership deals: title, the lead or partner, category, stage, health, status (open, live, completed, lost), owner, projected value, expected close and days at stage",
      params: c.partner_pipeline.DealListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
    {
      key: "deals.get",
      summary: "none: one record",
      description: "One deal whole: its event, venue, terms, validity, options, team, blockers, next action and history",
      params: c.common.IdParams,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.get(params.id, actor.scope, actor),
      cite,
    },
    {
      key: "categories.list",
      summary: "none: configuration; charted from its table (decision 50)",
      description: "List the partnership categories (Event, Hospitality, Vendor and the rest), with how many partners and leads each has",
      params: c.partner_pipeline.CategoryListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.listCategories(params, actor.scope),
      cite: (row) => ({ type: "partner_category", id: row.partner_category_id, label: row.name }),
    },
  ],
  routes: [
    { intent: "see the partnership pipeline, stalled deals and what has waited longest", screen: "partnerships.pipeline" },
    { intent: "move a deal or set its health", screen: "partnerships.pipeline" },
    { intent: "set up a category", screen: "partnerships.categories" },
  ],
});

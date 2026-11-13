"use strict";
/**
 * What the assistant may read and do about leads (docs/guides/partnerships.md §9): the leads the
 * asker may see, a page of 25 at a time, and one Lead 360, by the rule the screen keeps (§6.1); and,
 * as cards the person confirms (docs/guides/praxis-ai.md §6.11, decision 33), New Lead, Edit Lead and
 * Close as Lost, each through the screen's own service function. Moving its deal is the deals'
 * card; Convert to Partner needs the signed copy, a file, so it stays on the Lead 360.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const maps = require("../maps/maps.service");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const service = require("./leads.service");

const link = (id) => (routeMap.linkFor("lead", id) || {}).path || null;
/** The lead a card made or changed, read back as a line that opens its 360. */
const leadLine = (status) => (l) => [{ type: "lead", id: l.lead.lead_id, label: `${l.lead.number} ${l.lead.name}`, status, link: link(l.lead.lead_id) }];
const cite = (row) => ({ type: "lead", id: row.lead_id || row.lead.lead_id, label: row.name || row.lead.name });
const names = async (values, _actor, db) => [...(await pipeline.cardNames(db, values)), ...maps.cardPlace(values.city)];

/** The scopes a region may be, as the card offers them. */
const SCOPES = ["Cities", "National", "Africa", "Worldwide"];

/** New Lead's own request from the card's flat fields. */
function leadCreate(v) {
  return parseBody(c.leads.LeadCreate, {
    name: v.name,
    partner_category_id: v.partner_category_id,
    region: { scope: v.region_scope, ...(v.region_scope === "cities" && v.city ? { cities: [{ token: v.city }] } : {}) },
    industry: v.industry,
    source: v.source,
    owner_id: v.owner_id,
    contact: {
      first_name: v.contact_first_name,
      last_name: v.contact_last_name,
      job_title: v.contact_job_title,
      email: v.contact_email,
      ...(v.contact_phone ? { phones: [v.contact_phone] } : {}),
    },
    deal: {
      title: v.deal_title,
      objective: v.deal_objective,
      stage: v.deal_stage,
      estimated_value: v.estimated_value,
      expected_close_on: v.expected_close_on,
      owner_id: v.owner_id,
    },
  });
}

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "leads.create",
      label: "Create Lead",
      description: "Capture a partnership lead: the organisation, its category and region, the lead owner, its primary contact and the deal being pursued",
      input: c.leads.LeadAdd,
      permission: ["partnerships", "create"],
      risk: "standard",
      form: "none: New Lead's form also takes the region's other cities, the deal's options, venue and custom values; the card is the lead, its contact and its deal (LeadAdd)",
      picks: { owner_id: "employee", city: "place" },
      resolve: { city: (value) => maps.onePlace(value, { level: "city" }) },
      names,
      asks: [
        { field: "name", question: "What is the organisation called?" },
        { field: "partner_category_id", question: "Which category is it?", read: "categories.list" },
        { field: "region_scope", question: "Where does it work?", choices: SCOPES },
        { field: "city", question: "Which city?", when: { field: "region_scope", not: ["national", "africa", "worldwide"] } },
        { field: "owner_id", question: "Who owns the lead?", read: "employees.list" },
        { field: "contact_first_name", question: "Who is the contact there?" },
        { field: "contact_last_name", question: "What is their last name?" },
        { field: "deal_title", question: "What is the deal being pursued?" },
      ],
      run: (values, actor) => service.create(actor, actor.scope, leadCreate(values)),
      readback: leadLine("captured"),
      labels: {
        name: "Name",
        partner_category_id: "Category",
        region_scope: "Region",
        city: "City",
        industry: "Industry",
        source: "Source",
        owner_id: "Lead Owner",
        contact_first_name: "Contact First Name",
        contact_last_name: "Contact Last Name",
        contact_job_title: "Contact Position",
        contact_email: "Contact Email",
        contact_phone: "Contact Phone",
        deal_title: "Deal",
        deal_objective: "Objective",
        deal_stage: "Stage",
        estimated_value: "Projected Value",
        expected_close_on: "Expected Close",
      },
    },
    {
      key: "leads.update",
      label: "Save Lead",
      description: "Change a lead's own details: its name, category, industry, website, objective, source, owner, impact or comments; only what changes",
      input: c.leads.LeadChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Edit Lead's form changes the lead open on its 360 and never names it; the card names the lead (LeadChange)",
      picks: { owner_id: "employee" },
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [{ field: "lead_id", question: "Which lead is it?", read: "leads.list" }],
      records: (values) => (values.lead_id ? [{ type: "lead", id: values.lead_id }] : []),
      run: (values, actor) => {
        const { lead_id: id, ...changes } = values;
        return service.update(actor, actor.scope, id, parseBody(c.leads.LeadUpdate, changes));
      },
      readback: leadLine("saved"),
      labels: { lead_id: "Lead", name: "Name", partner_category_id: "Category", owner_id: "Lead Owner", identified_on: "Identified" },
    },
    {
      key: "leads.lose",
      label: "Close Lead",
      description: "Close a lead as lost, with why (10 characters or more): its deal moves to the first Closed Lost stage",
      input: c.leads.LeadClose,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Close as Lost asks only why, on the lead open on its 360; the card names the lead (LeadClose)",
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [
        { field: "lead_id", question: "Which lead is it?", read: "leads.list" },
        { field: "reason", question: "Why is it lost?" },
      ],
      records: (values) => (values.lead_id ? [{ type: "lead", id: values.lead_id }] : []),
      run: (values, actor) => service.lose(actor, actor.scope, values.lead_id, { reason: values.reason }),
      readback: leadLine("lost"),
      labels: { lead_id: "Lead", reason: "Why" },
    },
  ],
  // Every create and edit form of the leads contract, and how the chat reaches it (gate 23, decision 33).
  not_offered: {
    LeadCreate: "via leads.create: New Lead's own request, with the region's cities, the deal's options, venue and custom values; the card is LeadAdd",
    LeadUpdate: "via leads.update: Edit Lead's own request, which never names its lead; the card is LeadChange",
  },
  reads: [
    {
      key: "leads.list",
      description: "List partnership leads: name, category, region, status (new, contacted, qualified, lost, converted), stage, health, owner and last contact",
      params: c.leads.LeadListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
    {
      key: "leads.get",
      summary: "none: one record",
      description: "One lead's whole picture: its deal, stage, health, projected value, contacts and latest interactions",
      params: c.common.IdParams,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.get360(params.id, actor.scope, actor),
      cite,
    },
  ],
  routes: [
    { intent: "add a partnership lead or prospect", screen: "partnerships.leads", params: { new: "1" } },
    { intent: "see the leads and their status", screen: "partnerships.leads" },
  ],
});

"use strict";
/**
 * ⌘K for leads (docs/guides/partnerships.md §9): a lead by its name, number, region or a contact's
 * name, by the rule the Leads list keeps (§6.1). A converted lead is found as its partner, so it is
 * left out. A result opens the Lead 360 (shared/route-map.js lead).
 */
const { recordProvider } = require("../../shared/search/provider");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");

module.exports = recordProvider({
  type: "lead",
  module: "partnerships",
  label: "Leads",
  words: ["lead", "leads", "prospect", "tracker"],
  from: "lead l LEFT JOIN partner_category pc ON pc.partner_category_id = l.partner_category_id",
  key: "l.lead_id",
  columns: [
    "l.number::text",
    "l.name",
    `COALESCE(${deals.regionLabel("l.region_scope", "lead.cities", "l.lead_id")}, '')`,
    `COALESCE((SELECT string_agg(c.first_name || ' ' || c.last_name, ' ') FROM partner_contact c WHERE c.lead_id = l.lead_id), '')`,
  ],
  select: "l.lead_id AS id, l.number::text AS ref, l.name AS title, pc.name::text AS sub, l.status AS status",
  where: "l.status <> 'converted'",
  order: "l.name",
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => deals.recordSeen(scope, { alias: "l", kind: "lead" }, params).replace(/^AND /, "") || "TRUE",
});

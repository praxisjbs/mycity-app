"use strict";
/**
 * ⌘K for partners (docs/guides/partnerships.md §9): a partner by its name, number, region or a
 * contact's name, by the rule the Partners list keeps (§6.1: its owner in the reader's scope, or a
 * deal on it the reader may see). A result opens the Partner 360 (shared/route-map.js partner).
 */
const { recordProvider } = require("../../shared/search/provider");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");

module.exports = recordProvider({
  type: "partner",
  module: "partnerships",
  label: "Partners",
  words: ["partner", "partners", "sponsor", "commission"],
  from: "partner p LEFT JOIN partner_category pc ON pc.partner_category_id = p.partner_category_id",
  key: "p.partner_id",
  columns: [
    "p.number",
    "p.name",
    "COALESCE(p.legal_name, '')",
    `COALESCE(${deals.regionLabel("p.region_scope", "partner.cities", "p.partner_id")}, '')`,
    `COALESCE((SELECT string_agg(c.first_name || ' ' || c.last_name, ' ') FROM partner_contact c WHERE c.partner_id = p.partner_id), '')`,
  ],
  select: "p.partner_id AS id, p.number AS ref, p.name AS title, pc.name::text AS sub, p.status AS status",
  order: "p.name",
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => deals.recordSeen(scope, { alias: "p", kind: "partner" }, params).replace(/^AND /, "") || "TRUE",
});

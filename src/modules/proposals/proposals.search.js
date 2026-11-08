"use strict";
/**
 * ⌘K for proposals (docs/guides/partnerships.md §9): a proposal by its number, its title or the lead
 * or partner it is for, by the rule Proposals keeps (a proposal follows its deal, §6.1). The newest
 * version of each answers; earlier ones are reached from it. A result opens Proposals on it
 * (shared/route-map.js proposal).
 */
const { recordProvider } = require("../../shared/search/provider");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");

module.exports = recordProvider({
  type: "proposal",
  module: "partnerships",
  label: "Proposals",
  words: ["proposal", "proposals", "pitch", "deck", "sponsor", "sponsorship"],
  from: `partnership_proposal pp
    JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
    LEFT JOIN partner p ON p.partner_id = po.partner_id
    LEFT JOIN lead l ON l.lead_id = po.lead_id`,
  key: "pp.partnership_proposal_id",
  columns: ["pp.number", "COALESCE(pp.title, '')", "COALESCE(p.name, l.name, '')", "po.title"],
  select: "pp.partnership_proposal_id AS id, pp.number AS ref, COALESCE(pp.title, po.title) AS title, COALESCE(p.name, l.name) AS sub, pp.status AS status",
  where: "NOT EXISTS (SELECT 1 FROM partnership_proposal nv WHERE nv.number = pp.number AND nv.version > pp.version)",
  order: "pp.created_at DESC",
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => deals.dealSeen(scope, "po", params).replace(/^AND /, "") || "TRUE",
});

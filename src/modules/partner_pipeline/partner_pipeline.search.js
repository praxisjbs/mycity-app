"use strict";
/**
 * ⌘K for deals (docs/guides/partnerships.md §9): a deal by its number, title or event, by the rule
 * Pipeline keeps (§6.1: its owner in the reader's scope, or one of its team). A result opens the
 * 360 of the lead or partner it is on (shared/route-map.js partner_deal). Categories join it with
 * Categories (M7 PR 2).
 */
const { recordProvider } = require("../../shared/search/provider");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./partner_pipeline.repo");

module.exports = recordProvider({
  type: "partner_deal",
  module: "partnerships",
  label: "Deals",
  words: ["deal", "deals", "event", "opportunity"],
  from: `partnership_opportunity po
    LEFT JOIN partner p ON p.partner_id = po.partner_id
    LEFT JOIN lead l ON l.lead_id = po.lead_id
    LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage`,
  key: "po.partnership_opportunity_id",
  columns: ["po.number", "po.title", "COALESCE(po.event_title, '')", "COALESCE(p.name, l.name, '')"],
  select: "po.partnership_opportunity_id AS id, po.number AS ref, po.title AS title, COALESCE(p.name, l.name) AS sub, po.status AS status",
  order: "po.created_at DESC",
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => repo.dealSeen(scope, "po", params).replace(/^AND /, "") || "TRUE",
});

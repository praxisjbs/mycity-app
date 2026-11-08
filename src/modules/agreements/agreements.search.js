"use strict";
/**
 * ⌘K for agreements (docs/guides/partnerships.md §9): an agreement by its number, its title or the
 * lead or partner it is with, by the rule Contracts & MOUs keeps (an agreement follows its deal, §6.1).
 * One provider a kind, so "MOU" finds MOUs and "contract" contracts; a Deal Merchant Agreement or a
 * service agreement is an agreement. Each opens Contracts & MOUs on it (shared/route-map.js).
 */
const { recordProvider } = require("../../shared/search/provider");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");

const FROM = `partnership_agreement a
  LEFT JOIN partnership_opportunity po ON po.partnership_opportunity_id = a.partnership_opportunity_id
  LEFT JOIN partner p ON p.partner_id = a.partner_id
  LEFT JOIN lead l ON l.lead_id = a.lead_id`;

const provider = (type, label, words, where) =>
  recordProvider({
    type,
    module: "partnerships",
    label,
    words,
    from: FROM,
    key: "a.partnership_agreement_id",
    columns: ["a.number", "a.title", "COALESCE(p.name, l.name, '')"],
    select: "a.partnership_agreement_id AS id, a.number AS ref, a.title AS title, COALESCE(p.name, l.name) AS sub, a.status AS status",
    where,
    order: "a.number DESC",
    reach: (_client, user) => scopeFor(user, "partnerships", "view"),
    readable: (scope, params) => deals.dealSeen(scope, "po", params).replace(/^AND /, "") || "TRUE",
  });

module.exports = [
  provider("agreement", "Agreements", ["agreement", "agreements", "deal merchant", "service agreement", "renewal", "signed"], "a.kind IS DISTINCT FROM 'mou' AND a.kind IS DISTINCT FROM 'contract'"),
  provider("mou", "MOUs", ["mou", "mous", "memorandum"], "a.kind = 'mou'"),
  provider("contract", "Contracts", ["contract", "contracts"], "a.kind = 'contract'"),
];

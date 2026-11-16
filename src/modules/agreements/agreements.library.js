"use strict";
/**
 * The Document Centre's agreements (docs/guides/document-centre.md §6.2): an agreement's PDF, the
 * sealed copy once it is signed and the copy sent for signature until then, named by its kind and
 * listed for whoever sees the agreement (an agreement follows its deal, docs/guides/partnerships.md
 * §6.1). The rule is agreements.service.mayOpenFile, written once more for a list.
 */
const { librarySource } = require("../../shared/documents/library");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");
const { DOC_TYPE, ENTITY } = require("./agreements.events");

const OF = "partnership_agreement a WHERE a.partnership_agreement_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "partnerships",
  types: { [DOC_TYPE]: "Agreement" },
  entity: ENTITY,
  kind: `(SELECT CASE a.kind WHEN 'mou' THEN 'MOU' WHEN 'service_agreement' THEN 'Service Agreement'
                             WHEN 'contract' THEN 'Contract' WHEN 'deal_merchant' THEN 'Deal Merchant Agreement' END
            FROM ${OF})`,
  record: {
    type: "'agreement'",
    id: "d.entity_id",
    label: `(SELECT COALESCE(p.name, l.name) FROM partnership_agreement a
               LEFT JOIN partner p ON p.partner_id = a.partner_id
               LEFT JOIN lead l ON l.lead_id = a.lead_id
              WHERE a.partnership_agreement_id = d.entity_id::uuid)`,
    ref: `(SELECT a.number::text FROM ${OF})`,
  },
  // The file the agreement holds now: a draft drawn again leaves the one before it behind.
  listed: `d.document_id = (SELECT COALESCE(a.signed_document_id, a.document_id) FROM ${OF})`,
  // A signed agreement's term: what Expiring Soon counts, while the agreement is in force.
  expires: `(SELECT CASE WHEN a.status IN ('signed', 'active', 'expiring') THEN a.ends_on END FROM ${OF})`,
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => {
    if (!scope) return "FALSE";
    return `EXISTS (SELECT 1 FROM partnership_agreement a
              LEFT JOIN partnership_opportunity po ON po.partnership_opportunity_id = a.partnership_opportunity_id
             WHERE a.partnership_agreement_id = d.entity_id::uuid ${deals.dealSeen(scope, "po", params)})`;
  },
});

"use strict";
/**
 * The Document Centre's partner documents (docs/guides/document-centre.md §6.2): every file kept on a
 * lead or a partner, uploads and signed paper copies, named by its kind (MOU, Service Agreement) and
 * listed for whoever may see its record, as its Documents tab lists it (docs/guides/partnerships.md
 * §6.1). The rule is partners.documents.mayRead, written once more for a list.
 */
const { librarySource } = require("../../shared/documents/library");
const { scopeFor } = require("../../middleware/rbac");
const deals = require("../partner_pipeline/partner_pipeline.repo");
const { DOC_TYPE, ENTITY } = require("./partners.events");

const OF = "partner_document pd WHERE pd.partner_document_id = d.entity_id::uuid";
const WITH_RECORD = `partner_document pd
  LEFT JOIN partner p ON p.partner_id = pd.partner_id
  LEFT JOIN lead l ON l.lead_id = pd.lead_id
 WHERE pd.partner_document_id = d.entity_id::uuid`;

module.exports = librarySource({
  area: "partnerships",
  types: { [DOC_TYPE]: "Partner Document" },
  entity: ENTITY,
  // The kind MyCity gave it; a signing's paper copy has none and says what it is.
  kind: `(SELECT CASE WHEN pd.origin = 'signed_copy' THEN 'Signed Copy'
                      ELSE (SELECT rv.label FROM reference_value rv WHERE rv.domain = 'partner_document_kind' AND rv.code::text = pd.kind) END
            FROM ${OF})`,
  record: {
    type: `(SELECT CASE WHEN pd.partner_id IS NOT NULL THEN 'partner' ELSE 'lead' END FROM ${OF})`,
    id: `(SELECT COALESCE(pd.partner_id, pd.lead_id) FROM ${OF})`,
    label: `(SELECT COALESCE(p.name, l.name) FROM ${WITH_RECORD})`,
    ref: `(SELECT COALESCE(p.number::text, l.number::text) FROM ${WITH_RECORD})`,
  },
  reach: (_client, user) => scopeFor(user, "partnerships", "view"),
  readable: (scope, params) => {
    if (!scope) return "FALSE";
    const partner = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
    const lead = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
    return `EXISTS (SELECT 1 FROM ${WITH_RECORD}
      AND CASE WHEN pd.partner_id IS NOT NULL THEN (p.partner_id IS NOT NULL ${partner}) ELSE (l.lead_id IS NOT NULL ${lead}) END)`;
  },
});

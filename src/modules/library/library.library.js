"use strict";
/**
 * The Document Centre's own documents (docs/guides/document-centre.md §6.2, §6.4): the company's
 * papers uploaded here (the CAC certificate, the status report, licences), each in a category MyCity
 * names, belonging to that category and numbered DOC-0001. Listed by their own rule
 * (library.access.js): the CEO and documents.manage see every one; the uploader theirs; anyone with
 * the `documents` grant those of a category seen by everyone or by a role they hold. An archived one
 * is for documents.manage alone.
 */
const { librarySource } = require("../../shared/documents/library");
const access = require("./library.access");
const { DOC_TYPE, ENTITY } = require("./library.events");

const OF = "company_document cd WHERE cd.company_document_id = d.entity_id::uuid";
const WITH_CATEGORY = `company_document cd
  JOIN document_category dc ON dc.document_category_id = cd.document_category_id
 WHERE cd.company_document_id = d.entity_id::uuid`;

module.exports = librarySource({
  area: "documents",
  area_label: "Company",
  types: { [DOC_TYPE]: "Company Document" },
  entity: ENTITY,
  record: {
    type: "'document_category'",
    id: `(SELECT cd.document_category_id FROM ${OF})`,
    label: `(SELECT dc.name::text FROM ${WITH_CATEGORY})`,
    ref: "NULL",
  },
  number: `(SELECT cd.number::text FROM ${OF})`,
  archived: `(SELECT cd.archived_at FROM ${OF})`,
  reach: access.reach,
  readable: access.readable,
});

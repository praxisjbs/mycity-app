"use strict";
/**
 * What the assistant may read in Employee Self-Service: the caller's own
 * documents, and where it sends them to add one (A23: it reads, it never
 * writes). Never another person's record; the read is given the caller's own
 * employee id and nothing else.
 *
 * The rest of ESS (profile, leave balance, the latest payslip, open queries,
 * docs/guides/ess.md §9) joins this manifest as each of those tabs lands.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const documents = require("../documents/documents.service");

module.exports = defineManifest({
  module: "ess",
  reads: [
    {
      key: "my_documents.list",
      description:
        "List my own documents and the ones People have asked me for",
      params: c.documents.DocumentListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id
          ? documents.listFor([actor.employee_id], params)
          : { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } },
      cite: (row) => ({
        type: "document",
        id: row.document_id || row.document_request_id,
        label: row.name,
      }),
    },
  ],
  routes: [
    { intent: "upload one of my documents", screen: "ess.my-documents" },
  ],
});

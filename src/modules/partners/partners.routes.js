"use strict";
/**
 * Partnerships · Partners (docs/guides/partnerships.md §5), mounted on /api/v1/partnerships:
 *
 *   GET   /partners/summary         view: the cards above Partners
 *   GET   /partners, /partners/:id  view: partners the reader may see; the Partner 360 (zero-data safe,
 *                                   money only with partnerships.money)
 *   POST  /partners                 create: New Partner, signed, with its contact and first deal
 *   PATCH /partners/:id             edit: Edit Partner
 *   POST  /partners/:id/close       edit: Close Partner; its open and live deals lost with it
 *   GET   /duplicates               create: likely duplicates over leads and partners (advisory)
 *   POST  /contacts, PATCH /contacts/:id   edit: Add Contact, Edit Contact
 *   GET   /documents, POST /documents      view, edit: a record's documents; Upload Document
 *   POST  /exports                  export: Partners, Leads or their deals in the tracker's columns (202,
 *                                   made by the worker and downloaded where it was pressed)
 *
 * The Work tab's GET /work arrives with M7 PR 5.
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./partners.controller");

const p = c.partners;
const view = () => requirePermission("partnerships", "view");
const edit = () => requirePermission("partnerships", "edit");

route(router, "get", "/partners/summary", { response: p.PartnersSummary, summary: "The figures above Partners" }, view(), controller.summary);
route(router, "get", "/partners", { query: p.PartnerListQuery, response: p.PartnerPage, summary: "Partners the reader may see" }, view(), controller.list);
route(router, "get", "/partners/:id", { params: c.common.IdParams, response: p.Partner360, summary: "The Partner 360" }, view(), controller.get);
route(router, "post", "/partners", { body: p.PartnerCreate, response: p.Partner360, summary: "New Partner, already signed" }, requirePermission("partnerships", "create"), controller.create);
route(router, "patch", "/partners/:id", { params: c.common.IdParams, body: p.PartnerUpdate, response: p.Partner360, summary: "Edit a partner" }, edit(), controller.update);
route(router, "post", "/partners/:id/close", { params: c.common.IdParams, body: p.PartnerClose, response: p.Partner360, summary: "Close a partner" }, edit(), controller.close);

route(router, "get", "/duplicates", { query: p.DuplicateQuery, response: p.Duplicates, summary: "Likely duplicates among leads and partners" }, requirePermission("partnerships", "create"), controller.duplicates);

route(router, "post", "/contacts", { body: p.ContactCreate, response: p.Contact, summary: "Add a contact to a lead or partner" }, edit(), controller.createContact);
route(router, "patch", "/contacts/:id", { params: c.common.IdParams, body: p.ContactUpdate, response: p.Contact, summary: "Edit a contact" }, edit(), controller.updateContact);

route(router, "get", "/documents", { query: p.PartnerDocumentQuery, response: p.PartnerDocumentPage, summary: "A record's documents" }, view(), controller.documents);
route(router, "post", "/documents", { body: p.PartnerDocumentAttach, response: p.PartnerDocument, summary: "Attach an upload to a lead or partner" }, edit(), controller.attach);

route(router, "post", "/exports", { body: p.PartnershipExportRequest, response: c.documents.ExportFile, summary: "Export partners, leads or deals in the tracker's columns" }, requirePermission("partnerships", "export"), controller.requestExport);

module.exports = { basePath: "/partnerships", surface: "staff", router };

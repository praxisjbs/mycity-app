"use strict";
/**
 * Partnerships · agreements: generate, approve, sign, renew, close (docs/guides/partnerships.md §5, §6.8,
 * §6.9). Mounted on /api/v1/partnerships beside the other partnership modules. Every route holds the
 * reader to their `partnerships` scope through the agreement's deal (§6.1); the signing page and the
 * verification page are the signatures service's public routes.
 *
 *   POST  /templates/tidy                  edit + partnerships.configure: pasted wording tidied, nothing kept
 *   GET   /agreements/summary              view: the cards above Contracts & MOUs
 *   GET   /agreements, /agreements/renewals, /agreements/:id     view
 *   GET   /agreements/:id/document         view: the PDF, the sealed copy once signed
 *   POST  /agreements                      create: Generate Agreement on a deal
 *   PATCH /agreements/:id                  edit: Draft only
 *   POST  /agreements/:id/submit           edit: opens `partnership.agreement`
 *   POST  /agreements/:id/send             edit: approved only, or Send Again with corrected signers
 *   POST  /agreements/:id/resend           edit: Send Again to the same signers
 *   POST  /agreements/:id/signed-copy      edit: Record Signed Copy
 *   POST  /agreements/:id/renew            edit: the next agreement, drafted
 *   POST  /agreements/:id/close            edit: Close Agreement, with its reason
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./agreements.controller");

const router = express.Router();
const k = c.agreements;
const byId = { params: c.common.IdParams };
const view = requirePermission("partnerships", "view");
const edit = requirePermission("partnerships", "edit");

route(router, "post", "/templates/tidy",
  { body: c.partner_pipeline.TemplateTidy, response: c.partner_pipeline.TemplateTidyDraft, summary: "Tidy pasted agreement wording and propose its fields; nothing is kept" },
  edit, requireCapability("partnerships.configure"), controller.tidy);

route(router, "get", "/agreements/summary", { response: k.AgreementsSummary, summary: "The cards above Contracts & MOUs" }, view, controller.summary);
route(router, "get", "/agreements/renewals", { query: k.RenewalQuery, response: k.RenewalPage, summary: "Signed agreements coming up for renewal" }, view, controller.renewals);
route(router, "get", "/agreements", { query: k.AgreementListQuery, response: k.AgreementPage, summary: "The agreements the reader may see" }, view, controller.list);
route(router, "get", "/agreements/:id", { ...byId, response: k.AgreementDetail, summary: "One agreement: its wording, approval, signers and verification" }, view, controller.get);
route(router, "get", "/agreements/:id/document", { ...byId, no_content: true, summary: "An agreement's PDF: the sealed copy once signed" }, view, controller.document);

route(router, "post", "/agreements",
  { body: k.AgreementGenerate, response: k.AgreementDetail, summary: "Generate an agreement from its category's template" },
  requirePermission("partnerships", "create"), controller.generate);
route(router, "patch", "/agreements/:id", { ...byId, body: k.AgreementUpdate, response: k.AgreementDetail, summary: "Edit a draft agreement" }, edit, controller.update);
route(router, "post", "/agreements/:id/submit", { ...byId, body: c.common.EmptyBody, response: k.AgreementDetail, summary: "Submit an agreement for approval" }, edit, controller.submit);
route(router, "post", "/agreements/:id/send", { ...byId, body: k.AgreementSend, response: k.AgreementDetail, summary: "Send an approved agreement for signature" }, edit, controller.send);
route(router, "post", "/agreements/:id/resend", { ...byId, body: c.common.EmptyBody, response: k.AgreementDetail, summary: "Send an agreement for signature again" }, edit, controller.resend);
route(router, "post", "/agreements/:id/signed-copy", { ...byId, body: k.SignedCopyRecord, response: k.AgreementDetail, summary: "Record an agreement signed on paper" }, edit, controller.signedCopy);
route(router, "post", "/agreements/:id/renew", { ...byId, body: k.AgreementRenew, response: k.AgreementDetail, summary: "Draft the next agreement from a signed one" }, edit, controller.renew);
route(router, "post", "/agreements/:id/close", { ...byId, body: k.AgreementClose, response: k.AgreementDetail, summary: "Close an agreement, with its reason" }, edit, controller.close);

module.exports = { basePath: "/partnerships", surface: "staff", router };

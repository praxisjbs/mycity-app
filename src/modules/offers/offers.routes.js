"use strict";
/**
 * /api/v1/recruitment/offers: Recruitment · Offers (docs/guides/offers.md §5).
 *
 *   GET  /, /summary, /:id, /:id/document   `recruitment` view: scope by the vacancy's hiring manager
 *   GET  /draft                             `recruitment` create: what New Offer starts from
 *   POST /                                  `recruitment` create: New Offer
 *   PATCH /:id, POST /:id/submit, /send, /resend, /recipient, /withdraw   `recruitment` edit, in scope
 *   POST /:id/sign                          `recruitment` view: the Offer Signatory named on its request
 *                                           signs for the company (signatures.signAsStaffIn checks them)
 *   GET, PUT /settings/...                  `recruitment` edit: Offer Signatory and the standard wording
 *
 * An offer is approved in its approval (My Approvals and the offer's card), never by a route here.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./offers.controller");

const router = express.Router();
const o = c.offers;
const byId = { params: c.common.IdParams };
const view = requirePermission("recruitment", "view");
const create = requirePermission("recruitment", "create");
const edit = requirePermission("recruitment", "edit");

route(router, "get", "/", { query: o.OfferListQuery, response: o.OfferPage, summary: "Offers in the reader's scope" }, view, controller.list);
route(router, "post", "/", { body: o.OfferCreate, response: o.OfferDetail, summary: "New Offer" }, create, controller.create);
route(router, "get", "/summary", { response: o.OffersSummary, summary: "The figures above the Offers list" }, view, controller.summary);
route(router, "get", "/draft", { query: o.OfferDraftQuery, response: o.OfferDraft, summary: "What New Offer starts from" }, create, controller.draft);
route(router, "get", "/settings", { response: o.OfferSettings, summary: "The Offer Signatory and the wording's version" }, edit, controller.settings);
route(router, "put", "/settings/signatory", { body: o.OfferSignatorySave, response: o.OfferSettings, summary: "Name the Offer Signatory" }, edit, controller.saveSignatory);
route(router, "get", "/settings/letter", { response: o.OfferLetterTemplate, summary: "The standard offer letter" }, edit, controller.letter);
route(router, "put", "/settings/letter", { body: o.OfferLetterTemplateSave, response: o.OfferLetterTemplate, summary: "Save the standard offer letter" }, edit, controller.saveLetter);
route(router, "post", "/settings/letter/restore", { body: c.common.EmptyBody, response: o.OfferLetterTemplate, summary: "Restore the shipped wording" }, edit, controller.restoreLetter);
route(router, "get", "/:id", { ...byId, response: o.OfferDetail, summary: "One offer" }, view, controller.get);
route(router, "patch", "/:id", { ...byId, body: o.OfferEdit, response: o.OfferDetail, summary: "Change a draft offer" }, edit, controller.edit);
route(router, "post", "/:id/submit", { ...byId, body: c.common.EmptyBody, response: o.OfferDetail, summary: "Submit for approval" }, edit, controller.submit);
route(router, "post", "/:id/sign", { ...byId, body: c.signatures.SignSubmit, response: o.OfferDetail, summary: "Sign for the company" }, view, controller.sign);
route(router, "post", "/:id/send", { ...byId, body: c.common.EmptyBody, response: o.OfferDetail, summary: "Send the offer to the candidate" }, edit, controller.send);
route(router, "post", "/:id/resend", { ...byId, body: c.common.EmptyBody, response: o.OfferDetail, summary: "Send the signing link again" }, edit, controller.resend);
route(router, "post", "/:id/recipient", { ...byId, body: o.OfferRecipient, response: o.OfferDetail, summary: "Correct the candidate's email and send the link again" }, edit, controller.changeEmail);
route(router, "post", "/:id/withdraw", { ...byId, body: o.OfferWithdraw, response: o.OfferDetail, summary: "Withdraw an open offer" }, edit, controller.withdraw);
route(router, "get", "/:id/document", { ...byId, no_content: true, summary: "The offer letter's PDF" }, view, controller.document);

module.exports = { basePath: "/recruitment/offers", surface: "staff", router };

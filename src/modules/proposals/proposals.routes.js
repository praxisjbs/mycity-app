"use strict";
/**
 * Partnerships · proposals and proof points (docs/guides/partnerships.md §5, §6.10, §6.11): the proof
 * points (M7 PR 2) and the Proposal Studio (PR 7). A proposal is read and worked on within its deal's
 * scope (§6.1).
 *
 *   GET   /proof-points                  `partnerships` view: MyCity's facts, 25 a page
 *   POST  /proof-points                  edit + partnerships.configure: add one
 *   PATCH /proof-points/:id              edit + configure: change, move, remove its image, retire, restore
 *   POST  /proof-points/:id/image        edit + configure: upload its logo or picture
 *
 *   GET   /proposals/summary, /proposals, /proposals/:id, /proposals/:id/preview      view
 *   POST  /proposals                                    create: New Proposal from a brief; the cards are queued
 *   POST  /proposals/:id/retry                          edit: Try Again after a failure
 *   POST  /proposals/:id/questions/:qid/answer|skip|reshuffle                        edit
 *   POST  /proposals/:id/draft                          edit: Write Draft (queued; by hand when AI is off)
 *   PATCH /proposals/:id/content                        edit: a section, its layout, place, visibility or image
 *   POST  /proposals/:id/sections/:key/rewrite          edit: Rewrite Section, nothing kept
 *   POST  /proposals/:id/message                        edit: Write With AI for Send, nothing kept
 *   POST  /proposals/:id/send                           edit: Confirm and Send (confirm: true)
 *   POST  /proposals/:id/pdf                            view: Download PDF, made in the worker (202)
 *   POST  /proposals/:id/accept|decline|withdraw|revise edit
 *   POST  /proposals/:id/save-as-template               edit + partnerships.configure
 *   GET   /proposal-templates                           view: the saved templates a brief may use
 *
 * tests/unit/partnerships-skeleton.test.js holds every route here to the partnerships key.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./proposals.controller");

const router = express.Router();
const pr = c.proposals;
const edit = requirePermission("partnerships", "edit");
const configure = requireCapability("partnerships.configure");

route(router, "get", "/proof-points",
  { query: pr.ProofPointListQuery, response: pr.ProofPointPage, summary: "MyCity's proof points" },
  requirePermission("partnerships", "view"), controller.listProofPoints);

route(router, "post", "/proof-points",
  { body: pr.ProofPointCreate, response: pr.ProofPoint, summary: "Add a proof point" },
  edit, configure, controller.createProofPoint);

route(router, "patch", "/proof-points/:id",
  { params: c.common.IdParams, body: pr.ProofPointUpdate, response: pr.ProofPoint, summary: "Change, retire or restore a proof point" },
  edit, configure, controller.updateProofPoint);

route(router, "post", "/proof-points/:id/image",
  { params: c.common.IdParams, body: c.documents.DocumentUpload, response: pr.ProofPoint, summary: "Upload a proof point's logo or picture" },
  edit, configure, upload.single("file", { purpose: "photo" }), controller.setProofPointImage);

/* The Proposal Studio (M7 PR 7) */

const view = requirePermission("partnerships", "view");
const params = { params: c.common.IdParams };

route(router, "get", "/proposals/summary",
  { response: pr.ProposalsSummary, summary: "The figures above Proposals" },
  view, controller.summary);

route(router, "get", "/proposals",
  { query: pr.ProposalListQuery, response: pr.ProposalPage, summary: "Proposals the reader may see, the newest version of each" },
  view, controller.list);

route(router, "post", "/proposals",
  { body: pr.ProposalStart, response: pr.ProposalDetail, summary: "New Proposal: a brief on a deal; the question cards are queued" },
  requirePermission("partnerships", "create"), controller.start);

route(router, "get", "/proposals/:id",
  { ...params, response: pr.ProposalDetail, summary: "A proposal as the studio edits it" },
  view, controller.get);

route(router, "get", "/proposals/:id/preview",
  { ...params, response: pr.ProposalPreview, summary: "The proposal drawn by the design kit, and its sections" },
  view, controller.preview);

route(router, "post", "/proposals/:id/retry",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Try Again: the cards or the draft asked once more" },
  edit, controller.retry);

route(router, "post", "/proposals/:id/questions/:qid/answer",
  { params: pr.QuestionParams, body: pr.QuestionAnswer, response: pr.ProposalDetail, summary: "Answer a question card" },
  edit, controller.answer);

route(router, "post", "/proposals/:id/questions/:qid/skip",
  { params: pr.QuestionParams, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Skip a question card" },
  edit, controller.skip);

route(router, "post", "/proposals/:id/questions/:qid/reshuffle",
  { params: pr.QuestionParams, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "A different question in a card's place" },
  edit, controller.reshuffle);

route(router, "post", "/proposals/:id/draft",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Write Draft" },
  edit, controller.draft);

route(router, "patch", "/proposals/:id/content",
  { ...params, body: pr.ProposalContentEdit, response: pr.ProposalDetail, summary: "Edit a page of the proposal" },
  edit, controller.edit);

route(router, "post", "/proposals/:id/sections/:key/rewrite",
  { params: pr.SectionParams, body: pr.SectionRewrite, response: pr.SectionRewriteDraft, summary: "Rewrite Section: Claude's version, nothing kept" },
  edit, controller.rewrite);

route(router, "post", "/proposals/:id/message",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalMessageDraft, summary: "Write With AI: the covering email, nothing kept" },
  edit, controller.message);

route(router, "post", "/proposals/:id/send",
  { ...params, body: pr.ProposalSend, response: pr.ProposalDetail, summary: "Confirm and Send" },
  edit, controller.send);

route(router, "post", "/proposals/:id/pdf",
  { ...params, body: c.common.EmptyBody, response: c.documents.ExportFile, summary: "Download PDF: the one sent, or the draft's, made in the worker" },
  view, controller.pdf);

route(router, "post", "/proposals/:id/accept",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Mark Accepted" },
  edit, controller.accept);

route(router, "post", "/proposals/:id/decline",
  { ...params, body: pr.ProposalDecline, response: pr.ProposalDetail, summary: "Mark Declined, with the reason; the link stops" },
  edit, controller.decline);

route(router, "post", "/proposals/:id/withdraw",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Withdraw: the link stops" },
  edit, controller.withdraw);

route(router, "post", "/proposals/:id/revise",
  { ...params, body: c.common.EmptyBody, response: pr.ProposalDetail, summary: "Revise: the next version of a sent proposal" },
  edit, controller.revise);

route(router, "post", "/proposals/:id/save-as-template",
  { ...params, body: pr.ProposalTemplateSave, response: pr.ProposalTemplate, summary: "Save as Template: the pages and their order, never the partner's facts" },
  edit, configure, controller.saveTemplate);

route(router, "get", "/proposal-templates",
  { query: pr.ProposalTemplateListQuery, response: pr.ProposalTemplatePage, summary: "The saved templates a brief may use" },
  view, controller.listTemplates);

module.exports = { basePath: "/partnerships", surface: "staff", router };

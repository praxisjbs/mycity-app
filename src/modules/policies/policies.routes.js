"use strict";
/**
 * /api/v1/policies (docs/guides/policies.md §5).
 *
 * People who write policies: the `knowledge` grant and the `policies.manage` capability
 * (Knowledge Hub · Policies):
 *   GET   /                              every policy, with its state and acknowledgements (view)
 *   POST  /                              start a written policy (create)
 *   GET   /:id                           one policy: in force, waiting, its draft and submission (view)
 *   PUT   /:id/draft                     save its draft (edit)
 *   POST  /:id/draft/discard             discard it (edit)
 *   POST  /tidy                          a tidied suggestion of a text; nothing is saved (edit)
 *   POST  /:id/publish                   publish the draft, signed (edit; Needs Approval off)
 *   POST  /:id/submit                    send the draft for approval, signed (edit; Needs Approval on)
 *   POST  /:id/recall                    take a submission back to the draft (edit; the submitter or the CEO)
 *   POST  /:id/archive                   a written policy stops applying (delete)
 *   GET   /:id/versions                  its versions, newest first (view)
 *   GET   /versions/:id                  one version (view)
 *   POST  /versions/:id/withdraw         withdraw a version waiting to start (edit)
 *   GET   /versions/:id/acknowledgements who has and has not acknowledged it (view)
 *   POST  /versions/:id/pdf              its PDF, made and downloaded where it was asked for (view; 202)
 *
 * The person's own, `self`:
 *   GET   /me                            the policies that apply to me, and those waiting on me
 *   GET   /me/due                        what the acknowledge sheet shows now
 *   GET   /me/versions/:id               one of them
 *   POST  /me/versions/:id/acknowledge   acknowledge it
 *   POST  /me/versions/:id/later         put it off until tomorrow, before its due date
 *   POST  /me/versions/:id/pdf           its PDF (202)
 *   POST  /me/versions/:id/approve       approve a stage waiting on me, with my signature (204)
 *   POST  /me/versions/:id/reject        reject it, with a reason (204)
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./policies.controller");

const p = c.policies;

route(router, "get", "/me",
  { query: p.MyPolicyListQuery, response: p.MyPolicyPage, self: true, summary: "The policies that apply to me" },
  controller.mine);

route(router, "get", "/me/due",
  { response: p.MyPolicyDue, self: true, summary: "The policies I owe an acknowledgement for now" },
  controller.due);

route(router, "get", "/me/versions/:id",
  { params: c.common.IdParams, response: p.MyPolicyVersion, self: true, summary: "One policy version, for me" },
  controller.myVersion);

route(router, "post", "/me/versions/:id/acknowledge",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: p.MyPolicyVersion, self: true,
    summary: "Acknowledge a policy version" },
  controller.acknowledge);

route(router, "post", "/me/versions/:id/later",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: p.MyPolicyDue, self: true,
    summary: "Put off acknowledging until tomorrow" },
  controller.later);

route(router, "post", "/me/versions/:id/pdf",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: c.documents.ExportFile, self: true,
    summary: "A policy version as a PDF, for me" },
  controller.myPdf);

route(router, "post", "/me/versions/:id/approve",
  { params: c.common.IdParams, body: p.PolicyApprove, no_content: true, self: true,
    summary: "Approve and sign a policy version waiting on me" },
  controller.approve);

route(router, "post", "/me/versions/:id/reject",
  { params: c.common.IdParams, body: p.PolicyReason, no_content: true, self: true,
    summary: "Reject a policy version waiting on me" },
  controller.reject);

route(router, "get", "/",
  { query: p.PolicyListQuery, response: p.PolicyPage, summary: "Every policy" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.list);

route(router, "post", "/",
  { body: p.PolicyCreate, response: p.Policy, summary: "Start a written policy" },
  requirePermission("knowledge", "create"), requireCapability("policies.manage"), controller.create);

route(router, "post", "/tidy",
  { body: p.PolicyTidy, response: p.PolicyTidyResult, summary: "A tidied suggestion of a policy's text" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.tidy);

route(router, "get", "/versions/:id",
  { params: c.common.IdParams, response: p.PolicyVersion, summary: "One policy version" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.version);

route(router, "post", "/versions/:id/withdraw",
  { params: c.common.IdParams, body: p.PolicyReason, response: p.Policy, summary: "Withdraw a version waiting to start" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.withdraw);

route(router, "get", "/versions/:id/acknowledgements",
  { params: c.common.IdParams, query: p.PolicyAckListQuery, response: p.PolicyAckPage,
    summary: "Who has acknowledged a policy version" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.acknowledgements);

route(router, "post", "/versions/:id/pdf",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: c.documents.ExportFile,
    summary: "A policy version as a PDF" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.pdf);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: p.Policy, summary: "One policy" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.get);

route(router, "put", "/:id/draft",
  { params: c.common.IdParams, body: p.PolicyDraftSave, response: p.Policy, summary: "Save a policy's draft" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.saveDraft);

route(router, "post", "/:id/draft/discard",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: p.Policy, summary: "Discard a policy's draft" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.discardDraft);

route(router, "post", "/:id/publish",
  { params: c.common.IdParams, body: p.PolicyPublish, response: p.Policy, summary: "Publish a policy's draft" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.publish);

route(router, "post", "/:id/submit",
  { params: c.common.IdParams, body: p.PolicyPublish, response: p.Policy, summary: "Send a policy's draft for approval" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.submit);

route(router, "post", "/:id/recall",
  { params: c.common.IdParams, body: p.PolicyReason, response: p.Policy, summary: "Take a submission back to the draft" },
  requirePermission("knowledge", "edit"), requireCapability("policies.manage"), controller.recall);

route(router, "post", "/:id/archive",
  { params: c.common.IdParams, body: p.PolicyReason, response: p.Policy, summary: "Archive a written policy" },
  requirePermission("knowledge", "delete"), requireCapability("policies.manage"), controller.archive);

route(router, "get", "/:id/versions",
  { params: c.common.IdParams, query: p.PolicyVersionListQuery, response: p.PolicyVersionPage,
    summary: "A policy's versions" },
  requirePermission("knowledge", "view"), requireCapability("policies.manage"), controller.versions);

module.exports = { basePath: "/policies", surface: "staff", router };

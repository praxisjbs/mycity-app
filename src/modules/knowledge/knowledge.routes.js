"use strict";
/**
 * /api/v1/knowledge/sops (docs/guides/knowledge.md §5). Every route asks the `knowledge` view
 * grant; a write is a writer's (the department's head, or `sops.manage`), which the service checks,
 * so a head needs no create or edit grant (§6.2). Archiving is the head's, or `sops.manage` with
 * `knowledge` delete, also checked there.
 *
 *   GET   /sops                    published SOPs; a writer's drafts and archived SOPs under their chips
 *   POST  /sops                    New SOP: numbered, with an empty draft (a writer of the department)
 *   GET   /sops/for-screen         the published SOPs a step names this screen in (Procedures)
 *   GET   /sops/departments        the departments with an SOP the reader may read (the chips), or
 *                                  with writable=true those they may write for (New SOP)
 *   POST  /sops/draft-with-ai      a suggestion from a pasted procedure or a PDF; nothing is saved
 *   GET   /sops/versions/:id       one published version
 *   GET   /sops/:id                one SOP: the version in force, and its draft for a writer
 *   PUT   /sops/:id/draft          Save Draft
 *   POST  /sops/:id/draft/discard  Discard Changes
 *   POST  /sops/:id/publish        Publish SOP
 *   POST  /sops/:id/archive        Archive SOP
 *   GET   /sops/:id/versions       its versions, newest first
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./knowledge.controller");

const k = c.knowledge;
const view = () => requirePermission("knowledge", "view");

route(router, "get", "/sops",
  { query: k.SopListQuery, response: k.SopPage, summary: "SOPs" },
  view(), controller.list);

route(router, "post", "/sops",
  { body: k.SopCreate, response: k.Sop, summary: "Start an SOP for a department" },
  view(), controller.create);

route(router, "get", "/sops/for-screen",
  { query: k.SopScreenQuery, response: k.SopPage, summary: "The SOPs whose steps name a screen" },
  view(), controller.forScreen);

route(router, "get", "/sops/departments",
  { query: k.SopDepartmentQuery, response: k.SopDepartmentPage, summary: "The departments of the SOPs, or those the reader writes for" },
  view(), controller.departments);

route(router, "post", "/sops/draft-with-ai",
  { body: k.SopDraftWithAi, response: k.SopDraftSuggestion, summary: "An SOP drafted from a procedure; nothing is saved" },
  view(), controller.draftWithAi);

route(router, "get", "/sops/versions/:id",
  { params: c.common.IdParams, response: k.SopVersion, summary: "One SOP version" },
  view(), controller.version);

route(router, "get", "/sops/:id",
  { params: c.common.IdParams, response: k.Sop, summary: "One SOP" },
  view(), controller.get);

route(router, "put", "/sops/:id/draft",
  { params: c.common.IdParams, body: k.SopDraftSave, response: k.Sop, summary: "Save an SOP's draft" },
  view(), controller.saveDraft);

route(router, "post", "/sops/:id/draft/discard",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: k.Sop, summary: "Discard an SOP's draft" },
  view(), controller.discardDraft);

route(router, "post", "/sops/:id/publish",
  { params: c.common.IdParams, body: k.SopPublish, response: k.Sop, summary: "Publish an SOP's draft" },
  view(), controller.publish);

route(router, "post", "/sops/:id/archive",
  { params: c.common.IdParams, body: k.SopReason, response: k.Sop, summary: "Archive an SOP" },
  view(), controller.archive);

route(router, "get", "/sops/:id/versions",
  { params: c.common.IdParams, query: c.common.PageQuery, response: k.SopVersionPage, summary: "An SOP's versions" },
  view(), controller.versions);

module.exports = { basePath: "/knowledge", surface: "staff", router };

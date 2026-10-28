"use strict";
/**
 * /api/v1/letter-templates: Queries & Sanctions · Letter Templates (docs/guides/queries.md §5).
 *
 *   GET  /, /summary, /:id, /:id/preview   `queries` view
 *   POST /                                 `queries` create + queries.configure: a new letter, a draft
 *   PUT  /:id/body                         `queries` edit + queries.configure: the next version
 *   POST /:id/activate                     `queries` edit + queries.configure
 *   GET, POST /assist                      `queries` edit + queries.configure: Write With AI, nothing kept
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./templates.controller");

const router = express.Router();
const t = c.templates;

route(router, "get", "/summary",
  { response: t.LetterTemplatesSummary, summary: "The figures above Letter Templates" },
  requirePermission("queries", "view"), controller.summary);

route(router, "get", "/",
  { query: t.LetterTemplateListQuery, response: t.LetterTemplatePage, summary: "Letter templates" },
  requirePermission("queries", "view"), controller.list);

route(router, "get", "/assist",
  { response: c.queries.AiAvailability, summary: "Whether Write With AI may answer now" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.assistStatus);

route(router, "post", "/assist",
  { body: t.LetterDraftRequest, response: t.LetterDraft, summary: "Draft a letter's wording; nothing is kept" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.assist);

route(router, "get", "/:id",
  { params: c.common.IdParams, response: t.LetterTemplateDetail, summary: "One letter template and its wording" },
  requirePermission("queries", "view"), controller.get);

route(router, "get", "/:id/preview",
  { params: c.common.IdParams, response: t.LetterPreview, summary: "A letter rendered with sample values" },
  requirePermission("queries", "view"), controller.preview);

route(router, "get", "/:id/preview.pdf",
  { params: c.common.IdParams, no_content: true,
    summary: "The letter as the employee receives it: the real PDF, sample values, nothing stored" },
  requirePermission("queries", "view"), controller.previewPdf);

route(router, "post", "/",
  { body: t.LetterTemplateCreate, response: t.LetterTemplateDetail, summary: "Add a letter template" },
  requirePermission("queries", "create"), requireCapability("queries.configure"), controller.create);

route(router, "put", "/:id/body",
  { params: c.common.IdParams, body: t.LetterTemplateBodySave, response: t.LetterTemplateDetail,
    summary: "Save a letter's wording as its next version" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.saveBody);

route(router, "post", "/:id/activate",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: t.LetterTemplateDetail,
    summary: "Make a letter available to send" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.activate);

route(router, "post", "/:id/deactivate",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: t.LetterTemplateDetail,
    summary: "Take a letter nothing sends back to a draft" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.deactivate);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: t.LetterTemplateUpdate, response: t.LetterTemplateDetail,
    summary: "Rename a letter, or change what it is used for while nothing sends it" },
  requirePermission("queries", "edit"), requireCapability("queries.configure"), controller.update);

module.exports = { basePath: "/letter-templates", surface: "staff", router };

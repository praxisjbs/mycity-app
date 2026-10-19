"use strict";
/**
 * /api/v1/letter-templates: Queries & Sanctions · Letter Templates (docs/guides/queries.md §5).
 *
 *   GET  /, /summary, /:id, /:id/preview   `queries` view
 *   POST /                                 `queries` create + queries.configure: a new letter, a draft
 *   PUT  /:id/body                         `queries` edit + queries.configure: the next version
 *   POST /:id/activate                     `queries` edit + queries.configure
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

route(router, "get", "/:id",
  { params: c.common.IdParams, response: t.LetterTemplateDetail, summary: "One letter template and its wording" },
  requirePermission("queries", "view"), controller.get);

route(router, "get", "/:id/preview",
  { params: c.common.IdParams, response: t.LetterPreview, summary: "A letter rendered with sample values" },
  requirePermission("queries", "view"), controller.preview);

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

module.exports = { basePath: "/letter-templates", surface: "staff", router };

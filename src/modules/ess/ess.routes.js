"use strict";
/**
 * /api/v1/ess: the caller's own record (docs/guides/ess.md §5).
 *
 * Every route is `self: true`: it is authenticated, and the record it answers
 * for is taken from the session. The `ess` permission key is always `own` scope
 * (shared/access/access.catalog.js OWN_ONLY), so a grant check here would add
 * nothing a wrong employee id could slip past; the service reads the employee
 * from `req.user` and there is no parameter that names another.
 *
 * My Documents is the first tab on the real API (M0, track B). The other tabs
 * are added here as their milestones land.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const upload = require("../../middleware/upload");
const controller = require("./ess.controller");

const router = express.Router();

route(router, "get", "/documents",
  { query: c.documents.DocumentListQuery, response: c.documents.DocumentListPage, self: true,
    summary: "My documents" },
  controller.listDocuments);

route(router, "get", "/documents/summary",
  { response: c.documents.DocumentSummary, self: true, summary: "Counts above my documents" },
  controller.documentSummary);

route(router, "post", "/documents",
  { body: c.ess.EssDocumentUpload, response: c.documents.DocumentRow, self: true,
    summary: "Upload one of my documents" },
  upload.single("file", { purpose: "document" }), controller.addDocument);

module.exports = { basePath: "/ess", surface: "staff", router };

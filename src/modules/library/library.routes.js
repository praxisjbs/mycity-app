"use strict";
/**
 * /api/v1/library: Document Centre · Library (docs/guides/document-centre.md §5).
 *
 *   GET /documents, /documents/summary, /documents/:id, /filters    `documents` view
 *
 * The grant opens the screen. Each document is listed only for a reader the vault would let open it
 * from its own module (§6.3), so the grant's scope narrows nothing. A file's bytes stay on the
 * vault's routes (GET /documents/:id/content), which check that rule once more.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./library.controller");

const router = express.Router();
const l = c.library;
const view = requirePermission("documents", "view");

route(router, "get", "/documents", { query: l.LibraryListQuery, response: l.LibraryPage, summary: "The library: every document the reader may open" }, view, controller.list);
route(router, "get", "/documents/summary", { response: l.LibrarySummary, summary: "The figures above the library" }, view, controller.summary);
route(router, "get", "/documents/:id", { params: c.common.IdParams, response: l.LibraryDocument, summary: "One document of the library" }, view, controller.get);
route(router, "get", "/filters", { response: l.LibraryFilters, summary: "The areas and types the reader can reach" }, view, controller.filters);

module.exports = { basePath: "/library", surface: "staff", router };

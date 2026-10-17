"use strict";
/**
 * /api/v1/imports: Settings · Imports, the wizard and the history
 * (BACKEND_STRUCTURE §9.3, docs/guides/foundation.md §5).
 *
 * The permission a wizard route needs is the importer's own, and the importer
 * arrives in the request, so it cannot be named when the route is defined.
 * Those routes are therefore `self: true` and the engine makes the real check
 * against the importer the caller asked for (engine.assertMay), refusing with a
 * 403. The history is the `settings` view grant, which the route checks.
 *
 * The two spreadsheet routes (the blank template and the error file) declare
 * `no_content: true`: their answer is a file, not a JSON shape the generated
 * contract could describe.
 *
 * `/importers` is defined before `/:id` so the word is never read as an id.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./imports.controller");

const router = express.Router();
const settingsView = requirePermission("settings", "view");

route(router, "get", "/importers",
  { response: c.imports.ImporterList, self: true, summary: "What I can import" },
  controller.importers);

route(router, "get", "/importers/:key/template",
  { params: c.imports.ImporterKeyParams, no_content: true, self: true,
    summary: "The blank sheet for an import" },
  controller.template);

route(router, "get", "/",
  { query: c.imports.ImportListQuery, response: c.imports.ImportPage,
    summary: "Every import, newest first" },
  settingsView, controller.history);

route(router, "post", "/",
  { body: c.imports.ImportCreate, response: c.imports.ImportBatch, self: true,
    summary: "Upload a sheet to import" },
  upload.single("file", { purpose: "import_sheet" }), controller.create);

route(router, "get", "/:id",
  { response: c.imports.ImportBatch, self: true, summary: "One import" },
  controller.get);

route(router, "put", "/:id/mapping",
  { body: c.imports.ImportMappingSet, response: c.imports.ImportBatch, self: true,
    summary: "Set which column feeds which field" },
  controller.setMapping);

route(router, "post", "/:id/preview",
  { body: c.imports.ImportRun, response: c.imports.ImportResult, self: true,
    summary: "Run the import and roll it back" },
  controller.preview);

route(router, "post", "/:id/commit",
  { body: c.imports.ImportRun, response: c.imports.ImportResult, self: true,
    summary: "Commit the import" },
  controller.commit);

route(router, "post", "/:id/revert",
  { body: c.common.EmptyBody, response: c.imports.ImportRevertResult, self: true,
    summary: "Undo a committed import" },
  controller.revert);

route(router, "get", "/:id/rows",
  { query: c.imports.ImportRowListQuery, response: c.imports.ImportRowPage, self: true,
    summary: "The rows of a sheet and what happened to each" },
  controller.rows);

route(router, "get", "/:id/report",
  { no_content: true, self: true, summary: "The error file for an import" },
  controller.report);

module.exports = { basePath: "/imports", surface: "staff", router };

"use strict";
/**
 * /api/v1/library: the Document Centre (docs/guides/document-centre.md §5).
 *
 *   GET   /documents, /documents/summary, /documents/:id, /filters     `documents` view
 *   POST  /documents                                                   Upload Document: `documents` create
 *   PATCH /documents/:id                                               Edit Details: `documents` edit (the uploader, or documents.manage)
 *   POST  /documents/:id/versions                                      Upload New Version: as Edit Details
 *   POST  /documents/:id/archive, /restore                             `documents` delete (the uploader, or documents.manage)
 *   GET   /categories, /categories/:id                                 `documents` view: the categories the reader sees
 *   POST  /categories, PATCH /categories/:id, POST .../archive, /restore   `documents` edit and documents.manage
 *   GET   /tags                                                        `documents` view: the tag field's suggestions
 *   POST  /letterhead                                                  Download Letterhead: `documents` view (202)
 *
 * The grant opens the screen. Another module's document is listed only for a reader the vault would
 * let open it (§6.3), so the grant's scope narrows nothing; a company document follows its
 * category's audience (§6.4). A file's bytes stay on the vault's routes (GET /documents/:id/content),
 * which check that rule once more. Files arrive staged (POST /documents) and are claimed here.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./library.controller");

const router = express.Router();
const l = c.library;
const view = requirePermission("documents", "view");
const create = requirePermission("documents", "create");
const edit = requirePermission("documents", "edit");
const del = requirePermission("documents", "delete");
const manage = requireCapability("documents.manage");
const id = { params: c.common.IdParams };

route(router, "get", "/documents", { query: l.LibraryListQuery, response: l.LibraryPage, summary: "The library: every document the reader may open" }, view, controller.list);
route(router, "get", "/documents/summary", { response: l.LibrarySummary, summary: "The figures above the library" }, view, controller.summary);
route(router, "get", "/documents/:id", { ...id, response: l.LibraryDocument, summary: "One document of the library" }, view, controller.get);
route(router, "get", "/filters", { response: l.LibraryFilters, summary: "The areas and types the reader can reach" }, view, controller.filters);

route(router, "post", "/documents", { body: l.CompanyDocumentCreate, response: l.LibraryDocument, summary: "Upload a company document" }, create, controller.create);
route(router, "patch", "/documents/:id", { ...id, body: l.CompanyDocumentUpdate, response: l.LibraryDocument, summary: "Change a company document's details" }, edit, controller.update);
route(router, "post", "/documents/:id/versions", { ...id, body: l.CompanyDocumentVersion, response: l.LibraryDocument, summary: "Replace a company document with a new version" }, edit, controller.addVersion);
route(router, "post", "/documents/:id/archive", { ...id, body: c.common.EmptyBody, response: l.LibraryDocument, summary: "Archive a company document" }, del, controller.archive);
route(router, "post", "/documents/:id/restore", { ...id, body: c.common.EmptyBody, response: l.LibraryDocument, summary: "Restore an archived company document" }, del, controller.restore);

route(router, "get", "/categories", { query: l.CategoryListQuery, response: l.CategoryPage, summary: "The document categories the reader sees" }, view, controller.categories);
route(router, "get", "/categories/:id", { ...id, response: l.DocumentCategory, summary: "One document category" }, view, controller.category);
route(router, "post", "/categories", { body: l.DocumentCategoryCreate, response: l.DocumentCategory, summary: "Add a document category" }, edit, manage, controller.createCategory);
route(router, "patch", "/categories/:id", { ...id, body: l.DocumentCategoryUpdate, response: l.DocumentCategory, summary: "Change a document category" }, edit, manage, controller.updateCategory);
route(router, "post", "/categories/:id/archive", { ...id, body: c.common.EmptyBody, response: l.DocumentCategory, summary: "Archive a document category" }, edit, manage, controller.archiveCategory);
route(router, "post", "/categories/:id/restore", { ...id, body: c.common.EmptyBody, response: l.DocumentCategory, summary: "Restore an archived document category" }, edit, manage, controller.restoreCategory);

route(router, "get", "/tags", { query: l.TagListQuery, response: l.TagPage, summary: "The tags in use on the documents the reader sees" }, view, controller.tags);
route(router, "post", "/letterhead", { body: l.LetterheadRequest, response: c.documents.ExportFile, summary: "The blank letterhead, as PDF or Word" }, view, controller.letterhead);

module.exports = { basePath: "/library", surface: "staff", router };

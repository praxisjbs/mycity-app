"use strict";
/**
 * Partnerships · categories, lists, custom fields, Start From Tracker and, with M7 PR 3, deals
 * (docs/guides/partnerships.md §5). Mounted on /api/v1/partnerships beside the other partnership modules.
 *
 *   GET   /categories, /categories/:id                  `partnerships` view
 *   POST  /categories, PATCH /categories/:id            edit + partnerships.configure (retire, restore)
 *   POST  /categories/:id/templates                     edit + configure: a template with its wording
 *   GET   /category-templates/:id                       view: the wording as the editor opens it
 *   PATCH /category-templates/:id                       edit + configure: name, default, retire
 *   PUT   /category-templates/:id/wording               edit + configure: the next version, and its asks
 *   POST  /categories/:id/checklist, PATCH /checklist-items/:id    edit + configure
 *   GET   /fields                                       view: every definition, whole
 *   POST  /fields, PATCH /fields/:id                    edit + configure
 *   GET   /lists/:list                                  view: stages, impacts, sources, document kinds
 *   POST  /lists/:list, PATCH /lists/:list/:code        edit + configure
 *   POST  /setup/from-tracker, /setup/from-tracker/apply   edit + configure: Start From Tracker
 *
 * tests/unit/partnerships-skeleton.test.js holds every route here to the partnerships key.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./partner_pipeline.controller");

const router = express.Router();
const p = c.partner_pipeline;
const view = requirePermission("partnerships", "view");
const edit = requirePermission("partnerships", "edit");
const configure = requireCapability("partnerships.configure");

route(router, "get", "/categories",
  { query: p.CategoryListQuery, response: p.CategoryPage, summary: "Partnership categories" },
  view, controller.listCategories);

route(router, "get", "/categories/:id",
  { params: c.common.IdParams, response: p.CategoryDetail, summary: "One category with its templates, checklist and fields" },
  view, controller.getCategory);

route(router, "post", "/categories",
  { body: p.CategoryCreate, response: p.CategoryDetail, summary: "Add a category" },
  edit, configure, controller.createCategory);

route(router, "patch", "/categories/:id",
  { params: c.common.IdParams, body: p.CategoryUpdate, response: p.CategoryDetail, summary: "Change, retire or restore a category" },
  edit, configure, controller.updateCategory);

route(router, "post", "/categories/:id/templates",
  { params: c.common.IdParams, body: p.CategoryTemplateCreate, response: p.CategoryDetail, summary: "Add an agreement template with its wording" },
  edit, configure, controller.addTemplate);

route(router, "get", "/category-templates/:id",
  { params: c.common.IdParams, response: p.CategoryTemplateDetail, summary: "An agreement template with its wording" },
  view, controller.getTemplate);

route(router, "patch", "/category-templates/:id",
  { params: c.common.IdParams, body: p.CategoryTemplateUpdate, response: p.CategoryDetail, summary: "Rename, make the default, retire or restore a template" },
  edit, configure, controller.updateTemplate);

route(router, "put", "/category-templates/:id/wording",
  { params: c.common.IdParams, body: p.TemplateWordingSave, response: p.CategoryTemplateDetail, summary: "Save a template's wording as its next version" },
  edit, configure, controller.saveTemplateWording);

route(router, "post", "/categories/:id/checklist",
  { params: c.common.IdParams, body: p.ChecklistItemCreate, response: p.CategoryDetail, summary: "Add a delivery checklist item" },
  edit, configure, controller.addChecklistItem);

route(router, "patch", "/checklist-items/:id",
  { params: c.common.IdParams, body: p.ChecklistItemUpdate, response: p.CategoryDetail, summary: "Change, move or retire a checklist item" },
  edit, configure, controller.updateChecklistItem);

route(router, "get", "/fields",
  { query: p.FieldListQuery, response: p.FieldList, summary: "The custom fields" },
  view, controller.listFields);

route(router, "post", "/fields",
  { body: p.FieldCreate, response: p.Field, summary: "Add a custom field" },
  edit, configure, controller.createField);

route(router, "patch", "/fields/:id",
  { params: c.common.IdParams, body: p.FieldUpdate, response: p.Field, summary: "Change, retire or restore a custom field" },
  edit, configure, controller.updateField);

route(router, "get", "/lists/:list",
  { params: p.ListParams, response: p.ListValues, summary: "One of the partnership lists" },
  view, controller.getList);

route(router, "post", "/lists/:list",
  { params: p.ListParams, body: p.ListValueCreate, response: p.ListValues, summary: "Add a value to a list" },
  edit, configure, controller.addListValue);

route(router, "patch", "/lists/:list/:code",
  { params: p.ListValueParams, body: p.ListValueUpdate, response: p.ListValues, summary: "Change, move, retire or restore a value" },
  edit, configure, controller.updateListValue);

route(router, "post", "/setup/from-tracker",
  { body: p.TrackerSetup, response: p.TrackerSetupDraft, summary: "Read the stages, types and impacts a tracker offers" },
  edit, configure, controller.readTracker);

route(router, "post", "/setup/from-tracker/apply",
  { body: p.TrackerSetupApply, response: p.SetupResult, summary: "Set up the lists from the tracker, as corrected" },
  edit, configure, controller.applyTracker);

module.exports = { basePath: "/partnerships", surface: "staff", router };

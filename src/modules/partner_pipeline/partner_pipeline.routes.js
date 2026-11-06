"use strict";
/**
 * Partnerships · the pipeline (docs/guides/partnerships.md §5), mounted on /api/v1/partnerships beside
 * the other partnership modules:
 *
 *   GET   /pipeline                    view: Pipeline's figures, bars, longest at a stage, stalled
 *   GET   /deals, /deals/:id           view: deals the reader may see (§6.1)
 *   POST  /deals                       create: New Deal, on a partner (or a lead without one)
 *   PATCH /deals/:id                   edit: Edit Deal
 *   POST  /deals/:id/stage             edit: the stage switcher (§6.5); a signed meaning converts a lead
 *   POST  /deals/:id/health            edit: Set Health; Stalled needs blockers
 *   GET   /deals/:id/returns           view and partnerships.money: a deal's months
 *   PUT   /deals/:id/returns/:month    edit and partnerships.money: Enter Returns
 *   GET   /categories                  view: the categories a form picks from, 25 a page
 *   GET   /fields                      view: the custom field definitions, whole
 *   GET   /lists/:list                 view: one of MyCity's lists, whole (stages with meanings)
 *
 * Categories, fields and lists are written on Categories (M7 PR 2); tests/unit/
 * partnerships-skeleton.test.js holds every route here to the partnerships key.
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./partner_pipeline.controller");

const pp = c.partner_pipeline;
const view = () => requirePermission("partnerships", "view");
const create = () => requirePermission("partnerships", "create");
const edit = () => requirePermission("partnerships", "edit");
const money = () => requireCapability("partnerships.money");

route(router, "get", "/pipeline", { query: pp.PipelineQuery, response: pp.PipelineSummary, summary: "Pipeline's figures within the reader's scope" }, view(), controller.pipeline);

route(router, "get", "/deals", { query: pp.DealListQuery, response: pp.DealPage, summary: "Deals the reader may see" }, view(), controller.list);
route(router, "get", "/deals/:id", { params: c.common.IdParams, response: pp.DealDetail, summary: "One deal, whole" }, view(), controller.get);
route(router, "post", "/deals", { body: pp.DealCreate, response: pp.DealDetail, summary: "New Deal" }, create(), controller.create);
route(router, "patch", "/deals/:id", { params: c.common.IdParams, body: pp.DealUpdate, response: pp.DealDetail, summary: "Edit a deal" }, edit(), controller.update);
route(router, "post", "/deals/:id/stage", { params: c.common.IdParams, body: pp.StageMove, response: pp.DealDetail, summary: "Move a deal to another stage" }, edit(), controller.move);
route(router, "post", "/deals/:id/health", { params: c.common.IdParams, body: pp.HealthSet, response: pp.DealDetail, summary: "Set a deal's health" }, edit(), controller.health);
route(router, "get", "/deals/:id/returns", { params: c.common.IdParams, query: pp.ReturnListQuery, response: pp.ReturnPage, summary: "A deal's months of returns" }, view(), money(), controller.returns);
route(router, "put", "/deals/:id/returns/:month", { params: pp.ReturnParams, body: pp.ReturnSave, response: pp.DealReturn, summary: "Enter a month of a deal's returns" }, edit(), money(), controller.saveReturn);

route(router, "get", "/categories", { query: pp.CategoryListQuery, response: pp.CategoryPage, summary: "The partnership categories" }, view(), controller.categories);
route(router, "get", "/fields", { query: pp.FieldListQuery, response: pp.FieldList, summary: "The custom field definitions" }, view(), controller.fields);
route(router, "get", "/lists/:list", { params: pp.ListParams, response: pp.ListValues, summary: "One of MyCity's partnership lists" }, view(), controller.list_values);

module.exports = { basePath: "/partnerships", surface: "staff", router };

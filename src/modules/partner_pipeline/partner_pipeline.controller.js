"use strict";
/**
 * Partnerships · the pipeline: the HTTP edge (docs/guides/partnerships.md §5) for Categories (M7 PR 2:
 * categories, templates, checklists, custom fields, MyCity's lists, Start From Tracker) and for deals,
 * Pipeline and returns (M7 PR 3). Reads need `partnerships` view; Categories' writes need edit and
 * `partnerships.configure`, checked on the route. A deal's scope comes from the `partnerships` grant
 * (§6.1); money from `partnerships.money`, checked on the route and in the service.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./partner_pipeline.service");
const stages = require("./partner_pipeline.stages");
const health = require("./partner_pipeline.health");
const returns = require("./partner_pipeline.returns");

const id = (req) => req.validated.params.id;

module.exports = {
  listCategories: async (req, res) => sendPaged(res, await service.listCategories(req.validated.query, scopeOf(req))),
  getCategory: async (req, res) => ok(res, await service.getCategory(id(req), scopeOf(req))),
  createCategory: async (req, res) => created(res, await service.createCategory(withActor(req), req.validated.body, scopeOf(req))),
  updateCategory: async (req, res) => ok(res, await service.updateCategory(withActor(req), id(req), req.validated.body, scopeOf(req))),

  getTemplate: async (req, res) => ok(res, await service.getTemplate(id(req))),
  addTemplate: async (req, res) => created(res, await service.addTemplate(withActor(req), id(req), req.validated.body, scopeOf(req))),
  updateTemplate: async (req, res) => ok(res, await service.updateTemplate(withActor(req), id(req), req.validated.body, scopeOf(req))),
  saveTemplateWording: async (req, res) => ok(res, await service.saveTemplateWording(withActor(req), id(req), req.validated.body)),

  addChecklistItem: async (req, res) => created(res, await service.addChecklistItem(withActor(req), id(req), req.validated.body, scopeOf(req))),
  updateChecklistItem: async (req, res) => ok(res, await service.updateChecklistItem(withActor(req), id(req), req.validated.body, scopeOf(req))),

  listFields: async (req, res) => ok(res, await service.listFields(req.validated.query)),
  createField: async (req, res) => created(res, await service.createField(withActor(req), req.validated.body)),
  updateField: async (req, res) => ok(res, await service.updateField(withActor(req), id(req), req.validated.body)),

  getList: async (req, res) => ok(res, await service.getList(req.validated.params.list)),
  listSuggestions: async (req, res) => sendPaged(res, await service.listSuggestions(req.validated.params.list, req.validated.query)),
  addListValue: async (req, res) => created(res, await service.addListValue(withActor(req), req.validated.params.list, req.validated.body)),
  updateListValue: async (req, res) => {
    const { list, code } = req.validated.params;
    ok(res, await service.updateListValue(withActor(req), list, code, req.validated.body));
  },

  readTracker: async (req, res) => ok(res, await service.readTracker(withActor(req), req.validated.body)),
  applyTracker: async (req, res) => ok(res, await service.applyTracker(withActor(req), req.validated.body)),

  pipeline: async (req, res) => ok(res, await service.pipeline(req.validated.query, scopeOf(req))),
  listDeals: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  getDeal: async (req, res) => ok(res, await service.get(id(req), scopeOf(req), req.user)),
  createDeal: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  updateDeal: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  moveStage: async (req, res) => ok(res, await stages.move(withActor(req), scopeOf(req), id(req), req.validated.body)),
  setHealth: async (req, res) => ok(res, await health.set(withActor(req), scopeOf(req), id(req), req.validated.body)),
  returns: async (req, res) => sendPaged(res, await returns.page(id(req), req.validated.query, scopeOf(req))),
  saveReturn: async (req, res) =>
    ok(res, await returns.save(withActor(req), scopeOf(req), id(req), req.validated.params.month, req.validated.body)),
};

"use strict";
// search:none deals arrive with M7 PR 3; the categories are found by partner_pipeline.search.js
/**
 * Partnerships · Categories: the HTTP edge (docs/guides/partnerships.md §5). Reads need `partnerships`
 * view; every write needs edit and the `partnerships.configure` capability, checked on the route.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./partner_pipeline.service");

const id = (req) => req.validated.params.id;

module.exports = {
  listCategories: async (req, res) => sendPaged(res, await service.listCategories(req.validated.query)),
  getCategory: async (req, res) => ok(res, await service.getCategory(id(req))),
  createCategory: async (req, res) => created(res, await service.createCategory(withActor(req), req.validated.body)),
  updateCategory: async (req, res) => ok(res, await service.updateCategory(withActor(req), id(req), req.validated.body)),

  getTemplate: async (req, res) => ok(res, await service.getTemplate(id(req))),
  addTemplate: async (req, res) => created(res, await service.addTemplate(withActor(req), id(req), req.validated.body)),
  updateTemplate: async (req, res) => ok(res, await service.updateTemplate(withActor(req), id(req), req.validated.body)),
  saveTemplateWording: async (req, res) => ok(res, await service.saveTemplateWording(withActor(req), id(req), req.validated.body)),

  addChecklistItem: async (req, res) => created(res, await service.addChecklistItem(withActor(req), id(req), req.validated.body)),
  updateChecklistItem: async (req, res) => ok(res, await service.updateChecklistItem(withActor(req), id(req), req.validated.body)),

  listFields: async (req, res) => ok(res, await service.listFields(req.validated.query)),
  createField: async (req, res) => created(res, await service.createField(withActor(req), req.validated.body)),
  updateField: async (req, res) => ok(res, await service.updateField(withActor(req), id(req), req.validated.body)),

  getList: async (req, res) => ok(res, await service.getList(req.validated.params.list)),
  addListValue: async (req, res) => created(res, await service.addListValue(withActor(req), req.validated.params.list, req.validated.body)),
  updateListValue: async (req, res) => {
    const { list, code } = req.validated.params;
    ok(res, await service.updateListValue(withActor(req), list, code, req.validated.body));
  },

  readTracker: async (req, res) => ok(res, await service.readTracker(withActor(req), req.validated.body)),
  applyTracker: async (req, res) => ok(res, await service.applyTracker(withActor(req), req.validated.body)),
};

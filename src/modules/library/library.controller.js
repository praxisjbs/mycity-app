"use strict";
/**
 * The Document Centre: the HTTP edge (docs/guides/document-centre.md §5). Who sees which document,
 * and who may change a company document, is the service's; nothing here decides.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./library.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.user)),
  summary: async (req, res) => ok(res, await service.summary(req.user)),
  get: async (req, res) => ok(res, await service.get(id(req), req.user)),
  filters: async (req, res) => ok(res, await service.filters(req.user)),

  create: async (req, res) => created(res, await service.create(body(req), withActor(req))),
  update: async (req, res) => ok(res, await service.update(id(req), body(req), withActor(req))),
  addVersion: async (req, res) => created(res, await service.addVersion(id(req), body(req), withActor(req))),
  archive: async (req, res) => ok(res, await service.archive(id(req), withActor(req))),
  restore: async (req, res) => ok(res, await service.restore(id(req), withActor(req))),

  categories: async (req, res) => sendPaged(res, await service.listCategories(req.validated.query, req.user)),
  category: async (req, res) => ok(res, await service.getCategory(id(req), req.user)),
  createCategory: async (req, res) => created(res, await service.createCategory(body(req), withActor(req))),
  updateCategory: async (req, res) => ok(res, await service.updateCategory(id(req), body(req), withActor(req))),
  archiveCategory: async (req, res) => ok(res, await service.archiveCategory(id(req), withActor(req))),
  restoreCategory: async (req, res) => ok(res, await service.restoreCategory(id(req), withActor(req))),

  tags: async (req, res) => sendPaged(res, await service.tags(req.validated.query, req.user)),
  letterhead: async (req, res) => res.status(202).json(await service.requestLetterhead(body(req), withActor(req))),
};

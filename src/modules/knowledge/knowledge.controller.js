"use strict";
/**
 * The SOPs' HTTP layer (docs/guides/knowledge.md §5): reads the request, calls the service, answers.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./knowledge.service");
const draft = require("./knowledge.draft");

const id = (req) => req.validated.params.id;
const q = (req) => req.validated.query;
const body = (req) => req.validated.body;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.user, q(req))),
  forScreen: async (req, res) => sendPaged(res, await service.forScreen(q(req))),
  departments: async (req, res) => sendPaged(res, await service.departments(req.user, q(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), body(req))),
  draftWithAi: async (req, res) => ok(res, await draft.suggest(withActor(req), body(req))),
  version: async (req, res) => ok(res, await service.version(req.user, id(req))),
  get: async (req, res) => ok(res, await service.get(req.user, id(req))),
  saveDraft: async (req, res) => ok(res, await service.saveDraft(withActor(req), id(req), body(req))),
  discardDraft: async (req, res) => ok(res, await service.discardDraft(withActor(req), id(req))),
  publish: async (req, res) => ok(res, await service.publish(withActor(req), id(req), body(req))),
  archive: async (req, res) => ok(res, await service.archive(withActor(req), id(req), body(req))),
  versions: async (req, res) => sendPaged(res, await service.versions(req.user, id(req), q(req))),
};

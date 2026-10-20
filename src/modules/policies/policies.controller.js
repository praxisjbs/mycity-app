"use strict";
/**
 * Policies' HTTP layer (docs/guides/policies.md §5): reads the request, calls the service, answers.
 */
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./policies.service");
const tidy = require("./policies.tidy");

const id = (req) => req.validated.params.id;
const q = (req) => req.validated.query;
const body = (req) => req.validated.body;

module.exports = {
  mine: async (req, res) => sendPaged(res, await service.mine(req.user, q(req))),
  due: async (req, res) => ok(res, await service.due(req.user)),
  myVersion: async (req, res) => ok(res, await service.myVersion(req.user, id(req))),
  acknowledge: async (req, res) => ok(res, await service.acknowledge(withActor(req), id(req))),
  later: async (req, res) => ok(res, await service.later(withActor(req), id(req))),
  myPdf: async (req, res) => res.status(202).json(await service.requestPdf(withActor(req), id(req), { mine: true })),
  approve: async (req, res) => {
    await service.approve(withActor(req), id(req), body(req));
    return noContent(res);
  },
  reject: async (req, res) => {
    await service.reject(withActor(req), id(req), body(req));
    return noContent(res);
  },

  list: async (req, res) => sendPaged(res, await service.list(q(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), body(req))),
  tidy: async (req, res) => ok(res, await tidy.suggest(withActor(req), body(req))),
  get: async (req, res) => ok(res, await service.get(req.user, id(req))),
  saveDraft: async (req, res) => ok(res, await service.saveDraft(withActor(req), id(req), body(req))),
  discardDraft: async (req, res) => ok(res, await service.discardDraft(withActor(req), id(req))),
  publish: async (req, res) => ok(res, await service.publish(withActor(req), id(req), body(req))),
  submit: async (req, res) => ok(res, await service.submit(withActor(req), id(req), body(req))),
  recall: async (req, res) => ok(res, await service.recall(withActor(req), id(req), body(req))),
  archive: async (req, res) => ok(res, await service.archive(withActor(req), id(req), body(req))),
  versions: async (req, res) => sendPaged(res, await service.versions(id(req), q(req))),
  version: async (req, res) => ok(res, await service.version(id(req))),
  withdraw: async (req, res) => ok(res, await service.withdraw(withActor(req), id(req), body(req))),
  acknowledgements: async (req, res) =>
    sendPaged(res, await service.acknowledgements(id(req), q(req), scopeOf(req))),
  pdf: async (req, res) => res.status(202).json(await service.requestPdf(withActor(req), id(req))),
};

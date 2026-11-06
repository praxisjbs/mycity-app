"use strict";
/**
 * Vacancies: the HTTP edge for Recruitment · Vacancies (docs/guides/recruitment.md §5). Scope comes
 * from the `recruitment` grant (the hiring manager, guide §8), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./vacancies.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  suggested: async (req, res) => sendPaged(res, await service.suggested(req.validated.query, scopeOf(req))),
  settings: async (req, res) => ok(res, await service.settings(req.user)),
  saveSettings: async (req, res) => ok(res, await service.saveSettings(withActor(req), scopeOf(req), req.validated.body)),
  assistStatus: async (_req, res) => ok(res, await require("./vacancies.draft").status()),
  assist: async (req, res) => ok(res, await service.assist(req.user, req.validated.body)),
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  publish: async (req, res) => ok(res, await service.publish(withActor(req), scopeOf(req), id(req))),
  pause: async (req, res) => ok(res, await service.pause(withActor(req), scopeOf(req), id(req))),
  resume: async (req, res) => ok(res, await service.resume(withActor(req), scopeOf(req), id(req))),
  close: async (req, res) => ok(res, await service.close(withActor(req), scopeOf(req), id(req), req.validated.body)),
  saveQuestions: async (req, res) =>
    ok(res, await service.saveQuestions(withActor(req), scopeOf(req), id(req), req.validated.body)),
  saveScorecard: async (req, res) =>
    ok(res, await service.saveScorecard(withActor(req), scopeOf(req), id(req), req.validated.body)),
  suggestQuestions: async (req, res) => ok(res, await service.suggestQuestions(req.user, scopeOf(req), id(req))),
};

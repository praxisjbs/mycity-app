"use strict";
/**
 * Interviews: the HTTP edge for Recruitment · Interviews (docs/guides/recruitment.md §5). Scope comes
 * from the `recruitment` grant (the vacancy's hiring manager, guide §8), and a seat on a panel is read
 * from the reader's own employee record, never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const service = require("./interviews.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.user, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  cv: async (req, res) => vault.serve(req, res, await service.cv(id(req), req.user, scopeOf(req))),
  schedule: async (req, res) => created(res, await service.schedule(withActor(req), scopeOf(req), req.validated.body)),
  reschedule: async (req, res) => ok(res, await service.reschedule(withActor(req), scopeOf(req), id(req), req.validated.body)),
  cancel: async (req, res) => ok(res, await service.cancel(withActor(req), scopeOf(req), id(req), req.validated.body)),
  saveFeedback: async (req, res) => ok(res, await service.saveFeedback(withActor(req), scopeOf(req), id(req), req.validated.body)),
  submitFeedback: async (req, res) => ok(res, await service.submitFeedback(withActor(req), scopeOf(req), id(req))),
  close: async (req, res) => ok(res, await service.close(withActor(req), scopeOf(req), id(req))),
  details: async (req, res) => ok(res, await service.details(withActor(req), scopeOf(req), id(req), req.validated.body)),
  report: async (req, res) => ok(res, await service.report(withActor(req), scopeOf(req), id(req), req.validated.body)),
  tidy: async (req, res) => ok(res, await service.tidy(req.user, req.validated.body)),
};

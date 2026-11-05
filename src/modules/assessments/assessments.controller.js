"use strict";
/**
 * Assessments: the HTTP edge for Recruitment · Assessments and its Sittings
 * (docs/guides/recruitment.md §5). Scope comes from the `recruitment` grant (the vacancy's hiring
 * manager, guide §8), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const authoring = require("./assessments.authoring");
const service = require("./assessments.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await authoring.list(req.validated.query)),
  summary: async (req, res) => ok(res, await authoring.summary(scopeOf(req))),
  get: async (req, res) => ok(res, await authoring.get(id(req))),
  create: async (req, res) => created(res, await authoring.create(withActor(req), req.validated.body)),
  update: async (req, res) => ok(res, await authoring.update(withActor(req), id(req), req.validated.body)),
  saveQuestions: async (req, res) => ok(res, await authoring.saveQuestions(withActor(req), id(req), req.validated.body)),
  activate: async (req, res) => ok(res, await authoring.activate(withActor(req), id(req))),
  deactivate: async (req, res) => ok(res, await authoring.deactivate(withActor(req), id(req))),
  assist: async (req, res) => ok(res, await authoring.assist(req.user, scopeOf(req), req.validated.body)),
  exportOf: async (req, res) => {
    const file = await authoring.exportOf(id(req));
    const name = file.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "assessment";
    res.set("Content-Disposition", `attachment; filename="${name}.json"`);
    return ok(res, file);
  },
  importFrom: async (req, res) => created(res, await authoring.importFrom(withActor(req), req.validated.body)),
  sittings: async (req, res) => sendPaged(res, await service.sittings(req.validated.query, scopeOf(req))),
  sitting: async (req, res) => ok(res, await service.sitting(id(req), req.user, scopeOf(req))),
  send: async (req, res) => created(res, await service.send(withActor(req), scopeOf(req), req.validated.body)),
  sendBulk: async (req, res) => ok(res, await service.sendBulk(withActor(req), scopeOf(req), req.validated.body)),
  mark: async (req, res) => ok(res, await service.mark(withActor(req), scopeOf(req), id(req), req.validated.body)),
  cancel: async (req, res) => ok(res, await service.cancel(withActor(req), scopeOf(req), id(req))),
};

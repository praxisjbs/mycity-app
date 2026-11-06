"use strict";
/**
 * Candidates: the HTTP edge for Recruitment · Candidates and Candidate Emails
 * (docs/guides/recruitment.md §5). Scope comes from the `recruitment` grant (the vacancy's hiring
 * manager, guide §8), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const service = require("./candidates.service");

const id = (req) => req.validated.params.id;
const key = (req) => req.validated.params.key;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  cv: async (req, res) => vault.serve(req, res, await service.cv(id(req), scopeOf(req))),
  move: async (req, res) => ok(res, await service.move(withActor(req), scopeOf(req), id(req), req.validated.body)),
  notProgressed: async (req, res) =>
    ok(res, await service.notProgressed(withActor(req), scopeOf(req), id(req), req.validated.body)),
  reopen: async (req, res) => ok(res, await service.reopen(withActor(req), scopeOf(req), id(req))),
  score: async (req, res) => ok(res, await service.requestScore(withActor(req), scopeOf(req), id(req))),
  scoreAll: async (req, res) => ok(res, await service.scoreAll(withActor(req), scopeOf(req), req.validated.body)),
  invite: async (req, res) => created(res, await service.invite(withActor(req), scopeOf(req), req.validated.body)),
  emails: async (req, res) => sendPaged(res, await service.emails(req.user)),
  email: async (req, res) => ok(res, await service.email(key(req), req.user)),
  saveEmail: async (req, res) => ok(res, await service.saveEmail(withActor(req), scopeOf(req), key(req), req.validated.body)),
  restoreEmail: async (req, res) => ok(res, await service.restoreEmail(withActor(req), scopeOf(req), key(req))),
};

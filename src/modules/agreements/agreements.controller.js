"use strict";
/**
 * Agreements: the HTTP edge (docs/guides/partnerships.md §5). Reads need `partnerships` view; writes
 * edit (Generate Agreement create), within the reader's scope: an agreement follows its deal (§6.1).
 * Tidy With AI serves the template editor (M7 PR 2, §6.8). The assistant reads through agreements.ai.js;
 * search through agreements.search.js.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const tidy = require("./agreements.tidy");
const service = require("./agreements.service");

const id = (req) => req.validated.params.id;

module.exports = {
  tidy: async (req, res) => ok(res, await tidy.tidy(req.user, req.validated.body)),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  renewals: async (req, res) => sendPaged(res, await service.renewals(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), scopeOf(req), withActor(req))),
  document: async (req, res) => vault.serve(req, res, await service.documentOf(id(req), scopeOf(req))),
  generate: async (req, res) => created(res, await service.generate(withActor(req), scopeOf(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  submit: async (req, res) => ok(res, await service.submit(withActor(req), scopeOf(req), id(req))),
  send: async (req, res) => ok(res, await service.send(withActor(req), scopeOf(req), id(req), req.validated.body)),
  resend: async (req, res) => ok(res, await service.resend(withActor(req), scopeOf(req), id(req))),
  signedCopy: async (req, res) => ok(res, await service.signedCopy(withActor(req), scopeOf(req), id(req), req.validated.body)),
  renew: async (req, res) => created(res, await service.renew(withActor(req), scopeOf(req), id(req), req.validated.body)),
  close: async (req, res) => ok(res, await service.close(withActor(req), scopeOf(req), id(req), req.validated.body)),
};

"use strict";
/**
 * Offers: the HTTP edge for Recruitment · Offers (docs/guides/offers.md §5). Scope comes from the
 * `recruitment` grant (the vacancy's hiring manager, guide §8); the company's signer is read from the
 * signed-in user, never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const service = require("./offers.service");

const id = (req) => req.validated.params.id;
/** What a signature's evidence keeps of the request (the Signature Certificate). */
const meta = (req) => ({ ip: req.ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 400) });

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.user, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  draft: async (req, res) => ok(res, await service.draft(req.validated.query.application_id, req.user, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), scopeOf(req), id(req), req.validated.body)),
  submit: async (req, res) => ok(res, await service.submit(withActor(req), scopeOf(req), id(req))),
  sign: async (req, res) => ok(res, await service.sign(withActor(req), scopeOf(req), id(req), req.validated.body, meta(req))),
  send: async (req, res) => ok(res, await service.send(withActor(req), scopeOf(req), id(req))),
  resend: async (req, res) => ok(res, await service.resend(withActor(req), scopeOf(req), id(req))),
  changeEmail: async (req, res) => ok(res, await service.changeEmail(withActor(req), scopeOf(req), id(req), req.validated.body)),
  withdraw: async (req, res) => ok(res, await service.withdraw(withActor(req), scopeOf(req), id(req), req.validated.body)),
  document: async (req, res) => vault.serve(req, res, await service.documentOf(id(req), scopeOf(req))),
  settings: async (_req, res) => ok(res, await service.settings()),
  saveSignatory: async (req, res) => ok(res, await service.saveSignatory(withActor(req), req.validated.body)),
  letter: async (_req, res) => ok(res, await service.letterTemplate()),
  saveLetter: async (req, res) => ok(res, await service.saveLetter(withActor(req), req.validated.body)),
  restoreLetter: async (req, res) => ok(res, await service.restoreLetter(withActor(req))),
};

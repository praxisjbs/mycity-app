"use strict";
/**
 * Employment contracts: the HTTP edge (docs/guides/offers.md §5). Scope comes from the
 * `recruitment` grant (the vacancy's hiring manager, guide §8); the company's signer is read from
 * the signed-in user, never from the request.
 */
const { ok } = require("../../shared/http/respond");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const service = require("./employment_contracts.service");

const id = (req) => req.validated.params.id;
/** What a signature's evidence keeps of the request (the Signature Certificate). */
const meta = (req) => ({ ip: req.ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 400) });

module.exports = {
  get: async (req, res) => ok(res, await service.get(id(req), req.user, scopeOf(req))),
  sign: async (req, res) => ok(res, await service.sign(withActor(req), scopeOf(req), id(req), req.validated.body, meta(req))),
  resend: async (req, res) => ok(res, await service.resend(withActor(req), scopeOf(req), id(req))),
  reissue: async (req, res) => ok(res, await service.reissue(withActor(req), scopeOf(req), id(req))),
  document: async (req, res) => vault.serve(req, res, await service.documentOf(id(req), scopeOf(req))),
  template: async (_req, res) => ok(res, await service.template()),
  saveTemplate: async (req, res) => ok(res, await service.saveTemplate(withActor(req), req.validated.body)),
  restoreTemplate: async (req, res) => ok(res, await service.restoreTemplate(withActor(req))),
};

"use strict";
// ai:none a login is account administration; the assistant answers about people from organisation
/**
 * Settings · Users: the HTTP edge.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./users.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (_req, res) => ok(res, await service.summary()),
  candidates: async (req, res) =>
    sendPaged(res, await service.candidates(req.validated.query)),
  get: async (req, res) => ok(res, await service.get(id(req))),
  invite: async (req, res) =>
    created(res, await service.invite(req.validated.body, withActor(req))),
  resendInvite: async (req, res) =>
    ok(res, await service.resendInvite(id(req), withActor(req))),
  setRoles: async (req, res) =>
    ok(res, await service.setRoles(id(req), req.validated.body.role_codes, withActor(req))),
  suspend: async (req, res) =>
    ok(res, await service.suspend(id(req), req.validated.body.reason, withActor(req))),
  reactivate: async (req, res) =>
    ok(res, await service.reactivate(id(req), withActor(req))),
  sendResetLink: async (req, res) =>
    ok(res, await service.sendResetLink(id(req), withActor(req))),
  endSessions: async (req, res) =>
    ok(res, await service.endSessions(id(req), withActor(req))),
  resetTwoStep: async (req, res) =>
    ok(res, await service.resetTwoStep(id(req), withActor(req))),
};

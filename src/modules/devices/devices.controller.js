"use strict";
/**
 * Devices: the HTTP edge for ESS · My Devices (the caller's own, `self`) and People ·
 * Devices (within the `people` scope). The device a person registers is the session's,
 * so no route takes a device identifier from the client.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./devices.service");

const id = (req) => req.validated.params.id;

module.exports = {
  listMine: async (req, res) =>
    sendPaged(res, await service.listMine(req.user, req.validated.query)),

  registerMine: async (req, res) =>
    created(
      res,
      await service.registerMine(withActor(req), req.validated.body),
    ),

  removeMine: async (req, res) =>
    ok(res, await service.removeMine(withActor(req), id(req))),

  list: async (req, res) =>
    sendPaged(res, await service.list(req.validated.query, scopeOf(req))),

  get: async (req, res) => ok(res, await service.getFor(id(req), scopeOf(req))),

  remove: async (req, res) =>
    ok(
      res,
      await service.removeFor(
        withActor(req),
        scopeOf(req),
        id(req),
        req.validated.body,
      ),
    ),
};

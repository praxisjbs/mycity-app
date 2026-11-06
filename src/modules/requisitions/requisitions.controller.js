"use strict";
/**
 * Requisitions: the HTTP edge for Expenses · Requisitions. Holders of `expenses.finance` group and
 * read them, the CEO among them; whoever a requisition's stage names removes a request from it.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./requisitions.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.user)),

  get: async (req, res) => ok(res, await service.get(req.user, id(req))),

  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),

  remove: async (req, res) => ok(res, await service.remove(withActor(req), id(req), req.validated.body)),
};

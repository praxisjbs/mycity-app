"use strict";
/**
 * Calendar: the HTTP edge for My Workspace · Calendar (docs/guides/workspace.md §5).
 * A calendar is always the caller's own: the employee comes from the session, never
 * from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./calendar.service");

const id = (req) => req.validated.params.id;
const me = (req) => req.user.employee_id;

module.exports = {
  month: async (req, res) => sendPaged(res, await service.month(me(req), req.validated.query)),
  get: async (req, res) => ok(res, await service.getFor(id(req), me(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  edit: async (req, res) => ok(res, await service.edit(withActor(req), id(req), req.validated.body)),
  cancel: async (req, res) => ok(res, await service.cancel(withActor(req), id(req))),
  respond: async (req, res) => ok(res, await service.respond(withActor(req), id(req), req.validated.body)),
};

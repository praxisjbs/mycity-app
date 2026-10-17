"use strict";
/**
 * Attendance: the HTTP edge. The person's own clock and records (`self`, the session's
 * employee: no route under /me or /punches takes an employee id), and People's register
 * within the `people` scope (scopeOf). A punch's device is the session's and its time
 * is the server's; the controller passes neither from the request body.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const { pool } = require("../../config/db");
const service = require("./attendance.service");

const q = (req) => req.validated.query || {};
const id = (req) => req.validated.params.id;
const masked = (req, data) => maskForUser(pool, req.user, data);

module.exports = {
  today: async (req, res) => ok(res, await service.today(req.user)),

  punch: async (req, res) =>
    created(
      res,
      await service.punch(withActor(req), req.validated.body, {
        idempotencyKey: String(req.headers["idempotency-key"] || "").trim() || null,
      }),
    ),

  myDays: async (req, res) => sendPaged(res, await service.myDays(req.user, q(req))),

  mySummary: async (req, res) => ok(res, await service.mySummary(req.user, q(req))),

  myEvents: async (req, res) => sendPaged(res, await service.myEvents(req.user, q(req))),

  myExceptions: async (req, res) => sendPaged(res, await service.myExceptions(req.user, q(req))),

  myRecord: async (req, res) => ok(res, await service.myRecord(req.user, id(req))),

  explain: async (req, res) => ok(res, await service.explain(withActor(req), id(req), req.validated.body)),

  myExport: async (req, res) => ok(res, await service.requestMyExport(withActor(req), req.validated.body)),

  register: async (req, res) => sendPaged(res, await masked(req, await service.register(q(req), scopeOf(req)))),

  summary: async (req, res) => ok(res, await service.summary(q(req), scopeOf(req))),

  day: async (req, res) =>
    ok(res, await masked(req, await service.dayDetail(req.validated.params.employee_id, q(req), scopeOf(req)))),

  events: async (req, res) => sendPaged(res, await service.events(q(req), scopeOf(req))),

  exceptions: async (req, res) => sendPaged(res, await masked(req, await service.exceptions(q(req), scopeOf(req)))),

  record: async (req, res) => ok(res, await service.recordFor(id(req), scopeOf(req))),

  decide: async (req, res) =>
    ok(res, await service.decide(withActor(req), scopeOf(req), id(req), req.validated.body)),

  export: async (req, res) => ok(res, await service.requestRegisterExport(withActor(req), req.validated.body)),
};

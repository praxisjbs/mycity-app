"use strict";
/**
 * Attendance: the HTTP edge. The person's own clock and records (`self`, the session's
 * employee: no route under /me or /punches takes an employee id), and People's register
 * within the `people` scope (scopeOf). A punch's device is the session's and its time
 * is the server's; the controller passes neither from the request body.
 */
const { ok, created, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const { pool } = require("../../config/db");
const service = require("./attendance.service");
const homes = require("./attendance.home");
const requests = require("./attendance.requests");
const assignments = require("./attendance.assignments");
const schedules = require("./attendance.schedule");

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

  explainAutomatic: async (req, res) =>
    created(res, await service.explainAutomatic(withActor(req), id(req), req.validated.body)),

  myExport: async (req, res) => accepted(res, await service.requestMyExport(withActor(req), req.validated.body)),

  myHome: async (req, res) => ok(res, await homes.mine(req.user)),

  requestHome: async (req, res) => created(res, await homes.request(withActor(req), req.validated.body)),

  myRequests: async (req, res) => sendPaged(res, await requests.mine(req.user, q(req))),

  requestLocation: async (req, res) => created(res, await requests.request(withActor(req), req.validated.body)),

  myRequest: async (req, res) => ok(res, await requests.getMine(req.user, id(req))),

  cancelRequest: async (req, res) => ok(res, await requests.cancel(withActor(req), id(req), req.validated.body)),

  register: async (req, res) => sendPaged(res, await masked(req, await service.register(q(req), scopeOf(req)))),

  summary: async (req, res) => ok(res, await service.summary(q(req), scopeOf(req))),

  day: async (req, res) =>
    ok(res, await masked(req, await service.dayDetail(req.validated.params.employee_id, q(req), scopeOf(req)))),

  events: async (req, res) => sendPaged(res, await service.events(q(req), scopeOf(req))),

  exceptions: async (req, res) => sendPaged(res, await masked(req, await service.exceptions(q(req), scopeOf(req)))),

  record: async (req, res) => ok(res, await service.recordFor(id(req), scopeOf(req))),

  decide: async (req, res) =>
    ok(res, await service.decide(withActor(req), scopeOf(req), id(req), req.validated.body)),

  homes: async (req, res) => sendPaged(res, await masked(req, await homes.list(q(req), scopeOf(req)))),

  home: async (req, res) => ok(res, await masked(req, await homes.get(id(req), scopeOf(req)))),

  decideHome: async (req, res) =>
    ok(res, await masked(req, await homes.decide(withActor(req), scopeOf(req), id(req), req.validated.body))),

  requests: async (req, res) =>
    sendPaged(res, await masked(req, await requests.list(req.user, q(req), scopeOf(req)))),

  request: async (req, res) => ok(res, await masked(req, await requests.get(req.user, id(req), scopeOf(req)))),

  myAssignments: async (req, res) => sendPaged(res, await assignments.mine(req.user, q(req))),

  myAssignment: async (req, res) => ok(res, await assignments.getMine(req.user, id(req))),

  assignments: async (req, res) => sendPaged(res, await assignments.list(req.user, q(req), scopeOf(req))),

  assignment: async (req, res) => ok(res, await assignments.get(req.user, id(req), scopeOf(req))),

  assign: async (req, res) => created(res, await assignments.create(withActor(req), req.validated.body, scopeOf(req))),

  cancelAssignment: async (req, res) =>
    ok(res, await assignments.cancel(withActor(req), id(req), req.validated.body, scopeOf(req))),

  removeFromAssignment: async (req, res) =>
    ok(res, await assignments.remove(withActor(req), id(req), req.validated.body, scopeOf(req))),

  schedule: async (req, res) => ok(res, await schedules.get(req.user, req.validated.params.employee_id, scopeOf(req))),

  setSchedule: async (req, res) =>
    created(
      res,
      await schedules.set(withActor(req), req.validated.params.employee_id, req.validated.body, scopeOf(req)),
    ),

  export: async (req, res) => accepted(res, await service.requestRegisterExport(withActor(req), req.validated.body)),












};

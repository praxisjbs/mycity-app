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
const { scopeFor } = require("../../middleware/rbac");
const { pool } = require("../../config/db");
const service = require("./attendance.service");
const homes = require("./attendance.home");
const requests = require("./attendance.requests");
const assignments = require("./attendance.assignments");
const schedules = require("./attendance.schedule");
const pay = require("./attendance.pay");
const sites = require("./attendance.sites");
const checkIns = require("./attendance.check-ins");

const q = (req) => req.validated.query || {};
const id = (req) => req.validated.params.id;
const masked = (req, data) => maskForUser(pool, req.user, data);

/** A pay item's amount is masked as the salary is, never on the reader's own (field-mask.js). */
const maskedItem = (req, item) => (item.employee.employee_id === req.user.employee_id ? item : masked(req, item));
const maskedItems = async (req, page) => ({ ...page, data: await Promise.all(page.data.map((x) => maskedItem(req, x))) });

/**
 * Marks what the reader may decide now, as the decisions' own rules hold it (reconcile.decide,
 * home.decide): open (`state`), `people` approve over everyone, and never their own record.
 * Takes a page or one row.
 */
async function decidable(req, data, state) {
  const approve = await scopeFor(req.user, "people", "approve");
  const all = Boolean(approve && approve.scope === "all");
  const mark = (r) => ({ ...r, can_decide: all && r.status === state && r.employee.employee_id !== req.user.employee_id });
  return data && Array.isArray(data.data) ? { ...data, data: data.data.map(mark) } : mark(data);
}

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

  myRequest: async (req, res) => ok(res, await requests.getMine(req.user, id(req))),

  cancelRequest: async (req, res) => ok(res, await requests.cancel(withActor(req), id(req), req.validated.body)),

  register: async (req, res) => sendPaged(res, await masked(req, await service.register(q(req), scopeOf(req)))),

  summary: async (req, res) => ok(res, await service.summary(q(req), scopeOf(req))),

  day: async (req, res) =>
    ok(res, await masked(req, await service.dayDetail(req.validated.params.employee_id, q(req), scopeOf(req)))),

  events: async (req, res) => sendPaged(res, await service.events(q(req), scopeOf(req))),

  exceptions: async (req, res) =>
    sendPaged(res, await masked(req, await decidable(req, await service.exceptions(q(req), scopeOf(req)), "open"))),

  record: async (req, res) => ok(res, await service.recordFor(id(req), scopeOf(req))),

  decide: async (req, res) =>
    ok(res, await service.decide(withActor(req), scopeOf(req), id(req), req.validated.body)),

  homes: async (req, res) => sendPaged(res, await masked(req, await decidable(req, await homes.list(q(req), scopeOf(req)), "pending"))),

  home: async (req, res) => ok(res, await masked(req, await decidable(req, await homes.get(id(req), scopeOf(req)), "pending"))),

  decideHome: async (req, res) =>
    ok(res, await masked(req, await homes.decide(withActor(req), scopeOf(req), id(req), req.validated.body))),

  requests: async (req, res) =>
    sendPaged(res, await masked(req, await requests.list(req.user, q(req), scopeOf(req)))),

  request: async (req, res) => ok(res, await masked(req, await requests.get(req.user, id(req), scopeOf(req)))),

  myAssignments: async (req, res) => sendPaged(res, await assignments.mine(req.user, q(req))),

  myAssignment: async (req, res) => ok(res, await assignments.getMine(req.user, id(req))),

  assignments: async (req, res) => sendPaged(res, await assignments.list(req.user, q(req), scopeOf(req))),

  assignment: async (req, res) => ok(res, await assignments.get(req.user, id(req), scopeOf(req))),

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

  mySchedule: async (req, res) => ok(res, await schedules.mine(req.user)),

  myPayItems: async (req, res) => sendPaged(res, await pay.mine(req.user, q(req))),

  payItems: async (req, res) => sendPaged(res, await maskedItems(req, await pay.list(req.user, q(req), scopeOf(req)))),

  waive: async (req, res) => {
    const out = await pay.waive(withActor(req), scopeOf(req), req.validated.body);
    ok(res, { ...out, waived: await Promise.all(out.waived.map((x) => maskedItem(req, x))) });
  },

  decideOvertime: async (req, res) =>
    ok(res, await maskedItem(req, await pay.decideOvertime(withActor(req), scopeOf(req), id(req), req.validated.body))),

  approveOvertime: async (req, res) =>
    created(res, await pay.approveOvertime(withActor(req), scopeOf(req), req.validated.body)),

  export: async (req, res) => accepted(res, await service.requestRegisterExport(withActor(req), req.validated.body)),

  // Temporary sites and check-ins (PR 4). The person's own read their own Temporary Home unmasked.
  mySites: async (req, res) => sendPaged(res, await sites.mine(req.user, q(req))),

  submitSite: async (req, res) => created(res, await sites.submit(withActor(req), req.validated.body)),

  mySite: async (req, res) => ok(res, await sites.getMine(req.user, id(req))),

  withdrawSite: async (req, res) => ok(res, await sites.withdraw(withActor(req), id(req), req.validated.body)),

  checkIn: async (req, res) =>
    created(
      res,
      await checkIns.checkIn(withActor(req), req.validated.body, {
        idempotencyKey: String(req.headers["idempotency-key"] || "").trim() || null,
      }),
    ),

  myCheckIns: async (req, res) => sendPaged(res, await checkIns.mine(req.user, q(req))),

  sites: async (req, res) => sendPaged(res, await masked(req, await sites.list(req.user, q(req), scopeOf(req)))),

  site: async (req, res) => ok(res, await masked(req, await sites.get(req.user, id(req), scopeOf(req)))),

  addSite: async (req, res) => created(res, await masked(req, await sites.add(withActor(req), req.validated.body, scopeOf(req)))),

  cancelSite: async (req, res) =>
    ok(res, await masked(req, await sites.cancel(withActor(req), id(req), req.validated.body, scopeOf(req)))),

  removeFromSite: async (req, res) =>
    ok(res, await masked(req, await sites.remove(withActor(req), id(req), req.validated.body, scopeOf(req)))),

  checkIns: async (req, res) => sendPaged(res, await masked(req, await checkIns.list(q(req), scopeOf(req)))),
};

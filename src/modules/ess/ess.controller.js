"use strict";
// search:none the tabs are found by name through the screen catalogue (⌘K screens); a record inside ESS is the caller's own copy of a record its own module already answers for
/**
 * Employee Self-Service: the HTTP edge. Every handler reads the employee from
 * the session (`req.user`), never from the request.
 */
const { ok, created, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./ess.service");

const id = (req) => req.validated.params.id;

module.exports = {
  listDocuments: async (req, res) =>
    sendPaged(res, await service.documents.list(req.user, req.validated.query)),

  documentSummary: async (req, res) =>
    ok(res, await service.documents.summary(req.user)),

  addDocument: async (req, res) =>
    created(
      res,
      await service.documents.add(
        withActor(req),
        readUpload(req),
        req.validated.body || {},
      ),
    ),

  profile: async (req, res) => ok(res, await service.profile.get(req.user)),

  updateProfile: async (req, res) =>
    ok(res, await service.profile.update(withActor(req), req.validated.body)),

  setPhoto: async (req, res) =>
    ok(res, await service.profile.setPhoto(withActor(req), readUpload(req))),

  removePhoto: async (req, res) => ok(res, await service.profile.removePhoto(withActor(req))),

  exportData: async (req, res) => accepted(res, await service.data.requestOwn(withActor(req))),

  profileHistory: async (req, res) =>
    sendPaged(res, await service.profile.history(req.user, req.validated.query)),

  listLeave: async (req, res) =>
    sendPaged(res, await service.leave.list(req.user, req.validated.query)),

  leaveCalendar: async (req, res) =>
    sendPaged(res, await service.leave.calendar(req.user, req.validated.query)),
  leaveBalances: async (req, res) =>
    ok(res, await service.leave.balances(req.user, req.validated.query || {})),

  getLeave: async (req, res) => ok(res, await service.leave.get(req.user, id(req))),

  requestLeave: async (req, res) =>
    created(res, await service.leave.request(withActor(req), req.validated.body)),

  cancelLeave: async (req, res) =>
    ok(res, await service.leave.cancel(withActor(req), id(req), req.validated.body || {})),

  performance: async (req, res) => ok(res, await service.performance.overview(req.user)),
  checkIn: async (req, res) => ok(res, await service.performance.checkIn(req.user)),
  saveCheckIn: async (req, res) => ok(res, await service.performance.saveCheckIn(withActor(req), req.validated.body)),
  submitCheckIn: async (req, res) => ok(res, await service.performance.submitCheckIn(withActor(req))),
  dictateCheckIn: async (req, res) =>
    ok(res, await service.performance.dictate(withActor(req), req.validated.body || {}, readUpload(req))),
  addEvidence: async (req, res) =>
    created(res, await service.performance.addEvidence(withActor(req), readUpload(req), req.validated.body)),
  myReviews: async (req, res) => sendPaged(res, await service.performance.myReviews(req.user, req.validated.query)),

  listQueries: async (req, res) => sendPaged(res, await service.queries.list(req.user, req.validated.query)),

  listSanctions: async (req, res) => sendPaged(res, await service.queries.listSanctions(req.user, req.validated.query)),

  respondToQuery: async (req, res) =>
    ok(res, await service.queries.respond(withActor(req), id(req), req.validated.body)),
};

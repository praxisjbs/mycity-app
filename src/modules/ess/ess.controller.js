"use strict";
// search:none the tabs are found by name through the screen catalogue (⌘K screens); a record inside ESS is the caller's own copy of a record its own module already answers for
/**
 * Employee Self-Service: the HTTP edge. Every handler reads the employee from
 * the session (`req.user`), never from the request.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./ess.service");

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
};

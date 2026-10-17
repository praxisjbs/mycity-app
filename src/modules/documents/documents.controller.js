"use strict";
// ai:none a document is a file, and the assistant never opens one; what a document says about a person is read through that person's own module
// search:none a document is found from the record it belongs to; who may open one is decided per document by the vault (shared/documents/vault.js canRead), which no single search query can express
/**
 * Documents: the HTTP edge. The bytes are streamed by the service through the
 * vault, so nothing here writes to the response itself except by handing it over.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./documents.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

module.exports = {
  upload: async (req, res) =>
    created(res, await service.stage(readUpload(req), body(req), withActor(req))),

  get: async (req, res) => ok(res, await service.get(req.user, id(req))),

  content: async (req, res) =>
    service.serve(req, res, { documentId: id(req), inline: true }),

  variant: async (req, res) =>
    service.serve(req, res, {
      documentId: id(req),
      variantKind: req.validated.params.kind,
    }),

  versions: async (req, res) =>
    sendPaged(res, await service.versions(req.user, id(req), req.validated.query)),

  addVersion: async (req, res) =>
    created(
      res,
      await service.addVersion(withActor(req), id(req), readUpload(req), body(req)),
    ),

  verify: async (req, res) =>
    ok(res, await service.verify(withActor(req), id(req))),

  employeeDocuments: async (req, res) =>
    sendPaged(
      res,
      await service.listFor(
        service.withinScope(id(req), req),
        req.validated.query,
      ),
    ),

  employeeSummary: async (req, res) =>
    ok(res, await service.summaryFor(service.withinScope(id(req), req))),

  addEmployeeDocument: async (req, res) => {
    service.withinScope(id(req), req);
    return created(
      res,
      await service.addEmployeeDocument({
        employeeId: id(req),
        file: readUpload(req),
        body: body(req),
        actor: withActor(req),
        requestId: body(req).document_request_id,
      }),
    );
  },

  requestEmployeeDocument: async (req, res) => {
    service.withinScope(id(req), req);
    return created(
      res,
      await service.requestDocument(id(req), body(req), withActor(req)),
    );
  },
};

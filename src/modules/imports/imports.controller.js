"use strict";
/**
 * Imports: the HTTP edge. The two spreadsheet routes answer with a file, so they
 * set the download headers themselves; everything else is JSON.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const { contentDisposition } = require("../../shared/files/safe-name");
const service = require("./imports.service");

const id = (req) => req.validated.params.id;
const body = (req) => req.validated.body || {};

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Send a workbook as a download. */
function sendWorkbook(res, { buffer, filename }) {
  res.set({
    "Content-Type": XLSX,
    "Content-Length": String(buffer.length),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(filename, { inline: false }),
  });
  return res.send(buffer);
}

module.exports = {
  importers: async (req, res) => ok(res, await service.importers(req.user)),

  template: async (req, res) =>
    sendWorkbook(res, await service.template(req.user, req.validated.params.key)),

  create: async (req, res) =>
    created(res, await service.create(readUpload(req), body(req), withActor(req))),

  get: async (req, res) => ok(res, await service.get(req.user, id(req))),

  setMapping: async (req, res) =>
    ok(res, await service.setMapping(id(req), body(req), withActor(req))),

  preview: async (req, res) =>
    ok(res, await service.preview(id(req), body(req), withActor(req))),

  commit: async (req, res) =>
    ok(res, await service.commit(id(req), body(req), withActor(req))),

  revert: async (req, res) => ok(res, await service.revert(id(req), withActor(req))),

  rows: async (req, res) =>
    sendPaged(res, await service.rows(req.user, id(req), req.validated.query)),

  report: async (req, res) =>
    sendWorkbook(res, await service.errorFile(req.user, id(req))),

  history: async (req, res) =>
    sendPaged(res, await service.history(req.validated.query)),
};

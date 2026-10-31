"use strict";
// search:none a handful of letters, listed whole on Letter Templates, which ⌘K finds by name
// ai:none letter wording is configuration; questions about a query or sanction are answered by queries.ai.js and sanctions.ai.js
/**
 * Letter Templates: the HTTP edge (docs/guides/queries.md §5). Every route needs the
 * `queries` grant; writes also need `queries.configure` (templates.routes.js).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./templates.service");

const id = (req) => req.validated.params.id;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (_req, res) => ok(res, await service.summary()),
  get: async (req, res) => ok(res, await service.get(id(req))),
  preview: async (req, res) => ok(res, await service.preview(id(req))),
  previewPdf: async (req, res) => {
    const { pdf, filename } = await service.previewPdf(id(req), req.user);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w .-]/g, "")}"`,
      "Cache-Control": "no-store",
    });
    res.send(pdf);
  },
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  saveBody: async (req, res) => ok(res, await service.saveBody(withActor(req), id(req), req.validated.body)),
  activate: async (req, res) => ok(res, await service.activate(withActor(req), id(req))),
  deactivate: async (req, res) => ok(res, await service.deactivate(withActor(req), id(req))),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), req.validated.body)),
  assistStatus: async (_req, res) => ok(res, await require("./templates.assist").status()),
  assist: async (req, res) => ok(res, await require("./templates.assist").draft(req.user, req.validated.body)),
};

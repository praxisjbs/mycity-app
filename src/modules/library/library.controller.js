"use strict";
/**
 * The Document Centre's Library: the HTTP edge (docs/guides/document-centre.md §5). Who sees which
 * document is the service's, from the vault's own rule; nothing here decides.
 */
// ai:none file: Praxis AI's read of the library arrives with the Document Centre's PR 2 (guide §9); a file itself is never opened by the assistant
const { ok } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const service = require("./library.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.user)),
  summary: async (req, res) => ok(res, await service.summary(req.user)),
  get: async (req, res) => ok(res, await service.get(req.validated.params.id, req.user)),
  filters: async (req, res) => ok(res, await service.filters(req.user)),
};

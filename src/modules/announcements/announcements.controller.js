"use strict";
// search:none announcements are found through community.search.js
// ai:none the announcements reads are declared in community.ai.js
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const service = require("./announcements.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  stats: async (req, res) => ok(res, await service.stats()),
  create: async (req, res) => created(res, await service.create(req.validated.body, req.user)),
  update: async (req, res) => ok(res, await service.update(req.validated.params.id, req.validated.body, req.user)),
  cancel: async (req, res) => ok(res, await service.cancel(req.validated.params.id, req.user)),
  readers: async (req, res) => sendPaged(res, await service.readers(req.validated.params.id, req.validated.query)),
  remind: async (req, res) => ok(res, await service.remind(req.validated.params.id, req.user)),
};

"use strict";
/**
 * Knowledge Hub · User Guide: the HTTP edge (docs/guides/user-guide.md §5). A search and a
 * question arrive in the body and are never logged or kept (§6.1 decision 12).
 */
const { pool } = require("../../config/db");
const { ok } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./user_guide.service");

module.exports = {
  contents: async (req, res) => ok(res, await service.contents(pool, req.user)),
  chapter: async (req, res) => ok(res, await service.chapter(pool, req.user, req.validated.params.slug)),
  quickStart: async (req, res) => ok(res, await service.quickStart(pool, req.user)),
  image: async (req, res) => {
    const file = await service.image(pool, req.user, req.validated.params);
    res.set("Cache-Control", "private, max-age=3600");
    res.type("png").sendFile(file);
  },
  search: async (req, res) => sendPaged(res, await service.search(pool, req.user, req.validated.body)),
  answer: async (req, res) => ok(res, await service.answer(pool, req.user, req.validated.body)),
  transcribe: async (req, res) => ok(res, await service.transcribe(readUpload(req), withActor(req))),
};

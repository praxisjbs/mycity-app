"use strict";
// ai:none the assistant answers how-to questions from the guide in M10 (docs/guides/praxis-ai.md); nothing here is a record it reads
/**
 * Knowledge Hub · User Guide: the HTTP edge (docs/guides/user-guide.md §5).
 */
const { pool } = require("../../config/db");
const { ok } = require("../../shared/http/respond");
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
};

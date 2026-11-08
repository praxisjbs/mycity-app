"use strict";
/**
 * /api/public/v1/help: the public site's Help page on go.mycityapp.io (docs/guides/user-guide.md
 * §6.11). No sign-in: the one chapter written for people outside MyCity (`kind: public-help`,
 * docs/manual/public-site.md), whole, and the pictures it names.
 *
 *   GET /               the chapter: its sections, steps, notes, tables and pictures
 *   GET /images/:file   one of its pictures (`<shot>.<desktop|phone>.png`)
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { ok } = require("../../shared/http/respond");
const chapters = require("./user_guide.chapters");

const router = express.Router();

publicRoute(router, "get", "/",
  { response: c.user_guide.GuideChapter, summary: "The public site's Help" },
  async (req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    ok(res, chapters.publicHelp());
  });

publicRoute(router, "get", "/images/:file",
  { params: c.user_guide.PublicHelpImageParams, no_content: true, summary: "A picture of the public site's Help" },
  async (req, res) => {
    const file = chapters.publicImage(req.validated.params.file);
    res.set("Cache-Control", "public, max-age=3600");
    res.type("png").sendFile(file);
  });

module.exports = { basePath: "/help", surface: "public", router };

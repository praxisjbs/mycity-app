"use strict";
/**
 * /api/public/v1/apply: the Apply form on go.mycityapp.io (docs/guides/recruitment.md §5, §6.2). No
 * sign-in, no permission: the single-use Apply link is the key (middleware/public-token.js), and
 * every answer is an allow-list (candidates.apply.js). Writes are held to the public surface's
 * write limit.
 *
 *   GET  /:token      the role, its questions, when the link lapses
 *   POST /:token/cv   the CV (PDF or Word, at most 10 MB), quarantined until scanned
 *   POST /:token      the application; answers only a reference
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { requirePublicToken } = require("../../middleware/public-token");
const upload = require("../../middleware/upload");
const { ok, created } = require("../../shared/http/respond");
const apply = require("./candidates.apply");

const router = express.Router();
const k = c.candidates;

publicRoute(router, "get", "/:token",
  { response: k.ApplyLink, summary: "An Apply link: the role and its questions" },
  requirePublicToken(apply.SCOPE),
  async (req, res) => ok(res, await apply.link(req.public_token)));

publicRoute(router, "post", "/:token/cv",
  { body: c.common.EmptyBody, response: c.documents.DocumentRef, summary: "Send a CV for an application" },
  requirePublicToken(apply.SCOPE),
  upload.single("file", { purpose: "cv" }),
  async (req, res) => created(res, await apply.uploadCv(req.public_token, upload.readUpload(req))));

publicRoute(router, "post", "/:token",
  { body: k.ApplicationSubmit, response: k.ApplicationReceipt, summary: "Apply for a role" },
  requirePublicToken(apply.SCOPE),
  async (req, res) => created(res, await apply.submit(req.params.token, req.validated.body)));

module.exports = { basePath: "/apply", surface: "public", router };

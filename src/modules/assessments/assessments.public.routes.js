"use strict";
/**
 * /api/public/v1/assess: an assessment on go.mycityapp.io (docs/guides/recruitment.md §5, §6.7). No
 * sign-in, no permission: the link is the key (middleware/public-token.js) and every answer is an
 * allow-list (assessments.delivery.js). Writes are held to the public surface's write limit.
 *
 *   GET  /:token                                 where the sitting stands, with the server's clock
 *   POST /:token/start, /:token/submit           the clock starts; the end
 *   PUT  /:token/answers/:question_id            an answer as it is given (409 TIME_UP after due_at)
 *   POST /:token/answers/:question_id/file       a file answer, at most 25 MB, quarantined
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { requirePublicToken } = require("../../middleware/public-token");
const upload = require("../../middleware/upload");
const { ok } = require("../../shared/http/respond");
const delivery = require("./assessments.delivery");
const { SCOPE } = require("./assessments.events");

const router = express.Router();
const a = c.assessments;
const link = requirePublicToken(SCOPE);

publicRoute(router, "get", "/:token", { response: a.AssessmentSession, summary: "An assessment link: where it stands" },
  link, async (req, res) => ok(res, await delivery.session(req.params.token)));

publicRoute(router, "post", "/:token/start", { body: c.common.EmptyBody, response: a.AssessmentSession, summary: "Start the assessment" },
  link, async (req, res) => ok(res, await delivery.start(req.params.token)));

publicRoute(router, "put", "/:token/answers/:question_id",
  { params: a.AnswerParams, body: a.AnswerSave, response: a.AnswerSaved, summary: "Save an answer" },
  link, async (req, res) => ok(res, await delivery.answer(req.params.token, req.validated.params.question_id, req.validated.body)));

publicRoute(router, "post", "/:token/answers/:question_id/file",
  { params: a.AnswerParams, body: c.common.EmptyBody, response: a.AnswerFileSaved, summary: "Send a file as an answer" },
  link, upload.single("file", { purpose: "assessment_answer" }),
  async (req, res) => ok(res, await delivery.answerFile(req.params.token, req.validated.params.question_id, upload.readUpload(req))));

publicRoute(router, "post", "/:token/submit", { body: c.common.EmptyBody, response: a.AssessmentSession, summary: "Submit the assessment" },
  link, async (req, res) => ok(res, await delivery.submit(req.params.token)));

module.exports = { basePath: "/assess", surface: "public", router };

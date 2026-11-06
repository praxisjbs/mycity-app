"use strict";
/**
 * /api/v1/recruitment/candidates: Recruitment · Candidates and Candidate Emails
 * (docs/guides/recruitment.md §5). `:id` is the application.
 *
 *   GET  /, /summary, /:id, /:id/cv          `recruitment` view, scope by the vacancy's hiring manager
 *   POST /:id/move, /:id/not-progressed, /:id/reopen   `recruitment` edit: the pipeline
 *   POST /:id/score, /score-all              `recruitment` edit: Score With AI, Screen With AI (queued)
 *   POST /invitations                        `recruitment` create: Invite to Apply
 *   GET  /emails, /emails/:key               `recruitment` view: Candidate Emails
 *   PUT  /emails/:key, POST /emails/:key/restore   `recruitment` edit
 *
 * Apply is candidates.public.routes.js (/api/public/v1/apply).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./candidates.controller");

const router = express.Router();
const k = c.candidates;
const byId = { params: c.common.IdParams };
const byKey = { params: k.CandidateEmailParams };

route(router, "get", "/",
  { query: k.CandidateListQuery, response: k.CandidatePage, summary: "The Candidates board" },
  requirePermission("recruitment", "view"), controller.list);

route(router, "get", "/summary",
  { query: k.CandidateSummaryQuery, response: k.CandidatesSummary, summary: "The figures above the board" },
  requirePermission("recruitment", "view"), controller.summary);

route(router, "get", "/emails",
  { query: k.CandidateEmailListQuery, response: k.CandidateEmailPage, summary: "The five candidate emails" },
  requirePermission("recruitment", "view"), controller.emails);

route(router, "get", "/emails/:key",
  { ...byKey, response: k.CandidateEmail, summary: "One candidate email" },
  requirePermission("recruitment", "view"), controller.email);

route(router, "put", "/emails/:key",
  { ...byKey, body: k.CandidateEmailSave, response: k.CandidateEmail, summary: "Save a candidate email's wording" },
  requirePermission("recruitment", "edit"), controller.saveEmail);

route(router, "post", "/emails/:key/restore",
  { ...byKey, body: c.common.EmptyBody, response: k.CandidateEmail, summary: "Restore a candidate email's default wording" },
  requirePermission("recruitment", "edit"), controller.restoreEmail);

route(router, "post", "/score-all",
  { body: k.ScoreAll, response: k.ScoreAllQueued, summary: "Screen With AI: read every unscored application of a role" },
  requirePermission("recruitment", "edit"), controller.scoreAll);

route(router, "post", "/invitations",
  { body: k.ApplyInvite, response: k.ApplyInviteSent, summary: "Invite someone to apply" },
  requirePermission("recruitment", "create"), controller.invite);

route(router, "get", "/:id",
  { ...byId, response: k.CandidateDetail, summary: "One candidate" },
  requirePermission("recruitment", "view"), controller.get);

route(router, "get", "/:id/cv",
  { ...byId, no_content: true, summary: "The candidate's CV, once it has been checked" },
  requirePermission("recruitment", "view"), controller.cv);

route(router, "post", "/:id/move",
  { ...byId, body: k.CandidateMove, response: k.CandidateDetail, summary: "Move a candidate to another stage" },
  requirePermission("recruitment", "edit"), controller.move);

route(router, "post", "/:id/not-progressed",
  { ...byId, body: k.CandidateNotProgressed, response: k.CandidateDetail, summary: "Stop a candidate, with a reason" },
  requirePermission("recruitment", "edit"), controller.notProgressed);

route(router, "post", "/:id/reopen",
  { ...byId, body: c.common.EmptyBody, response: k.CandidateDetail, summary: "Put a stopped candidate back at their stage" },
  requirePermission("recruitment", "edit"), controller.reopen);

route(router, "post", "/:id/score",
  { ...byId, body: c.common.EmptyBody, response: k.CandidateDetail, summary: "Score With AI: read this application" },
  requirePermission("recruitment", "edit"), controller.score);

module.exports = { basePath: "/recruitment/candidates", surface: "staff", router };

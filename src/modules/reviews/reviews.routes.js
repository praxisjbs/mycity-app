"use strict";
/**
 * /api/v1/performance: monthly rounds, reviews, Tidy and improvement plans
 * (docs/guides/performance.md §5). The service decides which part of a review a reader sees and
 * whether they are its reviewer, dotted manager, second level or Operations & People; a route
 * checks the grant, and the capability where one is named.
 *
 *   GET   /rounds                        `performance` view: each with its reviews by stage
 *   POST  /rounds · /rounds/:id/close    create · edit, performance.manage: a late start; closing
 *   GET   /reviews · /reviews/:id        `performance` view · scope, and those naming the reader
 *   PUT   /reviews/:id/scores            the reviewer, after the check-in (409 CHECK_IN_FIRST)
 *   POST  /reviews/:id/submit            the reviewer: opens performance.review
 *   POST  /reviews/:id/return            the reviewer: the check-in back to the employee
 *   POST  /reviews/:id/ask-input · input the reviewer asks; the dotted manager gives
 *   POST  /reviews/:id/conduct           edit, performance.manage: caps the rating
 *   POST  /reviews/:id/probation-outcome approve, performance.manage: at HR's stage
 *   POST  /reviews/:id/items/:item_id/dictation  the reviewer's comment, the dotted manager's input
 *   POST  /tidy                          `performance` view: the writer of the text
 *   GET   /pips · POST /pips · PATCH /pips/:id · POST /pips/:id/close   view · scope; performance.manage
 *
 * Approving, Request Changes and Close Review are the approval's own routes
 * (POST /workflow/instances/:id/approve, reject), never a review route.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./reviews.controller");

const router = express.Router();
const r = c.reviews;
const view = requirePermission("performance", "view");

route(router, "get", "/rounds",
  { query: r.RoundListQuery, response: r.RoundPage, summary: "Monthly review rounds" },
  view, controller.listRounds);

route(router, "post", "/rounds",
  { body: r.RoundCreate, response: r.Round, summary: "Open a month's round by hand" },
  requirePermission("performance", "create"), requireCapability("performance.manage"), controller.createRound);

route(router, "post", "/rounds/:id/close",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.Round, summary: "Close a round" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.closeRound);

route(router, "get", "/reviews",
  { query: r.ReviewListQuery, response: r.ReviewPage, summary: "Reviews" },
  view, controller.list);

route(router, "get", "/reviews/:id",
  { params: c.common.IdParams, response: r.ReviewDetail, summary: "One review" },
  view, controller.get);

route(router, "put", "/reviews/:id/scores",
  { params: c.common.IdParams, body: r.ReviewScoresSave, response: r.ReviewDetail, summary: "Save a review's scores and actions" },
  view, controller.saveScores);

route(router, "post", "/reviews/:id/submit",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.ReviewDetail, summary: "Submit a review" },
  view, controller.submit);

route(router, "post", "/reviews/:id/return",
  { params: c.common.IdParams, body: r.ReturnCheckIn, response: r.Review, summary: "Return a check-in to the employee" },
  view, controller.returnCheckIn);

route(router, "post", "/reviews/:id/ask-input",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: r.ReviewDetail, summary: "Ask the dotted-line manager for input" },
  view, controller.askInput);

route(router, "post", "/reviews/:id/input",
  { params: c.common.IdParams, body: r.ReviewInput, response: r.ReviewDetail, summary: "Give input to a review" },
  view, controller.giveInput);

route(router, "post", "/reviews/:id/conduct",
  { params: c.common.IdParams, body: r.ConductMark, response: r.ReviewDetail, summary: "Mark a confirmed conduct breach" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.markConduct);

route(router, "post", "/reviews/:id/probation-outcome",
  { params: c.common.IdParams, body: r.ProbationOutcome, response: r.ReviewDetail, summary: "Choose a probation review's outcome" },
  requirePermission("performance", "approve"), requireCapability("performance.manage"), controller.probationOutcome);

route(router, "post", "/reviews/:id/items/:item_id/dictation",
  { params: r.ReviewItemParams, body: r.DictationRequest, response: r.Dictation, summary: "Dictate a review's comment or input" },
  view, upload.single("file", { purpose: "voice_note" }), controller.dictate);

route(router, "post", "/tidy",
  { body: r.TidyRequest, response: r.TidyResult, summary: "Tidy a check-in's or a review's text with AI" },
  view, controller.tidy);

route(router, "get", "/pips",
  { query: r.PipListQuery, response: r.PipPage, summary: "Improvement plans" },
  view, controller.listPips);

route(router, "post", "/pips",
  { body: r.PipCreate, response: r.Pip, summary: "Start an improvement plan" },
  requirePermission("performance", "create"), requireCapability("performance.manage"), controller.createPip);

route(router, "patch", "/pips/:id",
  { params: c.common.IdParams, body: r.PipEdit, response: r.Pip, summary: "Change an improvement plan" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.editPip);

route(router, "post", "/pips/:id/close",
  { params: c.common.IdParams, body: r.PipClose, response: r.Pip, summary: "Close an improvement plan" },
  requirePermission("performance", "edit"), requireCapability("performance.manage"), controller.closePip);

module.exports = { basePath: "/performance", surface: "staff", router };

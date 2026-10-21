"use strict";
/**
 * /api/v1/performance/cycles and /reviews: Performance · Reviews (A17;
 * docs/guides/performance.md §5).
 *
 *   GET  /cycles                     `performance` view
 *   POST /cycles                     `performance` create, reviews.cycles
 *   POST /cycles/:id/close           `performance` edit, reviews.cycles
 *   GET  /reviews, /reviews/summary  `performance` view · scope on the person reviewed
 *   GET  /reviews/:id                `performance` view: the employee, reviewer, second level, HR, CEO
 *   PUT  /reviews/:id                `performance` view: its reviewer, while a draft or returned
 *   POST /reviews/:id/submit         `performance` view: its reviewer; a manager review opens its approval
 *   POST /reviews/:id/decide         `performance` approve: the second level, then Operations & People
 *   POST /reviews/:id/dictation      `performance` view: its reviewer; multipart `file` (A18)
 *   GET  /analytics                  `performance` view · scope: Performance · Analytics
 *
 * Writing a review is the reviewer's own business, as My Review in ESS is the employee's, so
 * it asks only that the caller may use Performance; the service checks they are the reviewer.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./reviews.controller");

const router = express.Router();
const r = c.reviews;
const one = { params: c.common.IdParams };

route(router, "get", "/cycles",
  { query: r.CycleListQuery, response: r.CyclePage, summary: "Review cycles" },
  requirePermission("performance", "view"), controller.cycles);

route(router, "post", "/cycles",
  { body: r.CycleCreate, response: r.Cycle, summary: "Open a review cycle" },
  requirePermission("performance", "create"), requireCapability("reviews.cycles"), controller.createCycle);

route(router, "post", "/cycles/:id/close",
  { ...one, body: c.common.EmptyBody, response: r.Cycle, summary: "Close a review cycle" },
  requirePermission("performance", "edit"), requireCapability("reviews.cycles"), controller.closeCycle);

route(router, "get", "/reviews",
  { query: r.ReviewListQuery, response: r.ReviewPage, summary: "Review History" },
  requirePermission("performance", "view"), controller.list);

route(router, "get", "/reviews/summary",
  { response: r.ReviewsSummary, summary: "The current cycle's figures" },
  requirePermission("performance", "view"), controller.summary);

route(router, "get", "/reviews/:id",
  { ...one, response: r.ReviewDetail, summary: "One review, as the caller may read it" },
  requirePermission("performance", "view"), controller.get);

route(router, "put", "/reviews/:id",
  { ...one, body: r.ReviewSave, response: r.ReviewDetail, summary: "Save a review as a draft" },
  requirePermission("performance", "view"), controller.save);

route(router, "post", "/reviews/:id/submit",
  { ...one, body: c.common.EmptyBody, response: r.ReviewDetail, summary: "Hand in a review" },
  requirePermission("performance", "view"), controller.submit);

route(router, "post", "/reviews/:id/decide",
  { ...one, body: c.goals.DecideBody, response: r.ReviewDetail, summary: "Approve or return a review" },
  requirePermission("performance", "approve"), controller.decide);

route(router, "post", "/reviews/:id/dictation",
  { ...one, body: r.DictationRequest, response: r.Dictation, summary: "Dictate an answer" },
  requirePermission("performance", "view"), upload.single("file", { purpose: "voice_note" }), controller.dictate);

route(router, "get", "/analytics",
  { query: r.PerformanceAnalyticsQuery, response: r.PerformanceAnalytics, summary: "Performance Analytics" },
  requirePermission("performance", "view"), controller.analytics);

module.exports = { basePath: "/performance", surface: "staff", router };

"use strict";
/**
 * /api/v1/recruitment/assessments: Recruitment · Assessments and its Sittings
 * (docs/guides/recruitment.md §5, §6.7).
 *
 *   GET  /, /summary, /:id                    `recruitment` view: the library
 *   POST /, PATCH /:id, PUT /:id/questions    create; edit (questions fixed once sent)
 *   POST /:id/activate, /:id/deactivate       `recruitment` edit
 *   POST /assist                              `recruitment` edit: Suggest With AI, nothing kept
 *   GET  /:id/export, POST /import            `recruitment` export; create: one assessment as a file
 *   GET  /sittings, /sittings/:id             `recruitment` view, scope by the vacancy's hiring manager
 *   POST /sittings, /sittings/bulk            `recruitment` edit: Send, Send to Candidates
 *   PUT  /sittings/:id/marks, POST /sittings/:id/cancel   `recruitment` edit
 *
 * The candidate's side is assessments.public.routes.js (/api/public/v1/assess).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./assessments.controller");

const router = express.Router();
const a = c.assessments;
const byId = { params: c.common.IdParams };
const view = requirePermission("recruitment", "view");
const edit = requirePermission("recruitment", "edit");

route(router, "get", "/", { query: a.AssessmentListQuery, response: a.AssessmentPage, summary: "The assessment library" }, view, controller.list);
route(router, "get", "/summary", { response: a.AssessmentsSummary, summary: "The figures above Assessments" }, view, controller.summary);
route(router, "post", "/assist",
  { body: a.AssessmentDraftRequest, response: a.AssessmentDraft, summary: "Suggest questions; nothing is kept" }, edit, controller.assist);
route(router, "post", "/import",
  { body: a.AssessmentExport, response: a.AssessmentDetail, summary: "A new assessment from an exported file" },
  requirePermission("recruitment", "create"), controller.importFrom);

route(router, "get", "/sittings", { query: a.SittingListQuery, response: a.SittingPage, summary: "Sittings sent to candidates" }, view, controller.sittings);
route(router, "post", "/sittings", { body: a.SittingSend, response: a.SittingDetail, summary: "Send an assessment to a candidate" }, edit, controller.send);
route(router, "post", "/sittings/bulk",
  { body: a.SittingSendBulk, response: a.SittingSendBulkResult, summary: "Send to Candidates: one role at one stage" }, edit, controller.sendBulk);
route(router, "get", "/sittings/:id", { ...byId, response: a.SittingDetail, summary: "One sitting and its answers" }, view, controller.sitting);
route(router, "put", "/sittings/:id/marks", { ...byId, body: a.SittingMarks, response: a.SittingDetail, summary: "Mark written and file answers" }, edit, controller.mark);
route(router, "post", "/sittings/:id/cancel",
  { ...byId, body: c.common.EmptyBody, response: a.SittingDetail, summary: "Cancel a sitting not yet finished" }, edit, controller.cancel);

route(router, "post", "/", { body: a.AssessmentCreate, response: a.AssessmentDetail, summary: "New Assessment" },
  requirePermission("recruitment", "create"), controller.create);
route(router, "get", "/:id", { ...byId, response: a.AssessmentDetail, summary: "One assessment and its questions" }, view, controller.get);
route(router, "patch", "/:id", { ...byId, body: a.AssessmentEdit, response: a.AssessmentDetail, summary: "Change an assessment" }, edit, controller.update);
route(router, "put", "/:id/questions",
  { ...byId, body: a.AssessmentQuestionsSave, response: a.AssessmentDetail, summary: "Save an assessment's questions" }, edit, controller.saveQuestions);
route(router, "post", "/:id/activate", { ...byId, body: c.common.EmptyBody, response: a.AssessmentDetail, summary: "Switch an assessment on" }, edit, controller.activate);
route(router, "post", "/:id/deactivate", { ...byId, body: c.common.EmptyBody, response: a.AssessmentDetail, summary: "Switch an assessment off" }, edit, controller.deactivate);
route(router, "get", "/:id/export", { ...byId, response: a.AssessmentExport, summary: "One assessment as a file" },
  requirePermission("recruitment", "export"), controller.exportOf);

module.exports = { basePath: "/recruitment/assessments", surface: "staff", router };

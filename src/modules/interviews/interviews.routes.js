"use strict";
/**
 * /api/v1/recruitment/interviews: Recruitment · Interviews (docs/guides/recruitment.md §5, §6.6).
 *
 *   GET  /, /:id, /:id/cv               `recruitment` view: scope by the vacancy's hiring manager, or a
 *                                       seat on the panel; blind while the round is open
 *   POST /, PATCH /:id, POST /:id/cancel   `recruitment` edit: Schedule, Reschedule, Cancel
 *   PUT  /:id/feedback, POST /:id/feedback/submit   `recruitment` view and a seat on the panel: My Card
 *   POST /:id/close, PUT /:id/details   `recruitment` edit: Close Round, Candidate Details
 *   PUT  /:id/report                    `recruitment` view: edit in scope, or the vacancy's hiring manager
 *   POST /assist                        `recruitment` view: Tidy With AI, nothing kept
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./interviews.controller");

const router = express.Router();
const i = c.interviews;
const byId = { params: c.common.IdParams };
const view = requirePermission("recruitment", "view");
const edit = requirePermission("recruitment", "edit");

route(router, "get", "/", { query: i.InterviewListQuery, response: i.InterviewPage, summary: "Interviews the reader may see" }, view, controller.list);
route(router, "post", "/", { body: i.InterviewSchedule, response: i.InterviewDetail, summary: "Schedule an interview" }, edit, controller.schedule);
route(router, "post", "/assist", { body: i.NotesTidyRequest, response: i.NotesTidy, summary: "Tidy a card's comments; nothing is kept" }, view, controller.tidy);
route(router, "get", "/:id", { ...byId, response: i.InterviewDetail, summary: "One interview, blind while its round is open" }, view, controller.get);
route(router, "patch", "/:id", { ...byId, body: i.InterviewReschedule, response: i.InterviewDetail, summary: "Change an interview's time, place or panel" }, edit, controller.reschedule);
route(router, "post", "/:id/cancel", { ...byId, body: i.InterviewCancel, response: i.InterviewDetail, summary: "Cancel an interview" }, edit, controller.cancel);
route(router, "put", "/:id/feedback", { ...byId, body: i.FeedbackSave, response: i.InterviewDetail, summary: "Save my card as a draft" }, view, controller.saveFeedback);
route(router, "post", "/:id/feedback/submit", { ...byId, body: c.common.EmptyBody, response: i.InterviewDetail, summary: "Submit my card" }, view, controller.submitFeedback);
route(router, "post", "/:id/close", { ...byId, body: c.common.EmptyBody, response: i.InterviewDetail, summary: "Close the round" }, edit, controller.close);
route(router, "put", "/:id/details", { ...byId, body: i.RoundDetailsSave, response: i.InterviewDetail, summary: "Save the Candidate Details" }, edit, controller.details);
route(router, "put", "/:id/report", { ...byId, body: i.RoundReport, response: i.InterviewDetail, summary: "Write the consolidated report" }, view, controller.report);
route(router, "get", "/:id/cv", { ...byId, no_content: true, summary: "The candidate's CV, for the panel" }, view, controller.cv);

module.exports = { basePath: "/recruitment/interviews", surface: "staff", router };

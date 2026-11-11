"use strict";
/**
 * /api/v1/recruitment/vacancies: Recruitment · Vacancies (docs/guides/recruitment.md §5).
 *
 *   GET  /, /summary, /suggested, /:id      `recruitment` view, scope by hiring manager
 *   GET  /hiring-managers                   `recruitment` view: who may be a hiring manager (the picker)
 *   POST /                                  `recruitment` create: New Vacancy (draft, or published)
 *   PATCH /:id                              `recruitment` edit
 *   POST /:id/publish, /pause, /resume, /close   `recruitment` edit: the lifecycle
 *   PUT  /:id/questions, /:id/scorecard     `recruitment` edit
 *   GET, PUT /settings                      Careers Settings: view; edit
 *   GET, POST /assist, POST /assist/follow-ups, POST /:id/assist/questions   `recruitment` edit: Write With AI
 *                                           and New Vacancy's interview, nothing kept
 *
 * The careers page is vacancies.public.routes.js (/api/public/v1/jobs).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./vacancies.controller");

const router = express.Router();
const v = c.vacancies;
const byId = { params: c.common.IdParams };

route(router, "get", "/summary",
  { response: v.VacanciesSummary, summary: "The figures above Vacancies" },
  requirePermission("recruitment", "view"), controller.summary);

route(router, "get", "/suggested",
  { query: v.SeatSuggestionListQuery, response: v.SeatSuggestionPage, summary: "Vacant seats with no vacancy yet" },
  requirePermission("recruitment", "view"), controller.suggested);

route(router, "get", "/hiring-managers",
  { query: v.HiringManagerListQuery, response: v.HiringManagerPage, summary: "Who may be a vacancy's hiring manager" },
  requirePermission("recruitment", "view"), controller.hiringManagers);

route(router, "get", "/settings",
  { response: v.CareersSettings, summary: "Careers Settings: About MyCityApp and the Default Traits" },
  requirePermission("recruitment", "view"), controller.settings);

route(router, "put", "/settings",
  { body: v.CareersSettingsSave, response: v.CareersSettings, summary: "Save Careers Settings" },
  requirePermission("recruitment", "edit"), controller.saveSettings);

route(router, "get", "/assist",
  { response: c.queries.AiAvailability, summary: "Whether Write With AI may answer now" },
  requirePermission("recruitment", "edit"), controller.assistStatus);

route(router, "post", "/assist",
  { body: v.JdDraftRequest, response: v.JdDraft, summary: "Draft a job description; nothing is kept" },
  requirePermission("recruitment", "edit"), controller.assist);

route(router, "post", "/assist/follow-ups",
  { body: v.FollowUpsRequest, response: v.FollowUps, summary: "Two questions about the role for New Vacancy's interview; nothing is kept" },
  requirePermission("recruitment", "edit"), controller.followUps);

route(router, "get", "/",
  { query: v.VacancyListQuery, response: v.VacancyPage, summary: "Vacancies the reader may see" },
  requirePermission("recruitment", "view"), controller.list);

route(router, "get", "/:id",
  { ...byId, response: v.VacancyDetail, summary: "One vacancy" },
  requirePermission("recruitment", "view"), controller.get);

route(router, "post", "/",
  { body: v.VacancyCreate, response: v.VacancyDetail, summary: "New Vacancy" },
  requirePermission("recruitment", "create"), controller.create);

route(router, "patch", "/:id",
  { ...byId, body: v.VacancyEdit, response: v.VacancyDetail, summary: "Change a vacancy" },
  requirePermission("recruitment", "edit"), controller.update);

route(router, "post", "/:id/publish",
  { ...byId, body: c.common.EmptyBody, response: v.VacancyDetail, summary: "Put a draft live on the careers page" },
  requirePermission("recruitment", "edit"), controller.publish);

route(router, "post", "/:id/pause",
  { ...byId, body: c.common.EmptyBody, response: v.VacancyDetail, summary: "Stop taking applications for now; the link stays" },
  requirePermission("recruitment", "edit"), controller.pause);

route(router, "post", "/:id/resume",
  { ...byId, body: c.common.EmptyBody, response: v.VacancyDetail, summary: "Take applications again, on the same link" },
  requirePermission("recruitment", "edit"), controller.resume);

route(router, "post", "/:id/close",
  { ...byId, body: v.VacancyClose, response: v.VacancyDetail, summary: "Close a vacancy" },
  requirePermission("recruitment", "edit"), controller.close);

route(router, "put", "/:id/questions",
  { ...byId, body: v.VacancyQuestionsSave, response: v.VacancyDetail, summary: "Save the Apply questions and traits" },
  requirePermission("recruitment", "edit"), controller.saveQuestions);

route(router, "put", "/:id/scorecard",
  { ...byId, body: v.ScorecardSave, response: v.VacancyDetail, summary: "Save the scorecard parts" },
  requirePermission("recruitment", "edit"), controller.saveScorecard);

route(router, "post", "/:id/assist/questions",
  { ...byId, body: c.common.EmptyBody, response: v.QuestionsDraft, summary: "Suggest questions and traits; nothing is kept" },
  requirePermission("recruitment", "edit"), controller.suggestQuestions);

module.exports = { basePath: "/recruitment/vacancies", surface: "staff", router };

"use strict";
/**
 * /api/public/v1/jobs: the careers page on go.mycityapp.io (docs/guides/recruitment.md §5, §6.1).
 * No sign-in, no permission: a role is reached by its slug, and every answer is an allow-list
 * (vacancies.careers.js). Writes are held to the public surface's write limit.
 *
 *   GET  /              open roles taking applications, paged at 25, closing soonest first, by `q` and `department`
 *   GET  /summary       the public index's figures (a summary, not a list); before /:slug, and no slug is "summary"
 *   GET  /:slug         one role; a draft or an unknown slug is the same 404
 *   POST /:slug/apply   a single-use Apply link for the role, shown once
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { sendPaged } = require("../../shared/http/paged");
const { ok, created } = require("../../shared/http/respond");
const careers = require("./vacancies.careers");

const router = express.Router();
const v = c.vacancies;

publicRoute(router, "get", "/",
  { query: v.PublicJobListQuery, response: v.PublicJobPage, summary: "Open roles" },
  async (req, res) => sendPaged(res, await careers.list(req.validated.query)));

publicRoute(router, "get", "/summary",
  { response: v.PublicJobsSummary, summary: "Open roles in figures" },
  async (req, res) => ok(res, await careers.summary()));

publicRoute(router, "get", "/:slug",
  { params: v.SlugParams, response: v.PublicJob, summary: "One role" },
  async (req, res) => ok(res, await careers.get(req.validated.params.slug)));

publicRoute(router, "post", "/:slug/apply",
  { params: v.SlugParams, body: c.common.EmptyBody, response: v.ApplyStarted, summary: "Start an application" },
  async (req, res) => created(res, await careers.startApplication(req.validated.params.slug)));

module.exports = { basePath: "/jobs", surface: "public", router };

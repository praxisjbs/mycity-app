"use strict";
/**
 * Partnerships · agreements: generate, approve, sign, renew, close (docs/guides/partnerships.md §5).
 *
 * Mounted on /api/v1/partnerships beside the other partnership modules. M7 PR 2 serves Tidy With AI for
 * the template editor; the agreement's own routes arrive with PR 6 (the guide's Appendix A), each defined
 * with route(), its contract in packages/contract/schemas/agreements.js and
 * requirePermission("partnerships", <action>), with requireCapability after it where §5 names one.
 * tests/unit/partnerships-skeleton.test.js holds every route here to the partnerships key.
 *
 *   POST /templates/tidy      edit + partnerships.configure: pasted wording tidied, nothing kept
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./agreements.controller");

const router = express.Router();

route(router, "post", "/templates/tidy",
  { body: c.partner_pipeline.TemplateTidy, response: c.partner_pipeline.TemplateTidyDraft, summary: "Tidy pasted agreement wording and propose its fields; nothing is kept" },
  requirePermission("partnerships", "edit"), requireCapability("partnerships.configure"), controller.tidy);

module.exports = { basePath: "/partnerships", surface: "staff", router };

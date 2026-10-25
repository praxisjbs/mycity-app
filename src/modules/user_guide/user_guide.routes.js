"use strict";
/**
 * Knowledge Hub · User Guide (docs/guides/user-guide.md §5). Every route is the Knowledge Hub's
 * view grant; what each reader receives is cut to their own grants in the service.
 */
const router = require("express").Router();
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const c = require("@mycity/contract");
const controller = require("./user_guide.controller");

route(router, "get", "/",
  { response: c.user_guide.GuideContents, summary: "The chapters of the User Guide this person may read" },
  requirePermission("knowledge", "view"), controller.contents);

route(router, "get", "/quick-start",
  { response: c.user_guide.GuideChapter, summary: "The Quick Start's cards this person may follow" },
  requirePermission("knowledge", "view"), controller.quickStart);

route(router, "get", "/chapters/:slug",
  { params: c.user_guide.GuideChapterParams, response: c.user_guide.GuideChapter, summary: "One chapter of the User Guide, cut to this person" },
  requirePermission("knowledge", "view"), controller.chapter);

route(router, "get", "/images/:chapter/:file",
  { params: c.user_guide.GuideImageParams, no_content: true, summary: "A picture of the User Guide that a part this person may read shows" },
  requirePermission("knowledge", "view"), controller.image);

module.exports = { basePath: "/user-guide", surface: "staff", router };

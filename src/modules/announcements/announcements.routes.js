"use strict";
/**
 * Announcements routes (docs/guides/community.md §5), under /api/v1/community/announcements.
 * The tracking side: People and the CEO, who hold the announcements.post capability.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const {
  requirePermission,
  requireCapability,
} = require("../../middleware/rbac");
const controller = require("./announcements.controller");

const router = express.Router();
const an = c.announcements;
const poster = () => requireCapability("announcements.post");

route(
  router,
  "get",
  "/",
  {
    query: an.AnnouncementListQuery,
    response: an.AnnouncementPage,
    summary: "Announcements and their reads",
  },
  requirePermission("community", "view"),
  poster(),
  controller.list,
);
route(
  router,
  "get",
  "/stats",
  { response: an.AnnouncementStats, summary: "The tab's figures" },
  requirePermission("community", "view"),
  poster(),
  controller.stats,
);
route(
  router,
  "post",
  "/",
  {
    body: an.AnnouncementCreate,
    response: an.Announcement,
    summary: "Publish or schedule an announcement",
  },
  requirePermission("community", "create"),
  poster(),
  controller.create,
);
route(
  router,
  "put",
  "/:id",
  {
    body: an.AnnouncementUpdate,
    response: an.Announcement,
    summary: "Change a scheduled announcement",
  },
  requirePermission("community", "create"),
  poster(),
  controller.update,
);
route(
  router,
  "post",
  "/:id/cancel",
  {
    body: c.common.EmptyBody,
    response: an.Announcement,
    summary: "Cancel a scheduled announcement",
  },
  requirePermission("community", "create"),
  poster(),
  controller.cancel,
);
route(
  router,
  "post",
  "/:id/archive",
  {
    body: c.common.EmptyBody,
    response: an.Announcement,
    summary: "Take a published announcement down",
  },
  requirePermission("community", "create"),
  poster(),
  controller.archive,
);
route(
  router,
  "get",
  "/:id/reads",
  {
    query: an.AnnouncementReadQuery,
    response: an.AnnouncementReadPage,
    summary: "Who has and has not read an announcement",
  },
  requirePermission("community", "view"),
  poster(),
  controller.readers,
);
route(
  router,
  "post",
  "/:id/remind",
  {
    body: c.common.EmptyBody,
    response: an.RemindResult,
    summary: "Remind those who have not read it",
  },
  requirePermission("community", "view"),
  poster(),
  controller.remind,
);
// Anyone in an urgent announcement's audience acknowledges it; the service checks they are.
route(
  router,
  "post",
  "/:id/acknowledge",
  {
    body: c.common.EmptyBody,
    no_content: true,
    summary: "Acknowledge an urgent announcement",
  },
  requirePermission("community", "view"),
  controller.acknowledge,
);

module.exports = {
  basePath: "/community/announcements",
  surface: "staff",
  router,
};

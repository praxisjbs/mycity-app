"use strict";
// ai:none a person's own notices about other records; the assistant answers from those records' modules
// search:none the bell is read where it opens; its records are found through their own modules
/**
 * The bell: the HTTP edge. Every route is the caller's own (`self`).
 */
const { ok, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./notifications.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.user, req.validated.query)),
  unreadCount: async (req, res) => ok(res, await service.unreadCount(req.user)),
  badges: async (req, res) => ok(res, await service.badges(req.user)),
  markRead: async (req, res) => {
    await service.markRead(withActor(req), req.validated.params.id);
    noContent(res);
  },
  markAllRead: async (req, res) => {
    await service.markAllRead(withActor(req));
    noContent(res);
  },
};

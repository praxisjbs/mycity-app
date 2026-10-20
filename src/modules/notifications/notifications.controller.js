"use strict";
// ai:none a person's own notices about other records; the assistant answers from those records' modules
// search:none the bell is read where it opens; its records are found through their own modules
/**
 * The bell, preferences, quiet hours and devices: the HTTP edge. Those routes are the
 * caller's own (`self`), but for the two a service worker reaches with its device token.
 * Settings · Notifications (rules and reminders) sits behind `settings` in the routes.
 */
const { ok, noContent } = require("../../shared/http/respond");
const cookies = require("../identity/identity.cookies");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./notifications.service");
const rules = require("./notifications.rules");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.user, req.validated.query)),
  urgent: async (req, res) => sendPaged(res, await service.urgent(req.user, req.validated.query)),
  acknowledge: async (req, res) => ok(res, await service.acknowledge(withActor(req), req.validated.params.id)),
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
  readState: async (req, res) => ok(res, await service.readState(req.user, req.validated.query)),
  preferences: async (req, res) => ok(res, await service.preferences(req.user)),
  setPreference: async (req, res) => ok(res, await service.setPreference(withActor(req), req.validated.body)),
  setQuietHours: async (req, res) => ok(res, await service.setQuietHours(withActor(req), req.validated.body)),
  setDigest: async (req, res) => ok(res, await service.setDigest(withActor(req), req.validated.body)),
  rules: async (req, res) => sendPaged(res, await rules.list(req.validated.query)),
  saveRule: async (req, res) => ok(res, await rules.save(withActor(req), req.validated.params.key, req.validated.body)),
  resetRule: async (req, res) => ok(res, await rules.reset(withActor(req), req.validated.params.key)),
  reminders: async (_req, res) => ok(res, await rules.remindersOf()),
  saveReminders: async (req, res) => ok(res, await rules.saveReminders(withActor(req), req.validated.body)),
  pushConfig: async (_req, res) => ok(res, await service.pushConfig()),
  savePushSubscription: async (req, res) =>
    ok(
      res,
      await service.savePushSubscription(withActor(req), req.validated.body, {
        userAgent: String(req.headers["user-agent"] || "").slice(0, 400),
        deviceCookie: cookies.readDevice(req),
      }),
    ),
  pushDevices: async (req, res) => sendPaged(res, await service.pushDevices(req.user, req.validated.query)),
  removePushDevice: async (req, res) => {
    await service.removePushDevice(withActor(req), req.validated.params.id);
    noContent(res);
  },
  sendTestPush: async (req, res) => ok(res, await service.sendTestPush(withActor(req), req.validated.body)),
  renewFromDevice: async (req, res) => {
    await service.renewFromDevice(req.validated.body);
    noContent(res);
  },
  markReadFromDevice: async (req, res) => {
    await service.markReadFromDevice(req.validated.body);
    noContent(res);
  },
};

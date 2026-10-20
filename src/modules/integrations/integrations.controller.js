"use strict";
// ai:none keys and connections are configuration; an assistant that could read them would be one more way for them to leak
// search:none five connections, each found as the Integrations screen by its name (shared/search/screens.js)
/**
 * Integrations: the HTTP edge for Settings · Integrations (docs/guides/integrations.md §5).
 * The provider calls a test makes run in the service, outside any transaction.
 */
const { ok, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./integrations.service");

const code = (req) => req.validated.params.code;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  summary: async (_req, res) => ok(res, await service.summary()),
  get: async (req, res) => ok(res, await service.get(code(req))),
  checks: async (req, res) => sendPaged(res, await service.checks(code(req), req.validated.query)),
  save: async (req, res) => ok(res, await service.save(code(req), req.validated.body, withActor(req))),
  remove: async (req, res) => {
    await service.remove(code(req), withActor(req));
    noContent(res);
  },
  test: async (req, res) => ok(res, await service.test(code(req), req.validated.body, withActor(req))),
  testEmail: async (req, res) => ok(res, await service.testEmail(withActor(req))),
  replaceKeys: async (req, res) => ok(res, await service.replaceKeys(withActor(req))),
};

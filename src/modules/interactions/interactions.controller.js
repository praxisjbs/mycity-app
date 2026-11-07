"use strict";
// search:none an interaction is found through its lead or partner, whose 360 lists it (partners.search.js, leads.search.js)
/**
 * Partnerships · interactions: the HTTP edge for Log Interaction and a record's history
 * (docs/guides/partnerships.md §5, §6.12). Scope comes from the `partnerships` grant (§6.1): an
 * interaction is seen with its record.
 */
const { created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./interactions.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
};

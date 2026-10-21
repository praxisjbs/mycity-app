"use strict";
/**
 * Targets: the HTTP edge for Performance · Targets and a department's month
 * (docs/guides/performance.md §5). Scope by department comes from the `performance` grant.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./targets.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req), req.user)),
  summary: async (req, res) => ok(res, await service.summary(req.validated.query, req.user)),
  create: async (req, res) => created(res, await service.create(withActor(req), req.validated.body)),
  submitPlan: async (req, res) =>
    ok(res, await service.submitPlan(withActor(req), req.validated.params.department_id, req.validated.params.month)),
  decidePlan: async (req, res) =>
    ok(res, await service.decidePlan(withActor(req), req.validated.params.id, req.validated.body)),
};

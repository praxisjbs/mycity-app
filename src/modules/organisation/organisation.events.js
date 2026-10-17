"use strict";
/**
 * Organisation events (loaded by the API and the worker). An employee record holds
 * personal data, so its audit rows are marked sensitive: the Audit Log masks them
 * for people without the field grant.
 *
 * One follow-on runs here: a change to who reports to whom moves the boundary of
 * "my team", and team scope is cached (shared/rbac/grants-cache.js). The cache's
 * version is bumped after the change commits, so the next request reads the new
 * tree rather than yesterday's (docs/guides/foundation.md §7).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const grantsCache = require("../../shared/rbac/grants-cache");

const EVENTS = defineEvents("people", {
  "department.created": { summary: "A department was created" },
  "department.updated": { summary: "A department was changed" },
  "employee.created": { summary: "An employee record was created", sensitive: true },
  "employee.updated": { summary: "An employee record was changed", sensitive: true },
  "employee.archived": { summary: "An employee record was archived" },
  "employee.restored": { summary: "An archived employee record was restored" },
  "employee.reporting_line_changed": { summary: "An employee's reporting line changed" },
  "org_seat.created": { summary: "A vacant seat was added to the structure" },
  "org_seat.updated": { summary: "A vacant seat was changed" },
});

const bumpTeams = async () => grantsCache.bumpTeamVersion();

outbox.register(EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_CREATED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_ARCHIVED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_RESTORED, "organisation.refresh_team_scope", bumpTeams);

module.exports = { EVENTS };

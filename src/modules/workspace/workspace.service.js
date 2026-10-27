"use strict";
/**
 * My Workspace: the views built over tasks and the calendar, Today, Analytics and the week
 * (docs/guides/workspace.md §2, §6). Every write to a task is the tasks or the calendar service's;
 * the week writes only its own line and summary (workspace.week.js). Analytics' Export is a run
 * of Home's reports engine, whose service writes it (reports.service exportPersonal).
 */
const lagos = require("../../shared/time/lagos");
const { today } = require("./workspace.today");
const { analytics, assertPeriod } = require("./workspace.analytics");
const { week, save, teamWeeks, tidy } = require("./workspace.week");

/** The source of Analytics' Export in the reports engine (HOME_REPORT_SOURCES). */
const EXPORT_SOURCE = "workspace_analytics";

// Required when used: the reports engine's sources read this module's analytics.
const reports = () => require("../reports/reports.service");

/**
 * POST /workspace/analytics/export: the figures as one file for the caller, with the screen's
 * whose-work and period, answered as a pending run. The route has checked `workspace` export.
 * @param {object} actor  withActor(req)
 * @param {object} body  a validated WorkspaceAnalyticsExport
 */
async function exportAnalytics(actor, body, now = new Date()) {
  assertPeriod(body, lagos.today(now));
  const custom = body.period === "custom";
  return reports().exportPersonal(
    actor,
    EXPORT_SOURCE,
    { format: body.format },
    {
      task_scope: body.scope,
      analytics_period: body.period,
      period_from: custom ? body.from : undefined,
      period_to: custom ? body.to : undefined,
    },
  );
}

/** GET /workspace/analytics/export/:id: one of the caller's own Analytics exports. */
const analyticsExport = (user, id) => reports().getPersonalRun(user, id, EXPORT_SOURCE);

module.exports = { today, analytics, exportAnalytics, analyticsExport, week, save, teamWeeks, tidy };

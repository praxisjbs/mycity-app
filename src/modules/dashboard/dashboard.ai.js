"use strict";
/**
 * What the assistant may read on Home's Overview and Team tab, and where it sends a person
 * (docs/guides/home.md §9; A23: it reads, it never writes).
 *
 *   cards.mine   the asker's own cards and their figures, resolved and counted exactly as
 *                their Overview paints them: the cards they may see, each in their scope
 *   team.today   today's roster as the asker's Team tab lists it, a page of 25 in their
 *                `home` scope; an empty page for someone without `home.team`
 *   activity.list   a day's Activity Today (today unless a date is given), by its allow-list
 *                and the asker's scope on each module it comes from; one person's with
 *                `employee_id` or a name in `q`; a page of 25, each event cited as its record
 *   activity.summary   the same events in figures, for a day or a period, by kind, module,
 *                person or day (docs/guides/praxis-ai.md §6.13)
 *
 * Every login holds `home` view, which is all the assistant checks, so nothing here reads
 * past what the asker's own screen shows: who may see each card, and who may open the Team
 * tab, is decided inside the read, as it is on the screen. Choosing cards is the person's
 * own act on the Overview; the assistant routes them there, and to a card's records with
 * `kpi`, the card's key.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./dashboard.service");
const team = require("./dashboard.team");
const activity = require("./dashboard.activity");

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17). The roster is the asker's `home`
 * scope, for a person who may open the Team tab (nothing to assert for one who may not): a report of
 * theirs is on it, an outsider never. Activity Today carries each event's subject in the reader's
 * scope on that module: the report's own arrival (`employee.created`, today) for a reader with a
 * `people` grant, never the outsider's.
 */
const teamProbe = {
  inside: (ctx) => (ctx.capabilities.includes(team.CAPABILITY) && ctx.report ? { type: "employee", id: ctx.report.employee_id } : null),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};
const activityProbe = {
  inside: async (ctx) => ((await ctx.scopeOf("people", "view")) && ctx.report ? { type: "employee", id: ctx.report.employee_id } : null),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};
/**
 * The summary counts today, so its probe makes today's event: a day of unpaid leave Recorded for the
 * report by a reader who may record it (Leave Recorded, about the report, in their reach). No service a
 * probe may call leaves an allow-listed event about the outsider for a reader whose reach stops short of
 * them, so there is no outside record (docs/guides/praxis-ai.md §6.17).
 */
const activitySummaryProbe = {
  inside: async (ctx) => {
    const scope = ctx.report ? await ctx.scopeOf("people", "create") : null;
    if (!scope || !(await ctx.scopeOf("people", "view"))) return null;
    const day = ctx.freshDay();
    const leave = require("../leave/leave.service");
    const r = await leave.record(ctx.actor, scope, { employee_id: ctx.report.employee_id, leave_type_id: ctx.leaveTypeId, starts_on: day, ends_on: day, reason: `Recorded by the matrix for ${ctx.role}` });
    return { type: "leave_request", id: r.leave_request_id };
  },
  outside: () => null,
};

module.exports = defineManifest({
  module: "home",
  // Which cards each role's Home shows and locks is designed on its own screen (praxis-ai.md decision 35).
  not_offered: {
    HomeRoleKpisSave: "design: the cards a role's Home opens on and locks are arranged on Home with every card of the role in view",
  },
  summaries: [
    {
      key: "activity.summary",
      description: "Activity Today in figures, for a day (today unless dated) or a period: events, the people who acted and whom they were about; by kind, module, person or day; by hour",
      params: c.dashboard.HomeActivitySummaryQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => activity.aiSummary(client, actor, params),
      matrix: activitySummaryProbe,
    },
  ],
  reads: [
    {
      key: "cards.mine",
      summary: "none: my own Home cards, already figures",
      description: "Read the cards on my own Home and their figures today, in the order my Overview shows them",
      params: c.common.EmptyBody,
      permission: ["home", "view"],
      run: (_client, _params, actor) => service.myCards(actor),
      cite: () => ({ type: "screen", id: "home.overview", label: "Home" }),
    },
    {
      key: "team.today",
      summary: "attendance.summary",
      description: "List today's roster on my Team tab: each person's status, clock-in, clock-out and any missing clock-out yesterday",
      params: c.dashboard.HomeTeamQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => team.forAssistant(client, actor, params),
      cite: (row) => ({ type: "employee", id: row.employee.employee_id, label: row.employee.display_name }),
      matrix: teamProbe,
    },
    {
      key: "activity.list",
      summary: "activity.summary",
      description: "List a day's events as my Home's Activity Today shows them, today unless dated: who did what and who it was about; one person's by employee_id or a name in q",
      params: c.dashboard.HomeActivityQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => activity.forAssistant(client, actor, params),
      cite: (row) => ({ type: row.entity_type, id: row.entity_id, label: row.subject || row.actor_name }),
      matrix: activityProbe,
    },
  ],
  routes: [
    { intent: "choose the cards on my Home", screen: "home.overview" },
    { intent: "see who has clocked in today, by status", screen: "home.overview", params: { kpi: "attendance_today" } },
    { intent: "see the requests waiting on my approval", screen: "home.overview", params: { kpi: "approvals_awaiting_you" } },
    { intent: "see my team's attendance", screen: "home.team" },
    { intent: "see what happened today", screen: "home.overview" },
  ],
});

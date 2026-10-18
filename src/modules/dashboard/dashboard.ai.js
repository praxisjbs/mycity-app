"use strict";
/**
 * What the assistant may read on Home's Overview and Team tab, and where it sends a person
 * (docs/guides/home.md §9; A23: it reads, it never writes).
 *
 *   cards.mine   the asker's own cards and their figures, resolved and counted exactly as
 *                their Overview paints them: the cards they may see, each in their scope
 *   team.today   today's roster as the asker's Team tab lists it, a page of 25 in their
 *                `home` scope; an empty page for someone without `home.team`
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

module.exports = defineManifest({
  module: "home",
  reads: [
    {
      key: "cards.mine",
      description: "Read the cards on my own Home and their figures today, in the order my Overview shows them",
      params: c.common.EmptyBody,
      permission: ["home", "view"],
      run: (_client, _params, actor) => service.myCards(actor),
      cite: () => ({ type: "screen", id: "home.overview", label: "Home" }),
    },
    {
      key: "team.today",
      description: "List today's roster on my Team tab: each person's status, clock-in, clock-out and any missing clock-out yesterday",
      params: c.dashboard.HomeTeamQuery,
      permission: ["home", "view"],
      run: (client, params, actor) => team.forAssistant(client, actor, params),
      cite: (row) => ({ type: "employee", id: row.employee.employee_id, label: row.employee.display_name }),
    },
  ],
  routes: [
    { intent: "choose the cards on my Home", screen: "home.overview" },
    { intent: "see who has clocked in today, by status", screen: "home.overview", params: { kpi: "attendance_today" } },
    { intent: "see the requests waiting on my approval", screen: "home.overview", params: { kpi: "approvals_awaiting_you" } },
    { intent: "see my team's attendance", screen: "home.team" },
  ],
});

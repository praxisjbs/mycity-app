"use strict";
/**
 * What the assistant may do about My Week: write the person's own Support Needed line, as a card
 * they confirm (docs/guides/praxis-ai.md §6.11, decision 33), through the same service function
 * Write Support Needed's Save Line calls. Today, Analytics and the week read nothing of their own:
 * they are views over tasks and events, which tasks.ai.js and calendar.ai.js read. Tidy With AI's
 * summary stays on My Week, where the person reads it before they keep it.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./workspace.service");

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "week.support",
      label: "Save Support Needed",
      description: "Write my own Support Needed line on My Week: what help I need this week (or the week named) and from whom",
      input: c.workspace.WeekSave,
      permission: ["workspace", "edit"],
      risk: "standard",
      // Write Support Needed's own line; the summary Tidy With AI suggests is kept on the screen.
      fields: ["week_starts_on", "support_needed"],
      // A week is named by any day in it, or this, next or last week: its Monday (praxis-ai.md §6.11).
      resolve: { week_starts_on: (value) => service.weekOf(value) },
      asks: [{ field: "support_needed", question: "What support do you need?" }],
      run: (values, actor) => service.save(actor, values),
      // My Week sits on Today: the line opens it there.
      readback: (week) => [{ type: "week", id: week.week_starts_on, label: `Week of ${week.week_starts_on.split("-").reverse().join("/")}`, status: "saved", link: routeMap.screenPath("workspace", "today") }],
      labels: { week_starts_on: "Week Of", support_needed: "Support Needed" },
    },
  ],
});

"use strict";
/**
 * ⌘K for the calendar: an event found by its title, among those the reader made. A
 * calendar belongs to its person whatever their grant says, so the query is pinned to
 * the caller (`owner`) and the CEO finds only their own events too. A result opens the
 * event on My Workspace · Calendar.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "calendar_event",
  module: "workspace",
  label: "Events",
  words: ["events", "meetings", "calendar"],
  from: "calendar_event ce JOIN app_user u ON u.employee_id = ce.owner_employee_id",
  key: "ce.calendar_event_id",
  columns: ["ce.title"],
  select: "ce.calendar_event_id AS id, NULL::text AS ref, ce.title AS title, NULL::text AS sub, ce.event_type AS status",
  where: "ce.cancelled_at IS NULL",
  order: "ce.starts_at DESC",
  owner: { column: "u.user_id" },
});

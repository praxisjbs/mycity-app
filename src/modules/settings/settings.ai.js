"use strict";
/**
 * What the assistant may read from Settings. Everyone may ask about the working week,
 * the public holidays and the organisation's own details, so those reads need only
 * Self-Service; numbering schemes need Settings view. Security rules and sessions are
 * not something the assistant answers. It never changes a setting (A23); it sends the
 * person to the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const repo = require("./settings.repo");
const service = require("./settings.service");

module.exports = defineManifest({
  module: "settings",
  reads: [
    {
      key: "holidays.list",
      description: "List the public holidays, by date, optionally for one year",
      params: c.settings.HolidayListQuery,
      permission: ["ess", "view"],
      run: (client, params) => repo.holidayPage(client, params),
      cite: (row) => ({ type: "public_holiday", id: row.public_holiday_id, label: row.name }),
    },
    {
      key: "working_week.get",
      description: "The working week: which days are worked and the hours of each",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: () => service.week(),
      cite: () => null,
    },
    {
      key: "organisation.get",
      description: "The organisation's own details: legal name, trading name, address and contacts",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: () => service.organisation(),
      cite: () => null,
    },
    {
      key: "numbering.list",
      description: "List the numbering scheme of each numbered document type, with the next number",
      params: c.settings.NumberingListQuery,
      permission: ["settings", "view"],
      run: (_client, params) => service.numberingList(params),
      cite: (row) => ({ type: "numbering_scheme", id: row.doc_type, label: row.label }),
    },
  ],
  routes: [
    { intent: "add a public holiday", screen: "settings.organisation", params: { new: "1" } },
    { intent: "change the working week", screen: "settings.organisation" },
    { intent: "change a numbering scheme", screen: "settings.documents-and-numbering" },
    { intent: "change the security rules", screen: "settings.security" },
  ],
});

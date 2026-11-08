"use strict";
/**
 * ⌘K for offers (docs/guides/offers.md §9): an offer found by its number (OFF-), the candidate's name
 * or the role, in the reader's scope as on the screen (the vacancy's hiring manager). The words people
 * use are "offer" and "offer letter". A result opens it on Recruitment · Offers (shared/route-map.js offer).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "offer",
  module: "recruitment",
  label: "Offers",
  words: ["offer", "offers", "offer letter"],
  from: `offer o
    JOIN application a ON a.application_id = o.application_id
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id`,
  key: "o.offer_id",
  columns: ["o.number", "k.first_name", "k.last_name", "o.job_title"],
  select:
    "o.offer_id AS id, o.number::text AS ref, btrim(k.first_name || ' ' || k.last_name) AS title, o.job_title AS sub, o.status AS status",
  order: "o.created_at DESC",
  scope: { column: "v.hiring_manager_id" },
});

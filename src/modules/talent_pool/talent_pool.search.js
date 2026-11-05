"use strict";
/**
 * ⌘K for the Talent Pool (docs/guides/recruitment.md §9): a person kept for later, found by name or
 * email, in the reader's scope (the hiring manager of the vacancy they applied for). The words people
 * use are "talent pool" and "pool". A result opens them on Recruitment · Talent Pool
 * (shared/route-map.js talent_pool_entry).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "talent_pool_entry",
  module: "recruitment",
  label: "Talent Pool",
  words: ["talent pool", "pool", "kept"],
  from: `talent_pool_entry t
    JOIN candidate k ON k.candidate_id = t.candidate_id
    LEFT JOIN application a ON a.application_id = t.application_id
    LEFT JOIN vacancy v ON v.vacancy_id = a.vacancy_id`,
  where: "t.removed_at IS NULL",
  key: "t.talent_pool_entry_id",
  columns: ["k.first_name", "k.last_name", "k.email"],
  select: "t.talent_pool_entry_id AS id, NULL::text AS ref, btrim(k.first_name || ' ' || k.last_name) AS title, v.title AS sub, 'kept' AS status",
  order: "t.created_at DESC",
  scope: { column: "v.hiring_manager_id" },
});

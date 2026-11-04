"use strict";
/**
 * ⌘K for vacancies (docs/guides/recruitment.md §9): a vacancy found by its number or its title, in
 * the reader's scope as on the screen (the hiring manager, guide §8). The words people use for one
 * are "job", "role" and "opening". A result opens the vacancy on Recruitment · Vacancies
 * (shared/route-map.js vacancy).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "vacancy",
  module: "recruitment",
  label: "Vacancies",
  words: ["vacancy", "vacancies", "job", "role", "opening", "vac"],
  from: "vacancy v",
  key: "v.vacancy_id",
  columns: ["v.number", "v.title", "v.location"],
  select: "v.vacancy_id AS id, v.number::text AS ref, v.title AS title, v.location AS sub, v.status AS status",
  order: "v.created_at DESC",
  scope: { column: "v.hiring_manager_id" },
});

"use strict";
/**
 * ⌘K for candidates (docs/guides/recruitment.md §9): an application found by its number or the
 * candidate's name or email, in the reader's scope as on the board (the vacancy's hiring manager,
 * guide §8). The words people use are "applicant", "candidate" and "CV". A result opens the
 * candidate on Recruitment · Candidates (shared/route-map.js candidate).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "candidate",
  module: "recruitment",
  label: "Candidates",
  words: ["candidate", "candidates", "applicant", "applicants", "application", "cv"],
  from: "application a JOIN candidate k ON k.candidate_id = a.candidate_id JOIN vacancy v ON v.vacancy_id = a.vacancy_id",
  key: "a.application_id",
  columns: ["a.number", "k.first_name", "k.last_name", "k.email"],
  select:
    "a.application_id AS id, a.number::text AS ref, btrim(k.first_name || ' ' || k.last_name) AS title, v.title AS sub, a.stage AS status",
  order: "a.applied_at DESC",
  scope: { column: "v.hiring_manager_id" },
});

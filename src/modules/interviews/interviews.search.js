"use strict";
/**
 * ⌘K for interviews (docs/guides/recruitment.md §9): an interview found by the candidate's name or the
 * role, in the reader's scope as on the screen (the vacancy's hiring manager, guide §8), or any the
 * reader sits on the panel of. The words people use are "interview" and "panel". A result opens it
 * on Recruitment · Interviews (shared/route-map.js interview); nothing of a card is searched.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "interview",
  module: "recruitment",
  label: "Interviews",
  words: ["interview", "interviews", "panel"],
  from: `interview i
    JOIN interview_round r ON r.interview_round_id = i.interview_round_id
    JOIN application a ON a.application_id = r.application_id
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id`,
  key: "i.interview_id",
  columns: ["k.first_name", "k.last_name", "v.title", "a.number"],
  select:
    "i.interview_id AS id, a.number::text AS ref, btrim(k.first_name || ' ' || k.last_name) AS title, v.title AS sub, i.status AS status",
  order: "i.scheduled_start DESC",
  scope: { column: "v.hiring_manager_id", named: { column: "p.employee_id", through: "interview_panelist p WHERE p.interview_id = i.interview_id" } },
});

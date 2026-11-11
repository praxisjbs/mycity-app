"use strict";
/**
 * ⌘K for onboarding cases (docs/guides/offers.md §9): a hire's case found by their name or the role,
 * in the reader's scope as on the screen (the case's owner, the vacancy's hiring manager). The words
 * people use are "onboarding", "new hire" and "new joiner". A result opens the case on
 * Recruitment · Onboarding (shared/route-map.js onboarding).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "onboarding",
  module: "recruitment",
  label: "Onboarding",
  words: ["onboarding", "new hire", "new hires", "new joiner", "new joiners"],
  from: `onboarding_case oc
    JOIN offer o ON o.offer_id = oc.offer_id
    LEFT JOIN employee e ON e.employee_id = oc.employee_id`,
  key: "oc.onboarding_case_id",
  columns: ["e.first_name", "e.last_name", "o.job_title"],
  select:
    "oc.onboarding_case_id AS id, btrim(e.first_name || ' ' || e.last_name) AS title, o.job_title AS sub, oc.status AS status",
  order: "oc.created_at DESC",
  scope: { column: "oc.owner_id" },
});

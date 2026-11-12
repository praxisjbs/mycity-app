"use strict";
/**
 * ⌘K for employment contracts (docs/guides/offers.md §9): a contract found by its number (CON-) or
 * the hire's name, in the reader's scope as on the screen (the vacancy's hiring manager). The words
 * people use are "contract" and "employment contract". A result opens the hire's case on
 * Recruitment · Onboarding (shared/route-map.js employment_contract).
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "employment_contract",
  module: "recruitment",
  label: "Employment Contracts",
  words: ["contract", "contracts", "employment contract"],
  from: `employment_contract ct
    JOIN onboarding_case oc ON oc.onboarding_case_id = ct.onboarding_case_id
    JOIN application a ON a.application_id = oc.application_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN employee e ON e.employee_id = ct.employee_id`,
  key: "ct.employment_contract_id",
  columns: ["ct.number", "e.first_name", "e.last_name"],
  select:
    "ct.onboarding_case_id AS id, ct.number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, v.title AS sub, ct.status AS status",
  order: "ct.created_at DESC",
  scope: { column: "v.hiring_manager_id" },
});

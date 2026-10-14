"use strict";
/**
 * The permission vocabulary. Single source of truth for:
 *
 *  - the 15 module keys a route can name in requirePermission(key, action)
 *    (README §5.2; the 15 admin modules of MILESTONES §18),
 *  - the six actions and three record scopes,
 *  - the label, area and description the Roles & Permissions screen shows.
 *
 * middleware/rbac.js refuses, at boot, a requirePermission() whose key or action
 * is not here; scripts/check/module-catalogue.js fails CI when this list and the
 * keys enforced in src/ differ. The access module rejects a grant that names
 * anything outside it.
 *
 * Renaming a module's LABEL is a one-line edit here. Renaming its KEY is a
 * migration (grants are stored against it), so keys never change after M9.
 */

/** Rail areas, in rail order. The first three modules sit above any area. */
const AREAS = [
  { key: "top", label: "" },
  { key: "work", label: "Work" },
  { key: "people", label: "People" },
  { key: "business", label: "Business" },
  { key: "system", label: "System" },
];

const MODULE_CATALOG = [
  { key: "home", area: "top", label: "Home", description: "Overview, team, alerts and reports" },
  { key: "workspace", area: "top", label: "My Workspace", description: "Today, tasks, calendar and analytics" },
  { key: "ess", area: "top", label: "Employee Self-Service", description: "Your own record, attendance, pay, leave and documents" },
  { key: "community", area: "work", label: "Staff Community", description: "Channels, direct messages and announcements" },
  { key: "mailbox", area: "work", label: "Mailbox", description: "Your work email" },
  { key: "people", area: "people", label: "People", description: "Employees, attendance, leave, devices and worksites" },
  { key: "performance", area: "people", label: "Performance", description: "Goals, targets, KPIs and reviews" },
  { key: "queries", area: "people", label: "Queries & Sanctions", description: "Queries, rules, sanctions and letter templates" },
  { key: "recruitment", area: "people", label: "Recruitment", description: "Vacancies through to onboarding" },
  { key: "payroll", area: "people", label: "Payroll", description: "Payroll runs, payslips, salary structure and statutory" },
  { key: "partnerships", area: "business", label: "Partnerships", description: "Pipeline, partners, leads, proposals and contracts" },
  { key: "expenses", area: "business", label: "Expenses", description: "Requests, approvals, requisitions, disbursements and budgets" },
  { key: "knowledge", area: "system", label: "Knowledge Hub", description: "Policies, SOPs, FAQs, training and announcements" },
  { key: "praxis_ai", area: "system", label: "Praxis AI", description: "The assistant, and AI controls" },
  { key: "settings", area: "system", label: "Settings", description: "Organisation, users, roles, approvals and system settings" },
];

/** Every permission check names one of these. It is `edit`, never `update`. */
const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"];

/**
 * Record scope of a grant, widest first.
 *   all   every record of the module
 *   team  the caller's own records and those of everyone who reports to them, at any depth
 *   own   the caller's own records only
 */
const RECORD_SCOPES = ["all", "team", "own"];

/** Modules whose scope is always `own`, whatever a grant says. */
const OWN_ONLY = new Set(["ess"]);

const MODULES = MODULE_CATALOG.map((m) => m.key);
const MODULE_SET = new Set(MODULES);
const ACTION_SET = new Set(ACTIONS);

const MODULE_META = Object.freeze(
  Object.fromEntries(MODULE_CATALOG.map((m) => [m.key, { label: m.label, area: m.area, description: m.description }])),
);

const isModule = (key) => MODULE_SET.has(key);
const isAction = (action) => ACTION_SET.has(action);
const isScope = (scope) => RECORD_SCOPES.includes(scope);

/** Of two scopes, the wider. Used when several roles grant the same action. */
function widerScope(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RECORD_SCOPES.indexOf(a) <= RECORD_SCOPES.indexOf(b) ? a : b;
}

module.exports = {
  AREAS,
  MODULE_CATALOG,
  MODULES,
  MODULE_META,
  ACTIONS,
  RECORD_SCOPES,
  OWN_ONLY,
  isModule,
  isAction,
  isScope,
  widerScope,
};

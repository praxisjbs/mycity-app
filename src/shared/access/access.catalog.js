"use strict";
/**
 * The permission vocabulary. Single source of truth for:
 *
 *  - the 15 module keys a route can name in requirePermission(key, action)
 *    (README §5.2; the 15 admin modules of MILESTONES §18),
 *  - the six actions and three record scopes,
 *  - the label, area and description the Roles & Permissions screen shows,
 *  - the capabilities: named authorities inside a module, beyond its six actions.
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
  {
    key: "home",
    area: "top",
    label: "Home",
    description: "Overview, team, alerts and reports",
  },
  {
    key: "workspace",
    area: "top",
    label: "My Workspace",
    description: "Today, tasks, calendar and analytics",
  },
  {
    key: "ess",
    area: "top",
    label: "Employee Self-Service",
    description: "Your own record, attendance, pay, leave and documents",
  },
  {
    key: "community",
    area: "work",
    label: "Staff Community",
    description: "Channels, direct messages and announcements",
  },
  {
    key: "mailbox",
    area: "work",
    label: "Mailbox",
    description: "Your work email",
  },
  {
    key: "people",
    area: "people",
    label: "People",
    description: "Employees, attendance, leave, devices and worksites",
  },
  {
    key: "performance",
    area: "people",
    label: "Performance",
    description: "Goals, targets, KPIs and reviews",
  },
  {
    key: "queries",
    area: "people",
    label: "Queries & Sanctions",
    description: "Queries, rules, sanctions and letter templates",
  },
  {
    key: "recruitment",
    area: "people",
    label: "Recruitment",
    description: "Vacancies through to onboarding",
  },
  {
    key: "payroll",
    area: "people",
    label: "Payroll",
    description: "Payroll runs, payslips, salary structure and statutory",
  },
  {
    key: "partnerships",
    area: "business",
    label: "Partnerships",
    description: "Pipeline, partners, leads, proposals and contracts",
  },
  {
    key: "expenses",
    area: "business",
    label: "Expenses",
    description: "Requests, approvals, requisitions, disbursements and budgets",
  },
  {
    key: "knowledge",
    area: "system",
    label: "Knowledge Hub",
    description: "Policies, SOPs, FAQs, training and announcements",
  },
  {
    key: "praxis_ai",
    area: "system",
    label: "Praxis AI",
    description: "The assistant",
  },
  {
    key: "ai_control",
    area: "system",
    label: "AI Control",
    description: "Which model answers each AI feature, model prices, and the monthly spend and caps",
  },
  {
    key: "settings",
    area: "system",
    label: "Settings",
    description: "Organisation, users, roles, approvals and system settings",
  },
  {
    key: "system_health",
    area: "system",
    label: "System Health",
    description: "Readiness checks, performance over time, and the faults the code reports",
  },
  {
    key: "integrations",
    area: "system",
    label: "Integrations",
    description: "Mail, maps, AI and push settings, their keys kept encrypted, tested and watched",
  },
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
  Object.fromEntries(
    MODULE_CATALOG.map((m) => [
      m.key,
      { label: m.label, area: m.area, description: m.description },
    ]),
  ),
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

/**
 * Capabilities (README §5.2): an authority inside a module that its six actions cannot
 * express. Home's `view` opens Home for every employee; `home.team` opens its Team tab
 * to the people who manage others.
 *
 * Each is declared here once, with the module it belongs to, and inserted into the
 * `capability` table by its milestone's reference seed (insert if absent, so a role's
 * holdings edited on Settings · Roles & Permissions are never overwritten). A route
 * checks one after the module grant:
 *
 *   requirePermission("home", "view"), requireCapability("home.team"), controller.team
 *
 * The code is `<area>.<authority>`, two lower_snake segments, where the area is the
 * module key or a named part of the module (`alerts`, `announcements`). The rule is
 * the contract's too (packages/contract/schemas/identity.js; a test holds them equal).
 *
 * middleware/rbac.js refuses, at boot, a requireCapability() whose code is not here;
 * scripts/check/capabilities.js fails CI on a code the code checks that is not here, and
 * on a code here that no reference seed inserts (nobody could be given it).
 */
const CAPABILITY_CODE = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

const CAPABILITY_CATALOG = [
  {
    code: "home.team",
    module: "home",
    label: "View Team",
    description: "Open the Team tab on Home: who is in today and the team's figures.",
  },
  {
    code: "home.reports",
    module: "home",
    label: "Run Reports",
    description: "Build, schedule and run reports on Home, and receive them.",
  },
  {
    code: "alerts.clear",
    module: "home",
    label: "Clear Alerts",
    description: "Clear or dismiss an alert on Home.",
  },
  {
    code: "alerts.manage",
    module: "home",
    label: "Manage Alert Rules",
    description: "Create, change and switch off the rules that raise alerts on Home.",
  },
  {
    code: "announcements.post",
    module: "community",
    label: "Post Announcements",
    description: "Post to the announcements channel and track who has read a post.",
  },
  {
    code: "policies.manage",
    module: "knowledge",
    label: "Manage Policies",
    description: "Write, publish, withdraw and archive company policies, and see who has acknowledged them.",
  },
  {
    code: "mailbox.signature",
    module: "mailbox",
    label: "Configure Signature",
    description: "Set the company's signature links and what shows on everyone's email signature.",
  },
  {
    code: "queries.configure",
    module: "queries",
    label: "Configure Queries",
    description: "Write the query rules, the consequence chain and the letter templates.",
  },
  // M2 My Workspace (docs/guides/workspace.md §8), seeded in 2590.
  {
    code: "workspace.late_reasons",
    module: "workspace",
    label: "Manage Late Reasons",
    description: "Add the reasons Why Late offers on a late task, and switch them off or on.",
  },
  // M2 Performance (docs/guides/performance.md §8), seeded in 2190.
  {
    code: "goals.organisation",
    module: "performance",
    label: "Set Organisational Goals",
    description: "Record and edit the organisational goals and their quarterly targets.",
  },
  {
    code: "goals.company",
    module: "performance",
    label: "Set Company OKRs",
    description: "Set the company objectives and key results, and send the company plan.",
  },
  {
    code: "goals.function",
    module: "performance",
    label: "Set Function OKRs",
    description:
      "Set a function's objectives, key results and KPIs, report its month and send its plan, as its head or acting head.",
  },
  {
    code: "goals.confirm",
    module: "performance",
    label: "Confirm Scores",
    description: "Confirm the month's key result scores the heads propose.",
  },
  {
    code: "goals.view_all",
    module: "performance",
    label: "View All Goals",
    description: "Read the whole organisational and company plan: every organisational goal, company objective and key result.",
  },
  {
    code: "performance.manage",
    module: "performance",
    label: "Run Performance",
    description:
      "Run the cycle: quarters and their rules, rounds, reviewer changes, conduct, improvement plans, probation outcomes and imports.",
  },
];

const CAPABILITIES = CAPABILITY_CATALOG.map((c) => c.code);
const CAPABILITY_SET = new Set(CAPABILITIES);

const isCapability = (code) => CAPABILITY_SET.has(code);

module.exports = {
  AREAS,
  MODULE_CATALOG,
  MODULES,
  MODULE_META,
  ACTIONS,
  RECORD_SCOPES,
  OWN_ONLY,
  CAPABILITY_CODE,
  CAPABILITY_CATALOG,
  CAPABILITIES,
  isModule,
  isAction,
  isScope,
  isCapability,
  widerScope,
};

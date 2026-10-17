"use strict";
/**
 * Where a record opens in the staff app. The one map from (entity type, id) to a
 * screen, so the notification bell, the task panel, Home's alerts, search results
 * and the AI assistant all open the same place (MILESTONES §7, §11).
 *
 *   const { linkFor } = require("../../shared/route-map");
 *
 *   linkFor("query", id)
 *     → { module: "queries", tab: "queries", id, path: "/queries?tab=queries&id=<id>" }
 *
 *   linkFor("payslip", id, { self: true })      // the payslip's own employee
 *     → { module: "ess", tab: "my-payslips", id, path: "/ess?tab=my-payslips&id=<id>" }
 *
 * A link is DERIVED on every read and never stored. A stored URL freezes today's
 * routes into yesterday's rows, and the failure is silent: the app catches the
 * unknown path and lands on Home. A row stores entity_type and entity_id; this file
 * turns them into a link at the moment it is shown.
 *
 * The URL is `/<module>?tab=<tab>&id=<id>`. The module segment is the permission key
 * with "_" as "-" ("praxis_ai" → "/praxis-ai"). The tab is the screen's slug from
 * docs/PROGRESS.md, which never changes when a label does (MILESTONES §18.1). `id`
 * asks the screen to open that record (its detail panel or modal). The frontend's
 * router honours exactly this shape (FRONTEND_GUIDE §9.2).
 *
 * `self` routes a record to its owner's own view: the employee a payslip belongs to
 * opens it in Self-Service, not in Payroll, which they cannot open.
 *
 * An unknown type returns null, and the caller shows no link rather than a broken
 * one. A new entity type is one line in ENTITY_ROUTES; a test fails when a route
 * names a screen that is not in docs/PROGRESS.md.
 */
const catalog = require("./access/access.catalog");

/** Module key → tab slugs, in screen order (docs/PROGRESS.md; 80 staff-app screens). */
const SCREENS = Object.freeze({
  home: ["overview", "alerts", "reports", "team"],
  workspace: ["today", "tasks", "calendar", "analytics"],
  ess: [
    "my-profile",
    "my-attendance",
    "my-performance",
    "my-payslips",
    "my-leave",
    "my-queries",
    "my-documents",
    "work-location-requests",
    "my-devices",
    "policy-updates",
    "my-security",
    "org-chart",
  ],
  community: ["channels", "direct-messages", "announcements"],
  mailbox: ["inbox", "sent", "drafts", "archive", "spam", "trash"],
  people: ["employees", "attendance", "leave", "devices", "worksites", "organogram"],
  performance: ["goals", "targets", "kpis", "reviews", "analytics"],
  queries: ["queries", "rules", "sanctions", "letter-templates"],
  recruitment: [
    "vacancies",
    "candidates",
    "assessments",
    "interviews",
    "offers",
    "onboarding",
    "talent-pool",
  ],
  payroll: [
    "payroll-runs",
    "payslips",
    "salary-structure",
    "deductions",
    "statutory",
  ],
  partnerships: [
    "pipeline",
    "partners",
    "leads",
    "proposals",
    "contracts-and-mous",
    "analytics",
  ],
  expenses: [
    "my-requests",
    "approvals",
    "requisitions",
    "disbursements",
    "budgets",
    "categories",
  ],
  knowledge: ["policies", "sops", "faqs", "training", "announcements"],
  praxis_ai: ["ask", "history"],
  settings: [
    "organisation",
    "users",
    "roles-and-permissions",
    "approvals",
    "attendance-policy",
    "notifications",
    "appearance",
    "documents-and-numbering",
    "integrations",
    "security",
    "audit-log",
    "imports",
  ],
});

const screen = (module, tab) => ({ module, tab });

/**
 * entity_type → { module, tab, self? }. Types are the snake_case names modules pass
 * to emit() and store beside a notification, task or alert.
 */
const ENTITY_ROUTES = Object.freeze({
  // Home
  home_alert: screen("home", "alerts"),
  home_report: screen("home", "reports"),
  home_report_run: screen("home", "reports"),

  // My Workspace
  task: screen("workspace", "tasks"),
  calendar_event: screen("workspace", "calendar"),

  // Staff Community and Mailbox
  channel: screen("community", "channels"),
  channel_message: screen("community", "channels"),
  direct_thread: screen("community", "direct-messages"),
  direct_message: screen("community", "direct-messages"),
  announcement: screen("community", "announcements"),
  recognition: screen("community", "channels"),
  mail_thread: screen("mailbox", "inbox"),
  mail_message: screen("mailbox", "inbox"),

  // People
  employee: {
    ...screen("people", "employees"),
    self: screen("ess", "my-profile"),
  },
  import_batch: screen("settings", "imports"),
  // A file opens where its record is: on the employee's own My Documents, or on
  // the record's Documents tab for whoever may see it.
  document: {
    ...screen("people", "employees"),
    self: screen("ess", "my-documents"),
  },
  document_request: {
    ...screen("people", "employees"),
    self: screen("ess", "my-documents"),
  },
  attendance_record: {
    ...screen("people", "attendance"),
    self: screen("ess", "my-attendance"),
  },
  attendance_exception: {
    ...screen("people", "attendance"),
    self: screen("ess", "my-attendance"),
  },
  leave_request: {
    ...screen("people", "leave"),
    self: screen("ess", "my-leave"),
  },
  device: { ...screen("people", "devices"), self: screen("ess", "my-profile") },
  worksite: screen("people", "worksites"),

  // Performance
  goal: {
    ...screen("performance", "goals"),
    self: screen("ess", "my-performance"),
  },
  target: {
    ...screen("performance", "targets"),
    self: screen("ess", "my-performance"),
  },
  kpi: screen("performance", "kpis"),
  review: {
    ...screen("performance", "reviews"),
    self: screen("ess", "my-performance"),
  },

  // Queries & Sanctions
  query: { ...screen("queries", "queries"), self: screen("ess", "my-queries") },
  query_rule: screen("queries", "rules"),
  sanction: {
    ...screen("queries", "sanctions"),
    self: screen("ess", "my-queries"),
  },
  letter_template: screen("queries", "letter-templates"),

  // Recruitment
  vacancy: screen("recruitment", "vacancies"),
  candidate: screen("recruitment", "candidates"),
  assessment: screen("recruitment", "assessments"),
  interview: screen("recruitment", "interviews"),
  offer: screen("recruitment", "offers"),
  onboarding: {
    ...screen("recruitment", "onboarding"),
    self: screen("ess", "my-documents"),
  },
  talent_pool_entry: screen("recruitment", "talent-pool"),

  // Payroll
  payroll_run: screen("payroll", "payroll-runs"),
  payslip: {
    ...screen("payroll", "payslips"),
    self: screen("ess", "my-payslips"),
  },
  salary_structure: screen("payroll", "salary-structure"),
  deduction: screen("payroll", "deductions"),
  statutory_return: screen("payroll", "statutory"),

  // Partnerships
  partner: screen("partnerships", "partners"),
  partner_deal: screen("partnerships", "pipeline"),
  lead: screen("partnerships", "leads"),
  proposal: screen("partnerships", "proposals"),
  contract: screen("partnerships", "contracts-and-mous"),
  mou: screen("partnerships", "contracts-and-mous"),
  agreement: screen("partnerships", "contracts-and-mous"),

  // Expenses
  expense: {
    ...screen("expenses", "approvals"),
    self: screen("expenses", "my-requests"),
  },
  requisition: screen("expenses", "requisitions"),
  disbursement: screen("expenses", "disbursements"),
  budget: screen("expenses", "budgets"),
  expense_category: screen("expenses", "categories"),

  // Knowledge Hub
  policy: screen("knowledge", "policies"),
  sop: screen("knowledge", "sops"),
  faq: screen("knowledge", "faqs"),
  training_course: screen("knowledge", "training"),
  knowledge_announcement: screen("knowledge", "announcements"),

  // Praxis AI
  ai_conversation: screen("praxis_ai", "history"),

  // Settings
  department: screen("settings", "organisation"),
  app_user: screen("settings", "users"),
  // A person's own login, as they see it: sign-ins, sessions, their password.
  account: screen("ess", "my-security"),
  role: screen("settings", "roles-and-permissions"),
  workflow_definition: screen("settings", "approvals"),
  numbering_scheme: screen("settings", "documents-and-numbering"),
  template: screen("settings", "documents-and-numbering"),
  integration: screen("settings", "integrations"),
});

/** "praxis_ai" → "praxis-ai" */
const moduleSlug = (key) => key.replace(/_/g, "-");

/** Refuse a route to a screen that does not exist, when this file loads. */
function check() {
  for (const [module, tabs] of Object.entries(SCREENS)) {
    if (!catalog.isModule(module))
      throw new Error(
        `route-map: SCREENS names "${module}", which is not a module key`,
      );
    if (new Set(tabs).size !== tabs.length)
      throw new Error(`route-map: ${module} lists a tab twice`);
  }
  for (const [type, r] of Object.entries(ENTITY_ROUTES)) {
    for (const s of [r, r.self].filter(Boolean)) {
      if (!SCREENS[s.module] || !SCREENS[s.module].includes(s.tab)) {
        throw new Error(
          `route-map: ${type} opens ${s.module} / ${s.tab}, which is not a screen`,
        );
      }
    }
  }
}
check();

/**
 * The path for a screen, optionally opening one record and carrying extra
 * query values (the AI's prefilled "Create Task" link).
 * @param {string} module
 * @param {string} tab
 * @param {{id?: string, params?: Record<string, string>}} [opts]
 * @returns {string}
 */
function screenPath(module, tab, { id = null, params = {} } = {}) {
  if (!SCREENS[module] || !SCREENS[module].includes(tab))
    throw new Error(`route-map: ${module} / ${tab} is not a screen`);
  const q = new URLSearchParams({ tab });
  if (id !== null && id !== undefined && id !== "") q.set("id", String(id));
  for (const [k, v] of Object.entries(params)) {
    if (k === "tab" || k === "id")
      throw new Error(`route-map: "${k}" is set by screenPath itself`);
    if (v !== undefined && v !== null) q.set(k, String(v));
  }
  return `/${moduleSlug(module)}?${q.toString()}`;
}

/**
 * Where a record opens, or null for a type with no screen.
 * @param {string} entityType
 * @param {string} entityId
 * @param {{self?: boolean}} [opts]  self: the viewer is the record's own employee
 * @returns {{module: string, tab: string, id: string, path: string}|null}
 */
function linkFor(entityType, entityId, { self = false } = {}) {
  const r = ENTITY_ROUTES[entityType];
  if (!r || entityId === null || entityId === undefined || entityId === "")
    return null;
  const target = self && r.self ? r.self : r;
  const id = String(entityId);
  return {
    module: target.module,
    tab: target.tab,
    id,
    path: screenPath(target.module, target.tab, { id }),
  };
}

/** The module a record belongs to (its staff view), or null. Used to check the viewer may open it. */
function moduleOf(entityType) {
  const r = ENTITY_ROUTES[entityType];
  return r ? r.module : null;
}

const hasRoute = (entityType) =>
  Object.prototype.hasOwnProperty.call(ENTITY_ROUTES, entityType);

module.exports = {
  SCREENS,
  ENTITY_ROUTES,
  moduleSlug,
  screenPath,
  linkFor,
  moduleOf,
  hasRoute,
};

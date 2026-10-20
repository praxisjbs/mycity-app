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
 *
 * Search reaches everything (docs/guides/foundation.md §6.7): a type here is declared by
 * a search provider (`<module>.search.js`), or its line carries `// search:none <reason>`;
 * `not built yet (src/modules/<m>)` holds only until that module is built. A screen kept
 * out of ⌘K writes `// search:none <module>.<tab> <reason>`. The search coverage gate
 * (scripts/check/search-coverage.js) checks both.
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
  mailbox: ["inbox", "sent", "drafts", "archive", "spam", "trash", "signature"],
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
 * entity_type → { module, tab, self?, param? }. Types are the snake_case names modules pass
 * to emit() and store beside a notification, task or alert. `param` names the query value
 * that carries the record's id when its tab opens two kinds of record (an alert rule beside
 * the alerts it raises: `?rule=`; a report's run beside the reports: `?run=`); `id` otherwise.
 */
const ENTITY_ROUTES = Object.freeze({
  // Home
  home_alert: screen("home", "alerts"),
  // A rule opens Edit Rule on the Alerts tab, whose `?id=` is an alert.
  home_alert_rule: { ...screen("home", "alerts"), param: "rule" },
  home_report: screen("home", "reports"),
  // A run opens on the Reports tab, whose `?id=` is a report.
  home_report_run: { ...screen("home", "reports"), param: "run" },
  // A KPI card, by its catalogue key: the Overview opens the records behind it.
  home_kpi: screen("home", "overview"),

  // My Workspace
  task: screen("workspace", "tasks"), // search:none not built yet (src/modules/tasks)
  calendar_event: screen("workspace", "calendar"), // search:none not built yet (src/modules/calendar)

  // Staff Community and Mailbox
  channel: screen("community", "channels"), // search:none membership decides who sees a conversation, and a provider is gated by the module grant alone
  channel_message: screen("community", "channels"), // search:none membership decides who sees a conversation, and a provider is gated by the module grant alone
  direct_thread: screen("community", "direct-messages"), // search:none membership decides who sees a conversation, and a provider is gated by the module grant alone
  direct_message: screen("community", "direct-messages"), // search:none membership decides who sees a conversation, and a provider is gated by the module grant alone
  announcement: screen("community", "announcements"),
  recognition: screen("community", "channels"), // search:none membership decides who sees a conversation, and a provider is gated by the module grant alone
  community_link_preview: screen("community", "channels"), // search:none a page's card, kept once per address; found through the message that posts the link
  mail_thread: screen("mailbox", "inbox"), // opens the conversation by id, whichever folder it is in
  mail_message: screen("mailbox", "inbox"), // search:none a message is found through its conversation (mailbox.search.js)
  mail_signature: screen("mailbox", "signature"), // search:none one per person, their own; ⌘K finds the Signature tab (shared/search/screens.js)
  mail_signature_config: screen("mailbox", "signature"), // search:none one for the company, opened by Configure on the Signature tab
  mail_signature_image: screen("mailbox", "signature"), // search:none a picture inside every signature, never a record anyone looks up

  // People
  employee: {
    ...screen("people", "employees"),
    self: screen("ess", "my-profile"),
  },
  // A person's photo (organisation.photo.js) opens their record, or their own My Profile.
  // search:none a photo is found through the person it shows
  employee_photo: {
    ...screen("people", "employees"),
    self: screen("ess", "my-profile"),
  },
  // A Download My Data workbook (ess.export.js): its record opens My Profile, where it is asked for.
  data_export: screen("ess", "my-profile"), // search:none a file downloaded where it was asked for and removed a day later; nothing to look up
  // A post nobody holds yet opens on the Organogram, focused on it.
  org_seat: screen("people", "organogram"),
  // A Download PDF file: its record opens the Org Chart, where it is asked for.
  org_chart_export: screen("ess", "org-chart"), // search:none a file downloaded where it was asked for and removed a day later; nothing to look up
  import_batch: screen("settings", "imports"),
  // A file opens where its record is: on the employee's own My Documents, or on
  // the record's Documents tab for whoever may see it.
  // search:none found from the record it belongs to; the vault decides who opens each (documents.controller.js)
  document: {
    ...screen("people", "employees"),
    self: screen("ess", "my-documents"),
  },
  // search:none found from the record it belongs to; the vault decides who opens each (documents.controller.js)
  document_request: {
    ...screen("people", "employees"),
    self: screen("ess", "my-documents"),
  },
  // A day, or an exception on one: People · Attendance opens the person's day; the
  // person's own opens on My Attendance (both read /attendance/records/:id).
  attendance_record: {
    ...screen("people", "attendance"),
    self: screen("ess", "my-attendance"),
  },
  attendance_exception: {
    ...screen("people", "attendance"),
    self: screen("ess", "my-attendance"),
  },
  // A reminder to clock in (§6.14): the person's notice opens My Attendance with the clock panel (`?clock=`).
  // search:none a reminder is a notice about today, not a record anyone looks up
  attendance_clock_reminder: {
    ...screen("ess", "my-attendance"),
    param: "clock",
  },
  // A remote employee's home location: People · Attendance opens it in Homes (`?home=`,
  // its `?id=` is a day); the person's own opens their Home Location on My Attendance.
  attendance_home: {
    ...screen("people", "attendance"),
    param: "home",
    self: screen("ess", "my-attendance"),
  },
  // A work location request: People · Attendance opens it in Requests (`?request=`); the
  // person's own opens on Work Location Requests.
  attendance_location_request: {
    ...screen("people", "attendance"),
    param: "request",
    self: screen("ess", "work-location-requests"),
  },
  // A field assignment: People · Attendance opens it in Field (`?assignment=`); someone on it
  // opens it on My Attendance.
  attendance_field_assignment: {
    ...screen("people", "attendance"),
    param: "assignment",
    self: screen("ess", "my-attendance"),
  },
  leave_request: {
    ...screen("people", "leave"),
    self: screen("ess", "my-leave"),
  },
  device: { ...screen("people", "devices"), self: screen("ess", "my-devices") },
  worksite: screen("people", "worksites"),

  // Performance
  // search:none not built yet (src/modules/goals)
  goal: {
    ...screen("performance", "goals"),
    self: screen("ess", "my-performance"),
  },
  // search:none not built yet (src/modules/targets)
  target: {
    ...screen("performance", "targets"),
    self: screen("ess", "my-performance"),
  },
  kpi: screen("performance", "kpis"), // search:none not built yet (src/modules/kpis)
  // search:none not built yet (src/modules/reviews)
  review: {
    ...screen("performance", "reviews"),
    self: screen("ess", "my-performance"),
  },

  // Queries & Sanctions
  query: { ...screen("queries", "queries"), self: screen("ess", "my-queries") }, // search:none not built yet (src/modules/queries)
  query_rule: screen("queries", "rules"), // search:none not built yet (src/modules/query_rules)
  // search:none not built yet (src/modules/sanctions)
  sanction: {
    ...screen("queries", "sanctions"),
    self: screen("ess", "my-queries"),
  },
  letter_template: screen("queries", "letter-templates"), // search:none not built yet (src/modules/templates)

  // Recruitment
  vacancy: screen("recruitment", "vacancies"), // search:none not built yet (src/modules/vacancies)
  candidate: screen("recruitment", "candidates"), // search:none not built yet (src/modules/candidates)
  assessment: screen("recruitment", "assessments"), // search:none not built yet (src/modules/assessments)
  interview: screen("recruitment", "interviews"), // search:none not built yet (src/modules/interviews)
  offer: screen("recruitment", "offers"), // search:none not built yet (src/modules/offers)
  // search:none not built yet (src/modules/onboarding)
  onboarding: {
    ...screen("recruitment", "onboarding"),
    self: screen("ess", "my-documents"),
  },
  talent_pool_entry: screen("recruitment", "talent-pool"), // search:none not built yet (src/modules/talent_pool)

  // Payroll
  payroll_run: screen("payroll", "payroll-runs"), // search:none not built yet (src/modules/payroll)
  // search:none not built yet (src/modules/payslips)
  payslip: {
    ...screen("payroll", "payslips"),
    self: screen("ess", "my-payslips"),
  },
  salary_structure: screen("payroll", "salary-structure"), // search:none not built yet (src/modules/salary_structure)
  deduction: screen("payroll", "deductions"), // search:none not built yet (src/modules/deductions)
  statutory_return: screen("payroll", "statutory"), // search:none not built yet (src/modules/statutory)

  // Partnerships
  partner: screen("partnerships", "partners"), // search:none not built yet (src/modules/partners)
  partner_deal: screen("partnerships", "pipeline"), // search:none not built yet (src/modules/partner_pipeline)
  lead: screen("partnerships", "leads"), // search:none not built yet (src/modules/leads)
  proposal: screen("partnerships", "proposals"), // search:none not built yet (src/modules/proposals)
  contract: screen("partnerships", "contracts-and-mous"), // search:none not built yet (src/modules/agreements)
  mou: screen("partnerships", "contracts-and-mous"), // search:none not built yet (src/modules/agreements)
  agreement: screen("partnerships", "contracts-and-mous"), // search:none not built yet (src/modules/agreements)

  // Expenses
  // search:none not built yet (src/modules/expenses)
  expense: {
    ...screen("expenses", "approvals"),
    self: screen("expenses", "my-requests"),
  },
  requisition: screen("expenses", "requisitions"), // search:none not built yet (src/modules/requisitions)
  disbursement: screen("expenses", "disbursements"), // search:none not built yet (src/modules/disbursements)
  budget: screen("expenses", "budgets"), // search:none not built yet (src/modules/budgets)
  expense_category: screen("expenses", "categories"), // search:none not built yet (src/modules/expense_categories)

  // Knowledge Hub
  policy: screen("knowledge", "policies"), // search:none not built yet (src/modules/knowledge)
  sop: screen("knowledge", "sops"), // search:none not built yet (src/modules/knowledge)
  faq: screen("knowledge", "faqs"), // search:none not built yet (src/modules/knowledge)
  training_course: screen("knowledge", "training"), // search:none not built yet (src/modules/knowledge)
  knowledge_announcement: screen("knowledge", "announcements"), // search:none not built yet (src/modules/knowledge)

  // Praxis AI
  ai_conversation: screen("praxis_ai", "history"), // search:none not built yet (src/modules/assistant)

  // Settings
  department: screen("settings", "organisation"),
  app_user: screen("settings", "users"),
  // A person's own login, as they see it: sign-ins, sessions, their password.
  account: screen("ess", "my-security"), // search:none a person's own login opens from My Security; logins are found as Users (app_user)
  role: screen("settings", "roles-and-permissions"),
  workflow_definition: screen("settings", "approvals"),
  numbering_scheme: screen("settings", "documents-and-numbering"),
  public_holiday: screen("settings", "organisation"),
  template: screen("settings", "documents-and-numbering"), // search:none not built yet (src/modules/templates)
  integration: screen("settings", "integrations"), // search:none not built yet (src/modules/integrations)
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
    if (r.param !== undefined && (!/^[a-z][a-z_]*$/.test(r.param) || ["tab", "id"].includes(r.param)))
      throw new Error(
        `route-map: ${type} carries its id as "${r.param}"; name a snake_case value other than tab and id`,
      );
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
    path: r.param
      ? screenPath(target.module, target.tab, { params: { [r.param]: id } })
      : screenPath(target.module, target.tab, { id }),
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

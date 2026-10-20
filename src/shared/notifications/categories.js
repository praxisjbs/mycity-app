"use strict";
/**
 * Notification categories: the handful of switches a person sees in their
 * notification preferences (Settings, Notifications, M6), and what each defaults to.
 *
 * Event keys are fine-grained ("leave_request.approved", "payslip.published");
 * nobody wants a switch per key. Every notification is tagged with a category when
 * it is written, from the first segment of its event key, so:
 *  - the inbox filters by category, and
 *  - delivery checks the person's preference for (category, channel) first, except
 *    for `security`, which cannot be switched off: a change to who can do what
 *    always reaches the people who watch for it.
 *
 * Channels: in_app (the bell, always the record), email, push. A category's
 * defaults apply until the person changes them; a preference row overrides.
 *
 * An event key whose first segment is not mapped takes its module's category, and
 * failing that `system`, so a new event is never dropped.
 */

const CHANNELS = Object.freeze(["in_app", "email", "push"]);

/** In display order. `locked`: cannot be switched off on any channel that is on by default. */
const CATEGORIES = Object.freeze([
  { key: "security", label: "Security", locked: true, email: true, push: true },
  {
    key: "approvals",
    label: "Approvals",
    locked: false,
    email: true,
    push: true,
  },
  { key: "tasks", label: "Tasks", locked: false, email: true, push: true },
  { key: "alerts", label: "Alerts", locked: false, email: true, push: false },
  {
    key: "comms",
    label: "Messages and Mail",
    locked: false,
    email: false,
    push: true,
  },
  {
    key: "people",
    label: "Attendance and Leave",
    locked: false,
    email: false,
    push: true,
  },
  {
    key: "performance",
    label: "Performance",
    locked: false,
    email: false,
    push: false,
  },
  {
    key: "queries",
    label: "Queries and Sanctions",
    locked: false,
    email: true,
    push: true,
  },
  {
    key: "recruitment",
    label: "Recruitment",
    locked: false,
    email: false,
    push: false,
  },
  { key: "payroll", label: "Payroll", locked: false, email: true, push: false },
  {
    key: "partnerships",
    label: "Partnerships",
    locked: false,
    email: false,
    push: false,
  },
  {
    key: "expenses",
    label: "Expenses",
    locked: false,
    email: false,
    push: true,
  },
  {
    key: "knowledge",
    label: "Knowledge Hub",
    locked: false,
    email: false,
    push: false,
  },
  { key: "system", label: "System", locked: false, email: false, push: false },
  // Production faults and the readiness checks, for the IT team only. Locked like
  // Security: push and the bell cannot be switched off, because a fault nobody is told
  // about is the whole thing System Health exists to prevent. Email stays off by
  // default; only the 24 hour escalation declares it (fanout defineNotification channels).
  { key: "system_health", label: "System Health", locked: true, email: false, push: true },
]);

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** First segment of an event key → category. */
const DOMAIN_TO_CATEGORY = Object.freeze({
  // the system watching itself
  system_health: "system_health",

  // who can do what
  auth: "security",
  session: "security",
  access: "security",
  role: "security",
  permission: "security",
  field_visibility: "security",
  capability: "security",
  app_user: "security",
  device: "security",

  // approvals and alerts
  workflow: "approvals",
  home: "alerts",

  // workspace
  task: "tasks",
  calendar_event: "tasks",
  reminder: "tasks",

  // community and mail
  channel: "comms",
  channel_message: "comms",
  direct_message: "comms",
  direct_thread: "comms",
  announcement: "comms",
  recognition: "comms",
  celebration: "comms",
  mention: "comms",
  mail: "comms",
  mail_thread: "comms",

  // people
  employee: "people",
  attendance: "people",
  attendance_record: "people",
  leave_request: "people",
  leave: "people",
  worksite: "people",
  import_batch: "people",
  department: "people",

  // performance
  goal: "performance",
  target: "performance",
  kpi: "performance",
  review: "performance",

  // queries and sanctions
  query: "queries",
  sanction: "queries",
  query_rule: "queries",

  // recruitment, offers, onboarding
  vacancy: "recruitment",
  candidate: "recruitment",
  assessment: "recruitment",
  interview: "recruitment",
  offer: "recruitment",
  onboarding: "recruitment",
  talent_pool_entry: "recruitment",

  // payroll
  payroll_run: "payroll",
  payslip: "payroll",
  salary_structure: "payroll",
  deduction: "payroll",
  statutory_return: "payroll",

  // partnerships
  partner: "partnerships",
  partner_deal: "partnerships",
  lead: "partnerships",
  proposal: "partnerships",
  contract: "partnerships",
  mou: "partnerships",
  agreement: "partnerships",
  interaction: "partnerships",

  // expenses
  expense: "expenses",
  requisition: "expenses",
  disbursement: "expenses",
  budget: "expenses",

  // knowledge
  policy: "knowledge",
  sop: "knowledge",
  faq: "knowledge",
  training_course: "knowledge",
  knowledge_announcement: "knowledge",
});

/** Module key → category, for an event whose first segment is not mapped above. */
const MODULE_TO_CATEGORY = Object.freeze({
  home: "alerts",
  workspace: "tasks",
  ess: "people",
  community: "comms",
  mailbox: "comms",
  people: "people",
  performance: "performance",
  queries: "queries",
  recruitment: "recruitment",
  payroll: "payroll",
  partnerships: "partnerships",
  expenses: "expenses",
  knowledge: "knowledge",
  praxis_ai: "system",
  settings: "system",
  system_health: "system_health",
});

/**
 * The category for an event key: its first segment, else the module it belongs to,
 * else "system". Never throws.
 * @param {string} eventKey
 * @param {string} [moduleKey]  the event's module (catalogue entry or event.module)
 */
function categoryFor(eventKey, moduleKey) {
  const domain = String(eventKey || "").split(".")[0];
  return (
    DOMAIN_TO_CATEGORY[domain] || MODULE_TO_CATEGORY[moduleKey] || "system"
  );
}

const isCategory = (key) => BY_KEY.has(key);
const isChannel = (ch) => CHANNELS.includes(ch);

/** True when the category cannot be switched off. */
function isLocked(category) {
  const c = BY_KEY.get(category);
  return Boolean(c && c.locked);
}

/** Whether a channel is on for a category before the person has said anything. */
function defaultOn(category, channel) {
  if (channel === "in_app") return true;
  const c = BY_KEY.get(category) || BY_KEY.get("system");
  return channel === "email" ? c.email : channel === "push" ? c.push : false;
}

/**
 * Is a channel on, given the person's stored preference (true, false, or undefined
 * when they never set one) and the company's default for the notice (Settings ·
 * Notifications; undefined or null when People left it to the category)? The person's
 * choice wins, then the company's, then the notice's own declared default
 * (defineNotification's `channels`: the 24 hour escalation declares email, which its
 * category leaves off), then the category's. A locked category stays on
 * wherever it is on by default.
 */
function isOn(category, channel, stored, company, declared) {
  if (isLocked(category) && defaultOn(category, channel)) return true;
  if (stored !== undefined && stored !== null) return stored === true;
  if (company !== undefined && company !== null) return company === true;
  if (declared !== undefined && declared !== null) return declared === true;
  return defaultOn(category, channel);
}

module.exports = {
  CHANNELS,
  CATEGORIES,
  DOMAIN_TO_CATEGORY,
  MODULE_TO_CATEGORY,
  categoryFor,
  isCategory,
  isChannel,
  isLocked,
  defaultOn,
  isOn,
};

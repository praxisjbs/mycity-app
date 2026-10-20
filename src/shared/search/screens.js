"use strict";
/**
 * ⌘K's screens: every tab of the staff app, by its name and the words people use
 * for it (docs/guides/foundation.md §6.7). "Holiday" finds My Leave, "salary slip"
 * finds My Payslips, "workflow" finds Settings, Approvals.
 *
 * One entry per screen in shared/route-map.js SCREENS, with the label the shell
 * shows (app/src/shell/catalogue.ts). The search coverage gate
 * (scripts/check/search-coverage.js) fails a screen in the route map with no entry
 * here, an entry for a screen that does not exist, and a label that differs from
 * the shell's. `npm run new:screen` adds the entry with the screen; add its words.
 *
 * Who sees a screen: the reader holds `view` on its module, and the tab is one the
 * shell shows them (tabVisible mirrors app/src/shell/access.ts visibleTabs). A tab
 * behind a capability (README §5.2) is offered only to a reader who holds it.
 */
const s = (module, tab, label, words = []) => Object.freeze({ module, tab, label, words: Object.freeze(words) });

const SCREENS = Object.freeze([
  s("home", "overview", "Overview", ["home", "dashboard", "kpis", "needs you", "waiting on you"]),
  s("home", "alerts", "Alerts", ["alert", "warnings", "issues", "red flags"]),
  s("home", "reports", "Reports", ["report", "analytics", "insights"]),
  s("home", "team", "Team", ["my team", "direct reports", "reports to me"]),

  s("workspace", "today", "Today", ["my day", "agenda", "to do"]),
  s("workspace", "tasks", "Tasks", ["task", "to do", "todo", "assignments", "work items"]),
  s("workspace", "calendar", "Calendar", ["schedule", "meetings", "events", "diary"]),
  s("workspace", "analytics", "Analytics", ["my productivity", "my stats"]),

  s("ess", "my-profile", "My Profile", ["profile", "my details", "personal details", "bank details", "next of kin", "address"]),
  s("ess", "my-attendance", "My Attendance", ["attendance", "clock", "timesheet", "lateness", "punch"]),
  s("ess", "my-performance", "My Performance", ["performance", "my goals", "my kpis", "appraisal"]),
  s("ess", "my-payslips", "My Payslips", ["payslip", "pay slip", "salary slip", "salary", "pay"]),
  s("ess", "my-leave", "My Leave", ["leave", "holiday", "vacation", "time off", "annual leave", "days off"]),
  s("ess", "my-queries", "My Queries", ["query", "queries against me", "disciplinary"]),
  s("ess", "my-documents", "My Documents", ["documents", "my files", "contract", "certificates", "vault"]),
  s("ess", "work-location-requests", "Work Location Requests", ["remote work", "work from home", "wfh", "location change"]),
  s("ess", "my-devices", "My Devices", ["devices", "laptop", "phone", "equipment"]),
  s("ess", "policy-updates", "Policy Updates", ["policies", "acknowledge", "handbook"]),
  s("ess", "my-security", "My Security", ["security", "password", "pin", "passkey", "two step", "2fa", "sessions"]),
  s("ess", "org-chart", "Org Chart", ["organisation chart", "organization chart", "who reports to", "structure", "hierarchy"]),

  s("community", "channels", "Channels", ["chat", "messages", "groups", "discussion"]),
  s("community", "direct-messages", "Direct Messages", ["dm", "chat", "private message"]),
  s("community", "announcements", "Announcements", ["announcement", "news", "notice", "broadcast"]),

  s("mailbox", "inbox", "Inbox", ["mail", "email", "e-mail"]),
  s("mailbox", "sent", "Sent", ["sent mail", "outbox"]),
  s("mailbox", "drafts", "Drafts", ["draft"]),
  s("mailbox", "archive", "Archive", ["archived mail"]),
  s("mailbox", "spam", "Spam", ["junk"]),
  s("mailbox", "trash", "Trash", ["deleted", "bin"]),
  s("mailbox", "signature", "Signature", ["signature", "email signature", "sign-off", "whatsapp", "social links"]),

  s("people", "employees", "Employees", ["staff", "staff list", "register", "directory", "hr", "people"]),
  s("people", "attendance", "Attendance", ["team attendance", "clock ins", "lateness", "absence"]),
  s("people", "leave", "Leave", ["leave requests", "holiday", "time off", "leave calendar"]),
  s("people", "devices", "Devices", ["equipment", "laptops", "assets"]),
  s("people", "worksites", "Worksites", ["sites", "offices", "locations", "geofence"]),
  s("people", "organogram", "Organogram", ["org chart", "structure", "reporting lines", "seats", "hierarchy"]),

  s("performance", "goals", "Goals", ["goal", "objectives", "okr", "cascade"]),
  s("performance", "targets", "Targets", ["target", "monthly targets", "quota"]),
  s("performance", "kpis", "KPIs", ["kpi", "indicators", "metrics", "scorecard"]),
  s("performance", "reviews", "Reviews", ["review", "appraisal", "evaluation"]),
  s("performance", "analytics", "Analytics", ["performance analytics", "trends"]),

  s("queries", "queries", "Queries", ["query", "disciplinary", "issue a query"]),
  s("queries", "rules", "Rules", ["query rules", "triggers", "lateness rule"]),
  s("queries", "sanctions", "Sanctions", ["sanction", "warning", "suspension", "consequence"]),
  s("queries", "letter-templates", "Letter Templates", ["letters", "templates", "query letter"]),

  s("recruitment", "vacancies", "Vacancies", ["jobs", "openings", "hiring", "positions"]),
  s("recruitment", "candidates", "Candidates", ["applicants", "applications", "cv"]),
  s("recruitment", "assessments", "Assessments", ["tests", "assessment", "screening"]),
  s("recruitment", "interviews", "Interviews", ["interview", "panel"]),
  s("recruitment", "offers", "Offers", ["offer letter", "offer"]),
  s("recruitment", "onboarding", "Onboarding", ["new joiners", "induction", "onboard"]),
  s("recruitment", "talent-pool", "Talent Pool", ["pipeline of candidates", "future candidates"]),

  s("payroll", "payroll-runs", "Payroll Runs", ["payroll", "run payroll", "salaries"]),
  s("payroll", "payslips", "Payslips", ["payslip", "pay slip", "salary slip"]),
  s("payroll", "salary-structure", "Salary Structure", ["grades", "salary bands", "pay scale"]),
  s("payroll", "deductions", "Deductions", ["deduction", "loans", "advances"]),
  s("payroll", "statutory", "Statutory", ["paye", "pension", "nhf", "tax", "remittance"]),

  s("partnerships", "pipeline", "Pipeline", ["deals", "partnership pipeline", "crm"]),
  s("partnerships", "partners", "Partners", ["partner", "organisations", "clients", "crm"]),
  s("partnerships", "leads", "Leads", ["lead", "prospects"]),
  s("partnerships", "proposals", "Proposals", ["proposal", "pitch"]),
  s("partnerships", "contracts-and-mous", "Contracts & MOUs", ["contracts", "mou", "agreements"]),
  s("partnerships", "analytics", "Analytics", ["partnership analytics", "partnership report"]),

  s("expenses", "my-requests", "My Requests", ["expense", "expenses", "claim", "reimbursement", "my expenses"]),
  s("expenses", "approvals", "Approvals", ["expense approvals", "approve expenses"]),
  s("expenses", "requisitions", "Requisitions", ["requisition", "purchase request"]),
  s("expenses", "disbursements", "Disbursements", ["disbursement", "payments out", "payouts"]),
  s("expenses", "budgets", "Budgets", ["budget", "spend limits"]),
  s("expenses", "categories", "Categories", ["expense categories", "expense types"]),

  s("knowledge", "policies", "Policies", ["policy", "handbook", "rules", "attendance policy", "grace period", "lateness policy", "clock in rules"]),
  s("knowledge", "sops", "SOPs", ["sop", "procedures", "processes", "how to"]),
  s("knowledge", "faqs", "FAQs", ["faq", "questions", "help"]),
  s("knowledge", "training", "Training", ["courses", "learning", "lessons"]),
  s("knowledge", "announcements", "Announcements", ["company news", "notices"]),

  s("praxis_ai", "ask", "Ask", ["ai", "assistant", "chat", "question"]),
  s("praxis_ai", "history", "History", ["ai history", "past questions", "conversations"]),

  s("ai_control", "actions", "Actions", ["ai control", "ai actions", "fallback", "chain", "make first", "which model", "top tier", "deep reasoning", "transcription model", "gemini", "anthropic", "claude", "groq", "deepseek"]),
  s("ai_control", "models", "Models", ["ai models", "model prices", "find prices", "ai prices", "openai", "price per million"]),
  s("ai_control", "spend", "Spend", ["ai spend", "ai cost", "ai budget", "monthly cap", "set cap", "recharge", "spend by action"]),

  s("settings", "organisation", "Organisation", ["organization", "company", "company profile", "working week", "holidays", "public holidays"]),
  s("settings", "status", "Status", ["health", "system health", "uptime", "checks", "disk", "memory", "cpu", "server"]),
  s("settings", "performance", "Performance", ["performance", "response time", "slow", "error rate", "load"]),
  s("settings", "faults", "Faults", ["faults", "errors", "crashes", "exceptions", "stack trace", "brief"]),
  s("settings", "users", "Users", ["logins", "accounts", "invite", "user accounts"]),
  s("settings", "roles-and-permissions", "Roles & Permissions", ["roles", "permissions", "access", "grants", "rbac"]),
  s("settings", "approvals", "Approvals", ["approval flows", "workflow", "approval route", "hierarchy", "sign off"]),
  s("settings", "notifications", "Notifications", ["notification settings", "alerts settings", "email settings"]),
  s("settings", "appearance", "Appearance", ["theme", "dark mode", "branding"]),
  s("settings", "documents-and-numbering", "Documents & Numbering", ["numbering", "number format", "document numbers", "prefixes"]),
  s("settings", "integrations", "Integrations", [
    "integration", "connect", "api keys", "smtp", "mail server", "no-reply", "imap", "system sender",
    "geoapify", "maps key", "address search", "gemini", "ai key", "web push", "vapid", "push keys",
    "groq", "whisper", "transcription key", "openai", "embeddings key", "anthropic", "claude", "deepseek",
    "ai models", "add model", "exchange rates", "exchange rate", "dollar rate", "sync rates", "free plan", "paid plan",
  ]),
  s("settings", "security", "Security", ["password rules", "sessions", "two step", "failed sign ins"]),
  s("settings", "audit-log", "Audit Log", ["audit", "history", "who changed", "activity log"]),
  s("settings", "imports", "Imports", ["import", "upload", "spreadsheet", "import history"]),
  // new:screen adds screens above this line
]);

/**
 * @typedef {{grants: Record<string, string[]>, capabilities: string[], is_ceo: boolean, manages_people: boolean}} Reader
 */

/**
 * Does the reader hold this capability? The CEO holds every one, as requireCapability
 * passes them. Mirrors app/src/shell/access.ts hasCapability.
 * @param {Reader} reader
 * @param {string} code  a code in shared/access/access.catalog.js CAPABILITY_CATALOG
 */
function hasCapability(reader, code) {
  return reader.is_ceo === true || (reader.capabilities || []).includes(code);
}

/**
 * Does the shell show this tab to the reader? Mirrors app/src/shell/access.ts
 * visibleTabs, so search never offers a tab the person's menu hides.
 * @param {{module: string, tab: string}} screen
 * @param {Reader} reader
 */
/** Settings' tabs that system_health holds rather than settings. */
const SYSTEM_HEALTH_TABS = ["status", "performance", "faults"];

function tabVisible(screen, reader) {
  const can = (module, action = "view") => (reader.grants[module] || []).includes(action);
  // Status, Performance and Faults sit in Settings but are held by system_health
  // (docs/guides/system-health.md §8), as the shell shows them (app/src/shell/access.ts).
  if (screen.module === "settings" && SYSTEM_HEALTH_TABS.includes(screen.tab)) return reader.is_ceo || can("system_health");
  // Integrations is the IT team's: its own key, not Settings' (docs/guides/integrations.md §8).
  if (screen.module === "settings" && screen.tab === "integrations") return reader.is_ceo || can("integrations");
  if (!can(screen.module)) return false;
  const full = can("settings") || reader.is_ceo;
  const { module, tab } = screen;
  // Home's Team, Alerts and Reports follow capabilities. Search offers only a tab the
  // reader can use, so these stay hidden here even where the shell shows one locked
  // (docs/guides/home.md §10.1).
  if (module === "home" && tab === "team") return hasCapability(reader, "home.team");
  if (module === "home" && tab === "alerts")
    return hasCapability(reader, "alerts.clear") || hasCapability(reader, "alerts.manage");
  if (module === "home" && tab === "reports") return hasCapability(reader, "home.reports");
  // Knowledge Hub · Policies is for those who write policies; everyone reads theirs on Policy Updates.
  if (module === "knowledge" && tab === "policies") return hasCapability(reader, "policies.manage");
  if (module === "people" && !full) return tab === "attendance" || tab === "organogram";
  if (module === "community" && tab === "announcements") return can("people", "create");
  if (module === "queries" && !full) return tab === "queries";
  if (module === "expenses" && !full)
    return ["my-requests", "approvals", "budgets"].includes(tab) && (tab !== "approvals" || reader.manages_people);
  if (module === "performance" && !full && !reader.manages_people) return tab !== "analytics";
  return true;
}

module.exports = { SCREENS, tabVisible, hasCapability };

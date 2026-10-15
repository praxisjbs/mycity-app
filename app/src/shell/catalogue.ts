import type { IconName } from "@mycity/ui";

/**
 * Every module and tab in the staff app, in rail order.
 *
 * Keys are the permission keys (src/shared/access/access.catalog.js); tab slugs
 * are the approved inventory (MILESTONES §18, docs/PROGRESS.md) and never change
 * when a label does. src/shared/route-map.js lists the same slugs, so a link the
 * backend derives always lands on a screen that exists.
 */
export interface TabDef {
  slug: string;
  label: string;
}
export interface ModuleDef {
  key: string;
  label: string;
  /** One word, for the More tiles and the bottom bar (F16, F17). */
  short: string;
  icon: IconName;
  area: "" | "Work" | "People" | "Business" | "System";
  tabs: TabDef[];
}

const t = (label: string, slug: string): TabDef => ({ label, slug });

export const MODULES: ModuleDef[] = [
  { key: "home", label: "Home", short: "Home", icon: "home", area: "", tabs: [t("Overview", "overview"), t("Team", "team"), t("Alerts", "alerts"), t("Reports", "reports")] },
  { key: "workspace", label: "My Workspace", short: "Workspace", icon: "check", area: "", tabs: [t("Today", "today"), t("Tasks", "tasks"), t("Calendar", "calendar"), t("Analytics", "analytics")] },
  {
    key: "ess", label: "Employee Self-Service", short: "Self-Service", icon: "user", area: "",
    tabs: [
      t("My Profile", "my-profile"), t("My Attendance", "my-attendance"), t("Work Location Requests", "work-location-requests"),
      t("My Devices", "my-devices"), t("Policy Updates", "policy-updates"), t("My Performance", "my-performance"),
      t("My Payslips", "my-payslips"), t("My Leave", "my-leave"), t("My Queries", "my-queries"), t("My Documents", "my-documents"),
      t("Org Chart", "org-chart"), t("My Security", "my-security"),
    ],
  },
  { key: "community", label: "Staff Community", short: "Community", icon: "msg", area: "Work", tabs: [t("Channels", "channels"), t("Direct Messages", "direct-messages"), t("Announcements", "announcements")] },
  { key: "mailbox", label: "Mailbox", short: "Mailbox", icon: "mail", area: "Work", tabs: [t("Inbox", "inbox"), t("Sent", "sent"), t("Drafts", "drafts"), t("Archive", "archive"), t("Spam", "spam"), t("Trash", "trash")] },
  {
    key: "people", label: "People", short: "People", icon: "users", area: "People",
    tabs: [t("Employees", "employees"), t("Organogram", "organogram"), t("Attendance", "attendance"), t("Leave", "leave"), t("Devices", "devices"), t("Worksites", "worksites")],
  },
  { key: "performance", label: "Performance", short: "Performance", icon: "target", area: "People", tabs: [t("Goals", "goals"), t("Targets", "targets"), t("KPIs", "kpis"), t("Reviews", "reviews"), t("Analytics", "analytics")] },
  { key: "queries", label: "Queries & Sanctions", short: "Queries", icon: "flag", area: "People", tabs: [t("Queries", "queries"), t("Rules", "rules"), t("Sanctions", "sanctions"), t("Letter Templates", "letter-templates")] },
  {
    key: "recruitment", label: "Recruitment", short: "Recruitment", icon: "brief", area: "People",
    tabs: [t("Vacancies", "vacancies"), t("Candidates", "candidates"), t("Assessments", "assessments"), t("Interviews", "interviews"), t("Offers", "offers"), t("Onboarding", "onboarding"), t("Talent Pool", "talent-pool")],
  },
  { key: "payroll", label: "Payroll", short: "Payroll", icon: "wallet", area: "People", tabs: [t("Payroll Runs", "payroll-runs"), t("Payslips", "payslips"), t("Salary Structure", "salary-structure"), t("Deductions", "deductions"), t("Statutory", "statutory")] },
  {
    key: "partnerships", label: "Partnerships", short: "Partnerships", icon: "link", area: "Business",
    tabs: [t("Pipeline", "pipeline"), t("Partners", "partners"), t("Leads", "leads"), t("Proposals", "proposals"), t("Contracts & MOUs", "contracts-and-mous"), t("Analytics", "analytics")],
  },
  {
    key: "expenses", label: "Expenses", short: "Expenses", icon: "wallet", area: "Business",
    tabs: [t("My Requests", "my-requests"), t("Approvals", "approvals"), t("Requisitions", "requisitions"), t("Disbursements", "disbursements"), t("Budgets", "budgets"), t("Categories", "categories")],
  },
  { key: "knowledge", label: "Knowledge Hub", short: "Knowledge", icon: "book", area: "System", tabs: [t("Policies", "policies"), t("SOPs", "sops"), t("FAQs", "faqs"), t("Training", "training"), t("Announcements", "announcements")] },
  { key: "praxis_ai", label: "Praxis AI", short: "Praxis", icon: "spark", area: "System", tabs: [t("Ask", "ask"), t("History", "history")] },
  {
    key: "settings", label: "Settings", short: "Settings", icon: "cog", area: "System",
    tabs: [
      t("Organisation", "organisation"), t("Users", "users"), t("Roles & Permissions", "roles-and-permissions"), t("Approvals", "approvals"),
      t("Attendance Policy", "attendance-policy"), t("Notifications", "notifications"), t("Appearance", "appearance"),
      t("Documents & Numbering", "documents-and-numbering"), t("Integrations", "integrations"), t("Security", "security"), t("Audit Log", "audit-log"),
    ],
  },
];

/**
 * The phone's bottom bar (F16): Home, Workspace, Community and Self-Service,
 * then More, which opens the launcher (F17). The same five for everyone.
 */
export const BOTTOM_BAR = ["home", "workspace", "community", "ess"] as const;

/** The More launcher's groups (F17), in order: every module with an area. */
export const AREAS = ["Work", "People", "Business", "System"] as const;

export const moduleByKey = (key: string | null | undefined) => MODULES.find((m) => m.key === key);

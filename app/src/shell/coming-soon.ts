/**
 * What each screen will do, shown on its Coming Soon card (shell/Planned.tsx).
 * Keyed "<module key>/<tab slug>". Three short lines, in the words a member of
 * staff uses, from the screen as built and its milestone in MILESTONES.md.
 * The milestone and date come from docs/PROGRESS.md and MILESTONES.md, not here.
 */
export const COMING: Record<string, string[]> = {
  /* Home */
  "home/overview": ["Your role's KPIs and main chart, each opening the records behind the number", "Need You: everything waiting on you, in one list", "Who is in today, and what the organisation did today"],
  "home/alerts": ["Alerts raised by the rules: lateness, missed clock-outs, overdue approvals", "Filter by category and clear what you have handled", "Each alert links to the record that raised it"],
  "home/reports": ["Ready-made reports for your role, run on today's data", "Schedule a report to arrive by email", "Export to Excel or PDF, generated as you, so nothing leaks"],
  "home/team": ["Your team today: on site, remote, field, late or on leave", "Who has not clocked out, and who is late again", "Team KPIs, opening the people behind each number"],

  /* My Workspace */
  "workspace/today": ["The tasks your manager set for today, and your own", "Your diary and the meetings ahead", "Tick off work as you go; your manager sees progress live"],
  "workspace/tasks": ["Every task on a board: to do, in progress, in review, done", "Tasks your manager set for the week, and ones you add", "Due dates, priorities and comments on each"],
  "workspace/calendar": ["Your week: meetings, leave, public holidays and deadlines", "Invites go out as calendar files people can accept", "Book time with a colleague at a free slot"],
  "workspace/analytics": ["How your week went: tasks done, on time and late", "Trends over the month, against your team", "What is slipping, before it becomes a problem"],

  /* Employee Self-Service */
  "ess/my-profile": ["Your record as People sees it, and what you can change yourself", "Photo, contact details and next of kin", "Your work schedule, set by People"],
  "ess/my-attendance": ["Every clock-in and clock-out, with where it was made", "Late days and missed clock-outs, and why they were raised", "Your attendance against the month"],
  "ess/my-performance": ["Your KPIs for the month, weighted to 100%", "The goal chain above your KPI, up to the CEO", "Self rating first, then your manager, then a second approval"],
  "ess/my-payslips": ["A payslip for every approved run, as a PDF", "Deductions, each linked to its query", "Any past year, from your start date"],
  "ess/my-leave": ["Your entitlement, what you have taken and what is left", "Request leave; your line manager decides", "Approved leave shows on the team calendar"],
  "ess/my-queries": ["Open queries with a 48 hour response window", "Archived queries, with your response kept on record", "Sanctions, and any deduction they carried"],
  "ess/my-documents": ["Your documents in the vault: contract, ID, certificates", "Upload what is missing, with a progress bar", "Expiry dates, with a reminder before they lapse"],
  "ess/work-location-requests": ["Ask for a temporary home, a remote day or a client visit", "Your line manager, then People, approve it", "On those days your clock-in is matched to that place"],
  "ess/my-devices": ["The phones and laptops you clock in from", "Approve a new device, or remove a lost one", "Clock-in is refused from a device you have not approved"],
  "ess/policy-updates": ["Each new version of the attendance policy, in plain words", "What changed, and from when", "Acknowledge you have read it; People sees who has"],
  "ess/my-security": ["Your password and two-step sign-in", "Where you are signed in, and sign out anywhere", "Recent sign-ins, so a stranger's stands out"],
  "ess/org-chart": ["Who you report to, and who reports to them", "Your team and the teams around it", "Find anyone, and how to reach them"],

  /* Staff Community */
  "community/channels": ["Team channels, with replies, reactions and polls", "Announcements pinned where everyone sees them", "Birthdays and work anniversaries, celebrated automatically"],
  "community/direct-messages": ["One-to-one messages with anyone at MyCity", "Files, photos and voice notes", "Read receipts and who is online"],
  "community/announcements": ["Post to everyone, a department or a site", "See who has read each announcement", "Schedule a post for later"],

  /* Mailbox */
  "mailbox/inbox": ["Your work mail, on the company domain", "Read, reply and forward without leaving the app", "Attachments open in place"],
  "mailbox/sent": ["Everything you have sent, searchable", "Delivery status for each message", "Forward or resend in one step"],
  "mailbox/drafts": ["Drafts saved as you type", "Pick up a draft on your phone", "Attachments kept with the draft"],
  "mailbox/archive": ["Mail you have filed away, kept and searchable", "Move mail back to the inbox", "Search by sender, subject or date"],
  "mailbox/spam": ["Mail the filter caught, held for 30 days", "Mark a message as not spam", "Block a sender"],
  "mailbox/trash": ["Deleted mail, kept for 30 days", "Restore anything deleted by mistake", "Empty the trash when you are sure"],

  /* People */
  "people/employees": ["Every employee's record, from hire to exit", "Add employees one by one or import the staff sheet", "A 360 view: attendance, leave, KPIs, queries and documents"],
  "people/attendance": ["Who is in, late, remote or absent, live", "Missed clock-outs raise a query automatically", "Monthly attendance by person and department"],
  "people/leave": ["Every leave request, with who decides it", "Balances by person and leave type", "The leave calendar, so cover is planned"],
  "people/devices": ["Every device staff clock in from", "Approve, flag or revoke a device", "Spot a device shared between two people"],
  "people/worksites": ["Offices, studios and hubs, with their clock-in radius", "Who is assigned to which site", "Field and remote work, set per person"],
  "people/organogram": ["The reporting tree for the whole company", "Move a person or team by dragging", "Vacant positions shown where they sit"],

  /* Performance */
  "performance/goals": ["Company goals, broken down to each department", "Progress rolled up from the KPIs beneath", "Who owns each goal"],
  "performance/targets": ["Monthly targets set by managers", "Reviewed by the COO and Operations, approved by the CEO", "Binding once approved"],
  "performance/kpis": ["Each person's KPIs for the month, weighted to 100%", "Set by department managers", "Progress updated as work is done"],
  "performance/reviews": ["Self rating, then the manager, then a second approval", "Comments kept with each rating", "Review cycles by month or quarter"],
  "performance/analytics": ["Performance by department and by person", "Who is improving and who needs support", "Trends across review cycles"],

  /* Queries & Sanctions */
  "queries/queries": ["Raise a query, with a 48 hour window to respond", "Missed clock-outs and lateness raise queries automatically", "Decide each one, with the response on record"],
  "queries/rules": ["The rules that raise queries: lateness, missed clock-outs", "Thresholds per rule, changed without a deploy", "See what each rule raised this month"],
  "queries/sanctions": ["Caution, warning, suspension, dismissal, in order", "Deductions that go to payroll automatically", "Each sanction linked to its query"],
  "queries/letter-templates": ["Query and sanction letters, on the letterhead", "Fields filled from the record", "Edit the wording; every letter keeps its version"],

  /* Recruitment */
  "recruitment/vacancies": ["Create a vacancy, drafted by AI from the role", "Publish to the careers page and share the link", "Applicants, stage and days open for each role"],
  "recruitment/candidates": ["Every applicant, with an AI screening score marked provisional", "Move candidates through the stages", "A person reads every CV; the score only ranks the queue"],
  "recruitment/assessments": ["Psychometric tests, technical tests and case studies", "Timed on the public site, autosaved and resumable", "Scores land on the candidate's record"],
  "recruitment/interviews": ["Schedule panels with calendar invites", "Panellists score blind until the round closes", "A consolidated report for the hiring manager"],
  "recruitment/offers": ["Offer letters generated from the role and the candidate", "Sent by mail and signed on a phone", "Signed offers lock and can be verified"],
  "recruitment/onboarding": ["Documents first, then pre-onboarding, then onboarding", "A checklist per hire, with what is outstanding", "Onboarding opens only when documentation is complete"],
  "recruitment/talent-pool": ["Strong candidates kept for future roles", "Why each was not hired this time", "Invite them to apply when a role opens"],

  /* Payroll */
  "payroll/payroll-runs": ["Run payroll for the month, previewed before it is approved", "Operations, then the CEO, approve each run", "Bank file and payslips generated on approval"],
  "payroll/payslips": ["Every payslip in every run", "Email payslips to staff in one step", "Correct and reissue with a full trail"],
  "payroll/salary-structure": ["Grades, bands and allowances", "Effective dates, so history stays right", "Who is on which grade"],
  "payroll/deductions": ["Loans, advances and sanction deductions", "Each linked to its source", "Recovered over the months you set"],
  "payroll/statutory": ["PAYE, pension and NHF, calculated for Nigeria", "Remittance schedules for each authority", "Year-end figures for each employee"],

  /* Partnerships */
  "partnerships/pipeline": ["Every partnership by stage, from first contact to signed", "Value and likelihood for each deal", "What has stalled, and for how long"],
  "partnerships/partners": ["A 360 of each partner: contacts, deals, documents", "Deliverables and who owns them", "Every interaction, logged"],
  "partnerships/leads": ["New leads, imported from your Excel trackers", "Assign and follow up", "Convert a lead to a deal in one step"],
  "partnerships/proposals": ["Proposals drafted from templates", "Versions and approvals", "Track which were won"],
  "partnerships/contracts-and-mous": ["Contracts and MOUs in the vault", "Renewal dates, with a reminder before they lapse", "Signed copies, hash verified"],
  "partnerships/analytics": ["Pipeline value and win rate", "Revenue by partner and by month", "Which deliverables are at risk"],

  /* Expenses */
  "expenses/my-requests": ["Request money for work, with receipts attached", "See where your request is in the approval chain", "Get notified when it is paid"],
  "expenses/approvals": ["Requests waiting on you, oldest first", "Approve, return or decline with a reason", "The budget each request draws on"],
  "expenses/requisitions": ["Group approved requests into one requisition", "Sent to the CEO for approval", "One payment run per requisition"],
  "expenses/disbursements": ["Pay approved requisitions", "Record the transfer reference for each payment", "Requesters notified when paid"],
  "expenses/budgets": ["Budgets by department and month", "Spend against budget, live", "Alerts before a budget runs out"],
  "expenses/categories": ["Expense categories and their limits", "Which categories need receipts", "Who can approve each category"],

  /* Knowledge Hub */
  "knowledge/policies": ["Company policies, versioned and searchable", "Who has read each version", "Only what your role may see"],
  "knowledge/sops": ["Step-by-step procedures for each department", "Owners keep them current", "Linked from the screens they describe"],
  "knowledge/faqs": ["Answers to the questions staff ask most", "Search in plain words", "Suggest a new question"],
  "knowledge/training": ["Training material and onboarding courses", "Track who has completed what", "Assign training to a person or team"],
  "knowledge/announcements": ["Company announcements, kept and searchable", "Filter by department or date", "Linked to the policy they change"],

  /* Praxis AI */
  "praxis_ai/ask": ["Ask questions about your operations in plain words", "Answers from records you can see, never more", "Every answer says what it read"],
  "praxis_ai/history": ["Your questions and what they read", "Spend per month, against a cap", "Clear your history at any time"],

  /* Settings */
  "settings/organisation": ["Company details, working week and public holidays", "Grace periods for clocking in", "Changed here, without a deploy"],
  "settings/users": ["Invite an employee to sign in", "Change a user's role, or disable a login", "Disabled logins keep their history"],
  "settings/roles-and-permissions": ["Create roles from the screen", "Grant modules, actions and record scope", "Mask salary, bank details and query history"],
  "settings/approvals": ["Approval chains for leave, expenses, payroll and more", "Deputies for when an approver is away", "Changed without a deploy"],
  "settings/attendance-policy": ["Clock-in rules, grace periods and radius", "Draft changes, then publish a new version", "Staff acknowledge each version"],
  "settings/notifications": ["Which events notify whom", "In the app, by email, or both", "Quiet hours and digests"],
  "settings/appearance": ["The organisation's default theme", "Light, dark or the device setting", "Each person can still choose their own"],
  "settings/documents-and-numbering": ["Number formats for offers, queries and documents", "Letterhead and document templates", "Gap-free numbering, checked"],
  "settings/integrations": ["Mail, bank and other connected services", "Health checks for each connection", "Keys stored encrypted"],
  "settings/security": ["Two-step sign-in, required by role", "Active sessions, ended remotely", "Failed sign-ins and blocked attempts"],
  "settings/audit-log": ["Who did what, when, to which record", "Search by person, record, action or date", "Cannot be edited by anyone"],
  "settings/imports": ["Import a spreadsheet of records, column by column", "See what will be created before you commit", "Every import kept, with its error file and Revert"],
};

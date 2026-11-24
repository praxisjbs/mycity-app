ID: F09a
Title: Any requester can add a new bank name that everyone is then offered
Verdict: BY_DESIGN
Severity: Low
Module: Expenses
Evidence: Ran tests/integration/expenses.test.js on mycity_auditc_test: 18 of 18 pass, including "banks: the common ones and every bank a request names" (lines 181-195), where an unknown "Coda Bank" typed on a draft is then offered to every requester. GET /expenses/banks reads every expense_request.bank_name whatever its status, drafts and cancelled ones included (src/modules/expenses/expenses.repo.js:628-645; COMMON_BANKS at expenses.service.js:122). So the auditor's 'Not A Real Bank · 1 request' is the rule working as written.
Scope ref: docs/guides/expenses.md §6.1 rule 7 "The bank is typed or picked, never a closed list (TB, 11/11/2026) ... a bank it does not know is offered as Add and kept as typed, so it is suggested to everyone from then on"; handoff m8-expenses.md log 11/11/2026.
Fix: None required. If MyCity wants it, a small change (needs TB to re-decide): suggest only the common list plus banks named on requests that were paid, so a name typed on a draft, cancelled or rejected request is never offered to others (expenses.repo.js banks()).
Effort: S
For MyCity: Letting staff type a bank not on the list was agreed at the 11/11/2026 review, because the list cannot hold every microfinance bank. We can stop offering bank names that only appear on unpaid or cancelled requests if you would like that.

ID: F09b
Title: Invoice is optional and there are no purchase orders
Verdict: BY_DESIGN
Severity: Low
Module: Expenses
Evidence: The contract and service never require invoice_document_id to send (packages/contract/schemas/expenses.js payeeProblems checks only the four payee fields; expenses.service.js sendIn). The approvers' modal shows when there is none. "Require an invoice above a set amount" is an amount threshold, which decision 1 removed. Purchase orders: grep of MILESTONES.md and REUSE_MAP.md for "purchase order" finds nothing.
Scope ref: docs/guides/expenses.md §6.1 rule 2 "An invoice is optional but asked for (the approvers see when there is none)"; handoff m8-expenses.md §2 decision 1 (no approval threshold anywhere); MILESTONES §13 amended 04/11/2026. Purchase orders: no milestone (procurement is part of the finance core already ruled out of scope).
Fix: None. Purchase orders would need a Change Report (a PO record, its approval, matching an invoice and a payment to it).
Effort: S
For MyCity: The invoice is asked for but not forced, and every request takes the same route whatever its amount; both were agreed on 04/11/2026. Purchase orders are not part of the contract; we can scope them in a Change Report if you want them.

ID: F09c
Title: Account name and number are not checked against the payee
Verdict: IMPROVEMENT
Severity: Low
Module: Expenses
Evidence: account_number must be exactly ten digits (packages/contract/schemas/expenses.js:252, /^\d{10}$/), so 0000000000 passes; account_name is free text and never compared with payee_name (expenses.service.js payeeAsSent). A different account name is often legitimate (trading name vs registered name; the suite's own vendor is "Chuks Stores" paid to "Chuks Stores Ltd"). Confirming the name with the bank (name enquiry) needs a bank or payment-provider API, which no milestone includes.
Scope ref: MILESTONES §13 amended 04/11/2026 ("the bank details typed for the last three"); docs/guides/expenses.md §6.1 rules 2-3. No milestone covers a bank name-enquiry integration.
Fix: Cheap hardening: refuse an account number of one digit repeated, and show approvers a "Name Differs" pill on the request modal when the account name does not contain the payee name (packages/contract/schemas/expenses.js, app/src/features/expenses/parts.tsx, guide §6.1 and §10.1). Live bank verification would be a Change Report.
Effort: S
For MyCity: Bank details are typed as agreed, with a ten-digit check only. We will add a warning to approvers when the account name does not match the payee and refuse obviously fake numbers; checking names with the bank itself would need a payment-provider integration outside the contract.

ID: F09d
Title: No supplier master list maintained by Finance
Verdict: OUT_OF_SCOPE
Severity: Low
Module: Expenses
Evidence: grep of MILESTONES.md and REUSE_MAP.md for "supplier" and "vendor master" finds nothing. M8 says the bank details are typed for Vendor, Partner and DTT payees; there is no supplier table in the schema (docs/guides/expenses.md §4).
Scope ref: MILESTONES §13 amended 04/11/2026: "Staff with Use My Company Account ..., Vendor, Partner or Dedicated Task Team (DTT), the bank details typed for the last three"; lead's ruling that AP/finance core is out of scope.
Fix: None in scope. A Change Report would cover a supplier register (name, verified bank details, who may edit it), picking a payee from it on New Request, and its permissions and audit.
Effort: M
For MyCity: The contract has payee bank details typed on each request; a supplier list kept by Finance is a new feature we can quote for in a Change Report.

ID: F26a
Title: Requisitions tab shows Not Open to You with New Request
Verdict: BY_DESIGN
Severity: Low
Module: Expenses
Evidence: Management holds settings view (seeds/reference/0290_seed_roles_and_grants.sql:75), so visibleTabs shows every Expenses tab (app/src/shell/access.ts:38, 66). The "Program Manager" the auditor names is a Management-role post (seeds/staff/roles.json:11). Requisitions renders New Request above "Not Open to You" for a reader without expenses.finance (app/src/features/expenses/index.tsx:75-78), as the guide specifies.
Scope ref: docs/guides/expenses.md §2 (Requisitions: "New Request (their own), for anyone with expenses create, even where the list is not open to them") and §10.1 ("alone, primary, above Not Open to You for a reader without expenses.finance"), TB 13/11/2026.
Fix: None.
Effort: S
For MyCity: Requisitions stays visible on purpose so managers can raise their own request from it; the list itself is for Operations & People and the CEO.

ID: F26b
Title: Disbursements tab shown to people who cannot open it
Verdict: BUG
Severity: Low
Module: Expenses
Evidence: For any reader with settings view (Management), app/src/shell/access.ts:66 returns every Expenses tab, and Disbursements then shows only "Not Open to You" (app/src/features/expenses/index.tsx:303-309) because the reader lacks expenses.finance. The guide says the tab is for "expenses.finance holders and the CEO" (§2), and FRONTEND_GUIDE (lines 793-798) says a tab that belongs to fewer people than its module follows a capability and is hidden, Home's three tabs being "the one exception that shows". Unlike Requisitions, no decision keeps Disbursements visible. Code reading; the mirror rule is src/shared/search/screens.js:197-198.
Scope ref: docs/guides/expenses.md §2 (Disbursements row); docs/FRONTEND_GUIDE.md shell access paragraph (Home's gated tabs the only exception).
Fix: Hide Disbursements from readers without expenses.finance in visibleTabs (app/src/shell/access.ts) and tabVisible (src/shared/search/screens.js), changed together, with a test in Expenses.test.tsx; check the manual's Disbursements steps still carry their "needs".
Effort: S
For MyCity: Disbursements was showing as a locked tab to managers who cannot use it. We will hide it for anyone who does not record payments.

ID: F26c
Title: Payroll Record Advance form opens for people who cannot save it
Verdict: BUG
Severity: Low
Module: Payroll
Evidence: app/src/features/payroll/Deductions.tsx:106-130 shows the Record Advance button, screen action and ?action=advance whenever a month is open, with no grant check; the route needs payroll create (src/modules/deductions/deductions.routes.js:11, 38). Management holds payroll view only (0290_seed_roles_and_grants.sql:70, create false), so the form fills and then the API refuses. The helper usePayrollGrant (app/src/features/payroll/parts.tsx:51-54) exists but Deductions does not use it. Not touched by commits since 16/11. Code reading.
Scope ref: docs/FRONTEND_GUIDE.md ("A screen hides a button the same way ... Hiding is a courtesy: the API refuses"); docs/guides/payroll.md §2 Deductions row and §5 (POST /advances, payroll create).
Fix: Gate Record Advance (header button, useScreenAction, useUrlAction) on usePayrollGrant("create") in Deductions.tsx, and the row actions on their own grants; add a view-only case to Deductions.test.tsx.
Effort: S
For MyCity: The server already refuses the save correctly; we will hide Record Advance from anyone who is not allowed to record one, so nobody fills in the form for nothing.

ID: F70
Title: Phone forms put Save and Send at the end of a long scroll
Verdict: IMPROVEMENT
Severity: Low
Module: Expenses (and every form in a sheet)
Evidence: New Request's buttons sit in FormFooter (app/src/features/expenses/parts.tsx:289-294), which renders inline after the last field (packages/ui/src/form/Form.tsx:66-71, "mt-4 ... phone:[&>*]:w-full"). The sheet itself has a pinned footer (packages/ui/src/overlay/Sheet.tsx:58-71: the body scrolls, the footer is flex-none), but only ModalFooter portals into it (Modal.tsx:224-246). FormFooter is the house pattern: 130 feature files use it, 7 use ModalFooter. So the auditor is right that the buttons are not pinned; they are full width and 44 px, which meets the written rule ("at the bottom of the screen or the sheet, full width", FRONTEND_GUIDE line 365). Code reading.
Scope ref: docs/FRONTEND_GUIDE.md §3 phone rules ("The main action within thumb reach") and §8.4; docs/guides/expenses.md §10.2 (My Requests: "the form is a full sheet").
Fix: In packages/ui, let FormFooter inside an overlay on a phone portal its buttons into the sheet's pinned footer as ModalFooter does (keeping the press group), with its test and gallery page; then walk the long forms (New Request first) and retake the phone pictures (npm run guide:shots -- --stale).
Effort: M
For MyCity: The buttons work and are thumb-sized, but on long forms you have to scroll to reach them. We will pin them to the bottom of the screen on phones, starting with New Request.

ID: F43a
Title: Duplicate projects on staging were typed there, not seeded
Verdict: CLIENT_ACTION
Severity: Low
Module: My Workspace / Projects
Evidence: grep of seeds/ for "Lekki Launch" and "Lekki Branch Launch" finds nothing; the only staging seed that makes projects creates "Ember to Remember" and "Enugu City Launch" (seeds/staging/80_expenses.js:67-70, 204). So 'Lekki Branch Launch', 'Lekki Launch' and the two QA-AUDIT-Project-01 were entered on staging by people. A project is never deleted (docs/guides/workspace.md §6 Projects), so the spare one is completed, not merged.
Scope ref: docs/guides/workspace.md §6 "Projects (JBS Praxis, 23/10/2026) ... A project is never deleted"; A5 (production is never seeded).
Fix: None in code. MyCity (or whoever owns them) opens the spare project on My Workspace · Projects and presses Complete Project after moving its tasks to the one kept.
Effort: S
For MyCity: These duplicates were typed on staging during testing. Staging data does not go to production; on staging, complete the spare project and keep one.

ID: F43b
Title: No warning when a new project repeats an existing name
Verdict: IMPROVEMENT
Severity: Low
Module: My Workspace / Projects
Evidence: projects.service.js create() (lines 79-104) checks only the partner link; ProjectCreate is name, notes, due day (packages/contract/schemas/projects.js:64-73); no unique index on project names in migrations. Two projects with the same name save silently, as the auditor saw (PRJ-2026-000007 and 000008).
Scope ref: docs/guides/workspace.md §3 step 14 and §6 Projects (no rule on names either way).
Fix: Warn on New Project when an active project already has the same name (case and accents aside), as Partnerships' New Lead does: a lookup route or a 409 the form shows on Name with "Already a project", plus a test and guide §6 line.
Effort: S
For MyCity: Nothing stopped a second project with the same name. We will warn when a name is already used by an active project.

ID: F43c
Title: Due date and budget are not required on a project
Verdict: BY_DESIGN
Severity: Low
Module: My Workspace / Projects; Expenses
Evidence: New Project's form is Name, Notes Optional, Due Optional (workspace.md §10.1); ProjectCreate has due_on as blank-able (projects.js:69). A project's budget is not on the Workspace form: it is set on Expenses · Projects by an expenses.finance holder (projects.service.setBudget; budgets.test.js "Expenses · Projects: Set Budget" passes in the suite). Two of the five projects without a due date are our own demo projects (seeds/staging/80_expenses.js:204 creates them with no due day), staging only.
Scope ref: docs/guides/workspace.md §3 step 14 and §10.1 ("Due Optional"); docs/guides/expenses.md §6.6 rule 6 ("A project's budget is optional, set on Expenses · Projects"); handoff m8-expenses.md decision 7 ("A project has an optional budget too").
Fix: None.
Effort: S
For MyCity: Due dates and budgets are optional on projects by agreement; budgets are set by Operations & People on Expenses · Projects, not on the Workspace form.

ID: F79a
Title: A project completes with open tasks and no confirmation
Verdict: BY_DESIGN
Severity: Low
Module: My Workspace / Projects
Evidence: Complete Project is one press (app/src/features/workspace/Projects.tsx:139); projects.service.js edit() sets status completed and leaves the tasks alone (lines 121-126). The guide decides exactly this, and Reopen Project brings it back. The auditor confirmed a completed project leaves the expense picker, as designed.
Scope ref: docs/guides/workspace.md §11 "A project completed with open tasks: they stay open, where they were, still in the project; New Task on its page is gone until it is reopened"; §6 Projects.
Fix: None. Optional if MyCity asks: a confirm naming how many open tasks stay open.
Effort: S
For MyCity: Completing a project leaves its open tasks open and in place, and it can be reopened; this was the agreed behaviour.

ID: F79b
Title: Tasks can be assigned to someone who has no login yet
Verdict: IMPROVEMENT
Severity: Low
Module: My Workspace / Tasks
Evidence: Assign To lists every active employee in the setter's reach whether or not they have a login (src/modules/tasks/tasks.repo.js:327-345, WHERE e.status = 'active'), and the task saves; the person cannot see it until they are invited. Watchers, by contrast, are "anyone with a login" (workspace.md §10.1). No rule in the guide on assignees without a login. 'QA-AUDIT Employee' was created on staging by the auditor.
Scope ref: docs/guides/workspace.md §3 steps 1-2 and §10.1 (Assign To); CLAUDE.md "No login without an employee" (an employee may exist before their login).
Fix: Show "No Login Yet" beside such a person in the Assign To and Lead pickers (TaskPersonPage gains has_login; tasks.repo.js people(), TaskForms.tsx), guide §10.1 updated.
Effort: S
For MyCity: An employee can be given work before their account is set up. We will mark people who cannot sign in yet in the picker; before go-live, make sure every member of staff has been invited from People.

ID: F79c
Title: A leaver's projects cannot be handed to a new owner
Verdict: IMPROVEMENT
Severity: Low
Module: My Workspace / Projects
Evidence: The owner is whoever made the project and Edit Project has no owner field (packages/contract/schemas/projects.js:85-93; projects.service.js edit() changes name, notes, due, status, partner only). A reader with an all grant (Management, Operations & People, the CEO) can still edit and complete a leaver's project, so nothing is stuck. The guide covers a leaver's tasks (Left pill, setter reassigns, §11) but says nothing for projects. Our seed creates the two demo projects as the Operations & People Lead (seeds/staging/80_expenses.js:204); Cynthia is active in seeds/staff/staff-list.xlsx (S/N 6), so if she shows as a leaver on staging she was archived there by a person.
Scope ref: docs/guides/workspace.md §6 Projects and §11 ("Assignee leaves" covers tasks only). No milestone asks for reassigning work at exit.
Fix: Add Owner to Edit Project for its owner and all-grant readers (ProjectEditFields owner_employee_id, an active employee; projects.service.js edit(); Projects.tsx), and a Left pill beside an owner who has left; guide §6 and §11.
Effort: S
For MyCity: Projects of someone who leaves can still be managed by Management or Operations & People, but cannot be handed to a new owner. We will add a way to change the owner.

ID: F27
Title: Home's Overdue Tasks does not say whose tasks it counts
Verdict: IMPROVEMENT
Severity: Low
Module: Home / My Workspace
Evidence: Home's "Overdue Tasks" card counts in the reader's workspace scope (all for Management, so company-wide) and "My Overdue Tasks" counts the reader's own (src/modules/dashboard/kpi-catalog/tiles/work.js:79-131). My Workspace · Today's Overdue is personal (workspace.md §2). So the two figures are both right; the first label just does not name its reach, and has no help term.
Scope ref: docs/guides/home.md §6 Cards (Work: tasks_overdue; Personal: my_tasks_overdue) and §10.1; FRONTEND_GUIDE §5 (help terms, card title at most 4 words).
Fix: Give Home's Overdue Tasks a help term naming its reach ("Overdue tasks of everyone you can see.") or rename it Team Overdue Tasks; same in reports.sources.js and the manual's Home chapter, pictures retaken.
Effort: S
For MyCity: Home shows overdue tasks for everyone you can see, while My Workspace shows only yours. We will label the Home card so the difference is clear; you can also pick the My Overdue Tasks card on Home.


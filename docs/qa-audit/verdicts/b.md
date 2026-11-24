# Group b: Payroll, People, Settings

ID: F01a
Title: Statutory figures not yet entered on Configurations
Verdict: CLIENT_ACTION
Severity: Medium
Module: Payroll
Evidence: Configurations holds every statutory item as a dated version with its legal source or No Legal Source and a reason (payroll guide §6.11 rule 3a, §6.12 rules 7, 12, 13; StatutoryRatesSave refuses a figure without a source, 422 SOURCE_REQUIRED). No figure is seeded by design (seeds/staging/58_payroll.js:26-28 "Nothing statutory: no rate, band or relief, and the advanced option stays off"). The auditor's quoted rates were not checked from memory, on purpose (CLAUDE.md "Research has sources").
Scope ref: MILESTONES §11 amended 12/11/2026 ("MyCity has no accountant ... they then enter each figure of the guide's §6.16 with its source on Configurations"); payroll guide §13.1 item 38, §6.16 (the researched register, with instrument and section for each figure).
Fix: None in code. Operations & People enter each item that applies to MyCity on Payroll · Configurations, from the guide's §6.16 register with its source, then switch Advanced Payroll on from a date.
Effort: S
For MyCity: The system is ready to hold every statutory figure with its legal source; none is pre-loaded because MyCity's Operations & People enter them when MyCity starts statutory payroll. We can walk Operations & People through §6.16's researched list.

ID: F01b
Title: Run not blocked while statutory items read Not Set
Verdict: BY_DESIGN
Severity: Low
Module: Payroll
Evidence: In Advanced mode a run with no PAYE table, or no minimum wage while PAYE or NHF is in force, gets the blocking problem No Rates Set and Submit is refused (src/modules/payroll/payroll.repo.js:582-585, payroll.calc statutoryMissing; tests/integration/payroll-advanced.test.js:594 expects RUN_HAS_PROBLEMS). Pension, NHF, ITF and NSITF are deliberately optional because each applies only while MyCity is liable (pension from three employees, ITF from 25, NHF each person's choice). In simple mode (Advanced Payroll off) nothing statutory is computed at all, by decision.
Scope ref: payroll guide §6.12 rules 3 and 11, §13.2 item 38, §6.15; MILESTONES §11 amended 08/11/2026 ("Simple by default ... No statutory deduction ... until the advanced option is switched on").
Fix: None.
Effort: S
For MyCity: Once Advanced Payroll is on, a run already refuses to go for approval without PAYE bands and the minimum wage. The other items are only required when the law applies them to MyCity, so the system lets Operations & People decide.

ID: F01c
Title: Per-employee pension or PAYE exemption
Verdict: OUT_OF_SCOPE
Severity: Low
Module: Payroll
Evidence: No milestone or guide asks for a per-person pension or PAYE exemption. What is built per person: Contributes to NHF, State of Residence, rent declaration, Prior Pay, and the automatic minimum-wage PAYE exemption (payroll guide §6.12 rule 9, §13.1 items 44 and 45). grep for "exempt" in MILESTONES finds only the minimum-wage exemption (line 1111).
Scope ref: MILESTONES §11 and its amendments (08/11, 11/11, 12/11/2026); payroll guide §13.1 items 41 to 46.
Fix: None now. A Change Report would cover: which exemptions apply (each with its legal source, researched per CLAUDE.md), a per-employee switch with reason, evidence document and dates, how the engine and the statutory report treat it.
Effort: M
For MyCity: A per-person exemption was not part of the agreed payroll scope. If MyCity needs it, we will scope it in a Change Report with the legal basis for each exemption.

ID: F01d
Title: Test PAYE band of 0 to 200 naira on staging
Verdict: CLIENT_ACTION
Severity: Low
Module: Payroll
Evidence: Not from our seeds or scripts: seeds/staging/58_payroll.js:26-28 enters nothing statutory; grep of seeds/ and scripts/ for statutory writes finds only the M6 video scene, which opens the Employee Pension form and presses Cancel (scripts/video/scenes/m6-payroll-2.js:158-163). So the band was typed on screen on staging. Staging only: production is never seeded with demonstration data (A5).
Scope ref: payroll guide §6.12 rule 5 ("Test data is not seed data"), §13.1 item 38.
Fix: None in code. Settings · Audit Log shows who saved it; whoever did enters the real table as a new version (or Remove Change while it is not yet in force). If it was our build account, we remove it.
Effort: S
For MyCity: That band is not something we shipped; it was entered by hand on staging during testing. It will not exist on production, and the real bands are entered with their legal source when MyCity starts statutory payroll.

ID: F02a
Title: Blocking problems do stop Submit for Approval
Verdict: NOT_REPRODUCED
Severity: Low
Module: Payroll
Evidence: Ran tests/integration/payroll-run.test.js (27/27 pass), including "Submit is refused while a blocking problem stands, and freezes nothing" (a person with no salary: 422 RUN_HAS_PROBLEMS, run stays Computed, no approval opened). Throwaway test zz-audit-b-payroll: a November run with one no-salary person, Submit answered 422 RUN_HAS_PROBLEMS. "Computed" is the stage after Compute, not an approval (payroll guide §6.9). The Submit for Approval button is still shown while blocking problems stand (can_submit ignores them, src/modules/payroll/payroll.service.js:93; app/src/features/payroll/PayRuns.tsx:476), and pressing it gives the refusal.
Scope ref: payroll guide §6.9, §6.15 ("Submit refuses while any Blocking problem stands"); MILESTONES §11 amended 08/11/2026.
Fix: Optional: set can_submit false while blocking_problems > 0, or show the reason beside the button, so the stage reads clearly (payroll.service.js present(), PayRuns.tsx).
Effort: S
For MyCity: We tested this: a run with a blocking problem cannot be sent for approval; the system refuses it. Computed only means the figures were worked out. We may tidy the screen so the Submit button does not appear until blocking problems are fixed.

ID: F02b
Title: No PAYE deducted because Advanced Payroll is off
Verdict: BY_DESIGN
Severity: Low
Module: Payroll
Evidence: A run is advanced only when the setting in force on its month's first day has Advanced Payroll on (src/modules/payroll/payroll.run.js:207-217); in simple mode no statutory line is computed, whatever figure is In Force. The auditor's count (20 blocking = the 20 No Salary Set) fits simple mode: an advanced run with PAYE in force and no minimum wage would also report No Rates Set.
Scope ref: MILESTONES §11 amended 08/11/2026 ("Simple by default"); amended 12/11/2026 (Operations & People "do not apply statutory deductions yet"); payroll guide §6.11 rule 2.
Fix: None.
Effort: S
For MyCity: PAYE is only deducted once Advanced Payroll is switched on, which MyCity chose to keep off until Operations & People are ready. Entering a band alone does not start deductions.

ID: F02c
Title: Pending fine waits until someone accepts it
Verdict: BY_DESIGN
Severity: Low
Module: Payroll
Evidence: A fine reaches a run only after Accept This Month or Spread Over Months on Deductions (payroll guide §6.6 rule 2); until then the run shows the warning Fine Waiting (src/modules/payroll/payroll.repo.js FINE_WAITING; payroll-run.test.js "the problems a run reports" expects FINE_WAITING). The staging fine is the queries seed's ₦5,000 (seeds/staging/58_payroll.js:24-26), left waiting on purpose.
Scope ref: MILESTONES §11 ("Approved consequences from M3 arrive as pending deductions and must be explicitly accepted into a run"); payroll guide §6.6.
Fix: None.
Effort: S
For MyCity: Fines are not taken automatically; a person with payroll rights accepts, spreads or waives each one, and the run warns while one is waiting. This was agreed in the payroll scope.

ID: F02d
Title: Advance instalment silently lost when its person is excluded
Verdict: BUG
Severity: High
Module: Payroll
Evidence: Throwaway test zz-audit-b-payroll: a ₦150,000 advance (2 instalments) for a person with no salary; Compute shows only No Salary Set (no warning about the advance); after Exclude, Submit and CEO approval, the November instalment stays 'scheduled' with no run, the advance stays 'active', and payroll.inputs.instalmentsFor for December returns only December's ₦75,000. The query takes only instalments of the run's own month (or later ones for a leaver), never an earlier unpaid one (src/modules/payroll/payroll.inputs.js:162-163). Nothing warns that an instalment due is not being recovered.
Scope ref: payroll guide §6.6 rules 6, 7 and 9; MILESTONES §11 ("Salary advances are recorded by Operations & People and recovered as instalments").
Fix: Raise a warning (or blocking problem) when a person with an instalment due is excluded or has no pay, and let a later run take a past month's still-scheduled instalment (or move it to the next open month) instead of leaving it behind. Files: payroll.repo.js PROBLEMS, payroll.inputs.js instalmentsFor, a test in payroll-run.test.js.
Effort: M
For MyCity: You were right that the system does not warn here, and we found the money is never recovered if that person is left out of the run. We will fix it so the instalment is flagged and carried to the next run.

ID: F02e
Title: Joiner added after Compute not flagged until recomputed
Verdict: IMPROVEMENT
Severity: Low
Module: Payroll
Evidence: Throwaway test: a person hired after Compute has no payslip and no problem in the Computed run (headcount unchanged); Submit's recompute takes them in (their payslip existed after the refused Submit), and a changed total is refused with RUN_CHANGED (payroll guide §6.9 rule 7; §11 "Pay changed after Compute"). So nobody is lost at approval, but the screen shows a stale run without saying so.
Scope ref: payroll guide §6.1 rule 5, §6.9 rule 7, §11.
Fix: Show "Records changed since Compute" on the run card when an employee record or pay item that the run reads changed after computed_at, with Compute Run beside it (payroll.service.js present(), PayRuns.tsx).
Effort: S
For MyCity: A new joiner is always included when the run is sent for approval, because the system recalculates then. We will add a notice so the screen also says the figures are out of date.

ID: F02f
Title: Vendor build account counted in MyCity's payroll at 1.85M naira
Verdict: BUG
Severity: High
Module: Payroll
Evidence: The one salaried payslip of ₦1,850,000 matches the JBS Praxis build account, created by create-admin with gross_monthly 1850000.00, consultant, contract to 09/12/2026 (scripts/db/create-admin.js:224-247), on staging and production (docs/runbooks/first-accounts.md §2). A run takes every active or suspended person (payroll guide §6.1 rule 1), and handover only suspends the login (first-accounts.md §5), so the employee record stays in every run. The staging seed excludes it from its own demo runs (seeds/staging/58_payroll.js:20-22); a run made by hand does not. The other 20 have no salary entered (CLIENT_ACTION: enter pay on People · Employees).
Scope ref: payroll guide §6.1; first-accounts runbook §2 and §5; A5 (no demonstration data on production).
Fix: Give the build account no gross_monthly (and no bank) in create-admin, clear it on the existing staging and production records, and at handover set its employee record to left, not only suspend its login; add the step to first-accounts.md §5.
Effort: S
For MyCity: The only salary in that run was our own build account, which should never be in MyCity's payroll. We will remove its pay and close its record at handover. The other 20 staff need their salaries entered on People · Employees before the first live run.

ID: F11a
Title: Bank Details Required switched on mid-month misses this month's run
Verdict: BUG
Severity: Medium
Module: Payroll
Evidence: Throwaway test: switched Bank Details Required on today (24/11/2026), as the screen does (app/src/features/payroll/Configurations.tsx:202-206 sends effective_from today and toasts "Bank details now required"); November's run computed with config_snapshot.require_bank_details false and No Bank Details stayed a Warning; Submit then went through. The run reads the setting on its month's first day (src/modules/payroll/payroll.run.js:207, :279), and a change cannot be dated earlier than today (payroll.config.repo.js:108), so it only reaches next month's run.
Scope ref: payroll guide §6.1 rule 4, §6.11 rule 3a, §10.3 help ("When on, a person with no bank details blocks Submit"), §13.1 item 35.
Fix: Read the bank rule as it stands when Compute or Submit runs (or from the open run's month), not on the month's first day; keep the advanced switch by period. payroll.run.js computeInto, a test in payroll-run.test.js.
Effort: S
For MyCity: Turning the switch on now only takes effect from next month's run, although the screen says it applies at once. We will fix it so it applies to the run in progress.

ID: F11b
Title: No Bank Details is a warning unless the switch is on
Verdict: CLIENT_ACTION
Severity: Medium
Module: Payroll
Evidence: NO_BANK is 'warning', or 'blocking' when Bank Details Required is on (src/modules/payroll/payroll.repo.js:558-560); default off, decided with MyCity because some staff may be paid another way. "Verified payout details" (checking an account with the bank) is not in any milestone.
Scope ref: payroll guide §13.1 item 35 ("blocks Submit when on and lets a run go without bank details when off ... as built"), §6.1 rule 4; MILESTONES §11 amended 08/11/2026 ("a Bank Details Required switch live on Configurations").
Fix: None in code beyond F11a. Operations & People switch Bank Details Required on in Payroll · Configurations, and enter bank name and account number for each person on People · Employees.
Effort: S
For MyCity: The control exists and is MyCity's choice; turn on Bank Details Required in Payroll, Configurations if every person must have bank details. Account verification with the bank was not in the agreed scope.

ID: F58a
Title: Date of birth allows a six-year-old employee
Verdict: IMPROVEMENT
Severity: Low
Module: People
Evidence: node check of the contract: EmployeeAdd accepts date_of_birth 2020-01-01 with start 2026-11-16; the only rule is birth before start (packages/contract/schemas/organisation.js:215). No guide or milestone sets a minimum age.
Scope ref: foundation guide §6.16 (the rules Add Employee holds); MILESTONES §6 (M1 employee management).
Fix: Add a minimum age at the start date to employeeDateProblems, as a figure MyCity gives with its source (legal or "a company rule"), per CLAUDE.md "Research has sources".
Effort: S
For MyCity: The form only checks that a birth date is before the start date. We can add a minimum age; please confirm the age MyCity wants and its basis.

ID: F58b
Title: Gross pay below the minimum wage accepted silently
Verdict: IMPROVEMENT
Severity: Low
Module: People
Evidence: EmployeeAdd accepts gross_monthly 5000.00 (organisation.js pay: only "Not below zero"). The Minimum Wage item exists on Payroll · Configurations (payroll guide §6.12) but is Not Set on staging and is not read by People · Employees.
Scope ref: payroll guide §6.12 (minimum_wage item), §13.1 item 45.
Fix: When a Minimum Wage version is in force, warn (not refuse) on the Gross Monthly field and add a run warning for anyone paid below it.
Effort: S
For MyCity: Nothing checks pay against the minimum wage yet, and the minimum wage figure is not entered. Once it is, we can warn when a salary is below it.

ID: F58c
Title: Tax ID and pension PIN have no format check
Verdict: IMPROVEMENT
Severity: Low
Module: People
Evidence: EmployeeAdd accepts tax_id "abc" (stored "ABC") and pension_pin "123": statutoryNumber allows any letters, digits and hyphens up to 30 (organisation.js:126-131). No spec gives a format.
Scope ref: payroll guide §6.12 rule 6 (the numbers the statutory report prints); foundation guide §6.16.
Fix: Add format rules for TIN and pension PIN once the formats are researched from the issuing bodies with sources (CLAUDE.md "Research has sources"); not from memory.
Effort: S
For MyCity: These fields accept any letters and digits today. We can add format checks once the official formats are confirmed from the issuing bodies.

ID: F58d
Title: Line manager and bank optional when adding an employee
Verdict: BY_DESIGN
Severity: Low
Module: People
Evidence: Line manager, worksite and staff number are optional references by decision (foundation guide §6.16 "an empty optional reference (line manager, worksite, staff number) is not given"); a person without a line shows under Needs a Decision on People · Employees (docs/runbooks/staff-roster.md §5). Missing bank details are reported by every run (No Bank Details, blocking with Bank Details Required on, payroll guide §6.11 rule 3a).
Scope ref: foundation guide §6.16; payroll guide §6.1 rule 4, §13.1 item 35.
Fix: None (see F11a and F11b for the bank rule).
Effort: S
For MyCity: A record can be saved before every detail is known; the run reports anyone without bank details, and blocks them once Bank Details Required is on.


ID: F10a
Title: Two-step sign-in not yet required for any role
Verdict: CLIENT_ACTION
Severity: Medium
Module: Settings
Evidence: Enforcement by role is built: Settings · Security, Two-Step by Role (app/src/features/settings/SecurityRules.tsx:129-150) sets role.two_step_required; a person holding such a role is sent to the set-up step at the next sign-in and cannot turn two-step off (src/modules/security/security.service.js:154-155, TWO_STEP_REQUIRED). Ran tests/integration/settings.test.js -t "two-step" (2 passed), including "a role that requires two-step makes its people set it up at their next sign-in". No role requires it out of the box, so 0 of 22 is the starting state, not a fault. The auditor's Management role holds Settings view only (seeds/reference/0290_seed_roles_and_grants.sql:75), so it could not switch it on.
Scope ref: MILESTONES §14 (M9) "MFA (TOTP) enrolment and enforcement by role", amended 16/10/2026; identity guide §6 rule 15.
Fix: None in code. Before go-live, Operations & People (Settings edit) open Settings · Security, Two-Step by Role, and switch on Implementation Team, Operations & People, Management and System Administrator; each holder sets it up at their next sign-in.
Effort: S
For MyCity: Requiring two-step sign-in by role is already built. Operations & People switch it on for the senior roles in Settings, Security before go-live, and those staff set it up the next time they sign in.

ID: F10b
Title: Some staff logins use personal Gmail addresses
Verdict: CLIENT_ACTION
Severity: Low
Module: Settings
Evidence: The addresses come from MyCity's own staff list: seeds/staff/staff-list.xlsx, Email column, rows 12 to 18 (seven Growth, Marketing and Graphics staff) are @gmail.com, read with src/shared/spreadsheet/parse.js. A login signs in with its employee's work email; when People correct Work Email, an unused login follows it and a login in use moves with Use Work Email on Settings · Users (ran tests/integration/logins.test.js: all pass, including "a login in use stays until Use Work Email"). No rule restricts logins to one email domain; none is in scope.
Scope ref: foundation guide §6.1 (the roster as MyCity gave it); identity guide §6 (Use Work Email).
Fix: None in code. MyCity issues @mycityapp.io addresses to these seven staff; People update Work Email on each record and press Use Work Email on Settings · Users for any login already in use, or send us a corrected staff list.
Effort: S
For MyCity: Seven people in the staff list MyCity gave us have personal Gmail addresses. Once they have work addresses, People change them on each record and the login moves with one button.

ID: F13a
Title: Requests from staff under a vacant seat go above it
Verdict: NOT_REPRODUCED
Severity: Low
Module: People
Evidence: Throwaway test zz-audit-b-controls (deleted): a person moved to report to a vacant seat whose line manager is Kemi; their leave request's first stage named Kemi (type employee), and Kemi approved it. The rule is the view employee_effective_manager (migrations/1160_employee_effective_manager.sql: the first person above a chain of vacant seats, else the CEO), read by src/shared/workflow/approvers.js:53-60. So staff under "Head, Strategy, Partnerships & Growth" wait on the Program Manager, whom the sheet puts above that seat (seeds/staff/staff-list.xlsx row 20). Settings · Approvals' Needs Fixing counts flows with invalid stages, not vacant approvers, so 0 is correct.
Scope ref: organogram guide §4 and §6 (TB, 19/10/2026); MILESTONES §5 (A11, amended 14/10/2026).
Fix: None.
Effort: S
For MyCity: We tested it: when a manager's seat is empty, the request goes to the next person up, so nothing waits on an empty seat.

ID: F13b
Title: Nobody but the CEO can approve their own request
Verdict: NOT_REPRODUCED
Severity: Low
Module: Approvals
Evidence: Throwaway test zz-audit-b-controls (deleted): an Operations & People holder's 7-day leave reached the Operations & People stage; the requester got can_decide false and 403 on Approve, it was not in their My Approvals, and the other holder of the role approved it. Rule: src/shared/workflow/approvers.js:117 (canAct refuses opened_by) and :141-160 (waitingOnClause). Reassigning to the requester is refused (ran tests/integration/workflow.test.js, 20/20 pass, including the reassign test at line 430). A person cannot become their own approver through the tree either: reporting to oneself gave 422 REPORTS_TO_SELF and a loop through a vacant seat 422 REPORTING_LOOP, both orders. We could not open the staging request the auditor saw ("JBS Praxis Team" waiting on itself) from the repository.
Scope ref: MILESTONES §5 amended 14/10/2026 ("nobody approves their own request (the CEO excepted)"); foundation guide §6.5.
Fix: None in code. We open that staging request's route (People · Leave, the request, its approval) and report how it was named; if it shows a fault, it becomes a bug of its own.
Effort: S
For MyCity: The system refuses anyone approving their own request, and we tested it. We will look at the one staging request the audit named and report back.

ID: F13c
Title: CEO decides own review and both offer stages
Verdict: BY_DESIGN
Severity: Low
Module: Approvals
Evidence: The CEO may act on any stage of any approval, and a CEO's own request with nobody above them waits on the CEO (src/shared/workflow/approvers.js:116 and :82-86). Throwaway test: the CEO's own leave routed to the CEO with can_decide true; tests/integration/workflow.test.js (20/20 pass) "the CEO approves anywhere, even a stage that names someone else". So OFF-0001, where Ifeoma Mbonu approved both the Head of Department and CEO stages, and the CEO's own review naming the CEO, follow the rule. A rule that each stage needs a different person is F78b.
Scope ref: MILESTONES §5 amended 14/10/2026 ("the CEO excepted"); foundation guide §6.5 ("the CEO excepted, who may decide any stage") and its events table (the CEO decides their own request, 02/11/2026).
Fix: None.
Effort: S
For MyCity: This was agreed: the CEO can approve at any step and approves their own requests, since nobody sits above the CEO. If MyCity wants a second person on CEO requests, see F78b.

ID: F75a
Title: A leaver's login is closed, though the role still lists them
Verdict: NOT_REPRODUCED
Severity: Low
Module: Settings
Evidence: Ran tests/integration/logins.test.js (all pass): archiving a record closes the login at once ("This account is closed", 403), the follow-on job ends every session and spends every open link, and Restore alone does not reopen it. Throwaway test zz-audit-b-controls (deleted): an Operations & People holder archived as Left kept their user_role row, but sign-in answered 403, their old token 401, and a new Operations & People stage notified only the active holder (0 notices to the leaver). The role row stays so Reactivate (after Restore) gives the same access back (src/modules/identity/identity.service.js:1093-1122; identity guide §6.1). So Cynthia Osakunih's listing grants nothing while she is Left. Her record is Active in our roster (seeds/staff/staff-list.xlsx row 7), so it was archived on staging on screen. The "JBS test" Gmail login is not in our seeds or scripts; it is a test login made on staging.
Scope ref: identity guide §6.1 ("no login works for someone who is not on the active staff list"); MILESTONES §14 (M9).
Fix: None in code. If Cynthia still works at MyCity, People press Restore on her record and Reactivate on Settings · Users. We suspend the JBS test login on staging; production has only the build account, suspended at handover (docs/runbooks/first-accounts.md §5).
Effort: S
For MyCity: We tested it: once someone leaves, their login is closed at once and every session ends, so the role they held gives them nothing. We will remove our test login from staging.

ID: F75b
Title: Role's people count leaves out closed logins its list shows
Verdict: IMPROVEMENT
Severity: Low
Module: Settings
Evidence: Throwaway test: role detail users = 1 while GET /users?role=operations_people listed "Tunde Bakare: active, Cyn Leaver: left". The count counts active logins only (src/modules/access/access.repo.js:16-19, HOLDERS); the People tab lists every login holding the role, whatever its status (app/src/features/settings/Roles.tsx:771-783). Both are right on their own terms, but side by side they read as a mismatch.
Scope ref: MILESTONES §14 (M9, Roles & Permissions); identity guide §10 (Settings · Users).
Fix: Have the People tab list active logins by default (filter status=active, with closed ones behind the status filter), or label the count "2 active" (Roles.tsx PeoplePanel).
Effort: S
For MyCity: The count shows people who can use the role; the list also showed someone who has left, marked Left. We will make the two read the same way.

ID: F76a
Title: No approval or effective date for a pay change
Verdict: OUT_OF_SCOPE
Severity: Medium
Module: People
Evidence: Throwaway test zz-audit-b-controls (deleted): a Management user changed gross_monthly 5,000.00 to 350,000.00 through PATCH /employees/:id, 200, and no approval opened. That is the specified behaviour: pay is a People · Employees field set by Add and Edit with People edit (payroll guide §2 screens table, People · Employees row), and payroll reads gross_monthly as it stands when Compute runs (payroll guide §6.3 rule 1). The money control is the run: every run is approved by the CEO before it is paid (MILESTONES §11 amended 08/11/2026). No milestone asks for a pay-change request, approval or effective date.
Scope ref: MILESTONES §11 (M6) and its amendments of 08/11, 11/11 and 12/11/2026; payroll guide §13.1.
Fix: None now. A Change Report would cover a pay-change request (new figure, reason, effective month) through a Settings · Approvals flow, payroll reading the figure in force for the run's month, and the record showing pending changes.
Effort: M
For MyCity: Pay changes were scoped as an edit on the employee record, checked when the CEO approves each payroll run. An approval step with an effective date for each change would be new work we can scope in a Change Report.

ID: F76b
Title: Management can edit pay while Payroll is view only
Verdict: CLIENT_ACTION
Severity: Low
Module: People
Evidence: Management holds People view, create and edit over everyone and sees Salary and pay (seeds/reference/0290_seed_roles_and_grants.sql:66, 0449_seed_field_visibility_capabilities.sql:15), so it may set pay on the record; Payroll view only governs runs. A role that masks Salary and pay cannot read or write it (src/shared/rbac/field-mask.js:211 assertWritable, 403 FIELD_RESTRICTED). Both are role settings MyCity controls on Settings · Roles & Permissions.
Scope ref: MILESTONES §14 (M9: custom roles, module rights and masked fields); payroll guide §2 (People · Employees row: "`people` edit, a field masked from a role is left out of its form").
Fix: None in code. If only Operations & People should change pay, Operations & People remove People edit from Management on Settings · Roles & Permissions, or mask Salary and pay for it (which also hides pay from Management).
Effort: S
For MyCity: Management may edit employee records today, pay included, because the role was set up that way. Operations & People can narrow it on Roles & Permissions.

ID: F76c
Title: Record History names changed fields; Audit Log keeps values
Verdict: BY_DESIGN
Severity: Low
Module: People
Evidence: Throwaway test: the History entry read "Record changed: Gross Monthly" (src/modules/organisation/employee-360.service.js:109-121), while GET /audit for the same change returned before.gross_monthly 5000.00 and after 350000.00, and Settings · Audit Log shows each field before and after (app/src/features/settings/AuditLog.tsx:174-215; Salary and pay masked for a role that hides it). History naming fields in words, not values, was decided 25/10/2026 (organogram guide change log: "History names the fields a change touched in words").
Scope ref: MILESTONES §14 (M9 definition of done: the audit log shows who did what, when and to which record); foundation guide §6.16.
Fix: None. Optional: a link from a History line to its Audit Log entry.
Effort: S
For MyCity: The old and new pay are recorded; they show on Settings, Audit Log for people allowed to see pay. The record's History only names what changed, by design, so salaries do not show to everyone who can read the record.

ID: F76d
Title: History shows the UTC date, not the Lagos date
Verdict: BUG
Severity: Low
Module: People
Evidence: app/src/features/people/Employee360.tsx:465 renders formatDate(r.occurred_at.slice(0, 10)), the UTC date of the timestamp, so a change at 00:45 Lagos on 17/11 (23:45 UTC on 16/11) reads 16/11/2026. formatDate on the full timestamp would use Africa/Lagos (packages/ui/src/lib/format.ts:8-21). ESS · My Profile's history has the same slice (app/src/features/ess/Profile.tsx:98). Code reading; the server sends a UTC ISO timestamp (employee-360.service.js:24).
Scope ref: CLAUDE.md rule "Dates ISO on the wire, day-first for people"; FRONTEND_GUIDE §6 (format helpers, Lagos time).
Fix: Pass the whole timestamp to formatDateTime (or formatDate) in Employee360.tsx History and ess/Profile.tsx, so the date and time read in Lagos time. A sweep of the other `_at.slice(0, 10)` uses (13 in app/src) is worth doing at the same time.
Effort: S
For MyCity: Changes made just after midnight showed the previous day. We will fix it so History shows Lagos date and time.

ID: F30a
Title: My Profile says On Probation where People say Active
Verdict: BUG
Severity: Low
Module: ESS
Evidence: Two rules for one status. People · Employees shows On Probation only when a confirmation due date is set and no confirmation date (app/src/features/people/status.ts:21), else Active. ESS · My Profile shows On Probation whenever confirmed_on is empty (app/src/features/ess/Profile.tsx:77 and :122, from src/modules/ess/ess.profile.js:57). MyCity's staff list carries no probation dates, so roster staff read Active on the register and On Probation on their own profile. Code reading; ran app/src/features/people/status.test.ts (6 pass), which holds the register's rule. Not seed data.
Scope ref: foundation guide §10.1 (employment status drawn from the record's status and two probation dates); ESS guide §10 (My Profile).
Fix: Send confirmation_due_on and status in the ESS profile and draw the pill with the same employmentStatus rule the register uses (ess.profile.js, ess/Profile.tsx, people/status.ts shared).
Effort: S
For MyCity: A person's own profile used a stricter rule than the employee list, so the two disagreed. We will make both read the same status.

ID: F30b
Title: Cancelled leave shows Withdrawn under Approver
Verdict: IMPROVEMENT
Severity: Low
Module: ESS
Evidence: ESS · My Leave's Approver column reads the person it waits on, else People for a recorded request, else Withdrawn for a cancelled one, else Decided (app/src/features/ess/Leave.tsx:26), while Status reads Cancelled. It is consistent on new records (as the auditor found), so not a data fault; the guide's My Requests row describes Approver as "the person it waits on by name, else the stage" and does not mention Withdrawn (ESS guide §10).
Scope ref: ESS guide §10 (ESS · My Leave row), §6 (cancel while it waits).
Fix: Show a dash under Approver for a cancelled request, so its state reads once, in Status (ess/Leave.tsx approverOf; the ESS chapter of the User Guide with it).
Effort: S
For MyCity: A cancelled request said Withdrawn in one column and Cancelled in the next. We will show it once.

ID: F35
Title: Staff logins wait for People to send the invitations
Verdict: CLIENT_ACTION
Severity: Medium
Module: Settings
Evidence: The roster gives every person a login in the invited state and sends no email, on purpose: "No email is sent: Send Invite (one or all) does that, later" (foundation guide §6.1; scripts/db/load-staff.js:31-33). Settings · Users has Invite All Pending (app/src/features/settings/index.tsx:119) and each record has Send Invite; the User Guide says the same (docs/manual/settings.md:280). So 13 of 23 Not Sent and Last Seen Never is the state before People invite. Announcement acknowledgement follows from staff signing in.
Scope ref: foundation guide §6.1 (TB, 16/10/2026); identity guide §6; MILESTONES §16 (M11 handover and training).
Fix: None in code. Operations & People press Invite All Pending on Settings · Users when MyCity is ready (in waves by department if preferred, with Send Invite on each record), then follow up on anyone still Invited; we can cover this in the M11 handover.
Effort: S
For MyCity: Nobody is emailed until Operations & People choose to invite them, so most staff have not signed in yet. Pressing Invite All Pending on Settings, Users sends every invitation at once.

ID: F37a
Title: Extra vacant CEO seat entered on staging
Verdict: CLIENT_ACTION
Severity: Low
Module: People
Evidence: No seed, loader or script creates a seat called CEO: the staff list's VACANT rows are the ten open posts in seeds/staff/staff-list.xlsx rows 20 to 29, and "CEO" in its Line Manager column resolves to the Chief Executive Officer post (src/modules/organisation/manager-text.js:29), never to a seat. Ran tests/integration/staff-nomenclature.test.js (all pass), which loads the real sheet and finds its open seats where the sheet puts them. So the seat was added on staging with Add Role. The warning "2 people and roles sit at the top" is the Organogram doing its job (app/src/features/organogram/OrgTree.tsx:402).
Scope ref: organogram guide §6 and §10 (People · Organogram); A5 (production is never seeded).
Fix: None in code. On staging, whoever added it closes the seat (today through Praxis AI's Save Role with status closed, see F37b) or gives it a line with Edit Role.
Effort: S
For MyCity: The extra CEO seat is not in the structure we loaded; it was added by hand on staging and will not exist on production. It can be removed there.

ID: F37b
Title: No Close Role button for an open role on screen
Verdict: IMPROVEMENT
Severity: Low
Module: People
Evidence: The API closes a vacant seat (OrgSeatUpdate status closed, packages/contract/schemas/organisation.js:776-790, PATCH /org-seats/:id) and Praxis AI's Save Role card can do it (organogram guide §9, "closed with status"), but the Organogram's Edit Role only changes title, department and reports-to; grep of app/src for a close action on a seat finds none. So a seat added by mistake cannot be removed with a button.
Scope ref: organogram guide §10 (People · Organogram: Create Vacancy and Edit Role on a vacant seat); MILESTONES §6 (M1 organogram).
Fix: Add Close Role to a vacant seat's Edit Role (asks first, refused while people report to it), using the existing route; the People chapter of the User Guide with it.
Effort: S
For MyCity: An open role added by mistake can only be removed through the assistant today. We will add a Close Role button.

ID: F38a
Title: Duplicate Marketing department and missing head entered on staging
Verdict: CLIENT_ACTION
Severity: Low
Module: People
Evidence: Our files define five departments, each with a short code and a head: General Management GM, Technology & Back-office Ops TBO, Branding & Marketing BM (head: the Head, PR, Marketing & Brand Strategy post), Partnership & Growth PG, People & Culture PC (seeds/staff/nomenclature.json:3-20). No seed or script makes a "Marketing" department (grep of seeds/ and scripts/). Ran tests/integration/staff-nomenclature.test.js (all pass): Branding & Marketing gets code BM and Chinyere Elechi as head, and a head cleared on screen stays cleared after the next deploy ("an edit made on screen stays"). A department added on screen without a code takes one from its name (src/modules/organisation/organisation.service.js:59-71), hence MARKETING. A department's avatar is its name's initials, first and last word, the same rule as people (packages/ui/src/lib/format.ts:181-186), hence TO beside the code TBO.
Scope ref: organogram guide §6.1 (departments are settings, edited on screen); foundation guide §6.1 (nomenclature, TB 22/10/2026).
Fix: None in code. Operations & People merge Marketing into Branding & Marketing (More Actions, Merge Department; docs/manual/people.md:535), set Branding & Marketing's head again, and edit any code they want shorter.
Effort: S
For MyCity: The extra Marketing department and the empty head were changed on staging, not loaded by us; our structure has five departments with heads. Operations & People can merge it in one step.

ID: F38b
Title: Build account's department code reads IMPLEMENTATION
Verdict: SEED_DATA
Severity: Low
Module: People
Evidence: Our build account is created in a department named Implementation (scripts/db/create-admin.js:233), made at lines 406-415 without a code, so it takes IMPLEMENTATION from its name (organisation.service.js:59-71), unlike the short codes of MyCity's departments. The build account is also created on production and suspended at handover (docs/runbooks/first-accounts.md §2, §5), so the department would remain.
Scope ref: foundation guide §6.1; docs/runbooks/first-accounts.md.
Fix: Give the build account's department a short code (IMP) when create-admin makes it, and retire the Implementation department at handover with the account (create-admin.js, the first-accounts runbook §5).
Effort: S
For MyCity: The Implementation department is ours, holding only our build account. We will give it a short code and remove it at handover.

ID: F39
Title: Avatar initials take the first and last word
Verdict: BY_DESIGN
Severity: Low
Module: Platform
Evidence: One rule for every name: the first letter of the first and last words (packages/ui/src/lib/format.ts:181-186; "Cynthia Osakunih" gives CO, held by packages/ui/src/lib/format.test.ts:78; ran it, 14 pass). It suits staff with middle names ("Tobiloba Iyanuoluwa Dada" gives TD). "JBS Praxis Team" is our build account (first name "JBS Praxis", last name "Team", scripts/db/create-admin.js:227-229), so JT follows the rule; no MyCity person or organisation is affected, and the account is suspended at handover.
Scope ref: FRONTEND_FOUNDATION (shared components and format helpers, packages/ui); docs/runbooks/first-accounts.md §5.
Fix: None.
Effort: S
For MyCity: Initials take the first and last name for everyone. JT belongs to our own build account, which is switched off at handover.

ID: F44
Title: Typos in job titles, a category and a goal entered on staging
Verdict: CLIENT_ACTION
Severity: Low
Module: People
Evidence: None of the three is in our files: grep of seeds/, migrations/ and scripts/, and of the parsed workbooks seeds/staff/staff-list.xlsx and seeds/staging/performance/*.xlsx, finds no "Markerting", "Infrastructuaral" or "#2bn". Expense categories are MyCity's to enter (A26; expenses guide §4, expense_category "Entered by MyCity"), and our plan seed writes "₦2 billion" (seeds/staging/45_performance_plan.js:46). So they were typed on staging. Production is never seeded with demonstration data (A5).
Scope ref: MILESTONES §1 A5 and A26.
Fix: None in code. Whoever entered them corrects the three job titles on People · Employees, the category name on Expenses · Categories and the goal title on Performance, and uses the corrected spellings in the production import.
Effort: S
For MyCity: These spellings were typed on staging and are not in anything we load. Please correct them there and in the data prepared for go-live.

ID: F69
Title: Some Audit Log entries name the record by a short ID
Verdict: BUG
Severity: Low
Module: Settings
Evidence: The record's name is looked up by id only for logins, roles and employees; anything else is named from the number, name, title or label its own entry recorded, else the screen shows the id's first eight characters (src/modules/audit/audit.repo.js:16-34; app/src/features/settings/AuditLog.tsx:44). Several Partnerships events record only the changed field, for example a deal's health: before {health}, after {health} (src/modules/partner_pipeline/partner_pipeline.health.js:30-36), so they read "Partner deal · aeb9ac4f". The same fault was fixed for accounts on 14/11/2026 (foundation guide change log, "named a record by an id's first eight characters"); Partnerships entries were not covered. Not changed since (git log on src/modules/audit). Code reading.
Scope ref: MILESTONES §14 (M9 definition of done: "who did what, when and to which record"); foundation guide §10 (Settings · Audit Log).
Fix: In RECORD_NAME, look up partner and partner_deal (and any other entity type whose events carry no number) by id, as for employees and roles (audit.repo.js), with a test per type.
Effort: S
For MyCity: Some Partnerships entries in the Audit Log showed an internal code instead of the record's number or name. We will make every entry name its record.

ID: F78a
Title: Payroll and expense chains are the agreed ones
Verdict: BY_DESIGN
Severity: Low
Module: Approvals
Evidence: Payroll: Operations & People compute and submit, and the run is approved by the CEO alone, as MyCity answered on 08/11/2026 (MILESTONES §11; payroll guide §3, the payroll.run flow naming the CEO). Expenses: the auditor read the Expense Request flow on its own; every approved request then goes into a requisition the CEO approves, so the CEO sees every expense before it is paid (Requester, Line manager, Operations, Requisition, CEO, Disbursed; MILESTONES §13 "Thresholds and the requisition, reconciled"). There is no amount threshold by decision (expenses guide §6.3, decision 1). Any flow can take extra stages on Settings · Approvals with Edit Stages, without a deploy (docs/manual/settings.md, Change who approves; MILESTONES §14 definition of done).
Scope ref: MILESTONES §11 (amended 08/11/2026), §13, §14; expenses guide decision 1; payroll guide §13.1.
Fix: None. If MyCity wants another checker before the CEO on payroll, Operations & People add a stage on Settings · Approvals.
Effort: S
For MyCity: The chains are the ones MyCity agreed: the CEO approves every payroll run and every requisition of expenses. Extra steps can be added in Settings, Approvals without any code change.

ID: F78b
Title: Rule that each approval stage needs a different person
Verdict: OUT_OF_SCOPE
Severity: Low
Module: Approvals
Evidence: The engine's fixed rules are: nobody approves their own request, the CEO excepted; the requester can withdraw; rejecting or sending back needs a reason; approvers are resolved when a stage starts (MILESTONES §5, amended 14/10/2026). The CEO may decide any stage (foundation guide §6.5), which is how one person filled two levels of OFF-0001 (F13c). No milestone asks for distinct approvers across stages.
Scope ref: MILESTONES §5 (A11, "Port it as it is; do not extend it in M0", amended 14/10/2026); foundation guide §6.5.
Fix: None now. A Change Report would cover a per-flow "different person at each stage" setting, whether the CEO exception still applies to it, and what happens when only one eligible person remains (skip, reassign or wait).
Effort: M
For MyCity: The agreed engine stops people approving their own requests but lets the CEO approve at any step. Requiring a different person at each step would be new work for a Change Report.

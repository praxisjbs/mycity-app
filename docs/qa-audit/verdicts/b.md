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


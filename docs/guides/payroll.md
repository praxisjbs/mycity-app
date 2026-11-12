# Payroll · Engineering Guide

| | |
|---|---|
| Owner | TB; the screens are LA's (JBS Praxis, 09/11/2026) |
| Milestone | M6 |
| Backend modules | `payroll`, `payslips`, `deductions`, `salary_structure`, `statutory` |
| Frontend paths | `app/src/features/payroll/`, `app/src/features/ess/Payslips.tsx` |
| Permission key(s) | `payroll` (runs, everyone's payslips, deductions, configurations); `ess` (a person's own payslips and deductions) |
| Capabilities | `payroll.configure` (switch the advanced option on or off, set the pay day, enter statutory rates, bands, salary grades and pay components; the run itself needs only the `payroll` grant) |
| Screens (PROGRESS.md rows) | #45 Payroll Runs, #46 Payslips, #48 Deductions, Configurations (new; PR 1 registers it in the next free row, #109 while free (#107 and #108 are the public site's), and marks #47 Salary Structure and #49 Statutory Dropped), #11 My Payslips; changes to Home (the Payroll In Progress card), Settings · Approvals (#72, the `payroll.run` flow), People · Attendance (#25, its Deductions and Overtime views gain a link to the run), Queries & Sanctions · Sanctions (a fine's Payroll state) and the Notification Settings (#74, the Payroll category) |
| Status | Agreed |
| Last changed | 11/11/2026 |

---

## 0 · How to use this guide

**This guide is the single source of truth for Milestone 6.** Every pull request, every chat and every
reviewer working on Payroll starts here and reads it in full. It defines what is built, how it behaves,
what each screen shows, how the work is cut into pull requests and when each is done. Nothing else
defines M6: the prototype in `app/src/features/payroll/` and its mock, `demo.html`, the Gemini notes of
the 4 November meeting and the earlier lines of `docs/guides/ess.md` are superseded where they differ.
`docs/handoff/m6-payroll.md` only ticks progress and keeps the log; it adds no requirement and settles
no decision.

- **Where this guide sits among the binding documents** (CLAUDE.md step 3): MILESTONES §11 is M6's scope
  and decisions A1 to A26 bind it; this guide records how M6 meets them, and the decisions of the 4
  November Modules Review and JBS Praxis's answers of 08/11/2026 (§13.1) amend MILESTONES §11 where they
  differ (it carries the same amendment, pointing here). The frontend foundation's F1 to F32 bind every
  screen here, with the one amendment §10.3 asks for. If you find a disagreement this guide does not
  settle, stop and raise it; do not pick.
- **Changing M6:** change this guide first, in the same pull request as the code, with a Change log line
  (§14). A decision that changes behaviour is recorded in §13 with its date and who took it. Never
  re-open §13.1; a decision in §13.2 may be changed by TB with a line in §14.
- **Before you write code** also read what CLAUDE.md step 2 lists for your task type. Appendix A names,
  in each pull request, the other guides and chapters that PR must change.
- **Reading order for a newcomer:** §0 and §1 (what and why), §3 (how it flows), §6 (the rules, the
  heart of it), Appendix A (the plan), then the sections your pull request names. Read §4 and §5 before
  you write a migration or a route.
- **Every chat opens the same way:** read this guide in full, read `docs/handoff/m6-payroll.md` for where
  the work stands and what comes next, take the first unticked item whose predecessors are merged, build
  it to this guide, tick it with the date and add a line to the log.

### 0.1 Words used here

| Word | Means |
|---|---|
| **Run** (pay run) | One month's payroll for everyone paid that month. One run per month, ever. Table `payroll_run`, numbered `PAY-2026-10` |
| **Period** | The month a run pays for, stored as its first day (`2026-10-01`), shown as "October 2026" |
| **Payslip** | One person's pay for one run: its lines, its totals and, once the run is approved, its PDF. Table `payslip`, numbered `PAY-2026-10-0001` |
| **Line** | One row of a payslip: an earning, a deduction or an employer charge |
| **Gross** | The person's monthly pay before deductions: `employee.gross_monthly`, prorated for a part month, plus confirmed overtime and earning adjustments |
| **Net** | What the person is paid: earnings less deductions. Employer charges never reduce it |
| **Pay item** | Attendance's pending deduction or overtime for one day (`attendance_pay_item`), priced from the monthly gross |
| **Fine** | A financial outcome attached to a sanction (`sanction_fine`), never a rung. Pending until payroll accepts or waives it |
| **Advance** | Salary paid to a person before the month it belongs to, recovered from later payslips. Paid outside this system by the CEO; payroll only records and recovers it |
| **Instalment** | One month's share of a fine or an advance that is spread over several runs |
| **Adjustment** | A one-off earning or deduction a person adds to a run, with a reason: a bonus, a correction of an earlier run |
| **Deduction** | Any line that reduces pay: lateness, early departure, absence, unpaid leave, unpaid suspension, a fine, an advance's repayment, an adjustment, and in advanced mode PAYE, employee pension and NHF |
| **Frozen** | A pay item or instalment taken into a submitted run (`in_run`); nobody can change it until the run is sent back or approved |
| **Locked** | A run that is approved: nothing in it can change, and its payslips are published |
| **Published** | A payslip the person can open: only those of an approved run |
| **Excluded** | A person left out of one run with a reason (a leaver paid elsewhere, a person on unpaid leave all month) |
| **Simple mode** | The default: gross, attendance and consequence deductions, advances, adjustments, net. No statutory word on any screen or payslip |
| **Advanced mode** | The option MyCity switches on when it wants PAYE, pension, NHF, ITF and NSITF computed, and salary grades. Off until someone with `payroll.configure` switches it on from a date |
| **Statutory rate** | A rate, band or flat relief in force from a date, entered by MyCity on Configurations; never seeded |
| **Employer charge** | A statutory cost to MyCity that is not taken from the person (employer pension, ITF, NSITF); on the statutory report, never on the net |
| **Working days** | The person's own working days in the month, from their work schedule and the working week (A22: Saturday works), less public holidays. The divisor of every daily rate |
| **Daily rate** | The monthly gross over the person's working days that month. Attendance prices its items with it; payroll uses the same function |
| **No Salary Set** | A person whose monthly gross is empty. They cannot be paid by a run until it is set or they are excluded |
| **Pay day** | The one day of the month MyCity pays, the same for every month: the 30th unless MyCity sets another day from 1 to 31 on Configurations; a day past a month's end is that month's last day (30 pays on 28 or 29 February), so 31 is always the month's last day and reads Last Day of Month. Never set per month. Shows as Next Payday on My Payslips |
| **Legal source** | The instrument a statutory figure comes from: its title, the section, a link or the document in the vault, and the day it was checked (§6.16). A figure with no legal source says so (No Legal Source) and gives the reason |

### 0.2 Where things come from

| Source | What it settles | Standing |
|---|---|---|
| MILESTONES §11 and decisions A1 to A26 | Scope, definition of done, the donor, A22, A26; amended 08/11/2026 | Binding (CLAUDE.md step 3) |
| REUSE_MAP §7 | The donor files and what changes on the way in | Wins over MILESTONES where they differ |
| Modules Review, 4 November 2026 (TB with AJ; transcript 00:35:30 to 00:40:03) | Simple run by month, payslips as modals with PDF, Email All and Download All, no grading, the advanced option on Configurations, deductions pulled from consequence management with accept, spread or waive, advances | The latest word on screens and scope |
| Requirements meeting, 10 October 2026 (Cynthia Osakunih for MyCity, 01:10:41) | Simple payroll by default, a run is a month, payslips computed from base pay and additions, submitted to the CEO or COO; Cynthia agreed | Client agreement |
| Discovery call, 2 September 2026 | MyCity's payroll today is simple; ITF and NSITF "as we scale"; confirmed the system can switch to a full statutory mode | Client intent |
| Module demos, 12 October 2026 (00:38:05) | Staff are mostly contractors and consultants who handle their own tax and pension, so no screen mentions PAYE or pension in simple mode | Rule kept (§6.10); "hidden behind an advanced option" is superseded by §13.1 |
| Milestones Review, 11 November 2026 (TB with LA, GE, AJ; transcript 00:42:13 to 01:01:02) | The pay day is one exact day for every month, a short month paying on its last day; every statutory deduction, pension included, is monthly, never annual; every rate carries a verifiable legal source, and one with none says so; statutory figures are entered by people, never updated by the system; a saved band or change can be removed; each PR planned on the most capable model and built in a fresh chat | Corrections (§13.1 items 29 to 37); they win over everything below them in this table |
| JBS Praxis's answers, 08/11/2026 and 09/11/2026 | Statutory built and shipped off; advances recorded by Operations & People; the CEO approves; a leaver's instalments and a negative net; no recurring allowances in simple mode; both payslips as modals; test people on staging; the payslip sample drafted; the rates, conventions, pay day and staff pay data as configuration MyCity enters in the app; LA builds the screens; Written ticked after the merge | Decisions (§13.1) |
| `docs/guides/attendance.md` §6.17, `queries.md` §6.6, `ess.md` | What attendance and queries hand to payroll and what My Payslips shows | Contracts this guide meets |
| `docs/DATABASE_SCHEMA.md` M1, M3 and M6 | What exists and what payroll owes | Facts |
| The primary legal texts read in PR 9, 11/11/2026 (§6.16) | Every statutory figure: its instrument, section, base, threshold and date | Binding for the figures once MyCity's accountant confirms the register (§13.1 item 38); until then none is entered |
| Not sources | `demo.html` (look only), the mock, the donors' rates and bands, the demo's PAYE bands, Gemini's summaries where the transcript says otherwise, secondary summaries of the law (firms, payroll vendors, the press), which only point to where a text is | Never |

### 0.3 The starting point (verified 08/11/2026)

- **Built and waiting for payroll:** `attendance_pay_item` with its statuses `pending`, `waived`,
  `confirmed`, `cut`, `in_run` and a `payroll_run_id` with no foreign key (`migrations/1435*.sql`,
  `src/modules/attendance/attendance.pay.js`); `sanction_fine` with `pending`, `accepted`, `rejected`,
  `settled`, `waived` and `sanctions.fines` (`pending`, `accept`, `settle`, `waive`;
  `src/modules/sanctions/sanctions.fines.js`); `employee.gross_monthly`, `bank_name`,
  `account_number` (masked under `employee.salary` and `employee.bank`); the numbering schemes
  `payroll_run` and `payslip` (`src/shared/numbering/schemes.js`, seeded in 0099); the `payroll` module key,
  its grants in `0290` (Implementation Team and Operations & People full; Management view, approve and
  export) and the salary mask defaults in `0449`; the `payroll` notification category (email on, push
  off); the AI risk class `payroll`; `shared/db/effective-dated.js`; `shared/time/working-week.js`;
  the workflow engine; the document engine and `exports`; the route map, ⌘K screens, Coming Soon and
  catalogue entries for five tabs; Home's hidden Payroll In Progress card and its empty source.
- **Not built at all:** every file in `src/modules/{payroll,payslips,deductions,salary_structure,statutory}/`
  and `packages/contract/schemas/{payroll,payslips,deductions,salary_structure,statutory}.js` is empty; no
  migration in the 6000 block; no `payroll.run` approval; `templates/documents/payslip.html`,
  `statutory-report.html` and `templates/email/payslip-ready.html` are empty; `docs/manual/payroll.md` is
  empty; no staging seed.
- **The prototype:** `app/src/features/payroll/index.tsx` (five tabs) and `app/src/features/ess/Payslips.tsx`
  run on the in-browser mock with INTERIM types (`app/src/api/types/payroll.ts`). It breaks several screen
  rules (explainer cards, footnotes, a disabled button, a client-computed period) and has a tab layout this
  guide replaces. It is a drawing to rebuild from, not code to keep.
- **Not in this container:** the donor code (`C:\pixie-girl-hub\src\shared\hr_payroll\`, `C:\praxis-ls`).
  A builder who needs it asks for the file; ported code never says where it came from (CLAUDE.md step 2).

---

## 1 · What it is for

Payroll pays MyCity's people once a month, from what the system already knows: who works there, what each
is paid, which days they were late or absent, which fines were upheld, which advances are being repaid. An
Operations & People officer opens a run for the month, the system computes every payslip, the officer
reviews what is wrong, deals with deductions, and sends the run to the CEO. The CEO's approval locks it
and publishes each payslip to its owner, who opens it in Employee Self-Service or in their mailbox.
MyCity's people are mostly contractors and consultants who handle their own tax and pension, so payroll is
simple by default; a switch on Configurations brings in PAYE, pension, NHF, ITF and NSITF and salary
grades when MyCity wants them.

**Who uses it:** Operations & People (run it), the CEO (approve it), Management (read it and approve),
every employee (read their own payslips and deductions), and the Implementation Team until handover.

**In scope.** Pay runs by month with compute, validate, submit, approve and lock, send back and mark
paid; payslips with a designed PDF, a modal, Email All and Download All; the Deductions tab fed by
attendance pay items, fines and advances, with accept, spread and waive; advances recorded by Operations &
People; adjustments; unpaid leave and unpaid suspension days; Configurations with the pay day and the
advanced option; in advanced mode PAYE, pension (employee and employer), NHF, ITF, NSITF against
effective-dated rates, salary grades, pay components and the statutory report; ESS · My Payslips; Home's
Payroll In Progress card; notices; ⌘K and Praxis AI; the User Guide chapter.

**Out of scope** (decided; do not build): any statutory deduction by default; salary grading in simple mode;
general-ledger postings (the donor's `payroll.postings.js` is not ported: MyCity has no ledger here); a bank
transfer file or any payment execution (the CEO transfers outside the system); bonus and rewards automation
(the donor's `rewards.*`); tax filing; loans other than advances; employee-requested advances; recurring
allowances in simple mode; other currencies (NGN only); changes to a locked run (a correction goes into the
next run as an adjustment).

---

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Payroll · Payroll Runs (`payroll-runs`, #45) | Staff app, People group | `payroll` view | The current run's figures and chain, its problems, its adjustments and the people left out, the run history, the approval | New Run, Compute, Add Adjustment, Exclude, Include, Submit for Approval, Approve, Send Back, Reject (the approver), Mark Paid, Email All Payslips, Download All, Statutory Report (advanced), Discard |
| Payroll · Payslips (`payslips`, #46) | Staff app | `payroll` view; amounts need the salary grant | The month's payslips (Preview until approved, Published after), one opening in a modal with its lines, or its PDF once rendered | Pick the month, open a payslip, Download PDF (`payroll` edit, a restricted file), search by person; Email All Payslips and Download All once the run is approved |
| Payroll · Deductions (`deductions`, #48) | Staff app | `payroll` view | Every deduction waiting or running: attendance items, fines, advances; the month's figures | Accept This Month, Spread Over Months, Waive (a fine); Record Advance, Cancel Advance; a link to People · Attendance to waive an attendance item |
| Payroll · Configurations (`configurations`, new, #109 while free) | Staff app | `payroll` view; changes need `payroll.configure` | Pay Day, Bank Details Required, the Advanced Payroll switch, Statutory Items and PAYE Bands; when on or once it has been: the conventions, Salary Structure, Pay Components | Set Pay Day, Switch On or Off from a date, Save Rate, Save Grade, Place People, Set Pay Components |
| ESS · My Payslips (`my-payslips`, #11) | Staff app | Every employee, own record | Gross, Net Received, Payslips, Deductions, Next Payday; the year's months; the month's payslip | Change year, open a month, Download PDF, Email a Copy, open Deductions, Download All |
| Home · Overview, the Payroll In Progress card | Staff app | Readers with the salary field and `payroll` view | Runs not yet paid, in their scope | Open the run |
| Settings · Approvals (#72) | Staff app | `settings` view | The `payroll.run` flow, its stage and version | Edit Stages (saves a new version) |
| People · Attendance (#25), ESS · My Attendance (#9) | Staff app | As today | A pay item's status In Payroll once the run is submitted; a waived or frozen item says why | Nothing new; waiving stays here (attendance guide §6.17) |
| Queries & Sanctions · Sanctions | Staff app | As today | A fine's Payroll state: Waiting, Accepted, Deducted, Waived | Nothing new |
| People · Employees (#24) | Staff app | As today | The pay fields payroll reads: monthly gross, bank, in advanced mode the pay split and the tax and pension numbers | Set them: already built in M1, the Add and Edit forms' Pay and Bank step (Gross Monthly, Bank, Account Number) and the staff import's same columns; `people` edit, a field masked from a role is left out of its form |
| Notification Settings (#74), the bell | Staff app | Everyone | The Payroll category: its notices, channels per person | As today |
| ⌘K, Praxis AI | Everywhere | By permission | Runs, payslips, deductions; reads and cards of §9 | As §9 |
| Knowledge Hub · User Guide | Staff app | By grants | The Payroll chapter, written when the screens are accepted (Appendix A, PR 8) | Read |

The four Payroll tabs replace the five of MILESTONES §18 (Salary Structure and Statutory fold into
Configurations; decision 1 of §13.1). Their slugs `salary-structure` and `statutory` are retired, not
renamed; both were Coming Soon, so no link in the wild breaks.

---

## 3 · How the screens relate

**3.1 The month** (the main flow). Every step names what carries it.

1. **The days close.** Attendance judges each day and writes pending deductions and overtime
   (`attendance_pay_item`, attendance guide §6.17). People waive deductions with a reason; line managers
   confirm or cut overtime. Nothing here waits for payroll.
2. **A run is opened.** On Payroll Runs, Operations & People press New Run and pick the month
   (`POST /api/v1/payroll/runs`, `payroll` create). One run per month: a second is a 409. The run is a Draft.
3. **Compute.** Compute Run (`POST /payroll/runs/:id/compute`) builds a payslip for everyone paid that month and
   every line (§6.3 to §6.8). It can be pressed again whenever an input changes; it replaces the lines, never
   the adjustments or exclusions. The run becomes Computed and lists its problems (§6.15).
4. **Deal with what is wrong.** A person with No Salary Set is fixed on People · Employees or excluded; a
   negative net is fixed by spreading a deduction or adding an adjustment; warnings (pending overtime, no bank
   details) are read and left or fixed. Fines waiting for payroll are accepted, spread or waived on Deductions
   (flow 3.3); an advance is recorded on Deductions (flow 3.4); a one-off earning or deduction is added to the
   run as an adjustment.
5. **Submit.** Submit for Approval (`POST /payroll/runs/:id/submit`) computes again in the same transaction. If
   the totals differ from what the person last saw, the answer is 409 `RUN_CHANGED` with the new totals and the
   person presses again (§6.9). Otherwise the pay items and instalments are frozen (`in_run`), the run is
   `submitted` and `payroll.run` opens, naming the CEO. The engine tells the approver.
6. **The decision.** The approver opens the run on Payroll Runs (or the bell's link) and presses Approve, Send
   Back or Reject (`POST /workflow/instances/:id/approve`, `request-changes`, `reject`; the approvals' own routes).
   Send Back and Reject both return the run to Draft with the reason and release everything frozen (§6.9).
7. **Approved means locked.** After commit the engine's completion handler (`payroll.apply_decision`) locks the
   run: status `approved`; instalments `applied`; a fine whose last instalment applied is settled through
   `sanctions.fines.settle`; every payslip `published` and its PDF requested through `documents.generate`;
   `payslip.published` tells each employee "Your payslip is ready" (§7).
8. **The people read.** The employee opens My Payslips (or the email's link); Operations & People press Email
   All Payslips and Download All on the run. A payslip is never visible before step 7.
9. **Paid.** Once the CEO has transferred the money, Operations & People press Mark Paid with the date (and, if
   they wish, the bank's reference). The run is `paid`; Home's Payroll In Progress stops counting it.

**3.2 Lateness reaches a payslip.** A late punch (attendance) → a pending deduction priced from the person's
monthly gross → the person sees it on My Attendance → People may waive it until the run is submitted → Compute
groups the month's pending lateness into one line "Lateness" on the payslip → Submit freezes the items
(`in_run`) → Approve locks the line. Waiving a frozen item means sending the run back first (§6.9).

**3.3 A fine reaches a payslip.** A query is decided and a sanction with a fine is approved (`sanction.issued`,
queries guide §6.6) → the fine is `pending` and a notice tells Operations & People ("Fine Waiting for Payroll")
→ Deductions lists it → **Accept This Month** (one instalment in the open month), **Spread Over Months** (two
to twelve instalments from a month the person picks) or **Waive** with a reason → accepting calls
`sanctions.fines.accept` and writes a deduction with its instalments; waiving calls `sanctions.fines.waive` →
each instalment becomes one payslip line in its month's run → when the last instalment is applied the fine is
settled (`sanctions.fines.settle`). The employee sees each scheduled instalment on My Payslips · Deductions
with its query number.

**3.4 An advance.** The CEO pays a person ahead of pay day (outside this system) → on Deductions, Operations &
People press Record Advance: person, amount, the date it was paid, the months to recover it over and the first
month → instalments are scheduled exactly as for a spread fine → each appears as a payslip line "Salary Advance
Repayment" in its month's run → the person is told when it is recorded, and sees it on My Payslips · Deductions.

**3.5 Switching the advanced option on.** Someone with `payroll.configure` presses Switch On on Configurations,
picks a date (today or later, never earlier) → refused (409 `NO_RATES`) unless at least one statutory rate is in
force on that date, and (409 `NO_CONVENTIONS`) unless the three conventions are set → saved as a new version of the
setting. MyCity enters the rates first, on the same screen, while the option is still off (Statutory Items and PAYE
Bands are always there, §13.1 item 25), and sets the three conventions in the Switch On request itself, when its
accountant has confirmed them; no build step waits for them. Runs for months before the date stay simple and
locked runs never change; a run for a month from the date computes statutory lines, shows Employer Cost and
offers the Statutory Report.

**3.6 A correction after lock.** A locked run is never edited. The error is put right in the next run as an
adjustment ("Correction: October overtime", an earning or a deduction, with its reason). The payslip of the
month it lands in shows it; the original payslip is untouched.

**3.7 My payslip.** The run is approved → `payslip.published` (the bell, and an email unless the person turned
the Payroll category's email off) → My Payslips lists the month with its status → the person opens it (the
designed PDF the document engine produced) → Download PDF, Email a Copy (to their work email) or open
Deductions to see every month that carried one.

**3.8 Where the Home card comes from.** A run that is Draft, Computed, Submitted or Approved is "in progress";
Paid ends it. A run stuck from an older month still counts, so an unpaid October is visible in December.

---

## 4 · Data

### 4.1 Tables at a glance

| Table | Purpose | Block | Written by |
|---|---|---|---|
| `payroll_setting` | The advanced switch and the pay day, effective-dated | `6000` | `payroll` |
| `payroll_run` | One month's run: status, totals, workflow, paid details, snapshot | `6000` | `payroll` |
| `payslip` | One person in one run: totals, working days, bank snapshot, PDF, emailed | `6000` | `payroll`, `payslips` |
| `payslip_line` | The lines of a payslip; `base_amount`, what a statutory line's rate was applied to, joins in `6020` | `6000`, `6020` | `payroll` |
| `payroll_adjustment` | A one-off earning or deduction on a run | `6000` | `payroll` |
| `payroll_deduction` | A fine accepted or an advance recorded, with its months | `6010` | `deductions` |
| `payroll_deduction_instalment` | One month's share of a deduction | `6010` | `deductions`, `payroll` |
| `salary_grade` | A band: minimum and maximum from a date (advanced) | `6020` | `salary_structure` |
| `employee_salary_grade` | Where a person is placed, from a date (advanced) | `6020` | `salary_structure` |
| `employee_pay_component` | A person's pay split into basic, housing, transport and others, from a date (advanced) | `6020` | `salary_structure` |
| `statutory_rate` | A rate, band or relief in force from a date (advanced) | `6020` | `statutory` |

Changes to tables other people own, each reviewed by that table's owner (MIGRATIONS §1.3, README §12):
`attendance_pay_item.payroll_run_id` gains its foreign key (owed since `1435`; `ON DELETE SET NULL`, a nullable link; LA); `leave_type` gains
`unpaid` (M1 leave; AJ); in advanced mode `employee` gains the tax and pension numbers the statutory mask
already names (`tax_id`, `pension_pin`, `pension_administrator`, `nhf_number`; written through the
organisation service; TB). `sanctions.fines` gains `release` (§6.6; GE). Nothing else outside M6 changes.

### 4.2 Columns

Every table has `<table>_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at` and its
own `<table>_set_updated_at` trigger (MIGRATIONS §6). Money is `numeric(18,2)`, a status has a `CHECK` with
exactly the contract's values, every foreign key says `ON DELETE` and has an index. On the wire a column
keeps its name except the salary-derived amounts, which carry the names the salary mask already governs
(§6.13).

**`payroll_setting`** (effective-dated; read with `asOf`, written with `addVersion`,
`src/shared/db/effective-dated.js`)

| Column | Type and rule |
|---|---|
| `scope` | `text NOT NULL DEFAULT 'organisation' CHECK (scope = 'organisation')`, the key `addVersion` needs |
| `advanced_enabled` | `boolean NOT NULL DEFAULT false` |
| `pay_day` | `smallint`, `CHECK (pay_day BETWEEN 1 AND 31)`, null until MyCity sets one; null means the default, 30 (`DEFAULT_PAY_DAY` in `payroll.config.repo.js`) |
| `require_bank_details` | `boolean NOT NULL DEFAULT false`: when true, a person with no bank name or account number is a blocking problem (§6.15), otherwise a warning |
| `paye_basis` | `text CHECK (paye_basis IN ('annualised', 'monthly'))`, null until set: whether PAYE bands are applied to the month's taxable pay annualised and divided by twelve, or to the month's taxable pay against bands entered as monthly amounts (§6.12) |
| `pension_reduces_taxable`, `nhf_reduces_taxable` | `boolean`, null until set: whether employee pension, and NHF, reduce the taxable pay before PAYE |
| `effective_from`, `effective_to` | `date`; no two versions of one scope overlap (an exclusion constraint on `daterange`) |
| `changed_by` | `uuid REFERENCES app_user ON DELETE RESTRICT` |
| `reason` | `text`, optional |

With no row the run is simple, the pay day is the default 30 and bank details are a warning. Nothing is seeded (A26):
the default is a constant in code that JBS Praxis decided on 09/11/2026 (§13.1 item 24), shown on Configurations as
"30 (default)"; the bank rule and the accountant's conventions are MyCity's choices, entered on Configurations (§13.1
item 21).

**`payroll_run`**

| Column | Type and rule |
|---|---|
| `number` | `citext NOT NULL UNIQUE`, from `numbering.allocate(client, "payroll_run", { date: period })`, `PAY-2026-10` |
| `period` | `date NOT NULL UNIQUE`, `CHECK (period = date_trunc('month', period)::date)` |
| `status` | `draft`, `computed`, `submitted`, `approved`, `paid` |
| `advanced` | `boolean NOT NULL DEFAULT false`, the mode this run was computed in (a Draft not yet computed holds the default) |
| `headcount` | `integer NOT NULL DEFAULT 0`, payslips not excluded |
| `earnings_total`, `deductions_total`, `net_total`, `employer_total` | `numeric(18,2) NOT NULL DEFAULT 0` |
| `computed_at`, `submitted_at`, `approved_at` | `timestamptz` |
| `submitted_by`, `approved_by` | `uuid REFERENCES app_user ON DELETE RESTRICT` |
| `paid_on` | `date`; with `payment_reference text` (asked for, never required) and `paid_by uuid` |
| `returned_reason` | `text`, the last Send Back or Reject reason |
| `workflow_instance_id` | `uuid REFERENCES workflow_instance ON DELETE SET NULL` |
| `config_snapshot` | `jsonb NOT NULL DEFAULT '{}'`: genuinely open-ended extras only, the rates in force and the setting used, kept so a locked run can always be explained |

**`payslip`**

| Column | Type and rule |
|---|---|
| `number` | `citext NOT NULL UNIQUE`, `numbering.allocate(client, "payslip", { date: period })`, `PAY-2026-10-0001` |
| `payroll_run_id` | `uuid NOT NULL REFERENCES payroll_run ON DELETE CASCADE` |
| `employee_id` | `uuid NOT NULL REFERENCES employee ON DELETE RESTRICT`; `UNIQUE (payroll_run_id, employee_id)` |
| `status` | `draft`, `excluded`, `published` |
| `excluded_reason` | `text`, set iff `excluded` |
| `gross_monthly` | `numeric(18,2)`, the figure used, snapshot at Compute |
| `working_days`, `working_days_paid` | `smallint`, the person's month and the part of it paid (a joiner or leaver) |
| `earnings_total`, `deductions_total`, `net_pay`, `employer_total` | `numeric(18,2) NOT NULL DEFAULT 0` |
| `bank_name`, `account_last4` | `text`, snapshot at Compute (the full number is never copied) |
| `document_id` | `uuid REFERENCES document ON DELETE SET NULL`, the PDF; set when the run is approved |
| `published_at`, `emailed_at` | `timestamptz` |

**`payslip_line`**

| Column | Type and rule |
|---|---|
| `payslip_id` | `uuid NOT NULL REFERENCES payslip ON DELETE CASCADE` |
| `position` | `smallint NOT NULL`, the order on the slip |
| `kind` | `earning`, `deduction`, `employer` |
| `code` | `monthly_pay`, `overtime`, `lateness`, `early_departure`, `absence`, `unpaid_leave`, `unpaid_suspension`, `fine`, `advance`, `adjustment_earning`, `adjustment_deduction`, `paye`, `pension_employee`, `pension_employer`, `nhf`, `itf`, `nsitf` |
| `label` | `text NOT NULL`, Title Case, what the slip says |
| `detail` | `text`, one short line ("3 late arrivals", "QRY-0019, 1 of 3") |
| `amount` | `numeric(18,2) NOT NULL CHECK (amount >= 0)`; `kind` gives the direction |
| `source_type`, `source_id` | `text`, `uuid`, set for a line with one source (a fine's or an advance's instalment, an adjustment); null for a group (lateness is the month's pending items, found again by run, person and kind) |

**`payroll_adjustment`**: `payroll_run_id` (CASCADE), `employee_id` (RESTRICT), `kind` (`earning`,
`deduction`), `label text NOT NULL` (at most 60 characters), `amount numeric(18,2) NOT NULL CHECK (amount > 0)`,
`reason text NOT NULL`, `created_by`. Only on a Draft or Computed run.

**`payroll_deduction`** (a fine accepted or an advance recorded; a pending fine is not a row, it stays on
`sanction_fine` until accepted)

| Column | Type and rule |
|---|---|
| `employee_id` | `uuid NOT NULL REFERENCES employee ON DELETE RESTRICT` |
| `source` | `sanction_fine`, `salary_advance` |
| `sanction_fine_id` | `uuid REFERENCES sanction_fine ON DELETE RESTRICT`; set iff `source = 'sanction_fine'`. One live deduction a fine: a unique index leaving out the cancelled ones (`payroll_deduction_live_fine_uq`), so a fine released back to pending (§6.6 rule 5) can be accepted again as a new deduction |
| `reason` | `text NOT NULL` (a fine: the sanction's reason; an advance: what it was for) |
| `total_amount` | `numeric(18,2) NOT NULL CHECK (total_amount > 0)` |
| `instalments` | `smallint NOT NULL CHECK (instalments BETWEEN 1 AND 12)` |
| `start_period` | `date NOT NULL`, the first month's first day (a `CHECK` holds it to a month's first day) |
| `granted_on` | `date`, the day an advance was paid; null for a fine |
| `status` | `active`, `settled`, `cancelled` |
| `settled_at`, `cancelled_at`, `cancel_reason` | as named |
| `created_by` | `uuid REFERENCES app_user ON DELETE RESTRICT` |

**`payroll_deduction_instalment`**: `payroll_deduction_id` (CASCADE), `period date` (first of month, held by a `CHECK`),
`amount numeric(18,2) NOT NULL CHECK (amount > 0)`, `status` (`scheduled`, `in_run`, `applied`,
`cancelled`), `payroll_run_id uuid REFERENCES payroll_run ON DELETE SET NULL`; `UNIQUE
(payroll_deduction_id, period)`; indexes on `(period, status)` and `payroll_run_id`.

**Advanced tables (`6020`, built in PR 5 and off by default):**

- `salary_grade`: `code citext`, `name`, `minimum`, `maximum` (`CHECK (maximum >= minimum)`),
  `effective_from`, `effective_to`; versions of one code never overlap.
- `employee_salary_grade`: `employee_id`, `salary_grade_id`, `effective_from`, `effective_to`. A person above
  the maximum or below the minimum is flagged, never blocked. A placement names any version of its grade; the band it
  is read against is the version of that grade's code in force on the day asked, so a band changed from a date
  applies to everyone placed in it.
- `employee_pay_component`: `employee_id`, `code citext` (`basic`, `housing`, `transport` or another, lower case
  held by a `CHECK`), `label`, `amount`, `pensionable boolean`, `effective_from`, `effective_to`. A version is
  every row of the person starting that day.
- `statutory_rate`: `item` (`paye`, `pension_employee`, `pension_employer`, `nhf`, `itf`, `nsitf`, `relief`),
  `kind` (`employee`, `employer`, held to the item by a `CHECK`), `base` (`gross`, `pensionable`, `basic`,
  `taxable`, `annual_payroll`), `rate numeric(9,6) NOT NULL DEFAULT 0` (a percent, 0 to 100), `band_from`,
  `band_to`, `flat_amount` (a relief), `position smallint` (a band's order, set iff the item is PAYE),
  `effective_from`, `effective_to`. A PAYE table is one row per band; a save replaces the whole table from its
  date. Which columns each item uses is §6.12. **Owed (PR 10, migration `6040_statutory_sources.sql`; TB,
  11/11/2026, §13.1 item 31):** every version carries its legal source: `source_title text`, `source_section text`,
  `source_url text`, `source_document_id uuid REFERENCES document ON DELETE SET NULL` (the instrument uploaded to the
  vault), `source_checked_on date`, or `no_legal_source boolean NOT NULL DEFAULT false` with `no_source_reason text`; a
  `CHECK` holds a version to one or the other. Merged migrations are never edited, so this is a new one.
- `payslip_line.base_amount numeric(18,2)`: what a statutory line's rate was applied to (the month's taxable pay
  for PAYE), null on every other line; the statutory report prints it.
- `employee.tax_id`, `pension_pin`, `pension_administrator`, `nhf_number` (`text`), masked as `employee.statutory`
  and written through the organisation service (`PATCH /employees/:id`, `Employee360`).

No two versions of one key overlap, held without a `btree_gist` exclusion (the extension is not provisioned): each
key has one version starting on a given day and at most one open version (two unique indexes a table), and the one
write path, `shared/db/effective-dated` (`addVersion`, and `addVersionSet` for a version of several rows), locks the
key's versions and ends the open one the day before the next starts.

### 4.3 Lists, seeds, numbering and indexes

- **Migrations** (block 6000 to 6999, MIGRATIONS §2): `6000_payroll.sql` (setting, run, payslip, line,
  adjustment); `6010_payroll_deductions.sql` (deduction, instalment, and the foreign key from
  `attendance_pay_item.payroll_run_id`, added in a `DO` block that checks `pg_constraint`, with its index);
  `6020_payroll_advanced.sql` (grades, components, rates, and the employee columns); `6030_leave_unpaid.sql`
  (`leave_type.unpaid`); the reference seed `seeds/reference/6099_seed_payroll.sql`. Gaps are left between
  numbers so a fix can sit beside what it fixes.
- **The seed holds only what the code cannot run without** (A26, MIGRATIONS §9): the `payroll.run` approval
  definition (version 1, one stage, the CEO, 72 hours, context `{ net_total: "money" }`, which makes it a
  definition that carries money, so the engine escalates a timeout to the CEO and never approves it itself; also
  in `DEFAULTS` of `src/shared/workflow/definitions.js`, validated with `validateDefinition()`); the capability
  `payroll.configure` and its default holders (copy `0449`); the `unpaid` flag on the seeded Unpaid leave
  type. No setting row, no rate, no band, no grade, no run: those are MyCity's choices or its data.
- **Numbering** is already seeded (`payroll_run` padding 0, `payslip` padding 4, both monthly with the
  period). A run's number is the period; it is unique because a month has one run. A Draft run discarded is
  deleted, so its number is free again; nothing else frees one.
- **Indexes:** every foreign key; `payroll_run (status)`, `(period DESC)`; `payslip (employee_id, payroll_run_id)`,
  `(payroll_run_id, status)`; `payslip_line (payslip_id, position)`, `(source_type, source_id)`;
  `payroll_deduction (employee_id, status)`; every column a list sorts or filters on.
- **Staging data** (`seeds/staging/`, JavaScript through the services, never on production; Appendix A PR 8).

### 4.4 What payroll reads from, and writes to, other modules

Payroll never writes another module's table. It calls the owner's service function inside its own
transaction, and the owner writes (CLAUDE.md, "one write path").

| Module | Payroll reads | Payroll asks it to write |
|---|---|---|
| `attendance` | The pay items of a person for the run (`pending` deductions, `confirmed` overtime, with `work_date` up to the period's last day and no run) and the person's working days and daily rate for the month | `attendance.pay.takeIntoRun(client, { run_id, items, actor })` (status `in_run`, `payroll_run_id`; prices an item with no amount, "it gains its amount when payroll prices it", attendance guide §11; 409 `RUN_CHANGED` and nothing frozen when an item named is no longer a pending deduction or confirmed overtime with no run) and `releaseFromRun(client, run_id, actor)` (back to `pending` or `confirmed`; safe twice). Both are new, written in PR 2 with LA's review, each emitting one event for the run with a count. `monthRates(db, person, date, shared)` exposes the rate loop `ratesFor` already has (the person's working dates, minutes and daily rate; `monthContext(db, date)` loads the calendar and company hours once for a whole run) and `pricesOf(db, items)` prices items that have none |
| `sanctions` | Pending fines (`sanctions.fines.pending`, 25 a page), a sanction's reason, step and query number, and the sanctions with `financial_effect = 'unpaid_days'` that overlap a month | `sanctions.fines.accept`, `settle`, `waive`, and the new `release` (accepted back to pending, only while no instalment is in a run; GE's review) |
| `leave` | Approved leave of a type flagged `unpaid` that overlaps the month | Nothing |
| `employee` (organisation) | Status, `start_date`, `left_on`, `gross_monthly`, `bank_name`, `account_number`, `work_email`, in advanced mode the pay split and the tax numbers | Nothing |
| `workflow` | The instance and its decision | `openInstance` in the Submit transaction; the engine's own decisions |
| `documents` | The payslip PDF's render status | `documents.generate` for payslips, the batch and the statutory report |
| `notifications` | Nothing | Through `defineNotification` only |

---

## 5 · API

All under `/api/v1`. Staff routes take `requirePermission(key, action)` after `auth`; the contract of each is
in the file named in Appendix C. Every list is paged at 25 (BACKEND_STRUCTURE §16); a list names its filters
and allow-listed sorts (the first sort is the default, a leading `-` reverses). Money is a string with two
places; dates are ISO; the salary-derived amounts carry the masked names of §6.13. Writes go through the
owning module's service, in a transaction, with `emit()`.

**Runs** (`/payroll`, module `payroll`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /payroll/runs` | `PayrollRunListQuery` (`status`, `year`; sort `-period`, `period`, `status`) → `PayrollRunPage` | `payroll` view · all | yes, 25 | Totals are null for a reader without the salary grant. A row is a `PayrollRun` with an empty `chain`: the approval's route is read for the run a person opens |
| `GET /payroll/runs/summary` | → `PayrollRunSummary` | `payroll` view · all | no | The current run (the open one, else the latest), counts by status, the last 12 months' net for the Net Payroll by Month chart |
| `POST /payroll/runs` | `PayrollRunCreate` (`period`) → `PayrollRun` | `payroll` create · all | no | 409 `RUN_EXISTS` if the month has a run; 422 `PERIOD_NOT_ALLOWED` for a month after the current Lagos month or before anyone started |
| `GET /payroll/runs/:id` | → `PayrollRun` | `payroll` view · all | no | Totals, status, the approval's route (`chain`), problem counts, and `can_compute`, `can_submit`, `can_decide`, `can_pay`, `can_discard` for this reader |
| `POST /payroll/runs/:id/compute` | `EmptyBody` → `PayrollRun` | `payroll` edit · all | no | Draft or Computed only (409 `RUN_NOT_EDITABLE`). Idempotent; inline in the request: 308 people took 550 ms (§7 on the job) |
| `GET /payroll/runs/:id/problems` | `PageQuery` → `PayrollProblemPage` | `payroll` view · all | yes, 25 | Blocking first, then warnings, each naming the person and what to do |
| `POST /payroll/runs/:id/submit` | `PayrollRunSubmit` (`expected_net_total`, optional) → `PayrollRun` | `payroll` edit · all | no | A Computed run only (409 `RUN_NOT_COMPUTED` for a Draft); computes again; 422 `NO_ONE_TO_PAY` with nobody paid; 422 `RUN_HAS_PROBLEMS` while a blocking problem stands; 409 `RUN_CHANGED` when `expected_net_total` differs from the recomputed one, its `fields` carrying the totals that now stand (`gross_pay`, `total_deductions`, `net_pay`) for a reader who may see pay. A refusal is answered after the recompute commits, so the screen reads what now stands; nothing is frozen |
| `POST /payroll/runs/:id/mark-paid` | `PayrollRunPaid` (`paid_on`, `payment_reference` optional) → `PayrollRun` | `payroll` edit · all | no | Approved runs only (409 `NOT_APPROVED`, a repeat too); `paid_on` not in the future (422 `PAID_IN_THE_FUTURE`, Lagos) |
| `POST /payroll/runs/:id/exclude` | `PayrollRunExclude` (`employee_id`, `reason`, 10 to 500) → `PayrollRun` | `payroll` edit · all | no | Draft or Computed; the person must be paid in the month (422 `NOT_IN_RUN`); the run goes back to Draft |
| `POST /payroll/runs/:id/include` | `PayrollRunInclude` (`employee_id`) → `PayrollRun` | `payroll` edit · all | no | Undoes an exclusion (404 `NOT_EXCLUDED` for a person who is not left out); the run goes back to Draft |
| `GET /payroll/runs/:id/adjustments` | `PageQuery` → `PayrollAdjustmentPage` | `payroll` view · all | yes, 25 | |
| `POST /payroll/runs/:id/adjustments` | `PayrollAdjustmentAdd` → `PayrollAdjustment` | `payroll` edit · all | no | Draft or Computed; the run goes back to Draft (it must be computed again) |
| `DELETE /payroll/runs/:id/adjustments/:adjustment_id` | → 204 | `payroll` edit · all | no | Same rule |
| `DELETE /payroll/runs/:id` | → 204 | `payroll` delete · all | no | Discard: a run never submitted; releases nothing because nothing was frozen |
| `POST /payroll/runs/:id/email-payslips` | `PayslipEmailAll` (`resend`, default false) → 202 `PayslipEmailQueued` (`{ queued }`: how many mails the press will send) | `payroll` edit · all | no | Approved or Paid only (409 `NOT_APPROVED`); sends to those not yet emailed unless `resend`; the worker marks and mails each payslip whose PDF is done and tries again for the rest (§7) |
| `POST /payroll/runs/:id/payslips-export` | `EmptyBody` → 202 `ExportFile` | `payroll` export · all | no | One PDF of every published payslip, a page each (§6.10); downloaded where it was asked for (foundation §6.12). Approved or Paid only (409 `NOT_APPROVED`); 403 `FIELD_RESTRICTED` for a reader whose role hides pay or bank details, since the document carries both |
| `POST /payroll/runs/:id/statutory-report` | `EmptyBody` → 202 `ExportFile` | `payroll` export · all | no | Advanced runs only (409 `ADVANCED_OFF`), approved or paid (409 `NOT_APPROVED`: the figures are locked first); 403 `FIELD_RESTRICTED` for a reader whose role hides pay or tax numbers, since the document carries both |

The approval's own decisions are the workflow routes already built (`POST /workflow/instances/:id/approve`,
`/reject`, `/request-changes`; the approver's `payroll` approve grant and the stage's approvers are both
checked). The run's screen offers them as buttons, as Expenses does.

**Payslips** (`/payslips`, module `payroll`; and `/ess/payslips` for the person's own)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /payslips` | `PayslipListQuery` (`run_id`, `period`, `employee_id`, `status`, `q`; sort `employee`, `-net_pay`, `number`) → `PayslipPage` | `payroll` view · all | yes, 25 | Draft and published alike for a Payroll reader; amounts masked as the salary is |
| `GET /payslips/:id` | → `PayslipDetail` (its earning and deduction lines; employer charges are never on the slip) | `payroll` view · all | no | 404 outside the run's scope; a reader's own payslip is never masked from them |
| `GET /payslips/:id/lines/:line_id/items` | `PayslipLineParams`, `PageQuery` → `PayslipLineItemPage` | `payroll` view · all | yes, 25 | The pay items behind a grouped line (Lateness, Early Departure, Absence, Overtime): the run's own once Submit froze them, before that the pending ones the next Compute takes. An adjustment's line shows its reason, a fine's or an advance's its month and state, an unpaid leave's or suspension's the line as made; Monthly Pay and a statutory line stand on nothing and answer an empty page |
| `GET /payslips/:id/pdf` | → the PDF, streamed from the vault | `payroll` edit · all | no | A restricted file (HANDOFF §5 item 7: the module's `edit` grant, not only `view`); 409 `NOT_APPROVED` for a draft, 409 `NOT_READY` while it renders; 403 `FIELD_RESTRICTED` for a reader whose role hides pay or bank details, unless it is their own |
| `GET /ess/payslips` | `EssPayslipQuery` (`year`, this Lagos year when absent) → `PayslipPage` | `ess` · own | yes, 25 | Published payslips only, newest month first; each carries its run's status (`run_status`: `approved`, or `paid`) and `has_deduction`, which are what the month's status (Paid, Paid with a deduction, In the run) is read from (§13.1 item 28) |
| `GET /ess/payslips/summary` | `EssPayslipQuery` → `EssPayslipSummary` | `ess` · own | no | Over the year's published payslips: Gross, Net Received, Payslips, Deductions; Next Payday is the first pay date on or after today whose month's run is not paid (§6.11 rule 1) |
| `GET /ess/payslips/:id` | → `PayslipDetail` | `ess` · own | no | |
| `GET /ess/payslips/:id/pdf` | → the PDF | `ess` · own | no | 409 `NOT_READY` while the PDF is still rendering |
| `POST /ess/payslips/:id/email` | `EmptyBody` → `PayslipCopySent` (`{ sent }`) | `ess` · own | no | To the person's work email, the PDF attached; 409 `NOT_READY` while it renders, 429 `EMAIL_TOO_SOON` within a minute of the last mail of that payslip (Email All counts) |
| `POST /ess/payslips/export` | `EssPayslipQuery` (`year`) → 202 `ExportFile` | `ess` · own | no | Download All on My Payslips: one PDF of the person's published payslips of the year, oldest month first, a page each, kept 24 hours (§6.10 rule 6); 409 `NO_PAYSLIPS` for a year with none |
| `GET /ess/deductions` | `PageQuery` → `EssDeductionPage` | `ess` · own | yes, 25 | Each month that carried one, and each scheduled instalment, with amount, reason and query number |

The ESS routes live in `src/modules/ess/` and call `payslips.service` with the caller's own `employee_id`; the
`ess` module never reads payroll's tables.

**Deductions** (`/deductions`, module `payroll`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /deductions` | `DeductionListQuery` (`status`: `pending`, `active`, `settled`, `waived`; `source`: `attendance`, `fine`, `advance`; `employee_id`, `month` (`YYYY-MM`, the row's month), `q` (the person, the reason, the query number); sort `created`, `employee`, `amount`, either way) → `DeductionPage` | `payroll` view · all | yes, 25 | One page of the union of pending pay items, fines and deductions (§6.6); a row names its source, status and what can be done to it (`can_accept`, `can_waive`, `can_release`, `can_cancel`). With no sort the list opens on what is waiting, pending first and then the newest; `salary_set` is false for an attendance item priced for a person with no gross, so a null amount reads No Salary Set and never Restricted |
| `GET /deductions/summary` | → `DeductionSummary` | `payroll` view · all | no | Pending Fines, Pending Attendance, Active (what is left to recover), Recovered This Year (the instalments applied in the Lagos calendar year, by their month), and `open_period`, the month a fine goes into unless a later one is picked (§6.6 rule 2), so the screen works out no month itself |
| `POST /deductions/fines/:sanction_fine_id/accept` | `FineParams`, `DeductionAccept` (`months` 1 to 12, `start_period`) → `DeductionRow` | `payroll` edit · all | no | `months` 1 is Accept This Month; 409 `FINE_NOT_MOVABLE` from `sanctions.fines` for a fine no longer pending; 422 `START_NOT_ALLOWED` for a start before the open month or in a month whose run is already Submitted, Approved or Paid (on `start_period`); 422 `TOO_MANY_MONTHS` when the fine is too small to give every month a kobo (on `months`); never your own (403 `OWN_RECORD`) |
| `POST /deductions/fines/:sanction_fine_id/waive` | `FineParams`, `DeductionWaive` (`reason`, 10 to 500) → `DeductionRow` | `payroll` edit · all | no | 409 `FINE_NOT_MOVABLE` for a fine no longer pending; never your own |
| `POST /deductions/:id/release` | `DeductionWaive` → `DeductionRow` | `payroll` edit · all | no | `:id` is the `payroll_deduction_id`. An accepted fine whose instalments are all still scheduled goes back to pending (`sanctions.fines.release`); 409 `INSTALMENTS_STARTED` once one is in a run or applied; 409 `FINE_NOT_MOVABLE` for one no longer accepted; 422 `NOT_A_FINE` for an advance; never your own |
| `POST /deductions/advances` | `AdvanceRecord` (`employee_id`, `amount`, `granted_on`, `months` 1 to 12, `start_period`, `reason`) → `DeductionRow` (201) | `payroll` create · all | no | The start month is held to the same rule as an accepted fine (`START_NOT_ALLOWED`, `TOO_MANY_MONTHS`); 422 `GRANTED_IN_THE_FUTURE` for a day still to come (on `granted_on`); 404 for a person who does not exist; never your own |
| `POST /deductions/:id/cancel` | `AdvanceCancel` (`reason`) → `DeductionRow` | `payroll` edit · all | no | An advance recorded in error, while none of its instalments is in a run or applied (409 `INSTALMENTS_STARTED`); `:id` is the `payroll_deduction_id`; 422 `NOT_AN_ADVANCE` for a fine, 409 `NOT_ACTIVE` for one already cancelled or settled; the answer is the advance as it stood, no longer listed |

**Configurations** (`/payroll/settings`, `/salary-structure`, `/statutory`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /payroll/settings` | → `PayrollSettings` (`advanced_enabled`, `advanced_has_been_on`, `pay_day` (30 when none is set), `pay_day_is_default`, `require_bank_details`, the three conventions, and `current` and `next`, the version in force and the one that starts later) | `payroll` view · all | no | |
| `PATCH /payroll/settings` | `PayrollSettingsChange` (`advanced_enabled`, `effective_from`, `pay_day`, `require_bank_details`, `paye_basis`, `pension_reduces_taxable`, `nhf_reduces_taxable`, `reason`) → `PayrollSettings` | `payroll` edit · all, capability `payroll.configure` | no | `effective_from` today or later (422 `EFFECTIVE_IN_THE_PAST`); what is not sent carries over from the latest version, and a change for the day a version already starts joins it; a version starting later is refused (409 `VERSION_EXISTS`); the convention fields are accepted only once the option has been on or is being switched on (409 `ADVANCED_OFF` otherwise); 409 `NO_RATES` to switch on with no rate in force on that date; 409 `NO_CONVENTIONS` with any convention unset, on each unset field |
| `GET /statutory/items` | → `StatutoryItems` | `payroll` view · all | no | The seven items, always all seven, each with the version in force today and the next (`current`, `next`, null when none): a fixed set the code knows, not a list of records, so Configurations shows Not Set for an item with no rate |
| `GET /statutory/rates` | `StatutoryRateListQuery` (`item`, `as_of`) → `StatutoryRatePage` | `payroll` view · all | yes, 25 | Readable whatever the option's state: the rates are entered before the first switch-on (§13.1 item 25). With `as_of`, the rows in force that day; without, those in force today and those that start later |
| `POST /statutory/rates` | `StatutoryRatesSave` (`item`, `effective_from`, its `rate`, `flat_amount`, `bands`, and `base` among the item's own; **owed in PR 10:** its `source` (title, section, link or document, checked on) or `no_legal_source` with a reason, 422 `SOURCE_REQUIRED` without either) → `StatutoryRatePage` (201) | `payroll` edit · all, `payroll.configure` | no | A new version from a date; never backdated (422 `EFFECTIVE_IN_THE_PAST`); the previous version ends the day before and one already starting that day is replaced; accepted while the option is off, so a rate can be in force when it is first switched on. PAYE bands start at nothing, each where the last ends, only the last open |
| `DELETE /statutory/rates/:item/versions/:effective_from`, `DELETE /payroll/settings/versions/:effective_from` | → 204 | `payroll` edit · all, `payroll.configure` | no | **Owed (PR 10; §13.1 item 33).** Remove Change: removes a version that has not started yet (a saved band table, a rate or a pay day waiting for its day), and the version before it runs on again; 409 `VERSION_IN_FORCE` for one already in force (a new version from a date replaces it instead), so a run already paid at a figure never loses it |
| `GET /salary-structure/grades`, `POST /salary-structure/grades` | `SalaryGradeListQuery`, `SalaryGradeSave` → `SalaryGradePage`, `SalaryGrade` | view; edit with `payroll.configure` | yes, 25 | Advanced only (409 `ADVANCED_OFF` until the option is on or has been). A grade's band from a day; its counts of who is placed, below and above |
| `GET /salary-structure/placements`, `PUT /salary-structure/placements/:employee_id` | `GradePlacementListQuery` (`salary_grade_id`, `band_position`: `below`, `within`, `above`, `unplaced`; sort `employee`, `grade`), `GradePlacementSave` → `GradePlacementPage`, `GradePlacement` | view; edit with `payroll.configure` | yes, 25 | Everyone paid now against their band: Below Minimum, Within, Above Maximum. 422 `GRADE_NOT_IN_FORCE` for a grade with no band on the day |
| `GET /salary-structure/employees/:employee_id/components`, `PUT …` | `SalaryStructureParams`, `PayComponentsSave` → `PayComponentSet` | view; edit with `payroll.configure` | no | The split today and the next one. A save is a new version from a date: one `basic`, every code once, at most ten, adding up to the person's monthly gross (422 `SPLIT_NOT_GROSS`; 422 `NO_SALARY` with no gross) |

**Errors** (`shared/errors.js`, every one a code the screen can name): `RUN_EXISTS`, `PERIOD_NOT_ALLOWED`,
`RUN_NOT_EDITABLE`, `RUN_NOT_COMPUTED`, `RUN_NOT_SUBMITTED` (the approval's two ends, which the handlers answer with a quiet no-op),
`NO_ONE_TO_PAY`, `RUN_HAS_PROBLEMS`, `RUN_CHANGED`, `NOT_IN_RUN`, `NOT_EXCLUDED`, `PAID_IN_THE_FUTURE`, `NOT_APPROVED`, `NOT_READY`, `NO_RATES`,
`NO_CONVENTIONS`, `ADVANCED_OFF`, `FINE_NOT_MOVABLE`, `OWN_RECORD`, `INSTALMENTS_STARTED` (cancel or release after one is in a run),
`START_NOT_ALLOWED`, `TOO_MANY_MONTHS`, `GRANTED_IN_THE_FUTURE`, `NOT_A_FINE`, `NOT_AN_ADVANCE`, `NOT_ACTIVE` (Deductions, PR 3),
`EMAIL_TOO_SOON` (429, a copy within a minute of the last mail of a payslip), `NO_PAYSLIPS` (409, a download with nothing to put in it),
`EFFECTIVE_IN_THE_PAST` (422, a configuration change starting before today), `VERSION_EXISTS` (409, a version already starts later),
`SPLIT_NOT_GROSS` (422, a pay split that is not the monthly gross), `NO_SALARY` (422, a split for a person with no gross),
`GRADE_NOT_IN_FORCE` (422, a placement in a grade with no band that day) (Configurations, PR 5);
owed in PR 10: `SOURCE_REQUIRED` (422, a statutory version with no source and not marked No Legal Source) and
`VERSION_IN_FORCE` (409, Remove Change on a version that has started).
Messages are four words or fewer on a field, one short sentence elsewhere.

---

## 6 · Rules and calculations

Each rule is a sentence a test can check. **Money is `shared/money` throughout** (Decimal, kobo, half up,
rounded once where §6.8 says); never `Number()`, `parseFloat` or `+` on an amount (gate 20). Days are Lagos
business dates (`shared/time/lagos`).

### 6.1 Who is in a run

1. A person is paid in a month if they started on or before its last day and had not left before its first
   (`employee.start_date`, `left_on`), whatever their `employment_type` (contractors and consultants are the
   people being paid) and whether their `status` is `active` or `suspended`.
2. A person in that group gets a payslip when Compute runs. A person with no `gross_monthly` gets a payslip
   with the blocking problem No Salary Set and no lines; Operations & People set the pay on People ·
   Employees and press Compute again, or exclude the person with a reason.
3. An excluded person has a payslip with status `excluded` and its reason, no lines and no number counted in
   the headcount; including them again and computing builds their lines.
4. A person with no `bank_name` or `account_number` gets the warning No Bank Details (not blocking: they may
   be paid another way) unless Bank Details Required is on, when it blocks Submit (§6.15). A person whose `contract_ends_on` is before the period's last day while still active
   gets the warning Contract Ended.
5. Compute never adds or removes a person from the group by itself once the run is Submitted; a joiner after
   Submit is paid in the next run (§11).

### 6.2 The month and the daily rate

1. A period is a month's first day; its bounds come from `lagos.monthBounds`. A run's `period` is never in the
   future relative to the current Lagos month and never before the earliest `start_date` of anyone.
2. A person's **working days** in the month are counted from their own work schedule and the working week,
   less public holidays, exactly as attendance counts them (`attendance.pay.ratesFor`, which loads
   `workingWeek.loadCalendar`, the person's schedules and the company hours). Payroll calls the one function
   (`attendance.pay.monthRates`, §4.4) and keeps no copy of the loop. A month with Saturday working has about
   26 working days, not 22 (A22); this is the quietest way to get payroll wrong.
3. The **daily rate** is the monthly gross over the working days, at full precision; it is rounded only when an
   amount made from it is written (§6.8). A person with no working days in the month (a full month of Off days)
   has no daily rate and no deduction made from one.

### 6.3 Earnings

1. **Monthly Pay** (`monthly_pay`): the person's `gross_monthly` as it stands when Compute runs, times the part
   of the month they are paid. The part is `working_days_paid / working_days`, where the days paid are the
   person's working days from the later of the first of the month and `start_date` to the earlier of the last
   of the month and `left_on`. A person paid the whole month is paid the whole gross, never a daily rate times
   days. Changing someone's gross after Compute changes nothing until Compute (or Submit) runs again.
2. **Overtime** (`overtime`): the sum of the amounts of the person's overtime pay items with status `confirmed`,
   `work_date` up to the period's last day and no run. A `pending` overtime item is not paid; the run shows
   the warning Overtime Waiting (how many, whose) so Operations & People can chase the line manager. A `cut`
   item is never paid. Overtime was priced and capped by attendance (§6.17 there); payroll adds, never prices.
3. **Adjustments** that are earnings (`adjustment_earning`), one line each, label as typed.
4. In advanced mode, lines are produced from the pay components (§6.12); in simple mode there is one
   Monthly Pay line.

### 6.4 Deductions from attendance

1. The person's pay items of kind `late`, `early_departure` or `absence` with status `pending`, `work_date` up to
   the period's last day and no run are deductions. An item for an earlier month that was still pending when
   that month's run locked is taken by the next run, with its day in the breakdown.
2. They are grouped into one line per kind: Lateness, Early Departure, Absence, each the sum of its items'
   amounts (already whole kobo), with the count in `detail` ("3 late arrivals"). An item with no amount
   (No Salary Set when its day closed) is priced when payroll takes it (§4.4); if the person still has no
   gross, the blocking problem of §6.1 stands.
3. A `waived`, `cut` or `confirmed`-deduction item (confirmed is for overtime) is never a deduction.
4. Compute only reads the items; **Submit** is the moment they are frozen (§6.9).

### 6.5 Unpaid leave and unpaid suspension

Nothing in attendance deducts for these (attendance raises no deduction for leave, and no code turns an unpaid
suspension into absent days), so payroll does, from the owners' records:

1. **Unpaid leave** (`unpaid_leave`): for each approved leave request of a type flagged `unpaid`
   (`leave_type.unpaid`) overlapping the month, the person's working days inside the overlap, times the daily
   rate, rounded once per request. A request lying wholly in one month with a part-day amount uses that
   amount in days; a request spanning months is split by working days.
2. **Unpaid suspension** (`unpaid_suspension`): for each issued sanction whose step has `financial_effect =
   'unpaid_days'` overlapping the month (`sanction.effective_on` to `ends_on`), the working days inside the
   overlap, times the daily rate, rounded once per sanction. A day on which the person already has an
   `absence` pay item that payroll counts (pending or in the run) is not counted again.
3. A person on unpaid leave or unpaid suspension for the whole month gets Monthly Pay and a deduction that
   cancels it; Operations & People may exclude them instead.
4. Both lines say what they are in `detail` ("2 days, 12 to 13 October").

### 6.6 Fines, advances and instalments

1. **The Deductions list** is one page of a union read by `deductions.repo`: pending attendance deductions
   (`attendance_pay_item`, the three deduction kinds, `pending`), fines (`sanction_fine` `pending`, `waived`
   and, through their deduction, `accepted`, `settled`) and `payroll_deduction` rows. A row's `status` for the
   screen: **Pending** (a pending item or fine), **Active** (a deduction with instalments left), **Settled**,
   **Waived**. An attendance item is shown but is never accepted on this screen: it flows into the run by §6.4
   unless People waive it on People · Attendance.
2. **Accept This Month** on a fine calls `sanctions.fines.accept` and writes a `payroll_deduction`
   (`source = sanction_fine`, `instalments = 1`, `start_period` the open month) with one instalment of the
   fine's whole `amount_ngn`. The **open month** is the period of the newest run in Draft or Computed; with no
   such run, the current Lagos month if it has no run, else the next month. The person may pick a later month,
   never an earlier one and never a month that already has a Submitted, Approved or Paid run (422 `START_NOT_ALLOWED`); a
   spread is held to the same rule for every month it falls in, and the runs of those months are locked as it is checked, so
   a Compute or a Submit of such a month queues behind it and reads its instalments after it, never between a read and a freeze.
3. **Spread Over Months** takes 2 to 12 instalments from the month picked. The amounts are
   `shared/money.allocate(total, equal weights)`: kobo that do not divide go to the first instalments (₦10,000.00
   over 3 is 3,333.34, 3,333.33, 3,333.33). The instalments sum exactly to the total. A fine too small to give every month a kobo is refused on the months field
   (422 `TOO_MANY_MONTHS`): an instalment of nothing would never be deducted.
4. **Waive** (a pending fine) needs a reason of 10 to 500 characters and calls `sanctions.fines.waive`. Nothing
   is deducted. The employee is told.
5. **Release** returns an accepted fine to pending (`sanctions.fines.release`, new) only while every instalment
   is `scheduled`; the instalments become `cancelled` and the deduction `cancelled`. Once one is in a run (or
   applied) it cannot be released (`INSTALMENTS_STARTED`).
6. **Record Advance** writes a `payroll_deduction` (`source = salary_advance`, `granted_on`, the months, the
   first month) with instalments by rule 3 and tells the employee; the day it was paid is not a day still to come. The advance itself is paid outside the system;
   payroll never adds it to a payslip. Cancel Advance (a reason; never once an instalment is in a run or applied)
   marks it `cancelled` and its instalments `cancelled`.
7. **Each instalment** whose `period` is the run's month and whose status is `scheduled` becomes one payslip line:
   Fine (`fine`, `detail` "QRY-0019, 1 of 3") or Salary Advance Repayment (`advance`). At Submit it is `in_run`
   with the run; at approval `applied`. When the last instalment of a deduction is `applied`, the deduction is
   `settled` and a fine is settled through `sanctions.fines.settle`, in the same transaction as the lock.
8. **Never their own.** A person cannot accept, waive, release or record a deduction or advance for themselves
   (403 `OWN_RECORD`); someone else with `payroll` edit does it.
9. **A person who leaves.** The run for their last month takes every outstanding instalment of theirs
   (`left_on` in or before that month's last day, whatever month each instalment was for), so what is owed is recovered
   from final pay; a person whose `left_on` is in a later month keeps their schedule. Fines come before advances on the
   slip, then by month; if that would make the net
   negative, §6.7 rule 3 stands and Operations & People decide (settled 08/11/2026, §13.1 item 16).

### 6.7 Adjustments and the net

1. An **adjustment** is a one-off earning or deduction on one person's payslip in one run, with a label (at most
   60 characters), an amount above zero and a reason of 10 to 500 characters. It exists only on a Draft or
   Computed run; adding or removing one returns a Computed run to Draft.
2. `net_pay = earnings_total - deductions_total` for the payslip, from the stored lines. Employer lines are never
   in it.
3. A payslip whose net would be below zero has the blocking problem Negative Net. Nothing caps a deduction by
   itself; Operations & People spread a fine, record an adjustment or exclude the person.

### 6.8 Rounding, totals and the snapshot

1. Each line's amount is rounded half up to the kobo **once**, where it is written: a prorated Monthly Pay, a
   daily-rate times days amount, an allocated instalment. An amount that attendance already priced is taken as
   it is.
2. `earnings_total`, `deductions_total` and `employer_total` of a payslip are the sums of its stored lines;
   `net_pay` follows from them; the run's totals are the sums of its payslips' (excluded ones count for
   nothing). A total is never computed a second way, so a payslip can never disagree with its own lines.
3. A line's `amount` is never negative; its `kind` gives the direction.
4. Compute is **idempotent**: pressed twice with nothing changed it produces the same lines and totals to the
   kobo, and it never changes adjustments, exclusions or what the run's earlier status holds.
5. Compute writes the person's `gross_monthly`, working days and bank snapshot onto the payslip and the setting
   and rates it used into `payroll_run.config_snapshot`, so an approved run can be explained after anything
   changes.

### 6.9 The run's life

| From | To | Who and how | What happens |
|---|---|---|---|
| (none) | `draft` | `payroll` create: New Run | Number allocated in the transaction; one run per month |
| `draft` | `computed` | `payroll` edit: Compute Run | Payslips and lines written; problems listed |
| `computed` | `draft` | An adjustment added or removed; an exclusion changed | Must be computed again |
| `computed` | `submitted` | `payroll` edit: Submit for Approval | Computes again; refuses on a blocking problem or a changed total; freezes (below); opens `payroll.run` for the CEO |
| `submitted` | `draft` | The approver's Send Back or Reject, or the opener's withdrawal | Everything frozen is released; `returned_reason` kept; the submitter is told by the engine |
| `submitted` | `approved` | The approver's Approve | The lock below |
| `approved` | `paid` | `payroll` edit: Mark Paid | `paid_on`, optional reference |
| `draft`, `computed` | (deleted) | `payroll` delete: Discard | Nothing was frozen; the number is free again |

1. **Submit freezes.** In the Submit transaction every pay item taken by §6.3 to §6.5 becomes `in_run` with the
   run (`attendance.pay.takeIntoRun`) and every instalment of the month `in_run`; from then on People cannot
   waive such an item and no one can release or cancel such an instalment. This is a deliberate narrowing of the
   attendance decision T4 ("until the run is locked"): the approver must see what they approve. A person who
   must waive a frozen item asks the approver to Send Back.
2. **Send Back and Reject release.** `attendance.pay.releaseFromRun` puts items back to `pending` (or
   `confirmed`), instalments to `scheduled`; the run is a Draft again with the reason; one run still exists for
   the month.
3. **Approval locks.** The engine's completion handler (`payroll.apply_decision`, after commit, idempotent: it
   acts only on a `submitted` run) sets `approved`, `approved_at` and `approved_by` (the run is locked by its
   status, §6.9 rule 4); marks the instalments `applied`; settles each fine whose last instalment applied; sets
   every non-excluded payslip `published` and calls `documents.generate` for it (the payslips already carry their
   numbers); emits `payroll_run.approved` and one `payslip.published` per person.
4. **Locked means locked.** Every payroll write calls one guard (`assertEditable(run)` in `payroll.lock.js`),
   which refuses (409 `RUN_NOT_EDITABLE`) anything on an `approved` or `paid` run except Mark Paid, Email All
   and the exports. The writes that belong on a run that is out (Email All, a payslip's mail and its copy, Download All)
   are made with the `published` guard, which lets an approved or paid run through and refuses the rest with 409
   `NOT_APPROVED`. A test enumerates every write function of the five modules and asserts it hits the guard.
5. **The approval keeps its flow.** A run keeps the `payroll.run` version it opened with (the engine records
   it); changing the flow on Settings · Approvals affects the next Submit only.
6. **Concurrency.** Every transition `SELECT ... FOR UPDATE`s the run row; two people computing at once queue,
   and the second sees the first's lines. Pressing a button twice is one request (F26) and a repeat of the same
   transition is a no-op or a 409, never a second effect.
7. **Submit's recompute and `RUN_CHANGED`.** The screen sends the `net_total` it showed as `expected_net_total`;
   when the recomputed total differs the answer is 409 with the new totals, nothing is frozen, and the person
   presses again knowing.

### 6.10 Payslips

1. **A payslip shows** its number, month, the person (name, staff number, job title, department), the bank's
   name and last four digits, **earnings** lines, **deductions** lines, **net pay**, and the pay day or the date
   paid when known. In advanced mode it also shows the statutory lines and, on its second block, nothing the
   person did not pay (employer charges are on the report, not the slip).
2. **No statutory word in simple mode.** In simple mode no screen, payslip, email or letter says PAYE, pension,
   tax, NHF, ITF or NSITF (12 October). The words appear only in advanced mode and on Configurations.
3. **Visible only once published.** A payslip is `draft` until its run is approved; a Payroll reader sees a
   Preview of it on screen (a `Paper` with a Preview pill, never a PDF), the employee sees nothing.
4. **The PDF** is made by `documents.generate` at approval: doc type `payslip` (module `payroll`, sensitivity
   `restricted`, numbering none, not signable), template `templates/documents/payslip.html` on the letterhead, its
   variables the contract's `PayslipVars` (`defineVariables("document", "payslip", c.payslips.PayslipVars)`). The
   employee reads their own; anyone else needs `payroll` edit (HANDOFF §5 item 7). Until it has rendered,
   `GET …/pdf` is 409 `NOT_READY` and the screen says Preparing. The request is made in the lock's transaction with no
   actor, so the approver is not the uploader of a person's payslip and the vault's rule (the person, or `payroll` edit)
   is the only way in. A reader whose role hides pay or bank details (`employee.salary`, `employee.bank`) is not handed a
   document that carries them, unless it is their own (§6.13 rule 3).
5. **Email a Copy** (ESS) and **Email All Payslips** send a mail from `templates/email/payslip-ready.html` to the
   person's `work_email` with the PDF attached, through the outbox and `system-mail.service`. The body states the
   month and where to read it, never an amount. Each send sets `payslip.emailed_at`; Email All sends only to those
   not yet emailed unless `resend` is true (the screen asks Email Again?), so a repeat press never doubles a mail. A
   payslip is marked emailed in its own transaction and the mail is queued from the `payslip.emailed` it records (§7),
   so a retry skips what was marked; a mail that cannot be made (no work address, the PDF never rendered) puts the
   payslip back to not emailed.
6. **Download All** is one PDF of every published payslip of the run, one A4 page each, in staff-number order:
   `documents.generate` with doc type `payroll_payslips_export` (`export: true`, kept 24 hours, template
   `payslip-batch`), reserved in the request, finished by the worker, downloaded on the device that pressed it
   (foundation §6.12). No zip: the repository has none and one is not worth adding for 25 files. ESS · My
   Payslips' Download All is the same document for one person's year (`POST /ess/payslips/export`).
7. **The breakdown.** Opening a grouped line lists the pay items behind it (25 a page), each with its day,
   minutes and status; a fine's or an advance's line names its query or its advance; an adjustment's line
   shows its reason to Payroll readers only.

### 6.11 Configurations and the advanced option

1. **Pay Day** is a day of the month, 1 to 31, **30 by default** (§13.1 item 24), changed by someone with
   `payroll.configure` (Operations & People by default) as a new version of the setting from a date. It is **one exact
   day for every month** (TB, 11/11/2026, §13.1 item 29): never set for one month, never a different day in February.
   The Set Pay Day select lists 1 to 30 and **Last Day of Month** (stored as 31), so a person who wants the month's end
   never works out 28, 29, 30 or 31 (PR 10). A pay day past a month's last day falls on that
   last day (30 pays on 28 or 29 February, 31 on 30 April), so a month's **pay date** is
   `min(pay_day, last day of the month)` in Lagos. It drives Next Payday on My Payslips (the next pay date on or after
   today in Lagos, replaced by the month's run's `paid_on` once the run is paid) and the Pay Date on a payslip.
2. **The advanced option** is a versioned setting (`payroll_setting`). It decides a run's mode by the run's
   **period**: a run is advanced when the setting in force on its first day has `advanced_enabled`. Switching on
   from 1 December makes the December run advanced; November, computed in December, stays simple. A locked run
   never changes (it carries `advanced` and its snapshot).
3. **Switching on** needs `payroll.configure`, a date that is today or later (Lagos, never earlier), at least
   one statutory rate in force on that date (409 `NO_RATES`) and the three conventions of §6.12 set
   (409 `NO_CONVENTIONS`). **Switching off** needs the same date rule and changes later runs only.
3a. **The options MyCity configures** (§13.1 item 21), each saved as a new version of the setting from a date,
   needing `payroll.configure`: **Pay Day**; **Bank Details Required** (a person with no bank details blocks Submit);
   and, in advanced mode, the statutory rates and bands, the three conventions (PAYE basis, whether pension reduces
   taxable pay, whether NHF does) and the pay components. Every figure and every convention is entered in the app
   by MyCity when its accountant confirms it; no build step waits for one. Every person's salary and bank details
   are entered on People · Employees or through the staff import (nothing in payroll creates them), and the run
   reports each one missing (§6.15).
4. **Gated pieces.** Statutory Items and PAYE Bands are on Configurations whatever the option's state, so the
   rates can be entered before the first switch-on (§13.1 item 25, decided 09/11/2026). The conventions, Salary
   Structure and Pay Components are visible only when the option is on or has been (`advanced_has_been_on`); their
   routes answer 409 `ADVANCED_OFF` otherwise, except that the conventions are accepted in the request that
   switches the option on. In simple mode Configurations holds Pay Day, Bank Details Required, the switch, Statutory
   Items and PAYE Bands.
5. **Salary structure.** Grades are bands (minimum, maximum) from a date; people are placed in a grade from a
   date; a person above the maximum or below the minimum is flagged (Above Maximum, Below Minimum), never blocked,
   and an offer outside its band is not a payroll matter. Salaries stay negotiated: a grade sets no one's pay.
6. **Pay components** (advanced only): a person's gross split into `basic`, `housing`, `transport` and others,
   each marked pensionable or not, from a date. A split must add up to the person's monthly gross when it is saved
   (`SPLIT_NOT_GROSS`). In an advanced run each component is one earning line under its own label (code
   `monthly_pay`, its source the component), prorated as Monthly Pay is and rounded once. A person with no split in
   advanced mode, or whose split no longer adds up to their gross (the gross changed after it), gets the warning No
   Pay Split and one Monthly Pay line, their whole Monthly Pay treated as the pensionable and basic base, so the run
   still computes and the warning says it is an estimate.

### 6.12 Statutory calculation (advanced mode)

The engine is the donor's shape, pure and deterministic, with **no rate in the code and none in a seed**: every
rate, band and relief comes from `statutory_rate` rows in force on the run's last day (a past month uses that
month's rates). The function is `computeStatutory({ gross, basic, pensionable, rates })` in
`payroll.calc.js` and returns lines, tested without a database.

| Item | `kind` | Base | Rows it reads |
|---|---|---|---|
| Employee pension (`pension_employee`) | employee | `pensionable` | one row: `rate` |
| Employer pension (`pension_employer`) | employer | `pensionable` | one row: `rate` |
| NHF (`nhf`) | employee | `basic` | one row: `rate` |
| Relief (`relief`) | employee | `gross` | `flat_amount` and a `rate` (both may apply) |
| PAYE (`paye`) | employee | `taxable` | ordered rows: `band_from`, `band_to`, `rate`, `position` |
| ITF (`itf`) | employer | `annual_payroll` | one row: `rate` |
| NSITF (`nsitf`) | employer | `annual_payroll` | one row: `rate` |

1. **The accountant's conventions are configuration, not code** (§6.11 rule 3a, §13.1 item 21): `paye_basis`
   (`annualised`: annualise the month's taxable pay, apply the bands, divide by twelve; `monthly`: apply bands
   entered as monthly amounts to the month's taxable pay), `pension_reduces_taxable` and `nhf_reduces_taxable`.
   When the flags are true, employee pension and NHF reduce the taxable pay before PAYE; relief is applied as both
   a flat amount and a percentage; PAYE is progressive over the ordered bands. The function takes the conventions
   as inputs and has no default for any: an unset one is `NO_CONVENTIONS` at switch-on.
2. Employee items are `deduction` lines and reduce net; employer items are `employer` lines, in
   `employer_total` and on the report, never on the payslip's net.
3. An item with no row in force is not computed, and a run in advanced mode with no PAYE table shows the blocking
   problem No Rates Set naming the item; the engine never defaults a rate.
4. ITF and NSITF are two rate rows and two employer lines, the only items the donor does not model.
5. **Test data is not seed data.** Tests carry their own labelled rates in the test file. The demo's PAYE bands,
   the donor's rates and any figure in this guide are never loaded: MILESTONES §11 requires the real rates,
   confirmed against current law, before M6 is demonstrated.
6. **The statutory report** (`templates/documents/statutory-report.html`, doc type `statutory_report`, an export
   made from the run's lines) lists, per item and per employee, the base and the amount, the employee and employer
   totals, and the people's tax and pension numbers (`employee.statutory`; a missing number prints Not Set).
7. **What is data and what is code.** Parametric, entered on Configurations as a new version from a date with no code
   change or deploy: every rate, every band's limits and rate, the relief's flat amount and percentage, the employer
   percentages, each item's base, and the three conventions. So when the tax authority changes a rate, a band or a relief,
   someone with `payroll.configure` enters the new version from its effective date; runs for earlier months keep the
   rates they were paid at, and a locked run never changes. Nothing fetches rates from the tax authority: a person
   enters every change, and the engine never defaults one. In code: the set of items (PAYE, employee and employer
   pension, NHF, ITF, NSITF, relief) and the shape of the formula. A new kind of levy or a different formula is a small
   code change reviewed with MyCity's accountant, not a configuration.
8. **The bases, as built (PR 5; §13.2 item 24).** `gross` is the month's earnings on the slip: Monthly Pay or the
   pay split, overtime and earning adjustments; attendance deductions, unpaid days, fines and advances come off the
   net after the statutory items and do not reduce a base. `basic` is the `basic` component as paid (the whole
   Monthly Pay with no split), `pensionable` the pensionable components as paid (likewise). `annual_payroll` (ITF,
   NSITF) is the month's gross, each month's share of the year's payroll. Each item's base is the row's own among
   those its formula allows (`ITEM_BASES` in `statutory.js`; PAYE is always `taxable`).
9. **PAYE, as built.** Taxable pay is gross less the relief (its flat amount plus its rate of gross), less employee
   pension and NHF as deducted when the conventions say so, never below nothing. `annualised`: every monthly figure
   × 12, the bands and the relief's flat amount read as annual amounts, the tax ÷ 12; `monthly`: the bands and the
   flat amount read as monthly amounts. Each line is rounded once, half up, from full precision; a line of nothing
   is left off. A line keeps its base (`payslip_line.base_amount`: for PAYE the month's taxable pay) for the report.
10. **What a run keeps.** Compute writes into `config_snapshot` the conventions, the rate rows it used
   (`statutory_rates`) and what was missing (`statutory_missing`: `paye` with no PAYE table in force on the
   month's last day, `conventions` when one is unset); the items that have rates are computed either way, and No
   Rates Set reads `statutory_missing`. The report prints the rates from the snapshot, so a rate changed since does
   not show on an old run's report.
11. **Every statutory item is monthly** (TB, 11/11/2026, §13.1 item 30), **and PR 9 found what the law says of each**
   (§6.16). PAYE, employee and employer pension, NHF, ITF and NSITF are each computed for the month and taken in that
   month's run; no item is deducted once a year and no setting, label or help on a screen offers an annual deduction. Where
   the law states a year's figure, the engine takes the month's share; that is arithmetic of the formula, never a choice a
   person makes. **PAYE:** the bands are a year's (Nigeria Tax Act 2025, s.58 and the Fourth Schedule) and are entered
   exactly as the Schedule publishes them; the tax is deducted from every month's pay, and the deductions of a year of
   assessment (1 January to 31 December) must add up to the tax on that year's emoluments (Nigeria Tax Administration Act
   2025, s.51(6) and (7)). The method is **cumulative** (the Operation of PAYE Regulations 2002, regs 3 and 4, kept in
   force by NTA s.199(b); the Joint Revenue Board's Guidelines 2026, paras 7.5 to 7.7): before each payment the employer
   works out the year's pay to date, its reliefs and eligible deductions to date, the cumulative taxable pay and the
   corresponding cumulative tax, and deducts that tax less what it has already deducted in the year; where the cumulative
   tax falls below what was deducted, the employer refunds the difference (reg 4(2)), and a joiner's figures carry over
   from the previous employer's leaving certificate (reg 5). The `annualised` reading as built (the month × 12, the bands,
   ÷ 12) is not that method, and the `monthly` reading (bands entered as monthly amounts) has no source. So PR 11 computes
   PAYE cumulatively over the calendar year, and fixes `paye_basis` (the column stays) to that reading; how the year's bands
   apply to the pay to date (in full, or pro-rated to the months elapsed) is not stated in either text, and MyCity's
   accountant or the relevant tax authority's tax tables settle it. PAYE is remitted by the 10th of the next month
   (Guidelines para 12.2; Regulations reg 7(1)). PAYE Basis leaves the screen in PR 10. **ITF** is by law a year's contribution, 1% of the calendar year's
   payroll paid by 1 April of the next year (Industrial Training Fund Act, s.6 and s.16), and **NSITF** a monthly one
   (Employee's Compensation Act 2010, s.33(1)); both are computed in each run as 1% of the month's payroll, which adds up
   over the year to what the law asks; NSITF says its contribution is payable in the first two working days of each month.
   **NHF** is 2.5% of the month's gross pay, remitted within one month (National Housing Fund Act, s.4 as substituted in
   2023, s.9; FMBN's own statement), and
   **pension** at least 8% from the employee and 10% from the employer of monthly emoluments, remitted within 7 working
   days of pay day (Pension Reform Act 2014, s.4(1), s.11(3)).
12. **Every rate has its source** (TB, 11/11/2026, §13.1 item 31). A rate, a band table, a relief or a convention is
   saved only with its legal source (§4.2) or marked No Legal Source with the reason ("a company rule, not a law").
   Configurations shows each version's source beside its figure, and the payslip's statutory report prints it. A figure
   that came from no document is never entered as if it were law.
13. **People enter every change; nothing updates a legal figure by itself** (TB, 11/11/2026, §13.1 item 32). No job,
   scheduler, fetch or AI call reads a tax authority's site or changes a rate. When the law changes, someone with
   `payroll.configure` enters the new version from its effective date with its source. The assistant never drafts a rate
   (`ai:none design:` stays on `statutory` and `salary_structure`).
14. **The conventions are law, not taste** (TB, 11/11/2026, §13.1 item 34), **and the law settles all three** (PR 9,
   §6.16). A rule the law settles is fixed in the engine with its citation in this guide; only a point the law leaves to
   the employer stays a convention on Configurations, saved with its source like a rate. The employee's contributions under
   the Pension Reform Act and under the National Housing Fund are eligible deductions, so they reduce chargeable income
   (Nigeria Tax Act 2025, s.30(1) and (2)(a)(iii) and (i)): PR 11 fixes `pension_reduces_taxable` and `nhf_reduces_taxable`
   true in the engine with that citation, and rule 11 fixes the PAYE basis. The texts read leave no statutory convention
   to the employer, so PR 11 takes away the Conventions card, the three conventions of Switch On and `NO_CONVENTIONS`,
   unless MyCity's accountant names a point the law leaves open. The employer allows both in PAYE on the deduction record,
   "subject to appropriate documentary evidence", pension "limited to the actual amount deducted and remitted to an
   approved Pension Fund Administrator" (the Joint Revenue Board's Guidelines 2026, paras 7.3, 8.1 and 8.3).
15. **The relief, as the Nigeria Tax Act 2025 has it** (§13.3 item 2, answered by PR 9). The `relief` item as
   built (a flat amount plus a percentage of gross) is the shape of the old Consolidated Relief Allowance, which has no
   legal source from 1 January 2026: the Act repeals the Personal Income Tax Act (s.196(g)) and grants no relief computed
   on pay. The one relief it gives an employee is **rent relief**: 20% of the annual rent the person paid, at most
   ₦500,000, on the person's own accurate declaration (s.30(2)(a)(vi)), claimed in writing (s.31) and refused without
   evidence (s.32(1)); it rests on the rent declared, never on gross. **The employer gives it in PAYE**: its deduction
   record carries "rent relief with appropriate information or evidence of payment by eligible employees" (the Joint
   Revenue Board's Guidelines 2026, para 7.4), and the Guidelines set what the person gives (the legal tenant's name, the
   rent paid and the period it covers, the landlord's full name with a mobile number, Tax ID or NIN, the property's
   address; para 9.6), that only the year's own rent counts (paras 9.4 and 9.5, rent for a longer period pro-rated) and
   that each tenant of a shared tenancy claims on their own share (para 9.3). PR 11 removes the item's present shape and
   builds rent relief that way: a person's declared rent for the year with its evidence document, the year's relief
   (20% of it, at most ₦500,000, both entered as a version with their source) taken through the cumulative reliefs of the
   year to date (rule 11). No relief is entered before MyCity's accountant confirms the register (§13.1 item 38).

### 6.13 Money, privacy and dates

1. **Wire names.** Amounts derived from a salary use the property names the salary mask already governs
   (`src/shared/rbac/field-mask.js`, `employee.salary`): a run's totals are `gross_pay`, `total_deductions`,
   `net_pay`; a payslip's the same; a line's, an instalment's or an adjustment's amount is `pay_amount` (never a
   bare `amount`, which would mask every amount in the product); the run's employer total is `employer_cost`,
   added to that list in PR 1. These fields are nullable in the contract. A reader without the grant gets
   null, and the screens show Restricted.
2. **Bank fields** follow `employee.bank`: another person's bank name and last four digits on a payslip are masked
   for a reader without it (`account_last4` joined that list in `field-mask.js` in PR 1). A person always sees their own.
3. **Masks apply at the boundary** (`maskForUser` in controllers), in exports and in the assistant's reads; a
   service uses the real figure.
4. **Dates** are ISO on the wire and day-first for people (`formatDate`, `formatMonth`); a period is a first-of-month
   date. Business days come from `shared/time/lagos`, never `new Date()`.
5. **Events never carry an amount.** Events carry ids, the period, counts and statuses (audit is built from them);
   amounts live in the tables and are masked on the way out, as attendance does (`attendance.pay.js`).
6. **Nothing hard-coded.** Pay day, rates, bands, grades, components and every business choice are entered by
   MyCity on Configurations and People · Employees, never in code or a seed (A26).

### 6.14 A worked example (the tests' fixture)

October 2026, a person on `gross_monthly` ₦450,000.00 with the standard week (Monday to Saturday). Their
working days: 31 days less 4 Sundays less Thursday 1 October (Independence Day) is **26**. Daily rate
₦450,000.00 / 26 = ₦17,307.692307… (full precision).

| Line | Code | Working | Amount |
|---|---|---|---|
| Monthly Pay | `monthly_pay` | paid all 26 days | 450,000.00 |
| Overtime | `overtime` | one confirmed item, priced by attendance | 8,000.00 |
| Lateness | `lateness` | two pending items, 1,622.60 + 1,877.40 | 3,500.00 |
| Absence | `absence` | one day, the daily rate rounded once | 17,307.69 |
| Unpaid Leave | `unpaid_leave` | 2 working days × daily rate, rounded once (34,615.384…) | 34,615.38 |
| Fine | `fine` | ₦45,000.00 spread over 3, month 1 of 3 | 15,000.00 |
| Salary Advance Repayment | `advance` | ₦75,000.00 over 3, month 1 of 3 | 25,000.00 |

Earnings 458,000.00; deductions 95,423.07 (3,500.00 + 17,307.69 + 34,615.38 + 15,000.00 + 25,000.00); **net
₦362,576.93**. A joiner who starts on Wednesday 14 October has 16 working days of the 26 (18 days, less Sundays
18 and 25): Monthly Pay ₦450,000.00 × 16 / 26 = ₦276,923.08. Allocating ₦10,000.00 over three months gives
3,333.34, 3,333.33, 3,333.33. The tests assert these to the kobo, and that Compute twice gives the same lines.

### 6.15 Problems a run reports

| Code | Severity | Raised when | Fix |
|---|---|---|---|
| `NO_SALARY` | Blocking | A person in the run has no `gross_monthly` | Set the pay, or exclude them |
| `NEGATIVE_NET` | Blocking | A payslip's net is below zero | Spread a deduction, add an adjustment, exclude |
| `NO_RATES` | Blocking | Advanced mode and a needed item has no rate in force | Enter the rate on Configurations |
| `OVERTIME_WAITING` | Warning | Pending overtime items exist for the period | Ask the line manager to decide them |
| `NO_BANK` | Warning, or Blocking with Bank Details Required on | A person has no bank name or account number | Add them on People · Employees |
| `CONTRACT_ENDED` | Warning | An active person's contract ended before the period's last day | Check the person, exclude if needed |
| `NO_PAY_SPLIT` | Warning | Advanced mode and no pay components for a person | Set the split on Configurations |
| `FINE_WAITING` | Warning | A pending fine exists (any month) | Accept, spread or waive it on Deductions |

Submit refuses while any Blocking problem stands (422 `RUN_HAS_PROBLEMS`); warnings never block. A problem is about one person, and
Overtime Waiting and Fine Waiting say how many; a run reports problems while it is a Draft or Computed one, and none once it is
Submitted. An advanced run reports No Rates Set, blocking, when its Compute found no PAYE table in force on the month's last day
or a convention unset (its snapshot's `statutory_missing`, §6.12 rule 10): the engine never defaults one (§6.12 rule 3), so
Submit refuses it rather than approve a run with PAYE missing. No Pay Split is a Monthly Pay line on an advanced run's payslip
that is not a component of the person's split (§6.11 rule 6).

### 6.16 Legal sources (the statutory register)

Every statutory figure the engine may apply is listed here with the instrument it comes from (TB, 11/11/2026, §13.1
item 31). PR 9 researched each one from the primary text on 11/11/2026 (JP, in a session whose network was opened to the
government and gazette sites named in the second table for the research and closed again after it; CLAUDE.md, "Research
has sources"). **Nothing here is entered on Configurations until MyCity's accountant has confirmed the register**
(§13.1 item 38, pending; TB obtains it). MyCity then enters each figure as a new version from its date, with the section
and the document the second table names (PR 10's Source fields); a figure marked Unverified or No Legal Source is never
entered as if it were law. **Confirmed** means a primary text read on that day says so; **Unverified** says what is
missing; **No Legal Source** says why there is none. "Reported" marks what secondary summaries say, recorded only so the
next reader knows what to look for; it is never a citation.

| Item | Status | Instrument and section | Figure | Base | Threshold | In force from | Monthly? |
|---|---|---|---|---|---|---|---|
| PAYE bands (`paye`) | Confirmed | Nigeria Tax Act, 2025 (No. 7 of 2025), s.58 and the Fourth Schedule, "Individuals' Income Tax Rates" (gazette p. A538; p. A540 of the House's certified copy) | A year's bands of chargeable income: the first ₦800,000 at 0%, the next ₦2,200,000 at 15%, the next ₦9,000,000 at 18%, the next ₦13,000,000 at 21%, the next ₦25,000,000 at 23%, above ₦50,000,000 at 25%. As Set Bands takes them: 0 to 800,000 at 0; 800,000 to 3,000,000 at 15; 3,000,000 to 12,000,000 at 18; 12,000,000 to 25,000,000 at 21; 25,000,000 to 50,000,000 at 23; 50,000,000 with no limit at 25 | Chargeable income: total income (s.28, employment income among it) less the eligible deductions of s.30; the Schedule applies "after the relief allowance and exemptions" of s.30(1) | None, except that s.58 does not charge an individual earning the minimum wage (the minimum-wage row) | 1 January 2026 (the Act's commencement note; s.203) | No: the bands are a year's ("in respect of each year of assessment", s.58; the year of assessment is 1 January to 31 December, s.202). Deducted monthly: the next row |
| PAYE, the monthly deduction (`paye_basis`) | Confirmed for the method; Unverified for how the bands are read over part of a year | Nigeria Tax Administration Act, 2025 (No. 5 of 2025), s.51(6), (7) and (9); the Operation of Pay-As-You-Earn (PAYE) Regulations (S.I. 18 of 2002), regs 3, 4 and 5, kept in force by the Nigeria Tax Act, 2025, s.199(b); the Joint Revenue Board's Personal Income Tax Guidelines, 2026, paras 7 and 8 | The employer deducts the tax from every payment of emoluments (s.51(6)) so that the year's deductions equal the year's tax (s.51(7)), and does it **cumulatively**: before each payment it works out the year-to-date emoluments, the year-to-date reliefs and eligible deductions, the cumulative taxable emoluments and "the corresponding cumulative tax", and deducts the difference from what it has already deducted (Regulations reg 3 and 4(1); Guidelines paras 7.5 to 7.7: "the tax, if any, deducted or repaid on making the payment"). "Where the cumulative tax is less than the previous cumulative tax, the employer shall refund the difference to the employee" (reg 4(2)). A joiner's year-to-date figures carry over from the previous employer's leaving certificate (reg 4(3), reg 5(2)(b)). Neither text says whether the cumulative tax applies the year's bands in full to the pay to date or the bands pro-rated to the months elapsed: the relevant tax authority's tax tables or MyCity's accountant settle it | Emoluments: "remunerations including all allowances, salaries, wages, perquisites, bonuses, and other forms of compensation" (Guidelines para 1); bonuses, overtime and commission are taxed when paid (para 13) | None | The Regulations since 1 January 2002; the Administration Act from 26 June 2025; the Guidelines dated 24 February 2026 | Yes, from every month's pay, on the year to date. The engine's `annualised` reading (the month × 12, the bands, ÷ 12) is not the prescribed method, and the `monthly` reading (bands entered as monthly amounts) has no source (§6.12 rule 11) |
| PAYE, remittance and returns | Confirmed | Operation of PAYE Regulations 2002, reg 7(1) and reg 10; Deduction of Tax at Source (Withholding) Regulations, 2024 (S.I. No. 34 of 2024), reg 7(1)(b)(i); the Joint Revenue Board's Guidelines, 2026, paras 6.1, 12.1, 12.2 and 25; Nigeria Tax Administration Act, 2025, s.107(1), s.105, s.14 | PAYE is remitted "not later than the 10th day of the month following the deduction" (Guidelines para 12.2; "within ten days of the end of every month", Regulations reg 7(1) and Guidelines para 6.1; the same for PAYE paid to a State Internal Revenue Service, Withholding Regulations reg 7(1)(b)(i)), to the relevant tax authority, which for an employee resident in a State is that State's Internal Revenue Service (Guidelines para 25). A deduction not remitted by the 21st of the next month costs the amount, a penalty of 10% a year and interest at the Central Bank's monetary policy rate (NTAA s.107(1)); not deducting costs 40% (s.105). The employer files a return of every employee's emoluments, deductions and tax by 31 January for the year before (s.14(1) and (2); Guidelines para 12.1), and the employee files their own (s.14(3); by 31 March, Guidelines para 11.1) | n/a | n/a | As each instrument | The remittance is monthly, by the 10th; the return yearly |
| Pension and NHF reduce taxable pay (`pension_reduces_taxable`, `nhf_reduces_taxable`) | Confirmed | Nigeria Tax Act, 2025, s.30(1) and (2)(a)(i) and (iii); s.31; s.32; the Joint Revenue Board's Guidelines, 2026, paras 7.3 and 8 | The individual's contributions under the National Housing Fund ((i)) and under the Pension Reform Act ((iii)) are eligible deductions: chargeable income is total income less them (and less National Health Insurance Scheme contributions, (ii), interest on a loan for an owner-occupied house, (iv), and life assurance premiums, (v), none of which payroll deducts). The employer records each contribution on the deduction record (Guidelines para 7.3) and they apply "subject to appropriate documentary evidence", NHF "limited to the actual amount contributed" and pension "limited to the actual amount deducted and remitted to an approved Pension Fund Administrator" (paras 8.1 and 8.3) | The contributions as actually made | None | 1 January 2026 | Yes: each month's contribution comes off that month's taxable pay. Both are law, not a convention (§6.12 rule 14) |
| PAYE, the minimum-wage exemption (no item yet) | Confirmed | Nigeria Tax Act, 2025, s.58; s.163(1)(t) (s.162(1)(t) in the House's certified copy); "National Minimum Wage" in s.202; the Joint Revenue Board's Guidelines, 2026, the exempt employee's return; the National Minimum Wage (Amendment) Bill, 2024, clause 2 (new s.3(1)); the National Salaries, Incomes and Wages Commission's circulars SWC.04/T/140 (23 September 2024) and SWC/S/04/S.542/III/461 (27 September 2024) | The employment income of a person whose gross income from that employment is the national minimum wage or less is exempt (s.163(1)(t)), and s.58 charges no individual earning the minimum wage. The wage is "the extant minimum wage prescribed by the National Minimum Wage (Amendment) Act 2024" (s.202): **₦70,000 a month**, as the Board's return for an exempt employee asks ("Do you earn more than minimum wage of N70,000") and as the Bill set it ("not less than N70,000.00 per month"). The wage commission's circulars record "the enactment of the National Minimum Wage (Amendment) Act 2024" and apply it "with effect from the 29th July 2024". The Act's own text is not published anywhere this research could reach | Gross income from the employment | At or below ₦70,000 a month | The Act from 29 July 2024; the exemption from 1 January 2026 | Monthly: the month's gross against the monthly wage |
| Consolidated Relief Allowance (`relief` as built) | No Legal Source from 1 January 2026 | Nigeria Tax Act, 2025, s.196(g) (s.195(g) in the House's certified copy); s.30 | None. The Act repeals the Personal Income Tax Act, Cap P8 LFN 2004, from its commencement (s.196(g)), and grants no relief computed on pay: the whole text has no consolidated relief allowance, and the only reliefs it applies before the Fourth Schedule are the eligible deductions of s.30 | n/a | n/a | Repealed 1 January 2026 | n/a. The item's shape (a flat amount plus a percentage of gross) leaves the engine in PR 11 (§6.12 rule 15) |
| Rent relief (no item yet) | Confirmed | Nigeria Tax Act, 2025, s.30(2)(a)(vi), s.31, s.32(1); the Joint Revenue Board's Guidelines, 2026, paras 7.4 and 9 | 20% of the annual rent the individual paid, at most ₦500,000, "whichever is lower" (s.30(2)(a)(vi); para 9.1). **The employer gives it in PAYE:** its deduction record carries "rent relief with appropriate information or evidence of payment by eligible employees" (para 7.4). The rent is the year's own: rent paid in 2026 counts for 2026 (para 9.4), and rent covering more than one year is pro-rated to it (para 9.5; ₦2,000,000 for 24 months gives ₦1,000,000 for the year and a relief of ₦200,000); in a shared tenancy each tenant claims on their own portion, up to ₦500,000 (para 9.3) | The rent the individual paid for the year, never their pay | The individual declares "the actual rent paid and other prescribed information" (para 9.2) and gives at least the legal tenant's name, the actual rent paid and the period covered, the landlord's full name with one of a mobile number, Tax ID or NIN, and the property's address (para 9.6); the tax authority may ask for evidence and refuse without it (s.32(1)) | 1 January 2026 | A year's amount, given in PAYE through the cumulative reliefs of the year to date (para 7.5) |
| Employee pension (`pension_employee`) | Confirmed | Pension Reform Act, 2014 (No. 4 of 2014), s.4(1)(b), s.120 ("monthly emoluments", "employee", "employer"), s.2(2) and (3), s.11(3), s.10(1); PenCom's own statement of who the Act covers (its Framework for Micro Pension Plan, 2018) | "A minimum of eight per cent by the employee" of monthly emoluments (s.4(1)(b)); the rates may be raised by agreement, and the Commission told (s.4(2)); the employer deducts it at source and remits it with its own share "not later than 7 working days from the day the employee is paid his salary" (s.11(3)); contributions are tax-deductible (s.10(1); the same in NTA s.30(2)(a)(iii)) | "Monthly emoluments": total emoluments as the employee's contract of employment defines them, "but shall not be less than a total sum of basic salary, housing allowance and transport allowance" (s.120) | **Three or more employees.** PenCom states that the Act "applies to all employees in ... the Private Sector Organizations in which there are three or more employees", and that employees of organisations "with less than three employees" and the self-employed may join under s.2(3). That is the Act's own definition of "employer" (s.120: "any organization or business that employs three persons or more"); s.2(2)'s "15 or more employees" is an inconsistency in the text that the regulator does not apply | 2014 (the copy's assent date is not legible; reported as 1 July 2014) | Yes: a monthly deduction, remitted within 7 working days of pay day |
| Employer pension (`pension_employer`) | Confirmed | Pension Reform Act, 2014, s.4(1)(a), (4)(b) and (5) | "A minimum of ten per cent by the employer" of monthly emoluments (s.4(1)(a)); an employer may bear the whole, at not less than 20% (s.4(4)(b)). Beside the rates, every employer keeps group life insurance for each employee of at least three times their annual total emolument (s.4(5)), an employer's cost outside payroll | As above (s.120) | As above: three or more employees | As above | Yes: remitted with the employee's share within 7 working days of pay day (s.11(3)) |
| NHF (`nhf`) | Confirmed | National Housing Fund Act, Cap N45 LFN 2004, s.4 as substituted by the Business Facilitation (Miscellaneous Provisions) Act, 2022 (No. 5 of 2022), s.45; s.9(1) as amended by its s.46; s.9(2); s.26; FMBN's own statement of the contribution | 2.5% of monthly income. An employee earning the national minimum wage and above in the public sector "shall contribute", one in the private sector "may contribute" (s.4(1)(a) and (b)); a self-employed person earning the equivalent "shall contribute" (s.4(2)); interest of 2% a year, or as the Bank determines, is paid on contributions (s.4(3)). The employer deducts it (s.9(1)) and remits it to the Bank "within one month of the making of the deduction" (s.9(2)) | **The month's gross pay.** The 2023 s.4 says "monthly income", and FMBN, the Bank that runs the Fund, states the contribution as "The 2.5% of the monthly gross salary" (its NHF questions and answers) and "2.5% of monthly income" (its legal framework page). "Basic monthly salary" (the old s.4) and "basic monthly salaries" (s.26) are the original Act's words, which FMBN's own copy of Cap N45 still prints as before 2023 | Earning the national minimum wage and above | 8 February 2023 (the 2022 Act's commencement note) | Yes. **For MyCity, a private-sector employer, NHF is voluntary:** it is a deduction only for a person who chooses to contribute |
| ITF (`itf`) | Confirmed | Industrial Training Fund Act, Cap I9 LFN 2004, s.6 as substituted by the Business Facilitation (Miscellaneous Provisions) Act, 2022, s.41; the definitions in s.16 as inserted by the Industrial Training Fund (Amendment) Act, 2011 (No. 19 of 2011), s.14 | 1% of annual payroll, an employer contribution, never taken from pay (s.6(1)); the Minister may vary the rate by order in the Federal Government Gazette with the Federal Executive Council's approval (s.6(3)) | "Payroll": the sum total of all basic pay, allowances and other entitlements payable within and outside Nigeria to any employee (s.16) | An employer having 25 or more employees in its establishment and not operating within a free trade zone (s.6(1)). "Employees" are all persons employed for salary, wages or other consideration, full time or part time, including temporary employees who work 30 days or more (s.16). The 2011 test (5 or more employees, or fewer with a turnover of ₦50 million a year) was replaced on 8 February 2023 | 8 February 2023 for the threshold; the rate and the definitions since 3 June 2011 | No: a year's contribution for each calendar year, due by the "prescribed date", not later than 1 April of the following year (s.16). Computed monthly here as the month's share, 1% of the month's payroll (§6.12 rule 11) |
| NSITF (`nsitf`) | Confirmed | Employee's Compensation Act, 2010 (No. 13 of 2010), s.33(1) and (2), s.35, s.73; NSITF's own statement of the rate (its site's FAQ) | The Act: "within the first 2 years of the commencement of this Act", a minimum monthly employer contribution of 1.0% of the total monthly payroll (s.33(1)), after which the Board may prescribe risk classes and different rates by industry (s.33(2)). NSITF states the rate today: "Every employer is required to make a minimum monthly contribution of 1% of the total monthly payroll into the Employees' Compensation Fund. Contributions are payable within the first two working days of each month, and the Board may adjust the rate for any industry based on its assessed occupational risk." No regulation under s.33(2) was found | Total monthly payroll; "payroll" is not defined in the Act | Every employer; an "employee" is a person employed under an oral or written contract of employment on a continuous, part-time, temporary, apprenticeship or casual basis (s.73) | 17 December 2010 | Yes, a monthly contribution (s.33(1)), payable within the first two working days of each month (NSITF); the Act's assessment is due on 1 January of its year, and the Board may take it by instalments (s.35) |
| Withholding on a contractor's or consultant's fees (no item; outside payroll) | Confirmed | Deduction of Tax at Source (Withholding) Regulations, 2024, reg 3, reg 4(1) and (2), reg 7(1), the First Schedule; kept in force by NTA s.199(b); the Joint Revenue Board's Guidelines, 2026, para 14 | A body corporate deducts tax at source from "commission, consultancy, technical, management, and professional fees": 5% for a resident recipient, 10% for a non-resident; 2% for other services; twice the rate where the recipient has no Tax Identification Number (reg 3(c)). The Guidelines apply it to every "non-employee (including contractors, consultants, and suppliers of goods or services)" (para 14.1). A small company is exempt from deducting where the supplier has a valid TIN and the other conditions of reg 4(2) are met | The fee paid | Every body corporate except a small company within reg 4(2) | 1 January 2025 (reg 11(1)) | Per payment; remitted by the 21st of the next month to the federal service, or by the 30th to a State Internal Revenue Service (reg 7(1); "the last day of the month following", Guidelines para 14.2). This is not a payroll line: it bears on how MyCity pays people who are not its employees (§13.3 item 4) |

**Where each was read, and what MyCity uploads.** The figures above were read in these copies on the day shown. The
last column names the document MyCity uploads with the figure when it enters it on Configurations (PR 10's Source fields
and `source_document_id`): the upload is made in the app, never in this guide.

| Item | Read in | Checked | By | MyCity uploads with the figure |
|---|---|---|---|---|
| PAYE bands, pension and NHF reducing taxable pay, the minimum-wage exemption, the Consolidated Relief Allowance, rent relief | The Nigeria Tax Act, 2025 in the Official Gazette No. 117 of 26 June 2025, Vol. 112, pp. A385 to A597, as hosted by the Lagos State Internal Revenue Service (https://www.lirs.gov.ng/assets/docs/Gazette%20-%20NIGERIA%20TAX%20ACT,%202025.pdf) and the Gombe State Internal Revenue Service (https://irs.gm.gov.ng/docs/national/NIGERIA_TAX_ACT_2025.pdf); checked against the House of Representatives' certified true copy released in January 2026 after the dispute over the gazetted text (https://media.premiumtimesng.com/wp-content/files/2026/01/Final-Approved-Copy-for-Print-NIGERIA-TAX-ACT-2025.pdf). Every figure and every section cited reads the same in both, except that the certified copy numbers the later sections one lower (the gazette's s.163 is its s.162, s.196 its s.195, s.203 its s.202) and its citation section omits the date, which both carry in the commencement note | 11/11/2026 | JP | The Nigeria Tax Act, 2025 as gazetted (Official Gazette No. 117 of 26 June 2025), naming in Source the Fourth Schedule for the bands, s.30(2)(a) for the deductions and rent relief, s.163(1)(t) and s.58 for the exemption; and the National Minimum Wage (Amendment) Act 2024 for the wage |
| PAYE, the monthly deduction; remittance and returns | The Nigeria Tax Administration Act, 2025 in the Official Gazette No. 117 of 26 June 2025, Vol. 112, pp. A257 to A345 (https://irs.gm.gov.ng/docs/national/NIGERIA_TAX_ADMINISTRATION_ACT.pdf; the Nigeria Revenue Service hosts a scan of the gazette, https://www.nrs.gov.ng/uploads/NIGERIA_TAX_ADMINISTRATION_ACT_2025_8c945071a7.pdf), checked against the House's certified copy (https://media.premiumtimesng.com/wp-content/files/2026/01/Approved-Copy-to-Print-NIGERIA-TAX-ADMINISTRATION-ACT-2025.pdf.pdf), which reads the same on s.14, s.51, s.105 and s.107 (11/11/2026). The Deduction of Tax at Source (Withholding) Regulations, 2024 in the Official Gazette No. 168 of 2 October 2024, Vol. 111, pp. B753 to B766, in a law publisher's copy of the gazette (https://thenigerialawyer.com/wp-content/uploads/2024/10/Deduction-of-Tax-at-Source-Withholding-Regulations-2024_Gazetted.pdf) (11/11/2026). The Joint Revenue Board's Personal Income Tax Guidelines, 2026 (dated 24 February 2026; the Board's link is https://www.jrb.gov.ng/assets/2026-pit-guidelines-TJG3n9-T.pdf, which answers this session with a bot check), in the copy JBS Praxis downloaded and attached on 12/11/2026 under the same file name; its text matches what the search index quotes from the Board's link (paras 6.1, 7.4, 7.5 and 12.2), and the file is a later redesign of the same edition. The Operation of Pay-As-You-Earn (PAYE) Regulations (S.I. 18 of 2002) in the Federal Inland Revenue Service's consolidated text of the Personal Income Tax Act with its subsidiary legislation (2021; https://old.firs.gov.ng/wp-content/uploads/2021/07/Personal-Income-Tax-Act.pdf, not reachable from this session), attached by JBS Praxis on 12/11/2026; the Guidelines' paras 5 to 7 restate its regs 1, 2(3), 3 and 7 | 12/11/2026 | JP | The Administration Act as gazetted (s.51), the Guidelines (paras 7, 9 and 12) and the 2002 Regulations (regs 3, 4 and 7) |
| The minimum wage's figure | The Joint Revenue Board's Guidelines, 2026 as above (the return for an exempt employee); the National Minimum Wage (Amendment) Bill, 2024 as introduced (the copy PLAC publishes, attached by JBS Praxis on 12/11/2026; its commencement is blank and it bears no Clerk's certificate, so it is the Bill, not the Act); and the National Salaries, Incomes and Wages Commission's circulars on implementing the Act, published on its downloads page (https://nsiwc.gov.ng/information-center/circulars-salary-structures/): SWC.04/T/140 of 23 September 2024 (the Consolidated Public Service Salary Structure, "consequent upon the enactment of the National Minimum Wage (Amendment) Act 2024", "with effect from the 29th July 2024") and SWC/S/04/S.542/III/461 of 27 September 2024 (pensions, the same date). The Act itself: the gazette archive's 2024 issues answer with a bot check and the National Assembly's site does not publish it | 12/11/2026 | JP | The Board's Guidelines, naming the exempt employee's return in Source, with the wage commission's circular of 23 September 2024; the Act as gazetted if it is ever found |
| Employee and employer pension | The Pension Reform Act, 2014 as passed and assented, the text bearing the Clerk to the National Assembly's certificate under the Acts Authentication Act (June 2014) and the President's assent: PenCom's own file (`PRA_2014.pdf`, the name of the link on PenCom's Pension Reform Act page, which answers this session with 404), attached by JBS Praxis on 12/11/2026, whose text is the same scan as the copy the Nigeria Employers' Consultative Association publishes (https://neca.org.ng/download/the-new-pension-reform-act-2014/, read 11/11/2026). Its fonts carry a shifted character map, so the text was decoded before reading; the figures and sections cited read plainly. The gazette itself (indexed as No. 64 of 2 July 2014, Vol. 101, pp. A27 to A91) was not reached. The threshold: PenCom's Framework for Micro Pension Plan (2018) as summarised on PenCom's own publications page (https://www.pencom.gov.ng/news-and-events/, the entry "Framework for Micro Pension Plan 2018"; the framework's own file was not reached, PenCom's uploads answering 404) | 12/11/2026 | JP | PenCom's copy of the Pension Reform Act, 2014 (the attached `PRA_2014.pdf`), naming s.4 and s.120 in Source, and a printout of PenCom's statement of the threshold |
| NHF | The Business Facilitation (Miscellaneous Provisions) Act, 2022 in the Official Gazette No. 32 of 17 February 2023, Vol. 110, pp. A95 to A120, Part XI, in a law firm's copy of the gazette (https://sabilaw.org/wp-content/uploads/2023/03/Business-Facilitation-Misc-Provisions-Act-2022-searchable-pdf-1.pdf; no government-hosted copy was reached). The National Housing Fund Act, Cap N45, for s.9 and s.26, in a typed transcription, not a print of the Laws of the Federation (https://admin.theiguides.org/Media/Documents/National%20Housing%20Fund%20Act.pdf); FMBN's copy (https://fmbn.gov.ng/documents/NHF_ACT._CAP_N45.pdf) answered 404 and PLAC's refused the connection. The base: FMBN's own pages, its NHF questions and answers (https://fmbn.gov.ng/products/nhf-scheme/faqs: "The 2.5% of the monthly gross salary contribution qualifies you to access the loan") and its legal framework page (https://fmbn.gov.ng/products/nhf-scheme/legal-framework: "Mandatory contribution of 2.5% of monthly income", the pre-2023 wording on who pays), and FMBN's own copy of Cap N45 linked from it (https://fmbn.gov.ng/backend/storage/uploads/37UNgpzsyASabzhQCnHuyzFtIpnsfmW2ODvAmQSG.pdf, the Act as before 2023, which reads as the transcription did) | 12/11/2026 | JP | The 2022 Act as gazetted (Part XI, s.45), and a printout of FMBN's statement of the contribution |
| ITF | The Business Facilitation Act's gazette as above (Part IX, s.41) and the Industrial Training Fund (Amendment) Act, 2011 in the Official Gazette No. 108 of 22 June 2011, Vol. 98, pp. A373 to A378 (https://archive.gazettes.africa/archive/ng/2011/ng-government-gazette-dated-2011-06-22-no-108.pdf) | 11/11/2026 | JP | Both gazettes: the 2022 Act for the rate and the threshold, the 2011 Act for "payroll", "employees" and the due date |
| NSITF | The Employee's Compensation Act, 2010 in the Official Gazette No. 101 of 20 December 2010, Vol. 97, pp. A1281 to A1328, in a copy of the gazette at https://admin.theiguides.org/Media/Documents/Employee%20Compensation%20Act.pdf; and NSITF's own statement of the rate, the answer to "What is the contribution rate payable by employers?" on https://nsitf.gov.ng/ (the site draws the answer by script, so it was read in the site's own script file, `/assets/SiteShell-BEshLgUN.js`) | 11/11/2026 | JP | The Act as gazetted (s.33), and NSITF's written statement of the rate (a printout of its FAQ, or its letter), or the Board's regulation under s.33(2) if one is made |
| Withholding on a contractor's or consultant's fees | The 2024 Regulations' gazette as above (reg 3, reg 4, reg 7, reg 11, the First Schedule) | 11/11/2026 | JP | Nothing on Configurations: not a payroll figure |

**A second pass the same day** (11/11/2026, at JBS Praxis's request) reached the Pension Reform Act 2014 (the assented
text), the National Housing Fund Act's own text (a transcription), NSITF's statement of today's rate and the gazetted
Withholding Regulations 2024. **A third pass** (12/11/2026) read the documents JBS Praxis downloaded and attached: the
Joint Revenue Board's Personal Income Tax Guidelines 2026, the Operation of PAYE Regulations 2002 in the Federal Inland
Revenue Service's consolidated text, PenCom's own copy of the Pension Reform Act 2014 and the National Minimum Wage
(Amendment) Bill 2024; they settle the PAYE method, rent relief in payroll, the remittance date and the minimum wage
for PAYE. **A fourth pass** (12/11/2026, at JBS Praxis's request) settled the three points the third left open, from the agencies
that apply the law: the pension threshold from PenCom's own statement, the NHF base from FMBN's, and the minimum wage's
enactment and date from the National Salaries, Incomes and Wages Commission's circulars. **Still not read, and what each
would settle:** the relevant tax authority's PAYE tax tables or its word on how the bands apply to part of a year (the
cumulative tax); the Pension Reform Act 2014 as gazetted (whether the gazette carries s.2(2)'s "15"); the National
Minimum Wage (Amendment) Act 2024's own text (the figure itself rests on the Board's Guidelines and the Bill). Web searches and firms' summaries (KPMG, PwC, Mondaq, law firms' and payroll vendors' notes) were used only to
find where each text is, and are cited for nothing.

---

## 7 · Events, jobs and notifications

Events are defined in `payroll.events.js` (and the other four modules' files) with
`defineEvents("payroll", { ... })`; the constants it returns are used at every call site. Events carry ids,
the period, counts and statuses, never an amount (§6.13).

| Event / job | When | Does |
|---|---|---|
| `payroll_run.created`, `.computed`, `.discarded` | A run is opened, computed, discarded | Audit; realtime refresh of Payroll Runs |
| `payroll_run.submitted` | Submit commits | Audit; `payroll.run` opens in the same transaction; the engine tells the approver "Approval needed" |
| `payroll_run.returned` | The approver sends back or rejects, or the opener withdraws | Items released in the same handler that copies the decision; the engine tells the submitter |
| `payroll_run.approved` | The approval completes (`workflow.onCompleted("payroll.run", "payroll.apply_decision", ...)`) | Lock (§6.9 rule 3), audit, Home's card updates |
| `payroll_run.paid` | Mark Paid | Audit; Home's card stops counting it |
| `payslip.published` | Per person, in the lock | Notification "Your payslip is ready" to the person; the PDF is requested |
| `payslip.emailed` | A payslip is marked emailed, by Email All or Email a Copy (`copy` says which) | Audit; the outbox handler `payslips.mail` queues the mail on `email-send` (job `payslip-ready-<event>`, so a handler run again queues it once) with the PDF attached |
| `payroll_run.email_requested` | Email All Payslips committed (carries `resend`, the count queued and the database's clock at the press) | Audit; the outbox handler `payroll.email_payslips` |
| `payroll_run.export_requested`, `payslip.export_requested` | Download All was pressed on a run, or on My Payslips for a year | Audit; the document is reserved in the same transaction (`documents.generate`, pending) and the pdf-render job renders it |
| `payroll_adjustment.added`, `.removed` | An adjustment is saved or removed | Audit |
| `payslip.excluded`, `.included` | A person is left out of a run, or put back | Audit |
| `payroll_deduction.accepted`, `.released`, `.waived`, `.settled`, `.cancelled` | A fine or advance moves | Audit; notifies the employee for accepted, waived and a recorded advance; the fine events also reach `sanctions.fines`'s own (`sanction_fine.accepted` and so on). `.settled` is emitted by the lock (PR 2, entity `deduction`); the others are PR 3's (a fine's events name the fine as their entity, an advance's the deduction; an advance recorded is an `.accepted` with source `salary_advance`, and a cancelled advance tells no one) |
| `payroll_deduction.fine_pending` | After commit, from an outbox handler on `sanction.issued` whose payload has a `fine_amount` (`deductions.fine_waiting`); its `dedup_key` is the fine, so a retry tells once | Notifies `payroll` edit holders (scope `all`) "Fine Waiting for Payroll", the person and the query number, never the amount |
| `payroll_setting.changed`, `statutory_rate.saved`, `salary_grade.saved`, `grade_placement.saved`, `pay_components.saved` | Configurations change | Audit; `payroll_setting.changed` is `security: true` so the access watchers are told. Each carries the item, code, person and day, never a rate's figure or an amount; nobody is told |
| `payroll_run.statutory_report_requested` | Statutory Report was pressed on an approved advanced run | Audit; the document is reserved in the same transaction (`documents.generate`, `statutory_report`, an export kept 24 hours) and the pdf-render job renders it |
| `document.generated` (doc type `payslip`) | A payslip PDF finishes rendering | Marks it ready for the screen; nothing else |
| `payroll.email_payslips` (outbox handler) | Email All commits | Walks the run's published payslips not yet emailed (on a resend, not emailed since the press) whose PDF is done, 25 a pass (`pagination:batch`, a batch of work, never a list), and marks each emailed in its own transaction, which emits the `payslip.emailed` that queues its mail; a payslip whose PDF is still rendering makes the handler fail to be retried (10 s, 20 s, 40 s …) and, on the last attempt, is left unmailed for another press |

**How the run hears its approval.** Three registrations in `payroll.events.js`, as `expenses.events.js` does:
`workflow.onCompleted("payroll.run", "payroll.apply_decision", ...)` (approved, rejected, and the engine's timeout
outcomes), `outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "payroll.apply_withdrawal", ...)` (the opener
withdrew) and `outbox.register(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, "payroll.sent_back", ...)` (the approver's
Send Back). Each acts only on a `submitted` run and is idempotent; an approval is applied to the run at least once
and never twice. **A timeout never approves a payroll:** the definition carries money (`net_total`), so the engine
re-arms the stage and tells the CEO instead of approving, and refuses `auto_approve` on it (`conditions.js`).
`openInstance` is called with `context: { net_total }` in the Submit transaction, `subject_employee_id` null (a
run is about no one person), and the actor the submitter.

**Jobs.** `pdf-render` (existing) renders every payslip and the batch; `email-send` (existing) delivers the
mails. Compute runs inline in the request. `src/jobs/handlers/payroll-compute.js` and `payslip-render.js`
exist as empty stubs. PR 2 measured Compute for 308 people at 550 ms on the real migrations
(`tests/integration/payroll-run.test.js`; `PAYROLL_MEASURE=1` prints it), far under the three seconds that would move it to
`payroll-compute`, so there is no compute job and both stubs are deleted at the end (PR 8, README §11.5). There is no scheduler:
no reminder on pay day was agreed (the approver's waiting approval is already reminded by the engine's
reminder rules).

**Notifications** (`defineNotification`, never a row written by hand; category `payroll`, whose defaults are
email on and push off, each person's to change on Notification Settings):

| Event | Who is told | Title and body |
|---|---|---|
| `payslip.published` | The person | "Your payslip is ready", the month |
| `payroll_deduction.fine_pending` | `payroll` edit holders | "Fine Waiting for Payroll", the person and the query number |
| `payroll_deduction.accepted` (a fine or an advance) | The person | "Deduction Scheduled", the months and the reason; never the amount in the body of an email |
| `payroll_deduction.waived` | The person | "Fine Waived" |
| The engine's own (`workflow.*`) | The approver on Submit; the submitter on a decision | "Approval needed", "Payroll approved" and the returned reasons, as the engine words them |

**The Submit notice, checked (PR 6).** A submitted run tells the CEO ("Approval needed", the engine's own, category `approvals`) in the
bell, by push and by email, and nobody else (the submitter is not asked to decide it); the bell, the push and the email each carry
the link `shared/route-map.js` gives `payroll_run`, Payroll · Payroll Runs on the run (`tests/integration/ai-actions-payroll.test.js`). The
approval's end tells each person "Your payslip is ready" (category `payroll`: bell and email, no push), opening My Payslips for
someone who cannot open Payroll · Payslips.

The bell's link opens the same screen as the email's, and the push's, for each person: all three take the link the reader may
open (`notifications.service.readerLink`, the route map's `self` included; `docs/guides/notifications.md` §3 step 2, PR 12).
`shared/route-map.js` maps `payroll_run` to Payroll · Payroll Runs, `payslip` to Payroll · Payslips (`self: true` to ESS · My
Payslips), `deduction` to Payroll · Deductions (`self: true` to ESS · My Payslips), and the retired `salary_structure` and
`statutory_return` entries to Configurations. So an employee without `payroll` is emailed "Your payslip is ready", "Deduction
Scheduled" and "Fine Waived" with a link to My Payslips, and a Payroll reader's own payslip opens Payroll · Payslips
(`tests/integration/ai-actions-payroll.test.js`).

---

## 8 · Permissions and visibility by role

The `payroll` permission key's grants are seeded in `0290` (A26: roles and grants are reference data); who
holds a role is decided in Settings · Users. The CEO passes every check.

| Role | Sees | Can do |
|---|---|---|
| Employee (`ess`, own) | Their own published payslips, their own deductions and scheduled instalments, Next Payday | Open, download and email a copy of their payslip; Download All of their year |
| Line Manager, Head of Department | Nothing in Payroll (their team's attendance items are on People · Attendance) | As today |
| Operations & People (`payroll` all: view, create, edit, delete, approve, export; salary and bank fields visible) | Everything | Run payroll end to end, accept, spread and waive fines, record advances, add adjustments, email and download, mark paid; `payroll.configure` by default |
| Management (`payroll` all: view, approve, export; salary and bank fields visible) | Every run, payslip (not its PDF), deduction and configuration | Approve where a stage names them; export |
| CEO | Everything | Approve the run (the seeded stage is the CEO); holds every capability |
| Implementation Team (`payroll` all, everything) | Everything until handover | Everything; `payroll.configure` by default |
| System Administrator and others | Nothing unless Settings grants `payroll` | As granted |
| Praxis AI | Only what the asking person may read, masked as on screen | Cards the person confirms (§9) |

- **The person who submits cannot approve** (the engine's rule). The CEO may approve a run that includes their
  own pay, and their own payslip, fine or advance is recorded and accepted by someone else (§6.6 rule 8).
- **Restricted fields.** `employee.salary` governs every amount of §6.13; `employee.bank` the bank on a payslip;
  `employee.statutory` the tax and pension numbers on the report and People · Employees. A Payroll reader
  without the salary grant sees headcounts and statuses and Restricted for money.
- **A payslip's PDF** is a restricted document: the person who owns it reads it, anyone else needs `payroll`
  edit (HANDOFF §5 item 7), which Management does not hold.
- **Capability `payroll.configure`** (catalogued in `src/shared/access/access.catalog.js`, seeded in `6099`, code
  checked after the grant on `PATCH /payroll/settings`, the statutory-rate, salary-grade, placement and
  pay-component writes): Operations & People, the Implementation Team and the CEO hold it by default. A screen
  hides the controls with `hasCapability(useMe(), "payroll.configure")`; the route still decides. Configurations
  itself shows to every `payroll` viewer, so the tab is not gated by it (no change to `app/src/shell/access.ts`
  tab filtering is needed).
- **"Managers accept" (4 November)** means the people with `payroll` edit, not line managers, who hold no
  payroll grant (§13.2 decision 6).

---

## 9 · AI and search

M6 registers **no AI job of its own**: it adds no model call (no reading, drafting or scoring). Its cards and
reads run on the assistant engine's existing job (praxis-ai.md decision 25); if a model call of payroll's own is
ever wanted, the question CLAUDE.md requires ("which job does it use?", the owner's choice recorded with
`chosen_by`) is asked first.

- **AI reads** (`payroll.ai.js`, `payslips.ai.js`, `deductions.ai.js`; each a page of 25, masked as on screen):

  | Read | Answers | Permission |
  |---|---|---|
  | `payroll.runs` | The runs, their month, status and (with the salary grant) totals | `payroll` view |
  | `payslips.mine` | The asking person's own published payslips: month, gross, net, deductions | `ess` view · own |
  | `payslips.list` | A month's payslips within reach, with the salary grant | `payroll` view |
  | `deductions.list` | Pending, active and settled deductions, by person and source | `payroll` view |
  | `deductions.mine` | The asking person's own deductions and scheduled instalments | `ess` view · own |

  A **summary** (figures, never rows): `payroll.month` (headcount, gross, deductions, net of a month; the month asked for,
  else the run Payroll Runs shows first; `PayrollMonthQuery`). A summary is not masked on the way out as a read's rows are, so
  `payroll.month` leaves the three amounts out for a reader whose role hides pay (`employee.salary`) and answers the headcount
  alone, as the screen shows Restricted.

  **A person's own pay is never masked from them** (§6.13 rule 3), but the assistant's engine masks the salary-derived names in
  every row it reads and the Employee role hides salaries by default (`0449`), so a plain employee would be answered null about
  their own payslip. `payslips.mine` and `deductions.mine` therefore read by the session's employee id and nobody else's and
  carry the amounts under names the mask does not govern (`gross`, `net`, `deductions`, `amount`); the Payroll readers' reads
  keep the masked names and are masked as the screen is. Their citations open My Payslips (route-map types `payroll_own_payslip`
  and `payroll_own_deduction`), where a link to Payroll · Payslips would not open for someone without `payroll`.
- **AI cards** (each runs the service function its screen's button calls; risk `payroll`, so Confirm It's You
  first, praxis-ai.md decision 11; form schema named so gate 23 is satisfied):

  | Action | Input schema | Runs |
  |---|---|---|
  | `payroll_runs.create` (New Run) | `PayrollRunCreate` | `payroll.service.createRun`; `form: "none"` (its modal is PR 7's) |
  | `payroll_runs.submit` (Submit for Approval) | `PayrollRunSubmission` (`PayrollRunSubmit` with the run) | `payroll.service.submitRun`; `form: "none"` |
  | `payroll_adjustments.add` (Add Adjustment) | `PayrollRunAdjust` (`PayrollAdjustmentAdd` with the run) | `payroll.service.addAdjustment`; `form: "none"` |
  | `deductions.accept` (Accept Deduction) | `FineAccept` (`DeductionAccept` with the fine) | `deductions.service.acceptFine`; `form: "none"` |
  | `deductions.waive` (Waive Fine) | `FineWaive` (`DeductionWaive` with the fine) | `deductions.service.waiveFine`; `form: "none"` |
  | `advances.record` (Record Advance) | `AdvanceRecord` | `deductions.service.recordAdvance` |

  Every card is risk `payroll`. A screen's button on a record never names it (it sits on the run or the fine that is open), so a
  card whose form does not name its record takes a card schema: the form's own fields with the record beside them
  (praxis-ai.md §6.11, "an edit form's card names its record"). Each is asked first for what it needs (decision 34: the run, among
  those the card may act on, written by its month or number; the fine, among those waiting; the person, from People's register; the
  start month, among the twelve from the open month, written as "October 2026"), is named by its chip (the run's number and month,
  the fine's person and query, never an amount), and is held again at the press by its own `check`: Submit needs a computed run, Add
  Adjustment a draft or computed one, Accept and Waive a fine still waiting that is not the asker's own, Record Advance a person who
  is not the asker (403 `OWN_RECORD`, §6.6 rule 8). Submit's card carries the net pay the person saw (`expected_net_total`, from
  `payroll.runs`), so a changed total is told first (409 `RUN_CHANGED`) and nothing is frozen.

  Approve and Reject are the approvals' own card (`approvals.decide`). The forms of rates, bands, grades, placements and pay
  components carry `ai:none design:` on their controllers (PR 5), and **the advanced switch, the pay day and the bank rule
  (`PayrollSettingsChange`) are not a card** (§13.2 item 28): they are one version of the setting, saved from a date with the
  rates in force and the accountant's three conventions in view, so the route "turn on advanced payroll" opens Configurations and
  the person saves it there. Nothing is added to `scripts/check/ai-forms-gaps.json`. Each action key has an integration test
  (`tests/integration/ai-actions-payroll.test.js`, and `payroll-run.test.js` for New Run) and an evaluation case
  (`scripts/ai/eval-assistant.js`); `npm run gen:ai-catalogue` is run and its diff reviewed.
- **What PR 4 carries.** Gate 9 holds a filled controller to an AI manifest or a written `// ai:none <reason>`, and gate 10 to a search provider: `payslips.controller.js` said `ai:none` with the reason that PR 6 writes `payslips.mine` and `payslips.list` (PR 6 wrote them and removed the line), and `payslips.search.js` answered for `payroll` readers. A payslip has no create or edit form, so gate 23 asks for no card.
- **What PR 2 carries.** Gates 9, 10, 19 and 23 hold a module to its AI manifest and its search provider from the day its controller is
  filled, which is PR 2, so PR 2 carries `payroll_runs.create` (New Run, with its integration test and evaluation case) and
  `payroll.search.js` for `payroll_run`; PR 6 adds the five other cards, the reads, the summary and the other providers. **What PR 3 carries** for the same gates: `deductions.ai.js` with the one route "record a salary advance" (Payroll · Deductions, `action=advance`) and `deductions.search.js` for an accepted fine or an advance (a fine still waiting is the sanction's, found with its query); the three cards and the reads of this section stay PR 6's.
- **What PR 5 carries.** Gates 9, 10 and 23 hold the two modules from the day their controllers are filled.
  `statutory.controller.js` and `salary_structure.controller.js` say `ai:none design:` (praxis-ai.md decision 35: the
  rate tables, the PAYE bands, the grades, a person's grade and pay split are structures laid out whole on
  Configurations, never drafted in the chat; the rates are entered from figures MyCity's accountant confirmed) and
  `search:none` (configuration, found as the Configurations screen in ⌘K); the route map's `salary_structure`,
  `statutory_return` and the new `payroll_setting` open Configurations and carry the same reason. So
  `StatutoryRatesSave`, `SalaryGradeSave`, `GradePlacementSave` and `PayComponentsSave` are accounted for and nothing
  is added to `ai-forms-gaps.json`; `PayrollSettingsChange` (payroll's own manifest) and the route "turn on advanced
  payroll" were PR 6's to decide, and PR 6 decided them (§13.2 item 28).
- **What PR 6 built (10/11/2026, `m6/ai-search`).** `payroll.ai.js` (the read `payroll.runs`, the summary `payroll.month`, the cards
  `payroll_runs.submit` and `payroll_adjustments.add` beside `payroll_runs.create`, the routes "run payroll" and "turn on advanced
  payroll"), `payslips.ai.js` (`payslips.mine`, `payslips.list`, the route "my payslip"), `deductions.ai.js` (`deductions.list`,
  `deductions.mine`, the cards `deductions.accept`, `deductions.waive` and `advances.record`, the route "record a salary
  advance"); `payslips.search.js` gained the owner-pinned provider; ⌘K gained the New Run action; the contract gained
  `PayrollMonthQuery`, `PayrollRunSubmission`, `PayrollRunAdjust`, `FineAccept` and `FineWaive` (Appendix C);
  `scripts/ai/eval-assistant.js` has a case for each of the six cards, for the reads and the summary and for the two routes;
  `npm run gen:ai-catalogue` added 13 entries and changed none. The route map had no "not built yet" note left on a Payroll
  type (PR 2 to PR 5 removed them as they filled each provider). Home's Payroll In Progress card has been live since PR 2
  (`payroll.source.js`, `OWES` empty) and counts a run until it is Paid; this pull request checks it still does (§3.8).
- **AI routes** (intent to screen): "run payroll" to Payroll · Payroll Runs with `action=new`; "my payslip" to
  ESS · My Payslips; "record a salary advance" to Payroll · Deductions with `action=advance`; "turn on advanced
  payroll" to Payroll · Configurations.
- **Search** (`payroll.search.js`, `payslips.search.js`, `deductions.search.js`, each a `recordProvider`):
  `payroll_run` (number, "October 2026 payroll", words payroll, run, salaries), `payslip` (number and the
  person's name; PR 4 carries the provider for `payroll` readers, within their scope, draft and published alike, never an amount; PR 6
  adds the `owner`-pinned provider, the route-map type `payroll_own_payslip` (module `ess`, group My Payslips, a result opens My
  Payslips), which finds only the person's own published payslips by number or month, whatever their grant; words payslip, pay slip, salary slip),
  `deduction` (the person and reason; words deduction, fine, advance, loan). Screens in
  `src/shared/search/screens.js`: Payroll Runs, Payslips, Deductions and Configurations (words advanced payroll,
  statutory, paye, pension, grades, pay day, salary structure), replacing the Salary Structure and Statutory
  entries; ⌘K actions New Run (`action=new` on Payroll Runs, answered by the screen's own New Run, as the route "run payroll" is) and
  Record Advance. The route-map entries that say "search:none not built yet" lose that note in the PR that fills their provider.

---

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone (FRONTEND_GUIDE §5,
§7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it is listed here as tier 1 or
tier 2.** Tier 3 (how the run is frozen, why the divisor is what it is, rounding, the lifecycle) is never on
a screen; it lives in this guide, the User Guide chapter and the AI assistant. The page title is at most 3
words, a subtitle 8 and desktop only, a card title 4, a button 3, a toast 8, a help term 35, any sentence 20, the
first phone screen 40 (`scripts/check/lib/copy.js`). Title Case chrome, Verb Noun buttons, no dashes in copy.
Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Payroll · Payroll Runs | The month (desktop subtitle); the open run's card, titled by its month (October 2026 Run): Staff in Run, Gross, Deductions, Net; the chain Draft, Computed, Submitted, Approved, Paid; Number, Waiting On (who has it now), Submitted By, Approved By, Paid On and Sent Back (the reason) as they apply; the problem line "2 blocking, 3 warnings" with Open (Run Problems: Employee, Problem, Fix, Severity, with Exclude on a person); Adjustments (Employee, Label, Kind, Amount) with Add Adjustment; Left Out (Employee, Reason) with Include; Run History (Month, Staff, Gross, Net, Approved By, Status), a row putting its run in the card; Net Payroll by Month (desktop); New Run, Compute Run, Add Adjustment, Exclude, Submit for Approval, Approve, Send Back, Reject (the approver), Mark Paid, Email All Payslips, Download All, Statutory Report (advanced), Discard | Help term on **Status** (Run History's column): what each status lets people do. On the problem line (**Blocking**): what stops Submit. On **Adjustments**: a correction to a locked month goes into the next run. On Send Back's **Reason**: it releases everything frozen. Each at most 35 words | The freeze at Submit, the recompute and `RUN_CHANGED`, rounding, the working-days divisor, one run a month: §6.8, §6.9, the chapter |
| Payroll · Payslips | The Month select (the runs, newest first; the open run's month to start); Payslips, Gross, Deductions, Net, Visible to Staff (On approval, then Published); the month's payslips, titled Preview or Published (Employee, Gross, Deductions, Net, Status: Preview, Published, Excluded); Email All Payslips and Download All once the run is approved; a payslip opens in the modal: its lines (its PDF once rendered, Preparing while it renders), Net Pay, Download PDF (`payroll` edit) | Help term on **Preview** (the list's title): a payslip is a preview until the run is approved. On **Restricted**: the amount needs the salary grant | PDF generation, the restricted file rule, the breakdown's source: §6.10 |
| Payroll · Deductions | Pending Fines, Pending Attendance, Active, Recovered This Year (each opens its list in a pop-up, the ESS rule); the status chips (Pending, Active, Settled, Waived) and the source switch (All, Attendance, Fines, Advances); the list (Employee, Reason, Source, Amount, Month, Status); a row's sheet with Accept This Month, Spread Over Months (Months, Start Month), Waive, Release, Cancel Advance, and for an attendance row Open Attendance; Record Advance (Employee, Amount, Paid On, Months, Start Month, Reason) | Help term on the **Months** field of Spread Over Months and Record Advance: how many months, the first month, equal shares. On **Pending Attendance**: waive these on People · Attendance. On **Release**: only before any share is in a run | Instalment rounding, never your own, the fine and attendance lifecycles: §6.6, queries.md §6.6 |
| Payroll · Configurations | Payroll Options: Pay Day (30 (default) until set, Last Day of Month for 31, a change waiting with its day and Remove Change) with Set Pay Day, the Bank Details Required switch, the Advanced Payroll row with its state (On, Off, or On or Off from a day) and its switch; Statutory Items (Item, Type, Rate, Base, Source: the instrument and section, or No Legal Source; Status: In Force, From or Changes a day, Not Set), a row opening Save Rate (with its Source fields) and, for a change not yet in force, Remove Change; PAYE Bands (Band, From, To or No Limit, Rate, Status) with Set Bands, always; when on or once it has been: Conventions (only those the law leaves to MyCity, each with its Source, §6.12 rule 14; PAYE Basis leaves the screen in PR 10) with Set Conventions, Bands by Grade, Grades (Grade, Name, Minimum, Maximum, Staff, Outside Band, Status) with Add Grade and Save Grade, Pay Components (Employee, Grade, Monthly Gross, Pay Split, Position, with the chips All, Below Minimum, Above Maximum, Not Placed) whose person opens with their grade and split, Place Person and Set Pay Components | Help term on **Advanced Payroll**: from its date, later runs compute PAYE, pension, NHF, ITF and NSITF; locked runs never change. On **Bank Details Required**: a person with none blocks Submit. On **Pay Day**: 30 unless changed; a day past a month's end is its last day. On the PAYE Bands title: enter the bands as the law publishes them; each is taken monthly. On **Source**: the law a figure comes from; No Legal Source when none. On **Monthly Gross** in Set Pay Components: the components add up to it. Effective From carries no help: the date field refuses a day before today itself | Why statutory is off by default, how a run picks its mode, the rates' sources, the formula: §6.11, §6.12 |
| ESS · My Payslips | The year with its ‹ › switch (from the person's start year to this one) and Download All; Gross, Net Received, Payslips, Deductions (View Details), Next Payday; the year's months (Month, Net, Status: Paid, Paid with a deduction, In the run); the picked month's payslip in the modal (its PDF once rendered, Preparing while it renders), Download PDF, Email a Copy; Salary Deductions (Month, Amount, Reason, Query, Outcome; Open My Queries) | Help term on **In the run**: approved, and the pay is not yet transferred (§13.1 item 28) | PDF rendering, that no statutory word appears in simple mode: §6.10, ess.md §6 |
| Home · Payroll In Progress | A count of runs not paid, opening the run | Help term on the card's title (as every Home card) | The card's source and mask: home.md §4.1, §3.8 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Payroll · Payroll Runs | Staff in Run and Net two to a row, the chain as a vertical list, the problem line, then run cards (month, net, status pill) | The subtitle, Gross and Deductions cards, the trend chart | Submit for Approval, full width at the foot of the open run's sheet | Bottom bar More, then People; the four tabs scroll sideways |
| Payroll · Payslips | Four figures two to a row, then payslip cards (person, net, status pill) | The Gross and Deductions columns | Download PDF, full width at the foot of a payslip's full sheet; Email All Payslips and Download All in the run's overflow | As above |
| Payroll · Deductions | Four figures two to a row, then deduction cards (person, reason, amount, status pill) | The Source column, the subtitle | Accept This Month at the foot of a pending fine's sheet, Spread Over Months and Waive beside it | As above |
| Payroll · Configurations | Pay Day, the Advanced Payroll row, Statutory Items and PAYE Bands as cards; when on, cards for the rest | The band chart, the subtitle, the Base, Minimum, Maximum, Monthly Gross and Pay Split columns | Switch On or Off, opening its date sheet; a person of Pay Components opens in a sheet with Place Person and Set Pay Components | As above |
| ESS · My Payslips | The year switch (44 px targets) and Download All; the figures two to a row; the months as a list with a status pill | The subtitle, the Gross figure; the payslip opens in a modal on desktop and as a full sheet on a phone (F31 as amended, §10.3) | Download PDF at the foot of the month's sheet, Email a Copy beside it | ESS tabs |
| Home · Payroll In Progress | The card as every Home card | Nothing | Open the run | Bottom bar Home |

### 10.3 Components, and the amendments this guide asks for

Every component is imported from `@mycity/ui` (CLAUDE.md, components only from the shared package); a missing one
is added there with `npm run new:component` (header, test and gallery page), never inside a feature.

| Need | Use |
|---|---|
| The four tabs | The shell catalogue only (`app/src/shell/catalogue.ts`); the screen renders no `Tabs` of its own |
| Run list, previous runs | `DataView` through `PagedTable` and `ExportAction` (`@/features/shared/sections`), with `StatusPill`, `Money`, `Who`; counts in `StatStrip` or `KpiGrid` and `KpiCard` (`KpiTiles`) |
| The chain and the approval | `Chain` of the run's five statuses (`stack` on a phone, added to `Chain` in PR 7), Waiting On from the run's own `chain` (the approval's route), `Banner` for the problem line, the run's buttons in its `FormFooter` (one group, so a press makes the others wait), the reason through `workflow.ReasonBody`, `useConfirm` before an irreversible press (Approve Run, Discard Run, Email Again) |
| New Run | `useModal`, `Field`, `useContractForm(initial, payroll.PayrollRunCreate)`, `FormFooter`, and `MonthField` (Forms), added in PR 7 with `npm run new:component -- --name MonthField --group Forms` rather than reuse the unbound `features/shared/MonthPicker.tsx`: a year's twelve months under a year switch, a popover on desktop and a sheet on a phone, the value the month's first day; New Run caps it at this month |
| The payslip | `Paper`, `PaperLogo`, `PaperTitle`, `PaperTable` (two columns), `PaperFoot` for the Payroll preview of an unpublished payslip, and for a published one until its PDF has loaded (and on the in-browser mock, which holds no file); `DocumentPreview` with `useFileBlob` for a published one (the real PDF, ess.md §6); `ListDetail` with `layout="modal"`, `size="wide"` and `full`; both screens share `features/payroll/parts.tsx` |
| Email All, Download All | `Button` with `icon="mail"` handing back its work; `ExportAction` (`saveExport`) for Download All |
| Deductions | `DataView` with `Chips`, `SegmentedControl` for the source, `StatStrip` for the figures (each opens its list in a pop-up), `ListDetail`, `SelectField` for the months and the start month (the months from the summary's `open_period`; twelve choices, so not `ChoiceField`), `EmployeePicker` for the person, `HelpTerm`; mirror `features/attendance/PayItems.tsx` |
| Configurations | `ToggleRow` or `Switch`, `Card` and `CardHeader`, `KeyValue`, `DataView`, `BandChart`, `MoneyField`, `DateField min={todayIso()}`, `Banner`, `Details` or `HelpTerm` for support text |
| Money, empty, loading | `Money` (`short` only on KPIs), `MoneyField`, `formatMoney`; `EmptyState` (an illustration, a title, at most 8 words, one action), `LoadingRows`, `ErrorState` |

**Amendments to ask for in PR 7 (record them where the Expenses ones are recorded: FRONTEND_FOUNDATION F31, FRONTEND_GUIDE §7 and CLAUDE.md):**

1. **F31 for Payroll · Payslips and ESS · My Payslips.** A payslip opens in the shared Modal at every width (the
   centred dialog on desktop, a bottom sheet on a phone), as an Expenses record does, because TB asked for "a modal"
   (4 Nov) and JBS Praxis settled both screens on 08/11/2026 (§13.1 item 18). Both use `ListDetail` with
   `layout="modal"`; ESS · My Payslips stops placing the payslip beside its list on wide screens. Recorded 11/11/2026
   (PR 7) in FRONTEND_FOUNDATION F31, FRONTEND_GUIDE §7 and CLAUDE.md, beside the Expenses one.
2. **The Advanced Payroll switch opens a form.** FRONTEND_GUIDE §8.1 says a setting that applies at once is a
   switch that saves on change; this one needs an effective date, so pressing it opens a small form with the
   date and saves on Switch On (built with Configurations in PR 5).

**What the prototype taught.** Its explainer cards (`ChainCard note`, `KvCard` rows such as "Automatic? No"), the
footnote under a payslip, `<Button disabled>`, a toast over eight words, a client-computed period
(`new Date().toISOString().slice(0, 7)`), INTERIM rules in `useContractForm` and an Add Deduction button with no
place in the agreed design are all rebuilt, not kept.

### 10.4 Words

Titles: Payroll Runs, Payslips, Deductions, Configurations, My Payslips. Cards: Run History, the open run's card by its
month (October 2026 Run; This Run with no run open), Adjustments, Left Out, Run Problems (a pop-up), Preview and Published
(the month's payslips), 2026 Payslips (My Payslips), Salary Deductions (a pop-up), Pending Deductions, Statutory Items, PAYE Bands, Conventions, Bands by Grade, Pay Components. Buttons: New Run, Open Run, Compute Run,
Add Adjustment, Exclude, Exclude Person, Include, Submit for Approval, Approve, Approve Run, Send Back, Reject, Reject Run,
Discard Run, Email Again, Remove Adjustment, Mark Paid, Email All Payslips,
Download All, Download PDF, Email a Copy, Statutory Report, Accept This Month, Spread Over Months, Waive,
Release, Record Advance, Cancel Advance, Switch On, Switch Off, Save Rate, Save Grade, Set Pay Day, Set Bands, Save Bands,
Add Band, Remove Band, Remove Change, Set Conventions, Add Grade, Place Person, Set Pay Components, Save Components, Add Component, Remove
Component. Cards on Configurations: Payroll Options, Statutory Items, PAYE Bands, Conventions, Bands by Grade, Grades, Pay
Components. Chips and statuses:
Draft, Computed, Submitted, Approved, Paid; Pending, Active, Settled, Waived; Preview, Published, Excluded, Preparing; Paid, Paid
with a deduction, In the run; Blocking, Warning; In Force, Not
Set, Below Minimum, Within Band, Above Maximum, Not Placed, No Legal Source, Last Day of Month.
Field errors (at most 4 words): Pick a month, Enter an amount, Give a reason, Pick a start month, Date too early.
Toasts (at most 8 words): "Run opened for October 2026", "Run computed", "Sent for approval", "October 2026 approved", "Run
sent back", "Run rejected", "Run marked paid", "Run discarded", "Adjustment added", "Adjustment removed", "Payslips are being
emailed", "Payslips downloaded", "Sent to your work email", "Deduction scheduled", "Advance recorded", "Pay day saved", "Rate saved", "PAYE bands saved", "Grade saved", "Person
placed", "Pay components saved". Money is `₦450,000.00` (`formatMoney`), a month "October
2026" (`formatMonth`), a date "08/11/2026" (`formatDate`).

---

## 11 · Edge cases

- **No salary yet.** Staff are loaded without pay until MyCity enters it; the first run shows No Salary Set for
  each, blocking Submit, with Open on the person. Nobody is ever paid zero silently.
- **A joiner or leaver mid-month** is prorated by working days (§6.3); a leaver's outstanding instalments are taken
  in their last run (§6.6 rule 9). A person who joins after a run is Submitted is in the next run; the approved
  run is not reopened.
- **A part-day leave or a leave spanning two months** (§6.5): split by working days; a half day in one month uses
  its amount.
- **A suspension with a day already marked absent** is counted once (§6.5 rule 2).
- **Pay changed after Compute.** Nothing changes until Compute or Submit runs again; Submit's recompute means the
  approver never sees a stale figure, and `RUN_CHANGED` tells the submitter first.
- **An attendance day changes after Submit** (a clock-out People add, leave granted): a frozen item stays as it
  is (attendance guide §6.17); to change it, the approver sends the run back.
- **A person waives a pending item while the run is a Draft.** The next Compute leaves it out; nothing else is
  needed.
- **The approver is the submitter.** The engine refuses (they cannot decide their own request); the CEO approving
  a run they submitted themself is allowed, as the engine says.
- **Send Back twice.** Each returns the run to Draft with its reason; one run still exists for the month; the
  history of decisions is the engine's, kept on the run's page.
- **A second run for a month** is a 409; a run for next month is a 422 until that month begins.
- **A button pressed twice** is one request (F26). A repeated Mark Paid or Compute is idempotent or a 409, never a
  second effect; Email All twice sends nothing again unless Email Again was chosen.
- **PDF not rendered yet.** Both payslip screens show Preparing, with no Download PDF, until the payslip's `pdf_ready` is
  true (`GET …/pdf` stops answering `NOT_READY`); the slip is drawn from its lines meanwhile. A failed render is retried by
  the document engine and shows in System Health.
- **A decision lands after it commits.** Approve, Send Back and Reject reach the run through the approval's outbox
  handlers (§7), so the screen waits, ten seconds at most, until the run has left Submitted before it reads it again.
- **An employee who has left** cannot sign in, so reads their payslips through the HR document route, not ESS;
  their last run still publishes and emails to the work address while it exists.
- **A fine accepted for a person who then leaves** is recovered in their final run (§6.6 rule 9); the part that
  would make the net negative stays `active` for Operations & People to settle or waive.
- **A short month and the pay day.** The pay date of February 2026 with the default 30 is Saturday 28 February; a pay day
  of 31 pays on 30 April; Next Payday and a payslip's Pay Date both use the month-end rule (§6.11 rule 1). The pay day is
  never a working-day adjustment: a Sunday or a holiday keeps its date, because MyCity's CEO transfers by hand.
- **A fine spread across a year end** works: instalments are months, not calendar years.
- **A run for a month before the advanced option's date** stays simple even if computed after it (§6.11 rule 2).
- **A rate changed mid-year.** A new version from a date; runs before it keep the rates they were paid at; the
  report of a past run reads that month's rates.
- **A public holiday set after Compute.** Submit's recompute reads the holidays again; the daily rate moves with
  them; the totals change and `RUN_CHANGED` says so.
- **Staging sends real mail (A4).** Email All on staging reaches real inboxes with demonstration figures; staging
  demos use test people (§13.1 item 19), and the staging seed never emails.
- **A payroll reader without the salary grant** sees counts and statuses and Restricted for money, in the screen,
  exports and the assistant alike.
- **Export expiry.** A Download All or statutory report is kept 24 hours (`export-cleanup`); pressing again makes
  a new file.
- **The CEO's own payslip, fine or advance** is recorded and accepted by someone else (§6.6 rule 8).
- **A huge list.** Every list pages at 25; the problems list pages; Email All walks payslips in pages of 25 inside
  the handler and records each send before the next.
- **Offline.** No payroll screen works offline; a press made while offline shows its failure and sends nothing.
- **An empty month.** A month with nobody paid computes to zero payslips and Submit refuses ("No one to pay").

---

## 12 · Donor code

The donors are `C:\pixie-girl-hub` and `C:\praxis-ls`; neither is in the cloud container. Ported code never
says where it came from (`scripts/check/provenance.js`): no project names, paths or "ported from" in code,
comments, tests or config.

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/hr_payroll/payroll.calc.js` (235) | The shape of `computeStatutory`: pure, no I/O, `progressiveTax` over ordered bands, pension and NHF reducing the PAYE base, relief as flat and percentage, kobo at the edges. Money through `shared/money`, not floats; every rate read from `statutory_rate`, none in the code; ITF and NSITF added as employer items |
| pixie | `src/shared/hr_payroll/payroll.service.js`, `payroll.repo.js` (2,265) | The run lifecycle as a pattern only. Our states, our approval engine, no GL, our pagination (`pageQuery`), our one write path |
| pixie | `src/shared/hr_payroll/config.repos.js` (150) | `payroll_deductions` (PAYE bands, pension, NHF, effective-dated) becomes `statutory_rate` read with `asOf`, written with `addVersion` |
| pixie | `src/shared/hr_payroll/payslip.pdf.js`, `payslip.breakdown.js` (718) | The payslip document and its breakdown, rebuilt on `documents.generate` and `templates/documents/payslip.html`; NHF is a line in advanced mode only |
| pixie | `src/shared/hr_payroll/payroll.postings.js` (107) | **Not ported**: MyCity has no ledger here (`posting-map` entries are not used) |
| pixie | `src/shared/hr_payroll/rewards.*` (700+) | **Not ported**: bonus automation was not asked for |
| pixie | `src/shared/hr_payroll/lateness.calc.js`, `hr_ops.service.js` | Already used by attendance and queries; payroll consumes their pay items and fines |
| praxis-ls | `src/modules/hr/payroll/payroll.rules.js` (159) | **Cameroon: every rate is wrong.** Only its shape is kept (defaults a run's snapshot overrides, effective-dated rates, payslips computed estimates until locked) |
| praxis-ls | `salary_advance` (229) | Not ported: Operations & People record advances (§13.1); it may inform the instalment shape |
| praxis-ls | `src/modules/notification/`, `shared/notifications/`, `shared/push/` | Already built in M0; payroll only declares its notices |

---

## 13 · Open questions

### 13.1 Settled (the 4 November meeting and JBS Praxis's answers of 08/11/2026)

Binding; never re-opened. Timestamps are the meeting's transcript.

1. **Four Payroll tabs:** Payroll Runs, Payslips, Deductions, Configurations. Salary Structure and Statutory fold into
   Configurations (4 Nov, 00:37:48 to 00:40:03).
2. **Simple remuneration by default.** No PAYE, National Housing Fund, pension, Industrial Training Fund or NSITF
   deduction, and no screen mentions them in simple mode (4 Nov, 00:35:30; 12 Oct, 00:38:05).
3. **A run is made by picking the month**; previous runs are listed; a run awaits approval (4 Nov, 00:35:30).
4. **Payslips** are designed PDFs that open in a modal, each with a Download PDF button; the screen also has Email All
   (everyone is emailed their payslip) and Download All (4 Nov, 00:36:45).
5. **No salary grading.** Salaries are negotiated. The advanced option, behind a toggle on Configurations, brings the
   salary structure and statutory deductions (4 Nov, 00:37:48).
6. **Deductions come from consequence management** (a sanction's fine, a damaged laptop): they appear on the Deductions
   tab once approved, and a person with payroll rights accepts them for this month, spreads them over months or waives
   them; salary advances appear there too (4 Nov, 00:38:54).
7. **The run is approved by the CEO** (JBS Praxis, 08/11/2026; the 10 Oct meeting, 01:11:42, and MILESTONES §11 said
   the CEO or the COO). The seeded stage is the CEO only; MyCity can add a stage or a role (a COO, Operations & People)
   on Settings · Approvals without code.
8. **Statutory is built and shipped off** (JBS Praxis, 08/11/2026): the engine, the report and the rate tables exist
   behind the toggle, off by default; rates are entered only once MyCity's accountant confirms them.
9. **Advances are recorded by Operations & People** on the Deductions tab with their repayment months; there is no
   employee request flow (JBS Praxis, 08/11/2026).
10. **Who builds the screens** was left open on 08/11/2026 and answered on 09/11/2026: LA builds them (item 22).
11. **A payslip sample goes to MyCity for sign-off before PR 4** (4 Nov, TB's action item); item 20 records that JBS Praxis
    drafted it.
12. **Two release gates** apply to every module: the Playwright User Guide pictures and the AI-form gate (4 Nov,
    00:31:50); both are in Appendix B's release items.
13. **A document keeps the approval flow in force when it was created** (4 Nov, 00:10:50): a run keeps the `payroll.run`
    version it opened with (§6.9 rule 5).
14. **Simple payroll applies to staff treated as contractors and consultants**, who handle their own tax and pension
    (12 Oct, 00:38:05).
15. **The seeded approval is the CEO alone** (JBS Praxis, 08/11/2026): see item 7.
16. **A leaver's final run takes every outstanding instalment, and a negative net blocks Submit** (JBS Praxis,
    08/11/2026): nothing is deducted silently and nothing is dropped silently; Operations & People spread a
    deduction, add an adjustment or exclude the person (§6.6 rule 9, §6.7 rule 3).
17. **Simple mode has no recurring allowances** (JBS Praxis, 08/11/2026): one Monthly Pay line plus one-off adjustments;
    recurring splits (basic, housing, transport) exist only in advanced mode. The 10 October "predefined employee
    advantages" are not built in simple mode.
18. **Both payslips open in a modal at every desktop width** (JBS Praxis, 08/11/2026): Payroll · Payslips and ESS · My
    Payslips, a centred dialog on desktop and a bottom sheet on a phone. PR 7 amends F31 for both (§10.3).
19. **Staging demos and the staging seed use test people only** (JBS Praxis, 08/11/2026): staging sends real mail (A4,
    no sink and no flag), so Email All is never pressed on staging against real staff; the staging seed sends no mail.
20. **The payslip sample is drafted** (JBS Praxis, 08/11/2026) at `docs/MyCity-ERP-Documents/payroll-samples/payslip-sample.html`
    for MyCity's sign-off; PR 4 turns the approved version into `templates/documents/payslip.html`.

21. **The statutory rates, the accountant's conventions, the pay day and every person's salary and bank details are
    configuration that MyCity enters in the app** (JBS Praxis, 09/11/2026), so none is an open question and none
    blocks the build. Configurations carries the options: Pay Day, Bank Details Required, and in advanced mode the
    rates and bands, the three conventions (PAYE basis, pension reduces taxable pay, NHF reduces taxable pay) and the
    pay components (§6.11 rule 3a, §6.12 rule 1). Salary and bank details are entered on People · Employees or the staff
    import. Nothing is seeded (A26).
22. **LA builds the screens** (JBS Praxis, 09/11/2026): Payroll Runs, Payslips, Deductions, Configurations and ESS · My
    Payslips (PR 7), in the frontend lane; TB owns the milestone and the backend. AJ, the ESS guide's owner, reviews the
    ESS change.
23. **Written is ticked once the pull request merges** (JBS Praxis, 09/11/2026): the first chat after the merge ticks
    Written in `docs/guides/README.md`; nothing ticks it before.
24. **The pay day defaults to the 30th and is configurable from 1 to 31, with a month-end rule** (JBS Praxis,
    09/11/2026): a pay day past a month's last day falls on that last day (§6.11 rule 1). The default is a constant in
    code, shown on Configurations as "30 (default)", not a seeded row (A26). The ESS guide's "normally the 27th" is
    superseded.
25. **The first statutory rates are entered before the option is switched on** (JBS Praxis, 09/11/2026): Configurations
    shows Statutory Items and PAYE Bands while the option is off, `GET /statutory/rates` and `POST /statutory/rates` work
    whatever its state, and Switch On then passes `NO_RATES`. The gate is on computing statutory lines, not on entering
    the rates. The conventions are set in the Switch On request; Salary Structure and Pay Components stay behind "on or
    has been" (§6.11 rule 4).
26. **`leave_type.unpaid` is seed-only for now** (JBS Praxis, 09/11/2026): payroll reads the flag from the seeded Unpaid
    type; a switch on People · Leave's type form is a separate small change to M1 leave, taken when MyCity asks for a
    second unpaid type.
27. **My Payslips (#11) keeps its Owner, AJ** (JBS Praxis, 09/11/2026): LA builds the screen in PR 7 under AJ's review
    (item 22); the Owner column of the other Payroll rows is LA's.
28. **My Payslips' In the run means approved, not yet paid** (JBS Praxis, 11/11/2026, answering §13.3's question 2 for
    PR 7): the API keeps listing published payslips only (§5, §6.10 rule 3 unchanged), so a month still with the CEO has
    no row; a published payslip whose run is `approved` and not `paid` reads In the run, its help "Approved. The pay is
    not yet transferred." No contract or backend change.

**The Milestones Review of 11 November 2026** (TB with LA, GE and AJ; transcript timestamps):

29. **The pay day is one exact day for every month** (00:46:46 to 00:48:46). Set once from a date, it applies to every
    month after; a month shorter than the day pays on its last day; a person who wants the month's end picks Last Day of
    Month. It is never set for one month. Operations & People set it (`payroll.configure`). JBS Praxis confirmed the
    February case after the meeting: `payroll.config.repo.payDateOf` and its test (`src/modules/payslips/payslips.test.js`,
    "the pay date") give 28 February 2026, 29 February 2028 and 30 April for 31.
30. **Every statutory deduction, pension included, is monthly** (00:50:20): "the deduction for everything is monthly".
    No setting offers an annual deduction (§6.12 rule 11).
31. **Every statutory rate carries a verifiable legal source** (00:51:24 to 00:53:33): "once you put a rate there, you put
    the source of the document that gave the rate". A figure with no source says clearly that it has none, a principle
    rather than a law (§4.2, §6.12 rule 12, §6.16).
32. **Statutory figures are never updated automatically** (00:53:33): the system has no direct feed and a system that
    researched and updated them itself would be exposed to hallucination; people enter each change (§6.12 rule 13).
33. **A saved band or change can be removed** (00:54:43, "you delete your edit"): a version not yet in force has Remove
    Change; one in force is replaced by a new version from a date, so a paid run keeps its figures (§5).
34. **Statutory means researched and confirmed** (00:54:43): "if we say we are building something statutory, it should be
    something statutory". The rates, the conventions and the relief are researched from the primary texts with sources
    (PR 9) before any is entered; the build is reworked to the research (PR 11).
35. **Bank Details Required** blocks Submit when on and lets a run go without bank details when off (00:48:46): as built
    (§6.1 rule 4, §6.15), unchanged.
36. **Deductions as demonstrated stand** (00:43:35 to 00:46:46): accept this month, spread over months, waive, release
    with a reason, record and cancel an advance, the four figures. Unchanged.
37. **How the remaining PRs are planned** (00:55:50 to 01:01:02): planned in one chat on the most capable model at high
    effort, each PR then built in a fresh chat from its own prompt with its effort named, parallel PRs and their merge
    order stated (Appendix A, "How the rest is planned"; CLAUDE.md, Working conventions).

**PR 9, the statutory research register (11/11/2026):**

38. [ ] **Statutory register confirmed by MyCity's accountant**: pending. TB obtains it: the accountant reads §6.16 (each
    figure, its section, what stays Unverified) and the answers of §13.3 items 2 to 4, and says which stand; this line then
    carries the date and who confirmed. Until then no statutory figure is entered on Configurations.

### 13.2 Decided in writing this guide (change here if wrong)

Each is TB's to change with a line in §14; each is the smallest reading that makes the settled items work.

1. **One run per month, ever.** Discard deletes a Draft or Computed run (nothing was frozen); there is no cancelled state.
2. **Five statuses:** `draft`, `computed`, `submitted`, `approved`, `paid`. The demo's Previewed is Computed and its
   Locked is Approved.
3. **Compute is inline** in the request; the `payroll-compute` and `payslip-render` job stubs are deleted at the end
   (PR 2 measured 550 ms for 308 people, 09/11/2026, so there is no job).
4. **Submit recomputes and freezes** pay items and instalments (narrowing attendance's T4 from "until locked");
   Send Back and Reject release them; `RUN_CHANGED` guards the totals the submitter saw.
5. **Attendance deductions flow into the run automatically** unless People waive them; only fines are accepted,
   spread or waived on Deductions; attendance items are listed there but acted on in People · Attendance.
6. **"Managers accept" means `payroll` edit holders** (Operations & People, the Implementation Team and anyone Settings
   grants), not line managers.
7. **Unpaid leave and unpaid suspension are deducted by payroll** at the daily rate (nothing deducts them today);
   `leave_type.unpaid` is a column, seeded true for Unpaid.
8. **Joiners and leavers are prorated by working days; a leaver's outstanding instalments** are taken in their final run
   (settled 08/11/2026, §13.1 item 16).
9. **One-off adjustments are in scope** (bonuses, corrections after lock); recurring allowances are not, in simple mode
   (settled 08/11/2026, §13.1 item 17).
10. **Download All is one multi-page PDF; Email All sends one mail per person** to the work email with the PDF
    attached and no amount in the body; a repeat sends only to those not yet emailed unless Email Again is chosen.
11. **Payslips publish at approval.** Paid is bookkeeping (a date, an optional reference) and does not gate visibility.
12. **Capability `payroll.configure`** guards the advanced switch, the pay day, rates, grades, placements and pay
    components; Operations & People, the Implementation Team and the CEO hold it by default.
13. **Never your own**: nobody accepts, waives, releases or records a deduction or advance for themselves.
14. **The advanced mode is decided by the run's period**, switching on needs a rate in force (`NO_RATES`) and the three
    conventions set (`NO_CONVENTIONS`), and PR 5 adds the
    employee tax and pension number columns the statutory mask already names, written through the organisation service.
15. **The payslip opens in a modal at every width** on Payroll · Payslips and ESS · My Payslips (settled 08/11/2026,
    §13.1 item 18; F31 amended in PR 7).
16. **A payslip's PDF is a restricted file**: its owner and `payroll` edit holders open it; Management does not.
17. **No AI job of M6's own**; its cards are risk `payroll` and run on the assistant engine's job.
18. **Wire names follow the salary mask** (`gross_pay`, `total_deductions`, `net_pay`, `pay_amount`) and `employer_cost` is
    added to the mask's list.
19. **A line has no negative amount; kind gives the direction;** totals are sums of stored lines.
20. **`sanctions.fines.release`** is added (accepted back to pending before any instalment is in a run), GE reviewing.
21. **Simple mode prints one Monthly Pay line;** the split into basic, housing and transport exists only in advanced mode.
22. **The configuration options are one toggle (Bank Details Required) and three conventions** (§13.1 item 21), chosen from
    the donor's shape and the ways a Nigerian accountant can read PAYE; TB may add, rename or drop one with a line in §14.
    **Amended 11/11/2026 (§13.1 items 30 and 34):** PAYE Basis leaves the screen (it read as a choice of when to deduct),
    and the other two stay only if PR 9 finds the law leaves them to the employer. PR 9 (11/11/2026) found that it does
    not: both are eligible deductions under the Nigeria Tax Act 2025, s.30(2)(a), so PR 11 fixes them (§6.12 rule 14).
23. **The pay day is a plain calendar date**: it is never moved for a Sunday or a public holiday (the CEO transfers by
    hand, 4 Nov), and the month-end rule is the only adjustment (§6.11 rule 1).
24. **The statutory bases and PAYE's shape, as PR 5 built them** (§6.12 rules 8 and 9): gross is the month's earnings
    (Monthly Pay or the split, overtime, earning adjustments) and the post-tax deductions reduce no base; ITF and NSITF
    are the month's gross at their rate; the relief's flat amount is read as annual or monthly by the PAYE basis, as the
    bands are. The accountant may read any of these differently: it is a small code change reviewed with them (§6.12
    rule 7), recorded here.
25. **A pay split is used only while it adds up to the gross** (§6.11 rule 6): it must on saving, and a run treats one the
    gross has moved away from as no split (No Pay Split), rather than scale it silently.
26. **A configuration change for a day that already has a version joins it**, and a version starting later must change
    first (`shared/db/effective-dated` `replace`): the screen's switches save from today, so a second press the same day
    is one version, never a refusal. The past is never rewritten: every change starts today or later.
27. **The statutory report is of an approved or paid run** (the `published` guard): its figures are locked before they
    are reported.
28. **The advanced switch, the pay day and the bank rule are not a card** (PR 6): `PayrollSettingsChange` is one version of the
    setting, saved from a date with the statutory rates in force and the accountant's three conventions in view, so Praxis AI
    opens Configurations (the route "turn on advanced payroll") and the person saves it there, as it does a role's grants
    (praxis-ai.md decision 35). It is not a create or edit form by name, so gate 23 asks for no reason for it.
29. **A card names the record it acts on** (PR 6): the screen's button on a run or a fine never names it, so Submit, Add
    Adjustment, Accept and Waive take a card schema, the form's own fields with the record beside them (`PayrollRunSubmission`,
    `PayrollRunAdjust`, `FineAccept`, `FineWaive`), as praxis-ai.md §6.11 asks of an edit form's card. The screens' own request
    schemas are unchanged.
30. **A person's own pay is never masked from them in the assistant** (PR 6, §9): `payslips.mine` and `deductions.mine` carry the
    amounts under names the salary mask does not govern, because the engine masks every row it reads and the Employee role
    hides salaries by default. `payroll.month`, a summary, leaves the amounts out for a reader whose role hides pay.
31. **A person's own payslip is found in ⌘K through its own type** (PR 6): `payroll_own_payslip` (module `ess`, owner-pinned,
    published only), beside `payslip` for Payroll readers, as My Temporary Sites sits beside Temporary Sites; the assistant cites an
    own payslip and an own instalment with it and `payroll_own_deduction` so the link opens My Payslips.

### 13.3 Still open

| # | Question | Decides | Needed before | Meanwhile |
|---|---|---|---|---|
| 1 | Sign-off of the payslip sample (§13.1 item 20) | TB shows Cynthia | PR 4 | The sample is the draft in `docs/MyCity-ERP-Documents/payroll-samples/`; PR 4 built `templates/documents/payslip.html` from it as drafted (the letterhead supplies the logo, the organisation's line and the date; the number, the month and the person's block are in the body) and it is changed when MyCity answers |
| 2 | Does the Nigeria Tax Act 2025 leave payroll any relief to apply, and in what shape (§6.12 rule 15)? | PR 9's research, MyCity's accountant | PR 11 | **Answered (PR 9), for the accountant to confirm:** the Consolidated Relief Allowance has no source from 1 January 2026 (the Personal Income Tax Act is repealed, NTA s.196(g)); the one relief is rent relief, 20% of the year's rent paid, at most ₦500,000 (s.30(2)(a)(vi)), and the employer gives it in PAYE on the person's information and evidence (the Joint Revenue Board's Guidelines 2026, paras 7.4 and 9). No relief is entered before the register is confirmed; the item stays as built until PR 11 |
| 3 | The ITF threshold and base, and whether NHF is mandatory for MyCity's private-sector staff (§6.16) | PR 9's research, MyCity's accountant | PR 11 | **Answered (PR 9), for the accountant to confirm:** ITF is 1% of annual payroll (basic pay, allowances and other entitlements) for an employer with 25 or more employees not operating within a free trade zone (ITF Act s.6(1) as substituted by the Business Facilitation Act 2022, s.41; s.16 as inserted in 2011), due by 1 April of the next year; the 5-employee or ₦50 million test of 2011 no longer applies. NHF is voluntary for private-sector employees: such an employee "may contribute" 2.5% of monthly income (NHF Act s.4(1)(b) as substituted by the 2022 Act, s.45). The NHF base is the month's gross pay: the 2023 s.4 says "monthly income" and FMBN states the contribution as "2.5% of the monthly gross salary"; s.26's "basic monthly salaries" is the original Act's word. Neither is entered |
| 4 | Do pension and NHF apply to staff treated as contractors and consultants (§13.1 item 14)? | PR 9's research, MyCity's accountant | Switching the option on | **Open.** NHF through payroll is an employee's choice (NHF Act s.4(1)); a self-employed person contributes on their own (s.4(2)), not through MyCity's payroll. Pension reaches an "employee", "any person employed in" a private company, organisation or firm (Pension Reform Act 2014, s.120), of an organisation of three or more employees, as PenCom applies the Act (s.120; s.2(2) says 15), and a self-employed person may join voluntarily (s.2(3)). The ITF and Employee's Compensation Acts reach an "employee" (ITF Act s.16; ECA s.73, a contract of employment, oral or written), so whether MyCity's contractors and consultants are employees under them turns on their contracts, for MyCity's accountant and lawyer. PAYE is the tax on an employee's emoluments (Administration Act s.51(6)); a payment to a person who is not an employee falls under deduction at source (s.51(1)): 5% of a resident's consultancy or professional fees, twice that without a Tax Identification Number (Deduction of Tax at Source (Withholding) Regulations 2024, First Schedule and reg 3(c), kept in force by NTA s.199(b)), which MyCity deducts as a body corporate unless it is a small company within reg 4(2); the Joint Revenue Board's Guidelines 2026 name "contractors, consultants" among the non-employees this covers (para 14.1), while a temporary employee's pay is taxed through PAYE (para 13.1). Simple mode pays such a person through payroll with nothing deducted: the accountant is asked whether that stands. The option stays off |

Items 2 to 4 carry PR 9's answers with their citations (§6.16); each closes, and moves to §13.1, once MyCity's accountant
has confirmed the register (§13.1 item 38).

Answered and moved to §13.1: the approver (item 7), a leaver's instalments and a negative net (16), recurring
allowances (17), the ESS modal (18), staging mail (19), the statutory rates, the accountant's conventions, the pay day
and every person's salary and bank details as configuration (21), who builds the screens (22), when Written is
ticked (23), where the first statutory rates are entered (25), the unpaid flag on leave types (26), #11's Owner (27) and
what My Payslips' In the run means (28).

---

## Appendix A · The build plan

### How the rest is planned (TB, 11/11/2026, §13.1 item 37)

PR 0 to PR 7 are merged. The work left after the 11 November review is PR 8 to PR 12 below. It was planned in one
planning chat; each PR is built in a **fresh chat** from its start prompt (below), on the model and effort its line
names, and the planning chat is asked for the next prompt when one merges (CLAUDE.md, Working conventions). No PR's
prompt or plan names a model by its product name in the repository; "most capable, high" means the most capable model
the team has, at high effort.

| PR | Scope | Lane, owner | Size | Model and effort | Needs merged first | Runs in parallel with |
|---|---|---|---|---|---|---|
| 9 | The statutory research register (docs only, network on) | LA, TB reviews, MyCity's accountant confirms | M | Most capable, high | nothing | 10, 12 |
| 10 | Legal sources on every version, Remove Change, monthly wording, Last Day of Month | Full stack, LA (screens) and TB (backend) | M | Most capable, high | nothing | 9, 12 |
| 12 | Notification email links open the reader's own screen | Backend, GE (notifications) | S | Standard model, high | nothing | 9, 10 |
| 11 | The statutory engine reworked to the research (PAYE on the year to date, the relief, the conventions fixed, NHF by choice, the minimum-wage exemption, ITF and NSITF as cited, the tax numbers on People · Employees) | Full stack, TB | L (grown from M by PR 9's findings) | Most capable, high | 9 and 10 | 8's seed only |
| 8 | Staging seed, User Guide chapters with pictures, stubs, release check | Docs and seed, LA with TB | M | Standard model, high | 10, 11 and 12 for the pictures | 11 (seed only) |

**Merge order:** PR 10 before PR 11 (both change `Configurations.tsx`, `statutory.js` and the statutory service), PR 9
before PR 11 (PR 11 builds what PR 9 records), PR 12 any time, PR 8 last so its pictures show the final screens. PR 8's
staging seed may be written beside PR 11, but it merges after it.

Every PR follows CLAUDE.md steps 1 to 5: the type stated, the reading done, contract first, the rules never
broken, `npm run ci` green, `docs/PROGRESS.md` ticked with a dated note, this guide and `README.MD` matching,
the handoff ticked. A PR opens as a draft and is marked ready when CI is green locally (BACKEND_GUIDE §8.4).
Branches are `m6/<short-name>`; PR titles are Conventional Commits.

**Start prompt for any PR** (paste into a new chat opened on this repository, naming the PR):

> This is a (full-stack | backend | frontend | docs) change to M6 Payroll, PR <n> of
> `docs/guides/payroll.md` Appendix A. Read `docs/guides/payroll.md` in full (it is the single source of truth),
> then `docs/handoff/m6-payroll.md` for where the work stands, then what CLAUDE.md step 2 asks for this task
> type. Build only that PR. If the guide is wrong or silent, change the guide first in the same PR. Never
> re-open §13.1. Finish as CLAUDE.md step 5 says, tick the handoff and add a log line.

**Order and lanes.** PR 0, then PR 1. After PR 1 the backend lane (TB) runs PR 2, then PR 3, PR 4 and PR 5 (any
order, any of them in parallel with the others), then PR 6. The frontend lane's PR 7 is LA's (§13.1 item 22) and
starts once PR 1 has frozen the contract, building on the in-browser mock in contract shapes; it finishes on the
real API as PR 2 to PR 5 merge. LA also owns M7 (30 Nov to 4 Dec, MILESTONES §4), so PR 7's skeleton starts the day
PR 1 merges. PR 8 is last. **Proposed calendar** (the milestone's window is 23 to 27 Nov, demo Fri 27 Nov,
MILESTONES §4): 9 to 13 Nov PR 0 and PR 1, contract frozen by Friday 13 Nov; 16 to 20 Nov PR 2 to PR 4 and
the screens' skeleton; 23 to 27 Nov PR 5 to PR 8 and the demo.

### PR 0 · This guide (`m6/guide`) · documentation only

- This guide; `docs/handoff/m6-payroll.md`; MILESTONES §11's amendment of 08/11/2026; the ESS guide's payroll
  lines (§6, §10, §13) and a pointer in the attendance guide's §6.17; the guides index row; the guide's CODEOWNERS
  line; DATABASE_SCHEMA M6's pointer; a PROGRESS note; the payslip sample for MyCity's sign-off
  (`docs/MyCity-ERP-Documents/payroll-samples/payslip-sample.html` with its README, listed in
  `docs/MyCity-ERP-Documents/INDEX.md`).
- Not in PR 0 (they change code the gates read): the PROGRESS rows, MILESTONES §18's table and the shell's tabs
  (PR 1).
- Done when: `node scripts/check/guides.js`, `progress.js`, `readme-map.js` and `user-guide.js` pass and the pull
  request merges; the first chat after the merge ticks Written in `docs/guides/README.md` (§13.1 item 23).

### PR 1 · Contract, data and scaffolding (`m6/contract-data`)

- **Contract first:** `packages/contract/schemas/payroll.js`, `payslips.js`, `deductions.js` for the simple mode
  (Appendix C), each with its `TABLES`; `npm run gen:contract`.
- **Migrations:** `6000_payroll.sql`, `6010_payroll_deductions.sql` (with the foreign key from
  `attendance_pay_item.payroll_run_id`), `6030_leave_unpaid.sql`; `seeds/reference/6099_seed_payroll.sql` (the
  `payroll.run` definition, `payroll.configure`, the Unpaid flag); each with `-- UP` and `-- DOWN`, idempotent,
  its `updated_at` triggers and FK indexes.
- **Shared wiring:** the definition in `DEFAULTS` of `src/shared/workflow/definitions.js` (validated); the capability
  in `src/shared/access/access.catalog.js`; `employer_cost` in `src/shared/rbac/field-mask.js`; the labels
  (`src/modules/settings/settings.service.js` already names `payroll_run` and `payslip` in `DOC_LABELS`, so it needs no change); the route map, ⌘K screens, Coming Soon and catalogue for the four tabs
  (`src/shared/route-map.js`, `src/shared/search/screens.js`, `app/src/shell/coming-soon.ts`,
  `app/src/shell/catalogue.ts`, `app/src/api/mock/modules/identity.ts`, `app/src/lib/trail.test.tsx`,
  `tests/unit/foundation/delivery-plan.test.js`); PROGRESS rows #47 and #49 Dropped and Configurations added in the next free row (#109 while free),
  the Payroll screens' Owner set to LA (#45, #46, #48 and Configurations; #11 keeps AJ, §13.1 item 27), `SCREENS` in
  `scripts/check/progress.js` and the summary counts; MILESTONES §18's Payroll row. `payroll_setting` is created in
  `6000` with its option columns (Pay Day, Bank Details Required, the three conventions); the conventions are
  accepted by the route only in PR 5.
- **Tests and docs:** an integration test that the migrations apply (UP, DOWN, UP) and the seed validates; the
  affected tests that hard-code capabilities or numbering totals (`tests/integration/settings.test.js`,
  `home-schema.test.js`); DATABASE_SCHEMA M6 as built; README §5.9.
- Done when: gates 3 to 6 and the whole suite are green with the real migrations; the contract is frozen.

### PR 2 · Calculation and the run (`m6/run`)

- `payroll.calc.js` (pure: earnings, prorating, the daily-rate amounts, instalment allocation, net), `payroll.inputs.js`
  (reads attendance, sanctions, leave and the employees through the owners' functions), `payroll.run.js` (create,
  compute, exclude, adjustments, submit, discard, mark paid), `payroll.lock.js` (`assertEditable`),
  `payroll.config.repo.js` (the setting, as of a date), the repo, service, controller, routes (`/payroll/runs…`),
  `payroll.events.js` (events, the `payroll.apply_decision` completion handler, the notifications), the Home
  source (`payroll.source.js`: runs not paid, in the reader's scope; its `OWES` cleared; the card made live).
- **In other modules, with the owner's review:** `attendance.pay.takeIntoRun`, `releaseFromRun`, `monthRates` with
  `monthContext` and `pricesOf` (LA); `sanctions.fines.release` (GE).
- **What the gates add to PR 2** (§9): `payroll.ai.js` with the one card `payroll_runs.create`, `payroll.search.js` for
  `payroll_run`, the route map's note on `payroll_run` removed, `npm run gen:ai-catalogue`. The `payroll-compute` job is not built:
  Compute was measured at 550 ms for 308 people (§13.2 item 3).
- **Tests:** the worked example of §6.14 to the kobo; compute twice is identical; the totals equal the sums of
  the lines for generated runs; every write function hits `assertEditable`; Submit freezes and Send Back releases;
  `RUN_CHANGED`; concurrency (two computes, two submits); eligibility, proration, unpaid leave and suspension
  (with a double-counting case); a measurement of Compute for 300 people (decision 3 of §13.2); an end-to-end
  integration test on the real migrations: attendance items and a fine in, an approved run out.
- Done when: a run computes from attendance, deductions and approved consequences, locks on approval and
  publishes payslips (without their PDFs yet). Built 09/11/2026 (`m6/run`).

### PR 3 · Deductions and advances (`m6/deductions`)

- `deductions.repo.js` (the paged union), `deductions.service.js`, `deductions.acceptance.js` (accept, spread, waive,
  release, record and cancel an advance; instalments by `allocate`), routes, events, notices, the
  `sanction.issued` handler for "Fine Waiting for Payroll".
- Tests: the instalment sums and kobo; accept, spread, waive and release against `sanctions.fines`; an advance
  end to end through two runs and its settlement; `OWN_RECORD`; `INSTALMENTS_STARTED`; the union's paging and
  filters.
- Done when: the Deductions screen's every action works on the real API.
- **Built 09/11/2026 (`m6/deductions`), screen included.** JBS Praxis asked for the Deductions screen in this pull request,
  on desktop and phone (09/11/2026), so `app/src/features/payroll/Deductions.tsx` is built here on the contract (`GET /deductions`,
  the figures with their pop-ups, Accept This Month, Spread Over Months, Waive, Release, Record Advance, Cancel Advance, the
  phone's sheet) with its mock in the contract's shapes, and PR 7 builds Payroll Runs, Payslips, Configurations and My Payslips
  around it (§13.1 item 22 is unchanged: LA builds those). The contract gained `salary_set` on a row, `open_period` on the
  summary and `FineParams`; `payroll.lock` gained `openPeriod`, `lockRunsOf` and `lockMonths`, which a write takes before its
  own rows. A month field is not added to `packages/ui` for this screen: the start month is a select of the months from
  `open_period`, so PR 7's `MonthField` is not needed here.

### PR 4 · Payslips, the PDF, email and ESS (`m6/payslips`)

- `payslips.repo.js`, `payslips.service.js`, `payslips.breakdown.js`, `payslips.pdf.js` (the doc types, variables and
  `generate` calls), routes, the ESS routes in `src/modules/ess/`, `templates/documents/payslip.html` (from TB's
  signed-off sample), `payslip-batch.html`, `templates/email/payslip-ready.html`, the `payroll.email_payslips`
  handler, the export reservation.
- Tests: a payslip's lines equal the run's; the PDF renders and is restricted; Email All sends once per person and
  repeats only with `resend`; an ESS reader never opens another's; masks; the batch PDF has a page each.
- Done when: an approved run publishes payslips, each person opens theirs, Email All and Download All work. Built
  09/11/2026 (`m6/payslips`): the PDFs are requested in the lock's transaction (306 in under a second, so no render
  job of ours); the screens are PR 7's.

### PR 5 · Configurations and the advanced option (`m6/advanced`)

- `6020_payroll_advanced.sql`, the advanced contracts, `salary_structure` and `statutory` modules (`statutory.rates.js`,
  `statutory.report.js`), the `computeStatutory` function taking the three conventions as inputs and its integration
  into Compute, the settings route with `payroll.configure` (the conventions, `NO_RATES`, `NO_CONVENTIONS`), `templates/documents/statutory-report.html`, the employee tax and pension columns through the
  organisation service, the pay components.
- Tests on labelled test rates (never seeded): each item, the PAYE bands, relief, effective-dating (a past month
  uses its rates), `NO_RATES`, `NO_CONVENTIONS`, `ADVANCED_OFF`, both `paye_basis` values, the toggle by period, employer lines out of the net, the report.
- Done when: switching the option on computes the statutory lines and the report against rates entered on
  Configurations; off by default; no rate in any seed.
- **Built 10/11/2026 (`m6/advanced`), Configurations screen included.** JBS Praxis asked for the screens on desktop and
  phone in this pull request (10/11/2026), so `app/src/features/payroll/Configurations.tsx` is built here on the contract,
  as PR 3 built Deductions, with its mock in the contract's shapes; §13.1 item 22 is unchanged (LA builds the other screens
  in PR 7). The contract gained `GET /statutory/items` (`StatutoryItems`, the seven items in brief, so an unset one reads
  Not Set), `PayComponentSet`, `PayComponentVersion`, `PayComponentInput`, `SalaryStructureParams` and `BandPosition`;
  `shared/db/effective-dated` gained `replace` and `addVersionSet`; `payslip_line.base_amount` keeps a statutory line's base
  for the report. The employee's tax and pension numbers are written through `PATCH /employees/:id` and read on the 360;
  People · Employees' form does not ask for them yet (a People change, PR 7 or later), so the report prints Not Set until
  they are entered. The INTERIM `app/src/api/types/payroll.ts` is retired (its last routes were the prototype's grades and
  statutory). No rate, band, relief or grade is in any seed; the tests carry labelled test rates.

### PR 6 · AI, search, Home and notices (`m6/ai-search`)

- `payroll.ai.js` (its reads, summary and the cards after `payroll_runs.create`, which PR 2 carried), `payslips.ai.js`,
  `deductions.ai.js` (the reads, summary, cards and routes of §9); `payslips.search.js`, `deductions.search.js`
  (`payroll.search.js` came with PR 2); the remaining route-map notes removed; the screens' ⌘K entries;
  `npm run gen:ai-catalogue`; the integration test and evaluation case per action key.
- Verify the definition of done's notices: a submitted run produces in-app, push and email for the approver, and
  each link opens the same screen, with a test.
- Done when: gates 9, 10, 19 and 23 pass with payroll's controller filled; no M6 form on `ai-forms-gaps.json`.
- **Built 10/11/2026 (`m6/ai-search`), no screen.** The request that opened this pull request asked for the screens on desktop and
  phone; Appendix A's PR 6 has none and PR 7 is LA's (§13.1 item 22), so the guide was followed, as PR 2 and PR 4 did. The
  cards, the reads, the summary and the search results link to screens that exist (Payroll Runs, Payslips, Deductions,
  Configurations, My Payslips); the New Run action and the route "run payroll" open Payroll Runs on `action=new`, which the
  rebuilt screen answers in PR 7. §9 says what was built; §13.2 items 28 to 31 what was decided.

### PR 7 · Frontend (`m6/screens`) · LA

- Rebuild `app/src/features/payroll/` as `index.tsx` (a `switch`), `PayRuns.tsx`, `PaySlips.tsx`, `Deductions.tsx`,
  `Configurations.tsx`, `parts.tsx`, `Payroll.test.tsx`; ESS · My Payslips on the contract and the same parts
  (`app/src/features/ess/Payslips.tsx`); the in-browser mock on contract shapes; retire `app/src/api/types/payroll.ts`
  (`npm run contract:status`); `MonthField` in `packages/ui` (header, test, gallery); F31's amendment recorded; every
  form through `useContractForm` with its schema; the PR body's Native app feel section.
- Gates: `npm run fe:typecheck`, `fe:lint`, `fe:test`, `fe:build`; the screen gates at 390 and 1440 px.
- Done when: every screen of §2 works on the real API on both shells and the PROGRESS UI and Mobile columns are ticked.
- **Built 11/11/2026 (`m6/screens`), no contract or backend change.** Every route the screens call was already built (PR 2
  to PR 6), and JBS Praxis answered §13.3's question 2 without one (§13.1 item 28). `features/payroll/index.tsx` is the
  switch over `PayRuns.tsx`, `PaySlips.tsx` and the `Deductions.tsx` and `Configurations.tsx` of PR 3 and PR 5;
  `parts.tsx` holds what Payroll Runs, Payslips and My Payslips share (the status words, Restricted, the payslip drawn from
  its lines or as its PDF); `ess/Payslips.tsx` is rebuilt on it. `MonthField` is in `packages/ui` (Forms) and `Chain`
  gained `stack`. The mock (`api/mock/modules/payroll.ts`, `payslips.ts`) now holds runs, problems, adjustments, exclusions,
  the CEO's decisions, publication and the ESS routes in the contract's shapes, with the API's refusals; Send Back reaches
  it through the expenses mock's `request-changes`, the one such route the mock has. `app/src/api/types/payroll.ts` was
  already retired in PR 5. Every form is `useContractForm` with the contract's schema (or that schema with the person
  picker checked beside it). The screens open a record their link names (`id`): a run, a payslip; My Payslips opens a
  linked payslip once it is the person's own and Salary Deductions for a deduction's or an instalment's link (the route
  map's `deduction` and `payroll_own_deduction` carry those ids). Checked on the real API (a local database with the mock's
  25 people, their pay set through the API, the worker rendering PDFs) on desktop and phone: New Run, Compute, Submit,
  the CEO's Approve, publication with the PDFs, Email All, My Payslips' PDF, Download PDF and Email a Copy. That check found
  two faults the mock could not show: a decision reaches the run after it commits, so Approve, Send Back and Reject now
  wait for it (§11); and the money fields of Add Adjustment, Record Advance (PR 3) and Configurations' rate, PAYE band,
  grade and pay split forms (PR 5) sent the amount as typed, which the contract's two-place amounts refuse ("50000" is
  "Enter an amount"), so each now sends it through `toMoneyString`. Deductions and Configurations were also checked on the
  real API (Record Advance, Set Pay Day). Tests: `features/payroll/Payroll.test.tsx` (10), `features/ess/Payslips.test.tsx`
  (5), `form/MonthField.test.tsx` (7) and `display/Chain.test.tsx` (5).

### PR 8 · Staging seed, User Guide and release check (`m6/release`) · last

- `seeds/staging/NN_payroll.js` through the services (a locked earlier run, a computed current one with a pending fine,
  an advance and a joiner; test people, no mail sent; following `seeds/staging/lib/home-staging-rows.js`);
  `docs/manual/payroll.md` with its pictures (`npm run guide:shots -- --chapter payroll`, then `--stale`) and a
  Payslips section in the ESS chapter; the empty stubs deleted and off `README.MD` (README §11.5); PROGRESS Status set.
- The ESS guide's stale payroll lines (the 27th, "Payroll approves", "Coming Soon until M6") and Download My Data's
  payslips (in or said to be out); the M6 training-video plan in `docs/runbooks/training-videos.md` once the screens are
  final.
- Done when: Appendix B is ticked end to end on staging.

### PR 9 · The statutory research register (`m6/statutory-research`) · documentation only

- Run in an environment whose network access is switched on for the research and off after it (CLAUDE.md, "Research
  has sources"). Read each primary text (the Nigeria Tax Act 2025, the Pension Reform Act 2014, the National Housing
  Fund Act, the Industrial Training Fund Act as amended, the Employee's Compensation Act 2010) and any regulation or
  circular that sets a rate; the agencies' own pages (the tax service, PenCom, FMBN, ITF, NSITF) for the current
  figures.
- Fill §6.16: each row's section, rate or band, base, threshold, effective date, link, the day checked and who checked
  it; settle §13.3 items 2 to 4 with citations or leave them open with what is missing; rewrite §6.12 rules 11, 14 and
  15 to what was found. Name, per row, the document MyCity uploads with the figure when it enters it on Configurations
  (§6.16's second table): the upload is made in the app, through PR 10's Source fields (`source_document_id`), since a
  documentation pull request cannot put a file in the vault.
- Done when: every row of §6.16 is cited, or marked Unverified with what is missing, or No Legal Source with the reason,
  and MyCity's accountant has confirmed it (§13.1 item 38, dated when it is).
- **Built 11/11/2026 (documentation only).** Read from the primary texts, each copy and day in §6.16's second table: the
  Nigeria Tax Act 2025 and the Nigeria Tax Administration Act 2025 as gazetted, each checked against the House's certified
  copy; the Business Facilitation (Miscellaneous Provisions) Act 2022, which replaced the NHF Act's s.4 and the ITF Act's
  s.6 from 8 February 2023; the Industrial Training Fund (Amendment) Act 2011; the Employee's Compensation Act 2010; and,
  in a second pass the same day, the Pension Reform Act 2014 (the assented text), the NHF Act's own text (a transcription),
  NSITF's statement of today's rate and the gazetted Deduction of Tax at Source (Withholding) Regulations 2024; and, in a
  third pass on 12/11/2026, the documents JBS Praxis downloaded and attached: the Joint Revenue Board's Personal Income Tax
  Guidelines 2026, the Operation of PAYE Regulations 2002 (in the Federal Inland Revenue Service's consolidated text),
  PenCom's own copy of the Pension Reform Act 2014 and the National Minimum Wage (Amendment) Bill 2024; and, in a fourth
  pass the same day, the agencies' own statements that settle the pension threshold (PenCom: three or more employees),
  the NHF base (FMBN: the month's gross pay) and the minimum wage's enactment (the wage commission's circulars: in force
  from 29 July 2024). Still not read: the relevant tax authority's tax tables (how the bands apply to part of a year), the
  pension Act's gazette and the 2024 minimum wage Act's own text. What the findings
  change: PAYE is a year's bands deducted cumulatively over the year to date, with refunds; the Consolidated Relief
  Allowance has no source and rent relief is given in PAYE on the person's evidence; the minimum wage is ₦70,000; pension and NHF
  reduce taxable pay by law; NHF is voluntary for MyCity's staff and on monthly income; ITF needs 25 or more employees;
  NSITF's 1% is the Act's rate for its first two years and NSITF's stated rate today; pension is at least 8% and 10% of
  monthly emoluments, never less than basic, housing and transport; PAYE is remitted by the 10th. PR 11's scope (below)
  and MILESTONES §11 follow. The accountant's
  confirmation is TB's to obtain (§13.1 item 38).

### PR 10 · Legal sources, Remove Change and monthly wording (`m6/statutory-sources`)

- Contract first: `statutory.js` (`StatutoryRatesSave` and `StatutoryRate` gain the source or `no_legal_source`, the
  version briefs carry it), `payroll.js` (`PayrollSettings` drops `paye_basis` from what the screen sets; the Remove
  Change params); `npm run gen:contract`, `npm run gen:ai-catalogue`.
- `migrations/6040_statutory_sources.sql` (§4.2's owed columns, `-- UP` and `-- DOWN`, idempotent); `statutory.repo`
  and `.service` (save with a source, `SOURCE_REQUIRED`; Remove Change of a version not yet in force,
  `VERSION_IN_FORCE`; `shared/db/effective-dated` gains the removal that reopens the version before, with a test);
  the same Remove Change on `/payroll/settings`; the statutory report prints each item's source.
- Configurations: the Source column and fields (a `FileField` through the upload engine for the document), No Legal
  Source with its reason, Remove Change on a waiting version, PAYE Basis off the Conventions form and the card, Set Pay
  Day's Last Day of Month, help words of §10.1; tests on the mock and the real API; the screen gates at 390 and 1440
  px.
- Done when: no statutory version can be saved without a source or No Legal Source; a waiting change can be removed; no
  screen offers an annual deduction.

### PR 11 · The statutory engine to the research (`m6/statutory-law`)

- **PAYE to the two tax Acts** (§6.16, §6.12 rules 11 and 14): the bands entered as a year's, exactly as the Fourth
  Schedule publishes them; each month's PAYE computed cumulatively over the calendar year (the corresponding cumulative
  tax on the cumulative taxable pay, less the PAYE already deducted in the year; Operation of PAYE Regulations 2002, regs 3
  and 4; the Joint Revenue Board's Guidelines 2026, para 7), so the year's deductions equal the year's tax (Administration
  Act s.51(7)); a fall in the cumulative tax refunded to the person (reg 4(2)), which needs a refund line, since a line's
  amount is never negative (§6.8 rule 3); a joiner's pay and tax to date from a previous employer's leaving certificate
  entered on the person for the year (reg 5); how the bands apply to part of a year, and how months before the option was
  on count, as MyCity's accountant confirms;
  `paye_basis` fixed to that reading (the column kept, no longer read from the setting); employee pension and NHF
  reducing chargeable income in code with their citation (NTA s.30(2)(a)(iii) and (i)); the Conventions card, the three
  conventions of Switch On and `NO_CONVENTIONS` removed unless the accountant names a point the law leaves open; no PAYE
  for a person whose gross from MyCity is the national minimum wage or less (NTA s.58 and s.163(1)(t)), the wage (₦70,000
  a month, the Board's figure) entered as a figure with its source, like a rate.
- **The relief** (§6.12 rule 15): the `relief` item's flat amount and percentage of gross removed (the Consolidated
  Relief Allowance has no source from 1 January 2026), and rent relief built as the Guidelines have it (paras 7.4 and
  9): a person's declared rent for the year (the rent paid and the period it covers, pro-rated to the year; the legal
  tenant's name; the landlord's full name with a mobile number, Tax ID or NIN; the property's address) with its evidence
  document, kept with the person on People · Employees; the 20% and the ₦500,000 as a version with their source; the
  year's relief taken through the cumulative reliefs of the year to date.
- **NHF by choice** (NHF Act s.4(1)(b) as substituted in 2023): a deduction only for a person who has chosen to
  contribute (a choice kept with the person's NHF number on People · Employees), at the rate entered, on the month's
  gross pay (the 2023 s.4's "monthly income", as FMBN states it), so `ITEM_BASES` gives NHF `gross` in place of `basic`,
  and only for a person earning the national minimum wage or more.
- **ITF and NSITF as cited:** ITF at 1% of the month's payroll (basic pay, allowances and other entitlements: the month's
  gross) and only while MyCity has 25 or more employees and is not in a free trade zone (ITF Act s.6(1)); TB decides
  whether the engine checks the run's headcount or the rate is entered only while MyCity is liable; the report states the
  1 April due date. NSITF at the month's payroll and the rate entered (1%, the Act's minimum and NSITF's stated rate,
  until the Board sets another for MyCity's industry). Pension: MyCity is within the Act from three employees (PenCom's
  reading); the base is the contract's emoluments and never less than
  basic, housing and transport (Pension Reform Act 2014, s.120), so a pay split marks at least those three pensionable (TB
  decides whether a split that does not is refused or warned) and No Pay Split's fallback, the whole Monthly Pay, meets
  it; the rates are the Act's minimums, 8% and 10% (s.4(1)), entered with their source. The statutory report states each
  item's remittance date: PAYE by the 10th of the next month, pension within 7 working days of pay day, NHF within one
  month, NSITF in the first two working days of the month, ITF by 1 April.
- The employee's tax and pension numbers on People · Employees' form (owed since PR 5), so the report prints them.
- This guide first: §4.2, §5, §6.11 rule 3a, §6.12 (the table and rules 1, 8 and 9), §6.15, §10 and §13.2 item 24
  changed to what PR 11 builds, with a Change log line.
- Tests rewritten on labelled test rates that follow the cited shapes (a year's bands read year to date, a joiner, a
  month with overtime, NHF by choice, the minimum-wage exemption, ITF under 25 people).
- Done when: every line the engine can produce traces to a row of §6.16; the option still ships off; no rate in any
  seed.

### PR 12 · Notification email links follow the reader (`m6/notification-links`) · GE

- `src/jobs/handlers/notification-deliver.js` builds the email link with the recipient's own screen as the bell and
  push do (`notifications.service.screenTo`, the route map's `self`), so "Your payslip is ready", "Deduction Scheduled"
  and "Fine Waived" open ESS · My Payslips for a person without `payroll`, not Payroll · Payslips. A test that the email
  link equals the bell's for an employee (`tests/integration/ai-actions-payroll.test.js` checks the bell only).
- `docs/guides/notifications.md` §3 and this guide's §7 say so.
- Done when: the definition of done's "the link in each opens the same screen" holds for every payroll notice and every
  `self` route.
- Built 11/11/2026: `notifications.service.readerLink` is the one link for the bell, push and email; tests in
  `tests/integration/notifications.test.js` (a temporary site, and a record with no screen for the reader) and
  `tests/integration/ai-actions-payroll.test.js` (the payslip and deduction emails).

## Appendix B · Done, demo and handover

**Definition of done** (MILESTONES §11 as amended): a run computes from attendance, deductions and approved
consequences; payslips generate and are visible in ESS; the run locks; the advanced option switches on and the
statutory items compute against effective-dated configuration, with the report; notification preferences by
category and transport; a pending approval produces in-app, push and email; the link in each opens the same
screen; Email All and Download All work; advances are recorded by Operations & People.

**Demo, Friday 27 November:**

1. Open the run for the month; Compute; read the problems; set a missing salary on People · Employees; Compute again.
2. On Deductions accept a fine this month, spread another over three, waive a third; record an advance over two months.
3. Add an adjustment; exclude a person with a reason.
4. Submit for Approval; the CEO approves from the bell's link; payslips publish.
5. As an employee, open My Payslips: the new month, its payslip, its deductions with the query number.
6. On Payslips open one in the modal and Download PDF; Email All Payslips; Download All.
7. Mark Paid.
8. On Configurations show the pay day (30 by default, Last Day of Month for the month's end) and change it; show Statutory
   Items with their sources; switch Advanced Payroll on from next month only with rates PR 9 cited and MyCity's
   accountant confirmed (otherwise show the switch with the rates Not Set, never an unsourced figure); next month's run
   shows the statutory lines and the Statutory Report.
9. **Before the demo, on staging:** mail resumed (Settings · Integrations, System Sender, Resume Mail, after the mail
   plan's hourly limit is raised, `docs/runbooks/dns-and-mail.md` §5), the failed outbox rows behind the degraded Events
   check read from the Status brief and dealt with, and the test people given addresses that can receive mail; until
   then Email All, "Your payslip is ready" and the CEO's approval email cannot be shown.

**What MyCity enters in the app before the demo** (configuration, so none blocks the build; §13.1 item 21): the pay
day (30 unless MyCity wants another) and the Bank Details Required choice on Configurations; every person's salary and bank details on People ·
Employees (or the staff import); and, if the advanced option is to be shown computing, the statutory rates and the
three conventions its accountant confirms (otherwise the switch is shown with the rates not set). The payslip sample's
sign-off is the one open question (§13.3). The approver is settled (the CEO, §13.1 item 7); the demo uses test people
only (§13.1 item 19).

**Gates and release items (every one):** `npm run ci` green; the Playwright User Guide pictures taken and none stale;
the AI-form gate with no M6 form on the gaps list; the money gate (20); pagination at 25; search coverage; two
shells and no native control; `README.MD` current with no empty M6 file left; PROGRESS Status and counts; this guide's
Change log.

## Appendix C · Contract catalogue

Schemas are in `packages/contract/schemas/<module>.js`, each with a `TABLES` entry (BACKEND_GUIDE §3.1); keys are
`snake_case`; a name ending Create, Edit, Update, Patch or Save is an AI action or accounted for (§9).

- `payroll.js`: `PayrollRun`, `PayrollRunListQuery`, `PayrollRunPage`, `PayrollRunSummary`, `PayrollRunCreate`,
  `PayrollRunSubmit`, `PayrollRunPaid`, `PayrollRunExclude`, `PayrollRunInclude`, `PayrollProblem`, `PayrollProblemPage`,
  `PayrollAdjustment`, `PayrollAdjustmentPage`, `PayrollAdjustmentParams`, `PayrollAdjustmentAdd`, `PayrollSettings`, `PayrollSettingsChange`,
  `PayslipEmailAll`; the assistant's (PR 6): `PayrollMonthQuery` (the `payroll.month` summary's month), `PayrollRunSubmission` and
  `PayrollRunAdjust` (the cards of Submit for Approval and Add Adjustment: the screen's request with the run beside it); and the
  pieces they are made of: `RunStatus`, `AdjustmentKind`, `PayeBasis`,
  `ProblemSeverity`, `ProblemCode`, `PayrollRunCounts`, `PayrollTrendMonth`, `PayrollSettingsVersion`.
- `payslips.js`: `Payslip`, `PayslipLine`, `PayslipDetail`, `PayslipListQuery`, `PayslipPage`, `PayslipVars`,
  `PayslipBatchVars`, `EssPayslipQuery`, `EssPayslipSummary`, `EssDeductionRow`, `EssDeductionPage`; and
  `PayslipLineItem` and `PayslipLineItemPage` (the pay items behind a grouped line, §5), `PayslipLineParams`,
  `PayslipEmailQueued` (Email All's 202), `PayslipCopySent` (Email a Copy), `PayslipReadyEmailVars` (the mail's
  variables), `PayslipPrintedLine`,
  `PayslipStatus`, `PayslipLineKind`, `PayslipLineCode`, `EssDeductionSource`.
- `deductions.js`: `DeductionRow`, `DeductionListQuery`, `DeductionPage`, `DeductionSummary`, `FineParams`, `DeductionAccept`,
  `DeductionWaive`, `AdvanceRecord`, `AdvanceCancel`; the assistant's (PR 6): `FineAccept` and `FineWaive` (the cards of Accept
  Deduction and Waive Fine: the sheet's request with the fine beside it); and `DeductionFigure`, `DeductionSource`, `DeductionStatus`
  (a row's status on the tab), `DeductionState` (a `payroll_deduction`'s own) and `InstalmentStatus`.
- `salary_structure.js` (PR 5): `SalaryGrade`, `SalaryGradeListQuery`, `SalaryGradePage`, `SalaryGradeSave`,
  `GradePlacement`, `GradePlacementListQuery`, `GradePlacementPage`, `GradePlacementSave`, `PayComponent`,
  `PayComponentsSave`; and `BandPosition`, `SalaryStructureParams` (the `:employee_id` path), `PayComponentVersion`,
  `PayComponentSet` (a person's split today and next) and `PayComponentInput`.
- `statutory.js` (PR 5): `StatutoryRate`, `StatutoryRateListQuery`, `StatutoryRatePage`, `StatutoryRatesSave`,
  `StatutoryReportVars`; and `StatutoryItem`, `StatutoryKind`, `StatutoryBase`, `StatutoryBand`, `StatutoryVersionBrief`,
  `StatutoryItemState`, `StatutoryItems` (`GET /statutory/items`), `StatutoryReportRow`, `StatutoryReportItem`, and the
  code lists `ITEM_KIND` and `ITEM_BASES`.
- Shared from `common.js`: `EmptyBody`, `PageQuery`, `money`, `isoDate`, `uuid`, `text`, and, added in PR 1,
  `positiveMoney` (an amount above zero, the field error "Enter an amount") and `monthStart` (a month's first day).
  `ExportFile` is `documents.js`'s.

## Appendix D · File map

- **Backend, per module** (`src/modules/<m>/`): `payroll`: `.routes`, `.controller`, `.service`, `.repo`, `.events`,
  `.calc` (pure), `.inputs`, `.run`, `.lock`, `.config.repo`, `.ai`, `.search`, `.test`; `payslips`: `.routes`,
  `.controller`, `.service`, `.repo`, `.events`, `.breakdown`, `.pdf`, `.ai`, `.search`, `.test`; `deductions`: `.routes`,
  `.controller`, `.service`, `.repo`, `.events`, `.acceptance`, `.ai`, `.search`, `.test`; `salary_structure` and
  `statutory` as in README §5.9 (`statutory.rates`, `statutory.report`). The stubs for jobs
  (`src/jobs/handlers/payroll-compute.js`, `payslip-render.js`) are deleted at the end if unused (decision 3 of §13.2).
- **Other modules touched:** `attendance.pay.js`, `sanctions.fines.js`, `organisation` (tax and pension numbers, PR 5),
  `ess` (the routes, in `ess.earnings.js`, `ess.controller.js`, `ess.routes.js`), `dashboard/sources/payroll.source.js`, `settings.service.js`, `shared/access/access.catalog.js`,
  `shared/rbac/field-mask.js`, `shared/workflow/definitions.js`, `shared/route-map.js`, `shared/search/screens.js`.
- **Schema:** `migrations/6000_payroll.sql`, `6010_payroll_deductions.sql`, `6020_payroll_advanced.sql`,
  `6030_leave_unpaid.sql`; `seeds/reference/6099_seed_payroll.sql`; `seeds/staging/NN_payroll.js`.
- **Templates:** `templates/documents/payslip.html`, `payslip-batch.html`, `statutory-report.html`;
  `templates/email/payslip-ready.html`.
- **Frontend:** `app/src/features/payroll/` (the files of PR 7; `Deductions.tsx` came with PR 3 and `Configurations.tsx`
  with PR 5), `app/src/features/ess/Payslips.tsx`,
  `app/src/api/mock/modules/payroll.ts`, `payslips.ts`, `app/src/shell/catalogue.ts`, `coming-soon.ts`,
  `packages/ui/src/form/MonthField.*`.
- **Docs:** this guide, `docs/handoff/m6-payroll.md`, `docs/manual/payroll.md`, `docs/guides/ess.md`,
  `docs/guides/attendance.md`, `docs/DATABASE_SCHEMA.md`, `docs/PROGRESS.md`, `README.MD`.

---

## 14 · Change log

- 12/11/2026 · JP · PR 9, a fourth research pass at JBS Praxis's request, to settle the three points the third left open, from the agencies that apply the law (§6.16): the pension threshold is three or more employees (PenCom's own statement of who the Act covers, its Framework for Micro Pension Plan 2018, matching s.120; s.2(2)'s "15" is an inconsistency the regulator does not apply), so both pension rows are Confirmed; the NHF base is the month's gross pay (the 2023 s.4's "monthly income" and FMBN's own statement, "2.5% of the monthly gross salary"; FMBN's copy of Cap N45 still prints the pre-2023 wording), so NHF is Confirmed and PR 11 gives it the `gross` base; the National Minimum Wage (Amendment) Act 2024 is in force from 29 July 2024 (the National Salaries, Incomes and Wages Commission's circulars of 23 and 27 September 2024), the ₦70,000 resting on the Board's Guidelines and the Bill, so the exemption's row is Confirmed while the Act's own text stays unread. §6.12 rule 11, §13.3 items 3 and 4, Appendix A (PR 9's note, PR 11's NHF base and pension coverage) and the sources table follow.

- 12/11/2026 · JP · PR 9, a third research pass, from the documents JBS Praxis downloaded and attached, each verified (§6.16's second table): the Joint Revenue Board's Personal Income Tax Guidelines 2026 (the file the Board's link names; its text matches what the search index quotes from that link), the Operation of Pay-As-You-Earn (PAYE) Regulations 2002 (in the Federal Inland Revenue Service's 2021 consolidated text; kept in force by NTA s.199(b)), PenCom's own copy of the Pension Reform Act 2014 (the same scan as NECA's) and the National Minimum Wage (Amendment) Bill 2024 (the Bill as introduced, not the Act). §6.16: PAYE's method Confirmed as cumulative over the year to date, a fall in the cumulative tax refunded and a joiner's figures carried over (regs 3 to 5; Guidelines para 7), the band reading for part of a year left Unverified; remittance by the 10th (Guidelines para 12.2, Regulations reg 7(1)); pension and NHF allowed on the deduction record with evidence (Guidelines paras 7.3 and 8); the minimum wage ₦70,000 a month for PAYE (the Board's return, the Bill agreeing); rent relief Confirmed as given by the employer in PAYE on the person's evidence (Guidelines paras 7.4 and 9); the withholding row gains the Guidelines' para 14; the sources table and the paragraph of what is still unread rewritten. §6.12 rules 11, 14 and 15; §13.3 item 2 answered and item 4 extended; Appendix A: PR 9's note, PR 11's cumulative PAYE with a refund line and a joiner's figures, rent relief built, the minimum wage's figure.

- 11/11/2026 · JP · PR 12 (`m6/notification-links`): a notice's email link follows the reader as the bell and push do
  (`notifications.service.readerLink`), so "Your payslip is ready", "Deduction Scheduled" and "Fine Waived" open ESS · My
  Payslips for a person without `payroll`. §7's "Not yet true" paragraph is replaced by what now holds; Appendix A PR 12
  marked built. No screen changed.
- 11/11/2026 · JP · PR 9, a second pass of the research at JBS Praxis's request, for the texts the first could not reach (documentation only). Reached: the Pension Reform Act 2014 as passed and assented (the Clerk-certified copy NECA publishes), so employee and employer pension are Confirmed at a minimum of 8% and 10% of monthly emoluments (s.4(1)), the base never less than basic, housing and transport (s.120), remitted within 7 working days of pay day (s.11(3)), with the private-sector threshold Unverified because the text says 15 or more employees in s.2(2) and three or more in s.120; the National Housing Fund Act's own text (a transcription), so NHF is remitted within one month (s.9(2)) and its base is unsettled between "monthly income" (s.4) and "basic monthly salaries" (s.26); NSITF's own statement that the rate today is a minimum of 1% of total monthly payroll, payable in the first two working days of each month, so NSITF is Confirmed; the gazetted Deduction of Tax at Source (Withholding) Regulations 2024, kept in force by NTA s.199(b), so PAYE paid to a State Internal Revenue Service is remitted by the 10th of the next month (reg 7(1)(b)(i)) and a resident consultant's fees bear 5% withheld (the First Schedule), a new row for §13.3 item 4. Still not reached: the Joint Revenue Board's 2026 guidelines (its site answers with a bot check), the PAYE Regulations kept by s.199(b), the pension Act's gazette, the National Minimum Wage (Amendment) Act 2024. §6.16 rows and tables, §6.12 rule 11, §13.3 items 3 and 4, Appendix A (PR 9's note, PR 11's NHF base, pension base and report dates) and MILESTONES §11 follow.

- 11/11/2026 · JP · PR 9, the statutory research register (documentation only). §6.16 filled from the primary texts, each row with its instrument, section, figure, base, threshold, date in force, whether monthly, and a second table of the copy read, the day checked (11/11/2026), who checked it and the document MyCity uploads with the figure; the old Sources paragraph replaced by those copies and a list of what was not reached. Confirmed: the PAYE bands (Nigeria Tax Act 2025, s.58 and the Fourth Schedule, a year's, from 1 January 2026); the monthly deduction's rule (Nigeria Tax Administration Act 2025, s.51(6) and (7): the year's deductions equal the year's tax), remittance by the 21st of the next month (s.107) and the annual return (s.14); pension and NHF contributions reduce chargeable income (NTA s.30(2)(a)); the minimum-wage exemption's rule (s.58, s.163(1)(t)); no Consolidated Relief Allowance (the Personal Income Tax Act repealed, s.196(g)); rent relief of 20% of annual rent, at most ₦500,000, on the person's declaration (s.30(2)(a)(vi)); NHF at 2.5% of monthly income, voluntary in the private sector (NHF Act s.4 as substituted by the Business Facilitation Act 2022, s.45); ITF at 1% of annual payroll for an employer with 25 or more employees (ITF Act s.6 as substituted by the same Act, s.41; s.16 as inserted in 2011); NSITF at 1% of monthly payroll for the Employee's Compensation Act's first two years (s.33(1)). Unverified, with what is missing: pension (the Pension Reform Act 2014 not reached), the PAYE method (the regulations of s.51(9) not read), whether an employer applies rent relief, what NHF's "monthly income" includes, the minimum wage's figure, NSITF's rate since 2012. §0.2 gains the research as a source; §6.12 rules 11, 14 and 15 rewritten to it; §13.1 item 38 added, the accountant's confirmation, pending; §13.2 item 22 records that the law settles both reducing conventions; §13.3 items 2 and 3 answered (2 in part) and 4 left open, each with its citations; Appendix A: PR 9's upload line amended (the upload is made in the app, through PR 10's Source fields), PR 9 marked built, PR 11's scope grown to the findings (PAYE on the year to date, the relief removed or rent relief, the conventions fixed, NHF by choice, the minimum-wage exemption, ITF's 25-employee threshold, NSITF's rate) and its size to L. No code, contract, migration, seed or screen changed; no rate entered anywhere outside this guide.

- 11/11/2026 · JP · Milestone 6 audit against the Milestones Review of 11 November 2026 (TB's corrections). §0.1 Pay day (one day every month, Last Day of Month) and Legal source; §0.2 the meeting as a source; §4.2 the owed source columns (`6040`); §5 Remove Change and `SOURCE_REQUIRED`, `VERSION_IN_FORCE` owed; §6.11 rule 1 (one day for every month, Operations & People, Last Day of Month); §6.12 rules 11 to 15 (every item monthly and PAYE Basis off the screen; every rate with its source; people enter every change; the conventions are law; the relief to be checked against the Nigeria Tax Act 2025); §6.16 the statutory register, unverified; §10.1 and §10.4 Configurations' Source, Remove Change, Last Day of Month; §13.1 items 29 to 37; §13.2 item 22 amended; §13.3 items 2 to 4; Appendix A "How the rest is planned" with PR 8 to PR 12, their lanes, models, efforts and merge order; Appendix B demo items 8 and 9. Found and recorded: the email link of a notice ignores the route map's `self` (PR 12); mail is paused on staging and failed outbox rows keep the Events check amber (Appendix B item 9). Documentation only; no code changed.

- 11/11/2026 · JP · PR 7 (the screens, `m6/screens`) rebuilt Payroll Runs and Payslips and ESS · My Payslips on the contract and the real API, with `MonthField` in `packages/ui`; the guide meets what was built. §13.3's question 2 answered by JBS Praxis and moved to §13.1 item 28 (In the run is approved, not yet paid; no API change), §5's pointer with it. §2: Payroll Runs lists Include, Payslips its Month select and the run's mail and download. §10.1 to §10.4: what each screen now shows (the open run's card by its month, Waiting On, Adjustments, Left Out, Run Problems; the Payslips list titled Preview or Published; My Payslips' year from the start year, Email a Copy with Download PDF in the payslip's modal), the components as built (`MonthField`, `Chain stack`, the slip drawn from its lines until its PDF loads) and the words added. F31's amendment for both payslips recorded in FRONTEND_FOUNDATION, FRONTEND_GUIDE §7 and CLAUDE.md (§10.3). §11: Preparing has no Download PDF; a decision lands after it commits and the screen waits for it. §9: New Run's `action=new` is answered. Every money field of the four tabs sends a two-place amount (`toMoneyString`), as the contract asks. Appendix A PR 7 says what was built.
- 10/11/2026 · JP · PR 6 (AI, search, Home and notices, `m6/ai-search`) built `payroll.ai.js`, `payslips.ai.js`, `deductions.ai.js`, the owner-pinned payslip search and the New Run action; the guide meets what was built. Contract: `PayrollMonthQuery`, `PayrollRunSubmission`, `PayrollRunAdjust`, `FineAccept`, `FineWaive` (§9, Appendix C). §9: the reads, the summary and the six cards as built, each card risk `payroll`, asked first, named by its chip and held again at the press by its own `check`; the cards of Submit, Add Adjustment, Accept and Waive take a card schema because the screen's button never names the run or the fine (§13.2 item 29); Submit's card carries the net the person saw so `RUN_CHANGED` still guards the total; `payslips.mine` and `deductions.mine` carry the amounts under names the salary mask does not govern, because the engine masks every row it reads and the Employee role hides salaries by default (§13.2 item 30), while `payroll.month` leaves the amounts out for a reader whose role hides pay; the advanced switch, the pay day and the bank rule are not a card, the route "turn on advanced payroll" opens Configurations (§13.2 item 28); a person's own payslip is found in ⌘K as `payroll_own_payslip` and cited with `payroll_own_deduction`, both opening My Payslips (§13.2 item 31); ⌘K gained New Run. §7: the Submit notice is checked in the bell, by push and by email, each link opening Payroll Runs on the run. Home's Payroll In Progress card was live since PR 2 and its test still holds. No screen was built: Appendix A's PR 6 has none and PR 7 is LA's.
- 10/11/2026 · JP · PR 5 (Configurations and the advanced option, `m6/advanced`) built `statutory` (`.rates`, `.report`, `.repo`, `.service`, `.controller`, `.routes`, `.events`) and `salary_structure` (`.repo`, `.service`, `.controller`, `.routes`, `.events`), `/payroll/settings`, `/payroll/runs/:id/statutory-report`, `payroll.calc.computeStatutory` and the pay split in Compute, migration `6020`, `templates/documents/statutory-report.html` and the Configurations screen; the guide meets what was built. Contract: `GET /statutory/items` (`StatutoryItems`, the seven items in brief) and the pieces listed in Appendix C (§5). Data (§4.1, §4.2): `payslip_line.base_amount`; versions never overlap through two unique indexes a key and the one write path, not an exclusion constraint (no `btree_gist`); `statutory_rate.rate` is `NOT NULL DEFAULT 0` and a row's kind and band are held to its item. `shared/db/effective-dated` gained `replace` (a change for a day that already has a version joins it) and `addVersionSet` (a version of several rows). Rules: §6.11 rule 6 (a split used only while it adds up to the gross; each component a Monthly Pay line), §6.12 rules 8 to 10 (the bases, PAYE's shape, what a run keeps), §6.15 (No Rates Set reads the snapshot, No Pay Split a Monthly Pay line with no component), §13.2 items 24 to 27. The report is of an approved or paid run and refused to a reader whose role hides pay or tax numbers (§5). Errors `EFFECTIVE_IN_THE_PAST`, `VERSION_EXISTS`, `SPLIT_NOT_GROSS`, `NO_SALARY`, `GRADE_NOT_IN_FORCE` (§5). Events `grade_placement.saved` and `payroll_run.statutory_report_requested` (§7). Gates 9, 10 and 23: the two controllers say `ai:none design:` and `search:none`, the route map's three configuration types open Configurations (§9). The salary mask names `band_minimum`, `band_maximum` and `band_position` (§6.13). The screen was built in this pull request at JBS Praxis's request (Appendix A, PR 5); §10.1, §10.2 and §10.4 say what it shows, and Effective From carries no help term (the date field refuses a past day itself). The employee's tax and pension numbers are on the API (`PATCH /employees/:id`, the 360) and not yet on People · Employees' form.
- 09/11/2026 · JP · PR 4 (payslips, the PDF, email and ESS, `m6/payslips`) built `payslips.repo/.service/.breakdown/.pdf/.events/.controller/.routes/.search`, `ess.earnings.js` and the ESS routes, the pay-date helpers in `payroll.config.repo.js`, the two document templates and the mail; the guide meets what was built. Contract: `PayslipLineParams`, `PayslipEmailQueued`, `PayslipCopySent` and `PayslipReadyEmailVars` added (§5, Appendix C); the routes of Email All and Download All stay on the run (§5) and answer 202 with `PayslipEmailQueued` and `ExportFile`. New errors `EMAIL_TOO_SOON` (a copy within a minute of the last mail of a payslip, Email All counting) and `NO_PAYSLIPS` (§5). A sixth write guard `published` (an approved or paid run) is added to the lock, and the five writes that belong on a run that is out (Email All, a payslip's mail, its un-marking, a copy and Download All) are made with it and held by the enumerating test (§6.9 rule 4). The lock requests every payslip's PDF in its own transaction with no actor, so the approver is never the uploader of a person's payslip; 306 requested in 957 ms, so no render job of ours (§6.10 rule 4). Email All marks each payslip emailed in its own transaction and the `payslip.emailed` it records queues the mail (one path for both Email All and Email a Copy), so the handler of §7 marks and the mail is queued by `payslips.mail`; the new events are `payroll_run.email_requested`, `payroll_run.export_requested`, `payslip.emailed` and `payslip.export_requested` (§7). A payslip's PDF and Download All are refused to a reader whose role hides `employee.salary` or `employee.bank` unless the payslip is their own, since the document carries both (§6.10 rule 4, §6.13 rule 3). `GET /ess/payslips/summary` sums the year's published payslips and Next Payday is the first pay date on or after today whose month's run is not paid, with the pay day in force at that month's end (§5, §6.11 rule 1). Gates 9 and 10 hold a filled controller to an AI manifest and a search provider: `payslips.controller.js` carries `ai:none` until PR 6 writes the reads, and `payslips.search.js` answers for `payroll` readers (§9). §13.3 gains question 2: what My Payslips' In the run means, since §5 (published only) and §10.1 (waiting for approval) read differently. The staff app's typecheck refuses an INTERIM entry the contract also declares, so, as PR 2 did for Payroll Runs, the Payslips tab and My Payslips prototype screens and their mock now read the contract's shapes (`Payslip`, `PayslipDetail`, `EssPayslipSummary`, `EssDeductionRow`) and call `/payslips` and `/ess/payslips`; their layout, their placeholders for the PDF and Download All, and everything §10 asks for stay PR 7's, and the API row stays unticked in PROGRESS until PR 7 so the tabs do not open on staging as a half-built prototype.
- 09/11/2026 · JP · PR 3 (deductions, `m6/deductions`) built `deductions.repo/.acceptance/.service/.controller/.routes/.events/.ai/.search`, the Deductions screen and its mock; the guide meets what was built. Contract: `DeductionRow.salary_set` (an attendance item priced for a person with no gross has a null amount that is not the mask's, so the screen says No Salary Set and never Restricted), `DeductionSummary.open_period` (the screen works out no month, §6.6 rule 2) and `FineParams` (the path of a fine's Accept and Waive), §5 and Appendix C. Rules: a start month is the open month or later and no month of a deduction may already have a run sent for approval (422 `START_NOT_ALLOWED`), and a total too small for a kobo a month is refused (422 `TOO_MANY_MONTHS`) (§6.6); a write takes the runs of the months it touches before its own rows, in the order a run's lock takes them, so a Compute or a Submit never reads between a write and its commit (`payroll.lock.lockMonths`); errors `NOT_A_FINE`, `NOT_AN_ADVANCE`, `NOT_ACTIVE` and `GRANTED_IN_THE_FUTURE` added to §5. The list opens pending first and then newest by a default sort the contract does not name. Events: an advance recorded is `payroll_deduction.accepted` with its source, a cancelled advance tells no one, the waiting notice has a `dedup_key` (§7); the route map's `deduction` opens ESS · My Payslips for the person told. Gates 9 and 10 carry `deductions.ai.js` (one route) and `deductions.search.js` from the day the controller is filled, as for PR 2 (§9). The screen was built in this pull request at JBS Praxis's request (Appendix A, PR 3); the rest of PR 7 is unchanged.
- 09/11/2026 · JP · PR 2 (calculation and the run, `m6/run`) built `payroll.calc/.config.repo/.inputs/.lock/.run/.repo/.service/.controller/.routes/.events`, the Home source, `attendance.pay`'s hand-off functions and `sanctions.fines.release`; the guide meets what was built. Contract: `PayrollRunInclude` (the body of `POST …/include`, which §5 named without one) and `PayrollAdjustmentParams` (the two path parameters of a removal), added to §5 and Appendix C. Errors added to §5: `RUN_NOT_COMPUTED` (Submit on a Draft), `RUN_NOT_SUBMITTED`, `NO_ONE_TO_PAY` (§11 said Submit refuses an empty month), `NOT_IN_RUN`, `NOT_EXCLUDED`, `PAID_IN_THE_FUTURE`; `RUN_CHANGED` carries the new totals in `fields` to a reader who may see pay, and a refused Submit is answered after its recompute commits. The write guard is `payroll.lock.defineWrite`, which locks the run row and runs the guard a write names (`editable`, `computed`, `approved`, `submitted`), so every write registers in `WRITES` and a unit test holds the files to it (§6.9 rule 4). A leaver is one whose `left_on` falls on or before the month's last day (§6.6 rule 9); fines come before advances on a slip; a run reports problems only while Draft or Computed, and an advanced run reports No Rates Set until PR 5 (§6.15). New events `payslip.excluded`, `payslip.included` and `payroll_deduction.settled` (§7); the instalments' moves and the settlement of a finished deduction are written by the run (§4.1, which already named `payroll` a writer of the instalments). Compute for 308 people measured at 550 ms, so §13.2 item 3 is decided: no `payroll-compute` job, and both job stubs go in PR 8. Gates 9, 10, 19 and 23 hold a module to its AI manifest and search provider from the day its controller is filled, which is PR 2, so PR 2 carries the card `payroll_runs.create` and `payroll.search.js` for `payroll_run` (§9, Appendix A). Home's Payroll In Progress card is live.
- 09/11/2026 · JP · JBS Praxis's answers on PR 1's open points recorded (§13.1 items 25 to 27): the first statutory rates are entered before the option is switched on, so Statutory Items and PAYE Bands are always on Configurations and the rates routes work whatever the option's state, while the conventions go in the Switch On request and Salary Structure and Pay Components stay behind "on or has been" (§2, §3.5, §5, §6.11 rule 4, §10.1, §10.2); `leave_type.unpaid` is seed-only for now; #11 My Payslips keeps its Owner, AJ (Appendix A). §13.3's question 2 is answered and removed.
- 09/11/2026 · JP · PR 1 (contract, data and scaffolding) built the simple-mode contract, migrations `6000`, `6010` and `6030` and seed `6099`; the guide meets what was built: `payroll_run.advanced` defaults to false and the foreign key from `attendance_pay_item` is `ON DELETE SET NULL` (§4.1, §4.2); `payroll_deduction.sanction_fine_id` is no longer plainly `UNIQUE` but unique among the live (not cancelled) deductions, because a released fine (§6.6 rule 5) could otherwise never be accepted again (§4.2); `PayrollSettings` carries `advanced_has_been_on`, which the version in force and the next cannot tell (an option switched off has been on), and the conventions (§5); a run list row has an empty `chain` (§5); `account_last4` joins `employee.bank` in the mask so a payslip's last four digits are masked as §6.13 rule 2 says; the settings labels already existed (Appendix A); Appendix C lists the pieces the schemas are made of, the pay items behind a grouped line (`PayslipLineItem`, which §5 and §6.10 rule 7 name without a contract) and the two helpers added to `common.js`; §13.3 gains question 2, a circle between `NO_RATES` and the Statutory Items being hidden before the option has been on, for PR 5.
- 09/11/2026 · JP · Pay day and the statutory rates confirmed with JBS Praxis: the pay day defaults to the 30th, configurable 1 to 31, a day past a month's end falls on its last day (§13.1 item 24, §6.11 rule 1, §4.2, §5, §11); the statutory rates, bands, relief, employer percentages, bases and conventions are all data entered from a date, and only the set of items and the formula's shape are code (§6.12 rule 7); People · Employees already has the Pay and Bank step that sets a person's salary and bank (§2).
- 09/11/2026 · JP · After rebasing onto main: Configurations' PROGRESS row is the next free one, #109 while free (#107 and #108 are the public site's); §0.3 and the build plan otherwise unchanged.
- 09/11/2026 · JP · JBS Praxis's third round recorded: the statutory rates, the accountant's conventions, the pay day and every person's salary and bank details are configuration MyCity enters in the app (§13.1 item 21; the options in §4.2 `payroll_setting`, §5, §6.11 rule 3a, §6.12 rule 1, §6.15, §10.1; `NO_CONVENTIONS`); LA builds the screens (item 22; the header, Appendix A's lanes and PR 7); Written is ticked once the pull request merges (item 23, Appendix A PR 0); §13.3 holds one question.
- 08/11/2026 · JP · JBS Praxis's second round of answers recorded: the CEO alone approves (§13.1 items 7 and 15), a leaver's final run takes every outstanding instalment and a negative net blocks Submit (item 16), no recurring allowances in simple mode (item 17), both payslips open in a modal at every desktop width (item 18, §10.3, §10.2), staging demos use test people only (item 19), the payslip sample drafted under `docs/MyCity-ERP-Documents/payroll-samples/` (item 20); §13.3 now holds five questions; Appendix A's PR 0 and Appendix B follow.
- 08/11/2026 · JP · Written as M6's single source of truth from MILESTONES §11, the 4 November Modules Review (the
  transcript, not the Gemini summary), the 10 October and 2 September meetings, JBS Praxis's answers of 08/11/2026,
  and the built attendance, sanctions and leave code; the handoff `docs/handoff/m6-payroll.md` ticks and logs only.

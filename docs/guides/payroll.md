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
| Last changed | 09/11/2026 |

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
| **Pay day** | The day of the month MyCity pays: the 30th unless MyCity sets another day from 1 to 31 on Configurations; a day past a month's end is that month's last day (30 pays on 28 or 29 February). Shows as Next Payday on My Payslips |

### 0.2 Where things come from

| Source | What it settles | Standing |
|---|---|---|
| MILESTONES §11 and decisions A1 to A26 | Scope, definition of done, the donor, A22, A26; amended 08/11/2026 | Binding (CLAUDE.md step 3) |
| REUSE_MAP §7 | The donor files and what changes on the way in | Wins over MILESTONES where they differ |
| Modules Review, 4 November 2026 (TB with AJ; transcript 00:35:30 to 00:40:03) | Simple run by month, payslips as modals with PDF, Email All and Download All, no grading, the advanced option on Configurations, deductions pulled from consequence management with accept, spread or waive, advances | The latest word on screens and scope |
| Requirements meeting, 10 October 2026 (Cynthia Osakunih for MyCity, 01:10:41) | Simple payroll by default, a run is a month, payslips computed from base pay and additions, submitted to the CEO or COO; Cynthia agreed | Client agreement |
| Discovery call, 2 September 2026 | MyCity's payroll today is simple; ITF and NSITF "as we scale"; confirmed the system can switch to a full statutory mode | Client intent |
| Module demos, 12 October 2026 (00:38:05) | Staff are mostly contractors and consultants who handle their own tax and pension, so no screen mentions PAYE or pension in simple mode | Rule kept (§6.10); "hidden behind an advanced option" is superseded by §13.1 |
| JBS Praxis's answers, 08/11/2026 and 09/11/2026 | Statutory built and shipped off; advances recorded by Operations & People; the CEO approves; a leaver's instalments and a negative net; no recurring allowances in simple mode; both payslips as modals; test people on staging; the payslip sample drafted; the rates, conventions, pay day and staff pay data as configuration MyCity enters in the app; LA builds the screens; Written ticked after the merge | Decisions (§13.1) |
| `docs/guides/attendance.md` §6.17, `queries.md` §6.6, `ess.md` | What attendance and queries hand to payroll and what My Payslips shows | Contracts this guide meets |
| `docs/DATABASE_SCHEMA.md` M1, M3 and M6 | What exists and what payroll owes | Facts |
| Not sources | `demo.html` (look only), the mock, the donors' rates and bands, the demo's PAYE bands, Gemini's summaries where the transcript says otherwise | Never |

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
| Payroll · Payroll Runs (`payroll-runs`, #45) | Staff app, People group | `payroll` view | The current run's figures and chain, its problems, the run history, the approval | New Run, Compute, Add Adjustment, Exclude, Submit for Approval, Approve, Send Back, Reject (the approver), Mark Paid, Email All Payslips, Download All, Statutory Report (advanced), Discard |
| Payroll · Payslips (`payslips`, #46) | Staff app | `payroll` view; amounts need the salary grant | The month's payslips (Preview until approved, Published after), one opening in a modal with its lines | Open a payslip, Download PDF (`payroll` edit, a restricted file), search by person |
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
| `payslip_line` | The lines of a payslip | `6000` | `payroll` |
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
  the maximum or below the minimum is flagged, never blocked.
- `employee_pay_component`: `employee_id`, `code citext` (`basic`, `housing`, `transport` or another), `label`,
  `amount`, `pensionable boolean`, `effective_from`, `effective_to`.
- `statutory_rate`: `item` (`paye`, `pension_employee`, `pension_employer`, `nhf`, `itf`, `nsitf`, `relief`),
  `kind` (`employee`, `employer`), `base` (`gross`, `pensionable`, `basic`, `taxable`, `annual_payroll`),
  `rate numeric(9,6)` (a percent), `band_from`, `band_to`, `flat_amount` (a relief), `position smallint` (a
  band's order), `effective_from`, `effective_to`. A PAYE table is one row per band; a save replaces the
  whole table from its date. Which columns each item uses is §6.12.

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
| `POST /payroll/runs/:id/statutory-report` | `EmptyBody` → 202 `ExportFile` | `payroll` export · all | no | Advanced runs only (409 `ADVANCED_OFF`) |

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
| `GET /ess/payslips` | `EssPayslipQuery` (`year`, this Lagos year when absent) → `PayslipPage` | `ess` · own | yes, 25 | Published payslips only, newest month first; each carries its run's status (`run_status`: `approved`, or `paid`) and `has_deduction`, which are what the month's status (Paid, Paid with a deduction, In the run) is read from (§13.3 item 2) |
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
| `GET /deductions` | `DeductionListQuery` (`status`: `pending`, `active`, `settled`, `waived`; `source`: `attendance`, `fine`, `advance`; `employee_id`, `month`, `q`; sort `-created`, `employee`, `-amount`) → `DeductionPage` | `payroll` view · all | yes, 25 | One page of the union of pending pay items, fines and deductions (§6.6); a row names its source, status and what can be done to it |
| `GET /deductions/summary` | → `DeductionSummary` | `payroll` view · all | no | Pending Fines, Pending Attendance, Active, Recovered This Year |
| `POST /deductions/fines/:sanction_fine_id/accept` | `DeductionAccept` (`months` 1 to 12, `start_period`) → `DeductionRow` | `payroll` edit · all | no | `months` 1 is Accept This Month; 409 `FINE_NOT_MOVABLE` from `sanctions.fines` for a fine no longer pending; never your own (403 `OWN_RECORD`) |
| `POST /deductions/fines/:sanction_fine_id/waive` | `DeductionWaive` (`reason`, 10 to 500) → `DeductionRow` | `payroll` edit · all | no | Never your own |
| `POST /deductions/:id/release` | `DeductionWaive` → `DeductionRow` | `payroll` edit · all | no | An accepted fine whose instalments are all still scheduled goes back to pending (`sanctions.fines.release`) |
| `POST /deductions/advances` | `AdvanceRecord` (`employee_id`, `amount`, `granted_on`, `months` 1 to 12, `start_period`, `reason`) → `DeductionRow` | `payroll` create · all | no | Never your own |
| `POST /deductions/:id/cancel` | `AdvanceCancel` (`reason`) → `DeductionRow` | `payroll` edit · all | no | An advance recorded in error, while none of its instalments is in a run or applied |

**Configurations** (`/payroll/settings`, `/salary-structure`, `/statutory`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /payroll/settings` | → `PayrollSettings` (`advanced_enabled`, `advanced_has_been_on`, `pay_day` (30 when none is set), `pay_day_is_default`, `require_bank_details`, the three conventions, and `current` and `next`, the version in force and the one that starts later) | `payroll` view · all | no | |
| `PATCH /payroll/settings` | `PayrollSettingsChange` (`advanced_enabled`, `effective_from`, `pay_day`, `require_bank_details`, `paye_basis`, `pension_reduces_taxable`, `nhf_reduces_taxable`, `reason`) → `PayrollSettings` | `payroll` edit · all, capability `payroll.configure` | no | `effective_from` today or later; the convention fields are accepted only once the option has been on or is being switched on (409 `ADVANCED_OFF` otherwise); 409 `NO_RATES` to switch on with no rate in force on that date; 409 `NO_CONVENTIONS` with any convention unset |
| `GET /statutory/rates` | `StatutoryRateListQuery` (`item`, `as_of`) → `StatutoryRatePage` | `payroll` view · all | yes, 25 | Readable whatever the option's state: the rates are entered before the first switch-on (§13.1 item 25) |
| `POST /statutory/rates` | `StatutoryRatesSave` (`item`, `effective_from`, its rows or bands) → `StatutoryRatePage` | `payroll` edit · all, `payroll.configure` | no | A new version from a date; never backdated; the previous version ends the day before; accepted while the option is off, so a rate can be in force when it is first switched on |
| `GET /salary-structure/grades`, `POST /salary-structure/grades` | `SalaryGradeListQuery`, `SalaryGradeSave` → `SalaryGradePage`, `SalaryGrade` | view; edit with `payroll.configure` | yes, 25 | Advanced only |
| `GET /salary-structure/placements`, `PUT /salary-structure/placements/:employee_id` | `GradePlacementListQuery`, `GradePlacementSave` → `GradePlacementPage`, `GradePlacement` | view; edit with `payroll.configure` | yes, 25 | Each person against their band: Below Minimum, Within, Above Maximum |
| `GET /salary-structure/employees/:employee_id/components`, `PUT …` | `PayComponentsSave` → the person's components | view; edit with `payroll.configure` | no | A save is a new version from a date |

**Errors** (`shared/errors.js`, every one a code the screen can name): `RUN_EXISTS`, `PERIOD_NOT_ALLOWED`,
`RUN_NOT_EDITABLE`, `RUN_NOT_COMPUTED`, `RUN_NOT_SUBMITTED` (the approval's two ends, which the handlers answer with a quiet no-op),
`NO_ONE_TO_PAY`, `RUN_HAS_PROBLEMS`, `RUN_CHANGED`, `NOT_IN_RUN`, `NOT_EXCLUDED`, `PAID_IN_THE_FUTURE`, `NOT_APPROVED`, `NOT_READY`, `NO_RATES`,
`NO_CONVENTIONS`, `ADVANCED_OFF`, `FINE_NOT_MOVABLE`, `OWN_RECORD`, `INSTALMENTS_STARTED` (cancel or release after one is in a run),
`EMAIL_TOO_SOON` (429, a copy within a minute of the last mail of a payslip), `NO_PAYSLIPS` (409, a download with nothing to put in it).
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
   never a month that already has a Submitted, Approved or Paid run.
3. **Spread Over Months** takes 2 to 12 instalments from the month picked. The amounts are
   `shared/money.allocate(total, equal weights)`: kobo that do not divide go to the first instalments (₦10,000.00
   over 3 is 3,333.34, 3,333.33, 3,333.33). The instalments sum exactly to the total.
4. **Waive** (a pending fine) needs a reason of 10 to 500 characters and calls `sanctions.fines.waive`. Nothing
   is deducted. The employee is told.
5. **Release** returns an accepted fine to pending (`sanctions.fines.release`, new) only while every instalment
   is `scheduled`; the instalments become `cancelled` and the deduction `cancelled`. Once one is in a run (or
   applied) it cannot be released (`INSTALMENTS_STARTED`).
6. **Record Advance** writes a `payroll_deduction` (`source = salary_advance`, `granted_on`, the months, the
   first month) with instalments by rule 3 and tells the employee. The advance itself is paid outside the system;
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
   `payroll.configure` as a new version of the setting from a date. A pay day past a month's last day falls on that
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
   each marked pensionable or not, from a date. A person with no split in advanced mode gets the warning No Pay
   Split and their whole gross is treated as the pensionable and basic base, so the run still computes and the
   warning says it is an estimate.

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
Submitted. Until PR 5 builds the statutory tables, a run computed in advanced mode reports No Rates Set for the run, blocking:
no rate can exist yet, and the engine never defaults one (§6.12 rule 3), so Submit refuses it rather than approve a run with
statutory lines missing.

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
| `payroll_deduction.accepted`, `.released`, `.waived`, `.settled`, `.cancelled` | A fine or advance moves | Audit; notifies the employee for accepted, waived and a recorded advance; the fine events also reach `sanctions.fines`'s own (`sanction_fine.accepted` and so on). `.settled` is emitted by the lock (PR 2, entity `deduction`); the others come with PR 3 |
| `payroll_deduction.fine_pending` | After commit, from an outbox handler on `sanction.issued` whose payload has a `fine_amount` | Notifies `payroll` edit holders "Fine Waiting for Payroll" |
| `payroll_setting.changed`, `statutory_rate.saved`, `salary_grade.saved`, `pay_components.saved` | Configurations change | Audit; `payroll_setting.changed` is `security: true` so the access watchers are told |
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

The bell's link opens the same screen as the email's: `shared/route-map.js` maps `payroll_run` to Payroll ·
Payroll Runs, `payslip` to Payroll · Payslips (`self: true` to ESS · My Payslips), `deduction` to Payroll ·
Deductions, and the retired `salary_structure` and `statutory_return` entries to Configurations.

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

  A **summary** (figures, never rows): `payroll.month` (headcount, gross, deductions, net of a month).
- **AI cards** (each runs the service function its screen's button calls; risk `payroll`, so Confirm It's You
  first, praxis-ai.md decision 11; form schema named so gate 23 is satisfied):

  | Action | Input schema | Runs |
  |---|---|---|
  | `payroll_runs.create` (New Run) | `PayrollRunCreate` | `payroll.service.createRun` |
  | `payroll_runs.submit` (Submit for Approval) | `PayrollRunSubmit` | `payroll.service.submitRun`; `form: "none: a button with no form"` |
  | `payroll_adjustments.add` (Add Adjustment) | `PayrollAdjustmentAdd` | `payroll.service.addAdjustment` |
  | `deductions.accept` (Accept Deduction) | `DeductionAccept` | `deductions.service.acceptFine` |
  | `deductions.waive` (Waive Fine) | `DeductionWaive` | `deductions.service.waiveFine` |
  | `advances.record` (Record Advance) | `AdvanceRecord` | `deductions.service.recordAdvance` |

  Approve and Reject are the approvals' own card (`approvals.decide`). The forms of rates, bands, grades,
  placements, pay components and the advanced switch (`StatutoryRatesSave`, `SalaryGradeSave`,
  `GradePlacementSave`, `PayComponentsSave`, `PayrollSettingsChange`) are each offered as an action or listed in
  `not_offered` with a reason the gate accepts (praxis-ai.md §6.15); PR 6 decides each and nothing is added to
  `scripts/check/ai-forms-gaps.json`. Each action key has an integration test and an evaluation case
  (`scripts/ai/eval-assistant.js`); `npm run gen:ai-catalogue` is run and its diff reviewed.
- **What PR 4 carries.** Gate 9 holds a filled controller to an AI manifest or a written `// ai:none <reason>`, and gate 10 to a search provider: `payslips.controller.js` says `ai:none` with the reason that PR 6 writes `payslips.mine` and `payslips.list` (and removes the line), and `payslips.search.js` answers for `payroll` readers. A payslip has no create or edit form, so gate 23 asks for no card.
- **What PR 2 carries.** Gates 9, 10, 19 and 23 hold a module to its AI manifest and its search provider from the day its controller is
  filled, which is PR 2, so PR 2 carries `payroll_runs.create` (New Run, with its integration test and evaluation case) and
  `payroll.search.js` for `payroll_run`; PR 6 adds the five other cards, the reads, the summary and the other providers.
- **AI routes** (intent to screen): "run payroll" to Payroll · Payroll Runs with `action=new`; "my payslip" to
  ESS · My Payslips; "record a salary advance" to Payroll · Deductions with `action=advance`; "turn on advanced
  payroll" to Payroll · Configurations.
- **Search** (`payroll.search.js`, `payslips.search.js`, `deductions.search.js`, each a `recordProvider`):
  `payroll_run` (number, "October 2026 payroll", words payroll, run, salaries), `payslip` (number and the
  person's name; PR 4 carries the provider for `payroll` readers, within their scope, draft and published alike, never an amount; PR 6
  adds the `owner`-pinned search so a person finds only their own, which needs a link that opens My Payslips; words payslip, pay slip, salary slip),
  `deduction` (the person and reason; words deduction, fine, advance, loan). Screens in
  `src/shared/search/screens.js`: Payroll Runs, Payslips, Deductions and Configurations (words advanced payroll,
  statutory, paye, pension, grades, pay day, salary structure), replacing the Salary Structure and Statutory
  entries; ⌘K actions New Run, Record Advance. The route-map entries that say "search:none not built yet" lose
  that note in the PR that fills their provider.

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
| Payroll · Payroll Runs | The month (desktop subtitle); Staff in Run, Gross, Deductions, Net; the chain Draft, Computed, Submitted, Approved, Paid with who has it now; the problem line "2 blocking, 3 warnings" with Open; Run History (Month, Staff, Gross, Net, Approved By, Status); New Run, Compute Run, Add Adjustment, Submit for Approval, Approve, Send Back, Reject (the approver), Mark Paid, Email All Payslips, Download All, Statutory Report (advanced), Discard | Help term on **Status**: what each status lets people do. On **Blocking**: what stops Submit. On **Adjustment**: a correction to a locked month goes into the next run. On **Send Back**: it releases everything frozen. Each at most 35 words | The freeze at Submit, the recompute and `RUN_CHANGED`, rounding, the working-days divisor, one run a month: §6.8, §6.9, the chapter |
| Payroll · Payslips | Payslips, Gross, Deductions, Net, Visible to Staff (On approval, then Published); the month's payslips (Employee, Gross, Deductions, Net, Status); a payslip opens in the modal: its lines, Net Pay, Download PDF (`payroll` edit) | Help term on **Preview**: a payslip is a preview until the run is approved. On **Restricted**: the amount needs the salary grant | PDF generation, the restricted file rule, the breakdown's source: §6.10 |
| Payroll · Deductions | Pending Fines, Pending Attendance, Active, Recovered This Year (each opens its list in a pop-up, the ESS rule); the status chips (Pending, Active, Settled, Waived) and the source switch (All, Attendance, Fines, Advances); the list (Employee, Reason, Source, Amount, Month, Status); a row's sheet with Accept This Month, Spread Over Months, Waive, Release; Record Advance | Help term on **Spread Over Months**: how many months, the first month, equal shares. On **Pending Attendance**: waive these on People · Attendance. On **Release**: only before any share is in a run | Instalment rounding, never your own, the fine and attendance lifecycles: §6.6, queries.md §6.6 |
| Payroll · Configurations | Pay Day; the Bank Details Required switch; the Advanced Payroll row with its switch and its state; Statutory Items (Item, Type, Rate, Base, Status) and PAYE Bands, always; when on or once it has been: Conventions (PAYE Basis, Pension Reduces Taxable Pay, NHF Reduces Taxable Pay), Salary Structure (Bands by Grade, Grades, who is Above Maximum or Below Minimum), Pay Components; Save Rate, Save Grade | Help term on **Advanced Payroll**: from its date, later runs compute PAYE, pension, NHF, ITF and NSITF; locked runs never change. On **Effective From**: today or later. On **Bank Details Required**: a person with none blocks Submit. On **Pay Day**: 30 unless changed; a day past a month's end is its last day. On **PAYE Basis**: annualised or monthly bands | Why statutory is off by default, how a run picks its mode, the rates' sources: §6.11, §6.12 |
| ESS · My Payslips | The year with its ‹ › switch; Gross, Net Received, Payslips, Deductions (View Details), Next Payday; the year's months (Month, Net, Status: Paid, Paid with a deduction, In the run); the picked month's payslip, Download PDF, Email a Copy; Deductions (Month, Amount, Reason, Query, Outcome; Open My Queries) | Help term on **In the run**: the month is waiting for approval | PDF rendering, that no statutory word appears in simple mode: §6.10, ess.md §6 |
| Home · Payroll In Progress | A count of runs not paid, opening the run | Help term on the card's title (as every Home card) | The card's source and mask: home.md §4.1, §3.8 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Payroll · Payroll Runs | Staff in Run and Net two to a row, the chain as a vertical list, the problem line, then run cards (month, net, status pill) | The subtitle, Gross and Deductions cards, the trend chart | Submit for Approval, full width at the foot of the open run's sheet | Bottom bar More, then People; the four tabs scroll sideways |
| Payroll · Payslips | Four figures two to a row, then payslip cards (person, net, status pill) | The Gross and Deductions columns | Download PDF, full width at the foot of a payslip's full sheet; Email All Payslips and Download All in the run's overflow | As above |
| Payroll · Deductions | Four figures two to a row, then deduction cards (person, reason, amount, status pill) | The Source column, the subtitle | Accept This Month at the foot of a pending fine's sheet, Spread Over Months and Waive beside it | As above |
| Payroll · Configurations | Pay Day, the Advanced Payroll row, Statutory Items and PAYE Bands as cards; when on, cards for the rest | The band chart | Switch On or Off, opening its date sheet | As above |
| ESS · My Payslips | The year switch (44 px targets), Email a Copy, Download All; the figures two to a row; the months as a list with a status pill | The subtitle; the payslip opens in a modal on desktop and as a full sheet on a phone (F31 as amended, §10.3) | Download PDF at the foot of the month's sheet | ESS tabs |
| Home · Payroll In Progress | The card as every Home card | Nothing | Open the run | Bottom bar Home |

### 10.3 Components, and the amendments this guide asks for

Every component is imported from `@mycity/ui` (CLAUDE.md, components only from the shared package); a missing one
is added there with `npm run new:component` (header, test and gallery page), never inside a feature.

| Need | Use |
|---|---|
| The four tabs | The shell catalogue only (`app/src/shell/catalogue.ts`); the screen renders no `Tabs` of its own |
| Run list, previous runs | `DataView` through `PagedTable` and `ExportAction` (`@/features/shared/sections`), with `StatusPill`, `Money`, `Who`; counts in `StatStrip` or `KpiGrid` and `KpiCard` (`KpiTiles`) |
| The chain and the approval | `Chain` fed by the workflow instance (the `RouteCard` pattern in `features/expenses/parts.tsx`), `Banner` for the problem line, `ActionGroup` around Approve, Send Back and Reject, the reason through `workflow.ReasonBody`, `useConfirm` before an irreversible press |
| New Run | `useModal`, `Form`, `Field`, `useContractForm(initial, payroll.PayrollRunCreate)`, `FormFooter`; **a month field is missing from `packages/ui`**: PR 7 adds `MonthField` (`npm run new:component -- --name MonthField --group Forms`) rather than reuse the unbound `features/shared/MonthPicker.tsx` |
| The payslip | `Paper`, `PaperLogo`, `PaperTitle`, `PaperTable` (two columns), `PaperFoot` for the Payroll preview of an unpublished payslip; `DocumentPreview` with `useFileBlob` for a published one (the real PDF, ess.md §6); `ListDetail` with `layout="modal"` |
| Email All, Download All | `Button` with `icon="mail"` handing back its work; `ExportAction` (`saveExport`) for Download All |
| Deductions | `DataView` with `Chips`, `SegmentedControl` for the source, `ListDetail`, `NumberField` or `ChoiceField` for the months, `EmployeePicker` for the person, `HelpTerm`; mirror `features/attendance/PayItems.tsx` |
| Configurations | `ToggleRow` or `Switch`, `Card` and `CardHeader`, `KeyValue`, `DataView`, `BandChart`, `MoneyField`, `DateField min={todayIso()}`, `Banner`, `Details` or `HelpTerm` for support text |
| Money, empty, loading | `Money` (`short` only on KPIs), `MoneyField`, `formatMoney`; `EmptyState` (an illustration, a title, at most 8 words, one action), `LoadingRows`, `ErrorState` |

**Amendments to ask for in PR 7 (record them where the Expenses ones are recorded: FRONTEND_FOUNDATION F31, FRONTEND_GUIDE §7 and CLAUDE.md):**

1. **F31 for Payroll · Payslips and ESS · My Payslips.** A payslip opens in the shared Modal at every width (the
   centred dialog on desktop, a bottom sheet on a phone), as an Expenses record does, because TB asked for "a modal"
   (4 Nov) and JBS Praxis settled both screens on 08/11/2026 (§13.1 item 18). Both use `ListDetail` with
   `layout="modal"`; ESS · My Payslips stops placing the payslip beside its list on wide screens. Record the amendment
   where the Expenses one is recorded.
2. **The Advanced Payroll switch opens a form.** FRONTEND_GUIDE §8.1 says a setting that applies at once is a
   switch that saves on change; this one needs an effective date, so pressing it opens a small form with the
   date and saves on Switch On.

**What the prototype taught.** Its explainer cards (`ChainCard note`, `KvCard` rows such as "Automatic? No"), the
footnote under a payslip, `<Button disabled>`, a toast over eight words, a client-computed period
(`new Date().toISOString().slice(0, 7)`), INTERIM rules in `useContractForm` and an Add Deduction button with no
place in the agreed design are all rebuilt, not kept.

### 10.4 Words

Titles: Payroll Runs, Payslips, Deductions, Configurations, My Payslips. Cards: Run History, This Run,
Pending Deductions, Statutory Items, PAYE Bands, Conventions, Bands by Grade, Pay Components. Buttons: New Run, Compute Run,
Add Adjustment, Exclude, Submit for Approval, Approve, Send Back, Reject, Mark Paid, Email All Payslips,
Download All, Download PDF, Email a Copy, Statutory Report, Accept This Month, Spread Over Months, Waive,
Release, Record Advance, Cancel Advance, Switch On, Switch Off, Save Rate, Save Grade. Chips and statuses:
Draft, Computed, Submitted, Approved, Paid; Pending, Active, Settled, Waived; Preview, Published; In the run.
Field errors (at most 4 words): Pick a month, Enter an amount, Give a reason, Pick a start month, Date too early.
Toasts (at most 8 words): "Run opened for October 2026", "Run computed", "Sent for approval", "Payslips are being
emailed", "Deduction scheduled", "Advance recorded". Money is `₦450,000.00` (`formatMoney`), a month "October
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
- **PDF not rendered yet.** ESS shows Preparing and disables Download PDF until `GET …/pdf` stops answering
  `NOT_READY`; a failed render is retried by the document engine and shows in System Health.
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
23. **The pay day is a plain calendar date**: it is never moved for a Sunday or a public holiday (the CEO transfers by
    hand, 4 Nov), and the month-end rule is the only adjustment (§6.11 rule 1).

### 13.3 Still open

| # | Question | Decides | Needed before | Meanwhile |
|---|---|---|---|---|
| 1 | Sign-off of the payslip sample (§13.1 item 20) | TB shows Cynthia | PR 4 | The sample is the draft in `docs/MyCity-ERP-Documents/payroll-samples/`; PR 4 built `templates/documents/payslip.html` from it as drafted (the letterhead supplies the logo, the organisation's line and the date; the number, the month and the person's block are in the body) and it is changed when MyCity answers |
| 2 | What My Payslips' **In the run** means (§5, §10.1; `docs/guides/ess.md` §6, §13) | TB with AJ and LA | PR 7 | §5 and §6.10 rule 3 say the person sees nothing before approval, so `GET /ess/payslips` lists published payslips only and a month still in the approval has no row; §10.1's help text and the ESS guide's edge case say In the run is "waiting for approval". PR 4 returns each payslip's run status (`approved`, `paid`) and `has_deduction`, so a published payslip whose run is `approved` and not yet `paid` can read In the run (the money not yet transferred); if the person should also see a month that is still in the approval, the API needs a row with no figures, which is a change to §6.10 rule 3 |

Answered and moved to §13.1: the approver (item 7), a leaver's instalments and a negative net (16), recurring
allowances (17), the ESS modal (18), staging mail (19), the statutory rates, the accountant's conventions, the pay day
and every person's salary and bank details as configuration (21), who builds the screens (22), when Written is
ticked (23), where the first statutory rates are entered (25), the unpaid flag on leave types (26) and #11's Owner (27).

---

## Appendix A · The build plan

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

### PR 6 · AI, search, Home and notices (`m6/ai-search`)

- `payroll.ai.js` (its reads, summary and the cards after `payroll_runs.create`, which PR 2 carried), `payslips.ai.js`,
  `deductions.ai.js` (the reads, summary, cards and routes of §9); `payslips.search.js`, `deductions.search.js`
  (`payroll.search.js` came with PR 2); the remaining route-map notes removed; the screens' ⌘K entries;
  `npm run gen:ai-catalogue`; the integration test and evaluation case per action key.
- Verify the definition of done's notices: a submitted run produces in-app, push and email for the approver, and
  each link opens the same screen, with a test.
- Done when: gates 9, 10, 19 and 23 pass with payroll's controller filled; no M6 form on `ai-forms-gaps.json`.

### PR 7 · Frontend (`m6/screens`) · LA

- Rebuild `app/src/features/payroll/` as `index.tsx` (a `switch`), `PayRuns.tsx`, `PaySlips.tsx`, `Deductions.tsx`,
  `Configurations.tsx`, `parts.tsx`, `Payroll.test.tsx`; ESS · My Payslips on the contract and the same parts
  (`app/src/features/ess/Payslips.tsx`); the in-browser mock on contract shapes; retire `app/src/api/types/payroll.ts`
  (`npm run contract:status`); `MonthField` in `packages/ui` (header, test, gallery); F31's amendment recorded; every
  form through `useContractForm` with its schema; the PR body's Native app feel section.
- Gates: `npm run fe:typecheck`, `fe:lint`, `fe:test`, `fe:build`; the screen gates at 390 and 1440 px.
- Done when: every screen of §2 works on the real API on both shells and the PROGRESS UI and Mobile columns are ticked.

### PR 8 · Staging seed, User Guide and release check (`m6/release`)

- `seeds/staging/NN_payroll.js` through the services (a locked earlier run, a computed current one with a pending fine,
  an advance and a joiner; test people, no mail sent; following `seeds/staging/lib/home-staging-rows.js`);
  `docs/manual/payroll.md` with its pictures (`npm run guide:shots -- --chapter payroll`, then `--stale`) and a
  Payslips section in the ESS chapter; the empty stubs deleted and off `README.MD` (README §11.5); PROGRESS Status set.
- Done when: Appendix B is ticked end to end on staging.

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
8. On Configurations show the pay day (30 by default) and change it; switch Advanced Payroll on from next month (with test rates entered, or shown
   as not set); next month's run shows the statutory lines and the Statutory Report.

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
  `PayslipEmailAll`; and the pieces they are made of: `RunStatus`, `AdjustmentKind`, `PayeBasis`,
  `ProblemSeverity`, `ProblemCode`, `PayrollRunCounts`, `PayrollTrendMonth`, `PayrollSettingsVersion`.
- `payslips.js`: `Payslip`, `PayslipLine`, `PayslipDetail`, `PayslipListQuery`, `PayslipPage`, `PayslipVars`,
  `PayslipBatchVars`, `EssPayslipQuery`, `EssPayslipSummary`, `EssDeductionRow`, `EssDeductionPage`; and
  `PayslipLineItem` and `PayslipLineItemPage` (the pay items behind a grouped line, §5), `PayslipLineParams`,
  `PayslipEmailQueued` (Email All's 202), `PayslipCopySent` (Email a Copy), `PayslipReadyEmailVars` (the mail's
  variables), `PayslipPrintedLine`,
  `PayslipStatus`, `PayslipLineKind`, `PayslipLineCode`, `EssDeductionSource`.
- `deductions.js`: `DeductionRow`, `DeductionListQuery`, `DeductionPage`, `DeductionSummary`, `DeductionAccept`,
  `DeductionWaive`, `AdvanceRecord`, `AdvanceCancel`; and `DeductionFigure`, `DeductionSource`, `DeductionStatus`
  (a row's status on the tab), `DeductionState` (a `payroll_deduction`'s own) and `InstalmentStatus`.
- `salary_structure.js` (PR 5): `SalaryGrade`, `SalaryGradeListQuery`, `SalaryGradePage`, `SalaryGradeSave`,
  `GradePlacement`, `GradePlacementListQuery`, `GradePlacementPage`, `GradePlacementSave`, `PayComponent`,
  `PayComponentsSave`.
- `statutory.js` (PR 5): `StatutoryRate`, `StatutoryRateListQuery`, `StatutoryRatePage`, `StatutoryRatesSave`,
  `StatutoryReportVars`.
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
- **Frontend:** `app/src/features/payroll/` (the files of PR 7), `app/src/features/ess/Payslips.tsx`,
  `app/src/api/mock/modules/payroll.ts`, `payslips.ts`, `app/src/shell/catalogue.ts`, `coming-soon.ts`,
  `packages/ui/src/form/MonthField.*`.
- **Docs:** this guide, `docs/handoff/m6-payroll.md`, `docs/manual/payroll.md`, `docs/guides/ess.md`,
  `docs/guides/attendance.md`, `docs/DATABASE_SCHEMA.md`, `docs/PROGRESS.md`, `README.MD`.

---

## 14 · Change log

- 09/11/2026 · JP · PR 4 (payslips, the PDF, email and ESS, `m6/payslips`) built `payslips.repo/.service/.breakdown/.pdf/.events/.controller/.routes/.search`, `ess.earnings.js` and the ESS routes, the pay-date helpers in `payroll.config.repo.js`, the two document templates and the mail; the guide meets what was built. Contract: `PayslipLineParams`, `PayslipEmailQueued`, `PayslipCopySent` and `PayslipReadyEmailVars` added (§5, Appendix C); the routes of Email All and Download All stay on the run (§5) and answer 202 with `PayslipEmailQueued` and `ExportFile`. New errors `EMAIL_TOO_SOON` (a copy within a minute of the last mail of a payslip, Email All counting) and `NO_PAYSLIPS` (§5). A sixth write guard `published` (an approved or paid run) is added to the lock, and the five writes that belong on a run that is out (Email All, a payslip's mail, its un-marking, a copy and Download All) are made with it and held by the enumerating test (§6.9 rule 4). The lock requests every payslip's PDF in its own transaction with no actor, so the approver is never the uploader of a person's payslip; 306 requested in 957 ms, so no render job of ours (§6.10 rule 4). Email All marks each payslip emailed in its own transaction and the `payslip.emailed` it records queues the mail (one path for both Email All and Email a Copy), so the handler of §7 marks and the mail is queued by `payslips.mail`; the new events are `payroll_run.email_requested`, `payroll_run.export_requested`, `payslip.emailed` and `payslip.export_requested` (§7). A payslip's PDF and Download All are refused to a reader whose role hides `employee.salary` or `employee.bank` unless the payslip is their own, since the document carries both (§6.10 rule 4, §6.13 rule 3). `GET /ess/payslips/summary` sums the year's published payslips and Next Payday is the first pay date on or after today whose month's run is not paid, with the pay day in force at that month's end (§5, §6.11 rule 1). Gates 9 and 10 hold a filled controller to an AI manifest and a search provider: `payslips.controller.js` carries `ai:none` until PR 6 writes the reads, and `payslips.search.js` answers for `payroll` readers (§9). §13.3 gains question 2: what My Payslips' In the run means, since §5 (published only) and §10.1 (waiting for approval) read differently.

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

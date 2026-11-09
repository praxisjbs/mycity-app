# M6 Payroll & Notifications · Build Tracker

**This file only tracks progress.** Everything M6 builds, and how, is in **`docs/guides/payroll.md`**, the
milestone's single source of truth (its §0). Read the guide in full before any M6 work; this file adds no
requirement and settles no decision. Tick a line when it is done, with the date, and add a line to §3.

| | |
|---|---|
| Source of truth | `docs/guides/payroll.md` (Status Agreed, 08/11/2026) |
| Build plan | The guide's Appendix A (PR 0 to PR 8, lanes and order) |
| Owner | TB (Tom-Blake Asaah) owns the milestone and its backend; LA (Love Adeola) builds the screens (guide §13.1 item 22, JBS Praxis, 09/11/2026) |
| Type | Full stack (CLAUDE.md step 1) |
| Demo | Fri 27 Nov 2026 (MILESTONES §4) |
| Pull requests | PR 0 (this documentation) merged as praxisjbs/mycity-app#100 on 09/11/2026 (`1352338`); PR 1 (contract, data and scaffolding) merged as praxisjbs/mycity-app#102 on 09/11/2026 (`3b4c382`); PR 2 (calculation and the run) merged as praxisjbs/mycity-app#104 on 09/11/2026 (`a0b19fd`); PR 3 (deductions and advances, with the Deductions screen) on branch `m6/deductions`, praxisjbs/mycity-app#105, a draft |

---

## 1 · How to continue

1. Read `docs/guides/payroll.md` in full, then what CLAUDE.md step 2 lists for your task type and the guides your
   PR names in the guide's Appendix A.
2. Take the next PR whose predecessors are merged (the guide's Appendix A, "Order and lanes"). Branch from `main` as
   it names (`m6/<short-name>`).
3. Build it to the guide. If the guide is wrong or silent, change the guide first, in the same PR, with a Change
   log line. Never re-open its §13.1.
4. Run `npm run ci` on the Node major `.nvmrc` names. Tick the PR's lines below with the date, add a log line,
   mark the PR ready.

**In one paragraph.** Payroll is a monthly run of simple pay (monthly gross, attendance and fine deductions,
advances, adjustments) computed per person, submitted to the CEO, locked on approval and published as payslips
to Employee Self-Service and by email; PAYE, pension, NHF, ITF and NSITF and salary grades exist but are built
and shipped off behind a switch on Configurations. As of 08/11/2026 nothing but a mock exists in code: every
`payroll`, `payslips`, `deductions`, `salary_structure` and `statutory` file is empty, no 6000-block migration
exists, and the payslip template is empty.

**Things every session needs** (from the earlier milestones' lessons; the guide is the authority):

- Integration tests need PostgreSQL 16 **with pgvector** and Redis (BACKEND_GUIDE §8.4);
  `.claude/hooks/session-start.sh` starts them in a cloud session. Without them the integration files and gate
  4's round trip are skipped and CI runs them.
- Several tests hard-code each role's capabilities and the numbering totals
  (`tests/integration/settings.test.js`, `home-schema.test.js`); a new capability, scheme or migration updates
  them.
- `npm run gen:contract` and `npm run gen:ai-catalogue` after any contract change; never export one schema under
  two names.
- `npm run new:screen` only adds a tab; PR 1 removes and renames Payroll's tabs by hand across the files the guide
  lists. The screens' PROGRESS count is the `SCREENS` constant in `scripts/check/progress.js`.
- The donors (`C:\pixie-girl-hub`, `C:\praxis-ls`) are not in a cloud container; ask for a file, and never write
  where code came from.

## 2 · Checklist

### PR 0 · The guide
- [x] Guide written from MILESTONES §11, the 4 November Modules Review transcript, the 10 October and 2 September
      meetings, JBS Praxis's answers and the built code, standalone as the source of truth (08/11/2026)
- [x] MILESTONES §11 amended (08/11/2026)
- [x] `docs/guides/ess.md` payroll lines updated; a pointer in `docs/guides/attendance.md` §6.17 (08/11/2026)
- [x] Guides index row, the guide's CODEOWNERS line, `docs/DATABASE_SCHEMA.md` M6 pointer, PROGRESS note (08/11/2026)
- [x] JBS Praxis's second round of answers recorded in the guide (§13.1 items 7 and 15 to 20), MILESTONES §11 and
      the ESS guide: the CEO alone approves; a leaver's final run takes every outstanding instalment and a negative
      net blocks Submit; no recurring allowances in simple mode; both payslips as modals; staging demos with test
      people (08/11/2026)
- [x] The payslip sample drafted (`docs/MyCity-ERP-Documents/payroll-samples/payslip-sample.html` and its README,
      listed in `docs/MyCity-ERP-Documents/INDEX.md`) (08/11/2026)
- [x] Written ticked for `payroll.md` in `docs/guides/README.md` after praxisjbs/mycity-app#100 merged (JBS Praxis, 09/11/2026) (09/11/2026)
- [ ] TB shows MyCity the payslip sample and records the answers (guide §13.3 item 1; the README lists what to confirm)
- [x] The statutory rates, the accountant's conventions, the pay day and every person's salary and bank details are
      configuration MyCity enters in the app (guide §13.1 item 21); LA builds the screens (item 22) (09/11/2026)

### PR 1 · Contract, data and scaffolding
- [x] Contracts for the simple mode (`payroll.js`, `payslips.js`, `deductions.js`), `gen:contract` (09/11/2026)
- [x] Migrations `6000`, `6010` (with the `attendance_pay_item.payroll_run_id` foreign key), `6030`; seed `6099` (09/11/2026)
- [x] `payroll.run` in `DEFAULTS`, `payroll.configure` in the capability catalogue, `employer_cost` in the field mask (09/11/2026)
- [x] The four tabs in the route map, ⌘K screens, Coming Soon, catalogue and their tests; PROGRESS #47 and #49 Dropped,
      Configurations added as #109, the Payroll screens' Owner set to LA (#11 keeps AJ, guide §13.1 item 27), `SCREENS` and the counts; MILESTONES §18's Payroll row (09/11/2026)
- [x] `payroll_setting` carries the option columns (Pay Day, default 30 and 1 to 31 with the month-end rule; Bank Details Required; the three conventions) (09/11/2026)
- [x] DATABASE_SCHEMA M6 as built; README §5.2 and §5.9; gates 3 to 6 green (09/11/2026)
- [x] `npm run ci` green on the PR head and the PR marked ready; not merged until JBS Praxis says so (09/11/2026)

### PR 2 · Calculation and the run
- [x] `payroll.calc.js`, `.inputs`, `.run`, `.lock`, `.config.repo`, repo, service, controller, routes (09/11/2026)
- [x] `attendance.pay.takeIntoRun`, `releaseFromRun`, `monthRates` (LA's review); `sanctions.fines.release` (GE's) (09/11/2026)
- [x] `payroll.events.js`: events, `payroll.apply_decision`, notices; Home's source and card live (09/11/2026)
- [x] The worked example of guide §6.14 to the kobo; idempotent Compute; every write behind `assertEditable`;
      Submit freezes and Send Back releases; `RUN_CHANGED`; concurrency; an end-to-end run (09/11/2026)
- [x] Compute measured for 300 people (decides the job stubs, guide §13.2 item 3): 550 ms for 308 people, so no
      `payroll-compute` job and both stubs go in PR 8 (09/11/2026)
- [x] Carried from PR 6 by the gates: the card `payroll_runs.create`, `payroll.search.js` for `payroll_run` (09/11/2026)
- [x] `npm run ci` green locally on Node 20, all 52 gates (09/11/2026): the full run passed 51 and its one failure, an unhandled Radix timer error from `Categories.test.tsx` under four groups' load, passed on its own re-run (`--only=fe-test`)
- [x] The PR marked ready and merged as praxisjbs/mycity-app#104 (`a0b19fd`) (09/11/2026)

### PR 3 · Deductions and advances
- [x] The paged union, accept, spread, waive, release, record and cancel an advance, routes, events, notices (09/11/2026)
- [x] Tests: instalments and kobo, `OWN_RECORD`, `INSTALMENTS_STARTED`, an advance through two runs (09/11/2026)
- [x] The Deductions screen on desktop and phone, on the contract, with its mock in the contract's shapes (JBS Praxis asked for it in
      this pull request, 09/11/2026; guide Appendix A, PR 3) (09/11/2026)
- [x] The guide, PROGRESS (#48, API ticked), README §5.9 and this tracker match what was built (09/11/2026)
- [x] `npm run ci` green locally on Node 20, all 52 gates (09/11/2026): the first full run passed 50 and failed two (⌘K's action list lacked Record Advance; the delivery-plan test still held Payroll back on staging), both fixed, and the second full run passed all 52
- [ ] The PR marked ready (it stays a draft until JBS Praxis says so); not merged until then

### PR 4 · Payslips, the PDF, email and ESS
- [ ] Payslip service, breakdown, doc types and variables, routes, the ESS routes
- [ ] `payslip.html` (from the signed-off sample), `payslip-batch.html`, `payslip-ready.html`
- [ ] Email All (once per person, `resend`), Download All, Email a Copy; masks and the restricted file

### PR 5 · Configurations and the advanced option
- [ ] `6020`, the advanced contracts, `salary_structure` and `statutory`, `computeStatutory`, the report template
- [ ] The settings route with `payroll.configure` (the conventions, `NO_RATES`, `NO_CONVENTIONS`); the employee tax
      and pension columns through `organisation`
- [ ] Tests on labelled test rates; no rate, band or grade in any seed

### PR 6 · AI, search, Home and notices
- [ ] Reads, summary, cards and routes; search providers; route-map notes removed; `gen:ai-catalogue`
- [ ] A test and an evaluation case per action; the Submit notices checked in-app, push and email
- [ ] Gates 9, 10, 19 and 23 green; no M6 form on `ai-forms-gaps.json`

### PR 7 · Frontend (LA)
- [ ] `features/payroll/` rebuilt (the four tabs), ESS · My Payslips on the contract, the mock in contract shapes
- [ ] `MonthField`; F31 amended for both payslips (Payroll · Payslips and ESS · My Payslips in a modal at every
      desktop width); every form on `useContractForm`
- [ ] Screen gates at 390 and 1440 px; PROGRESS UI and Mobile ticked; the PR body's Native app feel section

### PR 8 · Staging seed, User Guide, release check
- [ ] `seeds/staging/NN_payroll.js` through the services (test people, no mail)
- [ ] `docs/manual/payroll.md` with pictures, a Payslips section in the ESS chapter, no stale picture
- [ ] Empty stubs deleted and off `README.MD`; PROGRESS Status set
- [ ] Guide Appendix B ticked end to end on staging

## 3 · Log

- 09/11/2026 · JP · PR 3 built (`m6/deductions`, a draft), the Deductions screen included. Backend: `deductions.repo` (the paged union of waiting attendance deductions, fines and advances, filtered and sorted in SQL, pending first by default, and the figures), `.acceptance` (Accept This Month and Spread Over Months by `allocate`, Waive, Release, Record Advance, Cancel Advance; never their own; `INSTALMENTS_STARTED`), `.service`, `.controller`, `.routes` (7 routes under `/deductions`), `.events` (five events, "Deduction Scheduled", "Fine Waived", and "Fine Waiting for Payroll" from an outbox handler on `sanction.issued`), `.ai` (one route) and `.search`. Payroll's lock gained `openPeriod`, `lockRunsOf` and `lockMonths`: a deduction write takes the runs of its months first and its own rows after, so a Compute or a Submit never reads between it and its commit. Contract: `salary_set` on a row, `open_period` on the summary, `FineParams`. Decisions, each in the guide's Change log: a start month is the open month or later and never one with a run already sent (`START_NOT_ALLOWED`); a fine too small for a kobo a month is refused (`TOO_MANY_MONTHS`); a cancelled advance tells no one; a recorded advance is `.accepted` with its source; the person's notice link opens My Payslips. Screens: the request that opened this PR asked for the screens on desktop and phone, and PR 2's entry above records that the same request was then answered by the guide (PR 7 is LA's, §13.1 item 22); this time the Deductions screen is built, at JBS Praxis's direction, and nothing else of PR 7 is. `app/src/features/payroll/Deductions.tsx` (the four figures each opening its list, status chips and a source switch, `ListDetail` with the record beside the list on desktop and in a sheet on a phone, the forms on the contract's schemas, Record Advance opened by `?action=advance` and the phone's floating button), the mock rebuilt in the contract's shapes (it carried a prototype's `/payroll/deductions` routes), the prototype's Deductions and its INTERIM types deleted. No `MonthField`: the start month is a select of the months from the summary's `open_period`. Tests: `src/modules/deductions/deductions.test.js` (12, no database: the kobo of every spread, the flags a row offers, the routes' grants), `tests/integration/deductions.test.js` (24, real migrations over HTTP: the union, its filters and paging, accept, spread, waive, release and advance with their refusals, the notices, a month's Submit freezing instalments and Send Back giving them back, an advance carried through two approved runs and settled, masks, ⌘K) and `app/src/features/payroll/Deductions.test.tsx` (8, on the mock). (praxisjbs/mycity-app#105.) PROGRESS #48: API ticked; UI and Mobile stay unticked until the screen has been checked on the real API on staging (F14 opens it there as soon as API is ticked). Next: PR 4 (payslips and the PDF) and PR 5 (the advanced option); PR 7 builds the other four screens around this one.
- 09/11/2026 · JP · PR 2 built (`m6/run`, a draft): the run end to end on the real migrations. `payroll.calc.js` (pure: proration, the daily rate rounded once, instalment shares, the lines of a payslip, totals), `.config.repo` (the setting as of a date, the default pay day 30), `.inputs` (everyone paid in a month and their attendance items, unpaid leave and suspension and instalments, read in batches), `.lock` (`assertEditable`, `defineWrite` and its registry, the lock `applyApproval` and `returnToDraft`), `.run` (open, compute, exclude and include, adjustments, submit, discard, mark paid), `.repo`, `.service`, `.controller`, `.routes` (14 routes under `/payroll/runs`), `.events` (13 events, the three approval handlers `payroll.apply_decision`, `payroll.apply_withdrawal` and `payroll.sent_back`, "Your payslip is ready"). In other modules: `attendance.pay` gains `takeIntoRun`, `releaseFromRun`, `monthRates`, `monthContext` and `pricesOf` (and `ratesFor` now calls `monthRates`), `sanctions.fines.release`. Home's Payroll In Progress is live (`payroll.source.js`, `tiles/finance.js`). Decisions, each in the guide's Change log: `PayrollRunInclude` and `PayrollAdjustmentParams` added to the contract (the include route had no body); Submit on a Draft is `RUN_NOT_COMPUTED`, an empty month `NO_ONE_TO_PAY`; a refused Submit commits its recompute first and `RUN_CHANGED` carries the totals; a run reports problems only while Draft or Computed, and an advanced run reports No Rates Set until PR 5; a leaver's instalments are those of a person whose `left_on` is on or before the month's last day; Compute stays inline, measured at 550 ms for 308 people (no `payroll-compute` job, both stubs go in PR 8). Gates 9, 10, 19 and 23 hold a module to its AI manifest and provider from the day its controller is filled, so PR 2 carries `payroll_runs.create` (with its test and evaluation case, `gen:ai-catalogue`) and `payroll.search.js` for `payroll_run`; PR 6 adds the rest. No screen was built (PR 7 is LA's, guide §13.1 item 22): the request that opened this PR asked for screens, and Appendix A's PR 2 has none, so the guide was followed. Tests: `src/modules/payroll/payroll.test.js` (49, no database: the worked example to the kobo, proration, rounding, the guard on every write), `tests/integration/payroll-run.test.js` (26, real migrations over HTTP: a run from New Run to Mark Paid, Send Back, Reject, Discard, concurrency, masks, the owners' functions, Home's card, 300 people), and the Home tests that treated the card as hidden. Next: PR 3 (deductions and advances), PR 4 (payslips and the PDF) and PR 5 (the advanced option) in any order; PR 7's screens can start on the contract.
- 09/11/2026 · JP · PR 1 built (`claude/lucid-meitner-c4eh9j`, praxisjbs/mycity-app#102, ready for review; the whole `npm run ci` passed, 52 gates): the simple-mode contract (`payroll.js`, `payslips.js`, `deductions.js`, `common.js` gains `positiveMoney` and `monthStart`), migrations `6000` (setting, run, payslip, line, adjustment), `6010` (deduction, instalment, the `attendance_pay_item` foreign key, `ON DELETE SET NULL`) and `6030` (`leave_type.unpaid`), seed `6099` (the `payroll.run` approval, `payroll.configure`, the Unpaid flag; nothing else), the definition, the capability, `employer_cost` and `account_last4` in the field mask, the four tabs everywhere they are listed, PROGRESS (#47 and #49 Dropped, #109 Configurations, Owner LA on #45, #46, #48 and #109, `SCREENS` 109, 105 screens), MILESTONES §18, DATABASE_SCHEMA M6, README. Tests: `tests/integration/payroll-schema.test.js` (21: shape, constraints, numbers, seed both ways, UP/DOWN/UP), `tests/unit/payroll-contract.test.js` (18), the capability lists in `settings.test.js` and `home-schema.test.js`, the screen count in `events-workflow.test.js`. Decisions taken, each in the guide's Change log: a fine may be accepted again after Release (unique among live deductions), `PayrollSettings.advanced_has_been_on`, `account_last4` masked as bank. JBS Praxis answered the three open points the same day (guide §13.1 items 25 to 27): the first statutory rates are entered before the option is switched on (for PR 5: Statutory Items and PAYE Bands are always on Configurations and the rates routes work whatever the option's state; the conventions go in the Switch On request); `leave_type.unpaid` stays seed-only until MyCity asks for a second unpaid type; #11 My Payslips keeps its Owner, AJ. The prototype under `app/src/features/payroll/` shows its Salary Structure and Statutory pieces on the Configurations tab until PR 7 rebuilds it. Next: PR 2, the run.
- 09/11/2026 · JP · PR 0 merged as praxisjbs/mycity-app#100 (`1352338`, squashed; the local CI run passed its 50 gates and the backend group after pgvector was installed, and GitHub's `ci` check was green on the head). Written ticked for `payroll.md` in `docs/guides/README.md` as JBS Praxis asked (once the pull request merged). Left for people: MyCity signs off the payslip sample. Next: PR 1, contract and data (guide Appendix A).
- 09/11/2026 · JP · PR 0, pay day: confirmed with JBS Praxis that the pay day defaults to the 30th, configurable 1 to 31, a day past a month's end falling on its last day (guide §13.1 item 24, §6.11 rule 1); the statutory rates and conventions are data entered from a date and only the items and the formula's shape are code (§6.12 rule 7); a person's salary and bank are set on People · Employees' Pay and Bank step, already built (§2). The ESS guide's "27th" and the payslip sample's date moved to the 30th. Documentation only.
- 09/11/2026 · JP · PR 0, third round: JBS Praxis answered the rest. The statutory rates, the accountant's conventions,
  the pay day and every person's salary and bank details are configuration MyCity enters in the app, so none is an
  open question (Configurations gains Bank Details Required and, in advanced mode, three conventions: PAYE basis,
  pension reduces taxable pay, NHF reduces taxable pay; guide §4.2, §5, §6.11 rule 3a, §6.12 rule 1, §6.15, §10.1,
  `NO_CONVENTIONS`). LA builds the screens (PR 7; MILESTONES §4 and §11, the guide's header, CODEOWNERS). Written is
  ticked once the pull request merges, by the first chat after it. The guide's §13.3 holds one question, the payslip
  sample's sign-off. Documentation only.
- 08/11/2026 · JP · PR 0, second round: JBS Praxis answered the open questions (the CEO alone approves; a leaver's
  final run takes every outstanding instalment and a negative net blocks Submit; no recurring allowances in simple
  mode; both payslips in a modal; staging demos with test people; the payslip sample drafted; the guide stays Agreed).
  Recorded in the guide (§13.1, §10.3, Appendix A and B, its Change log), MILESTONES §11, the ESS guide's §10.2 row,
  this tracker and PROGRESS; the sample, its README and an INDEX row added under
  `docs/MyCity-ERP-Documents/payroll-samples/`. Documentation only. Left open for people: TB reads the guide and ticks
  Written; MyCity signs off the sample; the statutory rates, the pay day, every person's salary and bank details, and
  who builds the screens.
- 08/11/2026 · JP · PR 0: `docs/guides/payroll.md` written as M6's single source of truth (the rules, the data, the
  API, the screens, the build plan, the demo); this tracker; MILESTONES §11 amended with the 4 November and 08/11
  decisions; `docs/guides/ess.md` and `docs/guides/attendance.md` brought into line; the guides index, CODEOWNERS,
  DATABASE_SCHEMA and PROGRESS pointed at the guide. Documentation only; no code, migration or screen changed.
  Next: TB reads the guide and shows MyCity the payslip sample; PR 1.

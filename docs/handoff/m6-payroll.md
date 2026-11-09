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
| Pull requests | PR 0 (this documentation) is on `claude/cool-goldberg-uszqmn`, not opened; no other PR yet |

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
- [ ] **After this pull request merges**, the first chat ticks Written for `payroll.md` in `docs/guides/README.md` (JBS Praxis, 09/11/2026; not before)
- [ ] TB shows MyCity the payslip sample and records the answers (guide §13.3 item 1; the README lists what to confirm)
- [x] The statutory rates, the accountant's conventions, the pay day and every person's salary and bank details are
      configuration MyCity enters in the app (guide §13.1 item 21); LA builds the screens (item 22) (09/11/2026)

### PR 1 · Contract, data and scaffolding
- [ ] Contracts for the simple mode (`payroll.js`, `payslips.js`, `deductions.js`), `gen:contract`
- [ ] Migrations `6000`, `6010` (with the `attendance_pay_item.payroll_run_id` foreign key), `6030`; seed `6099`
- [ ] `payroll.run` in `DEFAULTS`, `payroll.configure` in the capability catalogue, `employer_cost` in the field mask
- [ ] The four tabs in the route map, ⌘K screens, Coming Soon, catalogue and their tests; PROGRESS #47 and #49 Dropped,
      #107 added, the Payroll screens' Owner set to LA, `SCREENS` and the counts; MILESTONES §18's Payroll row
- [ ] `payroll_setting` carries the option columns (Pay Day, Bank Details Required, the three conventions)
- [ ] DATABASE_SCHEMA M6 as built; README §5.9; gates 3 to 6 green

### PR 2 · Calculation and the run
- [ ] `payroll.calc.js`, `.inputs`, `.run`, `.lock`, `.config.repo`, repo, service, controller, routes
- [ ] `attendance.pay.takeIntoRun`, `releaseFromRun`, `monthRates` (LA's review); `sanctions.fines.release` (GE's)
- [ ] `payroll.events.js`: events, `payroll.apply_decision`, notices; Home's source and card live
- [ ] The worked example of guide §6.14 to the kobo; idempotent Compute; every write behind `assertEditable`;
      Submit freezes and Send Back releases; `RUN_CHANGED`; concurrency; an end-to-end run
- [ ] Compute measured for 300 people (decides the job stubs, guide §13.2 item 3)

### PR 3 · Deductions and advances
- [ ] The paged union, accept, spread, waive, release, record and cancel an advance, routes, events, notices
- [ ] Tests: instalments and kobo, `OWN_RECORD`, `INSTALMENTS_STARTED`, an advance through two runs

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

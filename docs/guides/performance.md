# Performance Management · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M2 |
| Backend modules | `goals`, `kpis`, `targets`, `reviews` |
| Frontend paths | `app/src/features/performance/`, `app/src/features/ess/Performance.tsx` |
| Permission key(s) | `performance`; `ess` for My Performance; `workspace` for commitments, Counts Towards and the weekly summary |
| Capabilities | `goals.organisation` (record the organisational goals), `goals.company` (set the company objectives and key results), `goals.function` (set a function's objectives, key results and KPIs and send its quarter plan), `goals.confirm` (confirm the month's key result scores), `performance.manage` (run the cycle: quarters and their rules, monthly rounds, reviewer changes, conduct, PIPs, probation outcomes, imports) |
| Screens (PROGRESS.md rows) | #29 Goals, #30 Targets (labelled Scorecards), #31 KPIs, #32 Reviews, #33 Analytics, #10 My Performance |
| Status | Agreed |
| Last changed | 22/10/2026 |

Sources, all read in full on 22/10/2026: MyCity's own **MyCityApp Q4 2026 OKRs V2** workbook (11
sheets: the CEO's decisions, Company OKRs, the Q4 Scorecard roll-up, the four function sheets with
their operational KPIs, the Q4 Target Build, the phasing to Q3 2027, the change map of old to new
IDs, the priority mapping) and **MyCityApp Q4 2026 Individual Scorecards** workbook (the guide, the
staff register, the contribution map, 16 scorecards); the **Weekly Team Progress Tracker**; the
**Monthly Work Report** template; the **Employee Handbook 2026** §2.6 and §4; the **Org Chart
(October)**; the Q3 **caution** letter; the meetings of 2 September (discovery), 10 October
(requirements, the PMS meeting) and 12 October (demos, kickoff); MILESTONES §1.3 (A16 to A18, A24)
and §7; REUSE_MAP §3.2; and **TB's 22 answers of 22/10/2026** (§1.1). Two documents Cynthia named on
10 October were never received: her paper review form and the 2026 Organisational Goals and
Targets sheet (§13). An earlier design built on MILESTONES alone (AJ, 19 and 20/10/2026, commit
`d820732`) was withdrawn on 21/10/2026 because it did not follow MyCity's sheets; nothing of it is
on `main` and this guide does not build on it. `demo.html` is a visual reference only.

---

## 1 · What it is for

MyCity already runs a complete performance system, in two spreadsheets: company and function OKRs
whose key results feed one another, operational KPIs with formulas, a scorecard for every person
(Results 60%, KPIs 25%, Accountability 15%), fixed 0 to 1 scoring rules, rating bands, a commitment
register and monthly reporting deadlines. The sheets already disagree with each other (scorecards
cite retired key result IDs and old targets), the weekly tracker and monthly report are free text,
and the review form is paper. The Performance Management System makes that system live, linked and
quick, **without changing how MyCity works**: their sheets are the source of truth (P1).

It runs on one rhythm with three horizons:

| Horizon | What | Who sets it | When |
|---|---|---|---|
| Plan year | Organisational goals | CEO alone | Once a year (the plan year runs Q4 2026 to Q3 2027) |
| Quarter | Company objectives and key results | CEO and Management | Before the quarter; binding on the CEO's approval |
| Quarter | Each function's objectives, key results and KPIs, and every scorecard in it | Function head and managers | One plan per function: the head's line manager, then Operations & People, then the CEO (P7) |
| Quarter | Scorecard agreement | Employee and reviewer | One tap each (P8) |
| Month | Commitments | Each person, agreed with their reviewer; heads with the CEO | By the 3rd business day (P10) |
| Month | Check-in: actual, evidence and action per line | Each person | By the 2nd business day; heads by the 3rd (P15) |
| Month | Function report: key results and KPIs | Function head | By the 3rd business day; the CEO confirms scores at the monthly review |
| Month | Review | Reviewer, then second level, then Operations & People | By the 5th, 7th and 10th business day (P12) |
| Week and day | Tasks | Line manager sets, employee adds (A24) | My Workspace |

Every employee uses My Performance (agree, check in, see their score) and their task board. Line
managers use Scorecards and Reviews. Function heads use Goals and KPIs and send their plan. The CEO
approves, confirms scores and reads Analytics. Operations & People run the cycle, close reviews and
handle PIPs and probation. The Program Manager approves the plans of the functions under them and
reviews those heads.

### 1.1 Decisions (TB, 22/10/2026, binding)

| # | Question | Answer |
|---|---|---|
| P1 | Source of truth | **MyCity's two Q4 workbooks.** We align to them and add structure and clarity with the least friction; their words, codes, sections, weights and rules are kept |
| P2 | The cascade (A16) | Organisational goals (CEO) → company OKRs → function OKRs and operational KPIs → individual scorecards (each line linked to a key result or KPI) → monthly commitments → weekly and daily tasks. A16's levels map onto it: annual goal = company objectives and key results; monthly target = monthly commitments; departmental = function objectives and key results; individual KPI = scorecard lines; weekly and daily tasks = Workspace. MILESTONES §7 is amended to record the mapping |
| P3 | Period | **Quarter plan, monthly scores.** October and November scores are progress against the full quarter; December is the quarter's final; the year is a roll-up of its quarters |
| P4 | Departments | Department = function, one nomenclature everywhere (People, Home, Attendance, Performance, the staff sheet): **General Management, Technology & Back-office Ops, Branding & Marketing, Partnership & Growth, People & Culture**. Names are data, referenced by id, editable on People without breaking anything. Checked against the Org Chart (October): each maps onto it (§6.20) |
| P5 | Org corrections | The staff list is newer than the chart. Adopt the chart's job titles (Backend Operations Manager, Growth Officer · State, Graphics Associate, Head, Strategy, Partnerships & Growth); add the chart's vacant seats (HR/Admin Associate; Growth Officer for Anambra, Ekiti, Edo, Delta, Cross River); **David Idowu-Agida reports to Chinyere Elechi**. Abubakar Mohammed no longer works at MyCity and is **not** added: the seated 'Head Sales & Revenue' is retitled Head, Strategy, Partnerships & Growth and stays vacant |
| P6 | Scoring rules | **Both rule sets stay, configurable**: key results score by the OKR workbook's rules, scorecard lines by the scorecard workbook's rules (§6.8, §6.9). Operations & People change them per quarter |
| P7 | Plan approval | **One plan per function per quarter**: the function's objectives, key results, KPIs and every scorecard in it, sent by the head. Stage 1 the head's line manager (the Program Manager for Branding & Marketing, Partnership & Growth and People & Culture; the CEO for Technology & Back-office Ops), stage 2 Operations & People, stage 3 the CEO. Only the CEO makes it binding. A stage that would ask the same person twice is skipped |
| P8 | Scorecard agreement | **One-tap Agree Scorecard** for the employee and the reviewer, recorded and audited; Disagree With Reason returns it to the reviewer. No drawn signature |
| P9 | Changing a target | **A change request to the CEO** (new target, reason). On approval the new target applies, the original stays visible beside it and scores already given are not rewritten. A provisional target shows TBC until the quarter's lock date (7 November for Q4) |
| P10 | Commitment register | **Commitments are Workspace tasks** marked Commitment, with acceptance criteria, plus a filtered **Commitments view under Performance** that deep-links to each task and back |
| P11 | Tabs | The five approved tabs stay; **Targets is relabelled Scorecards** (slug `targets` unchanged) with a Scorecards and Commitments switch; Goals holds the OKR tree |
| P12 | Review chain | **Self, reviewer, second level, HR.** The employee checks in first and the reviewer cannot open it until then (A17); the reviewer's own line manager approves; Operations & People receive and close it. Second level is skipped when the reviewer is the CEO; the CEO's scorecard is self-assessed and marked for the Board |
| P13 | Function heads | **The reviewer is always the effective line manager**: the Program Manager reviews Chinyere, Cynthia and the future Strategy head (CEO second level), the CTO reviews the Backend Operations Manager (CEO second level), the CEO reviews the CTO and the Program Manager. Operations & People may name another reviewer on one scorecard, with a reason |
| P14 | Vacant seat and dotted line | The person above a vacant seat reviews its reports (the Program Manager for Partnership & Growth today); when the seat is filled the new head reviews from the next month. A **dotted-line manager gives input** (a comment the reviewer reads before scoring), never an approval. Operations & People may **name another reviewer, a person or a role**, with a reason |
| P15 | The monthly form | **One monthly check-in** replaces the T-A-V-A update, the Monthly Work Report and the paper form: per line Actual, Evidence and Action; Variance and the month's tasks (done, ongoing, next month) filled by the system; the closed review is a letterheaded PDF. After a dictation, **AI tidies and structures** the text |
| P16 | Self-rating | **Actuals in, factual score proposed.** The employee may change a proposed score with a reason; the reviewer sees both and sets the final. No evidence reads Not Assessable, never zero |
| P17 | Automatic lines | **The system scores what it knows**, and a reviewer may override with a reason: on-time commitments, monthly update on time, team reviews done, the Marketing team result, and every line fed by a function KPI or key result |
| P18 | Workspace | The weekly tracker retires: Workspace builds each person's week from their tasks (done, planned, blocked) with one optional line, Support Needed, and a little AI for clarity. A task can **count towards** a scorecard line or a key result; a key result's dated **initiatives become tasks** for its owner |
| P19 | AI | Both AI features (tidying the check-in after dictation, structuring the weekly summary) use the **Default** job and run **only when the person presses**; speech-to-text uses **Transcription**. Both carry personal data, so **DeepSeek is never in their chains** |
| P20 | Go-live data | **Import the two workbooks** through the import engine (preview, errors, commit, revert), run by Operations & People on production as MyCity's own data; old IDs are mapped through the workbook's change map; October is backfilled |
| P21 | Outcomes | Every missed result carries a **corrective action** (owner, date). A Below rating lets HR start a **PIP**. Someone on probation gets a **Probation Review** at month 3 on the same form (Confirm, Extend 3 Months, End Employment; HR decides). Cautions are issued in Queries & Sanctions (M3), linked from the review. HR marks a confirmed conduct breach, which caps the rating at Partly Meets |
| P22 | Delivery | **Five PRs: two foundations, then three in parallel** (§1.2) |

**Settled by this guide, not asked** (each is reversible; TB may change any at review):

| # | Point | Settled as |
|---|---|---|
| G1 | Codes | Objective, key result and KPI codes are MyCity's positional codes (`CO-O1`, `TBO-KR1.2`, `BM-K07`), built from the department's code and the position in the quarter, frozen when the plan becomes binding. They are labels inside a quarter, not document numbers, so they do not use `numbering.allocate()`. Every link is by id, so a code can change without breaking anything |
| G2 | Business days | MyCity's deadlines count **Monday to Friday, not a public holiday** (their 4 Nov, 3 Dec, 6 Jan). The working week (A22, Saturday worked) is for attendance; performance due dates use business days (§6.2) |
| G3 | Review deadlines | Not in the workbooks. Defaults: reviewer by the 5th business day, second level by the 7th, HR by the 10th. Each is a quarter rule Operations & People change |
| G4 | Emmanuel Aneke | On the chart and the scorecards, not on the staff list. Treated like Abubakar: he has left and Growth Officer · Rivers is a vacant seat. Confirm (§13) |
| G5 | The Program Manager | Has no scorecard in the workbook. The CEO writes one in the General Management plan; until then the Program Manager reviews and approves but is not reviewed |
| G6 | Context in a review | The reviewer sees the month's attendance (on time, late, absent days, from the shared roster) and the recognitions received in Staff Community, read only, never scored (handbook §4.1) |

### 1.2 Delivery

Five pull requests (P22). **PR 1 and PR 2 go in order; PR 3, PR 4 and PR 5 then run in parallel.**
PR 1 writes the whole schema and the whole contract, so the parallel three never need a migration
unless they find a gap; each has its own number block for that. Each PR owns its files (§12, Files
by PR), so the parallel three do not edit the same file; the shared exceptions are named there.

| PR | Branch | Builds | Sections | Migrations | Depends on | Status |
|---|---|---|---|---|---|---|
| 1 · Foundation | `m2/perf-foundation` | The org's names and seats; department heads; the whole schema, contract and scoring library; business days; the second-level approver; the four approval flows; capabilities; quarters and their rules (the first API); screens registered and laid out; the mock | §4, §6.1, §6.2, §6.8, §6.9 (the maths), §6.13, §6.20 | 2100 to 2199 | none | Built 22/10/2026 |
| 2 · Plan | `m2/perf-plan` | Organisational goals, the OKR tree, KPIs, scorecards with the contribution check, the quarter plan and its approval, agreement, target changes and the lock, the three importers; Goals, Scorecards and KPIs screens; Home's goals adapter kept true | §3.1, §3.2, §3.5, §3.6, §6.3 to §6.7, §6.19 | 2200 to 2299 | PR 1 | Built 22/10/2026 |
| 3 · Reviews | `m2/perf-reviews` | Monthly rounds, the check-in, automatic lines, self-first, the reviewer, dotted input, second level, HR close, conduct cap, PDF, corrective actions, PIPs, probation reviews, dictation and Tidy; Reviews tab and ESS · My Performance; Home's reviews adapter kept true | §3.3, §6.10, §6.12, §6.14 to §6.17 | 2300 to 2399 | PR 2 | Built 22/10/2026 |
| 4 · Workspace | `m2/perf-workspace` | Commitments and their approval, the Commitments view and month-end report, Counts Towards, initiatives on the board, the weekly summary with Tidy, performance dates on the calendar, My Commitments on ESS | §3.4, §6.11, §6.18 | 2400 to 2499 | PR 2 | Built 22/10/2026 |
| 5 · Analytics | `m2/perf-analytics` | Performance Analytics; Home's goal progress, Org KPI, Goals On Track, My Scorecard and the Team roster's score; the M2 demo walk | §3.7, §6.21 | 2500 to 2599 | PR 2 | Built 22/10/2026; the demo walk waits for staging |

Until a PR lands, the screens its sections build stay as they are (Coming Soon on production, the
mock on a laptop).

#### Progress: what each PR ticks

The PR that builds an item ticks it here with the date, in the same commit, and moves its row's
Status above and in `docs/PROGRESS.md` (Performance, Build plan). An item not built says why on its
line. Nothing is ticked until it is merged.

**PR 1 · Foundation**

- [x] 22/10/2026 · Org nomenclature and seats in `seeds/staff/` (P4, P5, §6.20): five department names and codes, the chart's job titles (with `roles.json` keys renamed in the same change), the vacant seats, David under Chinyere, the Strategy seat retitled and vacant; departments renamed in place on staging and production (ids kept, nobody moved out), a second deploy changes nothing; `organogram.md` and `foundation.md` updated
- [x] 22/10/2026 · Department head: `department.head_employee_id` or `head_seat_id`, in the contract and the department routes (`head` and `acting_head` on `Department`); `organisation.headOf(department_id)` gives the effective head (the person above a vacant head seat). There is no department form on screen in M2 (organogram guide §4): the staff loader sets the heads
- [x] 22/10/2026 · Migration `2100_performance_foundation.sql` (every table of §4) and reference seed `2190_seed_performance.sql` (capabilities and their default holders, the four approval flows, code lists); gates 3 to 6 green, UP, DOWN, UP on a throwaway database
- [x] 22/10/2026 · Contract: `goals.js`, `kpis.js`, `targets.js`, `reviews.js`, `scoring.js`, and the additions to `ess.js`, `tasks.js`, `calendar.js`, `workspace.js`, `organisation.js`; every `TABLES` entry; `npm run gen:contract`
- [x] 22/10/2026 · Scoring library in `packages/contract/schemas/scoring.js` (§6.8, §6.9, §6.15), pure, with unit tests that reproduce the workbooks' own formulas and the worked examples in §6
- [x] 22/10/2026 · Business days in `shared/time/working-week.js` (`isBusinessDay`, `nthBusinessDay`, `addBusinessDays`) with tests on 4 Nov 2026, 3 Dec 2026, 6 Jan 2027
- [x] 22/10/2026 · Workflow: approver kind `employee_in_context` (§6.13) in `conditions.js` and `approvers.js`, shown on Settings · Approvals; the four flows of §6.4, §6.7, §6.11 and §6.12 in `DEFAULTS` and the seed; engine tests for each condition and skip
- [x] 22/10/2026 · Capabilities (§8): catalogue, seed, `/me`; `check/capabilities.js` green. No button needs one yet: PRs 2 to 5 mirror theirs with `hasCapability`
- [x] 22/10/2026 · Quarters and rules API (`goals.periods.js`, with `GET /performance/periods/:id`): list, current, create (copies the last quarter's rules), change; integration tests
- [x] 22/10/2026 · Route map record types (§9) and the Scorecards label (MILESTONES §18 amendment): app catalogue, `src/shared/search/screens.js`, PROGRESS row #30 renamed
- [x] 22/10/2026 · Module files laid out per §12 (Files by PR); empty stubs not in the plan deleted and taken off README §5.5; the README map updated
- [x] 22/10/2026 · Screens laid out: `index.tsx` tabs, one file per part as §12 lists, each empty part saying which PR fills it; ESS `Performance.tsx` composed of its parts
- [x] 22/10/2026 · Mock in the contract's shapes: a Branding & Marketing quarter laid out as the Q4 workbook does (objectives, key results with October reported, KPIs, the plan, two scorecards, October's round) in `app/src/api/mock/data/performance.ts`, served by `app/src/api/mock/modules/performance.ts` for the periods, OKR tree, scorecards, plans, contributions and rounds. The interim routes whose paths the contract reuses (goals, KPIs, reviews, analytics, ESS) stay until the PR that replaces their screen swaps them
- [x] 22/10/2026 · Docs: this guide's §14, PROGRESS note and Build plan row, DATABASE_SCHEMA M2 Built and Owes, MIGRATIONS if a rule needed it

**PR 2 · Plan**

- [x] 22/10/2026 · Organisational goals (`goals.organisation`): create, edit, close; quarterly targets per quarter; Home's `goals.source.js` kept true to what is written (its cascade, statuses and indexes paid; progress is PR 5's). New Goal on screen records one; Edit Goal and Delete Goal on the goal's sheet came after PR 5 (§14), close is through the API
- [x] 22/10/2026 · Objectives and key results (`goals.company`, `goals.function`): draft editing, codes (G1), links to company key results, Scored From, accountable and co-accountable, TBC, the trace (`goals.authority.js` says who may set what)
- [x] 22/10/2026 · Initiatives: a key result's dated initiatives created as tasks for its owner through the tasks service (`entity_type` `key_result`), by the OKR workbook import; the key result's panel lists them
- [x] 22/10/2026 · Report Month (§6.8): the head's key results and KPIs for the month in one save; Confirm Score (`goals.confirm`); a score below 0.4 requires a recovery owner and date
- [x] 22/10/2026 · KPIs (§6.5): create and edit for a function, monthly actuals with Met, Not Met or N/A, the lines that use each
- [x] 22/10/2026 · Scorecards (§6.5): draft, lines by section with weights, measures and sources, Copy Last Quarter and Copy From Colleague (the API; New Scorecard on screen offers Last Quarter or Start Blank), reviewer resolution and override (person or role, with reason), dotted input default
- [x] 22/10/2026 · Contribution check (§6.5): shares against each split key result, OK or Rebalance; a plan cannot be sent while one reads Rebalance
- [x] 22/10/2026 · Quarter plan (§6.4): assemble, send, `performance.plan` with its conditions, Request Changes, binding on the CEO's approval (objectives, key results, KPIs and scorecards together); each stage decides on Goals · Waiting On You (built after PR 5, see §14)
- [x] 22/10/2026 · Agreement (§6.6): Agree Scorecard and Disagree With Reason, notices and the agreement reminder (`scorecard_agree_due`, scheduled when the plan binds)
- [x] 22/10/2026 · Target change and lock (§6.7): the request, `performance.target_change`, the `targets-lock` job on the lock date, history beside the target
- [x] 22/10/2026 · Import (§6.19): the `extract` hook in `shared/import` (GE reviews), importers `okr_workbook`, `okr_kpis`, `scorecards`, with aliases from the change map; tests on the copies staging loads (`seeds/staging/performance/`: the sheets the importers read, see §14)
- [x] 22/10/2026 · Screens, both shells: Goals, Scorecards (the Scorecards view and a scorecard), KPIs; ⌘K actions New Goal, Report Month, New Scorecard and New KPI
- [x] 22/10/2026 · AI reads `goals.ai.js`, `kpis.ai.js`, `targets.ai.js` (scorecards); search providers for key results, objectives, organisational goals, KPIs, scorecards
- [x] 22/10/2026 · Staging seed `seeds/staging/45_performance_plan.js`: Home's forward rows removed (`removeHomeStagingRows`), Q4 2026 loaded through the services from the workbooks; Home's seed tests updated
- [x] 22/10/2026 · Docs and progress: #29, #31 and the Scorecards half of #30 ticked; this guide's §14

**PR 3 · Reviews**

- [x] 22/10/2026 · Monthly rounds (§6.12): job `review-cycles` (handler `review-cycle-open`) opens each month's round on the next month's first business day, with one review per binding scorecard and the due dates of §6.2; Open Round and Close Round. A round reviews only the scorecards bound by its month's end (a plan's `binding_at`, or an amendment's approval)
- [x] 22/10/2026 · Check-in (§6.12, §6.14): actual, evidence and action per line; proposed scores; self score with reason; automatic lines (`targets.progress.js`, §6.10); the month's tasks from Workspace; Save Draft, Submit Check-In; Add Evidence uploads a file as a line's evidence (`POST /ess/performance/check-in/evidence`, purpose `performance_evidence`)
- [x] 22/10/2026 · Self first (A17): the reviewer gets 409 `CHECK_IN_FIRST` and none of the content until the check-in is in
- [x] 22/10/2026 · Reviewer: final scores, override reasons, corrective actions as tasks, Ask For Input and Give Input, Submit Review opening `performance.review`; Return Check-In. Score Without Check-In (§11) was built after PR #130 (§14)
- [x] 22/10/2026 · Second level and HR (§6.12): approve or Request Changes; Close Review on HR's approval; Mark Conduct; score to date and rating kept on the scorecard; the letterheaded PDF through `documents.generate()`
- [x] 22/10/2026 · PIP (§6.16): Start PIP from a Below review, its lines, review date and reminder, Close PIP with its outcome
- [x] 22/10/2026 · Probation review (§6.16): opened on `employee.probation_ending`; Confirm, Extend 3 Months or End Employment through `organisation.service`
- [x] 22/10/2026 · Dictation and Tidy (§6.17): actions `review-dictation` (Transcription) and `review-cleanup` (Default) registered with `chosen_by` TB, `chosen_at` 2026-10-22, `personal_data` true; prompts; `VoiceField`
- [x] 22/10/2026 · Reminders (§7): check-in due, review due, HR close, PIP review, and `kr_report_due` (the heads' monthly report, left by PR 2)
- [x] 22/10/2026 · Mid-quarter scorecards (§11, left by PR 2): a manager drafts a scorecard for someone who joins after the plan binds (PR 2 refuses it with 409 `PLAN_NOT_OPEN`), and Send Scorecard opens a plan amendment, a new `performance.plan` instance holding only that scorecard, which binds it on approval; touches `targets.service.js` `create` and `goals.approval.js`, so say so in the PR
- [x] 22/10/2026 · Screens, both shells: Reviews (the round, Waiting On You, the list, a review) and ESS · My Performance (everything but My Commitments); ⌘K action Start Check-In
- [x] 22/10/2026 · AI read `reviews.ai.js` (stages and scores only); `reviews.search.js`; PIPs `search:none` with the reason
- [x] 22/10/2026 · Home's `reviews.source.js` kept true to the new stages (Reviews Due, My Reviews Due), its OWES cleared
- [x] 22/10/2026 · Staging seed `seeds/staging/46_performance_reviews.js`: October's round with reviews at every stage
- [x] 22/10/2026 · Docs and progress: #32 and #10 ticked; this guide's §14
- [x] 22/10/2026 · After PR #130 (§14): a mid-quarter scorecard decided on Goals › Waiting On You and on its sheet; a scorecard opened from its link; Change Target on a line; Score Without Check-In; a leaver's review closed as Withdrawn (migration 2310), and Withdraw Review

**PR 4 · Workspace**

- [x] 22/10/2026 · Commitments on tasks (§6.11): Mark as Commitment, Acceptance Criteria and Month on the task form; Send Commitments (`commitment_set`, `performance.commitments`; a month sent by its own reviewer is approved as sent); approval fixes the original date, and the mark, month and criteria with it; a moved date keeps the original; Rescope by approval; states worked out on every read; a missed one gets its recovery task through Set Recovery, its owner and date chosen by a person (the CEO KPI is a recovery decision), not made by itself
- [x] 22/10/2026 · Commitments view on Performance · Scorecards (P10): the month, Department and State filters and Search People, all kept in the address; the figures; Waiting On You with Approve Month and Request Changes; a row opens its task and Back returns to the same filtered list
- [x] 22/10/2026 · Month-end delivery report (§6.11): Export Report on the Commitments view, a summary sheet and one sheet per function in the reader's scope, made by the worker through `shared/documents/exports`. It is made when asked: the 3rd business day is the CEO's deadline, not a schedule
- [x] 22/10/2026 · Counts Towards (§6.18): the task form's picker of the assignee's scorecard lines and the key results they own (`GET /tasks/counts-towards`, 25 a page); `linkFor("target", …)`; lines measured in tasks are counted on every read (`tasks.service.doneTowards`), so there is nothing stored to recount: `task.completed` and `task.reopened` carry the line and the month for whoever listens
- [x] 22/10/2026 · Weekly summary (§6.18): My Week and Team This Week on Today, Support Needed, Tidy With AI (action `week-summary`, Default, `chosen_by` TB, `chosen_at` 2026-10-22, `personal_data` true), which changes nothing until Use Summary
- [x] 22/10/2026 · Performance dates on the calendar (§6.18): check-in due, reviews to write, key result finish dates for their owner, PIP review dates. The first two show once PR 3 opens rounds
- [x] 22/10/2026 · My Commitments on ESS · My Performance (`app/src/features/performance/my/MyCommitments.tsx`, §12), placed on the page as its icon card and its desktop card (two lines in `app/src/features/ess/Performance.tsx`, PR 3's file, named in the PR)
- [x] 22/10/2026 · `docs/guides/workspace.md` brought up to what shipped (§2 to §10, §14)
- [x] 22/10/2026 · ⌘K action New Commitment; commitments found as tasks; a commitment set `search:none` with its reason
- [x] 22/10/2026 · Staging seed `seeds/staging/47_performance_commitments.js`: October and November commitments in every state the day allows (Not Sent, Awaiting Approval, Returned, Due, On Time, Late, Rescoped, a rescope waiting; Missed and a Recovery once October has closed), with its own integration test
- [x] 22/10/2026 · Docs and progress: Workspace notes and the Commitments half of #30; this guide's §14

**PR 5 · Analytics**

- [x] 22/10/2026 · `GET /performance/analytics` (§6.21) in the `goals` module (`goals.analytics.js`), within the reader's scope, every figure in SQL; the people table `GET /performance/analytics/people` (25 a page, by score) and its Export (`POST /performance/analytics/people/export`, 202, built in the worker); integration tests on fixtures of the rows PR 3 and PR 4 write (`tests/integration/performance-analytics.test.js`)
- [x] 22/10/2026 · Analytics tab, both shells, with Export of the people table; the mock in the contract's shapes, its INTERIM types gone
- [x] 22/10/2026 · Home: goal progress on Goals This Quarter, the Org KPI donut (company and per department), Goals On Track and My Scorecard tiles live (My Targets relabelled), each line's score on My Goals, the Team roster's score; `goals.source.js` OWES cleared; `docs/DATABASE_SCHEMA.md` M2 Owes paid; `docs/guides/home.md` updated
- [x] 22/10/2026 · Gates 9 and 10 for the whole module (every read and record type covered): the assistant's `goals.analytics` read and its route; `review` and `improvement_plan` stay `search:none` until PR 3 builds `reviews.search.js`
- [ ] The M2 demo walk written into §3.7 and walked on staging: PRs 3 and 4 are merged; it is walked once this PR is deployed to staging, and written into §3.7 by the PR that records it
- [x] 22/10/2026 · Docs and progress: #33 ticked; Status of #29 to #33 and #10 to Built where all three ticks stand (#33; #30, #32 and #10 wait for PRs 3 and 4); summary counts; this guide's §14

### 1.3 Prompts for new chats

Each PR is built in a fresh chat from its prompt below. **PR 1 and PR 2** are started one after the
other; **PR 3, PR 4 and PR 5** are started together once PR 2 is merged. In the chat, a short line
is enough:

```text
Build Performance PR <n>. Your brief is the "PR <n>" prompt in docs/guides/performance.md §1.3; follow it exactly.
```

Every prompt below begins with the same rules.

```text
COMMON RULES FOR EVERY PERFORMANCE PR

You are building one pull request of the MyCity App ERP's Performance Management System
(repository praxisjbs/mycity-app). docs/guides/performance.md is the single source of
truth. Its §1.1 decisions were taken by TB on 22/10/2026: do not ask them again. If something
genuinely blocks you that the guide does not settle, ask once with AskUserQuestion, your
recommendation first, then record the answer in §1.1 and §14 of the guide.

Work in the foreground. Do not start background agents or workflows unless the person asks.
Commit small and push often: a session can end at any time, and pushed work is not lost.

1. Branch from the latest main with the name your prompt gives. Open the PR as a draft at once.
2. Read, in this order: docs/guides/performance.md in full; docs/PROGRESS.md (Performance and the
   rows your PR touches); MILESTONES §7; then CLAUDE.md step 2 for full-stack work:
   docs/BACKEND_GUIDE.md in full, the BACKEND_STRUCTURE sections it points to, docs/MIGRATIONS.md
   if you write a migration or seed, docs/FRONTEND_GUIDE.md, docs/FRONTEND_FOUNDATION.md §3 and
   docs/COMPONENTS.md before any screen. Read the other guides your PR touches (named in your prompt).
3. Build the checklist for your PR in §1.2 of the guide, top to bottom, against the sections it
   names. Contract first, then backend, then the screens against contract.gen.ts.
4. Keep to the files your PR owns (guide §12, Files by PR). If you must touch another PR's file,
   say so in the PR description. When rebasing, never hand-merge contract.gen.ts: take either side
   and run npm run gen:contract.
5. The rules that bite most here: every list pages at 25 through shared/http/paged.js; every
   write goes through the owning service, in a transaction, with emit(); follow-on work is an
   outbox handler; approvals are workflow definitions, decided only through
   /workflow/instances/:id/approve, reject or request-changes, with workflow.onCompleted to react;
   capabilities are checked after the grant; snake_case contract keys equal to columns (gate 6);
   numbers are numeric strings on the wire; dates ISO on the wire and day-first for people;
   business days for performance deadlines (guide §6.2); screens only from @mycity/ui, tokens only,
   nothing the browser styles itself, one press one request (F26), the form system, the three
   tiers of screen text and the word limits (guide §10 lists what reaches each screen; nothing
   else does); a native phone shell, not the desktop shrunk; search reaches every new record and
   action; AI reads only, and every AI call names its registered action. No donor names anywhere
   (scripts/check/provenance.js). Never a model id in commits, PR text or code.
6. Test as you go: unit tests beside the code, integration tests on the real migrations
   (RUN_DB_TESTS=1), every response parsed with its contract. Run npm run ci in full before you
   mark the PR ready.
7. Finish: tick your checklist items in guide §1.2 with the date and set your row's Status; bring
   every section you changed up to what shipped and add a §14 line; in docs/PROGRESS.md tick API,
   UI and Mobile on the screens you completed, set Status and Updated, update the Build plan row
   and the summary counts, and add a note under Performance (dd/mm/yyyy · initials · done · left);
   list new files in README.MD; delete empty stubs your module no longer needs. Fill the PR template;
   for a screen change its Native app feel section says what you did on the phone and desktop
   shells. Mark the PR ready only when npm run ci is green. Your final message lists what changed,
   what is left and what you could not verify.
```

```text
PR 1 · FOUNDATION · branch m2/perf-foundation · migrations 2100 to 2199

Follow the COMMON RULES. You build the ground the other four PRs stand on; they start the moment
you merge, so completeness and exact shapes matter more than screens.

Also read: docs/guides/organogram.md, docs/guides/foundation.md (§5 Approvals, §6.1 the staff
roster, §6.4), docs/guides/home.md §4.1 and src/modules/dashboard/sources/{goals,reviews}.source.js,
docs/guides/workspace.md §4, docs/guides/ai-control.md §6, src/shared/workflow/*,
src/shared/import/registry.js, scripts/db/load-staff.js and seeds/staff/*.

Build the "PR 1 · Foundation" checklist of guide §1.2:
- The org first (guide §6.20). Read load-staff.js before changing seeds/staff: departments must be
  renamed in place (same ids, nobody moved out, nothing an editor changed on screen overwritten),
  and a second deploy must change nothing. Choose the safest route (a one-time, idempotent step
  through organisation.service run by deploy-gate, or aliases the loader understands), document it
  in foundation.md §6.1, and test it on a copy of staging data.
- Department head (person or vacant seat) on department, in the contract, the department form and
  organisation.headOf().
- The whole schema of guide §4 in migrations/2100_performance_foundation.sql and the seed
  seeds/reference/2190_seed_performance.sql. Read docs/MIGRATIONS.md first. Keep every column
  Home's adapters read; add, never drop. No business choices in the seed (A26): no goals, no
  KPIs, no rules values beyond the code's defaults.
- The whole contract (guide §5 names every shape) with TABLES for gate 6, and the scoring library
  in packages/contract/schemas/scoring.js with tests for every rule of guide §6.8, §6.9 and §6.15,
  using the workbook examples given there.
- Business days, the employee_in_context approver kind (Settings · Approvals must show it), the
  four flows, the five capabilities with their default holders.
- The quarters and rules endpoints (guide §5, goals module), with integration tests.
- Record types in src/shared/route-map.js (guide §9), the Scorecards label for Performance ·
  Targets everywhere the label lives (app catalogue, src/shared/search/screens.js, PROGRESS #30).
- Every file of guide §12 (Files by PR) laid out, including the frontend parts, each empty part
  stating the PR that fills it; README §5.5 updated to the new file list.
- The in-browser mock for every Performance endpoint in the contract's shapes.

Do not build PR 2's services or screens. Leave Coming Soon as it is: no screen is ticked by PR 1.
```

```text
PR 2 · PLAN · branch m2/perf-plan · migrations 2200 to 2299 (only for a gap)

Follow the COMMON RULES. PR 1 is merged: the schema, contract, scoring library, flows and
capabilities exist. You build everything that is set at the start of a quarter.

Also read: docs/guides/home.md §4.1 and goals.source.js (you keep it true to what you write),
docs/guides/workspace.md (initiatives are tasks), src/shared/import/* and
src/modules/organisation/employee.import.js (the importer pattern), docs/DATABASE_SCHEMA.md M2
(Home's staging rows you remove).

Build the "PR 2 · Plan" checklist of guide §1.2 against guide §3.1, §3.2, §3.5, §3.6, §6.3 to §6.7
and §6.19, and the Goals, Scorecards (Scorecards view) and KPIs rows of §10.

- Codes follow G1. The plan's approval is performance.plan with the conditions of §6.4; binding
  happens in a workflow.onCompleted handler, never in the decision request.
- The importers read MyCity's workbooks exactly as they are. The extract hook in shared/import is
  a shared change: keep it small, documented in the registry header, with its own tests; GE reviews it.
  Test with trimmed copies of the two workbooks in tests/fixtures/performance/ (one function sheet,
  two scorecards, the change map), never the full files.
- The staging seed loads Q4 2026 through the services, and removes Home's forward rows first, in
  the three steps docs/DATABASE_SCHEMA.md M2 describes.

Do not build reviews, commitments or analytics.
```

```text
PR 3 · REVIEWS · branch m2/perf-reviews · migrations 2300 to 2399 (only for a gap)

Follow the COMMON RULES. PR 2 is merged. PR 4 (Workspace) and PR 5 (Analytics) are being built at
the same time: stay inside the files guide §12 gives PR 3.

Also read: docs/guides/ess.md (My Performance), docs/guides/notifications.md §7.1 (reminders),
docs/guides/ai-control.md §6 and src/services/ai/actions.js, docs/guides/attendance.md §6.9 (the
shared roster, read only for the review's context), docs/guides/community.md (recognition, read only),
src/modules/notifications/notifications.reminders.js (Probation Ending), home.md §4.1 and
reviews.source.js (you keep it true).

Build the "PR 3 · Reviews" checklist of guide §1.2 against guide §3.3, §6.10, §6.12 and §6.14 to
§6.17, and the Reviews and ESS · My Performance rows of §10.

- A17 is the heart: nothing of a check-in reaches the reviewer until it is submitted (409
  CHECK_IN_FIRST), and the employee sees the reviewer's scores only once the review is closed.
- The chain is performance.review: second level through employee_in_context, skipped when the
  reviewer is the CEO; the reviewee is excluded from deciding any stage of their own review.
- Automatic lines (§6.10) are worked out by targets.progress.js; until PR 4 merges there are no
  commitments, so that line reads no eligible cases (blank), as the rules say.
- Register the two AI actions before the first call; prompts in src/services/ai/prompts/. The tidy
  never adds a fact, figure, name or judgement, and the person chooses which text to keep.
- My Commitments on ESS is PR 4's file: leave its slot as PR 1 laid it out.
- Mid-quarter scorecards (§11) are yours: PR 2 refuses a scorecard once its plan is sent (409
  PLAN_NOT_OPEN); build the plan amendment that holds only that scorecard and binds it on approval.
  It touches targets.service.js and goals.approval.js (PR 2's): say so in the PR.
```

```text
PR 4 · WORKSPACE · branch m2/perf-workspace · migrations 2400 to 2499 (only for a gap)

Follow the COMMON RULES. PR 2 is merged. PR 3 (Reviews) and PR 5 (Analytics) are being built at
the same time: stay inside the files guide §12 gives PR 4.

Also read: docs/guides/workspace.md in full (you change it: commitments, Counts Towards, the
weekly summary, performance dates on the calendar), docs/guides/ai-control.md §6,
src/services/ai/actions.js, src/shared/documents/exports (the month-end report),
docs/guides/foundation.md §6.12.

Build the "PR 4 · Workspace" checklist of guide §1.2 against guide §3.4, §6.11 and §6.18, the
Commitments view of the Scorecards row and the My Workspace and My Commitments rows of §10.

- Update docs/guides/workspace.md first (CLAUDE.md step 2), then build.
- A commitment's original date never resets: a later due date shows beside it. On-time is
  completed by the end of the original date's business day in Lagos.
- The Commitments view keeps its filters in the URL, so a row that opens its task and Back return
  the person to the same filtered list (F29).
- Register week-summary before the first call. Tidy runs only when pressed and changes nothing until
  the person accepts.
```

```text
PR 5 · ANALYTICS · branch m2/perf-analytics · migrations 2500 to 2599 (only for a gap)

Follow the COMMON RULES. PR 2 is merged. PR 3 (Reviews) and PR 4 (Workspace) are being built at
the same time: stay inside the files guide §12 gives PR 5. Until they merge, test analytics on rows
your integration fixtures write; each figure must read the rows PR 3 and PR 4 will write, as guide
§4 defines them.

Also read: docs/guides/home.md in full (you change it), src/modules/dashboard/* (layout, team,
kpi-catalog tiles, sources), docs/DATABASE_SCHEMA.md M2 Owes.

Build the "PR 5 · Analytics" checklist of guide §1.2 against guide §3.7 and §6.21, and the Analytics
and Home rows of §2 and §10.

- Every figure is worked out in SQL within the reader's scope; nothing is filtered in JavaScript.
- Home's cards keep their catalogue ids; the My Targets tile is relabelled My Scorecard.
- When PR 3 and PR 4 are both merged, walk the demo of §3.7 on staging and record it in the guide.
```

---

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Performance · Goals (`goals`) | staff app | `performance` view: everyone sees the whole tree (the OKRs are the company's shared plan, as their sheets are) | The quarter's OKR tree: organisational goals; company and function objectives with their key results (code, statement, owner, finish, status, October, November, December scores, TBC); each function's plan; Waiting On You (the plan stages, target changes and mid-quarter scorecards the reader decides) | New Goal (as their capability allows); Set Up Quarter and Edit Quarter (`performance.manage`); Edit Goal and Delete Goal (the CEO); edit and delete a draft's objectives and key results; Set Target on a TBC key result before its lock date; Send Plan; open a plan stage and Approve Plan or Request Changes, a target change and Approve Change or Refuse Change, or a mid-quarter scorecard and Approve Scorecard or Request Changes, as the flow names them; Report Month (heads); Confirm Score (CEO); Change Target; open a key result's panel and its initiatives |
| Performance · Scorecards (`targets`), Scorecards view | staff app | `performance` view · own, team, all | Every scorecard in scope: person, department, reviewer, status, score to date, rating; a scorecard: its three sections and lines, weights, monthly scores, links, agreement, contribution check | New Scorecard, Edit Lines (draft), Copy Last Quarter, Agree Scorecard, Disagree With Reason, Send Scorecard (a mid-quarter scorecard) and, for its approver, Approve Scorecard or Request Changes; Change Target on a line (its reviewer or the function's head), Change Reviewer (`performance.manage`) |
| Performance · Scorecards (`targets`), Commitments view | staff app | `performance` view · own, team, all | The month's commitments: commitment, person, original date, date now, state; Commitments, On Time, Late or Missed, Awaiting Approval; Waiting On You (each person's month sent to the reader) | Approve Month and Request Changes (as the flow names them); open a commitment's task and come back; Export Report (the month-end delivery report) |
| Performance · KPIs (`kpis`) | staff app | `performance` view | The functions' operational KPIs: code, name, target, direction, frequency, October to December results and actuals, data source | New KPI and edit (`goals.function`, own function); Record Actual |
| Performance · Reviews (`reviews`) | staff app | `performance` view · scope, plus any review that names the reader (reviewer, second level, dotted input) | The month's round: check-ins in, with reviewers, with second level and HR, closed; Waiting On You; every review in scope with its stage; PIPs | Open Round, Close Round (`performance.manage`); open a review: score, Ask For Input, Give Input, Submit Review, approve or Request Changes, Close Review, Mark Conduct, Start PIP, a probation outcome; Score Without Check-In (the reviewer, once a check-in is late); Withdraw Review (Operations & People) |
| Performance · Analytics (`analytics`) | staff app | `performance` view · scope | Company and function scores by month, key results by status, the rating spread, commitments on time, check-ins and reviews on time, self against final score, people's scores | Choose the quarter and function; search and sort the people; Export (`performance` export) |
| ESS · My Performance (`my-performance`) | staff app | the employee | Score to date, rating, this month's check-in, commitments on time, agreement; My Scorecard; This Month's Check-In; My Commitments; Rolls Up To; My Reviews; a PIP when open | Agree Scorecard, Disagree With Reason; Start Check-In, Save Draft, Submit Check-In, Dictate, Tidy With AI, Add Evidence, Change Score; read a closed review and download its PDF |
| My Workspace · Today (`today`) | staff app | every employee; managers also see their team | My Week (done this week, planned next week, blocked) with Support Needed; Team This Week for managers | write Support Needed, Tidy With AI; open a person's week |
| My Workspace · Tasks (`tasks`) | staff app | as Workspace | Commitment and Counts Towards on the task form and panel; a Commitment pill on cards; a commitment's state, original date and recovery on its panel; initiatives, corrective actions and recovery tasks as tasks | mark a task a commitment with acceptance criteria; Send Commitments (for oneself, or a manager for someone in scope); pick the line or key result it counts towards; Rescope Commitment; Approve or Request Changes on a rescope named to the reader; Set Recovery on a missed commitment |
| My Workspace · Calendar (`calendar`) | staff app | the reader | Performance dates: check-in due, reviews to write, key results they own finishing, PIP review dates | open the record |
| Home · Overview (M1, TB) | staff app | as Home | Goals This Quarter with progress; the Org KPI donut (company and per department); Goals On Track (CEO); My Scorecard (staff); Reviews Due; My Reviews Due | read only, through `dashboard/sources/goals.source.js` and `reviews.source.js` |
| Home · Team (M1, TB) | staff app | managers | each person's score to date on the roster | read only |
| People · Employees and Organogram (M1) | staff app | as People | the five department names, a department's head, the corrected titles and seats | set a department's head (person or vacant seat) |
| Settings · Approvals (M0) | staff app | `settings` | the flows Performance Plan, Performance Review, Commitments, Target Change, and the new approver kind | edit the stages |
| Settings · Documents & Numbering (M0) | staff app | `settings` | no new scheme: Performance codes are positional (G1) | none |
| AI Control (M10, brought forward) | staff app | `ai_control` | the three actions `review-dictation`, `review-cleanup`, `week-summary` with their jobs | change a chain |
| Notifications bell | both shells | the people §7 names | plan waiting, plan binding, scorecard to agree, check-in due and in, review waiting, input asked, review closed, commitments waiting, PIP started, target change decided | open the record |
| ⌘K search | both shells | per scope | key results, objectives, organisational goals (each opening its sheet), KPIs, scorecards, reviews; actions New Goal, Set Up Quarter, New Scorecard, Report Month, Start Check-In, New Commitment | open the record or the action |
| Queries & Sanctions (M3, GE) | staff app | as M3 | a caution raised from a review links back to it | M3 builds the screen; M2 hands over the event (§7) |

## 3 · How the screens relate

### 3.1 The year (PR 2)

1. **The CEO records the organisational goals** (Goals, New Goal, Organisational Goal): goal ID,
   strategic theme, goal, detail, success measure for the year, reference target, current baseline,
   key decisions, the functions it cascades to, and a target per quarter of the plan year.
   `POST /api/v1/performance/goals` writes `organisational_goal` (level `organisation`) active at once:
   organisational goals are set by the CEO alone (A16). Home's Goals This Quarter reads them.
2. **A goal opens its sheet** (a row of Organisational Goals, or ⌘K, `?goal=`): its theme, measure,
   baseline, detail and a target per quarter. The CEO presses Edit Goal for its title, description
   (`detail`) and quarterly targets (`PATCH /performance/goals/:id`), or Delete Goal, a confirmation
   naming the goal (`DELETE /performance/goals/:id`), refused with 409 `GOAL_IN_USE` while a company
   objective serves it.

### 3.2 The quarter: plan, approve, agree (PR 2)

1. **Operations & People open the quarter** (Goals, Manage Quarters, Set Up Quarter; or ⌘K): a wizard of the
   quarter (name, start, the end that follows it, lock date, status), then its scoring rules, which
   start as a copy of the last quarter's and change in the same wizard: Bands (key results' Good and
   Watch, the ratings' Exceeds, Meets and Partly Meets), Key Result Scoring and Line Scoring (the
   thresholds of §6.8 and §6.9) and Section Weights. `POST /performance/periods` takes them, each
   checked by `ScoringRules` with its error on its field. Q1 2027 is set up before January as
   `planning` while Q4 2026 is `active`. Edit Quarter (`PATCH /performance/periods/:id`) changes the
   quarter Goals shows, until it is closed. Standing KPIs carry over; objectives do not.
2. **The CEO and Management set the company objectives and key results** (`goals.company`) under
   the organisational goals. **Each function head sets the function's** (`goals.function`): each key
   result links to the company key results it feeds (Linked Company KR); a company key result a
   function wholly delivers is Scored From that function key result. Copy Last Quarter starts from
   the previous quarter's tree. While the plan is draft or returned, whoever sets that function's
   goals (§6.3) edits or deletes an objective from its card (Edit Objective, Delete Objective) and a
   key result from its panel (Edit Key Result, Delete Key Result); a delete is a confirmation naming
   the item. New Key Result and Edit Key Result are one form: objective, key result, measure, target,
   target in words, TBC, unit, finish, owner and, for a function's key result, Feeds (the company key
   results it feeds, picked 25 at a time); behind More, Scored From (a company key result's function
   key result), co-owner, direction, baseline, start, type and owner note.
3. **Managers draft their people's scorecards** (Scorecards, New Scorecard; Copy Last Quarter or
   Copy From Colleague): Results, KPIs and Accountability lines, each linked to a key result or KPI,
   with its target, how it is measured, due or frequency, weight and source (§6.5). Accountability
   lines arrive prefilled (§6.10). Where a function key result is split across named people, each
   line carries its share and the contribution check reads OK or Rebalance.
4. **The head sends the function's plan** (Send Plan): `POST /performance/plans/:id/submit` opens
   `performance.plan` (§6.4) over the objectives, key results, KPIs and scorecards together. The
   Program Manager (or the CEO for Technology & Back-office Ops), then Operations & People, then the
   CEO decide on Performance · Goals, Waiting On You: a stage opens the plan's sheet (what it binds,
   the chain, Approve Plan, Request Changes); the bell, Home's Need You and ⌘K's Waiting on You open
   the same sheet (`?plan=`). Request Changes is a refusal with a reason (`POST
   /workflow/instances/:id/reject`): the plan comes back Returned with the reason, the head edits it
   and sends again.
5. **The CEO's approval makes it binding** (`workflow.onCompleted` → `plan.binding`): codes freeze
   (G1), each scorecard goes to its employee and reviewer to agree (P8), Home and My Performance
   start counting it.
6. **Agreement.** Each presses Agree Scorecard on My Performance or on the scorecard
   (`POST /performance/scorecards/:id/agree`). Disagree With Reason notifies the reviewer, who edits
   through a target change (binding lines change only that way) or replies.

### 3.3 The month: check in, review, close (PR 3)

1. **A month's round opens** on the next month's first business day (job `review-cycles`;
   October's opens on 2 November): one review per binding scorecard (`performance_review`, kind
   `monthly`), due dates set (§6.2). Each person is told their check-in is due.
2. **The employee checks in** (ESS · My Performance, Start Check-In): per Results line the actual and
   its evidence; per KPI line the month's figure where it is their own; an Action for anything
   behind (typed, or dictated and tidied, §6.17). Automatic lines arrive filled (§6.10). The system
   proposes each score (§6.9); they may change one with a reason. The month's tasks (done, ongoing,
   next month) come from Workspace. Submit Check-In
   (`POST /api/v1/ess/performance/check-in/submit`) emits `review.check_in_submitted`; the reviewer
   is told. Once its due date has passed with nothing in, the reviewer opens the review without the
   check-in and may Score Without Check-In, with a reason (§11).
3. **Function heads report the month** (Goals, Report Month) for their key results and KPIs by the 3rd
   business day: status, actual and its source, update, a proposed score, a recovery owner and date
   under 0.4. Lines fed by those key results and KPIs pick the figures up (§6.10). **The CEO confirms**
   the key result scores at the monthly review (Confirm Score).
4. **The dotted-line manager is asked for input** where the scorecard names one (Ask For Input, or
   automatically when the check-in arrives): their comment shows on the review before the reviewer
   scores.
5. **The reviewer scores** (Reviews, the review): the check-in beside each line, the proposed and the
   employee's score; the reviewer sets each final score (a reason where it differs from the
   proposed), a corrective action for each missed line (it becomes a task for its owner with its
   date), a comment. Submit Review opens `performance.review` (§6.12).
6. **Second level** (the reviewer's line manager) approves or Requests Changes; **Operations &
   People** close it (Close Review is HR's approval). On close: score to date and rating are written
   to the scorecard, the review's PDF is generated into the vault, the employee is told and sees the
   final scores. A Below rating offers Start PIP (§6.16). HR may Mark Conduct, which caps the rating.
7. **Probation.** When `employee.probation_ending` fires, a probation review opens with the line
   manager as reviewer, on the same form; HR's close carries the outcome (§6.16).

### 3.4 The week and the commitments (PR 4)

1. **Commitments.** By the 3rd business day each person (or their manager for them) marks the month's
   priority tasks as commitments on the task form (Commitment, Acceptance Criteria, Month; the due date
   falls in that month), and presses Send Commitments on Tasks or on My Commitments:
   `POST /performance/commitments/sets/:employee_id/:month/submit` puts the month's unapproved
   commitments in the person's set and opens `performance.commitments` (their reviewer; the CEO for a
   function head). The approver presses Approve Month or Request Changes on Performance · Scorecards ›
   Commitments (Waiting On You), or from Home's Need You. Approval fixes each original date
   (`commitments.approved`); Request Changes returns the set with the reason, and the person sends it
   again. The Commitments view lists the month with each state; a row opens its task on My Workspace ·
   Tasks; Back returns to the same filtered list.
2. **Changes.** A later due date moves the date now and never the original. A commitment that can no
   longer be delivered as agreed is rescoped: Rescope Commitment on its panel, with a reason, goes
   through the same flow, and on approval it leaves the on-time count and is listed as Rescoped.
3. **Work.** Tasks carry Counts Towards (a scorecard line or a key result, picked from the assignee's
   own); a key result's initiatives are tasks for its owner; corrective actions are tasks. Done tasks
   count for lines measured in tasks and are listed as evidence in the check-in.
4. **The week.** Today shows My Week (done, planned next week, blocked with reasons) and Support
   Needed, with Tidy With AI; managers read Team This Week and open a person's week. Nothing else to
   fill: the weekly tracker retires.
5. **The calendar.** Each person's month carries their performance dates: their check-in due, the
   reviews they must write, the key results they own finishing, and PIP reviews.
6. **Month end.** A commitment not done when its month ends reads Missed; its manager (or the person)
   presses Set Recovery on its panel to give a recovery owner and date, which sets a Recovery task
   pointing at it. Export Report on the Commitments view gives the month-end delivery report per
   function for the CEO (by the 3rd business day); each person's On-time Commitment Delivery line
   reads the same states (§6.10).

### 3.5 Changing a target (PR 2)

Change Target on a binding key result or scorecard line asks for the new target and a reason (a
line's from its scorecard's reviewer or the function's head, never its employee; on the line's own
sheet, opened from the scorecard);
`performance.target_change` goes to the CEO, who decides it on Goals · Waiting On You (or from the
bell, Need You or ⌘K, `?change=`): the change's sheet shows the target, old and new, the month and
the reason, with Approve Change or Refuse Change (a refusal with a reason). While it waits, the key
result or line shows Change Waiting and offers no second Change Target. On approval the new target applies
from that month, the original stays beside it, and scores already given stay. Before the lock date a
TBC target is set in place, with no approval, by the key result's owner or the function's head: Set
Target on its panel (`PATCH /performance/key-results/:id` with the target only); it stays TBC, and
Change Target is not offered (409 `TARGET_TBC`). On the lock date (job `targets-lock`) every TBC
target locks, Set Target goes, and Change Target to the CEO is the way.

### 3.6 Import at go-live (PR 2)

Operations & People upload the OKR workbook (Import, OKR Workbook) and then the scorecards workbook
(Import, Scorecards): each is previewed (rows, matches, errors), committed and revertible
(`shared/import`). The OKR workbook brings objectives, key results, links, initiatives (as tasks), the
operational KPIs, the months already reported and the change map of old IDs; the scorecards workbook
brings each scorecard and its lines, matched to people on the staff list and to key results and KPIs
through the change map. The plan is created binding (it was approved and signed in September); the
October round is opened for the backfill (§6.19).

### 3.7 The demo walk (PR 5 writes it)

Left to write once PR 3 and PR 4 are merged (PR 5 merged before them, on 22/10/2026): who signs in,
in what order, on staging, to show the cascade, a plan's approval, an agreement, a check-in with a
dictated action, a review through its chain, a commitment's month and Analytics.

## 4 · Data

PR 1 writes every table below in `migrations/2100_performance_foundation.sql` and the reference data
in `seeds/reference/2190_seed_performance.sql`. PRs 2 to 5 add a migration only for a gap, in their
own blocks (§1.2). Numbers 2020, 2030 and 2091 were used on the withdrawn branch and never reached
`main`; they are not reused. Every column Home reads today stays (`docs/DATABASE_SCHEMA.md` M2).

| Table | Key columns | Notes |
|---|---|---|
| `department` (0040, altered) | `head_employee_id`, `head_seat_id` | The function's head: a person or a vacant seat, never both (CHECK). `code` is the OKR prefix (GM, TBO, BM, PG, PC; company objectives use CO). Names editable on People (P4) |
| `performance_period` (new) | `performance_period_id`, `name` (Q4 2026), `starts_on`, `ends_on`, `plan_year_starts_on`, `targets_lock_on`, `live_from`, `status` (`planning`, `active`, `closed`), `rules` jsonb | A quarter. `rules` is `ScoringRules` (§6.8, §6.9, §6.2 due days, section weights, bands), copied from the last quarter when one is created, so a rule changed next quarter never rewrites this one. `live_from` is the first day the system ran it (automatic lines do not score earlier months). UNIQUE (`starts_on`) |
| `organisational_goal` (2000, altered) | `code`, `strategic_theme`, `detail`, `success_measure`, `reference_target`, `baseline`, `key_decisions`, `function_cascade`, `plan_year_starts_on` | `level` stays `organisation` for every row written now. `status` `active` or `closed`. Read by Home (`level`, `title`, `status`, `starts_on`, `ends_on`) |
| `organisational_goal_target` (new) | `organisational_goal_id`, `performance_period_id`, `target_text`, `target_value` | The quarterly cascade: what each quarter of the plan year should reach. UNIQUE (goal, period) |
| `okr_objective` (new) | `okr_objective_id`, `performance_period_id`, `performance_plan_id`, `department_id` (NULL for company), `code`, `title`, `organisational_goal_id`, `position` | `code` G1, UNIQUE (period, code). Status follows its plan |
| `okr_key_result` (new) | `okr_key_result_id`, `okr_objective_id`, `code`, `statement`, `kr_type` (`diagnostic_gate`, `visibility_gate`, `enabling`, `compliance_retiring`, `compliance_floor`, `outcome`, `output`), `measure` (`numeric`, `dated`, `yes_no`, `multi_part`), `direction` (`higher`, `lower`), `unit`, `baseline_text`, `target_value`, `target_text`, `target_provisional`, `target_locked_at`, `parts` jsonb, `starts_on`, `finishes_on`, `accountable_employee_id`, `co_accountable_employee_id`, `accountable_note`, `scored_from_key_result_id`, `position` | A key result. `target_value` numeric(18,4) as a string on the wire. `parts` holds a multi-part key result's parts, each scored and averaged. `accountable_note` keeps MyCity's words ("CEO with interim finance owner") |
| `okr_key_result_link` (new) | `okr_key_result_id` (function), `company_key_result_id` | Linked Company KR; the company's Contributing list is built from these, so both read the same. UNIQUE pair |
| `okr_key_result_month` (new) | `okr_key_result_id`, `month` (first day), `status` (`not_started`, `on_track`, `at_risk`, `off_track`, `done`, `missed`), `actual_value`, `actual_text`, `actual_source`, `update_text`, `recovery_employee_id`, `recovery_due_on`, `proposed_score`, `proposed_by`, `confirmed_score`, `confirmed_by`, `confirmed_at` | One report per key result per month. The latest month is "now". UNIQUE (key result, month) |
| `okr_code_alias` (new) | `performance_period_id`, `alias_code`, `okr_key_result_id` or `kpi_definition_id` | Former IDs from the workbook's change map (OP-KR2.2 → TBO-KR3.3), used by the scorecards importer and search |
| `kpi_definition` (2000, altered) | `department_id`, `formula`, `target_text`, `target_value`, `frequency` (`weekly`, `monthly`, `quarterly`), `data_source`, `starts_period_id`, `active` | An operational KPI of a function (`code` TBO-K01, UNIQUE). `direction` `higher` or `lower` (its `target` value unused); `measurement_type` defaults to `standard`, which the KPIs service never writes. Standing across quarters |
| `kpi_month` (new) | `kpi_definition_id`, `month`, `result` (`met`, `not_met`, `na`), `actual_value`, `actual_text`, `comment`, `recorded_by`, `recorded_at` | One actual per KPI per month. N/A when no eligible cases, never 100%. UNIQUE (KPI, month) |
| `performance_plan` (new) | `performance_plan_id`, `performance_period_id`, `department_id` (NULL for company), `status` (`draft`, `submitted`, `binding`, `returned`), `workflow_instance_id`, `submitted_by`, `submitted_at`, `returned_reason`, `binding_at` | One per function per quarter, and one company plan. UNIQUE (period, department), with a partial unique index for the company row |
| `scorecard` (new) | `scorecard_id`, `performance_period_id`, `employee_id`, `department_id`, `scope_text`, `reviewer_employee_id`, `reviewer_role_code`, `reviewer_reason`, `dotted_employee_id`, `status` (`draft`, `binding`, `agreed`, `closed`), `employee_agreed_at`, `reviewer_agreed_at`, `disagreed_at`, `disagree_reason`, `results_weight`, `kpis_weight`, `accountability_weight`, `score_to_date`, `rating` | One per person per quarter. The reviewer is resolved at plan time (§6.13); a role reviewer (`reviewer_role_code`) is any holder of the role. Section weights are copied from the rules (60, 25, 15). `score_to_date` and `rating` are written when a review closes. UNIQUE (period, employee) |
| `employee_target` (2000, altered) | `scorecard_id`, `section` (`results`, `kpis`, `accountability`), `position`, `measure` (`numeric`, `milestone`, `standard`, `binary`), `direction`, `unit`, `target_text`, `milestone_due_on`, `frequency_text`, `source` (`own`, `key_result`, `team_result`, `function_kpi`, `commitments`, `update_on_time`, `team_reviews`, `tasks`), `okr_key_result_id`, `share_value` | **A scorecard line.** `title` is the line's goal or KPI; `kpi_definition_id`, `target_value`, `weight`, `due_on` already exist. `task.employee_target_id` (2010) is Counts Towards. Read by Home (`employee_target_id`, `employee_id`, `title`, `due_on`) |
| `employee_target_key_result` (new) | `employee_target_id`, `okr_key_result_id` | The key results a Team result line averages (the Marketing team result) |
| `target_change` (new) | `target_change_id`, `okr_key_result_id` or `employee_target_id`, `from_value`, `from_text`, `to_value`, `to_text`, `from_month`, `reason`, `status` (`pending`, `approved`, `rejected`), `workflow_instance_id`, `requested_by` | P9; the original target stays on its row and the history reads from here |
| `performance_cycle` (2000, altered) | `performance_period_id`, `month`, `check_in_due_on`, `head_check_in_due_on`, `review_due_on`, `second_level_due_on`, `close_due_on` | **A monthly round** ("October 2026"). `status` `open` or `closed`; `closes_at` is the end of `close_due_on` in Lagos. Read by Home (`name`, `closes_at`). UNIQUE (period, month) |
| `performance_review` (2000, altered; one review per scorecard per round: a unique index on (cycle, scorecard), and one open probation review per person; the 2000 key (cycle, employee, reviewer, review_type) stays, because Home's staging rows hold a self and a manager review per person; `performance_cycle_id` may be NULL for a probation review) | `scorecard_id`, `review_kind` (`monthly`, `probation`), `status` (`check_in`, `with_reviewer`, `second_level`, `with_hr`, `closed`, `returned`), `check_in_submitted_at`, `closed_at`, `returned_reason`, `workflow_instance_id`, `dotted_employee_id`, `dotted_input`, `dotted_input_at`, `score_month`, `score_to_date`, `rating`, `conduct_breach`, `conduct_note`, `probation_outcome` (`confirm`, `extend`, `end`), `document_id` | **One review per scorecard per month**, and probation reviews (`scorecard_id` may be NULL). `review_type` is `manager`, or `designated` when the reviewer was named (P13, P14). `submitted_at` is the reviewer's submit. Read by Home (`employee_id`, `reviewer_employee_id`, `review_type`, `submitted_at`, cycle) |
| `performance_review_item` (2000, altered) | `criterion` (a probation review's `objectives`, `quality`, `timeliness`, `attendance`, `conduct`, where there is no line), `actual_value`, `actual_text`, `achieved_on`, `evidence_kind` (`record`, `document`, `link`, `note`), `evidence_entity_type`, `evidence_entity_id`, `evidence_document_id`, `evidence_url`, `evidence_note`, `action_text`, `action_transcript`, `action_document_id`, `action_ai_run_id`, `proposed_score`, `self_score`, `self_reason`, `override_reason`, `assessable`, `auto` | One per line per review. `score` (existing) is the final score; `comment` (existing) the reviewer's comment |
| `improvement_plan` (new) | `improvement_plan_id`, `employee_id`, `performance_review_id`, `starts_on`, `ends_on`, `review_on`, `summary`, `status` (`open`, `passed`, `extended`, `not_met`), `outcome_note`, `created_by`, `decided_by`, `decided_at` | A PIP. Its actions are tasks pointing at it |
| `improvement_plan_line` (new) | `improvement_plan_id`, `employee_target_id`, `text`, `target_text` | What must improve |
| `task` (2000, 2010, altered) | `is_commitment`, `acceptance_criteria`, `commitment_month`, `original_due_at`, `commitment_set_id`, `rescoped_at`, `rescope_reason` (2400) | `entity_type` CHECK gains `key_result`, `scorecard`, `performance_review`, `improvement_plan`, and `task` (2400, PR 4: a Recovery task points at the missed commitment it recovers). `original_due_at` is fixed when the commitment set is approved; a rescope keeps its reason in `rescope_reason` (cleared when refused) and its approval sets `rescoped_at` |
| `commitment_set` (new) | `commitment_set_id`, `employee_id`, `month`, `status` (`draft`, `submitted`, `approved`, `returned`), `workflow_instance_id`, `approved_at` | One person's commitments for a month, approved as one. UNIQUE (employee, month) |
| `weekly_summary` (new) | `weekly_summary_id`, `employee_id`, `week_starts_on`, `support_needed`, `summary_text`, `ai_run_id` | The one line a person writes each week, and a tidied summary they accepted. UNIQUE (employee, week) |

Status CHECKs on the four 2000 tables Home's staging rows fill (`organisational_goal`, `employee_target`,
`performance_cycle`, `performance_review`) come with the PR that replaces those rows (PR 2 for goals and
lines, PR 3 for rounds and reviews), each in its own block; until then the services hold them to the
contract. Every new table has its CHECKs.

PR 3's `2300_performance_reviews.sql` adds what the review needed and §4 did not hold: the
`performance_cycle` and `performance_review` status CHECKs (`NOT VALID`, so rows written before them
are left alone, and the defaults become `open` and `check_in`); `performance_review.second_level_employee_id`
(the reviewer's effective line manager at submit, NULL when the reviewer is the CEO); and on
`performance_review_item` a corrective action kept while the reviewer works, `corrective_title`,
`corrective_owner_id`, `corrective_due_on`, and `corrective_task_id` once Submit Review makes it a task.

`2310_performance_review_withdrawn.sql` (after PR #130, §11) adds `performance_review.no_check_in_at` and
`no_check_in_reason` (Score Without Check-In: when and why the reviewer scored without the check-in),
`withdrawn_at` and `withdrawn_reason` (a review closed as Withdrawn and its note), and widens the status
CHECK with `withdrawn` (`NOT VALID`, as 2300's), with a CHECK that `withdrawn` and `withdrawn_at` go
together. A leaver's scorecard closes as `scorecard.status` `closed`, which 2100 already allows.

Indexes: every foreign key; `okr_key_result_month (month)`, `kpi_month (month)`,
`performance_review (performance_cycle_id, status)`, `performance_review (reviewer_employee_id) WHERE
status <> 'closed'`, `task (commitment_month, primary_assignee_id) WHERE is_commitment`, and the two
Home asked for (`organisational_goal (level, starts_on, ends_on)`, `employee_target (employee_id,
due_on)`).

Reference data (`2190`, A26): the five capabilities and their default holders (§8); the four flows
of §6.4, §6.11, §6.12 and §6.7; the code lists (key result types, statuses, measures, sources,
review stages, PIP statuses) as `reference_value` domains. No goals, KPIs, scorecards or rule
values: the rules' defaults live in the code (`scoring.js` `DEFAULT_RULES`) until Operations & People
save a quarter.

## 5 · API

All paths under `/api/v1`. Permission key `performance` unless said. Each module mounts its own
routes file; the module that owns each route is named.

**Quarters, goals, objectives, key results, plans, target changes** (`goals`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /performance/periods` | `PeriodListQuery` → `PeriodPage` | view | yes, 25 | `status`, `plan_year` (a goal's quarters) |
| `GET /performance/periods/current` | → `PerformancePeriod` | view | | the active quarter, else the latest planning one; 404 `NO_QUARTER` before the first |
| `GET /performance/periods/:id` | → `PerformancePeriod` | view | | |
| `POST /performance/periods` | `PeriodCreate` → `PerformancePeriod` | create, `performance.manage` | | `rules` as given (checked by `ScoringRules`), else the last quarter's; `status` `planning` (default) or `active` (409 `PERIOD_ACTIVE_EXISTS` while another is); a quarter may be set up before it starts |
| `PATCH /performance/periods/:id` | `PeriodEdit` → `PerformancePeriod` | edit, `performance.manage` | | dates, lock date, `rules` (validated by `ScoringRules`), status |
| `GET /performance/goals` | `GoalListQuery` → `OrganisationalGoalPage` | view | yes, 25 | `plan_year`, `status`, `q` |
| `GET /performance/goals/:id` | → `OrganisationalGoalDetail` | view | | quarterly targets, the company objectives under it, progress |
| `POST /performance/goals` | `OrganisationalGoalCreate` → `OrganisationalGoal` | create, `goals.organisation` | | active at once |
| `PATCH /performance/goals/:id` | `OrganisationalGoalEdit` → `OrganisationalGoal` | edit, `goals.organisation` | | an empty text clears it |
| `DELETE /performance/goals/:id` | `IdParams` → 204 | delete, `goals.organisation` | | 409 `GOAL_IN_USE` while a company objective (or an older line or goal) names it; its quarterly targets go with it |
| `GET /performance/okrs` | `OkrListQuery` → `ObjectivePage` | view · scope | yes, 25 objectives, each with its key results and latest month | `period_id`, `department_id` (`company` for the company), `status`, `q`; each objective's `can_edit` (draft or returned, and the reader sets its goals) |
| `GET /performance/objectives/:id` | → `Objective` | view | | one objective with its key results and `can_edit` (⌘K's `?objective=`) |
| `GET /performance/okrs/summary` | `OkrSummaryQuery` → `OkrSummary` | view | | the Goals figures over the quarter or one function: company score, key results on track, in recovery, awaiting a report |
| `POST /performance/objectives` | `ObjectiveCreate` → `Objective` | create, `goals.company` (company) or `goals.function` (own function) | | the service checks which, and that the plan is draft or returned |
| `PATCH /performance/objectives/:id` · `DELETE` | `ObjectiveEdit` → `Objective` · 204 | edit, as above (taking a part out of a draft plan is editing it) | | draft or returned plan only; delete takes its key results |
| `POST /performance/key-results` | `KeyResultCreate` → `KeyResult` | create, as above | | |
| `GET /performance/key-results` | `KeyResultListQuery` → `KeyResultRefPage` | view | yes, 25 | `period_id`, `level` (`company`, `function`), `department_id`, `q`; the pickers of Feeds and Scored From |
| `PATCH /performance/key-results/:id` · `DELETE` | `KeyResultEdit` → `KeyResult` · 204 | edit, as above; DELETE also `goals.company` or `goals.function` | | draft: every field (an empty one clears it); binding: only an open TBC target (`target_value`, `target_text`, `target_provisional`) by its owner or the function's head, before the lock date (Set Target); else 409 `KEY_RESULT_BINDING` |
| `GET /performance/key-results/:id` | → `KeyResultDetail` | view · scope | | links both ways, initiatives (tasks), months, target history, trace; `can_change_target` (the reader may ask; never for an open TBC target), `can_edit` (draft or returned, and the reader sets its goals), `can_set_target` (an open TBC target and the reader is its owner or the function's head) |
| `GET /performance/key-results/:id/trace` | → `Trace` | view · scope | | key result → company key result → organisational goal |
| `POST /performance/reports` | `MonthReport` → `MonthReportResult` | edit · the function's head or acting head; for company key results their accountable person | | `month`, `department_id` (null for company key results), each key result's and KPI's figures in one save (§6.8) |
| `POST /performance/key-results/:id/confirm` | `ConfirmScore` → `KeyResultMonth` | approve, `goals.confirm` | | `month`, `score` |
| `GET /performance/plans` | `PlanListQuery` → `PlanPage` | view | yes, 25 | `period_id`, `status`, `department_id`; each plan names who sent it (`submitted_by`) |
| `GET /performance/plans/:id` | → `PlanDetail` | view · scope | | objectives, key results, KPIs, scorecards, contribution checks; the chain and `can_decide` come from `GET /workflow/instances/:workflow_instance_id` |
| `GET /performance/approvals` | `PerformanceApprovalQuery` → `PerformanceApprovalPage` | view | yes, 25 | the plan stages, target changes and mid-quarter scorecards (`kind` `plan`, `target_change`, `scorecard`; a scorecard's `record_id` is the scorecard, its `employee` the person) waiting on the reader (`approvers.waitingOnClause`), oldest first, empty without `performance` approve; `q` finds a function, a key result, a person or who asked. Deciding is the engine's |
| `POST /performance/plans/:id/submit` | `EmptyBody` → `PlanDetail` | create, `goals.function` (or `goals.company` for the company plan) | | refuses `CONTRIBUTION_REBALANCE`, `WEIGHTS_NOT_100`, `PLAN_EMPTY`; opens `performance.plan` |
| `POST /performance/target-changes` | `TargetChangeCreate` → `TargetChange` | edit | | a binding key result (its accountable person, or who sets the function's goals) or line (its scorecard's reviewer or the function's head, never its employee: 403); one waiting at a time (409 `CHANGE_PENDING`); opens `performance.target_change`; 409 `TARGET_TBC` for a TBC target before its lock date (Set Target instead) |
| `GET /performance/target-changes` | `TargetChangeListQuery` → `TargetChangePage` | view · scope | yes, 25 | a key result's change for every reader; a line's within the reader's scope |
| `GET /performance/target-changes/:id` | → `TargetChangeDetail` | view · scope | | one change with its key result or line, unit, function and quarter; a line's is for whoever may read its scorecard (scope, its person, reviewer or dotted manager), its requester, or whoever runs the cycle |
| `GET /performance/analytics` (PR 5) | `PerformanceAnalyticsQuery` → `PerformanceAnalytics` | view · scope | no (aggregates) | `period_id` (the current quarter when none; `period` null before the first), `department_id`; §6.21 |
| `GET /performance/analytics/people` (PR 5) | `AnalyticsPeopleQuery` → `AnalyticsPersonPage` | view · scope | yes, 25 | `period_id`, `department_id`, `rating`, `q`; sort `score_to_date`, `employee` |
| `POST /performance/analytics/people/export` (PR 5) | `AnalyticsExportRequest` → `ExportFile` | export · scope | | 202; the people table as filtered, made in the worker (`shared/documents/exports`) |

**KPIs** (`kpis`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /performance/kpis` | `KpiListQuery` → `KpiPage` | view | yes, 25 | `department_id`, `period_id` (its months), `active`, `q` |
| `GET /performance/kpis/summary` | `KpiSummaryQuery` → `KpiSummary` | view | | a month's Met, Not Met and awaiting over the active KPIs, or one function's |
| `GET /performance/kpis/:id` | → `KpiDetail` | view | | months, the scorecard lines that use it; `can_edit` (the reader may edit and record) |
| `POST /performance/kpis` · `PATCH /performance/kpis/:id` | `KpiCreate`, `KpiEdit` → `Kpi` | create · edit, `goals.function` (own function) | | |
| `POST /performance/kpis/:id/actuals` | `KpiActual` → `KpiMonth` | edit, `goals.function` (own function) | | `month`, `result`, `actual_value` or `actual_text`, `comment` |

**Scorecards and commitments** (`targets`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /performance/scorecards` | `ScorecardListQuery` → `ScorecardPage` | view · own, team, all | yes, 25 | `period_id`, `department_id`, `status`, `reviewer_id`, `rating`, `q`; sort `employee`, `score_to_date` |
| `GET /performance/scorecards/:id` | → `ScorecardDetail` | view · scope, or its reviewer or dotted manager | | sections, lines, months, contribution, agreement; each line's `can_change_target` (the reader may ask now) and `pending_change` (the change waiting on the CEO); a line's id answers its scorecard, so the route map's `target` (a task's Counts Towards) opens it |
| `POST /performance/scorecards` | `ScorecardCreate` → `ScorecardDetail` | create · team or all (never one's own) | | `employee_id`, `copy_from` (`last_quarter`, a scorecard id, none) |
| `PUT /performance/scorecards/:id/lines` | `ScorecardLinesSave` → `ScorecardDetail` | edit · scope | | draft or returned plan; each section's weights must total its section weight to send the plan |
| `PATCH /performance/scorecards/:id` | `ScorecardEdit` → `ScorecardDetail` | edit · scope; reviewer fields need `performance.manage` | | scope text, reviewer (person or role) with reason, dotted manager |
| `POST /performance/scorecards/:id/agree` | `EmptyBody` → `ScorecardDetail` | view · the employee or the reviewer (the service checks which) | | |
| `POST /performance/scorecards/:id/disagree` | `DisagreeBody` (`disagree_reason`) → `ScorecardDetail` | as above | | |
| `POST /performance/scorecards/:id/submit` (PR 3) | `EmptyBody` → `ScorecardDetail` | edit · scope | | Send Scorecard: a draft scorecard of a binding plan opens its own `performance.plan` instance (entity `scorecard`, §11) and binds on approval; `can_send` says it may be sent, `amendment_instance_id` names the instance while it waits (its stages decide it on Goals › Waiting On You, `kind` `scorecard`, or on its sheet); 409 `PLAN_NOT_BINDING`, `SCORECARD_LOCKED` |
| `GET /performance/contributions` | `ContributionQuery` → `ContributionPage` | view | yes, 25 | `plan_id` or `key_result_id`: each split key result with its shares, sum, target, OK or Rebalance |
| `GET /performance/commitments` (PR 4) | `CommitmentListQuery` → `CommitmentPage` | view · own, team, all | yes, 25 | `month`, `department_id`, `employee_id`, `state` (`awaiting_approval`, `due`, `on_time`, `late`, `missed`, `rescoped`), `waiting_on_me`, `q`; rows are tasks |
| `POST /performance/commitments/sets/:employee_id/:month/submit` (PR 4) | `EmptyBody` → `CommitmentSetRow` | `workspace` edit · scope (the person or their manager) | | `month` is `YYYY-MM`; opens `performance.commitments` |
| `POST /performance/commitments/report` (PR 4) | `CommitmentReportRequest` → `ExportFile` | export · scope | | the month-end delivery report (202, `shared/documents/exports`) |
| `GET /performance/commitments/summary` (PR 4) | `CommitmentSummaryQuery` → `CommitmentSummary` | view · own, team, all | | the Commitments view's figures for a month: commitments, on time, late or missed, and awaiting approval (sent and not yet decided) |
| `GET /performance/commitments/sets` (PR 4) | `CommitmentSetListQuery` → `CommitmentSetPage` | view · own, team, all, plus sets waiting on the reader | yes, 25 | `month`, `employee_id`, `status`, `waiting_on_me`; each set with its person and its approval; Waiting On You |
| `POST /performance/commitments/:id/rescope` (PR 4) | `CommitmentRescope` (`reason`) → `Commitment` | `workspace` edit · scope (the person or their manager) | | an approved commitment not done; opens `performance.commitments` over the task |
| `POST /performance/commitments/:id/recovery` (PR 4) | `CommitmentRecovery` (`primary_assignee_id`, `due_on`) → `Commitment` | `workspace` create · scope (the owner is the caller or in their scope) | | a missed commitment; sets its Recovery task through the tasks service; 409 `RECOVERY_SET` when it has one |

**Reviews, rounds, PIPs** (`reviews`)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /performance/rounds` | `RoundListQuery` → `RoundPage` | view | yes, 25 | |
| `POST /performance/rounds` · `POST /performance/rounds/:id/close` | `RoundCreate` · `EmptyBody` → `Round` | create · edit, `performance.manage` | | the job opens rounds itself; this is for a late start |
| `GET /performance/reviews` | `ReviewListQuery` → `ReviewPage` | view · scope, plus reviews that name the reader | yes, 25 | `round_id`, `status`, `kind`, `department_id`, `waiting_on_me`, `q` |
| `GET /performance/reviews/:id` | → `ReviewDetail` | view · scope, or a person the review names | | §6.12 decides which parts the reader sees; the reviewer gets 409 `CHECK_IN_FIRST` until the check-in is in or its due date has passed (§11) |
| `PUT /performance/reviews/:id/scores` | `ReviewScoresSave` → `ReviewDetail` | the reviewer | | after the check-in only, or Score Without Check-In (409 `CHECK_IN_FIRST`) |
| `POST /performance/reviews/:id/score-without-check-in` | `ScoreWithoutCheckIn` (`no_check_in_reason`) → `ReviewDetail` | view · the reviewer | | a check-in still not in once its due date has passed (409 `CHECK_IN_NOT_LATE`, `CHECK_IN_SENT`); the review goes to the reviewer, the employee is told (§11) |
| `POST /performance/reviews/:id/withdraw` | `ReviewWithdraw` (`withdrawn_reason`) → `ReviewDetail` | edit, `performance.manage` · Operations & People | | an open review closes as Withdrawn at HR's stage, its approval cancelled (409 `REVIEW_ENDED`; §11) |
| `POST /performance/reviews/:id/submit` | `EmptyBody` → `ReviewDetail` | the reviewer | | needs every assessable line scored and a corrective action on each missed one; opens `performance.review` |
| `POST /performance/reviews/:id/return` | `ReturnCheckIn` → `Review` | the reviewer | | sends a submitted check-in back to the employee with a reason; answers the list row, since the reviewer may not read the check-in again until it is resubmitted (A17) |
| `POST /performance/reviews/:id/input` | `ReviewInput` → `ReviewDetail` | the dotted manager | | `POST /performance/reviews/:id/ask-input` (`EmptyBody`, the reviewer) asks for it |
| `POST /performance/reviews/:id/conduct` | `ConductMark` → `ReviewDetail` | edit, `performance.manage` | | caps the rating (§6.15) |
| `POST /performance/reviews/:id/probation-outcome` | `ProbationOutcome` → `ReviewDetail` | approve, `performance.manage` | | probation reviews at HR's stage |
| `POST /performance/reviews/:id/items/:item_id/dictation` | multipart `file` + `DictationRequest` → `Dictation` | the reviewer, or the dotted manager for `dotted_input` | | transcript; the tidy is separate. The upload engine's `purpose` field is accepted and the route's own (`voice_note`) decides |
| `POST /performance/tidy` | `TidyRequest` → `TidyResult` | view · the writer of the text | | `kind` `check_in` or `review`, the item, the text; one `review-cleanup` run |
| `GET /performance/pips` | `PipListQuery` → `PipPage` | view · scope | yes, 25 | |
| `POST /performance/pips` · `PATCH /performance/pips/:id` · `POST /performance/pips/:id/close` | `PipCreate`, `PipEdit`, `PipClose` → `Pip` | create · edit, `performance.manage` | | from a closed review rated Below |
| `GET /api/v1/ess/performance` | → `MyPerformance` | `ess` · own | | the quarter, the scorecard (score to date, rating, agreement, reviewer), the open check-in, this month's commitments (due and delivered on time, as `targets.commitments` `monthFigures` counts them, and the set's status), an open PIP; the reviews are `GET /ess/performance/reviews` |
| `GET /api/v1/ess/performance/check-in` · `PUT` | → `ReviewCheckIn` · `ReviewCheckInSave` → `ReviewCheckIn` | `ess` · own | | the open month; 404 `NO_OPEN_CHECK_IN` when none (`reviews.js`: attendance already has a `CheckIn`) |
| `POST /api/v1/ess/performance/check-in/submit` | `EmptyBody` → `ReviewCheckIn` | `ess` · own | | |
| `POST /api/v1/ess/performance/check-in/dictation` | multipart `file` + `DictationRequest` → `Dictation` | `ess` · own | | the transcript lands in the item's `action_transcript` |
| `POST /api/v1/ess/performance/check-in/evidence` (PR 3) | multipart `file` + `EvidenceUpload` → `DocumentRef` | `ess` · own | | a file (purpose `performance_evidence`, 15 MB) kept in the vault against the review as one line's evidence, and the line's score proposed again |
| `GET /api/v1/ess/performance/reviews` | `MyReviewListQuery` → `MyReviewPage` | `ess` · own | yes, 25 | closed reviews show final scores and the PDF; a review opens through `GET /performance/reviews/:id`, which sends the employee their own parts |

**My Workspace** (`workspace`, `tasks`, `calendar`; PR 4)

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /api/v1/tasks`, `PATCH /api/v1/tasks/:id` | `TaskCreate`, `TaskEdit` gain `is_commitment`, `acceptance_criteria`, `commitment_month`, `employee_target_id`, `entity_type` `key_result` | `workspace` as today; the commitment fields are the assignee's as well as the setter's | | a commitment's due date after approval moves `due_at` only; its month, criteria and the mark are fixed once approved (409 `COMMITMENT_APPROVED`) |
| `GET /api/v1/tasks/:id` | → `TaskDetail` gains the commitment's state, its pending rescope (with whether the reader decides it), its recovery, `can_rescope` and `can_set_recovery` | `workspace` view · scope | | |
| `GET /api/v1/tasks/counts-towards` | `CountsTowardsQuery` → `CountsTowardsPage` | `workspace` view · the assignee is the caller or in their scope | yes, 25 | `assignee_id` (the caller unless given), `month`, `q`: the lines of the assignee's binding scorecard for the month's quarter, and the key results they are accountable or co-accountable for in a binding plan |
| `GET /api/v1/tasks` | `TaskListQuery` gains `is_commitment`, `commitment_month`, `employee_target_id` | `workspace` view | yes, 25 | |
| `GET /api/v1/workspace/week` · `PUT` | `WeekQuery` → `WeekView` · `WeekSave` → `WeekView` | `workspace` view · own (a manager may read someone in scope) | no (the week's lists are each their first 25 with a total) | done, planned next week, blocked, Support Needed, summary |
| `GET /api/v1/workspace/team-weeks` | `TeamWeekQuery` → `TeamWeekPage` | `workspace` view · team | yes, 25 | one row per person |
| `POST /api/v1/workspace/week/tidy` | `TidyRequest` → `TidyResult` | `workspace` view · own | | one `week-summary` run |
| `GET /api/v1/calendar` | `CalendarItemPage` items gain kind `performance`, named by `performance_kind` (`check_in_due`, `review_due`, `key_result_due`, `pip_review`) | as today | yes, 25 | check-in due, reviews to write, key results finishing, PIP reviews; each all day on its date |

Every list is paged at 25 (BACKEND_STRUCTURE §16). A route behind a capability names it after the
grant, as above.

## 6 · Rules and calculations

### 6.1 Words and codes (PR 1)

- One vocabulary on every screen, contract and notice: **organisational goal, objective, key result,
  KPI, scorecard, line, commitment, check-in, review, round, PIP, probation review.** MyCity's words;
  nothing else is introduced.
- Codes (G1): company objectives `CO-O<n>`, company key results `CO-KR<n>.<m>`; a function's
  `<code>-O<n>`, `<code>-KR<n>.<m>` and KPIs `<code>-K<nn>`, where `<code>` is the department's
  code. The service gives the next free code in the quarter when a draft is saved and renumbers a
  draft's codes on reorder; codes freeze when the plan is binding. Imported rows keep their codes.
- Every link (a line to its key result, a key result to a company key result, a task to a line) is
  by id, so the drift found on 22/10/2026 (scorecards citing OP-KR3.1 and 40,000 users while the OKRs
  say TBO-KR1.3 and 64,000) cannot recur.

### 6.2 Quarters, months, business days and due dates (PR 1)

- A **business day** is Monday to Friday, not a public holiday (the holidays seeded in `0448` and
  those MyCity add). `nthBusinessDay("2026-11", 3)` is 4 November 2026; December's 3rd is
  3 December; January 2027's is 6 January (1 January a holiday, 2 January a Saturday). This matches
  MyCity's own deadlines (G2).
- A quarter has three months. Each month's round sets, from the quarter's `rules`:
  `check_in_due_on` = the month after's 2nd business day (staff), `head_check_in_due_on` = its 3rd
  (function heads, also the function report and the commitments' deadline), `review_due_on` = 5th,
  `second_level_due_on` = 7th, `close_due_on` = 10th (G3). A deadline is the end of that day, Lagos.
  The round for October therefore opens on 2 November and its check-ins are due 3 November.
  (Their PC-KR1.1 deadline for October and November reviews, 15 December, is met by the rounds.)
- **Score months.** October and November scores are progress against the full quarter; December is
  the quarter's final (P3). The year's score is the mean of its closed quarters' finals.

### 6.3 Who sets what (PR 2)

- **Organisational goals**: `goals.organisation` (the CEO). Active at once, no approval (A16). The CEO
  edits a goal at any time and deletes one only while no company objective serves it (`GOAL_IN_USE`).
- **Quarters and their rules**: `performance.manage` (Operations & People). A quarter is set up at any
  time before it starts, so the next one is planned while this one runs.
- **Company objectives and key results**: `goals.company` (Management, the CEO). A company objective
  names the organisational goal it serves.
- **A function's objectives, key results and KPIs**: `goals.function` and being the function's
  head, or its acting head (the person above a vacant head seat, `organisation.headOf`); the CEO and
  Operations & People may act for any function.
- **Scorecards**: a manager for people in their `performance` scope (team or all), never their own.
- **Editing and deleting** an objective or key result: whoever may set it (above), while its plan is
  draft or returned; the screen offers Edit and Delete only then (`can_edit`). Deleting an objective
  deletes its key results.
- **Lines on a binding scorecard and binding key results** change only by target change (§6.7), but
  for an open TBC target (§6.7).
- Each objective holds two to four key results (their rule): five refuses `OBJECTIVE_TOO_MANY`, one is
  allowed with a warning on the plan (an objective with one key result is folded into another, their
  rule, so the head decides).

### 6.4 The quarter plan and its approval (PR 2)

- One `performance_plan` per function per quarter, and one company plan. It holds the function's
  objectives, key results, KPIs that start this quarter and every scorecard of the people in the
  department (scorecards follow their person's department).
- **Send Plan** refuses, naming each problem: no objectives (`PLAN_EMPTY`); a scorecard whose section
  weights do not total its section weight (`WEIGHTS_NOT_100`, naming the person and section); a split
  key result whose shares do not add up to its target (`CONTRIBUTION_REBALANCE`); a line linked to a
  key result of another quarter.
- Flow **`performance.plan`** (module `performance`), context `{ head_reports_to_ceo: boolean,
  by_operations_people: boolean, is_company: boolean }`, worked out by the service when it opens:

  | Stage | Approver | Condition |
  |---|---|---|
  | `line_manager` | `manager_of_subject`, subject = the function's head (or acting head) | `head_reports_to_ceo` false and `is_company` false |
  | `operations_people` | role `operations_people` | `by_operations_people` false and `is_company` false |
  | `ceo` | `ceo` | always |

  So Branding & Marketing goes Program Manager, Operations & People, CEO; Technology & Back-office
  Ops goes Operations & People, CEO; People & Culture goes Program Manager, CEO; the company plan
  goes CEO. 72 hours a stage (Approvals Waiting reminders apply).
- On completion (`workflow.onCompleted("performance.plan", …)`): plan `binding`, codes frozen,
  scorecards `binding`, each employee and reviewer told to agree. Request Changes is a refusal with a
  reason (`/reject`, never `/request-changes`, which would send the instance back to its first stage
  and leave the plan Awaiting Approval): it sets `returned` with the reason; the head edits and sends
  again (a new instance).
- Each stage decides on Goals · Waiting On You, `GET /performance/approvals`, and the plan's sheet.
  The CEO may decide any stage; the sender never decides their own unless they are the CEO
  (`approvers.canAct`). A mid-quarter scorecard sent on its own (§11) goes through the same stages
  for its function and is decided the same way: its row (Scorecard and the person) opens the
  scorecard's own sheet, with Request Changes (`/reject`, a reason) and Approve Scorecard; the
  outcome is `scorecard.amendment_decided` (approved binds it; refused leaves it a draft to send
  again).

### 6.5 Scorecards, lines, KPIs and the contribution check (PR 2)

- **Sections** Results, KPIs, Accountability, weighted 60, 25 and 15 by default (the quarter's
  rules). Lines inside a section carry weights that total the section's (their guide: "weights inside
  each section are set per role"). Each line: goal or KPI (`title`), target and how it is measured
  (`target_text`, and `target_value` for a number), linked key result or KPI, due date or frequency,
  weight, **measure** and **source**.
- **Measure** decides how a month is scored (§6.9): `numeric` (actual ÷ target), `milestone` (a date
  met), `standard` (a monthly standard met, nearly met or missed), `binary` (met or not).
- **Source** decides where the month's figure comes from: `own` (the person enters it with evidence),
  `key_result` (the linked key result's report), `team_result` (the mean attainment of the key results
  in `employee_target_key_result`), `function_kpi` (the linked KPI's monthly actual), `commitments`,
  `update_on_time`, `team_reviews` (§6.10), `tasks` (Done tasks counting towards the line in the
  month).
- Results lines are `numeric` or `milestone`; KPI and Accountability lines are `standard` or `binary`.
- **Contribution check** (their Contribution Map): a function key result is **split** when two or more
  lines link to it with a `share_value`. The check reads OK when the shares add up exactly to the key
  result's target, else Rebalance with the difference. Only outcomes counted from a record that names
  the person are split; Marketing's outcomes are shared through one Team result line instead (their
  rule; the screen offers Team Result for a key result no line splits).
- **KPIs** belong to a function, carry formula, unit, direction, target, frequency and data source, and
  record one actual per month with Met, Not Met or N/A. "No KPI repeats a key result" is their rule;
  the screen warns when a KPI's name matches a key result's.

### 6.6 Agreement (PR 2)

- A binding scorecard needs both agreements; Agreed when both are in. Pressing again does nothing.
- Disagree With Reason clears both agreements and tells the reviewer; the scorecard stays binding and
  is scored as it stands until a target change or the reviewer's reply.
- A reminder (`scorecard_agree_due`) asks each side daily from 3 business days after binding until
  they act, within working hours.

### 6.7 Target changes and the lock (PR 2)

- Before `targets_lock_on`, a TBC target (`target_provisional`) is set in place by the key result's
  owner (accountable person) or the function's head (or acting head, or whoever runs the cycle), with no
  approval: Set Target (`can_set_target`) changes `target_value` and `target_text` and leaves TBC on, so
  it may be set again until the lock date, and it shows a TBC pill. Change Target is not offered for it
  and the API refuses one (409 `TARGET_TBC`). On the lock date the `targets-lock` job sets
  `target_locked_at` and clears TBC, and the months reported while it was TBC are scored on the locked
  target.
- After the lock, and on any binding non-TBC target, Change Target opens **`performance.target_change`**
  (one stage, `ceo`). One change to a target waits at a time (409 `CHANGE_PENDING`). On approval the
  target and `from_month` apply; earlier months keep the scores they had; the months from `from_month`
  not yet confirmed are proposed again; the line or key result shows Was beside the target. A month is
  scored on the target in force then: the last change approved that applies from it or earlier, else
  the target before any change.
- Change Target is offered to whoever the API would let ask: on a key result the accountable person,
  or someone who sets the function's goals (`can_change_target` on the key result); on a scorecard
  line its scorecard's reviewer (a role reviewer's holders) or the function's head or acting head,
  never its employee (`can_change_target` on the line, `targets.service.mayChangeLineTarget`); and not
  while a change to that target waits (`pending_change` on the line, shown as Change Waiting).
- The CEO decides a change on Goals · Waiting On You: Approve Change, or Refuse Change with a reason
  (`/reject`); a refused change keeps the target, and its reason stays on the request's decisions.

### 6.8 Key result scoring and the roll-up (PR 1 maths, PR 2 screens)

From the OKR workbook's Read Me (A14), held in the quarter's `rules.key_results` and changeable:

- Scores run 0 to 1. **Numeric**: actual ÷ target, capped at 1; lower is better: target ÷ actual
  (an actual of 0 scores 1). **Dated or yes/no**: 1 done by the date, 0.7 done within 14 days after it,
  0.3 partly done, 0 not done. **Multi-part**: each part scored, then the mean.
- October and November are progress against the full quarter; December is the final.
- **Bands**: 0.7 or above Good; 0.4 to under 0.7 Watch; under 0.4 Recovery, which needs a recovery
  owner and date in the report (`RECOVERY_REQUIRED`).
- The head proposes the score in Report Month; the CEO confirms it (`goals.confirm`); the confirmed
  score counts, else the proposed one shows marked Proposed. Report Month sends only the key results
  the head changed; a month reported again keeps what the report leaves out (an imported actual, a
  recovery owner), and keeps its confirmation unless its score changes. A confirmed score reaches the
  company key results Scored From it.
- **Scored From**: a company key result wholly delivered by a function key result takes that key
  result's month (status, actual, update, scores); nothing is entered twice.
- **Roll-up**: an objective's month score is the mean of its key results' scores for that month
  (rounded to 2 places, as their sheet); a function's is the mean of its objectives'; the company's is
  the mean of the company objectives'. Blank when nothing is scored.
- A [TBC] key result is scored only once its target is locked.
- Example (their Q4 Target Build): ₦30m ticketing commission target, ₦18m actual: 0.6, Watch.

### 6.9 Scorecard line scoring (PR 1 maths, PR 3 screens)

From the scorecard workbook's Guide, held in `rules.lines`:

- **Numeric**: actual ÷ target, capped at 1; lower is better: target ÷ actual.
- **Milestone**: 1.0 delivered and accepted on time; 0.5 accepted within 10 business days after the
  due date; 0 later or not accepted.
- **Standard** (KPI and accountability lines), each month: 1.0 target met; 0.5 missed by up to 5
  percentage points, or one count above a zero target; 0 otherwise. **Binary**: 1 met, 0 not.
- A month with no eligible cases is blank (N/A), never 1.
- A Results line's score is **the latest month entered**; a KPI or Accountability line's is **the mean
  of the months entered**.
- **Score to date** = Σ(weight × score) ÷ Σ(weight of the lines that have a score). A Not Assessable
  line (§6.14) has no score.
- Worked example (John Ojelola's Results line 3, weight 15): 4 live South West placements targeted, 3
  secured by November: 0.75, so 0.75 × 15 = 11.25 weighted.

### 6.10 Automatic lines (PR 3, `targets.progress.js`)

Worked out whenever a check-in opens or is read, and again at the review's submit, for the month:

- **On-time Commitment Delivery** (`commitments`, target 80%): the person's approved commitments due in
  the month delivered by their original date ÷ those due (overdue stay in; rescoped ones leave and are
  listed separately). Scored as a standard. No commitments due: blank.
- **Monthly Update On Time** (`update_on_time`, binary): the check-in submitted by its due (the 2nd
  business day; the 3rd for heads). A month before `live_from`: blank. Scored without the check-in
  (§11): 0.
- **Team Scorecards and Reviews** (`team_reviews`, target 100%): the reader's direct reports' reviews of
  the month submitted by `review_due_on` ÷ their reviews that month.
- **Team result** (`team_result`): the mean of the linked key results' latest attainment; the same score
  for everyone on the line (their Marketing team line).
- **Function KPI** (`function_kpi`): the KPI's monthly result scored as a standard against the line's
  target; N/A is blank.
- **Key result** (`key_result`): the key result's latest actual against the line's target (a head's
  function line), numeric.
- **Tasks** (`tasks`): Done tasks counting towards the line in the month, against its target.
- Every automatic score shows Auto; the reviewer may override it with a reason (P17), shown on the
  review and its PDF.

### 6.11 Commitments (PR 4)

- A commitment is a task with `is_commitment`, `acceptance_criteria` and `commitment_month` (the first
  of the month). It may be set by the person or their manager (A24), and either may mark a task the
  manager set as a commitment. It needs acceptance criteria and a due date in its month. Until its set
  is approved it is a draft commitment.
- **Send Commitments** (`POST /performance/commitments/sets/:employee_id/:month/submit`, the person or
  someone whose `workspace` scope covers them) puts every commitment of that person and month not yet
  approved, rescoped or cancelled into the person's `commitment_set` and submits it; none is
  `COMMITMENTS_EMPTY` (422), a set already waiting is `COMMITMENTS_WAITING` (409). Sending again after
  approval reopens the set for the commitments added since; those already approved keep their dates.
- Flow **`performance.commitments`**, context `{ is_function_head: boolean, reviewer_employee_id: uuid }`:
  stage `reviewer` (`employee_in_context` on `reviewer_employee_id`) when not a head; stage `ceo` when
  a head. `is_function_head`: the person heads a department (`department.head_employee_id`, or the
  filled head seat). `reviewer_employee_id`: the reviewer on the person's binding scorecard for the
  month's quarter (a role reviewer's first active holder), else their effective line manager. The person
  is excluded from deciding it. When the sender is the reviewer, `reviewer_employee_id` is left out, so
  the stage is skipped and the set is approved as it is sent (the engine refuses a decision by whoever
  opened it, and their sending is the decision).
- **Request Changes** is a refusal with a reason (as on a plan): the set returns (`returned`, the reason
  kept on the instance), its commitments stay drafts, and the person edits and sends again (a new
  instance). Withdrawing it puts it back to draft.
- On approval each task in the set takes `original_due_at` = its `due_at`. Moving the due date later
  changes `due_at` only; the original stays (their rule: deadlines are never reset). Once approved, the
  mark, the month and the acceptance criteria are fixed (409 `COMMITMENT_APPROVED`), and Cancel Task
  refuses it: it is rescoped instead.
- **Rescope** (`POST /performance/commitments/:id/rescope`, a reason): an approved commitment not yet done
  opens `performance.commitments` over the task, with the same approver. On approval `rescoped_at` is set:
  it leaves the on-time count and is listed separately. One rescope waits at a time (409
  `WORKFLOW_ALREADY_OPEN`).
- **States**, worked out on every read (`targets.commitments.js`, one SQL expression), in this order:
  Rescoped (`rescoped_at`); Awaiting Approval (no `original_due_at`; the set's status says whether it is
  sent); Delivered On Time (done by the end of the original date's day, Lagos); Late (done after it);
  Missed (not done when its month has ended in Lagos); Due (the rest).
- **Recovery**: a missed commitment needs a recovery owner and date (their CEO KPI: a recovery decision
  within 5 business days). Set Recovery (`POST /performance/commitments/:id/recovery`) sets a task
  "Recovery: <commitment>" for the owner, due that day, through the tasks service, pointing at the
  commitment (`entity_type` `task`); the commitment shows its owner and date.
- **On time** for a month, here, on the Commitments view and in the On-time Commitment Delivery line
  (§6.10): Delivered On Time ÷ (the month's approved commitments not rescoped), counted on the month's
  `commitment_month`; none due is blank (`monthFigures()` in `targets.commitments.js`).
- **Month-end delivery report**, per function, for the CEO by the 3rd business day: an export, not a
  page (Export Report, `shared/documents/exports`). One sheet per function in the reader's scope: each
  commitment with its person, criteria, original date, date now, completed, state and recovery owner and
  date; a summary sheet with each function's due, delivered on time, late, missed, rescoped and on time
  ÷ due.
- **Reminder** `commitments_due`: on the 2nd business day of the month, 09:00 Lagos, each active person
  with a login and no set sent or approved for the month is asked to send their commitments.

### 6.12 The monthly review (PR 3)

- One review per binding scorecard per month, opened by the round (§6.2). A scorecard agreed or not is
  reviewed alike.
- **Sequence** (A17, P12): `check_in` → the employee submits → `with_reviewer` → the reviewer submits →
  `second_level` → approved → `with_hr` → Operations & People approve → `closed`. Request Changes at
  second level or HR returns it to the reviewer (`returned`, then `with_reviewer` again); the reviewer
  may return a check-in to the employee with a reason (back to `check_in`, its submission cleared).
  On screen Request Changes is the engine's reject with a reason (the instance ends and the reviewer's
  next submit opens a new one); an engine `request-changes` on the flow, which would go back to the
  first stage, is read the same way: the instance is cancelled and the review returns to its reviewer.
- **Two ways off that path** (§11): a check-in still not in once its due date has ended goes
  `check_in` → `with_reviewer` when the reviewer presses Score Without Check-In (`no_check_in_at`,
  `no_check_in_reason`); any open review may end `withdrawn` at HR's stage (`withdrawn_at`,
  `withdrawn_reason`), without a score, its pending approval cancelled. Withdrawn is an end, like
  closed: no round counts it as due, Analytics' on-time figures leave it out, and nothing more is
  offered on it.
- **What each reader sees**: the employee sees their check-in, and the reviewer's scores, comments and
  corrective actions only once closed. The reviewer sees nothing of the check-in until it is submitted
  (409 `CHECK_IN_FIRST` on read and save); once its due date has passed they may open the review, but
  still none of the employee's drafts (no actual, evidence, action, self score or score proposed from
  them), and save no score until they press Score Without Check-In. Scored without it, the drafts
  stay the employee's alone and their own lines are Not Assessable. The dotted manager sees the check-in once submitted and
  writes only their input. Second level, Operations & People and the CEO see the whole review.
- Flow **`performance.review`**, context `{ second_level_employee_id: uuid, reviewer_is_ceo: boolean }`:
  stage `second_level` (`employee_in_context` on `second_level_employee_id` = the reviewer's effective
  line manager) when `reviewer_is_ceo` is false and the field is set; stage `operations_people` (role).
  The reviewee is in `excluded_employee_ids`, so nobody decides their own review (Cynthia's own review
  is closed by the CEO).
- **On close**: `score_month` (the month's score to date), `score_to_date`, `rating` written to the review
  and to the scorecard; `documents.generate()` the review PDF (`templates/documents/review-summary.html`:
  the letterhead, the person, reviewer, month, each line with target, actual, evidence, proposed, self
  and final score, the month's tasks, the actions, input, comments, the chain with names and dates);
  the employee told.
- **Probation reviews** use the same sequence and form (§6.16).

### 6.13 Who reviews (PR 1 resolution, PR 2 and PR 3 use)

- At plan time each scorecard's reviewer is **the person's effective line manager**
  (`employee_effective_manager`: the line manager, or the first person above a vacant seat). The
  Program Manager reviews the heads of Branding & Marketing and People & Culture and the reports of the
  vacant Strategy seat; the CTO reviews the Backend Operations Manager; the CEO reviews the CTO and the
  Program Manager. The CEO has no reviewer in the system (the Board).
- **Override** (`performance.manage`, with a reason): a named person, or a role, on one scorecard. A
  role reviewer is any active holder of the role: the review opens with the role's first active holder
  by name as `reviewer_employee_id`, and whichever holder saves scores first becomes it. The review's
  `review_type` reads `designated`.
- **Dotted line**: the scorecard's `dotted_employee_id` defaults to the employee's `dotted_manager_id`
  (Chinyere for Partnership & Growth staff). Input, never approval (P14).
- **When the line changes** mid-quarter: a review already opened keeps its reviewer; the next month's
  review takes the new effective manager unless overridden. When a vacant head seat is filled, its
  person reviews from the next round.
- **Second level** is the reviewer's own effective line manager, worked out when the reviewer submits;
  none when the reviewer is the CEO.
- **New approver kind** `employee_in_context` (`{ type: "employee_in_context", value: "<uuid context
  field>" }`, `field` read as `value`): resolves to that employee when the stage starts; absent or empty
  means the stage is skipped, and the field may be left out of the context. Validated in
  `conditions.validateDefinition` (the value must be a uuid field of the context); shown on Settings ·
  Approvals as Named Person, with the value it reads.

### 6.14 Evidence and Not Assessable (PR 3)

- Every `own` actual needs evidence: a record (a task, partner, vacancy, listing pointer, through
  `linkFor`), a document (the upload engine, `purpose: performance_evidence`), a link, or a note naming
  the source record. Their rule: every score cites its source.
- No evidence: the line reads **Not Assessable**, has no proposed score and leaves the score to date's
  denominator (not zero, not full marks). The reviewer may score it anyway with a reason saying what
  they saw.

### 6.15 Rating and the conduct cap (PR 1 maths, PR 3 screens)

- **Bands** (`rules.bands`): 0.90 or above Exceeds; 0.75 to under 0.90 Meets; 0.50 to under 0.75 Partly
  Meets; under 0.50 Below. "Score to date" uses only scored lines; the final is December's.
- **Conduct** (their Guide): accurate records, honest reporting and respect are conditions, not lines.
  Operations & People mark a confirmed breach on a review with a note (Mark Conduct); the rating is
  capped at Partly Meets whatever the score. M3 marks it from an upheld sanction once it exists.

### 6.16 Corrective actions, PIPs and probation (PR 3)

- **Corrective action**: every line scored below its target in the month needs an action with an owner
  and a date before the reviewer submits (`CORRECTIVE_ACTION_REQUIRED`); it is created as a task for its
  owner pointing at the review (their PC-KR1.1). "Below its target in the month" (PR 3): a milestone,
  standard or yes-or-no line whose final score is under 1; a numeric line only in the quarter's last
  month, since a quarter's count is reached across its three months. The screen offers an action on
  any line scored under 1; the rule above is what Submit Review requires.
- **PIP**: on a closed review rated Below, Operations & People may Start PIP: the lines to improve and
  their targets, the period (default 30 days), the review date (default its end), a summary. Actions are
  tasks. A reminder fires 3 business days before the review date. Close PIP records Passed, Extended
  (new dates) or Not Met, with a note. The handbook's further action is HR's, outside the system.
- **Probation review**: on `employee.probation_ending` (Probation Ending, 14 days ahead by default) a
  review of kind `probation` opens for the person, reviewer their effective line manager, on the same
  form: their scorecard lines if they have one, else an overall assessment of KPIs and objectives, quality
  and timeliness, attendance (from the roster) and conduct, with Dictate. HR's close carries the outcome:
  **Confirm** (`organisation.service` records the confirmation), **Extend 3 Months** (moves the
  confirmation date; at most once, as the handbook allows), **End Employment** (recorded; the letter and
  exit are outside M2).
- **Cautions** (their Q3 letter): issued in Queries & Sanctions (M3). M2 emits `review.closed` with the
  rating so M3's rules can raise one; until M3, HR acts outside.

### 6.17 Dictation and Tidy (A18, P19; PR 3)

- Dictate (`VoiceField`) records up to 3 minutes and 10 MB, uploads it (`purpose: voice_note`, personal),
  and transcribes it through action **`review-dictation`** (job Transcription). The transcript lands in
  the field and is kept (`action_transcript`, `action_document_id`).
- **Tidy With AI** appears after a dictation and beside any long text; it runs only when pressed: one
  `llm.service.complete` call, action **`review-cleanup`** (job Default, `personal_data` true, so DeepSeek
  is passed over), given the line's goal, target and the text. The rule in its prompt: fix wording,
  grammar and filler, structure into Done, Behind and Next where the text allows; never add, remove or
  change a fact, figure, name, judgement or tone.
- The tidied text shows beside the original with **Use Tidied** and **Keep Original**; nothing changes
  until the person picks. `action_ai_run_id` records a run that was used. AI off or capped: "Tidy is off"
  and the original stays.

### 6.18 Workspace connections (PR 4)

- **Counts Towards**: the task form lists, from `GET /tasks/counts-towards`, the assignee's lines on their
  binding (or agreed) scorecard for the quarter holding the task's month, and the key results they are
  accountable or co-accountable for in a binding plan of that quarter; one may be chosen. A line is
  `employee_target_id` (refused unless it is the assignee's: "Not one of their lines"); a key result is
  `entity_type` `key_result`. The task names it in `counts_towards` (`kind` `line` or `key_result`, its
  title, and its link: `linkFor("target", id)`, the scorecard at the line, or `linkFor("key_result", id)`).
- **Lines measured in tasks** count the Done tasks pointing at the line whose completion falls in the month
  (Lagos), worked out on every read like every automatic line (§6.10): `tasks.service.doneTowards(line,
  month)` is the one count, which targets.progress.js (PR 3) reads. `task.completed` and `task.reopened`
  carry the line and the month of the change, so nothing stored goes stale.
- **Initiatives**: a key result's initiatives are tasks assigned to its accountable person (or the named
  role's holder where someone else must act, their rule), due on the initiative's date, pointing at the
  key result; on the board, Counts Towards names the key result.
- **My Week** (`GET /workspace/week`, the reader's or, for a manager, someone's in their scope): Done This
  Week (tasks completed Monday to Sunday, Lagos), Planned Next Week (open tasks due next week), Blocked
  (open tasks marked blocked, with reasons), each its first 25 with a total; **Support Needed** is the one
  line a person writes (`PUT /workspace/week`, their own week only, `weekly_summary`). **Tidy With AI**
  (`POST /workspace/week/tidy`, action **`week-summary`**, Default, `personal_data` true, so DeepSeek is
  passed over) turns the week's lists and that line into a short summary with Done, Planned, Blocked and
  Support Needed; it never adds a task, a fact, a figure or a name. It runs only when pressed; the summary
  shows beside the line with **Use Summary** and **Discard Summary**, and only Use Summary saves it (with the
  run). Never automatic, never sent anywhere by itself. AI off or capped: "Tidy is off".
- **Team This Week** (`GET /workspace/team-weeks`, managers): one row per person in the reader's
  `workspace` scope other than themselves: done, planned, blocked counts and Support Needed; a row opens
  that person's week.
- **Calendar**: items of kind `performance`, each all day on its date: the reader's check-in due (their
  review at `check_in`; the 3rd business day's date for a head), reviews they must write (at the reviewer
  stage) by `review_due_on`, key results they are accountable for finishing that month in a binding plan,
  and the review dates of open PIPs that are theirs or whose review they wrote.

### 6.19 Import (PR 2)

- `shared/import` gains an optional importer function **`extract(workbook) → { rows, notes }`** that turns
  a whole uploaded workbook into the importer's rows, so MyCity uploads their file as it is; preview,
  errors, commit and revert work as for any importer.
- **`okr_workbook`**: reads the function sheets and Company OKRs: an objective row (`CO-O1   Build one
  trusted view…`) starts an objective; each `…-KR` row is a key result (type, owner, linked company key
  results, start, finish, initiatives split on `•` with their trailing dates, status, actual, update, the
  monthly scores); "Scored from" sets Scored From; `[TBC]` sets TBC; the department from the sheet's title
  (now equal to the department names, P4); accountable owners matched to employees by name, a function
  named as owner resolving to its head; the change map's former IDs saved as `okr_code_alias`.
- **`okr_kpis`**: each function sheet's Operational KPIs table. The KPI column names the KPI and KPI ID
  gives its code: a header equal to the name a column is looked up by wins over one that starts with it.
- **`scorecards`**: each `00nnn Name` sheet: the person matched on the staff list by name (their staff IDs
  differ from the system's), reviewer by name; each line with section, weight, target text, linked codes
  resolved through codes and aliases, due or frequency; months entered. Unmatched people (Abubakar
  Mohammed, Emmanuel Aneke) and unresolved codes (TECH-K01 to TECH-K05, which the change map lacks) are
  errors the person resolves in the preview (pick, or skip). A line whose text names a different figure
  from its key result's target (the Marketing team line's 40,000 against 64,000) is listed as a warning:
  the key result's target is the one scored.
- A key result's status, actual and update are its latest scored month's, else the month just ended
  (within the quarter); a KPI's result is that month's too, which the KPIs figures count. A month
  imported again keeps what was reported in the app that the workbook leaves blank (a status, a
  figure, a recovery owner and date, a score).
- Reverting an import is refused once anything rests on a record it created: a key result a
  scorecard line, a target change or a confirmed score uses; a KPI a scorecard line or a review uses; a
  line whose scorecard has been agreed, bound, reassigned or edited since (by a person or a later
  import), or whose target a change names. Records an import only updated stay as they are. Reverting
  the OKR workbook cancels its initiatives' open tasks and returns a plan left empty to draft; a
  reverted KPI goes with its months and former codes, and its next import creates it again. An import
  never brings back a KPI a person retired.
- Imported plans are created binding and imported scorecards agreed (they were approved and signed in
  September); the October round is opened with `live_from` the import date.

### 6.20 The org's nomenclature (PR 1)

The five departments, checked against the Org Chart (October) on 22/10/2026 (P4, P5):

| Department (code) | People and seats | Head |
|---|---|---|
| General Management (GM) | Ifeoma Mbonu, Chief Executive Officer; Edidiong Etudor, Program Manager; Technical Assistant (vacant, staff list only) | the CEO |
| Technology & Back-office Ops (TBO) | Bode Oluwasanmi, Chief Technology Officer; Oladotun Shola-Adido, Backend Operations Manager; Tobiloba Dada and Bassey Ekpe, Content & Listing Associates | the CTO |
| Branding & Marketing (BM) | Chinyere Elechi, Head, PR, Marketing & Brand Strategy; Aaron Agama, Social Media Manager; Precious Iyeserhen, Graphics Designer; Similoluwa Michael, Graphics Associate; David Idowu-Agida, PR & Marketing Lead · MyLagosApp (now reporting to Chinyere) | Chinyere Elechi |
| Partnership & Growth (PG) | Head, Strategy, Partnerships & Growth (vacant, reports to the Program Manager); Tochukwu Ifeanyi, Marketing Lead · Abuja; John Ojelola, Marketing Lead · South West; Growth Officers Gideon Ekom (Enugu), Adaeze Chike (Abia), Victor Esuk (Imo), Rabi'a Zawiya (Kano); vacant Growth Officer seats for Rivers (G4), Anambra, Ekiti, Edo, Delta, Cross River; dotted line to Chinyere for all | the vacant head seat (acting: the Program Manager) |
| People & Culture (PC) | Cynthia Osakunih, Operations & People Lead; HR/Admin Associate (vacant) | Cynthia Osakunih |

The chart's job titles replace the staff list's where they differ (Back-end Manager → Backend Operations
Manager; Marketing & Growth Officer · State → Growth Officer · State; Graphics Design Associate → Graphics
Associate; Head Sales & Revenue → Head, Strategy, Partnerships & Growth). The role names (Operations &
People, Head of Department and the others) are roles, not departments, and stay.

### 6.21 Analytics (PR 5)

For the quarter (the current one when none is picked) and, optionally, one function, Africa/Lagos,
every figure worked out in SQL (`goals.analytics.js`). The OKR figures read the whole tree, the
company's shared plan (§8); scorecards, reviews and commitments are read in the reader's
`performance` scope, over the person each is about.

- **Company Score**: the score Goals shows: each key result at its latest month (confirmed, else
  proposed), each objective the mean of its key results to two places, the company the mean of the
  company objectives. Home's Org KPI is the same figure (`goals.cascade.js` `objectiveScores`, the
  roll-up in SQL beside its JavaScript twin).
- **Scores by month**: the company's and each function's month scores (§6.8), October, November,
  December, each key result's score for that month; a month with nothing scored is blank. With a
  function picked: the company and that function.
- **Key results by status**: the latest month's status of each key result (the function's, or every
  one, the company's included), Awaiting Report for one with no month yet, and In Recovery: a latest
  score under the quarter's Watch band.
- **Rating spread**: scorecards by rating at the latest closed round (its monthly reviews closed
  with a rating); none before a round closes.
- **Commitments on time**: per function (the assignee's department) per month, and for the
  quarter, counted as the Commitments view counts them (§6.11, the tasks module's commitment state):
  the month's approved commitments not rescoped are due, open ones included, and on time when done
  by the end of their original date in Lagos.
- **Check-ins on time** and **reviews closed on time**: per month, and for the quarter, over the
  quarter's monthly reviews. A check-in is due once its deadline has ended (the round's staff
  deadline, or its head deadline for a function's head, `department.head_employee_id`) or it is in,
  and on time when submitted by then; a review likewise against the round's close deadline and its
  `closed_at`.
- **Self against final**: per function, the mean of (self score, or proposed where unchanged) minus
  the final score over the scored lines of closed monthly reviews; above zero, people rate
  themselves higher.
- **People**: the quarter's scorecards past draft, in scope: employee, function, reviewer, score to
  date, rating, months scored (closed monthly reviews); paged at 25, sorted by score (highest first
  on screen) or name, filtered by function, rating and name. **Export** (`performance` export): the
  table as filtered, built in the worker in the asker's scope at that moment
  (`analytics.export_requested`) and downloaded where it was asked for (`shared/documents/exports`).
- **Home** (§2), over the quarter today falls in, each figure null (never zero) while nothing
  behind it is scored, read through `dashboard/sources/goals.source.js`: Goals This Quarter
  progress is the mean of the latest scores of the company objectives serving the goal; the Org KPI
  is the company's score and each department's function score, as Goals shows them; Goals On Track
  is the quarter's key results (the company's and every function's) whose latest month is On Track
  or Done ÷ all of them; My Scorecard is the reader's lines at or above the quarter's Meets band ÷
  their scored lines, a line's score being its closed monthly reviews' final scores (a Results
  line its latest month's, a KPI or Accountability line the mean of its months, §6.9), which My
  Goals This Quarter shows as each line's progress; the Team roster's score is each person's score
  to date, where the reader's `performance` view reaches them.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `period.created` · `period.changed` | a quarter saved | audit; Home and Analytics read the new quarter |
| `organisational_goal.saved` | save | search reindex; Home's goals refresh |
| `objective.saved` · `key_result.saved` | save | search reindex |
| `key_result.reported` | Report Month | lines fed by it recount (outbox); the CEO's monthly confirm list refreshes |
| `key_result.score_confirmed` | Confirm Score | the function's and company's scores refresh |
| `plan.submitted` · `plan.binding` · `plan.returned` | Send Plan; the CEO's approval; Request Changes | the engine tells each stage, and its notice opens the plan's sheet on Goals (`?plan=`); on binding each employee and reviewer is told "Your Q4 2026 scorecard is ready to agree" |
| `plan.reopened` | reverting the import of a plan's last objectives | audit only: the plan is a draft again |
| `scorecard.agreed` · `scorecard.disagreed` | agreement | notice to the other party; disagreement to the reviewer |
| `scorecard.sent` · `scorecard.amendment_decided` (PR 3) | Send Scorecard; the plan flow's decision on it | the stages are told; on approval the scorecard binds and its people are told to agree it |
| `target_change.requested` · `target_change.decided` | request; the CEO's decision | the CEO's notice opens the change's sheet on Goals (`?change=`); the requester is told; the target applies on approval |
| job `targets-lock` (daily 00:15 Lagos) | the quarter's lock date | TBC targets lock; the heads are told which locked |
| `kpi.actual_recorded` | Record Actual or Report Month | lines fed by it recount |
| `kpi.removed` | reverting the import that created a KPI | audit only: the KPI, its months and former codes are gone |
| job `review-cycles` (06:00 Lagos) with handler `review-cycle-open` | the first business day after a month ends | opens the round and its reviews (idempotent per scorecard and month); `review_round.opened` tells each person their check-in is due |
| `review.check_in_submitted` | Submit Check-In | notice to the reviewer "Ada's check-in is in"; input asked of the dotted manager |
| `review.input_asked` · `review.input_given` | Ask For Input; Give Input | notice to the dotted manager; notice to the reviewer |
| `review.submitted` · `review.returned` | Submit Review; Request Changes | the engine tells the stage; a return tells the reviewer (or the employee for a returned check-in) |
| `review.advanced` | second level approves | the review moves to `with_hr`; Operations & People are told |
| `review.closed` | HR's approval | PDF generated; scorecard score and rating written; the employee told "Your October review is closed"; carries the rating for M3 |
| `review.conduct_marked` | Mark Conduct | audit; the employee is not told by the system |
| `review.scored_without_check_in` | Score Without Check-In | the employee is told "Your October 2026 review goes ahead", with the reviewer's reason; the review reminder is scheduled |
| `review.withdrawn` | Withdraw Review; a leaver's leaving | its pending approval and reminders end; the employee, reviewer and second level are told (a leaver's: the reviewer and second level), with the reason |
| `employee.archived` (people, existing) | People archive a record | handler `reviews.leaver`: the person's open reviews end Withdrawn ("The employee left.") and their scorecards close (`scorecard.closed`); with a leaving date (`employee.left_on`) still ahead, reminder `review_leaver_withdraw` is scheduled for 06:00 Lagos on that date instead |
| `review.leaver_due` | reminder `review_leaver_withdraw` fires (still archived, the date come) | handler `reviews.leaver_on_date`: as above, the note naming the date; a record restored before it ends the reminder |
| `scorecard.closed` | a leaver's scorecard closes | audit; no round reviews it again; its lines, scores and commitments stay reportable |
| `improvement_plan.started` · `improvement_plan.closed` | Start PIP; Close PIP | notice to the employee and their reviewer |
| `employee.probation_ending` (people, existing) | Probation Ending | handler opens the probation review; the reviewer is told |
| `analytics.export_requested` | Export on Analytics | outbox `goals.analytics_export`: the people workbook in the asker's scope, failed when they are no longer active or may no longer export; the screen downloads it (foundation.md §6.12) |
| `probation.decided` | HR's outcome | `organisation.service` confirms or extends; the employee is told |
| `commitments.submitted` · `commitments.approved` · `commitments.returned` | Send Commitments; approval; Request Changes | the engine tells the approver; the person is told when someone else sent it, and of the approval or the reason it came back |
| `commitment.rescope_requested` · `commitment.rescoped` · `commitment.rescope_refused` | Rescope Commitment; approval; Request Changes | the engine tells the approver; the person is told the outcome |
| `commitment.recovery_set` | Set Recovery | audit; the Recovery task's own `task.created` tells its owner |
| `commitments.report_requested` | Export Report | the worker makes the month-end delivery report (`shared/documents/exports`) |
| `task.completed` · `task.reopened` (workspace) | a task enters or leaves Done | carry the line it counts towards and the month; `tasks` lines and commitment states are worked out on read (§6.11, §6.18), so nothing is recounted |
| `week.summary_saved` | Support Needed or a summary saved | the manager's Team This Week refreshes |
| reminder `check_in_due` | 2 business days before the due date and on it, 09:00 | the person |
| reminder `review_due` | the day after the check-in and on the due date | the reviewer |
| reminder `review_close_due` | the round's close date, 09:00, while the review is with Operations & People | Operations & People |
| reminder `kr_report_due` | the 2nd business day of the month, 09:00 | the heads with key results unreported |
| reminder `commitments_due` | the 2nd business day, 09:00 Lagos | each active person with a login and no set sent or approved for the month |
| reminder `scorecard_agree_due` | §6.6 | each side not yet agreed |
| reminder `pip_review_due` | 3 business days before the review date | Operations & People and the reviewer |

Reminders are declared with `reminders.defineReminder` (`docs/guides/notifications.md` §7.1); approval
stages use the engine's Approvals Waiting. Every handler is idempotent. Schedulers are listed in
`SCHEDULERS` (`check/schedulers.js`).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Staff (`employee`, `performance` own) | their scorecard, reviews and commitments; the whole OKR tree and every KPI (shared, not scoped) | agree or disagree, check in, dictate and tidy, send commitments, write Support Needed |
| Line Manager (`manager`, team) | their reporting line's scorecards, reviews, commitments and weeks | draft scorecards, score reviews, ask for input, approve their people's commitments, second level for their reports' reviewers |
| Head of Department (`head_of_department`, team) | their department | as a line manager; `goals.function`: the function's OKRs and KPIs, Report Month, Send Plan |
| Management (`management`, all) | everyone | `goals.company`; first plan stage where they are the head's line manager (the Program Manager) |
| Operations & People (`operations_people`, all, full) | everyone | the plan's second stage; HR's review stage; `performance.manage`: quarters and rules, rounds, reviewer changes, conduct, PIPs, probation outcomes, imports, Withdraw Review |
| CEO | everyone | every capability; the plan's final stage; Confirm Score; target changes; heads' commitments |

Capabilities and their default holders (the CEO holds every one, and so does the Implementation Team,
which holds everything there is so training runs from the build account):

| Capability | Allows | Held by default |
|---|---|---|
| `goals.organisation` | Record and edit the organisational goals | nobody else (the CEO), but Implementation |
| `goals.company` | Set the company objectives and key results | Management |
| `goals.function` | Set a function's objectives, key results and KPIs, report its month and send its plan (the service also requires being its head or acting head) | Management, Head of Department, Operations & People |
| `goals.confirm` | Confirm the month's key result scores | nobody else (the CEO), but Implementation |
| `performance.manage` | Run the cycle: quarters and rules, rounds, reviewer changes, conduct, PIPs, probation outcomes, imports | Operations & People, Implementation |

**Restricted content.** A check-in's actions, evidence notes and transcripts, a review's comments, input,
conduct and PIPs are visible only to the employee (their own, once closed for the reviewer's parts), the
reviewer, the dotted manager (the check-in and their input only), the second level, Operations & People and
the CEO. They never go to search, Home, Analytics (scores only) or the AI (§9).

## 9 · AI and search

- **AI reads** (A23, paged at 25, within permissions): `goals.ai.js`: `goals.okrs` (a function's or the
  company's objectives and key results with the latest status and score: "how is Marketing doing on Q4"),
  `goals.trace` (what a key result rolls up to), `goals.analytics` (a quarter's Analytics in the asker's
  scope, scores and counts only, citing nothing). `kpis.ai.js`: `kpis.list` (KPIs with the latest results).
  `targets.ai.js`: `scorecards.list` (score to date and rating in scope; "who is below Meets"),
  `commitments.list` (a month's commitments and their states in scope; "what did Marketing miss in
  October"). `reviews.ai.js`: `reviews.list` (stages and scores only; never
  actions, evidence, transcripts, comments, input, conduct or PIPs).
- **AI routes**: "do my check-in" → `ess.my-performance` with `check_in=1`; "set my commitments" →
  `workspace.tasks` with `new=1&commitment=1` (New Task with Commitment ticked); "open Ada's scorecard" → `performance.targets` with the
  scorecard; "report the month" → `performance.goals` with `report=1`; "see performance analytics" →
  `performance.analytics`.
- **Feature AI** (§6.17, §6.18): `review-dictation` (Transcription), `review-cleanup` (Default),
  `week-summary` (Default), each registered in `src/services/ai/actions.js` with `chosen_by` TB,
  `chosen_at` 2026-10-22, `personal_data` true, and its prompt in `src/services/ai/prompts/<key>.md`.
- **Search**: `goals.search.js`: types `key_result` (code, alias codes, statement), `objective` (code,
  title), `organisational_goal` (code, theme, goal); words goal, OKR, objective, key result, KR, target.
  `kpis.search.js`: `kpi` (code, name). `targets.search.js`: `scorecard` (person, quarter; scoped);
  words scorecard, targets. `reviews.search.js`: `review` (person, month; scoped); words review,
  appraisal, check-in. PIPs: `search:none` (sensitive; reached from the review). Commitments are tasks:
  `tasks.search.js` finds them with the words commitment and commitments too. A commitment set is reached
  from its approval and the Commitments view (`search:none`; route map `commitment_set` →
  `performance.targets` with `?set=`). A quarter plan and a target change are reached from their approval
  and from Goals (`search:none`); ⌘K's Waiting on You lists them and opens their sheets. The week is a view over tasks (`search:none`, `ai:none` as the
  rest of the `workspace` module). A mid-quarter scorecard waiting on someone is in ⌘K's Waiting on
  You and opens its sheet through the route map's `scorecard` (`?id=`); Change Target on a line,
  Score Without Check-In and Withdraw Review sit on the scorecard and the review, which search finds
  (`search:none` with that reason beside each). ⌘K actions: New Goal, Set Up Quarter (`performance.goals`
  with `action=quarter`, `performance.manage`), New Scorecard, Report Month, Start Check-In, New Commitment
  (`workspace.tasks` with `action=commitment`). Edit and delete are actions on a record, reached by
  opening it: ⌘K opens an organisational goal's sheet (`?goal=`), an objective's (`?objective=`) and a
  key result's panel (`?id=`), each with its Edit and Delete; Set Target sits on the key result's panel;
  Edit Quarter on Goals' Manage Quarters menu (a quarter is picked on Goals, never searched for).
- **Route map** record types (PR 1): `organisational_goal` (`?goal=`), `objective` (`?objective=`),
  `key_result` (`?id=`) → `performance.goals`, each opening its sheet;
  `kpi` → `performance.kpis`; `scorecard` and `target` (a line) → `performance.targets`, self →
  `ess.my-performance`; `review` → `performance.reviews`, self → `ess.my-performance`;
  `improvement_plan` → `performance.reviews`, self → `ess.my-performance`. After PR 5: `performance_plan`
  → `performance.goals` with `?plan=`, self → `ess.my-performance` (a binding notice to someone who
  cannot open Goals), and `target_change` → `performance.goals` with `?change=`, so the bell, Need You,
  ⌘K and the assistant's citations open their sheets.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.**

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Performance · Goals (`goals`) | The quarter and its dates (desktop subtitle); the quarter switcher; New Goal (Organisational Goal, Objective, Key Result as the reader may); Manage Quarters (`performance.manage`): Set Up Quarter and Edit Quarter, a wizard of Quarter (Name, Starts, Ends, Lock Date, Status), Bands (Good, Watch, Exceeds, Meets, Partly Meets), Key Result Scoring (On Time, Grace Days, Late, Partly Done), Line Scoring (On Time, Grace Days, Late, Met, Near Miss, Near Points) and Section Weights (Results, KPIs, Accountability), its last button Set Up Quarter or Save Quarter; Company Score, On Track, In Recovery, Awaiting Report; function chips (Company and the four functions, each with its score); Organisational Goals (code, theme, goal), a row opening the goal's sheet (Goal, Theme, Success Measure, Baseline, Description, a target per quarter; Delete Goal and Edit Goal for the CEO: Goal, Description, a target per quarter of its year); per objective its code and title, Edit Objective and Delete Objective behind the card's menu while its plan is draft or returned, its key results (code, key result, owner, finish, status, October, November, December, a TBC pill); Plan Approval (status, objectives, scorecards, what stops it) with Send Plan; Waiting On You (hidden when empty): Request (the function's plan, Target Change and its code, or Scorecard and the person), From, Stage, Waiting Since; a row opens its sheet (a scorecard's is the scorecard's own sheet, below). A plan's sheet: Function, Quarter, Status, Stage, Sent By, Sent On, Objectives, Key Results, Scorecards, the Chain of its stages, what was returned and what warns, Objectives (code, objective, key results) and Scorecards (person, reviewer, lines, status); Request Changes and Approve Plan for its approver. A target change's sheet: Key Result (or Line and Person), Function, Quarter, Old Target, New Target, From Month, Reason, Asked By, Asked On, Status; Refuse Change and Approve Change for the CEO; Report Month for the head. A key result opens a panel: Key Result, Type, Owner, Start, Finish, Baseline, Target (with Was after a change), Change Waiting (the new target and its month, while a change waits), Feeds, Fed By, Initiatives (each task with its date), This Month (Status, Actual, Source, Update, Recovery Owner and Date, Proposed, Confirmed), History, Rolls Up To; Change Target, Confirm Score (CEO); Edit Key Result and Delete Key Result while its plan is draft or returned; Set Target (Target, Target in Words) on a TBC target before its lock date. New Key Result and Edit Key Result: Objective, Key Result, Measure, Target, Target in Words, TBC, Unit, Finish, Owner, Feeds (a function's key result), and More (Scored From for a company's, Co-Owner, Direction, Baseline, Start, Type, Owner Note). A delete asks once, naming the item. Every target, actual and baseline figure reads as people write it (64,000; 40%; 12 partners) | Help term on the score figures: "Scores run from 0 to 1. Green is 0.7 or above; amber 0.4 to 0.7; red below 0.4 needs a recovery plan." On TBC: "A provisional target, locked on the quarter's lock date." On Scored From: "This key result takes its figures from the function key result named." | The cascade rules, who sets which level, codes and why links are by id: §6.1, §6.3. How plans are approved: §6.4. Their KR types explained: the manual |
| Performance · Scorecards (`targets`) | The quarter (desktop subtitle); Scorecards and Commitments switch. **Scorecards**: Scorecards, Agreed, Awaiting Agreement, Below Meets; filters Department, Status, Reviewer; New Scorecard; the list (Employee, Department, Reviewer, Status, Score to Date, Rating). A scorecard: the person, designation, department, reviewer, dotted line, scope; Score to Date, Rating, Weights, Agreed; Results, KPIs, Accountability, each with its weight and lines (Goal or KPI, Target, Linked To, Due, Weight, Oct, Nov, Dec, Score, an Auto pill, a Change Waiting pill); Contribution (key result, shares, target, OK or Rebalance); Edit Lines, Copy Last Quarter, Agree Scorecard, Disagree With Reason, Change Reviewer. A mid-quarter scorecard sent on its own: Approval (the stage it is with) and the chain of its stages; Request Changes (asks Reason) and Approve Scorecard for its approver. A line opens its own sheet: Line, Section, Target, Change Waiting (the new target and its month, while a change waits), Linked To, Due, Weight, Score; Change Target (New Target, From Month, Reason) for the scorecard's reviewer or the function's head. A link to a scorecard opens its sheet over the list once. **Commitments**: the month switcher; Commitments, On Time, Late or Missed, Awaiting Approval; filters Department and State; Search People; Waiting On You (person, month, commitments, sent) with Approve Month and Request Changes (asks Reason); the list (Commitment, Person, Original Date, Due Now, State: Not Sent, Awaiting Approval, Returned, Due, On Time, Late, Missed, Rescoped); Export Report | Help term on Linked To: "The key result or KPI this line feeds. Its figures come from there." On Auto: "Worked out by the system. Your reviewer can change it with a reason." On Original Date: "The date agreed when the month was approved. It never moves." | The section weights' origin, sources and measures: §6.5. Contribution rules: §6.5. Commitment states' arithmetic: §6.11 |
| Performance · KPIs (`kpis`) | The quarter (desktop subtitle); function chips; KPIs, Met Last Month, Not Met, Awaiting Actual; New KPI; the list (KPI ID, KPI, Target, Direction, Oct, Nov, Dec as Met, Not Met or N/A with the actual). A KPI opens: Formula, Unit, Direction, Target, Frequency, Data Source, the months with actual and comment, Lines Using It; Record Actual, Edit KPI | Help term on N/A: "No eligible cases this month. It never counts as met." | That KPIs are not scored at function level and never repeat a key result: §6.5 |
| Performance · Reviews (`reviews`) | The month (desktop subtitle); the month switcher; Check-Ins In, With Reviewers, With HR, Closed; Waiting On You (each review that needs the reader: Score, Approve, Give Input); the list (Employee, Reviewer, Stage, Due, Score, Rating), filters Department, Stage, Kind; Reviews and PIPs switch; Open Round, Close Round. A review: the person, month, reviewer, stage (Chain: Check-In, Reviewer, Second Level, HR); per line the target, actual, evidence, the employee's action, Proposed, Self (with reason), Final, an Auto pill; Input from the dotted manager; Done This Month, Ongoing, Next Month; This Month (on time, late and absent days; recognitions received); Score This Month, Score to Date, Rating; Corrective Actions; Comment; Submit Review, Ask For Input, Approve, Request Changes, Close Review, Mark Conduct, Start PIP; for a probation review Confirm, Extend 3 Months, End Employment; Download PDF once closed. Waiting state: "Waiting for the check-in."; once that check-in is late, Score Without Check-In (asks Reason) for the reviewer. Withdraw Review (asks Reason) for Operations & People on an open review; No Check-In and Withdrawn (each with its reason) on the review; the Withdrawn stage. | Help term on Proposed: "Worked out from the actual against the target." On Self: "The employee's own score, with their reason." On Not Assessable: "No evidence was given, so it does not count either way." | The self-first rule, what each reader may see, the chain's conditions and skips: §6.12, §6.13. Scoring rules: §6.9 |
| Performance · Analytics (`analytics`) | The quarter (desktop subtitle); quarter and function switchers; Company Score, Commitments On Time, Check-Ins On Time, Reviews Closed On Time (each a percentage, with "12 of 15" under it); Scores by Month (Function, Oct, Nov, Dec; the company as Company); Key Results by Status (On Track, Done, At Risk, Off Track, Missed, Not Started, Awaiting Report, In Recovery); Rating Spread (the four ratings, the round's month under it on desktop; "No Closed Round" before one); Commitments On Time (Function, Oct, Nov, Dec as "7 of 9"); Self Against Final (Function, Self Against Final, Lines Scored); People (Employee, Department, Reviewer, Score to Date, Rating) with Search People, and Export for a reader who may export; empty: "No Quarter Yet" | Help term on Self Against Final: "The employee's score minus the final score, on average. Above zero means people rate themselves higher." | How each figure is worked out: §6.21 |
| ESS · My Performance (`my-performance`) | The quarter and reviewer (desktop subtitle); Score to Date, Rating, This Month, Commitments On Time, Agreement; a banner when something waits: Agree Scorecard with Disagree With Reason, or Start Check-In with its due date; My Scorecard (the three sections and their lines with months and scores); This Month's Check-In (per line: Goal, Target, Actual, Evidence with Add Evidence, Action with Dictate and Tidy With AI, Proposed, Change Score; automatic lines with their figures; Done This Month, Ongoing, Next Month; Save Draft, Submit Check-In); My Commitments (this month's, each with its state and original date; Send Commitments while some are not sent); Rolls Up To (a line's path to the organisational goal); My Reviews (month, score, rating, status; a closed review opens with its final scores and Download PDF); My PIP when one is open. Their own scorecard's link opens My Scorecard. A dictation shows As Spoken and Tidied with Use Tidied and Keep Original | Help term on Score to Date: "Your scored lines, weighted. December's is your quarter's final." On Change Score: "Give a reason. Your reviewer sees both scores." On Evidence: "Link a task or record, attach a file, or name the source." | That the reviewer cannot see it until submitted, scoring rules, the review chain: §6.9, §6.12. How tidying works: §6.17 |
| My Workspace · Today (`today`) (PR 4) | My Week (Done This Week, Planned Next Week, Blocked, each with its count and its tasks), Support Needed and the accepted Summary, Write Support Needed (Support Needed, Tidy With AI, Save Line; a summary shows with Use Summary and Discard Summary); Team This Week for managers (Person, Done, Planned, Blocked, Support Needed), a row opening that person's week | Help term on Support Needed: "One line on what would help you this week. Your manager sees it." | That the weekly tracker retired: this guide §3.4 |
| My Workspace · Tasks (`tasks`) (PR 4) | On the task form: Counts Towards (Optional), Commitment (a checkbox), and once it is ticked Acceptance Criteria and Month; on a card a Commitment pill; on the panel Counts Towards (with Open), State, Original Date, Recovery (owner and date); Rescope Commitment (asks Reason), Approve Rescope and Request Changes for its approver, Set Recovery on a missed one (Owner, Due); Send Commitments in the page header, which opens Person (Optional, for a manager), Month, that month's commitments and Send Commitments | Help term on Counts Towards: "The scorecard line or key result this work is for. Done tasks show as evidence." On Commitment: "A priority for the month. Its date is fixed once approved." | Commitment approval and on-time rules: §6.11 |
| My Workspace · Calendar (`calendar`) (PR 4) | Performance items in the month and in Coming Up (Check-In Due, Review Due, Key Result Due, PIP Review) | None | Which dates appear: §6.18 |
| Home · Overview (PR 5) | Goals This Quarter with progress; the Org KPI donut with each department; Goals On Track (CEO); My Scorecard (staff); Reviews Due; My Reviews Due | As each card's help in `home.md` §10 | Their arithmetic: §6.21 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Performance · Goals (`goals`) | The quarter switcher, the four figures two to a row, function chips scrolling sideways, Waiting On You as cards (request, from, stage, since) when something waits, then objectives as cards with their key results as rows (code, status pill, latest score) | The Organisational Goals strip (behind a card that opens a sheet); the month columns (latest month only, the rest in the key result's sheet) | Report Month (heads) or New Goal, the floating button; Manage Quarters opens an action sheet, and Set Up Quarter a full-screen wizard; a key result opens a sheet with Change Target or Set Target, Confirm Score, Edit Key Result and Delete Key Result at its foot, and its form is a full-screen sheet with More opening in place; an objective card's menu is an action sheet; a plan stage opens a full-screen sheet with Request Changes and Approve Plan at its foot, a target change a sheet with Refuse Change and Approve Change | Bottom bar More, Performance; the five tabs along the top |
| Performance · Scorecards (`targets`) | The Scorecards and Commitments switch; Scorecards as person cards (name, rating pill, score to date); Commitments as cards (commitment, person, state pill, original date) under the month switcher | The figures (a summary line instead); the contribution table (in the scorecard's sheet) | Agree Scorecard, Approve Scorecard or Approve Month, full width in the sheet; New Scorecard in the floating button; a line card opens its sheet with Change Target at its foot | As above; a commitment card opens its task, Back returns to the list; a line's sheet closes back to its scorecard |
| Performance · KPIs (`kpis`) | Function chips, then KPIs as cards (code, name, latest result pill) | Formula and data source (in the KPI's sheet) | Record Actual, full width in the sheet | As above |
| Performance · Reviews (`reviews`) | Waiting On You as cards first, then the month's reviews as cards (person, stage pill, due) | The figures (a summary line instead); the list's filters behind Filter | A review opens full screen with one line per card and Submit Review, Approve or Close Review in its footer | As above |
| Performance · Analytics (`analytics`) | The quarter and function switchers, the four figures two to a row, then Scores by Month | Self Against Final; the People table beyond 5 rows (View All opens a sheet with Search People and Export) | none | As above |
| ESS · My Performance (`my-performance`) | The banner when something waits, the five figures two to a row, then icon cards: My Scorecard, This Month's Check-In, My Commitments, Rolls Up To, My Reviews | The subtitle; the month columns of My Scorecard (the latest score per line, months in the line's sheet) | Start Check-In, full width; the check-in is a full-screen sheet, one line per card, Dictate a 44 px round button, Submit Check-In in its footer | Bottom bar Self-Service; the ESS tabs along the top |
| My Workspace · Today (`today`) (PR 4) | My Week as one card (three counts and Support Needed) under the existing Today cards | Team This Week beyond 5 people (View All opens a sheet) | Write Support Needed in the card's sheet | Bottom bar Workspace |

## 11 · Edge cases

- **Double press** on Send Plan, Agree Scorecard, Submit Check-In, Submit Review or an approval: one
  request (F26); the second answers 409 and the screen reloads.
- **A link to a request already decided, or one the reader does not decide** (a stale bell notice,
  a staff member's binding notice): the plan's or change's sheet opens on its record with its status
  and no decision buttons (`can_decide` false, or the instance closed).
- **A person joins mid-quarter**: their manager drafts a scorecard; it goes through a function plan
  amendment (a new instance of `performance.plan` holding only that scorecard). Months before it is
  binding are not reviewed. A draft scorecard of a binding plan is edited until Send Scorecard
  (`POST /performance/scorecards/:id/submit`); its plan's stages (the head's line manager, Operations
  & People, the CEO) decide it on Goals › Waiting On You, Scorecard and the person, whose row opens
  the scorecard's sheet with Request Changes and Approve Scorecard ("Sent on to Operations & People",
  "Scorecard approved"); the bell and ⌘K open the same sheet (`?id=`). Approved, it binds and both
  sides are asked to agree; refused, it is a draft again and its sender is told the reason. A round
  reviews it from the first month that ends after it binds. A scorecard is refused only while its
  plan is with the approvers (409 `PLAN_NOT_OPEN`).
- **A person leaves**: when People archive them (`employee.archived`), their open reviews close as
  Withdrawn at HR's stage with a note ("The employee left."), any pending approval on them is
  cancelled, and their scorecards close; their lines, scores and commitments stay reportable. With a
  leaving date still ahead on their record (`left_on`), all this happens on that date, 06:00 Lagos,
  through the reminder engine (`review_leaver_withdraw`), the note naming the date; a record restored
  before then changes nothing. Operations & People may also Withdraw Review on any open review, with
  a reason (`POST /performance/reviews/:id/withdraw`); the employee, reviewer and second level are told.
- **A manager sends someone's commitments and is also their reviewer**: the set is approved as it is sent
  (§6.11); a manager who is not the reviewer sends it to the reviewer as the person would.
- **A commitment's date moves into the next month**: it stays in its own month; not done when that month
  ends, it reads Missed there, and done later it reads Late.
- **A commitment added after the month was approved**: it waits as Not Sent until Send Commitments is
  pressed again, which asks for the new ones only.
- **Double press** on Send Commitments, Approve Month or Set Recovery: one request (F26); a second Send
  answers 409 `COMMITMENTS_WAITING`, a second Set Recovery 409 `RECOVERY_SET`.
- **A person moves department mid-quarter**: their scorecard stays with the quarter it was approved in;
  next quarter's is drafted in the new function.
- **The reviewer leaves or changes**: §6.13; Operations & People may reassign an open review (the engine's
  `reassign`).
- **The head seat is vacant** (Partnership & Growth today): the Program Manager acts as head for the plan
  and the month's report (`organisation.headOf`); when filled, the new head acts from the next action.
- **Cynthia's own review**: the reviewee is excluded from deciding it, so its HR stage waits on the CEO.
- **The CEO's scorecard**: self check-in only, marked for the Board; its review names the CEO as reviewer
  (the column is required) and closes when the check-in is submitted; scored like any other.
- **A key result is reported late**: lines fed by it read the previous month's figure until the report;
  the reviewer may override.
- **No check-in by the due date**: once the due date has ended (Lagos) the reviewer opens the review,
  still without any of the employee's drafts, and may press Score Without Check-In, with a reason
  (`POST /performance/reviews/:id/score-without-check-in`). The review goes to the reviewer; the
  employee's own lines are Not Assessable (the reviewer may still score one, with a reason); Monthly
  Update On Time scores 0; the employee is told by a notice. The reason is shown on the review (No
  Check-In) and printed in its PDF, whose own lines read No check-in.
- **The round opens on a holiday**: it opens on the next business day.
- **A function KPI reads N/A**: lines fed by it are blank that month.
- **Import errors**: a row that cannot be matched is skipped only when the person says so; nothing partial
  is committed without the preview's confirmation; revert removes what the import created.
- **AI off, capped or failing** (`ai_governance`): Dictate still gives the transcript where Transcription
  works; Tidy says "Tidy is off"; nothing blocks a submit.
- **Offline on a phone**: a check-in is saved as a draft on the server with each Save Draft; a submit
  offline is refused with "No connection. Try again." (no local queue).
- **Two quarters overlap in planning**: only one quarter is `active`; Q1's plan may be drafted while Q4 is
  active, and scorecards for Q1 become binding without touching Q4's reviews.

## 12 · Donor code

No donor holds MyCity's model: the OKR cascade with links and Scored From, the scorecard's three sections
and its rules, the contribution check, the commitment register and the monthly check-in are net-new, built
from MyCity's workbooks (REUSE_MAP §3.2 lists appraisal and goals code; it predates the workbooks). The
donor repositories are not on this machine; where an engineer has them, only these patterns are worth a
look, and nothing is copied with its names (provenance gate):

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/hr/appraisal/appraisal.evidence.js` | the idea of evidence per scored item; ours is the pointer, document, link or note of §6.14 |
| pixie | `src/shared/hr_payroll/appraisal.review-pdf.js` | a review to PDF; ours goes through `documents.generate()` and the letterhead template |
| pixie | `src/shared/goals/target.progress.subscribers.js` | recounting from domain events; ours are outbox handlers on `task.completed`, `kpi.actual_recorded`, `key_result.reported` |

**Files by PR.** Each parallel PR stays in its own files; PR 1 created every module and screen file below
(empty parts say which PR fills them) and README §5.5 lists them. Prompts, templates and staging seeds
are created by the PR that writes them: an empty prompt or template would be loaded as one.

| PR | Backend | Frontend | Other |
|---|---|---|---|
| 1 | `organisation` (department head, `headOf`); `goals.periods.js`, `goals.routes.js` (periods), `goals.controller.js`, `goals.service.js`, `goals.repo.js`, `goals.events.js` (periods), `goals.search.js` (key results, objectives, organisational goals); `shared/time/working-week.js`; `shared/workflow/{conditions,approvers,definitions,engine}.js`; `shared/access/access.catalog.js`; `shared/route-map.js`; `shared/search/screens.js`; `scripts/db/{load-staff,staff-nomenclature}.js`; the empty files the later PRs fill: `goals.{import,analytics}.js`, `kpis.{search,import}.js`, `targets.{weights,commitments,import,search}.js`, `reviews.{search,pip}.js`, `ess.performance.js` (the stubs `kpis.weights.js`, `reviews.{autoscore,metrics,analytics}.js` are gone) | `app/src/features/performance/index.tsx`; empty parts `Goals.tsx`, `Kpis.tsx`, `Scorecards.tsx`, `Commitments.tsx`, `Reviews.tsx`, `ReviewPage.tsx`, `CheckIn.tsx`, `Analytics.tsx`; `app/src/features/ess/Performance.tsx` composed of the parts in `app/src/features/performance/my/` (`MyScorecard.tsx`, `MyCommitments.tsx`, `MyReviews.tsx`, with `CheckIn.tsx`); `app/src/api/mock/modules/performance.ts` | `migrations/2100_*`, `seeds/reference/2190_*`; every contract file; `seeds/staff/*` |
| 2 | `goals/*` (but not `goals.analytics.js`), `kpis/*`, `targets.{service,repo,routes,controller,events,ai,search,import,weights}.js`; `shared/import` (`extract`); `dashboard/sources/goals.source.js` | `Goals.tsx`, `Kpis.tsx`, `Scorecards.tsx` | `seeds/staging/45_performance_plan.js`; `seeds/staging/performance/` (the two workbooks) |
| 3 | `reviews/*`; `targets.progress.js`; `ess.performance.js` and the ESS routes; `dashboard/sources/reviews.source.js`; `services/ai/prompts/review-{dictation,cleanup}.md`; `templates/documents/review-summary.html` | `Reviews.tsx`, `ReviewPage.tsx`, `CheckIn.tsx`; `my/MyScorecard.tsx`, `my/MyReviews.tsx`; `app/src/features/ess/Performance.tsx` | `seeds/staging/46_performance_reviews.js` |
| 4 | `targets.commitments.js` and its routes in `targets.routes.js`, its events and flow handler in `targets.events.js`, its read in `targets.ai.js`; `tasks/*`, `calendar/*`, `workspace/*`; `services/ai/prompts/week-summary.md`; `commitment_set` in `shared/route-map.js` | `Commitments.tsx` and the Scorecards and Commitments switch at the top of `Scorecards.tsx`; `my/MyCommitments.tsx`; `app/src/features/workspace/*`; its mock routes in `app/src/api/mock/modules/workspace.ts` | `migrations/2400_performance_commitments.sql`; `seeds/staging/47_performance_commitments.js`; `docs/guides/workspace.md` |
| 5 | `goals.analytics.js` and its routes; `dashboard/{dashboard.layout,dashboard.team}.js`, `dashboard/kpi-catalog/tiles/work.js`; built: also `goals.{routes,controller,events,ai}.js` (a few lines each), `goals.cascade.js` (`objectiveScores`), `dashboard/sources/goals.source.js`, `dashboard/dashboard.controller.js` | `Analytics.tsx`; built: also the Analytics and Home mocks and `app/src/api/types/performance.ts` (Analytics left it) | `docs/guides/home.md` |

| After 5 · Goals on screen | `goals.{periods,repo,service,controller,routes,okrs,events}.js` (quarters with rules and status, a plan year's quarters, `GET /objectives/:id`, `GET /key-results`, `DELETE /goals/:id`, `can_edit`, `can_set_target`, `TARGET_TBC`); `shared/route-map.js` (`?goal=`, `?objective=`); `shared/search/actions.js` (Set Up Quarter); contract `goals.js`, `scoring.js` (rule errors that fit a field) | `Goals.tsx`, `Quarter.tsx`, `KeyResultForm.tsx`, `shared.tsx` (`figureOf`, `bodySchema`), the figures in `Kpis.tsx`, `Scorecards.tsx`, `CheckIn.tsx`, `ReviewPage.tsx`, `Approvals.tsx`; `packages/ui` `lib/format.ts` (`formatNumber`) and `form/MoreFields.tsx`; the mock (`api/mock/{data,modules}/performance.ts`) | `tests/integration/performance-goals-edit.test.js`; `Goals.test.tsx` |
| After 5 | `goals.{repo,service,controller,routes,okrs}.js` (`GET /approvals`, `GET /target-changes/:id`, `submitted_by`, a line's change kept to scope, no second Change Target while one waits); `shared/route-map.js` (`performance_plan`, `target_change`) | `Approvals.tsx` (Waiting On You and the plan and target change sheets), mounted by `Goals.tsx`; `ReasonForm`'s `action` (`workspace/Commitment.tsx`); the plan and change flows in the mock (`api/mock/modules/performance.ts`, `organisation.ts`) | |

| After #130 | `goals.{repo,service,routes}.js` (approvals of kind `scorecard`; a line's change kept to its reviewer and the function's head), `goals.analytics.js` (a withdrawn review is never due); `targets.{service,repo,events}.js` (`mayChangeLineTarget`, a line's waiting change, `closeOfLeaver`, `scorecard.closed`); `reviews.{service,sequence,repo,routes,controller,events,pdf}.js` (Score Without Check-In, Withdraw Review, the leaver's handler and reminder); `templates/documents/review-summary.html` | `Approvals.tsx` (a scorecard's row), `Scorecards.tsx` (`useScorecardSheet`, the link, the approval footer, a line's sheet and Change Target), `ReviewPage.tsx`, `shared.tsx` (Withdrawn), `ess/Performance.tsx` (the own link); the mock (`api/mock/{data,modules}/{performance,reviews}.ts`) | `migrations/2310_performance_review_withdrawn.sql`; `Scorecards.test.tsx`, `ReviewEdges.test.tsx` |

Shared files more than one parallel PR touches, merged by rebase: `src/services/ai/actions.js` (PR 3 and
PR 4 each add entries), `src/shared/search/actions.js` (each adds its ⌘K actions), `contract.gen.ts`
(regenerate, never hand-merge), `docs/PROGRESS.md` and this guide (each edits its own rows and lines).

## 13 · Open questions

- **The 2026 Organisational Goals and Targets sheet** (11 goals with their quarterly cascade) and **the
  paper review form** were never received (10/10 next steps; Drive and mail searched 22/10/2026). The
  organisational goals are entered by the CEO, or imported if the sheet arrives. TB to ask Cynthia.
- **Emmanuel Aneke** (G4): confirm he has left. TB, before PR 1 merges.
- **Delivery dates** against the M2 window (20 to 23 October, demo on 23 October): this plan does not fit
  it; TB sets the dates for the five PRs and tells MyCity what the 23/10 demo shows.
- **The Program Manager's scorecard** (G5): the CEO to write it with the General Management plan.
- **Review deadlines** (G3): the 5th, 7th and 10th business days are this guide's defaults; Cynthia may
  change them on the quarter's rules.
- **M3 hand-off**: the caution letter and the conduct mark from upheld sanctions. GE, at M3's start.

## 14 · Change log

- 22/10/2026 · TB · Goals on screen, the six items left after PR 130 (TB's decisions of 22/10/2026),
  guide first: **Set Up Quarter** and **Edit Quarter** (Manage Quarters on Goals, and ⌘K's Set Up
  Quarter) for Operations & People, a wizard of the quarter and its rules (bands, key result and line
  scoring, section weights) starting from the last quarter's, each problem on its field
  (`ScoringRules`, whose messages now fit one); `POST /periods` takes `rules` and `status`, and
  `GET /periods` a `plan_year`; Q1 2027 is set up in October while Q4 2026 runs. **Edit and delete**
  an organisational goal (the CEO: its title, description and a target per quarter; `DELETE
  /goals/:id`, 409 `GOAL_IN_USE` while a company objective serves it), an objective (its card's menu,
  its sheet) and a key result (its panel), only while the plan is draft or returned and only for
  whoever sets that function's goals (`can_edit` on `Objective` and `KeyResultDetail`); deleting a
  part of a draft plan is an edit of it (`performance` edit, which heads hold; they hold no delete);
  each delete is a ConfirmDialog naming the item; an edit's empty field clears it. **The key result
  form carries every field**: New Key Result and Edit Key Result are one form (`KeyResultForm.tsx`),
  Feeds picked from `GET /key-results` (25 a page), TBC and target in words open, the rest behind
  More (`MoreFields`, new in `@mycity/ui`); `KeyResultDetail` names its quarter. **Set Target** on a
  TBC key result before its lock date, by its owner or the head, with no approval (it stays TBC until
  the lock date, `can_set_target`); Change Target is offered and accepted only after the lock (409
  `TARGET_TBC`). **One number formatter**, `formatNumber` in `@mycity/ui` (64,000; 40%; 12 partners),
  for every target, actual, baseline and KPI figure on the Performance screens, the scorecard lines
  and the Target Change sheet (`figureOf`). ⌘K opens a goal's sheet (`?goal=`), an objective's
  (`?objective=`) and a key result's panel (`?id=`); a form opened from a sheet comes back to it
  (§3.1, §3.2, §3.5, §5, §6.3, §6.7, §9, §10, §12).

- 22/10/2026 · TB · After PR #130, the five items it left (TB's decisions of 22/10/2026). A
  mid-quarter scorecard's own `performance.plan` is decided on screen: Goals › Waiting On You lists
  it (`GET /performance/approvals` kind `scorecard`, named by its person) and its row, the bell and
  ⌘K open the scorecard's sheet, with its chain, Request Changes and Approve Scorecard. A scorecard
  opens from its link (Scorecards honours `?id=` once, then leaves the address; the person's own opens
  My Performance at My Scorecard). Change Target on a scorecard line, on the line's own sheet, for its
  reviewer or the function's head, never its employee (the API was tightened to match: in scope
  alone, or running the cycle, no longer lets one ask); the line shows Change Waiting and offers no
  second while one waits (`can_change_target`, `pending_change`). Score Without Check-In (§11): a late
  check-in opens to its reviewer, still without the drafts, and with a reason goes to the reviewer;
  own lines Not Assessable, Monthly Update On Time 0, the employee told, the reason on the review and
  in its PDF. A leaver's review closes as Withdrawn (§11): on `employee.archived`, or on a future
  `left_on` through the reminder engine; their scorecards close; Operations & People also get
  Withdraw Review. Migration 2310 adds the four review columns and the `withdrawn` status (§4, §5,
  §6.4, §6.7, §6.10, §6.12, §7, §8, §9, §10, §11, §12).

- 22/10/2026 · TB · Approvals on screen, found while writing the training guide: nothing in the hub
  decided a Quarter Plan stage or a Target Change (§1.2 and the PR 2 entry said an Approvals inbox
  did; none exists), and their notices and Need You rows opened nothing. Goals now has Waiting On
  You (`GET /performance/approvals`: the plan stages and target changes naming the reader, oldest
  first, 25 a page) and two sheets: a plan's (what it binds, the chain, Request Changes and Approve
  Plan) and a target change's (`GET /performance/target-changes/:id`; Refuse Change and Approve
  Change). Request Changes and Refuse Change are refusals with a reason (`/reject`). The route map's
  `performance_plan` and `target_change` open them (`?plan=`, `?change=`), so the bell, Need You, ⌘K
  and the assistant reach them (§3.2, §3.5, §5, §6.4, §6.7, §7, §9, §10, §11, §12). Also: Plan names
  who sent it; a key result shows Change Waiting and offers no second Change Target while one waits;
  `GET /target-changes` keeps a line's change to the reader's scope, as §5 said; its sheet is for
  whoever may read the line's scorecard; a binding notice opens My Performance for staff who cannot
  open Goals. Left: a mid-quarter
  scorecard's own `performance.plan` (Send Scorecard) still has no screen to decide it, and the
  Scorecards tab does not open a scorecard from a link (§14, PR 3).

- 22/10/2026 · TB · Fix after PR 5, found while walking staging's data for the training guide: `okr_kpis`
  named every KPI after its code, because the column finder took the first header starting with "KPI"
  ("KPI ID") for the KPI column (§6.19). Importing the workbook's KPIs again corrects the names (45
  updates). A key result's panel reads "Was not set" for a target a change set first, not "Was null".
  Reviews opened on the quarter's oldest round: the API lists rounds newest first and the screen took
  the last row; it now opens on the newest (§10).

- 22/10/2026 · TB · PR 5 built: Performance Analytics (`GET /performance/analytics`, its people table
  and Export), every figure in SQL within the reader's scope (§6.21); the Analytics tab on both shells;
  Home's goal progress, Org KPI, Goals On Track, My Scorecard (My Targets relabelled), each line's score
  on My Goals and the Team roster's score; the assistant's `goals.analytics`. What differs from §5,
  §6.21 and §10: the analytics contract was reshaped to what §6.21 and §10 name (scores by month per
  function, key results by every status, the round's ratings, check-ins, reviews and commitments on
  time by month, self against final, people with their reviewer and months scored, the export request);
  the Company Score and Home's Org KPI are the score Goals shows (each key result at its latest month),
  one SQL definition in `goals.cascade.js`; Key Results by Status adds In Recovery; a function's head
  checks in by the head deadline; the people table sorts by score or name and Export is `performance`
  export. §2: a figure does not open its records (§10 lists none, and Scorecards does not yet open a
  scorecard from a link); the people are searched and sorted. Merged after PRs 3 and 4: commitments on
  time count as the Commitments view does (open ones due). The demo walk (§3.7) waits for staging.

- 22/10/2026 · TB · PR 3 merged with PR 4: the automatic commitments line (§6.10) and My Performance's
  Commitments On Time read `targets.commitments` `monthFigures`, PR 4's own count, so the line, the
  Commitments view and ESS agree; My Commitments sits on ESS · My Performance with the rest (§10).
- 22/10/2026 · TB · PR 3 Reviews built: monthly rounds (job `review-cycles`, Open Round, Close Round),
  the check-in with evidence, automatic lines (`targets.progress.js`), self first (409 `CHECK_IN_FIRST`),
  the reviewer's scores and corrective actions as tasks, Ask For Input and Give Input, the
  `performance.review` chain with second level and HR, Mark Conduct, the review PDF, PIPs, probation
  reviews, Dictate and Tidy With AI (`review-dictation`, `review-cleanup`), the reminders, Send
  Scorecard for a mid-quarter scorecard, the Reviews tab and ESS · My Performance (but My
  Commitments), Home's reviews adapter on the new stages, October's staging round. Decided on the way
  (§4, §5, §6.12, §6.16, §11): migration 2300 adds the status CHECKs (`NOT VALID`), the second level
  and the corrective action's columns; Request Changes is the engine's reject, and a request-changes
  is read the same way; Return Check-In answers the list row (A17); a round reviews only scorecards
  bound by its month's end; a scorecard line's months read closed reviews only; a numeric line is
  missed only in the quarter's last month; Add Evidence has its own route; the upload bodies accept
  the engine's `purpose`. Not built: Score Without Check-In and a leaver's Withdrawn review (§11).
- 22/10/2026 · TB · PR 4 built: commitments on tasks with their month's approval, original dates,
  rescope and recovery; the Commitments view with its figures, Waiting On You and Export Report; Counts
  Towards; My Week and Team This Week with Tidy With AI; performance dates on the calendar; My
  Commitments on ESS; New Commitment on ⌘K; the staging seed. What differs from §1.2: lines measured in
  tasks are counted on read, so nothing recounts; a recovery task is set by a person (Set Recovery),
  not made by itself; the month-end report is made when asked; the Commitments view's person filter is
  its search (Search People); a month sent by its own reviewer is approved as sent; Awaiting Approval
  counts sent months, a Not Sent commitment shows only in the list. My Commitments is placed on the ESS
  page in PR 3's file (two lines).

- 22/10/2026 · TB · PR 4 begun, this guide first (CLAUDE.md step 2): §3.4, §6.11 and §6.18 say how
  commitments are sent, approved, rescoped and recovered, how Counts Towards picks, how lines measured
  in tasks are counted and what the week and the calendar show; §5 adds the commitments' figures, sets,
  rescope and recovery routes and the Counts Towards picker; §4 the `task` pointer (2400); §7, §9, §10,
  §11 and §12 to match. The task form's Commitment is a checkbox, not a switch (a yes or no inside a form,
  COMPONENTS Switch).

- 22/10/2026 · TB · PR 2 review fixes: the CEO's approval binds the plan's scorecards and schedules
  agreement reminders; an approved target change applies to its line or re-proposes its key result's
  months; a TBC target not yet locked is reported but not scored; a confirmed score reaches the company
  key results scored from it; a role reviewer's first holder to agree becomes the reviewer; a reader
  sees only the scorecards they may read, in the plan too; a scorecard is drafted only on an open plan;
  import reverts are refused once anything rests on them (§6.19); one target change waits at a time,
  a month is scored on the target in force then, and TBC months are scored on the lock date (§6.7); a
  month reported again keeps what the report leaves out and its confirmation unless its score changes
  (§6.8); mid-quarter scorecards wait for PR 3's plan amendment (§11). On screen: Report Month is one
  function's (picked at its top), sends only the key results changed, keeps them while its pages turn,
  and shows Recovery Owner and Date whenever the score needs them with errors on their rows; Edit
  Lines keeps each line's unit, direction, frequency, share and links, keeps a target's words and
  number together, asks a copied line for its link and a milestone for its date, and shows every
  field's error in four words or fewer; the KPIs figures count the month just ended; the figures come from `GET /performance/okrs/summary` and
  `GET /performance/kpis/summary`; Change Target, Edit KPI and Record Actual follow the API's
  `can_change_target` and `can_edit`; the OKR tree pages. Reference seed 2290 aligns `goal_status`.

- 22/10/2026 · TB · PR 2 built: organisational goals, the OKR tree, Report Month and Confirm Score, KPIs,
  scorecards with the contribution check, the quarter plan and its approval, agreement and its reminder,
  target changes and the lock, the three importers, the Goals, Scorecards and KPIs screens on both
  shells, the AI reads and search, the staging seed, Home's goals adapter. What differs from §1.2 and
  §10: the workbooks live in `seeds/staging/performance/` (a release ships `seeds/`, not `tests/`), they
  keep only the sheets the importers read, and the tests read them there; the import engine also gives
  a text field a longer limit (`max`) and reads a formula saved without its result as blank (the OKR
  workbook's Company sheet is formulas with no saved results), and an importer may name a capability it
  needs besides its grant (the three need `performance.manage`, which runs imports, §8); the scorecards
  importer matches a name two letters out when one person fits ("Iyersehen" is Precious Iyeserhen); gates, enabling and output
  key results import as dated, the rest as numeric, with the workbook's month scores as proposed scores;
  an imported key result an import changed is not put back by revert (the workbook keeps no
  before-image). On screen: the tree shows each key result's latest month (its History is in the
  panel), the function switch is a select, and the plan's stages decide in the Approvals inbox, so the
  Plan Approval card shows the plan's state and Send Plan. Organisational goals are recorded with New
  Goal and changed through the API. `kr_report_due` moves to PR 3's reminders. `targets.approval.js`
  is gone: agreement lives in `targets.service.js`, completions in `goals.approval.js`. The 2026
  Organisational Goals sheet never arrived, so staging records four goals from the workbook's 2026
  references.

- 22/10/2026 · TB · PR 1 built: the org's names (`seeds/staff/nomenclature.json`, applied by the staff
  loader before and after the sheet), department heads, migration 2100 and seed 2190, the whole contract
  and the scoring library, business days, the named-person approver and the four flows, the five
  capabilities, the quarters API, the record types and the Scorecards label, the module and screen files,
  and the mock in the contract's shapes. What differs from the first version: §4 names the plan link
  `performance_plan_id` and the line's key result `okr_key_result_id`, keeps the 2000 review key (Home's
  staging rows) and adds one review per scorecard per round instead, lets a probation review have no
  round, adds `returned_reason` to plans and reviews and `criterion` to review items, and leaves the four
  2000 tables' status CHECKs to PRs 2 and 3; §5 adds `GET /periods/:id` and `POST /reviews/:id/return`,
  names the disagree body `DisagreeBody` and the check-in `ReviewCheckIn`; §6.13 writes the approver's
  field as `value`; §12 lists the files PR 1 laid out. No department form exists on screen, so the head
  is set by the loader and the API.

- 22/10/2026 · TB · First version, agreed. Built from MyCity's two Q4 workbooks, the handbook, the October
  org chart, the weekly tracker, the monthly report template, the caution letter and the meetings of 2,
  10 and 12 October; TB's 22 decisions (§1.1); the five-PR plan with its checklists and prompts (§1.2,
  §1.3). Replaces the withdrawn design of 19 and 20/10/2026 (commit `d820732`), which was never merged.

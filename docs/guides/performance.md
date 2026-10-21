# Performance Management · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M2 |
| Backend modules | `goals`, `targets`, `kpis`, `reviews` |
| Frontend paths | `app/src/features/performance/`, `app/src/features/ess/Performance.tsx` |
| Permission key(s) | `performance`; `ess` for My Performance |
| Capabilities | `goals.organisation` (record and activate organisational goals), `goals.company` (set annual and monthly goals), `goals.department` (set a department's monthly targets), `kpis.assign` (set individual monthly KPIs for people in scope), `reviews.cycles` (open and close review cycles, edit the cycle's questions) |
| Screens (PROGRESS.md rows) | #29 Goals, #30 Targets, #31 KPIs, #32 Reviews, #33 Analytics, #10 My Performance |
| Status | Draft |
| Last changed | 20/10/2026 |

Sources: MILESTONES §7.1, §7.2 and Definition of done (A16, A17, A18); REUSE_MAP §3.2; the meeting
of 10 October 2026 (Cynthia Osakunih: "once the managers have set the target the COO will go ahead
to review, I would also look at it, and once the CEO gives the final approval it becomes binding";
the paper review form where staff rate themselves first; voice capture with AI clean-up "without
altering the core message"). The COO stage is held by the Management role (AJ, 19/10/2026, §13).
Tasks and how a task counts towards a KPI are in `docs/guides/workspace.md`.

---

## 1 · What it is for

The Performance Management System holds MyCity's goals from the CEO's organisational goals down to
each person's monthly KPIs, gets each level approved by the people Cynthia named, scores progress,
and runs the review cycle where staff rate themselves first. The CEO, Management, heads of
department, line managers and Operations & People use the Performance module; every employee sees
their own part in ESS · My Performance.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Performance · Goals (`goals`) | staff app | `performance` view | organisational goals (Goal ID, Strategic Theme, Goal, Success Measure, Baseline, Owner, Status), annual goals, monthly goals, Goal Progress; a goal opens its trace and quarterly cascade | New Goal (organisational with `goals.organisation`, annual or monthly with `goals.company`); Submit for Approval; Approve or Return when it waits on the reader |
| Performance · Targets (`targets`) | staff app | `performance` view | a month's departmental targets with their status and the approval chain; last month's results; the month's approval trail | Set Targets (`goals.department`, own department); Submit Month for Approval; Approve or Return (the stage's approver) |
| Performance · KPIs (`kpis`) | staff app | `performance` view · scope | each person's KPIs for the month: KPI, weight, progress, set by, status; weights per person; where progress comes from | Assign KPIs (`kpis.assign`, people in scope); Edit Weights; update a manual KPI's actual |
| Performance · Reviews (`reviews`) | staff app | `performance` view · scope | the cycle, review history (self, manager, second level, status), the review form; a review opens the form | Open Cycle and Close Cycle (`reviews.cycles`); fill the manager review once the self review is in; approve as second level; receive as HR |
| Performance · Analytics (`analytics`) | staff app | `performance` view · scope | goals on track, reviews completed, average self and manager rating, goal completion by month, by department, self vs manager gap | choose the cycle and period |
| ESS · My Performance (`my-performance`) | staff app | the employee | KPI Score, On Track, Weight Assigned, Last Review, Next Cycle; My KPIs This Month; Rolls Up To; My Reviews | fill and submit My Review (dictate an answer); read a closed review |
| Home · Overview (M1, TB) | staff app | as Home | Goals This Quarter, Goals On Track (CEO), My Targets On Track and My Goals This Quarter (staff), My Reviews Due, the CEO's Org KPI score, KPI on the Team roster | read only, through `dashboard/sources/goals.source.js` and `reviews.source.js` |
| Settings · Approvals (M0) | staff app | `settings` | the `performance.goal` approval route | edit the stages |
| My Workspace · Tasks (M2) | staff app | as Workspace | Counts Towards on a task | link a task to an active KPI |
| Notifications bell | both shells | the people named in §7 | goal waiting for you, month approved, KPIs set for you, review opened, your manager's review is ready | open the record |

## 3 · How the screens relate

1. **The CEO records an organisational goal** (Goals, New Goal, Level Organisational): Goal ID from
   numbering (`OG-2026-01`), strategic theme, goal, success measure, baseline, the year, and a
   quarterly cascade (what each quarter should reach). It is active as soon as the CEO saves it:
   organisational goals are set by the CEO alone (A16).
2. **Management sets annual and monthly goals** under it (`goals.company`). Submit for Approval opens
   `performance.goal` on the workflow engine: Management (the COO's stage), then Operations &
   People, then the CEO. On the CEO's approval the goal becomes active (`goal.approved`).
3. **A head of department sets the month's departmental targets** (Targets, Set Targets), each under
   an active monthly goal of that month, for their own department (`goals.department`).
4. **Department managers set each person's individual KPIs for the month** (KPIs, Assign KPIs), each
   with a weight; a person's weights for a month total 100%. A KPI rolls up to one departmental
   target. Progress comes from Tasks (done tasks linked to it), or is entered by hand.
5. **The department's month is approved as one.** Submit Month for Approval (on Targets, by the head)
   sends that department's targets and its people's KPIs for the month together through
   `performance.goal`. On the CEO's approval every one of them becomes active and binding and
   dispatches: each person is notified that their KPIs are set (`kpis.dispatched`), and Cynthia sees
   it in the month's trail. Returned at any stage, it goes back to draft with the reason.
6. **Work counts.** A done task linked to a KPI (workspace §3 step 4) recounts `actual_value`
   through `targets.progress`; the KPI's status (On Track, At Risk, Behind, Met) and the person's
   KPI Score move. Departmental targets and goals roll their children's scores up by weight.
7. **Tracing up.** Any KPI opened anywhere shows Rolls Up To: KPI → departmental target → monthly
   goal → annual goal → organisational goal (`GET /api/v1/performance/kpis/:id/trace`).
8. **A review cycle opens** (`reviews.cycles`): a name, the period, the date it opens and closes, and
   its questions (prefilled from the last cycle). On the opening date every active employee gets a
   self review and their line manager a manager review (`review.cycle_opened`, notifications).
9. **Self first.** The employee fills My Review in ESS: a rating and comment per KPI of the period,
   an answer to each question (typed or dictated), an overall rating out of 5; Submit. Until then the
   manager's review shows "Waiting for the self review" and none of its content (A17).
10. **Manager, second level, HR.** The manager sees the self review beside their own form (KPI
    ratings prefilled from progress, `kpis/kpis.score.js`), fills it and submits; that opens
    `performance.review`: the manager's own line manager (second level), then Operations & People
    (HR receives it). On HR's stage the review closes, its PDF is generated into the vault, and the
    employee sees the manager's comment in My Performance.
11. **Dictation (A18).** On any answer, Dictate records audio (VoiceField), uploads it
    (`purpose: voice_note`), transcribes it and tidies it against the employee's goals, and keeps
    the audio, transcript and AI run against that answer; the person sees both texts and chooses
    Use Tidied, Use As Spoken or keeps typing. The answer's text changes only when they save the
    review, and a save that does not name the dictation clears it.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `organisational_goal` (2000, 2020) | `organisational_goal_id`, `code`, `level`, `parent_goal_id`, `department_id`, `title`, `strategic_theme`, `success_measure`, `baseline`, `description`, `status`, `starts_on`, `ends_on`, `weight`, `owner_employee_id`, `workflow_instance_id`, `performance_plan_id` | `level` CHECK `organisation`, `annual`, `monthly`, `department` (2020 replaces the 2000 list); `status` CHECK `draft`, `pending_approval`, `active`, `returned`, `completed`, `cancelled`. `code` filled by numbering for every level. Read by Home |
| `organisational_goal_quarter` (2020) | `organisational_goal_id`, `quarter` 1 to 4, `milestone` | the quarterly cascade of an organisational or annual goal |
| `performance_plan` (2020) | `performance_plan_id`, `department_id`, `month` (first day), `status`, `submitted_by`, `submitted_at`, `workflow_instance_id`, `approved_at` | one department's month: its targets and its people's KPIs, approved as one; UNIQUE (`department_id`, `month`) |
| `employee_target` (2000, 2020) | `employee_target_id`, `organisational_goal_id` (the departmental target), `kpi_definition_id`, `employee_id`, `title`, `month`, `target_value`, `actual_value`, `unit`, `direction`, `progress_source`, `weight`, `status`, `due_on`, `set_by_employee_id`, `performance_plan_id`, `approved_by`, `approved_at` | the individual monthly KPI. `progress_source` CHECK `manual`, `tasks`; `status` as goals plus `met`. Read by Home (`employee_target_id`, `employee_id`, `title`, `due_on`) |
| `kpi_definition` (2000) | `code`, `name`, `measurement_type`, `unit`, `direction` | an optional library of KPI wordings MyCity enters; no seed (A26) |
| `performance_cycle` (2000, 2030) | `performance_cycle_id`, `name`, `starts_on`, `ends_on`, `status`, `self_review_opens_at`, `manager_review_opens_at`, `closes_at`, `opened_by` | `status` CHECK `draft`, `scheduled`, `open`, `closed` |
| `performance_cycle_question` (2030) | `performance_cycle_id`, `position`, `prompt` | the cycle's questions, copied from the last cycle when one opens |
| `performance_review` (2000, 2030) | `performance_review_id`, `performance_cycle_id`, `employee_id`, `reviewer_employee_id`, `review_type`, `status`, `overall_score`, `summary`, `submitted_at`, `closed_at`, `workflow_instance_id`, `document_id` | `review_type` `self` or `manager` (`designated` kept for a review given to someone other than the line manager); `status` CHECK `draft`, `submitted`, `second_level`, `with_hr`, `closed`, `returned`. `dictation_document_id` (2000) is no longer written: dictation is per answer. Read by Home |
| `performance_review_item` (2000) | `performance_review_id`, `employee_target_id`, `score`, `comment` | a rating per KPI (1 to 5) |
| `performance_review_answer` (2030) | `performance_review_id`, `performance_cycle_question_id`, `answer_text`, `dictation_document_id`, `transcript`, `ai_run_id` | A18: the audio, what was said, and the run that tidied it |

Schema migration file(s): `migrations/2020_goal_cascade.sql`, `migrations/2030_reviews.sql`.
Reference-data file(s): `seeds/reference/2091_seed_performance.sql` (the numbering schemes
`goal_organisation`, `goal_annual`, `goal_monthly` and `goal_department`, one per prefix; a review has
no number, the status codes, the `performance.goal` and `performance.review` workflow
definitions, the five capabilities and their default holders).

Contracts: `packages/contract/schemas/goals.js`, `targets.js`, `kpis.js`, `reviews.js` (with
Performance Analytics) and `ess.js` (`MyPerformance`). Quantities and weights are decimal strings,
like money; ratings are whole numbers 1 to 5.

## 5 · API

All under `/api/v1/performance`, permission key `performance` unless said.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /goals` | `GoalListQuery` → `GoalPage` | view · all | yes, 25 | filters `level`, `status`, `year`, `month`, `parent_goal_id`, `q`; sort `code`, `ends_on`, `title` |
| `GET /goals/summary` | → `GoalsSummary` | view | no | the cascade chain and Goal Progress |
| `GET /goals/:id` | → `GoalDetail` | view | | with the quarters, the trace up and the children |
| `POST /goals` | `GoalCreate` → `Goal` | create, `goals.organisation` or `goals.company` by level (§6) | | |
| `PATCH /goals/:id` | `GoalEdit` → `Goal` | edit | | draft or returned only |
| `POST /goals/:id/submit` | `EmptyBody` → `Goal` | create, `goals.company` | | opens `performance.goal` |
| `POST /goals/:id/decide` | `DecideBody` → `Goal` | approve | | the stage's approver; `decision` `approve` or `return`, `reason` |
| `GET /targets` | `TargetListQuery` → `TargetPage` | view · scope by department | yes, 25 | `month`, `department_id`, `status`, `q` |
| `GET /targets/summary` | `TargetSummaryQuery` → `TargetsSummary` | view | no | the month's counts, chain, last month, trail |
| `POST /targets` | `TargetCreate` → `Target` | create, `goals.department` | | a departmental target (a `department` level goal) |
| `POST /plans/:department_id/:month/submit` | `EmptyBody` → `Plan` | create, `goals.department` | | the department's month; `month` is `YYYY-MM` |
| `POST /plans/:id/decide` | `DecideBody` → `Plan` | approve | | |
| `GET /kpis` | `KpiListQuery` → `KpiPage` | view · scope on `employee_id` | yes, 25 | `month`, `department_id`, `employee_id`, `status`, `q` |
| `GET /kpis/summary` | `KpiSummaryQuery` → `KpisSummary` | view · scope | no | |
| `GET /kpis/employees/:id` | `KpiMonthQuery` → `EmployeeKpis` | view · scope | no (a person's KPIs for a month are few; complete) | |
| `PUT /kpis/employees/:id` | `KpiAssign` → `EmployeeKpis` | create, `kpis.assign` · scope | | replaces the person's draft KPIs for the month; weights total 100 |
| `POST /kpis/:id/actual` | `KpiActual` → `Kpi` | edit · scope | | manual KPIs only |
| `GET /kpis/:id/trace` | → `KpiTrace` | view · scope | | |
| `GET /reviews` | `ReviewListQuery` → `ReviewPage` | view · scope on `employee_id` | yes, 25 | `performance_cycle_id`, `status`, `q` |
| `GET /reviews/summary` | → `ReviewsSummary` | view | no | |
| `GET /reviews/:id` | → `ReviewDetail` | view · scope, or the employee or reviewer | | a manager review returns no self content until the self review is submitted, and no manager content to the employee until closed |
| `PUT /reviews/:id` | `ReviewSave` → `ReviewDetail` | the reviewer (self route below for the employee) | | draft or returned only |
| `POST /reviews/:id/submit` | `EmptyBody` → `ReviewDetail` | the reviewer | | manager submit opens `performance.review` |
| `POST /reviews/:id/decide` | `DecideBody` → `ReviewDetail` | approve | | second level and HR |
| `POST /reviews/:id/dictation` | multipart `file` + `DictationRequest` → `Dictation` | the reviewer | | `performance_cycle_question_id`, `duration_s`; returns `dictation_id`, `transcript` and `tidied`; keeps the dictation against the answer, never its text |
| (the review's PDF) | `ReviewDetail.document` | as the review | | a closed review carries its `DocumentRef`; the file is read through the documents routes with the review's own read rule |
| `GET /cycles` | `CycleListQuery` → `CyclePage` | view | yes, 25 | |
| `POST /cycles` | `CycleCreate` → `Cycle` | create, `reviews.cycles` | | name, period, opens, closes, questions |
| `POST /cycles/:id/close` | `EmptyBody` → `Cycle` | edit, `reviews.cycles` | | |
| `GET /analytics` | `PerformanceAnalyticsQuery` → `PerformanceAnalytics` | view · scope | no | |
| `GET /api/v1/ess/performance` | → `MyPerformance` | `ess` · own | no | |
| `GET /api/v1/ess/performance/review` | → `ReviewDetail` | `ess` · own | | the open self review; 404 `NO_OPEN_REVIEW` when none (`MyPerformance.open_review_id` says whether there is one) |
| `PUT /api/v1/ess/performance/review` | `ReviewSave` → `ReviewDetail` | `ess` · own | | |
| `POST /api/v1/ess/performance/review/submit` | `EmptyBody` → `ReviewDetail` | `ess` · own | | |
| `POST /api/v1/ess/performance/review/dictation` | multipart `file` + `DictationRequest` → `Dictation` | `ess` · own | | |

## 6 · Rules and calculations

- **Who sets which level (A16).** Organisational: holders of `goals.organisation` (the CEO only, by
  default); saved active, no approval. Annual and monthly: `goals.company` (Management); each must
  name an active parent one level up (annual under organisational, monthly under annual) whose period
  contains it. Departmental target: `goals.department` (heads of department) for their own department,
  under an active monthly goal of the same month. Individual KPI: `kpis.assign` (line managers and
  heads) for people in their `performance` scope, under an active or pending departmental target of
  the person's department for the same month.
- **Binding.** Only the CEO's stage approval makes a goal, target or KPI active. Until then it is a
  draft or pending and never counts on Home, My Performance or Analytics.
- **The approval route `performance.goal`**: Management (`role` `management`, the COO's stage), then
  Operations & People (`role` `operations_people`), then the CEO (`ceo`), 48 hours each. The person
  who submitted cannot decide a stage (engine rule); the CEO may decide any stage. Return sends it
  back to draft with the reason.
- **Weights.** A person's KPIs for a month must total exactly 100.00 when the month is submitted, and
  each is between 1 and 100. Saving a draft that does not total 100 is allowed; the screen shows the
  total in red.
- **Progress of a KPI.** `tasks`: `actual_value` = the number of the person's tasks linked to it that
  are Done, with `target_value` the number expected. `manual`: entered by the setter or the person.
  Attainment = actual ÷ target, capped at 1 (direction `higher`); for `lower`, target ÷ actual capped
  at 1 (0 actual = 1). Status: Met at attainment 1; otherwise On Track when attainment ≥ the share of
  the month's working days gone (minus 10 points), At Risk within 25 points below that, Behind below.
- **KPI Score** of a person for a month = Σ(attainment × weight) ÷ 100, shown as a percentage.
- **Roll-up.** A departmental target's progress is the weighted mean of its people's KPI scores; a
  monthly goal's the mean of its departmental targets; annual and organisational goals the mean of
  their children's for the months gone. Goals On Track counts goals whose progress is On Track or
  Met.
- **Review sequence (A17).** A self review must be submitted before its manager review can be read
  or saved by the manager (409 `SELF_REVIEW_FIRST`). The manager's KPI scores are prefilled from
  attainment (1 to 5: ≥ 1.0 is 5, ≥ 0.85 is 4, ≥ 0.7 is 3, ≥ 0.5 is 2, else 1), editable. Submitting
  the manager review opens `performance.review`: the manager's line manager (`manager_of_subject`
  with the manager as subject), then Operations & People. A return sends the manager review back to
  draft.
- **Who is reviewed.** Every employee active on the cycle's opening day with a line manager; the
  reviewer is the line manager on that day (`employee_effective_manager`). Someone with no line
  manager is reviewed by the CEO.
- **Dictation (A18).** Audio of at most 3 minutes and 10 MB. The transcript is never changed by the
  system; the tidy step is one `llm.complete` call with purpose `review-cleanup`, given the
  question, the transcript and the person's KPI titles, under the rule: fix wording, grammar and
  filler; never add, remove or change a fact, figure, name, judgement or tone. The run id is kept
  with the answer. The person chooses which text to keep.
- **Numbers.** Goals `OG-2026-01` style per level: organisational `OG`, annual `AG`, monthly `MG`,
  departmental `DT`, through `numbering.allocate()`.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `goal.created` | a goal or target is saved | search reindex |
| `goal.submitted` | Submit for Approval | the engine notifies the stage's approvers |
| `goal.approved` / `goal.returned` | the last stage approves / any stage returns | notify the owner; Home's goal cards refresh |
| `plan.submitted` / `plan.approved` / `plan.returned` | the department's month | on approval every target and KPI in it becomes active |
| `kpis.dispatched` | after `plan.approved` commits | notify each person "Your KPIs for October are set" |
| `kpi.progress_changed` | after a recount | realtime to My Performance and KPIs |
| `task.completed` / `task.reopened` (workspace) | a linked task enters or leaves Done | handler `targets.progress` recounts the KPI |
| `review.cycle_opened` | the cycle's opening day (job) | creates the reviews; notifies each employee and reviewer |
| `review.self_submitted` | self submit | notify the manager "Ada's self review is in" |
| `review.submitted` / `review.decided` | manager submit, each stage | engine notifications; on HR's stage the review closes |
| `review.closed` | HR's approval | `documents.generate()` the review PDF; notify the employee |
| job `reviews.open_cycles` | 06:00 daily | opens cycles whose date has come |
| job `reviews.reminders` | 08:00 working days | reminds people with a review due in 3 days or overdue |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Staff | own KPIs, goals they roll up to, own reviews (ESS) | fill and submit their self review |
| Line Manager | their reporting line's KPIs and reviews | assign KPIs (`kpis.assign`), manager reviews, second-level approval for their reports' managers |
| Head of Department | their department | as a line manager; set targets and submit the month (`goals.department`) |
| Management | everyone | set annual and monthly goals (`goals.company`); the first approval stage |
| Operations & People | everyone | the second approval stage; HR's review stage; open cycles (`reviews.cycles`) |
| CEO | everyone | every capability; final approval |

Capabilities and their default holders: `goals.organisation` the CEO only; `goals.company`
Management; `goals.department` Head of Department; `kpis.assign` Line Manager and Head of
Department; `reviews.cycles` Operations & People. A review's content is visible only to the
employee, their reviewer, the second-level approver, Operations & People and the CEO.

## 9 · AI and search

- **AI reads**: `goals.list`, `goals.trace` (`goals.ai.js`); `targets.list` (`targets.ai.js`);
  `kpis.list`, `kpis.of_employee` (`kpis.ai.js`); `reviews.list` (`reviews.ai.js`, scores only,
  never answers). `performance` view, scoped, paged at 25.
- **AI routes**: "set KPIs for Ada" → `performance.kpis` with `new=1`; "start my review" →
  `ess.my-performance`.
- **Search**: `goals.search.js` (types `goal`: code, title, theme), `targets.search.js` (departmental
  targets), `kpis.search.js` (KPIs by person and title, scoped), `reviews.search.js` (reviews by
  employee and cycle, scoped).
- **Feature AI**: the dictation tidy step (§6), prompt `services/ai/prompts/review-cleanup.md` (purpose `review-cleanup`); the transcription is purpose `review-dictation`.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.**

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Performance · Goals (`goals`) | The year (desktop subtitle); New Goal; Organisational Goals (Goal ID, Strategic Theme, Goal, Success Measure, Baseline, Owner, Status); Annual Goals and Monthly Goals (Goal, Rolls Up To, Owner, Progress, Status); Goal Progress. A goal opens: its fields, Quarterly Cascade, Rolls Up To, Children, Approval (the stages and who acted), Submit for Approval, Approve, Return. New Goal: Level, Goal, Strategic Theme, Success Measure, Baseline, Quarter 1 to 4 (Optional) for organisational; Rolls Up To and the month for monthly | Help term on Status Pending: "Waiting on Management, Operations & People, then the CEO." | "Saved as a draft. Nothing binds until the CEO approves" is removed from the form. The cascade levels and who sets each: §6 |
| Performance · Targets (`targets`) | The month (desktop subtitle); Previous Month, This Month, Next Month; Set Targets; Submit Month (head); Departments, Approved, Awaiting Approval; the chain Management, Operations & People, CEO with where the month is; Departmental Targets (Department, Target, Rolls Up To, Set By, Measure, Status, Approve or Return when it waits on the reader); Last Month's Results; the month's Approval Trail | None | The chain card's note "Nothing becomes binding until the CEO approves" is removed: the chain shows it. §3 step 5 |
| Performance · KPIs (`kpis`) | The month (desktop subtitle); Assign KPIs; Staff With KPIs, Weights, On Track, Behind or At Risk; Department filter; This Month (Employee, KPI, Weight, Progress, Set By, Status); Weights (one person's KPIs, Total, Edit Weights); Progress Sources. Assign KPIs: Employee, then each KPI (KPI, Target, Unit, From Tasks or By Hand, Weight) with Add KPI and Total; Cancel, Save KPIs | Help term on Weights: "Each person's KPIs add up to 100%." | The card title "Weights Must Total 100%" becomes Weights. Scoring formula: §6 |
| Performance · Reviews (`reviews`) | The cycle and its dates (desktop subtitle); Open Cycle, Close Cycle, Review Form; Cycle, Opens, Closes, Average Rating; the chain Self, Manager, Second Level, HR; Review History (Employee, Cycle, Self Rating, Manager, Second Level, Status). A review opens the form: the employee's self review (once submitted), then the reviewer's: each KPI with its progress, a rating 1 to 5 and a comment; each question's answer with Dictate; Overall Rating; Save Draft, Submit Review; for an approver Approve, Return. Waiting: "Waiting for the Self Review". Open Cycle: Cycle, Period, Opens On, Closes On, Questions (one per line, Add Question); Cancel, Open Cycle | Help term on Dictate: "Speak your answer. We tidy the wording and you choose which to keep." | The chain note "The manager cannot see the form until the employee has submitted" is removed: the form shows Waiting. The sample quote card is removed. §6 Review sequence |
| Performance · Analytics (`analytics`) | The cycle; Goals On Track, Reviews Completed, Avg Self Rating, Avg Manager Rating; Goal Completion by Month; By Department; Self vs Manager Rating (Department, Self, Manager, Gap) | Help term on Gap: "Manager rating minus self rating." | How each figure is worked out: §6 |
| ESS · My Performance (`my-performance`) | The month and who set the KPIs (desktop subtitle); KPI Score, On Track, Weight Assigned, Last Review, Next Cycle; My KPIs This Month; Rolls Up To; My Reviews (Cycle, Self Rating, Manager, Second Level, Status); Start My Review while a cycle is open; My Review (each KPI: rating and comment; each question with Dictate; Overall Rating; Save Draft, Submit Review). A dictated answer shows As Spoken and Tidied with Use Tidied, Use As Spoken | Help term on KPI Score: "Your KPIs, weighted to 100%. It updates as the tasks against each KPI close." | That the manager cannot see it until submitted: §6. How tidying works: §6 Dictation |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Performance · Goals (`goals`) | organisational goals as cards (Goal ID, Goal, Status) | Success Measure and Baseline (in the goal's sheet); Goal Progress chart | New Goal, the floating button | bottom bar More, Performance; tabs along the top |
| Performance · Targets (`targets`) | the month switcher, then the three counts, then targets as cards with Approve full width in the sheet | Last Month's Results and the trail (behind cards that open sheets) | Set Targets, the floating button | as above |
| Performance · KPIs (`kpis`) | the four KPI cards two to a row, then people as cards (name, KPI count, score) | the KPI Sources table | Assign KPIs, the floating button | as above |
| Performance · Reviews (`reviews`) | the cycle line, then reviews as cards with a status pill | the chain card (a status line instead) | a review's form is a full-screen sheet with Submit Review in its footer | as above |
| Performance · Analytics (`analytics`) | the four KPI cards, then Goal Completion by Month | Self vs Manager Rating beyond 5 rows | none | as above |
| ESS · My Performance (`my-performance`) | the stat strip, then cards My KPIs This Month, Rolls Up To, My Reviews, and Start My Review when a cycle is open | none | Start My Review, full width; Dictate is a large round button on each answer | bottom bar Self-Service |

## 11 · Edge cases

- **A person moves department mid-month**: their KPIs stay under the target they were set against
  until the month ends; next month's are set by the new department.
- **A goal's parent is returned after a child was submitted**: the child keeps its place; it cannot
  be approved at any stage until its parent is active (422 `PARENT_NOT_ACTIVE`).
- **Weights edited after approval**: not possible; the person's KPIs are fixed once the month is
  approved. A change is a new KPI next month (§13).
- **Line manager changes during a cycle**: the review stays with the reviewer it opened with;
  Operations & People can reassign it.
- **Dictation fails or AI is off** (`ai_governance` spend cap): the transcript is still returned
  with "Tidying is unavailable"; with no transcription, "Could not hear that, try again".
- **Nobody holds Management** (the COO stage): the engine's stage has no approver; the CEO acts on it.
- **Double press on Submit**: one request (F26); the second answers 409 and the screen reloads.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/hr/appraisal/` (`appraisal.review.js`, `appraisal.rules.js`) | the review record and rules; self-first and the two-level chain on the workflow engine replace its single sign-off |
| pixie | `src/shared/hr_payroll/appraisal.autoscore.js` | prefills manager KPI ratings from attainment (§6) |
| pixie | `appraisal.service.js`, `.repo.js`, `.metrics.js`, `.review-pdf.js` | the cycle, averages for Analytics, the PDF through `documents.generate()` |
| pixie | `src/shared/goals/` with `target.progress.subscribers.js` | progress recounted from `task.completed` in an outbox handler |
| pixie | `src/shared/org_workflow/` | not ported: reporting lines come from the M1 organisation module and `scopeOf(req)` |
| praxis | `src/services/ai/gemini-transcription.service.js` | the audio call behind `services/ai/transcription.js`, governed and costed through the AI ledger |

## 13 · Open questions

- **The COO stage.** MyCity has no COO post; the stage is the Management role (Program Manager and
  CTO hold it today). Confirm with Cynthia at the 23/10 demo whether it should be the Program Manager
  alone (Settings · Approvals can name one person). AJ, 23/10/2026.
- **The review form.** Cynthia was to send the paper review form (10/10 next steps); not received.
  Until then cycles carry the three questions in the staging seed, and Operations & People edit them
  when they open a cycle. AJ to chase, 21/10/2026.
- **Goals data.** Cynthia was to send the goals and targets sheets; an import is not in M2 unless
  they arrive. AJ to chase, 21/10/2026.
- **Changing an approved month.** Not built; a correction is next month's KPI. Cynthia, at the demo.

## 14 · Change log

- 20/10/2026 · AJ · Staging: `seeds/staging/40_productivity.js` records the CEO's organisational goals, an annual and this month's goal approved through `performance.goal`, the head's two targets with their team's KPIs and the month approved, and the quarter's check-in open with the three questions of §13 and two self reviews handed in, all through the services; Home's forward goals, targets and reviews are taken away first.
- 20/10/2026 · AJ · §3 step 10: the prefilled ratings come from `kpis/kpis.score.js`; the empty `reviews.autoscore.js` and `reviews.analytics.js` stubs are deleted (README §11.5).
- 20/10/2026 · AJ · Screens built (§10): Where Progress Comes From is titled Progress Sources, since a card title may not open with Where (gate 8); a goal, a department's month and a review open in a sheet with their approval card, and Return asks its reason in that card.
- 20/10/2026 · AJ · The review PDF: on `review.closed` an outbox handler generates `review_summary` (template `review-summary.html`, variables `ReviewSummaryVars`: both ratings, the KPIs with both scores, both answers to each question, who approved and when) and links it on the review; a closed review's detail carries it as `document`, so there is no separate PDF route. Settings · Documents & Numbering lists the four goal schemes (and Project and Task, which it lacked).
- 20/10/2026 · AJ · Dictation built (A18): `POST /performance/reviews/:id/dictation` and `POST /ess/performance/review/dictation`. The recording is stored as `review_dictation` (personal; read by whoever may read the review), transcribed by Gemini's native API (a browser's webm, mp4 or ogg first made 16 kHz FLAC with ffmpeg in the request, under a second for three minutes), tidied by `review-cleanup` at temperature 0; transcript, audio and run are kept against the answer at once, its text only when the person saves with the `dictation_id`. Purpose names are kebab-case, as `llm.service` requires, so the prompt is the existing `review-cleanup.md` stub, not `review_answer_tidy.md`.
- 20/10/2026 · AJ · Analytics and My Performance built: `GET /performance/analytics` (the year's KPI attainment by month and department, the cycle's ratings and the self vs manager gap, in the reader's scope) and `GET /ess/performance` with the self review under `/ess/performance/review`. The open self review answers 404 `NO_OPEN_REVIEW` rather than 204, since a route declares one response.
- 20/10/2026 · AJ · Reviews API built (§5 cycles and reviews routes, jobs `review-cycles` 06:00 and `review-reminders` 08:00 Monday to Saturday): a cycle opens at once when its day is today; the review list is one row per person and cycle (the manager review, or the CEO's self review); the manager's ratings are prefilled from attainment until saved and kept as they stood when handed in; handing a review in needs an overall rating; HR's approval closes the self review with the manager's. Writing a review needs only the `performance` view grant plus being its reviewer, as My Review in ESS needs only `ess`. Not yet: the review PDF (§7 `review.closed`), dictation (§3 step 11), Analytics, My Performance.
- 20/10/2026 · AJ · KPIs API built (§5 kpis routes): KPIs hang from a departmental target of the person's department for the month whatever its status short of cancelled, because the month is assembled as a draft and approved as one (§6 "under an active or pending departmental target" read that way). Nobody sets their own KPIs; the same KPI twice in a month is refused; once the month is sent the person's KPIs are fixed (`PLAN_LOCKED`). A manual figure is recorded by the person or whoever set it (`performance` edit), only on an approved KPI; a tasks KPI refuses one (`KPI_FROM_TASKS`). Status (On Track, At Risk, Behind, Met) is worked out, never stored. ⌘K finds KPIs (`kpis.search.js`).
- 20/10/2026 · AJ · Targets API built (§5 targets and plans routes): a department's head is whoever holds `goals.department` in that department (the organisation records no head per department); the CEO may set any department's targets. A month with no target cannot be submitted (`PLAN_EMPTY`); one whose people's weights do not each total 100 is refused (`WEIGHTS_NOT_100`, naming each person and their total); once sent, the month takes no new target (`PLAN_LOCKED`). On the CEO's approval the targets and KPIs go active and each person is told their KPIs are set; a done, reopened or cancelled task linked to a tasks-sourced KPI recounts it. ⌘K finds targets (`targets.search.js`) apart from goals.
- 20/10/2026 · AJ · Goals API built (§5 goals routes): New Goal is gated by `goals.organisation` or `goals.company` on the route and the level's own capability in the service; Return closes the request (the engine's reject) and the goal goes back to `returned`; approving a goal whose parent is not active is refused with `PARENT_NOT_ACTIVE` at any stage. Scoring in `kpis.score.js`.
- 20/10/2026 · AJ · Contracts written. §4: four goal numbering schemes (one per prefix), no review
  number, `closed_at` on a review, dictation per answer. §5: decisions take `DecideBody` (the name
  `ApprovalDecision` is the workflow's decision row); dictation audio uploads as `voice_note`.
- 19/10/2026 · AJ · First version, from MILESTONES §7, REUSE_MAP §3.2 and the 10/10 meeting; the COO
  stage is Management (AJ, 19/10/2026).

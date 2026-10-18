# Home · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M1 |
| Backend modules | `dashboard`, `alerts`, `reports`; Home also reads the shared attendance roster, src/modules/attendance/attendance.roster.js, which attendance.md covers |
| Frontend paths | `app/src/features/home/` |
| Permission key(s) | `home` (view: every employee; its scope is the Team roster's scope); `settings` view and edit for a role's cards |
| Capabilities | `home.team` (open the Team tab and its figures), `home.reports` (build, schedule, run and receive reports), `alerts.manage` (create, change and switch off alert rules), `alerts.clear` (clear or dismiss an alert, together with the rule's own grant) |
| Screens (PROGRESS.md rows) | #1 Overview, #86 Team, #2 Alerts, #3 Reports |
| Status | Agreed |
| Last changed | 18/10/2026 |

Home is the command centre, renamed to **Home** at the 12 October kickoff and fixed in MILESTONES
§18.1 (a plain word that survives translation and fits an icons-only rail). This guide is the
engineering brief for the real build, backend and frontend; the version in `demo.html` is the
agreed visual reference only, and no data or field name is taken from it (CLAUDE.md step 3).

Sources read for this guide: the client discovery call (02/09/2026), the project kickoff and the
module demos (both 12/10/2026), the attendance and device review (13/10/2026), and the owner's
twelve answers on the Home build (TB, 17/10/2026), which this version follows.

Home is built in five pull requests, each based on the one before and each ticking its own
PROGRESS row: foundation (schema, reference seed, capabilities, contract, KPI catalogue, source
adapters, the attendance roster), Overview, Team, Alerts, Reports.

---

## 1 · What it is for

Home is the first screen a member of staff sees after sign-in, and the organisation's command
centre. It answers three questions for the person in front of it, tailored to their role:

- **Where do things stand?** A role-sensitive dashboard summarising what matters to that role
  across the organisation today, not one layout for everyone (kickoff, 01:08 to 01:18).
- **What needs me?** The work that is assigned to this person and has not been done, including the
  alerts only they can clear.
- **What has happened, and what can I plan for?** Activity across the organisation today, the
  person's week, and (for managers and the CEO) their team's attendance and the reports they own.

The people who use it: every employee (their own tailored Overview), line managers (their team),
People and Operations (attendance and the people engine), the CEO (the organisation at a glance),
and function leads such as Partnerships (their own pipeline, not attendance). The client asked for
exactly this at discovery: "a centralized dashboard for business intelligence ... role-based access
control for data-driven oversight" (02/09/2026).

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Home · Overview (`overview`) | staff app | every employee, resolved for their role | four KPI cards, Need You, Activity Today and Your Week; Operations, CEO and Partnerships also the role's main chart (and donut), the Partnership Pipeline and Goals This Quarter (on the CEO's the goals are the chart); Staff instead the day strip, My Goals This Quarter and Upcoming Leave | open a card's records; choose their own cards; Export the Overview; New (a menu of what they may create) |
| Choose Cards (picker) | Overview, from the KPI row (a page menu item on a phone) | every employee | the cards they may see, the ones on their Overview in order, the ones their roles lock | add, remove and reorder up to four cards; go back to their roles' cards |
| Home · Team (`team`) | staff app | holders of `home.team`; everyone else sees the gated state | today's roster for the people in their `home` scope (status, Clock-In, KPI, open tasks), four team cards, Attendance This Month | filter by department and status; search the roster; open a card's records; open a person, and from them People · Attendance or their profile when the reader may open those |
| Home · Alerts (`alerts`) | staff app | holders of `alerts.clear` or `alerts.manage`; everyone else sees the gated state | open alerts of the rules they may clear, about people in their scope, with severity, age and Over By; the counts; View Dismissed | clear or dismiss an alert (`alerts.clear`); see, create, change and switch off rules (`alerts.manage`) |
| Home · Reports (`reports`) | staff app | holders of `home.reports`; everyone else sees the gated state | their own reports and the shared ones whose source they may open, with schedule, status and audience; Recent Runs | build a report, schedule it, pause or resume it, run it now, download a finished run, archive it |
| KPI detail (the report model) | any KPI card, Overview and Team | the scope the card was computed in | the paged records behind the number, with its groups | page at 25; filter by group; open a record |
| Gated tab | Team, Alerts or Reports without the capability | every `home` viewer who lacks it | the page title, the Locked illustration, "For Managers" and one line | nothing; the tab is listed so the four tabs stay in place |
| Clock-in prompt | opened by Home, owned by Attendance | the signed-in employee, when the first session of a working day opens Home · Overview | Attendance's clock-in panel | clock in, or close it |
| Settings · Roles (role cards) | Settings, M9 | `settings` view and edit | a role's default cards and locks | set or clear them (routes in M1, the screen in M9) |

Home renders but does not own the attendance, partnership, approval, recruitment and task figures
it shows; it reads them live from the owning modules (§3, §4). It owns the alert rules and alerts,
the saved reports, their schedules and runs, the per-role cards and each person's own pick.

## 3 · How the screens relate

1. **Sign-in → Home, and the clock-in prompt.** An employee signs in and lands on Home · Overview,
   resolved for their role (a sign-in through a link to another screen lands on that screen). The
   Overview answer carries `prompt_clock_in`; when it is true the screen opens Attendance's
   clock-in panel once. So the prompt opens when the first session of a working day opens Home ·
   Overview: a first session that never opens it is not prompted that day, and the top bar's
   Clock In and the phone's floating button still open the panel. The server decides it (§6
   Clock-in prompt), so the shell no longer opens the panel after every sign-in. The punch itself
   is Attendance's write (`POST /api/v1/attendance/punches`, LA).
2. **A clock-in reflects on Home.** A punch commits through Attendance, which records it and
   recalculates the person's day (`attendance_day`). Clocked In Today, the Operations chart, the
   Team roster and the Staff day strip all read the shared attendance roster
   (`src/modules/attendance/attendance.roster.js`), which reads that day's record the way People ·
   Attendance and My Attendance read it, so they move with it, no copy and no second source, and
   always equal those screens. An Overview on screen reads itself again when the reader's own
   state today changes (after a punch from the panel, at once) and on `attendance.updated` (a
   punch in their People scope, a burst of them read once). When Attendance emits
   `attendance.punched`, Home's handler re-reads the late-arrival rules for that person at once
   instead of waiting for the morning sweep.
3. **A KPI card → its records.** Clicking a card opens the records behind the number
   (`GET /api/v1/home/kpi/:key/meta` for its title, summary line, columns and groups, then
   `GET /api/v1/home/kpi/:key`, paged at 25). Clocked In Today breaks down into On Site, Remote,
   Late, Not In, On Leave and No Clock-Out Yesterday (module demos, 01:27 to 01:28). A card the
   reader may not see answers 404, never 403.
4. **Choosing cards.** Choose Cards reads `GET /api/v1/home/kpi-picker` (only the cards the reader
   may see), and Save Cards writes the order with `PUT /api/v1/home/kpi-picks`; Use Role Default
   deletes the pick (`DELETE /api/v1/home/kpi-picks`). A role's own defaults and locks are set
   with `PUT /api/v1/home/roles/:role_id/kpis` (Settings, M9). When a role loses a grant, a
   capability or sight of a field (`permission.changed`, `capability.changed`,
   `field_visibility.changed`), an outbox handler takes the cards it can no longer see out of
   `role_kpi`; a person's own pick is filtered the same way each time it is read.
5. **A threshold breach → an alert.** Time-based metrics are swept once a day at 06:00 Lagos
   (`home-alert-sweeps`): for each switched-on rule the sweep computes its metric per subject and
   raises, refreshes or leaves an alert through the shared alert engine
   (`src/shared/alerts/alerts.js`). Late arrivals are also re-read on `attendance.punched`. An alert
   appears on Home · Alerts, and the holders of the rule's grant are notified
   (`home.alert_raised`). A High alert left open 14 days is escalated to the CEO
   (`home.alert_escalated`, the hourly `alert-ageing` job). An alert is not a notification
   (MILESTONES §18.1): a notification is read once, an alert ages until someone clears it.
6. **Clearing.** A person who holds `alerts.clear` and whose grant on the rule's `permission_key`
   reaches the alert's subject clears or dismisses it (`POST /api/v1/home/alerts/:id/clear`),
   which writes the audit entry (`home.alert_cleared`). Switching a rule off dismisses its open
   alerts as the rule change itself.
7. **A report → the recipient's inbox.** A manager builds a report on Home · Reports and schedules
   it (Daily Attendance, every working day at 18:00). Every five minutes `scheduled-reports` finds
   the schedules that are due and creates one numbered run per recipient and format for the slot
   (`home.report_run`). The outbox handler `reports.generate` builds each file **as its recipient**
   (their grants, scope and masked fields), as a PDF through `documents.generate` or an XLSX
   through `shared/spreadsheet` and the vault, and the file is emailed only once it exists. Run Now
   does the same for the caller, at once, and answers the pending run; Recent Runs shows it
   Pending until its file is there.
8. **Overview Export.** Export on the Overview is a run of the reader's own Overview through the
   same engine (`POST /api/v1/home/overview/export`): numbered, vaulted, emailed to them.
9. **The dashboard is wired last.** On production Home shows zero and empty lists until the modules
   it reads are built and used; on staging the Home seed writes tagged rows into those modules'
   tables so every card has figures (§11). This is a build-order note, not a runtime mode.

## 4 · Data

Home owns the tables below. It keeps no copy of the figures it displays: those are read live from
the owning modules, scoped by the reader's grants.

| Table | Key columns | Notes |
|---|---|---|
| `home_alert_rule` | `home_alert_rule_id`, `key`, `name`, `metric`, `threshold`, `window_days`, `severity`, `permission_key`, `enabled`, `created_by`, `updated_by` | A rule is data, not code: a number changes with no deploy. `key` is made by the server, `<metric>.<slug of the name>`, with a number on the end when taken. `metric` is a key of the metric registry (§6). `permission_key` is who may clear its alerts, `<module>.<action>` from the access catalogue. Rules are switched off, never deleted. `name`, `created_by`, `updated_by` came with `1150`; rules written before it took their key as their name |
| `home_alert` | `home_alert_id`, `home_alert_rule_id`, `subject_type`, `subject_id`, `subject_employee_id`, `title`, `trigger`, `severity`, `over_by`, `raised_at`, `last_seen_at`, `escalated_at`, `cleared_at`, `cleared_by`, `outcome`, `note` | One open alert per rule and subject. `subject_employee_id` (`1150`) is the person it is about, null when it is about no one in particular (a budget, a partner). `over_by` (`numeric(18,2)`, `1100`) is how far past the threshold, or the days left for a deadline metric. `outcome` is `cleared` or `dismissed`. Written only by the shared alert engine (BACKEND_STRUCTURE §11.1) |
| `saved_report` | `saved_report_id`, `owner_user_id`, `name`, `report_key`, `definition`, `shared`, `archived_at` | A report. `report_key` is its source (§6); `definition` holds its filters (`{ filters }`); `name` is unique per owner. A report with runs is archived (`archived_at`, `1150`), never deleted |
| `report_schedule` | `report_schedule_id`, `saved_report_id`, `recurrence`, `starts_on`, `run_time`, `timezone`, `formats`, `recipient_user_ids`, `recipients`, `active`, `last_run_at`, `next_run_at` | One per report (unique index, `1150`). `recurrence` is a rule of `src/shared/time/recurrence.js` counted from `starts_on`, fired at `run_time` in `timezone` (always Africa/Lagos); never cron. `formats` is `pdf`, `xlsx` or both. Recipients are logins (`recipient_user_ids`); `recipients` keeps their addresses as written, for display. `active` false is Paused |
| `home_report_run` | `home_report_run_id`, `number`, `saved_report_id`, `report_schedule_id`, `scheduled_for`, `recipient_user_id`, `requested_by`, `format`, `status`, `document_id`, `emailed_at`, `error`, `run_at`, `finished_at` | One generated file: one report, one recipient, one format. `number` from `numbering.allocate(client, "report_run")` (RPT-0001, never reset). `status` is `pending`, `done`, `failed` or `skipped`. A scheduled run names its schedule and slot, and a slot is generated once per recipient and format (unique index); a run on demand has neither. `document_id` is the vaulted file once it exists |
| `role_kpi` | `role_kpi_id`, `role_id`, `default_ids`, `locked_ids`, `updated_by` | A role's cards: up to four defaults in order, and the locked ones (always among the defaults). No row: the role follows its Home view's defaults. Removed with its role |
| `home_kpi_pick` | `home_kpi_pick_id`, `user_id`, `kpi_ids` | A person's own cards, up to four, in order. No row: they follow their roles. An empty list: they chose to see none |

A card id in `role_kpi` and `home_kpi_pick` is a key of the KPI catalogue
(`src/modules/dashboard/kpi-catalog`), which is code, so there is no foreign key: the service
checks every id, and an id the catalogue no longer has is ignored when read.

Schema migration files: `migrations/1000_core_operations.sql` (the tables), `1100_home_alert_columns.sql`
and `1150_home_foundation.sql` (everything above that is not in 1000, plus the index Activity
Today needs on an M1 table, `event_log (occurred_at)`; the roster reads through the attendance
module's own indexes).
Reference data: `seeds/reference/1199_seed_home.sql` (the capabilities and their default roles,
the `report_run` numbering scheme, and the removal of 1099's three alert thresholds, A26). Home
claims 1150 and 1199 in the M1 block. No `role_kpi` row is seeded: a role's cards are a business
choice, and the defaults by Home view are code (§6). Indexes Home's reads want on tables of later
milestones are requests in each owning milestone's Owes in DATABASE_SCHEMA ("Indexes asked by
Home"), never added here (A1).

Money is `numeric(18,2)` and crosses the wire as a string (`shared/money`); dates are ISO on the
wire and day-first for people.

### 4.1 Sources

Home reads tables of later milestones only through one source adapter per owning module,
`src/modules/dashboard/sources/<owner>.source.js`. Each declares the module, the milestone and
the owner of the tables, the tables and columns it reads (`tables`), what that milestone still owes
the query (`owes`), and the query functions Home calls. A unit test holds every declared table and
column to the migrated schema, and the schema gate holds every query to them.

| Adapter | Owning module · milestone · owner | Reads |
|---|---|---|
| `tasks.source.js` | tasks · M2 · AJ | `task`: overdue tasks and what is due this week (a person's Open Tasks on Team stays empty until M2) |
| `goals.source.js` | goals and targets · M2 · AJ | `organisational_goal`, `employee_target`: Goals This Quarter and My Goals, without progress until M2 defines it (Goals On Track stays hidden, §13; the CEO's Org KPI is drawn from the organisation's departments, each with no score until M2 defines KPI scores, §6, §13) |
| `reviews.source.js` | reviews · M2 · AJ | `performance_review`, `performance_cycle`: reviews due |
| `calendar.source.js` | calendar · M2 · AJ | `calendar_event`: Your Week |
| `vacancies.source.js` | vacancies · M4 · TB | `vacancy`: open vacancies |
| `payroll.source.js` | payroll · M6 · LA | nothing yet: Payroll In Progress is hidden and has no query until M6 creates its tables |
| `partners.source.js` | partners and pipeline · M7 · GE | `partner`, `partner_interaction`, `partnership_opportunity`, `partnership_agreement`, `partnership_proposal`: pipeline, signed value, quiet partners, proposals out |
| `expenses.source.js` | expenses · M8 · AJ | `expense_request` and `expense_category`: awaiting approval, with each request's category |
| `budgets.source.js` | budgets · M8 · AJ | `budget`, `budget_line`: budget used |

**The milestone that builds a table updates its adapter in the same PR**: it moves or replaces the
query, keeps the declared columns true, and clears its `owes`. Each adapter's header says so, and
DATABASE_SCHEMA's Owes for M2, M4, M6, M7 and M8 names the adapter. Money sums count Naira only
(`currency = 'NGN'`, §6).

Tables built in M0 and M1 are read through their own modules' service or repo functions, not adapters:
`organisation` (headcount, attrition, confirmations, one definition with People · Employees),
`workflow` (`mine`, `mineCount`: Need You and Awaiting Your Approval), `documents` (documents
requested, with the documents module's own open-request rule, `REQUEST_STILL_OPEN` in documents.repo.js),
`leave` (a person's year from its balance read in leave.repo.js), and the
**shared attendance roster**, `src/modules/attendance/attendance.roster.js` (LA's module, written
by Home, decision O4): `summary(client, { date }, scope)`, `page(client, { date, status, flagged,
... }, scope, query)` (paged at 25), `month(client, { from, to, department_id, q }, scope, query)`
(paged at 25: each person's totals over the days, in one query) and `personal(client, {
employee_id, from, to })`. It decides nothing about
attendance: it reads the attendance module's record of each day (`attendance_day`, written by the
punch, People's decisions and the day-close), a day with no record by the register's rules (granted
`leave_request`, the working week and public holidays through `shared/time/working-week`), and My
Attendance's own totals (`attendance.repo.js` `daysSummary`). Overview, Team and the Staff day strip
read it; People · Attendance and My Attendance read the same records through their own routes
(attendance.md §6.9).

## 5 · API

All three routers mount at `/api/v1/home` (`basePath: "/home"`); a literal path (`/summary`,
`/meta`) is defined before the `/:id` beside it. Contracts are `packages/contract/schemas/dashboard.js`,
`alerts.js` and `reports.js`, `snake_case`, every name prefixed `Home`.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/home/overview` | → `HomeOverview` | `home` view · each section in the reader's scope for its module | n/a | Typed sections, null when the reader has none (§6). Each embedded list holds at most 25. Need You is its own paged list (`GET /workflow/mine`); Upcoming Leave links to ESS · My Leave; Your Week is at most 25 a day; Goals This Quarter, My Goals and Activity Today are their first 25, each row with its link, and have no paged home in M1 |
| `POST /api/v1/home/overview/export` | `HomeReportRunNow` → `HomeReportRun` | `home` view | n/a | The Overview Export: a pending run of the reader's own Overview, through the reports service |
| `GET /api/v1/home/kpi-picker` | → `HomeKpiPicker` | `home` view · own | n/a | Only cards the reader may see; their pick, their roles' defaults and locks, what shows now |
| `PUT /api/v1/home/kpi-picks` | `HomeKpiPicks` → `HomeKpiPicker` | `home` view · own | n/a | Up to four, each once, each one the reader may see; an empty list is a choice |
| `DELETE /api/v1/home/kpi-picks` | no content | `home` view · own | n/a | Back to their roles' cards |
| `GET /api/v1/home/kpi/:key/meta` | `HomeKpiParams` → `HomeKpiDetailMeta` | `home` view, and the card's own eligibility · the card's scope | n/a | 404 for a card the reader may not see |
| `GET /api/v1/home/kpi/:key` | `HomeKpiParams`, `HomeKpiDetailQuery` → `HomeKpiDetailPage` | as above | yes, 25 | Filter `group`; rows masked for the reader |
| `GET /api/v1/home/roles/:role_id/kpis` | → `HomeRoleKpis` | `settings` view | n/a | Offers the cards the ROLE may see |
| `PUT /api/v1/home/roles/:role_id/kpis` | `HomeRoleKpisSave` → `HomeRoleKpis` | `settings` edit | n/a | Up to four defaults; locks among them. None takes the role back to its Home view's cards, as DELETE does |
| `DELETE /api/v1/home/roles/:role_id/kpis` | no content | `settings` edit | n/a | Back to the Home view's defaults |
| `GET /api/v1/home/team/summary` | → `HomeTeamSummary` | `home` view · its scope (all, team or own), `home.team` | n/a | `scope`, and today's four Team cards, each the number of records it opens (`GET /home/kpi/:key`) |
| `GET /api/v1/home/team` | `HomeTeamQuery` → `HomeTeamPage` | as above | yes, 25 | Today's roster. Filters: department, status, no clock-out yesterday, `q` (name or job title); sort by name (the default), department, Clock-In. KPI and Open Tasks are null until M2 |
| `GET /api/v1/home/team/attendance` | `HomeTeamAttendanceQuery` → `HomeTeamAttendancePage` | as above | yes, 25 | Attendance This Month, one row a person. Filters: department, `q`; sort by name (the default) or days on time |
| `GET /api/v1/home/alerts` | `HomeAlertQuery` → `HomeAlertPage` | `home` view, `alerts.clear` or `alerts.manage` · each rule's module scope over `subject_employee_id` | yes, 25 | Filters: category, severity, state (open, cleared, dismissed: View Dismissed), mine, overdue, rule. Each row says `can_clear` |
| `GET /api/v1/home/alerts/summary` | → `HomeAlertSummary` | as above | n/a | Open, Needs You, Overdue 7 Days +, Cleared This Week, the category chips, Alert Sources |
| `GET /api/v1/home/alerts/:id` | → `HomeAlert` | as above | n/a | For `?tab=alerts&id=`; 404 when the reader may not see it |
| `POST /api/v1/home/alerts/:id/clear` | `HomeAlertClear` → `HomeAlert` | `home` view, `alerts.clear`, and the rule's `permission_key` reaching the subject | n/a | `outcome` cleared (default) or dismissed. Clearing a closed alert answers it as it is, with no second audit entry |
| `GET /api/v1/home/alert-rules` | `HomeAlertRuleQuery` → `HomeAlertRulePage` | `home` view, `alerts.manage` | yes, 25 | Filters: metric, category, enabled |
| `GET /api/v1/home/alert-rules/:id` | → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Edit Rule from an alert |
| `POST /api/v1/home/alert-rules` | `HomeAlertRuleCreate` → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Rule Name, Metric, Threshold, Window Days, Severity, Who Can Clear; the key is made by the server |
| `PATCH /api/v1/home/alert-rules/:id` | `HomeAlertRuleUpdate` → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Any field but the metric; `enabled: false` dismisses its open alerts |
| `GET /api/v1/home/reports` | `HomeReportQuery` → `HomeReportPage` | `home` view, `home.reports` · own, and shared ones whose source the reader may open | yes, 25 | Filters: source, status, archived, mine; sort by name or created |
| `GET /api/v1/home/reports/summary` | → `HomeReportSummary` | as above | n/a | Scheduled, Paused, Runs This Month, Recipients |
| `GET /api/v1/home/reports/:id` | → `HomeReport` | as above | n/a | 404 when the reader may not see it |
| `POST /api/v1/home/reports` | `HomeReportCreate` → `HomeReport` | `home` view, `home.reports` | n/a | Name, source, filters, shared, and a schedule or none (on demand) |
| `PATCH /api/v1/home/reports/:id` | `HomeReportUpdate` → `HomeReport` | `home` view, `home.reports`; its owner or the CEO | n/a | Name, filters, sharing, or the whole schedule (null: on demand) |
| `PATCH /api/v1/home/reports/:id/schedule` | `HomeReportScheduleState` → `HomeReport` | as above | n/a | Pause or Resume |
| `POST /api/v1/home/reports/:id/archive` | `EmptyBody` → `HomeReport` | as above | n/a | Archives it and stops its schedule; its runs stay |
| `POST /api/v1/home/reports/:id/run` | `HomeReportRunNow` → `HomeReportRun` | `home` view, `home.reports`, and the source's grant | n/a | Run Now: one file for the caller, answered `pending` with no `document_id` yet |
| `GET /api/v1/home/report-runs` | `HomeReportRunQuery` → `HomeReportRunPage` | `home` view, `home.reports` · runs the reader received, and every run of the reports they own | yes, 25 | Recent Runs, newest first. Filters: report, status, format |

Every route checks `requirePermission` first and the capability after it (README §5.2); the grant
sets the record scope, the capability sets none. Every list is paged at 25 through
`shared/http/paged.js`, with no page-size parameter anywhere (BACKEND_STRUCTURE §16). Home also
calls routes it does not own: Need You reads `GET /api/v1/workflow/mine` (and `/count`), a finished
run downloads from `GET /api/v1/documents/:id/content`, and the clock-in panel uses Attendance's.
`contract.gen.ts` is generated by `npm run gen:contract`, never edited.

## 6 · Rules and calculations

**Cards**

- **The KPI catalogue** (`src/modules/dashboard/kpi-catalog`) declares every card once: its id,
  title, unit, the module whose `view` gate and scope it takes, an optional capability, an optional
  sensitive field, and its query and records. It checks itself at require time, so a half-defined
  card stops the boot. A card is `live` (computed and offered) or `hidden` (declared, no query,
  never offered, until its milestone makes it live).

  | Domain | Cards (module; `hidden` until the milestone named) |
  |---|---|
  | People | `headcount`, `attendance_today`, `leave_pending`, `attrition_90d`, `confirmations_due`, `documentation_pending` (people); `vacancies_open` (recruitment); `reviews_due` (performance) |
  | Work | `tasks_overdue` (workspace); `approvals_awaiting_you` (home); `alerts_high_open` (home, with `alerts.clear`); `goals_on_track` (performance, hidden until M2) |
  | Business | `partnership_pipeline`, `partnerships_active`, `partnerships_signed_value`, `partnerships_quiet_30d`, `proposals_out` (partnerships) |
  | Finance | `expenses_pending`, `budget_vs_actual` (expenses); `payroll_run_state` (payroll, hidden until M6) |
  | Personal | `my_attendance_30d`, `my_tasks_overdue`, `my_reviews_due`, `my_leave_left`, `my_targets_on_track` (ess, always own; the last hidden until M2) |
  | Team | `team_present`, `team_on_site`, `team_remote`, `team_flags` (`home`, with `home.team`; never offered in the picker; the Team tab's scope) |

- **Eligibility, at read time.** A reader may see a card when it is live, they hold `view` on its
  module, they hold its capability if it names one, and its sensitive field is not masked for them.
  The CEO sees every live card. A card never grants access its reader does not already have, and
  revoking a module retires its cards everywhere at once.
- **Which cards show (resolution).** First the person's own pick (`home_kpi_pick`: no row means
  "follow my roles", an empty list means "none"); else the `role_kpi` rows of their effective roles,
  highest rank first then by name, defaults joined in that order; else their Home view's defaults;
  else none. The locked cards of all their roles are joined and lead, whichever of those won. Then
  only eligible cards, each once, the first four. A card that drops out shrinks the row; nothing is
  put in its place.
- **Defaults by Home view** (code, not seed; each lists a fifth or sixth so a hidden M2 card does
  not leave a gap): Operations `attendance_today`, `tasks_overdue`, `expenses_pending`,
  `partnerships_active`, `headcount`; CEO `goals_on_track`, `approvals_awaiting_you`,
  `partnerships_signed_value`, `alerts_high_open`, `attendance_today`; Partnerships
  `partnerships_active`, `partnerships_signed_value`, `partnerships_quiet_30d`, `proposals_out`;
  Staff `my_targets_on_track`, `my_tasks_overdue`, `my_reviews_due`, `my_attendance_30d`,
  `my_leave_left`.
- **A card's figure** is computed in the reader's scope on its module. Money is Naira as a wire
  string; a ratio keeps what it is out of ("0 of 30" is not "0 of nothing", and a denominator of 0
  shows no figure). A card whose query fails is logged and left out of the row, never shown as 0.
- **Choosing cards.** Up to four, each once, only cards the reader may see; locked cards cannot be
  taken off. Choose Cards starts from the cards showing, locks first, never the stored pick, so a
  card a role locked after the pick was saved is already in it and saving unchanged is accepted.
  Restating the roles' cards in their order saves as "follow my roles". A role's defaults are at
  most four and its locks are among them; they are offered from the cards the role may see, not
  the editor's. Saving a role with no default removes its row, as DELETE does: a role row always
  holds a default, so `configured` is true only when its members get the role's cards.
- **The prune.** When a role loses a grant, a capability or sight of a field, the cards it can no
  longer see leave its `role_kpi` row (the row goes when no default is left). Personal picks are
  filtered at read time.

**Overview**

- **Sections by Home view** (`src/modules/dashboard/dashboard.layout.js`, code like the cards'
  defaults):
  - Operations: Clocked In under the greeting; the attendance chart, present out of expected on
    each of the last 14 working days (today the last when it is one); the On Time donut, this
    month's working days so far counted on time, late and absent; the Partnership Pipeline; Goals
    This Quarter. Every attendance figure is the shared roster's day (`summary`) in the reader's
    People scope, so it equals Clocked In Today and People · Attendance; absent is a day the
    day-close closed, so today never adds to it.
  - CEO: the organisation's goals this quarter as the main chart, and the Org KPI donut, the
    organisation's score and each active department beside it; the Partnership Pipeline. Goals
    This Quarter is the chart, so it is not drawn twice.
  - Partnerships: the Naira value signed in each month of this year (the agreements the Signed
    Value card counts, each in the month it starts until M7 records the signing date). The year is
    read whole, as the card reads it, so the months add up to the card: they run to this month, or
    to a later one an agreement already starts in. Beside it the Partnership Pipeline (open
    opportunities by stage, and active partners with no contact in 30 days) and Goals This
    Quarter.
  - Staff: the day strip (today's hours, and the reader's own row of today's roster: status,
    Clock-In, Clock-Out, the worksite of the clock-in, and Hours Today, first clock-in to last
    clock-out, none until they clock out), My Goals This Quarter (their targets due this quarter)
    and Upcoming Leave. A member of staff's Overview is their own day, so it draws no chart,
    pipeline or organisation goals.
  - Every view: Need You, Activity Today, Your Week.

  A section whose module the reader cannot open (the `view` grant the cards check) is null and is
  not drawn, and every section is read in the reader's scope on its module. A goal's progress and
  every KPI score are M2's to define and are null until then (§13). A section, the activity or the
  alert count whose read fails is logged and left null, never drawn as a zero or an empty list,
  as a card is. The server sends figures; every title and caption is written on the screen.
- **Need You** is on every Overview: the requests waiting on the reader (`GET /workflow/mine`, its
  own paged list) and `alerts_to_clear`, the open alerts of any severity they may clear (a holder
  of `alerts.clear` whose grant on the rule's `permission_key` reaches the alert's subject; null
  for anyone without `alerts.clear`). Staff hold `approve` nowhere, so theirs is empty in M1 and
  shows its empty state.
- **Activity Today** is today's `event_log` (Lagos day) through an allow-list in
  `dashboard.activity.js`; a key not on it never reaches Home, so a new event is private until
  someone adds it. On it: `employee.created`, `leave_request.approved`, `leave_request.recorded`
  and `attendance.review_required` (People, each about one person, so they follow the reader's
  People scope; one about nobody in particular reaches `all` only), and `recognition.posted` and
  `celebration.posted` (Community, posted in #general, so every Community viewer sees them). A
  row is only ever an allowed key under the module that declares it. Never a mail, a message, a
  sign-in or an audit before-and-after value: each row is the key, the module, when, who did it,
  who it is about and where it opens (the reader's own view when it is about them). At most 25,
  newest first.
- **Your Week** is this week's working days, Monday first (the days the working week works, a
  public holiday among them named and given no hours): each day's hours (Saturday 09:00 to 15:00),
  whether the reader's granted leave covers it, and their own calendar events and tasks due on it
  (through the M2 sources, for a reader who may open My Workspace). Each day reads its own page of
  events and of tasks, so a busy Monday never takes Friday's place, and shows at most 25 of them.
  An event shows on the day it starts, never on each day it spans; one that began before Monday
  shows on Monday.
- **Upcoming Leave** is the reader's own submitted and approved leave not yet over, soonest first,
  as the leave module shapes a request, and what is left this year of the type My Leave leads with
  (Annual, else the first type with an allowance): the same figure My Leave shows. It is the first
  25; View All opens ESS · My Leave, its paged home.
- **New** lists only the create actions the reader holds: New Task, Request Leave, New Rule, New
  Report.
- **Clock-in prompt** (`dashboard.prompt.js`). `prompt_clock_in` is true when all hold: the
  session reading the Overview is the first one they signed in with today (the earliest
  `user_session` issued that Lagos day is the caller's), and Attendance's own word on where they
  stand (`GET /attendance/me/today`, read only for that first session) is Not Clocked In on a
  working day: the employee is active, no granted leave covers today (approved, or granted by its
  approval), no clock-in counts today (accepted or in review, not excluded by People's decision)
  and no shift is still open from yesterday. It is stateless: closing the panel is enough for the
  day, a session kept from yesterday or a second session that day does not prompt, and a prompt
  that cannot be decided is not shown.

**Team**

- **The roster** gives one status per person per day: the attendance register's, in Home's words.
  `on_leave` (leave recorded, or granted leave covering the day), `late` (the day's record has late
  minutes: whole minutes past the start plus the policy's grace, counted punches only), `on_site` or
  `remote` (in on time: remote for someone whose work pattern is remote), `absent` (a working day the
  day-close closed with no clock-in), `not_in` (a working day not closed, no clock-in yet). Beside
  it, the flag No Clock-Out Yesterday (the person's last working day, so Saturday on a Monday and the
  day before a holiday after one, has a clock-in and no clock-out on its record). attendance.md §6.9
  is the rule's home; the roster decides none of it. Present Today is present out of expected, as
  the register counts them: on a day that is not worked nobody is expected, and a clock-in made on
  it is still present. Absent never shows on today's cards, since the day-close closes only days
  before today. A field status waits for LA's field assignments (§13).
- **Scope.** Team shows the people in the reader's `home` scope: `all` for Operations & People,
  Implementation, Management and the CEO; `team` (the reader and everyone below them on the solid
  reporting line) for Heads of Department and Line Managers; `own` (the reader alone) for anyone
  else the capability is given to. The capability opens the tab; the grant decides whose rows. The
  summary says which scope it read (`scope`); the screen words it.
- **Team's cards**, today in that scope, each the number of records it opens: Present Today
  (present out of expected; its records are the day's roster, and its On Site, Remote and Late
  chips hold the people it counts), On Site, Remote, and Flags: the people late today or with no
  clock-out yesterday, each counted once, so someone who is both is one flag and appears under both
  of its chips. KPI and Open Tasks on a roster row are null until M2 builds performance scores and
  tasks.
- **Attendance This Month** is one row a person on the register on any day from the 1st of this
  month (Lagos) to today, in the same scope, with My Attendance's own figures for those days
  (`attendance.repo.js` `daysSummary`): on time, late, absent and on leave, a day counting once the
  attendance module has recorded it, and expected as on time plus late plus absent. Someone who
  left during the month keeps the days recorded for them. It pages at 25 in one query.

**Alerts**

- **The metric registry** (`src/modules/alerts/alerts.metrics.js`, keys equal to the contract's
  `HomeAlertMetric`, in this order): `late_arrivals` and `missing_clock_out` (attendance, counted
  over a window of days), `approval_ageing` (approval, days waiting), `document_expiry` (document,
  deadline), `confirmation_due` and `contract_ending` (people, deadline), `partner_inactivity`
  (partnership, days since contact), `budget_threshold` (budget, percent spent),
  `recruitment_sla` (recruitment, days at a stage). Each also names its subject, its source, the
  milestone that owns its tables and its default Who Can Clear. Only the four over M0 tables
  (approval ageing, document expiry, confirmation due, contract ending) raise real alerts on
  production in M1; the attendance pair follows LA's punch API, the rest their milestones.
- **A count metric** breaches when its value reaches the threshold; `over_by` is the value less the
  threshold ("+1 over 3"). A window counts the last W days ("3 late arrivals in 30 days").
- **A deadline metric** breaches when the days left reach the threshold or fewer; its threshold is
  whole days, `over_by` holds the days left, and the screen reads "12 days left". A date already
  passed holds 0 and reads Expired.
- **Who sees an alert.** A holder of `alerts.clear` or `alerts.manage` sees the alerts of the rules
  whose `permission_key` they hold, about people within their scope for that module. An alert about
  no one in particular is seen only by holders with `all` scope. The CEO sees every alert.
- **Clearing needs both checks**: `alerts.clear` (may clear alerts at all, on the route) and the
  rule's `permission_key` reaching the alert's subject (may clear this one). The CEO passes both.
  `can_clear` on each row says the same, so the screen offers Clear Alert only where it will work.
- **Rules.** Created and changed by `alerts.manage` holders. Who Can Clear defaults to the metric's
  own and can be changed. A new rule is first evaluated at the next sweep or signal. Switching a
  rule off dismisses its open alerts as the rule change (no clearing right needed) and raises no
  more.
- **The counts.** Open; Needs You (open alerts the reader may clear); Overdue 7 Days + (open more
  than seven days, any severity); Cleared This Week (outcome `cleared` since Monday, Lagos; a
  dismissed alert is not counted); Alert Sources, 30 Days (raised in the last 30 days by metric,
  cleared ones included). View Dismissed lists outcome `dismissed`.
- A High alert open 14 days is escalated to the CEO once.

**Reports**

- **The sources** (`src/modules/reports/reports.sources.js`, keys equal to the contract's
  `HOME_REPORT_SOURCES`): `daily_attendance` (the roster; filters department and status), `leave`
  (People's leave list; status and type), `open_alerts` (the alert list; category and severity),
  `headcount` (the staff register; department), `tasks`, `partnerships`, `expenses`, `recruitment`
  (their milestones' queries; no filters until then), and `overview` (the Overview Export, never
  offered on the form). Each is the module and grant it needs plus the same query its screen uses,
  gathered page by page.
- **Who sees a report**: its owner, and, when it is shared, every `home.reports` holder who may
  open its source. Only the owner and the CEO change, pause or archive it. Anyone who sees it may
  run it, for themselves.
- **Generation is as the recipient.** Each run is built with the recipient's own grants, scope and
  masked fields, so a file never holds a row they could not open on screen. A recipient who is no
  longer active, no longer holds the source's grant, or (for any source but the Overview) no longer
  holds `home.reports`, gets no file: their run is `skipped` and nothing is emailed. A file is
  emailed only once it exists. The PDF and XLSX use day-first dates and Naira.
- **A file is opened** by its recipient, the report's owner and the CEO only (the vault's rule for
  `home_report_run`), from `GET /documents/:id/content`.
- **Schedules** repeat daily, weekly or monthly (a recurrence rule, never cron) from `starts_on`, at
  `run_time` in Lagos, optionally on working days only. `next_run_at` is the next slot; a paused
  schedule keeps its rule, has no next slot and sends nothing. Saving over a schedule keeps it
  paused or running as it was. A slot is generated once per recipient and format however often the
  scheduler looks.
- **Run Now and Export** each create one file for the caller in the chosen format and answer it
  `pending`; pressing again with the same idempotency key is the same run. The Overview Export is a
  run of the reader's own Overview report (source `overview`, made the first time they export, not
  listed on Reports).
- **Runs This Month** counts files since the 1st (Lagos); **Recipients** counts the people who
  receive at least one scheduled report the reader may see.

**Everywhere**

- **Every "today" is Lagos** (`shared/time/lagos`), never the database session's date.
- **Money is Naira only.** `shared/money` holds Naira; a sum over a forward table counts rows in
  `NGN` and leaves others out (§13).
- **What reaches a screen is decided in §10** (FRONTEND_GUIDE §5): data, numbers and actions are
  open; Over By is the one help term; how the system works (this section and §3) never reaches a
  screen. Chrome is Title Case; copy a person reads uses no em dashes.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `home.kpi_picks_changed` | a person saves or resets their cards | audit; nothing follows |
| `home.role_kpis_changed` | a role's cards are saved or cleared | audit; nothing follows |
| `permission.changed`, `field_visibility.changed`, `capability.changed` (access) | a role's grants, masks or capabilities change | outbox `dashboard.prune-role-kpis`: takes the cards the role can no longer see out of `role_kpi`; idempotent |
| `home.alert_rule_created`, `home.alert_rule_updated` | a rule is created or changed | audit; switching off also dismisses its open alerts in the same transaction (`home.alert_cleared` per alert) |
| `home-alert-sweeps` (scheduler, daily 06:00 Lagos) | every morning | runs each time-based metric's sweep for its switched-on rules: raises, refreshes or leaves alerts |
| `attendance.punched` (Attendance, when LA emits it) | a punch commits | outbox handler in `alerts.events.js`: re-reads the late-arrival rules for that person |
| `home.alert_raised` | an alert is raised | notifies the holders of the rule's `permission_key` (a notification, separate from the alert) |
| `home.alert_cleared` | an alert is cleared or dismissed | the audit entry (who, when, outcome) |
| `alert-ageing` (scheduler, hourly at ten past, M0) | a High alert has been open 14 days | `home.alert_escalated`: notifies the CEO, once per alert |
| `home.report_created`, `home.report_updated`, `home.report_archived` | a report or its schedule is saved, paused, resumed or archived | audit |
| `scheduled-reports` (scheduler, every 5 minutes) | a schedule's `next_run_at` has come | queues `scheduled-report` per due schedule |
| `scheduled-report` (handler) | queued by the scheduler | creates one run per recipient and format for the slot, advances `next_run_at`, emits `home.report_run` per run |
| `home.report_run` | a run row is created: scheduled, Run Now or Export | outbox `reports.generate`: builds the file as the recipient, PDF through `documents.generate` (doc type `home_report`, the run's number on it) or XLSX through `shared/spreadsheet` and the vault; `skipped` when the recipient may no longer open it |
| `document.generated`, `document.render_failed` (documents, filtered to `home_report`) | the PDF is rendered, or rendering gave up | the run becomes `done` (and the file is emailed) or `failed`; an XLSX run is settled where it is stored |

Every write goes through its module's service, in a transaction, with `emit()`; follow-on work is
an outbox handler, never inline, and every handler is safe to run twice. Home raises no event for a
figure it only reads.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (Staff) | the Staff Overview: day strip, their own cards, Upcoming Leave, Your Week, an empty Need You; Team, Alerts and Reports show the gated state | choose their cards; open a card's records; Export their Overview; clock in from the prompt |
| Line Manager | the Staff Overview; Team for everyone below them on the reporting line; alerts of rules whose grant reaches their team; their own and shared reports | clear their team's alerts; build, run and receive reports |
| Head of Department | the Partnerships Overview; Team for everyone below them; alerts their grants reach; their own and shared reports | as a Line Manager |
| Operations & People, Implementation, Management | the Operations Overview; Team across the organisation; every alert their grants reach; their own and shared reports | clear alerts; create and change rules; build, run and receive reports |
| System Administrator | the Staff Overview; Settings | set a role's cards (`settings` edit) |
| CEO | the CEO Overview; everything, organisation-wide | everything |

| Capability | Allows | Held by default (and the CEO) |
|---|---|---|
| `home.team` | the Team tab, its cards and lists | Implementation, Operations & People, Management, Head of Department, Line Manager (`1199`) |
| `home.reports` | building, scheduling, running and receiving reports | the same five (`1199`) |
| `alerts.manage` | creating, changing and switching off alert rules (the guide's earlier `home.alerts.manage`, renamed to the two-segment rule) | Implementation, Operations & People, Management (`1199`) |
| `alerts.clear` | clearing or dismissing an alert, with the rule's own grant | Implementation, Operations & People, Management (`0449`); Head of Department, Line Manager (`1199`) |

All four are changed on Settings · Roles & Permissions. Every `home` viewer sees the four tabs; a
tab whose capability they lack shows the gated state, and ⌘K does not offer it. Restricted fields
(salary and other personal amounts) reach a card, a record list or a report only for a reader who
may see them, and the CEO is never masked. A suspended or dismissed account cannot sign in and so
never reaches Home.

## 9 · AI and search

- **AI reads**, all `permission: ["home", "view"]`, paged at 25, with the capability checked inside
  the read (the assistant checks only the module grant):
  - `alerts.ai.js` · `alerts.mine` (`HomeAlertQuery`): the open alerts the asker may clear; an empty
    page without `alerts.clear`.
  - `dashboard.ai.js` · `team.today` (`HomeTeamQuery`): today's roster in the asker's `home` scope,
    as their Team tab lists it, each row cited as the employee; an empty page without `home.team`.
    `cards.mine` (`EmptyBody`): the asker's own cards and their figures.
  - `reports.ai.js` · `reports.mine` (`HomeReportQuery`): the reports the asker owns or receives;
    empty without `home.reports`.
  Nothing write-like: the assistant never clears an alert, edits a rule, runs a report or saves
  cards (A23). Manifests declare reads and screen routes only.
- **AI routes**: "see open alerts" → `home.alerts` with a category; "open a report" →
  `home.reports`; "see who is in" → `people.attendance`; "see my team's attendance" →
  `home.team`; "choose the cards on my Home" →
  `home.overview`; "see who has clocked in today, by status" and "see the requests waiting on my
  approval" → `home.overview` with `kpi` (`attendance_today`, `approvals_awaiting_you`), which opens
  that card's records as ⌘K's `?id=` does.
- **Search**: route-map types `home_alert` and `home_alert_rule` (Alerts), `home_report` and
  `home_report_run` (Reports), `home_kpi` (Overview, opening the card's records). Providers:
  `alerts.search.js` (alerts the reader may clear, subject in scope; rules for `alerts.manage`
  holders), `reports.search.js` (reports the reader may see; runs they received),
  `dashboard.search.js` (the cards the reader may see and the Overview offers, by their title or
  their records' title; a Team card belongs to its tab and is not found). Each filters per person,
  since every login holds `home` view. Words people use: "alert", "warning", "red flag"; "report",
  "attendance report"; "dashboard", "KPI", "card". New Rule and New Report are ⌘K actions
  (`src/shared/search/actions.js`). A tab the reader cannot open is not offered.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Home · Overview (`overview`) | Greeting with the first name, and the date (Operations adds the clocked-in count); the four KPI cards with Choose Cards; the main chart (Operations: Attendance, 14 Working Days, with "Dips are Saturdays, a half day" on desktop, and the On Time donut "37 on time, 4 late, 7 absent this month"; CEO: Organisational Goals and the Org KPI donut with its per-department figures; Partnerships: Monthly Signed Value; Staff: the day strip Shift Today, Clock-In, Worksite, Status, Hours Today); Need You (empty: "Nothing Needs You"); Partnership Pipeline with "4 with no contact in 30 days" on desktop; Goals This Quarter; Activity Today; Your Week; Staff: My Goals This Quarter and Upcoming Leave with the year's balance ("12 days left this year") and View All to My Leave; Export (toast "Export queued. It arrives by email."); New, a menu of New Task, Request Leave, New Rule, New Report as the reader holds them | None | How cards are chosen, inherited and pruned: §6 Cards. Why each role's Overview leans on its own work: §6 Overview. How the CEO rollup is built, where staff goals and leave are set: §6. That figures equal My Attendance: §3 step 2. Saturday hours: §11 |
| Choose Cards (picker) | Title "Choose Cards"; each card the reader may see with its title, a Locked pill on locked ones, a tick on the chosen; Move Up and Move Down on each chosen card; the count "3 of 4"; Cancel, Use Role Default, Save Cards; field error "Pick up to 4 cards" | None | Resolution order, eligibility, why a card is missing: §6 Cards |
| Home · Team (`team`) | The scope (The Whole Organisation, Your Team, or Just You); Present Today, On Site, Remote, Flags; Department (all departments, or one) and the status chips (Everyone, On Site, Remote, Late, Not In, On Leave, No Clock-Out Yesterday); the Team Roster with Search People: employee, department, today's status pill (Day Off on a day not worked) with No Clock-Out Yesterday beside it, Clock-In, KPI, Open Tasks; empty: "Nobody Matches", "Try another status, department or search."; Attendance This Month by person: On Time (out of the days expected), Late, Absent, On Leave. A card opens its records; a row opens the person: Job Title, Department, Today, Clock-In, Clock-Out, Worksite, KPI, Open Tasks, with View Attendance and Open Profile for a reader who may open those screens | None | Where the roster's figures come from and that they match My Attendance: §3 step 2, §6. Who the viewer may see: §6 Scope, §8 |
| Home · Alerts (`alerts`) | Open Alerts, Needs You, Overdue 7 Days +, Cleared This Week; the category chips; the Open Alerts list: alert, trigger, Who Can Clear, age, Over By ("+1" or "12 days left"), severity; Alert Sources, 30 Days (desktop). View Dismissed (the dismissed list, with View Open to go back). A row opens the alert: Trigger, Who Can Clear, Age, Over By, Severity; Close, Edit Rule (`alerts.manage`), Dismiss Alert, Clear Alert (when the reader may clear it); toasts "Alert cleared", "Alert dismissed". Alert Rules (each rule with its switch; switching off asks "Switch Off Rule" with "Its open alerts are dismissed."; Cancel, Switch Off). New Rule (Rule Name, Metric, Threshold, Window Days for a metric counted over days, Severity, Who Can Clear; Cancel, Create Rule; toast "Rule created"); Edit Rule (the same fields but Metric; Save Rule) | Help term on the Over By column header, and on each phone card's Over By label: "How far the alert is past its rule: +1 over 3 is one more than the 3 allowed. A deadline alert shows the days left instead." | That alerts are not notifications, escalation to the CEO, the two checks on clearing, the audit entry: §3 steps 5 and 6, §6 Alerts. Rules being numbers, not code: §4, §6. A new rule's first run: §6, §7 |
| Home · Reports (`reports`) | Scheduled, Paused, Runs This Month, Recipients; a card per report the reader may see (name, source, schedule, status pill Scheduled, Paused or On Demand, audience) with Run Now, and for its owner Pause Report or Resume Report, Edit Report, Archive Report; Recent Runs: number, report, run, recipient, format, status (Pending, Failed, Skipped, or Download once done); New Report, a form in three steps: Report (Report Name, Source, its filters, Share With Managers), Schedule (Repeats, Days, Start Date, Time; or On Demand), Delivery (Recipients, Formats); Create Report. Run Now asks the format when the report has both; toast "RPT-0215 queued" | None | Generation as the recipient, skipped runs, sources being the screens' own queries, email delivery, who may open a file, what Paused means: §3 step 7, §4, §6 Reports |
| KPI detail (the report model) | The card's title, the summary line ("22 of 25 clocked in across the organisation"), the group chips with their counts (Clocked In Today: On Site, Remote, Late, Not In, On Leave, No Clock-Out Yesterday), the paged list, the page count; empty: "Nothing Behind This" | None | Paging at 25: §5. Scope: §6 |
| Gated tab (Team, Alerts, Reports) | The page title, the Locked illustration, "For Managers" and one line, "This tab is for managers and the CEO." | None | Which capability opens which tab: §8 |
| Clock-in prompt | Owned by Attendance: the attendance guide's §10 | The attendance guide's §10 | When Home opens it: §6 Overview |
| Attendance figures on Overview and Team | The clocked-in count, the On Time donut and the roster statuses, as in the rows above | None | That the figures are read from the shared roster and always equal My Attendance: §3 step 2, §6 |

The demo's Viewing As switcher is a demo device for showing each role; the real Home resolves the
role from the signed-in employee (§6).

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Home · Overview (`overview`) | The greeting and New, the four KPI cards two to a row, then the role's main chart. Staff: the day strip (Shift Today, Clock-In, Status) before the KPI cards | Export; the date line and the chart captions; Staff: Worksite and Hours Today in the day strip | New, in the floating button's fan; Choose Cards in the page menu; a KPI card opens its records as a bottom sheet | Bottom bar Home; the four tabs along the top |
| Choose Cards (picker) | A bottom sheet: the chosen cards in order with Move Up and Move Down, then the other cards | The count | Save Cards, full width at the foot of the sheet | The sheet closes back to the Overview |
| Home · Team (`team`) | The four KPI cards two to a row, the status chips, then the roster as person cards: avatar, name and department, a status pill, Clock-In and KPI; then Attendance This Month as person cards (On Time, Late, Absent) | The scope line; the Department filter; the Department and Open Tasks columns (department shows under the name; open tasks in the person's sheet); On Leave in Attendance This Month | Tap a person card or a KPI card: a bottom sheet; View Attendance and Open Profile full width at the foot of the person's sheet | Bottom bar Home; the four tabs along the top |
| Home · Alerts (`alerts`) | View Dismissed, Alert Rules, New Rule; the four KPI cards two to a row; the category chips; alert cards with a severity pill, Who Can Clear and Over By (a help term: a tap opens it as a sheet) | Alert Sources, 30 Days; the Trigger and Age columns (both in the alert's sheet) | Clear Alert, full width at the foot of the alert's sheet; New Rule opens the rule form as a sheet | Bottom bar Home; the four tabs along the top |
| Home · Reports (`reports`) | New Report, the four KPI cards two to a row, then the report cards one to a row, then Recent Runs as run cards (report, run, recipient, status) | The Format column of Recent Runs | New Report; Run Now on a report card; a Done run card downloads its file | Bottom bar Home; the four tabs along the top |
| KPI detail (the report model) | A bottom sheet: the title, then the list as cards (the first column as the card title, a status pill, two label and value pairs) | Columns beyond two per card | Close, at the top of the sheet | The sheet closes back to the tab |
| Gated tab (Team, Alerts, Reports) | The Locked illustration, "For Managers" and its line | Nothing else is on it | None | Bottom bar Home; the four tabs along the top |
| Clock-in prompt | Owned by Attendance: the attendance guide's §10 | The attendance guide's §10 | Clock In | The attendance guide's §10 |
| Attendance figures on Overview and Team | As in the Overview and Team rows | As in the Overview and Team rows | As in the Overview and Team rows | As in the Overview and Team rows |

The phone shell itself (the top bar with search, the bell and the avatar; the bottom bar; More; the
floating button with Clock In or Out; sheets) is the frontend foundation's (AJ, FRONTEND_GUIDE §7,
§9.2); Home builds its phone layout on it, with less text and more icons than desktop (kickoff,
01:19 to 01:21). The picker is a `packages/ui` component (`npm run new:component`), worded Move Up
and Move Down rather than bare arrows.

## 11 · Edge cases

- **Production starts empty.** Until the modules Home reads are built and used, production shows
  every card at 0 and every list at its empty state, and null sections are not drawn, so Home does
  not look broken on day one. Nothing is seeded on production.
- **Staging shows figures.** The Home staging seed (`seeds/staging/60_home.js`) writes Home's own
  rules, alerts and reports through Home's services, attendance punches for the real staff, and rows
  in the forward modules' tables by SQL with fixed ids listed in one exported manifest
  (`HOME_STAGING_ROWS`), so the milestone that builds each table deletes exactly those rows when its
  own seed lands. Real people only; running it twice changes nothing.
- **A hidden M2 card** (Goals On Track, My Targets, Payroll In Progress) is never offered or
  computed; the Home view's fifth or sixth default takes its place, and with nothing else eligible
  the row shrinks.
- **A reader who may not open Partnerships** gets a null pipeline and no pipeline card, rather
  than an empty one. A Head of Department whose team owns no partner (one outside Partnerships)
  sees the pipeline's empty state; their role's own cards (`role_kpi`, §6) can lead with their
  own work instead of the partnership cards.
- **The first session of the day.** The clock-in prompt opens once, when the first session the
  person signs in with on a working day opens Home · Overview; closing it ends it for the day, a
  second device that day does not prompt, and nobody on approved leave is prompted. A first
  session that signs in through a link to another screen and never opens the Overview is not
  prompted that day; the top bar's Clock In and the floating button still open the panel.
- **A report skipped.** A recipient who has left, been suspended, or lost the source's grant or
  `home.reports` since the schedule was saved gets a `skipped` run, no file and no email; the other
  recipients get theirs. A report whose owner has left keeps running for its recipients until an
  owner or the CEO archives it.
- **A failed file.** A PDF that cannot be rendered is retried by the render job and then marked
  `failed`; its run shows Failed and offers no download.
- **Deadline alerts.** A document, confirmation or contract date inside the rule's days raises an
  alert reading "N days left"; a date already passed reads Expired until someone clears it.
- **A gated tab**: opening Team, Alerts or Reports without its capability shows the gated state
  (§10.1), not an empty screen or an error; ⌘K does not offer it.
- **A KPI with nothing behind it**: the records open to their empty state, not a blank modal.
- **A huge list**: everything pages at 25, including the records behind a card, the Team roster,
  Attendance This Month, the alert and rule lists, the reports and Recent Runs.
- **Timezone and Saturday**: every day boundary is Lagos; Saturday runs 09:00 to 15:00 and reads
  lower by design.
- **Double submit**: clearing a closed alert, saving the same cards, or pressing Run Now twice with
  the same key does nothing twice: no second audit entry and no second file.
- **Several roles**: cards follow the highest-ranked roles first, locks from every role lead; the
  Home view is the highest-ranked role's.
- **Money in another currency** in a forward table is left out of Naira sums (§13).

## 12 · Donor code

Reuse is recorded once, in `docs/MyCity-ERP-Documents/REUSE_MAP.md`; the rows below name the map's
rows, and nothing in the code says where anything came from.

| From | File | Change on the way in |
|---|---|---|
| REUSE_MAP §2.1, the KPI catalogue row | the catalogue pattern: assembly and self-check, eligibility, query guards, its shared vocabulary and the resolution of a person's cards | `src/modules/dashboard/kpi-catalog/{index, eligibility, guards, shared, resolve}.js`. MyCity's cards only (the catalogue's KPIs for modules MyCity has no part of are not taken); scope through `scopeClause`; today from `shared/time/lagos`; money as wire strings; a failing query logs and leaves its card out |
| REUSE_MAP §2.1, the human capital tiles row | six cards | `kpi-catalog/tiles/people.js`: `headcount`, `attendance_today` (reads the shared roster), `leave_pending`, `vacancies_open` (through the vacancies source), `attrition_90d`; `kpi-catalog/tiles/finance.js`: `payroll_run_state` (hidden until M6) |
| REUSE_MAP §2.1, the dashboard service row | band assembly and role configuration | `dashboard.service.js` and `dashboard.layout.js`; a person's own pick in `home_kpi_pick` |
| REUSE_MAP §2.1, the client dashboard row | band layout, the card picker, locked cards | the picker as a `packages/ui` component; the screens in `app/src/features/home/` |
| REUSE_MAP §3.2, the per-role KPI configuration row | a role's defaults and locks | `role_kpi`, landed in M1 Home by the owner's decision (O5), without the scope list; edited on Settings · Roles in M9 |
| REUSE_MAP §8, the zero-data 360 row | rendering for a brand-new organisation | every figure 0, every list empty, every section the reader has nothing for null |
| REUSE_MAP §4, the letter generation row | generating a document from a template | `documents.generate` with the `report` template for PDF; XLSX through `shared/spreadsheet`; schedules as recurrence rules, not cron |
| new | the alert rules on the shared alert engine, the metric registry and sweeps; the reports engine (sources, runs, numbering, generation as the recipient); the shared attendance roster; the source adapters | Built here |

## 13 · Open questions

- **Role card editor.** The routes are in M1; the Settings · Roles screen for them is M9 (GE). Until
  then a role's cards are its Home view's defaults.
- **Goals On Track.** What makes a goal on track (progress against the share of its period gone) is
  M2's to define (AJ); the card and My Targets stay hidden until then.
- **KPI scores.** A goal's progress and every departmental KPI score are M2's to define (AJ). Until
  then the CEO's Org KPI lists each active department with no score, and goal progress is empty.
- **Field status.** The roster has no field status until LA's field assignments land; Clocked In
  Today and Team show On Site and Remote only.
- **Reporting line as recipients.** Sending a report to "each person's line manager" was dropped in
  M1: recipients are chosen people. TB to decide whether it returns.
- **The CTO's view.** The kickoff asked for the CTO's Home to show the health of the whole
  application; in M1 the CTO gets the Operations Overview. Not modelled; TB to decide.
- **Currency.** `shared/money` is Naira only, so sums over forward tables count `NGN` rows and leave
  other currencies out. Owner to decide whether such sums group by currency when M7 and M8 land.

## 14 · Change log

- 14/10/2026 · GE · Alert tables aligned with the shared alert engine (`src/shared/alerts/alerts.js`): primary keys named `<table>_id`, `permission_key` written `<module>.<action>`, and `last_seen_at`, `escalated_at`, `outcome`, `note` added. No screen behaviour changed.
- 13/10/2026 · TB · First draft for the real build. Written from the 02/09 discovery call and the
  two 12/10 meetings (kickoff and module demos), with attendance read from the shared roster per the
  13/10 review. Covers the four tabs (Overview, Team, Alerts, Reports), role-sensitivity, the alert
  and report engines, and the Team tab now ratified into MILESTONES §18 as row #86.
- 14/10/2026 · TB · §10 rewritten to the template's content tiers and phone layout tables, from the
  demo as rebuilt to the screen conventions (FRONTEND_GUIDE §5, §7): the "How the team view reads",
  "Alerts are not notifications" and "How a report is built" cards, captions and footnotes left the
  screen, Over By became a help term, and the facts they carried that were missing here were added
  to §6. §6 and §11 now point at help terms and §10 instead of an ⓘ button.
- 15/10/2026 · AJ · Four tabs built in `app/` against the mock API; not wired yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: the three explainer cards are gone (as in the demo), card help is a help term on the title, KPI and card titles are Title Case, Team and Alerts subtitles shortened.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): the phone shell Home sits in is built (top bar with search, the bell and the avatar; the bottom bar, More and the floating button); Clock In or Out is in the floating button on a phone. No Home screen changed.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): the report model behind every KPI card is now `KpiDetail` from `@mycity/ui` (the same summary line, group chips with their counts, search past a screenful, and the records paged at 25); the role's chart and donut are the shared `AreaChart` and `DonutChart`, each its own lazy chunk; the bars and the activity trail go through one mapping from the wire's shape (`features/shared/wire.ts`). §10 and §3 step 3 are unchanged: the cards open the same records.
- 17/10/2026 · TB · Rewritten to the owner's twelve answers before the build: backend modules `dashboard`, `alerts`, `reports` with contracts `dashboard.js`, `alerts.js`, `reports.js`; tabs gated by the capabilities `home.team`, `home.reports`, `alerts.manage` (was `home.alerts.manage`) and `alerts.clear`, with a gated state; the KPI catalogue with per-role cards (`role_kpi`), a personal card picker and the prune; forward data through source adapters each milestone updates; the shared attendance roster and its statuses; alerts from daily sweeps and the punch signal, deadline metrics, both checks on clearing, View Dismissed; reports kept on `saved_report` and `report_schedule` with numbered runs (`home_report_run`), recurrence schedules, generation as the recipient, PDF and XLSX through the vault and email, Run Now answering a pending run, and the Overview Export; the clock-in prompt's trigger moved to Home; 1099's alert thresholds moved out; tagged staging rows; §4, §5, §7, §10, §11, §12 and §13 rewritten to match.
- 17/10/2026 · TB · KPI catalogue and source adapters built (`src/modules/dashboard/kpi-catalog`, `src/modules/dashboard/sources`): 29 cards, 26 live; the Team cards take the `home` scope; each card's word limits, module and capability checked at require time; the records behind every card paged at 25.
- 17/10/2026 · TB · Review fixes before PR 1: `alerts.raise` stores `subject_employee_id`; Documents Requested reads the documents module's own open-request rule; the roster's lateness counts punches in review and No Clock-Out Yesterday reads the last working day (§6, as attendance.md §6); index requests on later milestones' tables are in each owner's Owes; the New Report steps are Report, Schedule and Delivery (§10.1); §12 names the finance tiles file.
- 18/10/2026 · TB · Merged with Attendance's clock-in and clock-out (LA): the shared roster now reads each day's record as Attendance writes it and the register's rules for a day with no record, instead of re-deciding the day from the punches. Remote is the work pattern (a hybrid or unassigned person who clocks in is on site), lateness is Attendance's (whole minutes past the start plus grace, the organisation's policy when a person has none), a punch People rejected no longer counts, `absent` joins the statuses, and My Attendance on Home counts the days Attendance has recorded. `1150` no longer adds `attendance_event (occurred_at)`. The clock-in prompt counts a clock-in in review, as Attendance does, and the panel punches through Attendance's route. §3, §4, §4.1 and §6 follow.
- 18/10/2026 · TB · Overview backend built (`src/modules/dashboard`): `GET /home/overview` with each Home view's sections (`dashboard.layout.js`), Activity Today's allow-list (`dashboard.activity.js`), the alerts beside Need You and the clock-in prompt (`dashboard.prompt.js`); the card picker, a role's cards and the records behind a card; the prune after an access change; `cards.mine` and ⌘K's `home_kpi`. §2, §6, §9 and §11 now say which view draws which section, what Activity Today allows, how the prompt reads Attendance, and what a Head of Department outside Partnerships sees.
- 18/10/2026 · TB · Overview screen on the real API (`app/src/features/home`): drawn from the contract's typed `HomeOverview`, with the greeting and date line, the role's cards two to a row on a phone, each view's chart, donut and sections, Need You from `GET /workflow/mine` with the alerts the reader may clear, Activity Today worded on the screen from its event keys, Your Week, and the Staff day strip first. Every card opens its records through `KpiDetail`, whose All chip now counts the server's total (the groups can overlap); `?kpi=` and `?id=` open a card's records. Choose Cards sits on the card row (the page menu on a phone) with Use Role Default; New is a menu of the create actions the reader holds on screens that are open; the Overview opens Attendance's clock-in panel once when `prompt_clock_in` says so, and the shell's after-sign-in opener is gone. The server-written notes and captions are off the screen, and the day strip's Where is Worksite, since a title may not start with Where (§10.1, §10.2). Export arrives with Reports.
- 18/10/2026 · TB · Review fixes to the Overview: Your Week reads each working day's own page of events and tasks, so a busy week keeps its later days (§6); a role saved with no default has no row and follows its Home view, as DELETE does (§5, §6); Choose Cards starts from the cards showing, so a card locked after the pick is in the draft and saves (§6); the Overview reads itself again after the reader's punch and on `attendance.updated` (§3 step 2); Monthly Signed Value reads the whole year, as the Signed Value card does, so its months add up to the card (§6); Upcoming Leave has View All to My Leave, and §5 says which embedded lists have a paged home and which are their first 25 in M1 (§10.1); the clock-in prompt opens when the first session of a working day opens the Overview (§3 step 1, §11, attendance.md); §4.1 and §13 say the CEO's Org KPI is drawn with no score until M2.
- 18/10/2026 · TB · Team backend built (`src/modules/dashboard/dashboard.team.js`): `GET /home/team/summary`, `/home/team` and `/home/team/attendance` behind `home` view and `home.team`, in the grant's scope (`own` included, for someone given the capability alone); the four cards read the roster once per request; Flags now counts the people late or with no clock-out yesterday once each, so it equals the records it opens, which list both; Attendance This Month is My Attendance's figures per person from the 1st to today, from the roster's new `month()` in one paged query; `team.today` for the assistant, empty without the capability, and a route to the tab. §4.1, §5, §6 Team and §9 follow.
- 18/10/2026 · TB · Team screen on the real API (`app/src/features/home/Team.tsx`): the scope line, the four Team cards (two to a row on a phone) opening their records through `KpiDetail`, Department (desktop) and the status chips, the Team Roster searched, filtered and sorted by the server, a person's sheet with View Attendance and Open Profile for a reader who may open them, and Attendance This Month paged at 25. The gated state is live: Home's four tabs stay in place for every Home viewer (`app/src/shell/access.ts`), and Team, Alerts or Reports opened without its capability shows the lock and reads nothing (`app/src/features/home/access.ts`, `Gated.tsx`); ⌘K still offers only the tabs a reader may use. §2, §10.1 and §10.2 say what Team shows on each shell.

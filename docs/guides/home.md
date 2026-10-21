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
| Last changed | 21/10/2026 |

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
| Home · Overview (`overview`) | staff app | every employee, resolved for their role | four KPI cards, Need You, Activity Today and Your Week; Operations, CEO and Partnerships also the role's main chart (and donut), the Partnership Pipeline and Goals This Quarter (on the CEO's the goals are the chart); Staff instead the day strip, My Goals This Quarter and Upcoming Leave | open a card's records; choose their own cards; Export the Overview; New (a menu of what they may create); Add Work Site (attendance.md §6.11): a sheet to add a temporary site for themselves and colleagues, sent to People for approval |
| Choose Cards (picker) | Overview, from the KPI row (a page menu item on a phone) | every employee | the cards they may see, the ones on their Overview in order, the ones their roles lock | add, remove and reorder up to four cards; go back to their roles' cards |
| Home · Team (`team`) | staff app | holders of `home.team`; everyone else sees the gated state | today's roster for the people in their `home` scope (status, Clock-In, KPI, open tasks), four team cards, Attendance This Month | filter by department and status; search the roster; open a card's records; open a person, and from them People · Attendance or their profile when the reader may open those |
| Home · Alerts (`alerts`) | staff app | holders of `alerts.clear` or `alerts.manage`; everyone else sees the gated state | open alerts of the rules they may clear, about people in their scope, with severity, age and Over By; the counts; View Dismissed | clear or dismiss an alert (`alerts.clear`); see, create, change and switch off rules (`alerts.manage`) |
| Home · Reports (`reports`) | staff app | holders of `home.reports`; everyone else sees the gated state | their own reports and the shared ones whose source they may open, with schedule, status and audience; Recent Runs | build a report, schedule it, pause or resume it, run it now, download a finished run, archive it |
| KPI detail (the report model) | any KPI card, Overview and Team | the scope the card was computed in | the paged records behind the number, with its groups | page at 25; filter by group; open a record |
| Gated tab | Team, Alerts or Reports without the capability | every `home` viewer who lacks it | the page title, the Locked illustration, "For Managers" and one line | nothing; the tab is listed so the four tabs stay in place |
| Clock-in prompt | Attendance's, opened by the shell on whatever screen comes first (attendance.md §6.14) | the signed-in employee, on the first session of a working day | Attendance's clock-in panel | clock in, or Not Now |
| Settings · Roles (role cards) | Settings, M9 | `settings` view and edit | a role's default cards and locks | set or clear them (routes in M1, the screen in M9) |

Home renders but does not own the attendance, partnership, approval, recruitment and task figures
it shows; it reads them live from the owning modules (§3, §4). It owns the alert rules and alerts,
the saved reports, their schedules and runs, the per-role cards and each person's own pick.

## 3 · How the screens relate

1. **Sign-in → Home, and the clock-in prompt.** An employee signs in and lands on Home · Overview,
   resolved for their role (a sign-in through a link to another screen lands on that screen). The
   clock-in prompt is Attendance's (attendance.md §6.14, owner decision of 19/10/2026 in place of
   O12): on the first session of a working day the shell opens Attendance's clock-in panel over a
   blurred screen, on whatever screen comes first, Home or not. Home reads nothing for it. The
   punch itself is Attendance's write (`POST /api/v1/attendance/punches`, LA).
2. **A clock-in reflects on Home.** A punch commits through Attendance, which records it and
   recalculates the person's day (`attendance_day`). Clocked In Today, the Operations chart, the
   Team roster and the Staff day strip all read the shared attendance roster
   (`src/modules/attendance/attendance.roster.js`), which reads that day's record the way People ·
   Attendance and My Attendance read it, so they move with it, no copy and no second source, and
   always equal those screens; the day strip's Shift Today and Your Week read the reader's own work
   schedule (`attendance.schedule.js` `dayOn`, attendance.md §6.13). An Overview on screen reads
   itself again when the reader's own state today changes (after a punch from the panel, at once)
   and on `attendance.updated` (a punch in their People scope, a burst of them read once).
   Attendance's alerts are the Attendance policy's breaches (step 5): Home reads no attendance
   signal of its own.
3. **A KPI card → its records.** Clicking a card opens the records behind the number
   (`GET /api/v1/home/kpi/:key/meta` for its title, summary line, columns and groups, then
   `GET /api/v1/home/kpi/:key`, paged at 25). Clocked In Today breaks down into On Site, Remote,
   Field, Late, Not In, On Leave and No Clock-Out Yesterday (module demos, 01:27 to 01:28). A card the
   reader may not see answers 404, never 403.
4. **Choosing cards.** Choose Cards reads `GET /api/v1/home/kpi-picker` (only the cards the reader
   may see), and Save Cards writes the order with `PUT /api/v1/home/kpi-picks`; Use Role Default
   deletes the pick (`DELETE /api/v1/home/kpi-picks`). A role's own defaults and locks are set
   with `PUT /api/v1/home/roles/:role_id/kpis` (Settings, M9). When a role loses a grant, a
   capability or sight of a field (`permission.changed`, `capability.changed`,
   `field_visibility.changed`), an outbox handler takes the cards it can no longer see out of
   `role_kpi`; a person's own pick is filtered the same way each time it is read.
5. **A threshold breach → an alert.** Time-based metrics are swept once a day at 06:00 Lagos
   (`home-alert-sweeps`): for each switched-on rule the sweep reads its metric's breaches
   (`src/modules/alerts/alerts.metrics.js`) and raises, refreshes or leaves an alert for each
   subject through the shared alert engine (`src/shared/alerts/alerts.js`). Attendance's alerts
   come from the Attendance policy instead (TB, 20/10/2026; attendance.md §6.16): a breach of one of
   its rules is recorded with the punch, decision or day-close that crossed it, and after commit
   Attendance raises its alert through `alerts.service.raisePolicyBreach` on a rule the system keeps
   for that policy rule (metric `attendance_policy`), never read by the sweep. An alert appears on Home · Alerts, and the holders of the rule's grant
   over the person it is about, never that person, are notified (`home.alert_raised`). A High alert left open 14 days is escalated to the CEO
   (`home.alert_escalated`, the hourly `alert-ageing` job). An alert is not a notification
   (MILESTONES §18.1): a notification is read once, an alert ages until someone clears it.
6. **Clearing.** A person who holds `alerts.clear` and whose grant on the rule's `permission_key`
   reaches the alert's subject clears or dismisses it (`POST /api/v1/home/alerts/:id/clear`),
   which writes the audit entry (`home.alert_cleared`). Nobody but the CEO sees or clears an alert
   about themselves. Switching a rule off dismisses its open alerts as the rule change itself
   (`PATCH /api/v1/home/alert-rules/:id`, in the same transaction).
7. **A report → the recipient's inbox.** A manager builds a report on Home · Reports and schedules
   it (Daily Attendance, every working day at 18:00). Every five minutes `scheduled-reports` finds
   the schedules that are due and creates one numbered run per recipient and format for the slot
   (`home.report_run`). The outbox handler `reports.generate` builds each file **as its recipient**
   (their grants, scope and masked fields), as a PDF through `documents.generate` (rendered by the
   `pdf-render` job) or an XLSX through `shared/spreadsheet` and the vault, and the file is emailed
   only once it exists. Run Now does the same for the caller, at once, and answers the pending run
   (202); pressing it again while that run waits answers the same run. Its file is never emailed:
   the screen waits on the run and downloads the file on the device that pressed
   (`docs/guides/foundation.md` §6.12). Recent Runs shows it Pending until its file is there.
8. **Overview Export.** Export on the Overview is a run of the reader's own Overview through the
   same engine (`POST /api/v1/home/overview/export`): numbered, vaulted, and downloaded on the
   device that pressed once it is made; the screen waits on the run through
   `GET /api/v1/home/overview/export/:id`, open to every Home reader as the Export is.
9. **The dashboard is wired last.** On production Home shows zero and empty lists until the modules
   it reads are built and used; on staging the Home seed writes tagged rows into those modules'
   tables so every card has figures (§11). This is a build-order note, not a runtime mode.

10. **Add Work Site** (attendance's PR 4, attendance.md §6.11). Beside New, and as an entry in it,
    Add Work Site opens Attendance's temporary site sheet over the Overview: Hours (Usual Shift or
    Site Hours with a start and an end, attendance.md §6.11), Purpose, Name, Addresses,
    First Day, Last Day, People (the reader and colleagues, from `GET /community/people`, open to all
    staff), Description, Submit for Approval (`POST /attendance/me/temporary-sites`). Home owns the
    button only: the sheet, the site and its approval are Attendance's. A present day on an approved
    site reads Field on the roster, a Temporary Home Remote (§6 Team).

## 4 · Data

Home owns the tables below. It keeps no copy of the figures it displays: those are read live from
the owning modules, scoped by the reader's grants.

| Table | Key columns | Notes |
|---|---|---|
| `home_alert_rule` | `home_alert_rule_id`, `key`, `name`, `metric`, `threshold`, `window_days`, `severity`, `permission_key`, `enabled`, `created_by`, `updated_by` | A rule is data, not code: a number changes with no deploy. `key` is made by the server, `<metric>.<slug of the name>`, with a number on the end when taken. `metric` is a key of the metric registry (§6). `permission_key` is who may clear its alerts, `<module>.<action>` from the access catalogue. Rules are switched off, never deleted. `name`, `created_by`, `updated_by` came with `1150`; rules written before it took their key as their name |
| `home_alert` | `home_alert_id`, `home_alert_rule_id`, `subject_type`, `subject_id`, `subject_employee_id`, `title`, `trigger`, `severity`, `over_by`, `due_on`, `raised_at`, `last_seen_at`, `escalated_at`, `cleared_at`, `cleared_by`, `outcome`, `note` | One open alert per rule and subject. `subject_employee_id` (`1150`) is the person it is about, null when it is about no one in particular (a budget, a partner). `over_by` (`numeric(18,2)`, `1100`) is how far past the threshold, or the days left for a deadline metric (0 on the day, below 0 once the date has passed). `due_on` (`1151`) is the date a deadline alert is about, null for a count metric: a person who cleared it dealt with that date. `outcome` is `cleared` or `dismissed`; a rule switched off dismisses its open alerts with `cleared_by` empty and the note "Rule switched off" (the audit entry names who switched it off). Written only by the shared alert engine (BACKEND_STRUCTURE §11.1) |
| `saved_report` | `saved_report_id`, `owner_user_id`, `name`, `report_key`, `definition`, `shared`, `archived_at` | A report. `report_key` is its source (§6); `definition` holds its filters (`{ filters }`); `name` is unique per owner, case aside. A report with runs is archived (`archived_at`, `1150`), never deleted; archiving stops its schedule. A person's own Overview Export report (source `overview`) is made the first time they export and is never listed; a name its owner gives another report wins, and it takes the next free one ("Overview 2") |
| `report_schedule` | `report_schedule_id`, `saved_report_id`, `recurrence`, `starts_on`, `run_time`, `timezone`, `formats`, `recipient_user_ids`, `recipients`, `active`, `last_run_at`, `next_run_at` | One per report (unique index, `1150`); removed when the report goes back to on demand. `recurrence` is a rule of `src/shared/time/recurrence.js` counted from `starts_on`, fired at `run_time` in `timezone` (always Africa/Lagos); never cron. `formats` is `pdf`, `xlsx` or both. Recipients are logins (`recipient_user_ids`); `recipients` keeps their addresses as written, for display. `active` false is Paused, with no `next_run_at`; `last_run_at` is the last slot fired |
| `home_report_run` | `home_report_run_id`, `number`, `saved_report_id`, `report_schedule_id`, `scheduled_for`, `recipient_user_id`, `requested_by`, `format`, `status`, `document_id`, `emailed_at`, `error`, `run_at`, `finished_at` | One generated file: one report, one recipient, one format. `number` from `numbering.allocate(client, "report_run")` (RPT-0001, never reset). `status` is `pending`, `done`, `failed` or `skipped`, and `error` says why a run failed or was skipped. A scheduled run names its schedule and slot, and a slot is generated once per recipient and format (unique index); a run on demand has neither. `document_id` is the vaulted file once it is made (a PDF's while it renders, so the run stays `pending`); `emailed_at` is when a schedule's file was handed to the mailer (a run on demand is never emailed); `run_at` is when the run was made, the order of Recent Runs; `finished_at` when it settled |
| `role_kpi` | `role_kpi_id`, `role_id`, `default_ids`, `locked_ids`, `updated_by` | A role's cards: up to four defaults in order, and the locked ones (always among the defaults). No row: the role follows its Home view's defaults. Removed with its role |
| `home_kpi_pick` | `home_kpi_pick_id`, `user_id`, `kpi_ids` | A person's own cards, up to four, in order. No row: they follow their roles. An empty list: they chose to see none |

A card id in `role_kpi` and `home_kpi_pick` is a key of the KPI catalogue
(`src/modules/dashboard/kpi-catalog`), which is code, so there is no foreign key: the service
checks every id, and an id the catalogue no longer has is ignored when read.

Schema migration files: `migrations/1000_core_operations.sql` (the tables), `1100_home_alert_columns.sql`,
`1150_home_foundation.sql` (everything above that is not in 1000 or 1151, plus the index Activity
Today needs on an M1 table, `event_log (occurred_at)`; the roster reads through the attendance
module's own indexes) and `1151_home_alert_due_on.sql` (`home_alert.due_on`).
Reference data: `seeds/reference/1199_seed_home.sql` (the capabilities and their default roles,
the `report_run` numbering scheme, and the removal of 1099's three alert thresholds, A26). Home
claims 1150 to 1159 and 1199 in the M1 block. No `role_kpi` row is seeded: a role's cards are a business
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
| `vacancies.source.js` | vacancies and candidates · M4 · TB | `vacancy`: open vacancies; `application`, `candidate`: applications left at one stage too long (Recruitment SLA alerts) |
| `payroll.source.js` | payroll · M6 · LA | nothing yet: Payroll In Progress is hidden and has no query until M6 creates its tables |
| `partners.source.js` | partners and pipeline · M7 · GE | `partner`, `partner_interaction`, `partnership_opportunity`, `partnership_agreement`, `partnership_proposal`: pipeline, signed value, quiet partners (and Partner Inactivity alerts), proposals out |
| `expenses.source.js` | expenses · M8 · AJ | `expense_request` and `expense_category`: awaiting approval, with each request's category |
| `budgets.source.js` | budgets · M8 · AJ | `budget`, `budget_line`: budget used, and the budgets past a share spent (Budget Threshold alerts) |

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

The one exception is the alert metrics (§6 Alerts). `src/modules/alerts/alerts.metrics.js` reads
`workflow_instance` and `workflow_definition` (Approval Ageing), `document` (Document Expiry) and
`employee` (Confirmation Due, Contract Ending) in its own SQL (it no longer reads `attendance_day` or
`attendance_exception`: attendance's alerts are the Attendance policy's breaches, raised by
Attendance, §6 Alerts), under each owning module's own conditions and
a batch at a time, so a sweep loads breaches rather than every record. It is the one other reader
of those tables, coupled to them the way an adapter is to its milestone's tables: each entry names
its owning module, and **the module that changes what an entry reads updates that entry in the
same PR** (the file's header and attendance.md §6.9 say so; `tests/integration/home-alerts.test.js`
raises each from real rows). DATABASE_SCHEMA's notes on those tables name the metric that reads them.

## 5 · API

All three routers mount at `/api/v1/home` (`basePath: "/home"`); a literal path (`/summary`,
`/meta`) is defined before the `/:id` beside it. Contracts are `packages/contract/schemas/dashboard.js`,
`alerts.js` and `reports.js`, `snake_case`, every name prefixed `Home`.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/home/overview` | → `HomeOverview` | `home` view · each section in the reader's scope for its module | n/a | Typed sections, null when the reader has none (§6). Each embedded list holds at most 25. Need You is its own paged list (`GET /workflow/mine`); Upcoming Leave links to ESS · My Leave; Your Week is at most 25 a day; Goals This Quarter, My Goals and Activity Today are their first 25, each row with its link, and have no paged home in M1 |
| `POST /api/v1/home/overview/export` | `HomeReportRunNow` → `HomeReportRun` | `home` view | n/a | The Overview Export: 202, a pending run of the reader's own Overview through the reports service (on the Overview's router); pressing again while it waits answers the same run |
| `GET /api/v1/home/overview/export/:id` | `IdParams` → `HomeReportRun` | `home` view · the reader's own Overview runs | n/a | What the Overview reads while it waits to download its Export's file: Staff hold no `home.reports` for `GET /report-runs/:id`. Anyone else's run, or a run of another report, is a 404 |
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
| `GET /api/v1/home/alerts` | `HomeAlertQuery` → `HomeAlertPage` | `home` view, `alerts.clear` or `alerts.manage` · each rule's module scope over `subject_employee_id`, never the reader's own | yes, 25 | Filters: category, severity, state (open, cleared, dismissed: View Dismissed), mine, overdue, rule, `q` (title or trigger). Open newest first, a closed list most recently closed first; sort by raised or severity. Each row says `can_clear` and Who Can Clear (`who_can_clear`) |
| `GET /api/v1/home/alerts/summary` | → `HomeAlertSummary` | as above | n/a | Open, Needs You, Overdue 7 Days +, Cleared This Week, the category chips, Alert Sources |
| `GET /api/v1/home/alerts/:id` | → `HomeAlert` | as above | n/a | For `?tab=alerts&id=`, in any state; 404 when the reader may not see it |
| `POST /api/v1/home/alerts/:id/clear` | `HomeAlertClear` → `HomeAlert` | `home` view, `alerts.clear`, and the rule's `permission_key` reaching the subject | n/a | `outcome` cleared (default) or dismissed, with a note. An alert the reader may not see is a 404. Clearing a closed alert answers it as it is, with no second audit entry |
| `GET /api/v1/home/alert-rules` | `HomeAlertRuleQuery` → `HomeAlertRulePage` | `home` view, `alerts.manage` | yes, 25 | Filters: metric, category, enabled, `q` (name or key); sort by name (the default) or created. Each rule with its open alerts and Who Can Clear |
| `GET /api/v1/home/alert-rules/policy` | → `HomeAlertPolicyRules` | `home` view, `alerts.manage` | n/a | The Attendance policy's five consequence rules as the version in force today sets them, read only (§6 Alerts); `can_set` for a holder of `policies.manage`. Defined before `/:id` |
| `GET /api/v1/home/alert-rules/:id` | → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Edit Rule from an alert, or from `?tab=alerts&rule=` |
| `POST /api/v1/home/alert-rules` | `HomeAlertRuleCreate` → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Rule Name, Metric, Threshold, Window Days, Severity, Who Can Clear; the key is made by the server. A window only for a metric counted over days, whole days for a deadline, Who Can Clear a grant of the access catalogue (422 on the field otherwise) |
| `PATCH /api/v1/home/alert-rules/:id` | `HomeAlertRuleUpdate` → `HomeAlertRule` | `home` view, `alerts.manage` | n/a | Any field but the metric, held to its metric as on create; `enabled: false` dismisses its open alerts. Saving it unchanged records nothing |
| `GET /api/v1/home/reports` | `HomeReportQuery` → `HomeReportPage` | `home` view, `home.reports` · own, received, and shared ones whose source the reader may open (§6) | yes, 25 | Filters: source (`report_key`), status (scheduled, paused, on demand), archived (only the archived), mine (owned or received), `q` (name); sort by name (the default) or created |
| `GET /api/v1/home/reports/summary` | → `HomeReportSummary` | as above | n/a | Scheduled, Paused, Runs This Month, Recipients |
| `GET /api/v1/home/reports/:id` | → `HomeReport` | as above | n/a | 404 when the reader may not see it |
| `POST /api/v1/home/reports` | `HomeReportCreate` → `HomeReport` | `home` view, `home.reports` | n/a | Name (unique per owner, case aside: 409), a source the creator may open, the filters it takes (a department or leave type that exists), shared, and a schedule or none (on demand); 422 on the field otherwise, naming each recipient refused |
| `PATCH /api/v1/home/reports/:id` | `HomeReportUpdate` → `HomeReport` | `home` view, `home.reports`; its owner or the CEO | n/a | Name, filters, sharing, or the whole schedule (null: on demand). Only recipients the schedule did not already have are checked |
| `PATCH /api/v1/home/reports/:id/schedule` | `HomeReportScheduleState` → `HomeReport` | as above | n/a | Pause or Resume; 409 for a report on demand |
| `POST /api/v1/home/reports/:id/archive` | `EmptyBody` → `HomeReport` | as above | n/a | Archives it and stops its schedule; its runs stay. Archiving again answers it as it is; an archived report neither changes nor runs (409) |
| `POST /api/v1/home/reports/:id/run` | `HomeReportRunNow` → `HomeReportRun` | `home` view, `home.reports`, and the source's grant | n/a | Run Now: 202, one file for the caller in a format its schedule offers (either, on demand), answered `pending` with no `document_id` yet; pressing again while it waits answers the same run. The screen waits on `GET /report-runs/:id` and downloads the file; it is never emailed |
| `GET /api/v1/home/report-runs` | `HomeReportRunQuery` → `HomeReportRunPage` | `home` view, `home.reports` · runs the reader received, and every run of the reports they own; the CEO every run | yes, 25 | Recent Runs, newest first. Filters: report (`saved_report_id`), status, format |
| `GET /api/v1/home/report-runs/:id` | → `HomeReportRun` | as above | n/a | One run on the reader's Recent Runs however old, for `?tab=reports&run=`; 404 when the reader may not see it |

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
  - Staff: the day strip (Shift Today from the reader's own work schedule, `attendance.schedule.js`
    `dayOn`, or a temporary site's own hours on a day of one (attendance.md §6.11), none on a day
    they do not work; and the reader's own row of today's roster: status,
    Clock-In, Clock-Out, the worksite of the clock-in, and Hours Today, the day's worked minutes as
    Attendance counts them, so a System Clock-Out counts only to the shift's end, none until they
    clock out), My Goals This Quarter (their targets due this quarter) and Upcoming Leave. A member of staff's Overview is their own day, so it draws no chart,
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
- **Your Week** is this week's working days of the reader's own schedule, Monday first (the days
  their work schedule, else the company hours, works; a public holiday among them named and given no
  hours): each day's own hours (Saturday 09:00 to 15:00 under the suggested hours),
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
- **Clock-in prompt.** Not the Overview's: Attendance decides it (`AttendanceToday.sign_in_prompt`,
  attendance.md §6.14) and the shell opens it on the first screen, so a sign-in through a link to
  another screen is prompted too. The Overview carries no flag for it.

**Team**

- **The roster** gives one status per person per day: the attendance register's, in Home's words.
  `on_leave` (leave recorded, or granted leave covering the day), `late` (the day's record has late
  minutes: whole minutes past the start plus the policy's grace, counted punches only), `on_site`,
  `remote` or `field` (in on time: field on an approved temporary site's day, a Temporary Home aside,
  or a field assignment's made before attendance's PR 4; else remote for someone whose work pattern
  is remote, who is on an approved Temporary Home, or on an approved remote day made before PR 4), `absent` (a working day the
  day-close closed with no clock-in), `not_in` (a working day not closed, no clock-in yet). Beside
  it, the flag No Clock-Out Yesterday (the person's last working day, so Saturday on a Monday and the
  day before a holiday after one, has a clock-in and no clock-out on its record). attendance.md §6.9
  is the rule's home; the roster decides none of it. Present Today is present out of expected, as
  the register counts them: on a day that is not worked nobody is expected, and a clock-in made on
  it is still present. Absent never shows on today's cards, since the day-close closes only days
  before today.
- **Scope.** Team shows the people in the reader's `home` scope: `all` for Operations & People,
  Implementation, Management and the CEO; `team` (the reader and everyone below them on the solid
  reporting line) for Heads of Department and Line Managers; `own` (the reader alone) for anyone
  else the capability is given to. The capability opens the tab; the grant decides whose rows. The
  summary says which scope it read (`scope`); the screen words it.
- **Team's cards**, today in that scope, each the number of records it opens: Present Today
  (present out of expected; its records are the day's roster, and its On Site, Remote, Field and
  Late chips hold the people it counts), On Site, Remote, and Flags: the people late today or with no
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
  `HomeAlertMetric`, in this order): `approval_ageing` (approval, whole days a pending request has waited at its stage; the alert is
  about the record waiting and the person it is for), `document_expiry` (document, deadline: a
  current document's expiry), `confirmation_due` and `contract_ending` (people, deadline: an active
  employee's dates, as the staff register counts them), `partner_inactivity` (partnership, whole
  days since an active partner's last contact), `budget_threshold` (budget, percent of a running
  Naira budget spent), `recruitment_sla` (recruitment, whole days an application has been at its
  stage). Each also names its subject, the module, milestone and owner of its tables and its
  default Who Can Clear. The four over M0 tables raise real alerts on production in M1; the
  last three read their milestones' tables through the source adapters (§4.1) and find nothing
  until those are used; the four read their owning modules' tables in their own SQL, the one other
  reader of those tables (§4.1), and the owning module updates the entry when it changes them. A
  breach is read in SQL, a batch at a time, so a sweep loads breaches, never the organisation; an
  alert on a partner, a budget or an application is about no one in particular.
- **Attendance's thresholds are the Attendance policy's** (TB, 20/10/2026; `attendance.md` §6.16,
  built in its PR 3). The policy is the one source of every attendance threshold: its five rules
  (Late Arrivals, Early Departure, Absence, Forgotten Clock-Outs, Location Flags), each with its
  Alert switch, raise attendance's alerts through `attendance.rule_breached`, not a Home rule.
  - Each policy rule raises through one Home rule the system keeps: `home_alert_rule` with metric
    `attendance_policy` (the contract's `HOME_ALERT_POLICY_METRIC`, never offered on New Rule) and
    key `attendance_policy.<rule>` (`late_rule`, `early_rule`, `absence_rule`, `forgotten_rule`,
    `location_rule`), made by `alerts.service.raisePolicyBreach` on its first breach: named as the
    policy names the rule, threshold 1 (one breach is one alert), no window, severity medium, Who Can
    Clear People Approvers (`people.approve`). The sweep never reads these rules, Alert Rules never
    lists them for editing, and nobody switches them off: the policy's switches do.
  - The alert's subject is the breach (`attendance_rule_breach`, its id) with `subject_employee_id`
    the person, so a second breach raises its own alert while the first is still open; it opens the
    breach's last day on People · Attendance. Its title says the count ("Ada Obi: 3 late arrivals
    this month"), Query Due first while the query waits on M3; its trigger the days. Its category is
    attendance; it has no Over By.
  - Alert Rules lists the five read only on an Attendance Policy card, as the version in force today
    sets them (`GET /home/alert-rules/policy`, `HomeAlertPolicyRules`): each rule with its figures in
    words ("3 late arrivals in a month or 5 hours", or Off) and whether it alerts and raises a query,
    with Set in Attendance Policy opening the policy for a holder of `policies.manage`. An alert of a
    policy rule offers Set in Attendance Policy in place of Edit Rule.
  - Home's own metrics `late_arrivals` and `missing_clock_out` are gone from the list (New Rule no
    longer offers them); `1445` switched off every rule on them and dismissed its open alerts as the
    rule change ("Rule switched off"); Home's person-signal handler on `attendance.punched` and
    `attendance.day_closed` is gone (§7). A changed threshold applies from its version's first day,
    with no Home rule to change. The other metrics are unchanged.
- **A count metric** breaches when its value reaches the threshold; `over_by` is the value less the
  threshold ("+1 over 3"). A window counts the last W days ("3 late arrivals in 30 days").
- **A deadline metric** breaches when the days left reach the threshold or fewer; its threshold is
  whole days, `over_by` holds the days left, and the screen reads "12 days left". The day itself
  holds 0 and is not yet Expired; a date already passed holds the days since as a negative ("-2.00")
  and reads Expired. The contract's `over_by_kind` says which of the two a row holds.
- **The same breach is raised once.** The sweep sees a breach every morning; while its alert is
  open it is refreshed (Over By, title, trigger, last seen). Once a person clears or dismisses it,
  it is not raised again for the same evidence (the latest late clock-in, the end of the latest
  day with no clock-out whether or not the day-close has reached it, the request's time at its
  stage, the last contact, a deadline's date itself, stored as `due_on`); newer evidence raises a
  new alert, and a deadline whose date changes is new evidence. A rule's alerts dismissed by
  switching it off do not count, so a rule switched back on raises what still breaches.
- **Who sees an alert.** A holder of `alerts.clear` or `alerts.manage` sees the alerts of the rules
  whose `permission_key` they hold, about people within their scope for that module. An alert about
  no one in particular is seen only by holders with `all` scope. Nobody sees an alert about
  themselves, as nobody decides their own request or attendance exception: a manager late three
  times is seen by their own line manager and HR, not by themselves. The CEO sees every alert.
- **Clearing needs both checks**: `alerts.clear` (may clear alerts at all, on the route) and the
  rule's `permission_key` reaching the alert's subject (may clear this one; the shared engine's
  `mayClear` checks the scope too, and refuses an alert about the clearer). The CEO passes both.
  An alert the reader may not see is a 404, whatever they hold. `can_clear` on each row says the
  same, so the screen offers Clear Alert only where it will work.
- **One definition.** Who sees an alert is one condition in `alerts.repo.js`, read by the list, one
  alert, the counts, the Overview's alerts beside Need You, the Open High Alerts card and its
  records, ⌘K and the assistant, so none of them can disagree.
- **Rules.** Created and changed by `alerts.manage` holders. Who Can Clear defaults to the metric's
  own and can be changed; it reads as the grant's holders ("People Approvers"). A rule's key is
  `<metric>.<slug of the name>`, `_2`, `_3` on the end when taken. A new rule is first evaluated at
  the next sweep or signal. Switching a rule off dismisses its open alerts as the rule change (no
  clearing right needed) and raises no more: each raise reads the rule again in its own
  transaction, so a sweep part way through a rule when it is switched off stops raising on it. A
  rule whose metric the registry no longer has is skipped by the sweep.
- **The counts.** Open; Needs You (open alerts the reader may clear: all of Open for a holder of
  `alerts.clear`, none for one who only manages rules); Overdue 7 Days + (open more than seven
  days, any severity); Cleared This Week (outcome `cleared` since Monday, Lagos; a dismissed alert
  is not counted); the category chips (open alerts by category, most first); Alert Sources, 30
  Days (raised in the last 30 days by metric, cleared ones included, most first). View Dismissed
  lists outcome `dismissed`.
- A High alert open 14 days is escalated to the CEO once.

**Reports**

- **The sources** (`src/modules/reports/reports.sources.js`, keys equal to the contract's
  `HOME_REPORT_SOURCES`): `daily_attendance` (today's roster, in the reader's People scope;
  filters department and status), `leave` (People's leave list; status and type), `open_alerts`
  (the open alerts on Home · Alerts, through its one rule of who sees an alert; category and
  severity), `headcount` (the staff register's active staff, as the Headcount card counts them;
  department), `tasks`, `partnerships`, `expenses`, `recruitment` (the records behind Overdue
  Tasks, Active Partnerships, Expenses Awaiting Approval and Open Vacancies, read through their
  milestones' source adapters; empty until those are built and used, and no filters until then),
  and `overview` (the Overview Export, never offered on the form). Each is the module whose
  `view` grant it needs (Open Alerts also one of `alerts.clear` or `alerts.manage`, as its tab)
  plus the same query its screen uses, gathered page by page in the reader's scope and through
  their field mask. A table holds at most 2,000 rows; the file says when it holds the first of
  more.
- **Who sees a report**: its owner; its recipients and, when it is shared, every `home.reports`
  holder, while they may open its source; the CEO every report. Only the owner and the CEO
  change, pause or archive it. Anyone who sees it may run it, for themselves, while they may open
  its source. An archived report is listed only when asked for, and neither changes nor runs.
- **Generation is as the recipient.** Each run is built with the recipient's own grants, scope and
  masked fields, so a file never holds a row they could not open on screen. A recipient who is no
  longer active, no longer holds the source's grant, or (for any source but the Overview) no longer
  holds `home.reports`, gets no file: their run is `skipped`, with why, and nothing is emailed
  (asked as the file is built and again as it is delivered, since a PDF renders in between). A
  schedule's file is emailed only once it exists; a file somebody pressed for (Run Now, Export) is
  never emailed, and its screen downloads it on the device that pressed once it is done. The PDF (landscape, the run's number on it) and the XLSX
  use day-first dates and Naira; an amount in another currency is written with its code. A file
  that cannot be built is retried by the outbox, and on its last attempt the run is `failed`
  with why.
- **A file is opened** by its recipient, the report's owner and the CEO only (the vault's rule for
  `home_report_run`), from `GET /documents/:id/content`.
- **Schedules** repeat daily, weekly or monthly (a recurrence rule, never cron) from `starts_on`, at
  `run_time` in Lagos, optionally on working days only (a daily rule keeps to working days; a
  weekly or monthly day off moves to the next working day; the 31st, or the last day, is each
  month's last day). `next_run_at` is the next slot; a paused schedule keeps its rule, has no next
  slot and sends nothing. Saving over a schedule keeps it paused or running as it was; a new one
  runs. Recipients are logins that hold `home.reports` and may open the source, checked when the
  schedule is saved, and each one refused is named; saving over a schedule checks only the
  recipients it adds, since one who has lost the report since is skipped as the file is built
  (§11). A slot is generated once per recipient and format however often the scheduler looks; a
  slot missed while the worker was down is sent once, late, and the schedule moves to its next slot
  after now. A running schedule saved while its slot is due keeps that slot, which is then sent
  once, late, as saved. A slot firing and a change to its report (a save, Pause, Resume, Archive
  or Run Now) take turns: each takes the report, then its schedule, then the run counter.
- **Run Now and Export** each create one file for the caller in the chosen format (Run Now in a
  format the schedule offers, either for a report on demand) and answer it `pending`; pressing again
  while it waits, or with the same idempotency key, is the same run. Only a run the caller asked for
  answers a press: a scheduled run never does, even once its schedule is removed. The Overview
  Export is a run of the reader's own Overview report (source `overview`, made the first time they
  export, not listed on Reports), open to every Home reader.
- **Runs This Month** counts the files done since the 1st (Lagos) among the runs on the reader's
  Recent Runs; **Recipients** counts the people who receive at least one scheduled report the
  reader may see; **Scheduled** and **Paused** count the reports the reader may see by their
  schedule's state.

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
| `home-alert-sweeps` (scheduler, daily 06:00 Lagos; and its queue, to re-run a morning by hand) | every morning | `alerts.sweeps.js`: reads each switched-on rule's metric, a batch at a time, and raises, refreshes or leaves an alert per subject, each in its own transaction; a rule it cannot read is logged and the others still run |
| `attendance.rule_breached` (Attendance) | a policy rule is breached, in the transaction that crossed it (attendance.md §6.16) | Attendance's outbox handler `attendance.raise_breach_alert` raises its alert through `alerts.service.raisePolicyBreach` when Alert is on, or Query Due while Raise Query waits on M3; `home.alert_raised` follows as for any alert. Home no longer handles `attendance.punched` or `attendance.day_closed` |
| `home.alert_raised` | an alert is raised | notifies the holders of the rule's `permission_key` whose scope reaches the person it is about, never that person (a notification, separate from the alert) |
| `home.alert_cleared` | an alert is cleared or dismissed | the audit entry (who, when, outcome) |
| `alert-ageing` (scheduler, hourly at ten past, M0) | a High alert has been open 14 days | `home.alert_escalated`: notifies the CEO, once per alert |
| `home.report_created`, `home.report_updated`, `home.report_archived` | a report or its schedule is saved, paused, resumed or archived (and a person's own Overview report, the first time they export) | audit |
| `scheduled-reports` (scheduler, every 5 minutes) | a schedule's `next_run_at` has come | queues `scheduled-report` per due schedule, at most 200 a tick, its job id the schedule's and its slot's (a slot whose job failed every attempt is queued again at the next tick) |
| `scheduled-report` (handler) | queued by the scheduler | creates one run per recipient and format for the slot, advances `next_run_at`, emits `home.report_run` per run; a schedule paused, archived or moved past the slot makes nothing |
| `home.report_run` | a run row is created: scheduled, Run Now or Export | outbox `reports.generate` (`reports.generate.js`): builds the file as the recipient, PDF through `documents.generate` (doc type `home_report`, landscape, the run's number on it) or XLSX through `shared/spreadsheet` and the vault, then emails a schedule's XLSX (a run on demand is done, for its screen to download); `skipped` when the recipient may no longer have it, `failed` on the outbox's last attempt |
| `document.generated`, `document.render_failed` (documents, filtered to `home_report`) | the PDF is rendered, or rendering gave up | outbox `reports.file-ready`: a schedule's file is emailed, and the run `done`; `reports.file-failed`: the run `failed` |
| `home.report_run_finished` | a run settles: done, failed or skipped | audit; nobody is told (a schedule's file is the email; a file pressed for downloads where it was pressed) |

Every write goes through its module's service, in a transaction, with `emit()`; follow-on work is
an outbox handler, never inline, and every handler is safe to run twice. Home raises no event for a
figure it only reads.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (Staff) | the Staff Overview: day strip, their own cards, Upcoming Leave, Your Week, an empty Need You; Team, Alerts and Reports show the gated state | choose their cards; open a card's records; Export their Overview; clock in from the prompt |
| Line Manager | the Staff Overview; Team for everyone below them on the reporting line; alerts of rules whose grant reaches their team; their own and shared reports | clear their team's alerts, never one about themselves; build, run and receive reports |
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
    `runs.mine` (`HomeReportRunQuery`): the files the asker received, newest first; both empty
    without `home.reports`.
  Nothing write-like: the assistant never clears an alert, edits a rule, runs a report or saves
  cards (A23). Manifests declare reads and screen routes only.
- **AI routes**: "see open alerts" → `home.alerts`, and "see attendance alerts" (one per category)
  → `home.alerts` with that category; "change the rules that raise alerts" → `home.alerts`; "open a report", "build, schedule or run a report" and "see the report files sent to me" →
  `home.reports`; "see who is in" → `people.attendance`; "see my team's attendance" →
  `home.team`; "choose the cards on my Home" →
  `home.overview`; "see who has clocked in today, by status" and "see the requests waiting on my
  approval" → `home.overview` with `kpi` (`attendance_today`, `approvals_awaiting_you`), which opens
  that card's records as ⌘K's `?id=` does.
- **Search**: route-map types `home_alert` and `home_alert_rule` (Alerts), `home_report` and
  `home_report_run` (Reports), `home_kpi` (Overview, opening the card's records). Providers:
  `alerts.search.js` (open alerts the reader may see, by title or trigger; rules by name or key
  for `alerts.manage` holders, opening Edit Rule at `?tab=alerts&rule=`, since the tab's `?id=` is
  an alert), `reports.search.js` (reports the reader may see, by name, opening at `?tab=reports&id=`;
  runs they received or of reports they own, by number or report, at `?tab=reports&run=`; both only
  for `home.reports` holders),
  `dashboard.search.js` (the cards the reader may see and the Overview offers, by their title or
  their records' title; a Team card belongs to its tab and is not found). Each filters per person,
  since every login holds `home` view. Words people use: "alert", "warning", "red flag"; "report",
  "attendance report"; "dashboard", "KPI", "card". New Rule and New Report are ⌘K actions
  (`src/shared/search/actions.js`; New Rule only for holders of `alerts.manage`, New Report only
  for holders of `home.reports`, through the action's `capability`). A tab the reader cannot open
  is not offered.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Home · Overview (`overview`) | Greeting with the first name, and the date (Operations adds the clocked-in count); the four KPI cards with Choose Cards; the main chart (Operations: Attendance, 14 Working Days, with "Dips are Saturdays, a half day" on desktop, and the On Time donut "37 on time, 4 late, 7 absent this month"; CEO: Organisational Goals and the Org KPI donut with its per-department figures; Partnerships: Monthly Signed Value; Staff: the day strip Shift Today, Clock-In, Worksite, Status, Hours Today); Need You (empty: "Nothing Needs You"); Partnership Pipeline with "4 with no contact in 30 days" on desktop; Goals This Quarter; Activity Today; Your Week; Staff: My Goals This Quarter and Upcoming Leave with the year's balance ("12 days left this year") and View All to My Leave; Export, a choice of Export PDF or Export XLSX (busy while the file is made, then saved on this device and toasted with the run's number, "RPT-0216 downloaded"); New, a menu of New Task, Request Leave, Add Work Site, New Rule, New Report as the reader holds them; Add Work Site beside New, for everyone: the temporary site sheet, owned by Attendance (attendance.md §10) | None | How cards are chosen, inherited and pruned: §6 Cards. Why each role's Overview leans on its own work: §6 Overview. How the CEO rollup is built, where staff goals and leave are set: §6. That figures equal My Attendance: §3 step 2. Saturday hours: §11 |
| Choose Cards (picker) | Title "Choose Cards"; each card the reader may see with its title, a Locked pill on locked ones, a tick on the chosen; Move Up and Move Down on each chosen card; the count "3 of 4"; Cancel, Use Role Default, Save Cards; field error "Pick up to 4 cards" | None | Resolution order, eligibility, why a card is missing: §6 Cards |
| Home · Team (`team`) | The scope (The Whole Organisation, Your Team, or Just You); Present Today, On Site, Remote, Flags; Department (all departments, or one) and the status chips (Everyone, On Site, Remote, Field, Late, Not In, On Leave, No Clock-Out Yesterday); the Team Roster with Search People: employee, department, today's status pill (Day Off on a day not worked) with No Clock-Out Yesterday beside it, Clock-In, KPI, Open Tasks; empty: "Nobody Matches", "Try another status, department or search."; Attendance This Month by person: On Time (out of the days expected), Late, Absent, On Leave. A card opens its records; a row opens the person: Job Title, Department, Today, Clock-In, Clock-Out, Worksite, KPI, Open Tasks, with View Attendance and Open Profile for a reader who may open those screens | None | Where the roster's figures come from and that they match My Attendance: §3 step 2, §6. Who the viewer may see: §6 Scope, §8 |
| Home · Alerts (`alerts`) | Open Alerts, Needs You, Overdue 7 Days +, Cleared This Week; the category chips (All, then each category with open alerts, with counts); the Open Alerts list: alert, trigger, Who Can Clear ("People Approvers"), age ("Today", "3 days"), Over By ("+1", "12 days left", "Due Today" on the day itself, or Expired once it has passed), severity; empty: "No Open Alerts", or for a category "No Alerts Here", "Try another category."; Alert Sources, 30 Days (desktop; empty: "Nothing Raised"). View Dismissed (the dismissed list: alert, trigger, Dismissed, Dismissed By, severity; empty: "Nothing Dismissed"; View Open goes back). A row opens the alert: Trigger, Who Can Clear, Age, Over By ("+1 over 3"), Severity, and for a closed alert when, by whom and its note; Close, Edit Rule (`alerts.manage`; for an alert of an Attendance policy rule, Set in Attendance Policy instead), Dismiss Alert, Clear Alert (when the reader may clear it); toasts "Alert cleared", "Alert dismissed", and "Alert not found" for a link to one the reader may not see. Alert Rules (first an Attendance Policy card: the policy's five rules read only, Late Arrivals, Early Departure, Absence, Forgotten Clock-Outs and Location Flags, each with its figures in words ("3 late arrivals in a month or 5 hours", or Off) and Alert and Raise Query pills, and Set in Attendance Policy for a holder of `policies.manage`; then each rule with its threshold in words ("2 days waiting"), severity, Who Can Clear, open alerts, its switch and Edit Rule; Close, New Rule; switching off asks "Switch Off Rule" with "Its open alerts are dismissed."; Cancel, Switch Off; toasts "Rule switched off", "Rule switched on"). New Rule (Rule Name, Metric, Threshold, Window Days for a metric counted over days, Severity, Who Can Clear offering each metric's own grant; Cancel, Create Rule; toast "Rule created"); Edit Rule (from an alert, from Alert Rules, or from a link to the rule as ⌘K's rule results open it; the same fields but Metric; Save Rule; toast "Rule saved"), not offered for a rule on a metric no longer listed, which can still be switched off | Help term on the Over By column header, and on each phone card's Over By label: "How far the count is past its rule's threshold: +0 over 3 means it reached 3, +1 means 4. A deadline alert shows the days left instead." | That alerts are not notifications, escalation to the CEO, the two checks on clearing, the audit entry: §3 steps 5 and 6, §6 Alerts. Rules being numbers, not code: §4, §6. A new rule's first run: §6, §7 |
| Home · Reports (`reports`) | Scheduled, Paused, Runs This Month, Recipients; a card per report the reader may see (name, status pill Scheduled, Paused or On Demand, Source, Schedule in words ("Every working day at 18:00"), Audience) with Run Now, and for its owner or the CEO an actions menu: Edit Report, Pause Report or Resume Report, Archive Report (asks "Archive Report" with "It stops running and leaves this list. Its runs stay."; Cancel, Archive Report); empty: "No Reports Yet". Recent Runs: number, report, run (day-first date and time), recipient, format, status (Pending, Failed, Skipped, or Download once done); empty: "No Runs Yet". New Report, a form in three steps: Report (Report Name, Source, its filters, Share With Managers), Schedule (Repeats: Daily, Weekly, Monthly or On Demand; Days for Weekly; Start Date, Time, Working Days Only), Delivery (Recipients, Formats: PDF, XLSX or Both), with no Delivery step On Demand; Cancel, Back, Next, Create Report; a person Recipients cannot go to is named on it ("Ada Obi: no access"). Edit Report is the same form without Source; Save Report. Run Now asks the format (Run as PDF, Run as XLSX) when the report has both. A report opened from a link: Status (Archived for an archived one, which offers nothing else), Source, Schedule, Audience, Owner, Next Run; Close, the actions menu, Run Now. A run opened from a link, however far back: its number as the title, Report, Run, Recipient, Format, Status (Done, Pending, Failed or Skipped); Close, and Download once done. Toasts "RPT-0215 downloaded" (Run Now, once its file is saved on this device; busy until then), "Report created", "Report saved", "Report paused", "Report resumed", "Report archived", and "Report not found" or "Run not found" for a link to one the reader may not see | None | Generation as the recipient, skipped runs, sources being the screens' own queries, email delivery, who may open a file, what Paused means: §3 step 7, §4, §6 Reports |
| KPI detail (the report model) | The card's title, the summary line ("22 of 25 clocked in across the organisation"), the group chips with their counts (Clocked In Today: On Site, Remote, Field, Late, Not In, On Leave, No Clock-Out Yesterday), the paged list, the page count; empty: "Nothing Behind This" | None | Paging at 25: §5. Scope: §6 |
| Gated tab (Team, Alerts, Reports) | The page title, the Locked illustration, "For Managers" and one line, "This tab is for managers and the CEO." | None | Which capability opens which tab: §8 |
| Clock-in prompt | Owned by Attendance: the attendance guide's §10 | The attendance guide's §10 | When it opens: attendance.md §6.14 |
| Attendance figures on Overview and Team | The clocked-in count, the On Time donut and the roster statuses, as in the rows above | None | That the figures are read from the shared roster and always equal My Attendance: §3 step 2, §6 |

The demo's Viewing As switcher is a demo device for showing each role; the real Home resolves the
role from the signed-in employee (§6).

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Home · Overview (`overview`) | The greeting with New and Add Work Site, the four KPI cards two to a row, then the role's main chart. Staff: the day strip (Shift Today, Clock-In, Status) before the KPI cards | Export; the date line and the chart captions; Staff: Worksite and Hours Today in the day strip | New and Add Work Site, in the floating button's fan (Add Work Site opens its full sheet, Submit for Approval at the foot); Choose Cards in the page menu; a KPI card opens its records as a bottom sheet | Bottom bar Home; the four tabs along the top |
| Choose Cards (picker) | A bottom sheet: the chosen cards in order with Move Up and Move Down, then the other cards | The count | Save Cards, full width at the foot of the sheet | The sheet closes back to the Overview |
| Home · Team (`team`) | The four KPI cards two to a row, the status chips, then the roster as person cards: avatar, name and department, a status pill, Clock-In and KPI; then Attendance This Month as person cards (On Time, Late, Absent) | The scope line; the Department filter; the Department and Open Tasks columns (department shows under the name; open tasks in the person's sheet); On Leave in Attendance This Month | Tap a person card or a KPI card: a bottom sheet; View Attendance and Open Profile full width at the foot of the person's sheet | Bottom bar Home; the four tabs along the top |
| Home · Alerts (`alerts`) | View Dismissed, Alert Rules, New Rule; the four KPI cards two to a row; the category chips; alert cards with a severity pill, Who Can Clear and Over By (a help term: a tap opens it as a sheet) | Alert Sources, 30 Days; the Trigger and Age columns (both in the alert's sheet); in Alert Rules, each rule's Severity, Who Can Clear and open alerts (a rule card is its name, threshold, switch and Edit Rule; the Attendance Policy card first, a row per rule) | Clear Alert, full width at the foot of the alert's sheet; New Rule, also in the floating button's fan, opens the rule form as a sheet | Bottom bar Home; the four tabs along the top |
| Home · Reports (`reports`) | New Report, the four KPI cards two to a row, then the report cards one to a row, then Recent Runs as run cards (the report with the run's number under it, run, recipient, status) | The Number column (under the report on the card) and the Format column of Recent Runs | New Report, also in the floating button's fan, opens the form as a full-screen sheet with its steps; Run Now on a report card (its format choice and the owner's actions are action sheets); Download on a done run card, and full width at the foot of a run's sheet opened from a link | Bottom bar Home; the four tabs along the top |
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
- **Staging shows figures.** The Home staging seed (`seeds/staging/60_home.js`, run by
  `scripts/db/seed.js --staging` after `10_staff.js`) hangs everything off MyCity's real staff,
  found by post as `seeds/staff/roles.json` names it (`seeds/staging/lib/staff.js`), never by name,
  and adds nobody. It writes, in order:
  - **attendance** for today and the 14 working days before it, through the attendance module's own
    day writer and day-close (`seeds/staging/lib/attendance.js`): each person's day drawn from their
    work email and the date, so the same on every run (in on time, late, no clock-out, absent), and a
    punch only once its time has come. A seeded punch is source `import` with the idempotency key
    `staging-home:<date>:<type>`; a day holding the person's own punch, or one the day-close already
    closed, is left alone. `attendance_event` is append-only, so these stay;
  - **rows in the forward modules' tables** (tasks, the calendar, goals and targets, a review cycle and
    its reviews, partners and their pipeline, expenses and budgets, vacancies for the organogram's open
    seats) by SQL with fixed UUIDv5 ids, the in-browser mock's records on the real staff
    (`seeds/staging/lib/forward-rows.js`). Their numbers carry STG (`PAR-STG-01`), so none collides
    with a number the owning module gives. Every id is written out in one manifest,
    `HOME_STAGING_ROWS` (`seeds/staging/lib/home-staging-rows.js`, `{ table, id_column, ids }`,
    children before parents), never worked out from the rows: **the milestone that builds a table
    has its own staging seed call `removeHomeStagingRows` for it, which deletes the alerts Home raised
    about those rows and then the rows, and in the same PR takes the rows out of the Home seed,
    leaving their ids in the manifest** (DATABASE_SCHEMA, each milestone's Read by Home). An alert
    about a row that is gone opens nothing and nobody can deal with it, so it goes with the row;
  - **two alert rules** through the alerts service, authored by the seed (Quiet Partners, Budget
    Nearly Spent), then the morning sweep itself, so every alert is a real breach of the rows above
    raised through the shared engine. Attendance's alerts are the Attendance policy's breaches
    (§6 Alerts), raised once a version on staging switches its rules on, so the seed makes none;
  - **four reports** through the reports service, each made by its owner: Daily Attendance, every
    working day at 18:00, its last slot fired as the scheduler fires a missed one; Weekly Headcount,
    paused; High Alerts and Team Attendance on demand, each Run Now once.

  Run twice at the same moment it changes nothing: punches and runs are found by their keys, rules by
  their key, reports by their owner and name, forward rows by their ids, and the sweep refreshes what
  it raised. Run on a later day it adds that day's attendance, closes the days before it and moves the
  forward rows' dates with the day. Run after the organisation changed (a seat filled, someone moved
  or left) the forward rows follow it: a listed row it no longer writes is deleted with the alerts
  about it, and a row given a unique value another of Home's rows held (a review passing to the next
  person in a team) takes it from that row. A vacancy's slug follows its place, as its number does,
  never the seat's title. It refuses production with the runner's own three checks, asked
  again inside the file. On staging the runs are built (a schedule's emailed) and the alerts notify their
  holders, as the real jobs would (A4: staging mail is marked). `tests/integration/home-staging-seed.test.js`
  runs it twice on the real migrations and the real staff, again after a seat is filled and after
  someone changes manager, and follows M7's and M8's removal to the end.
- **A hidden M2 card** (Goals On Track, My Targets, Payroll In Progress) is never offered or
  computed; the Home view's fifth or sixth default takes its place, and with nothing else eligible
  the row shrinks.
- **A reader who may not open Partnerships** gets a null pipeline and no pipeline card, rather
  than an empty one. A Head of Department whose team owns no partner (one outside Partnerships)
  sees the pipeline's empty state; their role's own cards (`role_kpi`, §6) can lead with their
  own work instead of the partnership cards.
- **The first session of the day.** The clock-in prompt is Attendance's and opens on whatever
  screen the first session lands on (attendance.md §6.14, §11); Home's Overview no longer waits
  for it or opens it.
- **A report skipped.** A recipient who has left, been suspended, or lost the source's grant or
  `home.reports` since the schedule was saved gets a `skipped` run, no file and no email; the other
  recipients get theirs. Its owner still edits the report without taking them off: an edit checks
  only the recipients it adds. A report whose owner has left keeps running for its recipients until an
  owner or the CEO archives it.
- **A failed file.** A PDF that cannot be rendered is retried by the render job and then marked
  `failed`; a file that cannot be built is retried by the outbox and failed on its last attempt.
  Its run shows Failed and offers no download.
- **Deadline alerts.** A document, confirmation or contract date inside the rule's days raises an
  alert reading "N days left"; on the day itself it is not yet Expired; a date already passed reads
  Expired until someone clears it, and once cleared it is not raised again unless the date
  changes (earlier or later), when a new alert is raised for the new date.
- **A rule switched off and on.** Its open alerts are dismissed as the rule change and count as
  neither cleared nor dealt with; at the next sweep after it is switched back on, what still
  breaches is raised again.
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
- **Reporting line as recipients.** Sending a report to "each person's line manager" was dropped in
  M1: recipients are chosen people. TB to decide whether it returns.
- **The CTO's view.** The kickoff asked for the CTO's Home to show the health of the whole
  application; in M1 the CTO gets the Operations Overview. Not modelled; TB to decide.
- **Currency.** `shared/money` is Naira only, so sums over forward tables count `NGN` rows and leave
  other currencies out. Owner to decide whether such sums group by currency when M7 and M8 land.

## 14 · Change log

- 21/10/2026 · TB · Built with attendance's PR 3: the `late_arrivals` and `missing_clock_out` metrics left the list and their rules are switched off (`1445`); attendance's alerts are the policy's breaches, on the five rules the system keeps (metric `attendance_policy`, People Approvers, no Over By), raised after commit by `attendance.raise_breach_alert`; Alert Rules opens with the Attendance Policy card (`GET /home/alert-rules/policy`), and a policy alert offers Set in Attendance Policy in place of Edit Rule. Alert Sources counts them as Attendance Policy. The staging seed keeps two rules.
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
- 18/10/2026 · TB · Alerts backend built (`src/modules/alerts`): the metric registry over the attendance, approval, document and staff-register records and the partners, budgets and vacancies adapters; the alert list, one alert, the counts and clearing or dismissing behind `alerts.clear` or `alerts.manage` with the rule's grant over the subject; the rules (`alerts.manage`) with server-made keys, switching off dismissing their open alerts as the rule change; the 06:00 `home-alert-sweeps` scheduler and its queue, and the `attendance.punched` and `attendance.day_closed` signals; a breach a person closed is not raised again for the same evidence; the Overview's alerts beside Need You and the Open High Alerts card read the one rule of who sees an alert; `alerts.mine` for the assistant, ⌘K's alerts and rules, and New Rule for `alerts.manage` holders. §3, §4, §4.1, §5, §6 Alerts, §7, §9 and §11 follow.
- 18/10/2026 · TB · Alerts screen on the real API (`app/src/features/home/Alerts.tsx`, `AlertRules.tsx`): drawn from the contract's `HomeAlert`, `HomeAlertSummary` and `HomeAlertRule`, with the four counts (two to a row on a phone), the category chips, the Open Alerts list sorted by the server (Age, Severity) with Over By's help term on its header and on each phone card, View Dismissed, and Alert Sources, 30 Days on desktop. An alert opens as a sheet offering Clear Alert and Dismiss Alert only where `can_clear` says clearing will work, and Edit Rule to `alerts.manage`. Alert Rules lists each rule with its switch (switching off asks first) and Edit Rule; New Rule and Edit Rule are one form checked by the contract's `HomeAlertRuleCreate`, with Window Days only for a metric counted over days and Who Can Clear following the metric. `?id=`, `?category=` and `?action=new` open an alert, a chip and New Rule. The old subtitle and the explainer copy left the screen; the INTERIM Alerts types are gone. §10.1 and §10.2 say what each shell shows.
- 18/10/2026 · TB · Alerts review fixes (backend): nobody but the CEO sees, counts or clears an alert about themselves (`mayClear` and the one `seenWhere` condition, so the list, one alert, the counts, Needs You, the Overview, the Open High Alerts card, ⌘K and the assistant agree), nor is told it was raised; a raise reads its rule again in its own transaction, so a sweep or signal that loaded a rule before it was switched off raises nothing on it; a deadline's date is part of its evidence (`home_alert.due_on`, `1151`), so a cleared deadline alert is raised again when the date changes; `over_by` keeps a deadline's days left below 0 once passed, so the day itself and a passed date read apart; a missed clock-out's evidence is the day's end, so a late day-close does not raise a cleared one again; §4.1 and §6 say the alert metrics are the one other reader of the attendance, workflow, document and employee tables they watch. §3, §4, §4.1, §6 Alerts, §7, §8 and §11 follow.
- 18/10/2026 · TB · Alerts review fixes (screen): `?tab=alerts&rule=<id>`, the link ⌘K's Alert Rules results open, opens Edit Rule for a holder of `alerts.manage` and leaves the address when it closes, as `?id=` does; anyone else just loses the link. Over By reads Due Today for a deadline on the day itself and Expired only once the server's days left are below 0. The Over By help says what a count at its threshold reads (+0 over 3 means it reached 3), since reaching the threshold raises it. Age going up lists the youngest alert first. The mock follows the server: nobody but the CEO sees an alert about themselves, a rule switched off dismisses its alerts as no one, rule keys are `<metric>.<slug>` with `_2` when taken, and a closed list is most recently closed first. A link to a rule on a metric no longer listed opens Alert Rules and leaves the address, since Edit Rule is not offered for such a rule. §10.1 follows.
- 18/10/2026 · TB · Reports backend built (`src/modules/reports`): the source registry over each screen's own query (the roster, People's leave list, the alert list's one rule, the staff register, the forward cards' records and the reader's own Overview), reports with sharing, filters and a recurrence schedule from a start day at a time in Lagos, pause, resume and archive for the owner or the CEO, Run Now and the Overview Export as 202 pending runs that a second press answers again, Recent Runs, the four counts; the `scheduled-reports` tick and `scheduled-report` job making one run per recipient and format per slot; `reports.generate` building each file as its recipient (skipped when they may no longer have it, failed on the outbox's last attempt), the landscape PDF through `documents.generate` and the XLSX through the vault, emailed once the file exists and opened only by its recipient, its owner and the CEO; `reports.mine` and `runs.mine` for the assistant, ⌘K's reports and runs (`?run=`), and New Report for `home.reports` holders. §3, §4, §5, §6 Reports, §7, §9 and §11 follow.
- 18/10/2026 · TB · Reports screen on the real API (`app/src/features/home/Reports.tsx`, `ReportForm.tsx`): drawn from the contract's `HomeReport`, `HomeReportSummary` and `HomeReportRun`, with the four counts (two to a row on a phone), a card per report the reader may see with its schedule and audience in words, Run Now asking the format only when the report has both and toasting the run's number, and for its owner or the CEO Edit Report, Pause Report or Resume Report and Archive Report (asked first, naming what it does). Recent Runs is paged at 25 with Pending, Failed, Skipped or Download, and reads itself again while a run it shows is being made. New Report and Edit Report are one form in three steps checked by the contract's `HomeReportCreate`, offering only the sources the reader may open (Open Alerts to those the Alerts tab opens to), with no Delivery step On Demand and the server's refusals on their fields; recipients are picked from the colleague list. `?id=` opens a report (an archived one as Archived, with nothing to do), `?run=` marks a run on Recent Runs, and `?action=new` opens New Report. The Overview's Export makes a PDF or XLSX of the reader's Overview through the same runs, toasted with its number. The INTERIM Reports types are gone. §10.1 and §10.2 say what each shell shows.
- 18/10/2026 · TB · Home staging seed built (`seeds/staging/60_home.js`, with `seeds/staging/lib/` `staff.js`, `attendance.js`, `forward-rows.js` and `uuid5.js`): attendance for the real staff through the attendance module's day writer and day-close, the forward modules' rows by SQL with fixed ids in the `HOME_STAGING_ROWS` manifest each owning milestone deletes by, four alert rules and the sweep, four reports with their runs through the reports service; refuses production as the runner does. §11 says what it writes, how it stays idempotent and who removes which rows; DATABASE_SCHEMA's Read by Home for M2, M4, M7 and M8 says the same to each owner.
- 18/10/2026 · TB · Review fixes to the staging seed: the `HOME_STAGING_ROWS` ids are written out in `seeds/staging/lib/home-staging-rows.js` instead of worked out from the rows, so an owner taking its rows out of `forward-rows.js` keeps their ids, and its own seed calls `removeHomeStagingRows`, which deletes Home's alerts about those rows before the rows; a run deletes the listed rows it no longer writes with their alerts, a row given a unique value another of Home's rows held takes it from that row, and a vacancy's slug follows its place, so a seat filled or someone moving manager between runs no longer stops the seed. §11 and DATABASE_SCHEMA's Read by Home for M2, M4, M7 and M8 give the steps.
- 18/10/2026 · TB · Review fixes to the reports backend: a slot firing takes the report before its schedule, and a change to a report locks it without blocking a run made against it, so a slot firing while its owner saves, pauses, archives or runs it takes turns instead of deadlocking; a running schedule saved while its slot is due keeps that slot; Run Now answers only a run the caller asked for, never a scheduled run whose schedule was removed; saving over a schedule checks only the recipients it adds, and a refusal names each person refused; `GET /home/report-runs/:id` reads one run on the reader's Recent Runs for `?run=`; the reports integration test no longer depends on the day or hour it runs. §5, §6 Reports and §11 follow.
- 18/10/2026 · TB · Review fixes to the Reports screen: a `?run=` link (⌘K) opens that run as a sheet, read on its own from `GET /home/report-runs/:id`, however far back it is (number, Report, Run, Recipient, Format, Status, and Download once done), toasts "Run not found" for one the reader may not see, and closing it takes the link out; Edit Report sends the schedule only when the person changed it, so a new name or sharing alone never saves it again, and a recipient the server refuses is named on Recipients. The mock serves the one-run read, checks only the recipients a schedule adds and names each one refused, and holds a suspended person to not receiving. §10.1 and §10.2 follow.
- 19/10/2026 · TB · No change to Home. The reports unit test reads Home's outbox handlers sorted,
  because the organogram's Download PDF now registers on the same document events
  (`docs/guides/organogram.md` §7) and the order they load in is not Home's to fix.
- 19/10/2026 · LA · The roster's `field` status (attendance.md §6.12): a present day on a field assignment reads Field, counted in Present Today and Clocked In Today, with a Field chip on Team and in Clocked In Today's groups. Team's four cards are unchanged.
- 19/10/2026 · AJ · Team (the roster and Attendance This Month) and a card's records show each person's photo: `HomeTeamRow.employee`, `HomeTeamAttendanceRow.employee` and a person cell are `PersonRef` with `photo_url` (the roster reads it, `kpi-catalog/shared.js` `PERSON` is now `shared/db/person.js`); initials when there is none. TB to review.
- 19/10/2026 · TB · The clock-in prompt left Home (owner decision of 19/10/2026, replacing O12): Attendance decides it (`AttendanceToday.sign_in_prompt`, the same first-session rule `dashboard.prompt.js` held) and the shell opens it over a blurred screen on whatever screen comes first, so a sign-in through a link is prompted too. `dashboard.prompt.js`, `HomeOverview.prompt_clock_in` and the Overview's opener (`clockPrompt.ts`) are gone; §2, §3 step 1, §6, §10 and §11 say so. Nothing else on Home changed.
- 19/10/2026 · TB · Run Now and the Overview's Export download on the device that pressed, never by email (`docs/guides/foundation.md` §6.12, TB's decision; §3 steps 7 and 8, §4, §5, §6, §7, §10): a run on demand is done once its file exists and is not emailed (`emailed_at` stays empty), the screens wait on the run and save its file (toast "RPT-0215 downloaded"), and `GET /home/overview/export/:id` lets every Home reader, Staff included, wait on their own Overview run. A schedule's runs are still emailed; the email's `scheduled` variable is gone with the branch it chose.
- 20/10/2026 · TB · The Attendance policy becomes the one source of attendance thresholds (`attendance.md` §6.16, policies.md): from attendance's PR 3, Home's attendance alerts come from the policy's rules and their Home rules are read only; from its PR 4, Home · Overview gains an Add Work Site button beside New (and an entry in New) (`attendance.md` §6.11). Nothing else on Home changes.
- 20/10/2026 · TB · Attendance's PR 4 built: Home · Overview's Add Work Site, beside New and as an entry in New, on desktop and in the phone's floating button fan, opens Attendance's temporary site sheet (§2, §3 step 10, §10); a present day on an approved temporary site reads Field on the roster and Team, a Temporary Home Remote (§6 Team, attendance.md §6.9). Nothing Home computes changed.
- 21/10/2026 · TB · A temporary site's hours (attendance.md §6.11): Add Work Site's sheet opens on Usual Shift or Site Hours (§3 step 10); on a day of a site with its own hours the Staff day strip's Shift Today shows the site's (§6 Overview), and the roster counts the day as worked for its people (attendance.md §6.9).

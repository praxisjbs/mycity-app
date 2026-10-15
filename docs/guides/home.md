# Home · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M1 |
| Backend modules | `home` |
| Frontend paths | `app/src/features/home/` |
| Permission key(s) | `home` (view, every employee), `home.team` (roster and team attendance), `home.alerts` (see and clear, per the rule), `home.alerts.manage` (create and edit rules), `home.reports` (build, schedule and run reports) |
| Screens (PROGRESS.md rows) | #1 Overview, #86 Team, #2 Alerts, #3 Reports |
| Status | Agreed |
| Last changed | 15/10/2026 |

Home is the command centre, renamed to **Home** at the 12 October kickoff and fixed in MILESTONES
§18.1 (a plain word that survives translation and fits an icons-only rail). This guide is the
engineering brief for the real build, backend and frontend; the version in `demo.html` is the
agreed visual reference only, and no data or field name is taken from it (CLAUDE.md step 3). The
built demo preview helps a reader see the shapes while this is implemented.

Sources read for this guide: the client discovery call (02/09/2026), the project kickoff and the
module demos (both 12/10/2026), and the attendance and device review (13/10/2026).

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
| Home · Overview (`overview`) | staff app | every employee, role-filtered | the role's KPI cards, its main chart, Need You, activity across the organisation today, the person's week; managers also see attendance and the partnership pipeline where their role owns it | read; click any KPI card to open its detail (the report model); export |
| Home · Team (`team`) | staff app | managers, People and Operations, the CEO; a function lead sees their own people | the team roster with today's attendance (on site, remote, field, late, no clock-out, on leave) and team KPIs | read; click a KPI to list the people behind it; open a person; deep link to People · Attendance |
| Home · Alerts (`alerts`) | staff app | anyone who holds a clearing permission a rule names | rules that have crossed a threshold and nobody has cleared, with severity, age and how far past the threshold (Over By) | filter; clear or dismiss an alert; create or edit an alert rule (with `home.alerts.manage`) |
| Home · Reports (`reports`) | staff app | managers and the CEO only; cards are filtered by the viewer's permissions | the reports the viewer may build or receive, scheduled and on demand, with each card tagged by audience | build a report, set filters and recipients, schedule it, run it now, download PDF or XLSX |
| KPI detail modal (the report model) | any KPI card, every tab | the same scope as the card it opens from | the paged list behind the number, e.g. Clocked in today → on site / remote / late / no clock-out / on leave | page at 25; export; from Team, open a person |
| Clock-in prompt | staff app, first sign-in of the day | the signing-in employee | a prompt to clock in (owned by Attendance, triggered from Home) | clock in, or dismiss |
| Attendance figures on Overview and Team | reads People · Attendance | Operations, People, managers | the clocked-in count and breakdown, read live from the shared attendance roster | drill through to the Attendance register |

Home renders but is not the owner of the attendance, partnership, approval, recruitment and task
figures it shows; it reads them live from the owning modules (§3, §4). It owns the alert rules,
the alerts, the report definitions and the report runs.

## 3 · How the screens relate

The flows that cross screens, with the event or API that carries each step:

1. **Sign-in → Home.** An employee signs in and lands on Home · Overview, resolved for their role.
   On the first sign-in of the day, Home opens the clock-in prompt (owned by Attendance;
   `attendance.clock_in`). This is the only write Home initiates on behalf of another module, and it
   goes through the Attendance service, not Home.
2. **A clock-in reflects on Home.** A punch commits in People · Attendance
   (`attendance.punched`). Home's "Clocked in today" KPI and the Team roster read the same
   attendance roster, so they move with it, no copy and no second source. The number on Home always
   equals the number on My Attendance.
3. **A KPI card → its report model.** Clicking any KPI card opens a modal listing the records behind
   the number (`GET /api/v1/home/kpi/:key`), paged at 25. "Clocked in today" breaks down into on
   site, remote, field, late, no clock-out and on leave (module demos, 01:27 to 01:28).
4. **A threshold breach → an alert.** An owning module emits a signal (e.g.
   `attendance.rule_breached`, `partnership.inactive`, `approval.aged`, `document.expiring`,
   `recruitment.sla_missed`, `budget.threshold`). A Home outbox handler evaluates the matching alert
   rule and raises a `home_alert`. It appears on Home · Alerts until a person with the permission the
   rule names clears it; clearing writes to the audit log (`home.alert_cleared`). An alert is not a
   notification (MILESTONES §18.1): a notification is read once, an alert ages until cleared.
5. **A report → the recipient's inbox.** A manager builds a report on Home · Reports and schedules
   it (e.g. Daily attendance, weekdays at 18:00). The report scheduler (worker) generates it **as the
   recipient**, so no one receives a row they could not open, stores the file in the vault, and emails
   a PDF or XLSX (`home.report_run`). The same definition can be run on demand.
6. **The dashboard is wired last.** On production Home shows empty until the modules it reads are
   built and seeded; on staging it shows seeded mock data so the shapes can be reviewed (kickoff,
   01:16). This is a build-order note, not a runtime mode.

## 4 · Data

Home owns the rules, alerts, report definitions and report runs. It owns no copy of the figures it
displays; those are read live from the owning modules' repositories, scoped by permission.

| Table | Key columns | Notes |
|---|---|---|
| `home_alert_rule` | `home_alert_rule_id`, `key`, `metric`, `scope`, `threshold`, `window_days`, `severity`, `permission_key`, `enabled`, `created_by` | A rule is data, not code: changing a number needs no deploy. `metric` names the signal (late arrivals, partnership inactivity, approval ageing, document expiry, budget threshold, recruitment SLA). `permission_key` is who may clear its alerts, written `<module>.<action>` from the access catalogue (e.g. `people.approve`). |
| `home_alert` | `home_alert_id`, `home_alert_rule_id`, `subject_type`, `subject_id`, `title`, `trigger`, `severity`, `raised_at`, `last_seen_at`, `over_by`, `escalated_at`, `cleared_at`, `cleared_by`, `outcome` (cleared or dismissed), `note` | One open alert per (rule, subject). `over_by` is how far past the threshold it has gone. Cleared alerts are kept for the audit trail and the "cleared this week" count. Raising, clearing and the 14-day escalation are `src/shared/alerts/alerts.js`; the columns it reads are in BACKEND_STRUCTURE §11.1. |
| `home_report` | `id`, `key`, `name`, `source`, `filters` (jsonb), `schedule` (cron, nullable), `formats`, `recipients`, `reporting_line`, `permission_key`, `enabled`, `created_by` | A report definition. `source` names the query it runs (the same query the screen uses). `recipients` and `reporting_line` decide who receives it. |
| `home_report_run` | `id`, `number`, `report_id`, `run_at`, `status`, `document_id`, `format`, `recipients` | One row per generation. `number` from `numbering.allocate()`. `document_id` points at the vaulted file. |

Role layouts (which KPI cards and which main chart each role sees) are configuration over a KPI
catalogue, not a per-tenant table, following the donor's catalogue pattern (§12): a card is a
catalogue entry that **inherits** its rights and is computed eligible at read time, so revoking a
module silently retires its cards. Per-role defaults and locks live in the role-KPI config
(`role_kpi`), the tenant-facing dial over the catalogue.

Money is `numeric(18,2)` and crosses the wire as a string (`shared/money`); dates are ISO on the
wire, day-first for people. Migration file(s): in the M1 number block, `-- UP` / `-- DOWN`,
idempotent (README §6.3, CLAUDE.md step 4).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/home/overview` | `HomeOverviewQuery` → `HomeOverview` | `home` · own role | n/a (bounded) | Resolves the role's cards, main chart, Need You, activity and week. Each embedded list is itself capped at 25 and links to its full, paged endpoint. |
| `GET /api/v1/home/kpi/:key` | `HomeKpiQuery` → `HomeKpiPage` | the card's own permission · own/team/all | yes, 25 | The report model behind a card. Filters are the card's (mode, status, date). |
| `GET /api/v1/home/team` | `HomeTeamQuery` → `HomeTeamPage` | `home.team` · team/all | yes, 25 | Roster with today's attendance, read from the attendance roster. Filters: department, status, mode. |
| `GET /api/v1/home/alerts` | `HomeAlertQuery` → `HomeAlertPage` | `home.alerts` · scope of the rules | yes, 25 | Filters: category, severity, mine, age. |
| `POST /api/v1/home/alerts/:id/clear` | `HomeAlertClear` → `HomeAlert` | the permission the rule names | n/a | One write path: Home service, in a transaction, with `emit()`; writes the audit entry. |
| `GET/POST/PATCH /api/v1/home/alert-rules` | `HomeAlertRule*` | `home.alerts.manage` | list yes, 25 | Create and edit rules (threshold, window, severity, who clears). |
| `GET/POST/PATCH /api/v1/home/reports` | `HomeReport*` | `home.reports` · manager/CEO | list yes, 25 | A report definition. Cards a role may not see are not returned. |
| `POST /api/v1/home/reports/:id/run` | `HomeReportRun` → `HomeReportRunResult` | `home.reports` | n/a | Generates now, as the recipient; returns the run and its `document_id`. |
| `GET /api/v1/home/reports/:id/runs` | `HomeReportRunQuery` → `HomeReportRunPage` | `home.reports` | yes, 25 | Run history, each re-downloadable. |

Every list is paged at 25 through `shared/http/paged.js` (`pageQuery`, `sendPaged`); no `LIMIT`/
`OFFSET` in a repo and no page-size parameter in the contract (BACKEND_STRUCTURE §16, CLAUDE.md
step 4). Every request and response shape is a Zod schema in `packages/contract/schemas/home.js`,
`snake_case`; `contract.gen.ts` is generated, never edited by hand. Every staff route carries a
permission check; repos honour scope.

## 6 · Rules and calculations

- **Role resolution.** The cards and the main chart a person sees are decided by their role and
  permissions, computed at read time, never hard-coded per person. Attendance is a primary KPI for
  People and Operations; Partnerships sees pipeline KPIs and no attendance card; the CEO sees the
  organisational-goals rollup; a plain member of staff sees a personal view (today's shift and
  clocking status, their own goal KPIs, upcoming leave, their week). **Need You** is present for
  every role; its contents are the items assigned to that person (kickoff, 01:08 to 01:18).
- **Where the rest lives.** A Partnerships lead's own clocking is in My Attendance, not on their
  Home. A member of staff's goals are set with their manager in Performance, and a goal's progress
  counts from the tasks linked to it; their tasks and diary are in My Workspace; leave is requested
  in My Attendance and approved by their manager. The CEO's organisation KPI is the departmental KPI
  scores weighted together, shown beside it per department.
- **A card inherits rights.** A KPI card renders only if the viewer can open the module it reads
  from; revoking a module retires its cards automatically (donor pattern, §12). A card never grants
  access its viewer does not already have.
- **An alert rule is a threshold over a window.** "N late arrivals in W days", "a partnership with
  no recorded contact for more than D days", "a request ageing past D days", a document expiring
  within D days, spend past P percent of a budget. `over_by` is the current value minus the
  threshold (or days past). Severity is Low, Medium or High; a High alert escalates to the CEO after
  14 days. Rules are editable data, so a number changes with no deploy. Every alert comes from
  one rule; switching a rule off clears its open alerts and raises no new ones. A new rule is
  evaluated from the next signal its owning module emits (§7).
- **Reports are permission-gated before they render.** A report card appears only for a role that
  holds its permission, so a Partnerships lead never sees Daily attendance or Monthly expenses
  (kickoff, 01:12 to 01:13). A report is generated **as its recipient**, so it can never contain a
  row the recipient could not open on screen. The run history on Home · Reports is filtered the
  same way. A paused report keeps its schedule but sends nothing until it is resumed. Every
  generated file (PDF for reading, XLSX for working, day-first dates in both) is kept in the vault
  and can be downloaded again (§4, §5).
- **Attendance figures equal My Attendance.** The clocked-in count and its breakdown are read from
  the shared attendance roster, not recomputed, so Home and My Attendance never disagree.
- **What reaches a screen is decided in §10** (FRONTEND_GUIDE §5). Data, numbers and actions are
  open; the little support a person needs to act is a help term on the word it explains, or one
  Details row at the foot of a card; how the system works (this section and §3) is never on a
  screen. Chrome is Title Case; copy a person reads uses no em dashes.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `attendance.punched` (and leave, device, policy signals) | a punch or related change commits | Home reads the refreshed roster for the clocked-in KPI and the Team tab; no write |
| `attendance.rule_breached`, `partnership.inactive`, `approval.aged`, `document.expiring`, `recruitment.sla_missed`, `budget.threshold` | an owning module crosses a threshold | Home outbox handler evaluates the matching `home_alert_rule` and raises or updates a `home_alert` |
| `home.alert_raised` | an alert is raised | outbox: notify the role that can clear it (a notification, separate from the alert itself) |
| `home.alert_cleared` | an alert is cleared | writes the audit entry (who, when); updates the "cleared this week" count |
| `home.report_scheduled` (worker cron) | a report's schedule fires | generates the report as the recipient, stores the file in the vault, emails PDF/XLSX |
| `home.report_run` | a report is run on demand | the same generation path, returned to the caller |

Every write goes through the Home service, in a transaction, with `emit()` (one write path,
CLAUDE.md). Follow-on work (notifying, auditing, generating a file) is an outbox handler, never
inline. Home raises no event for a figure it only reads.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee (staff) | own role-filtered Overview: shift and clocking status, own goal KPIs, upcoming leave, their week | read; open a KPI's own detail; clock in from the prompt. No Team, Alerts or Reports |
| Line manager | Overview for their function; Team for their own people; Alerts they are named to clear; the Reports they are permitted | clear their alerts; build and receive their reports; open a team member |
| People / Operations | Overview with attendance primary; Team across the organisation; people, attendance and document alerts; attendance and productivity reports | reconcile via the owning modules; clear alerts; manage rules they own |
| Function lead (e.g. Partnerships) | Overview with their function's KPIs and no attendance card; Team for their department; alerts for their function; only the reports their role is tagged for | clear their alerts; build their function's reports |
| CEO | Overview as the organisation at a glance (goals rollup); Team across the organisation; high and escalated alerts; all reports | the above, organisation-wide |

Restricted fields (salary and other financial amounts) are shown only to a viewer who holds the
owning module's permission. Because reports are generated as the recipient, a restricted row never
reaches a report the recipient could not see on screen. No login exists without an employee record
(CLAUDE.md); a suspended or dismissed account cannot sign in and so never reaches Home.

## 9 · AI and search

- **AI reads** (`home.ai.js`): "what needs me today" (alerts I can clear, approvals waiting on me),
  "who is in today" (the attendance summary and breakdown), "how are we tracking" (the role's KPI
  and goal summary), "what reports do I receive". Every read is paged at 25 and read-only: the AI
  never clears an alert, edits a rule or runs a report (A23, CLAUDE.md). Manifests declare reads and
  screen routes only.
- **AI routes**: deep links to Home · Alerts filtered to a category, to a KPI's detail modal, to
  Home · Reports, and to the People · Attendance register, each with the filter prefilled.
- **Search** (`home.search.js`): alert rules and open alerts (by subject and trigger), report
  definitions (by name, and the words people use, so "attendance report" reaches Daily attendance),
  and KPI cards. Record types and their everyday words are declared here so ⌘K and the assistant can
  cite them (MILESTONES §18.2, gate 10).

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Home · Overview (`overview`) | Greeting and date (Operations adds the clocked-in count); the role's four KPI cards, each with a short trend line; the main chart (Operations: Attendance, 14 Working Days, with "Dips are Saturdays, a half day" on desktop, and the on-time donut "37 on time, 4 late, 7 absent this month"; CEO: Organisational Goals and the org KPI donut with its per-department figures; Partnerships: Partnership Pipeline and Monthly Signed Value; Staff: the day strip Shift Today, Clock-In, Where, Status, Hours Today); Need You; Partnership Pipeline with "4 with no contact in 30 days" on desktop; Goals This Quarter; Activity Today; Your Week; Staff: My Goals This Quarter and Upcoming Leave; Export, New | None | Why each role's dashboard leans on its own goals and why attendance is primary only for People and Operations: §6 Role resolution. Follow-ups raised automatically for quiet partnerships, and the late-arrival threshold behind the donut: §3 step 4, §6. How the CEO rollup is built, where a Partnerships lead's clocking lives, where staff goals are set and how they progress, how leave is approved, where tasks and the diary live: §6 Where the rest lives. Saturday hours: §11 |
| Home · Team (`team`) | The scope (The whole organisation, or the lead's departments); Present Today, On Site, Remote, Flags; the Team Roster: employee, department, today's status pill, Clock-In, KPI, Open Tasks; Attendance This Month by person. A KPI card or a row opens its list or the person | None | Where the roster's figures come from and that they match My Attendance: §3 step 2, §6. Who the viewer may see: §8, §13 Team scope. "Click a KPI card to see who is on site": the cards carry a chevron; §3 step 3. The "How the team view reads" card is removed |
| Home · Alerts (`alerts`) | Open Alerts, Needs You, Overdue 7 Days +, Cleared This Week; the category chips; the Open Alerts list: alert, trigger, Who Can Clear, age, Over By, severity; Alert Sources, 30 Days (desktop). A row opens the alert: trigger, who can clear, age, Over By, severity; Close, Edit Rule, Clear Alert. View Dismissed; Alert Rules (each rule with its switch); New Rule (Rule Name, Metric, Threshold, Window, Days, Severity; Cancel, Create Rule) | Help term on the Over By column header, and on each phone card's Over By label: "How far the alert is past its rule: +1 over 3 is one more than the 3 allowed. A deadline alert shows the days left instead." | That alerts are not notifications, escalation of High alerts to the CEO, clearing needing the permission the rule names, the audit entry on clearing: §3 step 4, §6, §7. Rules being numbers, not code, so a change needs no deploy: §4, §6. Switching a rule off, and a new rule's first run: §6, §7. The page subtitle, "Click a row to clear it" and the "Alerts are not notifications" card are removed |
| Home · Reports (`reports`) | Scheduled, Paused, Runs This Month, Recipients; a card per report the role may see (name, schedule and contents, status, audience); Recent Runs for those reports only (report, last run, recipients, format); New Report | None | Permission gating and generation as the recipient, the shared queries, formats, email delivery and on-demand download, retention and re-download, what Paused means: §3 step 5, §4, §5, §6. The "How a report is built" card and the page subtitle are removed |
| KPI detail modal (the report model) | The card's name as the title, the paged list behind the number, the page count. Clocked In Today adds "22 of 25 clocked in across the organisation" and groups On Site, Remote, Late, No Clock-Out Yesterday and On Leave | None | "Grouped the way the rules read them": §3 step 3. Paging at 25: §5 |
| Clock-in prompt | Owned by Attendance: the attendance guide's §10 | The attendance guide's §10 | The attendance guide's §10 |
| Attendance figures on Overview and Team | The clocked-in count, the on-time donut and the roster statuses, as in the rows above | None | That the figures are read from the shared roster and always equal My Attendance: §3 step 2, §6 |

On a gated tab (Team, Alerts or Reports for a role without the permission) the screen shows the
page title, a lock, "For Managers" and one line, "This tab is for managers and the CEO." (§11).
The demo's Viewing As switcher is a demo device for showing each role; the real Home resolves the
role from the signed-in employee (§6).

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Home · Overview (`overview`) | The greeting and New, the four KPI cards two to a row, then the role's main chart. Staff: the day strip (Shift Today, Clock-In, Status) before the KPI cards | Export; the date line and the chart captions; Staff: Where and Hours Today in the day strip | New, beside the greeting; a KPI card opens its report model as a bottom sheet | Bottom bar Home; the four tabs along the top. In the demo the role switcher collapses to one button naming the role in view, which opens the four roles as a sheet |
| Home · Team (`team`) | The four KPI cards two to a row, then the roster as person cards: avatar, name and department, a status pill, Clock-In and KPI | The scope line; the Department and Open Tasks columns (department shows under the name; open tasks in the person's sheet) | Tap a person card or a KPI card: a bottom sheet | Bottom bar Home; the four tabs along the top |
| Home · Alerts (`alerts`) | View Dismissed, Alert Rules, New Rule; the four KPI cards two to a row; the category chips; alert cards with a severity pill, Who Can Clear and Over By (a help term: a tap opens it as a sheet) | Alert Sources, 30 Days; the Trigger and Age columns (both in the alert's sheet) | Clear Alert, full width at the foot of the alert's sheet; New Rule opens the rule form as a sheet | Bottom bar Home; the four tabs along the top |
| Home · Reports (`reports`) | New Report, the four KPI cards two to a row, then the report cards one to a row, then Recent Runs as run cards (report, last run, recipients) | The Format column of Recent Runs | New Report; a KPI card opens its list as a sheet | Bottom bar Home; the four tabs along the top |
| KPI detail modal (the report model) | A bottom sheet: the title, then the list as cards (the first column as the card title, a status pill, two label and value pairs) | Columns beyond two per card | Close, at the top of the sheet | The sheet closes back to the tab |
| Clock-in prompt | Owned by Attendance: the attendance guide's §10 | The attendance guide's §10 | Clock In | The attendance guide's §10 |
| Attendance figures on Overview and Team | As in the Overview and Team rows | As in the Overview and Team rows | As in the Overview and Team rows | As in the Overview and Team rows |

The phone shell itself (bottom bar, sheets, the top bar's search and Clock In) is the frontend
foundation's (AJ, FRONTEND_GUIDE §7, §9.2); Home builds its phone layout on it, with less text and
more icons than desktop (kickoff, 01:19 to 01:21).

## 11 · Edge cases

- **Production starts empty.** Until the modules Home reads are built and seeded, the dashboard is
  blank on production; staging shows seeded data. Every card and list renders cleanly at zero
  (the zero-data 360 pattern, §12), so Home does not look broken on day one.
- **A role with no function data** (e.g. a non-partnership role) does not see the pipeline card at
  all, rather than an empty one.
- **A staff member on leave**: clocking is suppressed for the day and the person shows On leave on
  Team, not Absent; the clock-in prompt does not fire.
- **A gated tab**: a staff member opening Team, Alerts or Reports sees the gated state (a lock,
  "For Managers" and one line, §10.1), not an empty screen or an error.
- **A KPI with nothing behind it**: the report model opens to an empty state, not a blank modal.
- **A huge list**: everything pages at 25, including the report models and the Team roster.
- **Timezone and Saturday**: attendance figures follow the attendance policy's working week;
  Saturdays run a shorter shift and read lower by design.
- **Double submit**: clearing an already-cleared alert, or running a report twice, is idempotent and
  does not raise a second audit entry or a duplicate file.

## 12 · Donor code

Ported from `C:\praxis-ls` and `C:\pixie-girl-hub` per REUSE_MAP.md §2.1 (Dashboard) and §3.2.

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/dashboard/kpi_catalog/` (index, `eligibility.js`, `guards.js`) | Keep the whole pattern: self-check at require time, a tile inherits rights and is eligible at read time. Drop `money.js`, `operations.js`, `fleet_warehouse.js`, `sales_procurement.js` (831 loc of KPIs MyCity has no modules for) |
| praxis-ls | `src/modules/dashboard/kpi_catalog/human_capital.js` | Six tiles port almost unchanged: `headcount`, `attendance_today`, `leave_pending`, `vacancies_open`, `payroll_run_state`, `attrition_90d` |
| praxis-ls | `src/modules/dashboard/dashboard/` (`dashboard.service.js`, `repo`) | Band assembly and role config; keep |
| praxis-ls | `client/src/features/dashboard/` | Band layout, tile picker, role-locked tiles; most of it. Logistics control-tower screens do not apply |
| praxis-ls | `src/modules/security/role_kpi/` | Per-role KPI config: scope, default, lock. The tenant-facing dial over the catalogue |
| praxis-ls | `src/modules/master/party-360.service.js` | The zero-data rendering pattern: every figure defaults to 0 and every collection to `[]`, so Home renders for a brand-new tenant |
| praxis-ls | `src/modules/vault/report/` + `services/documents/templates` | Report and letter generation from a template; the report scheduler (cron, recipients) is net-new over it |

The alert-rule engine (threshold rules, severity, Over By, escalation) is largely net-new, built on
the catalogue's eligibility pattern so an alert inherits the clearing permission the rule names.

## 13 · Open questions

- **Role → card layouts.** The exact KPI cards and main chart per role need sign-off from People and
  the CEO. Shipped as catalogue configuration (`role_kpi`); confirm the M1 set.
- **Alert rule catalogue.** Which rules ship in M1, and GE (architecture) to confirm that read-time
  evaluation of cross-module metrics performs at scale; a materialised rollup can be added later if
  needed. Decided for now: read live, with Home owning the engines.
- **Report catalogue and reporting line.** The M1 report set, the formats, and how the reporting
  line selects recipients.
- **Team scope.** Whether "team" means direct reports, the whole department, or a permission-defined
  set, per role. TB is handling the Team tab's commercial sign-off with the client; the tab is
  ratified into §18 (row #86) and is not blocked pending that conversation.
- **Mobile shell.** Home's phone layout is decided in §10.2; the shell it sits in (bottom bar,
  sheets) lands with the frontend foundation (AJ).

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

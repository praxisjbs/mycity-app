# Home build · Decisions sheet (binding for every implementer)

Repo: /home/user/mycity-app (main d65c717). Briefs: ./briefs/*.md (critique.md is the tie-breaker
for facts about the code). This sheet is the tie-breaker for DESIGN. Owner = TB (Tom-Blake Asaah).
Today 17/10/2026. Author initials on every PROGRESS/guide note: `TB`.

## O · Owner answers (asked 17/10/2026, binding)

| # | Answer |
|---|---|
| O1 | Reports: keep `saved_report` + `report_schedule` (1000); add `home_report_run` and the missing columns by fix-forward |
| O2 | Permissions: module sub-area CAPABILITIES; written down as a convention every module owner applies ("each module gets its own"; "update notes and readme; let every other person apply this; it is important") |
| O3 | Forward data through source adapters with notes so later milestones update them |
| O4 | Home writes the shared attendance roster read (used by Home now, My Attendance later) |
| O5 | KPI catalogue + `role_kpi` (per-role defaults and locks) + a PERSONAL card picker |
| O6 | Alerts: push-signal outbox handlers + daily sweeps for time-based metrics |
| O7 | 1099's seeded alert thresholds move out per A26 |
| O8 | Full reports engine: definitions, schedules, generation as recipient, PDF + XLSX, vault, email, numbered runs, history |
| O9 | 5 PRs: foundation, overview, team, alerts, reports (each ticks its own PROGRESS row) |
| O10 | Stacked branches `m1/home-foundation` → `m1/home-overview` → `m1/home-team` → `m1/home-alerts` → `m1/home-reports`, each PR based on the previous |
| O11 | Staging seed also writes TAGGED rows into forward tables so every card shows figures on staging |
| O12 | Home owns the clock-in prompt TRIGGER |

## D · Design calls made by the builder (state them in the guide and the PR bodies)

### D1 Modules and paths
- Three backend modules, the README map's: `src/modules/dashboard` (Overview, KPI catalogue, KPI detail,
  Team, picks, role cards, layout, source adapters), `src/modules/alerts` (rules, alerts, metrics,
  sweeps), `src/modules/reports` (definitions, schedules, runs, generation). All `basePath: "/home"`;
  paths inside each router begin with their noun; literal sub-paths before `/:id`.
- Contract files `packages/contract/schemas/{dashboard,alerts,reports}.js`; every exported name unique
  across the contract (prefix `Home…`); `TABLES` for every object schema. `kpis.js` stays the M2
  Performance file: Home does not use it.
- home.md header becomes `Backend modules | dashboard, alerts, reports` (+ the roster file named).

### D2 Capabilities: the convention (O2) and Home's codes
- Convention, written into README §5.2, BACKEND_GUIDE §5, docs/guides/_TEMPLATE.md (permission row),
  foundation.md §6.3 and identity.md: **a capability is a named authority inside a module, beyond its
  six actions. Code = `<area>.<authority>`, two lower_snake segments (the Roles screen's rule), where
  `<area>` is the module key or a named part of it (`alerts`, `announcements`). Every capability is
  declared ONCE in `src/shared/access/access.catalog.js` CAPABILITY_CATALOG with its module, label and
  description, seeded by its milestone's reference seed (insert-if-absent, the 0449 pattern), checked on
  the route with `requirePermission(<module>, <action>)` FIRST then `requireCapability(code)` (or
  `requireAnyCapability([...])`), exposed on `/me.capabilities`, and mirrored in the shell's tab access
  and ⌘K. A gate fails a `requireCapability` code that is not catalogued, and a catalogued code no seed
  inserts.** Each module guide lists its capabilities in its header row.
- Home codes: `home.team` (Team tab), `home.reports` (build, schedule, run and receive reports),
  `alerts.manage` (create and edit alert rules; the guide's `home.alerts.manage`, renamed to fit the
  two-segment rule and to sit beside `alerts.clear`), `alerts.clear` (existing, 0449: clear or dismiss).
- Grants in 1199 (insert-if-absent): `home.team`, `home.reports` → implementation, operations_people,
  management, head_of_department, manager. `alerts.manage` → implementation, operations_people,
  management. `alerts.clear` += head_of_department, manager (guide §8: managers clear their alerts).
- Clearing needs BOTH: `alerts.clear` (may clear alerts at all, on the route) AND the rule's
  `permission_key` grant (may clear this one, `alerts.mayClear`). CEO passes both.
- Who sees the Alerts tab content: holders of `alerts.clear` or `alerts.manage` (`requireAnyCapability`).
  The list shows alerts of rules the reader may clear, subject within the reader's scope for the rule's
  module (via new `home_alert.subject_employee_id`; NULL subject = all-scope holders only).
- Middleware: `requireCapability` gains `mw.capability = code` (visible to routesOf/tests/gates);
  add `requireAnyCapability(codes)` (CEO passes) with `mw.capabilities = codes`.
- `/me` gains `capabilities: string[]` (declared in identity.js with the code regex moved there; access.js
  imports it). CEO = every code in the `capability` table.

### D3 Gated tabs
- Guide §10.1/§11 (agreed with the client) wins: Home's four tabs are visible to every `home` viewer; a
  tab whose capability the viewer lacks renders the gated state (PageHeader + `EmptyState`
  illustration "Locked", title "For Managers", text "This tab is for managers and the CEO."). ⌘K
  (`screens.js tabVisible`) still hides gated tabs. `app/src/shell/access.ts` changes for Home only.

### D4 Migrations and seeds (all in PR 1)
- `migrations/1140_home_foundation.sql`: everything Home's schema needs for all five PRs:
  - `home_alert_rule`: `name text NOT NULL` (backfill from key), `created_by`, `updated_by` (uuid → app_user), FK/count indexes.
  - `home_alert`: `subject_employee_id uuid REFERENCES employee` (nullable), indexes for open/rule/subject/raised_at.
  - `saved_report`: `archived_at timestamptz`; index on `report_key`.
  - `report_schedule`: `starts_on date`, `run_time time`, `formats text[]` (CHECK ⊆ {pdf,xlsx}, non-empty),
    `recipient_user_ids uuid[]`, unique index one schedule per report, due index `(next_run_at) WHERE active`.
  - `home_report_run` (one row per file = per recipient × format): `home_report_run_id`, `number citext
    UNIQUE`, `saved_report_id`, `report_schedule_id`, `scheduled_for`, `recipient_user_id`, `requested_by`,
    `format`, `status` (pending|done|failed|skipped), `document_id`, `emailed_at`, `error`, `run_at`,
    `finished_at`, timestamps; slot unique index; FK indexes; updated_at trigger.
  - `role_kpi` (`role_kpi_id`, `role_id UNIQUE REFERENCES role ON DELETE CASCADE`, `default_ids text[]`
    ≤ 4, `locked_ids text[]` ⊆ defaults, `updated_by`, timestamps). No `scope_ids` in M1.
  - `home_kpi_pick` (`home_kpi_pick_id`, `user_id UNIQUE REFERENCES app_user ON DELETE CASCADE`,
    `kpi_ids text[]` ≤ 4, timestamps).
  - Every constraint added to an existing table inside a `DO $$` guard; DOWN names all of it.
  - NO index/FK/view on forward tables (A1: 2000+ migrate after 11xx). Requests for owner indexes go in DATABASE_SCHEMA Owes.
- `seeds/reference/1199_seed_home.sql`: capabilities `home.team`, `home.reports`, `alerts.manage` +
  role grants (D2); numbering scheme `report_run` (RPT, 4, "-", never, no period); A26 move-out: DELETE
  1099's three rules only where untouched since seeding (values equal, `IS NOT DISTINCT FROM` for NULL
  window) and no `home_alert` references them; `-- DESTRUCTIVE:` marker; guarded DOWN.
- Numbering type `report_run` also in `src/shared/numbering/schemes.js`, `packages/contract/schemas/settings.js`
  DOC_TYPES, `settings.service.js` DOC_LABELS ("Report Run"); foundation.md change log.
- No `role_kpi` seed (A26): defaults live in code by `home_view`.

### D5 KPI catalogue and picker (O5)
- `src/modules/dashboard/kpi-catalog/` {index, shared, guards, eligibility, resolve}.js + `tiles/{people,work,business,finance}.js`
  (README already maps index/eligibility/guards/tiles; add shared.js and resolve.js to README §5.4).
- Self-check at require time (throws at boot on a half-defined entry); eligibility at read time
  (module view grant + optional capability + sensitive field not masked; CEO all live); entries
  `live | hidden` (hidden = declared, no SQL, flips live in its milestone); values respect scope; money
  as wire strings; ratios keep their denominator; a failing guard returns null and logs.
- Resolution: user pick (`home_kpi_pick`, null = never chosen, [] = chose none) > role_kpi rows of the
  user's effective roles ordered rank DESC, name (defaults concatenated, locks unioned and leading) >
  `HOME_VIEW_DEFAULTS[home_view]` > []. ∩ eligible, dedupe, first 4; a lost card shrinks the row.
- Defaults (each view lists a 5th/6th fallback so hidden M2 cards do not leave three):
  operations: attendance_today, tasks_overdue, expenses_pending, partnerships_active, headcount
  ceo: goals_on_track, approvals_awaiting_you, partnerships_signed_value, alerts_high_open, attendance_today
  partnerships: partnerships_active, partnerships_signed_value, partnerships_quiet_30d, proposals_out
  staff: my_targets_on_track, my_tasks_overdue, my_reviews_due, my_attendance_30d, my_leave_left
- Catalogue = donor brief §4.2/§4.3 list + `my_leave_left` (ess, days left this leave year from
  leave_balance) + Team cards (`team_present`, `team_on_site`, `team_remote`, `team_flags`;
  capability `home.team`, pickable false). Hidden in M1: `goals_on_track`, `my_targets_on_track`,
  `payroll_run_state`.
- Endpoints: `GET /home/kpi-picker`, `PUT /home/kpi-picks {kpi_ids}`, `DELETE /home/kpi-picks` (back to
  role), `GET /home/kpi/:key/meta`, `GET /home/kpi/:key` (paged 25, eligibility re-checked, 404 when not
  eligible, masked), role cards `GET/PUT/DELETE /home/roles/:role_id/kpis` (settings view/edit; the
  Settings · Roles UI for it is M9 and gets a note in foundation.md/MILESTONES M9).
- Prune: outbox handler on `permission.changed`, `field_visibility.changed`, `capability.changed`
  (payload role_id) removes no-longer-eligible ids from `role_kpi`; user picks are filtered at read time.
- Picker UI: new `packages/ui` component via `npm run new:component` (card checklist with order and
  locked cards; worded Move Up / Move Down, no bare arrow icons); opened by a "Choose Cards" button on
  the KPI row (desktop) / page menu item (phone). Added to §10 first.
- REUSE_MAP §3.2 note: role_kpi lands in M1 Home by owner decision (O5).

### D6 Source adapters (O3)
- `src/modules/dashboard/sources/<owner>.source.js`, one per owning module: tasks, goals, reviews,
  partners, expenses, budgets, vacancies, payroll (hidden, no SQL), calendar. Each exports
  `{ module, milestone, owner, tables: { <table>: [columns] }, owes: [..], ...query functions }`.
  Header comment: which milestone owns the tables and that its builder MUST move/replace the query
  and keep the declared columns true. A unit test checks every declared table/column against
  `scripts/check/lib/catalogue.js` (migrated schema) and that each query function names only declared
  columns (gate 6 also checks SQL strings). M0/M1-built sources (organisation, workflow, documents,
  leave, attendance roster) are read through their own service/repo functions, not adapters.
- Notes: DATABASE_SCHEMA "Owes" for M2/M4/M6/M7/M8 gets "Home reads <table.columns> through
  src/modules/dashboard/sources/<x>.source.js: update it in the same PR"; home.md §4 lists the sources.
- Money sums filter `currency = 'NGN'` (shared/money is Naira only), noted.
- All "today" from `shared/time/lagos` (never CURRENT_DATE / now()::date).

### D7 Attendance roster (O4)
- `src/modules/attendance/attendance.roster.js` (LA's module; LA reviews; attendance.md change log):
  `summary(client, { date }, scope)` and `page(client, { date, status }, scope, query)` (pageQuery, 25),
  plus `personal(client, { employee_id, from, to })` for My Attendance-style figures.
- Status vocabulary (one per person per day, precedence): `on_leave` (approved leave covers the day) >
  `late` (first accepted clock_in after start + grace) > `on_site` / `remote` (clocked in; remote when the
  event has no worksite or the employee work_pattern is remote) > `not_in` (expected, working day, no
  clock-in yet) ; plus flag `no_clock_out_yesterday` (yesterday's day closed with a clock_in and no
  clock_out). `field` deferred until LA's field assignments land (noted). Non-working day → expected set empty.
- Source of truth: `attendance_event` (accepted/review), `leave_request` approved, `employee.status='active'`,
  `working_week` + `public_holiday` via `shared/time/working-week`, grace from the employee's
  `attendance_policy` (default 0).
- Indexes Home needs on LA's tables go in DATABASE_SCHEMA M1 Owes, not in 1140, unless trivially
  `IF NOT EXISTS` on M1 tables (allowed: 1140 > 1000): add `attendance_event (occurred_at)`,
  `leave_request (status, starts_on, ends_on)` with a note to LA.

### D8 Alerts (O6, O7)
- Metric registry `src/modules/alerts/alerts.metrics.js` (keys = contract enum `HomeAlertMetric`):
  late_arrivals, missing_clock_out, approval_ageing, document_expiry, confirmation_due,
  contract_ending, partner_inactivity, budget_threshold, recruitment_sla. Each: category, kind
  (count|deadline), window?, subject type, source, owner milestone, default permission_key.
- Engine additions in `src/shared/alerts/alerts.js`: `closeForRule` (rule switched off → open alerts
  dismissed as the rule change, no clearing right needed), `evaluate` direction for deadline metrics
  (breach when days_left <= threshold; `over_by` stores days left; UI shows "N days left"),
  `raise` stores `subject_employee_id`. BACKEND_STRUCTURE §11.1 updated.
- Repo: `enabledRulesForMetric`, rule key generated `<metric>.<slug>` (+ suffix on conflict).
- One Home scheduler `home-alert-sweeps` (daily 06:00 Lagos) running each metric's sweep; push handler
  for `attendance.punched` registered on the agreed spelling (fires when LA emits it). README §5.15
  notes the M7/M8 stub schedulers are superseded by it (files untouched).
- Rules screen: create/edit/switch (alerts.manage); new rule fields Rule Name, Metric, Threshold,
  Window Days (count metrics), Severity, Who Can Clear (permission_key, defaulted per metric).
- "Cleared This Week" counts outcome = 'cleared' only. View Dismissed lists outcome = 'dismissed'.
- `GET /home/alerts/:id` for deep links.

### D9 Reports (O1, O8)
- Report sources registry `src/modules/reports/reports.sources.js`: `daily_attendance`, `leave`,
  `open_alerts`, `headcount`, `overview` (Overview Export), plus forward sources registered
  (tasks, partnerships, expenses, recruitment) that return rows once their tables have data. Each
  source = module + action gate + the same query the screen uses (paged gather) + columns.
- One `home_report_run` row per file; number `report_run` (RPT-0001); event `home.report_run` on
  creation (scheduled or on demand) → outbox handler `reports.generate` builds as the recipient
  (`getAuthUser` + `scopeFor`), PDF via `documents.generate` (doc type `home_report`, `numbering:null`),
  XLSX via `shared/spreadsheet` + `vault.store`; email after the file exists; status pending→done|failed|skipped.
- `vault.defineAccess("home_report_run", …)`: CEO, the recipient, the report owner.
- Schedule = `recurrence` jsonb (shared/time/recurrence.js, no cron) + `starts_on` + `run_time`;
  scheduler `scheduled-reports` (every 5 min, due scan) + handler `scheduled-report`.
- Recipients are users (`recipient_user_ids`); `recipients` emails written for display. `reporting_line` dropped in M1 (noted §13).
- Run Now returns the pending run (document_id null); UI shows Pending/Failed/Download.
- Overview Export = an on-demand run of source `overview` as the caller (PR 5).

### D10 Overview payload, Need You, activity, week
- Typed nullable sections, not free-form blocks: `{ greeting_name, date, clocked_in?, cards[], chart?, donut?,
  day_strip?, pipeline?, goals?, activity?, week?, my_goals?, upcoming_leave?, prompt_clock_in, picker_source }`.
  Copy (titles, captions) lives in the client; the server sends data. Chart per `home_view` in
  `dashboard.layout.js`, eligibility applied (null when the viewer cannot read its module).
- Need You = client `usePaged("GET /api/v1/workflow/mine")` (built) + alerts the reader can clear (count);
  rendered for every role with its empty state.
- Activity Today = `event_log` today, allow-listed keys, module-view filtered, never mail/private events;
  each embedded list ≤ 25 and links to its paged home.
- Your Week = working days of this week: leave (own), public holidays, Saturday short day, calendar
  events and task due dates through sources (M2 forward).
- "New" = a menu of the create actions the reader holds (task, leave request, alert rule, report).

### D11 Clock-in trigger (O12)
- Server flag `prompt_clock_in` on the overview: active employee, working day (Lagos), not on approved
  leave, no accepted clock_in today, and the current session is the caller's first session issued today.
  Client opens Attendance's prompt once; `useClockPrompt` leaves Shell.tsx. Until LA's punch API exists
  the prompt's primary action opens My Attendance. attendance.md change log.

### D12 Staging seed (O11)
- `seeds/staging/60_home.js` (+ `seeds/staging/lib/` helpers): Home's own records through Home's
  services/engine (rules, alerts, reports, runs), attendance events for the real staff today and the last
  14 working days, and forward-table rows written by SQL with deterministic UUIDv5 ids (node:crypto)
  listed in one exported manifest `HOME_STAGING_ROWS` so each owning milestone deletes exactly them when
  its own seed lands. Real people only (by work_email/job_title). Idempotent (run twice = same state).
  Integration test runs it twice against the test DB.

### D13 Frontend
- Keep Home's mock, retyped to the contract (as organisation/settings/ess did). Each PR that mounts a
  route deletes its INTERIM key in `app/src/api/types/home.ts` in the same PR (typecheck trap).
- KPI cards two to a row on a phone; tier-3 copy removed; subtitles per §10; Over By help term;
  phone layouts per §10.2; Native app feel section in every PR body.

### D14 Process
- Migration numbers: Home claims 1140-1149 and 1199 in the M1 block (state in PR 1).
- PR bodies: fill the template; delete the template's commented trailer lines; never use
  `Guide-unchanged:`/`Progress-unchanged:`.
- Node 20 (`/opt/node20/bin`) for `npm run ci`; DB tests with RUN_DB_TESTS=1 against local PG 16 + pgvector.
- No donor/origin words anywhere (provenance gate).
- Tell LA (attendance roster, 1140 indexes, D11), AJ (packages/ui picker component, shell access.ts),
  GE (shared alerts engine, rbac middleware) in the PR bodies.

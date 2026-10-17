# Brief: neighbour guides, roles, seeds and the client record (for building Home)

Scope: what the guides next to Home, the seed machinery, PROGRESS/HANDOFF, the demo, MILESTONES
§3 and §6, and the meeting transcripts say that Home's build must honour. Repo root
`/home/user/mycity-app`; every path below is relative to it. Read-only survey, 17/10/2026.

Owner decisions (binding, numbered as given): 1 merged report tables + fix-forward; 2 capabilities
`home.team`, `home.reports`, `home.alerts.manage` + existing `alerts.clear`, via
`requireCapability`; 3 source adapters per owning module; 4 Home writes `attendance.roster`;
5 KPI catalogue + `role_kpi` + personal picker; 6 outbox handlers + daily sweeps via
`src/shared/alerts/alerts.js`; 7 seeded thresholds (`seeds/reference/1099`) move out (A26);
8 full reports engine; 9 five PRs; 11 staging seed with tagged rows in forward tables;
12 Home owns the clock-in prompt trigger.

---

## 0 · The facts that matter most (read this if nothing else)

1. **Nothing Home reads from attendance or leave exists yet as code.** `src/modules/attendance/*`,
   `leave/*`, `devices/*`, `worksites/*` are all 0-byte stubs; PROGRESS rows #9 My Attendance, #25
   Attendance, #26 Leave, #27 Devices, #28 Worksites are `Not started`. Only the tables exist
   (`migrations/1000_core_operations.sql`) and they do **not** match the attendance guide's §4 names.
   Hence decision 4: Home writes the shared roster read.
2. **Home's backend layout is contested.** `docs/guides/home.md` header says backend module `home`;
   README §5.2/§5.4, the existing stubs and `src/shared/route-map.js` say `dashboard`, `alerts`,
   `reports` (stubs exist: `src/modules/{dashboard,alerts,reports}/*`,
   `src/modules/dashboard/kpi-catalog/{index,eligibility,guards}.js`,
   `kpi-catalog/tiles/{people,work,business,finance}.js`, all empty). The search gate's markers name
   `src/modules/alerts` and `src/modules/reports`. Pick one and fix README, route-map markers and the
   guide in the same PR.
3. **Tab gating today is `manages_people`, not capabilities.** `app/src/shell/access.ts` and its
   server mirror `src/shared/search/screens.js` both say Team = `manages_people || is_ceo`, Alerts
   and Reports = `FULL(me) || manages_people`. The real Operations & People Lead (Cynthia) manages
   nobody, so she would not see Team. Decision 2 must change both files and `/me` (contract `Me` is
   `.strict()` and has no `capabilities`).
4. **A 3-segment capability code is refused by the contract.** `CapabilityCode` in
   `packages/contract/schemas/access.js` is `/^[a-z][a-z_]*\.[a-z][a-z_]*$/`; `home.alerts.manage`
   fails it, so a role holding it could not be saved on Settings · Roles & Permissions
   (`RoleSave.capabilities`). Either name it with two segments or widen the regex (and its tests).
5. **`alerts.js` clears by the rule's `permission_key`, not by `alerts.clear`.** `mayClear()` = CEO
   or a module grant parsed from `rule.permission_key` (`<module>.<action>`, catalogue modules
   only). The seeded capability `alerts.clear` (0449) is checked nowhere yet. Decide how the two
   combine before PR 4.
6. **Team scope is the solid line only.** `req.scope_ids` for `team` = the caller plus everyone below
   them by `employee.line_manager_id` (recursive, `grants-cache.getTeamEmployeeIds`). Dotted lines
   and seat-reports (`line_manager_seat_id`) are not in anyone's team. On the real roster the seven
   marketing officers report to the **vacant** Head Sales & Revenue seat, so they are in nobody's
   team, only `all`.
7. **Staging seeding is manual and goes through services.** `scripts/db/seed.js --staging` runs
   `seeds/staging/NN_*.js` in name order; deploy-gate never runs it (it runs only
   `scripts/db/load-staff.js`). F13 and foundation §6.2 say staging rows go "through each module's
   service"; forward modules (M2, M4, M6, M7, M8) have no services, so decision 11's forward rows
   cannot follow that rule literally. No forward table has a common tag column.
8. **`seeds/reference/1099_seed_core_operations.sql` holds three alert rules and an attendance
   policy**, both business choices A26 forbids; decision 7 moves the rules out (the `Standard`
   attendance policy is LA's, same problem).
9. **Event names in guides drift from code.** Community guide says `community.message.posted`,
   `community.recognition.posted`; the code declares `channel_message.posted`, `recognition.posted`,
   `celebration.posted` (`src/modules/community/community.events.js`). Subscribe to the code's keys.
10. **No numbering scheme for report runs.** `src/shared/numbering/schemes.js` has no
    `home_report_run` (or `report_run`) type; the numbering gate fails any `allocate(client, "<type>")`
    in `src/` or `scripts/` for an unlisted type. Add the type and its `numbering_scheme` row (a
    reference seed may hold numbering schemes, A26).

---

## 1 · Who built what (PROGRESS.md, HANDOFF.md)

### 1.1 PROGRESS state relevant to Home (17/10/2026)

| Row | Screen | Owner | API/UI/Mobile | Status |
|---|---|---|---|---|
| #1 Overview, #2 Alerts, #3 Reports, #86 Team | Home | TB | ☐☐☐ | Not started (AJ built the UI on the mock, 15/10) |
| #9 My Attendance | ESS | AJ | ☐☐☐ | Not started |
| #12 My Leave | ESS | AJ | ☐☐☐ | Not started |
| #14 My Documents | ESS | TB | ☑☑☑ | Built 17/10 |
| #24 Employees, #92 Organogram, #91 Org Chart | People/ESS | TB | ☑☑☑ | Built 17/10 |
| #25 Attendance, #27 Devices, #28 Worksites, #87-#89 | People/ESS | LA | ☐☐☐ | Not started |
| #26 Leave | People | AJ | ☐☐☐ | Not started |
| #15-#17 Staff Community | GE | ☑☑☑ | Built 17/10 |
| #18-#23 Mailbox | GE | Built 17/10 (per guide) |
| M0 | 26 of 27 items done; Operations (backups/offsite) open | | |

Home PROGRESS note (AJ, 15/10): "Frontend built in `app/src/features/home/` against the in-browser
mock API (INTERIM shapes in `app/src/api/types/home.ts`) ... Left: the backend endpoints and
contract, then swap the INTERIM types for `contract.gen.ts`."

M0 notes that bear on Home:
- 16/10 TB: "`1100` lets the alerts code raise an alert with no trigger and returns `over_by` to two
  places." (`migrations/1100_home_alert_columns.sql`: `trigger DROP NOT NULL`, `over_by numeric(18,2)`.)
- 16/10 LA: "Moved deterministic reference SQL to `seeds/reference/` ... `db:migrate` now interleaves
  both folders and the migration gates enforce unique numbers and milestone ownership across both."
- 16/10 TB: "Migration conventions written (`docs/MIGRATIONS.md`) ... and A26 added ... The PR 25
  seeds that hold business choices move out in a fix-forward file."
- 17/10 TB (track D): "`/workflow/mine/count` for Home's Waiting on You" is built.
- 14/10 GE: shared foundation phase 3 includes `alerts`, `notifications/{categories,fanout}`,
  `route-map`; "Home's alert columns aligned in `docs/guides/home.md` (TB)".

### 1.2 HANDOFF.md (15/10, GE's M0 handoff; partly stale)

Still-binding working rules: no project names or "ported from" in code (`scripts/check/provenance.js`);
"Port from the donors, do not write from the map's description ... record every deliberate change in
REUSE_MAP §1.4"; Node 20, Express 4, CommonJS; "Do not touch `src/modules/*` or `migrations/` in
this work unless it is really needed, and ask first. Migrations are LA's." (relevant to decision 4:
the roster read lands next to LA's module). Open items it lists that touch Home: "the lateness
threshold for the auto-query" (client pack, §5.6), "Restricted documents ... need the module's
`edit` grant to open, not just `view`" (§5.7). Lessons: Postgres cannot type an unused parameter
("add parameters only when the clause that uses them is present"); jsonb keeps no key order.

---

## 2 · Roles, `home_view` and `/me` (identity.md §8, seed 0290, identity.service)

### 2.1 The seven roles (`seeds/reference/0290_seed_roles_and_grants.sql`)

| code | name | home_view | rank | `home` grant scope | home actions v c e d a x |
|---|---|---|---|---|---|
| `implementation` | Implementation Team | operations | 100 | all | ✓✓✓✓✓✓ |
| `operations_people` | Operations & People | operations | 90 | all | ✓✓✓✓✓✓ |
| `management` | Management | operations | 80 | all | ✓✓✓✗✓✓ |
| `head_of_department` | Head of Department | partnerships | 60 | team | ✓✓✓✗✓✓ |
| `administrator` | System Administrator | staff | 50 | own | ✓✗✗✗✗✗ |
| `manager` | Line Manager | staff | 40 | team | ✓✗✗✗✗✗ |
| `employee` | Staff | staff | 10 | own | ✓✗✗✗✗✗ |

There is **no `attendance` module key**: attendance, leave, devices and worksites are under `people`
(`src/shared/access/access.catalog.js`: people = "Employees, attendance, leave, devices and
worksites"; README §5.2 `people` → `organisation`, `attendance`, `devices`, `worksites`, `leave`).
The attendance guide's "Permission key(s) `attendance`" is wrong against the catalogue.
`people` grants: implementation/ops all; management all (no delete); head_of_department team (view,
approve, export); manager team (view, approve); administrator and employee none.

### 2.2 How `/me.home_view` is resolved (`src/modules/identity/identity.service.js` ~l.157)

```js
const view = row.is_ceo
  ? "ceo"
  : (roles.find((r) => r.home_view) || { home_view: "staff" }).home_view;
```

Roles come back `ORDER BY r.rank DESC, r.name` (identity.repo), so the highest-ranked role with a
`home_view` wins. Contract: `HomeView = z.enum(["operations", "ceo", "partnerships", "staff"])`
(`packages/contract/schemas/identity.js`); `RoleHomeView = HomeView.exclude(["ceo"])` in
`access.js` ("The CEO's Home is the flag's, never a role's"). `Me` (strict) carries `grants`,
`roles`, `home_view`, `manages_people` ("Does anyone report to this person? Opens Home · Team and
the manager views"), computed as `EXISTS (SELECT 1 FROM employee r WHERE r.line_manager_id =
e.employee_id AND r.status = 'active')`. No `capabilities` field: add it (contract + service +
`npm run gen:contract`) if the shell is to gate tabs on decision 2's capabilities.

### 2.3 The real people (`seeds/staff/roles.json`, organogram §12.1)

`roles.json` maps **job titles**, not names, and applies roles only when the login is created
("a role taken away on screen is not added back by the next deploy"):

```json
"Chief Executive Officer": { "roles": ["management"], "is_ceo": true },
"Program Manager": { "roles": ["management"] },
"Chief Technology Officer": { "roles": ["management", "administrator"] },
"Operations& People Lead": { "roles": ["operations_people"], "work_email": "cynthia@mycityapp.io" },
"Head PR, Markerting & Brand Strategy": { "roles": ["head_of_department"] },
"Back-end Manager": { "roles": ["manager"] },
default: ["employee"]
```

(The typos "Operations& People", "Markerting" match the sheet; `rolesForTitle` folds and word-matches.)

| Person (real) | Post | Roles | home_view | Home scope | manages_people |
|---|---|---|---|---|---|
| Ifeoma Mbonu | CEO | management + `is_ceo` | ceo | all | yes |
| Bode Oluwasanmi | CTO | management, administrator | operations | all | yes (Back-end Manager) |
| Etudor Edidiong | Program Manager | management | operations | all | yes |
| Cynthia Osasere Osakunih | Operations & People Lead | operations_people | operations | all | **no** (reports to Program Manager, assumed) |
| Chinyere Elechi | Head PR, Marketing & Brand Strategy | head_of_department | partnerships | team | yes (3 solid reports) |
| Oladotun Shola-Adido | Back-end Manager | manager | staff | team | yes (2) |
| everyone else (12) | | employee | staff | own | no |

Reporting tree (organogram §12.1, what the deploy loads): CEO → {CTO → Back-end Manager → 2
Content & Listing Associates; Program Manager → {Cynthia (assumed), Chinyere → {Precious Iyeserhen,
Aaron Agama, Similoluwa Michael}, [Vacant] Head Sales & Revenue (assumed parent) → 7 marketing and
growth officers, each with a dotted line to Chinyere}; [Vacant] Technical Assistant}. 18 people, 2
vacant seats.

Consequences for Home:
- Chinyere's `team` = herself + 3 designers; the 7 marketing officers (her dotted reports) are NOT in
  it. The demo's Partnerships persona sees "Marketing, Sales and Content"; the real one will not.
- The CTO gets the Operations Overview (management outranks administrator). Kickoff 01:18:00 said the
  CTO's Home should be about "the health of the whole application" instead. Not modelled anywhere.
- Demo personas are invented (CEO "Ifeoma Chukwu", Partnerships "Ngozi Eze, Marketing and Sales
  Lead", Staff "Tolu Adeyemi, Content"); only "Cynthia Osakunih" is real. Staging must use real
  people (foundation §6.2: "The people are the real staff, never the mock's").

### 2.4 Tab gating today (two mirrored files; change both)

`app/src/shell/access.ts`:
```ts
const FULL = (me: Me) => me.grants.settings?.includes("view") || me.is_ceo;
if (mod.key === "home" && t.slug === "team") return me.manages_people || me.is_ceo;
if (mod.key === "home" && (t.slug === "reports" || t.slug === "alerts")) return FULL(me) || me.manages_people;
```
`src/shared/search/screens.js` `tabVisible(screen, reader)` repeats it ("Mirrors
app/src/shell/access.ts visibleTabs, so search never offers a tab the person's menu hides"). Its
synonyms: overview `["home","dashboard","kpis","needs you","waiting on you"]`, alerts `["alert",
"warnings","issues","red flags"]`, reports `["report","analytics","insights"]`, team `["my team",
"direct reports","reports to me"]`.

---

## 3 · Capabilities (foundation §6.3, 0449, middleware)

Foundation §6.3: "Announcements and alert clearing go to the same roles [Operations & People,
Management, Implementation and the CEO]. All of it is editable on Roles & Permissions; a change is a
`security` event". "A new role starts with every field masked and no capability." Roles add up; a
person has the union of `role_capability` and `user_capability`.

Seed pattern to copy (`seeds/reference/0449_seed_field_visibility_capabilities.sql`):

```sql
INSERT INTO capability (code, name, description)
VALUES
  ('announcements.post', 'Post Announcements', 'Post to the announcements channel and track who has read a post.'),
  ('alerts.clear', 'Clear Alerts', 'Clear or dismiss an alert on Home.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id
  FROM role r CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people', 'management')
   AND c.code IN ('announcements.post', 'alerts.clear')
ON CONFLICT (role_id, capability_id) DO NOTHING;
-- DOWN deletes role_capability rows for those roles, then the capability only when no
-- user_capability or role_capability still references it ("would cascade into their choice").
```

`DO NOTHING`, not `DO UPDATE`, because a person edits these on screen (MIGRATIONS §9). Tables:
`capability(code citext UNIQUE, name, description)` (0020); `role_capability(role_id,
capability_id, granted_by, UNIQUE(role_id, capability_id))` (0400).

Route guard (`src/middleware/rbac.js`):

```js
function requireCapability(code) { ...
  return async function capabilityCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo === true) return next();
    const held = await grantsCache.getCapabilities(pool, req.user.user_id);
    if (!held.includes(code)) throw new AppError("CAPABILITY_REQUIRED", "This needs an authority you do not hold", 403);
    return next();
  };
}
```
Only user so far: `src/modules/announcements/announcements.routes.js`
(`const poster = () => requireCapability("announcements.post");`). It sits **on top of** the module
grant (`requirePermission`), it does not replace it, and it sets no `req.scope`.

Pitfalls for decision 2:
- `CapabilityCode` regex allows exactly two segments (§0 item 4). `home.team` and `home.reports`
  pass; `home.alerts.manage` does not.
- `/me` has no capabilities; the shell cannot gate on them until the contract changes.
- `requireCapability` gives no scope. Team vs all for `home.team` must still come from the `home`
  grant's scope (`req.scope`), or be defined by the capability convention you write down.
- `capability.changed` is a `security: true` event (watchers told, grants cache cleared).

---

## 4 · Team scope (organogram.md, rbac)

Organogram §1: the chart "draws the same `line_manager_id` reporting tree that already decides who
approves whose leave, expenses and tasks". §6: "`dotted_manager_id` ... does not affect permission
scope: approvals of leave, expenses and tasks follow the solid line only". A person reports to a
person (`line_manager_id`) or a seat (`line_manager_seat_id`), never both. Event
`employee.reporting_line_changed` → `grants-cache.bumpTeamVersion()` orphans every cached team.

`src/shared/rbac/scope.js` (use this, never write your own "team"):

```js
//   req.scope      "all" | "team" | "own"
//   req.scope_ids  null for all; employee ids for team (the caller and everyone under them)
const s = scopeClause(scopeOf(req) /* {scope, scope_ids, employee_id} */, { column: "e.employee_id" }, params);
const sql = `SELECT ... FROM employee e WHERE e.status = 'active' ${s.and} ORDER BY ...`;
// all → ""; team/own → "AND e.employee_id = ANY($n::uuid[])"
assertInScope(s, ownerEmployeeId); // 404 (not 403) outside scope
```
"A row whose owner column is NULL is NOT visible under team or own." Team ids come from
`getTeamEmployeeIds` (`WITH RECURSIVE team AS (... JOIN team ON e.line_manager_id =
team.employee_id)`, depth-capped, cached per team version).

Home guide §13 open question "Team scope ... direct reports, the whole department, or a
permission-defined set" is answered by the code only for `team` = recursive solid line. The guide's
§8 "Function lead ... Team for their department" and the demo's department filter are a different
rule.

---

## 5 · Attendance (attendance.md) and what the database really holds

### 5.1 What the guide says (LA, Draft, 15/10)

- Screens: Clock In/Out modal (`clock`), ESS · My Attendance, Work Location Requests, My Devices,
  Policy Updates, People · Attendance (`attendance`, managers team scope), Devices, Worksites,
  Settings · Attendance Policy, Notifications and Alerts.
- §3 step 2: "At sign-in, an active employee without a clock-in sees the Clock In modal. A suspended
  employee cannot enter the app; an employee on approved leave can enter permitted screens but cannot
  punch."
- §3 step 3: expected location from field assignment > approved location request > hybrid schedule >
  registered home > assigned office.
- §6: home fence fixed 100 m; distance == radius is inside; GPS ≤ 50 m good, > 100 m retry; duplicate
  punches refused by idempotency + uniqueness; "Attendance never applies a monetary deduction or
  sanction automatically."
- §7 events: `attendance.punched`, `attendance.review_required`,
  `attendance.location_request.submitted`, `attendance.location_request.decided`,
  `attendance.policy.published`; job "Missing-punch checks 11:00 same day / next morning per policy".
  **No `attendance.rule_breached`** (home.md §3 step 4 and §7 rely on it).
- §8: managers see direct reports (register: "Managers are restricted to direct reports"); People/HR
  organisation; CEO/Operations "where explicitly granted".
- §10.2 Clock modal navigation: "Opens from the floating button's Clock In or Clock Out (F18); on
  desktop from the top bar clock button. After sign-in it opens by itself for anyone not yet clocked
  in, on both shells."
- §11: approved leave rejects clock-in and clock-out with the leave dates; suspended terminated;
  offline unresolved.
- §14 (15/10, AJ): "`ClockButton.tsx` now exports `useClock` ... and `useClockPrompt` (the
  after-sign-in panel, called once by the shell, so it opens on a phone too)".

The statuses Home needs (on site, remote, field, late, no clock-out, on leave) are **not defined in
the attendance guide**; they come from home.md §3 step 3 / §10.1 and the demo.

### 5.2 What migration 1000 actually created (guide §4 names do not exist)

Guide §4 lists `attendance_session`, `attendance_location`, `attendance_assignment`,
`attendance_location_request`, `attendance_case`, `attendance_policy_version`,
`attendance_policy_ack`. **None exist.** `1000_core_operations.sql` has:

```sql
attendance_policy (attendance_policy_id, name UNIQUE, grace_minutes int default 0, earliest_clock_in_minutes 120,
  latest_clock_out_minutes 240, require_known_device, require_geofence, active)
employee_attendance_policy (employee_id, attendance_policy_id, worksite_id, effective_from, effective_to,
  UNIQUE (employee_id, effective_from))
attendance_event (attendance_event_id, employee_id, event_type CHECK IN ('clock_in','clock_out'), occurred_at,
  worksite_id, known_device_id, latitude, longitude, accuracy_m, distance_m,
  source CHECK IN ('pwa','admin','import','system'),
  validation_state CHECK IN ('accepted','review','rejected'), validation jsonb, request_id)
  -- index attendance_event_employee_time_idx (employee_id, occurred_at DESC)
attendance_day (attendance_day_id, employee_id, attendance_date, status text NOT NULL (free text),
  first_clock_in_at, last_clock_out_at, worked_minutes, late_minutes, overtime_minutes, closed_at,
  UNIQUE (employee_id, attendance_date))
attendance_exception (attendance_day_id, exception_type, severity low|medium|high,
  status open|under_review|resolved|dismissed, evidence jsonb, reviewed_by, reviewed_at, resolution)
leave_type (code UNIQUE, name, unit days|hours, policy jsonb, active)
leave_balance (employee_id, leave_type_id, period_start, period_end, opening, accrued, used, adjusted)
leave_request (leave_request_id, employee_id, leave_type_id, starts_on, ends_on, amount numeric(10,2),
  reason, status default 'draft', workflow_instance_id, submitted_at, decided_at)
```

Reference codes (`1099`): `attendance_status` = present, late, absent, leave; `attendance_exception`
= missing_clock_out, outside_worksite, unknown_device; `leave_status` = draft, submitted, approved,
rejected. There is no "remote", "field", "on site" status code, no field-assignment table and no
work-location table. `employee.work_pattern` CHECK is `('on_site','hybrid','remote')` (0110; 0199
fixed the `onsite` spelling); there is no `field` pattern. `worksite` exists (M0). So "Field" on the
roster has no source in the schema today; "Remote vs On Site" can only be inferred from the punch's
`worksite_id`/`distance_m`/`validation` or the employee's `work_pattern`.

### 5.3 Working week (A22) and grace

- A22 (MILESTONES §1.3): "Working week fully configurable per day. Fixed hours 09:00 to 17:00 Monday
  to Friday and 09:00 to 15:00 Saturday, but stored as per-day configuration".
- MILESTONES §6.2: "each day carries its own `{ working, start, end, grace_minutes }`". The table does
  not: `working_week(weekday 1..7 PK, is_working_day, starts_at, ends_at)` (0050); grace lives on
  `attendance_policy.grace_minutes` (default 0). 0199 seeds Saturday 09:00-15:00.
- 13/10 meeting: "Configured a 5-minute grace period before lateness is formally recorded".
- Read through `src/shared/time/working-week.js`:
  ```js
  const cal = await workingWeek.loadCalendar(client);        // once per request or job (cached 60 s)
  workingWeek.isWorkingDay("2026-10-01", cal)                // false: Independence Day
  workingWeek.countWorkingDays("2026-10-01", "2026-10-31", cal)
  ```
  "With no working_week rows (a fresh database) the week is Monday to Friday, 09:00 to 17:00".
  Holidays: `public_holiday` (Nigeria 2026/2027 seeded by `0448`; `expected` flag from `0410`;
  foundation §11: "Attendance and leave count an expected holiday from the start").
- Home §11: "Saturdays run a shorter shift and read lower by design" (the demo's "Dips are
  Saturdays, a half day").
- MILESTONES §6 DoD: "Saturday is a working day in the configuration, and a Saturday punch is judged
  against 09:00 to 15:00 (A22)."

### 5.4 Leave

- Flow `leave.approval` (module `people`, context `days`), seeded in `0499` and
  `shared/workflow/definitions.js` DEFAULTS: stage `line_manager` (48 h), then `operations_people`
  (48 h) when `days > 5`; no line manager → CEO (foundation §6.5, ESS §3 step 5).
- ESS §3 step 5: "approved leave counts down the entitlement and is never counted as absence by
  attendance." Home §11: "clocking is suppressed for the day and the person shows On leave on Team,
  not Absent; the clock-in prompt does not fire."
- The leave module (AJ) is a stub; Home reads `leave_request WHERE status = 'approved' AND
  starts_on <= d AND ends_on >= d`. Note `status` default `'draft'` and no CHECK constraint.

### 5.5 The numbers Home must equal (ESS / My Attendance)

ESS §2 delegates My Attendance to LA ("today, clock events, exceptions"); ESS §13: "the 12 October
notes give AJ a month picker, a chart and table toggle, the lateness percentage on the Late card and
clickable cards paged at 25. LA's My Attendance does not have them yet." The only concrete
definitions today are the mock's (`app/src/api/mock/modules/attendance.ts`):

```ts
// GET /api/v1/attendance/me/summary  (month = ?month or the current month)
worked = mine.filter(h => h.clock_in_at); late = mine.filter(h => h.status === "late");
{ key: "days",   label: "Days Worked",      value: `${worked.length} / ${mine.length}` },
{ key: "ontime", label: "On Time",          value: `${round((worked - late) / worked * 100)}%`, sub: `${late} late` },
{ key: "hours",  label: "Hours This Month", value: `${h}h ${mm}m` },
{ key: "review", label: "Under Review",     value: open cases }
// GET /api/v1/attendance/summary (People · Attendance, scope all|team)
{ in: "Clocked in" `${inn} / ${n}` }, { site: "On Site" }, { remote: "Remote" (matched "Approved home") },
{ field: "On Assignment" }, { late }, { out: "Outside Geofence" }, { missout: "Missing Clock-Out" },
{ recon: "Needs Reconciliation" }; donut_text `${inn} of ${n} have clocked in. ${late} late, ${leave} on approved leave.`
```
Mismatches to settle in the roster definition: the demo's Staff card is "My Attendance, 30d" (rolling
30 days) while My Attendance is per month; the mock's `on_time_pct` is actually clocked-in over
headcount. INTERIM `AttendanceToday` (app/src/api/types/attendance.ts) is the shape the shell's
prompt reads: `state: "not_clocked" | "clocked_in" | "complete" | "unavailable"`,
`unavailable_reason: "leave" | "suspended" | null`, `shift_start`, `shift_end`, `grace_minutes`,
`work_pattern`, `location_label`, `policy_ack_pending`.

### 5.6 The clock-in prompt (decision 12) as built and as asked

Built (AJ, frontend only, mock API): `app/src/features/attendance/ClockButton.tsx`

```tsx
/** After sign-in, the clock panel opens by itself for anyone who has not clocked in today. The shell calls it once. */
export function useClockPrompt() {
  const { today, open } = useClock();                 // GET /api/v1/attendance/me/today
  const { justSignedIn, clearJustSignedIn } = useAuth();
  useEffect(() => {
    if (justSignedIn && today) {
      clearJustSignedIn();
      if (today.state === "not_clocked") setTimeout(() => open(), 700);
    }
  }, [justSignedIn, today, clearJustSignedIn, open]);
}
```
called once in `app/src/shell/Shell.tsx` (`useClockPrompt();`). It fires after **every** sign-in,
not the first of the day, and depends on an attendance endpoint that does not exist.

What the client and team asked (transcripts, §11 below): first sign-in of the day, before the main
page loads, a small modal "Do you want to clock in" with "Yes, clock me in"; skippable (2 a.m. logins);
not shown when already clocked in or on leave; 09:00 push reminder outside the app; 17:00 full-screen
clock-out modal with snooze; auto clock-out at shift end when inactive; no offline clocking.
home.md §3 step 1: "On the first sign-in of the day, Home opens the clock-in prompt (owned by
Attendance; `attendance.clock_in`). This is the only write Home initiates on behalf of another module,
and it goes through the Attendance service, not Home." home.md §10.1 row "Clock-in prompt: Owned by
Attendance: the attendance guide's §10". Decision 12 moves the trigger to Home; both guides need
updating.

---

## 6 · ESS (ess.md) facts Home touches

- ESS has no tables; reads through owning services for the caller's own `employee_id`; "There is no
  parameter that selects another employee."
- Work schedule (§3 step 2): "each day Office, Remote or Off, with hours from the attendance policy
  (09:00 to 17:00, Saturday 09:00 to 15:00) and the place. Attendance judges lateness against the
  same schedule. One source."
- Lateness to payslip (§3 step 3): late punch → auto-query (LA) → My Queries → 48 h response →
  sanction → payroll deduction (M6). MILESTONES §6 DoD: "a late punch raises a query; HR waives it
  and the deduction is restored."
- Coming Soon (§6): "a tab whose module is not yet delivered shows a Coming Soon page naming the
  milestone and date (My Performance M2, My Queries M3, My Payslips M6)". Home's equivalent is the
  gated tab ("For Managers", home.md §10.1) and the zero state (§11), not Coming Soon.
- MyCity runs simple payroll: "staff are treated as contractors and consultants, so no screen
  mentions PAYE or pension, and Payroll sits behind an advanced option" (relevant to the
  `payroll_run_state` tile).
- ESS still cites `docs/MyCity-ERP-Documents/attendance-guide.md`, which does not exist (the guide
  is `docs/guides/attendance.md`).

---

## 7 · Foundation (foundation.md) rules Home must follow

### 7.1 §6.1 The staff roster

"It loads by itself on staging and production. No person runs a command. Each deploy, after
migrations, the loader runs the staff importer ... as the system actor, then applies `roles.json`.
It is idempotent: a person already present (matched by staff number, then work email) is left as the
app has them". "This overrules 'production is never seeded' for the real staff only (TB,
16/10/2026). Demonstration data still never reaches production." "The working hours column ... is
the organisation's working week (A22), set by track C, not per person." "**No email is sent**."

### 7.2 §6.2 Staging demonstration data

"`seeds/staging/` loads the mock's records (F13) through each module's service, for every module that
has a backend, so numbers, audit and events are right. The people are the real staff, never the
mock's. Each later module adds its own staging seed when its routes land. Production never runs it."

### 7.3 §6.7 Search reaches everything

"**Every new screen, action and record type must be searchable**: the search coverage gate (track D)
fails a screen in the route map, an entity type in `ENTITY_ROUTES` or a screen's New action that search
cannot reach, unless it carries a written `search:none <reason>`." Gate details
(`scripts/check/search-coverage.js`): every route-map screen has a search entry whose label equals the
shell's; every `ENTITY_ROUTES` type is declared by a provider or carries `// search:none <reason>`;
every `useScreenAction({ label })` is an action in `shared/search/actions.js`; "A type marked `not
built yet (src/modules/<m>)` fails once that module has a controller and a repo, and a marker on a
type a provider declares fails as stale." Actions open screens with `?action=new` (`useScreenAction`)
or a named `useUrlAction`. Waiting on You is provider `empty` + `pinned` over `/workflow/mine`.

Home's current markers (`src/shared/route-map.js`):
```js
home: ["overview", "alerts", "reports", "team"],
// Home
home_alert: screen("home", "alerts"), // search:none not built yet (src/modules/alerts)
home_report: screen("home", "reports"), // search:none not built yet (src/modules/reports)
home_report_run: screen("home", "reports"), // search:none not built yet (src/modules/reports)
```
No entry for `home_alert_rule` (home.md §9 says rules are searchable). If Home is built as
`src/modules/home`, these markers never fire and must be rewritten by hand.

### 7.4 §3 step 6 and §13: Waiting on You

"Home shows a Waiting on You count when Home's API lands." "D provides the count (`GET
/workflow/mine/count`, built); Home wires it when its API lands (TB, M1)." Response fields
`waiting`, `overdue` (foundation §5 track D).

### 7.5 §6.3, §8 masks and §11 edge cases worth reusing

- Field masks (`shared/rbac/field-mask.js`) "apply to every response, export, import preview and AI
  read"; defaults: salary, bank, personal, statutory visible to ops/management/implementation, CEO
  never masked. A report generated as the recipient must run through the same masks.
- "The roster loader and the deploy step act as the system, never as a person."
- §11: "A search provider that throws: its group is left out and logged; the rest answer." (Same
  stance fits a source adapter whose table is empty or missing.)
- Audit export precedent (§7): `audit.export_requested` → `audit.send_export` builds the workbook
  "(at most 10,000 entries, masked for the person who asked), files it in the vault and emails it to
  them". This is the closest built pattern for Home's report runs.

### 7.6 Track conventions to copy

Each track: one PR, own migration block, one reference seed file at the block's `..49`/`..99`
(`0349`, `0399`, `0449`, `0499`). Shared files that conflict on merge: `docs/PROGRESS.md`,
`README.MD`, `packages/contract/contract.gen.ts` ("regenerate ... with `npm run gen:contract`, never
hand-merge it"), `src/shared/route-map.js`.

---

## 8 · Events Home can show in Activity Today (community, mailbox, others)

Declared in code (`src/modules/*/*.events.js` via `defineEvents`), the keys to subscribe to:

| Module | Keys |
|---|---|
| organisation | `employee.created`, `employee.updated`, `employee.archived`, `employee.restored`, `employee.reporting_line_changed`, `department.created/updated`, `org_seat.created/updated` |
| community | `channel.created`, `channel.members_changed`, `channel_message.posted/reacted/edited/deleted`, `direct_message.sent`, `direct_thread.opened/read/delivered`, **`recognition.posted`**, **`celebration.posted`** |
| announcements | `announcement.created/updated/cancelled/published/reminded` |
| documents | `document.requested`, `document.request_cancelled`, `document.verified` |
| workflow | `workflow.opened/advanced/completed/changes_requested/escalated/cancelled` (shared catalogue), `workflow.definition_saved`, `workflow.reassigned` |
| shared alerts (`ALERTS`, module `home`) | `home.alert_raised`, `home.alert_cleared`, `home.alert_escalated` |
| mailbox | `mail_message.received` etc. (owner-private: never on someone else's Home) |
| identity/security/access/settings | `auth.*`, `access.*`, `role.*`: security events, not Activity |

Guide names that differ: community.md §3/§7 `community.message.posted`,
`community.recognition.posted` ("As above; counted for Home and M2"); code `channel_message.posted`,
`recognition.posted`. Community §3 step 14: "Deleting a recognition also takes it out of the counts
Home and M2 read." `peer_recognition(from_employee_id, to_employee_id, message,
community_message_id, note_written_by_system)` is "Kept separately so M2 performance and Home can
count recognitions". Celebrations: `celebrations` scheduler 05:00 Africa/Lagos posts birthday and
anniversary cards in #general (demo Activity: "Hauwa Yusuf birthday posted 00:01").

All emitted events land in `event_log(event_id, event_key, module_key, entity_type, entity_id,
actor_user_id, payload jsonb, request_id, import_batch_id, occurred_at)` (0030). Mailbox messages are
private to their owner (mailbox §8 "Their own mailbox only", "People, CEO ... No access to other
mailboxes"), so Activity Today must never read `mail_*` events except the viewer's own.

Event key rules (`src/shared/events/catalogue.js`): dotted lower snake_case, at least two segments,
first segment names the thing and picks the notification category; `summary` required and may not
contain an em dash; one module per key ("Two modules claiming one key fail at load"); declare in
`<module>.events.js` with `defineEvents("<permission key>", {...})`. `home.alert_*` already belong to
module `home` in the shared catalogue, so Home's own events file must declare other keys (or the same
keys with module `home`).

---

## 9 · Seeds: how staging and reference seeding work

### 9.1 `scripts/db/seed.js` (the staging runner)

```
npm run db:seed -- --build     synthetic data (seeds/build): local and CI databases   (seeds/build is empty)
npm run db:seed -- --staging   demonstration data (seeds/staging)
```
Refusal (pure `refusals({ mode, appEnv, dbName, marker })`, three independent checks):
`APP_ENV === "production"`; `dbName === "mycity_prod"`; `system_marker.environment` missing/null/
`production` (`--build` also refuses staging; `APP_ENV=staging` with a DB other than `mycity_stg`).
Error `code = "SEED_REFUSED"`, `err.problems`.

File contract (header comment):
```js
// seeds/<build|staging>/NN_name.js
module.exports = async function seed({ pool, actor, log }) {
  // through the services, like any other caller (README §6.1): numbering, audit and
  // events apply. Idempotent: look before creating, so a second run adds nothing.
};
```
- Files run in **name order** (`fs.readdirSync(dir).filter(f => f.endsWith(".js") &&
  !f.endsWith(".test.js")).sort()`), each once per invocation, inside
  `requestContext.run({ requestId: "seed-staging", surface: "script" }, () => fn({ pool: db, actor:
  ACTOR, log }))`.
- `ACTOR = Object.freeze({ user_id: null, source: "script:seed" })` ("every audit row says where it
  came from"). It has no `is_ceo`, no `role_ids`, no `employee_id`: a Home service that checks the
  actor's rights will refuse it; build a seed actor (see `SYSTEM` below) or call internals.
- Not run by deploy: `scripts/deploy/deploy-gate` `migrate()` runs `migrate.js --deploy-gate`, then
  `load-staff.js`, then `catalogue-sync.js`; never `seed.js`. Staging data is loaded by a person
  running `npm run db:seed -- --staging` on staging.
- Exports: `{ refusals, readMarker, seedFiles, seed, main, ACTOR }`.

### 9.2 `seeds/staging/10_staff.js` (the only staging seed)

```js
const { loadStaff } = require("../../scripts/db/load-staff");
module.exports = async function seed({ pool, log }) {
  const result = await loadStaff({ db: pool, log: (m) => log(`staff: ${m}`) });
  if (result.status === "no_sheet") { log("staff: seeds/staff/staff-list.xlsx is not in this build, ..."); return; }
  const counts = result.stats || {};
  log(`staff: ${result.status} (${counts.create || 0} created, ${counts.unchanged || 0} unchanged); ` +
      `logins ${result.logins ? result.logins.created : 0} invited`);
};
```
Header: "Every later module writes its own staging seed when its routes land, and hangs its records
off these people." So Home's file must sort after `10_` (e.g. `60_home.js`), find people by
`staff_number`/`work_email`/`job_title` (never by mock name), and stay idempotent.

### 9.3 `scripts/db/load-staff.js` (roster loader, staging and production)

`loadStaff({ db, log, dryRun = false, sheet = SHEET, rolesFile = ROLES })` →
`{ status: "no_sheet" | "already_loaded" | "previewed" | "loaded", stats?, logins?, batch?, dropped? }`.
Steps: checksum the sheet; skip if a committed `import_batch` with `options->>'source_sha256'` equals
it (then only `applyRoles` and `organisation.advanceStaffNumbers`); else `engine.createBatch(...,
{ options: { keep_existing: true, work_email_by_job_title, source, source_sha256 } })`,
`mappingFor` drops columns whose every filled cell fails (DOB, Phone), `engine.preview`,
`engine.commit({ valid_only: true, create_missing })`, `applyRoles` (login per active employee
without one: `identity.createUserForEmployee(client, { employee_id, email, is_ceo }, SYSTEM)` +
`access.setRoles(client, user_id, roles, SYSTEM)` inside `atomically`), then
`organisation.advanceStaffNumbers`. The system actor:

```js
const SYSTEM = Object.freeze({ user_id: null, name: "System", source: "deploy:staff-roster", is_ceo: true });
```
"it answers as an unrestricted caller. Audit rows carry no user id and the name System". Helper
pattern for one transaction per step:
```js
async function withTx(db, atomically, fn) { const client = await db.connect();
  try { return await atomically(client, () => fn(client)); } finally { client.release(); } }
```
(`atomically` from `src/shared/db/tx.js`; `alerts.raise/clear` throw unless inside it.)

### 9.4 Reference seeds and A26 (MIGRATIONS §9)

`seeds/reference/` runs in every environment, production included. Allowed: system roles with
permissions, numbering schemes for `schemes.js` doc types, validated workflow definitions, code lists
the code switches on, public holidays by law, template defaults. **Not allowed**: "Business choices
MyCity makes: expense categories, partner types and stages, attendance policies, alert thresholds,
leave entitlements, knowledge categories", "Demo or example rows", "Anything 'so the screen isn't
empty'". Rules: `ON CONFLICT (<natural key>) DO UPDATE` or `DO NOTHING`; a row a person edits later
is seeded `DO NOTHING` or `DO UPDATE ... WHERE` it still holds the old seeded value; numbering rows
only for `schemes.js` types; roles come with permission rows.

Gate 3 (`scripts/check/migration-numbers.js`): M1 owns 1000-1999 across `migrations/` **and**
`seeds/reference/` (unique numbers across both; reference files must contain `_seed_`, schema files
must not; on a milestone branch a new file outside the block fails). Taken in M1: `1000` (schema),
`1099` (seed), `1100`, `1110`, `1120`, `1130`. Gate 4: `-- UP`/`-- DOWN`, `-- DESTRUCTIVE: <reason>`
on destructive steps. Gate 5: re-apply clean; a merged migration is never edited.

What 1099 holds today (decision 7 targets the third block):
```sql
INSERT INTO home_alert_rule (key, metric, threshold, window_days, severity, permission_key, enabled)
VALUES
  ('attendance.absence', 'absence_count', 1, 1, 'high', 'people.view', true),
  ('attendance.lateness', 'late_count', 3, 30, 'medium', 'people.view', true),
  ('leave.pending', 'pending_days', 2, NULL, 'medium', 'people.approve', true)
ON CONFLICT (key) DO UPDATE SET ... enabled = true;
-- also: reference_value rows (attendance_status, attendance_exception, leave_status,
-- notification_category: attendance, leave, community) and attendance_policy 'Standard'
-- (grace 0, require_known_device, require_geofence)
```
1099 is merged, so it cannot be edited (gate 5): the move-out is a fix-forward file in the M1 block
that deletes these rows where they still hold the seeded values (no alert has been raised yet:
1100's header says "No release has raised an alert yet"), with a DOWN that restores them. The rules
then come from Home · Alerts on screen or the staging seed. Note `home_alert` has an FK to the rule,
so delete only rules with no alerts.

### 9.5 Decision 11: forward rows on staging, what the schema allows

Forward modules have no services (stubs), so the F13 "through the services" rule cannot hold for
them; the forward tables Home reads, and what a seed must satisfy:

| Table (migration) | NOT NULL / FK a seed must fill | Number? | Tag column? |
|---|---|---|---|
| `task` (2000) | `title`, `created_by` → `app_user`, status default `todo` | no | none |
| `organisational_goal` (2000) | `level` (organisation/department/team/role/individual), `title`, `starts_on`, `ends_on`, `owner_employee_id` | no | none |
| `kpi_definition`, `employee_target` (2000) | target: `employee_id`, `title`, `weight` (0-100] | no | none |
| `vacancy` (4000) | `number` UNIQUE, `title`, `slug` UNIQUE, `description`, `created_by` | `vacancy` in schemes.js | none |
| `application` (4000) | `vacancy_id`, `candidate_id` (→ `candidate`) | no | none (`answers` jsonb) |
| `partner` (7000) | `number` UNIQUE, `name`, `partner_type` | `partner` row seeded by 7099, **not in schemes.js** | `metadata jsonb` |
| `partnership_opportunity` (7000) | `number`, `partner_id`, `title` | 7099 row, not in schemes.js | none |
| `partner_interaction` (7000) | `partner_id`, `interaction_type`, `subject`, `occurred_at` | no | none |
| `budget`, `budget_line` (8000) | budget: `number`, `name`, `currency`, `starts_on`, `ends_on`; line: `expense_category_id`, `amount` | 8099 row, not in schemes.js | none |
| `expense_request` (8000) | `number`, `employee_id`, `expense_category_id`, `purpose`, `amount`, `currency` | `expense` in schemes.js (8099 seeds `expense_request` too) | none |
| payroll (M6) | **no tables**: "Payroll schema is deliberately deferred" (PROGRESS 15/10 LA) | | |

`expense_category` rows are seeded by 8099 (a business choice under A26; may move out later, which
would break a staging seed that assumes them). Numbering gate scans only `src/` and `scripts/`, so a
seed under `seeds/` that allocates `partner` is not gated, but the runtime needs the
`numbering_scheme` row. "Tagged" has no schema support: options are a Home-owned registry table of
seeded rows, `metadata` where it exists, or a recognisable title/number prefix. Record the choice in
home.md and in each adapter's notes so M2/M4/M7/M8 owners can delete or replace the rows.

---

## 10 · The demo (`docs/MyCity-ERP-Documents/demo.html`, look only)

Home code: lines ~1789-2152 (`HROLE`, `HROLES`, `HSEES`, `homeOverview`, `opsOverview`,
`ceoOverview`, `partnerOverview`, `staffOverview`, `homeTeam`, `homeAlerts`, `homeReports`,
`hmodal`, `ruleForm`, `openRuleModal`, `bindHome`). CSS at ~933. Date in view: Friday 09/10/2026.
"All data here is mock, seeded for the staging preview." Never take data or field names from it.

Role switcher ("Viewing As", a demo device): ops (Cynthia Osakunih, Operations and People Lead), ceo,
partner, staff. `HSEES = {team, alerts, reports: {ops:1, ceo:1, partner:1, staff:0}}`; a gated tab
renders the page title and `emptyb('lock','For Managers', 'This tab is for managers and the CEO.')`.

### 10.1 Overview per role

| Role | Header | Four KPI cards (each opens a modal) | Main visual | Rest |
|---|---|---|---|---|
| Operations | "Good Morning, Cynthia", "Friday, 09/10/2026 · 22 of 25 clocked in", Export, New | Clocked In Today 22/25 (88% · 3 late), Overdue Tasks 7, Awaiting Approval ₦1.84M (5 requests · 2 with CEO), Active Partnerships 23 | Area "Attendance, 14 Working Days" with "Dips are Saturdays, a half day."; donut 87% on time "37 on time, 4 late, 7 absent this month." | Need You (Request, From, Amount, Stage; "5 pending"); Partnership Pipeline bars (Contacted, In discussion, Proposal sent, MOU drafted, Signed) with "4 with no contact in 30 days."; Goals This Quarter (6 bars); Activity Today (5 items: expense raised, query raised by rule, new device punch, birthday posted, payroll submitted); Your Week (Mon to Sat, Diary/Task/Note pills; Sat "Half day, 09:00 to 15:00") |
| CEO | greeting, date, Export, New | Goals on Track 4 of 6, Awaiting Your Approval ₦1.26M, Signed Value FY ₦9.2M of ₦18M, Open High Alerts 3 | Bars "Organisational Goals"; donut org KPI 76 "People 81, Finance 82, Content 76, Partnerships 61, Support 76." | Need You (2 "With you"), Partnership Pipeline, Activity Today (payroll for sign-off, request ageing, oldest alert, targets closing), Your Week |
| Partnerships | greeting, date | Active Partnerships 23, Signed Value ₦9.2M, No Contact 30 Days + 4, Proposals Out 2 | Pipeline bars; area "Monthly Signed Value, ₦M" | Need You variant partnerships (Partnership, Stage, Quiet, Owner; "4 going quiet"); Your Week. No attendance card, no Activity Today |
| Staff | greeting, date (no Export/New) | stat strip first: Shift Today, Clock-In, Where (desktop), Status, Hours Today (desktop); cards Pieces Published 18 of 24, Channel Growth +6.2%, Reviews Filed 2 of 4, My Attendance 30d 20/20 | My Goals This Quarter bars; Upcoming Leave card (22 to 24 Dec, Balance 12 days) | Your Week. **No Need You** (guide §6 says Need You is present for every role) |

### 10.2 Team (gated)

Scope line ("The whole organisation" or "Marketing, Sales and Content" for partner, who sees only
those departments). Cards: Present Today x / n ("1 on leave"), On Site, Remote, Flags (late + no
clock-out). Team Roster table: Employee (avatar, name, department), Department, Today (pill: On time,
Late 3rd, Remote, New device, On leave, No clock-out 08/10), Clock-In, KPI %, Open Tasks; a row opens
a person modal (pills, stat strip Attendance 30d, KPI Score, Open Tasks, Leave Left, Open Queries;
Recent Punches). Attendance This Month bars by person (KPI% < 70 drawn in warning).

### 10.3 Alerts (gated)

Header actions View Dismissed, Alert Rules, New Rule. Cards Open Alerts, Needs You, Overdue 7 Days +,
Cleared This Week. Category chips All, Attendance, Partnerships, Approvals, Documents, People,
Budget. Table: Alert, Trigger, Who Can Clear, Age, Over By (help term), Severity. 12 mock alerts across
attendance rule, missing punch, device policy, partnership inactivity, approval ageing, document
expiry, contract renewal, confirmation due, budget threshold, payroll cycle, recruitment SLA; Over By
shapes "+1 over 3", "1 day open", "44 days left", "90 days notice", "due today". Partner sees only
partnership alerts. "Alert Sources, 30 Days" bars (desktop only). Row modal: kv Trigger, Who Can
Clear, Age, Over By, Severity; Close, Edit Rule, Clear Alert. Rule form: Rule Name, Metric (Late
arrivals, Partnership inactivity, Approval ageing, Document expiry, Budget threshold), Threshold,
Window Days, Severity (Low/Medium/High), Cancel, Create Rule. Rules list: one switch per rule, toast
"Rule disabled, its alerts cleared".

### 10.4 Reports (gated, cards filtered by role)

Header New Report. Cards Scheduled, Paused, Runs This Month, Recipients. Report tiles: Daily
attendance (weekdays 18:00, ops+ceo), Weekly productivity (Mon 08:00), Recruitment pipeline
(Fridays), Partnership pipeline (monthly, Paused; ops, ceo, partner), Monthly expenses (first working
day), Pending approvals (daily 09:00 to whoever holds one). Each tile: name, cadence, status pill,
audience pill. Recent Runs: Report, Last Run, Recipients, Format (PDF, XLSX). Partner sees only
Partnership pipeline and its runs.

### 10.5 KPI detail modal

Clocked In Today: "22 of 25 clocked in across the organisation." then grouped tables On Site, Remote,
Late, No Clock-Out Yesterday, On Leave, each Employee, Mode, Clock-In, Status; page note "n of n".
Every card key has a modal (`overdue`, `approval`, `partnerships`, `signed`, `stale`, `proposals`,
`goals`, `alerts_high`, `al_*`, `rp_*`, `sk0`-`sk3`); unknown key falls back to "No detail is wired
for this card yet."

---

## 11 · MILESTONES §3 (gates) and §6 (M1)

### 11.1 Gates table (`npm run ci` runs all; reports every failure)

| # | Gate | Refuses | From |
|---|---|---|---|
| 1 | Lint | ESLint incl. local rules | M0 |
| 2 | Test | Jest (backend) and Vitest (frontend), the whole suite | M0 |
| 3 | Migration numbering | duplicate or out-of-order numbers | M0 |
| 4 | Migration reversibility | no `-- DOWN` | M0 |
| 5 | Migration idempotency | fails on second apply | M0 |
| 6 | Schema drift | a query naming a column the schema lacks | M0 |
| 7 | Write routes validated | POST/PATCH/DELETE with no Zod validator | M0 |
| 8 | Five-second rule | system explanations on a screen; support text open; word limits; chrome not Title Case | M0 |
| 9 | AI manifest coverage | module with records and no `<module>.ai.js` or `// ai:none <reason>` | M1 |
| 10 | Search coverage | route, tab or record module with no `.search.js` or `// search:none <reason>` | M1 |
| 11 | Two shells | stretched mobile or shrunk desktop; sideways scroll; table or sub-44 px target on a phone; wordy first phone screen | M1 |
| 12 | Inline validation, one form system | submit-only errors; a field built outside the shared form components | M1 |
| 13 | Palette | raw hex outside tokens (incl. `#FFCD05`, `#004F70`) | M1 |
| 14 | Contrast | text pair below AA in either theme | M1 |
| 15 | Day-first dates | `<input type="date">`, `toLocaleDateString()` with no locale, ISO on a human surface | M1 |
| 16 | No native dialogs | `window.confirm/alert/prompt` and aliases | M1 |
| 17 | No dashes | em dash or double dash in copy a user reads | M1 |
| 18 | Upload engine | raw `<input type="file">`, drop zone with no percentage | M1 |
| 19 | AI read manifest | module with records and no read manifest (no writes, A23) | M4 |
| 20 | Money | float arithmetic on money; money column not `numeric(18,2)` | M6 |

Gate 8 limits (`scripts/check/lib/copy.js`): page title 3 words, subtitle 8 (desktop only), card title
4, button 3, toast 8, help 35, any sentence 20, first phone screen 40. "Hidden is not deleted: help
text stays in the DOM, linked with `aria-describedby`, never inside a label's or heading's accessible
name." Gate 11: "no subtitles or chart captions" on a phone. Gate 12: "a mark on the field with at most
four words". Gates 9 and 10: "A module written in M1 without one is invisible to the M10 assistant.
Under A23 a manifest declares **reads only** ... A manifest that declares a write fails gate 19."
Also used in CI here: schema-drift covers SQL strings in `src/` and `scripts/` only (not `seeds/`);
numbering-schemes covers `src/` and `scripts/`.

### 11.2 §6.1 Dashboard (TB), verbatim essentials

"Management dashboard plus a personal dashboard per employee. Built on a **KPI catalogue**: a tile
declares its id, grant gate and value source; eligibility is **computed at read time**, so a tile
inherits rights and never grants them, and revoking a module silently retires its tiles from pickers
and role configs. The catalogue self-checks at require time and throws at boot on a half-defined
entry." Port `kpi_catalog/index.js` (221), `eligibility.js` (97), `guards.js` (54), `shared.js` (98),
`resolve.js` (172), `human_capital.js` (247; tiles `headcount`, `attendance_today`, `leave_pending`,
`vacancies_open`, `payroll_run_state`, `attrition_90d`), `dashboard.service.js` (314),
`dashboard.repo.js` (295). "**Do not port** `money.js`, `operations.js`, `fleet_warehouse.js`,
`sales_procurement.js` ... **There is no sales in this product.** Partnerships are not sales and must
not be modelled as them." "Net-new tiles: partnership pipeline, pending expenses, budget versus
actual, pending documentation, upcoming confirmations and reviews." (home.md §12 also lists
`src/modules/security/role_kpi/` and `party-360.service.js`; MILESTONES §6.1 omits `shared.js` and
`resolve.js` from home.md's list, and home.md omits them from MILESTONES's.)

### 11.3 §6.2 Clock-in (LA) items that feed the roster

`hr.geofence` = off|warn|block (default warn); `hr.device_policy` off|warn|block (default off; devices
still register); "Remote, hybrid and on-site are work patterns on the employee, not separate code
paths"; A22 per-day week; `lateness.calc.js` "pro-rates monthly salary over the working days in the
month, so a six-day week changes the daily rate"; `attendance.query.js` "auto-query on a late punch,
upserted on `(employee, work_date, rule)`".

### 11.4 §6 Definition of done (M1, demo Mon 19 Oct)

"Management dashboard renders with role-locked tiles and no sales anywhere. An employee clocks in and
out on a phone with GPS and device validation; a late punch raises a query; HR waives it and the
deduction is restored. ... **A colleague is recognised from the plus menu ... a seeded birthday
produces its card that morning** (A19, A20). ... **Saturday is a working day in the configuration,
and a Saturday punch is judged against 09:00 to 15:00** (A22). All of it on both shells. Gates 1-18
green." Schedule: M1 "9-19 Oct. Demo Mon 19 Oct".

### 11.5 Other MILESTONES points

- A5: "Live = clean. No seed, no fixtures, no demo rows, ever." A23: "AI reads, never writes."
- A26 (16/10, amended 17/10 for holidays): "Reference seeds hold only what the code cannot run
  without ... attendance policies and alert thresholds are entered by MyCity on their screens or
  through the import engine ... The PR 25 seeds that hold business choices move out in a fix-forward
  file."
- §18.1: "**Home, not Command Centre or Dashboard.**" "**Alerts and notifications are different
  screens.** An alert is work nobody has done; it ages and needs a permission to clear. A
  notification is something that happened to you; it is read once." "A tab's label is chrome. A
  tab's value is a URL."
- §18 ratification 13/10: Team "reuses the `home` permission key, so the command menu and permission
  registry pick it up". Decision 2 changes that; record it.

---

## 12 · What the meetings said (quotes with timestamps)

Kickoff, 12/10/2026 12:30 WAT (`Project kickoff ... 2026_10_12 12_30 ...md`):
- 01:07:00 TB: "I changed the name from command center to home ... on your home, you would have like a
  full dashboard. You'll be able to see attendance over the past weeks ... all the things that need
  you this week ... the partnership pipeline. You would see uh your week."
- 01:08:07 TB: "we may not focus on attendance in the long run but knowing that ... their main
  objective is performance ... we can have more of the KPIs connected to the organizational goals and
  the individual goals ... the dashboard is going to be ... role sensitive ... each person is going to
  have a different view of the dashboard ... their KPIs and maybe their main chart, but then need you
  remains the same for everybody."
- 01:09:44 TB: "Partnerships in the pipeline will not appear for someone who ... isn't concerned with
  partnerships ... your week ... can appear for anyone because it just shows the task that have been
  assigned to you ... under alerts ... we set rules and we are able to control each of the rules".
- 01:11:05 TB: "attendance rule let's say three late arrivals in 30 days that's a rule ... nobody has
  cleared it you're going to come and see here that this rule has not been cleared".
- 01:12:16 TB: "you arrange ... the reporting line ... you want to receive the report in your mail as a
  PDF or as an Excel ... you can automate it to give you that report probably every Monday and then
  you can pick who the report should go to ... only for managers ... anybody who holds a managerial
  title and for the CEO".
- 01:13:22 TB: "the manager in charge of partnerships would not be able to set a report for attendance
  because it doesn't fall within his permitted ... modules ... it's going to check the permissions
  first of all before even displaying a module front end ... he wouldn't see the card for daily
  attendance".
- 01:14:33 TB: "partnership inactivity when a partnership has no active ... interaction ... not added
  any comments ... not made any review ... more than ... 30 days ... once it gets to 34 days, you can
  see this four here."
- 01:15:31 TB: "this module should have been the very last module that we would build ... it falls
  under milestone one ... we have uh uh role locked KPI ts ... We're going to see data for the staging
  ... but for the live the seated data wouldn't be there".
- 01:16:45 TB: "the dashboard will be properly wired when all the other modules are ready ... I just
  need to know ... the schema of her clock in and clock out experience ... I'll query the particular
  table name and get some particular columns".
- 01:18:00 TB: "the CEO is not going to have the same view as uh Cintia ... they have uh the CTO that's
  the IT department I mean they may not really have a lot to do here because theirs will have to do
  more with the health of the whole application".
- 01:23:43 TB: "we are going to seed the data into the staging ... nothing is hardcoded actually ... 22
  on 25 and all of that we are going to have mock data seeded"; 01:24:59 "The pro production server
  will show a blank"; 01:25:46 "The code is not uh nothing is hardcoded there. Everything is read from
  the database".
- Summary block: "Tom-Blake Asaah restricted report generation modules exclusively to managers and the
  CEO." "The staging database utilizes mock data to test dashboard visualizations prior to live
  deployment."

Module demos, 12/10/2026 17:32 WAT (`Module demos for milestone 1 ...md`):
- 00:58:30 TB: "on their first login of each day ... before it loads the main page, there is a UI that
  immediately shows you the option of clocking in ... at your end of the day if you are still clocked
  in it clocks you out. But if you are not clocked in for that day it ignores."
- 00:59:35 TB: "once five reaches because your work ends at 5 it clocks you out automatically ... if
  the person is actually still on the app ... we can make a popup ... Do you need more time".
- 01:00:42 TB: "a small model that is going to open and asks them if they want to clock in ... you can
  be able to skip ... opening the app ... at 2:00 a.m. or 3:00 a.m."
- 01:01:41 TB: "9:00 a.m. if they are on the app and they are not clocked in, then it can immediately
  remind them ... or ... a push notification ... no one should have an excuse of not clocking in."
- 01:03:52 (summary): no offline clock-in; "requiring an active connection for signing and clocking in".
- 01:06:45 (summary): "the next meeting demo must display the 9:00 AM clock-in and 5:00 PM clock-out
  pop-up models covering the entire screen".
- 01:17:22 TB: "for each employee on their dashboard they wouldn't see a KPI card on clocking in ...
  clocked in today is showing here because Cynthia is the people's manager."
- 01:18:23 TB: "once an employee signs in. No, they would have their own dashboard."
- 01:19:50 TB: "once you click on each of these reports they are supposed to open a model ... That one is
  on me." Action: "Build Report Models: ... clicking on attendance dashboard metrics ... onsite, remote,
  late, and missing clock out categories."
- 01:21:01 JBS Praxis: the work schedule "will help us with the leave ... So it doesn't affect their
  payroll." 01:31:43 (summary): attendance must check leave records; suspension without pay or
  dismissal are "automatically marked absent and blocked from accessing their accounts".
- 01:27:31 TB: "this is only for HR or anybody who has uh access to the uh people module. So the CEO
  ... can see and do everything that the HR can do ... On our KPI cards, all the KPI cards, once you
  click on them, they should be able to open a model." 01:28:20: "Once you click on onsite ... Remote
  ... Late ... no clock out ... a model that actually opens and shows you the list."
- 01:44:24 TB: "the popup model should be very clear." 01:45:49 TB: "It's 9:00 a.m. Do you want to
  clock in and you just have a yes, clock me in button? But if the person is already clocked in, that
  pop-up model doesn't pop up. Same thing at five ... remind me again in this amount of time ... it's a
  push notification once you're out of the app." Then JBS Praxis raises a team attendance view for
  direct managers.
- 01:46:57 TB: "There's no place that managers can monitor their teams ... not only attendance ... to
  monitor your teams everything ... people is only for HR and probably CEO ... I don't want us to add
  ... we have 15 uh modules ... Either the workspace or the home and then now they can view like all
  their team members." 01:48:15: "the organagram is going to help us a lot". (Origin of the Team tab.)
- Pagination: "The pagination rule is established at 25 items per page across module views."

Attendance and device review with the client, 13/10/2026 14:50 WAT:
- Summary: "The ESS app triggers automatic clock-in prompts and 9:00 a.m. push notifications";
  "Configured a 5-minute grace period before lateness is formally recorded in audit logs."
- 00:09:04 (summary): MTN head office geofence 100 m. 00:26:25/00:29:11: permanent and temporary work
  sites; "three hybrid staff, while the majority of staff work remotely or on the field".
- 00:33:30 (summary): "an automated prompt requiring employees to clock in immediately upon signing into
  the application would reduce disputes".
- 00:34:33 (summary): "scheduled push notifications at start times (e.g., 9:00 a.m.) and a full-screen
  blocking modal at closing time that requires employee interaction to clock out, featuring a snooze".
- Deferred: remote staff home address registration (Cynthia to finalise).

Earlier:
- Client discovery 02/09/2026: summary "a centralized dashboard for business intelligence ...
  role-based access control provide data-driven oversight"; 00:53:11 Cynthia: "I like the fact that
  there's a reporting dashboard"; 01:13:39 Cynthia: "the reporting budget against actual expenditures.
  I would like to monitor all of that."
- Planning 08/10/2026 (00:13:25 summary): "a management dashboard with KPIs and reports, alongside
  individual employee dashboards"; JBS Praxis: "you go to the dashboard and you start telling me that
  on our dashboard we should have sales ... We should not view it as that."

---

## 13 · Home's own tables as merged (context for decisions 1 and 7)

`migrations/1000_core_operations.sql`:
```sql
home_alert_rule (home_alert_rule_id uuid PK, key citext UNIQUE, metric text, threshold numeric,
  window_days int (NULL or > 0), severity low|medium|high, permission_key text, enabled bool, created_at, updated_at)
  -- no scope, no created_by, no name/title (home.md §4 lists scope and created_by; the demo's form has Rule Name)
home_alert (home_alert_id PK, home_alert_rule_id FK NOT NULL, subject_type, subject_id text, title, trigger,
  severity, over_by, raised_at, last_seen_at, escalated_at, cleared_at, cleared_by FK app_user,
  outcome cleared|dismissed, note, created_at, updated_at)
  -- UNIQUE INDEX home_alert_open_subject_uq (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL
  -- 1100: trigger DROP NOT NULL; over_by numeric(18,2)
saved_report (saved_report_id PK, owner_user_id FK NOT NULL, name, report_key, definition jsonb, shared bool,
  UNIQUE (owner_user_id, name))
report_schedule (report_schedule_id PK, saved_report_id FK ON DELETE CASCADE, recurrence jsonb,
  timezone default 'Africa/Lagos', recipients citext[] NOT NULL, active bool, last_run_at, next_run_at)
```
home.md §4 instead names `home_report` and `home_report_run`; decision 1 keeps `saved_report` +
`report_schedule` and adds `home_report_run` (plus missing columns) fix-forward in 1000-1999.
`alerts.js` header documents the alert tables as above ("Home's M1 migration; BACKEND_STRUCTURE
§11.1"). The `ALERT_COLUMNS` list it selects must keep existing.

## 14 · Conflicts found (docs vs code vs owner decisions)

1. **Backend module name.** home.md "Backend modules `home`" vs README §5.2/§5.4 (`dashboard`,
   `alerts`, `reports`), the stub directories, and route-map markers `src/modules/alerts`,
   `src/modules/reports`.
2. **Report tables.** home.md §4/§5 `home_report`, `home_report_run`, `GET /reports/:id/runs` vs
   migration 1000 `saved_report`/`report_schedule` (decision 1) and the INTERIM frontend
   `GET /api/v1/home/report-runs`, `/reports/summary`, `/alerts/summary`, `/team/summary`,
   `/kpi/:key/meta` (app/src/api/types/home.ts), none of which are in home.md §5.
3. **`home_alert_rule` columns.** home.md §4 lists `scope`, `created_by`; 1000 has neither, nor a
   rule name.
4. **Permission keys.** home.md header lists permissions `home.team`, `home.alerts`,
   `home.alerts.manage`, `home.reports`; the access catalogue has only module `home` with six actions;
   §18 ratification says Team "reuses the `home` permission key"; decision 2 makes them capabilities;
   the contract `CapabilityCode` regex rejects the three-segment `home.alerts.manage`.
5. **Who may clear an alert.** `alerts.js mayClear` = CEO or the module grant named by
   `rule.permission_key`; foundation §6.3 / 0449 seed capability `alerts.clear` (ops, management,
   implementation); decision 2 lists `alerts.clear` with `requireCapability`. A Head of Department
   holds `partnerships.approve` but not `alerts.clear`, yet home.md §8 says function leads clear their
   own alerts.
6. **Tab gating.** home.md §8 (People/Operations see Team across the organisation) vs
   `app/src/shell/access.ts` and `src/shared/search/screens.js` (Team only when `manages_people` or
   CEO; Cynthia manages nobody). `/me` has no capabilities and `Me` is strict.
7. **Team scope.** home.md §8 "Team for their department" and the demo's department filter vs
   `team` scope = recursive solid reporting line (`grants-cache`), with dotted lines and seat-reports
   excluded (organogram §6).
8. **Attendance permission key.** attendance.md "`attendance`" vs catalogue (`people` covers
   attendance, leave, devices, worksites).
9. **Attendance tables.** attendance.md §4 (`attendance_session`, `attendance_location`,
   `attendance_assignment`, `attendance_case`, policy versions/acks) vs 1000 (`attendance_event`,
   `attendance_day`, `attendance_exception`, `attendance_policy`, `employee_attendance_policy`). No
   table supports "Field" or a location request.
10. **Roster statuses.** home.md (on site, remote, field, late, no clock-out, on leave) vs 1099 codes
    (present, late, absent, leave; exceptions missing_clock_out, outside_worksite, unknown_device) vs
    `employee.work_pattern` (on_site, hybrid, remote) vs the mock (Office-only, Hybrid, Remote, Field).
11. **Signals.** home.md §3 step 4 / §7 need `attendance.rule_breached`, `partnership.inactive`,
    `approval.aged`, `document.expiring`, `recruitment.sla_missed`, `budget.threshold`; none is
    declared anywhere; attendance.md §7 has no rule-breach event. Decision 6 (daily sweeps) covers
    the time-based ones.
12. **Community event names.** community.md `community.message.posted`,
    `community.recognition.posted` vs code `channel_message.posted`, `recognition.posted`,
    `celebration.posted`.
13. **Clock-in prompt owner and trigger.** home.md §2/§3/§10 and attendance.md §10.2 say Attendance
    owns it and it opens "after sign-in"; the shell's `useClockPrompt` fires after every sign-in;
    the meetings say first sign-in of the day; decision 12 gives the trigger to Home.
14. **Grace and the working week.** MILESTONES §6.2 puts `grace_minutes` on each working-week day;
    `working_week` has no such column; `attendance_policy.grace_minutes` defaults 0; the 13/10 client
    meeting agreed 5 minutes.
15. **Staging seed path.** foundation §6.2 / F13 "through each module's service" vs decision 11
    (rows in forward tables whose modules have no services); `seed.js` ACTOR has no rights; no tag
    column exists.
16. **A26 vs 1099.** 1099 seeds alert thresholds (Home, decision 7) and the `Standard` attendance
    policy (LA); 8099 seeds `expense_category` rows; A26 forbids all three.
17. **Partnerships home_view holder.** demo Partnerships persona "Marketing and Sales Lead" vs real
    `head_of_department` = Head PR, Marketing & Brand Strategy, whose solid team excludes the seven
    marketing officers (they report to a vacant seat).
18. **CTO's Home.** kickoff 01:18:00 (CTO's view is about application health) vs code (management
    outranks administrator, so `home_view` = operations).
19. **Need You on Staff.** home.md §6 "Need You is present for every role" vs demo staff overview
    (none).
20. **Donor list.** MILESTONES §6.1 ports `shared.js` and `resolve.js`; home.md §12 does not list them
    but adds `role_kpi` and `party-360.service.js`.
21. **Stale links.** ess.md and organogram.md cite `docs/MyCity-ERP-Documents/attendance-guide.md`
    (does not exist; it is `docs/guides/attendance.md`).
22. **Migration ownership.** HANDOFF: "Migrations are LA's ... Do not touch `src/modules/*` ... ask
    first"; decisions 1, 4 and 7 have TB writing M1 migrations and a roster read next to LA's
    attendance module.

## 15 · Open questions

1. Module layout: one `src/modules/home/` or the stubs `dashboard`/`alerts`/`reports`? Then fix README
   §5.2/§5.4, route-map markers and the stubs (README §11.5: delete stubs left empty).
2. Capability codes: two segments (`home.team`, `home.reports`, `home.alerts_manage` or
   `alerts.manage`) or widen `CapabilityCode`? Which roles get each in the M1 reference seed
   (0449 gave `alerts.clear` to implementation, operations_people, management)? Does a head of
   department or line manager get `home.team`?
3. Alert clearing rule: capability `alerts.clear` AND/OR the rule's `permission_key`? Keep
   `mayClear()` as is and add the capability at the route, or change `alerts.js`?
4. Where does `attendance.roster` live (`src/modules/attendance/attendance.roster.js` in LA's module,
   or a shared file), and how is "Field", "Remote" and "On Site" derived from 1000's tables? LA must
   agree the status vocabulary so My Attendance and Home use one function.
5. Clock-in prompt: how does the server know "first sign-in of the day" (a `/me` or `/home/overview`
   flag, a `user_session`/`known_device` read, or Lagos-date of `last_seen_at`)? Who builds
   `GET /attendance/me/today` and `POST /attendance/punches`, which the shell already calls?
6. Rolling 30 days vs calendar month for personal attendance figures (demo vs mock My Attendance).
7. Grace minutes source (policy row, 5 per the client) and where the late threshold lives once 1099's
   rules move out.
8. Team scope per role: reporting tree only, or department for heads of department? What does the
   Head PR see of the seven marketing officers on the vacant seat?
9. Staging tags: a Home-owned registry table, `metadata` jsonb, or a number/title prefix? Who deletes
   the tagged rows when M2/M4/M7/M8 land, and how do adapters ignore them on production (they never
   exist there)?
10. Report run numbering doc type name and prefix (`schemes.js` + `numbering_scheme` row in the M1
    seed).
11. Which alert rules ship as staging data (not reference), and whether production starts with zero
    rules (A26) until MyCity creates them on screen.
12. Should Activity Today read `event_log` directly (permission-filtered per `module_key`) or keep its
    own feed via outbox handlers? Mail events must never appear for other people.
13. The CTO's Home (application health) and the Program Manager's (management → operations view):
    confirm with the client (home.md §13 "Role → card layouts").

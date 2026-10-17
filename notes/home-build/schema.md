# Home build brief · Schema, and the forward-milestone source map

Read-only survey of `/home/user/mycity-app` on 17/10/2026: every file in `migrations/` (41) and `seeds/reference/` (16),
`docs/DATABASE_SCHEMA.md`, `docs/guides/home.md`, `app/src/api/mock/modules/home.ts`, plus the shared code that
already reads Home's tables (`src/shared/alerts/alerts.js`, `src/shared/rbac/*`, `src/middleware/rbac.js`,
`src/shared/workflow/approvers.js`, `src/modules/workflow/workflow.repo.js`, `src/shared/time/working-week.js`,
`src/shared/numbering/*`, `src/shared/notifications/fanout.js`). The SQL is the fact; where a doc disagrees it is
listed in §J.

State of the code Home reads from: **every forward module is an empty stub** (`src/modules/attendance/*`,
`leave/*`, `tasks/*`, `goals/*`, `partner_pipeline/*`, `budgets/*`, `payroll/*`, `dashboard/*`, `alerts/*`,
`reports/*` are all 0 bytes; contract files `alerts.js`, `dashboard.js`, `reports.js`, `kpis.js`, `attendance.js`,
`leave.js` are 0 bytes). Only M0 modules plus `community`, `announcements`, `mailbox`, `ess`, `search` have code.
There is no `src/modules/home`: README §5.2 maps permission key `home` to backend modules `dashboard`, `alerts`,
`reports`.

---

## A · Rules that shape every Home migration and query

### A1 · Migration order: an M1 file cannot touch an M2+ table (critical)

`scripts/db/migrate.js` applies `migrations/` and `seeds/reference/` interleaved, **by number**
(MIGRATIONS.md §3). On a fresh database (CI integration with `RUN_DB_TESTS=1`, a rebuilt staging, gate 4's
UP/DOWN/UP round trip) a Home file numbered 11xx runs **before** `2000_productivity_performance.sql` ...
`10000_knowledge_ai_assistant.sql`. So Home's M1 migrations and seeds may reference only tables created by
files numbered below their own: all of M0 (0001 to 0499) and M1 (1000, 1100, 1110, 1120, 1130).

Consequences:
- No index, view, FK, trigger or seed row on `task`, `project`, `organisational_goal`, `employee_target`,
  `partner*`, `budget*`, `expense_request`, `vacancy`, `application`, ... from Home's M1 files. Indexes Home's
  reads want on those tables are **requests to their owners** (§G2).
- Cross-module SQL lives in **code** (decision 3: source adapters), never in an M1 view.
- The 9090 views (`attendance_summary`, `recruitment_pipeline_summary`, `partnership_pipeline_summary`,
  `budget_utilisation_summary`) exist on every database because 9090 runs after every block; adapters may read
  them (gate 6 treats views as opaque, so no column check).
- `seeds/staging/*.js` runs after all migrations, so the staging seed (decision 11) **can** write forward tables.

### A2 · The M1 number block

M1 owns 1000 to 1999 (gate 3, `scripts/check/migration-numbers.js`). Taken: `1000` schema, `1099` seed, `1100`
(home_alert columns), `1110` community, `1120` mailbox, `1130` announcement cancel. A number is unique across
both folders; on a branch `m1/...` a file outside 1000 to 1999 fails. LA (attendance owes) and AJ (devices owes)
will also take M1 numbers, so claim Home's in the PR description. Proposal: `1140_home_foundation.sql`
(schema), `1199_seed_home.sql` (reference seed). 1199 > 1099, so it can delete what 1099 inserted.

### A3 · Gate 6: the code and the contract name only real columns

- `scripts/check/schema-drift.js`: every `alias.column`, every `INSERT INTO t (cols)` and `UPDATE t SET col`
  in `src/` and `scripts/` must exist in the migrations (as `scripts/check/lib/catalogue.js` reads them).
  A source adapter that names a column the owner has not migrated yet **fails the build**. Adapters may only
  query columns that exist today (the tables in §E); anything the owner still owes is declared as a
  dependency note, not queried.
- `scripts/check/contract-columns.js`: every object schema exported from `packages/contract/schemas/<m>.js` is
  declared in that file's `TABLES` export; every key is a column of the named table or declared
  `virtual: { key: "<why>" }`; non-row shapes are `{ table: null, reason }`. So the Home contract spells
  `home_alert_rule_id`, `saved_report_id`, `report_key`, `definition`, `recurrence`, not the mock's
  `home_report_id`, `run_id`, `report`, `formats`, `who_clears`, `age`, `link`, `example`, `name` (rule)
  unless those become columns or are declared virtual.
- `buildCatalogue()` (`scripts/check/lib/catalogue.js`, returns `{ tables: Map<string, Set<string>>, views,
  opaque, gone }`) can be reused in a unit test that asserts every column a source adapter declares exists.

### A4 · Table shape (MIGRATIONS.md §6, gates 4 and 5)

- PK `<table>_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`; `created_at`/`updated_at timestamptz NOT NULL
  DEFAULT now()`.
- **The file that creates a table creates its trigger**: `CREATE OR REPLACE TRIGGER <table>_set_updated_at
  BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();`. Never name it `set_updated_at`
  (that is 9095's sweep name; 9095's DOWN drops every trigger of that name). On a fresh database 9095 also adds
  `set_updated_at` to a table from 1140 (1140 < 9095): two triggers, both harmless.
- Every FK says `ON DELETE` and has an index; every column a list sorts or filters on has an index.
- Status/type: `text` + `CHECK (col IN (...))` with exactly the contract enum's spelling. Constraints are added
  inside `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...)`.
- Money `numeric(18,2)`, strings on the wire (`shared/money`). Human numbers `number citext NOT NULL UNIQUE`
  from `numbering.allocate(client, "<type>")` inside `atomically()`; the type must be in
  `src/shared/numbering/schemes.js` (gate `numbering-schemes.js`) and have a `numbering_scheme` row
  (`/api/health/ready`).
- Destructive lines carry `-- DESTRUCTIVE: <why>`; DOWN drops exactly what UP made, by name.

### A5 · Pagination and scope in every read

```js
const { pageQuery, orderBy, TOTAL_COL, completeQuery } = require("../../shared/http/paged");
const { scopeOf, scopeClause, assertInScope } = require("../../shared/rbac/scope");
// controller: service.list(req.validated.query, scopeOf(req))   → { scope, scope_ids, employee_id }
const s = scopeClause(scope, { column: "e.employee_id" }, params);   // "" for all; "AND e.employee_id = ANY($n::uuid[])"
```
- `scope_ids` for `team` = the caller and every employee under them by `employee.line_manager_id`, any depth
  (`grants-cache.getTeamEmployeeIds`, recursive, depth < 20). The dotted line never grants scope.
- **A row whose owner column is NULL is invisible under team/own.** Pick the owner column per source (§F).
- `LIMIT 1` is allowed; any other `LIMIT` needs `-- pagination:batch <why>` on the line (sweeps only);
  `completeQuery()` needs `// pagination:complete <reason>` above it. Embedded Overview lists are page 1 of a
  `pageQuery`, never `LIMIT 25`.
- Lagos day bounds: `lagos.today()`, `lagos.startOfDay(d)`, `lagos.endOfDayExclusive(d)`, `lagos.monthBounds`
  (`src/shared/time/lagos.js`). Working days: `const cal = await workingWeek.loadCalendar(client)` then
  `isWorkingDay`, `addWorkingDays`, `countWorkingDays(from, to, cal)`.

---

## B · Home-owned tables: as built, gaps, and the fix-forward (decisions 1, 2, 5, 7)

### B1 · `home_alert_rule` (1000; seeded 1099)

```sql
home_alert_rule_id uuid PK DEFAULT gen_random_uuid()
key            citext NOT NULL UNIQUE
metric         text NOT NULL
threshold      numeric NOT NULL                 -- unscaled
window_days    integer CHECK (window_days IS NULL OR window_days > 0)
severity       text NOT NULL CHECK (severity IN ('low','medium','high'))
permission_key text NOT NULL                    -- "<module>.<action>", validated in code by alerts.parsePermission
enabled        boolean NOT NULL DEFAULT true
created_at, updated_at timestamptz NOT NULL DEFAULT now()
-- indexes: PK, UNIQUE(key). Trigger: set_updated_at (9095 sweep).
```

Read by `alerts.ruleByKey(client, key)` (enabled only):
`SELECT home_alert_rule_id, key, metric, threshold, window_days, severity, permission_key, enabled FROM
home_alert_rule WHERE key = $1 AND enabled = true`. `permission_key` must parse as `<module>.<action>` against
`access.catalog` (`people.view`, `people.approve`, `partnerships.approve`, ...), else `raise()` throws.

Gaps against guide §4 (`scope`, `created_by`), the mock/screens (`name`, `category`, "Who Can Clear", the
New Rule form: Rule Name, Metric, Threshold, Window, Days, Severity) and §6 ("a document expiring within D
days" is a deadline metric where lower is worse, but `alerts.evaluate()` breaches on `value >= threshold`):

| Column to add (1140) | Type | Why |
|---|---|---|
| `name` | `text` (backfill `key`, then `NOT NULL`) | Rule Name on the form and the rules list |
| `category` | `text NOT NULL DEFAULT 'attendance'` CHECK in the contract enum (`attendance`,`partnership`,`approval`,`document`,`people`,`budget`,`payroll`,`recruitment` per `HomeAlert.category` in `app/src/api/types/home.ts`) | category chips, Alert Sources; else derive `split_part(key, '.', 1)` and declare virtual |
| `scope` | `text NOT NULL DEFAULT 'subject' CHECK (scope IN (...))` | guide §4 lists it; DATABASE_SCHEMA M1 owes "alert scope". Meaning is not defined anywhere (open question J) |
| `created_by`, `updated_by` | `uuid REFERENCES app_user(user_id) ON DELETE SET NULL` + indexes | guide §4; audit is also in `audit_ledger` via `emit()` |
| (optional) `direction` | `text NOT NULL DEFAULT 'above' CHECK IN ('above','within')` | deadline rules (document expiry, contract renewal, confirmation due) show "44 days left"; either store `value = threshold_days - days_left` in the handler, or teach `evaluate()` a direction |

### B2 · `home_alert` (1000, 1100)

```sql
home_alert_id      uuid PK DEFAULT gen_random_uuid()
home_alert_rule_id uuid NOT NULL REFERENCES home_alert_rule(home_alert_rule_id)   -- no ON DELETE: NO ACTION
subject_type       text NOT NULL
subject_id         text NOT NULL
title              text NOT NULL
trigger            text                          -- NOT NULL dropped in 1100
severity           text NOT NULL CHECK (severity IN ('low','medium','high'))
over_by            numeric(18,2)                 -- retyped in 1100 (returns "1.00")
raised_at          timestamptz NOT NULL DEFAULT now()
last_seen_at       timestamptz NOT NULL DEFAULT now()
escalated_at       timestamptz
cleared_at         timestamptz
cleared_by         uuid REFERENCES app_user(user_id)
outcome            text CHECK (outcome IS NULL OR outcome IN ('cleared','dismissed'))
note               text
created_at, updated_at
-- index: home_alert_open_subject_uq UNIQUE (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL
```

Written only by `src/shared/alerts/alerts.js`: `raise(client, { rule, subject: {type, id}, value, title,
trigger?, subject_employee_id?, actor? }) → { raised, created, alert }` (ON CONFLICT on the partial unique
index; emits `home.alert_raised` only when created), `clear(client, { alert_id, actor, outcome = 'cleared',
note }) → alert` (idempotent; emits `home.alert_cleared`), `escalateAged({ db, days = 14, limit = 200 })`
(hourly `alert-ageing` scheduler, `LIMIT $2 -- pagination:batch`), `mayClear(client, user, rule)` (CEO, or any
scope of the rule's `permission_key`). Every `raise`/`clear` must run inside `atomically()`.

Gaps:
- **`subject_employee_id` is not stored.** `raise()` puts it only in the event payload (the fan-out uses it to
  notify `team` holders above the subject). The Alerts list cannot be scoped to a manager's team, and
  `mayClear()` lets any holder of the permission at team scope clear an alert about someone outside their team.
  Add `subject_employee_id uuid REFERENCES employee(employee_id) ON DELETE SET NULL` + index, write it in
  `raise()`'s INSERT, filter the list with `scopeClause(scope, { column: "a.subject_employee_id" })`, and check
  `assertInScope` in `clear()` (shared-code change, same PR as the column).
- Missing indexes Home's counts need (all on an M1 table, so 1140 may add them):
  `home_alert (home_alert_rule_id)` (FK; the partial unique covers open rows only), `home_alert (cleared_by)`,
  `home_alert (raised_at DESC)`, `home_alert (cleared_at) WHERE cleared_at IS NOT NULL`,
  `home_alert (subject_employee_id)`.
- No `link`/`category`/`who_clears`/`age` columns: derive `link` from `subject_type`/`subject_id` through
  `src/shared/route-map.js`, category from the rule, Who Can Clear from `permission_key` (module label from
  `access.catalog.MODULE_META`), age from `raised_at`; declare them virtual in the contract.
- `home_alert_rule_id` has no `ON DELETE`: deleting a rule with alerts fails. Rules are switched off
  (`enabled = false`), never deleted; guide §6 "switching a rule off clears its open alerts" is a service write
  through `alerts.clear(..., outcome: 'dismissed', note: 'Rule switched off')` per alert, not a cascade.

### B3 · `saved_report` and `report_schedule` (1000), kept per decision 1

```sql
saved_report:
saved_report_id uuid PK DEFAULT gen_random_uuid()
owner_user_id   uuid NOT NULL REFERENCES app_user(user_id)        -- no ON DELETE
name            text NOT NULL
report_key      text NOT NULL                                     -- the source (report catalogue key)
definition      jsonb NOT NULL                                    -- filters
shared          boolean NOT NULL DEFAULT false
created_at, updated_at
UNIQUE (owner_user_id, name)

report_schedule:
report_schedule_id uuid PK DEFAULT gen_random_uuid()
saved_report_id    uuid NOT NULL REFERENCES saved_report(saved_report_id) ON DELETE CASCADE
recurrence         jsonb NOT NULL
timezone           text NOT NULL DEFAULT 'Africa/Lagos'
recipients         citext[] NOT NULL                              -- email addresses, not user ids
active             boolean NOT NULL DEFAULT true
last_run_at        timestamptz
next_run_at        timestamptz
created_at, updated_at
-- indexes: PK, UNIQUE(owner_user_id, name) only. No index on report_schedule.saved_report_id, none on next_run_at.
```

Guide §4 `home_report` field → merged columns:

| Guide | Merged | Action in 1140 |
|---|---|---|
| `id` | `saved_report.saved_report_id` | none |
| `key`, `source` | `saved_report.report_key` | none (one column is both: the catalogue key of the shared query) |
| `name` | `saved_report.name` | none (unique per owner only) |
| `filters` | `saved_report.definition` | none; document its shape in the contract |
| `schedule` (cron) | `report_schedule.recurrence` jsonb + `timezone` | define the jsonb shape (reuse `src/shared/time/recurrence.js`) |
| `formats` | missing | add `report_schedule.formats text[] NOT NULL DEFAULT '{pdf}'` CHECK `formats <@ ARRAY['pdf','xlsx']::text[] AND cardinality(formats) > 0` |
| `recipients` | `report_schedule.recipients citext[]` | keep; validate on save that each is an active `app_user.email`, resolve to `user_id` at run time (generation is as the recipient, so an address with no login cannot be served) |
| `reporting_line` | missing | add `report_schedule.audience jsonb NOT NULL DEFAULT '{}'` (dynamic audience: line managers, hiring managers, current approvers); open question J |
| `permission_key` | missing | add `saved_report.permission_key text NOT NULL` ("<module>.<action>", the report card's gate) or derive from the report catalogue entry and declare virtual |
| `enabled` | `report_schedule.active` (Paused = `false`) | none |
| `created_by` | `saved_report.owner_user_id` | none |
| (archive) | missing | add `saved_report.archived_at timestamptz` so runs keep their parent (see B4 `ON DELETE RESTRICT`) |

Indexes to add in 1140: `report_schedule (saved_report_id)`, `report_schedule (next_run_at) WHERE active`
(the scheduler's due scan), `saved_report (report_key)`. Note `owner_user_id` has no `ON DELETE`: users are
never deleted (`status = 'left'`), so leave it.

### B4 · `home_report_run` (new, decision 1 and 8)

Guide §4: `id, number, report_id, run_at, status, document_id, format, recipients`. The engine generates **as
each recipient** in PDF and/or XLSX, so one generation yields recipients × formats files. Two shapes; the second
is recommended (open question J, it adds one table beyond "home_report_run and missing columns"):

```sql
-- Recommended: one numbered run per generation, one row per (recipient, format) file
CREATE TABLE IF NOT EXISTS home_report_run (
  home_report_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number citext NOT NULL UNIQUE,                                   -- numbering.allocate(client, "report_run")
  saved_report_id uuid NOT NULL REFERENCES saved_report(saved_report_id) ON DELETE RESTRICT,
  report_schedule_id uuid REFERENCES report_schedule(report_schedule_id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('schedule','on_demand')),
  scheduled_for timestamptz,                                       -- the slot a schedule fired for
  requested_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  run_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS home_report_run_slot_uq
  ON home_report_run (report_schedule_id, scheduled_for) WHERE report_schedule_id IS NOT NULL;  -- no double fire
CREATE INDEX ... (saved_report_id, run_at DESC); (report_schedule_id); (requested_by); (run_at)

CREATE TABLE IF NOT EXISTS home_report_delivery (
  home_report_delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_report_run_id uuid NOT NULL REFERENCES home_report_run(home_report_run_id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE RESTRICT,
  format text NOT NULL CHECK (format IN ('pdf','xlsx')),
  document_id uuid REFERENCES document(document_id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','emailed','failed')),
  emailed_at timestamptz,
  error text,
  created_at, updated_at,
  UNIQUE (home_report_run_id, recipient_user_id, format)
);
-- + FK indexes (recipient_user_id), (document_id); both tables get <table>_set_updated_at triggers.
```
Single-table alternative: `home_report_run(..., recipient_user_id, format, document_id)` numbered per file
(numbers inflate; Recent Runs must group).

Numbering: add `report_run: { prefix: "RPT", padding: 4, separator: "-", reset: "never", include_period: false }`
to `SCHEMES` (the mock shows `RPT-0214`) and seed the row in 1199 with `ON CONFLICT (doc_type) DO NOTHING`
(MIGRATIONS §9: a scheme is edited on Settings, so never `DO UPDATE` blindly).

Vault: register a doc type (`defineDocumentType("home_report", { label, module: ..., sensitivity:
"restricted" })` in the reports module's events file). Pitfall: document reading follows the doc type's
`module` view grant, and **every role has `home.view`**; a report file must be downloadable only by its
recipient (and the report owner), so serve it through Home's own endpoint that checks
`home_report_delivery.recipient_user_id`, or set `module` to the report's source module. Store
`entity_type = 'home_report_run'`, `entity_id = run id` (document CHECK: both or neither).

### B5 · `role_kpi` and the personal picker (new, decision 5)

Nothing exists. The donor's shape (`praxis-ls/migrations/tenant/13800_role_kpi_config.sql`): `role_id` PK,
`scope_ids text[]` (NULL = everything the role can read), `default_ids text[] NOT NULL DEFAULT '{}'`,
`locked_ids text[] NOT NULL DEFAULT '{}'`, `CHECK (scope_ids IS NULL OR default_ids <@ scope_ids)`,
`CHECK (locked_ids <@ default_ids)`, `CHECK (array_length(default_ids, 1) IS NULL OR array_length(default_ids, 1)
<= 4)`. Ids are bare text (the catalogue is code; membership checked in the service; orphan ids fail closed).
MyCity has no `user_preference` table, so the personal pick needs its own.

```sql
CREATE TABLE IF NOT EXISTS role_kpi (
  role_kpi_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL UNIQUE REFERENCES role(role_id) ON DELETE CASCADE,
  scope_ids text[],
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at, updated_at,
  CHECK (scope_ids IS NULL OR default_ids <@ scope_ids),
  CHECK (locked_ids <@ default_ids),
  CHECK (cardinality(default_ids) <= 4)
);
CREATE TABLE IF NOT EXISTS home_kpi_pick (
  home_kpi_pick_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_user(user_id) ON DELETE CASCADE,
  kpi_ids text[] NOT NULL DEFAULT '{}',
  created_at, updated_at,
  CHECK (cardinality(kpi_ids) <= 4)
);
```
Resolution order (read time): eligible(catalogue, viewer grants) ∩ role scope → locked ids first → personal picks
→ role defaults → the `home_view` fallback set. A person with several roles: use the highest-`rank` role's row
for defaults and locks (the same rule `/me` uses for `home_view`), union of `scope_ids`. Per-role defaults are a
business choice (A26): **not** in a reference seed; enter them on screen or in the staging seed. Naming pitfall:
`kpi_definition` (M2) is Performance's KPI register, unrelated to Home's card ids; `src/modules/kpis` is M2's.

`/me` already resolves the view (`src/modules/identity/identity.service.js`):
```js
const view = row.is_ceo ? "ceo" : (roles.find((r) => r.home_view) || { home_view: "staff" }).home_view;
// roles come from identity.repo.rolesOf(): active user_role rows, ORDER BY r.rank DESC, r.name
```

### B6 · Capabilities (decision 2)

`capability.code citext UNIQUE`; `role_capability (role_id, capability_id) UNIQUE`; `user_capability
(user_id, capability_id) UNIQUE, expires_at`. `requireCapability(code)` (middleware/rbac.js) passes the CEO,
else `grantsCache.getCapabilities(pool, user_id)` = user_capability (unexpired) ∪ role_capability via current
user_role rows. Seeded (0449): `announcements.post`, `alerts.clear`, both granted to `implementation`,
`operations_people`, `management`.

**Blocker:** the access contract only accepts one dot:
```js
// packages/contract/schemas/access.js
const CapabilityCode = z.string().trim().toLowerCase().regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/, "Not a capability");
```
`home.alerts.manage` fails it, so Settings · Roles & Permissions could never save a role holding it. Either name
it `home.alerts_manage` (and `home.team`, `home.reports` pass as they are) or widen the regex in the same PR.
Seed in 1199: `INSERT INTO capability (code, name, description) ... ON CONFLICT (code) DO NOTHING`, and
`role_capability` rows for the system roles with `ON CONFLICT (role_id, capability_id) DO NOTHING` (0449 is
the pattern). DOWN deletes only capabilities nobody else was given (0449's DOWN).

Note `alerts.clear` is **not checked anywhere** in `src/`: `alerts.clear()` authorises with `mayClear()` (the
rule's `permission_key` grant, any scope, or CEO). See §J.

### B7 · Moving 1099's alert thresholds out (decision 7, A26)

1099 inserted, with `ON CONFLICT (key) DO UPDATE ... enabled = true`:
```
('attendance.absence',  'absence_count', 1, 1,    'high',   'people.view',    true)
('attendance.lateness', 'late_count',    3, 30,   'medium', 'people.view',    true)
('leave.pending',       'pending_days',  2, NULL, 'medium', 'people.approve', true)
```
Fix-forward in 1199 (a merged file is never edited):
```sql
-- DESTRUCTIVE: alert thresholds are MyCity's business choice (A26); entered on Home · Alerts.
DELETE FROM home_alert_rule r
 WHERE (r.key, r.metric, r.threshold, r.window_days, r.severity, r.permission_key) IN (...the three seeded tuples...)
   AND NOT EXISTS (SELECT 1 FROM home_alert a WHERE a.home_alert_rule_id = r.home_alert_rule_id);
-- DOWN: re-insert the three with ON CONFLICT (key) DO NOTHING.
```
`window_days` is NULL for `leave.pending`: compare with `IS NOT DISTINCT FROM`, not a tuple `IN`. The staging
seed then creates rules through the Home service. 1099 also seeds the `Standard` attendance policy, also a
business choice under A26, but that is LA's to move.

---

## C · M0 tables Home reads (exact)

### C1 · Identity and access

`app_user` (0010, 0200, 0220): `user_id uuid PK`; `employee_id uuid NOT NULL` FK `app_user_employee_fk` →
`employee` (added 0040, no ON DELETE); `email citext NOT NULL UNIQUE`; `password_hash text NOT NULL`; `status text
NOT NULL DEFAULT 'active' CHECK IN ('active','suspended','left')`; `is_ceo boolean NOT NULL DEFAULT false` with
`app_user_one_ceo_uq UNIQUE (is_ceo) WHERE is_ceo`; `mfa_secret_enc`, `mfa_enrolled_at`, `failed_login_count int
NOT NULL DEFAULT 0 CHECK >= 0`, `locked_until`, `last_login_at`, `last_failed_login_at`, `password_changed_at`,
`mfa_frequency text NOT NULL DEFAULT 'daily' CHECK IN ('every_sign_in','daily','monthly')`,
`mfa_pending_secret_enc`, `mfa_pending_until`, `mfa_last_step int`, `pin_hash`, `pin_changed_at`,
`pin_failed_count int NOT NULL DEFAULT 0`, `pin_last_failed_at`, `pin_window_started_at`, `pin_window_failures int
NOT NULL DEFAULT 0`, timestamps. Index `app_user_employee_id_fk_idx`. Home selects `user_id, employee_id, email,
status, is_ceo, last_login_at` only; never a secret column.

`user_session` (0010, 0200, 0220): `session_id`, `user_id` FK CASCADE, `refresh_token_hash UNIQUE`, `ip_address
inet`, `user_agent`, `issued_at`, `expires_at` (CHECK > issued_at), `killed_at`, `killed_by`, `last_seen_at NOT
NULL DEFAULT now()`, `method CHECK IN ('password','password_totp','pin','pin_totp','passkey')`, `known_device_id`
FK SET NULL, `device_label`, `end_reason CHECK IN (...)`, `reauthenticated_at`. Indexes `user_session_user_issued_idx
(user_id, issued_at DESC)`, `user_session_live_idx (last_seen_at DESC) WHERE killed_at IS NULL`. Clock-in prompt
"first sign-in of the day" = no `issued_at` earlier today (Lagos) for this user, or simply "no clock-in today".

`known_device` (0010, 0200, 0220): `known_device_id`, `user_id` FK CASCADE, `fingerprint_hash`, `label`,
`platform`, `trusted_at`, `last_seen_at`, `revoked_at`, `last_ip inet`, `mfa_trusted_until`; `UNIQUE (user_id,
fingerprint_hash)`. "Punched from a new device" = `attendance_event.known_device_id` whose `trusted_at IS NULL`
or `created_at` is today. M1 owes enrolment status and the three-device rule here (ess.md §6).

`role` (0020, 0200, 0400): `role_id`, `code citext UNIQUE`, `name`, `description`, `is_system bool DEFAULT false`,
`active bool DEFAULT true`, `home_view text CHECK (home_view IS NULL OR home_view IN
('operations','ceo','partnerships','staff'))`, `rank int NOT NULL DEFAULT 0`, `two_step_required bool NOT NULL
DEFAULT false`. `user_role` (0020): `user_role_id`, `user_id` FK CASCADE, `role_id` FK CASCADE, `effective_from date
NOT NULL DEFAULT CURRENT_DATE`, `effective_to date` (exclusive), `granted_by`, `UNIQUE (user_id, role_id,
effective_from)`, `CHECK (effective_to IS NULL OR effective_to > effective_from)`; indexes on `role_id`,
`granted_by`. `permission` (0020): `permission_id`, `role_id` FK CASCADE, `module_key text`, `can_view`,
`can_create`, `can_edit`, `can_delete`, `can_approve`, `can_export` (bool DEFAULT false), `scope text NOT NULL
DEFAULT 'own' CHECK IN ('all','team','own')`, `UNIQUE (role_id, module_key)`. `field_visibility` (0020):
`role_id` FK CASCADE, `field_key`, `visibility CHECK IN ('visible','masked')`, `UNIQUE (role_id, field_key)`;
keys seeded: `employee.salary`, `employee.bank`, `employee.personal`, `employee.statutory`. `capability`,
`user_capability`, `role_capability` in B6.

### C2 · People and structure

`employee` (0040, 0110, 0210, 0300):
```
employee_id uuid PK; staff_number citext NOT NULL UNIQUE (renamed from number in 0110)
first_name text NOT NULL; middle_name; last_name text NOT NULL; preferred_name
work_email citext NOT NULL UNIQUE; personal_email citext; phone
job_title text NOT NULL
department_id uuid NOT NULL → department; worksite_id → worksite; line_manager_id → employee
employment_type NOT NULL CHECK IN ('full_time','part_time','contractor','consultant','intern')
work_pattern    NOT NULL CHECK IN ('on_site','hybrid','remote')
status NOT NULL DEFAULT 'active' CHECK IN ('active','suspended','left','archived')
  + employee_archived_check ((status = 'archived') = (archived_at IS NOT NULL))
start_date date (nullable since 0300); confirmation_due_on date; confirmed_on date; left_on date
profile jsonb NOT NULL DEFAULT '{}'
gender CHECK (NULL|'female'|'male'); date_of_birth; next_of_kin_name/_phone/_relationship   -- employee.personal
bank_name; account_number CHECK '^[0-9]{10}$'                                          -- employee.bank
gross_monthly numeric(18,2) CHECK >= 0                                                 -- employee.salary
dotted_manager_id → employee SET NULL; line_manager_seat_id, dotted_manager_seat_id → org_seat SET NULL
  CHECK not own manager; CHECK (line_manager_id IS NULL OR line_manager_seat_id IS NULL) (same for dotted)
home_address text (employee.personal); contract_ends_on date CHECK >= start_date
archived_at timestamptz; archive_reason text
```
Indexes: FK (department, line_manager, worksite, dotted manager, both seats); `employee_birthday_idx (month, day
of date_of_birth)`; `employee_contract_ends_idx (contract_ends_on) WHERE NOT NULL`; `employee_name_idx
(last_name, first_name)`, `_status_idx`, `_job_title_idx`, `_work_pattern_idx`, `_employment_type_idx`,
`_start_date_idx`, `_created_at_idx`; `employee_confirmation_due_idx (confirmation_due_on) WHERE
confirmation_due_on IS NOT NULL AND confirmed_on IS NULL`; `employee_search_idx` GIN trigram on
`search_fold(first_name||' '||last_name||' '||job_title)`. Display name in SQL: `btrim(e.first_name || ' ' ||
e.last_name)` (organisation.repo `DISPLAY_NAME`). Home never selects a masked column.

`department` (0040): `department_id`, `parent_department_id` → self, `code citext UNIQUE`, `name`, `description`,
`active bool DEFAULT true`. `worksite` (0040): `worksite_id`, `code citext UNIQUE`, `name`, `address jsonb`,
`latitude/longitude numeric(9,6) NOT NULL` (range CHECKs), `radius_m int NOT NULL > 0`, `timezone text NOT NULL
DEFAULT 'Africa/Lagos'`, `active`. `reporting_line` (0040): `employee_id`, `manager_id`, `effective_from NOT
NULL`, `effective_to`, `UNIQUE (employee_id, manager_id, effective_from)`; **not** what scope reads (scope reads
`employee.line_manager_id`). `org_seat` (0110): `org_seat_id`, `title`, `department_id NOT NULL` RESTRICT,
`line_manager_id` SET NULL, `line_manager_seat_id` SET NULL, `status DEFAULT 'vacant' CHECK IN
('vacant','filled','closed')`, `filled_by_employee_id` SET NULL, `filled_on`; `CHECK ((status = 'filled') =
(filled_by_employee_id IS NOT NULL))`; `org_seat_vacant_idx (department_id) WHERE status = 'vacant'`.

View `employee_team_closure` (0040): `(manager_id, employee_id, depth)`, includes self at depth 0, depth < 32,
line manager only. The grants cache does not use it (own CTE, depth < 20); use scope ids, not the view.

### C3 · History, notifications, alerts

`event_log` (0030): `event_id uuid PK`, `event_key`, `module_key`, `entity_type`, `entity_id text`,
`actor_user_id` → app_user, `payload jsonb NOT NULL DEFAULT '{}'`, `request_id`, `import_batch_id`,
`occurred_at timestamptz NOT NULL DEFAULT now()`, timestamps. Only index: `event_log_actor_user_id_fk_idx`.
**No index on `occurred_at` or `event_key`**: "Activity Today" would scan. Home may add
`event_log (occurred_at DESC)` and `(module_key, occurred_at DESC)` in 1140 (0030 < 1140).

`audit_ledger` (0030, 0100, 0400): append-only (`audit_ledger_append_only` trigger), `event_id` → event_log,
`occurred_at`, `actor_user_id`, `actor_name`, `actor_email`, `actor_ip`, `action`, `module_key`, `entity_type`,
`entity_id text`, `before`/`after jsonb`, `changed_fields text[]` (nullable), `is_sensitive`, `metadata jsonb`,
`request_id`, `import_batch_id`. Indexes `(occurred_at DESC, audit_ledger_id)`, `(module_key, occurred_at DESC)`,
`(action, occurred_at DESC)`, `(entity_type, entity_id)`. Holds before/after values (masked fields included),
so Activity must not render it raw.

`event_outbox` (0030): `outbox_id`, `event_id`, `event_key`, `dedup_key` (`event_outbox_dedup_uq UNIQUE WHERE NOT
NULL`), `status CHECK IN ('pending','processing','done','failed')`, `attempts`, `max_attempts DEFAULT 8`,
`next_attempt_at`, `completed_handlers text[]`, `last_error`, `processed_at`. Home's signal handlers are outbox
handlers; per-handler idempotency comes from `completed_handlers`.

`notification` (0060, 0100): `notification_id`, `user_id` CASCADE, `event_id` → event_log, `event_key`,
`category`, `priority CHECK IN ('normal','high')`, `title NOT NULL`, `body` (nullable), `entity_type`, `entity_id`,
`channels text[] DEFAULT ARRAY['in_app']`, `read_at`, `delivery_queued_at`, `UNIQUE (event_id, user_id)`.
Written only by `shared/notifications/fanout.js`; `home.alert_raised` already goes to holders of
`payload.clear_permission` (scope-aware via `payload.subject_employee_id`), `home.alert_escalated` to the CEO;
category `alerts`.

**`alert` (0060) is not `home_alert`.** Columns: `alert_id`, `user_id` → app_user (nullable, no ON DELETE),
`category text NOT NULL`, `severity CHECK IN ('low','medium','high')`, `title`, `body`, `entity_type`,
`entity_id`, `raised_at`, `cleared_at`, timestamps; index on `user_id`. It has no rule, threshold, `over_by`,
`last_seen_at`, escalation, `cleared_by`, outcome or note, and no one-open-per-subject constraint. **Nothing in
`src/` or `scripts/` reads or writes it** (the fan-out writes `notification`; `alerts.js` writes `home_alert`).
It is an orphan from the first schema, listed by DATABASE_SCHEMA under Notifications. Home must not use it;
dropping it is GE's (M0) call, destructive, and out of Home's scope.

### C4 · Approvals

`workflow_definition` (0070): `workflow_definition_id`, `key citext`, `version int > 0`, `module_key`, `name`,
`description`, `context_types jsonb`, `stages jsonb`, `active`, `created_by`, `UNIQUE (key, version)`.
`workflow_instance` (0070): `workflow_instance_id`, `workflow_definition_id`, `definition_key`, `module_key`,
`entity_type`, `entity_id text`, `subject_employee_id` → employee, `current_stage`, `state DEFAULT 'pending'
CHECK IN ('pending','approved','rejected','cancelled','timeout_approved','timeout_rejected')`, `context jsonb`,
`stage_approvers jsonb` (snapshot: `{type:'role'|'user'|'employee'|'ceo', value, via?}`), `stage_entered_at NOT
NULL`, `stage_due_at`, `opened_by`, `opened_at`, `completed_at`; `workflow_instance_pending_subject_uq UNIQUE
(entity_type, entity_id) WHERE state = 'pending'`; FK indexes. `workflow_decision` (0070, 0450): `decision CHECK
IN ('approve','reject','request_changes','cancel','timeout_approve','timeout_reject','reassign')`, `stage_key`,
`actor_id`, `reason`, `decided_at DEFAULT clock_timestamp()`.

Need You and approval ageing reuse the built repo (do not re-write the clause):
```js
// src/modules/workflow/workflow.repo.js (exports waiting, waitingCount)
waiting(client, user, roleCodes, modules, query)       // pageQuery, oldest stage_entered_at first
waitingCount(client, user, roleCodes, modules)         // { waiting, overdue } overdue = stage_due_at < now()
// approvers.waitingOnClause("i", user, roleCodes, params): CEO matches only {type:'ceo'} entries
```
A pending record of any module is found without a column on that record: `JOIN workflow_instance i ON
i.entity_type = '<table>' AND i.entity_id = r.<pk>::text AND i.state = 'pending'`. That is how Home reaches
expense, leave and goal approvals before their owners add `workflow_instance_id`.

### C5 · Files, numbers, settings, code lists

`document` (0080, 0100, 0350): `document_id`, `doc_type`, `title` (nullable), `original_name`, `storage_key
UNIQUE`, `mime`, `bytes`, `content_hash`, `artifact_hash`, `version`, `supersedes_id`, `is_current bool DEFAULT
true`, `entity_type`/`entity_id` (CHECK both or neither), `subject_employee_id` → employee, `sensitivity CHECK IN
('normal','personal','restricted')`, `locked_at`, `expires_on date`, `scan_status CHECK IN
('clean','pending','infected','skipped')`, `source CHECK IN ('upload','generated','import')`, `number text UNIQUE`,
`template_key`, `template_version`, `render_status`, `render_html`, `render_error`, `width`, `height`,
`duration_ms`, `uploaded_by`, `verified_at`, `verified_by`. Indexes incl. `document_expires_idx (expires_on) WHERE
expires_on IS NOT NULL`, `document_subject_current_idx (subject_employee_id, created_at DESC) WHERE is_current AND
subject_employee_id IS NOT NULL`.
`document_request` (0350): `document_request_id`, `employee_id NOT NULL` CASCADE, `doc_type`, `title NOT NULL`,
`note`, `requested_by`, `requested_at`, `fulfilled_document_id`, `fulfilled_at` (CHECK paired), `cancelled_at`,
`cancelled_by`; `document_request_open_idx (employee_id) WHERE fulfilled_at IS NULL AND cancelled_at IS NULL`.
`template` (0080): `kind CHECK IN ('document','email')`, `key citext`, `name`, `active`, `UNIQUE (kind, key)`;
`template_version`: `kind`, `key`, `version >= 0`, `subject`, `title`, `body`, `format CHECK IN
('html','markdown')`, `UNIQUE (kind, key, version)` (version 0 is the shipped file, no row).

`numbering_scheme` (0055): `doc_type text PK`, `prefix`, `padding smallint DEFAULT 4 CHECK 0..10`, `separator
DEFAULT '-'`, `reset CHECK IN ('never','yearly','monthly')`, `include_period bool`. `numbering_counter`:
`(doc_type → numbering_scheme, period DEFAULT '')` PK, `last_value bigint >= 0`.

`setting` (0050): `key text PK`, `value jsonb NOT NULL`, `updated_by`. Only `organisation.profile` (letterhead)
and the security rules are read today. `working_week` (0050): `weekday smallint PK CHECK 1..7` (1 = Monday),
`is_working_day bool NOT NULL`, `starts_at time`, `ends_at time`, `CHECK (NOT is_working_day OR (starts_at,
ends_at NOT NULL AND ends_at > starts_at))`. Seeded Mon to Fri 09:00 to 17:00 (0099), Saturday 09:00 to 15:00
(0199, A22), Sunday off. **No per-day `grace_minutes`** although MILESTONES §6.2 describes `{ working, start, end,
grace_minutes }`; grace lives on `attendance_policy`. `public_holiday` (0050, 0410): `public_holiday_id`,
`holiday_date date UNIQUE`, `name`, `expected bool NOT NULL DEFAULT false`; 2026 and 2027 seeded (0448).
`reference_value` (0050): `domain`, `code citext`, `label`, `description`, `display_order`, `metadata jsonb`,
`active`, `UNIQUE (domain, code)` (domains in §H1).

---

## D · M1 tables Home reads (LA attendance, AJ leave, GE community)

```sql
attendance_policy (1000)
  attendance_policy_id PK; name text NOT NULL UNIQUE; grace_minutes int NOT NULL DEFAULT 0 CHECK >= 0;
  earliest_clock_in_minutes int NOT NULL DEFAULT 120; latest_clock_out_minutes int NOT NULL DEFAULT 240;
  require_known_device bool NOT NULL DEFAULT true; require_geofence bool NOT NULL DEFAULT true; active bool

employee_attendance_policy (1000)        -- effective-dated (shared/db/effective-dated)
  employee_attendance_policy_id PK; employee_id NOT NULL → employee; attendance_policy_id NOT NULL → attendance_policy;
  worksite_id → worksite; effective_from date NOT NULL; effective_to date (exclusive);
  UNIQUE (employee_id, effective_from); CHECK (effective_to IS NULL OR effective_to > effective_from)

attendance_event (1000)                  -- the punches (append in practice; no ledger trigger)
  attendance_event_id PK; employee_id NOT NULL → employee;
  event_type text NOT NULL CHECK (event_type IN ('clock_in','clock_out'));
  occurred_at timestamptz NOT NULL; worksite_id → worksite; known_device_id → known_device;
  latitude, longitude numeric(9,6) CHECK ((latitude IS NULL) = (longitude IS NULL)); accuracy_m, distance_m numeric(10,2);
  source text NOT NULL CHECK (source IN ('pwa','admin','import','system'));
  validation_state text NOT NULL CHECK (validation_state IN ('accepted','review','rejected'));
  validation jsonb NOT NULL DEFAULT '{}'; request_id text
  INDEX attendance_event_employee_time_idx (employee_id, occurred_at DESC)

attendance_day (1000)                    -- one per person per date, closed by the attendance-day-close job (stub)
  attendance_day_id PK; employee_id NOT NULL → employee; attendance_date date NOT NULL;
  status text NOT NULL   -- NO CHECK; reference_value attendance_status: present, late, absent, leave
  first_clock_in_at, last_clock_out_at timestamptz; worked_minutes, late_minutes, overtime_minutes int NOT NULL DEFAULT 0 (>= 0);
  closed_at timestamptz; UNIQUE (employee_id, attendance_date)

attendance_exception (1000)
  attendance_exception_id PK; attendance_day_id NOT NULL → attendance_day;
  exception_type text NOT NULL  -- NO CHECK; reference attendance_exception: missing_clock_out, outside_worksite, unknown_device
  severity CHECK IN ('low','medium','high'); status NOT NULL DEFAULT 'open' CHECK IN ('open','under_review','resolved','dismissed');
  evidence jsonb; reviewed_by → app_user; reviewed_at; resolution        -- no index on attendance_day_id

leave_type (1000)      leave_type_id PK; code citext UNIQUE; name; unit CHECK IN ('days','hours'); policy jsonb; active
leave_balance (1000)   leave_balance_id PK; employee_id → employee; leave_type_id → leave_type; period_start, period_end date NOT NULL;
                       opening, accrued, used, adjusted numeric(10,2) NOT NULL DEFAULT 0;
                       UNIQUE (employee_id, leave_type_id, period_start, period_end); CHECK (period_end >= period_start)
leave_request (1000)   leave_request_id PK; employee_id NOT NULL → employee; leave_type_id NOT NULL → leave_type;
                       starts_on, ends_on date NOT NULL (CHECK ends_on >= starts_on); amount numeric(10,2) NOT NULL > 0 (days);
                       reason; status text NOT NULL DEFAULT 'draft' (NO CHECK; reference leave_status: draft, submitted, approved, rejected);
                       workflow_instance_id → workflow_instance; submitted_at; decided_at
                       -- no index on employee_id, status, starts_on/ends_on or workflow_instance_id
```
Community and announcements (Activity, optional): `announcement` (1000, 1110, 1130) `status CHECK IN
('draft','scheduled','published','archived','cancelled')`, `published_at`, `publish_at`, `expires_at`,
`audience jsonb`, `audience_size`, `community_message_id`; `announcement_read (announcement_id, user_id) UNIQUE,
read_at`; `community_message.message_type` includes `birthday`, `anniversary`, `recognition`, `announcement`
(1110); `peer_recognition (from_employee_id, to_employee_id, value_code, message, community_message_id)`.

Indexes Home may add in 1140 (M1 tables, coordinate with LA/AJ who own them): `attendance_event (occurred_at)`
(whole-organisation "today" range scan; the existing index leads with employee), `attendance_day
(attendance_date)`, `attendance_exception (attendance_day_id)`, `leave_request (employee_id)`, `leave_request
(starts_on, ends_on) WHERE status = 'approved'`, `leave_request (workflow_instance_id)`.

### D1 · The shared roster read (decision 4: `attendance.roster`)

Proposed home: `src/modules/attendance/attendance.roster.js` (new file; README must list it), exported
`roster(client, { date, scope, filters, query })` (page) plus `summary(client, { date, scope })` (counts), both
used by Home (Overview card, KPI detail, Team) and later My Attendance. One derivation, so "the number on Home
always equals the number on My Attendance" (guide §3).

```sql
-- $1 date (lagos.today()), $2/$3 = lagos.startOfDay($1) / lagos.endOfDayExclusive($1), $4 = yesterday
SELECT e.employee_id, e.staff_number::text, btrim(e.first_name || ' ' || e.last_name) AS display_name,
       e.department_id, d.name AS department, e.worksite_id, w.name AS worksite, e.work_pattern, e.status AS employee_status,
       pin.first_in, pin.first_in_worksite_id, pin.first_in_device_id, pin.first_in_state, pout.last_out,
       lv.on_leave, yd.first_clock_in_at IS NOT NULL AND yd.last_clock_out_at IS NULL AS no_clock_out_yesterday,
       coalesce(pol.grace_minutes, 0) AS grace_minutes, ${TOTAL_COL}
  FROM employee e
  JOIN department d ON d.department_id = e.department_id
  LEFT JOIN worksite w ON w.worksite_id = e.worksite_id
  LEFT JOIN LATERAL (SELECT min(ev.occurred_at) AS first_in,
                            (array_agg(ev.worksite_id ORDER BY ev.occurred_at))[1] AS first_in_worksite_id,
                            (array_agg(ev.known_device_id ORDER BY ev.occurred_at))[1] AS first_in_device_id,
                            (array_agg(ev.validation_state ORDER BY ev.occurred_at))[1] AS first_in_state
                       FROM attendance_event ev
                      WHERE ev.employee_id = e.employee_id AND ev.event_type = 'clock_in'
                        AND ev.validation_state <> 'rejected' AND ev.occurred_at >= $2 AND ev.occurred_at < $3) pin ON true
  LEFT JOIN LATERAL (SELECT max(ev.occurred_at) AS last_out FROM attendance_event ev
                      WHERE ev.employee_id = e.employee_id AND ev.event_type = 'clock_out'
                        AND ev.occurred_at >= $2 AND ev.occurred_at < $3) pout ON true
  LEFT JOIN LATERAL (SELECT true AS on_leave FROM leave_request lr
                      WHERE lr.employee_id = e.employee_id AND lr.status = 'approved'
                        AND lr.starts_on <= $1 AND lr.ends_on >= $1 LIMIT 1) lv ON true
  LEFT JOIN attendance_day yd ON yd.employee_id = e.employee_id AND yd.attendance_date = $4
  LEFT JOIN employee_attendance_policy eap ON eap.employee_id = e.employee_id
        AND eap.effective_from <= $1 AND (eap.effective_to IS NULL OR eap.effective_to > $1)
  LEFT JOIN attendance_policy pol ON pol.attendance_policy_id = eap.attendance_policy_id
 WHERE e.status IN ('active','suspended') ${s.and}       -- s = scopeClause(scope, { column: "e.employee_id" }, params)
 ORDER BY ...
```
Status precedence in JS (pure, unit-tested): `suspended` (employee.status) → `leave` (approved leave covering the
day) → not a working day (`isWorkingDay`; holiday or rest) → clocked in: `late` when `first_in > day start
(working_week.starts_at for the weekday) + grace_minutes`, else `on_time`; mode `on_site` when the punch has a
`worksite_id`, `remote` when it has none and `work_pattern IN ('remote','hybrid')`, `field` has **no source**
(attendance_assignment is owed by LA) → not clocked in: `not_yet` before the cut-off, `absent` after.
Flags beside the status: `no_clock_out_yesterday`, `new_device` (`known_device.trusted_at IS NULL`),
`review` (`validation_state = 'review'`). Today's `attendance_day` row may not exist until the day-close job runs,
so today is read from `attendance_event`; past days from `attendance_day`. Status spellings must be the contract
enum and must match `reference_value` `attendance_status` (today: `present`, `late`, `absent`, `leave`; the mock
uses `on_time`, `remote`, `no_clockout`, `new_device`, `suspended`, `not_yet`): agree one list with LA.

---

## E · Forward-milestone tables Home reads (exact, as migrated today)

No CHECK on any `status`/`stage` below unless shown; their vocabularies live only in `reference_value` (§H1).

**M2 · 2000 (AJ)**
```
project: project_id PK; number text NOT NULL UNIQUE (no scheme in schemes.js; 2099 seeds 'project' row);
  name NOT NULL; description; owner_employee_id → employee; department_id → department; status DEFAULT 'active';
  starts_on, due_on date (CHECK due_on >= starts_on); completed_at
task: task_id PK; project_id → project; parent_task_id → task; title NOT NULL; description;
  status NOT NULL DEFAULT 'todo'; priority NOT NULL DEFAULT 'normal'; created_by NOT NULL → app_user;
  primary_assignee_id → employee; starts_at, due_at timestamptz (CHECK due_at >= starts_at); completed_at;
  recurrence jsonb; blocked_reason; sort_order numeric(18,6) DEFAULT 0; archived_at
  INDEX task_assignee_due_idx (primary_assignee_id, status, due_at) WHERE archived_at IS NULL
task_assignee: task_assignee_id PK; task_id NOT NULL → task CASCADE; employee_id NOT NULL → employee;
  assignment_role; assigned_at; UNIQUE (task_id, employee_id)        -- no index leading on employee_id
calendar_event: calendar_event_id PK; title NOT NULL; description; event_type NOT NULL; owner_employee_id → employee;
  task_id → task; starts_at, ends_at timestamptz NOT NULL (CHECK ends_at > starts_at); all_day bool; location;
  recurrence jsonb; created_by NOT NULL → app_user           -- no attendees table (owed)
organisational_goal: organisational_goal_id PK; parent_goal_id → self;
  level NOT NULL CHECK (level IN ('organisation','department','team','role','individual'));
  department_id → department; employee_id → employee; title NOT NULL; description; status DEFAULT 'draft';
  starts_on, ends_on date NOT NULL; weight numeric(5,2) DEFAULT 100 CHECK (0,100]; owner_employee_id NOT NULL → employee;
  workflow_instance_id → workflow_instance        -- NO progress, target, baseline or actual column
kpi_definition: kpi_definition_id PK; code citext UNIQUE; name; description; job_title; measurement_type NOT NULL;
  unit; direction DEFAULT 'higher' CHECK IN ('higher','lower','target'); scoring jsonb; active
employee_target: employee_target_id PK; organisational_goal_id → organisational_goal; kpi_definition_id → kpi_definition;
  employee_id NOT NULL → employee; title NOT NULL; target_value, actual_value numeric(18,4);
  weight numeric(5,2) NOT NULL CHECK (0,100]; status DEFAULT 'draft'; due_on date; approved_by → app_user; approved_at
performance_cycle: performance_cycle_id PK; name; starts_on, ends_on date NOT NULL; status DEFAULT 'draft';
  self_review_opens_at, manager_review_opens_at, closes_at; UNIQUE (name, starts_on)
performance_review: performance_review_id PK; performance_cycle_id NOT NULL; employee_id NOT NULL; reviewer_employee_id NOT NULL;
  review_type CHECK IN ('self','manager','designated'); status DEFAULT 'draft'; overall_score numeric(8,4); summary;
  dictation_document_id → document; submitted_at; acknowledged_at;
  UNIQUE (performance_cycle_id, employee_id, reviewer_employee_id, review_type)
performance_review_item: performance_review_id CASCADE; employee_target_id; kpi_definition_id; score numeric(8,4); comment
```

**M3 · 3000 (GE)** `query_rule` (`code UNIQUE`, `source_event`, `window_days > 0`, `threshold numeric(18,4)`,
`condition jsonb`, `active`, `created_by`); `employee_query` (`number UNIQUE`, `employee_id NOT NULL`,
`query_rule_id`, `raised_by`, `subject`, `details`, `evidence jsonb`, `status DEFAULT 'awaiting_response'`,
`response_due_at`, `responded_at`, `reviewed_by`, `reviewed_at`, `workflow_instance_id`); `query_response
(employee_query_id, employee_id) UNIQUE`; `sanction` (`employee_query_id NOT NULL`, `employee_id`,
`sanction_type`, `reason`, `decided_by`, `effective_on`, `ends_on`, `status DEFAULT 'issued'`); `sanction_fine`
(`sanction_id UNIQUE`, `amount_ngn numeric(18,2) > 0`, `settlement_status CHECK IN
('pending','accepted','rejected','settled','waived')`); `sanction_letter (sanction_id, letter_type) UNIQUE,
document_id NOT NULL`.

**M4 · 4000 (TB)**
```
vacancy: vacancy_id PK; number UNIQUE; department_id; hiring_manager_id → employee; title; slug citext UNIQUE;
  description NOT NULL; requirements; positions int > 0 DEFAULT 1; work_pattern; worksite_id; status DEFAULT 'draft';
  opens_at, closes_at (CHECK); created_by NOT NULL
candidate: candidate_id PK; first_name, last_name; email citext UNIQUE; phone; location; profile jsonb; consented_at
application: application_id PK; vacancy_id NOT NULL; candidate_id NOT NULL; source; stage DEFAULT 'application';
  status DEFAULT 'active'; cover_letter; cv_document_id; answers jsonb; provisional_score numeric(8,4);
  provisional_ai_run_id → ai_run; current_stage_entered_at NOT NULL DEFAULT now(); applied_at; withdrawn_at;
  rejection_reason; UNIQUE (vacancy_id, candidate_id)
application_stage_history: application_id CASCADE; from_stage; to_stage NOT NULL; changed_by; reason; entered_at; exited_at
interview_round: application_id; round_number > 0; title; status DEFAULT 'scheduled'; feedback_closes_at; closed_at;
  UNIQUE (application_id, round_number)
interview: interview_round_id CASCADE; interview_type; scheduled_start, scheduled_end NOT NULL; location; meeting_url;
  status DEFAULT 'scheduled'; created_by
interview_panelist: interview_id CASCADE; employee_id NOT NULL; panel_role; submitted_at; UNIQUE (interview_id, employee_id)
interview_feedback: interview_panelist_id UNIQUE CASCADE; scorecard jsonb; recommendation; private_notes; ... (blind: never read by Home)
application_assessment: application_id; assessment_definition_id; status DEFAULT 'assigned'; due_at; submitted_at; score
```
**M5 · 5000 (LA)** `offer` (`application_id UNIQUE`, `number UNIQUE`, `status DEFAULT 'draft'`, `job_title`,
`start_date`, `expires_at`, `currency char(3)`, `annual_compensation numeric(18,2)` (salary: masked),
`approved_at`, `accepted_at`, `declined_at`); `signature_request` (`document_id NOT NULL`, `subject_type`,
`subject_id uuid`, `status DEFAULT 'pending'`, `expires_at`, `completed_at`); `onboarding_case` (`application_id
UNIQUE`, `offer_id UNIQUE`, `employee_id UNIQUE`, `owner_id`, `status DEFAULT 'pending'`, `starts_on`,
`completed_at`); `onboarding_checklist_item` (`onboarding_case_id CASCADE`, `document_requirement_id`, `title`,
`status DEFAULT 'pending'`, `assignee_id → employee`, `due_at`, `completed_at`, `document_id`);
`employment_contract` (`number UNIQUE`, `status`, `starts_on NOT NULL`, `ends_on`, `document_id NOT NULL`).

**M6 · payroll: there is no 6000-block file.** No `payroll_run`, `payslip`, salary, deduction or statutory table
exists; DATABASE_SCHEMA M6 "Built: nothing in the block" and "Owes, all of payroll". Only the `payroll_run`
(`PAY`, padding 0, monthly, period) and `payslip` (`PAY`, padding 4, monthly, period) numbering schemes are seeded
(0099) and in `schemes.js`. The `payroll` module and contract are empty stubs. Any payroll card or alert has no
source until M6 (LA).

**M7 · 7000 (GE)**
```
partner: partner_id PK; number UNIQUE (no scheme in schemes.js; 7099 seeds 'partner'); name; partner_type NOT NULL;
  status DEFAULT 'prospect'; website; industry; country_code char(2); owner_id → employee; metadata jsonb
partner_contact: partner_id CASCADE; first_name, last_name; email citext; phone; job_title; primary_contact;
  UNIQUE (partner_id, email) WHERE email IS NOT NULL
partnership_opportunity: number UNIQUE; partner_id NOT NULL; title; stage DEFAULT 'lead'; status DEFAULT 'open';
  owner_id → employee; estimated_value numeric(18,2); currency char(3); probability numeric(5,2) CHECK 0..100;
  expected_close_on date; closed_at
partnership_stage_history: partnership_opportunity_id CASCADE; from_stage; to_stage NOT NULL; changed_by; reason; changed_at
partner_interaction: partner_id NOT NULL; partnership_opportunity_id; contact_id; interaction_type NOT NULL; subject NOT NULL;
  summary; occurred_at timestamptz NOT NULL; owner_id → employee; mail_message_id → mail_message
partnership_proposal: partnership_opportunity_id NOT NULL; number UNIQUE; version; status DEFAULT 'draft'; value numeric(18,2);
  currency; document_id; sent_at; accepted_at; created_by NOT NULL        -- no owner_id
partnership_agreement: partner_id NOT NULL; partnership_opportunity_id; proposal_id; number UNIQUE; title; status DEFAULT 'draft';
  starts_on date NOT NULL; ends_on (CHECK); value numeric(18,2); currency; document_id; signature_request_id; owner_id → employee
  -- no signed_at, no type (MOU/contract), no renewal date
agreement_obligation: partnership_agreement_id CASCADE; title; owner_id; due_on; status DEFAULT 'pending'; completed_at
```
No indexes beyond PK/UNIQUE on any of these (no `partner_interaction (partner_id, occurred_at)`, no `owner_id`).

**M8 · 8000 (AJ)**
```
expense_category: code citext UNIQUE; name; parent_id; active        (5 rows seeded by 8099: a business choice under A26)
budget: number UNIQUE (no scheme in schemes.js; 8099 seeds 'budget'); name; department_id; owner_id → employee;
  currency char(3) NOT NULL; starts_on, ends_on NOT NULL; status DEFAULT 'draft'; approved_by; approved_at
budget_line: budget_id CASCADE; expense_category_id NOT NULL; amount, committed_amount, spent_amount numeric(18,2) >= 0;
  UNIQUE (budget_id, expense_category_id)
expense_request: number UNIQUE; employee_id NOT NULL → employee; department_id; budget_line_id; expense_category_id NOT NULL;
  purpose NOT NULL; amount numeric(18,2) > 0; currency char(3) NOT NULL; status DEFAULT 'draft'; needed_on;
  submitted_at; approved_at; rejected_at        -- no workflow_instance_id, no project link (owed)
requisition: expense_request_id UNIQUE (owed: one-to-many); number UNIQUE; requester_id NOT NULL → employee; supplier_name;
  status DEFAULT 'draft'; currency; total_amount numeric(18,2); submitted_at; approved_at
requisition_line: requisition_id CASCADE; expense_category_id; description; quantity numeric(18,4) > 0; unit_price numeric(18,2)
disbursement: expense_request_id | requisition_id (CHECK one not null); number UNIQUE; recipient_type; recipient_name;
  amount numeric(18,2) > 0; currency; status DEFAULT 'pending'; payment_reference; paid_at; processed_by
expense_transaction: expense_request_id; requisition_id; disbursement_id; transaction_type; amount >= 0; currency;
  occurred_at; reference; metadata jsonb
```
**M9 · 9000** `security_event`, `access_review(_item)`, `integration_connection`, `webhook_endpoint/delivery`:
not read by Home. **M10 · 10000** `knowledge_article` (`slug UNIQUE`, `status DEFAULT 'draft'`, `visibility
DEFAULT 'internal'`, `owner_id`, `published_at`): optional Activity source only.

**9090 views** (M9 block, so present everywhere; opaque to gate 6):
```sql
attendance_summary            = SELECT employee_id, attendance_date, status, worked_minutes, overtime_minutes FROM attendance_day
recruitment_pipeline_summary  = vacancy_id, number, title, stage, count(application_id)::bigint AS application_count (LEFT JOIN, GROUP BY)
partnership_pipeline_summary  = stage, status, currency, count(*)::bigint AS opportunity_count,
                                coalesce(sum(estimated_value),0)::numeric(18,2) AS estimated_value  (GROUP BY stage, status, currency)
budget_utilisation_summary    = budget_id, number, name, currency, allocated_amount, committed_amount, spent_amount (sums of budget_line)
```
None carries an owner or employee column except `attendance_summary`, so the pipeline and budget views cannot be
scoped to `team`/`own`: use them only for `all`-scope viewers, or query the base tables.

---

## F · Source map: every Home metric

Scope column = what goes into `scopeClause` for team/own. "Owes" = DATABASE_SCHEMA §3 items for that milestone
that can change the query. Risk: L (built, stable), M (built, vocabulary or writer not settled), H (column or
writer missing; card shows nothing real until the owner ships).

### F1 · Overview cards and blocks

| Metric (mock key) | Owner · M | Tables.columns | SQL sketch | Scope column | Owes that can change it | Risk |
|---|---|---|---|---|---|---|
| Clocked In Today (`clockedin`), detail groups On Site / Remote / Field / Late / No Clock-Out / On Leave / Not In | Attendance · M1 · LA | roster (D1): attendance_event, leave_request, attendance_day (yesterday), employee_attendance_policy, attendance_policy, working_week | `summary()` of D1: `count(*) FILTER (WHERE first_in IS NOT NULL)` / expected; late count | `e.employee_id` | home location, field assignment (no `field` mode), location requests, policy versions, auto-query unique key | M |
| Attendance, Last 14 Working Days (area) | Attendance · M1 | attendance_day.attendance_date, first_clock_in_at | dates = last 14 working days via `workingWeek` (JS); `SELECT attendance_date, count(*) FILTER (WHERE first_clock_in_at IS NOT NULL) FROM attendance_day WHERE attendance_date = ANY($1::date[]) ${s.and} GROUP BY 1` | `attendance_day.employee_id` | day-close job (writer) unbuilt | M |
| On Time donut (month) | Attendance · M1 | attendance_day.status, late_minutes | `count(*) FILTER (WHERE first_clock_in_at IS NOT NULL AND late_minutes = 0)`, `... late_minutes > 0`, `status = 'absent'` for month-to-date | `attendance_day.employee_id` | status vocabulary (no CHECK) | M |
| Overdue Tasks (`overdue`), trend vs last week | Workspace/tasks · M2 · AJ | task.due_at, completed_at, status, archived_at, primary_assignee_id; task_assignee | `WHERE t.archived_at IS NULL AND t.completed_at IS NULL AND t.status <> 'done' AND t.due_at < now()`; last week: `due_at < now() - 7d AND (completed_at IS NULL OR completed_at > now() - 7d)` | `t.primary_assignee_id` (unassigned tasks invisible to team/own) | `cancelled` status (counts as overdue until added), entity link, KPI link, cadence (A24) | M |
| Awaiting Approval ₦ (`approval`) and `approval_ceo` | Expenses · M8 · AJ, with workflow (M0) | expense_request.amount, currency, status, employee_id; workflow_instance via entity_type/entity_id | `SELECT r.currency, sum(r.amount)::numeric(18,2), count(*), count(*) FILTER (WHERE i.current_stage = 'ceo') FROM expense_request r JOIN workflow_instance i ON i.entity_type = 'expense_request' AND i.entity_id = r.expense_request_id::text AND i.state = 'pending' GROUP BY r.currency`; CEO card adds `waitingOnClause('i', ...)` | `r.employee_id` (requester); CEO: stage snapshot | `workflow_instance_id`, statuses of the M8 chain, requisition many requests, approval threshold | H |
| Active Partnerships (`partnerships`), "n closed this month" | Partnerships · M7 · GE | partnership_agreement.status, starts_on; or partnership_opportunity.stage/status/closed_at | `count(*) FROM partnership_agreement WHERE status = 'active'` (vocabulary unset) | `owner_id` | MyCity's twelve stages replace the seeded seven; MOU/contract type, agreement workflow | H |
| Partnership Pipeline bars, "n quiet 30 days" | Partnerships · M7 | partnership_opportunity.stage, status, owner_id; partner_interaction.occurred_at | `SELECT stage, count(*) FROM partnership_opportunity WHERE status = 'open' ${s.and} GROUP BY stage` (or the 9090 view for `all`); quiet: §F3 | `owner_id` | stages, region, objective, next action | H |
| Goals This Quarter / Organisational Goals bars | Performance · M2 · AJ | organisational_goal (level, starts_on, ends_on, status, weight), employee_target (target_value, actual_value, weight) | `WHERE g.level = 'organisation' AND g.starts_on <= $qend AND g.ends_on >= $qstart`; progress = weighted `actual_value / target_value` of linked employee_target, **no stored progress** | `owner_employee_id` (org goals are `all`) | A16 cascade (levels change: annual, monthly), code, baseline, success measure, CEO approval; task→goal link | H |
| Goals on Track (`goals`) "4 of 6" | Performance · M2 | as above | on-track rule undefined (progress vs elapsed share of the period) | `all` | as above | H |
| Org KPI donut (CEO), per department | Performance · M2 | employee_target × weight grouped by employee.department_id, or department-level goals | `SELECT e.department_id, sum(t.weight * least(t.actual_value / nullif(t.target_value,0), 1)) / sum(t.weight) FROM employee_target t JOIN employee e ... GROUP BY 1` | `all` | A16 departmental KPI; no score table | H |
| Signed Value FY (`signed`) "of ₦18M target" | Partnerships · M7 | partnership_agreement.value, currency, status, starts_on (no signed_at) | `sum(value) WHERE status IN (...signed...) AND starts_on BETWEEN fy` per currency; target has **no source** (an organisational_goal? a setting?) | `owner_id` | agreement workflow, viewed/expiring states, renewal date | H |
| Open High Alerts (`alerts_high`, CEO) | Home · M1 | home_alert.severity, cleared_at, raised_at | `count(*) WHERE severity = 'high' AND cleared_at IS NULL`; "over 7 days": `raised_at <= now() - interval '7 days'` | `a.subject_employee_id` (B2) | none (Home's own) | L |
| Need You (requests) | Workflow · M0 (built) + owning record | workflow_instance, stage_approvers; amount from the entity | `workflow.repo.waiting(client, user, roleCodes, modules, query)`; amount by `entity_type` | approver snapshot, not scopeClause | none for workflow; amounts per module | L/M |
| Need You (partnerships going quiet) | Partnerships · M7 | partner.owner_id, partner_interaction.occurred_at | §F3 with `p.owner_id = $me` | `owner_id` | mail-bound interactions | H |
| Activity Across the Organisation Today | all modules via M0 | event_log (event_key, module_key, entity_type, entity_id, payload, actor_user_id, occurred_at) | `WHERE occurred_at >= $start AND event_key = ANY($allow) AND module_key = ANY($viewModules)`; one formatter per allowed key; never render `audit_ledger` before/after | none on event_log: scope from `payload->>'subject_employee_id'` where the key carries it, else `all` only | each module's event keys appear only when it is built | M |
| Your Week / This Week | Calendar, tasks · M2 + settings · M0 | calendar_event (owner_employee_id, starts_at, ends_at, all_day, title), task (due_at, primary_assignee_id), task_assignee, working_week, public_holiday | events: `owner_employee_id = $me AND starts_at < $weekEnd AND ends_at > $weekStart`; tasks due in week; day notes from `loadCalendar()` (Saturday 09:00 to 15:00, holidays) | own (`$me`) | calendar attendees and visibility (an invite is not on the invitee's week until then) | M |
| Staff day strip: Today's Shift, Clock-In, Where, Status | Attendance · M1, settings · M0 | working_week (hours of today's weekday), roster row for me, worksite.name | roster with `scope = own` | own | home location ("Remote, approved home") | M |
| Staff job KPIs (`sk_pieces`, `sk_growth`) | Performance · M2 | employee_target (employee_id, kpi_definition_id, target_value, actual_value, due_on, status), kpi_definition (name, unit, direction) | `WHERE t.employee_id = $me AND t.due_on BETWEEN $qstart AND $qend`; value `actual_value of target_value` | own | A16 individual monthly KPI, cadence | H |
| Reviews Filed (`sk_reviews`) | Performance · M2 | performance_review (reviewer_employee_id, submitted_at, performance_cycle_id), performance_cycle (status, closes_at) | `count(*) FILTER (WHERE submitted_at IS NOT NULL) / count(*) WHERE reviewer_employee_id = $me AND cycle open` | own | second-level and HR stages | M |
| My Attendance, 30d (`sk_attendance`) | Attendance · M1 | attendance_day (employee_id, attendance_date, first_clock_in_at, late_minutes, status) | on-time days / `countWorkingDays(today-30, today-1)` | own | as roster | M |
| My Goals This Quarter | Performance · M2 | employee_target | as job KPIs | own | A16 | H |
| Upcoming Leave + balance | Leave · M1 · AJ | leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status); leave_balance (opening + accrued + adjusted - used, period); leave_type (name, unit) | `WHERE employee_id = $me AND status IN ('approved','submitted') AND ends_on >= $today ORDER BY starts_on`; balance for the period containing today | own | leave statuses have no CHECK; types and entitlements are business data, never seeded | M |

### F2 · Team tab

| Metric | Owner · M | Source | SQL sketch | Scope | Owes | Risk |
|---|---|---|---|---|---|---|
| Present Today (`tm_present`) "x / n, k on leave" | Attendance · M1 | roster `summary()` | present = clocked in; n = rows in scope; k = on_leave | `e.employee_id` from the **`home` grant's** scope (capability gates the tab, the grant scopes the rows) | as roster | M |
| On Site / Remote (`tm_onsite`, `tm_remote`) | Attendance · M1 | roster mode | mode from punch `worksite_id` + `work_pattern` | same | field assignment, home location | M |
| Flags (`tm_flags`) late + no clock-out | Attendance · M1 | roster | `late OR no_clock_out_yesterday` | same | auto-query key | M |
| Roster row: employee, department, status pill, mode, Clock-In | Attendance · M1 + M0 | roster page (pageQuery, 25) | D1 | same | | M |
| Roster KPI % | Performance · M2 | employee_target weighted achievement per employee | `sum(weight * least(actual/target,1)) / sum(weight)` for the current period | same | A16 | H |
| Roster Open Tasks | Tasks · M2 | task + task_assignee | `count(*) WHERE completed_at IS NULL AND archived_at IS NULL AND status <> 'done' AND (primary_assignee_id = e.employee_id OR EXISTS task_assignee)` | same | cancelled status | M |
| Attendance This Month by person (bars) | Attendance · M1 | attendance_day month-to-date | on-time days / `countWorkingDays(monthStart, yesterday)` per employee (the mock wrongly reuses `kpi_pct`) | same | | M |
| Department / status / mode filters | M0 + roster | employee.department_id; derived status | status/mode filters apply after derivation: derive in SQL `CASE` or filter a complete scoped set | same | | M |

"Function lead sees their own people / department" (guide §2, §13): scopes are only `all`/`team`/`own`, and
`head_of_department` holds `home` at `team` = the line-manager tree, not the department. A department scope does
not exist (open question J).

### F3 · Alerts tab and the signal metrics (decision 6)

Tab counts (all Home · M1, Risk L once B2 lands): Open Alerts `cleared_at IS NULL`; Needs You = open alerts
whose rule's `permission_key` the viewer holds (`mayClear`) and whose `subject_employee_id` is in scope; Overdue
7 Days + `cleared_at IS NULL AND raised_at <= now() - interval '7 days'` (the mock filters `severity = 'high'`
instead: bug); Cleared This Week `cleared_at >= lagos.startOfDay(monday)`; Alert Sources, 30 Days `GROUP BY
rule (or category) WHERE raised_at >= now() - interval '30 days'` (cleared included); chips `GROUP BY category`.
List: `home_alert a JOIN home_alert_rule r USING (home_alert_rule_id)`, paged.

Signal sources. Push = an outbox handler on the owner's event; Sweep = a daily scheduler with `-- pagination:batch`.

| Rule metric (mock category) | Owner · M | Kind | Value computed from | Subject / subject_employee_id | Owes | Risk |
|---|---|---|---|---|---|---|
| late arrivals in W days (attendance) | Attendance · M1 | push on `attendance.punched` / day close | `count(*) FROM attendance_day WHERE employee_id = $e AND late_minutes > 0 AND attendance_date > $today - window_days` | employee / employee_id | auto-query unique key (M3 query raised on the same breach) | M |
| absence (attendance) | Attendance · M1 | sweep after day close | `status = 'absent'` in window | employee | writer unbuilt | M |
| missing clock-out (attendance) | Attendance · M1 | sweep next morning | yesterday `first_clock_in_at IS NOT NULL AND last_clock_out_at IS NULL`, or `attendance_exception.exception_type = 'missing_clock_out' AND status = 'open'` | employee | | M |
| new device (attendance) | Devices · M1 · LA | push on punch | `known_device.trusted_at IS NULL` | employee | enrolment status, three-device rule | M |
| approval ageing (approval) | Workflow · M0 | sweep | `workflow_instance WHERE state = 'pending' AND stage_entered_at < now() - window`; value = days waiting | `workflow_instance` / `subject_employee_id` | per-module `workflow_instance_id` columns (join works without them) | L |
| leave pending (approval) | Leave · M1 + workflow | sweep | as above, `definition_key = 'leave.approval'` | leave_request / employee_id | | L |
| document expiry (document) | Documents · M0 | sweep | `document WHERE is_current AND expires_on <= $today + window`; value must be inverted (B1 `direction`) | document / `subject_employee_id` | | L |
| contract ends (people) | Organisation · M0 | sweep | `employee.contract_ends_on <= $today + window` | employee | | L |
| confirmation due (people) | Organisation · M0 | sweep | `employee.confirmation_due_on <= $today + window AND confirmed_on IS NULL` (indexed) | employee | | L |
| partnership inactivity (partnership) | Partnerships · M7 | sweep (README M7: `partner-inactivity`) | `now() - coalesce((SELECT max(occurred_at) FROM partner_interaction WHERE partner_id = p.partner_id), p.created_at)` in days | partner / `owner_id` | mail threads bound to records, stages | H |
| contract renewal (partnership) | Partnerships · M7 | sweep | `partnership_agreement.ends_on <= $today + window` | agreement / owner_id | renewal date, MOU type | H |
| budget threshold (budget) | Budgets · M8 | push on expense approval + sweep | `100 * (spent_amount [+ committed_amount]) / nullif(amount,0)` per budget_line or per budget | budget / `owner_id` | approval threshold, statuses | H |
| recruitment SLA (recruitment) | Recruitment · M4 | sweep | `application.current_stage_entered_at < now() - window AND status = 'active'`; or `interview_panelist.submitted_at IS NULL AND interview_round.feedback_closes_at < now()` | application / vacancy.hiring_manager_id | final score, AI-provisional flag | M |
| payroll cycle (payroll) | Payroll · M6 | none | **no tables** | n/a | all of payroll | H (no source) |

Guide §7 names push signals `attendance.rule_breached`, `partnership.inactive`, `approval.aged`,
`document.expiring`, `recruitment.sla_missed`, `budget.threshold`; none exists in
`src/shared/events/catalogue.js` (only `home.alert_raised`, `home.alert_cleared`, `home.alert_escalated`). Home's
daily sweeps compute the time-based ones itself through the adapters until owners emit them.

### F4 · Reports tab and report sources (decision 8)

| Metric | Source | SQL sketch | Scope | Risk |
|---|---|---|---|---|
| Scheduled / Paused | report_schedule.active over saved_reports the viewer may see | `count(*) FILTER (WHERE s.active)` / `(WHERE NOT s.active)`; visibility = `owner_user_id = $me OR shared` and the viewer holds `permission_key` | owner or shared + permission | L |
| Runs This Month | home_report_run.run_at | `run_at >= monthStart` for visible reports | same | L |
| Recipients | report_schedule.recipients | `count(DISTINCT x) FROM report_schedule s, unnest(s.recipients) x WHERE s.active` | same | L |
| Report cards, Recent Runs | saved_report, report_schedule, home_report_run | paged joins | same; runs filtered to reports the viewer may see | L |

| Report source (`report_key`) | Owner · M | Reads | Gap |
|---|---|---|---|
| Daily Attendance | Attendance · M1 | roster (D1) for the day | field mode |
| Weekly Productivity | Tasks · M2 | task completion, overdue, workload by `employee.department_id` | cancelled status |
| Recruitment Pipeline | Recruitment · M4 | `recruitment_pipeline_summary` (all scope) or application + application_stage_history (time at stage) | none structural |
| Partnership Pipeline | Partnerships · M7 | partnership_opportunity, partnership_stage_history, agreement value | stages |
| Monthly Expenses | Expenses · M8 | expense_request / expense_transaction by department and category | **no project link** (the card says "by project") |
| Pending Approvals | Workflow · M0 | workflow_instance pending, `waiting()` per recipient | none |

### F5 · Donor and net-new tiles (MILESTONES §6.1)

| Tile | Source | Risk |
|---|---|---|
| `headcount` | `count(*) FROM employee WHERE status = 'active'` (M0) | L |
| `attendance_today` | roster (M1) | M |
| `leave_pending` | `leave_request status = 'submitted'` or `workflow_instance WHERE definition_key = 'leave.approval' AND state = 'pending'` (M1/M0) | L |
| `vacancies_open` | `vacancy WHERE status = 'open'` (M4) | M |
| `payroll_run_state` | none (M6) | H, retired until M6 |
| `attrition_90d` | `employee WHERE left_on >= $today - 90` (M0; status may later be `archived`, so read `left_on`, not status) | L |
| pending documentation | `document_request WHERE fulfilled_at IS NULL AND cancelled_at IS NULL` (M0, indexed); onboarding_checklist_item pending (M5) | L/M |
| upcoming confirmations | `employee.confirmation_due_on` (M0, indexed) | L |
| upcoming reviews | performance_cycle opens / performance_review due (M2) | M |
| budget versus actual | `budget_utilisation_summary` (all) or budget_line (team: `budget.owner_id`) (M8) | H |
| pending expenses | `expense_request status = 'submitted'` (M8) | H |

### F6 · Clock-in prompt trigger (decision 12)

Fires for the signed-in employee when all hold: `employee.status = 'active'`, today is a working day
(`isWorkingDay(today, cal)`), no approved `leave_request` covers today, no `attendance_event` `clock_in` today
(Lagos bounds), within `attendance_policy.earliest_clock_in_minutes` of the day's `working_week.starts_at`.
No table records "dismissed today": keep it stateless (client session) or add a column; the write itself goes
through the Attendance service (`attendance.clock_in`), never Home.

---

## G · Indexes

### G1 · Home may add in 1140 (tables numbered below it)

`home_alert (home_alert_rule_id)`, `(cleared_by)`, `(raised_at DESC)`, `(cleared_at) WHERE cleared_at IS NOT
NULL`, `(subject_employee_id)`; `report_schedule (saved_report_id)`, `(next_run_at) WHERE active`;
`saved_report (report_key)`; `event_log (occurred_at DESC)`, `(module_key, occurred_at DESC)`; with LA/AJ's
agreement: `attendance_event (occurred_at)`, `attendance_day (attendance_date)`, `attendance_exception
(attendance_day_id)`, `leave_request (employee_id)`, `(workflow_instance_id)`, `(starts_on, ends_on) WHERE status
= 'approved'`. New tables' FK indexes are in B4/B5.

### G2 · Must be requested from the owner (A1)

M2: `task_assignee (employee_id)`, `task (due_at) WHERE archived_at IS NULL AND completed_at IS NULL`,
`calendar_event (owner_employee_id, starts_at)`, `employee_target (employee_id, due_on)`,
`organisational_goal (level, starts_on, ends_on)`. M7: `partner_interaction (partner_id, occurred_at DESC)`,
`partner (owner_id)`, `partnership_opportunity (owner_id, status)`, `partnership_agreement (status, starts_on)`.
M8: `expense_request (status)`, `(employee_id)`, `budget (owner_id)`. M4: `application (status,
current_stage_entered_at)`, `vacancy (status)`. At MyCity's size (about 25 staff) none blocks M1; they matter for
the sweeps later.

### G3 · Source adapter declarations (decision 3)

One file per owning module under the dashboard module (e.g. `src/modules/dashboard/sources/<owner>.source.js`),
each exporting `{ module, milestone, owner, tables: { <table>: [<columns read>] }, owes: [...], available }`, so a
later milestone's PR sees what it may break. Columns each adapter reads today:

| Adapter | Tables and columns |
|---|---|
| attendance (M1, LA) | attendance_event(employee_id, event_type, occurred_at, worksite_id, known_device_id, validation_state); attendance_day(employee_id, attendance_date, status, first_clock_in_at, last_clock_out_at, late_minutes, worked_minutes); attendance_exception(attendance_day_id, exception_type, status); employee_attendance_policy(employee_id, attendance_policy_id, effective_from, effective_to); attendance_policy(grace_minutes, earliest_clock_in_minutes); known_device(known_device_id, trusted_at, created_at) |
| leave (M1, AJ) | leave_request(employee_id, leave_type_id, starts_on, ends_on, amount, status, workflow_instance_id); leave_balance(employee_id, leave_type_id, period_start, period_end, opening, accrued, used, adjusted); leave_type(name, unit) |
| tasks + calendar (M2, AJ) | task(task_id, title, status, due_at, completed_at, archived_at, primary_assignee_id, project_id); task_assignee(task_id, employee_id); calendar_event(owner_employee_id, title, event_type, starts_at, ends_at, all_day) |
| goals + kpis + targets + reviews (M2, AJ) | organisational_goal(level, title, status, starts_on, ends_on, weight, owner_employee_id, department_id, employee_id, parent_goal_id); employee_target(employee_id, organisational_goal_id, kpi_definition_id, title, target_value, actual_value, weight, status, due_on); kpi_definition(code, name, unit, direction); performance_cycle(starts_on, ends_on, status, closes_at); performance_review(performance_cycle_id, employee_id, reviewer_employee_id, review_type, status, submitted_at) |
| recruitment (M4, TB) | vacancy(status, hiring_manager_id, department_id, title, number); application(vacancy_id, stage, status, current_stage_entered_at); interview_round(feedback_closes_at); interview_panelist(employee_id, submitted_at) |
| onboarding (M5, LA) | onboarding_case(status, owner_id, starts_on); onboarding_checklist_item(status, assignee_id, due_at) |
| payroll (M6, LA) | none: `available: false` |
| partnerships (M7, GE) | partner(partner_id, name, status, owner_id, created_at); partnership_opportunity(stage, status, owner_id, estimated_value, currency, closed_at); partner_interaction(partner_id, occurred_at); partnership_proposal(status, sent_at, accepted_at, partnership_opportunity_id); partnership_agreement(status, value, currency, starts_on, ends_on, owner_id) |
| expenses + budgets (M8, AJ) | expense_request(expense_request_id, employee_id, department_id, expense_category_id, amount, currency, status, submitted_at); requisition(requester_id, status, total_amount, currency); budget(owner_id, department_id, status, starts_on, ends_on, currency); budget_line(budget_id, amount, committed_amount, spent_amount) |
| workflow, documents, organisation (M0, built) | workflow_instance(...via workflow.repo); document(expires_on, is_current, subject_employee_id); document_request(employee_id, fulfilled_at, cancelled_at); employee(status, left_on, confirmation_due_on, confirmed_on, contract_ends_on) |

Money from SQL `sum()` arrives as a string from node-pg; never `Number()` it; group by `currency` (every money
table here carries `currency char(3)`, none is constrained to NGN).

---

## H · Reference seeds relevant to Home

### H1 · `reference_value` domains seeded

| Domain | Codes | File |
|---|---|---|
| employment_status | active, suspended, left, archived | 0099, 0349 |
| work_pattern | on_site, hybrid, remote (`onsite` deleted) | 0099, 0199 |
| employment_type | full_time, part_time, contractor, consultant, intern | 0199 |
| gender | female, male | 0199 |
| attendance_status | present, late, absent, leave | 1099 |
| attendance_exception | missing_clock_out, outside_worksite, unknown_device | 1099 |
| leave_status | draft, submitted, approved, rejected | 1099 |
| notification_category | attendance, leave, community | 1099 (the code's categories are in `shared/notifications/categories.js`, incl. `alerts`) |
| task_status | todo, in_progress, in_review, done | 2099 |
| task_priority | low, normal, high, urgent | 2099 |
| goal_status | draft, pending_approval, active, completed | 2099 |
| review_status | draft, self_submitted, manager_submitted, acknowledged | 2099 |
| query_status | awaiting_response, under_review, resolved | 3099 |
| sanction_type | caution, warning, second_warning, suspension, suspension_without_pay, termination | 3099 |
| vacancy_status | draft, open, paused, closed | 4099 |
| application_stage | application, screening, assessment, interview, shortlist, offer, documentation, pre_onboarding, onboarding, hired, rejected | 4099 |
| assessment_type | psychometric, technical, case_study, practical | 4099 |
| offer_status | draft, approval, sent, accepted, declined, expired | 5099 |
| onboarding_status | pending, in_progress, completed, cancelled | 5099 |
| signature_status | pending, signed, declined, expired | 5099 |
| partner_type | government, corporate, ngo, vendor (to be replaced: A26) | 7099 |
| partnership_stage | lead, qualified, proposal, negotiation, agreement, active, closed (to be replaced by MyCity's twelve) | 7099 |
| interaction_type | email, call, meeting, note | 7099 |
| expense_status | draft, submitted, approved, rejected, paid, cancelled | 8099 |
| disbursement_status | pending, processing, paid, failed | 8099 |
| security_severity, access_review_decision, webhook_status | (M9) | 9099 |
| knowledge_status, knowledge_visibility, ai_message_role | (M10) | 10099 |

No domain exists for: project status, partner status, opportunity status, proposal status, agreement status,
budget status, requisition status, performance cycle status, interview/round status. Home must not invent their
spellings; the adapters read the values the owners define.

### H2 · Numbering schemes

Seeded and in `schemes.js`: employee (`''`, 5, no separator, from 0199), document DOC, import_batch IMP, query
QRY, sanction SAN, letter LTR, vacancy VAC, offer OFF, contract CON, payroll_run PAY (0, monthly, period), payslip
PAY (4, monthly, period), proposal PRO, mou MOU, expense EXP, requisition REQ, disbursement DSB (0099).
Seeded but **not** in `schemes.js` (allocate throws): project PRJ (2099), partner PAR, partnership_opportunity
POP, partnership_agreement AGR (7099), budget BUD, expense_request EXR (8099). No `report_run` scheme exists
(B4).

### H3 · Workflow definitions

`leave.approval` v1 (0499, module `people`, valid): stages `line_manager` (`manager_of_subject`, 48 h) then
`operations_people` (role, condition `days > 5`, 48 h). `employee_consequence` v1 (3099, module `queries`)
**fails `validateDefinition()`** (approver `{role: ...}` shape) and M3 owes its replacement; nothing of Home's
depends on it.

### H4 · Roles, Home grants and views (0290)

| Role (rank, home_view) | `home` grant (scope; v c e d a x) |
|---|---|
| implementation (100, operations) | all; all six |
| operations_people (90, operations) | all; all six |
| management (80, operations) | all; v c e a x |
| head_of_department (60, partnerships) | team; v c e a x |
| administrator (50, staff) | own; v |
| manager (40, staff) | team; v |
| employee (10, staff) | own; v |

The CEO is `app_user.is_ceo` plus `management` (seeds/staff/roles.json), and `/me` gives `home_view = 'ceo'`.
`head_of_department` is held only by "Head PR, Marketing & Brand Strategy" today and opens the **Partnerships**
Home. Cards inherit rights from these module grants: `people` (attendance, leave), `workspace` (tasks, calendar),
`performance`, `recruitment` (not granted to `manager`, `administrator`, `employee`), `payroll` (not granted to
`head_of_department`, `administrator`, `manager`, `employee`), `partnerships`, `expenses`.

Pitfall: `employee` and `administrator` hold **no `people` grant**. A staff member's own attendance and leave
cards (day strip, My Attendance 30d, Upcoming Leave) must inherit from `ess` (always `own`, `OWN_ONLY` in
`access.catalog`), not `people`, or the eligibility check retires them for every plain member of staff.
Likewise `employee` holds `partnerships` and `expenses` at `own` scope, so an own-scope card for those is
eligible for everyone; that is correct only if the card is about the viewer's own records.

### H5 · Other seeded data Home touches

`working_week` (0099, 0199), `public_holiday` 2026 and 2027 with `expected` moon-dated days (0448),
`attendance_policy` 'Standard' grace 0 (1099, an A26 business choice, LA's), the three alert rules (1099, B7),
capabilities `announcements.post`, `alerts.clear` with their role grants (0449), `field_visibility` (0449).

---

## I · Staging seed: tagging rows in forward tables (decision 11)

`seeds/staging/NN_name.js` runs only through `scripts/db/seed.js --staging` (refuses production by APP_ENV,
database name and `system_marker`), after every migration, so it can write forward tables. Free columns that
could carry a tag: `partner.metadata`, `candidate.profile`, `application.answers`, `expense_transaction.metadata`,
`employee_query.evidence`, `attendance_event.validation`, `attendance_exception.evidence`, `kpi_definition.scoring`
(jsonb); `task.description`, `project.description`, `calendar_event.description`, `organisational_goal.description`,
`leave_request.reason` (text). Most tables have none (`task_assignee`, `budget`, `budget_line`,
`partnership_opportunity`, `partnership_agreement`, `partnership_proposal`, `requisition`, `disbursement`,
`attendance_day`, `employee_target`, `vacancy`). Recommendation: **deterministic ids** (UUID v5 from a fixed
namespace per seed file and a natural key), which tags every table without a column, makes the seed idempotent
(`ON CONFLICT (pk) DO NOTHING`) and lets an owner delete exactly Home's rows later (`WHERE id = ANY(...)`). The
README rule is "seeds through services"; forward modules have no services yet, so these inserts are direct SQL
(§J). Numbers on forward rows need their schemes: five of the forward types are missing from `schemes.js` (H2),
so use fixed numbers with a staging prefix rather than `allocate()`.

---

## J · Conflicts and open questions (carried into the JSON summary)

1. Capability code `home.alerts.manage` is rejected by `CapabilityCode` (one dot only) in
   `packages/contract/schemas/access.js`.
2. `alerts.clear` (0449) is checked nowhere; `alerts.clear()` authorises by the rule's `permission_key`
   (any scope) or CEO. Requiring the capability on the route as well would lock out line managers the rule
   names; using only it ignores the rule.
3. `home_alert` does not store `subject_employee_id`: no scoped Alerts list, and `mayClear()` ignores scope.
4. Guide §4 `home_report` / `home_report_run` vs built `saved_report` / `report_schedule` (decision 1): guide
   fields `formats`, `reporting_line`, `permission_key` have no column; `recipients` are emails, not users.
5. Guide header says backend module `home`; README §5.2/§5.4 says `dashboard`, `alerts`, `reports`.
6. Attendance guide §4 describes tables (`attendance_session`, `attendance_location`, `attendance_assignment`,
   `attendance_case`, `attendance_policy_version`) that 1000 did not build; the built shape is
   `attendance_day`/`attendance_event`/`attendance_exception`. Its permission key `attendance` is not in the
   access catalogue (attendance is under `people`).
7. Mock and reference statuses disagree (`on_time`/`remote`/`no_clockout`/`not_yet` vs `present`/`late`/
   `absent`/`leave`); `attendance_day.status` and `leave_request.status` have no CHECK.
8. Mock "Overdue 7 Days +" counts high-severity alerts, not age; mock Team "Attendance This Month" bars reuse
   `kpi_pct`.
9. MILESTONES §6.2 per-day `grace_minutes` (A22) is not in `working_week`; grace is per attendance policy.
10. `head_of_department` has `home_view = 'partnerships'` but is a generic department head.
11. 1099 seeds the `Standard` attendance policy, also a business choice under A26 (LA's, not in decision 7).
12. Staging seeds are to go "through services", but forward modules have no services.
13. Six seeded numbering types are absent from `schemes.js`; `allocate()` throws on them.
14. M1 Home files cannot index or reference M2+ tables (A1); the forward indexes in G2 are owner requests.
15. `employee` and `administrator` roles hold no `people` grant, so staff attendance and leave cards must gate
    on `ess`, not `people` (H4).
16. `leave.approval` is defined with `module_key = 'people'`; an approver without a `people` grant does not see
    it in My Approvals (`waitingWhere` filters by the modules the person approves in), which shapes Need You.

Open: what `home_alert_rule.scope` means; department scope for function leads (guide §13); the report audience
(`reporting_line`) model and whether `home_report_delivery` is accepted; the FY signed-value target's source;
how "goal on track" and departmental KPI scores are computed before M2 defines progress; whether clock-in prompt
dismissal is stored; who owns the M1 attendance indexes (LA) Home's reads need; a rule `direction` for deadline
metrics versus inverting the value in handlers.

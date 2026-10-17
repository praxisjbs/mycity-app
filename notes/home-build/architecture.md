# Home (M1) · Architecture constraints brief

Read-only survey of `/home/user/mycity-app` (17/10/2026). Sources: `docs/BACKEND_STRUCTURE.md` (all),
`docs/SYSTEM_ARCHITECTURE.md` (all), `README.MD` §3 to §11, `docs/MyCity-ERP-Documents/REUSE_MAP.md`
(all), `docs/guides/home.md`, `docs/MIGRATIONS.md` §6 to §9, `docs/BACKEND_GUIDE.md` §2, §3.4, §3.5, §5,
and the code cited inline. Every path is repo-relative unless absolute.

---

## 0 · Answers first

1. **Where Home's backend lives: three modules, not one.** Use the stubs the README map, CODEOWNERS and
   route-map already name: `src/modules/dashboard/` (Overview, KPI catalogue, KPI detail, Team, role_kpi,
   personal picks, source adapters), `src/modules/alerts/` (rules, alerts, signal handlers, sweeps) and
   `src/modules/reports/` (definitions, schedules, runs, generation). All three are guarded by the `home`
   permission key (README §5.2: `home` → `dashboard`, `alerts`, `reports`). There is **no**
   `src/modules/home/` folder, and creating one would fail three process gates (§13). The guide's header
   (`Backend modules | home`) is the thing that is wrong; it must become `` `dashboard`, `alerts`, `reports` ``
   or the guides gate stops tracking the code (§13, conflict C1).
2. **basePath: all three declare `basePath: "/home"`.** The loader mounts each router with
   `targets[surface].use(def.basePath, def.router)` and only refuses a duplicate `METHOD + full path`, so
   three routers under one prefix are legal (precedent: `announcements` mounts at `/community/announcements`
   beside `community` at `/community`). `"/home"` (not `/home/reports`) is needed because the frontend's
   interim map already calls `GET /api/v1/home/report-runs` and `GET /api/v1/home/alert-rules`, which sit
   outside `/home/reports` and `/home/alerts`.
3. **Discovery is by file name only.** Routes: `<m>/<m>.routes.js` (non-empty). Worker handlers:
   `<m>/<m>.events.js` and `<m>/*.import.js` only. AI: any `<m>/*.ai.js`. Search: any `<m>/*.search.js`.
   Anything else (signal handlers, source adapters, kpi-catalog tiles) loads only if one of those files
   `require`s it.
4. **Contract files:** `packages/contract/schemas/dashboard.js`, `alerts.js`, `reports.js` (all exist,
   empty). They surface as `c.dashboard.*`, `c.alerts.*`, `c.reports.*`. Not `home.js` (conflict C2).
5. **POST double submit:** the staff router already runs `middleware/idempotency.js` above every module;
   the client must send `Idempotency-Key` per press and the route must answer JSON (a 204 is not
   replayable). The service must also be idempotent on its own (§8).

---

## 1 · Stub inventory (every Home-related file that exists today)

All sizes in bytes; "0" means the file exists and is empty.

### 1.1 Backend modules

| File | Size | Notes |
|---|---|---|
| `src/modules/dashboard/dashboard.routes.js` | 0 | |
| `src/modules/dashboard/dashboard.controller.js` | 0 | needs `// search:none` or a provider; `// ai:none` or `.ai.js` |
| `src/modules/dashboard/dashboard.service.js` | 0 | |
| `src/modules/dashboard/dashboard.repo.js` | 0 | |
| `src/modules/dashboard/dashboard.events.js` | 0 | worker loads it once non-empty |
| `src/modules/dashboard/dashboard.test.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/index.js` | 0 | README §5.4 names these |
| `src/modules/dashboard/kpi-catalog/eligibility.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/guards.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/tiles/people.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/tiles/work.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/tiles/business.js` | 0 | |
| `src/modules/dashboard/kpi-catalog/tiles/finance.js` | 0 | |
| (no `dashboard.ai.js`, no `dashboard.search.js`) | n/a | create, or opt out in the controller |
| `src/modules/alerts/alerts.routes.js` | 0 | |
| `src/modules/alerts/alerts.controller.js` | 0 | |
| `src/modules/alerts/alerts.service.js` | 0 | |
| `src/modules/alerts/alerts.repo.js` | 0 | |
| `src/modules/alerts/alerts.events.js` | 0 | |
| `src/modules/alerts/alerts.ai.js` | 0 | |
| `src/modules/alerts/alerts.test.js` | 0 | |
| (no `alerts.search.js`) | n/a | route-map's `home_alert` marker expires once alerts has controller + repo (§11) |
| `src/modules/reports/reports.routes.js` | 0 | |
| `src/modules/reports/reports.controller.js` | 0 | |
| `src/modules/reports/reports.service.js` | 0 | |
| `src/modules/reports/reports.repo.js` | 0 | |
| `src/modules/reports/reports.events.js` | 0 | |
| `src/modules/reports/reports.test.js` | 0 | |
| (no `reports.ai.js`, no `reports.search.js`) | n/a | |
| `src/modules/kpis/*` (`kpis.{routes,controller,service,repo,events,ai,test,weights}.js`) | all 0 | **Performance (M2) KPIs, not Home's KPI cards.** Owner AJ/TB per README §5.5; table `kpi_definition` (migration 2000). Do not put the Home catalogue here (C9) |
| `src/modules/attendance/*` (`routes, controller, service, repo, events, ai, test, rules, lateness, clock-guard, reconcile, auto-query, analytics, export, calendar`) | all 0 | LA's. Decision 4 adds `attendance.roster.js` here (flat name passes readme-map) |
| `src/modules/{leave,devices,worksites,workspace,tasks,goals,targets,partners,partner_pipeline,expenses,budgets,vacancies,candidates,payroll}/*` | all 0 | every forward module Home reads is an empty stub today |

### 1.2 Shared and jobs

| File | Size | Notes |
|---|---|---|
| `src/shared/alerts/alerts.js` | 13046 | **built** engine (§9) |
| `src/jobs/schedulers/alert-ageing.js` | 745 | built; hourly at :10, swallows `42P01` until the tables exist |
| `src/jobs/schedulers/scheduled-reports.js` | 0 | stub; not in `jobs/registry.js` `SCHEDULERS` |
| `src/jobs/handlers/scheduled-report.js` | 0 | stub; not in `jobs/registry.js` `JOBS` |
| `src/jobs/schedulers/{approval-ageing,budget-threshold,partner-inactivity}.js`, `src/jobs/handlers/{approval-ageing,budget-threshold,partner-inactivity}.js` | 0 | M7/M8 owners per README §5.15 (C7) |
| `src/jobs/schedulers/attendance-day-close.js`, `src/jobs/handlers/attendance-day-close.js` | 0 | LA, M1 |
| `templates/email/scheduled-report.html` | 0 | stub mail template (needs front matter + `defineVariables`) |
| `templates/documents/` | no report template | add e.g. `report.html` (allowed path, no README change) |

### 1.3 Contract

| File | Size |
|---|---|
| `packages/contract/schemas/dashboard.js` | 0 |
| `packages/contract/schemas/alerts.js` | 0 |
| `packages/contract/schemas/reports.js` | 0 |
| `packages/contract/schemas/kpis.js` | 0 (M2) |
| `packages/contract/schemas/attendance.js`, `leave.js`, `worksites.js`, `devices.js` | 0 |
| `packages/contract/schemas/home*.js` | **none** |

### 1.4 Frontend (built against the mock; not wired)

| File | Size |
|---|---|
| `app/src/features/home/index.tsx` | 15543 |
| `app/src/features/home/blocks.tsx` | 5952 |
| `app/src/features/home/KpiDetail.tsx` | 1886 |
| `app/src/api/types/home.ts` | 6404 (INTERIM endpoint declarations, see §5.4) |
| `app/src/api/mock/modules/home.ts` | 35923 |
| `app/src/features/shared/{KpiTiles.tsx,wire.ts,sections.tsx,PhoneCards.tsx,...}` | shared |
| `app/src/shell/access.ts` | 1443 (tab gating, §4.6) |

### 1.5 Tests and docs

- No Home test under `tests/`. The alert engine is exercised in `tests/integration/shared-layer.test.js`
  (lines ~449 to 489: raise, 403 on clear, clear twice, `escalateAged`) and
  `tests/unit/foundation/events-workflow.test.js`.
- `docs/PROGRESS.md` rows 471 to 474: #1 Overview, #2 Alerts, #3 Reports, #86 Team, all `Not started`.
- `docs/DATABASE_SCHEMA.md` M1 "Owes": `home_report_run`, `role_kpi`, "alert scope".

---

## 2 · Module discovery and mounting (exact behaviour)

### 2.1 Routes (`src/http/module-loader.js`)

```js
// discover(): for every dir matching /^[a-z][a-z0-9_]*$/
//   <name>/<name>.routes.js          → staff  (mounted under /api/v1<basePath>)
//   <name>/<name>.public.routes.js   → public (/api/public/v1<basePath>)
// skipped quietly when the file is EMPTY (size 0)
module.exports = { basePath: "/home", surface: "staff", router };   // shape every routes file exports
```

Checks at load (`checkDefinition`), each a boot failure (strict) or a skipped, reported module:
- `surface` must equal the file kind; `basePath` must match `/^\/[a-z0-9/_-]*$/`.
- No nested `router.use()` (hides routes from the contract).
- Every route on the router must have been defined with `route()`/`publicRoute()`.
- A duplicate `METHOD /api/v1/<full path>` across modules throws:
  `Duplicate route ${full}: defined by ${seen.get(full)} and ${label}`.
- `discover()` does **not** sort directory entries, so mount order between dashboard, alerts and reports
  is filesystem order. Harmless while no two routers can match the same URL; never add a catch-all.

### 2.2 Worker (`src/worker.js`)

Load order: `SHARED_HANDLER_FILES` (`fanout`, `workflow/engine`, **`alerts/alerts`**, `documents/vault`,
`documents/generate`, `import/engine`) → every non-empty `<m>/<m>.events.js` and `<m>/*.import.js`
(sorted) → `registry.registerTriggers()` → `registerDelivery()` → `outbox.markReady()` → AI and search
registries → consumers, schedules, heartbeat. **A file that fails to load stops the worker boot.**

Consequence: an outbox handler that lives in `alerts/alerts.signals.js` or `dashboard/sources/*.js` is
never registered unless `alerts.events.js` / `dashboard.events.js` requires it.

The API process does not load events files on boot; they load when a service requires them (for
`EVENTS` constants). `audit.service.loadCatalogue()` force-loads every events file for the Audit Log
labels, so an events file must load cleanly in the API too.

### 2.3 AI and search

- `shared/ai/registry.js` discovers every non-empty `src/modules/*/*.ai.js`; `shared/search/registry.js`
  every non-empty `*.search.js` (sorted). Both load in `server.js` and `worker.js`.
- Gate 9 (`scripts/check/ai-manifest-coverage.js`): a module whose `*.controller.js` has content needs a
  non-empty `*.ai.js` or `// ai:none <reason>` in a controller. Gate 10
  (`scripts/check/search-coverage.js`): a module with a non-empty controller **and** repo needs a
  non-empty `*.search.js` or `// search:none <reason>`.
- Precedent for a sibling opting out: `src/modules/announcements/announcements.controller.js`
  ```js
  // search:none announcements are found through community.search.js
  // ai:none the announcements reads are declared in community.ai.js
  ```

### 2.4 Recommended layout (concrete)

| Module | basePath | Routes (all `requirePermission("home", "view")` first) | Extra gate |
|---|---|---|---|
| `dashboard` | `/home` | `GET /overview`, `GET /kpi/:key/meta`, `GET /kpi/:key`, `GET /team/summary`, `GET /team`, personal picks (e.g. `GET /kpi-picks`, `PUT /kpi-picks`), role_kpi admin if it lives here | `/team*`: `requireCapability("home.team")` |
| `alerts` | `/home` | `GET /alerts/summary`, `GET /alerts`, `POST /alerts/:id/clear`, `GET /alert-rules`, `POST /alert-rules`, `PATCH /alert-rules/:id` | `/alerts*`: `requireCapability("alerts.clear")`; `/alert-rules*`: the rule-manage capability (C3) |
| `reports` | `/home` | `GET /reports/summary`, `GET /reports`, `POST /reports`, `PATCH /reports/:id`, `POST /reports/:id/run`, `GET /report-runs` (and/or `GET /reports/:id/runs`, C4) | `requireCapability("home.reports")` |

Define literal sub-paths **before** `/:id` routes on the same router: `uuidParams` turns a non-UUID
`:id` into `next(new AppError("NOT_FOUND", ...))`, so `/reports/summary` defined after `/reports/:id`
would 404 (`src/shared/http/validate.js` `uuidParams`). Params named `id` or `*_id` are UUID-checked
automatically; `:key` is not.

---

## 3 · Defining a route (`src/http/route.js`)

```js
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./alerts.controller");

const router = express.Router();
const al = c.alerts;
const view = () => requirePermission("home", "view");
const clearer = () => requireCapability("alerts.clear");

route(router, "get", "/alerts/summary", { response: al.AlertSummary, summary: "Alert counts" }, view(), clearer(), controller.summary);
route(router, "get", "/alerts", { query: al.HomeAlertQuery, response: al.HomeAlertPage, summary: "Open alerts" }, view(), clearer(), controller.list);
route(router, "post", "/alerts/:id/clear", { body: al.HomeAlertClear, response: al.HomeAlert, summary: "Clear or dismiss an alert" }, view(), clearer(), controller.clear);

module.exports = { basePath: "/home", surface: "staff", router };
```

Refused **at definition** (process does not boot):
- a schema not exported from `packages/contract` (`knownSchemas()` identity check);
- no `response` (use `no_content: true` for a 204);
- POST/PUT/PATCH without `body` (use `c.common.EmptyBody`); GET with a body;
- a staff route with no handler carrying `.permission` (only `requirePermission`/`requireAnyPermission`
  set it), unless `self: true` or `anonymous: true`. **`requireCapability()` does not set
  `.permission`, so it can never be the only check**: pair it with `requirePermission("home", ...)`
  exactly as `announcements.routes.js` does.
- unknown contract keys (allowed: `body, query, params, response, no_content, anonymous, self, summary`).

Chain built: `auth → uuidParams → your handlers → validator → responseCheck (test/dev) → controller`.
Under `APP_ENV=test` every 2xx JSON is parsed with `response` and a mismatch throws; strict schemas
mean an extra key fails the test.

Controller shape (precedent `announcements.controller.js`):

```js
const { ok, created } = require("../../shared/http/respond");   // ok, created, accepted, noContent
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req), req.user)),
  clear: async (req, res) => ok(res, await service.clear(req.validated.params.id, req.validated.body, req.user)),
};
```

---

## 4 · Permissions

### 4.1 Vocabulary (`src/shared/access/access.catalog.js`)

- 15 module keys; Home's is `home` (`{ key: "home", area: "top", label: "Home", description: "Overview, team, alerts and reports" }`).
- Actions: `view create edit delete approve export` (`edit`, never `update`). Scopes `all > team > own`.
- `requirePermission(key, action)` refuses an unknown key/action **at boot**;
  `scripts/check/module-catalogue.js` requires literal keys. `home.team` etc. are **not** module keys and
  can never be passed to `requirePermission` or written as a `home_alert_rule.permission_key`.

### 4.2 What `requirePermission` gives you (`src/middleware/rbac.js`)

```
req.scope       "all" | "team" | "own"   (widest across roles; CEO → "all")
req.scope_ids   null for all; [caller, ...team] for team; [caller] for own
req.permission  { key, action }
```
Repo turns it into SQL with `scopeClause(scopeOf(req), { column: "e.employee_id" }, params)`
(`src/shared/rbac/scope.js`); single record: `assertInScope(scope, ownerEmployeeId)` → 404.

Seeded `home` grants (`seeds/reference/0290_seed_roles_and_grants.sql`):

| Role | scope | actions |
|---|---|---|
| implementation, operations_people | all | all six |
| management | all | view create edit approve export |
| head_of_department | team | view create edit approve export |
| manager | team | **view only** |
| administrator, employee | own | view only |

So `requirePermission("home", "view")` already yields the right Team scope (team for managers and heads,
all for People/Operations/Management, CEO all). Gating report building on `home.create` would lock
managers out; that is why decision 2 uses capabilities on top of `home.view`.

### 4.3 Capabilities (`requireCapability(code)`)

```js
function requireCapability(code) {           // middleware/rbac.js
  return async function capabilityCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo === true) return next();          // CEO holds every capability
    const held = await grantsCache.getCapabilities(pool, req.user.user_id);  // 30 s Redis cache
    if (!held.includes(code)) throw new AppError("CAPABILITY_REQUIRED", "This needs an authority you do not hold", 403);
    return next();
  };
}
```
- Codes live in `capability (code citext UNIQUE, name, description)`; held via `user_capability`
  (per person, optional `expires_at`) **or** `role_capability` (migration 0400). `getCapabilities` unions
  both (role rows honour `user_role.effective_to`).
- Existing seed `seeds/reference/0449_seed_field_visibility_capabilities.sql`: `alerts.clear` and
  `announcements.post`, granted to `implementation`, `operations_people`, `management`. New codes
  (`home.team`, `home.reports`, the rule-manage one) are reference data (code lists the code switches on,
  allowed by A26) in a new `seeds/reference/1xxx_seed_*.sql` with `ON CONFLICT (code) DO NOTHING` and
  `role_capability` rows with `ON CONFLICT (role_id, capability_id) DO NOTHING`.
- **Pitfall (C3): `CapabilityCode` in `packages/contract/schemas/access.js` is
  `/^[a-z][a-z_]*\.[a-z][a-z_]*$/` (exactly two segments).** `home.alerts.manage` would be rejected by
  `RoleSave` on Settings · Roles & Permissions, so nobody could grant it on screen. Either name it with
  two segments (`home.alert_rules`, `alerts.manage`) or widen the regex in `access.js` (touches the
  identity/foundation guides).

### 4.4 Non-route permission checks

```js
const { scopeFor, readPermissions } = require("../../middleware/rbac");
await scopeFor(user, "people", "view");   // → { scope, scope_ids, employee_id } | null  (same decision as requirePermission)
await readPermissions(req, [["people","view"],["partnerships","view"]]);  // → [bool,...] for SHAPING only, never authorising
```
`scopeFor` is what "a card inherits rights" (decision 5) and "generate as the recipient" (decision 8)
must call. `user` needs `{ user_id, employee_id, role_ids, is_ceo }`; for a recipient who is not the
caller, load it with `grantsCache.getAuthUser(pool, userId)` (returns `user_id, employee_id, email,
status, is_ceo, display_name, role_ids`; check `status === "active"`).

### 4.5 Alert clearing is grant-based, not capability-based

`shared/alerts/alerts.js`:
```js
function parsePermission(key)  // "people.approve" → ["people","approve"]; throws unless catalogue module + action
async function mayClear(client, user, rule)  // CEO, or any scope of rule.permission_key's grant
```
- `home_alert_rule.permission_key` must be `<module>.<action>` from the **catalogue** (`people.approve`),
  never a capability code. `raise()` calls `parsePermission` and throws otherwise.
- The raised-alert notification audience is that same grant:
  `defineNotification(ALERTS.HOME_ALERT_RAISED, { to: [{ permission: (e) => e.payload.clear_permission }] })`
  in `src/shared/notifications/fanout.js` (~line 470).
- With decision 2 the clear route stacks `requireCapability("alerts.clear")` on top of `mayClear`. A
  person holding the rule's grant but not the capability is then blocked at the route although they are
  notified (C5). Decide which is the gate.

### 4.6 Tab visibility today (must change with capabilities)

Two mirrored copies decide whether Team/Alerts/Reports tabs show, both using `manages_people` and "full"
(settings grant or CEO), not capabilities:
- `app/src/shell/access.ts` lines 16 to 17
- `src/shared/search/screens.js` `tabVisible()` lines 134 to 135 (search must never offer a tab the menu hides)

```js
if (module === "home" && tab === "team") return reader.manages_people || reader.is_ceo;
if (module === "home" && (tab === "reports" || tab === "alerts")) return full || reader.manages_people;
```
`/me` (`identity.service`, `c.identity` `Me`) returns `grants, roles, home_view, manages_people`, **not
capabilities**. Switching tab gating to capabilities needs: `capabilities` added to `/me`
(identity contract and guide), `access.ts`, and `readerOf(db, user)` in
`src/shared/search/search.service.js` (~line 233) + `screens.js`. Note
`role.home_view` (`operations | ceo | partnerships | staff`, migration 0200, seeded per role in 0290) is
already the per-role Home layout selector; `/me.home_view` = `"ceo"` for the CEO flag, else the first
role's non-null `home_view`, else `"staff"`.

---

## 5 · Contract (`packages/contract`)

### 5.1 Files and naming

- `packages/contract/index.js` requires every `schemas/*.js` and exposes it by basename:
  `c.dashboard`, `c.alerts`, `c.reports` (an empty file exposes `{}`).
- `readme-map` allows `packages/contract/schemas/<m>.js` only when `src/modules/<m>` exists (or `common`).
  A `home.js` would need a README entry and would not match CODEOWNERS.
- Generator (`scripts/gen/contract.js`): every exported capitalised schema gets
  `export type <Name>`; a name two domains share is **prefixed with its domain** (`AlertsSummary` vs
  `ReportsSummary`), which changes the type the frontend imports. Prefer unique names
  (`AlertSummary`, `ReportSummary`, `TeamSummary`).
- `contract.gen.ts` is never edited; `npm run gen:contract`; CI `--check` fails a stale file.

### 5.2 Rules every schema file follows

- Keys `snake_case` (generator refuses others).
- Every exported object schema is declared in the file's `TABLES` export (gate 6,
  `scripts/check/contract-columns.js`):
  ```js
  const TABLES = {
    HomeAlert: { table: "home_alert", virtual: { category: "derived from the rule's metric", who_clears: "label of the rule's permission", age: "days since raised_at, worded" } },
    HomeAlertQuery: { table: null, reason: "list controls and filters of GET /home/alerts" },
    AlertSummary: { table: null, reason: "the four counts and the sources bar of the Alerts tab" },
  };
  module.exports = { TABLES, HomeAlert, HomeAlertQuery, /* ... */ };
  ```
  A key that is not a column of the named table and not `virtual` with a reason fails. Tables must exist
  in `migrations/` (`saved_report`, not `home_report`).
- Lists: `listQuery(filters, sortable)` (`.strict()`, `page`, `q`, one `sort`); responses `Paged(item)`.
  No `limit/offset/per_page/page_size` key anywhere (`scripts/check/pagination.js`).
- Body-less writes: `c.common.EmptyBody`. Ids: `c.common.uuid`. Money: `c.common.money` (string
  `"1250000.00"`). Dates: `c.common.isoDate` / `isoDateTime`. Optional typed form fields: `blank(schema)`.
- Templates' variables are schemas too: `defineVariables("email", "scheduled-report", c.reports.ScheduledReportEmailVars)`
  with `TABLES` entry `{ table: null, reason: "the variables of templates/email/scheduled-report.html" }`
  (precedent `c.audit.AuditExportEmailVars`).

### 5.3 Wire field names already used by the frontend (`app/src/api/types/home.ts`)

These are INTERIM. Where they are not column names they must be `virtual` in `TABLES`, or the UI
changes: `HomeAlert.category, who_clears, age`; `AlertRule.name, example` (no `name`/`example` column on
`home_alert_rule`; it has `key`); `HomeReport.home_report_id, cadence, status, audience` (table is
`saved_report` with `saved_report_id`); `ReportRun.run_id, report, recipients, formats` (no table yet).

### 5.4 Interim endpoints the screens call today

```
GET  /api/v1/home/overview                 GET  /api/v1/home/kpi/:key/meta     GET /api/v1/home/kpi/:key (group)
GET  /api/v1/home/team (status)            GET  /api/v1/home/team/summary
GET  /api/v1/home/alerts (category)        GET  /api/v1/home/alerts/summary    POST /api/v1/home/alerts/:id/clear {outcome, note?}
GET  /api/v1/home/alert-rules              POST /api/v1/home/alert-rules       PATCH /api/v1/home/alert-rules/:id
GET  /api/v1/home/reports                  GET  /api/v1/home/reports/summary   POST /api/v1/home/reports
POST /api/v1/home/reports/:id/run {format} GET  /api/v1/home/report-runs
```
`app/src/api/endpoints.ts`: "An INTERIM key that the contract also declares is a type error: when a
module's routes land, its INTERIM entries go." The PR that mounts a route must delete its line from
`home.ts` in the same change or `fe:typecheck` fails.

---

## 6 · Pagination (BACKEND_STRUCTURE §16, `src/shared/http/paged.js`)

```js
const { pageQuery, orderBy, TOTAL_COL, sendPaged, assertPage, completeQuery } = require("../../shared/http/paged");
const SORTS = { raised_at: "a.raised_at", severity: "a.severity" };       // first key = default order
return pageQuery(client,
  `SELECT a.home_alert_id, a.title, ..., ${TOTAL_COL}
     FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
    WHERE a.cleared_at IS NULL AND ($1::text IS NULL OR r.metric = $1)
    ORDER BY ${orderBy(query, SORTS, "a.home_alert_id")}`,
  [query.category ?? null], query);                 // → { data: ≤25 rows, page: { number, size: 25, total, pages, has_next } }
```
- `pageQuery` throws without `TOTAL_COL` (`COUNT(*) OVER() AS _total`), without `ORDER BY`, or with a
  hand-written `LIMIT/OFFSET/FETCH FIRST`. Finish every order on a unique column.
- Gate refuses `LIMIT`/`OFFSET` in `src/` except `LIMIT 1` and a worker batch claim
  `LIMIT $1 -- pagination:batch <why>` on the same line (never in a route, controller or manifest).
  Precedent: `escalateAged` uses `LIMIT $2 -- pagination:batch alerts one ageing run escalates`.
- `completeQuery` (≤5000, throws above) only with `// pagination:complete <reason>` on the line above;
  never a list a person scrolls, never an AI read.
- Overview is "bounded" (not paged) but each embedded list must come from page 1 of a `pageQuery` and
  link to its paged endpoint. "Top 5" means page 1 sliced in JS from a page that is already ≤25, never
  `LIMIT 5`.
- Report generation over a large set walks pages, as `audit.service.gather()` does:
  ```js
  let page = await repo.page(db, { ...filters, page: 1 });
  while (page.page.has_next && rows.length < EXPORT_CEILING) page = await repo.page(db, { ...filters, page: page.page.number + 1 });
  ```

---

## 7 · One write path: service, transaction, `emit()`, outbox

### 7.1 Service skeleton (BACKEND_GUIDE §3.4)

```js
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const client = await pool.connect();
try {
  return await atomically(client, async () => {
    const row = await repo.insertRule(client, { ...body, created_by: actor.user_id });
    await emit(client, { key: EVENTS.HOME_ALERT_RULE_CREATED, entity: { type: "home_alert_rule", id: row.home_alert_rule_id }, actor, after: row });
    return row;
  });
} finally { client.release(); }
```
- `atomically` nests (inner joins outer). `alerts.raise/clear`, `numbering.allocate`,
  `documents.generate`, `vault.store` all throw unless `inTransaction(client)`.
- `emit(client, { key, entity:{type,id}, actor, before?, after?, payload?, module?, metadata?, dedup_key? })`
  writes `event_log` + `audit_ledger` + `event_outbox` in one statement. `entity.type` matches
  `/^[a-z][a-z0-9_]*$/`; payload ≤16 KiB (ids and facts, not rows); credential-looking keys are redacted.
- Never send mail, render a PDF, call AI or enqueue user-visible work inside the request transaction;
  that is an outbox handler (`<m>.events.js`). Realtime is best effort and only from handlers/jobs.
- A repo never writes for another module. A Home write into another module (the clock-in prompt,
  decision 12) calls that module's service (`attendance.service`), not its tables.

### 7.2 Event keys (`src/shared/events/catalogue.js`)

```js
const { defineEvents } = require("../../shared/events/catalogue");
const EVENTS = defineEvents("home", {                       // module = permission key
  "home.alert_rule_created": { summary: "An alert rule was created" },
  "home.alert_rule_changed": { summary: "An alert rule was changed" },
  "home.report_run_requested": { summary: "A report was asked for" },
});
EVENTS.HOME_ALERT_RULE_CREATED   // "home.alert_rule_created"
```
- Already declared in the shared catalogue under module `home`:
  `ALERTS.HOME_ALERT_RAISED` (`home.alert_raised`), `HOME_ALERT_CLEARED`, `HOME_ALERT_ESCALATED`.
  Re-declaring a key is allowed only with the same module.
- Options: `summary` (required, no em dash), `security`, `sensitive`. Key `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`.
- First segment picks the notification category: `home` → `alerts`
  (`src/shared/notifications/categories.js` lines 112, 194).

### 7.3 Outbox handlers (`src/shared/events/outbox.js`)

```js
const outbox = require("../../shared/events/outbox");
outbox.register("attendance.rule_breached", "alerts.raise_attendance", async (event, ctx) => { /* ... */ });
```
- Handler name `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/`, unique per key, **stable across deploys**
  (renaming re-runs a pending retry).
- `register` checks only the key's shape, not that any module declares it. A handler for a forward
  signal (`partnership.inactive`, M7) registers today and simply never fires; if the owner later spells
  the key differently it stays silent forever. Option: declare the signal keys once with the **owner's**
  module key in Home's source adapter (`defineEvents("partnerships", { "partnership.inactive": {...} })`);
  the owner's later declaration with the same module is allowed and the spelling is then pinned.
- At least once; per-handler completion; backoff 10 s doubling to 1 h; `max_attempts` 8; each handler
  stopped after 2 min. Handlers must be idempotent (`alerts.raise` is: `ON CONFLICT ... DO UPDATE`).
- Notifications are declared, not written: `defineNotification(key, { to: [...], title, body, priority })`
  in the events file (`src/shared/notifications/fanout.js`).

---

## 8 · Idempotency and double submit (guide §11)

### 8.1 HTTP layer (`src/middleware/idempotency.js`, mounted once in `src/http/routes.js` above every staff module router)

- Applies to POST/PUT/PATCH/DELETE carrying `Idempotency-Key` (8 to 200 chars `[A-Za-z0-9._:-]`),
  only with a valid token.
- Outcomes: new → runs and stores the 2xx JSON; same key + same `(user, method, path, body)` hash →
  replays the stored response with `Idempotency-Replayed: true`; same key, still running → 409
  `IDEMPOTENCY_IN_PROGRESS` + `Retry-After: 2`; same key, different request → 422
  `IDEMPOTENCY_KEY_REUSED`. 4xx/5xx and non-JSON responses (204, files) release the key. Kept 48 h.
- **So `POST /alerts/:id/clear` and `POST /reports/:id/run` must answer JSON with a 2xx** (not
  `no_content`), or a double press is not replayed.
- Client side (`packages/ui/src/data/createApi.ts`): `api.call(key, { ..., idempotencyKey })` sets the
  header. Precedent: `app/src/features/community/Chat.tsx`
  `api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() })`.
  One key per press, reused on retry of that press.

### 8.2 Service layer (still required: two presses can carry two keys)

- Clear: `alerts.clear()` locks the row `FOR UPDATE OF a`; a second clear returns the alert as it is, with
  no second `emit` (no second audit row). Keep that path; do not wrap it in another emit.
- Report run: make a run idempotent by a natural key (for example a unique
  `(saved_report_id, recipient_user_id, period/requested window)` or the request's key stored on the run)
  and give its jobs `jobId`s derived from the run id, so a retried outbox handler or a double press
  produces one file and one numbered run.

---

## 9 · The alert engine (`src/shared/alerts/alerts.js`, built)

```js
const alerts = require("../../shared/alerts/alerts");
alerts.SEVERITIES                // ["low","medium","high"]
alerts.ESCALATE_AFTER_DAYS       // 14
alerts.parsePermission(key)      // "people.approve" → ["people","approve"]
alerts.evaluate(rule, value)     // → { breached: v >= t, over_by: round2(v - t) }   (Number(), 2 dp)
alerts.ageDays(alert, now)
await alerts.ruleByKey(client, key)            // enabled rule or null; SELECT home_alert_rule_id, key, metric, threshold, window_days, severity, permission_key, enabled
await alerts.raise(client, { rule, subject: { type, id }, value, title, trigger?, subject_employee_id?, actor? })
      // → { raised, created, alert }; emits home.alert_raised only when created
await alerts.mayClear(client, user, rule)
await alerts.clear(client, { alert_id, actor, outcome: "cleared"|"dismissed", note })   // 403 PERMISSION_DENIED, 404, 422 INVALID_OUTCOME
await alerts.escalateAged({ db, days, limit })  // per-alert tx; emits home.alert_escalated (CEO notified, high priority)
```
Behaviour to rely on:
- Disabled rule → `raise` returns `{ raised:false }`. Below threshold → nothing. One open alert per
  `(rule, subject_type, subject_id)`; re-raise updates `over_by, title, trigger, last_seen_at`.
- An alert never closes itself. **Switching a rule off does not clear its open alerts** (guide §6 says it
  should): the rules service must clear/dismiss them itself, through `alerts.clear` per alert, in the
  same transaction as the rule change (C6).
- `over_by` is `numeric(18,2)` after migration 1100; `trigger` nullable after 1100.
- `subject_employee_id` in the payload makes `team` holders above that employee the audience.
- Columns it reads/writes (BACKEND_STRUCTURE §11.1): `home_alert_rule(home_alert_rule_id, key UNIQUE,
  metric, threshold, window_days, severity, permission_key, enabled)`; `home_alert(home_alert_id,
  home_alert_rule_id, subject_type, subject_id, title, trigger, severity, over_by, raised_at, last_seen_at,
  escalated_at, cleared_at, cleared_by, outcome, note)`, partial unique index
  `home_alert_open_subject_uq ... WHERE cleared_at IS NULL`. Renaming any of these changes this file in
  the same PR.
- Migration 1000 lacks the guide's `home_alert_rule.scope` and `created_by` (and the interim UI's
  `name`); DATABASE_SCHEMA lists "alert scope" as owed. Add by fix-forward in the M1 block.
- `"N in W days"` counting: `src/shared/rules/window-counter.js`
  (`windowBounds(rule, asOf)`, `evaluate(rule, dates, asOf)`, `firstBreach`), Lagos dates, window ends on
  and includes `asOf`.

Ageing: `src/jobs/schedulers/alert-ageing.js` (`pattern: "10 * * * *"`, Lagos) calls `escalateAged()`
and returns `{ skipped: "no home_alert table yet" }` on `42P01`. The tables now exist (1000), so this
already runs.

---

## 10 · Background work (`src/jobs/`)

### 10.1 Registry (`src/jobs/registry.js`), the single list

```js
const JOBS = Object.freeze([ { queue: "email-send", concurrency: 3, summary: "..." }, /* ... */ ]);   // queue name = handlers/<queue>.js
const SCHEDULERS = Object.freeze(["outbox-dispatch","workflow-timeout","alert-ageing","media-reconcile","import-cleanup","celebrations","announcement-release","mail-sync"]);
const TRIGGERS = Object.freeze([ { event: "document.render_requested", name: "jobs.pdf-render", queue: "pdf-render", data: (e) => ({ document_id: ... }) }, /* ... */ ]);
```
- Adding `scheduled-report` (handler) and `scheduled-reports` (scheduler), or a Home daily sweep, means
  adding the line here **and** the file; `queues.enqueue()` refuses an undeclared queue
  (`queues: "<name>" is not a queue (declare it in jobs/registry.js)`).
- TRIGGERS require `catalogue.has(event)` at registration, so a trigger on an event nobody declares
  fails the worker boot (unlike `outbox.register`).

### 10.2 Scheduler file

```js
const { defineSchedule } = require("../registry");
module.exports = defineSchedule({
  name: "scheduled-reports",          // must equal the file name; kebab-case
  every: 5 * 60 * 1000,               // or pattern: "0 6 * * *" (five fields, Africa/Lagos unless tz)
  summary: "Scheduled reports whose time has come, queued per recipient",
  run: () => require("../../modules/reports/reports.service").queueDue(),   // lazy require
});
```
Ticks run on the shared `schedule` queue under `withCronLock(name, fn)` (Postgres
`pg_try_advisory_lock`, key `mycity:cron:<name>`): a second process skips, never queues. `attempts: 1`:
the next tick is the retry, so every sweep must be safe to repeat.

### 10.3 Handler file

```js
const { UnrecoverableError } = require("bullmq");
const { isLastAttempt } = require("../registry");
module.exports = async function scheduledReport(job) {
  const id = job.data && job.data.report_run_id;
  if (!id) throw new UnrecoverableError("scheduled-report: the job needs report_run_id");
  return require("../../modules/reports/reports.service").generate(id);   // idempotent
};
```
Enqueue (`src/jobs/queues.js`): `queues.enqueue(queue, jobName, data, opts)`; data is JSON ids only;
defaults 5 attempts, exponential 5 s; `jobId` dedups while waiting/running; `replaceFinished: true`
lets a recurring jobId run again. The request context rides along as `__ctx`.

### 10.4 Precedents to copy

- `announcements.events.js`: outbox handler enqueues a **delayed** job with a deterministic `jobId`, plus a
  5-minute safety-net scheduler (`announcement-release`) for jobs lost with Redis. Same shape suits
  scheduled reports.
- `celebrations` scheduler + handler: a daily cron in Lagos plus a by-hand re-run queue.

### 10.5 Ownership overlaps (C7)

README §5.15 already assigns `approval-ageing` and `budget-threshold` (M8) and `partner-inactivity` (M7)
schedulers and handlers to later milestones. Decision 6's "daily sweeps for time-based metrics" in Home
overlaps with them. If Home ships a sweep (for example one `home-alert-sweep` scheduler calling each
source adapter's `sweep()`), say in README §5.15 and in each adapter which later scheduler replaces or
feeds it, so M7/M8 do not build a second evaluator.

---

## 11 · Reports engine: what exists to build on

### 11.1 Tables (migration `1000_core_operations.sql`, decision 1 keeps them)

```sql
saved_report   (saved_report_id uuid PK, owner_user_id uuid NOT NULL → app_user, name text NOT NULL,
                report_key text NOT NULL, definition jsonb NOT NULL, shared boolean NOT NULL DEFAULT false,
                created_at, updated_at, UNIQUE (owner_user_id, name))
report_schedule(report_schedule_id uuid PK, saved_report_id → saved_report ON DELETE CASCADE,
                recurrence jsonb NOT NULL, timezone text NOT NULL DEFAULT 'Africa/Lagos',
                recipients citext[] NOT NULL, active boolean NOT NULL DEFAULT true,
                last_run_at, next_run_at, created_at, updated_at)
```
Missing (fix-forward in 1000 to 1999): `home_report_run`, formats, audience/permission columns, a time of
day for the schedule, paused state if distinct from `active`. 1000 creates no triggers; the existing
tables got the generic `set_updated_at` trigger from `9095_updated_at_triggers.sql` (a loop over every
table with `updated_at` at the time it ran). A new M1 file applied on a database where 9095 has already
run is not covered, so every new table creates its own `<table>_set_updated_at` (MIGRATIONS §6), and
must not use the plain name `set_updated_at` (9095's DOWN drops that name everywhere).

### 11.2 Schedules are `recurrence` rules, not cron (C8)

`src/shared/time/recurrence.js` names "scheduled reports" as a consumer:
```js
{ freq: "daily", interval: 1, working_days_only: true }      // every working day
{ freq: "weekly", interval: 1, by_weekday: [1, 3] }
validateRule(rule) → string[]      assertRule(rule)
occurrences(rule, start, { from, to, calendar })   nextAfter(rule, start, after, { calendar }) → "YYYY-MM-DD" | null
```
Dates only; "the time of day, when a thing has one, is stored next to the rule". The guide's
`schedule (cron, nullable)` does not match the table or this helper.

### 11.3 Numbering (`src/shared/numbering/`)

```js
const numbering = require("../../shared/numbering/numbering");
const { number } = await numbering.allocate(client, "report_run");   // inside atomically(); "RPT-0001"
```
- Add `report_run` to `SCHEMES` in `src/shared/numbering/schemes.js` and a reference-seed row
  (`INSERT INTO numbering_scheme ... ON CONFLICT (doc_type) DO NOTHING`). `/api/health/ready` fails when
  a `SCHEMES` type has no row; `scripts/check/numbering-schemes.js` fails a non-literal or unknown type.
- Existing types: employee, document, import_batch, query, sanction, letter, vacancy, offer, contract,
  payroll_run, payslip, proposal, mou, expense, requisition, disbursement (+ project, partner, ... from
  later seeds). No report type yet.
- Column: `number citext NOT NULL UNIQUE` (MIGRATIONS §6). Rolled-back tx consumes no number.

### 11.4 PDF: `documents.generate` (async render)

```js
const { defineDocType, generate } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
defineDocType("home_report", { label: "Report", module: "home", template: "report", numbering: null,
                               sensitivity: "personal", title: (d) => d.report_name, landscape: true });
defineVariables("document", "report", c.reports.ReportDocumentVars);
const doc = await generate(client, { doc_type: "home_report", entity: { type: "home_report_run", id: runId },
                                     data, actor: recipientUserId, date });
// → document row, render_status "pending"; emits document.render_requested
```
- After commit the `pdf-render` job (TRIGGER on `document.render_requested`) calls
  `renderPending(id)` → Chromium → storage → `content_hash` → `locked_at` → emits
  **`document.generated`** (`payload: { document_id, doc_type, number, content_hash }`). Email the PDF
  from an outbox handler on `vault.EVENTS.DOCUMENT_GENERATED` filtered by `payload.doc_type`, never
  before (the file does not exist yet). Last failed attempt emits `document.render_failed`.
- Template: `templates/documents/report.html` (new, allowed path) inside `letterhead.html`. Render
  language (`src/shared/documents/render.js`): `{{ x }}`, `{{#if}}`, `{{#each rows}}`, helpers `date`
  (09/10/2026), `longdate`, `datetime`, `month`, `money` (₦1,250,000.00), `number`, `markdown`. Every value
  escaped; nothing else can format a date or amount.
- If `numbering` is set on the doc type, `generate` allocates a **second** number for the document;
  with the run numbered separately keep `numbering: null` and pass the run number in `data`.

### 11.5 XLSX: `buildWorkbook` + `vault.store` (synchronous in the worker)

```js
const { buildWorkbook } = require("../../shared/spreadsheet/build");
const { workbookContext } = require("../../shared/spreadsheet/context");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const buffer = await buildWorkbook({ sheets: [{ name, columns /* {key, header, width, format: money|date|datetime|int|pct|...} */, rows, freeze: { y: 1 } }],
                                     context: workbookContext({ actor: { name: reader.display_name }, title, filters }), cover: true });
const doc = await atomically(client, () => vault.store(client, {
  file: { buffer, originalname: exportFilename({ base: "daily-attendance", env: config.APP_ENV, extension: "xlsx" }) },
  purpose: "document", doc_type: "home_report", entity: { type: "home_report_run", id: runId },
  sensitivity: "personal", source: "generated", title, actor: reader.user_id }));
```
Dates are real date cells shown dd/mm/yyyy; money typed numbers shown `₦#,##0.00`; staging stamp on the
cover. `purpose: "document"` allows xlsx (`src/shared/files/mime-policy.js`).

### 11.6 Who can download a run (`vault.canRead`)

Order: `defineAccess` rule for the entity type (decides alone) → CEO → subject employee → **uploader
(`uploaded_by === user.user_id`)** → doc type's module (`home`) `view` grant, scope `all` only when
there is no `subject_employee_id`; `restricted` also needs `home.edit` (managers lack it). So: set
`actor` = the recipient (they can re-download), avoid `restricted`, and consider
`vault.defineAccess("home_report_run", (client, user, doc) => ...)` to keep a run to its recipient and
the CEO. Download through the existing `GET /api/v1/documents/:id/content` (documents module, gated by
`canRead`, 404 when not readable).

### 11.7 Email

```js
await queues.enqueue("email-send", "scheduled-report", {
  to: { name: reader.display_name, email: reader.email },
  template: "scheduled-report",            // templates/email/scheduled-report.html (currently EMPTY: needs front matter subject/title)
  data: { /* declared by defineVariables("email","scheduled-report", schema) */ },
  attachments: [{ document_id }],          // by id; a job carries no bytes
}, { jobId: `scheduled-report-mail-${runId}` });
```
Paced (`MAIL_SEND_PER_HOUR`); permanent errors fail at once; staging subjects start `[STAGING]`.

### 11.8 Generation "as the recipient" (decision 8): the precedent is `src/modules/audit/audit.events.js`

```js
const reader = await grantsCache.getAuthUser(pool, userId);
if (!reader || reader.status !== "active") return;                 // left or suspended: send nothing
const scope = await scopeFor(reader, "people", "view");           // the source's own module grant
if (!scope) return;                                                // cannot open it on screen: no file
const rows = await source.gather(pool, filters, scope);            // pages of 25, ceiling, masked for reader
```
Field masking for the reader: `fieldMask.maskedKeysFor(db, reader)` (as `audit.service.gather`).
Donor shape for the definitions: `praxis-ls/src/modules/vault/report/report.service.js` keeps a
`REPORTS = { report_key: { describe, run(client, params) } }` registry, which fits
`saved_report.report_key` + `definition jsonb`.

---

## 12 · Search, AI, route map, realtime

### 12.1 Route map (`src/shared/route-map.js`)

```js
home: ["overview", "alerts", "reports", "team"],                                  // SCREENS
home_alert: screen("home", "alerts"), // search:none not built yet (src/modules/alerts)
home_report: screen("home", "reports"), // search:none not built yet (src/modules/reports)
home_report_run: screen("home", "reports"), // search:none not built yet (src/modules/reports)
kpi: screen("performance", "kpis"), // search:none not built yet (src/modules/kpis)
```
- Links are `/<module>?tab=<tab>&id=<id>`, derived on read, never stored.
- Gate 10 (`search-coverage.js` rule 4): a `not built yet (src/modules/<m>)` marker holds **only while
  `<m>` has no controller and repo**. The moment `alerts` has both, `home_alert` must be declared by a
  provider or carry a real reason; same for `reports` (`home_report`, `home_report_run`). There is no
  entity type for `home_alert_rule`, KPI cards or `saved_report`; add lines if they get providers.
- Entity type names are independent of table names (`home_report` can select `FROM saved_report r`).

### 12.2 Search provider (`src/shared/search/provider.js`)

```js
const { recordProvider } = require("../../shared/search/provider");
module.exports = recordProvider({
  type: "home_report", module: "home", label: "Reports",
  words: ["report", "attendance report", "scheduled report"],
  from: "saved_report r", key: "r.saved_report_id",
  columns: ["r.name", "r.report_key"],
  select: "r.saved_report_id AS id, NULL::text AS ref, r.name AS title, r.report_key AS sub",
});
```
- The service checks the module's `view` grant first and applies scope via `scope: { column }`; a
  provider never picks a page size or builds a URL. `owner: { column }` for per-person rows.
- Custom provider objects are allowed for rule-based visibility (precedent `workflow.search.js`
  `waiting`: `{ type, module, label, words, scoped:false, columns:[], empty, pinned, async search(client, { term, page, user }) }`),
  which suits "alerts I can clear".
- Everyday words go in the provider's `words`, the screen synonyms in `src/shared/search/screens.js`
  (already: Overview "home, dashboard, kpis, needs you"; Alerts "alert, warnings, issues, red flags";
  Reports "report, analytics, insights"; Team "my team, direct reports").
- New-action labels from `useScreenAction({ label })` (New Report, New Rule) must be in
  `src/shared/search/actions.js` or carry the marker.

### 12.3 AI manifest (`src/shared/ai/manifest.js`)

```js
module.exports = defineManifest({
  module: "home",
  reads: [{
    key: "alerts.mine", description: "List the open alerts I can clear, oldest first",
    params: c.alerts.HomeAlertQuery,          // a listQuery: pages at 25
    permission: ["home", "view"],             // reads need `view`
    run: (_client, params, actor) => service.listForUser(actor, params),   // actor.scope = { scope, scope_ids, employee_id }
    cite: (row) => ({ type: "home_alert", id: row.home_alert_id, label: row.title }),
  }],
  routes: [{ intent: "clear an alert", screen: "home.alerts" }],   // "<module>.<tab>" from SCREENS
});
```
Refused at load: any write-shaped key (`write, writes, actions, action, executor, execute, executors,
mutations, creates, updates, deletes`), non-contract `params`, non-`view` permission, duplicate keys
across modules, em dashes in descriptions. `authorise.js` runs `scopeFor` first and `assertPage` on
every list result (≤25). The AI never clears, edits a rule or runs a report (A23). Capabilities are not
checked by `authorise.js`, so a read meant for capability holders must enforce it in `run`.

### 12.4 Realtime

`src/services/realtime/emitter.js`: `toUser(userId, event, payload)`, `toChannel`, `send(room, ...)`;
rooms `user:<id>`, `session:<id>`, `channel:<id>`; best effort, returns false and logs, never throws;
called only from outbox handlers and jobs. Live Home refresh (for example after `attendance.punched`)
is a `toUser` from a handler, never from a controller.

---

## 13 · Process gates Home touches (they fail the build or the Stop hook)

| Gate | What it means for Home |
|---|---|
| `scripts/check/guides.js` | The guide header `Backend modules` decides what code it covers (`src/modules/<m>/` and `packages/contract/schemas/<m>.js`). With `home` there, changes to `dashboard/alerts/reports` are covered by no guide; update the header. Touching `src/modules/attendance/` (decision 4's roster) requires a Change log line in `docs/guides/attendance.md` too (`Backend modules | attendance`), whose text has no roster today. |
| `scripts/check/readme-map.js` | Free: `src/modules/<m>/<m>.<anything>.js`, `packages/contract/schemas/<m>.js` (module must exist), `migrations/NNNN_*.sql`, anything under `seeds/ tests/ docs/ templates/ assets/ app/`. **Not free:** subfolders such as `src/modules/dashboard/sources/attendance.js` or new `src/jobs/schedulers/<x>.js` must be named in README (`onMap` matches file base + folder name as words). `kpi-catalog/...` is already on the map. |
| `scripts/check/codeowners.js` | `/src/modules/{dashboard,alerts,reports}/` and their contract files are already owned (TB, GE). A new `src/modules/home/` would have no owner line. |
| `scripts/check/progress.js` | Product code change needs a dated note in `docs/PROGRESS.md` (or `Progress-unchanged:`). |
| Gate 6 `schema-drift.js` | Every SQL string in `src/` and `scripts/` is checked against `migrations/`: `alias.column`, INSERT column lists, UPDATE SET lists, and tables no migration creates. **Source adapters for tables that do not exist fail it** (no `payroll_run` table: there is no 6000 migration). Tables that do exist: 2000 `task, task_assignee, organisational_goal, kpi_definition, employee_target, performance_*`; 4000 `vacancy, candidate, application, application_stage_history, interview*`; 7000 `partner, partnership_opportunity, partnership_stage_history, partner_interaction, partnership_*`; 8000 `expense_category, budget, budget_line, expense_request, requisition*, disbursement, expense_transaction`; 9090 views `attendance_summary, recruitment_pipeline_summary, partnership_pipeline_summary, budget_utilisation_summary` (views are skipped by the gate). |
| Gate 6 `contract-columns.js` | `TABLES` for every exported object schema (§5.2). |
| Gate 7 `route-contracts.js` | every route has a contract; writes a body. |
| Gate 8/17 `dashes.js` | no em dash in `src/` strings (alert titles, event summaries, mail, PDF templates). |
| Gates 9, 10 | §2.3, §12. |
| `module-catalogue.js` | literal keys in `requirePermission`; capability codes are not checked. |
| `numbering-schemes.js` | literal `allocate(client, "report_run")`, type in `schemes.js`. |
| `pagination.js` | §6. |
| `provenance.js` | ported code never names `praxis-ls`, `pixie-girl-hub` or their paths, in code, comments, tests or config. |
| Migration gates 3, 4, 5 | number unique across `migrations/` and `seeds/reference/` in 1000 to 1999; `-- UP`/`-- DOWN`; idempotent; DOWN names everything UP creates; `-- DESTRUCTIVE:` on drops/type changes; never edit a merged file. |

M1 numbers already used: `1000`, `1099` (seed), `1100`, `1110`, `1120`, `1130`. LA (attendance) and AJ
(leave/devices) also owe M1 migrations: agree numbers before opening PRs.

---

## 14 · Migrations and seeds (rules that bind Home's fix-forward)

- One file per change in the M1 block; schema in `migrations/`, reference data in `seeds/reference/`,
  numbers unique across both. Applied files are hash-locked.
- Table shape (MIGRATIONS §6): singular snake_case, PK `<table>_id uuid DEFAULT gen_random_uuid()`,
  `created_at`/`updated_at` + `CREATE OR REPLACE TRIGGER <table>_set_updated_at BEFORE UPDATE ...
  EXECUTE FUNCTION set_updated_at()` in the same file; every FK says `ON DELETE` and has an index;
  status/type `CHECK (col IN (...))` spelled exactly as the contract enum; `number citext NOT NULL
  UNIQUE` from `numbering.allocate`; files as `document_id uuid REFERENCES document(document_id)`;
  money `numeric(18,2)`; a filtered or sorted field is a column, not a jsonb key.
- Match the code (MIGRATIONS §7): every `ON CONFLICT (...)` target has a matching unique index (with the
  same `WHERE` when partial); `NOT NULL` without default only when every writer supplies the value.
- **A26 / decision 7:** `seeds/reference/1099_seed_core_operations.sql` seeds three thresholds
  (`attendance.absence`, `attendance.lateness`, `leave.pending`) with `ON CONFLICT (key) DO UPDATE`.
  Thresholds are a business choice, so they move out in a fix-forward reference file. Mind:
  `home_alert.home_alert_rule_id` has no `ON DELETE` (default NO ACTION, which refuses), so deleting a rule that has
  alerts fails; delete only rules with no alerts, or disable them, and put the demonstration rules in
  `seeds/staging/` (JavaScript, through services). Also `1099`'s DOWN deletes those keys, which is
  harmless once they are gone.
- Reference seeds may carry: capability codes and their `role_capability` rows for system roles,
  numbering schemes, code lists. **Per-role KPI defaults (`role_kpi`) are arguably "business choices"**
  under A26 (open question Q3).
- Production is never seeded (A5); staging demo rows (decision 11) go in `seeds/staging/*.js`
  (`seeds/staging/10_staff.js` exists), through services, refused on production by
  `scripts/db/seed.js` (APP_ENV, database name, `system_marker`).

---

## 15 · First administrator and the employee rule (BACKEND_STRUCTURE §17)

- No login without an employee: `app_user.employee_id uuid NOT NULL REFERENCES employee`. Every Home
  read can assume `req.user.employee_id` is set; `grantsCache` joins `employee` for `display_name`.
- `scripts/db/create-admin.js` creates department → employee → app_user → user_role in one tx through
  `organisation.service`, `identity.service`, `access.service`; actor
  `{ user_id: null, source: "script:create-admin" }`. Tests and seeds call the exported `createAdmin()`.
  The CEO is `app_user.is_ceo` (unique), not a role: Home's CEO view and capability bypass key off
  `req.user.is_ceo === true`.
- A suspended or left account cannot sign in, so it never reaches Home; but a **scheduled report
  recipient** can be inactive between runs, hence the `status === "active"` check in §11.8.

---

## 16 · REUSE_MAP facts relevant to Home

- §2.1 Dashboard (TB): take praxis `src/modules/dashboard/kpi_catalog/` whole: `index.js` (221, self-check
  at require time, throws at boot on a half-flipped entry), `eligibility.js` (97), `guards.js` (54): a
  tile inherits rights, eligibility at read time. Six `human_capital.js` tiles port almost unchanged:
  `headcount, attendance_today, leave_pending, vacancies_open, payroll_run_state, attrition_90d`. Leave
  `money.js, operations.js, fleet_warehouse.js, sales_procurement.js` (831 loc; "must not be ported for
  later"). `dashboard/dashboard/` service (314) + repo (295): band assembly, role config. Net-new tiles:
  partnership pipeline, pending expenses, budget vs actual, pending documentation, upcoming
  confirmations and reviews. The donor folder also has `resolve.js` and `shared.js` not named in the
  map or the guide.
- §3.2 places `praxis-ls/src/modules/security/role_kpi/` (398 loc: "per-role KPI config: scope, default,
  lock") under **M2 Performance**, while home.md §12 and decision 5 put `role_kpi` in Home M1 (C10).
- §4 (M3): `praxis-ls/src/modules/vault/report/` + `services/documents/templates` (734+) is "letter
  generation from a template". home.md §12 uses it for report generation; the scheduler is net-new.
- §1.4 (as built): `shared/alerts/alerts.js` is net-new ("Neither tree has work-nobody-has-done alerts
  with ageing"); `cron-lock` is a Postgres advisory lock, not Redis; the outbox loads every
  `<module>.events.js` instead of a hand-kept list; `jobs/workers.js` became `jobs/registry.js` +
  `worker.js` with `defineSchedule` and BullMQ job schedulers; `pdf-render` renders a pending generated
  document by id; `services/spreadsheet/` ported with `context.js`, NGN, Lagos dates; the search
  provider pages at 25 through `pageQuery`; `email-send` has one system sender and permanent failures
  fail at once.
- §2.2: the attendance engine is pixie's (Lagos-native), with praxis `attendance.analytics.js` (M2's
  analytics, built early) and `attendance.export.js`; owner LA. Home's roster read sits on that module.
- §7 (M6): the payroll engine and its tables arrive in M6; there is no `payroll_run` table today.
- §8 (M7): praxis `party-360.service.js` zero-data pattern (every figure 0, every collection `[]`) is
  the guide's "renders cleanly at zero" rule.
- §11 (M10): manifests from M1 or M10 "becomes an archaeology exercise"; the praxis write contract is not
  ported.

---

## 17 · Conflicts (docs vs code vs owner decisions)

- **C1** home.md header `Backend modules | home` vs README §5.2/§5.4, CODEOWNERS, route-map markers
  (`src/modules/alerts`, `src/modules/reports`) and the existing stubs, which all say `dashboard`,
  `alerts`, `reports`. The guides gate keys on the header.
- **C2** home.md §5 "Every request and response shape is a Zod schema in
  `packages/contract/schemas/home.js`" vs the existing empty `dashboard.js`, `alerts.js`, `reports.js`
  and readme-map's "module must exist" rule.
- **C3** Decision 2's `home.alerts.manage` (three segments) vs `access.CapabilityCode`
  `/^[a-z][a-z_]*\.[a-z][a-z_]*$/`; also home.md's header lists `home.team`, `home.alerts`,
  `home.alerts.manage`, `home.reports` as "permission keys", but the catalogue has only module keys.
- **C4** home.md §5 `GET /api/v1/home/reports/:id/runs` vs the frontend interim
  `GET /api/v1/home/report-runs`; and the frontend calls `/kpi/:key/meta`, `/team/summary`,
  `/alerts/summary`, `/reports/summary`, which the guide's API table does not list. `POST /reports/:id/run`
  body is `{ format }` in the UI and `HomeReportRun` in the guide.
- **C5** Clearing: `alerts.mayClear` (rule's catalogue grant) vs decision 2's `alerts.clear` capability
  on the route; the notification audience is the grant holders, so a notified person may be refused.
- **C6** home.md §6 "switching a rule off clears its open alerts" vs `alerts.raise` which only stops
  raising; nothing clears automatically.
- **C7** README §5.15 assigns `approval-ageing`, `budget-threshold` (M8) and `partner-inactivity` (M7)
  schedulers to later milestones vs decision 6's Home daily sweeps for time-based metrics.
- **C8** home.md §4 `home_report.schedule (cron)` vs `report_schedule.recurrence jsonb` +
  `shared/time/recurrence.js` (no cron); home.md §4 `home_report` table vs decision 1's `saved_report`
  + `report_schedule` (decision wins); route-map entity `home_report` vs table `saved_report` (fine, but
  contract `TABLES` must say `saved_report`).
- **C9** README §5.2 maps `kpis` to `performance` (M2 `kpi_definition`) while Home's KPI cards are the
  dashboard catalogue; route-map `kpi` opens Performance. Naming collision only; keep Home's catalogue
  in `dashboard/kpi-catalog/`.
- **C10** REUSE_MAP §3.2 puts `role_kpi` in M2 Performance; home.md §4/§12 and decision 5 put it in Home
  M1. CLAUDE.md step 3 says REUSE_MAP wins over MILESTONES, but the owner decision is explicit.
- **C11** home.md §4 `home_alert_rule` lists `scope` and `created_by`; migration 1000 has neither
  (DATABASE_SCHEMA "Owes ... alert scope"). The interim UI also needs `name` and `example`.
- **C12** Seeded thresholds in `1099` (`ON CONFLICT DO UPDATE ... enabled = true`) break A26 (decision 7
  moves them out); `home_alert` FK to rule has no `ON DELETE`, so removal must handle existing alerts.
- **C13** Tab gating in `app/src/shell/access.ts` and `src/shared/search/screens.js` uses
  `manages_people`/"full", and `/me` has no capabilities, vs decision 2's capability gating.

---

## 18 · Open questions

- **Q1** Capability naming for rule management (`home.alert_rules`? `alerts.manage`?) or widen
  `CapabilityCode` in `access.js`.
- **Q2** Which gate decides who may clear: the `alerts.clear` capability, the rule's
  `permission_key` grant, or both (and should the raised-alert notification audience match)?
- **Q3** Are `role_kpi` per-role defaults reference data (seeded in every environment) or a business
  choice entered on screen (A26)? Where is the role_kpi editor: Home, or Settings · Roles?
- **Q4** Final paths for run history (`/home/report-runs` vs `/home/reports/:id/runs`) and the
  `*/summary` endpoints; the guide's §5 table must list whatever ships.
- **Q5** Who owns the time-based sweeps once M7/M8 land (C7), and does Home's sweep call the source
  adapters or do the owners emit signals?
- **Q6** Report run document access: recipient-only (`vault.defineAccess("home_report_run", ...)`) or
  anyone with `home.view` all-scope?
- **Q7** Does the guide's `home.alerts` (see) map to `alerts.clear` alone, or to a separate view
  capability?
- **Q8** Migration numbers inside 1000 to 1999 to reserve for Home vs LA/AJ's pending M1 migrations.

---

## 19 · Pitfall checklist

- [ ] `requireCapability` never alone: always `requirePermission("home", "view")` first, or `route()` throws at boot.
- [ ] Literal sub-paths (`/summary`, `/meta`) before `/:id` on the same router.
- [ ] No `src/modules/home/`; no `schemas/home.js`; update home.md's `Backend modules` header.
- [ ] Every outbox handler file is required from `<m>.events.js` (worker loads nothing else).
- [ ] `alerts.raise/clear`, `numbering.allocate`, `documents.generate`, `vault.store` only inside `atomically()`.
- [ ] `permission_key` on a rule is `<catalogue module>.<action>`, never a capability.
- [ ] POST endpoints return JSON 2xx (replayable), and services are idempotent on their own.
- [ ] No `LIMIT` except `LIMIT 1` or `-- pagination:batch` in worker claims; Overview lists are page 1 of `pageQuery`.
- [ ] Remove each INTERIM line from `app/src/api/types/home.ts` in the PR that mounts its route.
- [ ] New queues/schedulers declared in `jobs/registry.js` and named in README §5.15.
- [ ] `route-map.js` `not built yet` markers for `home_alert`, `home_report`, `home_report_run` replaced by providers in the PR that builds the module.
- [ ] Email only after `document.generated` for PDFs; XLSX stored with `vault.store` in the worker.
- [ ] Recipient checked `status === "active"` and `scopeFor(reader, ...)` non-null before any file is built.
- [ ] Source adapters never query a table no migration creates (gate 6); payroll has none yet.
- [ ] No em dash in any string (alert titles, summaries, templates, manifest descriptions).
- [ ] Ported code carries no donor names or paths (`provenance.js`).
- [ ] Touching `src/modules/attendance/` (roster) needs an `attendance.md` Change log line and LA as code owner reviewer.

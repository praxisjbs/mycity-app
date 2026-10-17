# Brief: exemplar modules end to end (so Home matches them exactly)

Repo: `/home/user/mycity-app`. Everything below was read from the code on 17/10/2026; quotes are
verbatim unless marked "sketch". Read-only brief: nothing in the repo was changed.

Best exemplars, by what they teach:

| Module | Best for |
|---|---|
| `src/modules/organisation` | the full staff-module shape: scoped paged list, summary, 360, writes with emit + numbering, ai.js, search.js (3 providers), events with outbox handler |
| `src/modules/workflow` | `self: true` routes decided in the service, service-owned transactions, "waiting on you" SQL, a custom (non-SQL) search provider, defineNotification |
| `src/modules/notifications` | smallest complete `self` module (5 routes), `// ai:none` + `// search:none` markers, realtime follow-on in events.js |
| `src/modules/documents` | `self` reads + `no_content` streaming routes, `defineDocumentType`, markers with an EMPTY `documents.ai.js`/`documents.search.js` |
| `src/modules/access` | tiny routes file, single-provider search.js, ai.js with a get read |
| `src/modules/identity` | `/auth/me` (`self`), `anonymous` routes, `Me` schema |
| `src/modules/ess` | aggregator with no repo, reads another module's service, route-level unit test with `routesOf` |

---

## 1 · The file set and who loads each file

README §5.1 (verbatim):

```
src/modules/<name>/
  <name>.routes.js          staff routes   { basePath, surface: "staff", router }
  <name>.public.routes.js   public routes  { basePath, surface: "public", router }   only if it has any
  <name>.controller.js      req/res only. Never calls the repo
  <name>.service.js         business rules, transactions, emit(), numbering, documents.generate()
  <name>.repo.js            parameterised SQL, honours req.scope. Never emits
  <name>.events.js          event keys it emits + outbox handlers it registers
  <name>.ai.js              AI read manifest (§7.6), or `// ai:none <reason>` in the controller
  <name>.search.js          ⌘K provider, or `// search:none <reason>` in the controller
  <name>.import.js          importer, only where records arrive from spreadsheets
  <name>.<topic>.js         the module's own rule files (lifecycle, calc, scoring…)
  <name>.test.js            unit tests beside the code
packages/contract/schemas/<name>.js   every request and response shape of the module
```

Who loads what (this decides where code must live):

| File | Loaded by | Consequence |
|---|---|---|
| `<m>.routes.js` | `src/http/module-loader.js` (`src/modules/<name>/<name>.routes.js` → `/api/v1<basePath>`); an EMPTY file is skipped quietly | must export `{ basePath, surface: "staff", router }`; duplicate METHOD+path across modules fails boot |
| `<m>.events.js` | the worker: `moduleHandlerFiles()` in `src/worker.js` loads exactly `path.join(folder, \`${e.name}.events.js\`)` per module folder, plus `*.import.js`. The API loads it only because the service `require`s it | an outbox handler in any OTHER file name (e.g. `home.alerts.events.js`) is never registered in the worker. Put every `outbox.register` / `defineNotification` in `<m>.events.js` (or require that file from it) |
| `*.ai.js` | `src/shared/ai/registry.js` (non-empty `*.ai.js` under `src/modules/<m>/`) | any non-empty `.ai.js` name works |
| `*.search.js` | `src/shared/search/registry.js` (non-empty `*.search.js`) | exports one provider or an array |
| `<m>.test.js` | jest (empty test files are excluded by `jest.config.js`) | |

Empty stubs: the repository map pre-creates empty files. A gate treats a module as "built" only once
its controller (ai gate) or controller AND repo (search gate) have content.

**Home today:** `src/modules/` has NO `home` folder. README §5.2/§5.4 map permission key `home` to
three backend modules `dashboard`, `alerts`, `reports` (all files 0 bytes, plus empty
`dashboard/kpi-catalog/{index,eligibility,guards}.js` and `kpi-catalog/tiles/{people,work,business,finance}.js`),
and their empty contracts `packages/contract/schemas/{dashboard,alerts,reports}.js`. CODEOWNERS has lines
for `/src/modules/{alerts,dashboard,reports}/` and their schema files. `docs/guides/home.md` header says
`Backend modules | home` and §5 says contract `packages/contract/schemas/home.js`. See Conflicts.

---

## 2 · Routes (`<m>.routes.js`)

### 2.1 `route()` (src/http/route.js)

```js
const { route } = require("../../http/route");
route(router, method, path, contract, ...handlers);   // controller is the LAST handler
```

Contract keys allowed: `body, query, params, response, no_content, anonymous, self, summary`
(anything else throws at definition).

Refused when DEFINED (process does not boot; `scripts/check/route-contracts.js` = gate 7):
- a schema not exported from `packages/contract` (identity check against every export);
- no `response` and no `no_content: true`; both set;
- POST/PUT/PATCH with no `body` (use `c.common.EmptyBody`); a GET with a body;
- a staff route with no `requirePermission()`/`requireAnyPermission()` handler, nor `self: true`, nor `anonymous: true`.
  The check is `handlers.map((h) => h.permission).find(Boolean)`: only middlewares carrying a
  `.permission` property count.

Chain built for a staff route:

```
auth → uuidParams(:id, :*_id) → your handlers (requirePermission, requireCapability, upload…)
     → validator({ body, query, params }) → responseCheck (APP_ENV test: throws; development: logs) → controller
```

- Path params named `id` or ending `_id` must be UUIDs unless `params` is given; malformed → 404.
- Without a `params` schema, `req.validated.params = { ...req.params }`; query → `{}`; body → `undefined`.
- Under `APP_ENV=test` every 2xx JSON is `JSON.parse(JSON.stringify(body))` then `response.safeParse`'d;
  a mismatch THROWS inside the test. Dates become strings first, so `isoDateTime` works on a pg `Date`.
- Every definition goes in a REGISTRY: `routesOf(router)` returns
  `{ kind, router, method, path, contract, permission }` (used by unit tests and the generator).

**Order pitfall.** `/x/summary` must be defined BEFORE `/x/:id`: organisation does
`/employees`, `/employees/summary`, then `/employees/:id`. Defined the other way round, "summary"
hits `uuidParams` and is a 404.

### 2.2 Permission middlewares (src/middleware/rbac.js)

```js
const { requirePermission, requireAnyPermission, requireCapability, requireCeo, readPermissions, scopeFor } =
  require("../../middleware/rbac");
```

- `requirePermission(key, action)`: key from `src/shared/access/access.catalog.js` (15 modules incl.
  `home`), action in `view create edit delete approve export` (`edit`, never `update`); refused at
  definition if unknown. CEO (`req.user.is_ceo === true`) passes with scope `all`. Sets
  `req.scope` (`all|team|own`), `req.scope_ids` (null | employee ids, caller first), `req.permission`.
  `ess` is always `own` (`OWN_ONLY`).
- `requireAnyPermission([[key, action], ...])`: widest scope among the held grants.
- `requireCapability(code)`: `grantsCache.getCapabilities(pool, user_id)` (user_capability ∪
  role_capability, cached 30 s). CEO passes. 403 `CAPABILITY_REQUIRED`.
  **Pitfalls:** it carries NO `.permission` property (so it never satisfies route()'s permission
  rule on its own), it sets NO `req.scope`, it is invisible to `routesOf()` and to
  `scripts/check/module-catalogue.js`. Always pair it AFTER a `requirePermission`, exactly as
  `src/modules/announcements/announcements.routes.js` does (the only current user):

```js
const poster = () => requireCapability("announcements.post");
route(router, "get", "/", { query: an.AnnouncementListQuery, response: an.AnnouncementPage, summary: "Announcements and their reads" },
  requirePermission("community", "view"), poster(), controller.list);
route(router, "post", "/:id/cancel", { body: c.common.EmptyBody, response: an.Announcement, summary: "Cancel a scheduled announcement" },
  requirePermission("community", "create"), poster(), controller.cancel);
```

  So a Home Team route is (sketch): `requirePermission("home", "view"), requireCapability("home.team"), controller.team`
  and the record scope comes from the `home` grant (seeded: management/ops/implementation `all`,
  head_of_department/manager `team`, administrator/employee `own`; `seeds/reference/0290_seed_roles_and_grants.sql`).
- `readPermissions(req, [[key, action], ...])` → `boolean[]`: for shaping a screen only.
- `scopeFor(user, key, action)` → `{ scope, scope_ids, employee_id } | null`: the same decision for
  non-route code (AI reads, search).
- `scripts/check/module-catalogue.js`: the key passed to `requirePermission` must be a string
  literal in `src/` (outside the helper files). `const view = requirePermission("people", "view")` is fine.

### 2.3 Exemplar routes files

`src/modules/organisation/organisation.routes.js` (staff module mounted at the API root):

```js
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./organisation.controller");

const router = express.Router();
const view = requirePermission("people", "view");
const create = requirePermission("people", "create");
const edit = requirePermission("people", "edit");
const archive = requirePermission("people", "delete");

route(router, "get", "/employees",
  { query: c.organisation.EmployeeListQuery, response: c.organisation.EmployeePage, summary: "The staff register" },
  view, controller.list);

route(router, "get", "/employees/summary",
  { response: c.organisation.EmployeesSummary, summary: "Counts above the register" },
  view, controller.summary);

route(router, "post", "/employees/:id/restore",
  { body: c.common.EmptyBody, response: c.organisation.Employee360, summary: "Restore a record" },
  archive, controller.restore);

route(router, "get", "/employees/:id/history",
  { query: c.common.PageQuery, response: c.organisation.EmployeeHistoryPage, summary: "What has been done to a record" },
  view, controller.history);
...
module.exports = { basePath: "/", surface: "staff", router };
```

`src/modules/workflow/workflow.routes.js` (`self` = authenticated, service decides):

```js
route(router, "get", "/workflow/mine",
  { query: w.ApprovalMineQuery, response: w.ApprovalWaitingPage, self: true, summary: "Requests waiting on me" },
  controller.mine);
route(router, "get", "/workflow/mine/count",
  { response: w.ApprovalCount, self: true, summary: "How many requests wait on me" },
  controller.mineCount);
route(router, "post", "/workflow/instances/:id/approve",
  { params: c.common.IdParams, body: w.ApproveBody, response: w.ApprovalInstance, self: true, summary: "Approve the stage waiting on me" },
  controller.approve);
route(router, "put", "/settings/approvals/:id/steps",
  { params: c.common.IdParams, body: w.ApprovalStepsUpdate, response: w.ApprovalFlow, summary: "Save a flow's stages as a new version" },
  requirePermission("settings", "edit"), controller.saveSteps);
module.exports = { basePath: "/", surface: "staff", router };
```

`src/modules/notifications/notifications.routes.js`: `basePath: "/notifications"`, all `self: true`,
writes with `{ body: c.common.EmptyBody, no_content: true, self: true }`.
`src/modules/documents/documents.routes.js`: byte-streaming routes declare `{ no_content: true, self: true }`
(no JSON schema, not in the typed client); upload routes put `upload.single("file", { purpose: "document" })`
before the controller so multipart is parsed before validation.
`src/modules/identity/identity.routes.js`: `basePath: "/auth"`; sign-in routes `anonymous: true` with a rate limiter
handler first.

---

## 3 · Controller (`<m>.controller.js`)

Rules (docs/BACKEND_GUIDE.md §2): reads `req`, calls the service, sends the response; never calls a repo.
Reads only `req.validated.{body,query,params}`, `req.user`, `scopeOf(req)`.

Helpers:

```js
const { ok, created, accepted, noContent } = require("../../shared/http/respond"); // 200 / 201 / 202 / 204; a record is sent bare, never { data }
const { sendPaged } = require("../../shared/http/paged");                           // the one list envelope; asserts ≤ 25 rows
const { scopeOf, assertInScope } = require("../../shared/rbac/scope");              // { scope, scope_ids, employee_id }
const { maskForUser } = require("../../shared/rbac/field-mask");                    // restricted fields, on the way out
const { withActor } = require("../../shared/events/emit");                          // { ...req.user, ip: req.ip }
```

`req.user` (src/middleware/auth.js): `{ user_id, employee_id, email, display_name, role_ids, is_ceo, session_id }`.

Organisation controller (controller-owned transaction, a pattern also in identity):

```js
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const id = (req) => req.validated.params.id;

/** Run one write in its own transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(pool, req.validated.query, scopeOf(req))),
  summary: async (req, res) => ok(res, await service.summary(pool, scopeOf(req))),
  createDepartment: async (req, res) =>
    created(res, await tx((client) => service.createDepartment(client, req.validated.body, withActor(req)))),
  ...
};
```

Workflow/notifications controller (service-owned transaction; this is the BACKEND_GUIDE §2 rule
"Service: business rules, the transaction"):

```js
module.exports = {
  mine: async (req, res) => sendPaged(res, await service.mine(req.user, req.validated.query)),
  mineCount: async (req, res) => ok(res, await service.mineCount(req.user)),
  approve: async (req, res) => ok(res, await service.decide(withActor(req), id(req), "approve", reason(req))),
};
```

Prefer the service-owned form for Home (matches BACKEND_GUIDE §3.4 and workflow/notifications).

Markers sit at the TOP of the controller (§9).

---

## 4 · Service (`<m>.service.js`)

- Holds rules, the transaction, `emit()`, `numbering.allocate()`. Never touches `req`/`res`.
- Errors: `throw new AppError(code, message, status, fields)` (`src/shared/errors.js`); `fields` is
  `{ field: ["≤4 word message"] }` and the frontend shows it on the input. Not found is
  `new AppError("NOT_FOUND", "Not found", 404)`; outside scope is ALSO 404 (`assertInScope`).
- Service-owned tx helper, verbatim from workflow/notifications:

```js
async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}
```

  `atomically` nests (depth counter; a nested call joins the outer transaction) and joins a foreign
  BEGIN (SAVEPOINT probe). `emit()` THROWS unless `inTransaction(client)`.

- Write with emit (organisation `createDepartment`):

```js
const inserted = await repo.insertDepartment(client, { code: await departmentCode(client, name), name, ... });
const department = await repo.departmentRow(client, inserted.department_id);
await emit(client, {
  key: EVENTS.DEPARTMENT_CREATED,
  entity: { type: "department", id: department.department_id },
  actor,
  after: inserted,
});
return department;
```

- Update with before/after (gives the audit row `changed_fields`):

```js
const before = await repo.findDepartmentById(client, departmentId);
if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
const after = await repo.updateDepartment(client, departmentId, patch);
await emit(client, { key: EVENTS.DEPARTMENT_UPDATED, entity: { type: "department", id: departmentId }, actor, before, after });
```

- Numbering (organisation `createEmployee`):

```js
const staffNumber = body.staff_number
  ? body.staff_number
  : (await numbering.allocate(client, "employee", { date: body.start_date })).number;
```

  `allocate(client, docType, { date })` runs inside the caller's tx and refuses a `docType` not in
  `src/shared/numbering/schemes.js` (`scripts/check/numbering-schemes.js`); a type with no
  `numbering_scheme` row fails at run time. **There is no report-run scheme yet** (schemes: employee,
  document, import_batch, query, sanction, letter, vacancy, offer, contract, payroll_run, payslip,
  proposal, mou, expense, requisition, disbursement): Home adds one to `schemes.js` and a seed row.

- Idempotent no-op writes return early without emitting (notifications `markRead`:
  `if (before.read_at) return;`; `markAllRead`: `if (marked === 0) return;`).
- Reads are thin pass-throughs: `const list = (client, query, scope) => repo.list(client, query, scope);`
- Links are derived, never stored: `routeMap.screenPath(module, tab)` and
  `routeMap.linkFor(entityType, entityId, { self })` → `{ module, tab, id, path }` or null
  (`src/shared/route-map.js`). Organisation's summary builds `link: screen("people", "organogram")`.
- Cross-module reads go through the OTHER module's service, never its repo: ess calls
  `documents.listFor([meOf(user)], query)`; `workflow.search.js` calls `service.mine(user, {...}, client)`.

---

## 5 · Repo (`<m>.repo.js`)

### 5.1 Paging (src/shared/http/paged.js; gate `scripts/check/pagination.js`)

```js
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
```

`pageQuery(client, sql, params, query)` refuses at call time: no `TOTAL_COL`
(`"COUNT(*) OVER() AS _total"`), no `ORDER BY`, or any `LIMIT/OFFSET/FETCH FIRST` in the SQL. It
appends `LIMIT $n+1 OFFSET $n+2` (25), strips `_total`, and returns
`{ data, page: { number, size: 25, total, pages, has_next } }`. Past the last page it re-counts.

`orderBy(query, SORTS, tiebreak)`: `SORTS` maps the contract's sortable keys to SQL; the first key is
the default; `tiebreak` is a unique column (the PK). Descending adds `DESC NULLS LAST`.

`completeQuery(client, sql, params, { label, ceiling })` is the only whole-set read; the line above
must carry `// pagination:complete <reason>` (gate). `LIMIT 1` lookups are allowed; worker batch
claims need `-- pagination:batch <why>` on the same line.

### 5.2 Scope (src/shared/rbac/scope.js)

```js
const { scopeClause } = require("../../shared/rbac/scope");
const s = scopeClause(scope, { column: "e.employee_id" }, params);   // pushes ONE param for team/own
// all  → s.and === ""          team/own → s.and === "AND e.employee_id = ANY($n::uuid[])"
```

Call it AFTER pushing the query's own params (it appends). A row with a NULL owner column is
invisible to team/own.

### 5.3 Type rules from `src/shared/db/pg-types.js`

- `date` comes back as `"2026-10-13"` (matches `isoDate`); timestamptz is a JS `Date` (→ `isoDateTime`).
- `numeric` and `bigint` come back as STRINGS: cast counts (`count(*)::int`), keep money/`over_by` as strings.
- Text search: `search_fold(col) LIKE '%' || search_fold($1) || '%'`; escape user input with
  `escapeLike` from `src/shared/search/provider.js` when building the pattern in JS.

### 5.4 Schema gate

`scripts/check/schema-drift.js`: every `alias.column`, INSERT column list and UPDATE SET must exist in
`migrations/` (catalogue built by `scripts/check/lib/catalogue.js`). Reads of another module's tables
are allowed (organisation joins `app_user`, `user_role`); writes are not.

---

## 6 · Events (`<m>.events.js`)

```js
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
```

`defineEvents(moduleKey, { "thing.verb": { summary, security?, sensitive? } })` → frozen constants
(`"employee.reporting_line_changed"` → `EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED`). Key regex
`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`; no em dash in `summary`; the same key may be declared again
only by the same module.

**Already declared by the shared layer** (`src/shared/events/catalogue.js`), module `home`:

```js
const ALERTS = defineEvents("home", {
  "home.alert_raised": { summary: "An alert was raised" },
  "home.alert_cleared": { summary: "An alert was cleared or dismissed" },
  "home.alert_escalated": { summary: "A high alert was left open too long and escalated" },
});
```

Home may subscribe to these and re-declare them only under `"home"`. The workflow engine's
`workflow.opened/advanced/completed/changes_requested/escalated/cancelled` are declared there too.

`emit(client, { key, entity: { type, id }, actor, before?, after?, payload?, module?, metadata?, dedup_key? })`
writes `event_log` + `audit_ledger` + `event_outbox` in one statement, inside the tx. `entity.type`
snake_case; `payload` an object ≤ 16 KB ("carry ids, not rows"); credentials redacted; `dedup_key`
gives at most one outbox row per key (use for a retry-prone emit such as a sweep). The notification
fan-out reads `payload.subject_employee_id || payload.employee_id` for scope.

Outbox handler (organisation.events.js, verbatim):

```js
const bumpTeams = async () => grantsCache.bumpTeamVersion();
outbox.register(EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_CREATED, "organisation.refresh_team_scope", bumpTeams);
```

`register(key | "*", name, fn)`: name `"<module>.<what>"` (regex `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$`),
unique per key, stable across deploys (renaming re-runs pending rows). `fn(event, ctx)` with
`event = { event_id, key, module, entity: { type, id }, actor_user_id, payload, occurred_at, request_id }`.
At least once: handlers must be idempotent. Backoff 10 s doubling to 1 h; 2 min timeout per handler.
Registering for a key nobody declared is allowed (only the key format is checked), so a Home handler
for `attendance.punched` can exist before Attendance declares it.

Notification (documents.events.js, workflow.events.js):

```js
defineNotification(EVENTS.DOCUMENT_REQUESTED, {
  to: [{ subject: true }],
  title: "A document is needed",
  body: (e) => `${e.payload.title}. Upload it from My Documents.`,
});
defineNotification(EVENTS.WORKFLOW_REASSIGNED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${e.payload.definition_name || "A request"}`,
  body: (e) => `${e.payload.stage_name || "A stage"} is now waiting on you.`,
});
```

Audiences (one key each): `{ permission: [module, action] | (event) => [module, action] }`,
`{ subject: true }`, `{ approvers: true }`, `{ requester: true }`, `{ ceo: true }`,
`{ users: (event) => ids }`. One declaration per key (`defineEvents` first). The actor is not told
unless `include_actor: true`. Optional `priority: "normal" | "high"`. No em dashes.

Document types (documents.events.js): `defineDocumentType("employee_document", { label, module: "people", sensitivity: "personal" })`
from `src/shared/documents/types` — `module` decides who may open the vaulted file. A Home report
file needs its own type with `module: "home"`.

Notifications.events.js also shows a realtime follow-on: `realtime.toUser(userId, READ_EVENT, {...})`
from `src/services/realtime/emitter` inside an outbox handler.

---

## 7 · AI manifest (`<m>.ai.js`)

```js
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const repo = require("./organisation.repo");

module.exports = defineManifest({
  module: "people",
  reads: [
    {
      key: "employees.list",
      description: "List staff, by department, status, work arrangement, employment type or line manager",
      params: c.organisation.EmployeeListQuery,
      permission: ["people", "view"],
      run: (client, params, actor) => repo.list(client, params, actor.scope),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
    },
  ],
  routes: [
    { intent: "add an employee", screen: "people.employees", params: { new: "1" }, prefill: c.organisation.EmployeeCreate },
    { intent: "show the org chart", screen: "ess.org-chart" },
  ],
});
```

Checked at load (`src/shared/ai/manifest.js`):
- top keys only `module, reads, routes`; any write-like key (`write, writes, actions, action, executor,
  execute, executors, mutations, creates, updates, deletes`) is refused (A23; gate 19 `ai-no-writes`);
- read keys only `key, description, params, permission, run, cite`; `key` is `<thing>.<verb>` snake_case,
  unique; `description` 10 to 200 chars, no em dash;
- `params` is an exported contract OBJECT schema; a read is a "list" when its shape has `page`, and
  `authorise.js` then `assertPage`s the result (≤ 25 rows) — so list reads must return a `pageQuery` envelope;
- `permission` is `[moduleKey, "view"]` exactly;
- route keys `intent, screen, params, prefill`; `screen` is `"<module>.<tab>"` in route-map `SCREENS`
  (home: `overview, alerts, reports, team`); `params` values are strings; `prefill` a contract schema.

`run(client, params, actor)`: `actor` is `{ ...req.user, scope }` where `scope` is
`scopeFor(user, module, "view")` = `{ scope, scope_ids, employee_id }`, so pass `actor.scope` straight
to a repo that calls `scopeClause`. Rows are masked by `maskForUser` before the model sees them.

Other shapes: workflow's read runs the service (`run: (_client, params, actor) => service.mine(actor, params)`)
with `permission: ["ess", "view"]` because the list is the asker's own; access has a `get` read with
`params: c.common.IdParams` that turns a 404 into `null`; ess returns an empty envelope when
`actor.employee_id` is missing.

**Pitfall for Home:** AI reads check ONLY the module `view` grant. A capability (`home.team`,
`home.reports`, ...) is NOT checked by `authorise.js`. A Home read over capability-gated data must
check the capability itself inside `run` (e.g. `grantsCache.getCapabilities(client, actor.user_id)`,
CEO passes) or it leaks through the assistant.

---

## 8 · Search provider (`<m>.search.js`)

```js
const { recordProvider } = require("../../shared/search/provider");

const employees = recordProvider({
  type: "employee",                 // must be a key of ENTITY_ROUTES in src/shared/route-map.js
  module: "people",                 // whose `view` grant gates the group
  label: "Employees",               // group heading
  words: ["employee", "staff", "person", "people", "colleague", "who is"],
  from: "employee e JOIN department d ON d.department_id = e.department_id",
  key: "e.employee_id",             // unique; ends the ORDER BY
  columns: ["e.first_name", "e.last_name", "e.preferred_name", "e.middle_name", "e.staff_number", "e.work_email", "e.job_title"],
  select: "e.employee_id AS id, e.staff_number::text AS ref, btrim(e.first_name || ' ' || e.last_name) AS title, e.job_title || ' · ' || d.name AS sub, e.status AS status",
  where: "e.status <> 'archived'",
  scope: { column: "e.employee_id" },   // team/own narrow it like the screen
  phones: ["e.phone"],
});
module.exports = [employees, departments, seats];
```

Required: `type, module, label, from, key, columns, select`. `select` must alias `id`, and may alias
`ref, title, sub, status`. Optional `where`, `order`, `scope: { column }`, `owner: { column }` (pinned to
the caller's `user_id`), `phones`. The provider never decides access, page size or URL: the result's
link is `routeMap.linkFor(type, id)`.

Custom provider (workflow.search.js `waiting`): a frozen object
`{ type, module, label, words, scoped: false, columns: [], empty: true, pinned: true, async search(client, { term, page, user }) { return { page, items } } }`
— `empty: true` answers an empty ⌘K line, `pinned: true` puts it before screens. Items are
`{ id, type, ref, title, sub, status, link }`.

Reach rules (`scripts/check/search-coverage.js`, gate 10):
1. module with non-empty controller AND repo → non-empty `*.search.js` or `// search:none <reason>` in the controller;
2. every provider loads (`src/shared/search/registry.js`): module key exists, type in ENTITY_ROUTES, no duplicate type;
3. every `SCREENS` tab is in `src/shared/search/screens.js` with the SAME label as `app/src/shell/catalogue.ts`
   (home's four are already there: Overview, Alerts, Reports, Team);
4. every ENTITY_ROUTES type is declared by a provider, or its line carries `// search:none <reason>`.
   A reason of `not built yet (src/modules/<m>)` stops being accepted once `src/modules/<m>` has a
   non-empty controller and repo. Current Home lines:

```js
  home_alert: screen("home", "alerts"), // search:none not built yet (src/modules/alerts)
  home_report: screen("home", "reports"), // search:none not built yet (src/modules/reports)
  home_report_run: screen("home", "reports"), // search:none not built yet (src/modules/reports)
```

   If Home is built as `src/modules/home`, these markers keep passing while stale: replace them with
   providers (and remove the marker; a type with both a provider and a marker fails).
5. every `useScreenAction({ label })` in `app/src` has its label in `src/shared/search/actions.js`
   (New Rule, New Report, ... must be added) or carries the marker.

Tab visibility is mirrored in THREE places that must change together when Home gates tabs by capability:
`app/src/shell/access.ts` `visibleTabs`, `src/shared/search/screens.js` `tabVisible`, and the reader built
by `src/shared/search/search.service.js` `readerOf` (`{ grants, is_ceo, manages_people }` — no capabilities
today). Current rule in both:

```js
if (module === "home" && tab === "team") return reader.manages_people || reader.is_ceo;
if (module === "home" && (tab === "reports" || tab === "alerts")) return full || reader.manages_people;
```

---

## 9 · `ai:none` and `search:none` markers

Exact regexes: `/\/\/\s*ai:none\b[ \t:,-]*(.*)$/m` and `/\/\/\s*search:none\b[ \t:,-]*(.*)$/m`, searched
in the module's `*.controller.js` files. The reason must have at least 8 letters, or the gate reports
"opt-out without a reason". Verbatim examples:

```js
// src/modules/notifications/notifications.controller.js (lines 2-3)
// ai:none a person's own notices about other records; the assistant answers from those records' modules
// search:none the bell is read where it opens; its records are found through their own modules

// src/modules/documents/documents.controller.js (documents.ai.js and documents.search.js exist but are 0 bytes)
// ai:none a document is a file, and the assistant never opens one; what a document says about a person is read through that person's own module
// search:none a document is found from the record it belongs to; who may open one is decided per document by the vault (shared/documents/vault.js canRead), which no single search query can express

// src/modules/ess/ess.controller.js
// search:none the tabs are found by name through the screen catalogue (⌘K screens); a record inside ESS is the caller's own copy of a record its own module already answers for
```

A non-empty `.ai.js` / `.search.js` wins over a marker. A finished module deletes its empty stubs
(CLAUDE.md step 5.5) and takes them off README.

---

## 10 · The contract (`packages/contract`)

### 10.1 `schemas/common.js` helpers (all exported)

| Export | What |
|---|---|
| `uuid` | `z.string().uuid()` |
| `text(max = 200)` | trimmed, min 1 |
| `optionalText(max = 2000)` | trimmed, `""` → undefined |
| `email` | trimmed, lower-cased, ≤ 254 |
| `phone` | normalised to E.164 (+234…) |
| `isoDate` | `YYYY-MM-DD`, round-trip checked |
| `isoDateTime` | `z.string().datetime({ offset: true })` |
| `money` | string `/^-?\d{1,16}\.\d{2}$/` (gate 20) |
| `blank(schema)` | `""`/null → undefined, for optional typed form fields |
| `PAGE_SIZE` | 25 |
| `LIST_CONTROLS`, `RESERVED_CONTROLS` | `{ page, q }`; `page, q, sort` cannot be redefined |
| `sortParam(fields)` | `?sort=field` / `-field` → `{ field, dir }` |
| `listQuery(filters = {}, sortable = [])` | `z.object({ page, q, sort?, ...filters }).strict()`; unknown key → 422 naming it |
| `PageQuery` | `listQuery()` |
| `PageMeta` | `{ number, size: literal 25, total, pages, has_next }` strict |
| `Paged(item)` | `{ data: z.array(item).max(25), page: PageMeta }` strict |
| `EmptyBody` | `z.object({}).strict()` |
| `IdParams` | `{ id: uuid }` strict |

No `limit/offset/per_page/page_size` key anywhere outside common.js (pagination gate).

Typical module schema file shape (workflow.js / notifications.js):

```js
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");      // imported, NOT re-exported

const Notification = z.object({ notification_id: uuid, ..., read_at: isoDateTime.nullable(), created_at: isoDateTime }).strict();
const NotificationListQuery = listQuery({ status: z.enum(["unread", "read"]).optional() });
const NotificationPage = Paged(Notification);
const UnreadCount = z.object({ unread: z.number().int().min(0) }).strict();

const TABLES = { /* see 10.2 */ };
module.exports = { TABLES, Notification, NotificationListQuery, NotificationPage, UnreadCount, ... };
```

Conventions seen everywhere: every object `.strict()`; keys `snake_case` (the generator throws
otherwise); nullable columns `.nullable()`, never optional, on responses; counts
`z.number().int().min(0)`; enums mirror the DB CHECK exactly (`EMPLOYEE_STATUSES` comment).

### 10.2 `TABLES` (gate 6, `scripts/check/contract-columns.js`)

Every exported OBJECT schema whose export name starts with a capital (Zod objects, also under
effects/optional/nullable/default; not enums, records or unions) needs a `TABLES` entry:

```js
const TABLES = {
  ApprovalStepsUpdate: { table: "workflow_definition" },                         // every key is a column
  ApprovalFlow: {
    table: "workflow_definition",
    virtual: { open_requests: "counted from workflow_instance rows still pending on the flow's key", ... },
  },
  ApprovalMineQuery: { table: null, reason: "list controls for My Approvals" },  // not a row
  ApprovalWaitingPage: { table: null, reason: "a page of requests waiting on the caller" },
  // nested: AdminBootstrap: { table: null, reason: "...", nested: { employee: { table: "employee" } } }
};
```

Fails on: missing entry; a key that is not a column of the named table and not `virtual`; a
`virtual`/`nested` key the schema lacks; an empty reason; a table no migration creates; a TABLES key
the file does not export as an object schema. Columns come from `migrations/` (so a fix-forward
migration must land in the same PR as a schema naming its new columns). Example for a Home list row
naming `over_by`: `HomeAlert: { table: "home_alert", virtual: { who_clears: "...", age: "...", link: "derived ... route-map" } }`.

### 10.3 `index.js`, the generator, and `contract.gen.ts`

`packages/contract/index.js` requires every `schemas/*.js` by basename: a new file `home.js` is
`c.home` with no index edit. Backend uses `require("@mycity/contract")`; the frontend never does — it
imports the generated `contract.gen.ts`.

`scripts/gen/contract.js` (`npm run gen:contract`; CI `--check`):
1. boots the app in describe mode, strict (`buildApp({ strict: true })`), collecting every route;
2. names every exported schema `domain.Name`, refuses any non-snake_case key;
3. writes `export type <Name> = z.infer<typeof <domain>.<Name>>;` for every capitalised export.
   **A name exported by two domains is prefixed with its domain in BOTH** (`OrganisationTone`), which
   silently renames an existing type the app imports. `Tone` and `PersonRef` already exist
   (`organisation.Tone`, `organisation.PersonRef`, imported by app code via contract.gen): import them
   in a Home schema file but do not re-export them, and do not declare same-named schemas
   (`Tone`, `PersonRef`, `ReasonBody`, `Me`, `Notification`, ...);
4. `Endpoints`: one line per mounted route, request parts as `z.input`, response as `z.output`
   (`null` for `no_content`), params as the schema or `{ name: string }` inferred from the path:

```ts
"GET /api/v1/employees": { body: never; query: z.input<typeof organisation.EmployeeListQuery>; params: never; response: z.output<typeof organisation.EmployeePage> };
"GET /api/v1/workflow/mine": { body: never; query: z.input<typeof workflow.ApprovalMineQuery>; params: never; response: z.output<typeof workflow.ApprovalWaitingPage> };
"GET /api/v1/workflow/mine/count": { body: never; query: never; params: never; response: z.output<typeof workflow.ApprovalCount> };
"POST /api/v1/workflow/instances/:id/approve": { body: z.input<typeof workflow.ApproveBody>; query: never; params: z.input<typeof common.IdParams>; response: z.output<typeof workflow.ApprovalInstance> };
"POST /api/v1/auth/sessions/:id/end": { body: z.input<typeof common.EmptyBody>; query: never; params: { id: string }; response: null };
```

5. `export const schemas = { access, ..., workflow } as const;` (only domains with exports).
`contract.gen.meta.json` hashes EVERY schema file and every routes file (empty ones included), so
creating, emptying or deleting `schemas/home.js` / `schemas/alerts.js` changes the meta: regenerate and
commit both files. Never edit either by hand.

Frontend consumption (`app/src/api/endpoints.ts`): `export interface Endpoints extends Contract {}` plus
`QueryOf/BodyOf/ParamsOf/ResponseOf/RowOf<K>`; hooks `useApi`, `usePaged`, `useInfinite`, `useMutation`,
`invalidate` from `app/src/api/hooks.ts`. Home screens today run on INTERIM declarations merged into
`Endpoints` from `app/src/api/types/home.ts` (`declare module "@/api/endpoints" { interface Endpoints { ... } }`)
served by `app/src/api/mock/modules/home.ts`. When the real routes land, delete the INTERIM entries
(`npm run contract:status` in `app/` reports Interim / Partly / Ready to switch) and switch imports to
`@mycity/contract/contract.gen.ts`. INTERIM keys the screens call today:

```
GET  /api/v1/home/overview                GET  /api/v1/home/kpi/:key/meta        GET  /api/v1/home/kpi/:key   (query group)
GET  /api/v1/home/team (query status)     GET  /api/v1/home/team/summary
GET  /api/v1/home/alerts (query category) GET  /api/v1/home/alerts/summary       POST /api/v1/home/alerts/:id/clear  { outcome, note? }
GET  /api/v1/home/alert-rules             POST /api/v1/home/alert-rules          PATCH /api/v1/home/alert-rules/:id
GET  /api/v1/home/reports                 GET  /api/v1/home/reports/summary      POST /api/v1/home/reports
POST /api/v1/home/reports/:id/run { format: "pdf" | "xlsx" }                     GET  /api/v1/home/report-runs
```

---

## 11 · Identity `/me` (where Home adds capabilities)

Route (`src/modules/identity/identity.routes.js`, `basePath: "/auth"`):

```js
route(router, "get", "/me",
  { response: c.identity.Me, self: true, summary: "The signed-in person" },
  controller.me);
```

Controller (`identity.controller.js` line 84): `const me = async (req, res) => ok(res, await service.me(pool, req.user.user_id));`

Schema (`packages/contract/schemas/identity.js`):

```js
const ModuleKey = z.string().regex(/^[a-z][a-z_]*$/);
const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"];
const Action = z.enum(ACTIONS);
/** Which Home layout the person's role opens (docs/guides/home.md). */
const HomeView = z.enum(["operations", "ceo", "partnerships", "staff"]);
const RoleRef = z.object({ code: z.string(), name: z.string() }).strict();

/** GET /auth/me, and the user inside every session response. */
const Me = z
  .object({
    user_id: uuid, employee_id: uuid, email: z.string(), display_name: z.string(), first_name: z.string(),
    job_title: z.string(), department: z.string(), photo_url: z.string().nullable(), is_ceo: z.boolean(),
    /** Module key → the actions the person may take there. Hiding is a courtesy; the API enforces. */
    grants: z.record(ModuleKey, z.array(Action)),
    roles: z.array(RoleRef),
    home_view: HomeView,
    /** Does anyone report to this person? Opens Home · Team and the manager views. */
    manages_people: z.boolean(),
  })
  .strict();
const Session = z.object({ access_token: z.string(), ...sessionClock, user: Me }).strict();
// TABLES: Me: { table: null, reason: "the signed-in person, assembled from app_user, employee, their roles and the grants cache" }
```

`Me` is embedded in `Session` (login, two-step, passkey responses), so a new key must be filled by
the one `me()` function every path calls (`identity.service.js` calls `return me(client, user.user_id)`
inside the sign-in transaction, line 267).

Service (`src/modules/identity/identity.service.js` lines 142-175, verbatim):

```js
async function me(db, userId) {
  const row = await repo.meOf(db, userId);
  if (!row || row.status !== "active")
    throw new AppError("AUTH_REQUIRED", "Sign in to continue", 401);
  const roles = await repo.rolesOf(db, userId);
  const grants = {};
  if (row.is_ceo === true) {
    for (const m of catalog.MODULES) grants[m] = [...catalog.ACTIONS];
  } else {
    for (const g of await repo.grantsOf(db, roles.map((r) => r.role_id))) {
      if (!catalog.isModule(g.module_key)) continue;
      const actions = catalog.ACTIONS.filter((a) => g[`can_${a}`] === true);
      if (actions.length) grants[g.module_key] = actions;
    }
  }
  const view = row.is_ceo
    ? "ceo"
    : (roles.find((r) => r.home_view) || { home_view: "staff" }).home_view;
  return {
    user_id: row.user_id, employee_id: row.employee_id, email: row.email, display_name: row.display_name,
    first_name: row.first_name, job_title: row.job_title, department: row.department, photo_url: null,
    is_ceo: row.is_ceo === true, grants,
    roles: roles.map((r) => ({ code: r.code, name: r.name })),
    home_view: view,
    manages_people: row.manages_people === true,
  };
}
```

Repo: `meOf(db, userId)` (app_user ⋈ employee ⋈ department, plus
`EXISTS (SELECT 1 FROM employee r WHERE r.line_manager_id = e.employee_id AND r.status = 'active') AS manages_people`),
`rolesOf(db, userId)` (active, effective-dated, `ORDER BY r.rank DESC, r.name`), `grantsOf(db, roleIds)`.

Adding capabilities (sketch, matching the CEO-holds-everything rule of `grants`):

```js
// identity.js (NOT access.js: access.js requires identity.js, so identity cannot require access — circular)
capabilities: z.array(z.string()),          // codes the person holds; CEO: every code in `capability`
// identity.service.me():
const capabilities = row.is_ceo === true
  ? await repo.allCapabilityCodes(db)                       // new repo read
  : await grantsCache.getCapabilities(db, userId);          // same source requireCapability uses (30 s cache)
```

Knock-ons of a new `Me` key: `app/src/api/mock/modules/identity.ts` `me()` returns a typed `Me`
(TS error until the key is added); `app/src/shell/access.ts` and `src/shared/search/screens.js`
`tabVisible` + `search.service.readerOf` should read it; `tests/integration/identity.test.js` uses
`toMatchObject`-style assertions (does not break).

Capability code format: `packages/contract/schemas/access.js`

```js
const CapabilityCode = z.string().trim().toLowerCase().regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/, "Not a capability");
```

exactly TWO dot segments. `home.alerts.manage` fails it, so Settings · Roles (`RoleSave.capabilities:
z.array(CapabilityCode)`) would refuse to save a role holding it. The DB column (`capability.code citext
UNIQUE`, migration 0020) has no format check. Seeded today (`seeds/reference/0449_seed_field_visibility_capabilities.sql`):
`announcements.post`, `alerts.clear`, both held by roles `implementation`, `operations_people`,
`management`. `tests/integration/settings.test.js` asserts the exact lists
`["alerts.clear", "announcements.post"]` (catalogue, ops role detail, `getCapabilities(ops)`); new
seeded capabilities must update those assertions in the same PR.

---

## 12 · Workflow: "waiting on you" (Home's Need You)

Endpoints: `GET /api/v1/workflow/mine` (`ApprovalMineQuery` → `ApprovalWaitingPage`) and
`GET /api/v1/workflow/mine/count` (→ `ApprovalCount`), both `self: true`.

Contract:

```js
const ApprovalMineQuery = listQuery({ module_key: ModuleKey.optional() });      // page, q, module_key; no sort
const ApprovalWaitingPage = Paged(ApprovalWaiting);
/** GET /workflow/mine/count: Home's Waiting on You. */
const ApprovalCount = z.object({ waiting: z.number().int().min(0), overdue: z.number().int().min(0) }).strict();
// ApprovalWaiting keys: workflow_instance_id, definition_key, definition_name, module_key, entity_type, entity_id,
// subject_employee_id, subject_name, current_stage, stage_name, context, stage_entered_at, stage_due_at,
// overdue, opened_by, opened_by_name, opened_at, link
```

Service (`src/modules/workflow/workflow.service.js`), callable directly by Home's service:

```js
/** My Approvals; `client` is the caller's when it reads inside its own transaction (⌘K). */
async function mine(user, query, client = pool) {
  const roleCodes = await approvers.roleCodesOf(client, user.role_ids || []);
  const modules = await approveModules(user);          // modules where user holds `approve`; null for CEO
  const page = await repo.waiting(client, user, roleCodes, modules, query);
  return { ...page, data: page.data.map(({ stages, ...r }) => {
    const stage = cond.stageByKey({ stages }, r.current_stage);
    return { ...r, stage_name: stage ? stage.name : r.current_stage, context: r.context || {}, link: linkOf(r, user) };
  }) };
}
async function mineCount(user) { ... return repo.waitingCount(pool, user, roleCodes, modules); }   // { waiting, overdue }
```

`user` = `req.user` shape (needs `user_id, employee_id, role_ids, is_ceo`). `query` must carry `page`
(e.g. `{ page: 1 }`). Home's Need You embeds at most one page and links to Settings/My Approvals.

Repo SQL (`workflow.repo.js`):

```js
function waitingWhere(user, roleCodes, modules, moduleKey, params) {
  params.push(moduleKey ?? null, modules === null, modules || []);
  const n = params.length;
  const named = approvers.waitingOnClause("i", user, roleCodes, params);
  return `i.state = 'pending'
     AND ($${n - 2}::text IS NULL OR i.module_key = $${n - 2})
     AND ($${n - 1}::boolean OR i.module_key = ANY($${n}::text[]))
     AND ${named}`;
}
// waiting(): SELECT i.workflow_instance_id, ..., (i.stage_due_at IS NOT NULL AND i.stage_due_at < now()) AS overdue, ..., ${TOTAL_COL}
//   FROM workflow_instance i JOIN workflow_definition d ON ... LEFT JOIN employee se/oe, app_user ou
//   WHERE ${where} AND ($q::text IS NULL OR search_fold(d.name || ' ' || coalesce(subject,'') || ' ' || coalesce(opener,'')) LIKE search_fold($q::text))
//   ORDER BY i.stage_entered_at, i.workflow_instance_id
// waitingCount(): SELECT count(*)::int AS waiting,
//   count(*) FILTER (WHERE i.stage_due_at IS NOT NULL AND i.stage_due_at < now())::int AS overdue FROM workflow_instance i WHERE ${where}
```

`src/shared/workflow/approvers.js`:

```js
function waitingOnClause(alias, user, roleCodes, params) {
  params.push(user.user_id, user.employee_id || null, roleCodes, user.is_ceo === true);
  const n = params.length;
  return `(${alias}.opened_by IS DISTINCT FROM $${n - 3}::uuid OR $${n}::boolean)
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(${alias}.stage_approvers) a
       WHERE (a->>'type' = 'user' AND a->>'value' = $${n - 3}::text)
          OR (a->>'type' = 'employee' AND a->>'value' = $${n - 2}::text)
          OR (a->>'type' = 'role' AND a->>'value' = ANY($${n - 1}::text[]))
          OR (a->>'type' = 'ceo' AND $${n}::boolean)
    )`;
}
```

Rules: pending only; current stage names the caller (login, employee, a role code they hold, or CEO);
in a module where they hold `approve` (CEO everywhere); never their own request (except the CEO).

---

## 13 · Tests

### 13.1 Layout and config

```
src/modules/<m>/<m>.test.js       unit, beside the code, no DB
tests/unit/                       unit: gates (check-*.test.js, search-coverage.test.js), foundation/* (http, middleware, events-workflow, ...)
tests/integration/*.test.js       real Postgres + Redis, only with RUN_DB_TESTS=1
tests/integration/helpers/schema.js   rebuild() + sql fixtures
tests/integration/fixtures/test-tables.sql
tests/helpers/soft-authenticator.js   TOTP/passkey doubles
tests/staging/                    never run by jest here
```

`jest.config.js` (single config, no `projects`): `testMatch` `src/**/*.test.js`, `tests/**/*.test.js`,
`scripts/**/*.test.js`; ignores `tests/integration/` unless `RUN_DB_TESTS=1`; ignores EMPTY `*.test.js`
files by name; `setupFiles: tests/setup-env.js` (APP_ENV=test so every response is contract-checked,
silent logger, temp MEDIA_ROOT); `setupFilesAfterEnv: tests/settle-reporter.js`; `maxWorkers` 1 with DB
tests (they share one database), else 2; `testTimeout` 15000. CI runs the whole suite (gate 2), never a subset.

Run one integration file:

```
RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/workflow
```

### 13.2 Unit style

Pure rules: `workflow.test.js` (`service.approverView`, `service.routeOf`; reads seed SQL to prove it
matches code), `identity.test.js` (policies), `access.test.js` (`grantRows`). Route-shape test with
`routesOf` (ess.test.js):

```js
const { routesOf } = require("../../http/route");
const routes = routesOf(require("./ess.routes").router);
test("every one is the caller's own", () => {
  for (const route of routes) {
    expect(route.contract.self).toBe(true);
    expect(route.permission).toBeNull();
    expect(route.path).not.toMatch(/:(id|employee_id)\b/);
  }
});
test("the list pages at 25 through the contract's controls", () => {
  const list = routes.find((r) => r.method === "GET" && r.path === "/documents");
  expect(Object.keys(list.contract.query.shape)).toEqual(expect.arrayContaining(["page", "q", "status"]));
});
```

`route.permission` is `{ key, action }` for `requirePermission`, `{ any: [...] }` for
`requireAnyPermission`; capabilities are not recorded (see 2.2).

HTTP path without a DB (`tests/unit/foundation/http.test.js`): `jest.mock` `src/config/db`,
`src/shared/rbac/grants-cache` (`getAuthUser, getGrants, getTeamEmployeeIds, getCapabilities,
getMaskedFieldKeys`) and `src/shared/rbac/sessions` (`isSessionActive`), sign a JWT
`jwt.sign({ sub: USER, sid: SID, typ: "access" }, config.JWT_ACCESS_SECRET)`, and
`buildApp({ strict: true, accessLog: false, modulesDir })`. `getCapabilities.mockResolvedValue([...])`
is how a capability-gated route is unit-tested.

### 13.3 Integration harness (verbatim pieces)

```js
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);

async function drain() {                              // run the outbox as the worker would
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("approvals against the real migrations", () => {
  let app; const people = {}; const tokens = {}; let ipSeq = 0;
  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);      // DROP SCHEMA public; scripts/db/migrate.js (migrations + reference seeds) + test-tables.sql
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job) => ({ first_name: first, last_name: last, work_email: email, phone: "08031234567",
      job_title: job, department_name: "Programmes", start_date: "2026-01-05", employment_type: "full_time", work_pattern: "on_site" });
    const make = (key, first, last, role, job, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, `${key}@mycity.test`, job), role_code: role, is_ceo: isCeo },
          PASSWORD, { allowAdditional: true });       // → { employee, user, ... } through the real services
      });
    await make("ceo", "Ifeoma", "Nwankwo", "management", "Chief Executive Officer", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2",
      [people.manager.employee.employee_id, people.staff.employee.employee_id]);
    await drain();
    for (const key of Object.keys(people)) {
      ipSeq += 1;
      const res = await request(app).post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.60.0.${ipSeq}`)            // distinct IPs: sign-in is rate limited
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });
```

Roles available after `rebuild` (seed 0290): `implementation, operations_people, management,
head_of_department, administrator, manager, employee`; the CEO is `is_ceo: true` on the login, not a
role. Capabilities after rebuild come from seed 0449 (and whatever Home seeds).

Lighter fixtures without login (`tests/integration/shared-layer.test.js`, `helpers/schema.js`):
`schema.sql.employee` (`$1 first, $2 last, $3 line_manager_id`), `schema.sql.user` (`$1 employee_id, $2 email,
$3 is_ceo`), `schema.sql.role` (`$1 code`), then raw `INSERT INTO permission (...)` and
`INSERT INTO user_role (user_id, role_id)`; actors are plain objects
`{ user_id, employee_id, is_ceo, role_ids, display_name, email }` passed to services. Some files mock
the job queue: `jest.mock("../../src/jobs/queues", () => ({ enqueue: jest.fn(...), getQueue: jest.fn(), closeQueues: jest.fn(async () => {}), DEFAULTS: {} }))`.

Assertions always parse with the contract: `expect(c.workflow.ApprovalFlowPage.parse(res.body).page.size).toBe(25);`
and test 401 signed out, 403 without the grant, 404 outside scope, 422 for `?limit=`/unknown filter/bad sort.

---

## 14 · One complete list endpoint, end to end: `GET /api/v1/employees`

**Contract** `packages/contract/schemas/organisation.js`:

```js
/** GET /employees. The filters the register's toolbar sends, and its sortable columns. */
const EmployeeListQuery = listQuery(
  {
    department_id: uuid.optional(),
    status: EmployeeStatus.optional(),
    work_pattern: WorkPattern.optional(),
    employment_type: EmploymentType.optional(),
    line_manager_id: uuid.optional(),
  },
  ["display_name", "staff_number", "job_title", "department", "start_date", "created_at"],   // first = default order
);

/** One row of the register. */
const EmployeeRow = z.object({
  employee_id: uuid, staff_number: z.string(), display_name: z.string(), job_title: z.string(),
  department_id: uuid, department: z.string(), line_manager: ManagerRef.nullable(),
  work_pattern: WorkPattern, employment_type: EmploymentType, status: EmployeeStatus, login: LoginState,
  start_date: isoDate.nullable(), confirmation_due_on: isoDate.nullable(), confirmed_on: isoDate.nullable(),
}).strict();
const EmployeePage = Paged(EmployeeRow);

// TABLES
EmployeeListQuery: { table: null, reason: "list controls and the register's filters, not a row" },
EmployeeRow: {
  table: "employee",
  virtual: {
    display_name: "the person's name as a list shows it, from first_name and last_name",
    department: "the department's name, joined from department",
    line_manager: "the manager above them: a person or a vacant seat, from line_manager_id or line_manager_seat_id",
    login: "whether they have a login and its state, from app_user",
  },
},
EmployeePage: { table: null, reason: "a page of the register" },
```

**Route** (`organisation.routes.js`): `route(router, "get", "/employees", { query: c.organisation.EmployeeListQuery, response: c.organisation.EmployeePage, summary: "The staff register" }, view, controller.list);`
where `const view = requirePermission("people", "view");` (sets `req.scope`).

**Generated** (`contract.gen.ts` line 400):
`"GET /api/v1/employees": { body: never; query: z.input<typeof organisation.EmployeeListQuery>; params: never; response: z.output<typeof organisation.EmployeePage> };`

**Controller**: `list: async (req, res) => sendPaged(res, await service.list(pool, req.validated.query, scopeOf(req))),`

**Service**: `const list = (client, query, scope) => repo.list(client, query, scope);`

**Repo** (`organisation.repo.js`, verbatim; `DISPLAY_NAME`, `LOGIN_STATE`, `MANAGER_SELECT`, `EMPLOYEE_JOINS`
are SQL fragments at the top of the file, `toRow` maps a row to the contract's shape):

```js
/** The SQL for each field EmployeeListQuery allow-lists. The first is the default order. */
const EMPLOYEE_SORTS = {
  display_name: "e.last_name, e.first_name",
  staff_number: "e.staff_number",
  job_title: "e.job_title",
  department: "d.name",
  start_date: "e.start_date",
  created_at: "e.created_at",
};

async function list(db, query, scope) {
  const params = [
    query.q ?? null,
    query.department_id ?? null,
    query.status ?? null,
    query.work_pattern ?? null,
    query.employment_type ?? null,
    query.line_manager_id ?? null,
  ];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);      // $7 when team/own
  const page = await pageQuery(
    db,
    `SELECT e.employee_id, e.staff_number::text AS staff_number, ${DISPLAY_NAME} AS display_name,
            e.job_title, e.department_id, d.name AS department, e.work_pattern, e.employment_type,
            e.status, e.start_date, e.confirmation_due_on, e.confirmed_on,
            ${LOGIN_STATE} AS login, ${MANAGER_SELECT}, ${TOTAL_COL}
       ${EMPLOYEE_JOINS}
      WHERE ($1::text IS NULL
             OR search_fold(e.first_name || ' ' || e.last_name || ' ' || e.job_title) LIKE '%' || search_fold($1) || '%'
             OR e.staff_number::text ILIKE '%' || $1 || '%'
             OR e.work_email::text ILIKE '%' || $1 || '%')
        AND ($2::uuid IS NULL OR e.department_id = $2)
        AND ($3::text IS NULL OR e.status = $3)
        AND ($3::text IS NOT NULL OR e.status <> 'archived')
        AND ($4::text IS NULL OR e.work_pattern = $4)
        AND ($5::text IS NULL OR e.employment_type = $5)
        AND ($6::uuid IS NULL OR e.line_manager_id = $6)
        ${s.and}
      ORDER BY ${orderBy(query, EMPLOYEE_SORTS, "e.employee_id")}`,
    params,
    query,
  );
  return { ...page, data: page.data.map(toRow) };
}
```

Pattern to copy: every filter is `($n::type IS NULL OR col = $n)` with `?? null`; casts on every
nullable param (an untyped NULL param is a pg error); scope last; `orderBy` ending on the PK.

**AI** (`organisation.ai.js`): the same repo function, `run: (client, params, actor) => repo.list(client, params, actor.scope)`.

**Integration test** (`tests/integration/organisation.test.js`, setup: ops = `operations_people` (scope all),
manager = `manager` (scope team), staff Ngozi reports to the manager):

```js
const auth = (token) => (r) => r.set("Authorization", `Bearer ${token}`);
const asOps = () => auth(tokens.ops);
const asManager = () => auth(tokens.manager);

test("pages at 25, in the contract's shape, with the login state", async () => {
  const res = await asOps()(request(app).get("/api/v1/employees"));
  expect(res.status).toBe(200);
  expect(res.body.page.size).toBe(25);
  expect(res.body.page.total).toBe(3);
  expect(c.organisation.EmployeePage.safeParse(res.body).success).toBe(true);
  const ngozi = res.body.data.find((r) => r.staff_number === people.staff.staff_number);
  expect(ngozi).toMatchObject({ display_name: "Ngozi Umeh", job_title: "Delivery Analyst", department: "Delivery",
    work_pattern: "hybrid", status: "active", login: "none" });
  expect(ngozi.line_manager).toMatchObject({ display_name: "Chidi Nwankwo", vacant: false });
});

test("searches, filters and sorts on the server", async () => {
  const found = await asOps()(request(app).get("/api/v1/employees?q=ngozi"));
  expect(found.body.page.total).toBe(1);
  const hybrid = await asOps()(request(app).get("/api/v1/employees?work_pattern=hybrid"));
  expect(hybrid.body.data.map((r) => r.display_name)).toEqual(["Ngozi Umeh"]);
  const sorted = await asOps()(request(app).get("/api/v1/employees?sort=-display_name"));
  expect(sorted.body.data[0].display_name).toBe("Ngozi Umeh");
});

test("a page size or an unknown filter is refused, and so is a sort nobody allow-listed", async () => {
  for (const query of ["?limit=100", "?page_size=50", "?nonsense=1", "?sort=gross_monthly"]) {
    const res = await asOps()(request(app).get(`/api/v1/employees${query}`));
    expect(res.status).toBe(422);
  }
});

test("a line manager sees their team, not the whole register", async () => {
  const res = await asManager()(request(app).get("/api/v1/employees"));
  expect(res.status).toBe(200);
  expect(res.body.data.map((r) => r.display_name).sort()).toEqual(["Chidi Nwankwo", "Ngozi Umeh"]);
});

test("a record outside the caller's scope is a 404, not a 403", async () => {
  const res = await asManager()(request(app).get(`/api/v1/employees/${people.ops.employee.employee_id}`));
  expect(res.status).toBe(404);
});
```

---

## 15 · Checklist for each new Home backend module (derived from the exemplars and gates)

1. Contract file first; `TABLES` for every object schema; no name collisions; `npm run gen:contract`, commit `contract.gen.ts` + `contract.gen.meta.json`.
2. Routes: `route()` only; `requirePermission("home", ...)` literal, then `requireCapability(...)` where gated; `/summary` before `/:id`; `basePath: "/home"` (or sub-path) with no duplicate METHOD+path across modules.
3. Controller: no repo calls; `sendPaged` for lists; markers at the top if no ai/search.
4. Service: transaction + `emit()` for every write; idempotent re-clear/re-run returns without a second emit; numbering type added to `schemes.js` + seed.
5. Repo: `pageQuery` + `TOTAL_COL` + `orderBy(..., pk)`; `scopeClause` on the employee column; `::int` counts; `// pagination:complete` on any whole set.
6. Events in `<m>.events.js` (the only file name the worker loads); handler names `"<module>.<what>"`; Home alert keys already declared under `home`.
7. `.ai.js` reads are `view` only and must re-check capabilities inside `run`; `.search.js` providers per ENTITY_ROUTES type; remove the `not built yet` markers in `route-map.js`.
8. Tab gating moved to capabilities in all three mirrors (`app/src/shell/access.ts`, `src/shared/search/screens.js`, `search.service.readerOf`) and `/me`.
9. New module folder: a CODEOWNERS line with two owners (`scripts/check/codeowners.js`); new files outside `src/modules/<m>/<m>.*.js` (e.g. a subfolder like `kpi-catalog/`) must be named in README (`scripts/check/readme-map.js`); a contract file `schemas/<x>.js` is only auto-allowed when `src/modules/<x>` exists; delete empty stubs and their README/CODEOWNERS lines when finishing.
10. Tests: unit beside the code (`routesOf` shape test, pure rules), integration under `RUN_DB_TESTS=1` parsing every response with its schema; update `tests/integration/settings.test.js` capability lists if seeds add capabilities.

# Brief: backend infrastructure APIs Home calls

Repo: `/home/user/mycity-app`. Read-only survey of the M0 shared layer as it stands on 17/10/2026.
Every signature below is copied from the code. Paths are repo-relative unless absolute.

---

## 0. Read this first: the 25 things that will bite

1. **Home is three backend modules, not one.** README §5.2 and §5.4: permission key `home` →
   modules `dashboard`, `alerts`, `reports` (owner TB). Their files exist as empty stubs:
   `src/modules/{dashboard,alerts,reports}/*.js`, plus `dashboard/kpi-catalog/{index,eligibility,guards}.js`
   and `kpi-catalog/tiles/{people,work,business,finance}.js`. There is no `src/modules/home/`.
   `docs/guides/home.md` says "Backend modules: `home`" and "`packages/contract/schemas/home.js`";
   the contract stubs that exist are `packages/contract/schemas/{dashboard,alerts,reports,kpis}.js`
   (all empty). route-map markers already say `not built yet (src/modules/alerts)` and
   `(src/modules/reports)`. Pick the README layout (it is "the map of every file") unless TB says otherwise.
2. **`route()` refuses a staff route with no `requirePermission()`.** `requireCapability()` returns a
   middleware with **no** `.permission` tag, so a route carrying only a capability fails at definition.
   Always pair: `requirePermission("home", "view"), requireCapability("home.team")`.
3. **Capability codes are two segments.** `packages/contract/schemas/access.js`:
   `CapabilityCode = z.string().trim().toLowerCase().regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/)`.
   `home.alerts.manage` (three segments) will be **refused** by `RoleSave` on Settings, Roles &
   Permissions. Either widen that regex (and its test) or name it e.g. `home.alerts_manage` / `alerts.manage`.
4. **`requireCapability` does not validate the code at boot.** A typo denies everyone but the CEO,
   silently. Keep the codes in one constant file and seed them (precedent:
   `seeds/reference/0449_seed_field_visibility_capabilities.sql`).
5. **`/me` carries no capabilities** (`identity.service.js` returns `grants`, `roles`, `home_view`,
   `manages_people`). The shell (`app/src/shell/access.ts`) and search (`src/shared/search/screens.js`
   `tabVisible`) decide Home tab visibility from `manages_people` and `settings` grants, not
   capabilities. Decision 2 needs both changed, in step.
6. **The CEO (`is_ceo === true`) passes every `requirePermission`, `requireAnyPermission`,
   `requireCapability` with scope `all`.** Test with a non-CEO.
7. **`alerts.mayClear()` checks only the rule's `permission_key` (any scope).** It does not check the
   `alerts.clear` capability, nor the subject's team scope. If clearing must also need `alerts.clear`,
   add `requireCapability("alerts.clear")` on the route.
8. **`home_alert_rule.threshold` is `numeric` → arrives as a string** (`pg-types.js`). `alerts.evaluate`
   does `Number()`, fine; `window-counter.windowBounds/evaluate` require `Number.isInteger(rule.threshold)`
   and will throw `TypeError` on `"3"`. Convert first. `window_days` is `integer` (a number) but nullable.
9. **`alerts.evaluate` breaches at `value >= threshold`**, and `over_by = value - threshold` (two places).
   At the threshold `over_by` is `0`.
10. **`home.alert_raised` and `home.alert_escalated` already have notifications**, declared in
    `src/shared/notifications/fanout.js`. A second `defineNotification` for those keys throws
    `already declared`. `home.alert_cleared` has none.
11. **`ALERTS` events are already declared** in `src/shared/events/catalogue.js` under module `home`.
    Home's events files may re-declare them only with module `"home"`, and should just import
    `catalogue.ALERTS`.
12. **`defineEvents(moduleKey, …)` takes a PERMISSION key** (`"home"`), not the directory name.
13. **Job and scheduler stubs are empty and unregistered.** `jobs/handlers/scheduled-report.js`,
    `jobs/schedulers/scheduled-reports.js` (M1, Home) and the forward ones
    (`approval-ageing`, `partner-inactivity`, `budget-threshold` M7/M8; `reminders` M6;
    `attendance-day-close` M1 LA) are 0 bytes and are NOT in `JOBS` / `SCHEDULERS`. `queues.enqueue`
    to an unlisted queue throws. Listing an empty file breaks `schedules()`.
14. **`tests/unit/foundation/worker-jobs.test.js` pins the exact `JOBS` and `SCHEDULERS` lists.** Add a
    queue or scheduler → update that test and README §5.15 in the same PR.
15. **Search providers are gated by the module's `view` grant only.** `home.view` is every employee, so a
    `recordProvider` for `home_alert` or `home_report` shows every employee every alert title. Use a
    hand-written provider that reads `user` (pattern: `src/modules/workflow/workflow.search.js`) or
    `// search:none <reason>`.
16. **AI reads are gated by `view` only, too** (`shared/ai/authorise.js`). A Home read must apply the
    capability / rule-permission filter inside `run(client, params, actor)`.
17. **Vault read access defaults to the doc type's module `view` grant.** A report file stored with doc
    type module `home` is readable by anyone with `home` view at scope `all`. Register
    `vault.defineAccess("home_report_run", fn)` in a file the API loads at boot (the events file the
    service requires).
18. **`documents.generate()` renders the PDF after commit, in the worker.** The document row is
    `render_status: "pending"` until `document.generated`. `systemMail.send` refuses to attach a pending
    document (plain Error, retried 5x over ~75 s). Send the email from an outbox handler on
    `document.generated` filtered by `doc_type`, not from the request or straight after `generate()`.
19. **`documents.generate()` numbers the document itself** when its doc type has `numbering`. Allocating
    the run number separately AND giving the doc type a scheme burns two numbers. Allocate once.
20. **A new numbering type needs four things** or readiness goes `down` / the gate fails:
    `SCHEMES` entry, a reference-seed row, `allocate(client, "<literal>")`, nothing computed.
21. **`emit()` must be inside `atomically()`**; payload ≤ 16 KB; carry ids, not rows.
22. **Outbox handlers run at least once, outside any transaction, with the pool.** Open your own client
    and `atomically()` to write; be idempotent (`ON CONFLICT`, state checks, `dedup_key`, job ids).
23. **The worker loads only `<module>.events.js` and `*.import.js`.** Handlers registered anywhere else
    never run in the worker.
24. **No `LIMIT`/`OFFSET` in a repo** except `LIMIT 1` or a worker batch marked
    `LIMIT $1 -- pagination:batch <why>` on the same line. Lists go through `pageQuery`. A
    `completeQuery()` needs `// pagination:complete <why>` on one of the two lines above.
25. **Migration numbers in the M1 block already used**: `1000`, `1099` (seed), `1100`, `1110`, `1120`,
    `1130`. A number is unique across `migrations/` and `seeds/reference/`.

---

## 1. Modules: discovery, mounting, surface

`src/http/module-loader.js`

```
src/modules/<name>/<name>.routes.js          → staff  surface, /api/v1<basePath>
src/modules/<name>/<name>.public.routes.js   → public surface, /api/public/v1<basePath>
module.exports = { basePath: "/employees", surface: "staff", router };
```

Rules enforced at boot (`checkDefinition`, `mountModules`):
- export `{ basePath, surface, router }`; `surface` must match the file name;
- `basePath` matches `/^\/[a-z0-9/_-]*$/`;
- no nested `router.use()` (hides routes from the contract);
- every route on the router was defined with `route()`/`publicRoute()`;
- duplicate `METHOD + full path` across modules fails boot;
- an empty routes file is skipped quietly; a module that throws is skipped and reported (readiness
  `degraded`, deploy gate stops) unless `strict` (tests, `scripts/check/route-contracts.js`).

`discover()` does NOT sort directory entries, so mount order is filesystem order. Several modules can
share a prefix (`/home`) as long as full paths differ, but a router mounted at `/home` sees every
`/home/...` request first: keep param-at-root routes (`/:id`) out of a router that shares a prefix.

Suggested split for the guide's API (§5): `dashboard` `basePath: "/home"` (overview, kpi, team),
`alerts` `basePath: "/home"` with paths `/alerts…` and `/alert-rules…`, `reports` `basePath: "/home/reports"`.

`src/http/routes.js` wraps `/api/v1` with: `surface("staff")`, CORS (hub origin, credentials),
`rateLimit.staffLimiter`, `idempotency`, then the module routers. `req.surface` = `"staff"`.

Contract index `packages/contract/index.js` auto-exports every `schemas/<file>.js` as
`c.<basename>`; a new file needs no index edit. Backend: `const c = require("@mycity/contract")`.

---

## 2. `route()` and `publicRoute()`

`src/http/route.js` exports `{ route, publicRoute, routesOf, registry }`.

```js
route(router, method, path, contract, ...handlers)        // staff, /api/v1
publicRoute(router, method, path, contract, ...handlers)  // public, only in <module>.public.routes.js
```

Contract keys (anything else throws): `body`, `query`, `params`, `response`, `no_content`,
`anonymous`, `self`, `summary`.

Refused when DEFINED:
- a schema not exported from `packages/contract` (identity check against every export);
- no `response` and no `no_content: true`; both set;
- POST/PUT/PATCH with no `body` (use `c.common.EmptyBody`); GET with a `body`;
- staff route with no handler carrying `.permission` (from `requirePermission` / `requireAnyPermission`)
  unless `self: true` (ownership checked in the service) or `anonymous: true`;
- `anonymous` + `self` together; a public route with a permission handler.

Chain built (staff):
```
auth → uuidParams(ids) → your handlers (all but last) → validator({body,query,params}) → responseCheck → last handler
```
- Permission is checked before input is parsed. Controller reads `req.validated.{body,query,params}`.
- Path params named `id` or `*_id` are UUID-checked (malformed → 404) unless the contract gives `params`.
  `GET /home/kpi/:key` is NOT checked; give it a `params` schema from the contract.
- Without a `params` schema, `req.validated.params = { ...req.params }`.
- `APP_ENV=test`: a 2xx JSON body that fails `response.safeParse` THROWS (tests fail);
  `development`: logged. The body is round-tripped through JSON first (Dates become strings).

Real usage with a capability (`src/modules/announcements/announcements.routes.js`):
```js
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const poster = () => requireCapability("announcements.post");
route(router, "get", "/", { query: an.AnnouncementListQuery, response: an.AnnouncementPage, summary: "Announcements and their reads" },
  requirePermission("community", "view"), poster(), controller.list);
route(router, "post", "/:id/cancel", { body: c.common.EmptyBody, response: an.Announcement, summary: "Cancel a scheduled announcement" },
  requirePermission("community", "create"), poster(), controller.cancel);
module.exports = { basePath: "/community/announcements", surface: "staff", router };
```

Controller shape (`announcements.controller.js`), with the two required markers when the module has no
provider / manifest of its own:
```js
// search:none announcements are found through community.search.js
// ai:none the announcements reads are declared in community.ai.js
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query)),
  create: async (req, res) => created(res, await service.create(req.validated.body, req.user)),
};
```

`req.user` (middleware/auth.js): `{ user_id, employee_id, email, display_name, role_ids, is_ceo, session_id }`.

`src/shared/crud/resource.js` `mountResource(router, { controller, module, contract, actions })` mounts
list/get/create/update/archive with `requirePermission(module, action)` only. It cannot add a
capability: hand-write the alert-rules and reports routes.

---

## 3. RBAC

### 3.1 `src/middleware/rbac.js`

Exports: `requirePermission, scopeFor, requireAnyPermission, requireCapability, requireCeo,
readPermissions, scopeFromGrants, COLUMN`.

```js
requirePermission(key, action)      // key ∈ 15 module keys, action ∈ view|create|edit|delete|approve|export
                                    // unknown key/action throws at DEFINITION. mw.permission = { key, action }
requireAnyPermission([[key, action], ...])  // passes on ANY; scope = widest held. mw.permission = { any: [...] }
                                    // (the task's "anyOf" is this; there is no `anyOf` option)
requireCapability(code)             // user_capability ∪ role_capability codes; CEO passes. 403 CAPABILITY_REQUIRED
                                    // "This needs an authority you do not hold". No .permission tag.
requireCeo()                        // 403 PERMISSION_DENIED "Only the CEO can do this"
readPermissions(req, [[key, action], ...]) → Promise<boolean[]>   // for SHAPING a screen, never authorising;
                                    // CEO → all true; errors → all false; takes req (needs req.user)
scopeFor(user, key, action) → Promise<{ scope, scope_ids, employee_id } | null>
                                    // the same decision as requirePermission for non-route code
                                    // (worker, AI, search, "generate as recipient"); throws on bad key/action
scopeFromGrants(rows, action) → "all"|"team"|"own"|null          // widest among grant rows
COLUMN = { view: "can_view", create: "can_create", edit: "can_edit", delete: "can_delete",
           approve: "can_approve", export: "can_export" }
```

After a pass: `req.scope` (`all|team|own`), `req.scope_ids` (`null` for all; team = caller first then
everyone under them at any depth; own = `[employee_id]`), `req.permission = { key, action }`.
Module `ess` is always `own` (`catalog.OWN_ONLY`). Denials: 403 `PERMISSION_DENIED`
"You do not have access to this", metric `mycity_rbac_denials_total`.

### 3.2 `src/shared/access/access.catalog.js`

`MODULES` (15): `home, workspace, ess, community, mailbox, people, performance, queries, recruitment,
payroll, partnerships, expenses, knowledge, praxis_ai, settings`. `ACTIONS = ["view","create","edit",
"delete","approve","export"]` (it is `edit`, never `update`). `RECORD_SCOPES = ["all","team","own"]`.
Helpers: `isModule, isAction, isScope, widerScope(a, b)`, `MODULE_META[key] = { label, area, description }`.

Gate `scripts/check/module-catalogue.js`: every `requirePermission("<key>", "<action>")` is a string
literal from the catalogue.

### 3.3 `src/shared/rbac/grants-cache.js` (Redis, 30 s; team 60 s; Redis failure falls through to DB)

```js
getAuthUser(client, userId) → { user_id, employee_id, email, display_name, status, is_ceo, role_ids } | null
getGrants(client, { role_ids, module }) → [{ can_view, ..., can_export, scope }]
getTeamEmployeeIds(client, employeeId) → string[]   // own first, line_manager_id tree, depth ≤ 20
getMaskedFieldKeys(client, userId) → string[]       // "employee.salary" ...
getCapabilities(client, userId) → string[]          // codes; user_capability (unexpired) ∪ role_capability
invalidateUser(userId)    // after status, roles, capabilities or employee link change
invalidateGrants()        // after any role, grant, field-visibility or role-capability change (also clears caps)
bumpTeamVersion()         // after a reporting line change (organisation.events.js already does this)
TTL_S = 30
```
`getAuthUser` returns no `first_name`; `status` is `active|suspended|left`. Use it to load a report
recipient in the worker, as the audit export does.

### 3.4 `src/shared/rbac/scope.js`

```js
scopeOf(req) → { scope: req.scope || "own", scope_ids: req.scope_ids || null, employee_id }
scopeClause(s, { column: "e.employee_id" }, params) → { and, where }   // "" for all; pushes ids onto params
assertInScope(s, ownerEmployeeId)   // 404 NOT_FOUND (not 403) when outside scope
```
```js
const s = scopeClause(scope, { column: "e.employee_id" }, params);
const sql = `SELECT ... FROM employee e WHERE e.status = 'active' ${s.and} ORDER BY ...`;
```
A row whose owner column is NULL is invisible under team/own. `scopeFor(user, …)` returns the same shape
as `scopeOf(req)`, so the worker can pass it straight to a repo.

### 3.5 `src/shared/rbac/field-mask.js`

```js
maskForUser(client, user, data)   // masks at any depth, sets props to null (keeps contract shape); CEO never masked
maskData(data, maskedKeys); maskedKeysFor(client, user); canSee(client, user, fieldKey) → boolean
FIELDS: "employee.salary" (salary, base_salary, gross_pay, net_pay, gross_monthly, ...),
        "employee.bank", "employee.personal", "employee.statutory"
```
Apply at the boundary (controller, export, AI read), never in a service. A person's own row is not
masked from them: check `row.employee_id === req.user.employee_id`. Restricted props must be nullable in
the contract. For a report generated "as recipient": `maskForUser(pool, recipient, rows)` before building.

### 3.6 Capabilities today

Table `capability (capability_id, code citext UNIQUE, name, description)`; `user_capability
(user_id, capability_id, expires_at)`; `role_capability (role_id, capability_id, granted_by)` (0400).
Seeded codes: `announcements.post`, `alerts.clear` (0449, to roles `implementation`,
`operations_people`, `management`). Settings, Roles & Permissions edits them (`access.service.js`,
calls `invalidateGrants()` after a save). Seed new codes the same way:
```sql
INSERT INTO capability (code, name, description)
VALUES ('alerts.clear', 'Clear Alerts', 'Clear or dismiss an alert on Home.')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id FROM role r CROSS JOIN capability c
 WHERE r.code IN ('implementation', 'operations_people', 'management') AND c.code IN (...)
ON CONFLICT (role_id, capability_id) DO NOTHING;
```
DOWN deletes only what nobody has since given to a person or another role (see 0449).

`role.home_view` (0200) ∈ `operations | ceo | partnerships | staff | NULL`; `/me.home_view` = `"ceo"`
for the CEO, else the first role with one, else `"staff"`. This is the existing role → layout key.

---

## 4. HTTP helpers

### 4.1 `src/shared/http/paged.js` (THE pagination gate)

Exports: `PAGE_SIZE (25), TOTAL_COL, COMPLETE_CEILING (5000), pageOf, orderBy, envelope, pageQuery,
sendPaged, assertPage, completeQuery`.

```js
const TOTAL_COL = "COUNT(*) OVER() AS _total";
pageOf(query) → { number, size: 25, offset }               // bad input → page 1; max page 100000
orderBy(query, columns, tiebreak) → "e.last_name, e.first_name, e.employee_id"
  // columns: { sortKey: "sql, sql" }, FIRST key is the default; tiebreak = unique column (required)
  // desc adds " DESC NULLS LAST" to each part; unknown key falls back to default
pageQuery(client, sql, params, query) → { data: [...≤25], page: { number, size, total, pages, has_next } }
  // sql MUST contain TOTAL_COL and an ORDER BY, and NO limit/offset/fetch first (it appends LIMIT/OFFSET)
  // _total is stripped from rows; past the last page it runs a COUNT to report the real total
sendPaged(res, result)          // assertPage then res.json(result)
assertPage(result, label)       // throws unless { data: [], page } and data.length ≤ 25
completeQuery(client, sql, params, { label, ceiling }) → { rows }   // asks ceiling+1; over → 500 RESULT_SET_TOO_LARGE
envelope(data, number, total)   // build a page by hand (search.service does)
```
Repo usage (from the file header):
```js
const SORTS = { display_name: "e.last_name, e.first_name", department: "d.name", created_at: "e.created_at" };
function list(client, query, scope) {
  return pageQuery(client,
    `SELECT e.employee_id, e.staff_number, e.first_name, e.last_name, ${TOTAL_COL}
       FROM employee e
      WHERE ($1::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, SORTS, "e.employee_id")}`,
    [query.q ?? null], query);
}
```
Controller: `list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req)))`.

Worker batches (`alerts.escalateAged`, `workflow.sweepTimeouts`):
```sql
ORDER BY a.raised_at, a.home_alert_id
LIMIT $2 -- pagination:batch alerts one ageing run escalates
```

### 4.2 Contract primitives `packages/contract/schemas/common.js`

`uuid, text(max), optionalText(max), email, phone, isoDate, isoDateTime, money, blank(schema),
PAGE_SIZE, LIST_CONTROLS {page, q}, RESERVED_CONTROLS [page,q,sort], sortParam(sortable),
listQuery(filters, sortable), PageQuery, PageMeta, Paged(item), EmptyBody, IdParams, TABLES`.

```js
listQuery({ status: EmployeeStatus }, ["display_name", "created_at"])  // .strict(); ?sort=-created_at → {field, dir:"desc"}
Paged(Item)        // { data: z.array(item).max(25), page: PageMeta }.strict()
money              // /^-?\d{1,16}\.\d{2}$/ string
isoDateTime        // z.string().datetime({ offset: true })
```
Gate 6 (`scripts/check/contract-columns.js`): every exported object schema has a `TABLES` entry:
`{ table: "home_alert" }`, `{ table, virtual: { key: "<why>" } }`, or `{ table: null, reason: "<why>" }`.
Email/template vars precedent: `AuditExportEmailVars: { table: null, reason: "the variables of templates/email/audit-export.html, not a row" }`.
Gate (`pagination.js`): no `limit`, `offset`, `per_page`, `page_size` key anywhere in the contract
outside common.js, nor in an AI manifest.

### 4.3 `src/shared/http/respond.js`

`ok(res, body)` 200, `created(res, body)` 201, `accepted(res, body)` 202, `noContent(res)` 204. A single
record is sent as itself, a list is the page envelope.

### 4.4 Errors

`src/shared/errors.js`:
```js
class AppError extends Error { constructor(code, message, status = 400, fields = null) }
throw new AppError("EMPLOYEE_NOT_FOUND", "Employee not found", 404);
throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { work_email: ["is already in use"] });
```
Envelope (`middleware/error-handler.js`): `{ error: { code, message, fields }, request_id }`.
Non-AppError → 500 INTERNAL_ERROR. Postgres: 23505 → 409 ALREADY_EXISTS, 23503 → 409 REFERENCE_INVALID,
23502/23514 → 422. Messages have no dashes (gate 17 reads string literals in `src/`).
There is no generated error-code or API-reference document in this repo (`scripts/gen/` holds only
`components.js`, `contract.js`, `env-example.js`), so a new `AppError` code needs no doc regeneration.
A new or changed contract schema DOES: run `npm run gen:contract` (writes `packages/contract/contract.gen.ts`;
CI regenerates and fails on a difference; never edit it by hand).

### 4.5 Idempotency

`middleware/idempotency.js` is mounted on every staff write: the app sends `Idempotency-Key`; a replay
of the same request returns the stored 2xx. It does not make a service idempotent for the worker; the
guide's "running a report twice does not duplicate a file" (§11) still needs a service-level guard.

---

## 5. Database

### 5.1 `src/shared/db/tx.js`: `{ atomically, inTransaction, DEPTH }`

```js
atomically(client, fn) → fn's result   // BEGIN/COMMIT/ROLLBACK; nested calls JOIN the outer tx (depth counter);
                                       // joins a foreign BEGIN detected by SAVEPOINT probe
inTransaction(client) → boolean        // true only inside atomically()
```
Service helper used by every built module:
```js
async function tx(fn) {
  const client = await pool.connect();
  try { return await atomically(client, () => fn(client)); }
  finally { client.release(); }
}
```
`config/db.js` exports `{ pool, query, withClient, checkDatabase, closeDb }`.

### 5.2 `src/shared/db/query-helpers.js`

```js
insertOne(client, table, data, { writable, returning = "*" })
updateOne(client, table, pk, id, patch, { writable, returning, touch: "updated_at" }) → row | null
getById(client, table, pk, id, { columns, forUpdate }) → row | null
getOr404(client, table, pk, id, label, opts)          // 404 NOT_FOUND "<label> not found"
jsonb(data, columns)   // stringify jsonb columns before writing (node-postgres turns arrays into ARRAY literals)
defined(data); ident(name, ctx); table(name); assertWritable(keys, writable) // 422 FIELD_NOT_WRITABLE
```

### 5.3 `src/shared/db/pg-types.js`

`date` → `"YYYY-MM-DD"` string; `numeric` → string (money, thresholds, `over_by` "1.00");
`int8`/`COUNT(*)` → string, so write `COUNT(*)::int`; timestamptz → JS Date (the response check
sees it as an ISO string).

---

## 6. Events

### 6.1 `src/shared/events/catalogue.js`

```js
const { defineEvents } = require("../../shared/events/catalogue");
const EVENTS = defineEvents("home", {
  "home.report_run": { summary: "A report was generated" },            // CONSTANT: HOME_REPORT_RUN
});
```
- `moduleKey` must be a catalogue module key; key matches `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`;
- meta keys only `summary` (required, no em dash), `security`, `sensitive`;
- the same key twice is fine with the same module; another module claiming it throws;
- the first segment picks the notification category (`home` → `alerts`).
- Already declared: `catalogue.ALERTS` = `HOME_ALERT_RAISED "home.alert_raised"`,
  `HOME_ALERT_CLEARED "home.alert_cleared"`, `HOME_ALERT_ESCALATED "home.alert_escalated"` (module `home`);
  `catalogue.WORKFLOW` (`workflow.opened|advanced|completed|changes_requested|escalated|cancelled`, module
  `settings`); `vault.EVENTS` (`document.*`, module `settings`).
- Other API: `get(key)`, `has(key)`, `require(key)`, `all()`, `constantOf(key)`, `KEY_RE`.

None of the guide's signal keys are declared anywhere yet: `attendance.punched`,
`attendance.rule_breached`, `partnership.inactive`, `approval.aged`, `document.expiring`,
`recruitment.sla_missed`, `budget.threshold`. `outbox.register` accepts an undeclared key (regex only),
so Home can subscribe now; `defineNotification` and `jobs/registry` TRIGGERS require it declared.
`document.*` is the vault's (`settings`) namespace: a Home-declared `document.expiring` would be owned by
`home`. Decide who declares each signal (guide §3 step 4 says the owning module).

### 6.2 `src/shared/events/emit.js`: `{ emit, withActor, redact, changedFields, actorOf, PAYLOAD_MAX_BYTES }`

```js
await atomically(client, async () => {
  const row = await repo.insert(client, data);
  await emit(client, {
    key: EVENTS.EMPLOYEE_CREATED,              // required, declared
    entity: { type: "employee", id: row.employee_id },   // required; type snake_case
    actor,                                     // req.user | withActor(req) | user id | null (system); default: context user
    before, after,                             // audit before/after (credential keys redacted)
    payload: { ... },                          // what handlers get; object; ≤ 16 KB
    module,                                    // override the catalogue module
    metadata: { count: 12 },
    dedup_key: "announcement:published:<id>",  // at most one outbox row per key
  });
  return row;
});
// → { event_id, occurred_at }
```
One statement writes `event_log`, `audit_ledger`, `event_outbox`. Throws unless `inTransaction(client)`.
`withActor(req)` = `{ ...req.user, ip: req.ip }`. Fan-out subject: put `subject_employee_id`
(or `employee_id`) in the payload for scope-aware permission audiences.

### 6.3 `src/shared/events/outbox.js`

```js
const outbox = require("../../shared/events/outbox");
outbox.register("employee.created", "organisation.reindex", async (event, ctx) => { ... });
outbox.register("*", "notifications.fanout", fanout.handle);   // ALL = "*"
```
- name matches `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_-]*)+$/`, unique per key, STABLE (renaming reruns pending);
- `event` (frozen): `{ event_id, key, module, entity: { type, id }, actor_user_id, payload, occurred_at, request_id }`;
  `ctx`: `{ outbox_id, attempt }`;
- per-handler completion tracked per row (`completed_handlers`); a retry runs only the ones not done;
- backoff 10 s doubling, capped at 1 h; `max_attempts` default 8 → `failed`, reported, readiness degraded;
- each handler times out at 120 s; rows stuck `processing` reclaimed after 10 min; `SKIP LOCKED` claims;
- request id and actor are restored into the request context during the handler.
- Other exports: `handlersFor, registrations, markReady, isReady, dispatchDue({db, limit}), health(db),
  retryFailed(db, {outbox_ids}), prune(db, {days}), backoffSeconds, __reset`.

Worker boot (`src/worker.js` `loadHandlers`): requires `SHARED_HANDLER_FILES` (`shared/notifications/fanout`,
`shared/workflow/engine`, `shared/alerts/alerts`, `shared/documents/vault`, `shared/documents/generate`,
`shared/import/engine`), then every non-empty `src/modules/<m>/<m>.events.js` and `*.import.js` (sorted),
then `registry.registerTriggers()`, `registry.registerDelivery()`, then `outbox.markReady()`. A file that
throws stops the worker. The API process loads an events file only through the routes → controller →
service → events require chain.

Real outbox handler that enqueues a delayed job (`announcements.events.js`):
```js
outbox.register(EVENTS.ANNOUNCEMENT_CREATED, "announcements.schedule_release", async (event) => {
  const at = event.payload.publish_at;
  if (!at) return;
  await queues.enqueue("announcement-publish", "release",
    { announcement_id: event.payload.announcement_id },
    { delay: Math.max(0, new Date(at).getTime() - Date.now()), jobId: `announcement-publish-${event.payload.announcement_id}` });
});
```

---

## 7. Notifications

### 7.1 `src/shared/notifications/fanout.js`: `{ defineNotification, onDelivery, handle, watchers, permissionHolders, SPECS, __hooks }`

```js
defineNotification(key, {
  to: [ /* audiences, joined */ ],
  title: "string" | (event) => string,       // ≤ 200 chars, no em dash
  body: "string" | (event) => string,        // optional, ≤ 1000
  priority: "normal" | "high",
  include_actor: false,                      // the actor is not told about their own action by default
});
```
Audiences (exactly one key each):
```
{ permission: [module, action] }   active holders; with payload.subject_employee_id|employee_id: all-scope holders,
                                   team holders above the subject, the subject for own; without a subject: all-scope only.
{ permission: (event) => [module, action] }   rule-chosen (used for home.alert_raised)
{ subject: true }   { approvers: true }   { requester: true }   { ceo: true }
{ users: (event, client) => userIds }
```
- One handler (`notifications.fanout`) for every event, in the worker; rows `UNIQUE (event_id, user_id)`.
- The CEO is NOT added to permission audiences; name `{ ceo: true }` explicitly.
- Capabilities are not an audience. To tell holders of a capability, use `users:` with a query over
  `user_capability ∪ role_capability`.
- Links are not stored; the inbox derives them from `entity_type/entity_id` via route-map.

Already declared, do not redeclare:
```js
defineNotification(ALERTS.HOME_ALERT_RAISED, {
  to: [{ permission: (e) => e.payload.clear_permission }],
  title: (e) => `Alert: ${e.payload.title}`, body: (e) => e.payload.trigger || "", priority: "normal" });
defineNotification(ALERTS.HOME_ALERT_ESCALATED, {
  to: [{ ceo: true }],
  title: (e) => `Escalated alert: ${e.payload.title}`,
  body: (e) => `Open for ${e.payload.age_days} days without being cleared.`, priority: "high" });
```

### 7.2 `src/shared/notifications/categories.js`

`categoryFor(eventKey, moduleKey)`: first segment → `DOMAIN_TO_CATEGORY`, else `MODULE_TO_CATEGORY`, else
`system`. `home` → `alerts` (defaults: email on, push off). Locked: `security` only. Delivery
(`jobs/handlers/notification-deliver.js`): in_app pushed as realtime `notification`, email via
`templates/email/notification.html`; push arrives M6.

---

## 8. The alert engine `src/shared/alerts/alerts.js`

Exports: `SEVERITIES ["low","medium","high"], ESCALATE_AFTER_DAYS (14), parsePermission, evaluate, ageDays,
ruleByKey, raise, mayClear, clear, escalateAged`.

```js
parsePermission("people.approve") → ["people", "approve"]   // throws unless "<module>.<action>" from the catalogue
evaluate(rule, value) → { breached: v >= t, over_by: round2(v - t) }
ageDays(alert, now = new Date()) → whole days since raised_at
ruleByKey(client, key) → { home_alert_rule_id, key, metric, threshold, window_days, severity, permission_key, enabled } | null
                         // ENABLED rules only
raise(client, { rule, subject: { type, id }, value, title, trigger = null, subject_employee_id = null, actor = null })
  → { raised, created, alert }      // inside atomically(); disabled rule or below threshold → raised:false
mayClear(client, user, rule) → boolean   // CEO, or holds rule.permission_key at any scope
clear(client, { alert_id, actor, outcome = "cleared" | "dismissed", note = null }) → alert
  // inside atomically(); locks FOR UPDATE; 404 NOT_FOUND; 403 "You cannot clear this alert";
  // already cleared → returns it unchanged, no second event (idempotent)
escalateAged({ db = pool, days = 14, limit = 200 }) → { escalated }   // high, open, not escalated; each its own tx
```
Raise usage (from the file header):
```js
await atomically(client, async () => {
  const rule = await alerts.ruleByKey(client, "attendance.late_arrivals");
  await alerts.raise(client, {
    rule, subject: { type: "employee", id: employeeId }, value: 4,
    title: "Ada Obi: 4 late arrivals in 30 days", trigger: "Late on 2, 6, 9 and 13 October",
    subject_employee_id: employeeId,           // so `team` holders above Ada are told
  });
});
```
- Upsert on `UNIQUE (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL`; a repeat
  refreshes `over_by`, `title`, `trigger`, `last_seen_at` and emits nothing; only `created` emits
  `home.alert_raised` (payload: `rule_key, title, trigger, severity, over_by (string), subject_type,
  subject_id, clear_permission: [module, action], subject_employee_id`).
- `clear` emits `home.alert_cleared` with `before/after` and payload `outcome`.
- `escalateAged` emits `home.alert_escalated` (`actor: null`, payload `age_days`).
- `subject_employee_id` is NOT stored on `home_alert`; for team-scoped lists of employee subjects use
  `subject_type = 'employee' AND subject_id = ANY(...)`, or add a column by fix-forward migration.
- Nothing in the engine disables open alerts when a rule is switched off (guide §6: "switching a rule off
  clears its open alerts"): the Home service must do that, through `clear()` per alert or one UPDATE plus
  emits, in the same transaction as the rule change.
- Column contract: BACKEND_STRUCTURE §11.1. Migration 1100 made `trigger` nullable and `over_by numeric(18,2)`.
- Integration test pattern: `tests/integration/shared-layer.test.js` `describe("alerts")`.

---

## 9. `src/shared/rules/window-counter.js`: `{ windowBounds, evaluate, firstBreach }`

```js
windowBounds({ threshold, window_days }, asOf) → { from, to }      // inclusive, Lagos dates; window_days days ending on asOf
evaluate(rule, ["2026-10-02", ...], "2026-10-31") → { count, triggered, window_from, window_to, dates }
firstBreach(rule, dates) → "YYYY-MM-DD" | null                    // what to de-duplicate on
```
`threshold` must be an integer ≥ 1 and `window_days` 1..3660 (TypeError otherwise). SQL form:
`a.day BETWEEN $2 AND $3` with `[w.from, w.to]`.

---

## 10. Numbering

`src/shared/numbering/numbering.js`: `{ allocate, advanceTo, preview, format, periodOf, checkSchemes }`

```js
const { number } = await numbering.allocate(client, "query");                        // "QRY-0028"
const { number, seq, period } = await numbering.allocate(client, "payslip", { date: "2026-10-31" });
```
- Inside `atomically()` (throws otherwise); one `INSERT … ON CONFLICT DO UPDATE … RETURNING` locks the
  counter; a rollback takes the increment back (no gaps, no duplicates); never reused.
- Type not in `SCHEMES` → Error; no `numbering_scheme` row → 500 `NUMBERING_SCHEME_MISSING`.
- Period: Lagos business date of `date`, else today. `preview()` is display only.

`src/shared/numbering/schemes.js`: `SCHEMES` (frozen), `DOC_TYPES`, `RESETS`, `validateScheme(s)`.
Shape: `{ prefix: /^[A-Z0-9]{0,8}$/, padding 0..10, separator one of "-" "/" "." "_" or "", reset never|yearly|monthly, include_period }`.
Today: `employee, document, import_batch, query, sanction, letter, vacancy, offer, contract, payroll_run,
payslip, proposal, mou, expense, requisition, disbursement`. (`project` is seeded in 2099 but missing
from `SCHEMES`.)

Adding `home_report_run`:
1. `SCHEMES.home_report_run = { prefix: "RPT", padding: 4, separator: "-", reset: "yearly", include_period: true }`
   with a `// M1` comment (`format` → `RPT-2026-0001`).
2. Reference seed row in the M1 block, `INSERT INTO numbering_scheme (doc_type, prefix, padding, separator,
   reset, include_period) VALUES (...) ON CONFLICT (doc_type) DO NOTHING;` and a DOWN delete. Without the
   row `/api/health/ready` `numbering` is `down` → readiness degraded → the deploy gate stops.
3. Call it as a literal: `numbering.allocate(client, "home_report_run")`. Gate
   `scripts/check/numbering-schemes.js` refuses a computed type, and checks `docType:` / `numbering:` literals
   passed to the resource kit and `defineDocType`.
4. `tests/unit/foundation/domain.test.js` checks every default scheme is valid.

---

## 11. Documents and the vault

There is **no `src/services/documents/`** in this repo. Generation is `src/shared/documents/generate.js`,
PDF is `src/services/pdf/pdf.service.js` (Chromium), storage is `src/services/storage/storage.service.js`.

### 11.1 Doc types `src/shared/documents/types.js`

```js
defineDocumentType("query_letter", {
  label: "Query letter",
  module: "queries",        // whose `view` grant governs READING it (else the entity type's route-map module)
  sensitivity: "personal",  // normal | personal | restricted (restricted also needs the module's `edit`)
  signable: false, wet: false,
});
typeOf(docType); assertDocType(docType)   // 422 UNKNOWN_DOC_TYPE; signatureCeiling(docType); all()
```
Precedent for an export: `defineDocumentType("audit_export", { label: "Audit Log export", module: "settings", sensitivity: "restricted" })`.

### 11.2 Generated documents `src/shared/documents/generate.js`

```js
defineDocType(docType, {
  template: "query-letter",      // templates/documents/query-letter.html (file key /^[a-z][a-z0-9-]{1,63}$/)
  numbering: "letter" | null,    // a SCHEMES key; generate() allocates it
  sensitivity, landscape, label, module, signable, wet,
  title: (data) => string,       // required
});
defineVariables("document", "query-letter", c.queries.QueryLetterVars);   // shared/templates/variables.js

const doc = await documents.generate(client, {
  doc_type, entity: { type, id }, subject_employee_id, data, actor, date,
});   // inside atomically(); returns the document row, render_status "pending"
```
In the transaction: parse `data` against the declared variables (fails before numbering), allocate the
number, render HTML inside the letterhead, insert `document` (`source: "generated"`, `render_html`,
`template_version`), emit `document.render_requested` (module = route-map module of `entity.type`).
After commit: TRIGGER `document.render_requested` → queue `pdf-render` → `renderPending(id)` → PDF stored,
hashed, locked → emits `document.generated` payload `{ document_id, doc_type, number, content_hash }`.
Last attempt fails → `failRender` → `document.render_failed`. Other exports: `specOf, renderPending,
failRender, renderDocumentHtml, orgProfile(client), brand(), __reset`.

Template language (`shared/documents/render.js`): `{{ name }}` escaped, `{{#if x}}…{{else}}…{{/if}}`,
`{{#each list}}…{{/each}}` with `@index`/`@number`, house formatters only: `date`, `longdate`, `datetime`,
`month`, `money`, `number`, `markdown`. Built-ins every template may read: `org`, `number`, `today`, `doc`,
`staging` (mail adds `recipient`, `subject`). Files open with front matter (`subject:`, `title:`).
`templates/documents/statutory-report.html` and `templates/email/scheduled-report.html` exist and are EMPTY.

### 11.3 The vault `src/shared/documents/vault.js`

Exports: `EVENTS, COLUMNS, AREA_FOR, store, supersede, lock, get, getReadable, variantOf, canRead,
defineAccess, serve, parseRange, completeScan, completeAv, insertRow, moduleFor`.

```js
const doc = await vault.store(client, {          // inside atomically()
  file: { buffer, originalname: filename },      // bytes the system made, or readUpload(req)
  purpose: "document",                            // mime-policy: document = pdf, images, docx, xlsx
  doc_type: "audit_export",                       // registered
  entity: { type, id },
  subject_employee_id,                            // optional
  sensitivity: "restricted",                      // default: the doc type's
  source: "generated",                            // upload | generated | import
  title, expires_on, actor,
});
```
`store` sniffs the bytes, writes the file (under `vault/<yyyy>/<mm>/<uuid>.<ext>`), hashes as stored,
inserts the row, emits `document.stored`. It does not enforce size caps (middleware does).
`canRead(client, user, doc)`: an entity rule from `defineAccess` decides alone; else CEO; the subject
employee; the uploader; else `view` on the doc type's module (or the entity's route-map module) within
scope, plus `edit` for `restricted`. `getReadable(client, user, id)` → doc or 404.
```js
vault.defineAccess("community_channel", async (client, user, doc) => {
  const { rows } = await client.query(
    "SELECT 1 FROM community_member WHERE community_channel_id = $1 AND user_id = $2", [doc.entity_id, user.user_id]);
  return rows.length > 0;
});
```
Download for any readable document already exists: `GET /api/v1/documents/:id/content` (`self: true`,
`documents.routes.js`), and `GET /api/v1/documents/:id`. Home can return `document_id` and let the app
use those. `serve()` answers 409 `DOCUMENT_RENDERING` while pending and 410 `DOCUMENT_RENDER_FAILED`.

---

## 12. Spreadsheets `src/shared/spreadsheet/*`

```js
const { buildWorkbook } = require("../../shared/spreadsheet/build");
const { workbookContext } = require("../../shared/spreadsheet/context");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { buildCsv } = require("../../shared/spreadsheet/csv");

const buffer = await buildWorkbook({
  sheets: [{ name, title, columns: [ColumnSpec], rows, freeze: { y: 1 } }],
  context: workbookContext({ actor: { name }, title, filters, generatedAt, org }),
  cover: true,           // reports use the Cover sheet; import templates must not
});                      // → Buffer (.xlsx)
exportFilename({ base: "daily-attendance", env: config.APP_ENV, extension: "xlsx", date }) // "daily-attendance-2026-10-17.xlsx"; staging adds -STAGING-
```
ColumnSpec: `{ key, header, width, note, format, list, refColumn, total, wrap, emphasis }`;
`format` ∈ `money` (typed number "₦#,##0.00", sums), `int`, `qty`, `num`, `pct` (fraction in), `date`
(`dd/mm/yyyy`), `datetime` (`dd/mm/yyyy hh:mm`, Lagos), `bool` (Yes/No), `text`/`ref` (formula-injection
escaped). `total: true` writes a live `SUM()`. Builder is PURE: it never queries or pages; the caller
gathers rows (pages of 25, or a job). `workbookContext` reads `actor.full_name || actor.name`;
`orgProfile(client)` from generate.js gives the letterhead lines.

The pattern to copy for scheduled reports is the Audit Log export, `src/modules/audit/audit.events.js`:
```js
async function sendExport(event) {
  const reader = await grantsCache.getAuthUser(pool, event.payload.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return;
  const { rows, total, capped } = await service.gather(pool, filters, reader);   // pages of 25, masked for reader
  const buffer = await buildWorkbook({ sheets: [{ name: "Audit Log", columns: COLUMNS, rows, freeze: { y: 1 } }],
    context: workbookContext({ actor: { name: reader.display_name }, title: "Audit Log", filters }), cover: true });
  const filename = `${exportFilename({ base: "audit-log", env: config.APP_ENV, extension: "xlsx" })}`;
  const client = await pool.connect();
  let doc;
  try {
    doc = await atomically(client, () => vault.store(client, {
      file: { buffer, originalname: filename }, purpose: "document", doc_type: "audit_export",
      entity: { type: event.entity.type, id: event.entity.id }, sensitivity: "restricted",
      source: "generated", title: "Audit Log export", actor: reader.user_id }));
  } finally { client.release(); }
  await queues.enqueue("email-send", "audit-export", {
    to: { name: reader.display_name, email: reader.email }, template: "audit-export",
    data: { entries: Math.min(total, rows.length), filters: filtersText(filters), capped },
    attachments: [{ document_id: doc.document_id }],
  }, { jobId: `audit-export-${event.event_id}` });
}
outbox.register(EVENTS.AUDIT_EXPORT_REQUESTED, "audit.send_export", (event) => sendExport(event));
```
`gather` (audit.service.js) loops `repo.page(db, { ...filters, page: n })` while `has_next`, up to a
ceiling (10,000), so the export obeys the 25-per-page rule. Note: a retried handler builds and sends again
(accepted there; Home's §11 wants no duplicate file, so record the run's `document_id` and skip if set).

---

## 13. System mail `src/services/mail/system-mail.service.js`

`{ send, renderEmail, textOf, capturedMail, health, __reset }`. Only from an outbox handler or a job.
```js
await systemMail.send({
  to: { name, email } | [..],  cc, template: "scheduled-report",   // templates/email/<key>.html
  data: { ... },                 // parsed by defineVariables("email", key, schema)
  recipient,                     // what {{ recipient.* }} reads; default the first `to`
  attachments: [{ document_id }, { filename, content, contentType }],
  reply_to,
});   // → { message_id, accepted, rejected }
```
- ≤ 50 recipients per message; each address checked. Staging subject `[STAGING] …` plus a banner.
- `SMTP_HOST` empty (dev/test): captured in memory (`capturedMail()`), nothing sent.
- Paced (`services/mail/pace.js`, `MAIL_SEND_PER_HOUR`): over the limit throws `MAIL_PACED`; the
  `email-send` job postpones itself without spending an attempt.
- An attachment whose document is `render_status = 'pending'` or `scan_status` pending/infected throws
  "is not ready to attach" (retried by the job, not permanent).

Queue it rather than calling `send` inline (`jobs/handlers/email-send.js`):
```js
await queues.enqueue("email-send", "scheduled-report", {
  to: { name, email }, template: "scheduled-report", data, attachments: [{ document_id }],
}, { jobId: `scheduled-report-mail-${run_id}-${user_id}` });
```
Permanent failures (bad address, undeclared variables, AppError) → `UnrecoverableError`.
`templates/email/scheduled-report.html` is an empty stub: fill it (front matter `subject:`), declare its
variables in the contract (`{ table: null, reason }`), register with `defineVariables` in the events file.

---

## 14. Realtime

`src/services/realtime/emitter.js`: `{ ROOMS, CHANNEL_KEY, useServer, toUser, toChannel, endSession, reset }`
```js
const realtime = require("../../services/realtime/emitter");
realtime.toUser(userId, "notification", { notification_id, title });   // → boolean, never throws
```
Event name `/^[a-z][a-z0-9_.:-]{0,63}$/`; rooms `user:<id>`, `session:<id>`, `channel:<id>`, joined by
the server only. Call from outbox handlers and jobs, never a controller. In the worker it publishes over
Redis. Best effort: state goes through the outbox first. Messages ≤ 64 KB (`realtime/socket.js`).
A Home push (e.g. `home.kpi_changed` after `attendance.punched`) would be an outbox handler calling
`toUser`; the client must refetch over HTTP.

---

## 15. Jobs and schedulers

### 15.1 `src/jobs/registry.js`

Exports: `JOBS, SCHEDULERS, TRIGGERS, SCHEDULE_QUEUE ("schedule"), UnrecoverableError, isQueue, handlerOf,
defineSchedule, schedules, isLastAttempt, registerTriggers, registerDelivery, startConsumers,
startSchedules, startHeartbeat, workerHealth`.

```js
JOBS = [{ queue: "email-send", concurrency: 3, summary }, ...]   // queue name = jobs/handlers/<queue>.js
SCHEDULERS = ["outbox-dispatch", "workflow-timeout", "alert-ageing", "media-reconcile",
              "import-cleanup", "celebrations", "announcement-release", "mail-sync"]
TRIGGERS = [{ event, name, queue, when?, data: (e) => ({...}), opts? }]   // event → job, jobId `${queue}-${event_id}`
defineSchedule({ name /* kebab, = file name */, every /* ms ≥ 1000 */ | pattern /* 5-field cron, Africa/Lagos */,
                 tz, inProcess, run: async () => summary, summary })
isLastAttempt(job) → boolean
```
A BullMQ-ticked scheduler adds one job per tick to `schedule`, runs under `withCronLock(name, …)`,
`attempts: 1` (the next tick is the retry). A handler is `module.exports = async function (job) { ... }`;
throw `UnrecoverableError` when retrying cannot help.

### 15.2 `src/jobs/queues.js`: `{ enqueue, getQueue, closeQueues, DEFAULTS }`

```js
await queues.enqueue(name, jobName, data /* JSON ids only */, {
  jobId,              // dedup while waiting/running
  replaceFinished,    // with jobId: remove a finished job holding that id first
  delay, attempts, backoff, ...                   // BullMQ JobsOptions
});
// DEFAULTS: attempts 5, exponential from 5 s, keep 1000 done / 5000 failed
```
An unlisted queue throws "is not a queue (declare it in jobs/registry.js)". The request context
(`__ctx`: request id, user id) rides along and is restored in the worker.

### 15.3 `src/jobs/cron-lock.js`: `withCronLock(name, fn, { db }) → fn's result | undefined`

`pg_try_advisory_lock(hashtext("mycity:cron:<name>"))` on a pooled connection; never waits; another
process holding it → `undefined` (tick skipped); session-level, so `fn` opens its own transactions.

### 15.4 Built schedulers to copy

```js
// jobs/schedulers/alert-ageing.js
module.exports = defineSchedule({ name: "alert-ageing", pattern: "10 * * * *",
  summary: "Escalates high alerts nobody cleared",
  run: async () => { try { return await alerts.escalateAged(); }
    catch (err) { if (err && err.code === "42P01") return { skipped: "no home_alert table yet" }; throw err; } } });

// jobs/schedulers/workflow-timeout.js
module.exports = defineSchedule({ name: "workflow-timeout", every: 5 * 60 * 1000,
  summary: "Applies the time limit of approvals nobody decided", run: () => workflow.sweepTimeouts() });

// jobs/schedulers/celebrations.js  (module service required lazily inside run)
module.exports = defineSchedule({ name: "celebrations", pattern: "0 5 * * *",
  summary: "Birthday and work anniversary cards posted to #general",
  run: () => require("../../modules/community/community.service").postCelebrations() });

// jobs/schedulers/outbox-dispatch.js: every: 1000, inProcess: true (the only in-process one; the test pins that)
```
Sweep shape (`workflow.sweepTimeouts`): select a batch of ids with `LIMIT $1 -- pagination:batch …`, then
one `pool.connect()` + `atomically()` per id, counting `{ due, resolved, failed }`, logging failures.

### 15.5 Stubs relevant to Home (0 bytes, not registered)

| File | README §5.15 milestone |
|---|---|
| `jobs/handlers/scheduled-report.js`, `jobs/schedulers/scheduled-reports.js` | M1 (Home) |
| `jobs/handlers/attendance-day-close.js`, `jobs/schedulers/attendance-day-close.js` | M1 (LA, attendance) |
| `jobs/handlers/reminders.js`, `jobs/schedulers/reminders.js` | M6 |
| `jobs/handlers/partner-inactivity.js`, `jobs/schedulers/partner-inactivity.js` | M7 |
| `jobs/handlers/budget-threshold.js`, `jobs/schedulers/budget-threshold.js`, `jobs/handlers/approval-ageing.js`, `jobs/schedulers/approval-ageing.js` | M8 |

Filling one: write the file, add it to `JOBS` / `SCHEDULERS`, update
`tests/unit/foundation/worker-jobs.test.js` (exact lists) and README §5.15. Decision 6's daily sweeps:
filling the M7/M8 files early collides with those owners. Options: a Home-owned scheduler (e.g.
`home-alert-sweeps`, daily, calling one sweep per source adapter) and leave the forward stubs alone, or
fill them now with a note. Approval ageing can be swept today from `workflow_instance`
(`state = 'pending'`, `stage_entered_at`), an M0 table, without waiting for M8.

`scheduled-reports` design notes from the existing pieces: `report_schedule` (migration 1000) is
`recurrence jsonb, timezone, recipients citext[], active, last_run_at, next_run_at`, not a cron string
(the guide's `schedule (cron)`); `shared/time/recurrence.js` names scheduled reports as a consumer and
keeps the time of day OUTSIDE the rule. A tick (`every: 60_000` or `pattern: "*/5 * * * *"`) selects due
rows `next_run_at <= now()` in a marked batch, enqueues `scheduled-report` with
`jobId: scheduled-report-<schedule_id>-<period>`, and advances `next_run_at` with `recurrence.nextAfter`.

---

## 16. Time `src/shared/time/*`

`lagos.js` (UTC+1, no DST, pure):
```js
today(now?) "2026-10-14"; dateOf(instant); timeOf(instant) "07:05"; instant(date, "09:00") → Date;
startOfDay(date); endOfDayExclusive(date); addDays(date, n); addMonths(date, n) (clamped);
daysBetween(a, b); weekday(date) 1 Mon..7 Sun; yearMonth(date); monthBounds(date) → { first, last };
isDate(s); assertDate(s, label); TIME_ZONE "Africa/Lagos"; OFFSET_MIN 60
```
Never `toISOString().slice(0, 10)` for a business date (UTC date, wrong 00:00 to 01:00 Lagos).

`day-first.js` (everything a person reads: mail, PDFs, exports, notification text):
`formatDate` "09/10/2026", `formatDateTime` "09/10/2026 14:05", `formatLongDate` "9 October 2026",
`formatMonth` "October 2026", `parseDayFirst(text)` → ISO | null, `MONTHS`.

`working-week.js`:
```js
const cal = await workingWeek.loadCalendar(client);   // cached 60 s per process; invalidateCalendar()
isWorkingDay(date, cal); whyNotWorking(date, cal); nextWorkingDay(date, cal);
addWorkingDays(date, n, cal); countWorkingDays(from, to, cal); makeCalendar({ days, holidays, hours })
```
Reads `working_week` (Saturday is a working day 09:00 to 15:00 since seed 0199) and `public_holiday`.
"14 Working Days" on the Overview chart = walk back with `isWorkingDay`.

`recurrence.js`: rule `{ freq: daily|weekly|monthly|yearly, interval, by_weekday [1..7], by_month_day (1..31|-1),
working_days_only, until | count }`; `validateRule(rule) → string[]`, `assertRule`,
`occurrences(rule, start, { from, to, calendar }) → dates (≤ 400)`, `nextAfter(rule, start, after, { calendar }) → date | null`
(strictly after; five-year look-ahead). `working_days_only` needs a calendar.

Gate 15 (`scripts/check/date-format.js`): no `toLocaleDateString()`, no ISO day in mail/PDF/spreadsheet
code, markers `@date-format:parts|foreign|filename`.

---

## 17. Money `src/shared/money/money.js`

`{ Decimal, CURRENCY "NGN", ZERO, money, round, toWire, sum, percentOf, compare, isZero, isNegative,
allocate, formatNaira }`.
```js
const gross = m.money(row.gross_monthly);   // string from Postgres → Decimal; fractional JS number refused
m.toWire(gross.minus(tax))                  // "416250.00", half-up, once
m.formatNaira(v)                            // "₦416,250.00" for a person; { symbol: false }
m.allocate("100.00", [1, 1, 1])             // ["33.34", "33.33", "33.33"]
```
Gate 20 (`scripts/check/money.js`): a name containing a money word (amount, salary, budget, spend,
cost, ...) may not go through `Number()`, `parseFloat`, `Math.round`, `.toFixed()`, `+ - * /`, or a SQL
float cast. Budget-threshold percentages: compute with Decimal, or mark `@money:ok <reason>` for a true
ratio. Money on the wire is `common.money`.

---

## 18. Route map `src/shared/route-map.js`

`{ SCREENS, ENTITY_ROUTES, moduleSlug, screenPath, linkFor, moduleOf, hasRoute }`.
```js
SCREENS.home = ["overview", "alerts", "reports", "team"]
ENTITY_ROUTES.home_alert       = screen("home", "alerts")   // search:none not built yet (src/modules/alerts)
ENTITY_ROUTES.home_report      = screen("home", "reports")  // search:none not built yet (src/modules/reports)
ENTITY_ROUTES.home_report_run  = screen("home", "reports")  // search:none not built yet (src/modules/reports)
linkFor("query", id) → { module, tab, id, path: "/queries?tab=queries&id=<id>" } | null
linkFor(type, id, { self: true })   // the owner's own view (ess) when the type declares one
screenPath("home", "alerts", { params: { category: "people" } })  // "/home?tab=alerts&category=people"
                                         // { id } adds &id=<id>; "tab" and "id" are refused as params
moduleOf("home_alert") → "home"
```
Links are derived on read, never stored. `home_alert_rule` and `kpi` cards have no entity route; add one
if notifications, search or citations must open them (a test fails on a route to an unknown screen).
Once `alerts`/`reports` have a controller and a repo, the search gate rejects the
`not built yet (src/modules/...)` markers: give a provider or a real reason.

---

## 19. Search `src/shared/search/*`

`recordProvider(spec)` (`provider.js`), required: `type` (must be in ENTITY_ROUTES), `module`, `label`,
`from`, `key` (unique, ends ORDER BY), `columns`, `select` (`id, ref, title, sub, status`); optional
`words`, `where`, `order`, `scope: { column }`, `owner: { column }` (always `= caller's user_id`), `phones`.
Matching: folded prefix/substring, trigram for ≥ 4 letters. One page of 25 per group via `pageQuery`.

Gating (`search.service.js`): `scopeFor(user, provider.module, "view")` before the provider runs, scope via
the provider's scope column. Nothing else. A custom provider may be a frozen object with `type, module,
label, words, scoped, columns, search(client, { term, page, fuzzy, scope, user })`, plus `empty: true`
(answers an empty ⌘K) and `pinned: true`. Example `src/modules/workflow/workflow.search.js`:
```js
const waiting = Object.freeze({
  type: "approval", module: "ess", label: "Waiting on You",
  words: ["approval", "approvals", "waiting", "to approve"],
  scoped: false, columns: [], empty: true, pinned: true,
  async search(client, { term, page = 1, user }) {
    const result = await service.mine(user, { page, q: term || undefined }, client);
    return { page: result.page, items: result.data.map((row) => ({ id: row.workflow_instance_id, type: "approval",
      ref: null, title: row.subject_name || row.opened_by_name || row.definition_name,
      sub: `${row.definition_name} · ${row.stage_name}`, status: row.overdue ? "overdue" : "waiting", link: row.link })) };
  },
});
module.exports = [flows, waiting];
```
Each provider runs in a savepoint under a 2 s statement timeout; one that throws loses only its group.
Registry (`registry.js`) loads every non-empty `*.search.js`; two providers for one type fail the load.

`screens.js` `tabVisible(screen, reader)`, today:
```js
if (module === "home" && tab === "team") return reader.manages_people || reader.is_ceo;
if (module === "home" && (tab === "reports" || tab === "alerts")) return full || reader.manages_people;  // full = settings view || CEO
```
Reader = `{ grants, is_ceo, manages_people }` (`search.service.readerOf`), mirroring
`app/src/shell/access.ts`. Capability-based tabs need both changed together. Synonyms live in `SCREENS`
here (Home: "dashboard", "kpis", "needs you", "alert", "red flags", "report", "my team" ...).
`actions.js`: `a(key, label, { screen, params, run, need, words })`; `run: "clock"` is the existing Clock
In/Out action; a Home screen's New action (New Rule, New Report) must be listed here (gate 10 reads
`useScreenAction({ label })`).

---

## 20. AI `src/shared/ai/*`

```js
module.exports = defineManifest({
  module: "home",
  reads: [{
    key: "alerts.mine",                       // <thing>.<verb>, unique across the system
    description: "List the open alerts I can clear, newest first",   // 10..200 chars, no em dash
    params: c.alerts.HomeAlertQuery,          // a contract export; a listQuery() → list read, must return one page
    permission: ["home", "view"],             // must be "view"
    run: (client, params, actor) => service.listForAI(client, params, actor),  // actor = req.user + actor.scope
    cite: (row) => ({ type: "home_alert", id: row.home_alert_id, label: row.title }),
  }],
  routes: [{ intent: "clear an alert", screen: "home.alerts", params: { action: "clear" } }],
});
```
- Refused at load: any write-shaped key (`write(s)`, `action(s)`, `executor`, `execute`, `mutations`,
  `creates`, `updates`, `deletes`), non-contract params, non-`view` permission, a route to a non-screen.
  Route `params` are string values; `prefill` a contract schema.
- `authorise.runRead`: checks `view` via `scopeFor`, parses params, calls `run` with `{ ...actor, scope }`,
  `assertPage` for list reads (non-list reads return one record or null), masks with `maskForUser`, cites.
- Capability or rule-permission filtering is Home's job inside `run`.
- Gate 9: every module with a non-empty controller has `<module>.ai.js` or `// ai:none <reason>` in its
  controller. Gate 19: no writes. Registry: `shared/ai/registry.js`; catalogue synced at worker boot.
- Precedent for a "mine" read on a module every login holds: `src/modules/workflow/workflow.ai.js`
  (`permission: ["ess", "view"]`, service narrows to the asker).

---

## 21. Workflow reads Home can use for Need You

`src/shared/workflow/engine.js`:
```js
waitingOn(client, user, { page, module }) → page of pending instances whose current stage names the user
  // columns: workflow_instance_id, definition_key, module_key, entity_type, entity_id, subject_employee_id,
  //          current_stage, context, stage_entered_at, stage_due_at, opened_by, opened_at
findOpenInstance(client, { type, id }); getInstance(client, id); sweepTimeouts({ db, limit });
onCompleted(definitionKey, name, fn)   // outbox handler on workflow.completed filtered by definition_key
```
`workflow.service.mine(user, query, client)` is the enriched version My Approvals and ⌘K use.

---

## 22. State history and dedup (unlikely for Home, listed for completeness)

`src/shared/state/state-history.js`: `defineMachine(entityType, moves)`, `canMove`, `assertMove`
(409 MOVE_NOT_ALLOWED), `transition(client, machine, { entity_id, from, to, actor_id, reason })`,
`stagesFrom(rows, now)`, `currentStageSince(paramIndex)` (SQL to join "in stage since"). Table
`entity_state_history`. Useful for "stuck for N days" metrics (candidate, partner deal, expense).

`src/shared/dedup/dedup.js`: `norm.{email,digits,phone,name,company}`, `overlap`, `score`,
`rank(input, candidates, signals, { min = 55, cap = 10, idKey })`. Advisory duplicate scoring.

---

## 23. Gates that touch this work

| Gate | Script | Bites Home on |
|---|---|---|
| pagination | `scripts/check/pagination.js` | LIMIT/OFFSET in repos, unmarked batch, completeQuery marker, page-size keys |
| route contracts (7) | `scripts/check/route-contracts.js` | strict boot of every module |
| module catalogue | `scripts/check/module-catalogue.js` | non-literal or unknown permission key |
| contract columns (6) | `scripts/check/contract-columns.js` | missing `TABLES` entry, key not a column |
| schema drift (6) | `scripts/check/schema-drift.js` | `alias.column`, INSERT/UPDATE columns, tables no migration creates (forward tables 2000..8000 exist) |
| numbering | `scripts/check/numbering-schemes.js` | unlisted or computed doc type |
| search coverage (10) | `scripts/check/search-coverage.js` | module with controller+repo and no provider/marker; stale "not built yet" markers |
| AI coverage (9), no writes (19) | `ai-manifest-coverage.js`, `ai-no-writes.js` | missing manifest or marker; write keys |
| money (20), dates (15), dashes (17) | `money.js`, `date-format.js`, `dashes.js` | arithmetic on money names; ISO on paper; dashes in string literals and templates |
| provenance | `provenance.js` | any donor project name or path in code, comments, tests, seeds |
| migrations | `migration-numbers.js`, `migration-idempotency.js`, `migration-reversibility.js` | block, uniqueness, `-- UP`/`-- DOWN`, idempotent |
| guides, progress, readme map | `guides.js`, `progress.js`, `readme-map.js` (Stop hook) | guide §10 tables, PROGRESS rows, README listing new files |

---

## 24. Conflicts and open points found while reading

1. Guide says one backend module `home` and `schemas/home.js`; README and the stubs say
   `dashboard` / `alerts` / `reports` and `schemas/{dashboard,alerts,reports,kpis}.js`.
2. Capability `home.alerts.manage` does not fit `CapabilityCode` (two segments only).
3. Guide §1 header lists `home.alerts` as a permission key; only `home` exists as a key. Under decision 2
   it is a capability, and the existing one is `alerts.clear`.
4. `alerts.clear()` authorises on the rule's `permission_key` only; decision 2 adds `alerts.clear`. Both,
   or one? Today a holder of `people.view` (seed 1099 rules) can clear without the capability.
5. Shell and search tab visibility use `manages_people` / `settings` / CEO; decision 2 uses capabilities.
   `/me` has no capabilities field.
6. Guide §4 `home_report.schedule (cron)` vs migration 1000 `report_schedule.recurrence jsonb` +
   `next_run_at` and `shared/time/recurrence.js` (no cron).
7. Guide §7 `home.report_scheduled (worker cron)` is described as an event; the scheduler is a job, and
   only a write needs an event. Decide whether a scheduled run emits `home.report_run` like an on-demand one.
8. Guide §6 "switching a rule off clears its open alerts": not in the shared engine.
9. `home_alert` has no `subject_employee_id`, so team scope on alert lists needs `subject_type='employee'`
   or a new column.
10. Signal events in guide §3/§7 are declared by no module; who declares `document.expiring` (the vault's
    `document.*` namespace belongs to `settings`)?
11. The forward scheduler stubs (M7 `partner-inactivity`, M8 `budget-threshold`, `approval-ageing`) are
    owned by later milestones; decision 6's daily sweeps need a home that does not pre-empt them.
12. `numbering` has `project` seeded (2099) but not in `SCHEMES`; unrelated to Home, but readiness lists
    only `SCHEMES` types.

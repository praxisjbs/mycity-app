# MyCity App ERP · Backend Guide

**Read this before writing any backend code, whether you are a person or an AI.** It is the how-to:
the order to work in, what each layer may and may not do, and the checks a change must pass.
The design behind it (why it is built this way) is in `BACKEND_STRUCTURE.md` and
`SYSTEM_ARCHITECTURE.md`; this guide points into them rather than repeating them.

Owner GE. Written 13 October 2026. If something here is wrong or missing, fix the guide in the same
PR as the code. A rule that only lives in someone's head is not a rule.

---

## 1 · Before you write anything

1. **Find the screen** in `docs/PROGRESS.md`. Note its row number, milestone and owner.
2. **Read the feature guide** in `docs/guides/<module>.md` if one exists. It says which screens the
   feature touches and how they relate. If your change alters behaviour the guide describes, update
   the guide first, then build. A change that contradicts the guide is a defect, even if it works.
3. **Read the milestone section** in `docs/MyCity-ERP-Documents/MILESTONES.md` (scope, definition
   of done) and the module's row in `REUSE_MAP.md` (which donor file to port). `REUSE_MAP.md` wins
   where the two disagree.
4. **Check the map.** `README.MD` §4 and §5 list every file for M0 to M11. The file you need almost
   certainly exists already as an empty stub. If it does not, read README §11 before creating one.
5. **Look in `src/shared/` and `src/services/` first** (§4 below). If two modules need it, it is
   shared. A module never grows its own mailer, money helper, date formatter, file store, pager or
   AI client.

`demo.html` shows what a screen looks like. It is never a source of data, rules or field names.

---

## 2 · The layers and their limits

A request travels `route → controller → service → repo`. Each layer has one job, and the limits
are enforced by review and by the gates.

| Layer | File | Does | Never |
|---|---|---|---|
| Contract | `packages/contract/schemas/<module>.js` | Zod shape of every body, query, param and response | Lives in the module. Uses camelCase keys |
| Route | `<module>.routes.js` | `route(router, method, path, contract, ...handlers)`; `requirePermission(key, action)` on every staff route | Skips the contract or the permission |
| Controller | `<module>.controller.js` | Reads `req`, calls the service, sends the response | Calls a repo. Holds business rules |
| Service | `<module>.service.js` | Business rules, the transaction, `emit()`, numbering, `documents.generate()` | Touches `req`/`res`. Sends mail, renders PDFs or calls AI inside the transaction |
| Repo | `<module>.repo.js` | Parameterised SQL, honours `scope` | Emits events. Writes for another module. Writes its own `LIMIT` |
| Events | `<module>.events.js` | Event keys emitted; outbox handlers registered | Does work synchronously in the request |
| AI | `<module>.ai.js` | Read manifest: reads with permission and citation, routes to screens | Declares a write (A23) |
| Search | `<module>.search.js` | ⌘K provider | Is missing on a module with records (gate 10) |

**One write path.** A form, a workflow decision, an import row and a script all create a record
through the same service function. That is how numbering, audit, events and field rules apply
whatever the entry point. `scripts/db/create-admin.js` is the reference example: it creates an
employee through `organisation.service`, not through SQL.

---

## 3 · Building an endpoint, start to finish

The worked example is a list and a create for a module called `things`. Substitute your module.

The property names the example uses on `req` (`validated`, `scope`, `user`) are those of the
middleware ported in M0. If a ported file names them differently, the code wins and this example is
corrected in the same PR.

### 3.1 Contract first

```js
// packages/contract/schemas/things.js
const { z } = require("zod");
const { uuid, text, isoDate, listQuery, Paged } = require("./common");

const Thing = z.object({
  thing_id: uuid,
  number: z.string(),
  title: text(150),
  due_on: isoDate,
  created_at: z.string(),
}).strict();

const ThingListQuery = listQuery({ status: z.enum(["open", "closed"]).optional() });
const ThingPage = Paged(Thing);
const ThingCreate = z.object({ title: text(150), due_on: isoDate }).strict();

module.exports = { Thing, ThingListQuery, ThingPage, ThingCreate };
```

Keys are `snake_case` and equal the table columns. A key that is not a column is declared `virtual`
with a reason (gate 6). Run `npm run gen:contract` after any schema or route change; never edit
`contract.gen.ts`.

### 3.2 Route

```js
// src/modules/things/things.routes.js
const router = require("express").Router();
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const c = require("@mycity/contract");
const controller = require("./things.controller");

route(router, "get", "/", { query: c.things.ThingListQuery, response: c.things.ThingPage },
  requirePermission("workspace", "view"), controller.list);

route(router, "post", "/", { body: c.things.ThingCreate, response: c.things.Thing },
  requirePermission("workspace", "create"), controller.create);

module.exports = { basePath: "/things", surface: "staff", router };
```

Actions are `view create edit delete approve export`. It is `edit`, never `update`.

### 3.3 Controller

```js
const { sendPaged } = require("../../shared/http/paged");
const service = require("./things.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.scope)),
  create: async (req, res) => res.status(201).json(await service.create(req.validated.body, req.user)),
};
```

### 3.4 Service

```js
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const repo = require("./things.repo");

async function list(query, scope) {
  return repo.list(pool, query, scope);
}

async function create(body, actor) {
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const number = await numbering.allocate(client, "thing");
      const thing = await repo.insert(client, { ...body, number, created_by: actor.user_id });
      await emit(client, { key: "thing.created", entity: { type: "thing", id: thing.thing_id }, actor, after: thing });
      return thing;
    });
  } finally {
    client.release();
  }
}

module.exports = { list, create };
```

Anything that must happen after the save (a notification, an email, a PDF, an AI call, a search
reindex) is an outbox handler in `things.events.js`. It runs in the worker after commit, so a
rolled-back transaction leaves nothing behind.

### 3.5 Repo, and the pagination rule

**Every list pages at 25, through `shared/http/paged.js`. No exceptions for screens, exports
previews, pickers or the AI** (internal meeting 12 October; BACKEND_STRUCTURE §16).

```js
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");

function list(client, query, scope) {
  return pageQuery(client,
    `SELECT t.thing_id, t.number, t.title, t.due_on, t.created_at, ${TOTAL_COL}
       FROM thing t
      WHERE ($1::text IS NULL OR t.status = $1)
        AND ($2::text IS NULL OR search_fold(t.title) LIKE '%' || search_fold($2) || '%')
        AND ($3::uuid[] IS NULL OR t.owner_id = ANY($3))
      ORDER BY t.due_on DESC, t.thing_id`,
    [query.status ?? null, query.q ?? null, scope.ids ?? null],
    query);
}
```

- Put `TOTAL_COL` in the SELECT list. End with an `ORDER BY` that is unique (finish on the primary
  key) or rows repeat and vanish between pages. Do not write `LIMIT` or `OFFSET`; `pageQuery`
  appends them and throws if you do.
- The client sends `page` and the list's filters. It cannot choose a page size: there is no
  `limit`, `offset`, `per_page` or `page_size` anywhere in the contract.
- Search, filters and sorting happen in SQL. Never filter one page in JavaScript and present it as
  the whole result (praxis-ls Finance hub showed "No invoices match" for invoices on row 80).
- `LIMIT 1` for a single-row lookup is fine.
- A set that must be loaded whole (the permission matrix) uses `completeQuery()` with a
  `// pagination:complete <reason>` marker on the line above. It is never shown as a list and
  never given to the AI.
- `scripts/check/pagination.js` fails the build on any of the above.

### 3.6 AI manifest and search

```js
// src/modules/things/things.ai.js
module.exports = defineManifest({
  module: "workspace",
  reads: [{
    key: "things.list",
    description: "List things, filtered by status",
    params: c.things.ThingListQuery,          // listQuery(): the AI pages at 25 too
    permission: ["workspace", "view"],
    run: (client, params, actor) => repo.list(client, params, actor.scope),
    cite: (row) => ({ type: "thing", id: row.thing_id }),
  }],
  routes: [{ intent: "create a thing", screen: "things.new", prefill: c.things.ThingCreate }],
});
```

A read returns one page. When someone asks the assistant for "all my contacts", it answers with
the first 25 and the total, and fetches page 2 when asked. It never writes; it links to the screen
where the person makes the change (A23).

### 3.7 Tests, progress, guide

- Unit tests beside the code (`things.test.js`); integration tests with real Postgres under
  `RUN_DB_TESTS=1`. Every response is parsed with its contract schema in integration tests.
- Tick the screen's **API** column in `docs/PROGRESS.md` and leave a note.
- If behaviour changed, the feature guide in `docs/guides/` changed with it.

---

## 4 · Use what exists

| You need | Use | Not |
|---|---|---|
| A transaction | `shared/db/tx.atomically(client, fn)` | `BEGIN` by hand |
| A list | `shared/http/paged.pageQuery` + `sendPaged` | Your own `LIMIT`/`OFFSET`, a bare array |
| Validation | Contract schema via `route()` | Hand checks in the controller |
| An error the user should see | `throw new AppError(code, message, status, fields)` (`shared/errors.js`) | `res.status(400).send(...)`, raw `Error` |
| A document number | `numbering.allocate(client, type)` inside the transaction | `MAX()+1`, a sequence |
| Money | `shared/money` (`decimal.js`), `numeric(18,2)`, strings on the wire | `Number()`, `parseFloat`, `+` |
| A date a person reads | `shared/time/day-first`; business dates from `shared/time/lagos` | `toLocaleDateString()` with no locale |
| Working days | `shared/time/working-week` | A hard-coded Monday to Friday |
| A file | `middleware/upload` + `shared/documents/vault`; store a `document_id` | A path column, a module file table |
| A PDF | `documents.generate()` (outbox → worker → Chromium) | Rendering in the request |
| Mail | `services/mail/system-mail.service` via an outbox handler | nodemailer in a module |
| Something to happen after save | An outbox handler in `<module>.events.js` | Doing it inside the transaction |
| An approval | A workflow definition over `shared/workflow/engine` | Status flags and if-chains |
| A rule like "3 late in 30 days" | `shared/rules/window-counter` | A bespoke counter |
| An alert someone must clear | `shared/alerts` | A notification |
| AI | `services/ai/llm.service.complete()` | A vendor SDK import (gate) |
| Geofence maths | `shared/geo` | Haversine pasted into the module |
| Realtime push | An outbox handler → `services/realtime/emitter` | `io.emit` from a controller |
| A spreadsheet in or out | `shared/spreadsheet`, `shared/import` | A new xlsx library |

---

## 5 · Permissions and scope

- Every staff route: `auth` then `requirePermission(key, action)`. The permission keys are the 15
  modules in README §5.2.
- `req.scope` is `all`, `team` or `own`. The repo filters by it; the controller never does.
- Field masking (`shared/rbac/field-mask`) hides restricted fields (bank, salary, date of birth)
  from users without the field grant, in responses, exports, import previews and AI reads.
- Public routes (`*.public.routes.js`) never import `auth` or `rbac`. They are reached by token or,
  for careers and vacancies only, by slug.

---

## 6 · Migrations

- `migrations/NNNN_name.sql` in your milestone's block (README §6.3: M1 is 1000 to 1999, and so on).
  `-- UP` and `-- DOWN` in every file. Idempotent (`IF NOT EXISTS`).
- Every table: `<entity>_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at
  timestamptz`. Money `numeric(18,2)`. Dates that are business dates are `date`.
- A merged migration is never edited. Change it with a new file.
- Destructive steps (drop, rename, type change) are declared in the header and ship one release
  after the code that stops using them.
- Add the numbering schemes and workflow definitions your milestone introduces in its migration.
- **Two databases, not two schemas**: `mycity_stg` and `mycity_prod`, separate roles, no
  cross-grants. Staging gets realistic demonstration data from `scripts/db/seed.js --staging`.
  Production is never seeded. The code reads everything from the database; nothing a screen shows
  is hard-coded, so the same build shows seeded data on staging and real data on production.

---

## 7 · Scripts

| Script | When |
|---|---|
| `scripts/db/create-admin.js` | Once per environment, to make the first administrator: a full employee, login and role in one transaction (BACKEND_STRUCTURE §17). Interactive only. `--sample` on staging and local fills the employee with a sample profile and asks only for email, role and password |
| `scripts/db/seed.js --build` / `--staging` | Synthetic or demonstration data. Refuses on production (three checks) |
| `scripts/db/migrate.js` | Locally. On servers, migrations run only inside `deploy-gate` |
| `scripts/import/run.js` | First staff load on staging, through the import engine |
| `scripts/check/*.js` | The gates. `npm run ci` runs them all |

A script that writes data goes through services like any other caller.

---

## 8 · Done means

- [ ] Contract schemas in `packages/contract`, `gen:contract` run, no hand edit of the generated file
- [ ] Every route has a contract, a permission and (for writes) a body
- [ ] Every list pages at 25 through `pageQuery`
- [ ] Writes go through the service, in a transaction, with `emit()`
- [ ] Follow-on work is an outbox handler, not in the request
- [ ] `.ai.js` and `.search.js` present (or a written `none` with the reason)
- [ ] Unit tests beside the code; integration tests for every endpoint
- [ ] `npm run ci` green, the whole suite, before pushing
- [ ] `docs/PROGRESS.md` row ticked and a note left
- [ ] The feature guide in `docs/guides/` matches what was built

Engineered by JBS Praxis.

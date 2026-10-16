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

const ThingListQuery = listQuery(
  { status: z.enum(["open", "closed"]).optional() },
  ["due_on", "title", "created_at"],            // the fields a caller may sort by (F20)
);
const ThingPage = Paged(Thing);
const ThingCreate = z.object({ title: text(150), due_on: isoDate }).strict();

module.exports = { Thing, ThingListQuery, ThingPage, ThingCreate };
```

Keys are `snake_case` and equal the table columns. Each schema file says which table each exported
object schema belongs to, in a `TABLES` export, and gate 6 (`check/contract-columns.js`) checks every
key against the migrated columns:

```js
const TABLES = {
  ThingCreate: { table: "thing" },                        // every key is a column of thing
  ThingImportRow: { table: "thing", virtual: { owner_email: "resolved to owner_employee_id" } },
  ThingListQuery: { table: null, reason: "list controls, not a row" },
};
module.exports = { TABLES, Thing, ThingListQuery, ThingPage, ThingCreate, ThingImportRow };
```

A key that is not a column is declared `virtual` with a reason; a schema that is not a row says
`table: null` and why. Run `npm run gen:contract` after any schema or route change; never edit
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

What `route()` does for you, and refuses (`src/http/route.js`; the process does not start with a
broken route):

- It puts `auth` first on every staff route; you never add it. It runs your handlers next
  (`requirePermission`, `upload.single(...)`), then validates against the contract, then your last
  handler. The controller reads `req.validated.body`, `.query`, `.params`.
- Every schema must be exported from `packages/contract`; a local `z.object` is refused.
- Every route declares `response` (or `no_content: true` for a 204). Every POST, PUT and PATCH
  declares `body`; use `c.common.EmptyBody` when the URL says it all (`POST /:id/submit`).
- A staff route needs `requirePermission(key, action)`, or `self: true` when it is about the
  caller's own records and the service checks ownership (my notifications, my profile).
  `anonymous: true` is for sign-in only.
- `:id` and `:something_id` path parameters must be UUIDs; anything else is a 404.
- Under `APP_ENV=test` every 2xx response is parsed with `response`, so a field the contract does
  not declare fails your test.
- Public routes use `publicRoute()` in `<module>.public.routes.js`: no auth, no permission check.

### 3.3 Controller

```js
const { sendPaged } = require("../../shared/http/paged");
const { created } = require("../../shared/http/respond");
const { scopeOf } = require("../../shared/rbac/scope");
const service = require("./things.service");

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  create: async (req, res) => created(res, await service.create(req.validated.body, req.user)),
};
```

`scopeOf(req)` is `{ scope, scope_ids, employee_id }` from `requirePermission`: `scope` is `all`,
`team` or `own`; `scope_ids` is `null` for all, or the employee ids the caller may see.

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
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

/** The SQL for each field ThingListQuery allow-lists. The first is the default order. */
const SORTS = { due_on: "t.due_on", title: "t.title", created_at: "t.created_at" };

function list(client, query, scope) {
  const params = [query.status ?? null, query.q ?? null];
  const s = scopeClause(scope, { column: "t.owner_employee_id" }, params);   // "" for all
  return pageQuery(client,
    `SELECT t.thing_id, t.number, t.title, t.due_on, t.created_at, ${TOTAL_COL}
       FROM thing t
      WHERE ($1::text IS NULL OR t.status = $1)
        AND ($2::text IS NULL OR search_fold(t.title) LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "t.thing_id")}`,
    params,
    query);
}
```

`scopeClause` is the one translation of `team` and `own` into SQL. A row whose owner column is
NULL is visible only under `all`. For one record already loaded, `assertInScope(scope, owner_id)`
answers 404 when it is outside the caller's scope.

- Put `TOTAL_COL` in the SELECT list. End with an `ORDER BY` that is unique (finish on the primary
  key) or rows repeat and vanish between pages. Do not write `LIMIT` or `OFFSET`; `pageQuery`
  appends them and throws if you do.
- The client sends `page`, the list's filters and at most one `sort`. It cannot choose a page size:
  there is no `limit`, `offset`, `per_page` or `page_size` anywhere in the contract.
- **Sorting is the contract's, not the caller's** (F20). `listQuery(filters, sortable)` allow-lists
  the fields, so `?sort=-due_on` parses to `{ field, dir }` and `?sort=salary` is a 422 naming
  `sort`. `orderBy(query, SORTS, tiebreak)` turns it into SQL **from the repo's own map**: the
  caller picks a key, never a character of the query. Every order finishes on the unique column, or
  rows that tie swap places between pages. Index what you allow-list.
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
  routes: [{ intent: "create a thing", screen: "workspace.tasks", params: { action: "new" }, prefill: c.things.ThingCreate }],
});
```

A read returns one page. When someone asks the assistant for "all my contacts", it answers with
the first 25 and the total, and fetches page 2 when asked. It never writes; it links to the screen
where the person makes the change (A23). A route's `screen` is `"<module>.<tab>"` as listed in
`shared/route-map.js` SCREENS; `params` are extra query values for that screen (`action: "new"`).

A module with records also ships `<module>.search.js` for ⌘K:

```js
// src/modules/things/things.search.js
module.exports = recordProvider({                // shared/search/provider.js
  type: "thing", module: "workspace", label: "Things", words: ["thing"],
  from: "thing t", key: "t.thing_id", columns: ["t.number", "t.title"],
  select: "t.thing_id AS id, t.number AS ref, t.title AS title",
  scope: { column: "t.owner_employee_id" },     // team and own scope apply, as on the screen
});
```

A module with no AI surface or nothing to search says so at the top of its controller, with a
reason: `// ai:none <reason>`, `// search:none <reason>` (gates 9 and 10). Feature AI inside a
service is one call, `services/ai/llm.service.complete({ purpose, module, actor, input, output })`,
with its prompt in `services/ai/prompts/<purpose>.md`; it runs in an outbox handler or on a person's
request, never inside a transaction, and what it returns is provisional until a person accepts it.

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
| Who is calling, and over which records | `req.user`, `scopeOf(req)`, `shared/rbac/scope.scopeClause` | Reading the token yourself; your own "my team" query |
| A success response | `shared/http/respond` (`ok`, `created`, `noContent`) or `sendPaged` | Wrapping one record in `{ data }` |
| A list | `shared/http/paged.pageQuery` + `sendPaged` | Your own `LIMIT`/`OFFSET`, a bare array |
| Validation | Contract schema via `route()` | Hand checks in the controller |
| An error the user should see | `throw new AppError(code, message, status, fields)` (`shared/errors.js`) | `res.status(400).send(...)`, raw `Error` |
| A document number | `numbering.allocate(client, type)` inside the transaction | `MAX()+1`, a sequence |
| Money | `shared/money` (`decimal.js`), `numeric(18,2)`, strings on the wire | `Number()`, `parseFloat`, `+` |
| A date a person reads | `shared/time/day-first`; business dates from `shared/time/lagos` | `toLocaleDateString()` with no locale |
| Working days | `shared/time/working-week` | A hard-coded Monday to Friday |
| A file | `middleware/upload.single(field, { purpose })` + `shared/documents/vault`; store a `document_id` | A path column, a module file table, a base64 field |
| A PDF | `documents.generate()` (outbox → worker → Chromium) | Rendering in the request |
| Mail | `services/mail/system-mail.service` via an outbox handler | nodemailer in a module |
| Something to happen after save | An outbox handler in `<module>.events.js` | Doing it inside the transaction |
| An event key | `defineEvents(module, { "thing.created": { summary } })` in `<module>.events.js` (`shared/events/catalogue`); use the constant it returns | A string typed at the call site |
| Telling people something happened | `defineNotification(key, { to, title })` in `<module>.events.js` (`shared/notifications/fanout`) | Writing `notification` rows, or mailing from the service |
| A link to a record (bell, task, alert, AI) | `shared/route-map.linkFor(type, id)` when it is shown | Storing a URL |
| Restricted fields on the way out | `shared/rbac/field-mask.maskForUser` in the controller | Deleting keys by hand |
| A plain register (list, get, create, edit, archive) | `shared/crud/resource` (`makeRepo`, `makeService`, `makeController`, `mountResource`) | Copying another module's six files |
| An approval | A workflow definition over `shared/workflow/engine` (`openInstance` in the save's transaction, `onCompleted` to react) | Status flags and if-chains |
| A rule like "3 late in 30 days" | `shared/rules/window-counter` | A bespoke counter |
| An alert someone must clear | `shared/alerts` | A notification |
| AI | `services/ai/llm.service.complete()` | A vendor SDK import (gate) |
| Geofence maths | `shared/geo` | Haversine pasted into the module |
| Realtime push | An outbox handler → `services/realtime/emitter` | `io.emit` from a controller |
| A spreadsheet in or out | `shared/spreadsheet` (`buildWorkbook`, `parseUpload`, `buildCsv`), `shared/import` (`defineImporter` in `<module>.import.js`) | A new xlsx library |
| A document from a template | `defineDocType` + `defineVariables`, then `documents.generate()` in the transaction | Rendering HTML yourself, calling Chromium |
| A calendar invite | `services/calendar/ics` (`attachment()` on system mail) | Writing ICS by hand |
| A secret the system must read back (an IMAP password) | `services/secrets/encryption.service` with an `aad` naming its record | Storing it plain, or base64 |
| A QR code on a document | `services/qr` (our public origin only) | A QR library in a module |

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

**The full rules are `docs/MIGRATIONS.md`; read it before writing a migration or a reference seed.**
The summary:

- `migrations/NNNN_name.sql` in your milestone's block (README §6.3: M1 is 1000 to 1999, and so on).
  `-- UP` and `-- DOWN` in every file. Idempotent (`IF NOT EXISTS`).
- Every table: `<entity>_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at`, `updated_at
  timestamptz`. Money `numeric(18,2)`. Dates that are business dates are `date`.
- A merged migration is never edited. Change it with a new file. Gate 5 fails a merged file that
  was edited, renamed or deleted.
- Destructive steps (drop, rename, type change, SET NOT NULL, DELETE) are declared with
  `-- DESTRUCTIVE: <what is lost, and why>` in the header or on the line above, and ship one release
  after the code that stops using them.
- DOWN names everything UP creates. A change that cannot be undone says so instead of a DOWN:
  `-- IRREVERSIBLE: <what cannot be rebuilt>`; `migrate.js --down` refuses that file.
- Gates 3, 4 and 5 check all of this (`scripts/check/migration-*.js`). With `RUN_DB_TESTS=1` and
  `DATABASE_URL`, gate 4 also runs UP, every DOWN and UP again on a throwaway database.
- Add the numbering schemes and workflow definitions your milestone introduces in its migration.
- **Two databases, not two schemas**: `mycity_stg` and `mycity_prod`, separate roles, no
  cross-grants. Staging gets realistic demonstration data from `scripts/db/seed.js --staging`.
  Production is never seeded. The code reads everything from the database; nothing a screen shows
  is hard-coded, so the same build shows seeded data on staging and real data on production.

---

## 7 · Scripts

| Script | When |
|---|---|
| `scripts/db/create-admin.js` | Once per environment, to make the first administrator: a full employee, login and role in one transaction (BACKEND_STRUCTURE §17). Interactive only. `--sample` on staging and local fills the employee with a sample profile and asks only for email, role and password; `--build-account` creates the implementation team's complete record and asks only for the email and password; `--env=<name>` confirms the environment on the command line |
| `scripts/db/seed.js --build` / `--staging` | Synthetic or demonstration data. Refuses on production (three checks) |
| `scripts/db/migrate.js` | Locally. On servers, migrations run only inside `deploy-gate` |
| `scripts/import/run.js` | First staff load on staging, through the import engine, as a named person: `upload employees staff.xlsx --as=<email>`, then `preview`, `errors`, `commit` (type the environment name, or `--yes`), `revert`. The file header has every command |
| `scripts/check/*.js` | The gates. `npm run ci` runs them all |

A script that writes data goes through services like any other caller.

---

## 8 · Branches, pull requests and CI

### 8.1 Nobody pushes to `main`

`main` is protected. `git push origin main` is refused for everyone, the repository owner
included. Every change, however small, goes: **branch → push the branch → pull request → CI green
→ approval → merge.** Merging to `main` deploys to staging, so `main` only ever holds work that
passed CI and a second pair of eyes.

### 8.2 Opening a branch and a pull request

You do not fork. Every collaborator pushes branches to the same repository.

```
git checkout main
git pull                                   # start from the latest main
git checkout -b m1/attendance-clock-in     # m<milestone>/<short-name>
```

Work and commit as often as you like:

```
git add .
git commit -m "feat(attendance): clock-in with geofence check"
```

Push the branch and open the pull request:

```
git push -u origin m1/attendance-clock-in
gh pr create --base main --title "feat(attendance): clock-in with geofence check"
```

or open it from the **Compare & pull request** button GitHub shows after the push. The PR
description is pre-filled from `.github/pull_request_template.md`; fill it in.

- **Branch names**: `m<milestone>/<short-name>`, e.g. `m3/query-rules`, `m0/numbering`.
- **PR titles**: Conventional Commits, `type(module): what it does`. Types: `feat`, `fix`,
  `refactor`, `test`, `docs`, `chore`.
- **One feature per PR.** Small PRs get reviewed the same day; a week of work in one PR does not.

**From VS Code instead of the terminal:** click the branch name at the bottom left → *Create new
branch* → name it. Commit in the Source Control panel, then *Publish Branch*. VS Code then offers
*Create Pull Request*.

### 8.3 Keeping the branch up to date

`main` moves while your PR is open, and the branch must be up to date before it can merge:

```
git checkout m1/attendance-clock-in
git fetch origin
git rebase origin/main          # replay your commits on top of the latest main
git push --force-with-lease     # needed after a rebase; only ever on your own branch
```

If the rebase stops on a conflict, fix the files, `git add` them, `git rebase --continue`.
`git merge origin/main` also works if you prefer it; then a plain `git push` is enough.

### 8.4 What CI checks, and why your PR will fail

CI runs `npm run ci` on every push to a PR. **Run it yourself before pushing**; it is the same
command and the same result. A PR cannot merge until it is green. These are the usual reasons it is
red:

| CI says | Why | Fix |
|---|---|---|
| **Lint** | ESLint error or warning; the limit is zero | Fix it. `npm run lint` lists them |
| **Tests** | A test fails, anywhere in the suite | Fix the code or the test. Never delete a test to go green |
| **Every list pages at 25** | A repo wrote `LIMIT`/`OFFSET`, or a page-size key appeared in the contract or frontend | Use `pageQuery()` (§3.5) |
| **PROGRESS.md updated** | You changed product code (`src/`, `packages/contract/schemas/`, `migrations/`, `seeds/`, `templates/`, `app/`, `public-app/`) and `docs/PROGRESS.md` got no dated note, or the file is malformed | Tick the screens, set Status and Updated, add `- dd/mm/yyyy · XX · what was done, what is left` under the module |
| **Feature guides** | You changed code a guide in `docs/guides/` covers and the guide got no Change log line | Update the guide to match what you built, add the line |
| **README map** | You added a file outside the places the map already covers | Add it to the right section of `README.MD`, or put it where an existing file of that kind lives |
| **CODEOWNERS** | A new module or guide has no owner line, or a username is wrong | Add `/src/modules/<m>/ @owner @backup` (or the guide's path) to `.github/CODEOWNERS` |

**When a process check genuinely does not apply** (a refactor that moves no screen, a test-only
change), say so with a reason in the PR description, one line each:

```
Progress-unchanged: renamed a private helper, no screen affected
Guide-unchanged: tests only, behaviour as the guide describes
```

A line with no reason does not count. Editing the PR description re-runs CI.

`npm run ci` also lists gates as **NOT BUILT**. Those are rules whose check is not written yet
(money, dates, migrations and others during M0). They do not fail your PR today, but the rules
still apply, and review will hold you to them.

If you use Claude Code, the same progress, guide and README-map checks run before it finishes a
task (`.claude/hooks/stop-check.js`), so most of these are caught before you push.

### 8.5 Review and merge

- One approval, **not yours**, and from a code owner of every path you touched
  (`.github/CODEOWNERS`): change attendance and LA or her backup must approve.
- A new push after approval dismisses the approval; ask again.
- Resolve every review conversation.
- When CI is green and the PR is approved, the author merges, with **Squash and merge**.
- Afterwards:

  ```
  git checkout main
  git pull
  git branch -d m1/attendance-clock-in
  ```

## 9 · Done means

- [ ] Contract schemas in `packages/contract`, `gen:contract` run, no hand edit of the generated file
- [ ] Every route has a contract, a permission and (for writes) a body
- [ ] Every list pages at 25 through `pageQuery`
- [ ] Writes go through the service, in a transaction, with `emit()`
- [ ] Follow-on work is an outbox handler, not in the request
- [ ] `.ai.js` and `.search.js` present (or a written `none` with the reason)
- [ ] Unit tests beside the code; integration tests for every endpoint
- [ ] `npm run ci` green, the whole suite, before pushing
- [ ] Pushed as a branch, PR opened with the template filled in; CI green on the PR
- [ ] `docs/PROGRESS.md` row ticked and a note left
- [ ] The feature guide in `docs/guides/` matches what was built

Engineered by JBS Praxis.

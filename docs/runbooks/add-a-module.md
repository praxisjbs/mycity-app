# Runbook · Add a module

A new backend module, from an empty folder to merged. Use this only when the work is not a feature
of a module that already exists: that is a `<module>.<topic>.js` file in the existing module
(README §11). Most modules on the README map already have their folder; this runbook is also the
order to fill one in.

How to write the code inside each file is in `docs/BACKEND_GUIDE.md` §3. This page is the checklist
around it.

---

## 1 · Before any code

1. **The guide.** Copy `docs/guides/_TEMPLATE.md` to `docs/guides/<module>.md`, fill the header
   table and every section, and add its row to `docs/guides/README.md`. The guide is agreed before
   the code is written (BACKEND_GUIDE §8).
2. **The permission key.** Decide which of the 15 keys in `src/shared/access/access.catalog.js`
   guards it (README §5.2). A new key is a new tick box on the Roles screen: agree it with GE and TB
   first, add it to the catalogue and to the §5.2 table.
3. **The milestone block** for its migration (README §6.3: M1 is 1000 to 1999, and so on).

## 2 · The files

```
src/modules/<name>/
  <name>.routes.js          { basePath, surface: "staff", router }; every route via http/route.js
  <name>.public.routes.js   only if it has public routes; never imports auth
  <name>.controller.js      req/res only
  <name>.service.js         rules, transaction, emit(), numbering
  <name>.repo.js            parameterised SQL, honours req.scope
  <name>.events.js          the event keys it emits and the outbox handlers it registers
  <name>.ai.js              the AI read manifest, or `// ai:none <reason>` in the controller
  <name>.search.js          the ⌘K provider, or `// search:none <reason>` in the controller
  <name>.test.js            unit tests beside the code
packages/contract/schemas/<name>.js
migrations/NNNN_<name>.sql
```

The name is the folder name, snake_case, and every file starts with it. The loader
(`src/http/module-loader.js`) finds the module by these names alone: `<name>.routes.js` is mounted on
`/api/v1<basePath>`, `<name>.public.routes.js` on `/api/public/v1<basePath>`. There is no list to
register it in. A module that fails to load is skipped and shows under `modules` in
`/api/health/ready` instead of taking the API down.

In this order:

1. **Contract schema** (`packages/contract/schemas/<name>.js`): every request and response shape,
   snake_case. Then `npm run gen:contract`; never edit the generated file.
2. **Migration**, next free number in the block: `-- UP` and `-- DOWN`, idempotent, `created_at`
   and `updated_at timestamptz`, money `numeric(18,2)`, ids `uuid`. Add the numbering schemes and
   workflow definitions the module needs in the same file.
3. **Repo, service, controller, routes.** Each route names its permission key and action as a
   string literal (`requirePermission("people", "view")`), its schema, and pages at 25.
4. **Events** in `.events.js`, emitted from the service inside the transaction.
5. **`.ai.js` and `.search.js`**, or the `none` markers with a reason.
6. **Tests** beside the code (BACKEND_GUIDE §3.7).

## 3 · Around the code

| What | Where |
|---|---|
| Owners | a line for `/src/modules/<name>/` and one for `/docs/guides/<name>.md` in `.github/CODEOWNERS`, with `@swizfcodes @tomblakeasaah196` |
| The map | the module in README §5 under its milestone; any new top-level file on the README map |
| Settings | a new setting in the `.env` schema, then `npm run gen:env` |
| Progress | its rows in `docs/PROGRESS.md` and a dated note (dd/mm/yyyy · initials) |

## 4 · What CI checks

`npm run ci` runs the same gates as GitHub. The ones a new module meets first:

| Gate | Fails when |
|---|---|
| Write routes validated, route contracts | a route was not defined through `route()` / `publicRoute()`, or a write has no schema |
| Contract is generated and current | the schema changed without `gen:contract` |
| Module catalogue | a route names a key or action not in the catalogue |
| Migration numbering, reversibility, idempotency | a number outside the block or reused, no `-- DOWN`, not safe to run twice |
| AI manifest, Search coverage | no `.ai.js` / `.search.js` and no `none` marker with a reason |
| Public routes import no auth | a `.public.routes.js` reaches the staff auth |
| Every list pages at 25, Money, Day-first dates, No dashes | the house rules in README §7 |
| Feature guides | the code changed and the guide did not (or no `Guide-unchanged: <reason>` in the PR) |
| CODEOWNERS, README map, PROGRESS | the lines in §3 above are missing |

## 5 · The PR

From a branch off `main`, with the PR template filled. Both owners are requested by CODEOWNERS; one
approval merges. After merge the release pipeline takes it to staging (`docs/runbooks/deploy.md`).

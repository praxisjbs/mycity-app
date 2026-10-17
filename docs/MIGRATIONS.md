# MyCity App ERP · Migration Conventions

The rules every schema migration and reference seed obeys. They are binding for anyone adding a file
to `migrations/` or `seeds/reference/`, person or AI assistant. BACKEND_GUIDE §6 and README §6.3
summarise them and point here; where they seem to differ, this file is the detail and MILESTONES
(A5, A26) is the authority.

Each rule says what to do, why, and what enforces it. **Gate** means CI fails the PR. **Review**
means only a reviewer will catch it, so the author checks it before asking.

Most rules below exist because breaking them already cost us: the October 2026 audit of the first
schema found an `emit()` that could not write, notifications that never arrived, uploads and imports
that failed, and a rollback that could not run, all in files every gate passed. §7 and §12 are the
rules that would have caught them.

---

## 1 · Before you write a migration

1. **Find the code that will read and write the table.** The migration serves the code, not the
   other way round. Read the module's feature guide (`docs/guides/<module>.md`, its schema section),
   the contract (`packages/contract/schemas/<module>.js`) and, for shared tables, BACKEND_STRUCTURE
   §11.1, which lists the columns the shared layer reads and writes.
2. **Contract first** (CLAUDE.md Step 2). Change the Zod schema, then the migration, then the code.
   A contract key is the column name: `staff_number` in the contract means a `staff_number` column.
   Gate 6 (`check/contract-columns.js`) holds the two together through each contract file's `TABLES`.
3. **Your milestone only.** You write tables for the milestone your branch is named after
   (`m<N>/<short-name>`). A table another milestone owns is changed by its owner, or with the
   owner's review on your PR (README §12 names the owners). Never write a later milestone's schema
   ahead of time: it freezes the moment it merges (§3), before the people who will use it have
   designed against it (A14).
4. **Read MILESTONES for the entity's rules.** Scope decisions are data rules: Saturday is a working
   day (A22), a signature carries two hashes (A12), goals cascade CEO to task (A16, A24). A column
   that contradicts a decision is a defect, however clean the SQL.

## 2 · The file

| Rule | Example | Enforced by |
|---|---|---|
| Name `NNNN_lower_snake.sql`: four digits through M9, five from M10 | `1010_attendance_punch.sql` | Gate 3 |
| The number is in your milestone's block (table below) | M1 is 1000 to 1999 | Gate 3, on an `m<N>/` branch |
| A number is used once across `migrations/` and `seeds/reference/` together | | Gate 3 |
| Schema in `migrations/`; reference data in `seeds/reference/`, named `NNNN_seed_<name>.sql` | `1099_seed_attendance.sql` | Gate 3 |
| First line: a comment saying what the file does | `-- M1 punches and the daily attendance record.` | Review |
| Then `-- UP`, then `-- DOWN`, each on a line of its own, in that order | | Gate 4, `migrate.js` |
| One concern per file: a module's tables, or one change to them | | Review |
| Leave gaps between numbers (1000, 1010, 1020) so a fix can sit next to what it fixes | | Review |

| Milestone | Block | Milestone | Block |
|---|---|---|---|
| M0 | 0001 to 0999 | M6 | 6000 to 6999 |
| M1 | 1000 to 1999 | M7 | 7000 to 7999 |
| M2 | 2000 to 2999 | M8 | 8000 to 8999 |
| M3 | 3000 to 3999 | M9 | 9000 to 9999 |
| M4 | 4000 to 4999 | M10 | 10000 to 10999 |
| M5 | 5000 to 5999 | M11 | 11000 to 11999 |

Within a block, schema files take the low numbers and the milestone's reference seed takes
`N099` (`1099`, `2099`), so the seed runs after the tables it fills.

## 3 · Order, the ledger and never editing

- `scripts/db/migrate.js` applies files in **numeric** order, both folders interleaved, one
  transaction per file with its ledger row in `schema_migration` (name, sha256, applied_at).
- **A merged file is never edited, renamed or deleted.** The ledger keys on the name and records
  the hash; `migrate.js` refuses a changed file on any database that has applied it, and gate 5
  fails the PR. A mistake in a merged file is fixed by a **new** file in the same block.
- **Never sort migration names as text.** `10000_` sorts before `1000_` as a string. Anything that
  orders the ledger (health checks, scripts, reports) sorts by the leading number, as
  `migrate.js byNumber()` does.
- A file numbered below the current head still applies, with a warning. That is normal when
  milestones run in parallel; it is why §1.3 forbids writing ahead into a later block.

## 4 · UP is idempotent

Every UP must finish correctly on a database where it already ran, ran half way, or was restored
from a dump. Gate 5 enforces these outside a `DO $$ ... $$` body:

| Statement | Write it as |
|---|---|
| `CREATE TABLE / INDEX / SCHEMA / EXTENSION` | `... IF NOT EXISTS` |
| `ADD COLUMN` | `ADD COLUMN IF NOT EXISTS` |
| `DROP <anything>` | `DROP ... IF EXISTS` |
| `CREATE FUNCTION / PROCEDURE / VIEW / TRIGGER` | `CREATE OR REPLACE ...` |
| `ADD CONSTRAINT`, `CREATE TYPE` | inside a `DO $$` block that checks `pg_constraint` / `pg_type` first |
| `INSERT INTO` | with `ON CONFLICT` in the same statement |
| `CREATE INDEX CONCURRENTLY` | not allowed: every file runs inside a transaction |

Prefer `text` with a `CHECK` over `CREATE TYPE ... AS ENUM`: a check is replaced in one idempotent
step, an enum value can never be removed.

## 5 · DOWN undoes exactly what UP did

- DOWN drops, in reverse dependency order, **everything its UP created**: tables, views, functions,
  triggers, indexes, types, columns, constraints. Nothing more, nothing less. Gate 4 checks the
  names statically; with `RUN_DB_TESTS=1` it runs UP, DOWN and UP on a throwaway database and
  compares the catalogue.
- **DOWN never touches `schema_migration`.** The runner deletes the file's ledger row in the same
  transaction as its DOWN; a DOWN that drops or edits the ledger makes the rollback fail. The ledger
  belongs to `migrate.js`.
- **DOWN never loops over "every table that has X".** It removes what its own UP added, by name.
- A change that cannot be undone says so instead: `-- IRREVERSIBLE: <what cannot be rebuilt, and
  why>`. `migrate.js --down` refuses the file; the way back is the pre-deploy dump.
- A seed's DOWN deletes only the rows **its UP inserted**, by their natural key, and never rows an
  `ON CONFLICT DO UPDATE` may have taken over from someone else. Never delete a parent row whose
  `ON DELETE CASCADE` reaches data people entered (roles cascade to `user_role` and `permission`).

## 6 · The shape of a table

| Rule | Why | Enforced by |
|---|---|---|
| Name: singular `snake_case` noun (`leave_request`); PK `<table>_id uuid PRIMARY KEY DEFAULT gen_random_uuid()` | One convention for repos, the AI manifests and search | Review |
| `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()` on every mutable table | Lists sort and audit on them | Review |
| **The file that creates a table with `updated_at` also creates its trigger, named after the table:** `CREATE OR REPLACE TRIGGER <table>_set_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();` | 9095 only covered the tables that existed when it ran, and its DOWN drops every trigger called plain `set_updated_at`, so a table's own trigger must not use that name | Gate 4 round trip |
| Append-only tables (`audit_ledger`, ledgers) have no `updated_at` and carry the `prevent_ledger_mutation()` trigger | They are never updated | Review |
| Money `numeric(18,2)`, read and written as strings through `shared/money`. Never `numeric` without a scale, `float` or `money` | Unscaled numeric returns `"1"`, not `"1.00"` | Gate 20 (code), review (SQL) |
| Quantities and scores: `numeric(p,s)` with the scale the contract uses | | Review |
| Instants `timestamptz`; business days (start date, date of birth, leave day) `date`; never `timestamp` without a zone | Africa/Lagos, day-first for people | Review |
| Emails and codes people type: `citext`. Compare citext with citext, never cast it to `text[]` | A cast to text makes the match case-sensitive again | Review |
| A record's human number (`EXP-2026-0004`) is `number citext NOT NULL UNIQUE`, or the name the contract gives it (`employee.staff_number`), filled by `numbering.allocate()`; never `serial` or a sequence | One numbering system | Review, §9 |
| A file is a `document_id uuid REFERENCES document(document_id)`; never a path, URL or blob column | The vault owns files | Review |
| Every foreign key says `ON DELETE` (`RESTRICT` by default, `CASCADE` only for rows that are part of their parent, `SET NULL` for optional links) | Deleting a person must never silently delete their history | Review |
| **Every foreign key column has an index**, and so does every column a list allow-lists for sort or filter (BACKEND_GUIDE §3.5) | Scope and lists join on them; 205 of 254 had none in the first schema | Review |
| A status or type column has a `CHECK (col IN (...))` with **exactly** the contract's enum values, same spelling | One spelling everywhere (`on_site`, not `onsite`) | Review |
| Effective-dated rows (`effective_from`, `effective_to`, `expires_at`) are only added together with the code that filters on them | A column nobody reads grants access that should have expired | Review |
| A field that is required, filtered, sorted, masked or reported on is a column, not a key inside a `jsonb` blob. `jsonb` is for genuinely open-ended extras | Field masking, CHECKs and indexes work on columns | Review |
| Restricted personal data (bank details, salary, date of birth, next of kin) is a column, masked through `shared/rbac/field-mask.js` under its mask key (`employee.bank`, `employee.salary`, `employee.personal`) | The staff importer (BACKEND_STRUCTURE §9.4) and the API mask by field | Review |
| `bigint` only where `integer` can overflow. node-pg returns `bigint` as a **string**; the code must `Number()` it | | Review |
| `vector` columns state their dimension (`vector(768)`) matching the embedding model configured in `services/ai`, with the index in the same file | No dimension, no ANN index | Review |

## 7 · Match the code that writes the table

These rules are the ones the first schema broke. Every one of them failed at runtime, not in CI.

1. **`NOT NULL` without a `DEFAULT` only when every writer always supplies the value.** Before
   adding one, grep every `INSERT INTO <table>` and every service that writes it. If any writer can
   send `NULL` (an optional title, a run refused before a vendor is chosen, an event with no diff),
   the column is nullable or has a default the writer actually reaches.
2. **An explicit `NULL` does not use the default.** `INSERT ... VALUES (NULL)` into a column with
   `NOT NULL DEFAULT '{}'` fails. If the code passes a parameter that can be null, the column must
   accept null, or the code must `COALESCE` it. Decide which in the same PR.
3. **Indexes and offsets mean what the code means.** If the code stores a 0-based row index,
   `CHECK (x > 0)` and `DEFAULT 1` are wrong. Read the code, do not guess.
4. **Defaults match the code's defaults.** A `DEFAULT false` on a feature switch the code treats as
   on when absent turns the feature off the first time anyone saves a single setting.
5. **Every `ON CONFLICT (...)` target in the code has a matching unique index or constraint**, with
   the same `WHERE` for a partial one.
6. **Code lists in the database equal code lists in the code**: CHECK values, `reference_value`
   codes, notification categories, role codes, numbering doc types and workflow keys are spelled
   exactly as the contract and `src/` spell them.
7. **Prove it by running the code against the migration** (§12): the integration suite runs the
   real migrations, never a hand-written fixture, in CI on every PR.

## 8 · Changing what already exists

- **Additive first.** Add the new column or table, ship the code that writes both, then the code
  that reads the new one, then remove the old in a later release (expand, then contract).
- **Destructive steps** (`DROP TABLE/COLUMN`, `TRUNCATE`, `DELETE FROM`, `RENAME`, `ALTER COLUMN
  ... TYPE`, `SET NOT NULL`) carry `-- DESTRUCTIVE: <what is lost, and why that is acceptable>` on
  the line, the line above or in the header, and ship **one release after** the code that stops
  using what they remove. Gate 4.
- `SET NOT NULL` on a table with rows needs a backfill `UPDATE` in the same file, before it.
- A column rename is an add, a copy and a later drop, never `RENAME COLUMN` under running code.
- Relaxing a constraint (`DROP NOT NULL`, widening a CHECK) is not destructive and needs no marker.

## 9 · Reference seeds (A26)

`seeds/reference/` is applied by `migrate.js` in **every** environment, production included. A5
says production holds no seeded data, so A26 limits what a reference seed may contain to what the
**code** cannot run without:

| Allowed | Not allowed |
|---|---|
| System roles and their `permission` rows | People, employees, users, emails, phone numbers, bank details |
| Numbering schemes for the doc types in `shared/numbering/schemes.js` | Business choices MyCity makes: expense categories, partner types and stages, attendance policies, alert thresholds, leave entitlements, knowledge categories |
| Workflow definitions that pass `validateDefinition()` and are in `definitions.js DEFAULTS` | Demo or example rows, anything a screen shows as if it were data |
| Code lists the code switches on (statuses, the contract's enums) | Anything "so the screen isn't empty" |
| Public holidays set by law (Nigeria's, `0448`), those the government names late marked `expected` | Holidays MyCity gives on its own account |
| Template defaults the generator needs to render | Secrets, keys, URLs of external services |

Business choices are entered by MyCity on the screen that owns them, or loaded through the import
engine, on staging and production alike. Demonstration data belongs in `seeds/staging/` (JavaScript,
through services, never on production; `scripts/db/seed.js` refuses there).

**The one thing production is loaded with** is MyCity's own staff list, and it is not a reference
seed: `seeds/staff/staff-list.xlsx` and `roles.json` go through the staff importer, as the system,
on every deploy to staging and to production (`scripts/db/load-staff.js`, run by
`scripts/deploy/deploy-gate` after the migrations). A26 still holds here: `seeds/reference/` carries
no people, and nothing about a person is in SQL. The loader is idempotent, it sends no email, a row
it cannot write is reported in the deploy log and in Imports history, and an edit made in the app is
never written over (TB, 16/10/2026; `docs/guides/foundation.md` §6.1).

Rules for every reference seed:

- `INSERT ... ON CONFLICT (<natural key>) DO UPDATE` (or `DO NOTHING`), so it re-runs cleanly
  (gate 5).
- A numbering scheme seeded is a doc type `schemes.js` knows, and every table with `number NOT NULL`
  has one; otherwise `allocate()` throws.
- A workflow definition seeded is checked by running `validateDefinition()` on it before the PR.
- Roles come with their `permission` rows. A role with no grants locks out everyone except the CEO.
- A row a person will later edit on a screen (a numbering scheme, the working week) is seeded with
  `DO NOTHING`, or with `DO UPDATE ... WHERE` the row still holds the old seeded value. A file runs
  once per database, but it runs again after a failed attempt or on a rebuilt database, and a bare
  `DO UPDATE` would then overwrite the person's edit.

## 10 · Extensions and privileges

- Migrations run as the environment's application role, never a superuser (SYSTEM_ARCHITECTURE §5).
- `CREATE EXTENSION IF NOT EXISTS` is fine for trusted extensions (`pgcrypto`, `citext`, `pg_trgm`,
  `unaccent`, `btree_gin`, `btree_gist`). An untrusted one (`vector`) is created by
  `ops/provision/provision.sh` as the superuser; the migration's statement then finds it. A new
  untrusted extension is added to provisioning in the same PR.
- An `IMMUTABLE` function used in an index calls schema-qualified, fixed-argument forms
  (`unaccent('unaccent', ...)`), so a restore with an empty `search_path` rebuilds the index.

## 11 · Things a migration never does

- Write the `system_marker` row: it is written once, when the database is created (provisioning on
  servers, by hand locally), and says which environment the database is.
- Create or grant roles, change passwords or ownership: provisioning does that.
- Seed people, or anything §9 forbids.
- Depend on the data in a database (`IF EXISTS (SELECT ... FROM employee)`): the same file must
  produce the same schema on an empty database and a full one.
- Touch `schema_migration`.

## 12 · Before you open the PR

Run all of these and paste the result in the PR's Notes:

```
node scripts/check/migration-numbers.js        # gate 3
node scripts/check/migration-reversibility.js  # gate 4, static
node scripts/check/migration-idempotency.js    # gate 5
node scripts/check/schema-drift.js             # gate 6: the code names only tables and columns that exist
node scripts/check/contract-columns.js         # gate 6: contract keys are column names
RUN_DB_TESTS=1 DATABASE_URL=postgres://...mycity_test node scripts/check/migration-reversibility.js
                                               # gate 4 for real: UP, every DOWN, UP again
RUN_DB_TESTS=1 DATABASE_URL=... npx jest tests/integration
                                               # the shared layer and your module against the real schema
npm run ci                                     # the whole suite
```

CI runs both `RUN_DB_TESTS` lines on every PR, against PostgreSQL 16 with pgvector and Redis
(`.github/workflows/ci.yml`). Run them locally first: a red CI run costs everyone a cycle. The
integration suite builds its schema from the real migrations (`tests/integration/helpers/schema.js`);
a test that inserts rows by hand fills every column the schema requires, and never relaxes one.

Then check by hand:

- [ ] The branch is `m<N>/<short-name>` and every new file is in M<N>'s block.
- [ ] Every new table has its `updated_at` trigger, its FK indexes and `ON DELETE` on each FK.
- [ ] Every `NOT NULL` without a default is supplied by every writer (§7.1); grep shown in the PR.
- [ ] CHECK values equal the contract's enums; contract keys equal column names.
- [ ] DOWN drops exactly what UP made and does not touch `schema_migration`.
- [ ] Seeds contain only what §9 allows; schemes are in `schemes.js`; definitions validate.
- [ ] `docs/DATABASE_SCHEMA.md` and the module's guide describe the tables as built.
- [ ] `docs/PROGRESS.md` has a dated note under the milestone the tables belong to.
- [ ] The PR body is filled in. A migration PR is reviewed by the owner of the milestone it
      touches and by GE (schema), and is not merged the hour it is opened.

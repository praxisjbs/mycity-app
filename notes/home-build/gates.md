# Home build: every CI gate and process rule a Home PR must pass

Repo: `/home/user/mycity-app` (all paths below are relative to it). Baseline on `main` at
d65c717, 17/10/2026: `node scripts/ci-local.js --only=<the 30 static gates>` is **all green, 0 NOT
BUILT** (every one of the 43 gates in `ci-local.js` is built; `--list` says "ready" for all).
So any red you see is yours.

---

## 0 · The ten things most likely to turn a Home PR red

1. **Guide coverage does not match where the code lives.** `docs/guides/home.md` header says
   `Backend modules | \`home\``, but the repo maps Home to `dashboard`, `alerts`, `reports`
   (README §5.2, §5.4; CODEOWNERS; empty stubs in `src/modules/{dashboard,alerts,reports}/`;
   empty `packages/contract/schemas/{dashboard,alerts,reports}.js`; route-map markers name
   `src/modules/alerts` and `src/modules/reports`). `guides.js` only treats
   `src/modules/<m>/` and `packages/contract/schemas/<m>.js` for the modules in backticks as
   covered. Decide the folder(s) in PR 1 and make the header list exactly those (§10 below).
2. **Search markers go stale the moment alerts/reports are built.** `src/shared/route-map.js:122-124`:
   `home_alert: screen("home", "alerts"), // search:none not built yet (src/modules/alerts)` (and
   `home_report`, `home_report_run` → `src/modules/reports`). When `alerts.controller.js` AND
   `alerts.repo.js` get content, gate 10 fails ("src/modules/alerts is built now; give it a
   provider, or a real reason"). When a provider declares the type, the marker must be deleted
   ("a provider declares it, so remove its search:none").
3. **`requireCapability` alone is not a permission check.** `http/route.js` refuses a staff
   route whose handlers carry no `.permission` (only `requirePermission`/`requireAnyPermission`
   set it). Always `requirePermission("home", "view"), requireCapability("home.team"), ctrl`.
4. **Editing a merged migration or seed.** Decision 7 (move the alert thresholds out of
   `seeds/reference/1099_seed_core_operations.sql`) must be a NEW file; touching 1099 fails gate 5.
   The new file's `DELETE FROM` in UP needs `-- DESTRUCTIVE: <reason>` (gate 4).
5. **Pinned job lists.** `tests/unit/foundation/worker-jobs.test.js:33-58` pins `registry.JOBS`
   and `registry.SCHEDULERS` exactly. Adding `scheduled-report`, `scheduled-reports` or any alert
   sweep scheduler fails gate 2 until those arrays are updated.
6. **Provenance words in code.** Any of `pixie`, `praxis-ls`, `donor`, `ported from`, `port of`,
   or bare `praxis` (anything but "Praxis AI"/"praxis_ai"/"JBS Praxis") in src/, tests/,
   migrations/, seeds/, app/, packages/ … fails. Porting the KPI catalogue: strip origin comments.
7. **`LIMIT n` / `OFFSET` in backend SQL** (top-5 activity, "latest 3 runs"), or `limit:` keys
   in contract/AI manifests, or `pageSize` anywhere in app/. Only `LIMIT 1` passes.
8. **AI manifest keys that look like writes.** Gate 19's static regex refuses ANY object key
   `action:`/`actions:`/`write(s):`/`creates:`/`updates:`/`deletes:`… in a `*.ai.js`, including
   route params. BACKEND_GUIDE §3.6 shows `params: { action: "new" }`: that FAILS. Use
   `params: { new: "1" }` as the real manifests do.
9. **contract-columns.** Every exported object schema in `packages/contract/schemas/<m>.js` needs
   a `TABLES` entry; every key must be a column (as the migrations build it) or declared
   `virtual` with a reason. The guide's §4 columns (`home_report.id/source/filters/…`,
   `home_alert_rule.scope/created_by`) do not exist in migration 1000.
10. **Process gates.** Product code changed ⇒ `docs/PROGRESS.md` gains a dated note; covered code
    changed ⇒ the covering guide gains a Change log line; a new file off-pattern ⇒ README map entry;
    a new module folder or guide ⇒ CODEOWNERS line. The Stop hook enforces the first three before
    Claude may finish.

---

## 1 · How CI runs

### 1.1 `.github/workflows/ci.yml`
One job `ci` on `pull_request` to main (types `opened, synchronize, reopened, edited`: editing the
PR description re-runs it so a trailer fix counts), `push` to main and `workflow_dispatch`.
Services: `pgvector/pgvector:pg16` (user/pass `mycity`, db `mycity_test`) and `redis:7`. Steps:
checkout with `fetch-depth: 0`, Node from `.nvmrc` (20), `npm ci`, `npx playwright install
--with-deps chromium`, `apt-get install ffmpeg`, then **one step**:

```yaml
run: npm run ci
env:
  CI_STRICT: "1"            # an empty gate script = failure
  RUN_DB_TESTS: "1"         # integration suite + gate 4 live round trip
  APP_ENV: test
  DATABASE_URL: postgres://mycity:mycity@127.0.0.1:5432/mycity_test
  REDIS_URL: redis://127.0.0.1:6379/15
  GH_TOKEN: ${{ github.token }}
```
`timeout-minutes: 30`. `permissions: pull-requests: read` (the process gates read the merged PR's
body on a push to main).

### 1.2 `scripts/ci-local.js` (`npm run ci`)
Runs every gate in order, does not stop at the first failure (unless `--fast`), prints all
failures then a summary. Flags: `--fast`, `--strict` (or `CI_STRICT=1`), `--list`,
`--only=id1,id2`. An empty gate script = NOT BUILT (fails under strict). Gate ids, in order:

```
lint test migration-numbers migration-reversibility migration-idempotency schema-drift
contract-columns route-contracts five-second ai-manifest-coverage search-coverage two-shells
forms palette contrast date-format native-dialogs dashes upload ai-no-writes money
contract env-template module-catalogue public-surface numbering-schemes
production-environment-refs ai-vendor-imports shell pagination provenance
components-catalogue components fe-typecheck fe-lint fe-test fe-build mock-free a11y
progress guides readme-map codeowners
```
`lint` = `eslint --max-warnings 0 .` (backend; app/, public-app/, packages/ui/, templates/,
docs/ ignored; rules: `no-unused-vars` with `^_` args, `prefer-const`, `no-var`, `eqeqeq`,
`no-shadow`). `test` = `jest --ci` (whole suite; integration only with `RUN_DB_TESTS=1`; empty
`*.test.js` files are skipped by name). `contract` = `scripts/gen/contract.js --check`;
`components-catalogue` = `scripts/gen/components.js --check`; `fe-*` = `npm run fe:<x>` over
`@mycity/ui`, `@mycity/app`, `@mycity/public-app`.

Fast loop while working (all static, seconds):
```
node scripts/ci-local.js --only=migration-numbers,migration-reversibility,migration-idempotency,schema-drift,contract-columns,route-contracts,contract,module-catalogue,pagination,provenance,money,date-format,dashes,ai-manifest-coverage,search-coverage,ai-no-writes,numbering-schemes,progress,guides,readme-map,codeowners
```

### 1.3 What "the change" is (`scripts/check/lib/changes.js`)
Used by progress, guides, readme-map, migration-numbers (branch block), migration-idempotency
(merged-file edits) and the Stop hook. Base, first match wins: `MYCITY_BASE` env; on a PR,
`merge-base HEAD origin/<base>`; on a push, `event.before`; locally `merge-base HEAD origin/main`
(or `main`). **Locally, uncommitted and untracked (non-ignored) files count too**; in CI only
commits. So a scratch file left untracked inside the repo is "added" and readme-map will flag it:
keep scratch in the scratchpad.

**Trailers** (exemptions), one per line, anywhere in the PR description, any commit message of
the change, or locally `MYCITY_PR_BODY`:
```
Progress-unchanged: <reason>
Guide-unchanged: <reason>
```
Regex: `^\s*Progress-unchanged:[ \t]*(\S.*)$` (case-insensitive, multiline). A trailer with no
reason does not count. **One `Guide-unchanged` exempts EVERY guide** in the change.

**Pitfall (verified):** `.github/pull_request_template.md` ends with an HTML comment containing
the literal lines `Progress-unchanged: <reason>` and `Guide-unchanged: <reason>`. The regex does
not skip HTML comments, so a PR body that keeps the template's comment is treated as exempt from
both "updated with the work" checks in CI. Delete those comment lines from the PR body unless you
mean them; reviewers (and the local Stop hook, which never sees the body) still hold you to it.

### 1.4 The Claude Stop hook (`.claude/hooks/stop-check.js`, registered in `.claude/settings.json`)
Before Claude ends a turn it runs `progress`, `guides`, `readme-map`; and when any changed path
matches `^(packages/ui|app|public-app)/` or `docs/MyCity-ERP-Documents/demo.html`, also
`components`, `palette`, `forms`, `dashes`, `five-second`, `two-shells` (no exemption line for
these). Failure → exit 2, Claude is sent back with the report. Loop guard: after 2 consecutive
blocks it lets Claude stop and prints the failures to the user. Locally `five-second` and
`two-shells` need Chromium (§2.4); without it they FAIL ("a crawl that cannot start fails the
gate"), so any app/ change will block twice unless Chromium is set up.

---

## 2 · Running things locally

### 2.1 Node
`.nvmrc` = 20, `package.json engines: ">=20.19 <21"`. System `node` is v22.22.0. Use
`export PATH=/opt/node20/bin:$PATH` (v20.20.0 is installed there).

### 2.2 Postgres 16 + pgvector + Redis (integration suite and gate 4 round trip)
Verified on this machine: cluster `16/main` exists (port 5432, down), pg_hba allows
`scram-sha-256` on 127.0.0.1, **pgvector is NOT installed** (`migrations/0001_extensions.sql`
runs `CREATE EXTENSION IF NOT EXISTS vector;`, so every rebuild fails without it); apt has
`postgresql-16-pgvector 0.6.0-1` after `apt-get update`. `redis-server` is at `/usr/bin`.

```
apt-get install -y postgresql-16-pgvector
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE ROLE mycity LOGIN SUPERUSER PASSWORD 'mycity'\""
su postgres -c "createdb -O mycity mycity_test"
redis-server --daemonize yes --port 6379

export PATH=/opt/node20/bin:$PATH
export RUN_DB_TESTS=1 APP_ENV=test \
  DATABASE_URL=postgres://mycity:mycity@127.0.0.1:5432/mycity_test \
  REDIS_URL=redis://127.0.0.1:6379/15

npx jest tests/integration/home        # one file while iterating
npx jest tests/integration             # the whole integration suite (maxWorkers 1)
node scripts/check/migration-reversibility.js   # + live UP, every DOWN in reverse, UP again
node scripts/db/migrate.js --status    # applied / pending / changed (also --down: local and test only)
npm run ci                             # everything, as CI (with the env above)
```
Why SUPERUSER: `vector` is an untrusted extension, and the round trip `CREATE DATABASE
mycity_revcheck_<pid>_<ts>` (needs CREATEDB) and runs 0001 inside it. CI's `POSTGRES_USER` is a
superuser too.

How the integration suite works (`tests/integration/helpers/schema.js`): `rebuild(pool, dbName)`
**refuses unless the DB name ends in `_test`**, then `DROP SCHEMA public CASCADE`, `CREATE SCHEMA
public`, `migrate.migrate(client)` (real migrations + reference seeds), then
`tests/integration/fixtures/test-tables.sql`. Files gate themselves:
```js
const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
// beforeAll: await rebuild(pool, config.DB_NAME); outbox.markReady();
//            ({ app } = buildApp({ strict: true, accessLog: false }));
```
Helpers: `sql.employee`, `sql.user`, `sql.role` in `helpers/schema.js`; `createAdmin` from
`scripts/db/create-admin`; drain the outbox with `outbox.dispatchDue({ db: pool })` after
`UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'` (see
`tests/integration/workflow.test.js:39-45`). Under `APP_ENV=test` every 2xx JSON response is
parsed with the route's declared `response` schema and a mismatch THROWS (`http/route.js
responseCheck`), so integration tests double as contract tests. PDF tests must skip without
Chromium: `const hasChromium = (() => { try { return Boolean(chromium.resolvePath()); } catch {
return false; } })();` (`tests/integration/documents-api.test.js:56`). `chromium.resolvePath()`
looks at `CHROMIUM_PATH` then `/usr/bin/chromium`, `/usr/bin/google-chrome`, … not Playwright's
cache, so in CI PDF rendering tests effectively skip.

### 2.3 Staging seed rehearsal
`npm run db:seed -- --staging` refuses unless APP_ENV is not production, the DB name is not
`mycity_prod` (and on staging is `mycity_stg`), and `system_marker` has a row that is not
production. A local test DB has no `system_marker` row unless you insert one, so this is mostly a
staging operation; test seed functions directly from a test instead.

### 2.4 Screen gates (8, 11, a11y) need Chromium
`npx playwright install chromium` is what CI does, **but the Playwright CDNs are blocked by the
proxy here (403, verified)**. `storage.googleapis.com` IS reachable (HEAD 200 on
`chrome-for-testing-public/131.0.6778.85/linux64/chrome-linux64.zip`). Workaround (not verified
to run): download a Chrome for Testing build into the scratchpad, unzip, then
`export MYCITY_CHROMIUM=<dir>/chrome-linux64/chrome` (screen gates) and
`CHROMIUM_PATH=<same>` (PDF service); system libs via `npx playwright install-deps chromium`
(apt works). Quick loops: `node scripts/check/five-second.js --screen=Home`,
`node scripts/check/two-shells.js --screen=Home`, `MYCITY_SCREEN_TARGETS=app` (gallery, demo,
app), `MYCITY_A11Y_TARGETS=app node scripts/check/a11y.js`. The app crawl uses the **mock**
build (`app/dist`, `npm run build:demo` in app/, rebuilt when older than app/src), signs in as
the mock Operations account and opens every route in `app/dist/screens.json`.

---

## 3 · Process gates (run in CI and by the Stop hook)

### 3.1 `scripts/check/progress.js`: `docs/PROGRESS.md`
**Format, every run:**
- `SCREENS = 93`: rows `#1..#93` each exactly once (header comment says 85, README says 86: stale).
- Row regex (must match exactly, including single spaces):
  ```
  /^\| (\d+) \| ([^|]+?) \| `([^`]+)` \| (M\d+) \| ([^|]+?) \| ([☐☑]) \| ([☐☑]) \| ([☐☑]) \| ([^|]+?) \|\s*([^|]*?)\s*\|$/
  ```
  Home rows today (lines 471-474):
  ```
  | 1 | Overview | `overview` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
  | 2 | Alerts | `alerts` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
  | 3 | Reports | `reports` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
  | 86 | Team | `team` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
  ```
- Status ∈ `Not started, In progress, Built, On staging, Accepted, Dropped`. `Built`/`On
  staging`/`Accepted` need API, UI and Mobile all ☑. `Not started` with any ☑ fails. Any status
  other than `Not started` needs an Updated date. `In progress` with zero ticks is allowed.
- Dates: `dd/mm/yyyy`, a real calendar day, **not after tomorrow (UTC)**.
- Notes: inside a `**Notes**` block (until `---` or a heading) every non-blank line that is not
  `_None yet._` and not indented ≥2 spaces must match
  `/^- (\d{2}\/\d{2}\/\d{4}) · ([A-Z]{2}(?: · [A-Z]{2})?) · \S/` (one or two sets of initials).
  Continuation lines: indent 2+ spaces. Newest first (convention, not checked).
- Summary counts must equal the rows. Current lines:
  ```
  | M1 Core Operations & Employee Management | 32 | 17 | 0 | 15 | 0 | 0 |
  | **Total** | **93** | **71** | **0** | **22** | **0** | **0** |
  ```
  Columns: Screens, Not started, In progress, Built, On staging, Accepted (Dropped rows excluded).
  M0 rows count as M1. Moving all four Home rows to In progress ⇒ M1 `32 | 13 | 4 | 15 | 0 | 0`,
  Total `93 | 67 | 4 | 22 | 0 | 0`; all four Built ⇒ M1 `32 | 13 | 0 | 19 | 0 | 0`, Total
  `93 | 67 | 0 | 26 | 0 | 0`. Recompute after every rebase (LA/AJ/GE move M1 rows in parallel).
- M0 table: a ☑ item needs a date.

**Updated with the work:** if the change touches `src/`, `packages/contract/schemas/`,
`migrations/`, `seeds/`, `templates/`, `app/`, `public-app/` (ignoring `.gitkeep`), then
PROGRESS.md must be in the change AND an ADDED line must match the NOTE regex, unless
`Progress-unchanged: <reason>`. Any added note line anywhere satisfies the gate; put it at the top
of `### Home` → `**Notes**`:
```
- 17/10/2026 · TB · Home foundation: contract, 1140 migration, capabilities, KPI catalogue. Left: Overview, Team, Alerts, Reports screens on the real API.
```
**Ticks have runtime effect (F14, `app/src/lib/plan.ts`):** staging opens a screen as soon as API
is ☑ (on seeded data); production opens it when API, UI and Mobile are all ☑. Tick API only when
every endpoint the screen calls exists with contract, permission and tests AND the staging seed
gives it data; UI only when the desktop screen runs on the real API (no mock data in the
component); Mobile when the phone layout is built.

### 3.2 `scripts/check/guides.js`
**Complete, every run:** every `docs/guides/*.md` (not README/_TEMPLATE) is in the index
`docs/guides/README.md` (row regex ``/^\| `([^`]+\.md)` \|.*\| ([☐☑]) \|$/``); a ☑ guide exists.
Each guide keeps the template's header rows (`Owner, Milestone, Backend modules, Frontend paths,
Permission key(s), Screens (PROGRESS.md rows), Status, Last changed`) and all 14 `## N · `
headings in order, verbatim (`## 10 · On screen and mobile`, `## 14 · Change log` …). Status ∈
`Draft, Agreed, Built, Accepted`; `Last changed` a real `dd/mm/yyyy`. §10 must contain two tables
whose header lines START with `| Screen | Open (tier 1) |` and `| Screen | First on a phone |`,
each with ≥1 row not starting `| <`. Every non-blank, non-indented line under `## 14 · Change
log` must match `/^- (\d{2}\/\d{2}\/\d{4}) · ([A-Z]{2}) · \S/` (a `###` subheading there fails).

**Followed:** covered code = for each backticked name in `Backend modules`,
`src/modules/<m>/**` and `packages/contract/schemas/<m>.js`; plus every backticked `Frontend
paths` prefix. If the change touches covered code (other than the guide itself), the guide must be
in the change with an ADDED Change log line, else `Guide-unchanged: <reason>`. `Last changed` is
not enforced but bump it.

Guides a Home PR can trip besides home.md (verified headers):

| You touch | Guide(s) that then need a Change log line |
|---|---|
| `src/modules/attendance/` (decision 4 `attendance.roster`), `app/src/features/attendance/` (decision 12: `useClockPrompt` lives in `app/src/features/attendance/ClockButton.tsx`, called from `app/src/shell/Shell.tsx:96`) | `attendance.md` (owner LA) |
| `src/modules/identity/`, `security`, `users`, `access`; `packages/contract/schemas/identity.js` (e.g. capabilities on `GET /me`, `identity.routes.js:70`); `app/src/auth/` | `identity.md` |
| `src/modules/access/`, `organisation`, `audit`, `settings`, `workflow`, `documents`, `imports`; `app/src/features/people/`, `app/src/features/settings/`, `app/src/shell/Search.tsx` | `foundation.md` (access also `identity.md`; organisation also `organogram.md`) |
| `src/modules/ess/`, `app/src/features/ess/` | `ess.md` (+ `organogram.md` for `app/src/features/ess/`) |

Not covered by any guide: `src/shared/**`, `src/jobs/**`, `app/src/api/mock/modules/home.ts`,
`app/src/api/types/home.ts`, `app/src/shell/` (except Search.tsx), `packages/ui/**`.

### 3.3 `scripts/check/readme-map.js`
Only files ADDED or RENAMED in the change. Allowed without a README edit:
```
src/modules/<m>/<m>.<anything>.js          (directly in the module folder, name starts "<m>.")
packages/contract/schemas/<m>.js            (only if src/modules/<m>/ exists, or common.js)
migrations/NNNN_name.sql   seeds/** tests/** docs/** templates/** assets/** app/** public-app/**
src/services/ai/prompts/<x>.md   packages/ui/**   .github/** (not workflows)   package-lock.json   .gitkeep
```
Anything else must be findable in `README.MD`: the full path, or the path minus `src/`, or BOTH
the file's base name (no extension) and its folder name as whole words (`[A-Za-z0-9_-]` are word
characters, so `alert-ageing` matches as one word). Home cases:
- `src/modules/dashboard/kpi-catalog/**` (subfolder) is NOT auto-allowed; README §5.4 already
  names `kpi-catalog/{index, eligibility, guards}.js`, `kpi-catalog/tiles/{people, work,
  business, finance}.js`. A new `kpi-catalog/sources/tasks.js` (decision 3) needs "sources" and
  "tasks" as words; they happen to exist elsewhere in README, but README §11 wants the file listed:
  extend the §5.4 `dashboard` row.
- New `src/jobs/schedulers/<name>.js` / `src/jobs/handlers/<name>.js`: add `<name>` to README §5.15
  (`scheduled-report` and `scheduled-reports` are already there, as empty stubs).
- New `src/shared/<x>/<y>.js`: add to README §4 tree. New `scripts/**`: README §3.
- `packages/contract/schemas/home.js` without `src/modules/home/` ⇒ must be named in README.
Deleting stubs is not checked by the gate, but README §11.5 requires taking them off the map.

### 3.4 `scripts/check/codeowners.js` (`.github/CODEOWNERS`)
Every non-comment line: ≥2 owners, each a valid `@user` or `@org/team`; every concrete path a line
names must EXIST (adding a line for a file before creating it fails; deleting a module folder or
contract stub without removing its line fails); every folder in `src/modules/` has a line
`/src/modules/<m>/`; every guide has `/docs/guides/<g>.md`. Existing Home lines:
`/src/modules/dashboard/`, `/src/modules/alerts/`, `/src/modules/reports/` and their
`/packages/contract/schemas/*.js` (TB, GE); `/docs/guides/home.md` (GE, TB). A new
`src/modules/home/` needs `/src/modules/home/  @tomblakeasaah196 @swizfcodes` (and a contract
line by convention). Usernames: GE `@swizfcodes`, TB `@tomblakeasaah196`, AJ `@Ghosted34`, LA
`@LovedataX`. GE and TB are on every line, so either approves any path (not their own PR).
`docs/PROGRESS.md` deliberately has no owner.

---

## 4 · Data gates and every rule in `docs/MIGRATIONS.md`

### 4.1 Gate 3, `scripts/check/migration-numbers.js`
- Name `^(\d{4,5})_[a-z0-9_]+\.sql$`; folders flat; no `0000`; 5 digits only ≥10000.
- `seeds/reference/` files contain `_seed_`; `migrations/` files do not.
- Number unique across BOTH folders; inside a milestone block (M1 = 1000-1999).
- On a branch named `m<N>/…` (`/^m(\d{1,2})(?:[/_-]|$)/i`), every NEW file is in M<N>'s block.
- A new file numbered below an already merged one of the same milestone is only a `note:`.
- **M1 numbers taken:** `1000_core_operations`, `1099_seed_core_operations`,
  `1100_home_alert_columns`, `1110_community`, `1120_mailbox`, `1130_announcement_cancel`.
  Pick above 1130 with gaps (e.g. `1140_home_*.sql`, seed `1149_seed_home.sql` or `1199_seed_home.sql`).
  LA (attendance) and GE work in the same block in parallel: re-run gate 3 after every rebase.

### 4.2 Gate 4, `scripts/check/migration-reversibility.js`
Static (always):
- File splits into `-- UP` then `-- DOWN`, each on its own line (`migrate.js parseMigration`).
- DOWN empty ⇒ must declare `-- IRREVERSIBLE: <reason>` (non-empty reason); `migrate.js --down`
  then refuses the file and the round trip stops there.
- Every table/view/function/trigger/sequence/schema/extension/type/**column** the UP creates must
  be NAMED somewhere in DOWN (word match). Indexes and constraints are not checked statically, but
  ARE by the live round trip.
- Destructive in UP (outside `$$` bodies): `DROP TABLE|COLUMN|SCHEMA`, `TRUNCATE`, `DELETE FROM`,
  `RENAME (COLUMN|TO)`, `ALTER COLUMN x [SET DATA] TYPE`, `SET NOT NULL` need
  `-- DESTRUCTIVE: <what is lost, and why>` on the line, the line above, or anywhere in the header
  before `-- UP`. (DOWN may use them freely.)

Live (with `RUN_DB_TESTS=1` + `DATABASE_URL`, or `--apply`; CI does this): on a throwaway DB,
UP each file in number order snapshotting the catalogue before each, then DOWN every file in
reverse comparing with the snapshot, then UP again. Snapshot covers tables, **columns**, views,
sequences, **indexes**, functions, enum/domain types, **triggers**, **constraints**, extensions,
schemas. So DOWN must remove exactly what UP added (an index on an existing table, a CHECK added in
a DO block, the `<table>_set_updated_at` trigger) and must not remove anything that existed before.
Real example of a fix-forward (`migrations/1100_home_alert_columns.sql`):
```sql
-- M1 home alerts made to accept what the shared alerts code writes (src/shared/alerts/alerts.js).
-- ...
-- DESTRUCTIVE: over_by is retyped to numeric(18,2); a value with more than two places is rounded.
-- No release has raised an alert yet.
-- UP
ALTER TABLE home_alert ALTER COLUMN trigger DROP NOT NULL;
ALTER TABLE home_alert ALTER COLUMN over_by TYPE numeric(18,2);

-- DOWN
ALTER TABLE home_alert ALTER COLUMN over_by TYPE numeric;
ALTER TABLE home_alert ALTER COLUMN trigger SET NOT NULL;
```

### 4.3 Gate 5, `scripts/check/migration-idempotency.js`
Outside a dollar-quoted body, in UP and DOWN:

| Statement | Must be |
|---|---|
| `CREATE TABLE / INDEX / SCHEMA / EXTENSION / SEQUENCE` | `IF NOT EXISTS` |
| `ADD COLUMN` | `ADD COLUMN IF NOT EXISTS` |
| `DROP <TABLE/INDEX/VIEW/TRIGGER/FUNCTION/TYPE/COLUMN/CONSTRAINT/…>` | `IF EXISTS` |
| `CREATE FUNCTION/PROCEDURE/VIEW/TRIGGER` | `CREATE OR REPLACE …` |
| `ADD CONSTRAINT`, `CREATE TYPE/DOMAIN` | inside `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '…') THEN … END IF; END $$;` |
| `INSERT INTO` | `ON CONFLICT` in the same statement (temp tables `ON COMMIT DROP` exempt) |
| `CREATE/DROP INDEX CONCURRENTLY` | never (each file runs in one transaction) |

And any `migrations/` or `seeds/reference/` `.sql` that already exists on the base and is
**modified, renamed or deleted** in the change fails (the ledger keys on name + sha256).

### 4.4 Gate 6, `scripts/check/schema-drift.js` + `scripts/check/lib/catalogue.js`
The catalogue replays the **UP** sections of `migrations/` and `seeds/reference/` in number order
(`CREATE TABLE` column lists, `ALTER TABLE … ADD/DROP/RENAME COLUMN` incl. inside DO blocks,
`RENAME TO`, `DROP TABLE`). It then scans every SQL-looking string in `src/**` and `scripts/**`
(not `*.test.js`, not `scripts/check/`; template `${…}` is blanked) and fails on: `alias.column`
that is not a column of the alias's table; an `INSERT INTO t (cols)` or `UPDATE t SET col =` naming
a missing column; any table no migration creates (or one dropped/renamed); and a table CREATEd in
two files with different column lists (so never re-`CREATE TABLE IF NOT EXISTS saved_report (…)`
to "add" columns: use `ALTER TABLE saved_report ADD COLUMN IF NOT EXISTS …`). Unqualified columns
in SELECT/WHERE are not checked (the integration suite catches them). `seeds/staging/*.js` is NOT
scanned, so a staging seed's raw SQL is checked only by running it.

### 4.5 Gate 6b, `scripts/check/contract-columns.js`
Every export of `packages/contract/schemas/<m>.js` whose name starts with a capital and is an
object schema (through effects/optional/nullable/default) needs an entry in the file's exported
`TABLES`:
```js
const TABLES = {
  ApprovalFlow: { table: "workflow_definition",
    virtual: { open_requests: "counted from workflow_instance rows still pending on the flow's key" } },
  ApprovalFlowListQuery: { table: null, reason: "list controls for the flows" },
  ApprovalFlowPage: { table: null, reason: "a page of flows" },
};
```
Fails on: a missing entry; a key that is not a column and not virtual; a virtual/nested key the
schema lacks; an empty reason; `table` that no migration creates; a TABLES name the file does not
export. `{ table: null, reason, nested: { employee: { table: "employee" } } }` checks inner rows.
What exists today (1000/1100): `home_alert_rule(home_alert_rule_id, key citext UNIQUE, metric,
threshold numeric, window_days, severity low|medium|high, permission_key, enabled, created_at,
updated_at)`; `home_alert(home_alert_id, home_alert_rule_id, subject_type, subject_id text,
title, trigger NULL, severity, over_by numeric(18,2), raised_at, last_seen_at, escalated_at,
cleared_at, cleared_by → app_user, outcome cleared|dismissed, note, created_at, updated_at)`;
`saved_report(saved_report_id, owner_user_id, name, report_key, definition jsonb, shared,
created_at, updated_at, UNIQUE(owner_user_id, name))`; `report_schedule(report_schedule_id,
saved_report_id ON DELETE CASCADE, recurrence jsonb, timezone, recipients citext[], active,
last_run_at, next_run_at, …)`. No `home_report`, `home_report_run`, `role_kpi`.

### 4.6 `docs/MIGRATIONS.md` rules a reviewer holds you to (Gate = CI, Review = people)
- §1: find the code that reads/writes the table first; **contract first**; your milestone only;
  never write a later milestone's schema; read MILESTONES for the entity's rules.
- §2: first line a comment saying what the file does (Review); one concern per file; leave gaps;
  milestone's reference seed takes `N099` (1099 is used: an extra M1 seed needs another `_seed_`
  number, precedent `0199_seed_foundation_fixes.sql`).
- §3: numeric order, both folders interleaved; never edit/rename/delete a merged file; never sort
  migration names as text.
- §4 idempotent UP (gate 5); prefer `text` + `CHECK` over `CREATE TYPE … AS ENUM`.
- §5 DOWN undoes exactly what UP did, in reverse dependency order, by name; never touches
  `schema_migration`; never loops "every table with X"; a seed's DOWN deletes only rows its UP
  inserted, by natural key, never rows an `ON CONFLICT DO UPDATE` may have taken over; never
  delete a parent whose `ON DELETE CASCADE` reaches people's data.
- §6 table shape: singular snake_case; PK `<table>_id uuid PRIMARY KEY DEFAULT
  gen_random_uuid()` (so `home_report_run_id`, not the guide's `id`); `created_at`/`updated_at
  timestamptz NOT NULL DEFAULT now()`; **the creating file also creates `CREATE OR REPLACE TRIGGER
  <table>_set_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION
  set_updated_at();`** (never named plain `set_updated_at`; 9095's DOWN drops those); money
  `numeric(18,2)`; instants `timestamptz`, days `date`; typed codes `citext`; human number
  `number citext NOT NULL UNIQUE` filled by `numbering.allocate()`; files are `document_id uuid
  REFERENCES document(document_id)`; every FK says `ON DELETE`; **every FK column and every
  sortable/filterable column has an index**; status/type `CHECK (col IN (…))` spelled exactly as
  the contract's enum; filtered/required fields are columns, not jsonb keys; `bigint` comes back as
  a string.
- §7 match the writer: `NOT NULL` without default only if every writer supplies it; explicit
  `NULL` bypasses the default; defaults equal the code's; every `ON CONFLICT (…)` target in code
  has a matching unique index (same `WHERE` for partial); code lists in DB equal code lists in
  code; prove it with the integration suite.
- §8 changing what exists: additive first (expand, then contract); destructive steps carry the
  marker and ship one release after the code stops using the thing; `SET NOT NULL` needs a backfill
  `UPDATE` before it in the same file; a rename is add, copy, later drop; relaxing (`DROP NOT
  NULL`, widening a CHECK) is not destructive.
- §9 reference seeds (A26): run in EVERY environment incl. production. **Allowed:** system roles
  and their `permission` rows, numbering schemes for `schemes.js` types, validated workflow
  definitions, code lists the code switches on, public holidays by law, template defaults.
  **Not allowed:** people, business choices (explicitly "alert thresholds", expense categories,
  attendance policies, leave entitlements…), demo rows, "so the screen isn't empty", secrets. Every
  insert `ON CONFLICT … DO UPDATE/NOTHING`; a row people edit later is seeded `DO NOTHING` or
  `DO UPDATE … WHERE` it still holds the old seeded value. Demonstration data goes in
  `seeds/staging/NN_name.js` (JavaScript, through services, idempotent, never production).
- §10 run as the app role; trusted extensions only; new untrusted ones go in provisioning.
- §11 never: write `system_marker`, create/grant roles, seed people, depend on data
  (`IF EXISTS (SELECT … FROM employee)`), touch `schema_migration`.
- §12 before the PR: run gates 3, 4 (static and live), 5, 6, 6b and `RUN_DB_TESTS=1 npx jest
  tests/integration`, paste results in the PR notes; checklist: branch `m1/…` and numbers in M1;
  trigger, FK indexes, `ON DELETE`; NOT NULL grep shown; CHECKs = contract enums; DOWN exact;
  seeds A26-clean, schemes in `schemes.js`; **`docs/DATABASE_SCHEMA.md` M1 "Built"/"Owes"
  updated** (today it owes "Home (home.md §4): `home_report_run`, `role_kpi` (per-role tile
  defaults and locks), alert scope") and the guide's §4; PROGRESS note; reviewed by the milestone
  owner and GE (schema); not merged the hour it is opened.

### 4.7 Home-specific migration and seed patterns
Capability seed pattern (copy `seeds/reference/0449_seed_field_visibility_capabilities.sql`):
```sql
INSERT INTO capability (code, name, description)
VALUES ('home.team', 'See the Team Tab', '...'), ('home.reports', '...', '...'), ('home.alerts.manage', '...', '...')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_capability (role_id, capability_id)
SELECT r.role_id, c.capability_id FROM role r CROSS JOIN capability c
 WHERE r.code IN (...) AND c.code IN (...)
ON CONFLICT (role_id, capability_id) DO NOTHING;
-- DOWN: delete role_capability rows by (role code, capability code); delete capability only
-- WHERE NOT EXISTS user_capability / role_capability (someone may have granted it since)
```
Numbering for runs: add `home_report_run` (any literal you will pass to `allocate`) to
`src/shared/numbering/schemes.js` SCHEMES (passes `validateScheme`; `tests/unit/foundation/domain.test.js:51`
validates every entry) AND seed the row (`INSERT INTO numbering_scheme (doc_type, prefix,
padding, separator, reset, include_period) VALUES (...) ON CONFLICT (doc_type) DO NOTHING;`), or
`/api/health/ready` reports it and `allocate()` throws at the first run.

Decision 7 (thresholds out of 1099), in a NEW file:
```sql
-- UP
-- DESTRUCTIVE: the three alert rules 1099 seeded are business choices (A26); MyCity enters its own on Home, Alerts.
DELETE FROM home_alert_rule r
 WHERE r.key IN ('attendance.absence', 'attendance.lateness', 'leave.pending')
   AND (r.key, r.metric, r.threshold, r.severity, r.permission_key) IN (<the exact seeded values>)
   AND NOT EXISTS (SELECT 1 FROM home_alert a WHERE a.home_alert_rule_id = r.home_alert_rule_id);
-- DOWN
INSERT INTO home_alert_rule (key, metric, threshold, window_days, severity, permission_key, enabled)
VALUES (...) ON CONFLICT (key) DO NOTHING;
```
(`home_alert.home_alert_rule_id` has no `ON DELETE`, i.e. RESTRICT: an unguarded delete fails on a
DB with alerts.) Whether per-role `role_kpi` defaults are seedable is an A26 question (§12 below).

---

## 5 · Contract and route gates

### 5.1 `contract`: `scripts/gen/contract.js --check`
After ANY change to `packages/contract/schemas/*.js` or a `*.routes.js`, run `npm run
gen:contract` and commit BOTH `packages/contract/contract.gen.ts` and
`packages/contract/contract.gen.meta.json` (hash of every input). Never hand-edit. The generator
refuses any key that is not `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` anywhere in a schema. A schema name
two domains share is prefixed with its domain in the TS. Also pinned by
`tests/unit/foundation/worker-jobs.test.js` "the generated file in the repository is current".
Contract helpers (`packages/contract/schemas/common.js`): `listQuery(filters, sortable)` (adds
`page`, `q`, optional `sort`; `page`/`q`/`sort` are reserved filter names), `Paged(item)`,
`PageQuery`, `PageMeta`, `EmptyBody`, `IdParams`, `uuid`, `isoDate`, `isoDateTime`, `money`,
`PAGE_SIZE = 25`. `c.<file>.<Name>` is auto-exported by file basename (`packages/contract/index.js`).

### 5.2 Gate 7, `scripts/check/route-contracts.js`
Boots `buildApp({ strict: true })` with no DB/Redis; any route-definition error fails. Rules in
`src/http/route.js`: every route via `route()`/`publicRoute()`; schemas must be exported from
`@mycity/contract`; `response` or `no_content: true` (not both); POST/PUT/PATCH need `body`
(`c.common.EmptyBody` when none); GET has no body; contract keys only `body query params response
no_content anonymous self summary`; staff route needs a handler with `.permission`
(`requirePermission`/`requireAnyPermission`) unless `self: true` or `anonymous: true`; `:id` /
`:*_id` params must be UUIDs unless `params` given; duplicate METHOD+path across modules fails boot.
Pattern (`src/modules/announcements/announcements.routes.js`):
```js
const { requirePermission, requireCapability } = require("../../middleware/rbac");
route(router, "get", "/", { query: an.AnnouncementListQuery, response: an.AnnouncementPage, summary: "..." },
  requirePermission("community", "view"), requireCapability("announcements.post"), controller.list);
module.exports = { basePath: "/community/announcements", surface: "staff", router };
```
`requireCapability(code)` (`src/middleware/rbac.js:190`): CEO passes; else
`grantsCache.getCapabilities(pool, req.user.user_id)` must include `code`, else 403
`CAPABILITY_REQUIRED`. The per-rule "permission the rule names" for clearing is checked in the
service (`src/shared/alerts/alerts.js`; `permission_key` must be `<module>.<action>`,
`alerts.parsePermission("home.alerts")` throws), never as a variable `requirePermission(key, …)`.

### 5.3 `module-catalogue`: `scripts/check/module-catalogue.js`
Scans `src/**/*.js` (not tests) for `requirePermission("<key>", "<action>")`,
`requireAnyPermission([["k","a"], …])`, `mountResource(router, { module: "k" })`. Fails on a key
not in `src/shared/access/access.catalog.js` MODULES (`home` is one), an action not in `view
create edit delete approve export` (it is `edit`, never `update`), or a key/action that is not a
string literal. `requireCapability` codes are NOT checked here (they live in the `capability`
table). Today `home` is in the "no route enforces yet" note; `--exact` is switched on at M9.

---

## 6 · Pipeline guards

### 6.1 `pagination`: `scripts/check/pagination.js`
1. Backend `src/**/*.js` lines (only `//` comments are stripped; `/* */` and JSDoc are NOT): fails
   on `/\b(limit|offset)\s+(\$\{|\$\d+|\d+)/i` unless the line matches `/\blimit\s+1\b(?!\d)/i`,
   and on `FETCH FIRST|NEXT`. So `ORDER BY … LIMIT 5`, a JSDoc line ` * at most limit 25`, or a
   copy string `"over the limit 3"` all fail. Worker batch claims may write
   `LIMIT $1 -- pagination:batch <why>` on the same line, but not in `.routes.js`, `.controller.js`
   or `.ai.js`.
2. `completeQuery(` needs `// pagination:complete <reason>` on one of the TWO lines above.
3. `/\b(limit|offset|per_page|page_size|pageSize|perPage)\s*:/` anywhere in a contract file other
   than `common.js`, or in any `*.ai.js`.
4. app/ and public-app/ (`.js/.jsx/.ts/.tsx`, not `.gen.ts`): `?limit=`-style params, any
   `per_page|page_size|pageSize|perPage` identifier, `const …PAGE_SIZE =`.

API (`src/shared/http/paged.js`): `pageQuery(client, sql, params, query)` requires `TOTAL_COL`
(`COUNT(*) OVER() AS _total`) in the SELECT, a unique `ORDER BY` at the end (finish on the PK; use
`orderBy(query, SORTS, "t.pk")`), and no LIMIT/OFFSET; returns `{ data, page: { number, size:
25, total, pages, has_next } }`. Controller: `sendPaged(res, result)` (asserts ≤25 rows).
`completeQuery(client, sql, params, { label, ceiling? })` (default ceiling 5000, throws
`RESULT_SET_TOO_LARGE`) is the only way to load a whole set; never for a screen list or the AI.
Home consequences: Overview's embedded lists (Need You, Activity Today) are page 1 of a
`pageQuery`, capped at 25, linking to the full endpoint; never `LIMIT n`. Report generation (all
rows into a PDF/XLSX) loops `pageQuery` pages or uses `completeQuery` with the marker and a reason.

### 6.2 `provenance`: `scripts/check/provenance.js`
Scans src/, scripts/, tests/, packages/, migrations/, seeds/, templates/, ops/, .github/,
.claude/, app/, public-app/ and root config files (text extensions incl. `.md`, `.sql`, `.json`).
Not docs/, README.MD, CLAUDE.md. Line fails on (case-insensitive):
```
/pixie/i   /praxis[-_ ]?ls\b/i   /\bdonor\b/i   /\bported\s+from\b|\bport(ed)?\s+of\b/i
/(?<!jbs\s)\bpraxis\b(?![\s_-]*ai\b)/i
```
Verified: "catalogue pattern from the donor" fails; "a port of the catalogue" fails; "Praxis AI"
and "JBS Praxis" pass. Origin lives only in `docs/MyCity-ERP-Documents/REUSE_MAP.md` and guides.

### 6.3 `numbering-schemes`
`allocate(client, "<type>")` / `preview(…)` type must be a string literal in `SCHEMES`
(`src/shared/numbering/schemes.js`); forwarders (`shared/crud/resource.js`,
`shared/documents/generate.js`) are checked through the caller's `docType: "<type>"` /
`numbering: "<type>"`. Today no report type exists.

### 6.4 Gate 20, `money`: `scripts/check/money.js`
src/, packages/, scripts/ (not tests, not `src/shared/money/`): an identifier is money when a word
of it is in {amount salary gross net price cost fee balance tax paye pension deduction allowance
bonus **budget** ngn kobo naira wage earnings refund payout **spend spent** subtotal vat … loan}
and none is in {rate percent count days … id number … page size limit key name label type status
date …}. Fails `parseFloat/parseInt/Number(money)`, `Math.round/floor/ceil/trunc(money)`,
`.toFixed()` on money, `+ - * / %` (and `+=`…) with a money operand (incl. `"Total: " + amount`),
money cast to `float/real/double precision` in SQL; in migrations a money-named column not
`numeric(18,2)`. Waiver: `@money:ok <reason>` on the line or in the comment block directly above
(≤8 lines, no code between). Use `src/shared/money/money.js`: `money, round, toWire, sum,
percentOf, compare, isZero, isNegative, allocate, formatNaira`. Home: budget threshold %
(`percentOf`), Monthly Signed Value, payroll tiles.

### 6.5 Gate 15, `date-format` (built and green, despite README §8 and FRONTEND_GUIDE §10 saying
"still empty")
Backend: `toLocaleDateString()`, a date `toLocaleString()`, or an `Intl.DateTimeFormat` that
renders a day beside a month, anywhere outside `src/shared/time/`; an ISO day
(`toISOString().slice(0, 10)`, `"yyyy-mm-dd"`) in PAPER paths (`src/shared/spreadsheet/`,
`src/shared/documents/`, `src/shared/templates/`, `src/services/pdf/`, `src/services/mail/`,
`src/shared/import/report.js`); `MM/DD/YYYY` literals. Frontend (`app/src`, `public-app/src`,
`packages/ui/src`): native date inputs, an order-sensitive format with no locale, a month-first
locale (`en-US`, `en-PH`, `en`, `und`). Waivers `@date-format:parts|foreign|filename <reason>`
(same placement as money). Use `src/shared/time/day-first.js` (`formatDate, formatDateTime,
formatLongDate, formatMonth, parseDayFirst`) and `@mycity/ui` `formatDate`, `formatDateTime`,
`formatMonth`, `formatMoney`. Report files written by module code outside PAPER paths are not
flagged, but the rule (day-first in PDF and XLSX) still applies: write through
`shared/spreadsheet` and the document templates.

### 6.6 Gate 17, `dashes` (also gate 8's backend half)
Refuses `—`, `–` or a spaced `--` in: string literals in `src/` and `packages/` (errors, mail
subjects, notification text, KPI labels, Zod messages; SQL-looking literals have their `--`
comments removed first), app/ and public-app/ source outside comments, demo.html,
`src/services/ai/prompts/`, `templates/` text, `docs/manual/`. A value that is ONLY a dash (the
empty-value marker) is allowed. AI manifest descriptions must also have no em dash
(`shared/ai/manifest.js`).

### 6.7 Others
- `ai-vendor-imports`: no AI SDK in package.json or imports in src/scripts/packages; no vendor
  host outside `src/services/ai/vendors/`. Use `services/ai/llm.service` if Home ever calls a model.
- `public-surface`: `*.public.routes.js` never requires `middleware/auth|rbac` (Home has none).
- `env-template`: a new env var in `src/config/env.js` ⇒ `npm run gen:env` and commit `.env.example`.
- `shell`: every `.js` under src/scripts/packages/tests/ops parses; shell scripts LF + `bash -n`.
- `production-environment-refs`: only `release.yml`/`rollback.yml` name the production
  environment (Home never touches workflows).

---

## 7 · AI and search gates

### 7.1 Gate 9, `ai-manifest-coverage`
Per folder in `src/modules/`: once ANY `*.controller.js` has content, the folder needs a
non-empty `*.ai.js` OR `// ai:none <reason>` in a controller (reason ≥8 letters). Split Home
(dashboard + alerts + reports) ⇒ three manifests or markers. Existing empty stub:
`src/modules/alerts/alerts.ai.js`; dashboard/reports have none (create `<m>.ai.js`).

### 7.2 Gate 19, `ai-no-writes`
Every non-empty `*.ai.js` must call `defineManifest(` and (comments stripped, strings kept) must
not match `/(^|[{,\s])["']?(writes?|actions?|executors?|execute|mutations|creates|updates|deletes)["']?\s*:/m`
(verified: `params: { action: "new" }` matches). Then `shared/ai/registry.load()` runs
`defineManifest` checks: top keys only `module, reads, routes`; `module` and each read's
`permission` are catalogue keys and the read's action is `view`; read keys only `key,
description, params, permission, run, cite`; `key` matches `/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/`
and is unique; `params` is a contract schema and a list read's params carry `page` (a
`listQuery`); description short, plain, no em dash; route keys only `intent, screen, params,
prefill`; `screen` is `"<module>.<tab>"` in `shared/route-map.js` SCREENS (`home.overview`,
`home.alerts`, `home.reports`, `home.team`). Real pattern (`src/modules/workflow/workflow.ai.js`):
```js
module.exports = defineManifest({
  module: "settings",
  reads: [{ key: "approvals.mine", description: "...", params: c.workflow.ApprovalMineQuery,
    permission: ["ess", "view"], run: (_client, params, actor) => service.mine(actor, params),
    cite: (row) => ({ type: row.entity_type, id: row.entity_id, label: row.definition_name }) }],
  routes: [{ intent: "change who approves a request", screen: "settings.approvals" }],
});
```
`run(client, params, actor)` gets `actor.scope`; reads return one page (authorise.js asserts ≤25).

### 7.3 Gate 10, `search-coverage`
1. A module folder with a non-empty controller AND a non-empty repo needs a non-empty
   `<m>.search.js` or `// search:none <reason>` (≥8 letters) in a controller.
2. Every provider loads (`shared/search/registry.js`): `module` is a catalogue key, `type` is an
   `ENTITY_ROUTES` key in `src/shared/route-map.js`, no type declared twice.
3. Every `SCREENS` tab in route-map is in `src/shared/search/screens.js` with the SAME label the
   shell shows (`app/src/shell/catalogue.ts` `t("Label", "slug")`), and vice versa (Home is
   already listed: Overview, Alerts, Reports, Team).
4. Every `ENTITY_ROUTES` type is declared by a provider, or its line / the comment line above
   carries `// search:none <reason>`; declared AND marked = stale marker failure; a marker
   `not built yet (src/modules/<m>)` fails once `<m>` has controller + repo content.
   Home types today: `home_alert` (→ alerts), `home_report`, `home_report_run` (→ reports). A
   provider for alert rules needs a new `home_alert_rule` ENTITY_ROUTES entry first.
5. Every `useScreenAction({ label: "…" })` in app/src (label written out as a literal) is in
   `src/shared/search/actions.js` ACTIONS, or the call (line or comment line above) carries
   `// search:none <reason>`. Home uses none today; "New Rule"/"New Report" via
   `useScreenAction` need `a(key, label, { screen: "home.alerts", params: { action: "new" },
   need: ["home", "view"] })` entries.
Provider shape (`src/shared/search/provider.js`):
```js
module.exports = recordProvider({ type: "home_report", module: "home", label: "Reports",
  words: ["report", "attendance report"], from: "saved_report r", key: "r.saved_report_id",
  columns: ["r.name", "r.report_key"], select: "r.saved_report_id AS id, r.name AS title",
  scope: { column: "..." } /* or owner: { column: "r.owner_user_id" } */ });
```
Also: `src/shared/search/screens.js:134-135` decides tab visibility in ⌘K
(`home.team` → `reader.manages_people || reader.is_ceo`; alerts/reports → `full ||
reader.manages_people`). Decision 2 (capabilities) should be mirrored there or ⌘K offers a tab
the API refuses.

---

## 8 · Frontend gates (any PR touching `app/`, `packages/ui/`, `public-app/`)

| Gate | Script | Refuses (Home-relevant) |
|---|---|---|
| 8 Five-second | `five-second.js` | word limits from `scripts/check/lib/copy.js` LIMITS: page title 3, subtitle 8 and **desktop only**, card/section/modal/KPI title 4, KPI caption 5, button/tab/chip 3, field label 4, placeholder 3, field error 4, toast 8, empty text 8, chart caption 8 and desktop only, help 35, details 60, any sentence 20; chrome Title Case (minor words `a an and as at but by for from in into nor of on onto or per the to vs via with`; tokens with digits/dots/@/slash, ALLCAPS, iOS-style skipped); **a title starting How/Why/What/When/Where/About or containing is/are/isn't/aren't is an explainer** ("Who Is In" fails); help or Details open on load; any text in a modal footer; buttons Submit/OK/Okay/Yes/No/Click Here. Static half: `toast("…")` literals ≤8 words and string props `title`, `subtitle`/`sub`, `text`/`help`, `details` on PageHeader, Card, CardHeader, Modal, SidePanel, ConfirmDialog, EmptyState, Section, KpiCard, Sheet, HelpTerm, InfoButton, Details |
| 11 Two shells | `two-shells.js` | sideways scroll; phone: desktop sidebar, no bottom bar, any visible table, tap target <44×44, >40 words of interface copy on the first phone screen; desktop: bottom bar, no sidebar; any script error or native dialog. A modal that opens by itself (the clock-in prompt) is read as its own view and then closed with **Escape**: it must close on Escape |
| 12 Forms | `forms.js` | raw `<form> <input> <select> <textarea> <label>` or `react-hook-form` outside `packages/ui/src/form/`; native date input; instruction placeholders (ending `.`); Submit/OK |
| 13 Palette | `palette.js` + lint `no-hex` | hex outside `packages/ui/src/styles/tokens.css`; any arbitrary Tailwind value or `style=` prop in app/src (no exemptions) |
| 14 Contrast | `contrast.js` | runs `packages/ui/src/styles/tokens.test.ts` |
| 15/16/18 | `date-format.js`, `native-dialogs.js`, `upload.js` + lint | native date input, unpinned locale, `alert/confirm/prompt` incl. `window["confirm"]` and destructuring, raw file inputs |
| 17 Dashes | `dashes.js` | §6.6 |
| Components | `gen/components.js --check`, `components.js` | anything in `app/src/components/` (folder must not exist), a feature component named like a `@mycity/ui` one; new shared components only via `npm run new:component` in packages/ui with header, test, gallery page, then `npm run gen:components` |
| fe-typecheck/lint/test/build | workspaces | lint also bans `zod`/`zod/*` in app (no local Zod), and imports of `@radix-ui/*`, `vaul`, `sonner`, `lucide-react`, `react-hook-form`, `@hookform/*`, `@tiptap/*`, `leaflet` from the app (use `@mycity/ui`) |
| mock-free | `mock-free.js` | a release build containing `MOCK_SENTINEL` (keep mock imports behind `VITE_API_MODE`) |
| a11y | `a11y.js` | any axe violation on every app screen at 390 and 1440 px (mock build, Operations account), the self-opening clock-in prompt as its own view |

Data rules (FRONTEND_GUIDE §9.5): calls typed by `api.call("GET /api/v1/…", …)` from generated
`Endpoints`; `app/src/api/types/home.ts` is the INTERIM file; `npm run contract:status` (from
app/) says Interim / Partly / Ready to switch; when Ready, point imports at `contract.gen.ts`,
delete the INTERIM file, `npm run fe:typecheck`, fix, tick UI. The mock
(`app/src/api/mock/modules/home.ts`) is what the crawl, a11y and gallery run on: F12 says "a
module's mock is deleted when its real routes ship", but every shipped module (organisation,
community, mailbox, workflow…) still keeps its mock and the crawl needs it, so keep Home's mock in
the contract's shapes. The PR body's **Native app feel** section is required for frontend changes
("No screen changed" if none).

---

## 9 · Tests that pin things a Home PR will change

- `tests/unit/foundation/worker-jobs.test.js:33-58`: exact sorted lists of `registry.JOBS`
  queues and `registry.SCHEDULERS`. Today JOBS = announcement-publish, av-transcode, celebrations,
  email-send, import-commit, import-validate, mail-send, mail-sync, media-derive, media-scan,
  notification-deliver, pdf-render; SCHEDULERS = alert-ageing, announcement-release, celebrations,
  import-cleanup, mail-sync, media-reconcile, outbox-dispatch, workflow-timeout. Add
  `scheduled-report` / `scheduled-reports` / any sweep here in the same PR. Also: every scheduler
  is named after its file, has `every` or `pattern`, tz `Africa/Lagos`; only `outbox-dispatch` is
  `inProcess`; triggers listen to declared events and name declared queues.
  Registry: `src/jobs/registry.js` (`JOBS`, `SCHEDULERS`, `TRIGGERS`; schedulers export
  `defineSchedule({ name, every | pattern, run })`, run under `withCronLock`, `attempts: 1`;
  handlers idempotent, throw `UnrecoverableError` when retry cannot help).
- `tests/unit/foundation/domain.test.js:51`: every SCHEMES entry validates.
- `tests/unit/foundation/events-workflow.test.js`: `catalogue.ALERTS.HOME_ALERT_RAISED ===
  "home.alert_raised"`; `alerts.parsePermission("home.alerts")` throws. Event keys are declared
  with `defineEvents("home", { "home.report_run": { summary } })` in `<m>.events.js`; the same key
  declared by two modules must name the same module key or load fails; `emit()` refuses an
  undeclared key.
- `tests/unit/search-coverage.test.js`, `tests/unit/check-*.test.js`: gate fixtures (only if you
  change a gate, which needs GE/TB review).
- Jest skips EMPTY `*.test.js` stubs by name; the moment one has content it runs.

---

## 10 · The module-location decision and what each option costs in gates

**Option A (matches README §5.2/§5.4, CODEOWNERS, stubs, route-map markers):** `dashboard`
(Overview, Team, KPI catalogue, role_kpi, picks, source adapters), `alerts`, `reports`. Required:
home.md header `Backend modules | \`dashboard\`, \`alerts\`, \`reports\`` (plus `attendance` only if
you want home.md, not attendance.md, to own the roster read: both may list it); each folder with
a filled controller gets `<m>.ai.js` or `// ai:none`, each with controller+repo gets
`<m>.search.js` or `// search:none`; route-map markers removed as providers land; contract in
`packages/contract/schemas/{dashboard,alerts,reports}.js` (`c.dashboard.*`, `c.alerts.*`,
`c.reports.*`); nested basePaths are fine (`/home`, `/home/alerts`, `/home/reports`; cf.
`/community` + `/community/announcements`) but no duplicate METHOD+path.

**Option B (new `src/modules/home/`, as the guide header says):** add CODEOWNERS
`/src/modules/home/` (+ contract line); README §5.2 (`home` → `home`) and §5.4 rows; delete the
empty `dashboard/`, `alerts/`, `reports/` folders AND their 6 CODEOWNERS lines (module + contract)
in the same PR (codeowners fails on a line whose path is gone); delete the 3 empty contract stubs;
rewrite the 3 route-map markers; `packages/contract/schemas/home.js` is auto-allowed by readme-map
only once `src/modules/home/` exists.

Either way: README §11.5 at close-out, every module file still empty is deleted and taken off the
README map and the guide (e.g. unused `kpi-catalog/tiles/*.js`, `dashboard.events.js`, empty
`*.test.js`); stubs a later milestone fills stay (`src/jobs/*/budget-threshold.js`,
`approval-ageing.js` are M8).

---

## 11 · Per-PR checklists

### Every Home PR
- [ ] Branch `m1/home-<slice>`; PR title `feat(home): …` (Conventional Commits); do not commit,
      push or open the PR unless the user asks.
- [ ] `export PATH=/opt/node20/bin:$PATH`; `npm run ci` green (full report); with §2.2 env for
      `RUN_DB_TESTS=1` locally when migrations/repos changed.
- [ ] `docs/PROGRESS.md`: note under `### Home` **Notes** (top), `- dd/mm/yyyy · TB · what was
      done. Left: …`; row ticks/Status/Updated as earned; Summary M1 + Total recomputed.
- [ ] `docs/guides/home.md`: body matches what was built; `- dd/mm/yyyy · TB · …` Change log line;
      Last changed bumped; header Backend modules list exact; Status Agreed → Built at PR 5.
- [ ] Any other covered guide touched (§3.2 table) gets its own Change log line. Avoid
      `Guide-unchanged` (it exempts every guide).
- [ ] New off-pattern files on the README map (§3.3); `docs/DATABASE_SCHEMA.md` M1 Built/Owes for
      schema changes; README §5.4 "Files beyond the template" for new module topic files.
- [ ] CODEOWNERS: lines for any new module folder/guide; none left for deleted paths.
- [ ] Contract first; `npm run gen:contract`; commit `contract.gen.ts` + `contract.gen.meta.json`;
      `TABLES` entry for every exported object schema.
- [ ] Every staff route `requirePermission("home", "<action>")` literal (+ `requireCapability`
      where decision 2 applies); writes go through the service, in a transaction, with `emit()`;
      follow-on work in outbox handlers.
- [ ] Every list: `listQuery` + `Paged` in contract, `pageQuery`/`orderBy`/`TOTAL_COL` in repo,
      `sendPaged` in controller; no `LIMIT n`, no page-size keys anywhere, no `pageSize` in app.
- [ ] grep before pushing: `grep -rniE "pixie|praxis|donor|ported from|port of" src tests migrations seeds app packages templates`
      and `grep -rn "[—–]" src packages app templates` (only "Praxis AI"/"JBS Praxis" may remain).
- [ ] PR body: template filled; "Screens and items" names rows (#1, #2, #3, #86); the HTML
      comment with the two trailer lines DELETED unless an exemption is meant; Native app feel
      section for frontend; migration PRs paste gate 3/4/5/6 + integration output.
- [ ] Review: a code owner who is not the author (GE covers every path; LA for migrations/seeds and
      attendance; AJ for app/ and packages/ui). Migration PRs not merged the hour they open.

### PR 1 · foundation (contract, migrations, capabilities, `/me`, KPI catalogue, source adapters, roster, docs)
- [ ] Decide Option A/B (§10); fix home.md header; CODEOWNERS/README accordingly.
- [ ] Schema migration `migrations/11N0_home_*.sql` (> 1130): `ALTER TABLE saved_report /
      report_schedule ADD COLUMN IF NOT EXISTS …` (never re-CREATE), `CREATE TABLE IF NOT EXISTS
      home_report_run (home_report_run_id uuid PK, number citext NOT NULL UNIQUE, document_id uuid
      REFERENCES document(document_id) ON DELETE …, …)`, `role_kpi`, per-user picks, alert rule
      scope/created_by columns if the contract needs them; each new table's
      `<table>_set_updated_at` trigger; FK and filter indexes; CHECKs = contract enums; DOWN drops
      every column/index/constraint/trigger/table by name in reverse order. Header comment line 1.
- [ ] Reference seed `seeds/reference/11N9_seed_home.sql`: capabilities `home.team`,
      `home.reports`, `home.alerts.manage` (+ default `role_capability` rows like 0449),
      `numbering_scheme` row for the run type (if numbering lands now) with `schemes.js` entry;
      decision 7 removal guarded and marked DESTRUCTIVE; DOWN restores only its own rows.
- [ ] No business choices in reference SQL (no thresholds, no per-role KPI layout unless agreed
      A26-clean); demo rows go to `seeds/staging/`.
- [ ] `/me` exposing capabilities ⇒ identity.md Change log line, identity contract regenerated.
- [ ] `attendance.roster` in `src/modules/attendance/attendance.roster.js` (auto-allowed name) ⇒
      attendance.md Change log line, README §5.4 attendance row, LA review. Keep
      `attendance.controller.js` empty unless you also ship attendance's manifest/search answers.
- [ ] KPI catalogue: self-check at require (unit test that a half-flipped entry throws), eligibility
      at read time; source adapters declare the columns they read (schema-drift checks qualified
      columns in their SQL; adapters for M2+ tables read tables that exist since 2000-8000
      migrations) with comments that say what and why, never where from.
- [ ] Controllers filled ⇒ `.ai.js` / `// ai:none <reason>`, `.search.js` / `// search:none
      <reason>`; route-map markers adjusted the moment a module has controller + repo.
- [ ] PROGRESS: note (rows may go to In progress with Updated + Summary change; no ticks yet).
- [ ] DATABASE_SCHEMA.md M1 Built/Owes; home.md §4, §5, §8 (capabilities, not
      `home.alerts`-style permission keys), §9.

### PR 2 · Overview (role layouts, personal picker, KPI detail, clock-in trigger, UI on real API)
- [ ] `GET /home/overview` (bounded; embedded lists ≤25 via `pageQuery` page 1),
      `GET /home/kpi/:key` paged (only params named `id` or `*_id` get the automatic UUID check,
      `idParamNames` in `src/shared/http/validate.js`; validate `:key` against the catalogue with a
      `params` schema), picker writes with a body schema; integration tests per endpoint
      (response schema checked under APP_ENV=test).
- [ ] Clock-in trigger moved/owned by Home: touching `app/src/features/attendance/ClockButton.tsx`
      ⇒ attendance.md Change log line; the prompt still opens by itself and closes on Escape
      (crawl, a11y); `app/src/shell/Shell.tsx` not guide-covered.
- [ ] Screen gates on Overview at both widths (KPI titles ≤4 words Title Case, captions ≤5, no
      subtitle/chart caption on phone, first phone screen ≤40 words, no tables on phone).
- [ ] INTERIM → contract for the Overview endpoints (`npm run contract:status` in app/); mock kept
      in contract shapes for the crawl.
- [ ] PROGRESS #1: API ☑ only with staging data (opens on staging); UI ☑ on the real API; Mobile ☑;
      Built only with all three (opens on production).

### PR 3 · Team (roster, team KPIs, scope)
- [ ] `GET /home/team` paged, `requirePermission("home","view")` + `requireCapability("home.team")`;
      repo honours `req.scope` (shared/rbac/scope); roster read from `attendance.roster` (Home
      figure = My Attendance figure).
- [ ] `src/shared/search/screens.js` tab visibility for `home.team` aligned with the capability.
- [ ] Phone: roster as person cards (no table), bottom sheet on tap.
- [ ] PROGRESS #86 ticks/status; home.md §8/§13 team scope.

### PR 4 · Alerts (signal handlers, daily sweeps, rules CRUD, clear/dismiss)
- [ ] Outbox handlers in `<m>.events.js` for the owning modules' signals (keys must be declared by
      their modules; Home only consumes); raise through `src/shared/alerts/alerts.js` (`ruleByKey`,
      `raise`, clear/dismiss, `escalateAged` already run by `alert-ageing`).
- [ ] Daily sweeps: `src/jobs/schedulers/<name>.js` with `defineSchedule({ name, pattern, run })`
      registered in `src/jobs/registry.js` SCHEDULERS, name in README §5.15, pinned list in
      `worker-jobs.test.js` updated; batch claims `LIMIT $1 -- pagination:batch <why>`.
- [ ] Rules CRUD behind `home.alerts.manage`; clear/dismiss behind `alerts.clear` + the rule's
      `permission_key` checked in the service; double clear idempotent (no second audit row).
- [ ] `alerts.search.js` declares `home_alert` (and `home_alert_rule` after adding it to
      ENTITY_ROUTES); remove the `// search:none not built yet (src/modules/alerts)` marker;
      `alerts.ai.js` reads ("what needs me today") with `params: { new: "1" }`-style routes.
- [ ] Budget-threshold maths through `shared/money` (`percentOf`) or `@money:ok`.
- [ ] Phone: alert cards; Over By help term (35 words max); Clear Alert full width in the sheet.
- [ ] PROGRESS #2.

### PR 5 · Reports (engine, scheduler, vault, email, Overview Export, staging seed, close-out)
- [ ] `src/jobs/handlers/scheduled-report.js` + `src/jobs/schedulers/scheduled-reports.js` (stubs
      exist) registered in `registry.js` JOBS/SCHEDULERS/TRIGGERS; pinned test lists updated.
- [ ] Generation as the recipient; whole-dataset read via page loop or `completeQuery` + marker;
      PDF template in `templates/documents/` (dashes gate reads templates; day-first dates); XLSX
      via `src/shared/spreadsheet` day-first cells; file stored in the vault (`document_id`);
      email via the mail queue; run number `numbering.allocate(client, "home_report_run")` with a
      literal type in SCHEMES and its seeded row.
- [ ] PDF integration tests skip without Chromium (`hasChromium` pattern).
- [ ] `reports.search.js` declares `home_report`, `home_report_run`; remove both route-map markers;
      `reports.ai.js` ("what reports do I receive").
- [ ] `seeds/staging/NN_home.js` (`module.exports = async function seed({ pool, actor, log })`,
      through services, idempotent; staging only), tagged rows for forward tables per decision 11;
      it also creates the alert rules MyCity would enter (decision 7).
- [ ] Close-out: delete still-empty Home stubs and take them off README map, guide and CODEOWNERS
      (README §11.5); delete `app/src/api/types/home.ts` when fully on the contract; home.md Status
      Built; PROGRESS rows Built with Summary; DATABASE_SCHEMA "Owes" cleared.

---

## 12 · Conflicts and open questions found while reading (details in the JSON summary)
- home.md `Backend modules: home` vs README/CODEOWNERS/stubs/route-map (`dashboard`, `alerts`,
  `reports`).
- home.md §4 (`home_report` with `id/key/source/filters/schedule/formats/recipients/
  reporting_line/permission_key/enabled/created_by`; `home_report_run.id`) vs decision 1 tables
  `saved_report` + `report_schedule` and MIGRATIONS §6 PK naming (`home_report_run_id`).
- home.md header/§5/§8 "permission keys" `home.team`, `home.alerts`, `home.alerts.manage`,
  `home.reports` vs the access catalogue (module keys only) and `alerts.parsePermission`; decision
  2 makes them capabilities (and `home.alerts` is not in the decision's list).
- BACKEND_GUIDE §3.6 manifest example `params: { action: "new" }` fails gate 19's static scan.
- README §8 and FRONTEND_GUIDE §10 say `check/date-format.js` is NOT BUILT; it is built and passes.
- progress.js header says 85 rows, README §1/§8 say 86; the code and PROGRESS.md say 93.
- F12 "a module's mock is deleted when its real routes ship" vs the crawl/a11y gates running on the
  mock build (and every shipped module keeping its mock).
- PR template's commented trailer lines grant both exemptions in CI.
- A26 vs decision 5: are per-role `role_kpi` defaults a "business choice" (staging seed / code
  defaults) or reference data?
- Decision 12 moves code covered by attendance.md (LA's guide, Draft, index Written ☐).

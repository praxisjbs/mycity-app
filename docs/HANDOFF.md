# MyCity App: Handoff for the next session

**Written 15 October 2026, 08:30 Lagos time** (updated after phase 6, and after the first group of CI gates). It replaces the 12 October handoff. Read this
first, then `CLAUDE.md`, then the documents it points to.

---

## 1 · Start here

You are continuing **M0, the shared foundation**, for Godwin-Okoh Elisha ("Wizzy", GE, GitHub
`@swizfcodes`). The team is Tom-Blake Asaah (TB, `@tomblakeasaah196`, owns the GitHub repo
`tomblakeasaah196/mycity-app`), Love Adeola (LA, `@LovedataX`, migrations and data) and Adole Jerome
(AJ, `@Ghosted34`, frontend foundation). Tom-Blake is a colleague, not the user.

The plan approved on 13 October was six phases of shared code that M1 to M11 build on. **All six
phases are done, tested and passing (phase 6, AI and search, on 15 October).** What remains of M0
is module code, migrations and the release pipeline (§4); confirm with him before starting any of it.

### How he works (follow it exactly)

- Short prompts with raw context (logs, screenshots). He expects finished, working output, not
  upfront questions. Ask only when a decision genuinely blocks the work, and recommend an answer.
- **Write code directly on his computer** (`C:\mycity-app`, through the device shell), never in the
  cloud workspace. A cloud session can be wiped; patches written there were lost once.
- **The cloud is a test bench only.** Copy a snapshot there, run tests, fix on his machine, copy
  the fixed file across, rerun. Never edit code in the bench. Procedure in §6.
- **Do not run tests, scripts or a browser unless he asks or approves.** He approved cloud testing
  on 14 October; ask again in a new session. Reading files and `node --check` are fine.
- **Do not commit, push or open a PR** unless asked. He commits himself.
- **Do not touch `src/modules/*` or `migrations/`** in this work unless it is really needed, and
  ask first. Migrations are LA's.
- **Ported code never names its source**: no `praxis`, `pixie`, donor paths or "ported from" in
  code, comments, tests or config. `scripts/check/provenance.js` fails the build. He was firm on this.
- **Port from the donors, do not write from the map's description.** For each file REUSE_MAP names,
  open the donor file, port it, and record every deliberate change in REUSE_MAP §1.4. He checks.
- Node 20 stays (`.nvmrc`, engines `>=20.19 <21`). Express 4. CommonJS.
- Leave `ops/nginx` alone. The backend serves the built frontends itself (`app/dist` on `hub.`,
  `public-app/dist` on `go.`, host-guarded); the proxy only terminates TLS.
- No deletions on his machine: delete permission was declined. Put anything to remove in a
  `_to_delete/` folder and tell him.
- After writing files on his machine, verify them by hash.
- He asked for an honest answer when something is not done. Say what was not verified.

---

## 2 · Where everything is

| Place | What |
|---|---|
| `C:\mycity-app` (device shell: `$HOME/mnt/mycity-app`) | The repo. Branch **`m0-foundation-build`** |
| `C:\praxis-ls` (`$HOME/mnt/praxis-ls`) | Donor 1. Read its `CLAUDE.md` |
| `C:\pixie-girl-hub` (`$HOME/mnt/pixie-girl-hub`) | Donor 2. Read its `CLAUDE.md` |

**Git state at handoff:** `main` has PR #17 (phases 1 to 4) merged. Branch `m0-foundation-build`
has commit `9c42322` (restored deliverability, encryption and spreadsheet ports) plus **staged,
uncommitted** changes from the reuse pass (20 files, listed in §3.2). He will commit them.
`main` is branch-protected; work on branches named `m<N>/<short-name>`.

**Document authority:** `MILESTONES.md` is binding for scope and decisions A1 to A25, and
`REUSE_MAP.md` wins where the two disagree. Then `SYSTEM_ARCHITECTURE.md`, `BACKEND_STRUCTURE.md`
and the guides. `README.MD` is the file map; `demo.html` is look only. If two disagree in a way that
matters, stop and ask.

---

## 3 · What is done

### 3.1 Phases 1 to 4 (merged in PR #17)

1. **Config and HTTP core:** `config/*` (env schema, one pg pool, Redis, logger, request context),
   `app.js`, `server.js`, `http/*` (`route()` with a contract and a permission on every route,
   module loader, health), `middleware/*` (auth, rbac, idempotency, error handler, rate limit,
   uploads, async-safe), `shared/http/paged.js` (25 per page, the pagination gate).
2. **RBAC and contracts:** grants cache, sessions, scopes all/team/own, field masking, the contract
   package `common.js`, route-contract and public-surface gates.
3. **Events and work:** `events/{catalogue,emit,outbox}` (one `emit()` writes event_log, audit_ledger
   and event_outbox; at-least-once handlers; `markReady()`), `workflow/*` (engine, conditions,
   definitions, approvers), alerts, notifications (categories, fanout), route map, crud kit.
4. **Files and documents:** sniff by bytes, mime policy, storage, vault, image/AV pipelines, clamd
   scan, reconcile, PDF via Chromium, template language and versions, Markdown, canonical payloads,
   spreadsheets, the import engine (map, real preview, commit, revert, error file), system mail,
   deliverability, encryption, QR, ICS.

### 3.2 Reuse pass (14 October; staged, not committed)

Brought phases 3 and 4 in line with REUSE_MAP and recorded every deliberate change in
**REUSE_MAP §1.4**: doc-type register (`shared/documents/types.js`, enforced by `vault.store`),
served types limited to the allow-list, `shared/files/variant-key.js`, photo/avatar enhancement,
versioned canonical signature payloads with a golden test, the escape-first Markdown renderer
(`marked` removed), spreadsheet totals fix, MILESTONES workflow amendment, BACKEND_STRUCTURE port
table, PROGRESS note, `.env.example` regenerated (`MAIL_RBL_HOSTS`).

### 3.3 Phase 5: the worker (14 October; not committed)

`worker.js`, `jobs/{queues,registry,cron-lock}`, the eight M0 handlers and five schedulers,
outbox triggers (`document.stored` → `media-scan` / `av-transcode`; `document.render_requested` →
`pdf-render`), notification delivery (bell over Socket.io, email with
`templates/email/notification.html`, push counted until M6), `realtime/socket.js` and
`services/realtime/emitter.js`, `scripts/db/{migrate,seed}.js`, `scripts/gen/contract.js`
(`contract.gen.ts` generated, the contract gate built). Also: `shared/import/engine.expireAbandoned`
(`import.expired`), `WORKER_DB_POOL_MAX`, a worker heartbeat read by `/api/health/ready`
(`worker`), Chromium's background networking off, `sessionLive` and `originsFor` exported,
template front matter values may be quoted (`subject: "{{ title }}"`), which survives his formatter.
New packages in `package.json` and the lockfile: `bullmq`, `socket.io`, `@socket.io/redis-adapter`,
`@socket.io/redis-emitter`; dev `socket.io-client`. **He must run `npm install`** on his machine.
Every deliberate change against the donors is in REUSE_MAP §1.4; BACKEND_STRUCTURE §3, §11.1
(`schema_migration` with `sha256`, `system_marker`) and SYSTEM_ARCHITECTURE §7 updated.

Decisions taken in phase 5 (say so if he disagrees):
- Queue names are the handler file names (`email-send`, `pdf-render`), not `email` / `pdf`.
- Schedulers are BullMQ job schedulers on one `schedule` queue, each tick under the Postgres
  cron lock; the outbox dispatch is a 1-second in-process timer in every worker (SKIP LOCKED).
- `media-derive` re-derives audio/video by id; image variants are made at upload (phase 4), so it
  only reports for images.
- Unfinished imports are closed after 14 days (rows removed, batch `failed`, stats.expired).
- import-validate / import-commit run as the person who asked (grant re-checked in the job).

### 3.4 Phase 6: AI and search (15 October; not committed)

- `services/ai`: `llm.service.complete()` (prompt file with `version:` front matter, governance,
  ledger opened before anything leaves, redaction, Gemini or the stub, structured parsing against a
  contract schema with one corrective retry, cost in naira), `governance.js` (`ai_setting`: switch,
  `disabled_modules`, `monthly_cap_ngn`, prices; environment defaults with no row), `ledger.js`
  (`ai_run`, `ai_run_step`; fails closed), `redact.js` (Nigerian identifiers, restricted fields),
  `structured.js` (Zod to JSON Schema, parse), `vendors/gemini.js` (fetch to the OpenAI-compatible
  gateway; no SDK), `vendors/stub.js` (a placeholder of the schema's shape), `transcription.js`
  (seam; Gemini audio is M2). Prompt files are still empty: each milestone writes its own.
- `shared/ai`: `manifest.js` (`defineManifest`: reads need `view`, params from the contract, routes
  name `"<module>.<tab>"` screens; any write-shaped key refused), `registry.js`, `authorise.js`
  (`runRead`, `allowedReads`), `cite.js`, `catalogue-sync.js` (worker boot and
  `node src/shared/ai/catalogue-sync.js` for deploy-gate). The M10 assistant folder stays empty.
- `shared/search`: `recordProvider` (folded prefix, substring, trigram; scope column; pages of 25;
  link from the route map), `registry.js`, `search.service.js`.
- `middleware/rbac.scopeFor(user, key, action)`: requirePermission's decision for non-route callers.
- The API and the worker load manifests and providers at boot (a bad one stops the boot); `/api/health/ready`
  reports `ai` (vendor and model, no call out).
- Gates built: 9 `ai-manifest-coverage`, 10 `search-coverage` (backend half), 19 `ai-no-writes`,
  `ai-vendor-imports`. New env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_REQUEST_TIMEOUT_MS`,
  `AI_MAX_OUTPUT_TOKENS`, `AI_INPUT_NGN_PER_MILLION` (450.00), `AI_OUTPUT_NGN_PER_MILLION` (3750.00):
  the price defaults are Gemini 2.5 Flash list prices at about ₦1,500 to the dollar, to check
  before go-live. REUSE_MAP §1.4 has every change against the donors; BACKEND_STRUCTURE §3, §11.1
  (ai tables), §14.3 and BACKEND_GUIDE §3.6 updated.

### 3.5 CI gates, first group (15 October; not committed)

Nine gates and the import command line, each with tests (`tests/unit/foundation/gates.test.js`,
plus round-trip and command-line tests in `tests/integration/worker.test.js` and
`documents-import.test.js`):

- Gate 3 `migration-numbers.js`: names, unique numbers across `migrations/` and
  `seeds/reference/`, and milestone blocks; reference files must use `_seed_` in their names.
- Gate 4 `migration-reversibility.js`: a DOWN or `-- IRREVERSIBLE: <reason>`; DOWN names what UP
  creates; `-- DESTRUCTIVE: <reason>` on destructive steps. With `RUN_DB_TESTS=1` and
  `DATABASE_URL` (or `--apply`): UP one file at a time, each DOWN compared with the catalogue as it
  was before that UP, then UP again, on a throwaway `mycity_revcheck_*` database (needs CREATEDB).
- Gate 5 `migration-idempotency.js`: the guard rules, and a merged migration edited, renamed or
  deleted fails (git, through `check/lib/changes.js`).
- Gate 15 `date-format.js`, 20 `money.js`; gate 17 `dashes.js` is the screen gates' version from
  main (merged 15 October), widened to `packages/` and the AI prompts; guards `module-catalogue.js`
  (unenforced keys are a note until `--exact` at M9), `production-environment-refs.js`, `shell.js`.
- `check/lib/source.js`: the JavaScript reader the backend gates share. The screen gates from
  main have their own (`check/lib/sources.js`); folding the two together is a later tidy-up.
- `migrate.js`: four-digit names through M9 and five-digit names from M10, with schema and
  reference-seed files interleaved by number; `migrate({until})` and `--down` refuses an
  irreversible file.
- `scripts/import/run.js`: list, template, upload, map, preview, errors, commit, revert, status,
  history, as the person named by `--as`; commit and revert on staging or production ask for the
  environment name (or `--yes`).

### 3.5b Release pipeline (15 October; not committed)

- `scripts/deploy/deploy-gate`: bash, forced command of both deploy keys (`--key=staging` stages
  and seals; `--key=production` promotes and rolls back; both may ask `status`). Tarball on stdin,
  checked against `SHA256SUMS`; `npm ci --omit=dev` then every dependency confirmed present (npm
  crashed once and exited 0); pre-deploy `pg_dump`; migrations and the AI catalogue sync as the
  environment's user (`node --env-file=shared/.env`); `current` switched; units restarted;
  readiness must report the sha, else switched back. Seal = tree hash of the release (written
  after hashing). Promote = seal checks, freeze window, hard links (`cp -al`). One lock for all.
  `DG_*` variables exist only for tests (sshd passes no client environment).
- `release-manifest.js` (assemble, check), `verify-staging.js` (HTTPS checks; six PENDING checks
  wait for modules), `rollback.sh`, `release.yml`, `rollback.yml`.
- Server changes, need a provisioning re-run: `/srv/mycity/<env>` owned by `mycity-deploy`;
  units add `EnvironmentFile=-.../current/BUILD.env` (BUILD_SHA no longer goes in `.env`).
- Tested in the cloud with the server's users, modes and sudoers and real Postgres and Redis
  (`docs/runbooks/deploy.md` §4); `tests/unit/foundation/deploy.test.js` (9 tests).

### 3.5c Operations: backups, restore drill, uptime (16 October; built in the cloud overnight, not committed)

- `scripts/db/backup.sh` (installed as `/srv/mycity/bin/mycity-backup`, run as root by
  `mycity-backup.timer` at 02:30 Lagos): per environment a psql coprocess opens a read-only
  REPEATABLE READ transaction and exports its snapshot; `pg_dump --snapshot` dumps it and the same
  transaction reads the migration head and every table's exact row count into
  `nightly-<time>.json` (with sha256). Media: `rsync --link-dest` snapshots. 14 of each. Offsite:
  `/etc/mycity/backup.env` `OFFSITE_TARGET`, always into `mycity-backups/` under it (so `--delete`
  cannot reach anything else), ssh with `BatchMode` and strict host keys; `rrsync` on the far side
  recommended. Writes `backups/last-run.json`; failures alert production's channels.
  No deploy lock is taken: the snapshot makes the head and counts consistent with the dump.
- `scripts/db/restore-drill.js` (`/srv/mycity/bin/mycity-restore-drill`, Sundays 04:00): Node
  built-ins only; drops to the postgres user by spawn uid/gid (no runuser, no PAM); stdin is the
  dump opened as root. Exact counts against the record; live counts shown only. History in
  `backups/drills.jsonl`.
- `ops/monitoring/uptime-probe.js` + `.github/workflows/uptime.yml` (every 10 minutes; state in
  actions/cache; repository secret `ALERT_WHATSAPP_URLS`). Public repo, so no Actions minutes.
- Alerts (16 October, he chose WhatsApp): the team uses WhatsApp, which has no group webhook. One
  sender, `src/shared/observability/alert.js`, used by the error reporter, the backup and drill
  (installed as `/srv/mycity/bin/mycity-alert`) and the probe: `ALERT_WHATSAPP_URLS` (per-person
  gateway links with `{text}`; CallMeBot free, TextMeBot if CallMeBot is full) and/or
  `ALERT_WEBHOOK_URL`. Cut to 900 characters, 5 per person per 10 minutes, links never printed.
- `provision.sh` installs the two tools and the four timer files, enables the timers, writes
  `/etc/mycity/backup.env` once. Needs a provisioning re-run on the server.
- Runbooks rewritten or written: `backup-restore.md`, `monitoring.md` (also the three lines
  corrected against the code: what `error_event` records, what the logger redacts, what the
  metrics are), `incident.md`, `add-a-module.md`; `server-setup.md`, `deploy.md`,
  `github-settings.md` updated. Tests: `tests/unit/foundation/operations.test.js`.

### 3.6 Test state (15 October, Node 20, cloud bench)

387 tests pass (305 unit, 82 integration against Postgres 16 and Redis, real Chromium and
ffmpeg). `npm run ci`: 26 passed, 0 failed, **2 not built** (schema-drift, contract-columns, both
gate 6). The guides gate passed only with a `Guide-unchanged:` trailer: his editor reformatted
`packages/contract/schemas/organisation.js` (layout only), which `docs/guides/organogram.md` covers.
The same reformat changed the contract source hash; `contract.gen.ts` and its meta were
regenerated. Not tested live: a real Gemini call
(the bench cannot reach Google; the vendor is tested against a fake `fetch`), ClamAV (reply parsing
only), real SMTP delivery, web push (M6).

---

## 4 · What is left

### 4.1 Rest of M0 (module code: confirm first; other owners)

- **Nine M0 modules** (`identity`, `access`, `audit`, `organisation`, `settings`, `notifications`,
  `workflow`, `documents`, `imports`): every file still empty. Module code, so confirm before
  starting. The documents and imports routes, the staff importer, and the security modules REUSE_MAP
  §1.1 lists (`app_user`, `audit_ledger`, `permission`, `scope`, `capability`, `field_visibility`)
  land here.
- **M0 migrations 0001 to 0099 (LA).** `migrations/` is empty. They must match BACKEND_STRUCTURE
  §11.1, which now includes `setting`, `document`, `document_variant`, `template_version` and the
  three import tables, plus `schema_migration` (`name`, `sha256`, `applied_at`; migrate.js creates
  it with that DDL if missing) and `system_marker` (`environment`, one row; seed.js reads it).
  Integration tests use fixture DDL in `tests/integration/fixtures/shared-layer.sql`; it is not a
  migration.
- The per-module contract schemas (only `common.js`, `organisation.js` and `notifications.js` have
  content). The generator is built; run `npm run gen:contract` after any schema or route change.
- Gate 6 (`schema-drift.js`, `contract-columns.js`), still empty; both need the M0 migrations.
  `ci.yml` has no Postgres service yet, so in CI the integration tests and gate 4's round trip do
  not run; add one (with `RUN_DB_TESTS=1` and `DATABASE_URL`) once the migrations exist.
  The release pipeline is built (15 October, in the cloud while he was away; see below). Before the
  first release: `docs/runbooks/deploy.md` §1 (two deploy keys, GitHub environments and
  variables, re-run provisioning with the keys), DNS and mail. Backups, the drill and the uptime
  probe are built (§3.5c); the offsite host and the WhatsApp links (`ALERT_WHATSAPP_URLS`) are his to provide.
- Server 108.181.196.53 (fresh Ubuntu 24.04, 15 October): `ops/provision/provision.sh`, the four
  systemd units, both env templates, the nginx files and the deploy `authorized_keys` template are
  written (not yet run on the server; tested in the cloud: shellcheck, nginx config and live
  proxying, env files against `config/env.js`). He runs it: `docs/runbooks/server-setup.md`. DNS A
  records for the four hosts are his to add. The proxy is nginx from `ops/nginx/` now, not a
  hosting panel. GitHub settings by TB.
- `assets/brand` and `assets/fonts` are empty, so PDFs show the text wordmark.
- M3 and later letter templates are empty (each milestone writes its own). Web push waits for M6.
- systemd it is (decided 15 October); the units are in `ops/systemd/`.

---

## 5 · Waiting on the user (carried from 12 October; check whether settled)

1. A14: MILESTONES says the generic importer lands in M7; the engine was built in M0. One-line
   amendment offered.
2. The 15 permission keys in README §5.2 were proposed, not confirmed.
3. Settled 15 October: systemd, and nginx from the repository instead of a hosting panel.
4. Numbering prefixes in BACKEND_STRUCTURE §7 are proposals for MyCity to confirm.
5. REUSE_MAP §1.3 public-site wording contradicts A9; he said leave it.
6. Client pack: maintenance price contradiction (₦500,000 vs ₦300,000 a year); M11 "training on
   live data on staging" vs A5; current PAYE bands before M6; who approves payroll; the lateness
   threshold for the auto-query.
7. Restricted documents (payslips, bank letters, ID) need the module's `edit` grant to open, not just
   `view`. He has not objected; confirm if it comes up.

---

## 6 · Testing in the cloud bench (only when he approves)

1. On his machine: `cd $HOME/mnt/mycity-app && mkdir -p coverage/claude-sync && git ls-files -co
   --exclude-standard | grep -v '^coverage/' | tar czf coverage/claude-sync/repo.tgz -T -`.
   `coverage/` is git-ignored; `.git` cannot be written through the remote tools.
2. Stage `C:\mycity-app\coverage\claude-sync\repo.tgz`, unpack into `/home/claude/bench`.
3. `export PATH=/opt/node20/bin:$PATH; npm ci`. Postgres: `pg_ctlcluster 16 main start`, set the
   `postgres` password to `postgres`, create `mycity_test`. `redis-server --daemonize yes`.
4. `RUN_DB_TESTS=1 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/mycity_test
   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run ci`. The progress gate
   needs git: `git init -b main`, commit, branch.
5. Fix on his machine; stage the changed file; copy it into the bench; rerun. At the end, compare
   hashes of every changed file on both sides.

Do not `npm install` inside `C:\mycity-app` from the device shell: it is Linux, and native packages
(`sharp`) built there would break his Windows install. He runs `npm install` himself.

---

## 7 · Things learned the hard way

- `marked` 16 is ESM-only and breaks Jest; it is now removed altogether.
- ExcelJS `cell.value` is a prototype getter; a loaded workbook keeps no column keys or headers.
- Writing dropdowns down to row 1000 moves `addRow()`; place rows by number.
- jsonb keeps no key order: take column order from the stored mapping.
- `.gitignore` `media/` also matched `src/services/media`; it is `/media/` now.
- The error reporter flushes on a timer; tests flush it before closing the pool.
- His editor reformats files written to his machine (Prettier style). JavaScript survives; an HTML
  template's front matter did not (`{{ title }}` became `{ { title } }`). Re-read a file before
  editing it, edit by content not by line, and check templates after writing.
- A test file written to a temp folder cannot `require("@mycity/contract")` (no node_modules
  above it); require `packages/contract` by absolute path.
- Postgres cannot type a parameter the SQL never uses ("could not determine data type of
  parameter $3"); add parameters only when the clause that uses them is present.
- Redis pub/sub ignores the database number: the Socket.io adapter and emitter key must carry the
  environment prefix (`mycity:<env>:socket.io`).
- In the bench, `pkill -f "node src/..."` matches the shell running it and kills the command; stop
  a background process by its saved pid.
- Old leftovers on his machine he can delete: `coverage/claude-sync/`, `coverage/claude-restore/`,
  `.git/claude-sync.tgz`.

Engineered by JBS Praxis.

# MyCity App ERP · Progress

**The single record of what is built.** 86 screens (80 in the staff app, 6 on the public site) plus
the M0 foundation. Every change that moves a screen or a foundation item forward updates this file
in the same commit. An AI assistant does this as part of finishing a task (CLAUDE.md, step 5); a
person does it by hand. Nobody should have to ask "where are we on X".

Screen names and tab slugs are the approved inventory (MILESTONES §18, approved 12 October 2026).
A tab's slug is a URL and does not change when its label does.

---

## How to update this file

1. **Tick the columns** the change completed, on the row of each screen it touched:

   | Column | Ticked when |
   |---|---|
   | API | Every endpoint the screen calls exists with its contract, permission check and tests |
   | UI | The desktop screen is built against the real API (no mock data in the component) |
   | Mobile | The mobile shell is built (gate 11: a native mobile layout, not the desktop one shrunk) |

2. **Set Status** to one of: `Not started` · `In progress` · `Built` (all three ticked) ·
   `On staging` (deployed and demo script walked) · `Accepted` (signed off at the milestone demo).
3. **Set Updated** to the date, day-first: `13/10/2026`.
4. **Leave a note** under the module's **Notes**, newest first, one line per change:

   ```
   - 13/10/2026 · LA · My Attendance: API for the month view and the export; table toggle still to do.
   ```

   Say what was done and what is left. Name a blocker if there is one. Replace `_None yet._` with the
   first note.
5. **Update the summary** counts below when a Status changes.

A row is never deleted. A screen that is dropped by agreement gets Status `Dropped` and a note
saying who agreed and when.

---

## Summary

| Milestone | Screens | Not started | In progress | Built | On staging | Accepted |
|---|---|---|---|---|---|---|
| M0 Foundation | items below | | | | | |
| M1 Core Operations & Employee Management | 25 | 25 | 0 | 0 | 0 | 0 |
| M2 Productivity & Performance | 9 | 9 | 0 | 0 | 0 | 0 |
| M3 Queries & Consequence Management | 4 | 4 | 0 | 0 | 0 | 0 |
| M4 Recruitment End to End | 8 | 8 | 0 | 0 | 0 | 0 |
| M5 Offers, Documentation & Onboarding | 5 | 5 | 0 | 0 | 0 | 0 |
| M6 Payroll & Notifications | 6 | 6 | 0 | 0 | 0 | 0 |
| M7 Partnerships, CRM & Trackers | 6 | 6 | 0 | 0 | 0 | 0 |
| M8 Expenses & Budget Control | 6 | 6 | 0 | 0 | 0 | 0 |
| M9 Settings & Governance | 10 | 10 | 0 | 0 | 0 | 0 |
| M10 Staff Knowledge Hub & AI Assistance | 7 | 7 | 0 | 0 | 0 | 0 |
| **Total** | **86** | **86** | **0** | **0** | **0** | **0** |

M1 counts Employees with People although its API is M0 work. M4 and M5 include their public-site
pages. Settings → Notifications is counted in M6, where it is built.

---

## M0 · Foundation

Not a screen each, so tracked as items. `☑` done, `☐` not yet. Same note format as the screens.
Source: BACKEND_STRUCTURE §13 (definition of done) and the 12 October internal meeting.

| Item | Owner | Done | Updated |
|---|---|---|---|
| Server: 4 subdomains, TLS, proxy settings per `docs/runbooks/proxy.md` | GE | ☐ | |
| Root config: `package.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, ESLint, Jest | GE | ☑ | 14/10/2026 |
| `src/config/*`, `app.js`, `server.js`, `worker.js`, `http/*`, `middleware/*` | GE | ☑ | 14/10/2026 |
| Shared core: `db`, `crud`, `http`, `errors`, `events`, `workflow`, `numbering`, `money`, `time`, `access`, `rbac` | GE | ☑ | 14/10/2026 |
| Pagination gate: `shared/http/paged.js`, `common.js` page schemas, `check/pagination.js` (§16) | GE | ☑ | 13/10/2026 |
| Contract package + generator (`gen:contract`) + `http/route.js` | GE | ☑ | 14/10/2026 |
| M0 migrations 0001 to 0099 | LA | ☐ | |
| Staging seed data | LA | ☐ | |
| Nine M0 modules: identity, access, audit, organisation, settings, notifications, workflow, documents, imports | GE | ☐ | |
| `create-admin` seeds a full employee, login and role (§17) | GE | ☑ | 13/10/2026 |
| Documents, media, uploads, PDF generation | GE | ☑ | 14/10/2026 |
| Import engine + staff importer; real staff sheet imported on staging | GE · LA | ☐ | 15/10/2026 |
| AI foundation: `services/ai`, manifests, registry, gate 9 | GE | ☑ | 15/10/2026 |
| CI wiring: `package.json`, lockfile, ESLint, Jest, `ci-local.js`, `ci.yml` | GE | ☑ | 13/10/2026 |
| Process gates: progress, guides, README map, CODEOWNERS; PR template; Claude Stop hook | GE | ☑ | 13/10/2026 |
| GitHub settings applied by TB (`docs/runbooks/github-settings.md`) | TB | ☐ | |
| CODEOWNERS usernames: GE `@swizfcodes`, TB `@tomblakeasaah196`, AJ `@Ghosted34`, LA `@LovedataX` | GE | ☑ | 13/10/2026 |
| CI gates 1 to 8 and pipeline guards (gate 6, schema-drift and contract-columns, still empty, reported NOT BUILT) | GE | ☐ | 15/10/2026 |
| Release pipeline: `release.yml`, `deploy-gate`, staging seal, production approval | GE | ☐ | |
| Docs: `CLAUDE.md`, backend guide, frontend guide, this file, guide template | GE | ☑ | 13/10/2026 |
| Frontend foundation (`app/`, `public-app/`): shell, design tokens, contract client, shared components | AJ | ☐ | |

**Notes**

- 15/10/2026 · GE · CI gates, first group. Gate 3 migration numbers (unique, in the milestone's
  block, a new file in its branch's block), gate 4 reversibility (a DOWN or `-- IRREVERSIBLE:
  <reason>`, DOWN names what UP creates, `-- DESTRUCTIVE: <reason>` on destructive steps, and UP,
  DOWN, UP on a throwaway database when RUN_DB_TESTS=1), gate 5 idempotency (and a merged migration
  never edited, by git), gates 8/17 no dashes in what a person reads, gate 15 day-first dates
  (backend formats only through `shared/time`), gate 20 money, and the guards: module catalogue,
  production environment references, shell scripts LF and parse, every JavaScript file parses.
  `migrate.js`: five-digit numbers for M10 and M11, ordered by number; `--down` refuses an
  irreversible file. `scripts/import/run.js`: list, template, upload, map, preview, errors, commit,
  revert, as a named person. Left: gate 6 (schema-drift, contract-columns); the catalogue gate's
  `--exact` at M9; a Postgres service in `ci.yml` so the round trip and integration tests run in CI;
  the real staff sheet on staging.
- 15/10/2026 · GE · Shared foundation, phase 6 of 6: AI and search. `services/ai`: `complete()` through
  governance (switch, per-module switch, monthly cap in naira), redaction (Nigerian identifiers,
  restricted fields), prompt files, Gemini (or the stub with no key), structured output against the
  contract with one corrective retry, and the ledger (`ai_run`, `ai_run_step`, cost from tokens);
  transcription's seam (Gemini audio in M2). `shared/ai`: `defineManifest` (reads and routes only,
  A23), registry, `authorise` (caller's grant and scope, pages of 25, masking, citations), catalogue
  sync (worker boot and deploy). `shared/search`: providers, registry, ⌘K service (grant first, scope,
  pages of 25, typo matching). `rbac.scopeFor` for non-route callers. Gates built: 9, 10 (backend
  half), 19, AI vendor imports. New env: `GEMINI_*`, `AI_*`. 22 unit and 16 integration tests. Left:
  migration 0095 (LA: ai tables in BACKEND_STRUCTURE §11.1), the M10 assistant, the screen-registry
  half of gate 10 (AJ), per-module manifests and providers with the modules.
- 14/10/2026 · GE · Shared foundation, phase 5 of 6: the worker. `worker.js` (loads the shared and
  module events files and importers before `markReady()`, then consumers, schedules, a heartbeat that
  /api/health/ready reads), `jobs/{queues,registry,cron-lock}` (BullMQ, prefix `mycity:<env>`, one
  run per tick under a Postgres lock), the eight M0 handlers and five schedulers (outbox every
  second in process; workflow timeouts, alert ageing, media reconcile, import cleanup), outbox
  triggers (document stored or render requested queues the scan, transcode or PDF job), Socket.io
  on the API (staff host only, HTTP sign-in rules, `user:` and `session:` rooms, closed at token
  expiry or session end) and the realtime emitter the worker publishes through, `db:migrate`,
  `db:seed` (three production checks) and `gen:contract` (contract gate now built). New: the
  notification email template, `WORKER_DB_POOL_MAX`, `import.expired`; Chromium no longer calls out; quoted template front matter.
  New packages: bullmq, socket.io, @socket.io/redis-adapter and redis-emitter (socket.io-client for
  tests): run `npm install`. 27 unit and 18 integration tests added, one starting the real worker
  process and rendering a PDF through it. Left: phase 6 (AI and search); migrations 0001 to 0099
  (LA: `schema_migration` and `system_marker` columns in BACKEND_STRUCTURE §11.1); web push (M6).
- 14/10/2026 · GE · M0 table brought up to date with phases 1 to 4. Ticked: root config, the shared
  core, and documents, media, uploads and PDF generation. Partly done, so not ticked: the app
  entry points (`worker.js` is phase 5), the contract package (`common.js` and `http/route.js`
  are built; the `gen:contract` generator is phase 5), and imports (the engine is built; the staff
  importer lands with the imports and organisation modules, then the staging import). Next:
  phase 5, the worker, jobs, realtime and the db and gen scripts.
- 14/10/2026 · GE · Reuse pass on phases 3 and 4 (REUSE_MAP §1.4 records every change on the
  way in): deliverability (DMARC, PTR, RBL, route check; system mail refuses a trapped route),
  encryption as is, spreadsheets with a workbook context and live totals, photo enhancement,
  a doc-type register (`documents/types.js`: reader module, signing ceiling) that `vault.store`
  enforces, served types limited to the allow-list, one name for derived files, versioned
  canonical signature payloads, and an escape-first Markdown renderer (`marked` removed).
  272 tests (228 unit, 44 integration) and `npm run ci` pass on Node 20.
- 14/10/2026 · GE · Shared foundation, phase 4 of 6: files (`sniff` by bytes, per-purpose
  `mime-policy`, `safe-name`, `hash`), `services/storage` (atomic, contained keys), the vault
  (store, versions, lock, quarantine and scan, access rules, range downloads),
  `services/media` (image profiles with metadata stripped, voice and video through ffmpeg,
  clamd scan, reconcile), generated documents (`generate` queues HTML, the worker renders
  through Chromium, stores, hashes, locks), the template language, template versions and
  variables, Markdown, canonical hashing, spreadsheets (xlsx and CSV in and out, day-first dates,
  formula escaping), the import engine (map, real preview, commit, revert, error file), system mail
  (captured off servers, marked on staging), deliverability checks, encryption, QR and ICS.
  Letterhead and mail layout templates written. 223 unit tests, 43 integration tests (with real
  Chromium and ffmpeg). New env: media tools and SMTP (SMTP_HOST required on servers). Tables in
  BACKEND_STRUCTURE §11.1 (LA). `web-push` stays for M6.
- 14/10/2026 · GE · Shared foundation, phase 3 of 6: `events/{catalogue,emit,outbox}` (one `emit()`
  writes event, audit and outbox in one statement; handlers run after commit with per-handler
  retry), `workflow/{conditions,definitions,approvers,engine}` (test.threshold, versioned
  definitions, no self-approval, timeouts, My Approvals), `rbac/field-mask`, `alerts`,
  `notifications/{categories,fanout}`, `route-map` (links derived, never stored; checked against this
  file's tabs) and `crud/resource`. Integration suite added (`tests/integration`, `RUN_DB_TESTS=1`,
  27 tests against Postgres 16); 188 unit tests. Gates: pagination allows a marked worker batch
  claim, numbering checks the resource kit's `docType`. Tables these read are in BACKEND_STRUCTURE
  §11.1 (LA); Home's alert columns aligned in `docs/guides/home.md` (TB). `db.js` provenance line
  removed again (it had come back on disk).
- 14/10/2026 · GE · Shared foundation, phase 2 of 6: `shared/db/{query-helpers,effective-dated}`,
  `money` (decimal.js, Naira, kobo-exact `allocate`), `time/{lagos,day-first,working-week,recurrence}`,
  `numbering/{numbering,schemes}` (rollback-safe, gap-free), `geo`, `rules/window-counter`,
  `state/state-history`, `dedup`, `tokens/public-token` and `middleware/public-token`. Gate built:
  numbering-schemes. 155 unit tests; numbering under 20 concurrent saves, rollback, effective dating,
  tokens and the working week also checked against real Postgres. `crud/resource.js` moves to phase 3
  (it writes through `emit()`). New columns for LA in BACKEND_STRUCTURE §11.1.
- 14/10/2026 · GE · Review of phase 1: the API now serves both frontend builds by host (`http/static.js`:
  `app/dist` on hub., `public-app/dist` on go., SPA fallback, cache headers, a host guard that 404s
  the other surface's API); the proxy only forwards (`docs/runbooks/proxy.md` rewritten). Code never
  names the project it was ported from; `check/provenance.js` enforces it. Responses are
  checked as the client receives them (dates as strings); path params reach `req.validated`. Suite
  green on Node 20, 22 and 24.
- 14/10/2026 · GE · Shared foundation, phase 1 of 6 (branch `m0/shared-foundation`): the app boots.
  Written: `config/*` (env refuses an unsafe server boot), `app.js`, `server.js`, `http/*`
  (`route()` enforces a contract and a permission on every route), every middleware except
  `public-token`, `shared/http/{validate,respond,body-limits}`, `shared/db/{tx,pg-types}`,
  `shared/rbac/{grants-cache,scope,sessions}`, `shared/access/access.catalog`, observability.
  Gates now built: env-template, route-contracts, public-surface. 80 unit tests; the request path
  also checked against a real Postgres 16 and Redis. Left: `worker.js` (phase 5), `public-token`
  (phase 2). The columns this code reads are listed in BACKEND_STRUCTURE §11.1 for the 0010 to
  0040 migrations (LA).
- 13/10/2026 · GE · CI wired: `npm run ci` runs every gate locally and in Actions; empty gates are
  reported NOT BUILT, not passed. Process gates and the Claude Stop hook added. Branch protection
  needs TB to apply the runbook; CODEOWNERS needs LA and AJ usernames.
- 13/10/2026 · GE · Pagination gate, `create-admin` and the engineering docs written (12 October
  meeting actions). `create-admin` calls the organisation, identity and access services, which are
  still empty; it runs once those M0 modules land. Root `package.json` is still an empty file, so no
  Node command runs in the repo yet.

---

## Screens

### Home

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Overview | `overview` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
| 2 | Alerts | `alerts` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
| 3 | Reports | `reports` | M1 | TB | ☐ | ☐ | ☐ | Not started | |
| 86 | Team | `team` | M1 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 13/10/2026 · TB · Team tab ratified into the inventory (MILESTONES §18): Home is now four tabs, with Team added as #86 (`team`, M1). Summary counts and the SCREENS constant moved to 86. Full engineering guide written at `docs/guides/home.md`; Home reads live from the owning modules and owns the alert and report engines.
- 13/10/2026 · TB · Home demo upgraded in `docs/MyCity-ERP-Documents/demo.html` from the two 12
  October meetings: role sensitive Overview (Operations, CEO, Partnerships, Staff), every KPI card
  opens a detail modal paged at 25, Alerts gained an Over by (days past threshold) column and a
  create or dismiss rule modal, and Reports is role gated. Added a new Team tab (manager and CEO
  view of the roster and today's attendance). Team is not yet in the approved inventory
  (MILESTONES §18); adopting it would take M1 to 25 screens and needs sign off. Demo prototype only,
  no app screens built, so API, UI and Mobile stay unticked and Status stays Not started.

### My Workspace

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 4 | Today | `today` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 5 | Tasks | `tasks` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 6 | Calendar | `calendar` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 7 | Analytics | `analytics` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Employee Self-Service

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 8 | My Profile | `my-profile` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 9 | My Attendance | `my-attendance` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 10 | My Performance | `my-performance` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 11 | My Payslips | `my-payslips` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 12 | My Leave | `my-leave` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 13 | My Queries | `my-queries` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 14 | My Documents | `my-documents` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 13/10/2026 · AJ · ESS demo updated from the 12 October meeting. Desktop: photo upload on My Profile,
  work schedule inside Employment (read from LA's attendance data), year switcher and a deductions
  breakdown on My Payslips, pension text removed, three cards on My Queries (Open, Archived, Sanctions)
  with the build flowchart removed, leave approval text removed, Coming Soon preview for tabs not in M1.
  Mobile: icon cards that open the shared modal, previews on tap. New My Security tab (devices link to
  LA's My Devices). Demo gained a viewport tag and a mobile menu drawer. LA's four attendance tabs
  untouched on desktop; on a phone they get the same icon cards, built from her page. Guide
  `docs/guides/ess.md` written (Draft). My Security is not in the approved inventory (MILESTONES §18)
  and needs sign off. Demo only, no app screens, so no ticks.

### Staff Community

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 15 | Channels | `channels` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 16 | Direct Messages | `direct-messages` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 17 | Announcements | `announcements` | M1 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 13/10/2026 · GE · Demo updated per the 12 October meeting (guides removed, ＋ menu, members behind ⋮, fixed
  composer, read-only pinned #announcements, birthday and recognition cards, Praxis-style DMs with
  voice notes, mobile full screen). Engineering guide `docs/guides/community.md` written. No product code yet.

### Mailbox

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 18 | Inbox | `inbox` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 19 | Sent | `sent` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 20 | Drafts | `drafts` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 21 | Archive | `archive` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 22 | Spam | `spam` | M1 | GE | ☐ | ☐ | ☐ | Not started | |
| 23 | Trash | `trash` | M1 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 13/10/2026 · GE · Demo composer added (rich text, recipient chips, attachments with progress, schedule,
  inline discard), reader full screen on mobile. Engineering guide `docs/guides/mailbox.md` written.

### People

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 24 | Employees | `employees` | M0 | GE | ☐ | ☐ | ☐ | Not started | |
| 25 | Attendance | `attendance` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 26 | Leave | `leave` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 27 | Devices | `devices` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 28 | Worksites | `worksites` | M1 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 13/10/2026 · TB · Organogram agreed with the client rep and written up as
  `docs/guides/organogram.md`: two screens, People · Organogram (HR builder) and ESS · Org Chart
  (read-only viewer for all staff), over the live reporting tree. Proposed scope addition to the
  §18 inventory (85 to 87), pending ratification, so no numbered screen rows added here yet. A demo
  preview was added to `demo.html` for sign-off. What is left: ratify the inventory, assign owner
  and milestone, then add the rows and build.

### Performance

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 29 | Goals | `goals` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 30 | Targets | `targets` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 31 | KPIs | `kpis` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 32 | Reviews | `reviews` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |
| 33 | Analytics | `analytics` | M2 | AJ | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Queries & Sanctions

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 34 | Queries | `queries` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 35 | Rules | `rules` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 36 | Sanctions | `sanctions` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 37 | Letter Templates | `letter-templates` | M3 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Recruitment

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 38 | Vacancies | `vacancies` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 39 | Candidates | `candidates` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 40 | Assessments | `assessments` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 41 | Interviews | `interviews` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 42 | Offers | `offers` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 43 | Onboarding | `onboarding` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 44 | Talent Pool | `talent-pool` | M5 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Payroll

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 45 | Payroll Runs | `payroll-runs` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 46 | Payslips | `payslips` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 47 | Salary Structure | `salary-structure` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 48 | Deductions | `deductions` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 49 | Statutory | `statutory` | M6 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Partnerships

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 50 | Pipeline | `pipeline` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 51 | Partners | `partners` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 52 | Leads | `leads` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 53 | Proposals | `proposals` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 54 | Contracts & MOUs | `contracts-and-mous` | M7 | GE | ☐ | ☐ | ☐ | Not started | |
| 55 | Analytics | `analytics` | M7 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Expenses

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 56 | My Requests | `my-requests` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 57 | Approvals | `approvals` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 58 | Requisitions | `requisitions` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 59 | Disbursements | `disbursements` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 60 | Budgets | `budgets` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |
| 61 | Categories | `categories` | M8 | AJ | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Knowledge Hub

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 62 | Policies | `policies` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 63 | SOPs | `sops` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 64 | FAQs | `faqs` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 65 | Training | `training` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 66 | Announcements | `announcements` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Praxis AI

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 67 | Ask | `ask` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 68 | History | `history` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Settings

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 69 | Organisation | `organisation` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 70 | Users | `users` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 71 | Roles & Permissions | `roles-and-permissions` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 72 | Approvals | `approvals` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 73 | Attendance Policy | `attendance-policy` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 74 | Notifications | `notifications` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 75 | Appearance | `appearance` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 76 | Documents & Numbering | `documents-and-numbering` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 77 | Integrations | `integrations` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 78 | Security | `security` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 79 | Audit Log | `audit-log` | M9 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

### Public site · `go.mycityapp.io` (separate app)

| # | Screen | Path | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 80 | Careers | `/jobs` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 81 | Vacancy | `/jobs/<slug>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 82 | Apply | `/apply/<token>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 83 | Assessment | `/assess/<token>` | M4 | TB | ☐ | ☐ | ☐ | Not started | |
| 84 | Sign Offer | `/sign/<token>` | M5 | LA | ☐ | ☐ | ☐ | Not started | |
| 85 | Verify Document | `/verify/<number>` | M5 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

_None yet._

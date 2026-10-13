# MyCity Hub — Backend

The MyCity App ERP backend: one Express API and one worker, serving the staff app at
`hub.mycityapp.io` and the public site at `go.mycityapp.io`. Built by JBS Praxis, M0 to M11,
9 October to 18 December 2026.

This README is the map every engineer follows. It says **where every file for M0 to M11 lives, what
goes in it, and the rules a change must keep**. If you are about to create a file that is not in this
map, read §11 first.

---

## 1 · Read these before writing code

| Document | What it settles |
|---|---|
| `docs/MyCity-ERP-Documents/MILESTONES.md` | Scope, decisions A1 to A25, gates, schedule, each milestone's definition of done. **Binding** |
| `docs/MyCity-ERP-Documents/REUSE_MAP.md` | Which donor file each piece comes from. Wins over MILESTONES where they disagree |
| `docs/SYSTEM_ARCHITECTURE.md` | Servers, processes, request lifecycle, events, release pipeline |
| `docs/BACKEND_STRUCTURE.md` | The M0 foundation in detail: shared layer, contract, numbering, documents, imports, AI, pagination, first administrator |
| `docs/BACKEND_GUIDE.md` | **How to write backend code here**: layers, a worked endpoint, what to reuse, done checklist. Read before any backend change |
| `docs/FRONTEND_GUIDE.md` | **How to write frontend code here**: contract client, 25-per-page lists, ⓘ help, two shells. Read before any frontend change |
| `docs/guides/<module>.md` | One engineering guide per feature: every screen it touches and how they relate. A change passes through its guide first |
| `docs/PROGRESS.md` | The 85 screens and the M0 items, ticked as they are built, with a note per change |
| `CLAUDE.md` | What an AI assistant reads first: which documents to read for a backend, frontend or full-stack task, and how to finish one |
| `docs/MyCity-ERP-Documents/demo.html` | What the product looks like. UI and layout reference only, never a source for data or rules |

Donor code: `C:\praxis-ls` and `C:\pixie-girl-hub`. Port from them; never copy a file without the
changes the reuse map lists.

---

## 2 · Stack

PostgreSQL 16 · Node 20 + Express (CommonJS) · Redis + BullMQ · Socket.io · Zod · `pg` with
parameterised SQL (no ORM) · `decimal.js` for money · headless Chromium for PDFs · ffmpeg · ClamAV ·
Gemini (through `services/ai` only). Timezone Africa/Lagos. Currency NGN. English only.

---

## 3 · Repository map

```
mycity-app/
├── app/                      staff React + Vite app (frontend team), served at hub.mycityapp.io
├── public-app/               public React + Vite app (frontend team), served at go.mycityapp.io
├── src/                      backend source (§4, §5)
├── packages/contract/        Zod schemas + GENERATED contract.gen.ts (§6.2)
├── migrations/               NNNN_name.sql, block per milestone (§6.3)
├── seeds/build/              synthetic data, CI and local only
├── seeds/staging/            demonstration data, staging only. Never production
├── templates/documents/      PDF templates (HTML)
├── templates/email/          mail templates (HTML)
├── templates/import/         import template definitions
├── assets/brand/             logo vector masters, pin mark, app icons
├── assets/fonts/             Geist, for PDFs
├── scripts/
│   ├── ci-local.js           runs every CI gate locally, full report
│   ├── gen/                  contract and .env.example generators
│   ├── check/                the CI gates (§8)
│   │   └── lib/changes.js    what a change touched (git diff vs main) and its trailers,
│   │                         shared by check/progress.js, check/guides.js, check/readme-map.js
│   ├── db/                   migrate, seed, backup, restore-drill, create-admin
│   ├── import/               command-line import
│   └── deploy/               deploy-gate, release-manifest, verify-staging, rollback
├── ops/
│   ├── systemd/              four units + env templates
│   ├── provision/            server packages
│   ├── monitoring/           uptime probe (M11)
│   └── ssh/                  authorized_keys template for the deploy user
├── tests/
│   ├── unit/                 cross-module unit tests
│   ├── integration/          real Postgres + Redis (RUN_DB_TESTS=1)
│   └── staging/              verify-staging suite, runs against the staging hosts
├── docs/
│   ├── MyCity-ERP-Documents/ the client document pack
│   ├── BACKEND_GUIDE.md      how to write backend code (read first)
│   ├── FRONTEND_GUIDE.md     how to write frontend code (read first)
│   ├── PROGRESS.md           85 screens + M0 items, updated with every change
│   ├── guides/               one engineering guide per feature, from _TEMPLATE.md
│   ├── runbooks/             deploy, rollback, backup-restore, incident, monitoring, add-a-module,
│   │                         proxy (the hosting panel's proxy settings), github-settings (TB applies)
│   └── manual/               user manual, one file per module (M11, written as each ships)
├── .github/
│   ├── workflows/            ci.yml (runs `npm run ci`), release.yml, rollback.yml
│   ├── CODEOWNERS            who must approve each path (checked by check/codeowners.js)
│   └── pull_request_template.md
├── .claude/
│   ├── settings.json         registers the Stop hook for everyone using Claude Code here
│   └── hooks/stop-check.js   runs the process gates before Claude may finish a task
├── package.json · package-lock.json · .nvmrc (Node 20) · eslint.config.js · jest.config.js
└── CLAUDE.md                 what an AI assistant reads first
```

**About `.gitkeep`.** Git does not track empty folders, so a folder with nothing in it would not
exist in a fresh clone. These folders hold a `.gitkeep` placeholder so the layout above survives:
`app`, `public-app`, `assets/brand`, `assets/fonts`, `migrations`, `seeds/build`, `seeds/staging`, `tests/unit`,
`tests/integration`, `tests/staging`. The file is empty and has no meaning to any tool.

When you add the first real file to one of these folders, **delete its `.gitkeep` in the same
commit**. A `.gitkeep` next to real files is clutter, and in `migrations/` the runner must see only
`NNNN_name.sql` files. Do not add `.gitkeep` anywhere else: an empty source file already keeps its
folder.

---

## 4 · `src/` outside the modules

These are built in M0. A milestone fills in a file listed here when its first consumer arrives; it
never creates a second copy of the concern inside a module.

```
src/
├── server.js · worker.js · app.js
├── config/        env · logger · db · redis · request-context · build-info
├── http/          routes · module-loader · route (contract-aware) · health
├── middleware/    async-safe · request-id · access-log · environment-marker · rate-limit ·
│                  idempotency · auth · rbac · public-token · upload · error-handler
├── shared/
│   ├── errors.js · route-map.js
│   ├── db/            tx · query-helpers · pg-types · effective-dated
│   ├── crud/          resource (makeRepo / makeService / makeController / makeRouter)
│   ├── http/          validate · paged (THE pagination gate, 25 per page) · body-limits · respond
│   ├── events/        emit · outbox · catalogue
│   ├── workflow/      engine · conditions · definitions · approvers
│   ├── access/        access.catalog (the permission module list)
│   ├── rbac/          grants-cache · field-mask · scope
│   ├── money/         money
│   ├── time/          lagos · working-week · day-first · recurrence
│   ├── numbering/     numbering · schemes
│   ├── files/         sniff · mime-policy · hash · safe-name
│   ├── documents/     vault · generate · render · markdown · canonical
│   ├── templates/     template-store · variables
│   ├── spreadsheet/   parse · build · csv · cells · day-first-cells
│   ├── import/        engine · mapping · registry · report · revert
│   ├── tokens/        public-token
│   ├── rules/         window-counter
│   ├── alerts/        alerts
│   ├── state/         state-history
│   ├── dedup/         dedup
│   ├── geo/           geo
│   ├── notifications/ categories · fanout
│   ├── search/        provider · registry · search.service
│   ├── ai/            manifest · registry · catalogue-sync · authorise · cite
│   └── observability/ scrub · metrics · error-reporter
├── services/
│   ├── storage/       storage.service
│   ├── media/         image-pipeline · av-pipeline · scan · reconcile
│   ├── pdf/           chromium · pdf.service
│   ├── mail/          system-mail.service · deliverability/{route-check, dns-check}
│   ├── secrets/       encryption.service
│   ├── ai/            llm.service · governance · ledger · redact · structured · transcription ·
│   │                  vendors/{gemini, stub} · prompts/*.md · assistant/* (M10)
│   ├── push/          web-push (M6)
│   ├── calendar/      ics
│   ├── qr/            qr
│   └── realtime/      emitter
├── realtime/      socket
└── jobs/
    ├── queues.js · registry.js · cron-lock.js
    ├── handlers/      one file per queue (table in §5.15)
    ├── schedulers/    one file per recurring job
    └── loops/         long-running loops (mail-idle)
```

---

## 5 · Modules, milestone by milestone

### 5.1 The shape every module follows

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

Aggregator modules (`ess`, `workspace`, `partnership_analytics`) read through other modules'
services and have no repo of their own.

### 5.2 Permission keys

The staff app has **15 modules** (MILESTONES §18); those are the permission keys in
`shared/access/access.catalog.js`. A backend module declares which key guards it.

| Permission key | Backend modules |
|---|---|
| `home` | `dashboard`, `alerts`, `reports` |
| `workspace` | `workspace`, `tasks`, `calendar` |
| `ess` | `ess` (always `own` scope) |
| `community` | `community`, `announcements` |
| `mailbox` | `mailbox` |
| `people` | `organisation`, `attendance`, `devices`, `worksites`, `leave` |
| `performance` | `goals`, `targets`, `kpis`, `reviews` |
| `queries` | `queries`, `query_rules`, `sanctions` |
| `recruitment` | `vacancies`, `candidates`, `assessments`, `interviews`, `offers`, `onboarding`, `employment_contracts`, `talent_pool` |
| `payroll` | `payroll`, `payslips`, `salary_structure`, `deductions`, `statutory` |
| `partnerships` | `partners`, `partner_pipeline`, `leads`, `interactions`, `proposals`, `agreements`, `partnership_analytics` |
| `expenses` | `expenses`, `requisitions`, `disbursements`, `budgets`, `expense_categories` |
| `knowledge` | `knowledge` (announcements are read here too) |
| `praxis_ai` | `assistant`, `ai_governance` |
| `settings` | `identity`, `access`, `audit`, `settings`, `notifications`, `workflow`, `documents`, `imports`, `users`, `security`, `integrations`, `templates`, `signatures` |

The settings modules that every user touches (`identity` login, own `notifications`, own `documents`)
check ownership, not the `settings` grant.

### 5.3 M0 · Foundation · GE, LA · 9 to 19 Oct

| Module | Files beyond the template | Does |
|---|---|---|
| `identity` | | Login, refresh, logout, me, sessions, known devices |
| `access` | | Roles, grants, record scope, field visibility |
| `audit` | | Audit ledger read |
| `organisation` | `employee.import.js`, `employee-360.service.js` (M1) | Departments, employees, reporting lines; staff importer; employee 360 |
| `settings` | `settings.appearance.js` (M9) | Settings, working week, holidays, numbering schemes |
| `notifications` | `notifications.preferences.js`, `notifications.reminders.js` (M6) | Caller's own inbox |
| `workflow` | | Definitions, act on an instance, my approvals |
| `documents` | | Upload, download, versions, generated documents |
| `imports` | | Generic import API: upload, map, preview, commit, report, revert |

### 5.4 M1 · Core Operations & Employee Management · TB, LA, AJ, GE · to 19 Oct

| Module | Owner | Files beyond the template |
|---|---|---|
| `dashboard` | TB | `kpi-catalog/{index, eligibility, guards}.js`, `kpi-catalog/tiles/{people, work, business, finance}.js` |
| `alerts` | TB | |
| `reports` | TB | |
| `attendance` | LA | `.rules` (wall clock, working week), `.lateness`, `.clock-guard`, `.reconcile`, `.auto-query`, `.analytics`, `.export`, `.calendar` |
| `devices` | LA | `.guard` |
| `worksites` | LA | |
| `leave` | AJ | `.balance`, `.clash` |
| `ess` | AJ | `.profile`, `.earnings`, `.attendance`, `.documents` (aggregator) |
| `community` | GE | `.presence`, `.media`, `.links`, `.recognition` (A19), `.celebrations` (A20), `.export` |
| `announcements` | GE | |
| `mailbox` | GE | `providers/imap-smtp.provider.js`, `threads.{repo,service}`, `threading`, `send-queue.{repo,service}`, `folders`, `autodiscover`, `smtp-errors`, `compose`, `access`, `visible`, `find`, `presend`, `attachments.service`, `schedule`, `origin`, `mail-notify` |

Shared pieces first filled in M1: `middleware/upload`, `shared/files`, `shared/documents/vault`,
`services/media/image-pipeline`, `services/media/av-pipeline` (voice notes), `shared/geo`,
`shared/alerts`, `shared/spreadsheet` (exports), `realtime/socket` (presence).

**M1 mailbox rule:** cut the five `require` lines into triage, binding and assist before anything else
(MILESTONES §6.5). `mailbox/binding/` stays empty until M7.

### 5.5 M2 · Productivity & Performance · AJ, TB, GE · 20 to 23 Oct

| Module | Files beyond the template |
|---|---|
| `tasks` | `.audience` (reporting line scope), `.blockage`, `.recurrence` |
| `calendar` | |
| `workspace` | `.today`, `.analytics` (aggregator) |
| `goals` | `.cascade`, `.trace` (KPI → organisational goal), `.approval` (A16) |
| `targets` | `.progress`, `.approval` |
| `kpis` | `.weights` (must total 100) |
| `reviews` | `.cycle`, `.sequence` (self rating first, A17), `.autoscore`, `.metrics`, `.pdf`, `.dictation` (A18), `.analytics` |

Shared first filled: `shared/time/recurrence`, `services/calendar/ics`, `services/ai`
(`llm.service`, `transcription`, prompt `review-cleanup.md`).

### 5.6 M3 · Queries & Consequence Management · GE · 26 to 30 Oct

| Module | Files beyond the template |
|---|---|
| `queries` | `.visibility` (a manager sees only queries they raised), `.response`, `.escalate` |
| `query_rules` | `.evaluator` (outbox subscriber: N events in a window) |
| `sanctions` | `.chain` (workflow definition), `.fines` (pending deduction for M6), `.letters` |
| `templates` | Editable letter templates (M3), mail templates (M5) |

Shared first filled: `shared/rules/window-counter`, `shared/documents/generate`,
`shared/templates`. Templates: `query-letter`, `caution-letter`, `warning-letter`,
`suspension-letter`, `suspension-without-pay-letter`, `termination-letter`.

### 5.7 M4 · Recruitment End to End · TB, LA, AJ · 2 to 13 Nov

| Module | Files beyond the template |
|---|---|
| `vacancies` | `.public.routes` (careers list, vacancy by slug), `.lifecycle` (DRAFT, OPEN, PAUSED keeps the link, CLOSED), `.slug`, `.draft` (AI JD), `.questions` |
| `candidates` | `.public.routes` (apply, write only), `.pipeline`, `.screening` (provisional flag), `.scorecard` (A10 weights), `.sla` |
| `assessments` | `.public.routes` (take, token), `.authoring`, `.delivery`, `.timer` (server side), `.scoring` |
| `interviews` | `.panel` (blind until the round closes), `.consolidate`, `.schedule` (ICS), `.notes` (AI cleanup) |

Shared first filled: `shared/tokens`, `middleware/public-token`, `services/media/scan` (ClamAV),
`shared/state/state-history`. Prompts: `jd-draft`, `cv-screen`, `screening-questions`,
`interview-notes-cleanup`. Gate 19 switches on.

### 5.8 M5 · Offers, Documentation & Onboarding · LA, GE · 16 to 20 Nov

| Module | Files beyond the template |
|---|---|
| `offers` | `.public.routes` (sign), `.render` (one markdown renderer for web and PDF), `.expiry` |
| `signatures` | `.public.routes` (verify, two verdicts), `.certificate`, `.signed-pdf`, `.verify` |
| `onboarding` | `.public.routes` (candidate document upload), `.checklist` (documentation before onboarding), `.plans`, `.sop` |
| `employment_contracts` | `.lifecycle` |
| `talent_pool` | `.retention` (24 months then purge) |

Shared first filled: `shared/documents/canonical` (A12), `services/qr`. Templates: `offer-letter`,
`offer-packet`, `employment-contract`, `signature-certificate`, and the recruitment mails.

### 5.9 M6 · Payroll & Notifications · LA, AJ · 23 to 27 Nov

| Module | Files beyond the template |
|---|---|
| `payroll` | `.calc` (pure, no DB), `.inputs` (attendance, accepted deductions), `.run`, `.lock`, `.config.repo` (effective dated) |
| `payslips` | `.pdf`, `.breakdown` |
| `salary_structure` | |
| `deductions` | `.acceptance` (nothing deducts itself) |
| `statutory` | `.rates`, `.report` (off by default; bands from current law, never the donor's) |

Also: `notifications.preferences`, `notifications.reminders`, `services/push/web-push`,
`settings` Notifications screen. The daily rate divides by the working days from
`shared/time/working-week` (A22), never by a constant.

### 5.10 M7 · Partnerships, CRM & Trackers · GE, LA · 30 Nov to 4 Dec

| Module | Files beyond the template |
|---|---|
| `partners` | `.360` (renders correctly with zero data), `.dedup`, `.import` (the tracker) |
| `partner_pipeline` | `.stages` (MyCity's twelve, in order), `.types` (configurable, A21), `.inactivity` |
| `leads` | `.convert` |
| `interactions` | |
| `proposals` | `.questionnaire`, `.draft` (AI), `.pdf` |
| `agreements` | `.lifecycle` (Draft to Renewed/Closed, workflow definition), `.renewals` |
| `partnership_analytics` | `.queries` (per lead owner, A21) |
| `mailbox/binding/` | `intake.service`, `mail-context.service`, `context-tabs`, `convert.service` |

Shared first filled: `shared/dedup`. Prompts: `proposal-draft`, `mou-draft`. Templates: `proposal`, `mou`.

### 5.11 M8 · Expenses & Budget Control · AJ · 7 to 11 Dec

| Module | Files beyond the template |
|---|---|
| `expenses` | `.receipt-ai`, `.duplicates`, `.budget-check` (flag before approval) |
| `requisitions` | `.lines` (one requisition, many requests; a line at or above its category threshold needs its own CEO tick) |
| `disbursements` | Bank transaction reference enforced by a database trigger |
| `budgets` | `.variance` (ships empty, A25) |
| `expense_categories` | Threshold lives on the category |

Chain for every request: requester, line manager, Operations, requisition, CEO, disbursed
(MILESTONES §13).

### 5.12 M9 · Settings & Governance · GE · 7 to 11 Dec

| Module | Files beyond the template |
|---|---|
| `users` | `.invite` |
| `security` | `.mfa` (TOTP), `.sessions` (remote kill), `.events` |
| `integrations` | |
| `settings` | `settings.appearance.js` |

Four permission layers: module, action, record scope, field. No entity layer (A2).

### 5.13 M10 · Staff Knowledge Hub & AI Assistance · TB, GE · 14 to 18 Dec

| Module | Files beyond the template |
|---|---|
| `knowledge` | `.versions`, `.embeddings` (policies, SOPs, FAQs, training) |
| `assistant` | `.history` (Ask, History). Engine in `services/ai/assistant/{orchestrator, retrieval, embeddings, answer, conversation.repo}.js` |
| `ai_governance` | Spend cap, model, per-module switch |

The assistant **reads only** (A23). It answers from the manifests every module has carried since M1.

### 5.14 M11 · Handover & Training · TB, all · 14 to 18 Dec

No new modules. Fills `docs/manual/*.md` (one per staff module plus the public site),
`docs/runbooks/*.md`, `ops/monitoring/uptime-probe.js`, and runs the restore drill
(`scripts/db/restore-drill.js`).

### 5.15 Background jobs by milestone

| Milestone | Handlers (`jobs/handlers/`) | Schedulers (`jobs/schedulers/`) |
|---|---|---|
| M0 | `email-send`, `pdf-render`, `notification-deliver`, `media-derive`, `media-scan`, `av-transcode`, `import-validate`, `import-commit` | `outbox-dispatch`, `workflow-timeout`, `alert-ageing`, `media-reconcile`, `import-cleanup` |
| M1 | `celebrations`, `mail-sync`, `attendance-day-close`, `scheduled-report`, `announcement-publish` (delayed, scheduled announcements) | `celebrations`, `mail-sync`, `attendance-day-close`, `scheduled-reports`; loop `loops/mail-idle` |
| M2 | `task-recurrence`, `review-cycle-open` | `task-recurrence`, `review-cycles` |
| M3 | `query-rule-evaluate` | |
| M4 | `assessment-expire`, `interview-feedback-reminder` | `assessment-expiry`, `interview-reminders` |
| M5 | `offer-expiry`, `signature-reminder`, `onboarding-dispatch`, `talent-pool-purge` | `offer-expiry`, `signature-reminders`, `talent-pool-purge` |
| M6 | `payroll-compute`, `payslip-render`, `reminders` | `reminders` |
| M7 | `partner-inactivity`, `agreement-renewal` | `partner-inactivity`, `agreement-renewals` |
| M8 | `budget-threshold`, `approval-ageing` | `budget-threshold`, `approval-ageing` |
| M10 | `knowledge-embed` | |

Every scheduler takes `cron-lock` so a restart overlap cannot double-fire. Every handler is
idempotent: the outbox and BullMQ both deliver at least once.

---

## 6 · How data moves

### 6.1 One write path

Every write goes through the module's **service**. A form, a workflow decision, a screen the
assistant routes to, and a spreadsheet import all call the same function, so numbering, audit,
events and field rules apply the same way whatever the entry point. A repo never writes on behalf of
another module; call that module's service.

### 6.2 The contract (snake_case on the wire)

- Every body, query, path parameter and response is a Zod schema in
  `packages/contract/schemas/<module>.js`.
- Routes declare it: `route(router, "post", "/", { body, response }, handler)`.
- `npm run gen:contract` writes `packages/contract/contract.gen.ts`. **Never edit that file.** CI
  regenerates it and fails on any difference.
- Field names are `snake_case` and match the table columns. A key that is not a column is declared
  `virtual` with a reason.
- The frontend imports only from `@mycity/contract`; it may not declare its own Zod schemas.

### 6.3 Migrations

- `migrations/NNNN_name.sql`, each with `-- UP` and `-- DOWN`, idempotent, `created_at` and
  `updated_at timestamptz` on every table.
- **Number blocks per milestone**, so parallel work never collides:

| Milestone | Block | Milestone | Block |
|---|---|---|---|
| M0 | 0001 to 0999 | M6 | 6000 to 6999 |
| M1 | 1000 to 1999 | M7 | 7000 to 7999 |
| M2 | 2000 to 2999 | M8 | 8000 to 8999 |
| M3 | 3000 to 3999 | M9 | 9000 to 9999 |
| M4 | 4000 to 4999 | M10 | 10000 to 10999 |
| M5 | 5000 to 5999 | M11 | 11000 to 11999 |

- A merged migration is never edited. A change is a new file.
- Destructive steps (drop, rename, type change) are declared in the file header and ship one release
  after the code that stops using the column.
- Money columns are `numeric(18,2)`. IDs are `uuid` with `gen_random_uuid()`.
- Each milestone's migration adds the numbering schemes and workflow definitions it introduces.

### 6.4 Events and the outbox

`emit(client, event)` inside the service's transaction writes `event_log`, `audit_ledger` and
`event_outbox` together. Anything that must happen after (notifications, rule evaluation, PDF
rendering, search reindex, realtime push) is an outbox handler registered in `<module>.events.js` and
run by the worker after commit. Never send mail, render a PDF or call AI inside a request transaction.

### 6.5 Workflow

Approvals are definitions over `shared/workflow/engine.js` (Pixie's engine, ported). Adding a step is
data, not code. Services call `openInstance()` inside their transaction and react to
`workflow.completed` in an outbox handler.

---

## 7 · Rules that are not optional

1. **Money** through `shared/money` (`decimal.js`), `numeric(18,2)`, strings on the wire. Never
   `Number()`, `parseFloat` or `+` on money.
2. **Dates** ISO `YYYY-MM-DD` on the wire and in the database; day-first (`09/10/2026`) wherever a
   person reads one, PDFs and exports included. Business days come from `shared/time/working-week`.
3. **Numbers** for documents come from `numbering.allocate(client, type)` inside the transaction.
   Never `MAX()+1`, never a Postgres sequence, never reused.
4. **Files** go through `middleware/upload` and `shared/documents/vault`. A module stores a
   `document_id`, never a path. Hash the master the pipeline returns, never the bytes received.
5. **AI** through `services/ai/llm.service` only. No vendor SDK imports anywhere else. Output is
   provisional until a person accepts it.
6. **AI manifests** (`<module>.ai.js`): reads with a permission and a citation, and routes to a
   screen. Never a write (A23).
7. **Search providers** (`<module>.search.js`) for every module with records.
8. **Permissions**: every staff route runs `auth` then `requirePermission(key, action)`. Actions are
   `view create edit delete approve export`; it is `edit`, never `update`. Repos honour `req.scope`.
9. **Public routes** (`*.public.routes.js`) never import `auth` or `rbac`; they read through an
   allow-listed shape and are reached by token, or by slug for careers and vacancies only.
10. **Errors** are `AppError(code, message, status, fields)`. No SQL or stack trace reaches a client.
11. **Copy a person reads** (mail, PDFs, exports): no em dashes, Title Case for chrome.
12. **Production data**: never seeded. Real records reach production by people using the product or
    through the import engine.
13. **Pagination**: every list pages at 25 on the server through `shared/http/paged.js`
    (`pageQuery`, `sendPaged`). No `LIMIT`/`OFFSET` in a repo, no page-size key in the contract or
    the frontend, AI reads included. The one exception is `completeQuery()` with a
    `// pagination:complete <reason>` marker (BACKEND_STRUCTURE §16).
14. **No login without an employee.** The first administrator comes from `scripts/db/create-admin.js`
    (full employee, login and role in one transaction); everyone else is created in the app
    (BACKEND_STRUCTURE §17).

---

## 8 · CI gates

`npm run ci` runs every gate in CI's order and reports all failures, not the first.

| Gate | From | Script |
|---|---|---|
| 1 Lint | M0 | `eslint` |
| 2 Tests, whole suite | M0 | `jest` |
| 3 Migration numbering | M0 | `check/migration-numbers.js` |
| 4 Migration reversibility | M0 | `check/migration-reversibility.js` |
| 5 Migration idempotency | M0 | `check/migration-idempotency.js` |
| 6 Schema drift | M0 | `check/schema-drift.js`, `check/contract-columns.js` |
| 7 Write routes validated | M0 | `check/route-contracts.js` |
| 8 Five-second rule | M0 | frontend; backend half `check/dashes.js` |
| 9 AI manifest coverage | M1 | `check/ai-manifest-coverage.js` |
| 10 Search coverage | M1 | `check/search-coverage.js` |
| 11 to 14, 16, 18 | M1 | frontend gates |
| 15 Day-first dates | M1 | `check/date-format.js` |
| 17 No dashes | M1 | `check/dashes.js` |
| 19 AI read manifest only | M4 | `check/ai-no-writes.js` |
| 20 Money | M6 | `check/money.js` |

Pipeline guards from M0: `gen:contract --check`, `check/env-template.js`, `check/module-catalogue.js`,
`check/public-surface.js`, `check/numbering-schemes.js`, `check/production-environment-refs.js`,
`check/ai-vendor-imports.js`, `check/shell.js`, `check/pagination.js`.

Process gates, from M0. They check that the work is recorded where the team reads it:

| Gate | Script | Fails when |
|---|---|---|
| Progress | `scripts/check/progress.js` | Product code changed and `docs/PROGRESS.md` gained no dated note; or the file is malformed (85 rows, statuses, ticks, day-first dates, summary counts) |
| Guides | `scripts/check/guides.js` | Code a guide covers changed and the guide gained no Change log line; or a guide lost a template section or is missing from the index |
| README map | `scripts/check/readme-map.js` | A new file is neither where the map says files go nor named in this README |
| CODEOWNERS | `scripts/check/codeowners.js` | A placeholder or invalid username, a path with one owner, a renamed path, or a module or guide with no owner line |

The first two accept a reason instead, as a line in the PR description or a commit message:
`Progress-unchanged: <reason>` or `Guide-unchanged: <reason>`.

**Not built is not passed.** A gate whose script is still an empty file is reported as NOT BUILT
and listed at the end of `npm run ci`; it checks nothing yet. `npm run ci:list` shows each gate's
state. Once M0 is complete, CI runs with `CI_STRICT=1` and a NOT BUILT gate fails the build.

**Run `npm run ci` before every push.** A single test file passing is not evidence about the suite.

---

## 9 · Branches, review and release

1. Branch from `main`: `m<N>/<short-name>` (for example `m3/query-rules`).
2. PR title in Conventional Commits form: `feat(queries): raise a query on the third late arrival`.
3. One approving review, not the author, and from a code owner of every path the PR touches
   (`.github/CODEOWNERS`). The `ci` check green. `main` is protected with no bypass, the
   repository owner included (`docs/runbooks/github-settings.md`). Collaborators push branches and
   open PRs; nobody pushes to `main`.
4. Merge to `main` deploys to **staging** automatically, runs the staging verification, and seals the
   build.
5. **Production** waits for an approver (GE or TB) who did not trigger the release, after testing on
   `hub.staging.mycityapp.io`. Production then receives the exact files staging ran.
6. No production release between 21 December and 5 January.
7. Rollback goes through `rollback.yml`, with the same approval.

Full detail: `docs/SYSTEM_ARCHITECTURE.md` §9.

---

## 10 · Local setup

```
nvm use                      # Node 20 (.nvmrc)
npm ci                       # exact versions from package-lock.json
cp .env.example .env         # fill DB, Redis, JWT secrets
npm run db:migrate           # against your local database
npm run db:seed -- --build   # synthetic data; refuses on staging and production
npm run dev                  # API
npm run dev:worker           # worker
npm run gen:contract         # after any schema or route change
npm run ci                   # before every push
```

The seed command checks `APP_ENV`, the database name and the `system_marker` row, and refuses unless
all three say this is not production.

First login on a fresh local or staging database:

```
node scripts/db/create-admin.js --sample   # sample employee profile; asks email, role, password
```

On production, run it without `--sample` and enter the real person's details
(BACKEND_STRUCTURE §17).

---

## 11 · Adding something not on this map

1. If it is a feature of an existing module, it is a `<module>.<topic>.js` file in that module.
2. If two modules need it, it goes in `src/shared/` or `src/services/`, in the folder whose name says
   what it is; add it to §4 of this README in the same PR.
3. A new module needs: its folder in the §5.1 shape, its schema file in `packages/contract`, its
   permission key mapped in `access.catalog.js` and §5.2 above, its migration in its milestone's
   block, and its `.ai.js` and `.search.js`.
4. Never a second copy of a shared concern (a module-local mailer, money helper, date formatter,
   file store or AI client). CI checks several of these; review checks the rest.

---

## 12 · Team

| Initials | Name | Owns |
|---|---|---|
| GE | Godwin-Okoh Elisha | Architecture, schema, M0, M3, M7, M9; community and mailbox in M1 |
| TB | Tom-Blake Asaah | Dashboard (M1), M4, M10, M11 |
| LA | Love Adeola | Migrations and data (M0), attendance (M1), M5, M6 |
| AJ | Adole Jerome | Frontend foundation, ESS (M1), M2, M8 |

Engineered by [JBS Praxis](https://jbspraxis.com).

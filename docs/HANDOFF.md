# MyCity Hub — Handoff for the next session

**Written 12 October 2026, 14:40 Lagos time.** Read this first, then `README.MD`, then the
documents it points to. Everything below is the state at the end of the session that produced the
architecture and the empty repository.

---

## 1 · Who and what

- **User:** Godwin-Okoh Elisha ("Wizzy"), GE on the JBS Praxis team. Owns architecture, schema and
  M0 (foundation). Backend/full-stack, Node/Express, PostgreSQL, Linux VPS.
- **Team:** Tom-Blake Asaah (TB), Love Adeola (LA), Adole Jerome (AJ). Tom-Blake is a colleague, not
  the user.
- **Client:** MyCity App Ltd (Lagos). Operations contact: Cynthia Osakunih. CEO: Ifeoma Chukwu (as
  used in the demo; confirm before relying on it).
- **Product:** MyCity App ERP. Staff app `hub.mycityapp.io`, separate public site `go.mycityapp.io`,
  staging twins `hub.staging.` / `go.staging.`. Eleven contracted milestones (M1 to M11) plus M0,
  9 October to 18 December 2026, ₦3,200,000 over the eleven weights. No production release
  21 December to 5 January.

---

## 2 · How this user works (follow it)

- Short prompts, raw context. Expects finished output, not upfront questions. Ask only when a
  decision genuinely blocks the work.
- **Do not run tests, scripts or a browser unless he asks or approves.** (He explicitly asked for the
  HTML files to be rendered once; that was approval for that task only.) Reading files with
  `ls`/`cat`/`grep` is fine.
- Prefers files delivered directly, not branch pushes. Do not commit to git unless asked; he commits
  himself (`main` has one commit, "Project started: Building project foundation.").
- **"Edit, don't rewrite"** when he says so: use targeted edits on existing documents.
- **When he says "leave empty", files are created with zero bytes, no `.gitkeep`, and no migration
  files.**
- He corrected scope once and then reversed the correction: a version that moved later-milestone
  features out of M0 (BACKEND_STRUCTURE v1.2) was rejected; **v1.1 is the accepted version.** Do not
  re-trim M0.
- He wants nothing missed or skipped. He reads closely and will catch omissions.

---

## 3 · Where everything is

### On his computer (linked through the Claude desktop app)

| Path | What |
|---|---|
| `C:\mycity-hub\` | The new repository. Git initialised, one commit. **All code files are empty** |
| `C:\mycity-hub\README.MD` | Engineer guide (filled, 28 KB). Note the uppercase `.MD`, his choice |
| `C:\mycity-hub\docs\SYSTEM_ARCHITECTURE.md` | System architecture v1.0 + edits (filled) |
| `C:\mycity-hub\docs\BACKEND_STRUCTURE.md` | Backend structure v1.1 + AI and offline sections (filled) |
| `C:\mycity-hub\docs\MyCity-ERP-Documents\` | Client pack: `MILESTONES.md` (v1.4), `REUSE_MAP.md`, `MILESTONE_QUESTIONS.md`, `INDEX.md`, `EMAIL-naming-approval.md`, `milestones.html`, `demo.html` |
| `C:\praxis-ls\` | Donor repo 1 (multi-tenant logistics ERP, Cameroon). Has a `CLAUDE.md` worth reading |
| `C:\pixie-girl-hub\` | Donor repo 2 (multi-brand Nigerian ERP). Has a `CLAUDE.md` worth reading |

Folder access already granted this session: `C:\` (whole drive), `C:\praxis-ls`, `C:\pixie-girl-hub`.
In the device shell they mount as `$HOME/mnt/c`, `$HOME/mnt/praxis-ls`, `$HOME/mnt/pixie-girl-hub`.

### Document authority

1. `MILESTONES.md` v1.4 is binding for scope and decisions A1 to A25.
2. `REUSE_MAP.md` **wins over** `MILESTONES.md` where they disagree (user ruling).
3. `demo.html` is a **look-and-feel reference only**. Its data contradicts the documents in many
   places; that is accepted and must not be "fixed" or used as a source of rules or data.
4. `SYSTEM_ARCHITECTURE.md` and `BACKEND_STRUCTURE.md` are the engineering design produced this session.
5. `README.MD` is the map for engineers and the place new files are recorded.

---

## 4 · Decisions made this session (user rulings)

| # | Decision |
|---|---|
| 1 | `REUSE_MAP.md` wins over `MILESTONES.md`. Workflow engine is **Pixie's, ported** (A11 updated) |
| 2 | **A23 holds**: AI reads only; writes are routed to the owning screen. No write contract anywhere |
| 3 | §18.2 unregistered-route gate is **gate 10** (was wrongly 15) |
| 4 | **No entity permission layer.** Four layers: module, action, record scope, field |
| 5 | **Expenses reconciled**: one chain for every request: requester → line manager → Operations → requisition → CEO → disbursed. Category threshold does not add a step; a line at or above its category threshold needs its own CEO tick inside the requisition; removed lines return to Operations. No flat ₦500,000 hierarchy |
| 6 | Demo is for visuals only |
| 7 | PAYE bands and statutory rates come from current Nigerian law at M6; never the donor's or the demo's |
| 8 | **Public site stays a separate app** on `go.mycityapp.io` (A9). User said "leave public site for now"; `REUSE_MAP.md` §1.3 still says otherwise and was deliberately not changed |
| 9 | **Wire casing: `snake_case`** everywhere, matching DB columns |
| 10 | Mobile layout is built alongside desktop in React + Vite by the frontend team; the backend design does not cover frontend |
| 11 | Staging must be tested and **approved by a person before anything reaches production** (design in SYSTEM_ARCHITECTURE §9) |
| 12 | Offline/sync is **out of scope** (BACKEND_STRUCTURE §15 records why and what exists if it is ever added) |

Edits already applied to the client pack for rulings 1 to 5 and 7: `MILESTONES.md` is v1.4
(A11 rewritten, gate wording, write contract removed, four layers, §13 reconciliation, PAYE note),
`REUSE_MAP.md` §9 and §11 amended, `milestones.html` deck corrected (M5/M10 reuse, gate 19 label,
eight gates at M0, no em dashes, v1.4).

---

## 5 · The design in brief

Full detail is in the two architecture documents; this is the spine.

- **Processes:** per environment, one API (`src/server.js`) and one worker (`src/worker.js`). Four
  systemd units on one server (4 vCPU, 8 GB, 80 GB). nginx, Let's Encrypt.
- **Data:** PostgreSQL 16, `mycity_prod` / `mycity_stg`, separate roles, no cross-grants. Redis db 0/1
  with BullMQ prefixes `mycity:prod` / `mycity:stg`. `system_marker` row in each DB; seed tooling
  refuses production. Production is never seeded.
- **Surfaces:** staff API `/api/v1/*` on `hub.`; public API `/api/public/v1/*` on `go.`; nginx
  allow-lists paths per host. Modules declare `surface` per routes file (`*.public.routes.js`).
- **Events:** one `emit()` in the service transaction writes `event_log` + `audit_ledger` +
  `event_outbox`; the worker runs named, idempotent handlers after commit. Fixes Praxis's
  in-transaction fan-out and Pixie's pre-commit EventEmitter.
- **Workflow:** Pixie engine ported; `business` column dropped; events go through the outbox; money
  conditions use `decimal.js`; approvers `role | user | manager_of_subject`; CEO = `app_user.is_ceo`.
- **Contract:** Zod schemas in `packages/contract/schemas/`; routes declare `{ body, query, params,
  response }` via `route()`; `npm run gen:contract` generates `contract.gen.ts` (types + `Endpoints`
  map + runtime schemas). CI fails if stale, hand-edited, non-snake_case, a key is not a column, or a
  route lacks a contract. Frontend may not declare its own Zod.
- **Numbering:** one allocator, inside the caller's transaction, counter row locked, gap-free, never
  reused, scheme is data, missing scheme fails readiness. Proposed prefixes in BACKEND_STRUCTURE §7.
- **Documents/media:** one `document` table for every file (versions, lock, sensitivity, polymorphic
  attachment); upload sniffs bytes; image pipeline (photo/document/avatar), ffmpeg for voice/video,
  ClamAV for stranger uploads; Node checks access then nginx streams via `X-Accel-Redirect`;
  `documents.generate()` numbers, renders, PDFs, stores, hashes, locks.
- **Imports (v1.1 puts engine + staff importer in M0):** upload, detect header, map with remembered
  profiles, day-first coercion, validate with the create-API schema, match, preview = real run rolled
  back, commit through services, error file, history, revert. Staff importer resolves line managers in
  a second pass. **A14 in MILESTONES still says M7; amendment offered, not yet approved.**
- **AI:** everything through `services/ai/llm.service.js` (governance cap, redact, versioned prompt
  files, Gemini or stub, structured Zod output, ledger). Output provisional until accepted. Module
  `.ai.js` manifests declare reads (with permission and citation) and screen routes; a `write` key is
  rejected. Catalogue synced on deploy. M10 assistant in `services/ai/assistant/`.
- **Release (SYSTEM_ARCHITECTURE §9):** PR → CI → merge → `release.yml`: build → deploy staging →
  automated verify → seal (tree hash) → **wait for approval** (GitHub `production` environment, GE or
  TB, self-review blocked, prod SSH key only released after approval) → promote by hard-linking the
  sealed staging tree into production (no rebuild) → readiness → tag. Server-side forced-command
  `deploy-gate` with key-scoped verbs. Migrations run only inside stage/promote, after a dump. Freeze
  21 Dec to 5 Jan enforced in promote.

---

## 6 · Repository state

`C:\mycity-hub` has about 1,011 files outside `.git`, **all empty except** `README.MD`, the two
architecture docs, and the client pack. 63 modules in `src/modules/` (9 for M0, 54 for M1 to M11),
schema files per module in `packages/contract/schemas/`, jobs, prompts, templates, CI check scripts,
ops files, runbooks and manual stubs. Empty directories with no files: `migrations/`, `seeds/build`,
`seeds/staging`, `assets/brand`, `assets/fonts`, `tests/{unit,integration,staging}`. Git does not track
empty directories; the user knows.

The full module list, file conventions, permission-key mapping, jobs per milestone and migration
number blocks (M0 0001 to 0999, M1 1000s … M11 11000s) are in `README.MD` §5 and §6.3.

---

## 7 · Open items waiting on the user

1. **A14 amendment**: MILESTONES says the generic importer lands in M7; BACKEND_STRUCTURE v1.1 builds
   the engine and staff importer in M0. Offer stands to make the one-line amendment.
2. **Permission keys**: the 15 keys in README §5.2 (`home`, `workspace`, `ess`, `community`,
   `mailbox`, `people`, `performance`, `queries`, `recruitment`, `payroll`, `partnerships`,
   `expenses`, `knowledge`, `praxis_ai`, `settings`) were proposed by the AI. Confirm before code.
3. **systemd vs PM2**: the docs say four systemd units; the user normally uses PM2. Not answered.
4. **Numbering prefixes** (BACKEND_STRUCTURE §7, e.g. `MCA-0001` staff number) are proposals for
   MyCity to confirm.
5. **Public site wording in REUSE_MAP §1.3** still contradicts A9; user said leave it.
6. **Things raised from the client pack, not yet acted on** (from the first review):
   - SOW maintenance price contradiction: cover ₦500,000/yr vs clause 8.2 ₦300,000/yr.
   - M11 "training on live data on staging" vs A5 "staging holds demonstration data" (NDPA question).
   - Confirm current Nigerian PAYE bands (Nigeria Tax Act effective 2026) before M6. Not web-verified.
   - Who approves payroll (CEO or COO) is open in MILESTONES §11.
   - Lateness threshold for auto-query is unconfirmed (§8).

---

## 8 · Donor code findings worth remembering

- **Praxis `shared/events/emit.js`** fans out notifications and starts a workflow executor inside
  the business transaction. Do not port that part.
- **Pixie `src/workflows/engine.js`** emits `workflow.*` on an in-process EventEmitter before commit,
  and `conditions.js` compares money with `Number()`. Both changed in the port.
- **Praxis `deploy.yaml`** has `environment: production` but its PR-review gate is `if: false` since
  5 August 2026, and it deploys by `git pull` on the server. Not reused.
- **Praxis `config/env.js`** is 1,075 lines of tenant/platform variables: rewrite, do not port.
- Strong donors to port as-is or nearly: Praxis `tx.js`, `query-helpers.js`, `resource.js`,
  `validate.js`, `error-handler.js`, `idempotency.js`, `auth.js`, `rbac.js`, `module-loader.js`,
  `health.js`, `numbering.service.js`, `image-pipeline.service.js`, `upload.middleware.js`,
  `services/spreadsheet/*`, `services/search/*`, `document_vault`; Pixie `outbox.js`, `money.js`,
  `lagos-time.js`, `access.catalog.js`, `workflows/*`.
- Both repos' `CLAUDE.md` files hold their house rules (no native dialogs, day-first dates, upload
  engine, search registry, prose behind ⓘ, Title Case, no em dashes, AI manifests). MyCity keeps the
  intent of all of them.

---

## 9 · What comes next

The user's stated direction: **"we need to get to work now … build the foundation."** The structure
and README are done; the natural next step is **writing M0 code into the empty files**, in roughly
this order, each against `BACKEND_STRUCTURE.md` v1.1:

1. Root config: `package.json` (scripts named in README §10), `.nvmrc` (20), `.gitignore`,
   `.gitattributes` (LF), `eslint.config.js`, `jest.config.js`, `.env.example` (generated).
2. `src/config/*`, `src/app.js`, `src/server.js`, `src/worker.js`, `src/http/*`, `src/middleware/*`
   (port per BACKEND_STRUCTURE §3).
3. `src/shared/db`, `crud`, `http`, `errors`, `events` (emit + outbox), `workflow` (port),
   `numbering`, `money`, `time`, `access`, `rbac`.
4. `packages/contract` + `scripts/gen/contract.js` + `http/route.js`.
5. M0 migrations (the user has not yet asked for migration files; ask before creating them).
6. The nine M0 modules.
7. Scripts: `ci-local.js`, `check/*`, `db/*`, `deploy/*`; `.github/workflows/*`; `ops/*`.

Before writing code, confirm with the user which slice to start with, and remember: do not run
anything without his approval.

Engineered by JBS Praxis.

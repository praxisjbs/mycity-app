# MyCity App ERP — System Architecture

**Version 1.0 · 12 October 2026 · M0 · Owner GE**

Companion to `MILESTONES.md` v1.4 and `REUSE_MAP.md`. Where this document names a donor file, the
file was read in the checked-out tree on 12 October. Backend source layout is in
`BACKEND_STRUCTURE.md`. Frontend is out of scope here.

---

## 1 · The shape in one picture

```
                         Internet
                            │
            ┌───────────────┴────────────────┐
            │ nginx (TLS only)               │   one server, 18 GB RAM / 240 GB SSD
            └──┬──────────┬──────────┬───────┘
     hub.mycityapp.io  go.mycityapp.io  hub.staging…  go.staging…
            │          │                │          │
   ┌────────▼──────────▼───────┐  ┌─────▼──────────▼──────────┐
   │ PRODUCTION                │  │ STAGING  (full parity)    │
   │                           │  │                           │
   │ mycity-api-prod   :7000   │  │ mycity-api-stg    :7100   │
   │   app/dist        (hub.)  │  │   app/dist                │
   │   public-app/dist (go.)   │  │   public-app/dist         │
   │   /api/v1/*     (staff)   │  │   /api/v1/*               │
   │   /api/public/v1/* (go.)  │  │   /api/public/v1/*        │
   │   /socket.io     (staff)  │  │   /socket.io              │
   │                           │  │                           │
   │ mycity-worker-prod        │  │ mycity-worker-stg         │
   │   outbox dispatcher       │  │   (same)                  │
   │   BullMQ consumers        │  │                           │
   │   schedulers, IMAP IDLE   │  │                           │
   └──────┬──────────┬─────────┘  └──────┬──────────┬─────────┘
          │          │                   │          │
   ┌──────▼───┐ ┌────▼─────────┐  ┌──────▼───┐ ┌────▼─────────┐
   │mycity_prod│ │Redis db 0    │  │mycity_stg │ │Redis db 1    │
   │role       │ │prefix        │  │role       │ │prefix        │
   │mycity_    │ │mycity:prod   │  │mycity_    │ │mycity:stg    │
   │ prod_app  │ │              │  │ stg_app   │ │              │
   └───────────┘ └──────────────┘  └───────────┘ └──────────────┘
        one PostgreSQL 16 instance      one Redis instance
        no cross-grants                 headless Chromium shared by both
```

Four systemd units: `mycity-api-prod`, `mycity-worker-prod`, `mycity-api-stg`, `mycity-worker-stg`.
One codebase, one build, two running copies that differ only in their `.env`.

The four virtual hosts are nginx files in the repository (`ops/nginx/`), installed with everything
else by `ops/provision/provision.sh` on Ubuntu 24.04 (decided 15 October 2026; the server,
108.181.196.53, came bare, so the earlier plan of a hosting panel was dropped). The proxy terminates TLS and forwards every path to the environment's API process,
which serves both frontend builds and the API and keeps the hosts apart itself (§3). What the proxy
must contain (forwarded headers, body size, WebSocket upgrade) is in `docs/runbooks/proxy.md`.

Installed on the server at M0 (`ops/provision`), so no later milestone is a server change: PostgreSQL
16 with **pgvector** (M10), Redis, headless **Chromium** (PDFs), **ffmpeg** (voice notes, video),
**ClamAV** `clamd` (stranger uploads, M4/M5), Geist fonts.

**Files.** Each environment has a private media root, `/srv/mycity/<env>/media`, never in the
release directory and never served directly. Node checks access, then streams the file itself
(range requests supported), so no file is reachable without the permission check. Details in
BACKEND_STRUCTURE §5.

---

## 2 · Runtime processes

| Process | Entry | Does | Does not |
|---|---|---|---|
| **API** | `src/server.js` | HTTP for both surfaces, Socket.io for staff, enqueues jobs, writes outbox rows | Run handlers for outbox events, run cron, hold IMAP connections |
| **Worker** | `src/worker.js` | Outbox dispatcher, BullMQ consumers (email, pdf, notification delivery), schedulers (workflow timeouts, birthdays, sweeps), IMAP IDLE (from M1) | Serve HTTP |

Why two and not one: a PDF render or a 40-second IMAP sync must never sit on the request path, and a
crash in a consumer must not take the API down. Why two and not five: Praxis splits mail IDLE into a
third process (`src/jobs/mail-idle.js`); at 50 users the worker carries it. If IDLE connections ever
crowd the worker, it becomes a fifth unit with no code change, because the IDLE loop is already its
own module.

**Scaling stays vertical** (A6). The server is 18 GB RAM / 240 GB SSD (confirmed 13 October 2026),
above the A6 sizing of 8 GB to 50 users and 12 GB beyond. Nothing in the design assumes a second
host, and nothing prevents one: sessions are in Redis, jobs are in BullMQ, outbox claims use
`SKIP LOCKED`.

---

## 3 · The two surfaces, and how the origin boundary is kept

| | Staff app | Public site |
|---|---|---|
| Host | `hub.mycityapp.io` | `go.mycityapp.io` |
| Build, served by the API process | `app/dist` (PWA, service worker at `/`) | `public-app/dist` (no PWA, no service worker) |
| API prefix | `/api/v1/*` | `/api/public/v1/*` |
| Auth | Bearer access token (memory) + refresh cookie `HttpOnly; Secure; SameSite=Strict; Host-only` on `hub.` | None. Opaque per-person token in the URL |
| CORS | Origin `hub.` only | Origin `go.` only, no credentials |
| Rate limit | Per user | Per IP, stricter on writes |

**The API process allow-lists the path per host** (`src/http/static.js`). On `go.` only
`/api/public/` and the public build are served; `/api/v1/` and `/socket.io/` are a 404. On `hub.`,
`/api/public/` is a 404. A request under any other host name is a 404 on a server, except
`/api/health`. Both surfaces are served by the same API process, but they are mounted from separate
routers (BACKEND_STRUCTURE §2) and a public route cannot import the staff auth middleware because the
module loader mounts by declared `surface` and `check/public-surface.js` refuses the import.

The cookie is host-only on `hub.`, so a browser never sends it to `go.`. The service worker is
registered at `hub.` scope, so it never controls `go.`. That is the separation A9 asks for, enforced
by the browser and the host guard rather than by a flag.

---

## 4 · Request lifecycle (staff)

```
nginx (TLS only, forwards everything)
  → async-safe (patches Express 4 so async throws reach the error handler)
  → request-id            X-Request-Id in, echoed out
  → request-context       AsyncLocalStorage { requestId, userId }
  → access-log            pino, scrubbed
  → helmet, cors(hub), compression, body limits
  → environment-marker    X-Mycity-Environment, X-Robots-Tag on staging
  → rate-limit            Redis store, prefixed by environment
  → /api/health, /api/health/ready      (no auth)
  → /api/v1
      → idempotency       Idempotency-Key replay protection on writes
      → module router
          → auth          JWT → req.user, session-revocation check
          → rbac          requirePermission(module, action) → req.scope, req.scope_ids
          → validate      Zod from packages/shared
          → controller    req/res only
          → service       transaction: repo + emit (event_log + audit + outbox)
          → repo          parameterised SQL, honours req.scope
  → not-found → error-handler (AppError → envelope; Postgres codes mapped; no SQL or stack out)
```

Every step above except the last two is a direct port from `praxis-ls/src` (`server.js`,
`middleware/*`, `shared/http/*`). What changes is listed in BACKEND_STRUCTURE §3.

---

## 5 · Data

**One database per environment, one schema (`public`), one application role.** No tenant column, no
brand column, no entity column (A2).

| Concern | Decision |
|---|---|
| Access | `pg` pool, parameterised SQL, no ORM. One pool per process, max 20 API / 10 worker on prod, 10 / 5 on staging |
| Roles | `mycity_prod_app` owns `mycity_prod`; `mycity_stg_app` owns `mycity_stg`. No cross-grants. Staging role has `CONNECTION LIMIT 10` and `statement_timeout = 15s` so a heavy test cannot starve production |
| Migrator role | Migrations run as the owning app role. No superuser in any `.env` |
| IDs | UUIDv4, `gen_random_uuid()` |
| Money | `numeric(18,2)`, `decimal.js` in code, strings in payloads (gate 20) |
| Time | `timestamptz` stored in UTC; business dates are `date` computed in Africa/Lagos; working days come from the per-day week table (A22) |
| Audit | `audit_ledger` append-only, enforced by trigger (no UPDATE, no DELETE) |
| Environment marker | Every database has `system_marker(environment)` written once at creation: `production` or `staging`. Seed and test tooling read it and refuse to run on `production` (A5) |

**Three data postures (A5).** Build and CI: synthetic seed into throwaway databases. Staging: realistic
demonstration data, loaded by `scripts/db/seed.js --staging`. Production: created clean, never seeded.
The seed script refuses on three independent checks: `APP_ENV`, database name, and `system_marker`.

---

## 6 · Events, the outbox and notifications

This is the one place the two donors disagree in a way that matters, so it is stated in full.

**What Praxis does.** `shared/events/emit.js` writes `event_log` and `immutable_ledger` in the
caller's transaction (good), then, still inside that transaction, starts the workflow executor and
fans out notifications synchronously.

**What Pixie does.** `shared/outbox/outbox.js` writes an outbox row in the caller's transaction and
lets the worker run consumers after commit, with per-handler progress and retry. But its workflow
engine (`src/workflows/engine.js`) signals through an in-process `EventEmitter` *before* the
transaction commits, so a rolled-back approval can still fire `workflow.completed`, and a listener in
the worker never hears an event raised in the API.

**What MyCity does.** One call, `emit(client, event)`, inside the business transaction, writes three
rows atomically:

```
event_log       what happened (queryable history, drives the activity feeds)
audit_ledger    who did it, before/after (append-only)
event_outbox    the work that must follow (dispatched after commit)
```

The worker drains `event_outbox` (`FOR UPDATE SKIP LOCKED`, exponential backoff, per-handler
completion so a retry skips handlers that already succeeded). Handlers are named and idempotent.

```
service tx ──► emit ──► COMMIT
                           │
              worker: outbox dispatcher
                ├─► notifications.fanout   → notification rows → BullMQ notification-deliver
                │                              (in-app via Socket.io Redis emitter, web push, email)
                ├─► workflow.subscribers   → consequence rules (M3), offer/payroll/expense hooks
                ├─► search.reindex         (when a provider needs it)
                └─► realtime.push          → Socket.io room user:<id>
```

The ported workflow engine's `emitter.emit(...)` calls become `outbox.enqueue(client, ...)` calls.
That is the only behavioural change to the engine (BACKEND_STRUCTURE §5).

Realtime is best effort; everything that changes state goes through the outbox.

---

## 7 · Background work

| Queue / schedule | Process | Purpose | From |
|---|---|---|---|
| outbox dispatch (poll 1s) | worker | Post-commit consumers | Pixie `shared/outbox` |
| `email-send` | worker | System mail via SMTP, staging-marked | Praxis `jobs/handlers/email-send` |
| `pdf-render` | worker | Chromium render | Praxis `services/pdf.service.js`, `chromium.js` |
| `notification-deliver` | worker | Push + email fan-out | Praxis `jobs/handlers/notification-deliver` |
| `workflow-timeout` (every 5 min) | worker | Applies stage `on_timeout` | Pixie engine `resolveTimeout` |
| `celebrations` (05:00 Lagos) | worker | Birthday, anniversary posts (M1) | new |
| `mail-sync`, IMAP IDLE | worker | Mailbox (M1) | Praxis `jobs/mail-*` |

BullMQ prefix `mycity:prod` / `mycity:stg` on separate Redis logical DBs. Queue names are the handler
file names (`jobs/registry.js` lists them all; README §5.15 by milestone). Schedulers are BullMQ job
schedulers on one `schedule` queue, so a tick starts once across processes, and each tick runs under a
Postgres advisory lock (Praxis `jobs/cron-lock.js`) so a slow run and the next tick, or two workers
during a restart, never overlap. The outbox dispatch is the exception: a one-second timer in every
worker, safe because its claim is `SKIP LOCKED`. The worker writes a heartbeat to Redis every 30
seconds; `/api/health/ready` reports `worker` degraded when none is fresh.

---

## 8 · Security model, at system level

- **Auth.** Argon2id passwords. Access JWT 15 min, in memory. Refresh token rotated on use, stored
  hashed in `user_session`, sent as host-only cookie. Session kill is effective on the next request
  (Redis session set, Postgres fallback), as Praxis `middleware/auth.js` does today.
- **RBAC, four layers.** Module → action (`view create edit delete approve export`) → record scope
  (`all team own`) → field. Enforced by the API; the shell only hides. No entity layer (A2).
- **Module catalogue** (`shared/access/access.catalog.js`) is the single list of permission keys; a
  CI gate checks it equals the distinct `requirePermission` keys in `src/`.
- **Secrets.** `.env` per environment, mode 600, owned by the service user. Integration secrets
  (mailbox passwords) AES-256-GCM in `integration_secret`, never on the row that uses them.
- **Service users.** `mycity-prod` and `mycity-stg` run their own units and cannot read each
  other's `.env` or media. `mycity-deploy` is the only SSH login CI has, with a forced command
  (§ 9.5).

---

## 9 · Release pipeline: nothing reaches production that staging has not passed and a person has not approved

### 9.1 The rule

> A commit reaches production only if (1) every CI gate passed on it, (2) that exact build was deployed
> to staging, (3) the automated staging verification passed on staging, and (4) a named approver who
> did not trigger the release approved it. Production then receives **the same files that staging ran**,
> not a rebuild.

Every one of those is enforced by a mechanism, not by a convention. Three independent layers enforce
it, so that a mistake in one is caught by the next.

### 9.2 The flow

```
 PR ──► CI (all gates) ──► review (1 approval, not the author) ──► merge to main
                                                                       │
                       release.yml (runs automatically on green main) ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1 build          npm ci, build app + public-app, assemble release tarball,  │
 │                  write MANIFEST (sha, file hashes, lockfile hash)           │
 │ 2 deploy-staging environment: staging                                       │
 │                  upload tarball, deploy-gate stage <sha>:                   │
 │                  unpack → npm ci --omit=dev → pg_dump mycity_stg →          │
 │                  migrate mycity_stg → switch symlink → restart stg units →  │
 │                  /api/health/ready must report build sha                    │
 │ 3 verify-staging automated suite AGAINST hub.staging + go.staging:          │
 │                  readiness, build sha, every module mounted, migrations at  │
 │                  head, auth round trip, RBAC deny check, workflow round     │
 │                  trip, PDF render, real mail delivered to the QA inbox,     │
 │                  Playwright smoke on both shells                            │
 │                  on success: deploy-gate seal <sha>  → STAGING_VERIFIED     │
 │ 4 approve        environment: production   ◄── WAITS HERE FOR A HUMAN       │
 │                  required reviewers, self-review blocked, main only          │
 │                  approvers test on staging, then approve in GitHub           │
 │ 5 deploy-prod    only now does the job receive the production SSH key.      │
 │                  deploy-gate promote <sha>:                                 │
 │                  re-verify seal + hashes → refuse if staging moved on →     │
 │                  freeze-window check → pg_dump mycity_prod → migrate →      │
 │                  hard-link the sealed staging tree → restart prod units →   │
 │                  readiness must report sha → read-only smoke → tag release  │
 └─────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Layer one: GitHub

| Setting | Value | What it stops |
|---|---|---|
| `main` branch protection | PR required, 1 approval, stale approvals dismissed, all CI jobs required, up to date, **no bypass for admins**, no force push | Unreviewed or red code reaching `main` (the Praxis audit found 45% of changes pushed direct) |
| Environment `staging` | Deployment branches: `main` only. Holds `STAGING_SSH_KEY` | A branch build reaching staging |
| Environment `production` | **Required reviewers: GE and TB** (either may approve), **prevent self-review on**, deployment branches: `main` only, holds `PROD_SSH_KEY` | Any production action without a person approving it. The key does not exist inside a job until approval is given |
| Workflows | `release.yml` is the only workflow that references the `production` environment. A CI gate fails any other workflow file that does | Someone adding a second, ungated path to production |

**The production SSH key is the control.** GitHub releases environment secrets to a job only after
the environment's protection rules pass. No approval, no key, no shell on production. This is the
step Praxis's `deploy.yaml` names but never completed (its review gate is `if: false` since
5 August).

### 9.4 Layer two: the staging seal

`verify-staging` ends by calling `deploy-gate seal <sha>` on the server, which writes
`/srv/mycity/stg/releases/<sha>/STAGING_VERIFIED`:

```
sha=<commit>
tree_sha256=<hash of every file in the release dir, node_modules included>
verified_at=<UTC>
run=<GitHub run id>
```

`promote` recomputes `tree_sha256` and refuses unless it matches, unless `stg/current` still points at
`<sha>`, and unless the seal is younger than 7 days. So the approver approves exactly what staging is
running, and if anyone deploys something newer to staging while the approval is waiting, the old
approval cannot ship.

**Production gets the staging tree, byte for byte.** Both environments are on one machine, so
promote is `cp -al` (hard links) of the sealed release directory into `prod/releases/<sha>`. Nothing
is rebuilt, nothing is reinstalled. The `node_modules` that passed staging is the one that runs in
production.

### 9.5 Layer three: the server

CI never gets a shell. The `mycity-deploy` user's `authorized_keys` carries a forced command:

```
command="/srv/mycity/bin/deploy-gate --key=staging",no-pty,no-port-forwarding,no-agent-forwarding <staging key>
command="/srv/mycity/bin/deploy-gate --key=production",no-pty,no-port-forwarding,no-agent-forwarding <prod key>
```

`deploy-gate` reads `SSH_ORIGINAL_COMMAND`, accepts only `stage <sha>`, `seal <sha>`, `promote <sha>`,
`rollback <env> <sha>`, and checks **which key** called it (the `--key=` its forced command
passes; `ops/ssh/authorized_keys.template`). The staging key can stage and seal and
nothing else. The prod key can promote and roll back production and nothing else. A leaked staging
key cannot touch production even with a hand-typed command.

### 9.6 Migrations under this rule

- Migrations run **only** inside `deploy-gate stage` (against `mycity_stg`) and `deploy-gate
  promote` (against `mycity_prod`), each after a `pg_dump` of that database. No other path runs them.
- The same migration files run on staging first, so a migration that fails or locks badly fails on
  staging and never reaches the approval step.
- Migrations are written expand then contract: the running code must keep working with the new
  schema during the restart window. A destructive step (drop, rename, type change) must be declared
  in the file header and ships in a later release than the code that stops using it. CI gate.
- CI proves every new migration applies on an empty database, re-applies as a no-op, and reverses
  (`-- DOWN`) on a throwaway database. Down migrations are never run against staging or production;
  rollback in a live environment is restore-from-dump plus the previous release.

### 9.7 Rollback, hotfix, freeze

| Case | Path |
|---|---|
| **Rollback** | `rollback.yml`, `environment: production` (same approvers). `deploy-gate rollback prod <sha>` switches the symlink to a previous release that is still on disk (last 5 kept) and restarts. If the bad release migrated, the approver chooses restore from the pre-deploy dump |
| **Hotfix** | No separate lane. Same PR, same CI, same staging deploy, same seal, same approval. It is faster only because the approvers act immediately |
| **Freeze** | `promote` refuses between 21 December and 5 January (Africa/Lagos dates). Staging keeps deploying, so M11 training is unaffected |

### 9.8 What a person does before approving

The approval is not a click-through. The release summary posted to the approval page carries the
staging verification report, the migration list for this release and the commit list since the last
production release. The approver:

1. Opens `hub.staging.mycityapp.io`, checks the top bar shows this build's short sha.
2. Walks the milestone's demo script for anything this release touches (the Friday demo script is the
   regression script).
3. Approves with a comment naming what was checked. GitHub records who, when and the comment against
   the deployment.

---

## 10 · Environments, marked but not crippled (A4)

| Signal | Staging | Production |
|---|---|---|
| `X-Mycity-Environment` header | `staging` on every response and every outbound mail | `production` |
| Mail `From` display name | `MyCity [STAGING]`, banner row in every template | plain |
| Top bar in both apps | persistent, shows build sha | none |
| `X-Robots-Tag` | `noindex` | none |
| Favicon, theme colour | distinct | brand |
| Features, mail delivery, public URLs | all on, real | all on, real |

`APP_ENV` is read once in `config/env.js`; nothing else branches on it except these markers and the
seed guard.

---

## 11 · Observability and operations

- **Logs.** Pino JSON to journald per unit, request id on every line, PII scrubbed (Praxis
  `shared/observability/scrub.js`).
- **Health.** `/api/health` liveness (cannot fail); `/api/health/ready` checks Postgres, Redis,
  every module mounted, migration head, outbox backlog; returns build sha. Deploys gate on ready, not
  live (Praxis `routes/health.js`).
- **Errors.** `error_event` table + alert channel for 5xx only; 4xx are logged, not alerted (Praxis
  `shared/observability/error-reporter.js`).
- **Backups.** Nightly `pg_dump` of both databases, 14 kept, media rsync; pre-deploy dump on every
  stage and promote. Restore rehearsed into a scratch database before M11 (MILESTONES §16).
- **Uptime.** External probe on both production hosts and `/api/health/ready`.

---

## 12 · Decisions in this document that are new

| # | Decision | Why |
|---|---|---|
| S1 | One `emit()` writes event_log + audit + outbox atomically; all follow-on work runs after commit in the worker | Removes Praxis's in-transaction fan-out and Pixie's pre-commit `EventEmitter` |
| S2 | Public API on the same process, separate router, path allow-listed per host by the API's host guard; the API also serves both frontend builds | A9 isolation without a fifth process, and no web server configuration to drift from the code |
| S3 | Promotion copies the sealed staging tree; production never builds or installs | "What staging ran is what production runs" is then a file comparison, not a hope |
| S4 | Production SSH key lives only in the `production` GitHub environment | Approval is a precondition for access, not a step in a script |
| S5 | Forced-command `deploy-gate` on the server, key-scoped verbs | CI never holds a shell on the box |
| S6 | `system_marker` row in each database | Seed and test tooling cannot touch production even with a wrong `.env` |

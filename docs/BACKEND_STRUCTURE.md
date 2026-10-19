# MyCity App ERP — Backend Structure

**Version 1.1 · 12 October 2026 · M0 · Owner GE (architecture, schema) with LA (migrations, data)**

The backend source tree as it stands at the end of M0, every file's job, where it comes from, and
what changes on the way in. M1 to M11 add modules under `src/modules/` in the template of §8. Every
cross-cutting capability those milestones need already has its place outside `src/modules/`; §12
checks that milestone by milestone.

v1.1 adds documents, media and images (§5), the generated FE/BE contract (§6), document numbering
(§7), the import engine and the staff importer (§9), the coverage check (§12), the AI foundation that
carries every module's `.ai.js` (§14), and the position on offline and sync (§15).

**Amended 13 October 2026** after the internal meeting of 12 October: the system-wide pagination
rule (§16), how the first administrator is created (§17), AI reads paged (§14.3), and the reverse
proxy configured in the hosting panel rather than from `ops/nginx/` (§1, §5.2). **Reversed 15 October
2026**: the server is a bare Ubuntu 24.04, so the proxy is nginx from `ops/nginx/`, installed by
`ops/provision/provision.sh`.

Donor line counts are from the checked-out trees on 12 October. `praxis` = `praxis-ls`, `pixie` =
`pixie-girl-hub`.

---

## 1 · Repository

```
mycity-erp/
├── src/                     Express backend, CommonJS, Node 20
├── migrations/              NNNN_name.sql schema steps, -- UP / -- DOWN in every file
├── seeds/
│   ├── reference/           NNNN_seed_name.sql product/reference rows, applied by db:migrate
│   ├── build/               synthetic, CI and local only
│   └── staging/             realistic demonstration data, staging only
├── packages/
│   └── contract/            THE contract: Zod schemas + generated contract.gen.ts (§6)
├── templates/               version-controlled defaults, copied into the DB on migrate
│   ├── documents/           PDF templates: letterhead, payslip, letters, offer, MOU (HTML)
│   ├── email/               transactional mail layouts and bodies
│   └── import/              import template definitions (column order, reference sheets)
├── assets/
│   ├── brand/               logo vector master, pin mark (paths), white variant, app icons
│   └── fonts/               Geist (OFL) for PDF rendering, so a PDF never falls back
├── app/                     staff React app            (out of scope here)
├── public-app/              public React app           (out of scope here)
├── scripts/
│   ├── ci-local.js          every CI gate, CI's order, full report
│   ├── gen/                 contract generator, .env.example generator
│   ├── check/               the gates (§10)
│   ├── db/                  migrate, seed, backup, restore-drill, create-admin
│   ├── import/              CLI over the import engine (first staff load)
│   └── deploy/              deploy-gate, release-manifest, verify-staging, rollback
├── ops/
│   ├── systemd/             four units + env file templates; the backup and restore-drill
│   │                        services and timers
│   ├── provision/           server packages: postgres 16 + pgvector, redis, chromium,
│   │                        ffmpeg, clamav, fonts
│   ├── monitoring/          uptime-probe.js (run from outside by .github/workflows/uptime.yml)
│   ├── ssh/                 authorized_keys template for mycity-deploy
│   └── nginx/               mycity.conf (shared) + one file per host; docs/runbooks/proxy.md
├── tests/
│   ├── unit/
│   ├── integration/         real Postgres + Redis, RUN_DB_TESTS=1
│   └── staging/             runs against hub.staging / go.staging in verify-staging
├── .github/workflows/       ci.yml, release.yml, rollback.yml, uptime.yml
├── .env.example             generated from config/env.js, CI checks they match
└── CLAUDE.md
```

**Runtime files never live in the repo.** Per environment, on the server:

```
/srv/mycity/<prod|stg>/           owned by mycity-deploy (deploy-gate switches current)
├── releases/<sha>/          code, with RELEASE, BUILD.env, SHA256SUMS (+ STAGING_VERIFIED on staging)
├── current -> releases/<sha>
├── shared/.env              root's, readable by the environment's group only
└── media/                   private, mode 750, owned by mycity-<env>
    ├── vault/<yyyy>/<mm>/<uuid>.<ext>          documents (masters)
    ├── derived/<uuid>/<w>.<avif|webp>          image derivatives
    ├── avatars/<uuid>.<ext>
    ├── comms/<yyyy>/<mm>/<uuid>.<ext>          chat images, voice notes, video
    ├── generated/<yyyy>/<mm>/<uuid>.pdf        PDFs the system rendered
    ├── imports/<batch>/<uuid>.<xlsx|csv>       uploaded source sheets
    ├── quarantine/<uuid>                       public uploads awaiting scan
    └── public/                                 brand assets served pre-auth
```

---

## 2 · `src/` at the end of M0

```
src/
├── server.js                         API process entry
├── worker.js                         worker process entry
├── app.js                            builds the Express app, no listen
│
├── config/
│   ├── env.js                        Zod parse of process.env, refuses unsafe production boot
│   ├── logger.js
│   ├── db.js                         the one pg Pool
│   ├── redis.js                      environment-prefixed keys
│   ├── request-context.js            AsyncLocalStorage { requestId, userId, surface, importBatchId }
│   └── build-info.js
│
├── http/
│   ├── routes.js                     /api/health, /api/v1, /api/public/v1, /media (§5.4)
│   ├── module-loader.js              discovers src/modules/*, mounts by declared surface
│   ├── route.js                      route(router, method, path, contract, ...handlers) (§6)
│   ├── health.js
│   └── static.js                     serves app/dist (hub.) and public-app/dist (go.); host path guard
│
├── middleware/
│   ├── async-safe.js
│   ├── request-id.js
│   ├── access-log.js
│   ├── environment-marker.js
│   ├── rate-limit.js
│   ├── idempotency.js
│   ├── auth.js
│   ├── rbac.js
│   ├── public-token.js
│   ├── upload.js                     multipart, memory, size caps, readUpload() (§5.2)
│   └── error-handler.js
│
├── shared/
│   ├── errors.js
│   ├── db/            tx.js · query-helpers.js · pg-types.js · effective-dated.js
│   ├── crud/          resource.js
│   ├── http/          validate.js · paged.js · body-limits.js · respond.js
│   ├── events/        emit.js · outbox.js · catalogue.js
│   ├── workflow/      engine.js · conditions.js · definitions.js · approvers.js
│   ├── access/        access.catalog.js
│   ├── rbac/          grants-cache.js · field-mask.js · scope.js · sessions.js
│   ├── money/         money.js
│   ├── time/          lagos.js · working-week.js · day-first.js · recurrence.js
│   ├── numbering/     numbering.js · schemes.js                                (§7)
│   ├── files/         sniff.js · mime-policy.js · hash.js · safe-name.js · variant-key.js (§5)
│   ├── documents/     vault.js · types.js · generate.js · render.js · markdown.js · canonical.js (§5)
│   ├── templates/     template-store.js · variables.js                          (§5.5)
│   ├── spreadsheet/   parse.js · build.js · csv.js · cells.js · context.js · day-first-cells.js (§9)
│   ├── import/        engine.js · mapping.js · registry.js · report.js · revert.js (§9)
│   ├── tokens/        public-token.js (32-byte, hashed at rest, expiring)
│   ├── rules/         window-counter.js (N events in a rolling window, M3 and M7)
│   ├── alerts/        alerts.js (work nobody has done; count and deadline breaches; ageing;
│   │                  clear-by-permission over the subject; a switched-off rule's alerts dismissed)
│   ├── state/         state-history.js (time at stage, M4 M7 M8)
│   ├── dedup/         dedup.js (scoring, advisory, never blocking)
│   ├── geo/           geo.js (distance, inside-fence; M1 clock-in)
│   ├── notifications/ categories.js · fanout.js
│   ├── search/        provider.js · registry.js · search.service.js
│   ├── ai/            manifest.js · registry.js · catalogue-sync.js · authorise.js ·
│   │                  cite.js                                                   (§14)
│   ├── route-map.js
│   └── observability/ scrub.js · metrics.js · error-reporter.js · alert.js
│
├── services/
│   ├── storage/       storage.service.js (local driver, keys per §1)
│   ├── media/         image-pipeline.js · av-pipeline.js · scan.js · reconcile.js (§5.3)
│   ├── pdf/           chromium.js · pdf.service.js
│   ├── mail/          system-mail.service.js · deliverability/
│   ├── secrets/       encryption.service.js
│   ├── ai/            llm.service.js · vendors/gemini.js · vendors/stub.js · governance.js ·
│   │                  ledger.js · redact.js · structured.js · transcription.js ·
│   │                  prompts/<purpose>.md                                       (§14)
│   ├── calendar/      ics.js (M2 calendar, M4 interview invites)
│   ├── qr/            qr.js (M5 verification)
│   ├── push/          vapid.js (the environment's key pair: .env, else stored encrypted, else made
│   │                  once) · web-push.js (one encrypted push to one browser; TTL, urgency, topic;
│   │                  what a refusal means) · payload.js (the v1 payload under 3 KB; tag and mode)
│   │                  (web push brought forward from M6 by TB, 19/10/2026;
│   │                  docs/guides/notifications.md, docs/runbooks/push-notifications.md)
│   └── realtime/      emitter.js · active.js (who is in front of the app, for the push hold)
│
├── realtime/
│   └── socket.js                     Socket.io, Redis adapter, rooms user:<id>, channel:<id>
│
├── jobs/
│   ├── queues.js · registry.js · cron-lock.js
│   ├── handlers/      email-send · pdf-render · notification-deliver · notification-push ·
│   │                  media-derive · media-scan · av-transcode · import-validate · import-commit
│   └── schedulers/    outbox-dispatch · workflow-timeout · alert-ageing · media-reconcile ·
│                      import-cleanup · urgent-repeats
│
└── modules/                          M0 ships these nine; each follows §8
    ├── identity/                     login, refresh, logout, me, sessions, known devices
    ├── access/                       roles, grants, scopes, field visibility
    ├── audit/                        audit log read API
    ├── organisation/                 departments, employees (core record), reporting lines
    │   └── employee.import.js        the staff importer (§9.4)
    ├── settings/                     settings, working week, numbering schemes
    ├── notifications/                caller's own inbox: list, unread count, badges, read marks;
    │                                 preferences, push devices, Send Test (notifications.push.js)
    ├── workflow/                     definitions admin, act on an instance, my approvals
    ├── documents/                    upload, download, versions, generated docs (gated)
    └── imports/                      the generic import API over shared/import (§9.3)
```

---

## 3 · Shared layer: donor, size, and what changes

| File | From | loc | Change on the way in |
|---|---|---|---|
| `middleware/async-safe.js` | praxis `shared/http/async-safe.js` | 43 | As is |
| `middleware/request-id.js` | praxis | 21 | As is |
| `middleware/access-log.js` | praxis | 132 | Drop tenant fields |
| `middleware/rate-limit.js` | praxis `shared/http/rate-limit.js` | 299 | Key prefix `mycity:<env>:rl:`; public-surface limiter |
| `middleware/idempotency.js` | praxis | 311 | `req.tenantDb` → `db` |
| `middleware/auth.js` | praxis | 162 | `req.identityDb` → `db`; keeps Redis-then-Postgres revocation check |
| `middleware/rbac.js` | praxis | 368 | `req.identityDb` → `db`. `req.scope` = `all/team/own`. Actions `view create edit delete approve export` |
| `middleware/upload.js` | praxis `shared/http/upload.middleware.js` | 135 | Multipart only (no base64 data-URL path: new repo, no legacy callers) |
| `middleware/error-handler.js` | praxis | 232 | As is |
| `http/module-loader.js` | praxis `shared/http/module-loader.js` | 214 | Flat `src/modules/<name>/`, `surface` declared per routes file, no feature gate |
| `http/health.js` | praxis `routes/health.js` | 274 | Build sha, migration head |
| `config/env.js` | praxis | 1,075 | **Rewritten** (same technique, MyCity variables only) |
| `config/db.js` | pixie `config/database.js` | ~150 | One pool, no brand GUCs |
| `shared/db/tx.js` | praxis | 121 | As is |
| `shared/db/query-helpers.js` | praxis | 274 | As is, **except `page()`** (default 50, client limit to 200) and `TOTAL_COL`/`splitTotal`, which are not ported: paging lives only in `shared/http/paged.js` (§16) |
| `shared/http/paged.js` | praxis `shared/http/paged.js` | 27 | **Rewritten** as the pagination gate: fixed 25, `pageQuery`, envelope in the body, `completeQuery` (§16) |
| `shared/crud/resource.js` | praxis | 361 | No tenant pool; `scope: { column }` through `shared/rbac/scope`; lists through `paged.js`; routes through `route()` (`mountResource`) |
| `shared/http/validate.js` | praxis | 182 | Schemas from `packages/contract` only |
| `shared/events/emit.js` | praxis | 415 | **Reworked**: event_log + audit + outbox in one tx; inline workflow and fan-out removed |
| `shared/events/outbox.js` | pixie `shared/outbox/outbox.js` | 210 | No `business` column |
| `shared/workflow/*` | pixie `src/workflows/` | 1,151 | §4 |
| `shared/access/access.catalog.js` | pixie | 199 | MyCity's 15 module keys |
| `shared/rbac/grants-cache.js` | praxis `shared/cache/identity-cache.js` | 456 | No tenant keying |
| `shared/rbac/field-mask.js` | praxis | 131 | As is |
| `shared/rbac/sessions.js` | praxis `shared/cache/session-store.js` | 100 | Redis index of live sessions in front of `user_session`; three-valued answer kept |
| `shared/money/money.js` | pixie `utils/money.js` | 123 | NGN only |
| `shared/time/lagos.js` | pixie `shared/hr_payroll/lagos-time.js` | 35 | As is |
| `shared/numbering/*` | praxis `services/documents/numbering.service.js` | 216 | §7 |
| `shared/files/*`, `shared/documents/*` | praxis `modules/vault/document_vault/` | 2,009 | §5. Keep the mime allow-list (also at serve time), the doc-type registry (`types.js`: reader module, signing ceiling, no QES tier), one function naming derived files (`variant-key.js`), content hash on the stored master; drop the attachment outbox (our outbox covers it) |
| `shared/spreadsheet/*` | praxis `services/spreadsheet/` | 1,458 | Drop tenant workbook context; MyCity brand header; day-first cells |
| `shared/dedup/dedup.js` | praxis `master/_shared/dedup.service.js` | 189 | Generic: scorer takes signal definitions, not client/supplier tables |
| `shared/search/*` | praxis `services/search/` | 305 | English only |
| `services/media/image-pipeline.js` | praxis `services/image-pipeline.service.js` + `media-compression.service.js` | 878 | Local storage only; profiles kept with enhancement on photo and avatar; metadata always stripped; no brand profile (brand images come from `assets/brand/`) |
| `services/media/av-pipeline.js` | pixie `jobs/processors/media.ffmpeg.js` | | Voice note → Opus, video → H.264 MP4, poster frame |
| `services/media/reconcile.js` | praxis `jobs/handlers/media-reconcile` | | Orphan file sweep. The donor sweeps its attachment outbox and deletes; ours moves orphans aside and never deletes |
| `services/mail/deliverability/*` | praxis `modules/mail/deliverability` + `mail/mail/dns-check.js` | 662 | DMARC, PTR, RBL, evaluate, route check as is; no tenant table (`check.js` composes); `MAIL_RBL_HOSTS` |
| `services/pdf/*` | praxis `pdf.service.js`, `chromium.js` | 262 | Fonts from `assets/fonts` |
| `services/storage/storage.service.js` | praxis | 335 | Local driver only |
| `services/secrets/encryption.service.js` | praxis | 42 | As is |
| `jobs/cron-lock.js` | praxis and pixie `jobs/cron-lock.js` | 84 | As is; our pool, key `mycity:cron:<name>`; wraps every scheduler tick |
| `jobs/queues.js` | praxis `jobs/queue.js` + `queue-producer.js` | 96 | One producer; prefix `mycity:<env>`; only declared queues; finished-job replacement opt-in |
| `jobs/registry.js`, `worker.js` | praxis `jobs/workers.js`; pixie `jobs/worker.js` (outbox loop) | 1,635 | No tenants; schedulers as files on BullMQ job schedulers; one `schedule` queue; events files discovered, then `markReady()`; heartbeat for readiness |
| `jobs/handlers/{email-send,notification-deliver,pdf-render}` | praxis `jobs/handlers/` | 112 | No tenant connection; permanent failures fail at once; emails sent recorded on the job |
| `realtime/socket.js`, `services/realtime/emitter.js` | pixie `config/socket.js`, `realtime/emitter.js`, `realtime/socket-auth.js`; praxis `realtime/index.js` | 811 | Staff host only; HTTP sign-in rules; rooms `user:`, `session:`, `channel:`; environment-prefixed pub/sub key |
| `scripts/db/migrate.js` | praxis `services/platform/migrator.js` | 321 | One database; `-- UP`/`-- DOWN`; a changed applied file is refused; advisory lock |
| `services/ai/llm.service.js`, `vendors/*` | praxis `services/ai/llm.service.js` | 710 | Gemini only; pixie's `resolveVendor` rule: no key configured returns the stub, never throws |
| `services/ai/redact.js` | praxis `services/ai/redact.js` | 205 | As is, plus MyCity's restricted fields |
| `services/ai/governance.js` | praxis `modules/ai/governance/` | 605 | Monthly spend cap, per-module switch; no tenant keying |
| `services/ai/ledger.js` | pixie `praxis_ai` run tracing (`ai_run_steps`) | | Every call recorded with real token usage and cost |
| `shared/ai/registry.js`, `catalogue-sync.js` | praxis `services/ai/action-registrar.js` | 335 | **Reads only** (A23): `write` entries rejected at load |
| `shared/ai/authorise.js` | praxis `services/ai/action-authz.js` | 200 | Checks the caller's grant and scope before any read runs |
| `shared/ai/cite.js` | praxis `services/ai/answer-sources.js` | 309 | Citations through the route map |
| `services/ai/structured.js`, `vendors/stub.js` | praxis `action-registrar.js` (Zod to JSON Schema) | | Constraints carried to the model; the stub answers with a placeholder of the schema's shape |
| `services/ai/transcription.js` | (seam) | | Governance, ledger and stub in M0; the Gemini audio call is M2 |

**Not ported:** `tenant-context.js`, `host-tenent-resolver.js`, `platform-auth.js` (521 loc, A2);
`api-version.js`; `public-head.js`; `feature-gate.js` (A4); praxis `services/workflow/executor`;
praxis's base64 upload path. (`webauthn.service.js` was on this list until 16/10/2026, when TB
decided to build passkeys with two-step sign-in and the PIN; REUSE_MAP §1.1.)

---

## 4 · The workflow engine (A11), ported

Source: pixie `src/workflows/engine.js` (590), `conditions.js` (226), `default-definitions.js` (335).

| Pixie | MyCity |
|---|---|
| Tables carry `business` | `workflow_definition / _instance / _decision`, no business column |
| `emitter.emit(…)` inside the transaction | `emit(client, …)`: audited, and its outbox row fires after commit in the worker |
| `conditions.toNumber()` via `Number()` | Money fields compared with `decimal.js` (gate 20) |
| Approvers `role`, `position`, `user`; CEO = `owner` role | `role`, `user`, `manager_of_subject`; CEO = `app_user.is_ceo` |
| `on_timeout` auto_approve allowed anywhere | Refused on a definition whose context carries money |

M0 proves it with `test.threshold` (two stages, second when `amount >= 500000.00`).

What a definition is, as built (`shared/workflow/conditions.js` has the full shape):

- `context` declares every field a condition reads and its type (`money`, `number`, `date`,
  `text`, `uuid`, `boolean`). A request missing a declared field is refused rather than read as
  zero, because zero would skip a stage meant for large amounts.
- A stage is `{ key, name, approver | approvers, condition, sla_hours, on_timeout, on_approve,
  on_reject }`. Approver types: `role` (role code), `user`, `manager_of_subject`, `ceo`.
  `on_approve: complete` finishes at that stage; `on_reject: return` sends the request back to
  the first stage instead of ending it.
- Approvers are resolved when a stage starts and stored on the instance (`stage_approvers`), so
  "My Approvals" is one read and a reorganisation does not move a request mid-stage. A subject
  with no line manager goes to the CEO.
- Nobody decides their own request (the CEO excepted). Reject and request changes need a reason.
  The requester can withdraw (`cancel`) while it is pending.
- An edit in Settings saves a new version; open instances keep the version they started on.
- A module reacts with `workflow.onCompleted(definitionKey, name, fn)`, an outbox handler.

---

## 5 · Documents, media and images

One rule runs through all of it: **a file is stored once, private by default, hashed as stored,
and reachable only through a route that checks who is asking.**

### 5.1 The document record

Every stored file, uploaded or generated, is a `document` row. A module never keeps its own file
table; it keeps a `document_id`.

```
document          document_id, doc_type, title, original_name, storage_key, mime, bytes,
                  content_hash (sha256 of the master as stored), version, supersedes_id,
                  entity_type, entity_id            ← attached to any record, like tasks
                  sensitivity (normal|personal|restricted), locked_at, expires_on,
                  scan_status (clean|pending|infected|skipped), source (upload|generated|import),
                  number (when the type is numbered, §7), uploaded_by, created_at
document_variant  document_id, kind (avif-320, webp-960, poster, opus…), storage_key, bytes
```

- **Versions, not overwrites.** Replacing a file inserts a new row with `supersedes_id`; the old
  bytes stay. A `locked_at` document (signed, sent, filed letter) cannot be superseded at all.
- **Attachment is polymorphic** (`entity_type`, `entity_id`), resolved through the same route map
  tasks and notifications use, so an employee's documents, a query's letters and a partnership's MOU
  are one table and one download route.
- **Who reads a document** (`vault.canRead`): the CEO; the employee it is about
  (`subject_employee_id`, their ESS view); whoever uploaded it; otherwise the `view` grant of the
  module the record belongs to (route map), within scope. A `restricted` document (payslip, bank
  letter, ID) also needs that module's `edit` grant, so view-only roles cannot open it. A module whose
  records need a finer rule (a direct message's attachment) registers it with `vault.defineAccess()`.
  A document the caller cannot read is a 404, never a 403. The full column list is in §11.1.

### 5.2 Upload

```
multipart (memory, 25 MB hard cap; per-type caps tighter)
  → sniff.js        type from the bytes (magic numbers), never from the extension or the browser
  → mime-policy.js  allow-list per purpose; no html, svg, xml, js anywhere (praxis vault.mime rule)
  → safe-name.js    original name kept for display only; storage key is <uuid>.<ext from sniff>
  → image? → image-pipeline (profile: photo | document | avatar)  → master + derivatives job
    audio/video? → stored, av-transcode job                         → playable variant
    other?  → stored as is
  → hash.js         sha256 of the MASTER AS STORED (what the pipeline returns, never the input)
  → document row, inside the caller's transaction
```

The proxy → Express → multer size chain is set once in `ops/nginx/mycity.conf`
(`client_max_body_size 30m`, `docs/runbooks/proxy.md`) and `middleware/upload.js`, the "works locally, fails live 413" pixie documents in
`docs/UPLOAD_SIZE_LIMITS.md`.

**Public uploads** (CVs, candidate documents from M4/M5) land in `media/quarantine/` with
`scan_status = pending`; the `media-scan` job runs ClamAV (`clamd`, installed by `ops/provision`)
and only then moves the file into the vault. A staff user never opens an unscanned stranger's file.

### 5.3 Image, audio and video

| Kind | Engine | Output |
|---|---|---|
| Photo | `image-pipeline` profile `photo` | Master in source format, AVIF + WebP derivatives at 320/640/960/1600 |
| Scanned document, ID, certificate | profile `document` | Orientation fixed, downscaled, re-encoded; **no tonal change** (a faint stamp stays faint) |
| Avatar | profile `avatar` | Square crop, 96/192/384 |
| Signature capture (M5) | profile `document`, PNG kept | Stamped into the PDF execution block |
| Voice note (M1 chat, M2 dictation) | `av-pipeline` | Opus in Ogg, duration stored; original kept |
| Video (chat) | `av-pipeline` | H.264 MP4 ≤ 720p + poster frame |
| HEIC from iPhones | `image-pipeline` normalisation | Converted on the way in |

Brand images (logo, pin, white variant, app icons) come from `assets/brand/` vector masters and are
rendered to PNG at build; they are the only files served pre-auth.

### 5.4 Serving

| Request | Path | Check |
|---|---|---|
| Staff opens a document | `GET /api/v1/documents/:id/content` | Module grant or subject-is-self; then Node streams the file (range requests supported) |
| Image in a list | `GET /api/v1/documents/:id/variant/:kind` | Same check, cached `private, max-age=300` |
| Public candidate / signer | `GET /api/public/v1/<surface>/:token/document` | Token scope names the document; nothing else is reachable |
| Verify a signed document | `GET /api/public/v1/verify/:number` | Returns type, signer, two verdicts. Never the file |
| Brand assets | `GET /media/public/*` | Allow-list (praxis `media-guard.js` rule, deny by default) |

`Content-Disposition` is always set; `Content-Type` comes from the sniffed mime; `X-Content-Type-Options: nosniff`.

### 5.5 Generated documents and templates

One call produces every system document from M3 letters to M6 payslips to M7 proposals:

```js
const doc = await documents.generate(client, {
  docType: "query_letter",          // → template, numbering scheme, sensitivity, retention
  entity: { type: "query", id },
  data,                             // validated against the template's variable schema
  actor,
});
// allocates the number (§7) → renders HTML from the template → Chromium PDF (worker)
// → stores → hashes → document row (locked) → emit("document.generated")
```

- **Templates are data**, version-controlled defaults in `templates/`, copied into a `template` table
  on migrate, editable from Settings (M3 letter templates, M5 offer and mail templates). An edit makes a
  new version; a generated document records the template version it used.
- **Variables are declared**: each template has a variable schema in `packages/contract`; rendering
  with a missing variable fails before anything is numbered or stored.
- **Markdown → HTML is one renderer** (`shared/documents/markdown.js`, ported from pixie
  `recruitment.render.js`): every line is escaped first, then a whitelist of forms applied, so no raw
  tag survives. The same HTML feeds the web view and the PDF, so what a candidate reads on screen is
  what they sign (M5). `stripTrailingAcceptanceBlock` removes a drafted signature block, because the
  document appends the one execution block itself.
- **Day-first dates and `₦1,250,000.00` money** are the only formatters templates can call (gate 15).
- **Letterhead**: City Green logo from the vector master, yellow rule, support footer (MILESTONES §5.3).
- **Hashing**: `content_hash` over the stored PDF bytes (the artifact hash); `canonical.js` gives the
  content hash over a versioned per-doc-type payload that M5's signatures need (A12). A builder's
  fields and key order never change; a change is a new version, and a golden test pins each digest.

---

## 6 · One contract for backend and frontend, generated

### 6.1 The rule

> Every request body, query, path parameter and **response** that crosses the wire is defined once,
> as Zod, in `packages/contract/schemas/`. The backend validates with it. The frontend can only
> reach the API through `packages/contract/contract.gen.ts`, which is **generated** from those schemas
> and the route table, is never edited by hand, and fails CI when it is stale.

So the frontend cannot send `userId` when the API expects `user_id`, cannot read `response.fullName`
when the API returns `full_name`, and cannot call a path the API does not serve: each is a TypeScript
compile error, not a 422 in testing.

### 6.2 Field names on the wire: `snake_case`, everywhere

One casing, matching the database columns, so a repo row, an API payload, a contract type and a
migration column all read the same. The generator **refuses** a schema key that is not `snake_case`.
`check/contract-columns.js` additionally checks each entity schema's keys against the migrated
columns of its table (praxis `check-query-columns` approach); a key that is not a column must be
declared `virtual` with a reason.

### 6.3 How it is wired

```
packages/contract/
├── schemas/                  hand-written Zod (CommonJS), one file per domain
│   ├── common.js             uuid, isoDate (round-trip checked), money string, phone (+234), email
│   ├── identity.js · access.js · organisation.js · settings.js · documents.js · imports.js …
├── index.js                  re-exports schemas (backend require()s this)
├── contract.gen.ts           GENERATED. Do not edit.
├── contract.gen.meta.json    GENERATED. Hash of every input
└── package.json              zod pinned as peer dependency (one Zod instance, both sides)
```

Routes declare their contract where they are defined:

```js
// src/modules/identity/identity.routes.js
const { route } = require("../../http/route");
const c = require("@mycity/contract");

route(router, "post", "/login", {
  body: c.identity.LoginBody,
  response: c.identity.Session,
}, controller.login);
```

`route()` attaches Zod validation for body/query/params and records the contract in a registry.
`npm run gen:contract` boots the module loader in describe mode (no DB, no Redis), walks the
registry and writes `contract.gen.ts`:

```ts
// @generated by scripts/gen/contract.js. DO NOT EDIT.
// Source hash: 3f9c… Regenerate: npm run gen:contract
import { z } from "zod";
import * as schemas from "./index.js";

export type LoginBody = z.infer<typeof schemas.identity.LoginBody>;
export type Session   = z.infer<typeof schemas.identity.Session>;
// … every schema

export interface Endpoints {
  "POST /api/v1/auth/login": { body: LoginBody; query: never; params: never; response: Session };
  "GET /api/v1/employees/:id": { body: never; query: never; params: { id: string }; response: Employee };
  // … every route the backend mounts, both surfaces
}
export const schemas = { … };   // runtime schemas re-exported for form validation
```

The frontend API client is typed against `Endpoints` (`api.call("POST /api/v1/auth/login", body)`),
and forms use the same runtime schema the API uses, so a field rule cannot differ on the two sides.

### 6.4 What CI fails

| Check | Fails when |
|---|---|
| `gen:contract --check` | `contract.gen.ts` differs from what the generator would write now (someone edited it, or changed a schema/route without regenerating) |
| Route coverage | A mounted route has no `route()` contract, or a write route has no `body`, or any route has no `response` |
| Casing | A schema key is not `snake_case` |
| Columns | An entity schema key is neither a table column nor declared `virtual` |
| Response contract | Integration tests parse every response with its declared schema (strict: unknown keys fail), so the backend cannot return a field the contract does not declare |
| Frontend local schemas | ESLint in `app/` and `public-app/` bans importing `zod` and declaring `z.object` outside `@mycity/contract` |
| Hand edit | A commit changing `contract.gen.ts` without a matching change under `schemas/` or a routes file |

The generator is in M0 with the first routes, so the contract is complete from the first endpoint
rather than back-filled.

---

## 7 · Document numbering

Every human-readable reference in the system comes from one allocator.

```
numbering_scheme    doc_type (pk), prefix, padding (0 = no sequence part), separator,
                    reset (never|yearly|monthly), include_period, updated_at, updated_by
numbering_counter   doc_type, period ('all', '2026' or '2026-10'), last_value, pk (doc_type, period)
```

```js
const number = await numbering.allocate(client, "query");   // → "QRY-0028"
```

- **Inside the caller's transaction.** `UPDATE numbering_counter … RETURNING last_value` locks the
  counter row, so concurrent allocations serialise and **a rolled-back transaction does not consume a
  number** (praxis `numbering.service.js` model). Numbers are gap-free per type and period.
- **Never reused.** The counter only increments; deleting or archiving a record does not return its
  number. The `number` column is `UNIQUE` on every numbered table.
- **Scheme is data** (Settings → Documents & Numbering, M9 surface, editable from M0 via API).
  Changing a scheme changes future numbers only; existing numbers are never rewritten.
- **Missing scheme fails loudly at boot**, not at first use: `schemes.js` lists every `doc_type`
  the code allocates and the readiness probe fails if a scheme row is absent (pixie's
  `document-number.js` documents the silent failure this prevents).
- **Opaque references are a different thing.** Anything a stranger holds in a URL (apply, assess,
  sign) uses `shared/tokens`, not a sequential number (praxis `operation-reference.js` lesson).
  Verification uses the document number because it is a reference, not a secret (MILESTONES §2).

Seeded schemes (reference data, same in every environment):

| doc_type | Format | First used |
|---|---|---|
| `employee` | `00001` (staff number: MyCity's own five digits, no prefix; `0199_seed_foundation_fixes.sql`) | M0 import |
| `query` | `QRY-0001` | M3 |
| `sanction`, `letter` | `SAN-0001`, `LTR-0001` | M3 |
| `vacancy` | `VAC-0001` | M4 |
| `offer` | `OFF-0001` | M5 |
| `contract` | `CON-0001` | M5 |
| `payroll_run`, `payslip` | `PAY-2026-10`, `PAY-2026-10-0001` | M6 |
| `proposal`, `mou` | `PRO-0001`, `MOU-0001` | M7 |
| `expense`, `requisition`, `disbursement` | `EXP-0001`, `REQ-0001`, `DSB-0001` | M8 |
| `document` | `DOC-0001` (vault, generated docs without their own type) | M0 |
| `import_batch` | `IMP-0001` | M0 |

Prefixes are proposals for MyCity to confirm with the naming email; they are a setting, so changing
one is not a code change.

---

## 8 · Module template (every module from M1 on)

```
src/modules/<name>/
  <name>.routes.js        { basePath, surface, router }; route() with contract for every endpoint
  <name>.controller.js    req/res only. Never calls the repo
  <name>.service.js       business rules, transactions, emit(), numbering, documents.generate()
  <name>.repo.js          parameterised SQL, honours req.scope. Never emits
  <name>.events.js        event keys emitted + outbox handlers registered
  <name>.ai.js            read manifest, or `// ai:none <reason>`          (gate 9)
  <name>.search.js        search provider, or `// search:none <reason>`    (gate 10)
  <name>.import.js        importer, when the module's records come from sheets (§9.4)
  <name>.test.js
```

Schemas for the module live in `packages/contract/schemas/<name>.js`, never in the module.

---

## 9 · Import engine and the staff importer

### 9.1 Why it is in M0

A14 and MILESTONES §12 put the generic importer in M7. The staff list cannot wait for M7: it is the
first real data the system holds, M1 cannot be demonstrated on real people without it, and every later
milestone joins to `employee`. So the **engine and the staff importer are built in M0**; M7 adds the
partnership importer and the column-mapping screen polish on the same engine. (MILESTONES A14 and §12
should say so; one-line amendment.)

### 9.2 The pipeline

```
upload (.xlsx, .csv, Google Sheets downloaded as .xlsx)
  → parse        bounded: 10 MB, 100 sheets, 100k rows, 256 cols (zip-bomb caps, praxis parse.js)
  → detect       header row found in the first 20 rows (real sheets have titles above the header)
  → map          source column → importer field; auto-match by normalised header + aliases;
                 a remembered mapping profile is applied when the header signature matches
  → coerce       per field: text, int, money (decimal string), phone (+234), email, enum,
                 date (Excel serial OR text read day-first; an ambiguous or impossible date is an
                 error, never a guess), reference (resolved later)
  → validate     each row against the SAME contract schema the create API uses
  → match        existing record by the importer's match keys (staff number, then work email)
                 → create | update | unchanged | duplicate-in-file | conflict
  → preview      the whole commit run inside a transaction that is ROLLED BACK; the preview is the
                 real result, not a simulation: counts, per-row action, field-level diff for updates
  → commit       same code path, committed. All-or-nothing by default; "commit valid rows only" is an
                 explicit choice recorded on the batch
  → report       error file: the user's own rows, their columns, plus Status and Problem columns
  → history      every batch kept: who, when, file, mapping, counts
  → revert       created rows archived, updated rows restored from their before-snapshot, refused
                 for any row that has since been changed or referenced
```

### 9.3 Tables and API

```
import_batch          import_batch_id, number (IMP-0001), importer_key, document_id (source file),
                      sheet, header_row, mapping jsonb, options jsonb, status
                      (uploaded|mapped|validated|previewed|committed|reverted|failed),
                      stats jsonb, created_by, committed_at, reverted_at
import_row            import_batch_id, row_number, raw jsonb, values jsonb, status
                      (ok|warning|error|duplicate|unchanged|skipped), problems jsonb,
                      action (create|update|none), target_id, before jsonb
import_mapping_profile importer_key, name, header_signature, mapping jsonb, last_used_at
```

```
GET  /api/v1/imports/importers                 what can be imported, by this user
GET  /api/v1/imports/importers/:key/template   xlsx template: header row + protected Reference sheet
POST /api/v1/imports                           upload → batch (parse + detect + auto-map)
PUT  /api/v1/imports/:id/mapping
POST /api/v1/imports/:id/preview               validate + match + dry-run commit (job for large files)
POST /api/v1/imports/:id/commit
POST /api/v1/imports/:id/revert
GET  /api/v1/imports/:id/rows?status=error
GET  /api/v1/imports/:id/report                error file (xlsx)
GET  /api/v1/imports                           history
```

Every write in a commit goes through the target module's **service**, not straight SQL, so numbering,
audit, events, field rules and workflow apply exactly as they do for a record created on screen. Each
audit row carries the batch id (request context). `scripts/import/run.js` drives the same engine from
the command line for the first staff load on staging.

### 9.4 The staff importer (`modules/organisation/employee.import.js`)

```js
module.exports = {
  key: "employees",
  permission: ["people", "create"],
  schema: contract.organisation.EmployeeImportRow,   // same field rules as POST /employees
  matchKeys: ["staff_number", "work_email"],
  fields: [
    { key: "staff_number",   label: "Staff ID",     aliases: ["staff no", "employee id", "id no"] },
    { key: "first_name",     label: "First Name",   required: true },
    { key: "last_name",      label: "Last Name",    required: true },
    { key: "work_email",     label: "Work Email",   type: "email" },
    { key: "phone",          label: "Phone",        type: "phone" },
    { key: "department",     label: "Department",   type: "reference", ref: "department",
                             createMissing: "confirm" },
    { key: "job_title",      label: "Job Title" },
    { key: "line_manager",   label: "Line Manager", type: "reference", ref: "employee",
                             by: ["staff_number", "work_email", "full_name"], pass: 2 },
    { key: "start_date",     label: "Start Date",   type: "date" },
    { key: "date_of_birth",  label: "Date of Birth", type: "date", mask: "employee.personal" },
    { key: "employment_type",label: "Employment Type", type: "enum" },
    { key: "work_pattern",   label: "Work Pattern", type: "enum" },  // on-site | hybrid | remote
    { key: "worksite",       label: "Worksite",     type: "reference", ref: "worksite", pass: 2 },
    { key: "bank_name",      label: "Bank",         mask: "employee.bank" },
    { key: "account_number", label: "Account Number", mask: "employee.bank" },
    { key: "gross_monthly",  label: "Gross Monthly", type: "money", mask: "employee.salary" },
    { key: "next_of_kin",    label: "Next of Kin" },
  ],
  options: { createLogins: false },   // M1 adds "create login and send invite" per row
  // find, resolve, create, write, link, archive, restore: see shared/import/registry.js
  write: (client, values, ctx) => employeeService.importRow(client, values, ctx),
};
```

What it handles that a naive import does not:

- **Line managers point at other rows in the same file.** Pass 1 creates or updates everyone; pass 2
  resolves `line_manager` (and `worksite`) against the now-complete set, so file order does not
  matter. A manager who is in neither the file nor the system is an error on that row, and a cycle
  (A manages B manages A) is refused.
- **Departments that do not exist yet** are listed in the preview as "will be created" and need an
  explicit tick; a typo ("Marketting") does not silently become an eighth department. Near matches are
  suggested by `shared/dedup`.
- **Staff numbers.** If the sheet carries them they are kept; if not, `numbering.allocate("employee")`
  issues them at commit, so every employee has one either way.
- **Dates** from Excel serials and day-first text both work; `03/07/1991` is 3 July; `13/31/1991` is
  an error on that cell.
- **Sensitive columns** (bank, salary, date of birth) are masked in the preview and the error file for
  a user without the field grant, and are never written to logs.
- **Changing templates**: the mapping profile is keyed by header signature, so next month's sheet with
  a renamed column maps once and is remembered.
- **Production**: real staff reach `mycity_prod` through this engine, run by an authorised user, with
  the batch on record. That is data entry, not seeding, so A5 holds: no seed script ever touches
  production.

---

## 10 · Gates standing at M0, plus pipeline guards

| Gate | Script |
|---|---|
| 1 Lint | `eslint --max-warnings 0` |
| 2 Test | whole jest suite; integration suite against real Postgres in CI |
| 3 Migration numbering | `check/migration-numbers.js` (praxis) |
| 4 Migration reversibility | `check/migration-reversibility.js` (praxis); CI applies UP, DOWN, UP |
| 5 Migration idempotency | `check/migration-idempotency.js` (praxis); applied files hash-locked |
| 6 Schema drift | `check/schema-drift.js`, `check/contract-columns.js` |
| 7 Write routes validated | `check/route-contracts.js` (every route has a contract; writes have a body) |
| 8 Five-second rule | `check/five-second.js` over every screen (FRONTEND_GUIDE §5); backend half is `check/dashes.js` over `src/` strings, templates and the manual |

Pipeline guards, also from M0: `gen:contract --check`, `.env.example` matches schema, module
catalogue equals enforced keys, every list paged at 25 (`check/pagination.js`, §16), public routes import no auth/rbac, numbering schemes exist for every
allocated type, only `release.yml`/`rollback.yml` reference the `production` environment, shell
scripts LF and `bash -n`, `node --check` on every file.

The backend code gates (date-format, money, module-catalogue) read JavaScript through
`scripts/check/lib/source.js` (comments, strings, template literals and regex literals told apart,
line numbers kept), so a pattern in a comment never fails a build and one in a string is not
missed. Each takes a waiver only on the line or in the comment directly above, with a reason:
`@date-format:parts|foreign|filename`, `@money:ok`. Gate 17 (dashes) is shared with the screen
gates and reads through `scripts/check/lib/sources.js`.
The module catalogue gate lists catalogue keys no route enforces yet as a note; its CI entry gains
`--exact` at M9, when every module's routes exist.

---

## 11 · Foundation migrations and reference seed

| # | File | Contents |
|---|---|---|
| 0001 | `extensions.sql` | `pgcrypto`, `citext`, `pg_trgm`, `unaccent`, `vector` (pgvector, used M10; installed now so M10 is not a server change); `search_fold()`; `set_updated_at()` |
| 0002 | `system.sql` | `system_marker`, `schema_migration` |
| 0010 | `identity.sql` | `app_user` (incl. `mfa_secret_enc`, `mfa_enrolled_at`, used by the `security` module with the rest of two-step from `0220`), `user_session`, `known_device`, `password_reset` |
| 0020 | `access.sql` | `role`, `user_role`, `permission`, `field_visibility`, `capability`, `user_capability` |
| 0030 | `audit_events.sql` | `event_log`, `audit_ledger` (append-only trigger), `event_outbox`, `idempotency_key`, `error_event` |
| 0040 | `organisation.sql` | `department`, `worksite` (geofence centre + radius, used M1), `employee` (+ `number`), `reporting_line` (effective-dated), team closure view |
| 0050 | `settings.sql` | `setting`, `working_week`, `public_holiday` |
| 0055 | `numbering.sql` | `numbering_scheme`, `numbering_counter` |
| 0060 | `notifications.sql` | `notification`, `notification_preference`, `push_subscription`, `alert` |
| 0070 | `workflow.sql` | `workflow_definition`, `workflow_instance`, `workflow_decision`, `entity_state_history` |
| 0080 | `documents.sql` | `document`, `document_variant`, `template`, `template_version` |
| 0085 | `imports.sql` | `import_batch`, `import_row`, `import_mapping_profile` |
| 0090 | `security_store.sql` | `integration_secret`, `public_token` (hash, scope, subject, expires, used_at) |
| 0095 | `ai.sql` | `ai_setting` (vendor, model, monthly cap, per-module switch), `ai_run`, `ai_run_step` (tokens, cost, latency, purpose, module, actor), `ai_catalogue` (synced from manifests). Prompts are files with a `version:` front matter, recorded on each run; `ai_prompt_version` waits for prompt editing in Settings, if MyCity wants it |
| 0099 | `seeds/reference/0099_seed_reference.sql` | System roles, module catalogue rows, working week, numbering schemes, template defaults. **No people, no demo rows** |

### 11.1 Columns the shared layer already reads

The shared layer was written before these migrations (14 October), so it names the columns it
depends on. A migration that names them differently changes the code in the same PR, or the code
fails at the first query. Everything else in each table is the migration's call.

| Table (migration) | Columns read or written by | |
|---|---|---|
| `app_user` (0010) | `user_id`, `employee_id` (NOT NULL), `email`, `status` (`active` / `suspended` / `left`), `is_ceo` | `shared/rbac/grants-cache` |
| `user_session` (0010, 0100) | `session_id`, `user_id`, `killed_at`, `expires_at`, `last_seen_at`, `refresh_token_hash`, `end_reason` | `middleware/auth`; the session rules are `identity.session-policy.js` (`docs/guides/identity.md` §6) |
| `role`, `user_role` (0020) | `role_id`, `code`; `user_id`, `role_id` | `shared/rbac/grants-cache` |
| `permission` (0020) | `role_id`, `module_key`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_approve`, `can_export`, `scope` (`all` / `team` / `own`) | `middleware/rbac` |
| `field_visibility` (0020) | `role_id`, `field_key`, `visibility` (`visible` / `masked`) | `shared/rbac/grants-cache` |
| `capability`, `user_capability` (0020) | `capability_id`, `code`; `user_id`, `capability_id` | `middleware/rbac` (`requireCapability`) |
| `idempotency_key` (0030) | `key` (PK), `method`, `path`, `request_hash`, `user_id`, `state` (`in_flight` / `completed`), `status_code`, `response_body` jsonb, `created_at`, `completed_at`, `expires_at` | `middleware/idempotency` |
| `error_event` (0030) | `occurred_at`, `severity`, `origin`, `fingerprint`, `name`, `message`, `stack`, `route`, `request_id`, `user_id`, `release`, `extra` jsonb | `shared/observability/error-reporter` |
| `employee` (0040) | `employee_id`, `first_name`, `last_name`, `line_manager_id` (team scope is the tree under it) | `shared/rbac/grants-cache` |
| `schema_migration` (0002) | `name` text PK (the file name without `.sql`), `sha256` text NOT NULL, `applied_at` timestamptz NOT NULL DEFAULT now(). `scripts/db/migrate.js` creates it with exactly this DDL when it is missing, so 0002 must declare it `IF NOT EXISTS` with the same columns | `scripts/db/migrate.js`, `http/health` (migration head) |
| `system_marker` (0002) | `environment` text NOT NULL (`production` / `staging` / `development` / `test`), one row, written when the database is created (ops/provision on servers, by hand locally) | `scripts/db/seed.js` (refuses unless it exists and is not production) |
| `worksite` (0040) | `worksite_id`, `latitude`, `longitude`, `radius_m` | `shared/geo` (clock-in, M1) |
| `working_week` (0050) | `weekday` (1 Monday to 7 Sunday), `is_working_day`, `starts_at`, `ends_at` | `shared/time/working-week` |
| `public_holiday` (0050) | `holiday_date`, `name` | `shared/time/working-week` |
| `numbering_scheme` (0055) | `doc_type` PK, `prefix`, `padding`, `separator`, `reset`, `include_period` | `shared/numbering` (§7); 0099 seeds one row per type in `shared/numbering/schemes.js` |
| `numbering_counter` (0055) | `doc_type`, `period`, `last_value`, PRIMARY KEY (`doc_type`, `period`) | `shared/numbering` |
| `entity_state_history` (0070) | `entity_state_history_id`, `entity_type`, `entity_id`, `from_state`, `to_state`, `actor_id`, `reason`, `changed_at` | `shared/state/state-history` |
| `public_token` (0090) | `public_token_id`, `token_hash` UNIQUE, `scope`, `subject_type`, `subject_id`, `single_use`, `expires_at`, `used_at`, `revoked_at`, `created_by`, `created_at` | `shared/tokens`, `middleware/public-token` |
| any effective-dated table | `effective_from` date NOT NULL, `effective_to` date NULL (exclusive; NULL = current), no overlap per key | `shared/db/effective-dated` |
| `event_log` (0030) | `event_id` uuid PK, `event_key`, `module_key`, `entity_type`, `entity_id` **text**, `actor_user_id` NULL, `payload` jsonb, `request_id`, `import_batch_id` NULL, `occurred_at` | `shared/events/emit` |
| `audit_ledger` (0030) | `event_id` FK, `occurred_at`, `actor_user_id`, `actor_name`, `actor_email`, `actor_ip`, `action`, `module_key`, `entity_type`, `entity_id` text, `before` jsonb, `after` jsonb, `changed_fields` text[], `is_sensitive`, `metadata` jsonb, `request_id`, `import_batch_id`; append-only trigger | `shared/events/emit` |
| `event_outbox` (0030) | `outbox_id` uuid PK, `event_id` FK, `event_key`, `dedup_key` (UNIQUE where not null), `status` (`pending` / `processing` / `done` / `failed`), `attempts`, `max_attempts` (default 8), `next_attempt_at`, `completed_handlers` text[], `last_error`, `created_at`, `updated_at`, `processed_at`; index on `next_attempt_at` where pending. A handler is given `{ outbox_id, attempt, max_attempts }`, so one that keeps a status of its own (a report run) records a final failure instead of throwing it again | `shared/events/outbox` |
| `notification` (0060) | `notification_id` uuid PK, `user_id`, `event_id` FK, `event_key`, `category`, `priority` (`normal` / `high`), `title`, `body`, `entity_type`, `entity_id` text, `channels` text[], `created_at`, `read_at`, `delivery_queued_at`; UNIQUE (`event_id`, `user_id`). No link column: the inbox derives it (`shared/route-map`). The bell shows rows whose `channels` include `in_app` | `shared/notifications/fanout` |
| `notification_preference` (0060) | `user_id`, `category`, `channel` (`in_app` / `email` / `push`), `enabled`; PRIMARY KEY (`user_id`, `category`, `channel`) | `shared/notifications/fanout` |
| `workflow_definition` (0070) | `workflow_definition_id` uuid PK, `key`, `version`, `module_key`, `name`, `description`, `context_types` jsonb, `stages` jsonb, `active`, `created_by`, `created_at`; UNIQUE (`key`, `version`) | `shared/workflow/definitions` |
| `workflow_instance` (0070) | `workflow_instance_id` uuid PK, `workflow_definition_id` FK, `definition_key`, `module_key`, `entity_type`, `entity_id` text, `subject_employee_id`, `current_stage`, `state` (`pending` / `approved` / `rejected` / `cancelled` / `timeout_approved` / `timeout_rejected`), `context` jsonb, `stage_approvers` jsonb, `stage_entered_at`, `stage_due_at`, `opened_by`, `opened_at`, `completed_at`; UNIQUE (`entity_type`, `entity_id`) WHERE `state = 'pending'` | `shared/workflow/engine` |
| `workflow_decision` (0070) | `workflow_decision_id` uuid PK, `workflow_instance_id` FK, `stage_key`, `actor_id` NULL, `decision` (`approve` / `reject` / `request_changes` / `cancel` / `timeout_approve` / `timeout_reject`), `reason`, `decided_at` (clock_timestamp, so two decisions in one transaction keep their order) | `shared/workflow/engine` |
| `home_alert_rule` (Home, M1) | `home_alert_rule_id` uuid PK, `key` UNIQUE, `metric`, `threshold` numeric, `window_days`, `severity` (`low` / `medium` / `high`), `permission_key` (`"<module>.<action>"`, e.g. `people.approve`), `enabled`; `name`, `created_by`, `updated_by` (1150) are Home's own (`src/modules/alerts`) | `shared/alerts` |
| `home_alert` (Home, M1) | `home_alert_id` uuid PK, `home_alert_rule_id` FK, `subject_type`, `subject_id` text, `title`, `trigger`, `severity`, `over_by` numeric, `raised_at`, `last_seen_at`, `escalated_at`, `cleared_at`, `cleared_by`, `outcome` (`cleared` / `dismissed`), `note`, `subject_employee_id` (1150, written by `raise()` from its `subject_employee_id`; scopes the Alerts list, and `mayClear()` holds the clearer's scope to it and refuses the clearer's own, the CEO excepted), `due_on` (1151, a deadline's date, written by `raise()` from its `due_on`); UNIQUE (`home_alert_rule_id`, `subject_type`, `subject_id`) WHERE `cleared_at IS NULL`. `raise()` reads a value by the metric's `kind`: a `count` breaches at the threshold and `over_by` is how far past it, a `deadline` (days left) breaches at the threshold or fewer and `over_by` is the days left, 0 on the day and below 0 once passed; with `since` (the breach's latest evidence) it does not raise again a breach a person closed after it (`cleared_by` set), for a deadline only one about the same `due_on`. It reads the rule again in its own transaction (`FOR SHARE`), so a rule switched off since the caller loaded it raises nothing. `closeForRule()` dismisses a switched-off rule's open alerts with `cleared_by` NULL and the note "Rule switched off", audited as `home.alert_cleared` with `rule_off` | `shared/alerts` |

| `setting` (0050) | `key` PK, `value` jsonb. The letterhead and mail read `organisation.profile` (`name`, `address`, `phone`, `email`, `website`) | `shared/documents/generate` |
| `document` (0080) | `document_id` uuid PK, `doc_type`, `title`, `original_name`, `storage_key` UNIQUE, `mime`, `bytes`, `content_hash` (NULL until rendered), `version`, `supersedes_id`, `is_current`, `entity_type`, `entity_id` text, `subject_employee_id`, `sensitivity` (`normal` / `personal` / `restricted`), `locked_at`, `expires_on`, `scan_status` (`clean` / `pending` / `infected` / `skipped`), `source` (`upload` / `generated` / `import`), `number` UNIQUE, `template_key`, `template_version`, `render_status` (NULL / `pending` / `done` / `failed`), `render_html`, `render_error`, `width`, `height`, `duration_ms`, `uploaded_by`, `created_at` | `shared/documents/vault`, `generate` |
| `document_variant` (0080) | `document_variant_id`, `document_id`, `kind` (`webp-320`, `avif-960`, `opus`, `mp4-720`, `poster`), `storage_key` UNIQUE, `mime`, `bytes`, `width`, `height`, `created_at`; UNIQUE (`document_id`, `kind`) | `shared/documents/vault` |
| `template_version` (0080) | `template_version_id`, `kind` (`document` / `email`), `key`, `version`, `subject`, `title`, `body`, `format` (`html` / `markdown`), `created_by`, `created_at`; UNIQUE (`kind`, `key`, `version`). Version 0 is the shipped file; no row for it | `shared/templates/template-store` |
| `import_batch` (0085) | `import_batch_id` uuid PK, `number` UNIQUE, `importer_key`, `document_id`, `file_name`, `sheet`, `header_row`, `mapping` jsonb, `options` jsonb, `status` (`uploaded` / `mapped` / `previewed` / `committed` / `reverted` / `failed`), `stats` jsonb, `created_by`, `created_at`, `previewed_at`, `committed_at`, `committed_by`, `reverted_at`, `reverted_by` | `shared/import` |
| `import_row` (0085) | `import_row_id`, `import_batch_id`, `row_number`, `raw` jsonb, `values` jsonb, `status` (`ok` / `warning` / `error` / `duplicate` / `unchanged` / `skipped`), `problems` jsonb, `action` (`create` / `update` / `none`), `target_id` text, `before` jsonb, `diff` jsonb; UNIQUE (`import_batch_id`, `row_number`) | `shared/import` |
| `import_mapping_profile` (0085) | `import_mapping_profile_id`, `importer_key`, `name`, `header_signature`, `mapping` jsonb, `created_by`, `last_used_at`; UNIQUE (`importer_key`, `header_signature`) | `shared/import/mapping` |
| `ai_setting` (0095) | `ai_setting_id`, `enabled` boolean, `vendor` (`gemini` / `stub`), `model`, `disabled_modules` text[] (module keys whose AI is off), `monthly_cap_ngn` numeric(18,2) NULL (no cap), `input_ngn_per_million`, `output_ngn_per_million` numeric(18,2) NULL (NULL: the environment's prices), `updated_by`, `updated_at`. The newest row wins; no row: environment defaults | `services/ai/governance` |
| `ai_run` (0095) | `run_id` uuid PK, `purpose`, `module_key`, `actor_user_id`, `vendor`, `model`, `prompt_key`, `prompt_version` int, `prompt_sha`, `status` (`running` / `ok` / `failed` / `refused`), `provisional` boolean, `error_code`, `error`, `request_id`, `started_at`, `finished_at` | `services/ai/ledger` |
| `ai_run_step` (0095) | `ai_run_step_id`, `run_id` FK, `step_no`, `kind` (`completion` / `retry` / `transcription`), `vendor`, `model`, `input_tokens`, `output_tokens` int, `input_ngn_per_million`, `output_ngn_per_million`, `cost_ngn` numeric(18,2), `latency_ms`, `finish_reason`, `outcome` (`ok` / `invalid` / `failed`), `error`, `created_at`; UNIQUE (`run_id`, `step_no`); index on `created_at` (the month's spend is summed from tokens × prices, rounded once) | `services/ai/ledger`, `governance` |
| `ai_catalogue` (0095) | `key` PK, `kind` (`read` / `route`), `module_key`, `description`, `permission` (`people.view`), `params_schema` jsonb, `screen`, `path`, `build_sha`, `synced_at` | `shared/ai/catalogue-sync` |

`entity_id` is text wherever a row points at "any record", because not every record's key is a
uuid. The integration suite (`RUN_DB_TESTS=1`, in CI on every PR) builds its schema from the real
migrations (`tests/integration/helpers/schema.js`), so it proves the shared layer against the
columns above as they are actually migrated.

---

## 12 · Coverage check: everything M1 to M11 needs outside `src/modules/`

Built = in M0. Seam = the place, contract and tables exist in M0; the first consumer fills it in the
milestone shown, so nothing is retrofitted.

| Need | Milestones | Lives in | M0 |
|---|---|---|---|
| Auth, sessions, devices, MFA columns | M1, M9 | `modules/identity`, `middleware/auth` | Built |
| RBAC 4 layers, field masking, own/team scope | all | `middleware/rbac`, `shared/rbac` | Built |
| Audit, events, outbox | all | `shared/events` | Built |
| Workflow engine + timeouts | M2, M3, M5, M6, M8 | `shared/workflow`, `jobs/schedulers` | Built |
| Contract (FE/BE validators, types, endpoints) | all | `packages/contract` | Built |
| Document numbering | M0, M3 to M8 | `shared/numbering` | Built |
| Document vault, versions, locking, sensitivity | M1, M3, M5, M7, M10 | `shared/documents`, `modules/documents` | Built |
| Upload engine, sniffing, size chain | all uploads | `middleware/upload`, `shared/files` | Built |
| Image pipeline (photo/document/avatar) | M1, M5 | `services/media` | Built |
| Voice notes, video | M1 chat, M2 dictation | `services/media/av-pipeline` | Built |
| Virus scan for stranger uploads | M4, M5 | `services/media/scan` | Built |
| Generated PDFs, letterhead, templates | M3, M5, M6, M7 | `shared/documents`, `services/pdf`, `templates/` | Built |
| Canonical hashing, QR | M5 | `shared/documents/canonical`, `services/qr` | Built |
| Public tokens | M4, M5 | `shared/tokens`, `middleware/public-token` | Built |
| Spreadsheet export (reports, lists) | M1 onward | `shared/spreadsheet` | Built |
| **Import engine + staff importer** | **M0, M1**, M7 | `shared/import`, `modules/imports`, `employee.import.js` | **Built** |
| Dedup scoring | M0 import, M7 | `shared/dedup` | Built |
| Working week, holidays, Lagos dates | M1, M6 | `shared/time` | Built |
| Money | M6, M8 | `shared/money` | Built |
| Effective-dated config | M6 statutory, reporting lines | `shared/db/effective-dated` | Built |
| Notifications: in-app, email, push, preferences | M1, M6 | `shared/notifications`, `modules/notifications`, `services/push`, `jobs/handlers` | Built (web push, its keys and personal preferences brought forward from M6 by TB, 19/10/2026) |
| Alerts (age, clear by permission) | M1 Home, M3, M7, M8 | `shared/alerts` | Built |
| Time at stage | M4, M7, M8 | `shared/state` | Built |
| Rolling-window rules ("3 in 30 days") | M3, M7 inactivity | `shared/rules` | Seam |
| Geofence maths | M1 clock-in | `shared/geo` | Built |
| Realtime rooms, presence | M1 chat | `realtime/socket`, `services/realtime/active` (in front of the app, for attendance's clock watch) | Built (presence M1) |
| Mailbox secrets, IMAP IDLE loop slot | M1 | `services/secrets`, worker | Seam |
| Recurrence, ICS invites | M2, M4 | `shared/time/recurrence`, `services/calendar` | Seam |
| LLM client, governance, spend ledger, stub when off | M2, M4, M7, M10 | `services/ai` (§14) | Built (vendor key M2) |
| Feature AI: structured output, provisional flag, prompts as files | M2, M4, M7 | `services/ai/structured.js`, `prompts/` | Built |
| Transcription | M2 dictation | `services/ai/transcription.js` | Seam |
| AI read manifests, registry, catalogue, caller-grant check, citations | M1 onward | `shared/ai` (§14) | Built |
| Assistant orchestrator (retrieve, read, answer, cite) | M10 | `services/ai/assistant/` | Seam |
| ⌘K search providers | M1 onward | `shared/search` | Built |
| Embeddings (pgvector) | M10 | extension in 0001 | Seam |
| Scheduled reports, generated as recipient | M1 Home → Reports | `modules/reports` (sources, schedule, files, generate), `jobs` (`scheduled-reports`, `scheduled-report`), `shared/documents`, `shared/spreadsheet` | Built |
| Backups, restore drill, monitoring | M11 | `scripts/db`, `ops` | Built |

If a milestone needs something not on this list, the PR that adds it puts it in the matching shared
folder and adds a row here; a module never grows its own copy of a shared concern.

---

## 13 · Definition of done for M0 (this document's scope)

- `server.js` and `worker.js` boot on both environments; `/api/health/ready` reports build sha, nine
  modules mounted, migration head, numbering schemes present.
- `mycity_prod` holds `system_marker('production')`, reference data and one CEO user, created by
  `create-admin` as a complete employee with a staff number, department, login and role (§17).
  No other row.
- Every list endpoint in the M0 modules returns `{ data, page }` with at most 25 rows;
  `check/pagination.js` is green.
- `contract.gen.ts` generated; editing it by hand fails CI; a route without a contract fails CI.
- `emit()` inside a rolled-back transaction leaves no event, audit, outbox row **and no consumed
  number** (test).
- `test.threshold` routes one instance through one stage and one through two.
- A photo, a scanned document and a voice note upload, process and download through gated routes; a
  direct `/media/vault/...` request is refused.
- A letter template generates a numbered, hashed, locked PDF through Chromium in the staging worker.
- **The real staff sheet imports on staging**: preview shows creates and line-manager links, the
  commit creates every employee with a staff number and reporting line, the error file round-trips,
  and revert restores the previous state.
- Every M0 module ships a `.ai.js` or `// ai:none`; the catalogue syncs on deploy; a manifest with a
  `write` is refused at boot; an AI call with no vendor key returns the stub and still writes its
  ledger row.
- A merge to `main` deploys to staging, verifies, seals, and waits at the production approval.

---

## 14 · AI foundation

Every module ships a `.ai.js` from M1 (A13, gate 9), and AI features arrive in M2, M4, M7 and M10.
Without one shared setup each of those would bring its own vendor call, its own cost tracking and
its own idea of who may see what. So M0 builds the carrier; milestones only add manifests and
prompts.

### 14.1 Two kinds of AI, one pipe

| Kind | Example | Who calls it | Lands |
|---|---|---|---|
| **Feature AI**: one task inside a module's service | M2 transcript cleanup, M4 JD draft and CV screening, M7 proposal draft | The module's service, via `ai.complete()` | M2, M4, M7 |
| **Assistant**: answers questions from data | M10 Praxis AI ("who has overdue tasks?") | `services/ai/assistant/`, via the manifests | M10 |

Both go through `services/ai/llm.service.js`. Nothing else in `src/` may import a vendor SDK;
`check/ai-vendor-imports.js` fails the build if it does.

### 14.2 What every call passes through

```
ai.complete({ purpose, module, actor, input, output: ContractSchema })
  → governance    module switch on? monthly cap not reached? (refuses with a clear AppError)
  → redact        restricted fields removed; only what the actor may see is ever sent
  → prompt        services/ai/prompts/<purpose>.md, versioned; version recorded on the run
  → vendor        Gemini, or the stub when no key is configured (pixie resolveVendor rule)
  → structured    response parsed against a Zod schema from packages/contract; a malformed
                  answer is retried once, then fails, never half-applied
  → ledger        ai_run + ai_run_step: purpose, module, actor, tokens, cost in NGN, latency,
                  prompt version, outcome
  → result        { output, provisional: true, run_id }
```

- **AI output is always provisional** until a person accepts it (praxis `vacancy.scoring.js` rule:
  every surface that shows a score shows the flag). Accepting writes through the module's service
  like any other edit, with the `run_id` on the audit row.
- **Prompts are files**, reviewed in PRs like code. Guardrails live in the prompt and in the schema:
  M2's cleanup prompt says "tidy wording, do not change meaning", and its schema returns the cleaned
  text plus the original, so the UI can show both.
- **The stub is honest.** With no key, `complete()` returns a deterministic placeholder marked
  `vendor: "stub"`, so CI, local and a staging without a key exercise the full path, ledger included.

### 14.3 The manifest every module carries

```js
// src/modules/organisation/organisation.ai.js
module.exports = defineManifest({
  module: "people",                                   // access.catalog key
  reads: [
    {
      key: "employees.list",
      description: "List employees, filtered by department, status or manager",
      params: c.organisation.EmployeeListQuery,       // Zod from packages/contract
      permission: ["people", "view"],
      run: (client, params, actor) => repo.list(client, params, actor.scope),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.full_name }), // → route map URL
    },
  ],
  routes: [                                           // A23: writes are routed, never executed
    { intent: "add an employee", screen: "people.employees", params: { action: "new" },
      prefill: c.organisation.EmployeeCreate },       // screen is "<module>.<tab>" from route-map SCREENS
  ],
});
```

`defineManifest()` validates the shape at load. It **rejects a `write` key** (A23), and any other
write-shaped key (`writes`, `actions`, `executor`, `execute`, `mutations`). A read needs the `view`
grant; its `params` and a route's `prefill` must be schemas exported from `packages/contract`. `reads[].run`
receives the caller's own scope, so a manifest read returns exactly what the same person would see on
screen; field masking is applied to its rows by `authorise.js` before the model sees them.

**AI reads are paged like every other list (§16).** A list read's `params` is a `listQuery()` schema,
so it accepts `page` and never a size. `run` returns the `pageQuery` envelope, and `authorise.js`
passes every result through `assertPage()` before the model sees it, so the assistant can never pull
more than 25 rows in one step, however the question is phrased. Asked for "all our contacts", it
answers with the first 25 and the total ("showing 25 of 312") and fetches the next page when asked.
This keeps a broad question from timing out the AI call or the request behind it.

### 14.4 Registry, catalogue, gate

- `shared/ai/registry.js` discovers every `src/modules/*/*.ai.js` at boot, as the search registry
  discovers `.search.js`.
- `catalogue-sync.js` upserts `ai_catalogue` on deploy (step in `deploy-gate stage` and `promote`), so
  the assistant's tool list always equals the code that is running.
- Gate 9 (`check/ai-manifest-coverage.js`, praxis) fails a module with records and neither a manifest
  nor `// ai:none <reason>`. It runs in M0 against the M0 modules so it is proven before M1 depends
  on it.
- Gate 19 fails a manifest that declares a write.

### 14.5 What each milestone adds

| Milestone | Adds | On top of |
|---|---|---|
| M1 onward | One `.ai.js` per module | registry, gate 9 |
| M2 | `transcription.js` body, `prompts/review-cleanup.md`, vendor key in `.env` | `complete()`, ledger |
| M4 | `prompts/jd-draft.md`, `prompts/cv-screen.md` | structured output, provisional flag |
| M7 | `prompts/proposal-draft.md`, `prompts/mou-draft.md` | same |
| M10 | `services/ai/assistant/` (retrieve, choose reads, answer, cite), embeddings with pgvector, spend screen | catalogue, authorise, cite, ledger, governance |

---

## 15 · Offline and sync

**Not in scope.** No MyCity document asks for the staff app to work offline, and the SOW does not buy
it. The PWA installs and caches the shell; data needs a connection.

What the foundation already gives, so a later Change Report would not be a rewrite:

- **Every write accepts an `Idempotency-Key`** (M0), so a queued request replayed after reconnect
  cannot create a record twice.
- **Clock-in carries the device's own timestamp alongside the server's** (M1), so a punch sent late
  can be judged on when it happened, with the gap recorded.
- **Records carry `updated_at`**, the minimum a conflict check needs.

The one place a dropped connection is already handled is the M4 assessment, which autosaves and
resumes on the server; that is a feature of that screen, not offline sync.

---

## 16 · Pagination: 25 per page, everywhere

Decided at the internal meeting of 12 October 2026. Neither donor had one rule: praxis-ls clamps
lists to 50 with a client `limit` up to 200 and several endpoints had no limit at all; a list that
loads a whole table works in testing and takes the server down when the table is large.

### 16.1 The rule

- **Every list is paged on the server at 25 rows.** Screens, pickers, search results, exports'
  previews, mobile infinite scroll and AI reads. The size is fixed, not a default: the client cannot
  ask for more or for fewer.
- The client sends `page` (1-based), the list's own filters and at most one `sort`. The contract has
  no `limit`, `offset`, `per_page` or `page_size` key; `listQuery()` is `.strict()`, so a client that
  sends one gets a 422 naming it.
- Search, filtering and sorting happen in SQL, before the page is cut. A page is never filtered in
  the browser and presented as the whole result.
- **The sortable fields are the list's own** (FRONTEND_FOUNDATION F20). `listQuery(filters, sortable)`
  allow-lists them and parses one key, the field name with a leading `-` for descending
  (`?sort=-due_on` → `{ field: "due_on", dir: "desc" }`); a field not on the list is a 422 naming
  `sort`. `orderBy(query, columns, tiebreak)` builds the `ORDER BY` from the repo's own map, so a
  caller chooses a key and never a character of SQL, and every order finishes on a unique column.

### 16.2 Where it lives

| Piece | File |
|---|---|
| `PAGE_SIZE = 25`, `listQuery(filters, sortable)`, `sortParam`, `PageQuery`, `PageMeta`, `Paged(item)` | `packages/contract/schemas/common.js` |
| `pageQuery`, `orderBy`, `TOTAL_COL`, `sendPaged`, `assertPage`, `completeQuery` | `src/shared/http/paged.js` |
| The gate | `scripts/check/pagination.js` |

Every list response is the same envelope, in the body (no header to expose through CORS):

```json
{ "data": [ "...at most 25 rows" ],
  "page": { "number": 2, "size": 25, "total": 312, "pages": 13, "has_next": true } }
```

`pageQuery` requires `TOTAL_COL` (`COUNT(*) OVER()`) in the SELECT list, a unique `ORDER BY`, and no
hand-written `LIMIT`/`OFFSET`; it throws at the first call otherwise. The count and the rows come from
one query, so they cannot disagree. Past the last page it counts separately so the client still gets
the real total.

### 16.3 The one exception

A set that must be loaded whole because acting on part of it would be wrong (the permission matrix:
praxis-ls loaded it paged, an editor saw half the grants and saved over the rest) uses
`completeQuery()`. It returns up to 5,000 rows and **fails loudly** above that instead of
truncating. It is never a list a person scrolls and never an AI read. Every call carries
`// pagination:complete <reason>` on the line above it.

### 16.4 What the gate refuses

| Refused | Where |
|---|---|
| `LIMIT`/`OFFSET`/`FETCH FIRST` in SQL outside `paged.js` (`LIMIT 1` allowed; a worker batch claim marked `LIMIT $1 -- pagination:batch <why>` on the same line is allowed, never in a route, controller or AI manifest) | `src/` |
| `completeQuery()` without its marker | `src/` |
| A page-size key | `packages/contract/schemas/` (except `common.js`), any `*.ai.js` |
| A page-size parameter or a local `PAGE_SIZE` | `app/`, `public-app/` |

---

## 17 · The first administrator: `scripts/db/create-admin.js`

Decided at the internal meeting of 12 October 2026. The praxis-ls script created an `app_user` with
an email and a password: an account that could sign in but was not an employee, so it appeared in no
staff list, reported to nobody and could not be traced to a person. In a public repository it was
also a readable recipe for an account outside the HR record. MyCity does it differently.

### 17.1 What it creates

One transaction, through the services (never raw SQL):

```
department     found by name, or created          organisation.service
employee       full payload, staff number issued    organisation.service   (numbering, audit, events)
app_user       linked to that employee              identity.service       (Argon2id, is_ceo)
user_role      the chosen role                      access.service
```

The input is `AdminBootstrap` in `packages/contract/schemas/organisation.js`: every field
`EmployeeCreate` requires (name, work email, phone, job title, department, start date, employment
type, work pattern), plus the role code and whether the person is the CEO. If the employee already
exists (imported before the first login was made), the login is attached to that record instead.

### 17.2 What it refuses

| Refused | Why |
|---|---|
| A login with no employee | Schema rule: `app_user.employee_id uuid NOT NULL REFERENCES employee` (0010/0040). The script cannot do it, and neither can anything else |
| An existing login for that email or employee | It never changes an existing login; passwords are reset in the app. praxis-ls's `ON CONFLICT DO UPDATE SET password_hash` let the script take over any account |
| A role that already has an active holder | It is a bootstrap. Everyone after the first is created in the app, by a person, under their own name in the audit log. `--allow-additional` overrides, deliberately |
| A second CEO | `is_ceo` is unique |
| A password on the command line or in a file | Typed at a hidden prompt, twice, held to the contract's `NewPassword` rule: at least 8 characters with a lowercase and an uppercase letter, a number and a symbol |
| A non-interactive run | Needs a terminal; seeds and tests call `createAdmin()` directly |
| `--sample` on production | The production administrator is a real person |

It reads the server's own `.env`, so it only works where the database credentials already are, and
it asks the operator to type the environment name before writing, or takes it as `--env=<name>`,
refused unless it is that `.env`'s `APP_ENV`.

### 17.3 Staging and local

`--sample` fills the employee with a complete, obviously sample profile ("System Administrator",
department "Administration") and asks only for the work email, role and password, so a developer
gets a real employee record behind their login without typing twelve fields. `scripts/db/seed.js`
calls the exported `createAdmin()` with the demonstration data.

`--build-account` is the implementation team's login, on staging and production alike: the complete
employee record is `BUILD_ACCOUNT` in the script (JBS Praxis Implementation Team, consultant,
remote, a two-month contract, address, next of kin, pay, and a bank account of ten zeros that no
payment can reach), role `implementation`. Every employee column is filled except the references
(worksite, managers, seats) and `left_on`. Only the email and the password are typed, the email
serving as work and personal email; neither is in the repository. It is suspended at handover (`docs/runbooks/first-accounts.md`).

### 17.4 What it needs from the M0 modules

The services it calls (built 16/10/2026, `docs/guides/identity.md`) expose:

| Service | Functions |
|---|---|
| `organisation.service` | `findDepartmentByName(client, name)`, `createDepartment(client, { name }, actor)`, `findEmployeeByWorkEmail(client, email)`, `createEmployee(client, EmployeeCreate, actor)` returning the row with `employee_id` and `number` |
| `identity.service` | `findUserByEmail`, `findUserByEmployeeId`, `findCeo`, `createUserForEmployee(client, { employee_id, email, password, is_ceo }, actor)` returning `{ user_id, email }` |
| `access.service` | `findRoleByCode`, `listRoles`, `countActiveUsersWithRole(client, role_id)`, `assignRole(client, { user_id, role_id }, actor)` |
| `config/env`, `config/db` | `{ config: { APP_ENV } }`, `{ pool }` |

`actor` is `{ user_id: null, source: "script:create-admin" }`; the audit row records that source.

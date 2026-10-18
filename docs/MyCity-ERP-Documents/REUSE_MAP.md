# MyCity App ERP — Codebase Audit and Reuse Map

**What this is:** a file-level audit of `praxis-ls` and `pixie-girl-hub` against the eleven
milestones in the signed Statement of Work, plus M0. For every milestone it names the donor files,
their size, what we take, what we leave, and what has to change on the way in.

**Why it exists:** "be inspired by Praxis LS" and "clone from Pixie" are not plans. A plan says
which file. Where a milestone has no donor, this document says so, because that is the number that
decides the schedule.

**Measured:** 9 October 2026, from the checked-out trees. All line counts are real.
**Revised:** 11 October 2026, after the client requirements meeting of 10 October (§13.1).

---

## 0. The two donors, measured

| | `praxis-ls` | `pixie-girl-hub` |
|---|---|---|
| Backend | 185,000+ loc across 29 top-level modules | ~150,000 loc across 48 modules + 19 `shared/` libraries |
| Module convention | `routes / controller / service / repo / validator / events / ai` | same, plus `subscribers` |
| Migrations | 35 platform + **392 tenant** + 60 seeds | 15 shared + 20 brand-template, 425 tables / 3 schemas |
| Tenancy | **Database per tenant** + platform registry; `live`/`sandbox` schemas via `search_path` | **Schema per business** (`shared`, `pixiegirl`, `faitlynhair`) |
| Locale | Africa/Douala, XAF, OHADA, bilingual EN/FR | **Africa/Lagos, NGN, Nigerian statutory** |
| CI gates | **50** in `scripts/ci-local.js` | lint, naming, jest, coverage, smoke |
| Frontend | 3 apps; `client/src/components/ui/` = **89 primitives, 12,566 loc** | 1 admin app + reference client |
| Money | `numeric(18,2)`, raw arithmetic | `decimal.js`, 2dp, strings in payloads |

**The headline: the donor is not one repo, it is two, and the split is not arbitrary.**
Praxis LS wins on anything *communications, documents, tasks and platform plumbing*.
Pixie wins on anything *Nigerian, money, HR-operational and workflow*.

---

## 1. M0 — Foundation

Nothing in M0 is demonstrable to the client. Everything in M1 stands on it, which is why M0 and M1
share one window.

### 1.1 Take from `praxis-ls`

| Donor | loc | What it gives | Change on the way in |
|---|---|---|---|
| `src/shared/crud/resource.js` | 361 | `makeRepo` / `makeService` / `makeController` / `makeRouter`. Every module's six files stay thin. Carries `?sort=` allow-listing (no ORDER BY from user input) and record-scope filtering. | Strip `tenantDb`; drop `scopeColumn` only if Q2 says single-tenant with no record scope — keep it, ESS needs `own` scope |
| `src/shared/db/` | 683 / 5 files | `tx.js` (`atomically`), `query-helpers.js` (`insertOne`, `updateOne`, `page`, `TOTAL_COL`), parameterised-SQL discipline | Remove per-tenant pool registry; one pool |
| `src/shared/events/emit.js` | 415 | `emitEvent` + `audit` + `resolveActorId`. One call writes the domain event and the audit row. This is what makes M9's audit log free. | Keep as is |
| `src/shared/http/` | 2,298 / 13 | Response envelope, pagination, error shape, API versioning | Keep |
| `src/shared/observability/` | 1,742 / 7 | Pino + request correlation, access log, silent-catch taxonomy | Keep |
| `src/middleware/` | 1,938 / 12 | `auth.js` (162), `rbac.js` (368), `idempotency.js` (311), `error-handler.js` (232), `request-id.js` (21) | **Delete** `tenant-context.js` (207), `host-tenent-resolver.js` (183), `platform-auth.js` (131) — 521 loc of tenancy we are not buying |
| `src/services/search/provider.js` + `registry.js` + `search.service.js` | 70 | `recordProvider` pattern: a module declares its own ⌘K provider, the registry discovers it, the gate fails a module with records and no provider. Folded matching, prefix then substring then trigram. | Keep. This is the cheapest findability we will ever get |
| `scripts/ci-local.js` | — | 50 gates in CI's own order, reporting all failures not the first | Port the 8 in Q7; the file's structure is the reusable part |
| `src/modules/security/app_user/` | 4,085 | `app_user.service.js` (1,749) argon2 + TOTP + session issue; `session-policy.js` (139); `known-device.js` (187) + repo (130); `webauthn.service.js` (584) | Take all three ways in: two-step sign-in (TOTP with recovery codes), passkeys (WebAuthn) and the PIN, with the fresh-sign-in check (`assertFreshAuth`). Decided by TB on 16/10/2026, reversing "drop WebAuthn for now"; built in the second sign-in PR (`docs/guides/identity.md`). Keep `known-device` — M1 attendance needs device validation |
| `src/modules/security/audit_ledger/` | 644 | Append-only audit reader with `entity-label.js` | Keep whole. M9 deliverable, built in M0 |
| `src/modules/security/{permission,scope,capability,iam_role,field_visibility}/` | 1,337 | The RBAC spine: grants, record scope, capabilities, field visibility | Keep. SOW clause 2.2 says the permissions and audit foundation is laid at M1 |

### 1.2 Take from `pixie-girl-hub`

| Donor | loc | What it gives |
|---|---|---|
| `src/shared/hr_payroll/lagos-time.js` | 35 | Lagos-pinned day boundaries. Written as an audit fix because UTC made 00:00–01:00 punches land on the previous day and lateness run an hour lenient. We inherit the fix, not the bug |
| `src/utils/money.js` + `decimal.js` | — | 2dp, strings in API payloads. Praxis does raw `numeric` arithmetic; Pixie's discipline is the right one for NGN |
| `src/shared/outbox/` | 210 | Transactional outbox. Matters from M1 — a notification must not fire for a transaction that rolled back |
| `src/shared/cache/` | 254 | Redis helper, single instance |
| `src/workflows/engine.js` + `conditions.js` + `default-definitions.js` | — | Data-driven threshold-aware JSONB approval routing. Stand it up in M0; M3, M5, M6 and M8 all consume it |

### 1.3 Frontend foundation — `praxis-ls/client/`

| Donor | loc | Note |
|---|---|---|
| `client/src/components/ui/` | 12,566 across 89 files | `field.tsx`, `info-hint.tsx`, `date-field.tsx`, `datetime-field.tsx`, `image-upload.tsx`, `file-drop.tsx`, `form.tsx`, `callout.tsx`, `kpi-tile.tsx`, `data-view.tsx`, `chart.tsx`, `otp-input.tsx`, `dialog.tsx`, `modal.tsx`, `panel.tsx`, `meter.tsx` |
| `client/src/lib/` | — | `api-client.ts` (session refresh, network retry), `day-first-date.ts`, `cn.ts`, `chunk-reload.ts`, `appearance-cache.ts` |
| `packages/shared/` | 16 schema files | One Zod definition consumed by API and form. `entityRoute` map — tasks and notifications derive their link from it, never store it |

**What we do not take:** the three-app split (`client` + `platform-console` + `public-web`). MyCity is
one admin app plus public routes. That removes `platform-console` and `public-web` entirely, and with
them 17 of the 50 CI gates.


### 1.4 Changes on the way in, as built (M0, 14 October 2026)

What the M0 port actually changed, so this map stays true. Each was a decision, not drift.

| Donor | What changed, and why |
|---|---|
| praxis `shared/events/emit.js` ("keep as is") | Reworked to one `emit()` that writes `event_log`, `audit_ledger` and `event_outbox` in one statement inside the caller's transaction, with no inline fan-out (SYSTEM_ARCHITECTURE §6, BACKEND_STRUCTURE §3). The donor's two calls (`emitEvent` + `audit`) became one |
| pixie `workflows/engine.js` ("port as it is") | Added: no self-approval (CEO excepted), requester withdraw, reasons required on reject and send-back, approvers stored at stage entry, typed condition values. Dropped: `position` approvers and deputy fallback. MILESTONES §1 amended |
| pixie `workflows/conditions.js` + `default-definitions.js` | Same operators and "skipped, not run" semantics; values are typed per definition and money compares as a two-place string, not a JS number. The shipped-defaults mechanism is kept (a default is saved as version 1 the first time it is needed), keyed by definition key instead of `module:action`. Pixie's own routes (stylist payouts, discounts and the rest) are not carried; each milestone adds its own |
| pixie `workflows/engine.js` events | The in-process EventEmitter (`workflow.completed`, `advanced`, `escalated`) became events through `emit()` and the outbox, so a module reacts after commit with `onCompleted()` and a failed handler is retried |
| praxis `shared/notifications/notify-events.js` | Same rules: a curated list of events, audiences by RBAC permission, the actor never told of their own action, per-category preferences, best effort. Changed: runs as one outbox handler after commit, not inside `emit()`; each module declares its own entries with `defineNotification()` instead of one central `NOTIFIABLE` list; audiences add subject, approvers, requester and CEO. The client-portal and client-team notifiers are not ported (no client portal in scope) |
| praxis `shared/cache/identity-cache.js` (chosen over pixie's, same design) | Kept: 30-second read-through cache in Redis, fail-open to Postgres, no password hashes cached. Changed: invalidation is called by the service that changes the grant or user, not subscribed to in-process events, because our events reach handlers through the outbox and a grant change must apply on the next request. The TTL is fixed; there is no setting to disable the cache |
| (no donor) `shared/alerts/alerts.js` | Net-new. Neither tree has work-nobody-has-done alerts with ageing |
| praxis `services/encryption.service.js` | As is |
| praxis `mail/deliverability/` + `mail/mail/dns-check.js` | DMARC, PTR, RBL, evaluate and route check as is, comments made MyCity's. No `deliverability` table or routes yet (`check.js` composes the checks). System mail refuses a send the route check calls trapped (`MAIL_ROUTE_TRAPPED`) |
| praxis `services/spreadsheet/` | Ported with the tenant workbook context replaced by `context.js` (organisation profile, actor, title); NGN money; Lagos dates |
| praxis `image-pipeline.service.js` + `media-compression.service.js` | Profiles and enhancement ported (photo and avatar enhanced; document and signature untouched). Not ported: the lenient decode that stores an unreadable image as it came (ours refuses it, because a pass-through keeps GPS metadata); the brand profile (brand images come from `assets/brand/`); stem-suffix derivative keys (ours are rows in `document_variant`, named by `variant-key.js`). The "never bigger than what arrived" rule applies only to a file already free of metadata |
| praxis `vault/document_vault/` | Doc-type registry ported as `shared/documents/types.js`: `moduleKey` became `module`, the signing ceiling keeps `signable` and `wet` and drops `allowsQes`. The mime fallback now applies at serve time. `attachment_variants.variantKey` became `shared/files/variant-key.js`. Attachment outbox not ported (our outbox covers it) |
| praxis `services/signatures/canonical.js` | Mechanism ported as is (Map lookup, versioned builders, `hash`, `build`, `diff`). Only `EMPLOYMENT_CONTRACT` carried over; the logistics builders were left. Money is a two-place string, never a float |
| pixie `recruitment.render.js` | The escape-first Markdown renderer and `stripTrailingAcceptanceBlock` ported to `shared/documents/markdown.js`; safe links added. The offer shell and execution block wait for M5. The `marked` dependency was removed |
| praxis `jobs/handlers/media-reconcile.js` + `media-reconcile-scheduler.js` | Not ported: it sweeps the attachment outbox per tenant and deletes bytes. Ours (`services/media/reconcile.js`) moves orphans aside and never deletes. Its wrapper is the `media-reconcile` scheduler (phase 5): once a night at 02:30 Lagos rather than every 15 minutes, because the pass walks every file and an orphan is only acted on after a day |
| praxis and pixie `jobs/cron-lock.js` (same file in both) | Ported as is: `pg_try_advisory_lock`, session level, connection destroyed when the unlock fails. Changed: the pool is ours and can be passed in (tests); the key is `mycity:cron:<name>`; the `corn-lock.js` alias is not carried. Used around every BullMQ scheduler tick (the donors wrapped node-cron with it). SYSTEM_ARCHITECTURE §7 said "a Redis lock"; it is a Postgres lock, and §7 now says so |
| praxis `jobs/queue.js` + `jobs/queue-producer.js` (two producers) | One `jobs/queues.js`. Kept: lazily created queues on the shared client, retry with exponential backoff, the request id and user stamped on the job (`__ctx`) and restored by the consumer. Changed: every queue carries the BullMQ `prefix` `mycity:<env>`; only queues `jobs/registry.js` declares can be used; removing a finished job that holds the same `jobId` is opt-in (`replaceFinished`), because the donor's always-remove re-ran a job keyed on an event id |
| praxis `jobs/workers.js` (1,104 lines) | Became `jobs/registry.js` (what runs) and `worker.js` (the process). Kept: one dedicated Redis connection per consumer, start and done logs with the time taken, job metrics, retries counted and only a final failure reported, `requestContext` restored per job. Changed: no tenant fan-out (one database); each scheduler is its own file declared with `defineSchedule` and registered with BullMQ job schedulers (`upsertJobScheduler`), which replace a changed schedule and let the worker remove ones the build no longer has (the donor needed a stale-repeatable sweep per job); ticks share one `schedule` queue instead of a `<name>-scheduler` queue each; permanent failures throw BullMQ's `UnrecoverableError` instead of being retried; a heartbeat key that `/api/health/ready` reads |
| pixie `jobs/worker.js` (outbox section) | Kept: the outbox dispatcher runs in-process in every worker on a timer, safe alongside a second worker because the claim is `SKIP LOCKED`. Changed: every second, not every five (SYSTEM_ARCHITECTURE §7), draining up to ten claims a tick; the handlers are found by loading every `<module>.events.js` and `*.import.js` instead of a hand-kept `require` list (the donor documents inbound messages lost when one was missing), and `outbox.markReady()` is called only after they load; old finished rows pruned daily under the cron lock. node-cron is not used |
| praxis `jobs/handlers/email-send.js` | Kept: one message per job, retried by the queue. Changed: no tenant connection or per-purpose sender (one system sender, `services/mail/system-mail.service`); a message that cannot succeed (template data, address) fails at once |
| praxis `jobs/handlers/notification-deliver.js` | Kept: the job carries the plan (rows already decided), so a retry sends what the person already sees. Changed: each email sent is recorded on the job (`job.updateData`) and a retry skips it, where the donor accepted a duplicate; the bell is pushed through `services/realtime/emitter`; web push is counted as waiting until M6 |
| praxis `jobs/handlers/pdf-render.js` | Changed: renders a pending generated document by id (`documents.renderPending`); the build-from-record shape and the tenant QR origin are not carried; the last attempt marks the document failed (`document.render_failed`) |
| pixie `config/socket.js`, `realtime/socket-auth.js`, `realtime/emitter.js`; praxis `realtime/index.js` | Kept: the Redis adapter on its own pub and sub connections (praxis), the server-or-Redis-emitter broadcaster so the worker reaches sockets (pixie `getBroadcaster`), rooms derived from the verified token only, never from the client. Changed: the sign-in check is the HTTP one (active user who is an employee, live session); staff host only; the pub/sub key carries the environment prefix (pub/sub is shared across Redis databases); a socket closes when its token expires and when its session ends (`session:<id>` room). Not carried: per-tenant rooms, the public guest namespace, the ops console namespace, the module relays |
| praxis `services/platform/migrator.js` | Kept: the ledger with each file's sha256 (line endings normalised, so Windows and Linux agree), each file and its ledger row in one transaction. Changed: one database and one scope; files carry `-- UP` and `-- DOWN` sections (the donor's had none); an applied file that changed is refused before anything runs (the donor only reported drift); a session advisory lock so two deploys cannot interleave; `--down` for local databases; on servers only through deploy-gate |
| (no donor) `scripts/db/seed.js` | Net-new: the three independent checks of A5 (APP_ENV, database name, `system_marker`) and a runner for `seeds/<build|staging>/*.js` through services |
| (no donor) `scripts/gen/contract.js` | Net-new. praxis checks its API against a JSON baseline (`check-api-contract.js`); not carried. Ours generates `contract.gen.ts` from the Zod schemas and the route registry, refuses a key that is not snake_case, and `--check` fails CI when the file is stale or edited |
| praxis `services/ai/llm.service.js` (710) | Kept: the OpenAI-compatible Gemini gateway, `reasoning_effort` "none" for 2.5 Flash and "low" otherwise, the tool-schema reduction Gemini needs, `finish_reason` recorded, errors classed as config (not retried, reported) or transient (retried). Changed: Gemini only, so no vendor chain and no fallback hop; `fetch` instead of axios; no platform credential table (key from `GEMINI_API_KEY`); no key is the stub, never an error (pixie `resolveVendor`); streaming and inline tool-markup salvage not carried (the M10 assistant adds streaming if it needs it); one `complete()` that wraps governance, redaction, the prompt file, structured parsing with one corrective retry, and the ledger |
| praxis `services/ai/redact.js` | Kept: the two egress classes (reasoning and external), numbers masked by what surrounds them rather than by length, payment and identity numbers masked on every path. Changed: Nigerian shapes (labelled NUBAN, BVN, NIN, a passport letter and eight digits, +234 and 0803 phones, TIN); the Cameroon RIB, NIU and CNPS rules dropped; `redactValue` empties the field-mask restricted fields (salary, bank, personal, statutory) in structured input unless the task names one in `keep` |
| praxis `modules/ai/governance/` (618) + pixie `ai_governance` | Kept: the gate every AI entry point calls, the hard cap that refuses, cost computed from tokens and a price, rounding once at the end (the praxis lesson: per-call rounding floored the ledger to 0.00). Changed: no tenant entitlement or per-user grants (RBAC already bounds who can reach a feature); one `ai_setting` row with an on/off switch, a per-module switch and a monthly cap in naira; prices in naira per million tokens; a refused call is recorded |
| pixie `praxis_ai` run tracing (`ai_run_steps`) + `ai/usage-meter.js` | Kept: one trace row per step with real tokens, cost and latency. Changed: `ai_run` per call and `ai_run_step` per round trip, not tied to a conversation; written before the call goes out and failing closed (pixie's meter swallowed ledger errors, which makes the cap unenforceable) |
| praxis `services/ai/action-registrar.js` (335) | Kept: manifests discovered from the modules, never a central list; the Zod to JSON Schema conversion that carries formats, lengths, enums and bounds to the model (moved to `services/ai/structured.js`). Changed: reads and routes only (A23): the executor map, `ai_enabled` and confirm-gated writes are gone, and `defineManifest` refuses any write-shaped key; read keys unique across modules is a load error |
| praxis `services/ai/action-authz.js` (200) | Kept: the caller's grant checked before anything runs, CEO through, a denial counted and logged. Changed: the decision is `middleware/rbac.scopeFor`, the same code as `requirePermission`, and it also yields the caller's scope (all, team, own), which the read runs under; list reads must return one page of 25 (`assertPage`); restricted fields masked for the caller |
| praxis `services/ai/answer-sources.js` (309) | Kept: citations from what was read, never from the answer's prose; deduplicated. Changed: links from `shared/route-map` (records here are addressable, so a citation opens the record, not just the screen); no reasoning trace yet (M10) |
| praxis `services/search/{provider,registry,search.service}.js` | Kept: providers declared beside the module, folded prefix, substring and trigram matching, `%` and `_` as letters, the `view` grant checked before any provider runs, a savepoint per provider and a 2-second timeout, type words at either end of the term. Changed: module keys instead of MOD-xx; English labels only; a result's link from the route map; the caller's scope applied through the provider's scope column; a group is a page of 25 through `pageQuery` instead of a LIMIT of 5 to 10 (BACKEND_STRUCTURE §16) |
| praxis `scripts/check-ai-manifest-coverage.js`, `check-search-registry.js` | Gate 9 kept (a manifest or `// ai:none <reason>` in the controller, a reason required), counting a module once its controller has content. Gate 10: the backend half (records need a provider or `// search:none <reason>`; providers load); the screen-registry half waits for the staff app. Gate 19 (`ai-no-writes.js`) and the vendor guard (`ai-vendor-imports.js`) are new |
| praxis `scripts/db/check-migration-numbers.js` | Kept: a duplicate number fails, a badly named file fails, and each milestone owns its README §6.3 block. Changed: schema SQL lives in `migrations/` and deterministic reference SQL in `seeds/reference/`; numbers are unique across both and `migrate.js` interleaves them into the same ledger. Five-digit names begin at M10. Build and staging demo seeds remain separate JavaScript runners and never run in production. |
| praxis `scripts/db/check-migration-reversibility.js` + `check-destructive-migrations.js` | Merged into gate 4. Kept: a DOWN or an `-- IRREVERSIBLE: <reason>` declaration (a reason required), and `-- DESTRUCTIVE: <reason>` on a DROP, TRUNCATE, DELETE, RENAME, type change or SET NOT NULL, on the line or the line above. Changed: the marker may also sit in the file header (README §6.3 says destructive steps are declared there); statements inside function bodies and DO blocks are not counted; DOWN must name each table, view, function, type, sequence, trigger and added column its UP creates; with a database it runs UP, each DOWN against the catalogue as it was before that file, then UP again, on a throwaway database. `migrate.js --down` now refuses a file declared irreversible. No grandfathered list: the repository starts with none |
| praxis `scripts/db/check-migration-idempotency.js` | Kept: the rules (IF NOT EXISTS, IF EXISTS, OR REPLACE, constraints and types inside a DO block, ON CONFLICT per statement, the ON COMMIT DROP temp-table exemption). Changed: every dollar-quoted body is exempt, not only DO blocks (a function body runs when called); single-quoted strings are blanked; added CREATE SEQUENCE and DOMAIN, and CREATE/DROP INDEX CONCURRENTLY, which cannot run in the transaction each migration runs in. The hash baseline is replaced by git: a migration that existed before the change and was edited, renamed or deleted fails (`migrate.js` still refuses an edited file on a database that has it) |
| praxis `scripts/check-dashes.js` | Gate 17 is the screen gates' `dashes.js` (shared rules in `scripts/check/lib/copy.js`), merged from the frontend foundation. The backend adds `packages/` string literals and the AI prompt files to its scope: the model copies the style it is given |
| praxis `scripts/check-date-format.js` | Kept: the order-sensitive test (a day beside a month), the locale checks, the literal MM/DD/YYYY, ISO on paper, the `@date-format:parts`, `:foreign` and `:filename` markers and the per-rule file allowlist. Changed: backend code formats dates for people only through `shared/time/day-first.js`, so any order-sensitive Intl or toLocale date call outside `shared/time/` fails whatever its locale; Intl used only for `formatToParts()` passes on its own; paper is mail, PDFs, templates, spreadsheets and the import error file; the frontend rules apply to `app/src` and `public-app/src`; the twin-file check is dropped |
| praxis `scripts/db/check-query-columns.js` + `check-schema-drift.js` | Gate 6, as `scripts/check/schema-drift.js` and `contract-columns.js` over one catalogue (`scripts/check/lib/catalogue.js`). Kept: the schema is read from the migration files alone, no database; tables a reader cannot follow are opaque and never produce a finding; CTEs, subqueries, functions in FROM and interpolation are skipped; `alias.column` is checked against the alias's table; dropped and renamed-away tables are refused; a table created twice with different columns is drift. Changed: only UP sections are replayed, in `migrate.js` order (both folders interleaved); a second CREATE of an existing table adds nothing, as in Postgres; INSERT column lists and UPDATE SET lists are checked too; tables no migration creates are refused; `FOR UPDATE` row locks and the `pg_` catalogues are left alone. No grandfathered baseline: the repository starts clean. `contract-columns.js` is net-new: each contract file's `TABLES` declares the table every exported object schema's keys are the columns of, with a reason for any key that is not |
| (no donor) `scripts/check/money.js`, `module-catalogue.js`, `production-environment-refs.js`, `shell.js`, `scripts/import/run.js` | Net-new. Money: parse, round, toFixed and arithmetic on money-named values, SQL float casts and money columns that are not numeric(18,2). Catalogue: keys and actions from `requirePermission`, `requireAnyPermission` and `mountResource` must be in the catalogue and literal; a key nothing enforces is a note until `--exact` at M9. Production refs: only release.yml and rollback.yml name the production environment, no expression environments, no PROD secrets. Shell: LF, a #! line and `bash -n` for shell scripts, and every JavaScript file parses. The import command line drives the same engine as the Imports screen, as a named person |
| praxis `security/app_user/app_user.service.js` (two-step sign-in) | Kept: the 5-minute ticket between the first step and the code; recovery codes as the same door under the same limit, ten characters from a 31-letter alphabet (about 2^49.5); a browser earns its window only by giving a code. Changed (16/10/2026): no `otplib` (RFC 6238 on `node:crypto`, checked against the RFC's vectors; otplib 13 is ESM-only and 12 deprecated); each code's step accepted once (`mfa_last_step`); how often a browser is asked is the person's choice (every sign-in, once a day, once a month); a new key waits for its first code before anything changes; recovery codes Argon2id; a wrong code counts with the password's wait; the issuer is MyCity App |
| praxis `security/app_user/webauthn.service.js`, `webauthn.controller.js`, `webauthn.repo.js` | Kept: the stateless 5-minute signed ticket, user verification required, the email bound into the sign-in ticket on a known browser, the counter check. Changed (16/10/2026): `@simplewebauthn/server` 13 (the donor's was 9); single use through `spent_challenge` in the transaction that opens the session, not Redis with a per-process fallback; the relying party ID and origin from `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`, by default the staff origin's host; discoverable passkeys only, at most 10 a person; a passkey counts as both steps |
| praxis `security/app_user/session-policy.js` (`assertFreshAuth`) | Kept: adding or removing a way in needs a recent sign-in. Changed (16/10/2026): `assertFresh` reads `user_session.reauthenticated_at` against `CREDENTIAL_ENROL_WINDOW_MIN` (15); past it a 403 `REAUTH_REQUIRED` and one `POST /security/confirm` (the password, the PIN or a passkey), instead of a password on every route |
| (no donor) the PIN | Net-new (16/10/2026): four digits on a known browser, Argon2id, weak shapes and the birthday refused, the password's wait, off after 10 wrong in a row or 20 in 30 days; `verifyPin` is the one check, which attendance will reuse |

---

## 2. M1 — Core Operations & Employee Management · 12% · ₦384,000

Four deliverables: dashboard, clock-in/out, ESS, staff community. Plus the mailbox client, per D6.

### 2.1 Dashboard — Tom-Blake

| Donor | loc | Take | Leave |
|---|---|---|---|
| `praxis-ls/src/modules/dashboard/kpi_catalog/` | 1,671 / 11 files | **The whole pattern.** `index.js` (221) self-checks at require time and throws at boot on a half-flipped entry. `eligibility.js` (97) + `guards.js` (54): a tile **inherits** rights, never grants them — eligibility is computed at read time, so revoking a module silently retires its tiles | `money.js` (294), `operations.js` (201), `fleet_warehouse.js` (167), `sales_procurement.js` (120) — **831 loc of KPIs MyCity has no modules for** |
| `praxis-ls/src/modules/dashboard/kpi_catalog/human_capital.js` | 247 | 6 tiles that port almost unchanged: `headcount`, `attendance_today`, `leave_pending`, `vacancies_open`, `payroll_run_state`, `attrition_90d` | — |
| `praxis-ls/src/modules/dashboard/dashboard/` | 727 | `dashboard.service.js` (314) + `repo` (295) — band assembly, role config | — |
| `praxis-ls/client/src/features/dashboard/` | 12,692 | Band layout, tile picker, role-locked tiles | Most of it. Logistics control-tower screens do not apply |

**Net-new tiles for MyCity:** partnership pipeline, pending expenses, budget vs actual, pending
documentation, upcoming confirmations and reviews. Five tiles against an existing registry.

**The trap you named last night:** no sales. `sales_procurement.js` must not be ported "for later".

### 2.2 Clock-in / clock-out — Love Adeola

**Two donors, and Pixie wins the engine.**

| Donor | loc | Verdict |
|---|---|---|
| `pixie-girl-hub/src/shared/attendance/` | 749 / 7 | `attendance.repo.js` (189), `geo.calc.js` (170), `attendance.service.js` (161). **Lagos-native.** |
| `pixie-girl-hub/src/shared/hr_payroll/lateness.calc.js` | 314 | **Pure, no DB.** Daily pay pro-rated over the brand's working days; tiered lateness deduction (default 1h = 10%, 2h = 20%, 3h = 30% of that day's pay), tiers configurable |
| `pixie-girl-hub/src/shared/hr_payroll/clock.guard.js` | 62 | `evaluateClockTransition` — stops a double clock-in |
| `pixie-girl-hub/src/shared/hr_payroll/devices.service.js` + `.repo.js` + `device.guard.js` | 601 | Device enrolment and the unenrolled-device flag Cynthia saw demonstrated |
| `praxis-ls/src/modules/hr/attendance/` | 4,084 / 15 | **Take selectively.** `attendance.rules.js` (251) — `wallClock` uses the workplace timezone, not the host clock. `attendance.reconcile.js` (441) — the reconcile/waive/uphold loop. `attendance.analytics.js` (393) — M2's analytics, built early. `attendance.export.js` (286), `attendance.calendar.js` (223), `attendance.weekly.js` (300) |
| `praxis-ls/src/modules/hr/attendance/attendance.query.js` | 124 | Auto-query on a late punch, upserted on `(employee, work_date, rule)`. The reconciler **adopts** it rather than reopening it |
| `praxis-ls/client/src/features/hr/attendance.tsx` + `attendance-history.tsx` | 1,505 | Screens |

**The policy model to inherit** (`doc/CLOCKIN_REVAMP_ENGINEERING_GUIDE.md` §1.2):
`hr.geofence` = `off | warn | block` (default warn), `hr.device_policy` = `off | warn | block`
(default off, devices still **register** when off), `hr.attendance_policy` = `{work_start,
grace_minutes}`, plus `hr.weekend_days` and `employee.work_days`.

**Known gaps in the Praxis donor**, documented in its own guide and still open: no analytics
endpoint, no export endpoint, no punch date range (`date` or `employee_id` only), no multi-employee
filter. We build those rather than inherit them missing.

### 2.3 ESS — Adole Jerome

| Donor | loc | Take |
|---|---|---|
| `pixie-girl-hub/src/shared/hr_payroll/hr_ops.service.js` | **1,633** | The self-service dashboard: live earnings tracker, lateness, schedule, leave, monthly target countdown, tasks, contracts. Plus **the lateness → query → waive/uphold loop**: reconcile flags a late day, auto-raises a query, the deduction shows on the running salary until HR waives (restored) or upholds (deducted from net) |
| `pixie-girl-hub/src/shared/hr_payroll/hr_ops.repo.js` | 1,354 | Its SQL |
| `pixie-girl-hub/apps/admin/src/pages/hr/MyHrPage.tsx` | — | The screen Cynthia asked to rename to ESS |
| `pixie-girl-hub/src/shared/hr_payroll/staff_documents.*` | 952 | Employee document vault, 4 files |
| `praxis-ls/client/src/features/hr/employee-360.tsx` | **2,420** | The employee 360 you said to bring across |
| `praxis-ls/src/modules/hr/leave_allowance/` | 1,119 | Leave requests and balances |

**Rename discipline:** "My HR" → "Employee Self-Service (ESS)" is a client decision from 2 September
and appears in both the PRD and the SOW. Praxis's prose gate has a sharp lesson here — renaming an
English label moves its dictionary key, and `AREA_ICON` was keyed by display label, which silently
dropped five areas onto one glyph. With Q15 answered "English only" the dictionary risk disappears,
but **copy used as a key** is still a real hazard.

### 2.4 Staff community (SmartComms) — Godwin-Okoh Elisha

`praxis-ls/src/modules/smartcomm/` is **9,962 loc** and splits cleanly:

| Half | loc | Verdict |
|---|---|---|
| **Chat** — `smartcomm.service.js` (645), `repo` (417), `controller` (435), `routes` (281), `validator` (235), `media.service.js` (351), `presence.js` (220), `links.service.js` (606), `erp.service.js` (444), `config.service.js` (152), `schedule.service.js` (83), events, ai | **4,212** | **Take.** Its own header: channels (department / project / dossier / direct / client) with members, presence, read receipts, reactions, stars, drafts, quick replies, search, and a tamper-evident SHA-256 certified export. Membership is the authorization boundary |
| **Calls** — `call.pipeline.service.js` (1,817), `call.service.js` (1,195), `call.repo.js` (899), `diagnostics.service.js` (836), `turn.secret.service.js` (268), `turn.service.js` (133), `call.signals.js` (200), `call.gate.js` (163), `call.clock.js` (113), `call.vocab.js` (47) | **5,750** | **Leave.** WebRTC voice calling with a TURN server. Nothing in any MyCity document asks for it |

`smartcomm.media.service.js` (351) matters and is worth reading before anyone touches it: it routes
bytes by **what the file is**, not who uploaded it — real documents (pdf, xlsx, docx, csv) to the
document vault, chat media (image, audio, video) to `comms_media`. Voice notes were explicitly
asked for; this is the file that handles them correctly.

Frontend: `praxis-ls/client/src/features/comms/team-chat.tsx` + `chat/`.

### 2.5 Mailbox client (D6 — full client in M1)

`praxis-ls/src/modules/mail/` is **23,441 loc / 110 files**. The split:

| Sub-area | loc | files | Verdict |
|---|---|---|---|
| `mail/mail/` — the client | **12,250** | 39 | **Take** |
| `mail/signature/` — signature builder | 3,414 | 17 | Leave for now (palette, PNG render, gap analysis) |
| `mail/triage/` — ticket triage + SLA clock | 2,368 | 13 | Leave. Praxis-LS logistics desk |
| `mail/assist/` — AI on mail, OCR | 2,261 | 10 | Leave until M10 |
| `mail/binding/` — bind a thread to an ERP record | 2,126 | 19 | **Take in M7** — this is how a thread attaches to a partner record |
| `mail/deliverability/` — DNS/SPF/DKIM checks | 829 | 11 | **Take `route-check.js` (288) and `dns-check.js` (180)** in M0; they are what stop "it works locally" |
| `mail/public_secure/` | 193 | 1 | Leave |

Inside `mail/mail/`:

- `mail.service.js` — **1,808 loc**, the engine. Provider-agnostic; business code never calls a
  provider directly. Secrets live AES-256-GCM in the `integration_secret` section keyed
  `mail_conn:<id>`, never on the connection row.
- `providers/imapSmtp.provider.js` — **411**. imapflow inbound, nodemailer outbound, lazy-required
  so the web process does not load an IMAP stack it never uses. Covers cPanel, DTR and private
  servers. **This is the only provider MyCity needs.**
- `providers/microsoftGraph.provider.js` (186) + `microsoftOAuth.js` (220) + `gmail.provider.js`
  (225) + `googleOAuth.js` — **delete**. You were explicit: no Microsoft, no Google, custom domain
  only.
- `thread.repo.js` (866) + `thread.service.js` (456) + `threading.js` — threading
- `outbox.service.js` (747) + `outbox.repo.js` (367) — send queue
- `folders.js` — the canonical six (Inbox, Sent, Drafts, Spam, Archive, Trash) + read-only user folders
- `autodiscover.js` (145) — IMAP/SMTP host and port discovery from the address
- `smtp-error.map.js` (195) — one classifier shared by connection-test and system email, so the UI's
  fix guides key off the same codes
- `compose.js` (542), `mail.validator.js` (598), `mail-notify.service.js` (475), `access.js` (230),
  `visible.js` (228), `search.js` (212), `presend.js` (204), `attachment.service.js` (202),
  `schedule.js` (175), `origin.js` (169)

**The precise port cost.** `mail.service.js` has hard `require`s into four areas we are not taking:

```
require("../triage/ingest-hooks")       // 314 loc
require("../triage/followup.service")
require("../binding/intake.service")    // 288 loc
require("../assist/semantic.service")   // 169 loc
require("../assist/ocr.enqueue")
```

Those five lines are the whole job: cut them to no-ops behind a feature check, or the port drags
4,900 loc of triage and assist in behind it. **This is the single most likely way M1 overruns.**

Jobs: `src/jobs/mail-sync.js`, `src/jobs/handlers/mail-sync-scheduler.js`, `src/jobs/mail-idle.js`
(IMAP IDLE for push).
Frontend: `client/src/features/comms/inbox/`, `mail-setup-wizard.tsx`, `setup/`. Taken so far (18/10/2026):
`email-frame.tsx` and `email-doc.ts` (the sealed frame, its policy, fit to width, `mailto:` parsing) as
`packages/ui/src/documents/EmailFrame.tsx`, and `email-dark.ts` (the dark-mode partial inversion) as
`packages/ui/src/lib/email-dark.ts`; `message-body.ts` (the remote-content pass, `cid:` resolution and
quoted-history folding) as `packages/ui/src/lib/email-body.ts`, which re-parses the stored body for each
render instead of keeping held-back URLs on the markup, and splits plain-text replies line by line
because our server joins their lines with `<br>`. The sender trust is ours: `mail_image_trust` (1125).
Reference: `doc/SMART_MAIL_ENGINEERING_GUIDE.md` — a binding decision log on all 35 questions, plus
`doc/SMART_MAIL_FIELD_NOTES.md`, which is the defect log of what actually broke after each PR.
**Read the field notes before starting, not after.**

---

## 3. M2 — Productivity & Performance · 9% · ₦288,000

Four tabs: My Workspace, Tasks, Calendar, Analytics.

### 3.1 Tasks and calendar — Praxis, decisively

| Donor | loc | Note |
|---|---|---|
| `praxis-ls/src/modules/dashboard/workspace/tasks.service.js` | **2,703** | Statuses are exactly the PRD's: `TO_DO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `CANCELLED` |
| `praxis-ls/src/modules/dashboard/workspace/tasks.repo.js` | **2,236** | |
| `praxis-ls/src/modules/dashboard/workspace/tasks.validator.js` | 499 | |
| `praxis-ls/src/modules/dashboard/workspace/tasks.controller.js` | 414 | |
| `praxis-ls/src/modules/dashboard/workspace/recurrence.js` | 331 | Canonicalises repeat rules and **rejects** rules the product does not implement — a 422 naming the field, not a half-applied RRULE |
| `praxis-ls/src/modules/dashboard/workspace/workspace.time.js` | 175 | `timezoneOf` / `toInstant` |
| **Total** | **6,790** | vs `pixie-girl-hub/src/shared/tasks/` at **996**. Not close |

Two ideas in `tasks.service.js` worth preserving verbatim:

1. **A task is a pointer, not a note.** `link_url` is **derived on every read** from `entity_type` +
   `entity_id` via the shared entity-route map, never stored. Storing it freezes today's routes into
   yesterday's rows, and the failure is silent because the SPA catches the unknown path and lands on
   the dashboard. The same map serves notifications, so the bell and the task panel open the same
   screen — which is why it lives in `packages/shared`.
2. **Audience is not a new mechanism.** "Only certain roles see everyone else's" is
   `req.permission_scope` / `req.scope_ids`, already set by `middleware/rbac.js` from grants and the
   organigram closure. The service reads it and never invents its own rule.

Frontend — `praxis-ls/client/src/features/workspace/` (12,436 loc): `analytics/analytics-page.tsx`
(**1,560**), `tasks/task-panel.tsx` (1,138), `tasks/task-board.tsx` (800), `tasks/task-list.tsx`
(515), `today.tsx` (493), `tasks/task-dialog.tsx` (475), `calendar/event-dialog.tsx` (451),
`calendar/calendar-page.tsx` (419), `tasks/task-blockage.tsx` (395). Tests ship with them
(task-board 681, today 348, task-panel 517).

**That is the Analytics tab already built** — 1,560 loc of it. Read
`doc/MY_WORKSPACE_TASKS_CALENDAR_TODAY_GUIDE.md`: Analytics was the fourth-section candidate and the
guide records the decisions behind it (canonical path-based URLs plus a legacy adapter,
least-privilege owner/assignee/invitee visibility, overdue carry-over on Today).

**One decision to carry over:** Praxis links tasks to operations files. MyCity has no operations
files. Link to partnerships and vacancies instead — `entity_type` already makes that a map entry,
not a schema change.

### 3.2 Performance and KPIs

| Donor | loc | Note |
|---|---|---|
| `praxis-ls/src/modules/hr/appraisal/` | 1,208 / 10 | `appraisal.review.js`, `appraisal.rules.js`, `appraisal.evidence.js` |
| `praxis-ls/src/modules/security/role_kpi/` | 398 | Per-role KPI config: scope, default, lock. The tenant-facing dial over the catalogue. **Moved to M1 Home** by owner decision (TB, 17/10/2026; `docs/guides/home.md` §4): defaults and locks only (`role_kpi`, no scope), plus each person's own pick (`home_kpi_pick`). The editor screen stays in M9 Settings · Roles |
| `pixie-girl-hub/src/shared/hr_payroll/appraisal.autoscore.js` | 280 | Auto-scoring from counted activity |
| `pixie-girl-hub/src/shared/hr_payroll/appraisal.service.js` + `.repo.js` + `.metrics.js` + `.review-pdf.js` | 890 | Review cycle and the PDF |
| `pixie-girl-hub/src/shared/goals/` | 1,318 / 12 | Targets with `notes`, and `target.progress.subscribers.js` auto-counting progress from domain events |
| `pixie-girl-hub/src/shared/org_workflow/org.*` | 1,336 | Org chart + reporting lines — what decides whose targets a manager may set |

**Weighted KPIs** (PRD: "KPI weights") exist in neither donor as weights. Small, net-new.

---

## 4. M3 — Queries & Consequence Management · 5% · ₦160,000

**This is the milestone I got wrong on the first pass, and the correction matters.**

`praxis-ls/src/modules/hr/hr_query/` is **209 loc across 7 files**.
`praxis-ls/src/modules/hr/hr_sanction/` is **206 loc across 7 files**.

Both are thin wrappers over `makeService({repo, ...})`. Read `migrations/tenant/0475_hr_discipline_and_avatar.sql`:

```sql
CREATE TABLE hr_query (
  severity text NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO','WARNING','SERIOUS')),
  status   text NOT NULL DEFAULT 'OPEN'    CHECK (status IN ('OPEN','RESPONDED','CLOSED')),
  ...);
CREATE TABLE hr_sanction (
  type     text NOT NULL CHECK (type IN ('WARNING','SUSPENSION','DEMOTION','FINE','DISMISSAL')),
  amount_xaf numeric(18,2),
  ...);
```

**Two flat tables with a nullable FK between them.** `grep -ril escalat src/modules/hr/` returns
**nothing**. There is:

- no chain, no ordering, no "second warning"
- no thresholds ("query on the third offence, not the first" — Cynthia asked for this three times)
- no rule configuration
- no system-generated warning / suspension / termination letters
- no "add a step to the flow"
- and `amount_xaf` is a **hard-coded currency column name**

**What does exist, and is genuinely useful:**

| Donor | loc | What |
|---|---|---|
| `praxis-ls/src/modules/hr/attendance/attendance.query.js` | 124 | One real auto-query: late punch, upserted on `(employee, work_date, rule)`, adopted by the reconciler |
| `pixie-girl-hub/src/shared/hr_payroll/hr_ops.service.js` | within 1,633 | The lateness → query → waive/uphold loop **with the financial consequence wired to the running salary**. Attendance-specific, but it is the pattern |
| `pixie-girl-hub/src/workflows/engine.js` + `conditions.js` | — | Threshold-aware JSONB stages. This is what "add a step without a code change" needs |
| `praxis-ls/src/modules/vault/report/` + `services/documents/templates` | 734 + | Letter generation from a template |

**Honest assessment: M3 is roughly 70% net-new.** The rule engine, the configurable chain, the
thresholds and the generated letters are all new work. The SOW weights M3 at **5%** — the
second-smallest milestone — and it sits in week three. The two tables give us the schema shape and
the two loops give us the pattern; neither gives us the engine.

Set against that: the consequence chain is a **state machine over a workflow definition**, and if
the Pixie engine is standing from M0 (Q11) the chain becomes a definition plus letter templates
rather than an engine. That is the difference between M3 fitting in 5% and not.

---

## 5. M4 — Recruitment End to End · 13% · ₦416,000

Largest milestone. Two donors, and they overlap.

### 5.1 Vacancy and applicant pipeline

| Donor | loc | Note |
|---|---|---|
| `praxis-ls/src/modules/hr/vacancy/vacancy.service.js` | 638 | Lifecycle `DRAFT → OPEN ⇄ PAUSED → CLOSED`. **PAUSED keeps the careers token**, so resuming restores the *same* public link |
| `praxis-ls/src/modules/hr/vacancy/vacancy.scoring.js` | **424** | **Read the header before writing any scoring code.** Two tiers: `estimate()` is arithmetic, microseconds, free, marked **PROVISIONAL**; `assess()` reads the résumé against the JD and costs a model call, marked final. Both write the same columns; `ai_provisional` tells them apart and **every surface that renders a score must render that flag**. The failure it exists to prevent is named in the schema comment: a recruiter rejecting somebody on the strength of a "97% match" that never opened a CV |
| `praxis-ls/src/modules/hr/vacancy/vacancy.draft.js` | 453 | AI-drafted JD |
| `praxis-ls/src/modules/hr/vacancy/vacancy.questions.js` | 101 | Generated screening questions |
| `pixie-girl-hub/src/modules/recruitment/` | **5,317** / 18 | `recruitment.service.js` (832), `recruitment.vacancy.repo.js` (657), `recruitment.vacancy.service.js` (647), `recruitment.vacancy.ai.js` (577) |
| `praxis-ls/client/src/features/hr/` | — | `vacancy.tsx` (1,033), `applicant-drawer.tsx` (754), `vacancy-editor.tsx` (635) |

### 5.2 The public candidate surface

`praxis-ls/src/modules/hr/careers/careers.service.js` (**445 loc**) is the strongest single donor in
M4, and the reason is its security model. Its own header:

- **A vacancy is only reachable by its token**, never by `vacancy_id`. Ids appear in admin URLs,
  exports and logs, so accepting one here "would quietly turn every internal identifier into a
  public credential." The token is 32 bytes of CSPRNG minted at publish.
- **The response is an allow-list, never a row.** `SELECT *` on `vacancy` would ship `scope_id` and
  `ai_generated` to the public today and whatever column somebody adds next, tomorrow.
- **An application is write-only.** Applying returns an acknowledgement and an opaque reference,
  never the created row — a candidate must not be able to read back their own AI score.

That is exactly the model the assessment platform needs. Also `recruitment.careers.public.routes.js`
(81) and `recruitment.careers.service.js` (290) in Pixie.

### 5.3 Multi-panel blind assessment — closer than it looked

`praxis-ls/migrations/tenant/0525_recruitment_ai_scoring.sql`:

```sql
CREATE TABLE applicant_answer (
  applicant_id        uuid NOT NULL REFERENCES job_applicant(applicant_id),
  vacancy_question_id uuid NOT NULL REFERENCES vacancy_question(vacancy_question_id),
  rating              numeric(2,1) CHECK (rating >= 0 AND rating <= 5),
  notes               text,
  rated_by            uuid REFERENCES app_user(user_id),
  rated_at            timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX ux_applicant_answer_pair
  ON applicant_answer(applicant_id, vacancy_question_id);
```

**`rated_by` is already there.** But the unique index is on `(applicant_id, vacancy_question_id)` —
**it excludes the rater**, so today one rating per question exists in total, not one per panelist.
The table comment says `job_applicant.rating` is the average of these and is written by the service
on every upsert.

**The precise change for M4:**

1. Widen the index to `(applicant_id, vacancy_question_id, rated_by)`
2. Add a panel round with a state (`OPEN` / `CLOSED`) and a members list
3. One predicate on the read path: a reviewer sees only their own rows until the round closes
4. Recompute `job_applicant.rating` as the average across raters, not across questions

That is a migration, a state column and a predicate — not a module. **The blindness is one `WHERE`
clause**, and it is the whole of what Cynthia asked for.

### 5.4 Genuinely net-new in M4

`grep -ril "psychometric\|panelist" src` returns **zero** in both repos.

- Psychometric test authoring and delivery
- Technical tests and case studies, including structured spreadsheet responses
- Timed submission, autosave, resume-after-disconnect
- Weighted scorecard (Screening 15 + Psychometric 15 + Technical 25 + Case Study 20 + Interview 25)
- Recruitment SLA / time-at-stage tracking

**M4 is roughly 45% net-new.** Pipeline, scoring, careers portal and interview notes port. The
assessment platform does not exist anywhere.

---

## 6. M5 — Offers, Documentation & Onboarding · 11% · ₦352,000

**Two e-signature donors. The light one is the right one.**

| Donor | loc | Verdict |
|---|---|---|
| `pixie-girl-hub/src/shared/documents/documents.esign.service.js` | **939** | **Take.** Plus `esign.repo.js` (352), `esign.certificate.js` (150), `esign.signed-pdf.js` (149), `esign.controller.js` (141), `esign.validator.js` (83). ~1,800 loc total |
| `pixie-girl-hub/src/modules/recruitment/recruitment.render.js` | **742** | **Take.** One safe markdown→HTML renderer is the SSOT for both the generated PDFs and the candidate-facing offer page, so **what the candidate reads on the web matches the signed PDF**. Produces JD, Offer Letter (with execution block) and full Offer Packet. When the candidate signs, the actual base64 signature image is **stamped into the execution block** so it rides in the PDF — not a "signed" placeholder |
| `praxis-ls/src/modules/vault/` | **10,522** / 77 | **Take two of ten.** `document_vault/` (2,043) for storage, retention and versions; `document_verification/` (673) for the public verification page |
| `praxis-ls/src/modules/vault/{qes,qes_public,signature_wet,compliance_flag}/` | 2,728 | **Leave.** Qualified e-signature tiers, wet-ink capture and a compliance-flag tier. The PRD asks for canvas + hash + public URL |
| `praxis-ls/src/modules/vault/{signature_request,document_signature,signature_public}/` | 4,344 | **Judgement call.** The dual-hash design is worth taking even if the tier model is not (below) |
| `praxis-ls/src/services/signatures/` | — | `canonical.js`, `certificate.js`, `qr.js`, `barcode.js`, `verify-link.js`, `tokens.js`, `otp.js`, `seal-view.js`, `mask.js`, `presets.js` |

**The one thing not to simplify away.** `doc/SIGNATURE_ENGINEERING_GUIDE.md` §1.1 Q2 settled on
**two hashes on every signature row**: `content_hash` over the canonical payload (recomputable) and
`artifact_hash` over the vaulted bytes (frozen). The verification portal reports **two verdicts**.
Drop `artifact_hash` and the public page confirms the payload while saying nothing about the bytes
actually stored. `praxis-ls/CLAUDE.md` states the backend rule: callers hash the master the image
pipeline **returns**, never the bytes they received.

Onboarding and documentation:

| Donor | loc |
|---|---|
| `praxis-ls/src/modules/hr/onboarding/` | 1,034 / 7 — incl. `onboarding.rules.js` (212), the checklist a hire raises |
| `praxis-ls/src/modules/hr/sop_onboarding/` | 783 / 9 |
| `praxis-ls/src/modules/hr/hr_contract/` | 992 / 8 |
| `pixie-girl-hub/src/shared/hr_payroll/staff_documents.*` | 952 / 4 |
| `praxis-ls/client/src/features/hr/onboarding.tsx` + `sops.tsx` | 1,380 |

Note the sequencing Cynthia asked for on 2 September: **documentation happens before onboarding**.
`vacancy.service.js` already requires `onboarding.rules` and `onboarding.service` — the hire→checklist
bridge exists; the order is a configuration of it.

---

## 7. M6 — Payroll & Notifications · 11% · ₦352,000

**The jurisdiction decides the donor, and Praxis is the wrong country.**

`praxis-ls/src/modules/hr/payroll/payroll.rules.js` (159 loc) is **Cameroon**:

```js
cnps_pension_rate: 0.042,  cnps_ceiling: 750000,  cnps_family_rate: 0.07,
cfc_employee_rate: 0.01,   cfc_employer_rate: 0.015,  fne_rate: 0.01,
frais_pro_rate: 0.30,      monthly_abatement: 41667,  cac_rate: 0.10,
irpp_brackets: [{upTo: 2000000, rate: 0.10}, ...]
```

CNPS, CFC, FNE, IRPP with a CAC surtax. Every rate is wrong for Nigeria, and `hr_sanction.amount_xaf`
shows the currency is baked into column names elsewhere too.

**What is right about it** is the shape, and it is worth stating: pure, deterministic, no I/O; every
rate a **default** a tenant overrides via the run's config snapshot; rates effective-dated in
`tax_code` rows, resolved per period, with the entity's own `payroll_config` winning over both.
Payslips are computed **estimates** until validated.

**The Nigerian donor:** `pixie-girl-hub/src/shared/hr_payroll/`, **16,164 loc / 65 files**.

| File | loc | What |
|---|---|---|
| `payroll.calc.js` | **235** | **Pure, no DB.** `progressiveTax(taxable, bands)` over ordered bands; `computeDeductions({gross, pensionableBase, configs})`. Pension and NHF are tax-deductible and reduce the PAYE base; consolidated relief is both a flat NGN amount and a percentage. Rounded to **kobo** at the edges |
| `payroll.service.js` | 1,288 | Run lifecycle |
| `payroll.repo.js` | 977 | |
| `config.repos.js` | 150 | `payroll_deductions` — PAYE bands, pension %, NHF, **effective-dated**, admin-maintained. Fields incl. `consolidated_relief_ngn`, `consolidated_relief_pct` |
| `payslip.pdf.js` | 526 | Payslip PDF, NHF line included |
| `payslip.breakdown.js` | 192 | The breakdown drawer |
| `payroll.postings.js` | 107 | GL postings |
| `rewards.*` | 700+ | Rule-driven bonus automation |
| `salary_advance` (Praxis, 229) | 229 | Advances |

**The D5 decision maps onto this cleanly.** The engine is already config-driven, so "simple by
default, statutory behind an advanced toggle" is *a config row set*, not a second engine. ITF (1%)
and NSITF (1%) are **employer** charges and are the only two not already modelled — Pixie has PAYE,
pension (employee and employer) and NHF. Two rate rows and two GL postings.

`posting-map.js` already has `NHF_PAYABLE: "2230"` and `NHF_EMPLOYER_EXPENSE: "5140"`.

Notifications:

| Donor | loc | Note |
|---|---|---|
| `praxis-ls/src/modules/notification/` | 1,570 / 7 | **Read-only on the caller's own inbox.** Rows are written by the event engine's fan-out. Its header records why: "the previous generic CRUD leaked every tenant row" |
| `praxis-ls/src/shared/notifications/` | 910 / 4 | `categories.js` (155) + `notify-events.js` (237) |
| `praxis-ls/src/shared/push/push.service.js` | 437 | Web push |
| `pixie-girl-hub/src/shared/notifications/` + `push/` | 460 | |
| `packages/shared` | — | `notificationInterrupt`, `notificationEmailDefault`, `entityRoute` — the bell and the task panel open the same screen |

---

## 8. M7 — Partnerships, CRM & Trackers · 10% · ₦320,000

| Donor | loc | Note |
|---|---|---|
| `praxis-ls/src/modules/master/party-360.service.js` | **332** | **The 360 pattern you named.** One call returns the master record, KPIs, aging, and child collections (contacts, addresses, banks, documents, registrations). Built to render for a **brand-new party with zero data** — every figure defaults to 0, every collection to `[]`. That is an acceptance gate in its own spec and it is why the screen does not look broken on day one |
| `praxis-ls/src/modules/sales/partnership_request/` | 1,117 / 8 | **The decision is a transition, not a column write.** Approve is reachable only from `IN_REVIEW`; reject demands a reason the database also enforces; both stamp `reviewed_at` / `reviewed_by_user_id`. Approving creates the downstream record **in the same transaction** |
| `praxis-ls/src/modules/sales/{lead,opportunity,meeting}/` | 1,943 | Pipeline stages, stage movement, interaction history |
| `praxis-ls/src/modules/sales/proposal/` + `proposal_public/` | 553 | Proposal generation and the public view |
| `pixie-girl-hub/src/modules/crm/` | 2,830 / 9 | Incl. `crm.presets.js` — pipeline presets. `PipelineStagesPage.tsx` is the admin UI |
| `pixie-girl-hub/src/shared/contacts/` | 2,681 / 8 | Contact master with `country-codes.js` |
| `praxis-ls/src/modules/mail/binding/` | 2,126 / 19 | **Now it earns its place** — `intake.service.js` (288), `mail-context.service.js` (283), `context-tabs.js` (227), `convert.service.js` (203). This is how a mail thread attaches to a partnership record, which is the "conversation history" line in the PRD |
| `praxis-ls/src/modules/hr/vacancy/vacancy.draft.js` | 453 | The AI-drafting pattern, repointed at proposals and MOUs |

Contract and MOU lifecycle (`Draft → Review → Approval → Sent → Viewed → Signed → Active → Expiring
→ Renewed/Closed`) reuses M5's e-signature plus the workflow engine. `hr_contract` (992) is the
closest existing lifecycle.

Excel migration — the generic pipeline (upload → map → validate → dedupe → preview → import → error
report → history) exists in neither repo. `praxis-ls/src/modules/master/_shared/dedup.service.js`
gives duplicate detection; `exceljs` is already a dependency in both. **Net-new, and it is M7's
real cost.**

---

## 9. M8 — Expenses & Budget Control · 8% · ₦256,000

**The best single-file match in the whole audit.**
`pixie-girl-hub/src/modules/cash_request/cash-request.service.js` — **642 loc**. Its header:

```
draft → pending_finance → (pending_ceo) → approved → disbursed → settled

STAGE 1  submit          User submits          → pending_finance
STAGE 2  financeDecision Finance validates     → pending_ceo (>= threshold)
                                                  OR approved (< threshold)
STAGE 3  ceoDecision     CEO approves          → approved
STAGE 4  disburse        Finance sends money    → disbursed
                         (mandatory bank_transaction_id; posts GL;
                          auto-creates an Expense for direct spends)
POST     settle          Receipts returned      → settled
```

Set that beside the PRD's `Request → Approval → Approved → Disbursement → Transaction Record →
Reporting` and Cynthia's `Line manager → Operations → CEO`. **It is the same state machine.**
Separation of duties is already there: a `business_config` threshold decides whether the CEO must
co-approve, and disbursement always requires the bank transaction ID as the audit anchor — enforced
by a DB trigger, not just the service. "Approved but not yet disbursed" is a first-class state.

| Donor | loc |
|---|---|
| `pixie-girl-hub/src/modules/cash_request/` | 1,428 / 7 |
| `pixie-girl-hub/src/modules/expenses/` | 2,052 / 7 — incl. `expenses.ai.service.js` (364), AI receipt categorisation |
| `pixie-girl-hub/src/shared/approvals/` | 541 / 3 |
| `pixie-girl-hub/src/shared/org_workflow/approvals.*` | 560 | Configurable hierarchy over the org chart |
| `praxis-ls/src/modules/finance/office_expense/` | 323 / 8 | Thin. Use Pixie's |

Budget vs actual: Pixie has `business_config` budgets and spend analytics; a department / project /
category budget table with variance is small net-new. The SOW weights M8 at 8% and most of it is
already written.

**Not ported:** the `business_config` threshold as a routing constant. Every request goes line
manager → Operations → requisition → CEO; the per-category threshold only flags a line for the
CEO's individual tick inside the requisition (`MILESTONES.md` §13).

---

## 10. M9 — Settings & Governance · 7% · ₦224,000

Built in M0 (clause 2.2: the permissions and audit foundation is laid at M1), surfaced in M9.

| Donor | loc | Note |
|---|---|---|
| `pixie-girl-hub/src/shared/iam/` | **3,141** / 6 | `iam.service.js` (1,057) + `iam.repo.js` (1,267). Argon2, **TOTP lifecycle**, session management, encrypted secrets. Every mutating function takes a `ctx` and calls the audit middleware |
| `pixie-girl-hub/apps/admin/src/pages/` | — | **The console is already built**: `IamUsersPage`, `IamMfaPage`, `IamSessionsPage`, `IamSecurityPage`, `IamSecurityEventsPage`, `IamAuditPage`, `IamAccessReviewsPage` |
| `pixie-girl-hub/src/shared/access/access.catalog.js` | within 1,658 | Module list as **single source of truth** — `MODULES` must equal the distinct `requirePermission(module, …)` keys enforced in `src/`. That equality is checkable, and should be a gate |
| `praxis-ls/src/modules/security/` | 7,226 / 76 | `audit_ledger/` (644), `permission/` (464), `scope/` (464), `capability/` (245), `field_visibility/` (64), `setting/` (410), `numbering_setting/` (99) |
| `praxis-ls/src/middleware/rbac.js` | 368 | `requirePermission` → `req.permission_scope` + `req.scope_ids` |
| `pixie-girl-hub/src/shared/audit/` | 372 / 6 | |

**Spell it `edit`, not `update`.** `praxis-ls/CLAUDE.md` names this; both backends spell the RBAC
action `edit`.

Field-level visibility matters here: the PRD says sensitive HR and payroll information is restricted
by role, and Pixie's 5-layer model ends at **field** (cost, salary, factory origin hidden from
non-privileged roles). `field_visibility/` (64) is the Praxis equivalent.

---

## 11. M10 — Staff Knowledge Hub & AI Assistance · 10% · ₦320,000

| Donor | loc | Note |
|---|---|---|
| `pixie-girl-hub/src/modules/help_center/` | 828 / 5 | Articles, categories, search. `HelpCenterPage` / `HelpArticlePage` / `HelpEditorPage` built |
| `praxis-ls/src/modules/hr/sop_onboarding/` | 783 / 9 | SOPs |
| `praxis-ls/client/src/features/hr/house-rules.tsx` | 617 | Policies |
| `pixie-girl-hub/src/modules/praxis_ai/` | **4,482** / 15 | `praxis.orchestrator.js` — one turn: RAG retrieve → LLM call with the `ai_enabled` action catalogue as tools → **a tool call materialises an `ai_pending_actions` row and nothing executes until a human confirms** → trace every step in `ai_run_steps` and record real token usage and cost. Plus `sql-agent.js`, `query-agent.js`, `query-catalogue.js`, `learning.service.js`, `praxis.executor.js` |
| `praxis-ls/src/services/ai/` | **7,691** | `orchestrator.service.js` (2,012), `llm.service.js` (710), `action-registrar.js` (335), `action-authz.js` (200), `retrieval.service.js` (204), `embeddings.service.js`, `redact.js` (205), `answer-sources.js` (309), `knowledge/entity-cards.js` (590) |
| `praxis-ls/src/modules/ai/governance/` | 605 | Spend caps and model config — the "80,000 units" cap Cynthia saw |
| `pixie-girl-hub/src/modules/ai_governance/` | 2,871 | `SpendBudgetPage`, `ModelsAndVendorsPage`, `AiAccessPage`, `TrainPraxisPage` |

**The one convention that must hold from M1, not M10.** Both repos derive the AI's tool catalogue
*only* from per-module `<module>.ai.js` manifests. Praxis gates it:
`AI manifest coverage` and `AI catalogue drift` are gates 18 and 19 there (gates 9 and 19 in this
build). **Under A23 the assistant reads only**, so the manifests carry reads and a route to the
owning screen, nothing else. Praxis's `ai-write-contract.test.js`, the `write` entries and Pixie's
`praxis.executor.js` / `ai_pending_actions` path are **not ported**.

A module written in M1 without its manifest is invisible to the M10 assistant. **Write the manifests
as each module lands**, or M10 becomes an archaeology exercise across ten weeks of code.

Vendor: Gemini (`@google/generative-ai` is already a `praxis-ls` dependency). DeepSeek dropped.
Pixie's `resolveVendor` returns null with no vendor configured and the caller falls back to a
graceful stub — safe to leave wired in every environment, which is what makes a feature flag honest.

---

## 12. M11 — Handover & Training · 4% · ₦128,000

| Donor | Note |
|---|---|
| `praxis-ls/doc/HANDOVER.md`, `TENANT_ONBOARDING_CHECKLIST.md`, `END_TO_END_OPERATIONS_WALKTHROUGH.md`, `E2E_DEMO_DATA_SHEET.md` | Structure for the manual and the three sessions |
| `praxis-ls/doc/INCIDENT_RUNBOOK.md`, `MONITORING_SETUP.md`, `BACKUP_RESTORE_SWEEP_2026-09-30.md` | What Year 1 support under clause 8.1 actually needs |
| `pixie-girl-hub/docs/PRAXIS_KNOWLEDGE_BASE.md` | The module → route → permission → tabs → "how do I…" navigation guide the AI is trained on, in the RAG ingest manifest and re-embedded every deploy |
| `pixie-girl-hub/docs/PDF_RENDERING_SETUP.md`, `UPLOAD_SIZE_LIMITS.md`, `DEPLOY_GIT_AUTH.md` | The three "works locally, fails live" write-ups. Read all three in M0 |

Clause 8.1 gives MyCity Year 1 free from completion of M11: defect fixes, security patching,
dependency updates, daily backups, uptime monitoring, six support hours a month.

---

## 13. Summary — reuse versus net-new

| M | Milestone | Wt | Primary donor | Est. reuse |
|---|---|---|---|---|
| 0 | Foundation | 0% | praxis-ls `shared/` + `middleware/` + CI; pixie workflow engine, Lagos time, money | **85%** |
| 1 | Core Ops & Employee Mgmt | 12% | pixie `hr_payroll` + `attendance`; praxis `smartcomm` chat + `mail/mail` + `kpi_catalog` | **72%** |
| 2 | Productivity & Performance | 9% | praxis `workspace` (6,790 be + 12,436 fe) | **50%** |
| 3 | Queries & Consequence | 5% | pixie workflow engine; two thin Praxis tables | **30%** |
| 4 | Recruitment End to End | 13% | praxis `vacancy` + `careers`; pixie `recruitment` | **55%** |
| 5 | Offers, Docs & Onboarding | 11% | pixie `documents.esign` + `recruitment.render`; praxis `document_vault` | **70%** |
| 6 | Payroll & Notifications | 11% | pixie `hr_payroll/payroll.*`; praxis `notification` | **80%** |
| 7 | Partnerships, CRM & Trackers | 10% | praxis `party-360` + `partnership_request` + `mail/binding`; pixie `crm` | **55%** |
| 8 | Expenses & Budget Control | 8% | pixie `cash_request` + `expenses` | **80%** |
| 9 | Settings & Governance | 7% | pixie `iam` + the built console; praxis `security/` | **85%** |
| 10 | Knowledge Hub & AI | 10% | pixie `praxis_ai` + `help_center`; praxis `services/ai` | **80%** |
| 11 | Handover & Training | 4% | both docs sets | n/a |

### 13.1 What the 10 October client meeting changed

Scope added by the client requirements meeting, **absorbed with no Change Report** and no change to
dates or weights. Recorded here because it moves the estimates above.

| Milestone | Added | Effect on reuse |
|---|---|---|
| M1 | Peer recognition, birthday and anniversary posts, per-day working week | 75% → **72%**. All three are small; the week is near free because the donor already stores `work_days` |
| M2 | Four-level goal cascade, separate PMS module, voice capture with AI cleanup | 80% → **50%**. The cascade has no donor in either tree. This is the largest single swing in the document |
| M3 | Two extra sanction tiers (caution, suspension without pay), fine as an attachable outcome, manager-sees-own-queries scope rule | 30%, unchanged. It was already mostly new |
| M7 | Partnership type configuration UI, partnership analytics page | 60% → **55%** |
| M8 | The requisition batching step between Operations and the CEO | 85% → **80%**. Not in the Pixie state machine |
| M10 | AI narrowed to read-only; writes route to the owning module | 70% → **80%**. The pending-action queue, executor and write contract all drop out |

**The net is close to zero in total and badly distributed.** M10 gives back roughly what M1, M7 and
M8 take. M2 absorbs almost all of the cost on its own, which is why the capacity released from M10
is pointed there.

**The four places the schedule is actually at risk, in order:**

1. **M2 (9% weight, now ~50% net-new, one four-day week).** Promoted to first place by the
   10 October additions. The goal cascade is a new data model with a five-level hierarchy, a
   four-stage approval and an upward trace from every individual KPI, and it lands in the shortest
   window in the build. It is also the milestone immediately before M3.
2. **M3 (5% weight, ~70% net-new).** The consequence chain does not exist in either repo. Worst
   effort-to-weight ratio in the SOW. Mitigated almost entirely by standing the workflow engine up
   in M0. **M2 and M3 are now consecutive weeks of mostly new code against 14% of the contract.**
3. **M4 (13%, ~45% net-new).** The assessment platform is greenfield. Largest milestone, and the
   part with no donor is the part the client cares most about.
4. **M1's mail port.** 12,250 loc with five `require` lines reaching into 4,900 loc we are not
   taking. Cut those five lines first, before anything else in the module.

**Two corrections to what I said earlier today, stated plainly:**

- I said M3 "is configuration against an existing engine." It is not. `hr_query` and `hr_sanction`
  are 415 loc of flat CRUD between them with no escalation anywhere in the tree.
- I said recruitment had rich donors and implied `talent_pool` was among them. `talent_pool` is
  **156 loc** and `hr_query` **209** — both stubs. The real recruitment donors are `vacancy` (2,483)
  and `careers` (801) in Praxis and `recruitment` (5,317) in Pixie.

And one thing I had missed entirely on the first pass: **`pixie-girl-hub/src/shared/hr_payroll/` is
16,164 loc of Nigerian HR** — Lagos-pinned time, NGN, PAYE/pension/NHF, device enrolment, lateness
tiers, the query→waive/uphold loop, appraisals with auto-scoring, staff documents. It is the primary
donor for M1, M2 and M6, and reading it first changes those three estimates more than anything else
in this document.

---

Engineered by [JBS Praxis](https://jbspraxis.com).

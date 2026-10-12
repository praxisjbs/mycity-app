# MyCity App ERP — 15 Questions Before the Milestone Document

**Status:** decision gate. The twelve-page milestone document is not written until these are answered.
**Date:** 9 October 2026 · **Audience:** delivery team only.
**Companion:** `REUSE_MAP.md` — the file-level audit of both repos. Read that first; every question
below cites it.
**Format:** three options, one marked (Recommended) with the reason, then a suggested answer.

---

## Part 0 — Already decided, so nobody re-opens it

| # | Decision | Source |
|---|---|---|
| D1 | Working dates only. SOW dates noted once, not per milestone. | 9 Oct |
| D2 | **M0 and M1 share one window.** M1 is not demonstrable until M0 is done. | 9 Oct |
| D3 | M0 carries **0% weight, no fee**. The eleven weights and the ₦3,200,000 split are untouched, so no Change Report. | 9 Oct |
| D4 | AI wherever needed (screening in M4, proposals and MOUs in M7). Only the **conversational assistant** waits for M10. | 9 Oct |
| D5 | M6 ships simple payroll by default with a **working** advanced toggle for PAYE, pension, ITF, NSITF. | 9 Oct |
| D6 | **Full mailbox client in M1**, adapted from `praxis-ls/src/modules/mail/`. | 9 Oct |
| D7 | Named owner per milestone area. Dashboard is Tom-Blake. | 9 Oct |
| D8 | Document carries a **reuse map** and the **engineering gates**. No risk register, no client-dependency section. | 9 Oct |
| D9 | Client delivers server, subdomain, DNS and SMTP on **9 October 2026** — all of it. | 9 Oct |
| D10 | Twelve pages, team-only, unbranded, markdown. | Brief |

**M1 split agreed 8 Oct:** Dashboard — Tom-Blake · Clock-in/out — Love Adeola · ESS — Adole Jerome ·
Staff community — Godwin-Okoh Elisha · Backend architecture and schema — Godwin-Okoh Elisha with
Love Adeola.

---

## Part 1 — Foundation (M0)

### Q1 · Codebase strategy, now that the donor is provably two repos

The audit settles the shape of this question. The donors do not compete — they divide:

- **`pixie-girl-hub` wins everything Nigerian, money and HR-operational.** `src/shared/hr_payroll/`
  is **16,164 loc / 65 files**: Lagos-pinned day boundaries (`lagos-time.js`), PAYE/pension/NHF over
  effective-dated config (`payroll.calc.js`), device enrolment, tiered lateness, the
  lateness→query→waive/uphold loop, appraisals with auto-scoring, staff documents. Plus
  `cash_request` (M8's exact state machine), `iam` (3,141, with the console already built) and the
  workflow engine.
- **`praxis-ls` wins everything communications, documents, tasks and plumbing.** `workspace`
  (6,790 backend + 12,436 frontend), `mail/mail/` (12,250), `smartcomm` chat half (4,212),
  `document_vault`, `party-360`, the search provider pattern, 89 UI primitives, 50 CI gates.

- **A — Fresh repository, port per the reuse map (Recommended).** Praxis module shape and plumbing;
  Pixie's Nigerian HR, money and workflow engine. *Reason: the two donors disagree on tenancy
  (DB-per-tenant vs schema-per-business), locale (Douala/XAF/OHADA vs Lagos/NGN) and money handling
  (raw `numeric` vs `decimal.js`). Forking either imports the disagreement and we spend eleven weeks
  managing it; `hr_sanction.amount_xaf` is what that looks like in a column name.*
- **B — Fork `praxis-ls` and strip.** Mail, smartcomm, tasks and vault arrive working on day one.
  Then M2 to M4 go on removing 392 tenant migrations' worth of tenancy, OHADA, XAF and the French
  side, and the Cameroon payroll engine has to come out anyway.
- **C — Fork `pixie-girl-hub` and extend.** Right locale, right money, the workflow engine and the
  IAM console. No mail client, no internal staff comms, and `shared/tasks` is 996 loc against
  Praxis's 6,790 — so most of M1 and M2 is a fresh build.

**Suggested answer: A.** Both forks throw away more than they keep.

---

### Q2 · Tenancy — one company, or room for Nairobi and Accra?

`praxis-ls` runs **one physical Postgres per tenant** plus a platform registry
(`doc/DB_ARCHITECTURE.md` §1), with `live`/`sandbox` as two schemas switched by `search_path`.
`pixie-girl-hub` runs **schema-per-business**. Either costs us `middleware/tenant-context.js` (207),
`host-tenent-resolver.js` (183) and `platform-auth.js` (131) — 521 loc of resolver we would be
maintaining for one company.

MyCity App Ltd is one company today. The product is city-replicated (My Lagos App exists; Nairobi
and Accra were named on the call) but this ERP manages **their staff**, not their cities.

- **A — Single database, single tenant, no abstraction (Recommended).** One schema, no brand column,
  no tenant resolver, those three middlewares deleted. *Reason: the SOW buys one company's
  operations in eleven weeks. An abstraction nobody exercises costs the schema, the repo layer and
  every query, and that time is time M4 needs.*
- **B — Schema-per-entity now, Pixie style.** Cheap at schema-design time, expensive to retrofit.
  Adds brand-context middleware and an entity header to every call for an entity that may never
  exist.
- **C — Single tenant, `entity_id` on every table.** The hedge: a later split becomes a migration
  rather than a rewrite. Costs a column and a predicate everywhere, and an unexercised predicate is
  one somebody eventually forgets.

**Suggested answer: A**, stated in the document so nobody designs around a second entity. Nairobi
later is a Change Report and real work, not a cost we carry silently for eleven weeks.

---

### Q3 · Staging and production on one server — how do we split the data?

One server is right for this budget. Note the *related* precedent in `praxis-ls`: `live` and
`sandbox` as two schemas with a `search_path` toggle and a cron that truncates and reseeds sandbox
every 14 days. **That is a user-facing test mode, not a deployment environment**, and the two must
not be conflated.

- **A — One Postgres 16 instance, two databases, two roles (Recommended).** `mycity_prod` and
  `mycity_stg`, each owned by its own role, no cross-grants, plus
  `ALTER ROLE mycity_stg_app CONNECTION LIMIT 10` and a `statement_timeout`. *Reason: a staging
  credential cannot read a production row — the only property that matters on a system holding
  salaries — and it costs one extra `CREATE DATABASE`.*
- **B — One database, two schemas.** Cheapest, one pool, mirrors the live/sandbox pattern. A wrong
  `search_path`, a migration against the wrong schema or a careless `TRUNCATE` reaches live payroll.
- **C — Two Postgres instances.** Hardest isolation, and a second set of `shared_buffers` and WAL on
  a box also running two Node processes, Redis, nginx and headless Chromium.

**Required under A, not optional:** one Redis, two logical DBs **and** distinct BullMQ `prefix`
values (`mycity:prod` / `mycity:stg`). BullMQ keys by prefix — without it a staging worker picks up
a production job. Both repos run BullMQ, so this applies either way. Then separate nginx blocks,
systemd units, `.env` files and media directories.

**Suggested answer: A.** Both certificates are free; the second domain costs MyCity a DNS record.

---

### Q4 · What stops staging sending real mail to real people?

M5 emails offer letters; M4 emails candidates. A staging offer letter reaching a real candidate is
an incident with a named person on the other end. `praxis-ls` already separates system email from
mailbox email (`doc/EMAIL_TWO_CONFIGS.md` — "never conflate them"); that discipline has to extend to
environment.

- **A — Local catch-all, plus noindex and basic auth on public routes (Recommended).** Staging SMTP
  to a sink on localhost; staging serves `X-Robots-Tag: noindex` with basic auth on the careers
  page, assessment platform, offer signing and document verification. *Reason: M4 and M5 deliver
  token-addressed public URLs (`careers.service.js` mints 32 bytes of CSPRNG per vacancy), so
  staging carries live-looking public links for eight weeks — they must be testable and unreachable
  at once.*
- **B — Recipient allowlist in the mailer.** Real mail, our domains only. Tests real deliverability,
  and depends on no code path building its own transport.
- **C — Both, by surface.** Catch-all for candidate and employee mail; allowlist where we must prove
  delivery. Safest, most configuration.

**Suggested answer: A** for the build, switching to **C** in the week before M11 to prove real
delivery through MyCity's SMTP before training. Take `mail/deliverability/route-check.js` (288) and
`dns-check.js` (180) in M0 — they are what stop "it works locally".

---

### Q5 · What data does staging hold?

M11 is three handover sessions **on live data**; we should not meet that requirement for the first
time in week eleven. Clause 9.3 makes us data processor under the NDPA, processing only on MyCity's
documented instructions.

- **A — Synthetic through the build, masked production copy before M11 (Recommended).** Seeded fake
  data while building; one copy with emails, phones, salaries and bank details masked, taken ahead
  of M11. *Reason: it buys the M11 rehearsal without standing up a second unmasked copy of their
  payroll for eleven weeks.* `praxis-ls/doc/E2E_DEMO_DATA_SHEET.md` is the seed-data precedent.
- **B — Synthetic throughout.** Cleanest under 9.3; we rehearse the most sensitive milestone on data
  that does not behave like theirs.
- **C — Mirror production unmasked.** Most realistic, and it puts real salaries somewhere with
  weaker controls.

**Suggested answer: A.** The masking script is half a day in M0 and pays for itself at M11.

---

### Q6 · What do we ask MyCity for today?

They are provisioning everything on 9 October, so the ask is free under clause 7.2 — but only if we
make it while the conversation is open. The workload is two Node processes, Postgres 16, Redis,
nginx and **headless Chromium**. Both repos ship `puppeteer`; Pixie has a whole
`docs/PDF_RENDERING_SETUP.md` about this failing on live, and M5's offer packet, M6's payslips, M7's
proposals and M2's org chart all render through it.

- **A — 4 vCPU / 8 GB / 80 GB NVMe (Recommended).** *Reason: smallest box where Chromium rendering
  an offer packet while both app processes are warm does not swap.*
- **B — 2 vCPU / 4 GB, resize later.** Easier to agree today; the first PDF render in M5 thrashes,
  and a resize mid-delivery is a window we have no slack for.
- **C — 8 vCPU / 16 GB.** Comfortable through Year 1 with no resize conversation. More than needed.

**Suggested answer: A**, with both subdomains in the same message.

---

### Q7 · Which of the 50 CI gates stand up in M0?

`praxis-ls/scripts/ci-local.js` runs 50 gates in CI's own order and reports **all** failures rather
than the first. **17 of the 50 belong to `platform-console` and `public-web`** — apps MyCity does
not have — so they disappear with Q2 and the single-app decision. You were explicit last night that
the simplicity rules belong in CI and in the agent instructions, not in memory.

- **A — Eight in M0, grow per milestone (Recommended).** Lint · jest · migration numbering ·
  migration reversibility · schema drift · write-routes-validated · prose budget and Title Case ·
  **the desktop-and-mobile shell gate**. *Reason: a gate with nothing to guard is one people learn
  to skip, and these eight all have something to guard from day one.*
- **B — Port the full runnable backend set immediately.** Strongest floor; we spend M0 fixing gate
  failures on a three-file codebase.
- **C — Lint and tests only, add gates reactively.** Fastest start, and it is exactly how Praxis LS
  reached 805 `hint=` strings and fourteen `FileDrop`s with no progress bar. Nobody decided that —
  the gate just was not there yet.

**Suggested answer: A.** The desktop-versus-mobile gate is the genuinely new one. Pixie was built
mobile-first with desktop adapting to it, and you named that as the thing not to repeat, so it needs
a gate rather than a convention. Add **AI manifest coverage** (gate 18) from M1 — see Q13.

---

## Part 2 — Product shape

### Q8 · Where does the design system come from?

`praxis-ls/client/src/components/ui/` is **89 files, 12,566 loc** (excluding tests): `field.tsx` with
its sibling-not-child `InfoHint` rule, `date-field.tsx` / `datetime-field.tsx` enforcing day-first,
`image-upload.tsx` / `file-drop.tsx` with the progress engine, `kpi-tile.tsx`, `data-view.tsx`,
`chart.tsx`, `otp-input.tsx`. Behind them: palette, contrast, motion, prose and bundle-graph gates.
It is also the interface you described as "10,000 things connected to it at the same time".

- **A — New visual language, ported primitives (Recommended).** Take the *engineering* — tokens,
  `Field`/`InfoHint`, the date fields, the upload engine, the palette and contrast gates — and build
  a new shell and visual language on it. *Reason: the primitives are not what makes Praxis LS
  cumbersome; the density of what was put in them is. The JBS signature you want to protect lives in
  the primitives and the gates, not the screen layouts.*
- **B — Clone the Praxis frontend and simplify in place.** Fastest to a working screen; carries the
  density forward by default, because simplifying is a decision someone must keep making and
  shipping is one that makes itself.
- **C — Build fresh from Claude mockups.** Cleanest break, best shot at the corporate aesthetic.
  Loses the gates, and the gates are what stopped the palette, contrast and date-format defects
  recurring.

**Suggested answer: A.** Note we inherit `client/src/features/workspace/` (12,436 loc, Analytics tab
included) and `employee-360.tsx` (2,420) as screens, so "new visual language" means the shell and
tokens, not redrawing every table.

---

### Q9 · Is the candidate assessment platform a separate application?

You told Cynthia on 2 September it would be two platforms. The audit found **zero hits for
`psychometric` or `panelist` across both repos** — this is the real greenfield in M4.

What does exist, and is the strongest donor in M4, is the security model in
`praxis-ls/src/modules/hr/careers/careers.service.js` (445 loc): a vacancy is reachable **only by its
token, never by `vacancy_id`** ("accepting one here would quietly turn every internal identifier
into a public credential"); the response is an **allow-list, never a row**; an application is
**write-only** so a candidate cannot read back their own AI score. `public-web/` is the precedent for
a separate stranger-facing app with its own dependencies and CI.

- **A — Public routes in the main app, own shell and path prefix (Recommended).** One deployable,
  one database, unauthenticated candidate routes with their own layout, rate limits and no ERP
  chrome. *Reason: a second deployable on a single server doubles PM2 units, TLS config and the
  deploy script for a boundary routing already gives us — and the assessment has to write to the
  candidate record anyway.*
- **B — Separate application, like `public-web`.** Clean blast radius, independent CI, and the
  candidate app genuinely cannot touch employee data. A second build and a cross-app contract inside
  eleven weeks.
- **C — Third-party assessment tool, results pulled back.** Fastest to a working psychometric test;
  a per-seat cost MyCity has not budgeted and a dependency outside 7.2.

**Suggested answer: A**, built on the `careers.service.js` model so B stays available later without
a rewrite.

---

### Q10 · Multi-panel blind assessment — how far do we take it?

Better news than expected. `praxis-ls/migrations/tenant/0525_recruitment_ai_scoring.sql` already has
`applicant_answer` with `rating`, `notes` and **`rated_by`**. But its unique index is
`(applicant_id, vacancy_question_id)` — **it excludes the rater** — so today one rating per question
exists in total, and `job_applicant.rating` is their average.

The change is four precise steps: widen the index to include `rated_by`; add a panel round with an
`OPEN`/`CLOSED` state and members; **one predicate on the read path** so a reviewer sees only their
own rows until the round closes; recompute the average across raters. Cynthia asked three times, and
the blindness is that one `WHERE` clause.

- **A — Blind until submit, consolidated by the hiring manager (Recommended).** Private form per
  reviewer, peers invisible until all submit or the manager closes the round, then the manager sees
  all and writes the consolidated report. Private internal notes stay private permanently. *Reason:
  exactly what was asked, and the enforcement is a migration, a state column and a predicate — not a
  module.*
- **B — Blind until submit, no consolidation artefact.** Smaller; "use that to form like an interview
  report" was explicitly part of the ask.
- **C — Add the weighted scorecard too** (Screening 15 + Psychometric 15 + Technical 25 + Case Study
  20 + Interview 25). Most complete, in the largest milestone in the SOW, which also carries the
  greenfield assessment platform.

**Suggested answer: A** for M4; scorecard named in the document as the first thing to add if M4 runs
ahead.

---

### Q11 · Which workflow engine — and this now decides whether M3 fits

**The correction that matters most from the audit.** I said this morning that M3 was configuration
against an existing engine. It is not.
`praxis-ls/src/modules/hr/hr_query/` is **209 loc** and `hr_sanction/` is **206** — thin wrappers
over the shared CRUD factory. `migrations/tenant/0475` gives two flat tables with a nullable FK, a
three-value `severity` and a five-value `type`. `grep -ril escalat src/modules/hr/` returns
**nothing**. No chain, no ordering, no thresholds, no rule configuration, no generated letters, and
`amount_xaf` baked into a column name.

**M3 is roughly 70% net-new against a 5% weight** — the worst effort-to-weight ratio in the SOW, in
week three.

`pixie-girl-hub/src/workflows/engine.js` + `conditions.js` + `default-definitions.js` is
data-driven: JSONB stages in `workflow_definitions`, running state in `workflow_instances`, the
per-approver log in `workflow_decisions`, and **threshold-aware routing evaluated at request time —
no compiled matrix, no code change to reroute an approval**. Non-applicable stages are skipped, not
run. That is precisely what "create a workflow that permits adding a step" requires.

- **A — Stand the Pixie engine up in M0, M3 becomes a definition plus letter templates
  (Recommended).** One engine serving M3, M5, M6 and M8. *Reason: this is the single decision that
  moves M3 from "70% net-new in week three at 5% weight" to "a workflow definition and four
  templates". It also removes M8's approval-hierarchy build, since `cash_request` consumes the same
  engine.*
- **B — Port the Praxis `workflow` module (695 loc).** Consistent with the Praxis plumbing we take;
  a third of the size, tenant-scoped, and not threshold-aware.
- **C — Hard-code each flow, extract an engine later.** Fastest for M3 alone. The SOW promises
  configurable approval hierarchies in M8 and the PRD asks for a reusable engine rather than
  hard-coding each process, so we would build it twice.

**Suggested answer: A**, and M0's scope grows by the engine. That is the right trade: it is paid once
and four milestones draw on it.

---

### Q12 · How much of the signature system do we take?

Two donors, and the light one fits the ask.
`pixie-girl-hub/src/shared/documents/documents.esign.service.js` (**939 loc**) plus repo,
certificate and signed-PDF helpers is ~1,800 loc. Alongside it
`pixie-girl-hub/src/modules/recruitment/recruitment.render.js` (**742**) already produces the JD,
the Offer Letter with an execution block, and the full Offer Packet from **one** markdown→HTML
renderer — so what the candidate reads on the web matches the signed PDF — and stamps the actual
base64 signature into the execution block rather than a "signed" placeholder.
`praxis-ls/src/modules/vault/` is **10,522 loc / 77 files** with QES tiers, wet-ink capture, a
preset table and a signer menu.

- **A — Pixie e-sign + `recruitment.render` + Praxis `document_vault` and `document_verification`
  (Recommended).** ~4,500 loc: canvas capture, both hashes, public verification, locked-after-signing,
  configurable expiry, document vault with retention and versions. Leave `qes`, `qes_public`,
  `signature_wet` and `compliance_flag` (2,728 loc). *Reason: it is the whole of PRD §5 and nothing
  MyCity did not ask for.*
- **B — Port the whole Praxis vault.** Strongest artefact; brings an assurance-tier model and a
  signer menu nobody at MyCity asked to choose from, in an 11% milestone.
- **C — Minimal: canvas, one hash, one public URL.** Smallest. Drops `artifact_hash`, so the
  verification page confirms the payload while saying nothing about the bytes stored.

**Suggested answer: A.** One thing not to simplify away:
`doc/SIGNATURE_ENGINEERING_GUIDE.md` §1.1 Q2 settled on **two hashes per signature** —
`content_hash` over the canonical payload (recomputable) and `artifact_hash` over the vaulted bytes
(frozen) — with the portal reporting **two verdicts**. And the backend rule from `CLAUDE.md`: hash
the master the image pipeline **returns**, never the bytes received.

---

### Q13 · Do we write the AI manifests from M1, or at M10?

The assistant is M10 (D4), but both repos derive the AI's tool catalogue **only** from per-module
`<module>.ai.js` manifests — `src/services/ai/action-registrar.js` → `ai_action_catalogue`. Praxis
gates it: "AI manifest coverage" and "AI catalogue drift" are gates 18 and 19, and
`tests/unit/ai-write-contract.test.js` ratchets a baseline downward. The write contract is exact: a
manifest `write` runs as `service(client, payload, actor)` through an inline wrapper mapping
snake_case to the service's real argument shape **and forwarding the full actor**; a bare
`service.create` drops the actor and puts the flat payload in the wrong parameter. A module without
a manifest is invisible to the assistant.

- **A — Manifest with every module, gate on from M1 (Recommended).** Each module ships its
  `.ai.js` and its `.search.js` as it lands. *Reason: M10 is 10% and ten weeks after M1. Writing
  manifests for ten weeks of modules in week ten is archaeology, and the write contract is a thing
  you get right while the service is fresh or not at all.*
- **B — Manifests from M4 onward, backfill M1 to M3 during M10.** Less M1 overhead; four modules to
  reconstruct later, including the ones with the most writes.
- **C — All manifests in M10.** Zero cost now. The gate cannot be switched on until week ten, so the
  first time we learn a manifest has drifted from its service is after ten weeks of drift.

**Suggested answer: A.** Same answer for `<module>.search.js` — ⌘K findability and the AI catalogue
are the same discipline, and `search.service.js` is only 70 loc.

---

### Q14 · Who owns the Excel migration, and when?

M7 replaces the partnership tracker; Cynthia said there are several more. The sheets arrive today.
The PRD asks for upload → map columns → validate → detect duplicates → preview → import → error
report → history. **That pipeline exists in neither repo.** What exists:
`praxis-ls/src/modules/master/_shared/dedup.service.js` for duplicate detection, and `exceljs` as a
dependency in both. Elisha and Love were to start the schema **after** seeing the sheets, which makes
the sheets an M0 dependency, not an M7 one.

- **A — Read the sheets in M0, build the generic importer in M7 (Recommended).** The sheets inform
  the schema this week, which is the whole point of getting them today; the reusable pipeline is
  built once in M7 where the SOW puts it; M1 to M6 use direct seeding. *Reason: the sheets' value
  right now is what they tell us about their columns, not an importer we cannot yet aim.*
- **B — Build the generic importer in M0.** Every later milestone gets import free; we build a
  column-mapping UI before knowing one real column name.
- **C — Per-tracker scripts, no generic importer.** Fastest per tracker, and MyCity cannot import
  anything themselves after handover — which is most of why they are leaving Excel.

**Suggested answer: A.** Reading the sheets is M0 work and the document should name it as such.

---

### Q15 · English only, or keep the bilingual scaffolding?

`praxis-ls` is bilingual throughout: `tr()`, `navT()`, `title_fr`, `name_fr`, `fr.strings`, a gate
that moves dictionary keys when an English label is renamed, and a rule that French is never
title-cased. Nothing in any of the four MyCity documents mentions French.

The real hazard in that machinery is worth knowing even if we drop it: `--fix-titles` moves a key
only when the old spelling has left the source entirely, because the same English can be rendered
from two places — and `AREA_ICON` was **keyed by display label**, so retitling the navigation
silently dropped five areas onto one glyph with nothing failing at the type level.

- **A — English only, no i18n layer (Recommended).** Plain strings. *Reason: the dictionary exists to
  stop a renamed English label rendering English in the French build. With no French build there is
  nothing to protect, and the Title Case and no-dashes gates work on plain strings.*
- **B — Keep `tr()` with one locale loaded.** Insurance if MyCity Accra ever needs French; every
  string for eleven weeks pays a key for a build that does not exist.
- **C — English only, strings centralised in one module.** No translation machinery, copy in one
  place, a later i18n pass mechanical. Costs an indirection on every label.

**Suggested answer: A.** Keep the Title Case and no-dashes gates — those are copy quality, not
translation — and **keep the warning about copy used as a key**, because `AREA_ICON` is the kind of
thing we will do to ourselves regardless of language.

---

## What each answer unblocks

| Q | Blocks | Needed by |
|---|---|---|
| Q1 Codebase | Repository creation, module layout, the reuse map | Today |
| Q2 Tenancy | Schema, repo layer, every query, three middlewares | Before the first migration |
| Q3 Staging split | Provisioning script, `.env` shape, BullMQ prefixes, deploy | Today, with the server |
| Q4 Mail guardrail | Mailer config, public route middleware | Before M1 mail work |
| Q5 Staging data | Seed script, masking script | M0, used at M11 |
| Q6 Server spec | The ask to MyCity | **Today, while provisioning** |
| Q7 CI gates | `ci-local.js`, the agent instructions file | M0, before the first PR |
| Q8 Design system | Shell, tokens, primitive port | Before any screen |
| Q9 Assessment app | Routing, deploy units, M4 estimate | Before M4 |
| Q10 Panel blindness | `applicant_answer` index, M4 scope | Before M4 |
| Q11 Workflow engine | **M0 scope, and whether M3 fits its 5%** | Before M3, decided in M0 |
| Q12 Signature depth | Vault schema, M5 scope | Before M5 |
| Q13 AI manifests | Every module from M1 on, gate 18 | **M1** |
| Q14 Excel migration | Schema design this week, M7 scope | Today |
| Q15 Language | Every string in the product | Before any screen |

---

## Two things worth flagging, not questions

**1. The first `require` lines to cut.** `praxis-ls/src/modules/mail/mail/mail.service.js` is 1,808
loc and reaches into four sub-areas we are not taking:

```js
require("../triage/ingest-hooks")      // triage: 2,368 loc
require("../triage/followup.service")
require("../binding/intake.service")   // binding: 2,126 loc — take in M7, not M1
require("../assist/semantic.service")  // assist: 2,261 loc — M10 at the earliest
require("../assist/ocr.enqueue")
```

Five lines. Cut them to no-ops behind a feature check before anything else in the module, or the
port drags ~4,900 loc behind it. This is the most likely way M1 overruns.

**2. The SOW contradicts itself on maintenance.** The cover page reads **"ESSENTIAL support at
₦500,000 per year from Year 2"**; clause 8.2 reads **"Essential plan at ₦300,000 per year"**, with
Growth at ₦600,000. Clause 1.1 ranks the SOW above its annexures but is silent on its own cover page
versus its own clause. Cheap to settle in writing now, awkward in fourteen months.

Everything else reconciles: ₦4,000,000 less 7.5% is ₦3,700,000; ₦500,000 deposit plus ₦3,200,000 is
₦3,700,000; the eleven milestone fees sum to ₦3,200,000 and the eleven weights to 100%.

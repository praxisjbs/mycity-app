# MyCity App ERP — Technical Milestone Document

**Version 1.5 · 14 October 2026 · Internal engineering document**

Revised after the MyCity client requirements meeting of 10 October. Scope added there is absorbed
with no Change Report; see §1.3 for what was added and where it lands. v1.2 added §18, the screen
inventory. v1.3 records it as approved, resolves the production hostnames, and corrects the public
surface: it is a separate application, not a sixteenth module. v1.4 aligns this document with
`REUSE_MAP.md`, which wins where the two disagree: the workflow engine is Pixie's, ported (A11).
It also removes the write contract everywhere under A23, drops the entity permission layer (A2),
corrects the gate references, and reconciles expense thresholds with the requisition (§13). v1.5
widens gates 8, 11 and 12 (§3) into the screen content rule (three tiers, help terms, word limits),
the checked two shells and one form system, after the 14 October review of the client demo, and
gives each a script.

Eleven contracted milestones plus M0, the foundation they stand on. For each: owner, window, scope,
the exact donor files, what is net-new, and the demonstrable definition of done.

**How to read this.** Dates are **working dates**, not the dates in the signed schedule. Every
file path with a line count has been measured in the checked-out tree. Where a milestone has no
donor this document says so, because that is the number that decides the schedule.

**Team.** Tom-Blake Asaah (TB) · Love Adeola (LA) · Adole Jerome (AJ) · Godwin-Okoh Elisha (GE)

**Engineered by [JBS Praxis](https://jbspraxis.com).**

---

## 1 · Architecture decisions

Settled 9 October. These are binding. If the code disagrees with this table, the code is wrong.

| # | Decision | Consequence |
|---|---|---|
| A1 | **Fresh repository.** Port from both donors and fix on the way in; fork neither. | Reuse is surgical and declared per module in §5–§16 |
| A2 | **Single tenant, single database, one schema.** MyCity App Ltd only, wherever they operate from. | No tenant resolver, no brand column, no entity header. Delete `tenant-context.js`, `host-tenent-resolver.js`, `platform-auth.js` — 521 loc not ported |
| A3 | **One Postgres 16 instance, two databases, two roles.** `mycity_prod` / `mycity_stg`, no cross-grants. | A staging credential cannot read a production row |
| A4 | **Staging is production in every respect but data.** Real SMTP, real delivery, every feature on, every public URL live. Marked, never crippled. | Training in M11 runs on a system that behaves exactly like the live one |
| A5 | **Three data postures.** Build = synthetic seed. Staging = realistic demonstration data. **Live = clean. No seed, no fixtures, no demo rows, ever.** | A seed script that can reach `mycity_prod` is a defect |
| A6 | **4 vCPU / 8 GB / 80 GB NVMe to 50 users; 12 GB RAM above 50.** | Headroom for two Node processes, Postgres, Redis, nginx, headless Chromium |
| A7 | **Gates from day one**, including the three agreed 8 October and the two AI gates. | §3 |
| A8 | **New design system on MyCity's brand.** Praxis LS primitive engineering, simplified; MyCity's own palette, logo and type so the operator feels inside their brand. Tokens in §5.1. | Dark theme is derived (§5.2), not taken — they have none |
| A9 | **A public surface on its own subdomain.** Every public URL — careers, assessment, offer signing, document verification — served from one lightweight public app. | Third deployable. Not a marketing site |
| A10 | **Blind panel assessment plus weighted scorecard.** | M4 |
| A11 | **Pixie's workflow engine, ported.** `pixie-girl-hub/src/workflows/engine.js` + `conditions.js` + `default-definitions.js`, per `REUSE_MAP.md` §1.2. | M0 stands it up; M3, M5, M6, M8 consume it |
| A12 | **Dual-hash signatures.** `content_hash` over canonical payload, `artifact_hash` over vaulted bytes. Two verdicts on the verification page. | M5 |
| A13 | **AI manifest and search provider ship with every module, from M1.** | Gates 9 and 10 |
| A14 | **Excel sheets read in M0; generic importer built in M7.** | Schema design this week is driven by their real columns |
| A15 | **English only.** No `tr()`, no dictionary, no `title_fr`. | Title Case and no-dash gates still apply — they are copy quality, not translation |

### 1.3 Added 10 October, absorbed

The client requirements meeting of 10 October added scope that is **not** in PRD §1 to §23 and
therefore not in the Statement of Work. **It is absorbed: no Change Report, no fee, no change to
dates or weights.** It is recorded here because the team still has to build it.

| # | Added | Lands in | Not in PRD |
|---|---|---|---|
| A16 | **Four-level goal cascade.** Organisational (CEO) → annual (management) → monthly (management) → departmental (unit head) → individual monthly KPI (department manager) → weekly and daily tasks. Goal IDs, strategic themes, success measures, baselines, quarterly cascades. | M2 | ✓ |
| A17 | **Performance Management System as its own module**, separate from the tasks and calendar workspace. Self-rating first, then manager approval, then second-level approval, then HR. | M2 | ✓ |
| A18 | **Voice capture with AI cleanup on review forms.** Speak instead of type; AI tidies the transcript against goal context without changing the meaning. | M2 | ✓ |
| A19 | **Peer recognition.** Thumbs up manager to subordinate, peer to peer, and upward, posted to the staff community. No rewards, no voting, no employee of the month. | M1 | ✓ |
| A20 | **Automatic birthday and work anniversary posts** to the staff community, from date of birth and start date. | M1 | ✓ |
| A21 | **Partnership type configuration UI** and a **partnership analytics page** (prospects, meetings held, proposals sent, signed, active, downloads generated, per lead owner). | M7 | ✓ |
| A22 | **Working week fully configurable per day.** Fixed hours 09:00 to 17:00 Monday to Friday and 09:00 to 15:00 Saturday, but stored as per-day configuration rather than a hard-coded week. | M1, M6 | ✓ |

**Where the capacity comes from.** The AI assistant narrowed on 10 October: it reads only, and
routes writes to the owning module rather than executing them (A23 below). That removes the pending
action queue, the confirmation surface and the write contract from M10. **That saving is reinvested
in M2**, which is where A16 to A18 land and which has the least slack in the schedule.

| # | Decision | Consequence |
|---|---|---|
| A23 | **AI reads, never writes.** The assistant answers from the database within the caller's permissions and links the user to the module to make a change. | M10 loses the pending-action queue and the write contract. Gate 19 becomes read-manifest coverage only |
| A24 | **The line manager sets the week; the employee can still add their own tasks.** Manager authorship of weekly and daily tasks is what Cynthia asked for, and it is a change to how MyCity works today. Employees keep the ability to log their own work alongside it. | M2 permission model: manager writes to their reporting line, employee writes to self |
| A25 | **Budget versus actual is built and handed over empty.** MyCity has no budget lines until 2027. | M8 ships the screen, demonstrated with figures clearly marked as examples |
| A26 | **Reference seeds hold only what the code cannot run without.** `seeds/reference/` runs in every environment, production included, so it carries system roles with their permissions, numbering schemes, validated workflow definitions and the code lists the code switches on. No people, no transactions, and no business choices: expense categories, partner stages, attendance policies and alert thresholds are entered by MyCity on their screens or through the import engine. Decided with TB, 16/10/2026. A public holiday set by law is not a business choice: Nigeria's are seeded, the moon-dated and weekend ones as expected until confirmed (TB, 17/10/2026; `seeds/reference/0448`) | Reconciles A5 with README §6.3; `docs/MIGRATIONS.md` §9. The PR 25 seeds that hold business choices move out in a fix-forward file |

### 1.1 Stack

PostgreSQL 16 · Node 20 + Express (CommonJS) · React 18 + Vite + TypeScript · Tailwind + shadcn/ui
role tokens · **Geist** (SIL OFL, free, ships `tnum` tabular figures) · Redis + BullMQ · Socket.io ·
Gemini LLM · PWA. No ORM: `pg` with parameterised SQL. Money via `decimal.js`, 2dp, strings in
payloads. Timezone Africa/Lagos. Currency NGN. IDs UUIDv4. Dates ISO 8601 on the wire, day-first on
every human surface.

Geist and the shadcn/ui token names are what mycityapp.io itself runs, so the brand theme drops in
without translation. One family only — the site loads three, including six preloaded weights of a
typeface none of its captured text styles use.

### 1.2 Repository shape

```
src/                 Express backend
  modules/<name>/    routes · controller · service · repo · validator · events · ai · search
  shared/            crud · db · events · http · observability · rbac · workflow
  middleware/        auth · rbac · idempotency · error-handler · request-id
  services/          mail · documents · signatures · pdf · ai · search · storage
  jobs/              BullMQ workers + schedulers
migrations/          numbered SQL, reversible, idempotent
packages/shared/     Zod schemas consumed by API and frontend — one definition each
app/                 React admin (the ERP)
public-app/          React public surface (A9)
```

---

## 2 · Environment topology

One server. Two environments. Three surfaces each.

| | Production | Staging |
|---|---|---|
| Admin, the PWA | `hub.mycityapp.io` | `hub.staging.mycityapp.io` |
| Public, no PWA | `go.mycityapp.io` | `go.staging.mycityapp.io` |
| Database | `mycity_prod` owned by `mycity_prod_app` | `mycity_stg` owned by `mycity_stg_app` |
| Redis | db 0, BullMQ `prefix: mycity:prod` | db 1, BullMQ `prefix: mycity:stg` |
| Process | `mycity-api-prod`, `mycity-worker-prod` | `mycity-api-stg`, `mycity-worker-stg` |
| Media | `/srv/mycity/prod/media` | `/srv/mycity/stg/media` |
| Mail | Real SMTP, real delivery | **Real SMTP, real delivery** (A4) |
| Data | Clean. No seed. | Realistic demonstration data |

**Why the public surface is a second host and not a path** (A9). A path is not a boundary; the
browser's unit of isolation is the origin. On `hub.mycityapp.io/public/*` the browser would attach
any staff session cookie held for that host to a candidate's request, the admin service worker
registered at `/` would control those pages, and `localStorage`, IndexedDB and the cache would be
shared with the admin app. A separate origin removes all four structurally rather than by a scope
setting somebody has to keep correct. It also forces a separate build, so an admin module cannot be
imported into a public page by accident.

Public addresses are short, because a stranger reads them:

```
go.mycityapp.io/jobs                           careers list, indexable
go.mycityapp.io/jobs/partnerships-associate    one vacancy, readable slug, shareable
go.mycityapp.io/apply/<token>                  opaque, one person, not indexable
go.mycityapp.io/assess/<token>                 opaque
go.mycityapp.io/sign/<token>                   opaque
go.mycityapp.io/verify/OFF-0018                a reference, not a secret
```

Only the careers list and an open vacancy carry readable addresses, because a careers page exists
to be found and shared. Everything a single person is invited to is reached by an opaque token that
cannot be enumerated.

**Isolation that is not optional.** BullMQ keys by prefix — two environments on one Redis without
distinct prefixes means a staging worker executes a production job. Separate prefixes, separate
logical DBs, separate roles. `ALTER ROLE mycity_stg_app CONNECTION LIMIT 10` and a
`statement_timeout` on the staging role so a heavy test cannot starve live.

**How staging is marked without being crippled** (A4). Staging sends real mail to real recipients
and every feature is on, so training is real. What differs is signalling, never capability:

- `X-Mycity-Environment: staging` header on every response and every outbound mail
- Mail `From` display name carries ` [STAGING]`; a banner row at the top of every mail template
- No bar drawn on the page: the address already says staging (TB, 17/10/2026; it replaced a
  persistent top bar in both apps, which crowded the sign-in screen)
- `X-Robots-Tag: noindex` on staging responses — marked, not blocked
- Distinct favicon and theme colour

No feature flag, no stub, no sink. If a flow works on staging it works on production, which is the
entire point of training on it.

**Promotion is a tagged deploy.** Never a database rename, never a copy from staging to production.
`mycity_prod` is created clean at M0 and never receives a seeded row.

---

## 3 · Engineering gates

`npm run ci` runs all of them in CI order and reports every failure, not the first. Gates 1–8 stand
up in M0; gates 9 and 10 switch on with the first module in M1; the rest attach to the milestone
that gives them something to guard.

| # | Gate | What it refuses | From |
|---|---|---|---|
| 1 | Lint | ESLint, including the local rules below | M0 |
| 2 | Test | Jest (backend), Vitest (frontend) — the **whole** suite, never a subset | M0 |
| 3 | Migration numbering | Duplicate or out-of-order numbers | M0 |
| 4 | Migration reversibility | A migration with no `-- DOWN` | M0 |
| 5 | Migration idempotency | A migration that fails on second apply | M0 |
| 6 | Schema drift | A query naming a column the schema lacks | M0 |
| 7 | Write routes validated | A POST/PATCH/DELETE with no Zod validator | M0 |
| 8 | **Five-second rule** | System explanations on a screen; support text open instead of behind a help term or Details row; a word limit broken; chrome not in Title Case | M0 |
| 9 | **AI manifest coverage** | A module with records and no `<module>.ai.js` or written `// ai:none <reason>` | M1 |
| 10 | **Search coverage** | A route, tab or record module with no `<module>.search.js` or `// search:none <reason>` | M1 |
| 11 | **Two shells** | A desktop view that is a stretched mobile layout, or a mobile view that is a shrunk desktop one: sideways scroll, the wrong navigation, a table or a sub-44 px target on a phone, a wordy first phone screen | M1 |
| 12 | **Inline validation, one form system** | A form field whose error surfaces only on submit; a field, label or form built outside the shared form components | M1 |
| 13 | Palette | A raw hex outside the §5.1/§5.2 tokens. Also `#FFCD05` and `#004F70`, which are in their CSS but are not brand | M1 |
| 14 | Contrast | A text-on-surface pair below AA, **in both themes** — a chart series legible on white can be 1.49:1 on the dark card | M1 |
| 15 | Day-first dates | `<input type="date">`, `toLocaleDateString()` with no locale, ISO on a human surface | M1 |
| 16 | No native dialogs | `window.confirm` / `alert` / `prompt` and their aliases | M1 |
| 17 | No dashes | An em dash or double dash in copy a user reads | M1 |
| 18 | Upload engine | A raw `<input type="file">`, or a drop zone with no percentage | M1 |
| 19 | AI read manifest | A module with records and no read manifest. The write contract is dropped: under A23 the assistant has no writes to contract | M4 |
| 20 | Money | Float arithmetic on a money value; a money column that is not `numeric(18,2)` | M6 |
| 21 | Nothing the browser styles itself | A native select or phone picker, a browser-drawn input, a `title` tooltip, a validation bubble or an unbranded toast, in source or on any rendered screen (FRONTEND_FOUNDATION F25, added 18/10/2026) | M0 |

**Gates 8, 11 and 12 are the ones agreed on 8 October** and they are the reason this product is not
Praxis LS. Stated as rules a script can check:

- **Gate 8.** A page carries what the operator must read to act; a person knows what the screen is
  for within five seconds. Every piece of text is one of three tiers: **operational** (data,
  status, actions) is open; **support** a person occasionally needs to act sits behind a **help
  term** (the word itself, dotted underline; hover or focus on desktop, a tap and a sheet on a
  phone) or a **Details** row closed by default; **system** text (how the product works, why it
  was built this way, reassurance, footnotes) never reaches a screen and lives in the feature
  guide or the manual. Hidden is not deleted: help text stays in the DOM, linked with
  `aria-describedby`, never inside a label's or heading's accessible name. The limits are numbers
  in `scripts/check/lib/copy.js` (page title 3 words, subtitle 8 and desktop only, card title 4,
  button 3, toast 8, help 35, any sentence 20, first phone screen 40); FRONTEND_GUIDE §5 is the
  full rule. Decided 14 October 2026 after the client-demo review: help terms replace the sibling ⓘ,
  which stays only where there is no word to attach to.
- **Gate 11.** Mobile is a native-feeling application: a bottom bar, cards not tables, sheets, a
  thumb-reachable primary action, 44 px targets, no subtitles or chart captions, at most 40 words
  of interface copy on the first screen. Desktop is desktop software: dense tables, keyboard
  navigation, multi-pane, hover help. The gate renders every screen at both widths in Chromium and
  fails a route that ships one layout scaled. Each feature guide's §10 carries the phone layout per
  screen; the PR states the measures taken.
- **Gate 12.** A field validates as it is filled: checked when the person leaves it or pauses,
  re-checked on every key once marked. The signal is a mark on the field with at most four words,
  not a sentence under it and never a dialog. Submit-time-only validation fails. Fields, labels and
  forms come only from the shared form components with `useContractForm`, so the rule is
  structural: a raw field written in a feature fails the gate (FRONTEND_GUIDE §8).

**Gates 9 and 10 exist because retrofitting is archaeology.** The AI's tool catalogue is derived
*only* from per-module manifests. A module written in M1 without one is invisible to the M10
assistant. Under A23 a manifest declares **reads only**: the queries the assistant may run, scoped by
the caller's grants, and the screen a write is routed to. There is no `write` entry and no write
contract. A manifest that declares a write fails gate 19.

---

## 4 · Schedule

Ten build weeks and a handover week, demonstrated on staging each Friday. Clause 2.2 allows
overlapping parallel tracks; M8/M9 and M10/M11 use that to recover the nine days lost to the late
start and still land on 18 December.

| M | Milestone | Wt | Window | Demo | Owner |
|---|---|---|---|---|---|
| **0** | **Foundation** | — | 9–19 Oct | with M1 | **GE** · LA |
| 1 | Core Operations & Employee Management | 12% | 9–19 Oct | Mon 19 Oct | **TB** · LA · AJ · GE |
| 2 | Productivity & Performance | 9% | 20–23 Oct | Fri 23 Oct | **AJ** · TB |
| 3 | Queries & Consequence Management | 5% | 26–30 Oct | Fri 30 Oct | **GE** |
| 4 | Recruitment End to End | 13% | 2–13 Nov | Fri 13 Nov | **TB** · LA · AJ |
| 5 | Offers, Documentation & Onboarding | 11% | 16–20 Nov | Fri 20 Nov | **LA** · GE |
| 6 | Payroll & Notifications | 11% | 23–27 Nov | Fri 27 Nov | **LA** · AJ |
| 7 | Partnerships, CRM & Trackers | 10% | 30 Nov–4 Dec | Fri 4 Dec | **GE** · LA |
| 8 | Expenses & Budget Control | 8% | 7–11 Dec | Fri 11 Dec | **AJ** |
| 9 | Settings & Governance | 7% | 7–11 Dec ∥ | Fri 11 Dec | **GE** |
| 10 | Staff Knowledge Hub & AI Assistance | 10% | 14–18 Dec | Fri 18 Dec | **TB** · GE |
| 11 | Handover & Training | 4% | 14–18 Dec ∥ | Fri 18 Dec | **TB** · all |

No production release between 21 December 2026 and 5 January 2027. M11 training runs on staging,
which under A4 carries every feature.

---

## 5 · M0 — Foundation

**Owner GE** (architecture, schema) with **LA** (migrations, data). **9–19 Oct, inside M1's window.**
Zero weight: M0 is not invoiced and does not alter the eleven weighted milestones.

### Scope

**Infrastructure.** Server provisioned per A6. Postgres 16 with two databases and two roles. Redis
with two logical DBs and distinct BullMQ prefixes. nginx with four server blocks. Four systemd
units. Let's Encrypt on all four hosts. DNS: A records plus SPF, DKIM and DMARC for the mail domain.
Headless Chromium installed and proven by rendering one PDF end to end — this is the single most
common "works locally, fails live" failure and it is cheaper to find today than in M5.

**Schema.** Read MyCity's Excel trackers the day they arrive and design against their real columns
(A14). First migrations: identity and sessions, RBAC (role, grant, scope, capability, field
visibility), audit ledger, employee and org chart, settings, numbering, notification, workflow
definitions.

**The workflow engine (A11).** Ported from `pixie-girl-hub/src/workflows/` (`engine.js`,
`conditions.js`, `default-definitions.js`): data-driven JSONB stages, threshold-aware routing
evaluated at request time, non-applicable stages skipped. On the way in it loses the brand schema
and takes our table names:

```
workflow_definition   key, version, stages jsonb, active
workflow_instance     definition_key, entity_type, entity_id, current_stage, state, context jsonb
workflow_decision     instance_id, stage_key, actor_id, decision, reason, decided_at
```

A stage carries `{ key, approver: {role|user|manager_of_subject}, condition, on_approve, on_reject,
sla_hours }`. A condition is a comparison against `context` — one operator set (`>=`, `>`, `=`, `<`,
`<=`, `in`), evaluated at request time, no expression language. A stage whose condition is false is
**skipped, not run**. Adding a step is inserting an object into `stages`; it needs no deploy. That
is the whole engine, and it stays the whole engine. M3's consequence chain, M5's offer approval,
M6's payroll approval and M8's expense hierarchy are all definitions over it. Port it as it is;
do not extend it in M0. **Amended 14 October 2026:** four rules were added in M0 because no later
milestone can safely add them under live requests: nobody approves their own request (the CEO
excepted); the requester can withdraw; rejecting or sending back needs a reason; approvers are
resolved when a stage starts and stored on the request. Each definition also declares the type of
every value its conditions compare. Pixie's `position` approvers and deputy fallback were dropped
(BACKEND_STRUCTURE §4). See REUSE_MAP §1.4.

**Design system.** Port the primitive **engineering** from `praxis-ls/client/src/components/ui/`
(89 files) and rebuild the shell and visual language on MyCity's tokens. Primitives first:
`field.tsx` + `info-hint.tsx` (gate 8; the hint becomes the help term and the Details row,
FRONTEND_GUIDE §5.2), `date-field.tsx` / `datetime-field.tsx` (gate 15),
`image-upload.tsx` + `file-drop.tsx` (gate 18), `form.tsx`, `dialog.tsx` + `modal.tsx` (gate 16),
`callout.tsx`, `kpi-tile.tsx`, `data-view.tsx`, `chart.tsx`, `otp-input.tsx`, `panel.tsx`. The
primitives keep their Praxis engineering; they are re-skinned onto shadcn/ui role names so the
brand theme below applies without a mapping layer.

### 5.1 Brand tokens — light

Taken from mycityapp.io. Every value below is theirs; nothing is invented.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--primary` | `#FFDF55` | Primary button fill, active nav, focus ring on dark | — |
| `--primary-foreground` | `#01221D` | Text on yellow | **12.77:1** |
| `--accent` | `#FFEFAA` | Active nav pill | nav ink 14.43:1 |
| `--secondary` | `#014339` | Page titles, lead text, focus ring on light | **11.27:1** on white |
| `--sidebar` | `#01221D` | Sidebar, footer | — |
| `--foreground` | `#09090B` | Body text | 19.90:1 |
| `--muted-foreground` | `#71717A` | Secondary text | 4.83:1 |
| `--border` | `#E4E4E7` | Dividers **only** — 1.27:1 | decorative |
| `--input` | `#71717A` | Control outlines — the `#E4E4E7` border is far too faint for an input boundary | 4.83:1 |
| `--radius` | `0.5rem` | Inputs and menus. Pills on buttons; 12–20 px on cards | — |

Status text uses darkened shades of the site's own status hues, because the hues themselves fail as
text: success `#0D844C`, warning `#A66105`, error `#DA1E10`, info `#1D4ED8` — each ≥4.5:1 on white
and on its own tint. The eyebrow amber on the site is 1.97:1; use `#98690C` (4.82:1, same hue).

**Three traps in their own CSS, carried here so nobody re-imports them.** Their framework
`--primary` resolves to `#FFCD05` while every button renders `#FFDF55` — **`#FFDF55` is the token**.
Their `--momo` (`#004F70`) is an MTN payment-provider colour, not brand. Their chart tokens are
untouched framework defaults.

### 5.2 Brand tokens — dark, derived

They have no dark theme. Rather than drop their palette onto neutral greys, the dark surfaces are
built on the brand's **own hue (171°)**, so dark mode reads as MyCity and not as generic dark mode.
Ratios computed, not estimated:

| Token | Value | HSL | On it |
|---|---|---|---|
| `--background` | `#01110E` | 169 89% 4% | page base |
| `--card` | `#01221D` | 171 94% 7% | Deep Green, their own footer colour |
| `--popover` | `#012B24` | 170 95% 9% | menus, drawers |
| `--accent` (hover/selected) | `#013C33` | 171 97% 12% | — |
| `--foreground` | `#E6EDEB` | — | **14.17:1** on card |
| `--muted-foreground` | `#A9B8B4` | — | **8.18:1** on card |
| `--border` / `--input` | `#125A4D` / `#1A6B5C` | — | input outline **3.04:1** on base |
| `--primary` | `#FFDF55` | unchanged | **12.77:1** on card |

Status on dark needs lighter shades than the light theme: success `#32D583` (8.80:1), warning
`#FDB022` (9.14:1), error `#F97066` (6.04:1), info `#84ADFF` (7.54:1).

**Charts need two palettes, not one.** City Green is 11.27:1 on white and **1.49:1** on the dark
card — invisible. Light series: `#014339` `#0E7C6B` `#98690C` `#B54708` `#3538CD` `#9F1AB1` (all
≥4.8:1 on white). Dark series: `#45C8B0` `#FFDF55` `#7CC4FA` `#FF9B85` `#C3B5FD` `#E8D7A8` (all
≥8:1 on the card). Gate 14 checks both. Primary Yellow is **1.32:1 on white** — never a line, never
text, fill only with a dark outline.

### 5.3 The logo, and the one real problem in it

The mark is a map pin containing a person, followed by the **MyCityApp** wordmark, in City Green
`#014339`; a white version sits on Deep Green. The pin alone is the favicon; the full lockup is the
logo.

`mycity-logo.svg` **contains no vector paths at all.** It wraps a 356 × 356 px PNG, and its
`<image>` element declares that PNG as **4096 × 4096** — the file misreports its own resolution by
11.5×. At the 178 × 56 it is displayed at, this is invisible. It will not survive a login splash, a
2× display, or a PDF invoice: a renderer that trusts the declared size upscales a 356 px raster
eleven times.

M0 therefore does two things. Request vector masters (SVG paths or AI/EPS) plus the white variant
and app icon. In parallel, redraw the **pin** as true paths — it is a simple geometric form and the
favicon, sidebar rail and PDF header all need it at arbitrary size — and carry the wordmark as a
2×/3× PNG until masters arrive. Never recolour, stretch or outline the mark; clear space of one pin
height; City Green on light, white on Deep Green, **City Green on yellow** (8.55:1), never white on
yellow.

**Brand intensity by surface.** High on login, onboarding and splash. Medium on the shell — Deep
Green sidebar, Primary Yellow active item, white content. Low on tables, forms and settings:
neutrals and status colour only. Medium on anything a partner receives (offer letters, invoices,
payslips): City Green logo and headings, a yellow rule, support contacts in the footer.

**Two shells, not one responsive layout** (gate 11). A shared route tree and data layer; a mobile
shell of cards, sheets and a bottom bar, and a desktop shell of panes, dense tables and keyboard
navigation. The split is at the shell, so a screen is written once and laid out twice.

### Reuse

| From | Files | loc | Change |
|---|---|---|---|
| praxis-ls | `src/shared/crud/resource.js` | 361 | Drop tenant pool; keep `scopeColumn` — ESS needs `own` scope |
| praxis-ls | `src/shared/db/` (`tx.js`, `query-helpers.js`) | 683 | One pool, not a per-tenant registry |
| praxis-ls | `src/shared/events/emit.js` | 415 | As is. One call writes the event and the audit row |
| praxis-ls | `src/shared/http/`, `observability/` | 4,040 | As is |
| praxis-ls | `src/middleware/` ×5 | ~1,100 | Keep auth, rbac, idempotency, error-handler, request-id |
| praxis-ls | `src/services/search/provider.js` + registry | 70 | As is — gate 10 depends on it |
| praxis-ls | `src/modules/security/{app_user,audit_ledger,permission,scope,capability,field_visibility}` | ~6,600 | Keep `known-device.js` — M1 needs it. **Amended 16/10/2026 (TB):** `webauthn.service.js` is ported after all, with two-step sign-in and the PIN, in the second sign-in PR (REUSE_MAP §1.1) |
| praxis-ls | `mail/deliverability/route-check.js`, `dns-check.js` | 468 | DNS and SPF verification for M0's mail setup |
| pixie | `src/shared/hr_payroll/lagos-time.js` | 35 | As is |
| pixie | `src/utils/money.js` + `decimal.js` | — | Replaces Praxis's raw `numeric` arithmetic |
| pixie | `src/shared/outbox/` | 210 | Transactional outbox — a notification must not fire for a rolled-back transaction |
| pixie | `src/shared/access/access.catalog.js` | — | Module list as single source of truth, checkable against `requirePermission` keys |
| pixie | `src/workflows/engine.js` + `conditions.js` + `default-definitions.js` | — | A11. Drop the brand schema; one set of tables |

**Net-new:** the brand token layer, the two-shell split, gates 8, 11 and 12.

### Definition of done

Four hosts resolve over TLS. Both databases migrate from empty and roll back. `npm run ci` green on
all eight M0 gates. A seeded user signs in to the admin shell on both environments, in **both
themes**, with the pin mark crisp at 3× on the login splash. One PDF renders through Chromium on
the server carrying the City Green logo at print resolution. One mail sends and is received through
MyCity's SMTP. A workflow definition with a threshold condition routes a test instance down two
different paths. `mycity_prod` contains no seeded row.

---

## 6 · M1 — Core Operations & Employee Management · 12%

**Owner TB** (dashboard) · **LA** (clock-in/out) · **AJ** (ESS) · **GE** (staff community).
**9–19 Oct. Demo Mon 19 Oct.**

### 6.1 Dashboard — TB

Management dashboard plus a personal dashboard per employee. Built on a **KPI catalogue**: a tile
declares its id, grant gate and value source; eligibility is **computed at read time**, so a tile
inherits rights and never grants them, and revoking a module silently retires its tiles from pickers
and role configs. The catalogue self-checks at require time and throws at boot on a half-defined
entry.

Reuse `praxis-ls/src/modules/dashboard/kpi_catalog/` — `index.js` (221), `eligibility.js` (97),
`guards.js` (54), `shared.js` (98), `resolve.js` (172) — and `human_capital.js` (247), whose six
tiles port nearly unchanged: `headcount`, `attendance_today`, `leave_pending`, `vacancies_open`,
`payroll_run_state`, `attrition_90d`. Plus `dashboard.service.js` (314) and `dashboard.repo.js` (295).

**Do not port** `money.js`, `operations.js`, `fleet_warehouse.js`, `sales_procurement.js` — 831 loc
of KPIs for modules MyCity does not have. **There is no sales in this product.** Partnerships are
not sales and must not be modelled as them.

Net-new tiles: partnership pipeline, pending expenses, budget versus actual, pending documentation,
upcoming confirmations and reviews.

### 6.2 Clock-in / clock-out — LA

Pixie is the engine, Praxis supplies the history and reconciliation.

| From | File | loc |
|---|---|---|
| pixie | `src/shared/attendance/` (`repo` 189, `geo.calc` 170, `service` 161) | 749 |
| pixie | `src/shared/hr_payroll/lateness.calc.js` — pure; daily pay pro-rated over working days, tiered deduction | 314 |
| pixie | `src/shared/hr_payroll/clock.guard.js` — `evaluateClockTransition`, stops a double punch | 62 |
| pixie | `src/shared/hr_payroll/devices.*` + `device.guard.js` | 601 |
| praxis-ls | `attendance.rules.js` — `wallClock` uses the **workplace** timezone, not the host clock | 251 |
| praxis-ls | `attendance.reconcile.js` — reconcile, waive, uphold | 441 |
| praxis-ls | `attendance.analytics.js`, `.export.js`, `.calendar.js`, `.weekly.js` | 1,202 |
| praxis-ls | `attendance.query.js` — auto-query on a late punch, upserted on `(employee, work_date, rule)`; the reconciler **adopts** it rather than reopening it | 124 |

Policy model: `hr.geofence` = `off|warn|block` (default warn), `hr.device_policy` = `off|warn|block`
(default off — devices still **register** when off, which is what makes the policy switchable later),
`hr.device_policy`, and the working week. Remote, hybrid and on-site are work patterns on the
employee, not separate code paths.

**The working week is configured per day (A22), not hard-coded.** MyCity works 09:00 to 17:00
Monday to Friday and **09:00 to 15:00 on Saturday**, which the donors do not assume. Rather than
swap one hard-coded week for another, each day carries its own `{ working, start, end,
grace_minutes }`. The attendance donor already ships `hr.weekend_days` and `employee.work_days`, so
this is close to free, and it removes a whole class of question: a department that does not work
Saturdays, or a Saturday that stops counting toward lateness, becomes a setting rather than a
migration in week six.

**This reaches M6.** `lateness.calc.js` pro-rates monthly salary over the working days in the
month, so a six-day week changes the daily rate and therefore every lateness deduction. The divisor
reads the same per-day configuration. One source, two consumers.

Known gaps in the Praxis donor, documented in its own guide and built rather than inherited: no
analytics endpoint, no export endpoint, no punch date range, no multi-employee filter.

### 6.3 ESS — AJ

Named **Employee Self-Service**, never "My HR". Employees update personal records, see attendance
history, respond to queries, see earnings and deductions, read tasks and calendar.

`pixie-girl-hub/src/shared/hr_payroll/hr_ops.service.js` (**1,633**) and `hr_ops.repo.js` (1,354)
carry it: live earnings tracker, lateness, schedule, leave, target countdown, tasks, contracts —
and the lateness → query → waive/uphold loop, where the deduction shows on the running salary until
HR waives it (restored) or upholds it (deducted from net). Plus `staff_documents.*` (952) and
`praxis-ls/client/src/features/hr/employee-360.tsx` (2,420). Leave from
`praxis-ls/src/modules/hr/leave_allowance/` (1,119).

### 6.4 Staff community — GE

`praxis-ls/src/modules/smartcomm/` is 9,962 loc and splits in half. **Take the chat half (4,212):**
`smartcomm.service.js` (645), `repo` (417), `controller` (435), `routes` (281), `validator` (235),
`media.service.js` (351), `presence.js` (220), `links.service.js` (606), `erp.service.js` (444),
`config.service.js` (152). Channels for department, project, direct and ad-hoc groups; membership is
the authorization boundary; presence, read receipts, reactions, drafts, quick replies, search,
tamper-evident SHA-256 certified export.

**Leave the call half (5,750)** — `call.pipeline.service.js` (1,817), `call.service.js` (1,195),
`call.repo.js` (899), `diagnostics.service.js` (836), TURN and signalling. WebRTC voice calling is
in no MyCity requirement.

`smartcomm.media.service.js` (351) routes bytes by **what the file is**, not who uploaded it: real
documents to the vault, chat media (image, audio, video) to `comms_media`. Voice notes were asked
for; this is the file that handles them correctly.

**Recognition and celebrations (A19, A20) — net-new, absorbed.** A plus button beside the composer,
WhatsApp-style, opening a short menu. Thumbs up a colleague: manager to subordinate, peer to peer,
and upward to a manager. A note is optional; the system writes one if the sender does not. It posts
to the general channel where everyone sees it. **No rewards, no voting, no employee of the month** —
Cynthia ruled all three out as too involved. Celebrations are a daily job reading `date_of_birth`
and `start_date` from the employee record and posting a card with the person's avatar. Both are
small, both are visible on day one, and neither exists in either donor.

### 6.5 Mailbox client — GE

`praxis-ls/src/modules/mail/mail/` — **12,250 loc / 39 files** of the module's 23,441.
`mail.service.js` (1,808) is provider-agnostic; business code never calls a provider. Secrets live
AES-256-GCM in the integration-secret vault keyed `mail_conn:<id>`, never on the connection row.
Take `providers/imapSmtp.provider.js` (411) — imapflow in, nodemailer out, lazy-required.
**Delete** `microsoftGraph.provider.js` (186), `microsoftOAuth.js` (220), `gmail.provider.js` (225),
`googleOAuth.js`: custom domain only, as specified. Plus `thread.repo.js` (866), `thread.service.js`
(456), `outbox.service.js` (747), `folders.js`, `autodiscover.js` (145), `smtp-error.map.js` (195),
`compose.js` (542), `mail.validator.js` (598), `access.js` (230), `visible.js` (228), `search.js`
(212). Jobs: `mail-sync.js`, `mail-sync-scheduler.js`, `mail-idle.js` (IMAP IDLE).

**Cut these five lines first, before anything else in the module:**

```js
require("../triage/ingest-hooks")      // triage: 2,368 loc not ported
require("../triage/followup.service")
require("../binding/intake.service")   // binding: 2,126 loc — M7, not M1
require("../assist/semantic.service")  // assist: 2,261 loc — M10 at the earliest
require("../assist/ocr.enqueue")
```

Left in place they drag ~4,900 loc behind them. This is the single likeliest way M1 overruns.

### Definition of done

Management dashboard renders with role-locked tiles and no sales anywhere. An employee clocks in and
out on a phone with GPS and device validation; a late punch raises a query; HR waives it and the
deduction is restored. ESS shows attendance history, running earnings, deductions, tasks and
personal records, editable. A department channel carries text, an image and a voice note with
presence and read receipts. **A colleague is recognised from the plus menu and the thumbs up posts
to the general channel; a seeded birthday produces its card that morning** (A19, A20). A user signs
into a company mailbox with address and password alone, reads threaded inbox mail across the
canonical six folders, and sends a reply that arrives. **Saturday is a working day in the
configuration, and a Saturday punch is judged against 09:00 to 15:00** (A22). All of it on both
shells. Gates 1–18 green.

---

## 7 · M2 — Productivity & Performance · 9%

**Owner AJ** with **TB** (analytics) and **GE** (goal cascade). **20–23 Oct. Demo Fri 23 Oct.**

**This milestone carries the most absorbed scope in the build.** The SOW buys "tasks, analytics,
role-based KPIs, targets, reviews" at 9%. The 10 October meeting added A16 to A18 on top: a
four-level goal cascade, a separate Performance Management System, and voice capture with AI
cleanup. The weight did not change. The capacity comes from the AI narrowing (A23), and the
engineer freed from M10's write contract works here instead.

Two modules, not one:

**Workspace** — My Workspace, Tasks, Calendar, Analytics.
**Performance Management System** — goals, KPIs, review cycle. Separate, because Cynthia asked for
it separate and because a review cycle and a task board have different audiences and lifespans.

### 7.1 The goal cascade (A16) — net-new

```
Organisational goal     set by the CEO alone
  Annual goal           set by the management team
    Monthly target      set by the management team
      Departmental      set by the head of that unit
        Individual KPI  set by the department manager, monthly
          Weekly task   set by the line manager (A24)
            Daily task  set by the line manager, employee may add their own
```

Approval, exactly as Cynthia described it: managers set targets in the monthly management review,
the COO reviews, Cynthia reviews, **the CEO gives final approval and only then does it become
binding** and dispatch to staff. That is the M0 workflow engine with a four-stage definition, not
new machinery.

Organisational goal record: goal ID, strategic theme, detail, success measure, baseline, quarterly
cascade. Every level below links upward, so an individual KPI can be traced to the organisational
goal it serves. **Nothing in either donor repo has this.** It is the single largest piece of
net-new work in M2.

### 7.2 Performance Management System (A17) — part donor, part new

Review flow: the employee rates themselves first, the manager approves, a second level approves,
then it reaches HR. Reuse `praxis-ls/src/modules/hr/appraisal/` (1,208) and
`pixie/src/shared/hr_payroll/appraisal.{service,repo,metrics,review-pdf}` (890) plus
`appraisal.autoscore.js` (280). The self-rating-first sequence and the two-level approval are the
parts to build; the review record, the PDF and the scoring are ports.

**Voice capture (A18).** A recorder on the review form, transcribed, then cleaned by the model
against the employee's goal context. The instruction that matters: it tidies wording, it does not
change meaning. `praxis-ls/src/services/ai/gemini-transcription.service.js` (197) and
`transcription.service.js` are the donors; the guardrail prompt is new.

### Reuse — Praxis, decisively

`praxis-ls/src/modules/dashboard/workspace/` — **6,790 loc**: `tasks.service.js` (2,703),
`tasks.repo.js` (2,236), `tasks.validator.js` (499), `tasks.controller.js` (414), `recurrence.js`
(331), `workspace.time.js` (175). Statuses are already the required set: `TO_DO`, `IN_PROGRESS`,
`IN_REVIEW`, `DONE`, `CANCELLED`. Pixie's `shared/tasks/` is 996 loc; not a contest.

Frontend `praxis-ls/client/src/features/workspace/` — **12,436 loc** with tests:
`analytics/analytics-page.tsx` (**1,560** — the Analytics tab, already built), `tasks/task-panel.tsx`
(1,138), `tasks/task-board.tsx` (800), `tasks/task-list.tsx` (515), `today.tsx` (493),
`tasks/task-dialog.tsx` (475), `calendar/calendar-page.tsx` (419), `calendar/event-dialog.tsx` (451),
`tasks/task-blockage.tsx` (395).

**Two design rules to preserve verbatim.** A task is a **pointer**: `link_url` is derived on every
read from `entity_type` + `entity_id` through the shared route map and is never stored — storing it
freezes today's routes into yesterday's rows and the failure is silent, because the SPA catches the
unknown path and lands on the dashboard. The same map serves notifications, so the bell and the task
panel open the same screen. And audience is not a new mechanism: "managers see their team's work" is
`req.permission_scope` / `req.scope_ids` from the org chart, read by the service, never reinvented.

Praxis links tasks to operations files; MyCity has none. Link to partnerships and vacancies — that is
a route-map entry, not a schema change.

Performance: `praxis-ls/src/modules/hr/appraisal/` (1,208), `security/role_kpi/` (398, per-role KPI
scope/default/lock), `pixie/src/shared/hr_payroll/appraisal.autoscore.js` (280) and
`appraisal.{service,repo,metrics,review-pdf}` (890), `pixie/src/shared/goals/` (1,318) with
`target.progress.subscribers.js` auto-counting from domain events, `pixie/src/shared/org_workflow/`
(1,336) for reporting lines.

**Net-new:** KPI **weights**, the goal cascade (§7.1), the self-rating-first review sequence, and
the voice capture guardrail. Roughly half this milestone is now new code.

### Definition of done

Kanban board with the four columns, drag between them, deadline on the calendar. **A line manager
sets a team member's weekly and daily tasks; the team member can add their own alongside, and both
appear on one board** (A24). A manager sees current, completed, pending and overdue work for their
reporting line and nobody else's. Completed tasks remain reportable. Analytics shows completion
rate, overdue, average completion time, workload by employee and tasks by priority.

The cascade: the CEO records an organisational goal with a strategic theme, success measure and
baseline. Management sets an annual goal and a monthly target under it. A unit head sets a
departmental target. A department manager sets an individual monthly KPI with a weight. The run
goes COO, then Operations, then CEO, and **only the CEO's approval makes it binding**. An
individual KPI opened at any point shows the organisational goal it rolls up to.

A review cycle opens, the employee rates themselves first, the manager cannot see the form until
they have, the manager approves, a second level approves, HR receives it. One answer on the form is
dictated rather than typed, transcribed, and tidied without its meaning changing.

---

## 8 · M3 — Queries & Consequence Management · 5%

**Owner GE. 26–30 Oct. Demo Fri 30 Oct.**

### The honest position

`praxis-ls/src/modules/hr/hr_query/` is **209 loc** and `hr_sanction/` is **206** — thin wrappers
over the CRUD factory. Migration `0475` gives two flat tables with a nullable FK, a three-value
`severity`, a five-value `type` and a hard-coded `amount_xaf` column. There is **no escalation
anywhere in either tree**: no chain, no ordering, no thresholds, no rule configuration, no generated
letters.

M3 is roughly **70% net-new against a 5% weight**, in week three. What rescues it is A11: the
workflow engine stood up in M0 turns the consequence chain from an engine into a definition.

### Build

**Rule engine.** A rule is `{ trigger_event, window, threshold, action }` evaluated by a subscriber
on the domain event. Triggers from M1 and M2: late punch, absence, missing clock-out, unenrolled
device, overdue task, missed target. Threshold is Cynthia's requirement stated as data — query on
the third offence in thirty days, not the first. Manual query creation uses the same path so one
code path produces every query.

**Consequence chain** as a workflow definition, not code. MyCity's own sanction set, given by
Cynthia on 10 October, is wider than the PRD's:

```
Query → Caution → Warning → Suspension → Suspension without pay → Dismissal or termination
                                      ↳ Fine (property damage, deducted from salary)
```

Each stage: who decides, what evidence is required, what letter is generated, what financial
consequence attaches. **Adding a step is inserting a stage object.** A fine is not a stage in the
ladder but an attachable outcome, because Cynthia described it as specific to property damage
rather than a rung everyone passes through. It reaches payroll as a pending deduction that M6 must
explicitly accept into a run.

**Query visibility is a hard rule, not a preference.** Managers can raise queries, not only HR, and
**a manager sees only the queries they themselves raised**. HR and the CEO see all of them. That is
a record-scope predicate on the query repo, and it is the kind of rule that is cheap on day one and
expensive to retrofit. HR can push an unsatisfactory query response straight into the sanctions
module, so the query and the sanction stay linked.

**Still to confirm with MyCity:** the lateness threshold that triggers an automatic query. Three
late arrivals, four, or five cumulative hours in a month were all discussed and none was settled.
Build it as a configured rule so the answer is a setting.

**Letter generation** from templates through the document service: first warning, second warning,
suspension, termination. Rendered to PDF, filed to the employee's document vault, delivered by mail.
Every outcome records reason, evidence, decision-maker, date.

**Employee response and review.** The employee responds in ESS; the manager reviews; the full
history is on the employee 360 and is append-only.

Reuse: `attendance.query.js` (124) for the one real auto-query that exists; `hr_ops.service.js`'s
waive/uphold loop as the pattern for financial consequence; `document_vault` and the PDF service for
letters; the M0 workflow engine for the chain.

### Definition of done

A rule is configured from the UI in under a minute — "three late arrivals in thirty days raises a
query". Three late punches raise exactly one query, not three. The employee responds in ESS. HR
upholds it and a warning letter generates, files and sends. A second offence escalates to second
warning without code. A new step is inserted into the chain from the UI and the next case walks it.
An approved financial consequence reaches the payroll run as a pending deduction.

---

## 9 · M4 — Recruitment End to End · 13%

**Owner TB** with **LA** (assessment platform) and **AJ**. **2–13 Nov, two weeks.** **Demo Fri 13 Nov.**
Largest milestone, and the part with no donor is the part the client cares most about.

```
Vacancy → Application → Screening → Assessment → Interview → Shortlist → Offer
```

### Reuse

`praxis-ls/src/modules/hr/vacancy/` (2,483): `vacancy.service.js` (638) — lifecycle
`DRAFT → OPEN ⇄ PAUSED → CLOSED`, where **PAUSED keeps the careers token** so resuming restores the
same public link; `vacancy.draft.js` (453) AI-drafted JD; `vacancy.questions.js` (101);
`vacancy.scoring.js` (424).

**Read `vacancy.scoring.js` before writing any scoring code.** Two tiers: `estimate()` is arithmetic,
costs nothing, marked **PROVISIONAL**; `assess()` reads the résumé against the JD and criteria, costs
a model call, marked final. Both write the same columns and `ai_provisional` tells them apart.
**Every surface that renders a score must render that flag.** The failure it prevents is named in
its own schema comment: a recruiter rejecting somebody on a "97% match" that never opened a CV.

`praxis-ls/src/modules/hr/careers/careers.service.js` (445) is the public-surface model and A9's
foundation: a vacancy is reachable **only by its token**, never by `vacancy_id` ("accepting one here
would quietly turn every internal identifier into a public credential"); the response is an
**allow-list, never a row**; an application is **write-only**, so a candidate cannot read back their
own AI score. Plus `pixie/src/modules/recruitment/` (5,317) and
`praxis-ls/client/src/features/hr/{vacancy,applicant-drawer,vacancy-editor}.tsx` (2,422).

### Blind multi-panel assessment (A10)

`praxis-ls/migrations/tenant/0525` already has `applicant_answer` with `rating`, `notes` and
**`rated_by`** — but its unique index is `(applicant_id, vacancy_question_id)`, **excluding the
rater**, so one rating per question exists in total. Four precise changes:

1. Widen the index to `(applicant_id, vacancy_question_id, rated_by)`
2. Add `interview_round` with state `OPEN | CLOSED` and a members list
3. **One predicate on the read path:** a reviewer sees only their own rows until the round closes
4. Recompute the applicant rating as the average across raters

Then the consolidated report for the hiring manager, and private internal notes that stay private
permanently. **The blindness Cynthia asked for three times is that one `WHERE` clause.**

**Weighted scorecard** (A10, from C): Screening 15 + Psychometric 15 + Technical 25 + Case Study 20
+ Interview 25, weights configurable per vacancy, component scores feeding one ranking.

### Net-new — the assessment platform

Zero hits for `psychometric` or `panelist` across both repos. Built on the public app (A9):

- Test authoring: psychometric, technical, role-specific, from the job description
- Case studies and practical tasks, including structured spreadsheet responses
- Timed delivery with autosave and resume after disconnect
- Automatic scoring where the question type allows, manual where it does not
- Results returned to the candidate record, feeding the scorecard

Plus recruitment SLA and time-at-stage tracking, candidate communication templates, interview
scheduling with calendar invites, automatic panel-feedback reminders.

### Definition of done

A vacancy is created, AI-drafted, published to the public careers page and shared as a link. A
stranger applies with a CV; AI screening scores them with the provisional flag visible. An
assessment is assigned, taken under timer on the public app, scored, and the result lands on the
candidate record. Three panelists each submit an interview assessment and **none can see another's
until the round closes**; the hiring manager then sees all three and produces a consolidated report.
The weighted scorecard ranks candidates. Interview notes are cleaned with AI. SLA shows time at
stage.

---

## 10 · M5 — Offers, Documentation & Onboarding · 11%

**Owner LA** with **GE**. **16–20 Nov. Demo Fri 20 Nov.**

```
Offer → Acceptance → Documentation → Pre-Onboarding → Onboarding
```

Documentation before onboarding, as specified on 2 September.

### Reuse

`pixie/src/shared/documents/documents.esign.service.js` (**939**) + `esign.repo.js` (352) +
`esign.certificate.js` (150) + `esign.signed-pdf.js` (149) + controller and validator — ~1,800 loc.

`pixie/src/modules/recruitment/recruitment.render.js` (**742**): one safe markdown→HTML renderer is
the single source of truth for both the generated PDF and the candidate-facing offer page, **so what
the candidate reads on the web matches the signed PDF**. Produces the JD, the Offer Letter with its
execution block, and the full Offer Packet. On signature the actual base64 image is **stamped into
the execution block** so it rides in the PDF — not a "signed" placeholder.

`praxis-ls/src/modules/vault/document_vault/` (2,043) and `document_verification/` (673), plus
`services/signatures/` (`canonical.js`, `certificate.js`, `qr.js`, `verify-link.js`, `tokens.js`).
**Leave** `qes`, `qes_public`, `signature_wet`, `compliance_flag` (2,728) — assurance tiers nobody
asked to choose from.

**A12, and the thing not to simplify away.** Two hashes on every signature row: `content_hash` over
the canonical payload (recomputable) and `artifact_hash` over the vaulted bytes (frozen). The public
verification page reports **two verdicts**. Drop `artifact_hash` and the page confirms the payload
while saying nothing about the bytes stored. Backend rule: hash the master the image pipeline
**returns**, never the bytes received.

Onboarding: `praxis-ls/src/modules/hr/onboarding/` (1,034, incl. `onboarding.rules.js` — the
checklist a hire raises), `sop_onboarding/` (783), `hr_contract/` (992),
`pixie/src/shared/hr_payroll/staff_documents.*` (952), and the onboarding and SOP screens (1,380).

### Definition of done

A shortlisted candidate moves to Offered; the offer letter generates, is editable, and sends by
mail. The candidate opens a public URL, reads the same text that is in the PDF, signs on a canvas
from a phone, and the status updates automatically. The signed document locks. The public
verification URL returns **two verdicts**. A configurable expiry lapses an unsigned offer. The
document checklist shows required, uploaded and outstanding items; the candidate uploads through a
public URL with a data-privacy acknowledgement; verification status tracks each. Mail fires
automatically at each phase from an editable template. Onboarding does not open until documentation
completes.

---

## 11 · M6 — Payroll & Notifications · 11%

**Owner LA** with **AJ**. **23–27 Nov. Demo Fri 27 Nov.**

### Jurisdiction decides the donor

`praxis-ls/src/modules/hr/payroll/payroll.rules.js` is **Cameroon** — CNPS, CFC, FNE, IRPP brackets,
CAC surtax. Every rate is wrong for Nigeria. Its *shape* is right and worth stating: pure,
deterministic, no I/O; every rate a **default** a tenant overrides through the run's config
snapshot; rates effective-dated and resolved per period; payslips computed **estimates** until
validated.

The Nigerian donor is `pixie-girl-hub/src/shared/hr_payroll/`:

| File | loc | What |
|---|---|---|
| `payroll.calc.js` | 235 | **Pure, no DB.** `progressiveTax` over ordered bands; pension and NHF reduce the PAYE base; consolidated relief as both a flat NGN amount and a percentage; rounded to kobo at the edges |
| `payroll.service.js` / `.repo.js` | 2,265 | Run lifecycle |
| `config.repos.js` | 150 | `payroll_deductions` — PAYE bands, pension %, NHF, **effective-dated**, admin-maintained |
| `payslip.pdf.js` / `payslip.breakdown.js` | 718 | Payslip and its breakdown |
| `payroll.postings.js` | 107 | GL postings; `posting-map.js` already carries `NHF_PAYABLE: 2230` and `NHF_EMPLOYER_EXPENSE: 5140` |
| `rewards.*` | 700+ | Rule-driven bonus automation |

**Simple by default, statutory behind a toggle.** Because the engine is already config-driven, this
is a **config row set, not a second engine**. Default mode: gross, attendance and query deductions,
net. Advanced mode adds PAYE, pension (employee and employer), NHF, ITF and NSITF. ITF (1%) and
NSITF (1%) are **employer** charges and are the only two not already modelled — two rate rows and
two postings. Nothing statutory appears at first glance. Confirmed with Cynthia on 10 October.

**The donor's rates are not seeded.** PAYE bands, reliefs and statutory rates are loaded as
effective-dated configuration from current Nigerian law, confirmed before M6 is demonstrated. The
Pixie defaults and any band table shown in the prototype are not a source.

Approved consequences from M3 arrive as pending deductions and must be explicitly accepted into a
run; a run is previewed, validated, then locked. **A run is submitted for approval to the CEO or
the COO** — which of the two is the one open question on this milestone.

**The daily rate divisor reads the per-day working week (A22), not a hard-coded five.** With
Saturday working, a month has roughly 26 working days rather than 22, which changes every
pro-rated figure on every payslip. This is the quietest way to get payroll wrong and the easiest to
get right, since §6.2 already stores the week as data.

### Notifications

`praxis-ls/src/modules/notification/` (1,570) is **read-only on the caller's own inbox** — rows are
written by the event engine's fan-out, and its header records why: a generic CRUD predecessor leaked
every row. Plus `shared/notifications/` (910), `shared/push/push.service.js` (437) for web push, and
the shared route map so the bell and the task panel open the same screen.

Transports: in-app, web push, email. Per-user and per-category preferences. Configurable
reminders for pending leave approvals, other approvals, employees due for confirmation, due
invoices, and sensitive operational actions.

**Brought forward to M0 by TB on 19/10/2026.** Web push to phones and computers (it reaches a device
after the session has ended, and a tap opens the record through sign-in), the in-app banner, the
bell's pane on both shells and each person's Notification Settings (In App, Email and Push per
category) are built in M0 (`docs/guides/notifications.md`, `docs/runbooks/push-notifications.md`).
**Added to M0 by TB on the same day:** every device alerted at once, every channel post alerting,
and urgency (Normal, Important, Urgent) with Acknowledge, a red bar on every screen and urgent
repeats every 30 minutes of the working day; then Settings · Notifications (#74) with the
configurable reminders above: who each notice reaches and how, approvals waiting, employees due
for confirmation, a daily digest and each person's quiet hours, on one reminder engine that M2's
tasks and calendars use (`docs/handoff/notifications-everywhere.md`). Due invoices join the
reminders with the module that owns them. M6 keeps payroll's own notices and the definition of
done below.

### Definition of done

A payroll run computes from attendance, deductions and approved consequences; payslips generate and
are visible in ESS; the run locks. The advanced toggle switches on and PAYE, pension, NHF, ITF and
NSITF compute against effective-dated configuration, with the statutory report produced. Notification
preferences by category and transport; a pending approval produces in-app, push and email; the link
in each opens the same screen.

---

## 12 · M7 — Partnerships, CRM & Trackers · 10%

**Owner GE** with **LA** (Excel import). **30 Nov–4 Dec. Demo Fri 4 Dec.**

### Partnership 360

`praxis-ls/src/modules/master/party-360.service.js` (332) is the pattern: one call returns the master
record, KPIs, and every child collection — contacts, documents, interactions — and is **built to
render for a brand-new party with zero data**, every figure defaulting to 0 and every collection to
`[]`. That is an acceptance criterion in its own right and it is why the screen does not look broken
on day one.

`praxis-ls/src/modules/sales/partnership_request/` (1,117): **the decision is a transition, not a
column write.** Approve is reachable only from `IN_REVIEW`, reject demands a reason the database also
enforces, both stamp `reviewed_at` and `reviewed_by_user_id`, and approval creates the downstream
record **in the same transaction**. Plus `lead`, `opportunity`, `meeting` (1,943) for stages and
interaction history, `proposal` + `proposal_public` (553), `pixie/src/modules/crm/` (2,830) with
`crm.presets.js`, `pixie/src/shared/contacts/` (2,681).

**Now `mail/binding/` earns its place** (2,126): `intake.service.js` (288),
`mail-context.service.js` (283), `context-tabs.js` (227), `convert.service.js` (203). This is how a
mail thread attaches to a partnership record — the conversation history requirement.

### Proposals, MOUs and contracts

AI generation from a short questionnaire, reusing the `vacancy.draft.js` pattern (453) repointed.
PDF export through the renderer built in M5. Lifecycle
`Draft → Review → Approval → Sent → Viewed → Signed → Active → Expiring → Renewed/Closed` as a
workflow definition over the M0 engine, with e-signature from M5. Tracked: start, end and renewal
dates, owner, counterparty, value, obligations, versions, alerts. Automatic follow-up when a
partnership goes inactive.

### Their actual tracker, read off the screen on 10 October

The Partnerships Pipeline Tracker is one Google Sheets workbook with two sheets. Build against
these, not against invented fields.

**Pipeline sheet.** Partner name, industry, contact person, position, contact details, region,
partnership objective, partnership type, current stage, potential impact, lead owner, date
identified, next action, expected close date, status, comments.

**Partnership types**, from the data-validation dropdown: strategic, events, media, tourism,
hospitality, university, government, corporate, vendor, sponsorship, community, influencer. **Plus
a configuration UI to add more (A21)** — Cynthia asked for it directly and it is absorbed.

**Stages**, in order: prospect identified, initial contact, introductory meeting scheduled,
introductory meeting held, proposal sent, follow up, ongoing negotiation, verbal approval, contract
review, partnership signed, active partnership, on hold.

**Potential impact**, multi-select: app downloads, revenue generation, brand visibility, user
acquisition, vendor acquisition, content collaboration, community growth, business listings,
strategic positioning.

**Monthly partnership performance sheet (A21, absorbed).** Per lead owner: prospects brought in,
meetings held, proposals sent, signed partnerships, active partnerships, downloads generated. This
becomes the analytics page on the partnership module. Marketing and sales own the tracker, so lead
owners come from that department.

**Leads** are captured manually by marketing officers after business development conversations, and
move through new, contacted, qualified, converted, lost. The website contact form is the only
inbound route and currently goes nowhere we control.

### Import engine — net-new

The pipeline exists in neither repo and it is what MyCity is paying to escape:
upload → map columns → validate → detect duplicates → preview → import → error report → import
history, plus export back out. Reuse `master/_shared/dedup.service.js` for duplicate detection;
`exceljs` is already a dependency. Generic, so MyCity can import their remaining trackers
themselves after handover.

**They are on Google Sheets, not Excel.** A sheet downloaded as `.xlsx` reads identically, so the
importer needs no Google API integration. Cynthia also warned that templates may change after
end-of-month feedback, which is the argument for column mapping at import time rather than a fixed
parser.

### Definition of done

The partnership tracker's real data imports through the generic importer with a column map, a
validation pass, a duplicate report and a reversible preview. A partnership 360 shows contacts,
conversation history, stage, owner, expected close, documents and next action, and renders correctly
for a partnership created one minute ago. A record moves between stages with history. A proposal is
AI-generated from a questionnaire, exported as PDF and sent. An MOU runs its lifecycle to Signed
using M5's signature. A mail thread binds to a partnership and appears in its history. An inactive
partnership raises a follow-up.

---

## 13 · M8 — Expenses & Budget Control · 8%

**Owner AJ. 7–11 Dec, parallel with M9. Demo Fri 11 Dec.**

### The closest match in the audit

`pixie-girl-hub/src/modules/cash_request/cash-request.service.js` (**642**) is already the required
state machine:

```
draft → pending_finance → (pending_ceo) → approved → disbursed → settled
```

A `business_config` threshold decides whether the CEO must co-approve. Disbursement **always**
requires the bank transaction ID as the audit anchor, enforced by a database trigger and not only by
the service. "Approved but not yet disbursed" is a first-class state, which the PRD asks for by name.
Set beside `Request → Approval → Approved → Disbursement → Transaction Record → Reporting` and
`Line manager → Operations → CEO`, it is the same machine — and under A11 the hierarchy becomes a
workflow definition rather than a threshold constant.

Plus `pixie/src/modules/expenses/` (2,052) including `expenses.ai.service.js` (364) for receipt
categorisation, `pixie/src/shared/approvals/` (541), `org_workflow/approvals.*` (560).
Praxis's `finance/office_expense/` (323) is thin; use Pixie's.

### One step the donor does not have: the requisition

MyCity's real process has a **batching step** between approval and the CEO, and the Pixie machine
does not model it. Cynthia described it exactly:

```
Requester  →  Line manager approves or rejects  →  Operations (Cynthia) approves or rejects
           →  Operations selects several approved requests and groups them into ONE requisition
           →  CEO approves the requisition  →  Bank transfer  →  Disbursement logged
```

So a requisition is a record that owns many requests, and the CEO approves the requisition rather
than each request. Build it as a checkbox selection over the approved list. Cynthia was explicit
that she rejects as well as approves, so rejection must be available at her stage, not only the
line manager's.

**Thresholds and the requisition, reconciled.** There is one chain for every request, whatever
the amount:

```
Requester → Line manager → Operations → Requisition → CEO → Disbursed
```

Every approved request reaches the CEO inside a requisition, because that is how MyCity pays out.
The per-category approval threshold does **not** add or remove a step. It decides how the CEO
treats that line inside the requisition:

- **Below its category's threshold**, the line is approved with the requisition as a whole.
- **At or above it**, the line is flagged and needs its own tick inside the requisition. A
  ₦820,000 stage hire is never waved through on the strength of a ₦136,000 shoot beside it.
- The CEO approves the requisition once every flagged line is ticked. An unticked or removed
  line goes back to the Operations queue with its history (partial approval).

As a workflow definition: `line_manager` and `operations` stages, then a `requisition` stage whose
per-line condition is `amount >= category.approval_threshold`. Thresholds live on the category,
not on the hierarchy. There is no separate "expense under ₦500,000" hierarchy and no flat
₦500,000 figure anywhere in the configuration. The Pixie `business_config` threshold constant is
not ported.

**Details from the same conversation.** A request carries a vendor invoice upload and account
details when paying a vendor; when an employee is paying themselves, the bank details come from
their employee profile, which is why those fields are in the M1 staff list. Everything is bank
transfer, **NGN only** — a foreign invoice is converted before it enters the system. Disbursement
is logged manually after the bank confirms, which keeps the bank transaction reference as the
audit anchor.

**Budget versus actual ships empty (A25).** MyCity has no budget lines until 2027. The screen is
built, demonstrated at M8 with figures clearly marked as examples, and the high-level operating
expense lines are seeded whenever they arrive.

**Net-new:** department, project and category budgets with variance; budget check before approval;
duplicate-claim detection; pending-disbursement reporting; spend analytics.

### Definition of done

An employee requests cash from a phone. It routes line manager → Operations by a workflow
definition, and the hierarchy is edited from the UI without a deploy. Operations groups approved
requests into one requisition; a line at or above its category threshold is flagged and the CEO
must tick it individually before the requisition can be approved, while lines below it ride with
the requisition. A line the CEO removes returns to the Operations queue. The approved request sits
visibly in "approved, not yet disbursed" until finance disburses with a mandatory bank transaction
reference. Complete history per request. Budget versus actual by department, project and
category shows budget, actual, variance, remaining, committed and disbursed. A request exceeding
remaining budget is flagged before approval, not after.

---

## 14 · M9 — Settings & Governance · 7%

**Owner GE. 7–11 Dec, parallel with M8. Demo Fri 11 Dec.**

Built in M0, surfaced in M9. The permissions and audit foundation is laid at M1 by design, so this
milestone is a console over mechanisms already load-bearing — which is what makes it safe to run
parallel with M8.

`pixie-girl-hub/src/shared/iam/` (**3,141**): `iam.service.js` (1,057) + `iam.repo.js` (1,267) —
argon2, TOTP lifecycle, session management, encrypted secrets, every mutating function taking a
`ctx` and calling audit. **The console is already built**: `IamUsersPage`, `IamMfaPage`,
`IamSessionsPage`, `IamSecurityPage`, `IamSecurityEventsPage`, `IamAuditPage`,
`IamAccessReviewsPage`.

Plus `praxis-ls/src/modules/security/` — `audit_ledger/` (644), `permission/` (464), `scope/` (464),
`capability/` (245), `field_visibility/` (64), `setting/` (410), `numbering_setting/` (99) — and
`middleware/rbac.js` (368) setting `req.permission_scope` and `req.scope_ids`.

**Four layers:** module → action → record scope (`all` / `team` / `own`) → field. There is no
entity layer: under A2 there is one company, so there is no entity column, header or predicate
to grant against. Field-level matters here: salary, bank details and query history are hidden from non-privileged
roles. The RBAC action is spelled **`edit`**, not `update`, in both backends and in this one.

**Module list is a single source of truth.** `access.catalog.js` `MODULES` must equal the distinct
`requirePermission(module, …)` keys enforced in `src/`, and each nav entry carries its permission so
the UI hides what the user cannot open. The API enforces regardless. That equality is checkable and
becomes a gate here.

Configurable approval hierarchies, notification rules and terminology all resolve to data, editable
from Settings. MFA (TOTP) enrolment and enforcement by role. Session and device management with
remote kill. Audit log searchable by actor, entity, action and date. **Amended 16/10/2026 (TB):**
personal two-step enrolment (with passkeys and the PIN) is brought forward to the second sign-in
PR in M0, on ESS · My Security; enforcement by role stays here, with Settings · Security.

### Definition of done

A custom role is created from the UI, granted module and action rights with a record scope, and a
user in it sees exactly those modules with sensitive fields masked. MFA is enforced for a role and
an enrolled user signs in with TOTP. An administrator views active sessions and kills one remotely.
The audit log shows who did what, when and to which record, and cannot be edited. Approval
hierarchies and notification rules are changed without a deploy. The module catalogue equals the
enforced permission keys, checked by a gate.

---

## 15 · M10 — Staff Knowledge Hub & AI Assistance · 10%

**Owner TB** with **GE**. **14–18 Dec, parallel with M11. Demo Fri 18 Dec.**

### Knowledge hub

`pixie-girl-hub/src/modules/help_center/` (828) with its editor and article pages;
`praxis-ls/src/modules/hr/sop_onboarding/` (783); `house-rules.tsx` (617). Company announcements, HR
policies, SOPs, training resources, searchable FAQ. Articles are versioned and permission-filtered.

### AI assistant

**Narrowed on 10 October (A23): the assistant reads, it never writes.** Cynthia and Tom-Blake
agreed that a write is routed to the module that owns it rather than executed by the model. Asked
to create a task, the assistant takes you to the task screen; it does not create the task. That
removes the pending-action queue, the confirmation surface, the executor and the write contract
from this milestone, and **the capacity released goes to M2** (§1.3), which absorbed the most new
scope.

`pixie-girl-hub/src/modules/praxis_ai/` (**4,482**): `praxis.orchestrator.js` runs one turn as
RAG retrieve → LLM call → answer, tracing every step in `ai_run_steps` with real token usage and
cost. Take the retrieval and tracing halves; **leave `praxis.executor.js` and the
`ai_pending_actions` path.** Plus `sql-agent.js`, `query-agent.js`, `query-catalogue.js`.

From `praxis-ls/src/services/ai/` (7,691): `orchestrator.service.js` (2,012), `llm.service.js` (710),
`action-registrar.js` (335), `action-authz.js` (200), `retrieval.service.js` (204), `redact.js`
(205), `answer-sources.js` (309), `knowledge/entity-cards.js` (590). Governance from
`praxis-ls/src/modules/ai/governance/` (605) and `pixie/src/modules/ai_governance/` (2,871) —
spend caps, model config, per-module AI access.

**The assistant answers only from manifests written since M1** (A13, gate 9, now read-manifest
coverage only). It inherits the caller's permissions exactly: **an agent checks the caller's grants
before the model answers**, so marketing cannot reach HR employee data through a question. Every
answer cites its source records. Vendor is Gemini; `resolveVendor` returns null with no vendor
configured and the caller falls back to a graceful stub, which is what makes the feature flag
honest.

Target questions: who has overdue tasks · which expenses await approval · who is due for
confirmation · which partnerships have gone inactive · which candidates await feedback · what is
budget versus actual this month.

### Definition of done

Policies, SOPs, announcements, training resources and FAQs are searchable and permission-filtered.
⌘K finds every page, tab and record the user may open, and nothing they may not. The assistant
answers each of the six target questions with data-backed, auditable answers citing their records.
A user without expense permission asks about expenses and is told it is not available to them.
**Asked to create a task, the assistant opens the task screen rather than creating one** (A23).
Spend caps enforce. Every module in the product has a read manifest or a written `// ai:none`.

---

## 16 · M11 — Handover & Training · 4%

**Owner TB** with the full team. **14–18 Dec, parallel with M10.**

Three sessions on live data, a user manual, and technical knowledge transfer.

Training runs on **staging**, which under A4 carries every feature and sends real mail, so what is
demonstrated is what they will use. Live data means their own imported records — their trackers,
their employees, their partnerships — not fixtures.

**Deliverables.** Three sessions: management and governance (dashboard, approvals, settings, RBAC),
people operations (ESS, attendance, queries, recruitment, offers, payroll), and finance and
partnerships (expenses, budgets, CRM, contracts). A user manual written per module against the
screens as shipped. Technical knowledge transfer: architecture, deployment, backup and restore,
incident runbook, monitoring, and how to add a module. Source and documentation handed over.

**Operational readiness, proven not asserted.** Daily backup running and a restore **rehearsed from
the backup into a scratch database**. Uptime monitoring live with alerting. Error monitoring with a
request correlation ID reaching the logs. Dependency and security patch process documented.

### Definition of done

Three sessions delivered to their named attendees. The manual covers every module with screenshots
from the shipped build. Restore rehearsal completed and timed. Monitoring and alerting demonstrated.
Repository, documentation and credentials transferred. The clean production environment carries
their real data and no seeded rows.

---

## 17 · Conventions

**Module shape.** Every module is `routes · controller · service · repo · validator · events · ai ·
search`. Controllers never call repos. Services never touch `req`/`res`. Repos never emit events.
Validation lives once, in `packages/shared`, consumed by both sides.

**Money.** `decimal.js`, `numeric(18,2)`, 2dp, strings in payloads. Never a float. Never a currency
in a column name. Rendered `₦1,250,000.00`, right-aligned, in **tabular figures**
(`font-variant-numeric: tabular-nums` — Geist ships `tnum`); compact `₦1.3M` only on KPI tiles. A
negative carries a minus sign, a colour **and** a label, never colour alone.

**Dates.** ISO `YYYY-MM-DD` on the wire and in the database. **Day-first everywhere a person reads
one** — screens, PDFs, exports. Never a native date input, never `toLocaleDateString()` with no
locale.

**Errors.** `AppError` with `code`, `httpStatus`, `userMessage`. No SQL or stack traces to the
client. A silent catch carries a written taxonomy marker.

**Audit.** One call writes the domain event and the audit row together. An action without an audit
row is a defect.

**Naming.** Files `kebab-case`, tables `snake_case`, functions `camelCase`, constants
`SCREAMING_SNAKE_CASE`, primary keys `<entity>_id uuid`, every table `created_at` / `updated_at
timestamptz`.

**Before any push:** `npm run ci`. Not lint and a targeted test file — a subset pass reads as green
while CI is not, because a change to a shared service breaks suites you did not name.

---

## 18 · Screen inventory

Fifteen modules in the admin application, plus a separate public site of six pages. 92 screens in
all. This is the vocabulary the client sees, the vocabulary the ⌘K index is built from, and the
vocabulary every later document uses. It is reproduced exactly in the prototype.

**Status: approved 12 October 2026.** These names are now fixed. Each one is a route, a search
entry, a permission key and a line in the training material, so a rename after M9 means touching
the route table, the registry, the permission catalogue and the knowledge base in one change.

**Proposed additions (flagged 13/10/2026, TB; ratified 15/10/2026, below).** A client request for a
clear, well-presented organogram adds two screens: **People · Organogram** (HR builder) and
**Employee Self-Service · Org Chart** (read-only viewer for every member of staff), both drawing
the live `line_manager_id` reporting tree, not a separate structure. This would take the inventory
from 86 to 88. It is deliberately not yet applied to the tables above or to `docs/PROGRESS.md`;
ratifying it also updates the summary counts, the `SCREENS` constant in
`scripts/check/progress.js`, and the command menu and permission registry. The agreed shape is in
`docs/guides/organogram.md`, with a preview in `demo.html`.

**Ratified 13/10/2026 (TB).** Home gains a fourth tab, **Team** (`team`), a managers-and-CEO roster and today’s attendance view that reads the live attendance roster. This is applied to the table above (Home now lists four tabs), taking the admin surface to 80 screens and the inventory to 86. It is reflected in the summary counts, the `SCREENS` constant in `scripts/check/progress.js`, and `docs/PROGRESS.md` (row #86). Its engineering shape is in `docs/guides/home.md`, with the built preview in `demo.html`. It reuses the `home` permission key, so the command menu and permission registry pick it up when the frontend foundation lands.

**Ratified 15/10/2026 (TB).** Six screens join the inventory, taking the admin surface to 86 and the inventory to 92: **People · Organogram** (`organogram`) and **Employee Self-Service · Org Chart** (`org-chart`), the two proposed above; the three ESS attendance tabs built with the attendance work, **Work Location Requests** (`work-location-requests`), **My Devices** (`my-devices`) and **Policy Updates** (`policy-updates`); and **My Security** (`my-security`). All are M1. They are applied to the table above, the summary counts, the `SCREENS` constant in `scripts/check/progress.js`, `src/shared/route-map.js` and `docs/PROGRESS.md` (rows #87 to #92). They reuse the `ess` and `people` permission keys.

**Ratified 20/10/2026 (TB).** One screen joins the inventory, taking the admin surface to 87 and the inventory to 93: **Settings · System Health** (`system-health`), second in Settings, after Organisation. It carries the readiness checks, a day or a week of snapshots, and every fault the code reports, grouped with a status the team shares, and downloads a Markdown brief an AI can fix them from. It is M9, and it is the first screen with a permission key of its own rather than a reused one: `system_health`, granted to the Implementation Team and the System Administrator only, because a stack trace is not Operations & People's or Management's to act on and alerting them creates alarm without action. It is applied to the table below, the `SCREENS` constant in `scripts/check/progress.js`, `src/shared/route-map.js`, `src/shared/search/screens.js` and `docs/PROGRESS.md` (row #95). Its engineering shape is in `docs/guides/system-health.md`.

**Amended 20/10/2026 (TB).** Settings · System Health is split into three tabs after TB walked the first release on staging: **Status** (`status`), **Performance** (`performance`) and **Faults** (`faults`), taking the admin surface to 89 and the inventory to 95. One tab meant scrolling past the checks and the chart to reach the fault list, which is the part the IT team uses. The `system_health` permission key and everything behind it are unchanged; only the tab the screens sit on changes. Applied to the table below, `scripts/check/progress.js`, `src/shared/route-map.js`, `src/shared/search/screens.js` and `docs/PROGRESS.md` (rows #95 to #97).

**Ratified 20/10/2026 (TB).** Policies are centralised. **Knowledge Hub · Policies** (`policies`) is brought forward from M10 to M1, built with the attendance work, as the one place every company policy lives: a written document, or a rules policy whose switches and figures the system enforces, the Attendance policy first. **Settings · Attendance Policy** (`attendance-policy`) is dropped: its worksheet is the Attendance policy on Knowledge Hub · Policies, taking Settings to 13 tabs, the admin surface to 88 and the inventory to 94. **Employee Self-Service · Policy Updates** keeps its slug and now carries every policy that applies to the person, with their acknowledgement. Its row in `docs/PROGRESS.md` (#73) is marked Dropped, not deleted. Applied to the table below, `src/shared/route-map.js`, `src/shared/search/screens.js`, the app's catalogue and `docs/PROGRESS.md` (rows #62, #73, #89). Its engineering shape is in `docs/guides/policies.md`, and the Attendance policy's rules in `docs/guides/attendance.md` §6.15. Policies use the `knowledge` permission key with a new capability, `policies.manage`, so only Operations & People (and those given it) write them; everyone else reads the policies that apply to them on ESS.

**The public site is not a sixteenth module.** It is the third deployable named in A9: its own
application, its own build, its own origin, listed below only because it carries six of the 92
screens and those screens need names too. Nothing in the admin rail links to it, and a member of
staff never navigates to it to do their job.

| Area | Module | Tabs | Screens | Built in |
|---|---|---|---|---|
| (ungrouped) | **Home** | 4 | Overview · Team · Alerts · Reports | M1 |
| (ungrouped) | **My Workspace** | 4 | Today · Tasks · Calendar · Analytics | M2 |
| (ungrouped) | **Employee Self-Service** | 12 | My Profile · My Attendance · Work Location Requests · My Devices · Policy Updates · My Performance · My Payslips · My Leave · My Queries · My Documents · Org Chart · My Security | M1 |
| Work | **Staff Community** | 3 | Channels · Direct Messages · Announcements | M1 |
| Work | **Mailbox** | 6 | Inbox · Sent · Drafts · Archive · Spam · Trash | M1 |
| People | **People** | 6 | Employees · Organogram · Attendance · Leave · Devices · Worksites | M1 |
| People | **Performance** | 5 | Goals · Targets · KPIs · Reviews · Analytics | M2 |
| People | **Queries & Sanctions** | 4 | Queries · Rules · Sanctions · Letter Templates | M3 |
| People | **Recruitment** | 7 | Vacancies · Candidates · Assessments · Interviews · Offers · Onboarding · Talent Pool | M4, M5 |
| People | **Payroll** | 5 | Payroll Runs · Payslips · Salary Structure · Deductions · Statutory | M6 |
| Business | **Partnerships** | 6 | Pipeline · Partners · Leads · Proposals · Contracts & MOUs · Analytics | M7 |
| Business | **Expenses** | 6 | My Requests · Approvals · Requisitions · Disbursements · Budgets · Categories | M8 |
| System | **Knowledge Hub** | 5 | Policies · SOPs · FAQs · Training · Announcements | M1 (Policies), M10 |
| System | **Praxis AI** | 2 | Ask · History | M10 |
| System | **Settings** | 13 | Organisation · Status · Performance · Faults · Users · Roles & Permissions · Approvals · Notifications · Appearance · Documents & Numbering · Integrations · Security · Audit Log | M9 |

**Separate application — `go.mycityapp.io`, not in the rail**

| | Site | Pages | Screens | Built in |
|---|---|---|---|---|
| Public | **Public site** | 6 | Careers · Vacancy · Apply · Assessment · Sign Offer · Verify Document | M4, M5 |

Three of the above span a milestone boundary. **Knowledge Hub** gets Policies in M1 (ratified 20/10/2026) and SOPs, FAQs, Training and Announcements in M10. **Recruitment** gets Vacancies through Interviews in M4 and
Offers, Onboarding and Talent Pool in M5. The **public site** gets Careers, Vacancy, Apply and
Assessment in M4, and Sign Offer and Verify Document in M5. **Settings → Notifications** is built
with the notification engine, not in M9 with the rest of the module (brought forward from M6 to
M0 by TB on 19/10/2026).

### 18.1 Naming rules

**Home, not Command Centre or Dashboard.** It is the first thing in the rail and the first thing a
new employee sees. A plain word survives translation, fits an icons-only rail and does not promise
more than four tabs deliver.

**Praxis AI carries our name, and it is the only place it appears in the chrome.** The assistant is
the signature. Every other module is named for what it does.

**Employee Self-Service, never "My HR".** Staff do not think of themselves as having an HR. The
seven tabs all begin "My" so the boundary is obvious: this module shows you only your own record.

**Queries & Sanctions, not Discipline.** The module is used far more often for a question that
closes with no action than for a sanction. Naming it after the worst outcome makes people
reluctant to open it.

**Alerts and notifications are different screens.** An alert is work nobody has done; it ages and
needs a permission to clear. A notification is something that happened to you; it is read once.
Merging them produces a list that cannot be cleared and is therefore ignored.

**A tab's label is chrome. A tab's value is a URL.** `?tab=salary-structure` is a deep link that
appears in email, in the knowledge base and in training material. Renaming the label must not
change the value, so the display name is mapped at the point of render and the slug is left alone.

**English only.** No French build and no `title_fr`. The corridor is Nigerian and the working
language is English, which removes the dictionary-key problem entirely.

### 18.2 What registering a screen costs

A screen that exists but is not registered is invisible three times over: ⌘K cannot find it, the
shell cannot permission-filter it, and the assistant cannot cite it. None of those fails a test,
which is why gate 10 fails the build on an unregistered route instead. Each entry carries its
route, its module permission, the record types it covers and the words people actually use for it,
so "cash request" and "expense" reach the same screen.

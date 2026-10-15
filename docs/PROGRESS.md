# MyCity App ERP · Progress

**The single record of what is built.** 92 screens (86 in the staff app, 6 on the public site) plus
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
| M1 Core Operations & Employee Management | 31 | 31 | 0 | 0 | 0 | 0 |
| M2 Productivity & Performance | 9 | 9 | 0 | 0 | 0 | 0 |
| M3 Queries & Consequence Management | 4 | 4 | 0 | 0 | 0 | 0 |
| M4 Recruitment End to End | 8 | 8 | 0 | 0 | 0 | 0 |
| M5 Offers, Documentation & Onboarding | 5 | 5 | 0 | 0 | 0 | 0 |
| M6 Payroll & Notifications | 6 | 6 | 0 | 0 | 0 | 0 |
| M7 Partnerships, CRM & Trackers | 6 | 6 | 0 | 0 | 0 | 0 |
| M8 Expenses & Budget Control | 6 | 6 | 0 | 0 | 0 | 0 |
| M9 Settings & Governance | 10 | 10 | 0 | 0 | 0 | 0 |
| M10 Staff Knowledge Hub & AI Assistance | 7 | 7 | 0 | 0 | 0 | 0 |
| **Total** | **92** | **92** | **0** | **0** | **0** | **0** |

M1 counts Employees with People although its API is M0 work. M4 and M5 include their public-site
pages. Settings → Notifications is counted in M6, where it is built.

---

## M0 · Foundation

Not a screen each, so tracked as items. `☑` done, `☐` not yet. Same note format as the screens.
Source: BACKEND_STRUCTURE §13 (definition of done) and the 12 October internal meeting.

| Item | Owner | Done | Updated |
|---|---|---|---|
| Server: 4 subdomains, TLS, proxy settings per `docs/runbooks/proxy.md` | GE | ☐ | |
| Root config: `package.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, ESLint, Jest | GE | ☐ | |
| `src/config/*`, `app.js`, `server.js`, `worker.js`, `http/*`, `middleware/*` | GE | ☐ | |
| Shared core: `db`, `crud`, `http`, `errors`, `events`, `workflow`, `numbering`, `money`, `time`, `access`, `rbac` | GE | ☐ | |
| Pagination gate: `shared/http/paged.js`, `common.js` page schemas, `check/pagination.js` (§16) | GE | ☑ | 13/10/2026 |
| Contract package + generator (`gen:contract`) + `http/route.js` | GE | ☐ | |
| M0 migrations 0001 to 0099 | LA | ☐ | |
| Staging seed data | LA | ☐ | |
| Nine M0 modules: identity, access, audit, organisation, settings, notifications, workflow, documents, imports | GE | ☐ | |
| `create-admin` seeds a full employee, login and role (§17) | GE | ☑ | 13/10/2026 |
| Documents, media, uploads, PDF generation | GE | ☐ | |
| Import engine + staff importer; real staff sheet imported on staging | GE · LA | ☐ | |
| AI foundation: `services/ai`, manifests, registry, gate 9 | GE | ☐ | |
| CI wiring: `package.json`, lockfile, ESLint, Jest, `ci-local.js`, `ci.yml` | GE | ☑ | 13/10/2026 |
| Process gates: progress, guides, README map, CODEOWNERS; PR template; Claude Stop hook | GE | ☑ | 13/10/2026 |
| GitHub settings applied by TB (`docs/runbooks/github-settings.md`) | TB | ☐ | |
| CODEOWNERS usernames: GE `@swizfcodes`, TB `@tomblakeasaah196`, AJ `@Ghosted34`, LA `@LovedataX` | GE | ☑ | 13/10/2026 |
| CI gates 1 to 8 and pipeline guards (scripts still empty, reported NOT BUILT) | GE | ☐ | |
| Release pipeline: `release.yml`, `deploy-gate`, staging seal, production approval | GE | ☐ | |
| Docs: `CLAUDE.md`, backend guide, frontend guide, this file, guide template | GE | ☑ | 13/10/2026 |
| Frontend foundation (`app/`, `public-app/`): shell, design tokens, contract client, shared components | AJ | ☐ | |

**Notes**

- 15/10/2026 · AJ · `npm run contract:status` (in `app/`, FRONTEND_GUIDE §9.1): reports, for both apps, which modules still run on INTERIM types and which are ready to move to `contract.gen.ts`. Today 19 INTERIM files, 317 endpoints, none in the contract yet.
- 15/10/2026 · AJ · Delivery plan in both apps (FRONTEND_GUIDE §9.2): production shows Coming Soon for any screen whose row here is not fully ticked, with its milestone and date from this file and MILESTONES §4 (the public site hides both from visitors); development, the demo build and staging get the demo's "Prototype View" switch: Full Design, or As Delivered at the current milestone (the earliest not past its demo day and not fully ticked; M1 today). This file is now read by the frontend build, so the table format (backticked slug, M column, three tick columns) must hold.
- 15/10/2026 · AJ · Staging bar in both apps (MILESTONES §6): shown on a `staging.` host or when the API answers `X-Mycity-Environment: staging`; fixed above everything in `app/`, sticky in `public-app/`. Production renders nothing. The tab icon becomes the pin on amber (`favicon-staging.svg`) and the browser bar takes the staging amber (`theme-color`). Left from §6: the installed staff app's home-screen icon and splash colour come from the PWA manifest, which is fixed at build; varying them needs `src/http/static.js` to serve a staging manifest on `hub.staging` (GE).
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

- 15/10/2026 · AJ · Frontend built in `app/src/features/home/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/home.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
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

- 15/10/2026 · AJ · Frontend built in `app/src/features/workspace/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/workspace.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

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
| 87 | Work Location Requests | `work-location-requests` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 88 | My Devices | `my-devices` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 89 | Policy Updates | `policy-updates` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 90 | My Security | `my-security` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 91 | Org Chart | `org-chart` | M1 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/ess/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/ess.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · My Leave: the four KPI tiles open their modal on a phone only (`Kpi` `opensOn="phone"`); on desktop they are plain tiles because the requests table and entitlement card already sit beside them. Home keeps desktop drill-down, as `docs/guides/home.md` asks.
- 15/10/2026 · TB · Five ESS tabs ratified into the inventory (MILESTONES §18): Work Location Requests (#87), My Devices (#88) and Policy Updates (#89), owned by LA from the attendance work; My Security (#90, AJ); Org Chart (#91, TB). Inventory now 92 screens; SCREENS constant and `src/shared/route-map.js` updated.
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

- 15/10/2026 · AJ · Frontend built in `app/src/features/community/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/community.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
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

- 15/10/2026 · AJ · Frontend built in `app/src/features/mailbox/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/mailbox.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
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
| 92 | Organogram | `organogram` | M1 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/people/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/organisation.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · TB · Organogram ratified as #92 (`organogram`, M1, TB) alongside ESS · Org Chart (#91). Owner and milestone assigned; build follows `docs/guides/organogram.md`.
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

- 15/10/2026 · AJ · Frontend built in `app/src/features/performance/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/performance.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Queries & Sanctions

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 34 | Queries | `queries` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 35 | Rules | `rules` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 36 | Sanctions | `sanctions` | M3 | GE | ☐ | ☐ | ☐ | Not started | |
| 37 | Letter Templates | `letter-templates` | M3 | GE | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/queries/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/queries.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

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

- 15/10/2026 · AJ · Frontend built in `app/src/features/recruitment/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/recruitment.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Payroll

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 45 | Payroll Runs | `payroll-runs` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 46 | Payslips | `payslips` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 47 | Salary Structure | `salary-structure` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 48 | Deductions | `deductions` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 49 | Statutory | `statutory` | M6 | LA | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/payroll/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/payroll.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

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

- 15/10/2026 · AJ · Frontend built in `app/src/features/partnerships/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/partnerships.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

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

- 15/10/2026 · AJ · Frontend built in `app/src/features/expenses/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/expenses.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Knowledge Hub

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 62 | Policies | `policies` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 63 | SOPs | `sops` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 64 | FAQs | `faqs` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 65 | Training | `training` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 66 | Announcements | `announcements` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/knowledge/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/knowledge.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.

### Praxis AI

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 67 | Ask | `ask` | M10 | TB | ☐ | ☐ | ☐ | Not started | |
| 68 | History | `history` | M10 | TB | ☐ | ☐ | ☐ | Not started | |

**Notes**

- 15/10/2026 · AJ · Frontend built in `app/src/features/assistant/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/knowledge.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · Fixed a blank screen on Ask: the scroll effect returned a value, which crashed React in browsers where `scrollIntoView` returns a Promise. The shell now wraps every screen in an error boundary, so a crash in one screen shows an error card there and the menu and back button keep working.

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

- 15/10/2026 · AJ · Frontend built in `app/src/features/settings/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/settings.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 15/10/2026 · AJ · Roles & Permissions: New Role and Edit Role (name, purpose, per module the actions and the record scope, and the three sensitive fields), delete for an unused custom role, the CEO role locked, built-in roles keep their names. The matrix, the roles list and the role pickers in Users read the saved roles; every change is audited. Copy now says four layers with no entity layer (MILESTONES §14, A2). INTERIM endpoints in `app/src/api/types/settings.ts`: `GET /settings/roles/catalogue`, `GET|PUT|DELETE /settings/roles/:id`, `POST /settings/roles`, for GE to confirm. Left: the mock's demo sign-ins do not yet take their access from these roles.

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

- 15/10/2026 · AJ · Built `public-app/` (A9) from the demo's Public Site pages: Careers, Vacancy, Apply, Assessment, Sign Offer and Verify Document, desktop and phone, light and dark with a visitor toggle, against an in-browser mock of `/api/public/v1`. Added the states the demo does not draw: application received, assessment start, finished and time up, offer signed, declined and expired, the three failed verify verdicts and a reference lookup, and every bad link (unknown, expired, used). No ticks: UI is ticked once the pages run on the real API. Left: the public routes in the contract. Only `GET /verify/:number` and `GET /<surface>/:token/document` are named in BACKEND_STRUCTURE §8; the rest are INTERIM in `public-app/src/api/types/public.ts` for TB (M4) and LA (M5) to agree, including `POST /jobs/:slug/apply` minting the apply token and `POST /apply/:token/cv` for the CV.

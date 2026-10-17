# MyCity App ERP · Progress

**The single record of what is built.** 93 screens (87 in the staff app, 6 on the public site) plus
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
| M0 Foundation | 27 items below: 26 done, 1 open | | | | | |
| M1 Core Operations & Employee Management | 32 | 17 | 0 | 15 | 0 | 0 |
| M2 Productivity & Performance | 9 | 9 | 0 | 0 | 0 | 0 |
| M3 Queries & Consequence Management | 4 | 4 | 0 | 0 | 0 | 0 |
| M4 Recruitment End to End | 8 | 8 | 0 | 0 | 0 | 0 |
| M5 Offers, Documentation & Onboarding | 5 | 5 | 0 | 0 | 0 | 0 |
| M6 Payroll & Notifications | 6 | 6 | 0 | 0 | 0 | 0 |
| M7 Partnerships, CRM & Trackers | 6 | 6 | 0 | 0 | 0 | 0 |
| M8 Expenses & Budget Control | 6 | 6 | 0 | 0 | 0 | 0 |
| M9 Settings & Governance | 10 | 3 | 0 | 7 | 0 | 0 |
| M10 Staff Knowledge Hub & AI Assistance | 7 | 7 | 0 | 0 | 0 | 0 |
| **Total** | **93** | **71** | **0** | **22** | **0** | **0** |

M1 counts Employees with People although its API is M0 work. M4 and M5 include their public-site
pages. Settings → Notifications is counted in M6, where it is built.

---

## M0 · Foundation

Not a screen each, so tracked as items. `☑` done, `☐` not yet. Same note format as the screens.
Source: BACKEND_STRUCTURE §13 (definition of done) and the 12 October internal meeting.

| Item | Owner | Done | Updated |
|---|---|---|---|
| Server: 4 subdomains, TLS, proxy settings per `docs/runbooks/proxy.md` | GE | ☑ | 17/10/2026 |
| Root config: `package.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, ESLint, Jest | GE | ☑ | 14/10/2026 |
| `src/config/*`, `app.js`, `server.js`, `worker.js`, `http/*`, `middleware/*` | GE | ☑ | 14/10/2026 |
| Shared core: `db`, `crud`, `http`, `errors`, `events`, `workflow`, `numbering`, `money`, `time`, `access`, `rbac` | GE | ☑ | 14/10/2026 |
| Pagination gate: `shared/http/paged.js`, `common.js` page schemas, `check/pagination.js` (§16) | GE | ☑ | 13/10/2026 |
| Contract package + generator (`gen:contract`) + `http/route.js` | GE | ☑ | 14/10/2026 |
| M0 migrations and reference seed 0001 to 0099 | LA | ☑ | 16/10/2026 |
| Staging seed data: MyCity's staff (`seeds/staging/10_staff.js`); each later module seeds its own records | LA · TB | ☑ | 17/10/2026 |
| Nine M0 modules: identity, access, audit, organisation, settings, notifications, workflow, documents, imports | GE · TB | ☑ | 17/10/2026 |
| Sign-in and sessions: `identity`, `access`, `users`; session rules, lock screen, credential links, the seven roles, the four-city sign-in screen (`docs/guides/identity.md`) | TB | ☑ | 16/10/2026 |
| Two-step sign-in, passkeys and the PIN: the `security` module, the code step, PIN and passkey sign-in, the lock screen's PIN and passkey, the fresh-sign-in window, Reset Two-Step (`docs/guides/identity.md`) | TB | ☑ | 16/10/2026 |
| `create-admin` seeds a full employee, login and role (§17) | GE | ☑ | 13/10/2026 |
| Documents, media, uploads, PDF generation | GE | ☑ | 17/10/2026 |
| Import engine + staff importer; real staff sheet imported on staging | GE · LA · TB | ☑ | 17/10/2026 |
| AI foundation: `services/ai`, manifests, registry, gate 9 | GE | ☑ | 15/10/2026 |
| CI wiring: `package.json`, lockfile, ESLint, Jest, `ci-local.js`, `ci.yml` | GE | ☑ | 13/10/2026 |
| Process gates: progress, guides, README map, CODEOWNERS; PR template; Claude Stop hook | GE | ☑ | 13/10/2026 |
| GitHub settings applied by TB (`docs/runbooks/github-settings.md`; branch protection and required reviewers wait for a public repository or a plan that offers them) | TB | ☑ | 17/10/2026 |
| CODEOWNERS usernames: GE `@swizfcodes`, TB `@tomblakeasaah196`, AJ `@Ghosted34`, LA `@LovedataX` | GE | ☑ | 13/10/2026 |
| CI gates 1 to 8 and pipeline guards (gate 6: schema-drift and contract-columns) | GE · TB | ☑ | 16/10/2026 |
| Release pipeline: `release.yml`, `deploy-gate`, staging seal, production approval (manual run by GE or TB while the repository is private) | GE | ☑ | 17/10/2026 |
| Operations: nightly backup, weekly restore drill, offsite copy, uptime probe; runbooks backup-restore, incident, monitoring, add-a-module | GE | ☐ | 17/10/2026 |
| Docs: `CLAUDE.md`, backend guide, frontend guide, this file, guide template | GE | ☑ | 13/10/2026 |
| Screen gates 8, 11, 12, 17: `five-second`, `two-shells`, `forms`, `dashes`; screen conventions in FRONTEND_GUIDE §5, §7, §8 | TB | ☑ | 14/10/2026 |
| Frontend foundation PR 1 · Ground: `packages/ui` (tokens, primitives, overlays, help, toast, form system, data client), catalogue and gallery, new gates, docs (FRONTEND_FOUNDATION §4) | AJ | ☑ | 15/10/2026 |
| Frontend foundation PR 2 · Shell: both apps' shells on `packages/ui`, bottom bar, More, floating button, session, PWA, what opens where | AJ | ☑ | 15/10/2026 |
| Frontend foundation PR 3 · Build kit: DataView, KPI, charts, kanban, calendar, pickers, upload, editor, PDF preview, voice, maps; app component folders emptied; every screen on the token scale | AJ | ☑ | 16/10/2026 |

**Notes**

- 17/10/2026 · GE · Two-column Grid panes polished: a thin scrollbar kept inside the card's rounded corners (its track margin is the card radius) and a card's header that stays put while its body scrolls (`data-panes`, `data-card-header`). Left: nothing.
- 17/10/2026 · GE · Two cards side by side now scroll on their own on desktop, as the mailbox's panes do: `Grid` (2, "1.4/1", "1/1.5") caps each column at the window's height under the top bar (`max-h-card-pane`) with its own scroll, from the width the columns sit side by side; the page still scrolls around them, and `scroll={false}` opts a grid out. Phones are unchanged (one column, the page scrolls). Checked on Settings · Security at 1440 by 520: the role card scrolls alone while the rules card and the page stay put. Left: nothing.
- 17/10/2026 · TB · GitHub settings ticked: TB restricted the production environment to `main`, and
  the team accepted the rest as it stands for M0. Left: branch protection on `main` and required
  reviewers on production, once the repository is public or on a plan that offers them.
  Operations: provisioning re-run on the server, confirmed over SSH, so the backup and restore-drill
  timers are installed. Still open: the offsite backup host and the WhatsApp alert links.
- 17/10/2026 · TB · Release pipeline ticked: the team accepted the manual production run by GE or TB
  (`release.yml` approver job) as M0's production approval while the repository is private. Left:
  required reviewers on the production environment once the repository is public or on a plan
  that offers them; the GitHub settings and operations items stay open.
- 17/10/2026 · TB · M0 table brought up to date: 24 of 27 items done. Ticked the server (staging
  verify passes over HTTPS with HSTS and each host refusing the other's API, production serves the
  sealed releases, the uptime probe is green) and the staging seed (MyCity's staff through
  `seeds/staging/10_staff.js`; later modules seed their own records). Still open, each with
  something outside the code: GitHub settings (the repository is private, so required reviewers
  and branch protection are not offered); the release pipeline's production approval (interim
  manual run until then); operations (backups, restore drill and offsite copy need provisioning
  re-run on the server, the offsite host and the WhatsApp alert links, none confirmed yet).
- 17/10/2026 · TB · Production runs only by hand while the repository is private: GitHub offers no
  required reviewers there, so releases 130 to 134 reached production seconds after the seal. The
  automatic `release.yml` run now stops at the seal and names the sha; an approver (GE or TB)
  starts Release from `main` with it, and an `approver` job in `release.yml` and `rollback.yml`
  refuses anyone else (SYSTEM_ARCHITECTURE §9.3, deploy runbook §2). Left: TB sets the production
  environment to Selected branches `main`; the server-side approval if the repository stays private.
- 17/10/2026 · TB · ⌘K additions (`docs/guides/foundation.md` §6.7): Waiting on You first with nothing
  typed (the requests waiting on the reader, opening the record each is about), open seats (opening
  the Organogram focused on the seat), preferred and middle names, Use Dark Theme, Use Light Theme,
  Change Density, Install App and Sign Out as actions the app runs, and one forgiven slip in screens
  and actions. Left: nothing.
- 17/10/2026 · TB · Track D of `docs/guides/foundation.md` built: the `workflow` module's routes (My
  Approvals and `/workflow/mine/count` for Home's Waiting on You, one request with its route and
  decisions, approve, reject and request changes with a reason, withdraw, and reassign from the guide's
  §11, migration `0450`), the leave flow `leave.approval` seeded in `0499` (the line manager, then
  Operations & People over 5 days), and ⌘K search on `GET /search` in a new `search` module: screens
  with synonyms, actions (each screen's New action: Add Employee, Start Import, Invite User, New Role,
  New Holiday, Add Role; and Import Staff, Clock In, Request Leave, Change Password, Set PIN, Mark All Read) and every module's records, each group 25 a
  page by the reader's grants. The search coverage gate now fails a route-map screen, an `ENTITY_ROUTES`
  type or a `useScreenAction` label that search cannot reach, unless it carries `search:none <reason>`;
  65 types not built yet carry `not built yet (src/modules/<m>)`, which fails once that module is built.
  `useScreenAction` no longer re-registers on every render (an inline `onSelect` looped). Left: the nine
  modules row, ticked with this merge now that tracks A, B and C are in.
- 17/10/2026 · TB · Foundation track A (`docs/guides/foundation.md` §1.1): the `organisation`
  module on the real API, the staff importer, and MyCity's real staff loaded by every deploy.
  Backend: the register at 25 with search, filters and server sort, the employee 360 masked per
  viewer, Add, Edit, Archive and Restore, reporting lines to a person or to a vacant seat with a
  dotted line beside it, departments, `org_seat` writes, the whole tree in one bounded read (2,000
  nodes), `organisation.search.js` (employees and departments) and `organisation.ai.js` (three
  reads, no writes); migration `0300` (archiving, a start date that may be unknown, the register's
  indexes) and reference seed `0349`. The staff importer `employee.import.js` reads one Name cell, a
  department by name and a line manager in prose (a name, a post, or a post with a dotted line
  beside it), and a VACANT row becomes a seat that carries reports. `scripts/db/load-staff.js` runs
  on every deploy, on staging AND production, as the system: it is quiet when the sheet has not
  changed, drops a column the whole sheet gets wrong (MyCity's DOB holds a day and month with no
  year; Phone is a placeholder in every row), commits the valid rows, gives each person a login in
  the invited state with the roles `seeds/staff/roles.json` grants their post, sends no email, and
  never writes over an edit made in the app. `seeds/staff/staff-list.xlsx` (18 people, 2 open seats)
  and `roles.json` are committed, the repository being private. `seeds/staging/10_staff.js` loads the
  same roster for a demonstration. Shared, additive: `numbering.advanceTo()` (the counter past the
  numbers a sheet brings), `blank()` in the contract (an optional field a form leaves empty), the
  import engine takes batch `options` and honours a service that answers "nothing to write".
  Left: track D (`workflow`); the Documents tab on the employee record, which arrives with the
  documents work; the people tasks in the guide's §1.2.
- 17/10/2026 · TB · Track C of `docs/guides/foundation.md` built, three more of the nine M0 modules:
  `access` (roles created, edited and deleted with their grants, field visibility and capabilities
  in one save; the matrix; nobody can take away their own Settings), `settings` (the organisation
  profile, the working week, public holidays entered on screen, numbering schemes, the security
  rules) and `audit` (`GET /audit` at 25 with filters, the summary, the Excel export emailed through
  the outbox, values masked per reader; Settings view with scope all, or the CEO). Migration `0400`
  (`role_capability`, `role.two_step_required`, audit and session indexes, the `two_step_setup`
  ticket) and seed `0449` (the §6.3 field visibility and capabilities). Security rules are settings
  within the `.env` floor (`PASSWORD_MIN_LENGTH` is new); requiring two-step by role came forward
  from M9 and adds a set-up step to sign-in, so `identity`, `security` and the grants cache changed
  too. Each module has an `.ai.js` (reads only) and a `.search.js`, or `audit`'s written none. Left
  for the row above: `organisation` (track A) and `workflow` (track D).
- 17/10/2026 · TB · Track B of `docs/guides/foundation.md` built: the `imports` module (the
  BACKEND_STRUCTURE §9.3 API over any registered importer, plus `GET /imports/:id` so the wizard
  survives a reload), the `documents` module (`POST /documents` for a file with no record yet,
  `GET /documents/:id` with `/content`, `/variant/:kind` and `/versions`, `POST /documents/:id/versions`
  and `/verify`, `GET|POST /employees/:id/documents` with `/summary` and `/document-requests`), and the
  `ess` module's first tab. Migration `0350` adds `document_request` and `document.verified_at`;
  reading a file stays the vault's rule, so a document the caller may not read is a 404. M0's
  definition of done for files is proved through the gated routes in
  `tests/integration/documents-api.test.js`: a photo, a scanned document and a voice note upload,
  process and download; a direct `/media/vault/...` request is a JSON 404; a letter template
  generates a numbered, hashed, locked PDF that only its readers can fetch. Left for the row above:
  the staff importer and the real sheet on staging, which are track A's.
- 17/10/2026 · TB · Sign-in made luxurious on both shells (TB: slight glassmorphism, motion on
  the phone too): smoked glass for the form and the desktop's city dock, film grain, darkened
  edges, rising points of city light, the city's name arriving out of focus and a ticking colon.
  The phone now drifts, glows and crossfades like desktop. Left: nothing.
- 17/10/2026 · TB · Sign-in: four more cities (Johannesburg, Rabat, Abidjan, Douala; TB's images),
  eight in turn, each photograph fetched only when its city is shown or next. The phone sign-in is
  redesigned: a still portrait crop of the photograph at the top, the brand and a glass clock on it,
  the form in a frosted panel in the dark theme's colours; nothing moves but the crossfade. The
  staging bar is off both apps by TB's decision (MILESTONES §6 and SYSTEM_ARCHITECTURE §10
  updated); the tab icon, theme colour, header and mail marks stay. Left: nothing.
- 17/10/2026 · TB · Sign-in photographs: Lagos, London, Accra and Nairobi at dusk (TB's images, WebP
  at 1280 and 640, about 250 KB for all four) behind the sign-in screen, each drifting and zooming on
  its own path, the lights glowing, a few pixels of pointer parallax, crossfades with a short focus
  pull. The drawings stay as the stand-in until a photograph loads. Left: sharper sources (the
  images are 1280 wide, a little soft on large screens).
- 16/10/2026 · TB · Release fix: staging deployed, but verify-staging refused to seal on two
  checks. The migrations head now counts reference seeds, which share the ledger's numbering
  (`10099_seed_knowledge_ai` is the head, not `10000_…`). `/socket.io` on the public host is now the
  API's JSON 404 (docs/runbooks/proxy.md §5): Engine.IO hands a wrong-host request back to the app,
  and refuses a wrong-host upgrade with a 404, where it answered 400 before. Left: the PENDING
  checks wait for their modules.
- 16/10/2026 · TB · `docs/guides/foundation.md`: the rest of M0 and the foundation in four tracks (A
  people and the staff roster, B imports and documents, C access, settings and audit, D workflow and
  search), with TB's twenty decisions of 16/10/2026. TB claims the remaining M0 modules from GE's row
  (GE reviews). The repository is private; MyCity's staff sheet and role map go into `seeds/staff/`
  with track A and load on staging and production with each deploy (the one exception to
  "production is never seeded"). CLAUDE.md gains that exception and the rule that search reaches every screen,
  action and record type. Left: the four tracks; the people tasks in the guide's §1.2.
- 16/10/2026 · TB · The bell on the real API, one of the nine M0 modules: `notifications`
  (`GET /notifications` at 25 a page with a `status` filter, `/unread-count`, `/badges`, `POST
  /notifications/:id/read` and `/read-all`), the caller's own rows only. Badges count unread
  notifications per module the reader may open; a link is derived from the record and dropped when
  the reader cannot open its module. A read mark is recorded and pushed to the person's other tabs
  (`notification_read`). The shell's bell and the mock moved onto the contract: Open marks a notice
  read, and a notice with no screen has Mark Read. Fixed: `password-reset.html` and `user-invite.html`
  were empty, so every Forgot Password, invitation and reset link failed in the worker after the
  screen said it was sent; both are written, and a test fails any declared email without a template.
  Left: preferences and web push (M6, #74); badges count notifications only, so mail and tasks add
  their own counts when built; audit, settings, workflow, documents and imports routes.
- 16/10/2026 · TB · Two-step sign-in, passkeys and the PIN built (`docs/guides/identity.md` §3, §6),
  reversing "drop WebAuthn for now" (REUSE_MAP §1.1, MILESTONES §5 and §14 amended, DATABASE_SCHEMA
  §4). Backend: migration `0220_sign_in_methods.sql` (the `mfa_*` and `pin_*` columns, `mfa_recovery_code`,
  `passkey`, `spent_challenge`, `pin_totp` sessions); the `security` module (RFC 6238 codes on
  `node:crypto`, ten Argon2id recovery codes used once each, passkeys through `@simplewebauthn/server`
  with the fingerprint or face required, the four-digit PIN with the password's wait and a switch-off
  after 10 wrong in a row or 20 in 30 days, single-use tickets between steps, the 15-minute fresh
  sign-in window and `POST /security/confirm`); `/auth/two-step`, `/auth/pin`, `/auth/passkey`;
  Reset Two-Step on Settings · Users; `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` (default: the staff
  origin's host). Frontend: the code step and Use Passkey and Use PIN on the sign-in card, the lock
  screen's PIN, passkey and code, My Security's Two-Step Sign-In, PIN and Passkeys, Confirm It's You,
  `OtpField` `secret` and `onComplete`. Tests: unit, `tests/integration/security.test.js` on the
  real migrations with a software authenticator, and a browser run on the real API with Chromium's
  virtual authenticator. Left: passkeys on a real phone; enforcement by role (M9); the servers'
  `.env` may add the two WebAuthn lines (optional: the default is right).
- 16/10/2026 · TB · `create-admin --build-account --env=<name>` makes the implementation team's
  login with every employee field filled (JBS Praxis Implementation Team, known as JBS Praxis,
  consultant, remote, contract 09/10/2026 to 09/12/2026 at ₦1,850,000.00 a month, phone 0802 749 2738,
  address, next of kin, bank); only the email and password are typed, so neither is in the
  repository. Empty by design: worksite, managers, seats and `left_on`. `employee` gained
  `home_address` and `contract_ends_on` (`0210`); the contract now also takes `middle_name`,
  `preferred_name`, `personal_email` and the confirmation dates. Left: run it on staging and
  production (`docs/runbooks/first-accounts.md`).
- 16/10/2026 · GE · Mail host values in (`docs/runbooks/dns-and-mail.md` §4): `mycityapp.io`,
  465 and 993, 50 recipients an hour, 30 IMAP connections per IP, 30 mailboxes. System mail is now
  paced to the hourly limit (`services/mail/pace.js`, `MAIL_SEND_PER_HOUR`: production 40, staging
  10, required on servers); over it, jobs wait for a slot instead of failing. The env templates
  carry the values. Left: the SMTP password and `MAIL_SEND_PER_HOUR` in both `.env` files on the
  server; whether the 50 is per mailbox or per account; the IMAP limit is a rule for the Mailbox
  module (`mailbox.md` §6).
- 16/10/2026 · TB · Sign-in and sessions built (`docs/guides/identity.md`). Backend: migration
  `0200_identity_sessions.sql` and seed `0290_seed_roles_and_grants.sql` (the seven real roles with
  a home view and rank, and the grants matrix); `identity` (sign-in, refresh with rotation and reuse
  detection, sign-out, the device cookie and new-device notice, forgot, reset and invitation links
  through the outbox, change password, own sessions, the throttle instead of a lockout, the breach
  check), `access` (roles), `users` (Settings · Users) and the first `organisation` service code;
  contract schemas `identity`, `users`, `access`. Sessions last 2 hours, lock after 30 idle minutes,
  every token capped at the session's end, the refresh token in an HttpOnly cookie. Passwords are 8
  characters with mixed case, a number and a symbol. Frontend: the four-city sign-in screen
  (`CityShowcase`), Forgot, Reset and Welcome, the lock screen (`LockScreen`) with the session clock
  and cross-tab locking in `AuthProvider`, refreshes serialised across tabs in `createApi`, the app
  typed from `contract.gen.ts`. `organisation` writes the employee columns of `0110`. Fixed on the
  way: the rate limiters shared one counter. Left: two-step sign-in, passkeys and the PIN (the
  second sign-in PR); the notifications and search routes (the bell and
  ⌘K still on INTERIM types); the organisation routes, so the employee screens still use the mock;
  `create-admin` on staging and production for the operations lead and the build account
  (`docs/runbooks/first-accounts.md`).
- 16/10/2026 · TB · `docs/DATABASE_SCHEMA.md` rewritten as the database design: the M0 core and how a
  module attaches to it, each milestone's block, owner, tables as built and what it still owes (from
  the coverage audit), what is not built and why (passkeys per REUSE_MAP; nothing for M11), and the
  open decisions (payroll design, the role permission matrix, moving business choices out of seeds).
  M6 payroll is in scope (MILESTONES §11); the earlier "not modelled" note is withdrawn.
- 16/10/2026 · TB · The integration suite runs on the real migrations: `tests/integration/helpers/schema.js`
  rebuilds the schema with `migrate.js` and `fixtures/shared-layer.sql` is gone; CI now has PostgreSQL 16
  with pgvector and Redis, so the suite and gate 4's round trip run on every PR. `1100` lets the alerts
  code raise an alert with no trigger and returns `over_by` to two places. 82 of 82 integration tests
  pass. Left: the role permission matrix (M9), the staff-number counter after an import.
- 16/10/2026 · TB · M0 schema made to match the foundation code: `0100` lets the shared layer write
  what it writes (emit's empty diff, bell rows without a body, untitled uploads, 0-based import
  header rows, refused AI runs, the AI settings defaults); `0110` gives `employee` the contract's
  columns (`staff_number`, gender, date of birth, next of kin, bank, gross monthly, dotted line,
  vacant seats in `org_seat`) with checks equal to the contract's enums; `0120` indexes the 43
  unindexed M0 foreign keys; `0199` fixes `on_site`, adds employment types, makes Saturday
  09:00 to 15:00 (A22) and staff numbers `00001`. `migrate.js --down` now rolls back to empty; the
  health check reports the real head. Phone numbers abroad are accepted in international form.
  `0130` lets the error reporter record an error with no extra detail (it was silently lost).
  Left: `home_alert` (M1 block) and the integration suite on the real migrations (next PR); role
  permissions wait on a role matrix; the importer must advance the staff-number counter past
  imported IDs.
- 16/10/2026 · TB · Gate 6 built: `check/schema-drift.js` (every SQL string in `src/` and `scripts/` names only
  tables and columns the migrations create: qualified columns, INSERT column lists, UPDATE SET lists,
  dropped or unknown tables, a table created twice with different columns) and `check/contract-columns.js`
  (each contract file's `TABLES` names the table every object schema's keys are columns of, with a
  reason for any key that is not), over one catalogue read from the migrations (`check/lib/catalogue.js`,
  checked column for column against a migrated database). Run against the schema PR 25 merged,
  contract-columns reports the 12 employee mismatches. `CI_STRICT` is on: no gate can sit empty again.
  Left: nothing for gate 6; every new contract file declares its `TABLES`.
- 16/10/2026 · TB · Migration conventions written (`docs/MIGRATIONS.md`) after the audit of the PR 25
  schema, and A26 added (reference seeds hold only what the code cannot run without). Left: a
  fix-forward M0 file for the six columns the shared layer cannot write (`audit_ledger.changed_fields`,
  `notification.body`, `document.title`, `import_batch.header_row`, `ai_run` vendor and prompt,
  `home_alert.trigger`), the `0002` DOWN, the employee columns the contract and staff importer need,
  and the integration suite moved onto the real migrations.
- 16/10/2026 · GE · Alerts go to WhatsApp: one sender (`shared/observability/alert.js`) for errors,
  the backup, the restore drill and the uptime probe; `ALERT_WHATSAPP_URLS` holds one gateway link
  per person (CallMeBot, or TextMeBot), `ALERT_WEBHOOK_URL` stays for a Slack or Google Chat
  webhook. Messages cut to 900 characters, 5 per person per 10 minutes. Setup:
  `docs/runbooks/monitoring.md` §2. Left: each person's link, then the setting on the server and
  the repository secret.
- 16/10/2026 · GE · Operations built: `scripts/db/backup.sh` (nightly, both databases with the
  migration head and every table's row count read from the dump's own snapshot, media as
  hard-linked snapshots, 14 of each, offsite mirror over SSH into its own folder, alert on failure),
  `scripts/db/restore-drill.js` (newest nightly into a scratch database, exact counts demanded,
  timed, fails when the backup has stopped), `mycity-backup` and `mycity-restore-drill` services
  and timers installed by `provision.sh`, `ops/monitoring/uptime-probe.js` with
  `.github/workflows/uptime.yml` (every 10 minutes from GitHub: readiness, environment header,
  certificate days; alerts on change). Exercised in a copy of the server layout, including a dump
  taken under constant writes. Runbooks written: `backup-restore.md`, `incident.md`,
  `monitoring.md`, `add-a-module.md`. Left: re-run provisioning on the server to install them,
  the offsite host (`backup-restore.md` §2), the WhatsApp alert links in production's `.env` and as
  a repository secret; the M11 rehearsal in front of MyCity.
- 16/10/2026 · TB · RichTextField no longer touches a destroyed editor: TipTap's `useEditor` can
  destroy its first editor before the mount effect runs on a slow machine, and the draft sync then
  threw (gate 11 on CI). `syncDraft` skips a destroyed editor, with a test. Nothing left.
- 16/10/2026 · LA · Moved deterministic reference SQL to `seeds/reference/` while retaining CLAUDE.md's milestone blocks (`0099`, `1099`, and so on). `db:migrate` now interleaves both folders and the migration gates enforce unique numbers and milestone ownership across both. Payroll tables remain deferred; only shared numbering configuration required by the existing numbering contract is seeded. Left: create environment-specific staging people and transaction data through services.
- 15/10/2026 · LA · PostgreSQL 16 migrations and deterministic reference seeds added for M0 to M10, with the table catalogue and relationship map in `docs/DATABASE_SCHEMA.md`. Payroll schema is deliberately deferred pending the tax-reform contract; sanction fines remain standalone. Migration number, idempotency, reversibility and PostgreSQL 16 UP/DOWN/UP checks pass (the local check substituted the vector type because pgvector is not installed). Left: verify the unchanged pgvector statements where the extension is installed, then create environment-specific staging people and transaction data through services.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit) done, and with it the whole frontend foundation (`docs/FRONTEND_FOUNDATION.md` §4 and §6; the four questions answered in §5: one `sort` key with a per-list allow-list, both styling-exemption lists emptied and deleted, TipTap in a lazy chunk for rich text, the browser's own PDF viewer plus an image viewer with Open in Tab). `packages/ui` now holds 157 components: a Data group (DataView with the pager, server sort, selection, bulk actions and Export; Kanban to F19; Calendar), a Charts group (area, bar, donut, bands, sparkline, each its own lazy chunk, both palettes from the chart tokens), a Documents group (DocumentPreview, ImageViewer, Paper, Reader), a Maps group (MapView, PlaceSearch, LocationLabel on Leaflet with the tiles, the address search and the reverse lookup all proxied), the KPI pieces and the record display parts, and the pickers, the upload engine, SignatureField, RichTextField, VoiceField and Tick in Forms. The contract gained one `sort` key per list (a field name, a leading `-` for descending, allow-listed, a 422 naming `sort` otherwise) and `shared/http/paged.js` gained `orderBy()`, which builds the ORDER BY from the repo's own map so a caller picks a key and never a character of SQL. Both apps' `components/` folders are deleted, LEGACY and §7 are empty, and `styling-exemptions.json` is gone with its readers: 804 arbitrary values converged onto the named type, spacing, radius and leading scales, and the last 10 inline styles became shared components, because an app may not write `style` at all. The mailbox composer runs on the shared editor rather than its own `contentEditable` on the deprecated `execCommand`. The map's drawing holds no focus (Leaflet's keyboard panning, focusable markers, zoom control and Leaflet link are off; the zoom buttons are ours, outside the hidden part), a list's pages are a landmark named after that list, a board's stages are a screen's second level, and the file input sits out of the reading order behind the words a person presses. 663 tests green in the package, the whole `npm run ci` green. Left: the Geoapify proxy routes are backend work (attendance, worksites), so the map components run against the paths `maps/geoapify.ts` names; voice input waits on the M2 transcription route; screens adopt server sort as each module's contract names its sortable fields.
- 15/10/2026 · GE · Release pipeline built: `deploy-gate` (stage, seal, promote, rollback, status;
  each deploy key forced to its own commands), `release-manifest.js` (release tarball with
  `RELEASE`, `BUILD.env`, `SHA256SUMS`), `verify-staging.js`, `rollback.sh`, `release.yml` (build,
  staging, verify and seal, approval, promote, tag) and `rollback.yml`. Exercised end to end in a
  cloud copy of the server layout. Server fixes: the environment folder belongs to `mycity-deploy`,
  the units read the release's `BUILD.env`. Runbooks: `deploy.md`, `rollback.md`. Left: the
  one-time setup in `deploy.md` §1 (keys, GitHub environments), re-running provisioning, then the
  first release once DNS and mail are in; the checks waiting for modules (sign-in, RBAC, workflow,
  PDF, mail, Playwright); nightly backups (`backup.sh`, `restore-drill.js`).
- 15/10/2026 · GE · Server 108.181.196.53 (Ubuntu 24.04): `ops/provision/provision.sh` takes a fresh
  install to a ready server (Node 20, PostgreSQL 16 + pgvector, Redis, Chrome, ffmpeg, ClamAV,
  nginx + Let's Encrypt, firewall), with the two environments' users, databases, `.env` files and
  directories; the four systemd units, the nginx files and the deploy key template. Proxy is nginx
  from `ops/nginx/` (no hosting panel); processes run under systemd. Runbook:
  `docs/runbooks/server-setup.md`. Run once on the server the same day. Left: DNS for the four hosts
  (`docs/runbooks/dns-and-mail.md`), mail settings, then the release pipeline (`deploy-gate`, `release.yml`) for the first deploy.
- 15/10/2026 · TB · Frontend foundation PR 2 (Shell) done, to `docs/FRONTEND_FOUNDATION.md` §4 and §5 (four questions answered: the frame in `packages/ui`, the session sheet in place, the phone top bar, the install offer). `packages/ui` gains a Shell group (15 components) and one copy of the environment and the delivery plan. Staff app: desktop rail and top bar; phone top bar with the pin, search, bell and avatar over a title rail; bottom bar Home, Workspace, Community, Self-Service, More (F16); More as a launcher of the modules the `/me` grants allow (F17); the floating button with the screen's New action, Clock In or Out, Praxis AI, Help and Hide Here (F18); ⌘K search; the bell on Socket.io; sign-in, sign-out and the in-place session sheet; update, install and offline in the PWA. Both apps open screens by F14: production at API, UI and Mobile, staging at API, the Prototype View switch only on the mock. Public site on PublicPage, ComingSoon and the staging bar. `/gallery/` on the staff host everywhere but production. The a11y gate now crawls all 86 app screens at both sizes and they pass; `npm run new:screen` adds a screen to the catalogue, route map, module, PROGRESS and the gates at once. Left: PR 3 (Build kit); screens adopt `useScreenAction` as they are touched; presence needs M1 chat; the release pipeline must carry `packages/ui/dist-gallery`.
- 15/10/2026 · TB · Frontend foundation PR 1 (Ground) done, to `docs/FRONTEND_FOUNDATION.md` (decisions F1 to F24). `packages/ui` (`@mycity/ui`) is the one design system for both apps: tokens, density and motion, 87 components (primitives, overlays, help, toast, the form system, the shared data client), the generated catalogue `docs/COMPONENTS.md`, `npm run new:component` and the gallery (`npm run gallery`). Both apps import every Ground part from `@mycity/ui`; the app copies are deleted and FRONTEND_FOUNDATION §7 lists what PR 2 and PR 3 still move. Merged with the screen conventions work: its screens and copy stay, and `@mycity/ui` takes its API (`useContractForm(initial, rules or schema)`, `Button busy`, `Wizard`, `CardHeader help`). New gates: components, palette, contrast, native dialogs, upload, mock-free, a11y, frontend typecheck, lint, test and build; gates 8 and 11 crawl the gallery and every app screen. Left: PR 2 (Shell) and PR 3 (Build kit).
- 15/10/2026 · AJ · Screen conventions in the staff app (FRONTEND_GUIDE §5, §7, §8): gates 8 and 11 now crawl all 86 app screens at phone and desktop size (the build writes `dist/screens.json`; `scripts/check/lib/screens.js` builds and serves the demo app, CI installs `app/`), and both pass. `HelpTerm` and `Details` replace the ⓘ toggle; about 60 explainer cards, footnotes and long captions are gone; titles are Title Case and within the word limits; `Table` is a card list on a phone; controls are 44 px on a phone. Forms: `useContractForm` on react-hook-form, the §8.6 names, `FormFooter`, `Wizard` (seven long forms), `PhoneField`, `CheckboxField`, the Optional tag; Submit is never disabled. Left for this item: the contract client (waits on `contract.gen.ts`), Lucide icons and the illustration set (§5.5), and crawling as Staff and the CEO.
- 15/10/2026 · GE · CI gates, first group. Gate 3 migration numbers (unique across `migrations/`
  and `seeds/reference/`, in the milestone's block), gate 4 reversibility (a DOWN or `-- IRREVERSIBLE:
  <reason>`, DOWN names what UP creates, `-- DESTRUCTIVE: <reason>` on destructive steps, and UP,
  DOWN, UP on a throwaway database when RUN_DB_TESTS=1), gate 5 idempotency (and a merged migration
  never edited, by git), gate 17's backend half widened to packages/ and AI prompts, gate 15 day-first dates
  (backend formats only through `shared/time`), gate 20 money, and the guards: module catalogue,
  production environment references, shell scripts LF and parse, every JavaScript file parses.
  `migrate.js`: four digits through M9 and five from M10, with schema and reference-seed steps
  ordered together; `--down` refuses an
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
- 15/10/2026 · AJ · `npm run contract:status` (in `app/`, FRONTEND_GUIDE §9.1): reports, for both apps, which modules still run on INTERIM types and which are ready to move to `contract.gen.ts`. Today 19 INTERIM files, 317 endpoints, none in the contract yet.
- 15/10/2026 · AJ · Delivery plan in both apps (FRONTEND_GUIDE §9.2): production shows Coming Soon for any screen whose row here is not fully ticked, with its milestone and date from this file and MILESTONES §4 (the public site hides both from visitors); development, the demo build and staging get the demo's "Prototype View" switch: Full Design, or As Delivered at the current milestone (the earliest not past its demo day and not fully ticked; M1 today). This file is now read by the frontend build, so the table format (backticked slug, M column, three tick columns) must hold.
- 15/10/2026 · AJ · Both apps pass gate 12 (`scripts/check/forms.js`): every field, the `<form>` and the field components moved to `components/form/` (FRONTEND_GUIDE §8.6, §9.4), imported from `@/components/form`; screens no longer write a raw form element; placeholders are short examples, with any instruction moved to the field's ⓘ. Left for the screen-conventions PR: the §8.6 names, `useContractForm` on `react-hook-form`, and Submit never disabled.
- 15/10/2026 · AJ · Staging bar in both apps (MILESTONES §6): shown on a `staging.` host or when the API answers `X-Mycity-Environment: staging`; fixed above everything in `app/`, sticky in `public-app/`. Production renders nothing. The tab icon becomes the pin on amber (`favicon-staging.svg`) and the browser bar takes the staging amber (`theme-color`). Left from §6: the installed staff app's home-screen icon and splash colour come from the PWA manifest, which is fixed at build; varying them needs `src/http/static.js` to serve a staging manifest on `hub.staging` (GE).
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
  process and rendering a PDF through it. Left: phase 6 (AI and search); M0 migrations and reference seed 0001 to 0099
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
- 14/10/2026 · TB · Screen gates built: gate 8 (three tiers of screen text, word limits, Title Case),
  gate 11 (phone and desktop shells), gate 12 (one form system), gate 17 (no dashes in copy). They
  render demo.html at 390 and 1440 px in Chromium and will read `app/` once it has a build.
  MILESTONES gates 8, 11 and 12 amended; guide template §10 now lists content tiers and the phone
  layout. Every demo module now passes all four. Left: the crawler blind spots listed in PR #16.
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
| 14 | My Documents | `my-documents` | M1 | TB | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 87 | Work Location Requests | `work-location-requests` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 88 | My Devices | `my-devices` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 89 | Policy Updates | `policy-updates` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 90 | My Security | `my-security` | M1 | AJ | ☑ | ☑ | ☑ | Built | 16/10/2026 |
| 91 | Org Chart | `org-chart` | M1 | TB | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 17/10/2026 · TB · ESS · Org Chart (#91) on the real API, read only for every member of staff:
  the whole company from one bounded read (`GET /api/v1/org-chart`, 2,000 nodes), open seats drawn as
  vacant, dotted lines tagged, no restricted field on any card. On a phone it starts on the signed-in
  person as a focus view. Built with People · Organogram (#92) from `docs/guides/organogram.md`.

- 17/10/2026 · TB · My Documents (#14) built on the real API (M0, track B): the Vault list is what is
  held and what People have asked for in one paged list, the counts come from
  `GET /ess/documents/summary`, a row opens its details with Download, a missing row opens Upload
  Document, and the preview is the chosen document itself. Desktop and phone. The hard-coded contract
  and the "Your vault" subtitle are gone (`docs/guides/ess.md` §10). Left: the other ESS tabs, with
  their milestones.
- 16/10/2026 · TB · My Security (#90) built: Two-Step Sign-In (set up from a QR code or the key, on
  with the first code, ten recovery codes shown once, Ask for a Code every sign-in, once a day or once
  a month, New Codes, Change App, Turn Off), Passkeys (Add Passkey on this device, rename, remove;
  the fingerprint or face on a phone), the PIN (Set, Change, Remove; weak PINs and the birthday
  refused), Recent Sign-Ins with the Method. Past the window, adding or removing a way in asks Confirm
  It's You (password, PIN or passkey). Desktop and phone. Left: passkeys on a real phone.
- 16/10/2026 · TB · My Security (#90) on the real API: Password (Change Password with the contract's rule), Signed In with Sign Out per device and Sign Out Others, Recent Sign-Ins, Clock-In Devices; desktop and phone. In progress until two-step sign-in, passkeys and the PIN arrive with the security module (the second sign-in PR); no ticks until then.
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
| 15 | Channels | `channels` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 16 | Direct Messages | `direct-messages` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 17 | Announcements | `announcements` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 17/10/2026 · GE · #announcements has no composer (announcements come only from the tab; the server refuses a plain post there, People and the CEO included) and a lock on its row. The Announcements tab's figures come from the server (`GET /community/announcements/stats`): Audience is the active staff an all-staff announcement reaches, where it read 0 until one was published; the other figures were counted from the first page only. Polls sit on the sender's side up to 560 px as in the demo; announcements read as a feed on the left. Ctrl+Enter (Cmd+Enter) starts a new line on desktop too. Left: nothing.
- 17/10/2026 · GE · Each person pins up to 3 channels or conversations for themselves (migration 1140; ⋮ Pin to Top, Unpin; under #general and #announcements, which stay pinned for everyone). Muted and pinned rows show a bell and a pin. Fixed: a muted channel always read as unmuted (pg returns 'infinity' as Infinity), so it could not be unmuted from the screen; notifications were correctly held back throughout. Messages and announcements keep their line breaks, and the composer is a box that grows (Enter sends and Shift+Enter is a new line on desktop; on a phone Enter is a new line). Left: nothing.
- 17/10/2026 · GE · Scheduled announcements can be edited or cancelled until they go out (migration 1130; the release now checks the announcement is still scheduled and due). Channel admins are chosen in Edit Members (Make Admin, Remove Admin; a channel keeps one). Messages carry a ⋮: Edit your text for 15 minutes, Edit a poll before its first vote, Close Poll, Delete by the author or a moderator (channel admins; People and the CEO in #general and #announcements), "Message deleted" in place, a deleted recognition leaves the counts. Polls in #general and hand-posted celebrations are for moderators; recognition stays open to all (A19). A conversation with yourself is named You. The people pickers leave you out except New Message. Sheets opened from a conversation on a phone now sit above it (the open conversation was layered over every sheet). Left: nothing new.
- 17/10/2026 · GE · Backend built: contract (`community.js`, `announcements.js`), migration 1110, the `community` and `announcements` modules (channels, members, messages, uploads, voice notes, polls, reactions, transcripts, direct messages with sent, delivered and read ticks, presence, profile card, recognition always to #general per A19, announcements with audience, scheduling, reads and reminders), the 05:00 celebrations job, the announcement release job and its safety net, ⌘K for announcements, the AI read manifest; unit tests and an integration suite on the real migrations. AJ's screens moved onto the contract and the mock rewritten in its shapes; voice notes record and upload in channels too; search steps between matches; Edit Members, Mute and the copy in §10 done. Walked on the live API on a laptop, desktop and phone, two people: announcement, text, a recorded voice note, a direct message with its read ticks arriving over the socket, presence; the dev server now proxies the socket too. A new `GET /community/people` lets every member of staff pick a colleague (the staff register needs People). Left: the Average Read help term needs StatStrip to take one; the Knowledge Hub (M10) needs its own read route for announcements, as `/community/announcements` is for People and the CEO.
- 15/10/2026 · AJ · Frontend built in `app/src/features/community/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/community.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 13/10/2026 · GE · Demo updated per the 12 October meeting (guides removed, ＋ menu, members behind ⋮, fixed
  composer, read-only pinned #announcements, birthday and recognition cards, Praxis-style DMs with
  voice notes, mobile full screen). Engineering guide `docs/guides/community.md` written. No product code yet.

### Mailbox

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 18 | Inbox | `inbox` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 19 | Sent | `sent` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 20 | Drafts | `drafts` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 21 | Archive | `archive` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 22 | Spam | `spam` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 23 | Trash | `trash` | M1 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 17/10/2026 · GE · ⌘K now finds a person's own mail by subject, address or sender name, pinned to the caller so the CEO and People find nobody else's; a result opens the conversation in any folder. Connecting uses `mycityapp.io` as the mail host, the certificate's name, instead of `mail.mycityapp.io`. Virus scanning checked against a real clamd with a local test signature (the signature download is blocked here): an inbound attachment carrying the EICAR string stays in quarantine marked infected, a clean one is released. Left: the real host and clamd's real signatures on staging; disconnecting a leaver needs a deactivation event.
- 17/10/2026 · GE · Built on the real API: contract `mailbox.js`, migration 1120 (connection status, folder kinds and UID cursor, thread keys, `mail_draft`, `mail_send_queue`), the `mailbox` module (IMAP and SMTP provider, autodiscover to `mail.<domain>` on 993 and 465, threading by References, sanitised HTML in and out, send queue with Bcc in the envelope only, a copy to the server's Sent, deferrals retried three times, paced to 50 an hour), `mail-sync` and `mail-send` jobs, IMAP IDLE in the worker, `mailbox.updated` over the socket. Screens on the contract: the Connect sheet opens over Mailbox ("Password refused" on the field), Reconnect banner, scheduled mail in Drafts with Cancel Schedule, field errors in the composer, Discard with buttons only. Unit tests and an integration suite on a fake provider; checked against a real Dovecot IMAP server and an SMTP relay (15 of 15), then walked on a laptop and a phone: connect, sync with an attachment, reply, Sent, the reply arriving in the other person's inbox. Empty stubs deleted. Left: the real `mycityapp.io` host (Namecheap) is untested; disconnecting a leaver needs a deactivation event; ⌘K inside mail needs an owner-scoped provider.
- 15/10/2026 · AJ · Frontend built in `app/src/features/mailbox/` against the in-browser mock API (INTERIM shapes in `app/src/api/types/mailbox.ts`), desktop and phone, checked against demo.html. No ticks: UI is ticked once the screens run on the real API. Left: the backend endpoints and contract, then swap the INTERIM types for `contract.gen.ts`.
- 13/10/2026 · GE · Demo composer added (rich text, recipient chips, attachments with progress, schedule,
  inline discard), reader full screen on mobile. Engineering guide `docs/guides/mailbox.md` written.

### People

| # | Screen | Tab | M | Owner | API | UI | Mobile | Status | Updated |
|---|---|---|---|---|---|---|---|---|---|
| 24 | Employees | `employees` | M0 | TB | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 25 | Attendance | `attendance` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 26 | Leave | `leave` | M1 | AJ | ☐ | ☐ | ☐ | Not started | |
| 27 | Devices | `devices` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 28 | Worksites | `worksites` | M1 | LA | ☐ | ☐ | ☐ | Not started | |
| 92 | Organogram | `organogram` | M1 | TB | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 17/10/2026 · TB · ⌘K finds an employee by their work phone, typed any way (0803 123 4567,
  +234 803 123 4567, the last four digits), as `docs/guides/foundation.md` §6.7 promised: a `phones`
  option on search providers compares the digits. Masked numbers (personal, next of kin) are never
  searched. Left: nothing.
- 17/10/2026 · TB · People · Employees (#24) and People · Organogram (#92) on the real API, with
  ESS · Org Chart (#91): the register lists 25 a page with search, the department, status and work
  pattern filters and the server's own sort, each row opening the record; Add Employee and Edit are
  the contract's `EmployeeCreate` and `EmployeeUpdate`, Archive asks why and Restore brings a record
  back, Send Invite gives a person a login, and Import Staff opens Settings · Imports on the
  employees importer (track B builds that screen, so the link lands on Settings until it does). The
  record has Profile, Job, Reporting Line, Login and History as tabs; a field the viewer may not see
  shows Restricted behind a help term. Change Manager sets a person or an open seat, with a dotted
  line beside it. The organogram draws people and open seats from one bounded read, drag moves a
  card (desktop), Add Role adds a seat, and the legend carries the two help terms; on a phone it is
  the focus view the guide asks for (Reports To, the person, Direct Reports, tap to refocus, Show Me
  or Show Top). The in-browser mock answers the contract's shapes, sort included. Left: the
  Documents tab (track B); Attendance Today and the attendance and location modal come back to the
  register with LA's attendance API (`app/src/features/people/EmployeeDetails.tsx` holds them and
  nothing links to it until then); PDF export on the chart.

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
| 69 | Organisation | `organisation` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 70 | Users | `users` | M9 | GE | ☑ | ☑ | ☑ | Built | 16/10/2026 |
| 71 | Roles & Permissions | `roles-and-permissions` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 72 | Approvals | `approvals` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 73 | Attendance Policy | `attendance-policy` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 74 | Notifications | `notifications` | M6 | LA | ☐ | ☐ | ☐ | Not started | |
| 75 | Appearance | `appearance` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 76 | Documents & Numbering | `documents-and-numbering` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 77 | Integrations | `integrations` | M9 | GE | ☐ | ☐ | ☐ | Not started | |
| 78 | Security | `security` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 79 | Audit Log | `audit-log` | M9 | GE | ☑ | ☑ | ☑ | Built | 17/10/2026 |
| 93 | Imports | `imports` | M0 | TB | ☑ | ☑ | ☑ | Built | 17/10/2026 |

**Notes**

- 17/10/2026 · TB · Approvals (#72) built on the real API, track D of `docs/guides/foundation.md`: the
  flows (25 a page, with search), their KPIs (Flows, Open Requests, Overdue, Needs Fixing), a flow's
  route and stages in a side panel, and Edit Stages: change a stage's approver, when it applies and its
  time limit, add, remove and reorder stages, Save Stages as the next version (open requests keep
  theirs; a stale version is refused). Desktop table and side panel; phone cards and full sheets. Left:
  `3099`'s consequence flow shows Needs Fixing until M3 seeds a valid one.
- 17/10/2026 · TB · Organisation (#69): Nigeria's public holidays for 2026 and 2027 are seeded
  (`seeds/reference/0448`, 33 days): the eight the Public Holidays Act fixes as Declared, and the
  Eids and the weekday given for a weekend holiday as Expected (`0410`), confirmed or moved on the
  card with Confirm Holiday. Left: 2028's list, in a later seed or a yearly job.
- 17/10/2026 · TB · Organisation (#69), Roles & Permissions (#71), Documents & Numbering (#76),
  Security (#78) and Audit Log (#79) built on the real API, track C of `docs/guides/foundation.md`,
  desktop and phone; the mock follows the same paths and contract shapes. Organisation: the company
  profile, public holidays by year and the working week (Monday to Friday 09:00 to 17:00, Saturday
  09:00 to 15:00). Roles: the role list and matrix, a role's modules with actions and scope,
  sensitive fields and capabilities, New Role and Delete Role. Numbering: every scheme with its next
  number, editable. Security: session minutes, idle lock and password minimum within the server's
  floor, two-step by role, everyone's sessions with End Session, failed sign-ins. Audit Log:
  filters, entries with their changes (Restricted where masked), Export by email. Left: no document
  setting other than numbering is specified for #76; the organisation profile is empty until
  entered on staging and production; Integrations, Appearance and Notifications stay Coming Soon;
  Attendance Policy (#73) is LA's.
- 17/10/2026 · TB · Imports (#93) built on the real API, track B of `docs/guides/foundation.md`: the
  wizard (Upload, Map, Preview with the rows that have problems, Commit, with Blank Sheet, the new
  values to tick and Commit Valid Rows) over ANY registered importer, opened with `?importer=<key>`;
  and the history, every batch with its counts, Download Errors and Revert. Desktop and phone. The
  screen knows nothing about what is being imported: the columns and choices come from
  `GET /imports/importers`. The staff importer itself is track A's. Left: the mock cannot carry a
  sheet, so the wizard in a mock build says so and stops at Upload.
- 16/10/2026 · TB · Users (#70): Reset Two-Step in a login's sheet (confirm, then the fresh-sign-in
  check; the person is signed out everywhere, told, and sets two-step up again from My Security), and
  a Two-Step column on desktop.
- 16/10/2026 · TB · Users (#70) built on the real API, the lean screen agreed with TB: counts, status chips, the paged list, Users by Role, Invite User, and per login Save Roles, Resend Invitation, Send Reset Link, Sign Out Everywhere, Suspend with a reason, Reactivate; desktop and phone. The roles picker reads `GET /access/roles`. Left for M9: the role editor on the real API (Roles & Permissions is still on the mock).
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

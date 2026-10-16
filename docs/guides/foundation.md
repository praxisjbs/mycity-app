# Foundation Completion · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 |
| Backend modules | `organisation`, `access`, `audit`, `settings`, `workflow`, `documents`, `imports` |
| Frontend paths | `app/src/features/people/`, `app/src/features/settings/`, `app/src/shell/Search.tsx` |
| Permission key(s) | `people`, `settings`, `ess` (own records) |
| Screens (PROGRESS.md rows) | #24, #14, #91, #92, #69, #71, #72, #76, #78, #79, and the M0 items |
| Status | Agreed |
| Last changed | 16/10/2026 |

Sources: MILESTONES §5 (M0 scope and definition of done); BACKEND_STRUCTURE §4 (workflow), §5
(documents), §9 (import engine and the staff importer), §11, §13 (M0 definition of done), §16
(pagination), §17 (create-admin); `docs/guides/identity.md` (sign-in, Users, security); and
`docs/guides/organogram.md` (Organogram and Org Chart, which this guide schedules but does not
restate). Twenty decisions taken by TB on 16/10/2026 are in §6; they are binding for this work.

GE owns the "Nine M0 modules" row; TB claimed the modules below on 16/10/2026 and told GE. Every PR
from this guide names GE as reviewer.

---

## 1 · What it is for

M0 is not finished. Sign-in, sessions, two-step, passkeys, the PIN, Users and the bell are built
(`identity`, `security`, `users`, `notifications`). What is left is everything else the foundation
promises: the people data and its import, the settings every module reads, roles and permissions
that can be changed on screen, the audit log, the approvals engine's routes, documents through the
vault, and search that reaches every screen and record. When this guide is built, MyCity's real
staff are in the system on staging and production with their roles and logins (not yet invited),
and every foundation screen runs on the real API.

### 1.1 Four tracks

The work is split into four tracks, each one PR, each run from its own prompt in a new chat. Each
track owns the files listed; a track that needs another's file asks in its PR rather than editing it.

| Track | Builds | Owns | Migration block | Seed file |
|---|---|---|---|---|
| **A · People** | `organisation` (departments, employees, reporting lines, seats, employee 360), the staff importer `employee.import.js`, People · Employees (#24) full register, Org Chart (#91) and Organogram (#92) to `organogram.md`, the real staff roster load on staging and production, the staging demonstration seed | `src/modules/organisation/`, `seeds/staff/`, `seeds/staging/`, `scripts/db/seed.js`, the deploy step that loads the roster, `app/src/features/people/`, `app/src/features/organogram/` | `0300` to `0349` | `seeds/reference/0349_*` |
| **B · Imports and documents** | `imports` (the generic API over any registered importer, the Import wizard and Imports history as Settings · Imports, opened with `?importer=<key>`), `documents` (gated upload, download, versions), ESS · My Documents (#14), the Documents tab on an employee's record | `src/modules/imports/`, `src/modules/documents/`, `app/src/features/imports/`, the My Documents tab, the employee record's Documents tab (added after A merges) | `0350` to `0399` | `seeds/reference/0399_*` |
| **C · Access, settings, audit** | `access` (roles and grants editing, field visibility, capabilities), `settings` (organisation profile, working week, holidays, numbering, editable security rules), `audit` (read, filter, export) and their Settings screens: Organisation (#69), Roles & Permissions (#71), Documents & Numbering (#76), Security (#78), Audit Log (#79) | `src/modules/access/`, `src/modules/settings/`, `src/modules/audit/`, `app/src/features/settings/` (except Users and Approvals) | `0400` to `0449` | `seeds/reference/0449_*` |
| **D · Workflow and search** | `workflow` routes (my approvals, decide, withdraw), Settings · Approvals (#72) designer, the leave approval definition; ⌘K search over screens, actions, people, logins and departments; the search coverage gate | `src/modules/workflow/`, `src/shared/search/` route and providers, `app/src/shell/Search.tsx`, the Approvals screen, `scripts/check/search-coverage.js` | `0450` to `0499` | `seeds/reference/0499_*` |

**Running them in parallel.** A, B and C can run at the same time. D can run at the same time too,
but merges last: its gate checks every screen and record type the other three add. A owns the
staff importer and registers it with the import engine; B's wizard and history work with any
registered importer, so the two meet only at the engine (`shared/import`), which exists. People ·
Employees' Import Staff opens B's wizard at Settings · Imports with `?importer=employees`. Shared files (`docs/PROGRESS.md`, `README.MD`,
`packages/contract/contract.gen.ts`, `src/shared/route-map.js`) conflict on merge: merge `main` in,
keep both sides of PROGRESS and README, regenerate `contract.gen.ts` with `npm run gen:contract`,
never hand-merge it.

### 1.2 Not code: what people do

These finish M0 and no prompt can do them:

- TB: the `staging` environment's `STAGING_SSH_KEY` secret (the whole private file, `-----BEGIN` to
  `-----END`) and `PROD_SSH_KEY` (`docs/runbooks/deploy.md` §1); every release since PR 29 stopped
  there.
- TB or GE: the SMTP password and `MAIL_SEND_PER_HOUR` (staging 10, production 40) in both server
  `.env` files; DKIM, SPF and DMARC Valid in cPanel (`docs/runbooks/dns-and-mail.md`).
- TB: `create-admin --build-account --env=staging`, then the same on production after GE approves the
  production step (`docs/runbooks/first-accounts.md`).
- GE: the offsite backup host and the WhatsApp alert links (`docs/runbooks/backup-restore.md`,
  `monitoring.md`); GitHub branch protection (`github-settings.md`).

## 2 · Screens affected

| Screen | Where | Who | Track | Today | After |
|---|---|---|---|---|---|
| People · Employees (#24) | Staff app | `people` view; add, edit, archive with create, edit, delete | A | Mock | Real API: list at 25 with search and filters, the employee's record with tabs, Add, Edit, Archive, Send Invite, Import Staff |
| Employee record (360) | People · Employees, opened from a row | `people` view, field masks apply | A | Mock | Profile, job, reporting line, documents, login, history on the real API |
| Org Chart (#91), Organogram (#92) | ESS and People | Everyone (Org Chart); `people` edit (Organogram) | A | Mock | As `organogram.md` describes, on the real API |
| Settings · Imports (new screen: the wizard and history) | Settings; Import Staff on People · Employees opens it | The importer's permission (`people` create for staff); history `settings` view | B | None | Upload, map, preview with errors, commit, revert; every batch with its counts, error file and Revert |
| ESS · My Documents (#14) | ESS | The person (own) | B | Mock | Their documents, upload where allowed, download |
| Settings · Organisation (#69) | Settings | `settings` view, edit | C | Mock | Organisation profile, working week, holidays |
| Settings · Roles & Permissions (#71) | Settings | `settings` edit | C | Mock | Roles, the grants matrix, field visibility, capabilities, editable |
| Settings · Documents & Numbering (#76) | Settings | `settings` edit | C | Mock | Numbering schemes and document settings |
| Settings · Security (#78) | Settings | `settings` edit | C | Mock | Session and password rules, required two-step by role, failed sign-ins, sessions |
| Settings · Audit Log (#79) | Settings | `settings` view with scope all, the CEO | C | Mock | Filtered log at 25, export |
| Settings · Approvals (#72) | Settings | `settings` edit | D | Mock | Every approval flow and its stages, editable as new versions |
| ⌘K Search | Everywhere | Everyone, by permission | D | Mock (INTERIM) | Screens, actions, employees, logins, departments; each later module adds its own |
| Settings · Integrations (#77), Appearance (#75), Notifications (#74), Attendance Policy (#73) | Settings | | none | Mock | Coming Soon (#74 is M6; #73 is LA's attendance) |

## 3 · How the screens relate

1. **The roster.** Each deploy loads `seeds/staff/` through the staff importer (track A runs it
   and owns the importer): new people become employees with a staff number, department, line
   manager (or a vacant seat), and a login in the invited state with their roles. Nobody is emailed.
   People · Employees then lists them, and Settings · Users shows them as Invited.
2. **Inviting.** Operations & People press Send Invite on an employee or a login, one
   person or all at once; `identity` sends the invitation.
3. **Import Staff.** Later staff, or a corrected sheet, go through the Import wizard on Employees.
   Every batch appears in Imports history, where its error file can be downloaded and the batch
   reverted.
4. **Roles and permissions.** A change on Roles & Permissions clears the grants cache, so the next
   request and `/auth/me` see it; the rail and More follow `/me`.
5. **Settings read by modules.** The working week and holidays feed attendance and leave; numbering
   schemes feed every numbered record; security rules feed sign-in and sessions.
6. **Approvals.** Settings · Approvals edits a flow as a new version; Leave (M1) opens a request on
   the leave flow; approvers see it in their approvals and act; Home shows a Waiting on You count
   when Home's API lands.
7. **Audit.** Every write in every module lands in the Audit Log through `emit()`.
8. **Search.** ⌘K reads every provider: screens and actions from the route map and the screen
   catalogue, records from each module's `.search.js`.

## 4 · Data

Every table below exists; the tracks add columns or rows only where the code needs them, in their
own migration block (§1.1), to every rule in `docs/MIGRATIONS.md`.

| Table | Migration | Track | Notes |
|---|---|---|---|
| `department`, `employee`, `org_seat`, `reporting_line` | 0040, 0110, 0210 | A | Employees carry every column of 0110 and 0210; vacant seats are `org_seat` rows |
| `app_user`, `user_role` | 0010, 0020, 0200 | A | Roster logins: `password_hash = '!invited'`, roles from `seeds/staff/roles.json` |
| `import_batch`, `import_row`, `import_mapping_profile` | 0085 | B | BACKEND_STRUCTURE §9.3 |
| `document`, document versions | 0080 | B | Through the vault and upload engine only |
| `role`, `permission`, `field_visibility`, `capability`, `user_capability` | 0020, 0290 | C | Defaults for field visibility and capabilities in `0449` (§6.3) |
| `setting` rows, working week, holidays, numbering schemes | 0050, 0055, 0099 | C | Security rules become settings rows with an `.env` floor (§6.4) |
| `audit_ledger`, `event_log` | 0030 | C | Read only |
| `workflow_definition`, `workflow_instance`, `workflow_decision` | 0070 | D | The leave definition in `0499` |

The staff roster is not a reference seed. A26 still holds: `seeds/reference/` carries no people.
The roster lives in `seeds/staff/` and loads through the import engine (§6.1).

## 5 · API

The screens already call these paths on the in-browser mock (`app/src/api/mock/modules/`). Build the
backend to them, or change the screen and the mock in the same PR; never leave the two apart.
Every list pages at 25 through `shared/http/paged.js`. Every route has a contract in
`packages/contract/schemas/<module>.js` with `TABLES`.

**Track A · `organisation`**

| Route | Permission |
|---|---|
| `GET /employees` (search, department, status, work pattern, employment type; sort) | `people` view |
| `GET /employees/summary` | `people` view |
| `GET /employees/:id` (the 360: profile, job, reporting line, login, documents, history; masked per viewer) | `people` view |
| `POST /employees`, `PATCH /employees/:id`, `POST /employees/:id/archive`, `POST /employees/:id/restore` | `people` create, edit, delete |
| `PATCH /employees/:id/line-manager` (a person or a vacant seat; dotted line) | `people` edit |
| `GET /departments`, `POST /departments`, `PATCH /departments/:id` | `people` view, create, edit |
| `GET /org-chart` (the whole tree, §6.6) | `ess` view |
| Organogram routes as `organogram.md` §5 | `people` edit |

`organisation.service.importRow(client, values, ctx)` is the one write the staff importer calls:
create or update by `staff_number` or `work_email`, returning `{ action: "create" | "update" | "none",
target_id, before }`. Track A builds both; the roster loader runs the same importer.

**Track B · `imports` and `documents`**: BACKEND_STRUCTURE §9.3 exactly (`GET /imports/importers`,
`/importers/:key/template`, `POST /imports`, `PUT /imports/:id/mapping`, `POST /imports/:id/preview`,
`/commit`, `/revert`, `GET /imports/:id/rows`, `/report`, `GET /imports`); documents: upload, download,
versions (BACKEND_STRUCTURE §5); `GET /ess/documents`, `POST /ess/documents` (own records);
`GET /employees/:id/documents`, `POST /employees/:id/documents` (`people`).

**Track C · `access`, `settings`, `audit`**: the mock's `GET/PATCH /settings/organisation`;
`GET /settings/roles`, `/roles/catalogue`, `/roles/matrix`, `/roles/:id`, `POST /settings/roles`,
`PUT /settings/roles/:id`, `DELETE /settings/roles/:id`; `GET /settings/numbering`,
`/numbering/summary` and edits; `GET/PATCH /settings/security`, `/security/failed-logins`,
`/security/sessions`, `POST /security/sessions/:id/end`; working week and holidays; `GET /audit`,
`/audit/summary`, export.

**Track D · `workflow` and search**: `GET /workflow/mine` (waiting on me), `/workflow/mine/count`,
`GET /workflow/instances/:id`, `POST /workflow/instances/:id/approve`, `/reject`,
`/request-changes`, `/withdraw`; `GET /settings/approvals`, `/approvals/summary`,
`PUT /settings/approvals/:id/steps` (saves a new version); `GET /search` (25 a page, grouped).

## 6 · Rules and calculations

### 6.1 The staff roster (TB, 16/10/2026)

- The repository is private (TB, 16/10/2026), so the roster is committed: track A adds
  `seeds/staff/staff-list.xlsx` (MyCity's staff sheet as TB gives it in that chat) and
  `seeds/staff/roles.json` (each person's roles, the CEO flag, and the work email of the Operations
  & People Lead, which the sheet lacks; TB gives it in that chat). The sheet holds 18 people and 2 vacant seats (Head
  Sales & Revenue, Technical Assistant), with Staff ID, name, designation, team, gender, joining
  date, date of birth, line manager, email, phone, employment type, work arrangement, work hours and
  bank name.
- **It loads by itself on staging and production.** No person runs a command. Each deploy, after
  migrations, the loader runs the staff importer over the sheet (track A: the importer, the loader
  and the deploy step) as the system actor, then applies `roles.json`. It is idempotent: a person
  already present (matched by staff number, then work email) is left as the app has them, so an edit
  made on screen is never overwritten; a new row in the sheet is added. A row that fails is reported
  in the deploy log and the batch in Imports history, and does not stop the deploy.
- **This overrules "production is never seeded" for the real staff only** (TB, 16/10/2026).
  Demonstration data still never reaches production. CLAUDE.md says so.
- Each person gets a complete employee record, a login in the invited state and their roles. **No
  email is sent**: Send Invite (one or all) does that, later.
- Roles (`roles.json`): the CEO flag and Management for the CEO; Management for the Program Manager
  and the CTO, who is also System Administrator; Operations & People for the Operations & People
  Lead; Head of Department for the Head of PR, Marketing and Brand Strategy; Line Manager for the
  Back-end Manager; Staff for everyone else.
- Line managers come from the sheet's Line Manager column: a name, a title ("<first name> - Head PR &
  Marketing", "Program Manager", "CEO"), or a vacant post with a dotted line ("Head Sales & Revenue,
  with dotted line to Head PR & Marketing": the vacant seat as line manager, the Head of PR as the
  dotted manager). The mapping from those texts to people and seats is written once, tested, and
  shown in the import preview.
- FTE is `full_time`; Remote and Hybrid are `remote` and `hybrid`. The working hours column (Monday
  to Friday 09:00 to 17:00, Saturday 09:00 to 15:00) is the organisation's working week (A22), set by
  track C, not per person.
- A person with no staff ID gets one from `numbering.allocate()`.

### 6.2 Staging demonstration data

`seeds/staging/` loads the mock's records (F13) through each module's service, for every module that
has a backend, so numbers, audit and events are right. The people are the real staff, never the
mock's. Each later module adds its own staging seed when its routes land. Production never runs it.

### 6.3 Field visibility and capabilities (defaults, editable)

Salary, bank and personal details are visible to Operations & People, Management, Implementation and
the CEO; everyone sees their own. Announcements and alert clearing go to the same roles. All of it is
editable on Roles & Permissions; a change is a `security` event (the watchers are told).

### 6.4 Security rules editable within the floor

Session length, the idle lock, the password minimum and required two-step per role are settings,
edited on Settings · Security. The `.env` values are the floor: a setting can make a rule stricter,
never looser. Required two-step per role (brought forward from M9) makes the next sign-in of a person
in that role set it up. Every change is audited and the watchers are told.

### 6.5 Approvals designer

A flow's stages (approver, a condition on an amount or a number of days, a time limit) are edited as
a new version; open requests keep the version they started on. No drag-and-drop canvas. The leave
flow: line manager, then Operations & People when the request is over the number of days the flow
sets.

### 6.6 The org tree

Org Chart and Organogram read the whole tree in one `completeQuery()` with a ceiling of 2,000 people
and the `// pagination:complete` marker (BACKEND_STRUCTURE §16.3). Vacant seats are part of it.

### 6.7 Search reaches everything

⌘K finds screens (with synonyms), actions (Add Employee, Import Staff, Invite, Clock In, Request
Leave, Change Password, Set PIN, Mark All Read, and each screen's New action), employees (name,
staff number, work email, phone), logins, departments, and the records of every later module,
each by the reader's permissions, 25 a page grouped by kind. **Every new screen, action and record
type must be searchable**: the search coverage gate (track D) fails a screen in the route map, an
entity type in `ENTITY_ROUTES` or a screen's New action that search cannot reach, unless it carries
a written `search:none <reason>`. CLAUDE.md says so.

### 6.8 Settings screens not in this guide

Integrations (#77), Appearance (#75) and Notifications (#74, M6) stay Coming Soon. Attendance Policy
(#73) belongs to LA's attendance work.

## 7 · Events, jobs and notifications

| Event | Track | Follow-on |
|---|---|---|
| `employee.created`, `employee.updated`, `employee.archived`, `employee.restored`, `employee.reporting_line_changed`, `department.*` | A | Search reindex; the team cache version (`grants-cache`) on a reporting change |
| `import_batch.committed`, `import_batch.reverted` | B | The person who ran it is told |
| `document.uploaded`, `document.version_added` | B | Scan and derive (existing jobs) |
| `role.*`, `permission.changed`, `field_visibility.changed`, `capability.changed`, `settings.security_changed` | C | `security: true`: the watchers are told; the grants cache cleared |
| `settings.changed` (organisation, working week, holidays, numbering) | C | Audit only |
| The engine's own events (`workflow.*`) | D | Approvers told when a stage starts; the requester when decided |

## 8 · Permissions and visibility by role

- `people`: Employees, the 360 and the Organogram, by scope (`all`, `team`, `own`).
- `settings`: every Settings screen; the Audit Log needs scope `all` (and the CEO passes).
- `ess` own: My Documents and the Org Chart.
- Field masks (`shared/rbac/field-mask.js`) apply to every response, export, import preview and AI
  read: salary, bank and personal details per §6.3.
- The roster loader and the deploy step act as the system, never as a person.

## 9 · AI and search

Each module ships a read manifest (`<module>.ai.js`) or `// ai:none <reason>`: employees and
departments (A), import history (B), roles and settings (C, reads only), my approvals (D). Search
providers: `organisation.search.js` (employees, departments; A), `users.search.js` (exists), screens
and actions (D), and the gate in §6.7.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| People · Employees | Staff list: name, staff number, job title, department, line manager, work pattern, status, login; Add Employee, Import Staff, filters | Help term on Invited: has a login, not yet signed in | How the roster loads on deploy: §6.1 here |
| Employee record | Profile, job, reporting line, login state with Send Invite, documents, history; Edit, Archive | Masked fields show Restricted with a help term naming who may see them | Field mask rules: §6.3, §8 |
| Import Staff | Steps Upload, Map, Preview, Commit; counts to create, update, skip, errors; Download Errors, Revert | Help term on Unchanged | The two-pass manager matching: §6.1, BACKEND_STRUCTURE §9.4 |
| Settings · Roles & Permissions | Roles, the grants matrix, field visibility, capabilities; Save | Help term on scope (all, team, own) | Grants cache and security events: §7 |
| Settings · Security | Session length, idle lock, password minimum, two-step by role, failed sign-ins, sessions; Save, End Session | Help term naming the floor a rule cannot go below | Why `.env` is the floor: §6.4 |
| Settings · Audit Log | Who, what, record, when, filters; Export | Restricted values masked with a help term | How `emit()` writes the ledger: BACKEND_STRUCTURE |
| Settings · Approvals | Flows, their stages, version; Edit Stages, Save | Help term on a stage condition | Versioning of open requests: §6.5 |
| ⌘K Search | Results grouped Screens, Actions, People, Logins, Departments | None | The coverage gate: §6.7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| People · Employees | Search, then employee cards (name, title, department, status pill) | Bulk actions, column choice | Add Employee in the floating button | More, People |
| Employee record | Profile card, then sections as tabs that scroll sideways | History detail | Send Invite or Edit, full width in a sheet | Back to the list |
| Import Staff | One step per sheet, counts as cards | The full row table (Download Errors instead) | Commit, full width | From Employees |
| Settings · Roles & Permissions | Role cards; a role opens its grants as grouped toggles | The full matrix grid | Save, full width | More, Settings |
| Settings · Audit Log | Entry cards: who, what, when | Export | Filter in a sheet | More, Settings |
| ⌘K Search | Full-screen search with grouped results | None | Tap a result | The search bar in More and the top bar |

## 11 · Edge cases

- A sheet row whose line manager is a title held by nobody: the vacant seat with that title, or an
  error on the row, never a guess.
- A person removed from the sheet: nothing happens; archiving is a person's decision on screen.
- A person edited on screen, then the deploy runs: the screen's version stays.
- Two people with the same name: matched by staff number or email, never by name alone.
- A role removed from a person on screen: the next deploy does not add it back (roles apply only when
  the login is created).
- An approver who leaves: open stages keep their resolved approvers; Operations & People can
  reassign (D).
- A security rule set looser than the floor: refused with the floor named.
- A search provider that throws: its group is left out and logged; the rest answer.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/security/{permission,scope,capability,field_visibility}` | Roles and grants editing (C); no tenant |
| praxis-ls | `src/modules/notification/` pattern of a self-scoped module | Already followed by `notifications` |
| pixie-girl-hub | `src/workflows/` | Already ported into `shared/workflow`; D adds the routes and designer |
| REUSE_MAP | the import engine and the staff importer rows | Already ported into `shared/import`; B adds the API, wizard and importer |

## 13 · Open questions

- The leave flow's day threshold for the second stage: Operations & People decide on screen; the
  seed sets 5 days until they do.
- Home's Waiting on You card: D provides the count; Home wires it when its API lands (TB, M1).
- The sign-in screen's drawings or licensed photographs: TB (`identity.md` §13).

## 14 · Change log

- 16/10/2026 · TB · The staff importer moved to track A with the roster loader, so A and B meet only
  at the import engine; Settings · Imports holds the wizard and history.
- 16/10/2026 · TB · First version: the remaining M0 and foundation work in four tracks, with TB's
  twenty decisions of 16/10/2026 (§6); the staff sheet and role map go into `seeds/staff/` with
  track A, the repository being private.

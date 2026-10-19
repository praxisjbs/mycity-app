# Foundation Completion · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 |
| Backend modules | `organisation`, `access`, `audit`, `settings`, `workflow`, `documents`, `imports` |
| Frontend paths | `app/src/features/people/`, `app/src/features/settings/`, `app/src/shell/Search.tsx` |
| Permission key(s) | `people`, `settings`, `ess` (own records) |
| Capabilities | none of its own; `access` holds the convention and the catalogue, and Settings · Roles & Permissions gives every module's (§6.3) |
| Screens (PROGRESS.md rows) | #24, #14, #91, #92, #69, #71, #72, #76, #78, #79, and the M0 items |
| Status | Agreed |
| Last changed | 19/10/2026 |

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
| People · Employees (#24) | Staff app | `people` view; add, edit, archive with create, edit, delete | A | **Built** (17/10/2026) | Real API: list at 25 with search, filters and server sort, the record with tabs, Add, Edit, Archive, Restore, Send Invite, Import Staff |
| Employee record (360) | People · Employees, opened from a row | `people` view, field masks apply | A | **Built** (17/10/2026) | Profile, job, reporting line, login and history on the real API; the Documents tab is track B's, on the `documents` module that has landed |
| Org Chart (#91), Organogram (#92) | ESS and People | Everyone (Org Chart); `people` edit (Organogram) | A | **Built** (17/10/2026) | As `organogram.md` describes, on the real API, with the phone focus view |
| Settings · Imports (#93, new screen) | Settings; Import Staff on People · Employees opens it | The importer's permission (`people` create for staff); history `settings` view | B | **Built** (17/10/2026) | Upload, map, preview with errors, commit, revert; every batch with its counts, error file and Revert |
| ESS · My Documents (#14) | ESS | The person (own) | B | **Built** (17/10/2026) | Their documents and the ones People asked for, upload, download, preview |
| Settings · Organisation (#69) | Settings | `settings` view, edit; holidays `settings` create, delete | C | **Built** (17/10/2026; brand files 19/10/2026, §6.11) | Organisation profile, the brand files (Logo, White Logo, Icon), working week, public holidays (Nigeria's seeded, the moon-dated and weekend ones Expected until confirmed; others entered on screen) |
| Settings · Roles & Permissions (#71) | Settings | `settings` view; edit, create, delete to change | C | **Built** (17/10/2026; redesigned 18/10/2026, §6.10) | Roles beside the role in view (desktop) or by level (phone), each module's access as one level with Approve and Export, review before save, who holds a role; the grants matrix as a second view; field visibility and capabilities per role |
| Settings · Documents & Numbering (#76) | Settings | `settings` view, edit | C | **Built** (17/10/2026) | Every numbering scheme with its next number, editable. No other document setting is specified yet |
| Settings · Security (#78) | Settings | `settings` view, edit | C | **Built** (17/10/2026) | Session length, idle lock, password minimum, two-step by role, failed sign-ins, everyone's sessions with End Session |
| Settings · Audit Log (#79) | Settings | `settings` view with scope all (export: `settings` export), the CEO | C | **Built** (17/10/2026) | The log at 25 with filters, the summary, Excel export by email, values masked per reader |
| Settings · Approvals (#72) | Settings | `settings` view; edit to change | D | **Built** (17/10/2026) | Every flow, its stages and version; Edit Stages saves a new version |
| ⌘K Search | Everywhere | Everyone, by permission | D | **Built** (17/10/2026) | Screens with synonyms, actions, and every module's records (employees, logins, departments, roles, numbering, holidays, approval flows, imports), 25 a group |
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
| `document`, document versions | 0080 | B | Through the vault and upload engine only. `0350` adds `verified_at` and `verified_by`: People accepting a file is a person's judgement, not the virus scan (§6.9) |
| `document_request` | 0350 | B | What People asked an employee for; a Missing row until it is given (§6.9) |
| `role`, `permission`, `field_visibility`, `capability`, `user_capability` | 0020, 0290 | C | Defaults for field visibility and capabilities in `0449` (§6.3). `0400` adds `role.two_step_required` (§6.4) |
| `role_capability` | 0400 | C | A capability given to everyone holding a role; `user_capability` still gives one to a single person, and a person has the union |
| `setting` rows, working week, holidays, numbering schemes | 0050, 0055, 0099 | C | The organisation profile is `organisation.<field>` rows, the three brand files among them as `organisation.logo_document_id`, `organisation.logo_white_document_id` and `organisation.icon_document_id` (§6.11), read by everything that prints the company through one reader, `shared/organisation/profile.js` (until 19/10/2026 documents and system mail read a single `organisation.profile` row that nothing wrote, so they always printed the defaults); security rules are `security.<rule>` rows with an `.env` floor (§6.4). Nigeria's public holidays for 2026 and 2027 are seeded by `0448`; `0410` adds `public_holiday.expected` for the Eids and the weekday given for a weekend holiday, until someone confirms them (TB, 17/10/2026). The Report Run scheme (`report_run`, RPT-0001, never reset) is seeded by `1199` (TB, 17/10/2026); the Work Location Request scheme (`location_request`, WLR-0001, never reset) by `1392` and the Field Assignment scheme (`field_assignment`, FA-0001, never reset) by `1393` (LA, 19/10/2026) |
| `audit_ledger`, `event_log` | 0030 | C | Read only. `0400` adds the indexes the Audit Log filters on (when, module, action, record) and one on live sessions |
| `spent_challenge` | 0230 | C | `0400` widens its purpose check with `two_step_setup`, the ticket of the set-up step at sign-in (§6.4) |
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

`organisation.service.counts(client, scope, { today })` gives headcount, attrition over 90 days and
confirmations due in the next 30, counted as `GET /employees/summary` counts them and from the Lagos
date it is given (`lagos.today()` when none is), never the database's `current_date`. Home's cards read
them through it, so the two screens share one definition.

`organisation.service.importRow(client, values, ctx)` is the one write the staff importer calls:
create or update by `staff_number` or `work_email`, returning `{ action: "create" | "update" | "none",
target_id, before }`. Track A builds both; the roster loader runs the same importer.

**Track B · `imports` and `documents`** (built 17/10/2026)

| Route | Permission |
|---|---|
| `GET /imports/importers`, `/importers/:key/template` | the importer's own (`people` create for staff), checked in the service |
| `POST /imports`, `PUT /imports/:id/mapping`, `POST /imports/:id/preview`, `/commit`, `/revert` | the same |
| `GET /imports/:id`, `/imports/:id/rows`, `/imports/:id/report` | the importer's own, or `settings` view |
| `GET /imports` (history) | `settings` view |
| `POST /documents` (a file before the record that will hold it) | a session; it belongs to the uploader |
| `GET /documents/:id`, `/content`, `/variant/:kind`, `/versions` | `vault.canRead` per document; a document the caller may not read is a 404 |
| `POST /documents/:id/versions` | the same, and the document must not be locked |
| `POST /documents/:id/verify` | `people` edit |
| `GET /employees/:id/documents`, `/documents/summary` | `people` view, within scope |
| `POST /employees/:id/documents`, `/employees/:id/document-requests` | `people` edit |
| `GET /ess/documents`, `/ess/documents/summary`, `POST /ess/documents` | the caller's own record |

Beyond BACKEND_STRUCTURE §9.3's list, the wizard also reads `GET /imports/:id`, so a batch survives a
reload; the two `/summary` routes carry the counts above a Vault list, which a page of 25 cannot; and
`POST /documents` is the upload field's own endpoint, for a voice note or a photograph that has no
record yet. The import routes are `self` at the edge because the permission is the importer's and the
importer arrives in the request: `engine.assertMay()` makes the real check and refuses with a 403.
The `documents` module mounts at the API root, because an employee's documents are read where the
employee is (`/employees/:id/documents`) while `src/modules/organisation/` is track A's.

**Track C · `access`, `settings`, `audit`** (built 17/10/2026)

| Route | Permission |
|---|---|
| `GET /settings/organisation`, `PATCH /settings/organisation` | `settings` view, edit |
| `POST /settings/organisation/brand/:slot` (multipart `file`, purpose `brand`; `slot` is `logo`, `logo_white` or `icon`) → `DocumentRef`; `DELETE /settings/organisation/brand/:slot` → `Organisation` | `settings` edit |
| `GET /settings/working-week`, `PUT /settings/working-week` (all seven days at once) | `settings` view, edit |
| `GET /settings/holidays` (year; sort), `POST /settings/holidays`, `PATCH /settings/holidays/:id`, `DELETE /settings/holidays/:id` | `settings` view, create, edit, delete |
| `GET /settings/roles` (search; sort), `/roles/catalogue`, `/roles/matrix`, `/roles/:id` | `settings` view |
| `POST /settings/roles`, `PUT /settings/roles/:id`, `DELETE /settings/roles/:id` | `settings` create, edit, delete |
| `GET /settings/numbering` (search; sort), `/numbering/summary`, `PUT /settings/numbering/:doc_type` | `settings` view, edit |
| `GET /settings/security`, `PATCH /settings/security` | `settings` view, edit |
| `GET /settings/security/failed-logins` (days; sort), `/security/sessions` (search; sort), `POST /settings/security/sessions/:id/end` | `settings` view, edit |
| `GET /audit` (module, action, actor, record, dates; search; sort), `/audit/summary` | `settings` view with scope all, or the CEO |
| `POST /audit/exports` (the same filters; the workbook is emailed) | `settings` export with scope all, or the CEO |
| `POST /auth/two-step/setup`, `POST /auth/two-step/enrol` (anonymous, the set-up ticket) | none; `identity.md` §5 |

`PUT /settings/roles/:id` replaces a role's grants, visible fields and capabilities together, so the
matrix, the masks and the capabilities cannot disagree half way through a save. The role picker on
Users keeps `GET /access/roles`.

**Track D · `workflow` and search** (built 17/10/2026)

| Route | Permission |
|---|---|
| `GET /workflow/mine` (waiting on me; `module_key` filter), `/workflow/mine/count` (`waiting`, `overdue`) | the caller's own: the requests whose current stage names them, in modules where they hold `approve` |
| `GET /workflow/instances/:id` (the route, the decisions, `can_decide`, `can_withdraw`, `can_reassign`) | whoever opened it, the employee it is about, the people its stage names, anyone who decided on it, or `view` on its module within scope; anyone else a 404 |
| `POST /workflow/instances/:id/approve` (optional note), `/reject`, `/request-changes` (a reason, required) | named on the current stage, and `approve` on the request's module (§8) |
| `POST /workflow/instances/:id/withdraw` | the requester, or the CEO |
| `POST /workflow/instances/:id/reassign` (one login and a reason) | `approve` with scope `all` on the request's module (§11) |
| `GET /settings/approvals` (the active version of each flow, 25 a page), `/approvals/summary` | `settings` view |
| `PUT /settings/approvals/:id/steps` (`:id` is the version on screen; saves the next version) | `settings` edit |
| `GET /search` (`q`, `page`, `type` to page one group) | everyone signed in; each group by the reader's own grants |

The `workflow` module mounts at the API root, because its halves live under `/workflow` and
`/settings/approvals`. `GET /search` lives in a module of its own, `search`, because routes are found
only under `src/modules/`; the work is `shared/search`.

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
- **A post the sheet does not hold** can be given its line manager in `roles.json`, in the same
  words as the sheet's Line Manager column: the Implementation Partner (the build account, which
  `create-admin` makes before any roster) reports to the CTO (TB, 19/10/2026). The loader gives that
  line on every run, only while the person has none, so a manager set on screen stays.
- Line managers come from the sheet's Line Manager column: a name, a title ("<first name> - Head PR &
  Marketing", "Program Manager", "CEO"), or a vacant post with a dotted line ("Head Sales & Revenue,
  with dotted line to Head PR & Marketing": the vacant seat as line manager, the Head of PR as the
  dotted manager). The mapping from those texts to people and seats is written once, tested, and
  shown in the import preview. A VACANT row's Line Manager is the seat's own line: the importer
  gives it to the seat (the roster only while the seat has none), so the sheet places an open post
  as it places a person. MyCity's sheet names both (TB, 19/10/2026): Head Sales & Revenue under the
  Program Manager, Technical Assistant under the CEO.
- **The sheet was corrected on 19/10/2026 (TB).** Aaron Agama's team is Sales & Marketing (the
  sheet said Marketing, a department of one); Markerting is Marketing in three titles; Operations&
  People Lead is Operations & People Lead, and its `roles.json` key with it; two work emails had a
  mistyped domain (gheil.com and gpril.com, for gmail.com). A person already loaded is never written
  over, so staging takes these on screen (`docs/runbooks/staff-roster.md` §6).
- FTE is `full_time`; Remote and Hybrid are `remote` and `hybrid`. The working hours column (Monday
  to Friday 09:00 to 17:00, Saturday 09:00 to 15:00) is the organisation's working week (A22), set by
  track C, not per person.
- A person with no staff ID gets one from `numbering.allocate()`, and the counter is moved past
  every number the sheet brought (`numbering.advanceTo()`), so the next person added on screen
  cannot be given one that is taken.
- **A column the whole sheet gets wrong is not imported**, and the deploy log says why. MyCity's own
  sheet holds a day and month with no year under DOB, and the same placeholder under Phone, in every
  row: mapping either would fail every row instead of loading the person. A column with one good
  cell among bad ones is imported, and its bad cells are row problems as usual. Work Hours and S/N
  are not fields of a person at all (the working week is one organisation setting, A22).
- The loader asks the import engine for things no person asks for, as batch options: **keep what
  the app already has** (an existing person is left exactly as People hold them, and the reporting
  line is filled only where it is empty), **the work email `roles.json` gives a post** whose
  sheet cell is blank, and **the sheet's claim on its own staff numbers**. The Import wizard sets
  none of them.
- **A staff number the sheet gives one of its people belongs to them.** The first administrator is
  created before any roster and is given 00001, which the sheet says is the CEO's. A number held by
  somebody the sheet does not name is taken back: that person moves to the next free number from
  `numbering.allocate()`, keeping their record, their login and their roles, and the person the
  sheet names is created on the number it gives them. Two things are never moved: a holder the same
  sheet also names (a sheet that gives one number to two people is wrong, not authoritative, and the
  row is reported), and a person already here under another number. A holder with the row's own
  first and last name is not somebody else: it is the same person, whose work email the sheet now
  spells differently (a corrected domain), and the row is theirs, so nobody moves and no second
  record is made (TB, 19/10/2026). Importing a sheet by hand moves
  nobody: a taken staff number is a problem on the row, as it is on the Add Employee form. Reverting
  such a batch archives the people it created but leaves the holder on the number they moved to; a
  number is given back on screen, not by a revert.
- **A deploy that changes no file changes no record.** The loader keeps the sheet's checksum on its
  batch; a later deploy with the same sheet checks the logins and stops. A corrected sheet loads
  again, adding what is new and leaving the rest alone.

### 6.2 Staging demonstration data

`seeds/staging/` loads the mock's records (F13) through each module's service, for every module that
has a backend, so numbers, audit and events are right. The people are the real staff, never the
mock's. Each later module adds its own staging seed when its routes land. Production never runs it.

- `10_staff.js`: the staff roster (§6.1).
- `30_leave.js`: the mock's twelve sample leave requests on the real staff, through the leave
  service (`seeds/lib/leave-sample.js`, shared with the laptop seed `seeds/build/20_mock_data.js`).

### 6.3 Field visibility and capabilities (defaults, editable)

Salary, bank and personal details are visible to Operations & People, Management, Implementation and
the CEO; everyone sees their own. All of it, and who holds each capability, is editable on Roles &
Permissions; a change is a `security` event (the watchers are told).

`0449` seeds the fields: a `field_visibility` row for every role and each of the four field keys
(`employee.salary`, `.bank`, `.personal`, `.statutory`), visible for the three roles and masked for
the rest. Roles add up: a field is masked for a person only when every role they hold masks it, and
a missing row reads as visible. The CEO is never masked. A new role starts with every field masked
and no capability.

**Capabilities are a convention every module follows** (TB, 17/10/2026; README §5.2 is the rule and
the table of every capability, BACKEND_GUIDE §5 the steps). A capability is a named authority inside
a module that its six actions cannot express: everyone views Home, only managers see its Team tab.

- **Code** `<area>.<authority>`, two lower_snake segments, the area being the module key or a named
  part of it (`home.team`, `alerts.clear`). `RoleSave` refuses any other shape, so a three-segment
  code could never be given on this screen.
- **Declared once**, in `src/shared/access/access.catalog.js` `CAPABILITY_CATALOG`, with its module,
  label and description; **seeded** by its milestone's reference seed, inserted only when absent,
  with the roles that hold it by default (`0449`: `announcements.post` and `alerts.clear` to
  Implementation, Operations & People and Management; `1199`: Home's `home.team`, `home.reports`,
  `alerts.manage`, and `alerts.clear` for Heads of Department and Line Managers; `1129`: Mailbox's
  `mailbox.signature` to System Administrator and Implementation, `docs/guides/mailbox.md` §8).
- **Held** through `role_capability` (edited here) or `user_capability` (one person, until an
  optional date). Roles add up: a person holds every capability any of their roles holds. The CEO
  holds every capability without a grant.
- **Checked** on the route after the module grant, `requirePermission(...)` then
  `requireCapability(code)` or `requireAnyCapability([...])`: the grant gives the record scope, the
  capability only says yes or no. `route()` refuses the other order and `middleware/rbac.js` an
  uncatalogued code, at boot.
- **Shown** on `/me` as `capabilities` (`identity.md` §5), which the shell's tab access
  (`app/src/shell/access.ts`) and ⌘K (`src/shared/search/screens.js`) both read.
- **Gated**: `scripts/check/capabilities.js` fails a code the code checks that the catalogue lacks, a
  catalogued code no reference seed inserts (this screen lists only the rows of `capability`, so
  nobody could be given it), and a seeded code the catalogue lacks.

### 6.4 Security rules editable within the floor

Session length, the idle lock, the password minimum and required two-step per role are settings,
edited on Settings · Security. The `.env` values are the floor: a setting can make a rule stricter,
never looser. Required two-step per role (brought forward from M9) makes the next sign-in of a person
in that role set it up. Every change is audited and the watchers are told.

| Rule | Setting | Floor (`.env`) | In force |
|---|---|---|---|
| Session length | `security.session_max_age_min` | `SESSION_MAX_AGE_MIN` | The shorter of the two |
| Idle lock | `security.idle_lock_min` | `SESSION_INACTIVITY_MIN` | The shorter of the two, and never longer than the session |
| Password minimum | `security.password_min_length` | `PASSWORD_MIN_LENGTH` (new, 8 by default) | The longer of the two; applies to the next password each person chooses |
| Two-step required | `role.two_step_required` | none | Any role a person holds that requires it |

A value past the floor is refused with the floor named (`RULE_BELOW_FLOOR`, 422). Each process reads
the rules at most every 30 seconds (`settings.security-rules.js`) and falls back to the floors if the
read fails, so a broken setting can never loosen a rule.

Required two-step: when the password or the PIN is right and the person's role requires two-step
that they have not set up, sign-in answers `{ step: "setup" }` with a 15-minute ticket instead of a
session. The sign-in card then shows the new key as a QR code, takes the app's first code
(`POST /auth/two-step/enrol`), shows the ten recovery codes once and opens the session. While a role
requires it, My Security has no Turn Off and the server refuses one (`TWO_STEP_REQUIRED`). A passkey
counts as both steps. A locked screen cannot run the set-up, so it asks the person to sign out and
sign in again. `identity.md` §3 and §8 carry the sign-in side.

### 6.5 Approvals designer

A flow's stages (approver, a condition on an amount or a number of days, a time limit) are edited as
a new version; open requests keep the version they started on. No drag-and-drop canvas. The leave
flow: line manager, then Operations & People when the request is over the number of days the flow
sets.

As built (17/10/2026):

- **The leave flow** is `leave.approval` (module `people`, context `days`), seeded in `0499` and in
  `shared/workflow/definitions.js` DEFAULTS: stage `line_manager` (the subject's line manager, 48 hours),
  then `operations_people` (the role, 48 hours) when `days > 5`. A subject who reports to a vacant
  seat goes to the first person above the seat (`employee_effective_manager`, organogram guide §6;
  TB, 19/10/2026); one with nobody above them goes to the CEO (the engine's rule). The leave module (M1, `src/modules/leave`) opens it with `{ days }`
  in the transaction that saves the request, and copies its outcome onto the request after commit
  (`docs/guides/ess.md` §6). People · Leave decides with the same approve and reject routes.
- **Editing** changes a stage's name, its approver (Line Manager, a role, one login, or the CEO), when
  it applies (Always, or one comparison on a number the flow carries: Over, At Least, Under, At Most,
  Exactly) and its time limit in hours; stages are added, removed and moved up or down. Save Stages
  writes the whole list as the next version. The flow's key, name, values and the timeout, approve and
  reject behaviour of each stage are the code's and are kept as they are.
- A save is refused when the version on screen is no longer the active one (409: someone saved first),
  when a stage names a role or a login that does not exist, or when the engine's rules refuse the
  route (422 naming the problem). Each save is the event `workflow.definition_saved`, so the Audit Log
  shows the stages before and after.
- A flow stored before the rules (`3099`'s `employee_consequence`) is listed with Needs Fixing, and
  saving it is refused until every stage is valid.
- **Who decides**: the people the current stage names, and only while they hold `approve` on the
  request's module; nobody decides their own request (the CEO excepted, who may decide any stage).

### 6.6 The org tree

Org Chart and Organogram read the whole tree in one `completeQuery()` with a ceiling of 2,000 people
and the `// pagination:complete` marker (BACKEND_STRUCTURE §16.3). Vacant seats are part of it.

Team scope (`shared/rbac/grants-cache.js`), the line-manager approver (`shared/workflow/approvers.js`),
the notifications that reach a person's managers (`shared/notifications/fanout.js`) and search's
"manages people" read the same tree through `employee_effective_manager`: someone under an empty
seat answers to the first person above it (TB, 19/10/2026). A seat's line or status changing bumps
the team cache as a person's line does. A loop is refused whether it runs through people or seats.

### 6.7 Search reaches everything

⌘K finds screens (with synonyms), actions (Add Employee, Import Staff, Invite, Clock In, Request
Leave, Change Password, Set PIN, Mark All Read, and each screen's New action), employees (name,
staff number, work email, phone), logins, departments, and the records of every later module,
each by the reader's permissions, 25 a page grouped by kind. **Every new screen, action and record
type must be searchable**: the search coverage gate (track D) fails a screen in the route map, an
entity type in `ENTITY_ROUTES` or a screen's New action that search cannot reach, unless it carries
a written `search:none <reason>`. CLAUDE.md says so.

As built (17/10/2026):

- `GET /search` answers in groups, each the first page of 25: **Screens** (every tab of the staff app by
  its name, its module or a synonym: "holiday" finds My Leave), **Actions** (Add Employee, Import Staff,
  Start Import, Invite User, New Role, New Holiday, Add Role, Clock In, Request Leave, Change Password,
  Set PIN, Mark All Read, Notification Settings, Turn On Notifications, Send Test Notification, Use
  Dark Theme, Use Light Theme, Change Density, Install App, Sign Out), then
  one group per kind of record from each `<module>.search.js` (Employees, Departments, Open Seats, Users,
  Roles, Numbering, Holidays, Approval Flows, Imports, and each later module's).
- **Waiting on You** comes first: the requests waiting on the reader's decision (the My Approvals list),
  shown with nothing typed and found by flow, subject or requester when typing. A result opens the record
  the request is about. Its provider answers an empty line (`empty`) and is placed first (`pinned`).
- Screens and actions forgive one slip in a word of four letters or more ("payslp" finds My Payslips),
  ranked after every exact match. Records already forgive typos through trigrams. With nothing typed it offers the screens and actions; `type`
  pages through one group.
- Employees are found by name (first, last, middle or preferred), staff number, work email, post or
  work phone; an open seat by its title or department, opening the Organogram focused on it. A term made of digits,
  spaces and + ( ) - (four digits or more) is compared with the phone digit for digit, a leading local
  0 dropped, so 0803 123 4567, +234 803 123 4567 and the last four digits find the same person
  (`phones` in `shared/search/provider.js`). Masked numbers (personal, next of kin) are never searched.
- A screen or an action is offered only when the shell would show its tab to the reader
  (`shared/search/screens.js` mirrors `app/src/shell/access.ts`; a Home tab the shell shows locked,
  ⌘K hides) and they hold the grant it needs. A
  record group runs only for a reader with `view` on its module, within their scope.
- A type word at either end of the line ("login halima", "staff ada") narrows the records to that
  type; the screens and actions are still matched on the whole line.
- An action opens its screen asked to start it: `?action=new` runs the screen's New action
  (`useScreenAction`), another word runs what the screen names with `useUrlAction` (`password`, `pin`),
  and `?importer=employees` opens the Import wizard. Clock In, Mark All Read and the three
  notification actions run in the app itself (`docs/guides/notifications.md` §9).
- **The gate** (`scripts/check/search-coverage.js`): every screen in the route map has a search entry
  whose label equals the shell's; every entity type in `ENTITY_ROUTES` is declared by a provider or its
  line carries `// search:none <reason>`; every `useScreenAction({ label })` in the app is an action in
  `shared/search/actions.js`. A type marked `not built yet (src/modules/<m>)` fails once that module has a
  controller and a repo, and a marker on a type a provider declares fails as stale. `npm run new:screen`
  adds the new screen's search entry.

### 6.8 Settings screens not in this guide

Integrations (#77), Appearance (#75) and Notifications (#74, M6) stay Coming Soon. Attendance Policy
(#73) belongs to LA's attendance work.

### 6.9 What a document's status means (TB, 17/10/2026)

One status per row of a Vault list, worked out from the record rather than stored, so nothing can
drift from the file:

| Status | When |
|---|---|
| Missing | People asked for it and it has not been given |
| Signed | The document is locked: signed, sent or filed, and it can never be replaced |
| Expiring | Its expiry is inside 60 days |
| Verified | People have looked at the file and accepted it |
| Awaiting Verification | Uploaded, not yet looked at |

Signed wins over Expiring, and Expiring over Verified, because the more urgent fact is the one a
person needs. **Verification is a person's judgement, not the virus scan**: `scan_status` says the
file is safe to open, never that the right document arrived, so `document.verified_at` is its own
column (migration `0350`). A request (`document_request`, the same migration) is cancelled, never
deleted, so the ask stays on the record.

### 6.10 Access levels on Roles & Permissions (TB, 18/10/2026)

The API keeps a grant as its six actions and a record scope (§5, `access.js`). The screen shows each
module's actions as one **level** plus two add-ons, and turns a level back into actions when it saves.
Nothing about levels is stored, so the matrix, the AI read and every permission check are unchanged.

| Level | Actions it stands for |
|---|---|
| No Access | none (the grant is left out of the save) |
| View | view |
| Add | view, create |
| Edit | view, create, edit |
| Full | view, create, edit, delete |

**Approve** and **Export** are separate switches beside the level, because the seeded roles hold them
apart from delete (Management may view and export Settings, a Line Manager approves People without
editing it). A grant whose actions fit no level (edit without create, say) reads **Custom** and keeps
its actions until a level is picked for it. Self-Service is always Own records (`own_only`).

The screen, decided with TB on 17 and 18/10/2026 from three drawn options for each shell:

- **Desktop: split view.** The roles on the left (paged at 25, searched by the server), the role in
  view on the right with Access, Details and People. A role opens read first; Edit Role turns each
  module row into its level, records and add-ons. Roles and Matrix switch at the page head; the
  matrix shows each cell as a level meter with its short level and letters.
- **Phone: by level.** A role opens full screen with its modules grouped Full, Edit, Add, View and
  No Access as chips. While editing, a chip opens a sheet to move the module to another level and set
  its records, Approve and Export. No matrix on a phone.
- **Letters.** Where space is short (phone chips, matrix cells) a module carries T (Team), O (Own),
  A (Approve) and X (Export); none means All records. Each letter is a help term (hover on desktop,
  tap on a phone), with a one-line key above the chips or the matrix.
- **Review before save.** Save Role (Create Role for a new one) first lists what the role gains,
  loses and changes per module, field and capability, and how many people it reaches.
- **Unsaved edits.** Choosing another role, switching to the matrix, starting a new role or leaving
  the screen asks once: Keep Editing or Discard Changes. Closing the tab asks through the browser.
- **New Role.** Step 1 in a modal: Role Name and Start From (an existing role, or Blank). The role
  then opens in place, editing, through Access, Details and Review, and ends on Create Role.
- **People.** Who holds the role, from `GET /users?role=`, 25 a page; roles are still given on
  Settings · Users. The role's summary (what it changes, reads and approves, and whether salary is
  masked) sits behind an ⓘ beside its name.

### 6.11 Brand files (TB, 19/10/2026)

Settings · Organisation holds the company's three brand files, each optional, each one upload
(purpose `brand`: PNG or WebP with a transparent background, at most 5 MB; the `brand` image profile
keeps it a PNG, never corrects its colours and fits it within 2000 px). Uploading one replaces it at
once (no Save) and Remove clears it; the old document stays in the vault, as every replaced file
does. What changes with each, from the next thing made:

| File | Where it goes | Until it is uploaded |
|---|---|---|
| Logo (City Green, for white paper) | Letterheads and every PDF `documents.generate` renders | `assets/brand/logo.png`, else the company's name set in the letterhead's own type |
| White Logo (for Deep Green) | The email signature's band (`docs/guides/mailbox.md` §3) and the header of system mail, both as an inline picture | The drawn pin with the company's name on the signature; the name in text on system mail |
| Icon (the pin) | The signature's band beside the company's name when there is no White Logo | The app's drawn pin |

The Icon is drawn on Deep Green, so it must read on a dark ground (the yellow pin does). The app's
own icons (the favicon, the home-screen icon) are files in the release, which phones keep, so they
change with a release, not with this screen.

## 7 · Events, jobs and notifications

| Event | Track | Follow-on |
|---|---|---|
| `employee.created`, `employee.updated`, `employee.archived`, `employee.restored`, `employee.reporting_line_changed`, `department.*` | A | Search reindex; the team cache version (`grants-cache`) on a reporting change |
| `import.committed`, `import.reverted` | B | The person who ran it is told (`imports.events.js`) |
| `document.stored`, `document.superseded` (the vault's own) | B | Scan and derive (existing jobs) |
| `document.requested` | B | The employee it is about is told; the notice opens My Documents |
| `document.verified`, `document.request_cancelled` | B | Audit only |
| `role.*`, `permission.changed`, `field_visibility.changed`, `capability.changed`, `settings.security_changed` | C | `security: true`: the watchers are told; the grants cache cleared |
| `settings.changed` (organisation, working week, holidays, numbering) | C | Audit only; the working week and holidays clear the calendar cache |
| `audit.export_requested` | C | `audit.send_export` builds the workbook of the whole filtered log (at most 10,000 entries, masked for the person who asked), files it in the vault and emails it to them |
| The engine's own events (`workflow.*`) | D | Approvers told when a stage starts; the requester when decided |
| `workflow.definition_saved` | D | Audit only (the stages before and after) |
| `workflow.reassigned` | D | The new approver is told; the stage's time limit starts again |

## 8 · Permissions and visibility by role

- `people`: Employees, the 360 and the Organogram, by scope (`all`, `team`, `own`).
- `settings`: every Settings screen; the Audit Log needs scope `all` (and the CEO passes).
- Nobody can save a role change that takes away their own Settings edit over everything
  (`LOCKOUT`); the CEO is exempt. A built-in role keeps its name and cannot be deleted; a role somebody
  holds cannot be deleted either.
- `ess` own: My Documents and the Org Chart.
- Approvals: a request is decided by the people its current stage names who also hold `approve` on its
  module (the CEO decides anywhere); a line manager named by the leave flow therefore needs `people`
  approve, which the Line Manager, Head of Department, Management and Operations & People roles hold.
  My Approvals lists only what the caller can decide.
- Field masks (`shared/rbac/field-mask.js`) apply to every response, export, import preview and AI
  read: salary, bank and personal details per §6.3.
- Capabilities (§6.3) sit on top of a module's grant, never instead of it; who holds each by default
  is README §5.2's table, and Roles & Permissions changes it.
- The roster loader and the deploy step act as the system, never as a person.

## 9 · AI and search

Each module ships a read manifest (`<module>.ai.js`) or `// ai:none <reason>`: employees and
departments (A), import history and the caller's own documents (B, `imports.ai.js` and `ess.ai.js`),
roles and settings (C, reads only: `access.ai.js` lists and opens roles; `settings.ai.js` reads
public holidays, the working week and the organisation profile with `ess` view, and numbering with
`settings` view), my approvals (D). `audit` carries `ai:none`: the ledger is for the people who hold
Settings over everything, and the assistant does not answer from it. `documents` carries `ai:none`: a document is a
file, and what it says about a person is read through that person's own module.

Search providers: `organisation.search.js` (employees, departments; A), `imports.search.js` (a batch
by its number or the file; B), `access.search.js` (roles by name or code) and `settings.search.js`
(numbering schemes by document, public holidays by name; C), `users.search.js` (exists), screens and
actions (D), and the gate in §6.7. `audit` carries `search:none`: entries are found on the Audit Log
with its filters, not one by one. `documents` and `ess` carry `search:none`: a document is found from the record it belongs to,
and who may open one is decided per document by the vault, which no single query can express.

## 10 · On screen and mobile

ESS · My Documents (#14) is track B's too; its rows are in `docs/guides/ess.md` §10, which owns the
screen.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| People · Employees | The counts (Headcount, Confirmed, On Probation, Attrition 90 Days) and the work-pattern strip; the staff list: name and job title, staff number, department, line manager, work pattern, status, login; Add Employee, Import Staff, search and the department, status and work pattern filters; Headcount by Department; Needs a Decision | Help term on Invited: has a login, not yet signed in | How the roster loads on deploy: §6.1 here. Attendance Today, which returns to the list with the attendance API (LA, M1) |
| Employee record | Profile, Job, Reporting Line, Login and History as tabs; the status, work pattern, manager and since chips; Edit Record, Archive Record or Restore Record, Send Invite, Change Manager | Masked fields show Restricted with a help term naming who may see them; a help term on Dotted line | Field mask rules: §6.3, §8 |
| Settings · Imports (#93) | History: Reference, Import, File, Who, When, Created, Updated, Problems, Status; Start Import. A batch opens its counts with Download Errors and Revert | Help term on Unchanged | Who may run an import, and the two-pass manager matching: §5, §6.1 |
| Settings · Imports, the wizard | Steps Upload, Map, Preview, Commit; Blank Sheet; counts Rows, To Create, To Update, Unchanged, Problems; the rows with problems and why, rows that will save with something missing (a Line Manager nobody holds) among them; new values to tick; Commit Valid Rows; Commit Import | Help term on Unchanged | That the preview is the commit rolled back: BACKEND_STRUCTURE §9.2 |
| Settings · Organisation (#69) | Company: legal and trading name, RC number, tax ID, address, phone, email, website, currency, time zone; Brand: Logo, White Logo (shown on Deep Green), Icon, each with its picture or an empty mark, Upload Logo, Upload White Logo, Upload Icon and Remove, toasts "Logo updated", "White logo updated", "Icon updated" and "Logo removed" (and the same for the other two); Public Holidays by year, each Declared or Expected; Working Week (day, hours, worked); Edit Profile, New Holiday, Edit Week; Confirm Holiday on an expected one | Help term on the Brand title: "PNG or WebP with a clear background. Signatures, letters and system mail use them at once." | Who reads the working week and holidays: §3; why some are Expected: §4; where each brand file goes: §6.11 |
| Settings · Roles & Permissions | Roles and Matrix; the roles (name, people, modules, record scope); a role's name, Built-In or Custom, people, modules and Home; Access (each module's level with Approve and Export, records), Details (purpose, Home, Sensitive Fields, Capabilities), People (who holds it, 25 a page); the matrix of every role by module with a level meter, its short level and letters; the letter key; Edit Role, Save Role, Create Role, Delete Role, New Role, Next, Back, Keep Editing, Discard Changes; the review: Gains, Loses, Changes and how many people it reaches | ⓘ Role Summary beside the role's name; help terms on Record Scope and on each letter T, O, A, X; Optional on the role's purpose | Grants cache and security events: §7; the lockout rule: §8; how levels map to actions: §6.10 |
| Settings · Documents & Numbering (#76) | Document Types, Numbers Issued, Reset Each Period; each document's next number, prefix, when it starts again, how many issued; a scheme opens prefix, digits, separator, reset, period and the next number it would give; Save Numbering | None | How numbers are allocated: BACKEND_STRUCTURE |
| Settings · Security | Signed In Now, Two-Step On, Failed Sign-Ins; session minutes, idle lock minutes, password minimum; two-step by role with how many have set it up; who is signed in where; failed sign-ins with the outcome; Save Rules, Undo Changes, End Session | Help term naming the floor a rule cannot go below; help on Two-Step by Role | Why `.env` is the floor: §6.4 |
| Settings · Audit Log | Today, This Week, This Month, Sensitive; who, what, record, module, when; Module and Dates filters, search; an entry opens its fields before and after with Open Record; Entries by Module; Export | Restricted values masked with a help term | How `emit()` writes the ledger: BACKEND_STRUCTURE |
| Settings · Approvals | Flows, Open Requests, Overdue, Needs Fixing; the flows (Flow, Stages, Version, Open Requests, Status); a flow's route and each stage's Approver, Applies When, Time Limit; Edit Stages, then per stage Move Up, Move Down, Edit, Remove, Add Stage, Save Stages; a stage's Stage Name, Approver, Role or Person, Applies When, Comparison and value, Time Limit, Hours | Help term on Applies When | Versioning of open requests, who decides: §6.5 |
| ⌘K Search | Results grouped Waiting on You (first, when anything waits), Screens, Actions, then each kind of record (Employees, Departments, Open Seats, Users, Roles, Numbering, Holidays, Approval Flows, Imports) | None | The coverage gate: §6.7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| People · Employees | Search, then employee cards (name, title, department, status pill) | Bulk actions, column choice | Add Employee in the floating button | More, People |
| Employee record | Profile card, then sections as tabs that scroll sideways | History detail | Send Invite or Edit, full width in a sheet | Back to the list |
| Settings · Imports (#93) | Import cards: reference, file, status pill | File, Who, Updated, Problems | Start Import in the floating button | More, Settings |
| Settings · Imports, the wizard | One step per sheet, counts as cards | The rows with problems (Download Errors instead) | Commit Import, full width | From Employees or Settings |
| Settings · Organisation (#69) | Company card, the Brand card (the three pictures in a row, each with its upload as a 44 px icon button and Remove under it), then holiday cards by year, then the week | None | New Holiday in the floating button | More, Settings |
| Settings · Roles & Permissions | Role cards; a role opens full screen with its modules as chips grouped by level, and a chip (while editing) opens a sheet with the level, records, Approve and Export | The Matrix view and its switch, the Record Scope column | New Role in the floating button; Edit Role, then Save Role, full width | More, Settings; Back closes the role |
| Settings · Documents & Numbering (#76) | Counts as cards, then document cards: next number, when it starts again | Prefix and Issued columns | A card opens its scheme in a sheet | More, Settings |
| Settings · Security | Counts as cards, the three rules, two-step by role as switches | Method and address of a session, the person and address of a failed sign-in | Save Rules, full width | More, Settings |
| Settings · Audit Log | Entry cards: who, what, when | Export, Entries by Module, the Module column | Filter in a sheet | More, Settings |
| Settings · Approvals | KPI cards two to a row, then flow cards (name, stages, version, open requests) | The Status column | Edit Stages in the flow's full sheet; Save Stages full width | More, Settings |
| ⌘K Search | Full-screen search with grouped results | None | Tap a result | The search bar in More and the top bar |

## 11 · Edge cases

- A sheet row whose line manager is a title held by nobody: the vacant seat with that title, or an
  error on the row, never a guess.
- A row whose Line Manager matches nobody: the person is saved without one and the row is a
  warning. The wizard's preview lists warnings with the errors, so it never says Every Row Is Fine
  over a person left at the top of the tree.
- A VACANT row with a Line Manager: the seat is given that line; the roster gives it only while the
  seat has none.
- A dotted line to someone the same sheet creates: set once every row is written, in the preview
  and the commit alike. Each run reads the dotted manager from the row's own Line Manager cell,
  never from an earlier run, whose ids a preview rolls back.
- A person removed from the sheet: nothing happens; archiving is a person's decision on screen.
- A person edited on screen, then the deploy runs: the screen's version stays.
- Two people with the same name: matched by staff number or email, never by name alone.
- A role removed from a person on screen: the next deploy does not add it back (roles apply only when
  the login is created).
- An approver who leaves: open stages keep their resolved approvers; Operations & People can
  reassign (D). Built 17/10/2026: `POST /workflow/instances/:id/reassign` gives the current stage to one
  login who holds `approve` on the module (never the requester), writes a `reassign` decision with the
  reason (`0450`), starts the time limit again and tells them.
- Two people editing one flow: the second save is refused (409) and they open it again.
- A security rule set looser than the floor: refused with the floor named. An idle lock longer than
  the session: refused, "Within the session length".
- A role change that would leave the person saving it without Settings: refused (`LOCKOUT`).
- A grant whose actions fit no level (§6.10): it reads Custom and is saved as it was unless a level is
  picked for it.
- Another role chosen, the matrix opened, New Role pressed or the screen left while a role has unsaved
  edits: asked once, Keep Editing or Discard Changes.
- Two public holidays on one date: refused, "Already a holiday".
- An expected holiday the Federal Government moves: open it, change the date, Confirm Holiday. One
  it does not declare at all: Delete Holiday. Attendance and leave count an expected holiday from
  the start, so a move changes the working days of leave already requested over it.
- A numbering scheme that starts again each year or month without the period in the number:
  refused, since numbers would repeat.
- Ending your own session from Settings · Security: refused; Sign Out does that.
- A role made to require two-step while one of its people is signed in: their session carries on;
  the next sign-in asks them to set it up.
- A search provider that throws: its group is left out and logged; the rest answer.
- A document asked for twice: two requests, two Missing rows. People cancel the one they do not want.
- An upload answering a request somebody already answered: refused, naming the document that arrived.
- A locked document (signed, sent, filed): it can never be replaced; a new version is refused.
- A file whose scan has not finished: reading it waits rather than serving an unchecked file.
- A sheet whose first row is the header: the header row is 0, which `0100` already allows.
- A brand file that is not PNG or WebP (a JPEG has no clear background, an SVG may carry script): refused
  with the types it takes. A very large one is fitted within 2000 px.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis-ls | `src/modules/security/{permission,scope,capability,field_visibility}` | Roles and grants editing (C); no tenant |
| praxis-ls | `src/modules/notification/` pattern of a self-scoped module | Already followed by `notifications` |
| pixie-girl-hub | `src/workflows/` | Already ported into `shared/workflow`; D adds the routes and designer |
| REUSE_MAP | the import engine and the staff importer rows | Already ported into `shared/import`; B adds the API, wizard and importer |

## 13 · Open questions

- Attendance Today on the register, and the attendance and location modal a row used to open: both
  wait on LA's attendance routes (M1). The screen pieces are kept in
  `app/src/features/people/EmployeeDetails.tsx` and nothing links to them until then.
- The leave flow's day threshold for the second stage: Operations & People decide on screen; the
  seed sets 5 days until they do.
- Home's Waiting on You card: D provides the count (`GET /workflow/mine/count`, built); Home wires it
  when its API lands (TB, M1).
- The sign-in screen's drawings or licensed photographs: TB (`identity.md` §13).

## 14 · Change log

- 19/10/2026 · TB · §6.7: ⌘K's actions gain Notification Settings, Turn On Notifications and Send
  Test Notification, run in the app like Mark All Read (`docs/guides/notifications.md`, web push
  brought forward from M6).
- 19/10/2026 · TB · §2, §4, §5, §6.3, §6.11, §10, §11: the brand files on Settings · Organisation
  (Logo, White Logo, Icon) and where each goes; one reader of the organisation profile
  (`shared/organisation/profile.js`) for settings, documents, system mail and signatures; the
  `mailbox.signature` capability seeded by `1129`.
- 19/10/2026 · LA · §4: Documents & Numbering gains Field Assignment (`field_assignment`, FA-0001,
  never reset), the number of each field assignment (`docs/guides/attendance.md` §6.12), seeded by
  `seeds/reference/1393`; the settings contract's `DOC_TYPES` and the screen's labels list it. The
  search provider's `scope` takes `through` for a record about several people (shared/search/provider.js).
- 19/10/2026 · LA · §4: Documents & Numbering gains Work Location Request (`location_request`,
  WLR-0001, never reset), the number of each work location request (`docs/guides/attendance.md`
  §6.11). Its scheme is seeded by `seeds/reference/1392`; the settings contract's `DOC_TYPES` and
  the screen's labels list it.
- 19/10/2026 · TB · §6.1, §6.5, §6.6, §10.1, §11, from a review of the roster as staging shows it.
  A VACANT row's Line Manager becomes the seat's line (the importer dropped it). `roles.json` can
  give a post outside the sheet its line manager (the Implementation Partner reports to the CTO).
  The sheet's corrections of 19/10/2026 are listed, and a row whose staff number is held by someone
  with its own name is that person (a corrected email no longer takes their number and makes a
  second record). Approvals, team scope and the notifications that
  follow it pass through a vacant seat to the first person above it, and loops through seats are
  refused. The import preview lists warning rows with the errors and counts them as problems. A
  preview's dotted lines no longer leak into its commit, and a link that writes nothing is no longer
  counted as an update.
- 18/10/2026 · AJ · §6.2: the leave staging seed `30_leave.js` (the mock's twelve sample requests on the
  real staff, through the leave service; LA to review) and `seeds/lib/` for code the build and staging
  seeds share.
- 18/10/2026 · TB · §6.1: a staff number the roster's sheet gives one of its people is theirs. The
  first administrator is created before any roster and is given 00001, which the sheet says is the
  CEO's, and the loader read that as a match and skipped the CEO. A holder the sheet does not name
  now moves to the next free number, keeping their record, login and roles; a holder the sheet does
  name is reported instead, and importing a sheet by hand moves nobody. Why the roster has never
  run on staging at all, and how to put it there, is `docs/runbooks/staff-roster.md`.
- 18/10/2026 · TB · §2, §6.10, §10, §11: Roles & Permissions redesigned from three drawn options per
  shell. Desktop is a split view (roles beside the role, Access, Details and People, Roles and Matrix
  views); the phone shows a role's modules by level, edited in a sheet. A module's access is one level
  (No Access, View, Add, Edit, Full) with Approve and Export beside it, mapped to the six actions on
  screen only, so the API and contract are unchanged. Review before save, a role's people, the ⓘ
  summary, the letters with help and a key, the unsaved-edits question and New Role in steps.
- 18/10/2026 · TB · §6.7: a Home tab the shell shows locked (Team, Alerts, Reports without their capability) stays hidden from ⌘K.
- 17/10/2026 · TB · Documents: `documents.repo.js` exports `REQUEST_STILL_OPEN`, the one rule for a request still waiting for its file, which Home's Documents Requested card reads instead of a copy. No behaviour changed.
- 17/10/2026 · TB · §5: `organisation.service.counts(client, scope, { today })` for Home's headcount,
  attrition and confirmations cards, the register's own definition; the counts above People ·
  Employees now count their 90 and 30 day windows from `lagos.today()` rather than the database's
  `current_date` (the same figures, except between midnight and 01:00 Lagos on a server in UTC).
- 17/10/2026 · TB · §6.3, §8, header: capabilities become a convention every module applies (README
  §5.2, BACKEND_GUIDE §5): one catalogue (`CAPABILITY_CATALOG`), seeded by the milestone's reference
  seed, checked after the grant (`route()` enforces the order; `requireAnyCapability` added), on
  `/me.capabilities`, mirrored in the shell and ⌘K, and held by `scripts/check/capabilities.js`.
  Every guide gains a Capabilities header row (`_TEMPLATE.md`).
- 17/10/2026 · TB · §4: Documents & Numbering gains Report Run (`report_run`, RPT-0001, never
  reset), the number of each report file Home generates. Its scheme is seeded by
  `seeds/reference/1199`; the settings contract's `DOC_TYPES` and the screen's labels list it.
- 17/10/2026 · TB · §2, §4, §10.1, §11: Nigeria's public holidays for 2026 and 2027 are seeded
  (`seeds/reference/0448`): the days the Public Holidays Act fixes as declared, and the Eids (from the
  Umm al-Qura calendar) and the weekday given for a weekend holiday as Expected, which `0410` adds and
  Confirm Holiday clears. A26 amended: a holiday set by law is not a business choice.
- 17/10/2026 · AJ · §6.5: the leave module now opens `leave.approval` and settles the request from its outcome; People · Leave (#26) approves and rejects through the workflow routes (`docs/guides/ess.md`).
- 17/10/2026 · TB · §6.7, §10.1: ⌘K gains Waiting on You (first, with nothing typed), open seats,
  preferred and middle names, the theme, density, Install App and Sign Out as actions, and one forgiven
  slip in screens and actions.
- 17/10/2026 · TB · §6.7: employees are also found by their work phone, typed any way (a `phones`
  option on search providers). §6.7 already promised it; track A's provider lacked the column.
- 17/10/2026 · TB · Track D built: the `workflow` routes (My Approvals and its count, one request,
  approve, reject, request changes, withdraw, and reassign from §11 with `0450`), Settings · Approvals
  (#72) on the real API (flows edited as new versions), the leave flow in `0499` (line manager, then
  Operations & People over 5 days), and ⌘K search on `GET /search` (screens with synonyms, actions,
  every module's records); the search coverage gate now holds screens, entity types and New actions.
  §2, §5, §6.5, §6.7, §7, §8, §10 and §11 say what was built.
- 17/10/2026 · TB · Track A built: the `organisation` module on the real API (the register, the
  employee 360, departments, vacant seats, reporting lines and the bounded tree), the staff importer,
  the roster loader that every deploy runs on staging and production, the staging seed, and People ·
  Employees (#24) with Org Chart (#91) and Organogram (#92). §2 marks the three screens built; §6.1
  gains the three things the sheet itself taught us (a column the whole sheet gets wrong is not
  imported, the two batch options only the loader sets, and a deploy that changes no file changes no
  record); §10.1 lists the register and the record as built; §13 records that Attendance Today waits
  on LA's attendance routes. Three additive changes outside the module, each in the PR: the import
  engine takes batch `options` and honours a service that answers "nothing to write",
  `numbering.advanceTo()`, and `blank()` in the contract for an optional field a form leaves empty.
  Import Staff on the register opens track B's Settings · Imports, which landed first. The API now
  registers every module's importers at boot, the way the worker already did (`http/module-loader.js`):
  the two tracks meet at the registry, and without it B's screen would list nothing to import.
- 17/10/2026 · TB · Track C built: `access` (roles created, edited and deleted, the grants matrix,
  field visibility and capabilities per role), `settings` (organisation profile, working week, public
  holidays, numbering schemes, the security rules within the `.env` floor) and `audit` (the log at 25
  with filters, the summary and the emailed Excel export, masked per reader), with Organisation (#69),
  Roles & Permissions (#71), Documents & Numbering (#76), Security (#78) and Audit Log (#79) on the
  real API. Migration `0400` adds `role_capability`, `role.two_step_required` and the audit indexes;
  `0449` seeds the §6.3 defaults; `PASSWORD_MIN_LENGTH` joins the `.env` floors. Required two-step by
  role adds the set-up step to sign-in, in `identity` and `security` (§6.4, `identity.md`). §4, §5,
  §6.3, §6.4, §7 to §11 updated.
- 17/10/2026 · TB · Track B built: the `imports` API over any registered importer, Settings · Imports
  (#93, the wizard and the history), the `documents` module (gated upload, download, versions,
  verification and document requests) and ESS · My Documents (#14) on the real API. Migration `0350`
  adds `document_request` and `document.verified_at`; §5 lists every route as built, §6.9 says what a
  document's status means, §10 carries the new screen's rows. The employee record's Documents tab
  waits for track A, which has now landed.
- 16/10/2026 · TB · The staff importer moved to track A with the roster loader, so A and B meet only
  at the import engine; Settings · Imports holds the wizard and history.
- 16/10/2026 · TB · First version: the remaining M0 and foundation work in four tracks, with TB's
  twenty decisions of 16/10/2026 (§6); the staff sheet and role map go into `seeds/staff/` with
  track A, the repository being private.

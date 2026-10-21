# Employee Self-Service · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M1 |
| Backend modules | `ess`, `leave` |
| Frontend paths | `app/src/features/ess/`, `app/src/features/attendance/EssAttendance.tsx`, `app/src/features/people/Leave.tsx` |
| Permission key(s) | `ess` (always `own` scope); `people` for People · Leave |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #8 My Profile, #9 My Attendance, #87 Work Location Requests, #88 My Devices, #89 Policy Updates, #10 My Performance, #11 My Payslips, #12 My Leave, #13 My Queries, #14 My Documents, #91 Org Chart, #90 My Security, #26 People · Leave |
| Status | Draft |
| Last changed | 21/10/2026 |

Sources: MILESTONES §6.3 and §18; REUSE_MAP §2.3; the internal workflow meeting of 12 October 2026
(AJ presenting ESS, TB reviewing). The demo (`demo.html`, Employee Self-Service) was updated on
13 October to match this guide, and on 14 October to the screen conventions (FRONTEND_GUIDE §5, §7,
§8); where they differ, this guide wins. Attendance inside ESS (My
Attendance, Work Location Requests, My Devices) is owned by LA and described in
`docs/guides/attendance.md`; Policy Updates is described in `docs/guides/policies.md` (TB); this
guide only says how those tabs sit in ESS.

---

## 1 · What it is for

Each member of staff's own record, in one place: their profile and work schedule, attendance,
performance, payslips, leave, queries and sanctions, documents, and how they sign in. It replaces
asking People for a copy of something. Named **Employee Self-Service**, never "My HR"; every tab
begins "My" because the module shows only the caller's own record (MILESTONES §18.1).

Used by every member of staff. People, managers and the CEO see other people's records in their own
modules (People, Performance, Queries & Sanctions, Payroll), never here.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| ESS · My Profile (`my-profile`) | Staff app | Every employee, own record | Photo, personal details, employment details with the **work schedule**, bank details, next of kin, record history | Upload or change their photo; edit phone, address, next of kin and bank details (Edit Profile); download their data; go to My Security to change the password |
| ESS · My Attendance (`my-attendance`) | Staff app | Every employee, own record | Owned by LA: today, clock events and check-ins, exceptions, the person's temporary sites today and to come (attendance guide §1, §2) | Clock in and out, check in at each stop on a temporary site's day, report an issue, export the month |
| ESS · Work Location Requests (`work-location-requests`) | Staff app | Every employee | Owned by LA: the temporary sites they submitted or are on (attendance guide §6.11), and their work location requests made before its PR 4 | Add Work Site (the same sheet as Home's), Withdraw Submission while it waits; withdraw or cancel an old request |
| ESS · My Devices (`my-devices`) | Staff app | Every employee | Owned by LA: devices used to clock in, up to 3 | Register this device |
| ESS · Policy Updates (`policy-updates`) | Staff app | Every employee | Owned by TB (policies.md): every policy that applies to them, those to acknowledge first, as clean text or sentences with what changed; approvers, the versions waiting on them | Acknowledge, Later, Download PDF; an approver approves and signs |
| ESS · My Performance (`my-performance`) | Staff app | Every employee | KPIs this month, the goal chain above them, reviews | Read; open a review; self rating opens with the review cycle (M2) |
| ESS · My Payslips (`my-payslips`) | Staff app | Every employee | Payslips by year, gross, net, deductions, next payday, a preview | Change year, preview a month, download a PDF, email a copy, open the deductions breakdown |
| ESS · My Leave (`my-leave`) | Staff app | Every employee | Entitlement, taken, upcoming, remaining, requests | Request leave, cancel a request while it waits or before it starts, open a request or a figure's list, open the leave calendar |
| ESS · My Queries (`my-queries`) | Staff app | Every employee | Three cards: Open Queries, Archived, Sanctions | Open each list; respond to an open query |
| ESS · My Documents (`my-documents`) | Staff app | Every employee | Their vault: contracts, certificates, ID; signed, verified, expiring, missing | Upload a requested document, preview, download |
| ESS · My Security (`my-security`) | Staff app | Every employee | Password (when it was changed), two-step sign-in, the PIN, passkeys, where they are signed in, recent sign-ins with how each began; a link to My Devices | Change password; set up, change or turn off two-step (no Turn Off while a role they hold requires it) and choose how often it asks; new recovery codes; set, change or remove the PIN; add, rename or remove a passkey; sign out one device or all the others; open My Devices |
| Shell avatar (rail, phone top bar, More) | Staff app | Every employee | The photo from My Profile, or initials | |
| People · Employees (employee record) | Staff app | People; Download Their Data the CEO only | The same employee record | Where People edit the fields an employee cannot; the CEO asks for a copy of one person's data (Download Their Data) |
| People · Employees · Work Schedule tab | Staff app | People | Owned by LA: Work Setup and the person's work schedule | Where the work schedule shown in My Profile is set |
| People · Leave (`leave`) | Staff app | `people` view: Operations & People everyone, a line manager their team | Everyone's requests within that scope, the figures above them, who else in the department is away, this month's calendar | Approve or reject a request that waits on them, record leave for someone (`people` create), cancel granted leave before it ends (`people` edit) |
| Payroll · Payslips (M6) | Staff app | Payroll | The payslips ESS shows | Approving a run is what makes a payslip visible in ESS |
| Queries & Sanctions (M3) | Staff app | Managers, People, CEO | The queries and sanctions ESS shows | Raising and deciding them |
| Settings · Security (#78) | Staff app | `settings` view, edit | Session length, idle lock and password minimum within the server's floor; two-step by role; everyone's sessions; failed sign-ins | The rules My Security follows; a role that requires two-step makes its people set it up at their next sign-in (`docs/guides/foundation.md` §6.4) |
| Mobile bottom bar and More | Staff app, phone | Every employee | Self-Service is the fourth place in the bottom bar (F16) | |

## 3 · How the screens relate

1. **Photo.** An employee taps their avatar in My Profile (a + on it while there is none, a pencil
   once there is) → Profile Photo: the file goes through the upload engine as an `avatar` (cropped
   square to the face, metadata stripped, 96, 192 and 384 px) into the vault, as an `employee_photo`
   every signed-in colleague may read → `employee.photo_document_id` (1170) points at it →
   `employee.photo_updated`. My Profile and the shell avatar (rail, phone top bar, More, the lock
   screen) show it at 384 px; every list and card that names a person shows it at 192 px, because
   every person in a list is read through `shared/db/person.js` (`PersonRef.photo_url`): People ·
   Employees (the list, and the record's header at 384 px), Leave and Attendance, Devices,
   Worksites, Settings · Users and Roles, the Organogram and Org Chart, Staff
   Community (channels, direct messages, members, the profile panel, posts, celebrations,
   recognitions, the people pickers) and Home (Team, a card's records). Remove Photo clears the
   pointer and the initials return. `photo_url` is an API path fetched with the session, never a
   bare image link; the app fetches each one once and shares it between screens (`usePhotos`).
2. **Work schedule.** People set each person's work schedule on the record's Work Schedule tab, after
   Job (attendance guide §6.13, its PR 3) → My Profile shows it, read only: each day Working or Off,
   its hours and Office or Remote, or the Attendance policy's company hours when none is set (09:00
   to 17:00, Saturday 09:00 to 15:00). The person is told when it changes. Attendance judges
   lateness and absence against the same schedule. One source.
3. **Lateness to payslip.** A late punch raises a query (attendance auto-query, LA) → it appears in
   My Queries · Open → the employee responds within 48 hours → if it is upheld a sanction is
   recorded (My Queries · Sanctions) and any deduction is accepted into the payroll run (M6) → the
   approved payslip shows it in My Payslips, and the Deductions figure opens the list of months with
   deductions, each with its query. If the query is waived nothing is deducted.
4. **Payslips** become visible when Payroll approves and locks the run (normally the 27th). Until
   then the month shows "In the run".
5. **Leave.** A request from My Leave goes to the line manager, then to Operations & People when it
   is over 5 days (the leave flow, `docs/guides/foundation.md` §6.5) → approved leave counts down the
   entitlement and is never counted as absence by attendance.
6. **Documents.** People request a document (passport photograph, a certificate) → it shows as
   Missing in My Documents → the employee uploads it → People see it on the employee record. A
   missing document blocks onboarding for a new hire, nothing for a confirmed employee.
7. **Devices.** My Security links to My Devices (LA), where the up to 3 devices are registered. A
   clock-in from any other device is flagged to People.
8. **Download My Data.** An employee presses Download My Data on My Profile (or the CEO presses
   Download Their Data on a person's record in People · Employees) → `employee.data_export_requested`
   is written on the person's record with who asked, at once → after commit the worker gathers
   everything the person can see about themselves, 25 rows at a time through the screens' own
   reads (profile and employment, next of kin, the bank by its last four digits, record history,
   leave requests and balances, attendance days and punches without coordinates or device
   identifiers, the list of their documents, their sign-ins) → one workbook, a sheet per area and a
   cover (who, when, what each sheet holds, the NDPA line) → the vault as a restricted
   `data_export` the person and the CEO alone may open → downloaded on the device that asked, which
   waits for it (`docs/guides/foundation.md` §6.12); nothing is emailed → removed from the vault a
   day later (`export-cleanup`). The file is not listed in My Documents. Payslips join it with
   Payroll (M6).

## 4 · Data

ESS is an aggregator (README §5.1): **no tables of its own**. It reads through other modules'
services, always for the caller's own `employee_id`.

| Table | Key columns | Notes |
|---|---|---|
| `employee` (organisation) | `employee_id`, `phone`, `address`, `next_of_kin`, `bank`, `photo_document_id` | The editable fields are written through the organisation service |
| attendance tables (LA) | see the attendance guide | Read for the work schedule |
| `payslip` (M6) | `payslip_id`, `employee_id`, `period`, `gross`, `net`, `locked_at` | Only locked payslips are returned |
| `leave_type` (leave) | `code`, `name`, `policy.days_per_year`, `active` | The types People offer and each one's yearly allowance. Four are seeded (`1290`: Annual 20, Compassionate 5, Sick 12, Unpaid), by the team lead's decision of 17/10/2026; People add, change, retire and delete the rest on People · Leave |
| `leave_request`, `leave_balance` (leave) | `employee_id`, `leave_type_id`, `starts_on`, `ends_on`, `amount` (working days), `status`, `workflow_instance_id`, `recorded_by` | `leave_balance` holds People's figure for one person and year; without one the type's allowance applies. `1200` checks the status and indexes the lists |
| `query`, `sanction` (M3) | `employee_id`, `status`, `outcome`, `deduction` | |
| `document` (vault) | `document_id`, `entity_type`, `entity_id`, `sensitivity` | `restricted` documents are readable by the subject in ESS (BACKEND_STRUCTURE §5) |
| identity and security tables | password, two-step, passkeys, PIN, sessions | Owned by `identity` and `security` |

Migration file(s): none for ESS. Leave: `migrations/1200_leave_requests.sql`, `seeds/reference/1290_seed_leave.sql` (the status list and the four types).

## 5 · API

Proposed, all under `/api/v1/ess`, all `own` scope. Writes go through the owning module's service.
Every list is paged at 25 (BACKEND_STRUCTURE §16). Contract in `packages/contract/schemas/ess.js`
(empty today).

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /profile` | → `EssProfile` | `ess` · own | | Built 17/10/2026. From the employee 360; the account by its last four digits; the organisation's working week (each person's arrangement waits on attendance) |
| `PATCH /profile` | `EssProfileUpdate` → `EssProfile` | `ess` · own | | Built 17/10/2026. Only phone, home address (a `PlaceInput`: picked or pinned, never typed, F27), next of kin, bank, through the organisation service; an empty field is left as it is. `EssProfile` carries `home_address_place` for the edit form A bank change is audited and tells `people` edit holders |
| `GET /profile/history` | `PageQuery` → `EmployeeHistoryPage` | `ess` · own | yes | Built 17/10/2026. Record History |
| `POST /profile/photo` | multipart `file` (purpose `avatar`, 5 MB, an image) → `DocumentRef` (the stored file, as every upload answers) | `ess` · own | | Built 19/10/2026. Through `organisation.photo.setPhoto`; a file that is not an image is a 415 |
| `DELETE /profile/photo` | → `EssProfile` | `ess` · own | | Built 19/10/2026. Clears the pointer; the file stays in the vault |
| `POST /profile/export` | `EmptyBody` → `ExportFile` (documents, 202) | `ess` · own | | Built 19/10/2026. Download My Data (§3 step 8): the file reserved and the request audited at once, built after commit and downloaded where it was asked for. Pressed again the same Lagos day, the same file again; when the CEO already made one for this person that day, a 429 `DATA_EXPORT_LIMIT` |
| `GET /payslips` | `EssPayslipQuery` (`year`) → `PayslipPage` | `ess` · own | yes | Locked payslips only |
| `GET /payslips/:id/pdf` | → PDF | `ess` · own | | |
| `POST /payslips/:id/email` | → `{ sent }` | `ess` · own | | To the work email |
| `GET /deductions` | `PageQuery` → `DeductionPage` | `ess` · own | yes | Month, amount, reason, query |
| `GET /leave` | `EssLeaveListQuery` (`status`, `year`) → `LeavePage` | `ess` · own | yes | Built 17/10/2026. The caller's own requests |
| `GET /leave/calendar` | `EssLeaveCalendarQuery` (`month`) → `LeavePage` | `ess` · own, wider by rule | yes | Built 18/10/2026. Approved and waiting leave touching the month: the caller's own and everyone under them in the reporting tree; everyone for the CEO and People with scope all (Operations & People) (the team lead, 18/10/2026) |
| `GET /leave/balances` | `EssLeaveBalanceQuery` (`year`) → `LeaveBalances` | `ess` · own | | Built 17/10/2026. Every active type: entitled, taken, booked, pending, remaining |
| `GET /leave/:id` | → `LeaveRequest` | `ess` · own | | Built 17/10/2026. Someone else's is a 404 |
| `POST /leave` | `LeaveRequestCreate` → `LeaveRequest` | `ess` · own | | Built 17/10/2026. Opens the `leave.approval` flow in the same transaction |
| `POST /leave/:id/cancel` | `LeaveCancel` → `LeaveRequest` | `ess` · own | | Built 17/10/2026. While it waits (the approval is withdrawn too) or once granted until it starts |
| `GET /queries` | `EssQueryList` (`status`: open, archived) → `QueryPage` | `ess` · own | yes | |
| `POST /queries/:id/response` | `QueryResponse` | `ess` · own | | Through the queries service |
| `GET /sanctions` | `PageQuery` → `SanctionPage` | `ess` · own | yes | |
| `GET /documents` | `DocumentListQuery` (`status`) → `DocumentListPage` | `ess` · own | yes | Built 17/10/2026. Documents held and ones People asked for, in one list |
| `GET /documents/summary` | → `DocumentSummary` | `ess` · own | | Built 17/10/2026. The five counts, over every row, not the page |
| `POST /documents` | multipart `EssDocumentUpload` → `DocumentRow` | `ess` · own | | Built 17/10/2026. Upload engine and vault; `document_request_id` answers a Missing row |
| `GET /performance` | → `EssPerformance` | `ess` · own | | M2 |

Download Their Data is the organisation module's route, built by ESS (`ess.export.js`):
`POST /api/v1/employees/:id/data-export` (`EmptyBody` → `ExportFile`, 202), `people`
view then `requireCeo()`: anyone else is a 403, an unknown person a 404. The same workbook,
downloaded by the CEO, counted in the person's one a day.

People · Leave calls the `leave` module under `/api/v1/leave` (`schemas/leave.js`): `GET /requests` (`LeaveListQuery`: status, type, employee, `from` and `to` overlap, search, sort), `GET /summary`, `GET /requests/:id`, `GET /requests/:id/clashes`, all `people` view within scope; `POST /requests` (`LeaveRecordCreate`, `people` create, approved at once); `POST /requests/:id/cancel` (`people` edit); `GET /types` (`ess` view, so every form can list them), `POST /types` and `PATCH /types/:id` (`people` create, edit), `DELETE /types/:id` (`people` delete; refused with `LEAVE_TYPE_IN_USE` once a request or allowance names it, so it is retired instead); `GET /balances` (`LeaveBalanceQuery`: one person's year, `people` view within scope) and `PUT /balances` (`LeaveAllowanceSet`: one person's allowance of a type for a year, `null` back to the type's, `people` edit; the person is told). A waiting request is decided with the approval's own routes (`POST /workflow/instances/:id/approve`, `reject`), never a leave route.

My Security calls the `identity` module's own-account routes (`/auth/security`, `/auth/password`,
`/auth/sessions`) and the `security` module's (`/security`, `/security/two-step*`,
`/security/passkeys*`, `/security/pin*`, `/security/confirm*`; `docs/guides/identity.md` §5); they
check ownership, not the `settings` grant (README §5.2).

## 6 · Rules and calculations

- Every ESS read and write is for the caller's own employee record. There is no parameter that
  selects another employee.
- An employee may change phone, address, next of kin, bank details and photo. Job title, salary,
  line manager and work schedule are changed only by People. Every change is audited; a bank
  change also notifies People. Edit Profile offers only the fields an employee may change, so no
  screen lists them; the bank account on the profile is the one expense refunds are paid into.
- The work schedule is read only in ESS and comes from attendance; hours come from the attendance
  policy in force.
- The KPI score is the employee's KPIs weighted to 100%, and it moves as the tasks against each KPI
  close (Performance, M2). The goal chain above the KPI is shown read only, five levels from the
  organisational goal down to the employee's own KPI.
- A payslip is visible only once its run is approved and locked. The preview is the PDF the
  document engine produces for that payslip, not a screen layout.
- MyCity runs simple payroll: staff are treated as contractors and consultants, so no screen
  mentions PAYE or pension, and Payroll sits behind an advanced option (12 October).
- A deduction reaches a payslip only from an upheld query. The Deductions figure opens every month
  that carried one, with its query reference.
- My Queries shows three cards: Open Queries, Archived, Sanctions. The build flowchart is not shown
  to staff (TB, 12 October). The employee's response stays on the record beside the decision, and
  it is read before the decision is made, so disagreement goes in the response. Most queries close
  with no action. Who can see a query: §8.
- Leave is approved by the line manager, and by Operations & People too when it is over 5 days (a
  number they change on Settings · Approvals); the screen does not say so. People · Leave shows who
  else in the department is away on the same days (Also Away) before a request is decided.
- A request is counted in working days: the configured week (Monday to Saturday, A22) with public
  holidays left out, both ends included. It is refused when it ends before it starts, crosses New
  Year (two requests instead), has no working day in it, starts in the past (the employee's own),
  overlaps leave already waiting or granted, or would take the year past the type's allowance,
  counting what is granted and what still waits. A type with no allowance (Unpaid) has no ceiling.
- The allowance is People's figure for that person and year (`leave_balance`, set in Allowances) when
  they set one, otherwise the type's days a year. Taken is granted leave already started, Booked granted leave
  still to come, Pending what waits in the flow.
- The approval decides; the request copies the outcome after commit, and every read takes the
  approval's outcome until the copy lands, so a decided request never shows as Pending.
- The employee cancels their own request while it waits (the approval is withdrawn with it) or once
  granted until it starts. People cancel granted leave until it ends; a waiting request is theirs
  to decide in My Approvals. Leave People record is approved at once, with no flow, and the person
  is told.
- Signed documents carry two hashes (content and artifact) and a public verification link on
  `go.mycityapp.io/verify/<ref>`.
- Changing the password ends the employee's other sessions. The password, two-step, passkey, PIN
  and session rules are `docs/guides/identity.md` §6. A passkey signs in with the fingerprint or face
  instead of the password and the code; the PIN unlocks the app and signs in on a browser the person
  has used, and attendance will use the same check to confirm a clock-in on a registered device.
- Adding or removing a way in needs a sign-in or a confirmation in the last 15 minutes; past it the
  screen asks Confirm It's You first.
- Up to 3 registered devices (attendance guide).
- Download My Data holds what the person can already see about themselves in the app, nothing
  more: the bank account by its last four digits, punches with their location check and the
  device's label but never coordinates or a device identifier, the documents as a list without the
  files, no salary or pay (Payroll adds payslips in M6). At most one file a day for a person,
  counting the CEO's Download Their Data for them; the limit is per Lagos day. Whoever asked
  pressing again that day gets the same file again, so a download that failed can be done again;
  anyone else is refused until tomorrow, and a file that failed does not count. The file is
  restricted (the person and the CEO alone may open it), downloaded on the device that asked, never
  emailed, and removed from the vault a day later.
- Every list that shows a person shows their photo at 192 px (`shared/db/person.js` chooses the
  sizes once, `organisation.photo.js` exports both); a person with none shows initials.
- Coming Soon: a tab whose module is not yet delivered shows a Coming Soon page naming the milestone
  and date (My Performance M2, My Queries M3, My Payslips M6). What each milestone delivers is in
  MILESTONES, not on the page. The demo has a Prototype View switch for it, on desktop only.
- Copy a person reads: Title Case chrome, no em dashes, day-first dates, 25 per page.
- No footnote at the bottom of a page and no page subtitle that describes the page. Support text is
  a help term on the word it explains or a Details row at the foot of its card (FRONTEND_GUIDE
  §5.2); §10 lists each one. Everything else in this section stays off the screen.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `employee.updated` (organisation) | After an own-profile change commits | Audit row with before and after |
| `employee.bank_details_changed` (`ess.events.js`) | After a bank change commits | "Bank details changed" to `people` edit holders within scope; never the account |
| `employee.photo_updated` | After a photo is set or removed (organisation, 19/10/2026) | Shell and Community pick up the new avatar |
| `employee.data_export_requested` (`ess.events.js`) | Download My Data or Download Their Data, at once | On the person's record with who asked (audit), with the restricted `data_export` file it reserved; after commit `ess.data_export` builds the workbook into that file, which the screen that asked downloads; nothing is emailed |
| `export-cleanup` (scheduler, every hour) | A file is a day old | Removes it from the vault (`vault.remove`, `document.removed`), as every export (`docs/guides/foundation.md` §6.12) |
| `payroll.run_approved` (M6) | Run approved | Payslips become visible; notification "Your payslip is ready" |
| `query.raised` (M3) | Query raised against the employee | Notification opening My Queries |
| `document.requested` | People request a document | Notification opening My Documents |
| `auth.two_step_*`, `auth.passkey_*`, `auth.pin_*`, `auth.recovery_code*` | A way in added, changed, removed or used from My Security | Notice to the person, bell and email (`docs/guides/identity.md` §7) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Their own record only | Everything in §2 for themselves |
| People, managers, CEO | Their own record only, in ESS | Other people's records are in People, Performance, Queries & Sanctions and Payroll |

A query raised against an employee is seen by the employee, whoever raised it, People and the CEO.

Restricted documents (payslips, bank letters, ID) are readable by the subject in ESS and otherwise
only with the owning module's grant.

Download My Data is the person's own; Download Their Data is the CEO's alone (`requireCeo`), not
People's or a manager's. The workbook opens for the person it is about and the CEO, nobody else.

## 9 · AI and search

- **AI reads** (`ess.ai.js`): built: the caller's own documents, leave requests (`my_leave.list`) and
  year (`my_leave.balances`); `leave.ai.js` reads leave requests within the asker's `people` scope.
  Still to come: the caller's own profile summary, latest payslip
  summary, open queries count. Never another person's record. Paged at 25.
- **AI routes**: "my payslip" → My Payslips; "request leave" → My Leave · Request Leave; "change my
  password" → My Security; "upload my photo" → My Profile.
- **Search** (`ess.search.js`, ⌘K): the tabs by name and the words people use: payslip, salary
  slip, leave, holiday, query, sanction, documents, contract, password, two-step.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| ESS · My Profile (`my-profile`) | The photo or initials, with a + (none yet) or a pencil, opening Profile Photo (Choose a Photo; Remove Photo while there is one); name, role and pills (Confirmed or On Probation, arrangement, Reports To); Edit Profile, Change Password (opens My Security), Download My Data (busy while the file is made, then saved on this device: toast "Your data downloaded", or why not today); Personal (Full Name, Date of Birth, Phone, Work Email, Address); Employment (Job Title, Department, Line Manager, Start Date, Employment Type, Work Arrangement, Status) with the Work Schedule inside it (each day Office, Remote or Off, hours and place; a Set by People pill); Bank Details (Bank, Account Name, masked Account Number); Next of Kin; Record History. Edit Profile: Phone, Home Address (picked from the search or pinned, never typed: `AddressField`, `docs/guides/addresses.md` §10), Next of Kin, Next of Kin Phone, Bank, New Account Number (Optional); Cancel, Save Profile | Help terms on the card titles: Employment, "Only People can change these, including your work schedule."; Work Schedule, "Lateness is measured against these hours."; Bank Details, "Expense refunds are paid into this account. A change is logged and People are notified." On the New Account Number label: "Leave blank to keep the account ending 4417. A bank change is logged and People are notified." | The What You Can Change card (which fields an employee may change; a bank change logged): §6, and Edit Profile offers only those fields. "Every change to this record is written to the audit log": §6, §7. Where the schedule comes from and that approved leave never counts as absence: §3 steps 2 and 5. The page subtitle "What People see, and what you can change yourself" is removed |
| ESS · My Attendance (`my-attendance`) | Owned by LA: the attendance guide §1, §2 | The attendance guide | The attendance guide. ESS strips the "A correction never overwrites a punch" footnote from LA's page (attendance guide §5) |
| ESS · Work Location Requests (`work-location-requests`) | Owned by LA: the attendance guide §6 | The attendance guide | The attendance guide §6 |
| ESS · My Devices (`my-devices`) | Owned by LA: the attendance guide §1 | The attendance guide | The attendance guide §1, §7 (device rules) |
| ESS · Policy Updates (`policy-updates`) | Owned by TB: policies.md §10.1 | policies.md | policies.md §6 |
| ESS · My Performance (`my-performance`) | "October 2026 · set by Ifeoma Chukwu" (desktop subtitle); KPI Score, On Track, Weight Assigned, Last Review, Next Cycle; My KPIs This Month (each KPI with its bar and progress); Rolls Up To (the goal chain from the organisational goal down to the employee's KPI); My Reviews (Cycle, Self Rating, Manager, Second Level, Status). A review opens Your Rating, Manager, Second Level, Status and, once closed, the Manager Comment | Help term on the KPI Score label: "Your KPIs, weighted to 100%. It updates as the tasks against each KPI close." | The chart caption "Weighted. Your score updates as tasks against each KPI close" became the KPI Score help; the "Five levels… you can see the whole chain" footnote: §6. "Click a review to open it" is removed: rows show as links |
| ESS · My Payslips (`my-payslips`) | The year (‹ year ›), Email a Copy, Download All; Gross, Net Received, Payslips, Deductions (View Details), Next Payday; Payslips, 2026 (Month, Net, Status: Paid, Paid with a deduction, In the run); the selected payslip's PDF preview with Email a Copy and Download PDF. Deductions opens Salary Deductions (Month, Amount, Reason, Query, Outcome; Open My Queries). A month still in the run opens "In This Month's Run, Appears once the run is approved." | None | "This is the document the engine produces": §6. A deduction only from an upheld query, waived means nothing deducted: §3 step 3, §6. No PAYE or pension line: §6. Visible once Payroll approves, normally the 27th: §3 step 4. The Salary Deductions subtitle and "Click a month to preview it" are removed |
| ESS · My Leave (`my-leave`) | "2026 entitlement" (desktop subtitle); Leave Calendar (a month of approved and waiting leave, the reader's own marked You and in yellow, waiting ones marked Waiting; this year and next) and Request Leave; Entitlement, Taken, Approved Upcoming, Remaining, each opening its list or request; My Requests (Type, From, To, Days, Approver, Status), a row opens the request with Cancel Request while it waits or before it starts; Entitlement by type (allowance, bar, taken, booked, pending, left; No set allowance for a type without one). Request Leave: Leave Type (the types People offer), First Day and Last Day (DD/MM/YYYY), Note (Optional); Cancel, Send Request | None | "Leave is approved by your line manager in one step" and "The calendar shows clashes before you submit": §3 step 5, §6 |
| ESS · My Queries (`my-queries`) | Open Queries, Archived, Sanctions: a count and one line each; the chosen list under them (desktop) or in a sheet (phone): "No Open Queries, Nothing is waiting on you."; Archived Queries (Subject, Raised By, Date, Your Response, Outcome); Sanctions (Sanction, Reason, Date, Deduction, Status) | None | The 48 hours to respond: §3 step 3 (an open query shows its own due time). "Most queries close with no action", the response kept beside the decision, disagreement read before the decision: §6. Who can see a query: §8. A deduction only after an upheld sanction: §3 step 3. The flowchart and the page subtitle are removed |
| ESS · My Documents (`my-documents`) | Upload Document; Documents, Signed, Verified, Expiring, Missing; Vault (Document, Uploaded, Status, Expires); a row opens the document (Uploaded, Status, Expires, Reference; View File on a PDF or a photo, which opens it full screen in the file viewer with Download and, on a phone, Share; Download, or Upload Document on a missing one); the chosen document's preview, a PDF's pages drawn in the app | None | "Signed documents carry two hashes and a public verification link": §6. What each status means: `docs/guides/foundation.md` §6.9. A missing document blocks onboarding only for a new hire: §3 step 6, §11. The "Your vault" subtitle and "Click any row to preview it" are removed |
| ESS · My Security (`my-security`) | Password (when it was changed, or Not changed yet; Change Password); Two-Step Sign-In (On or Off; Ask for a Code: Every Sign-In, Once a Day, Once a Month; the recovery codes left; Set Up Two-Step, New Codes, Change App, Turn Off); PIN (On or Off, Changed or Not set; Set PIN, Change PIN, Remove PIN); Passkeys (Name with This Device, Added, Last Used; Add Passkey; a passkey opens Name, Save Name, Remove Passkey); Clock-In Devices (each registered or new device with its platform, status, last clock-in and This Device; Manage My Devices); Signed In (Device with its address, Signed In, This Device or Sign Out; Sign Out Others when there are others); Recent Sign-Ins (When, Device, Method, Address, Status). Change Password, Set PIN (New PIN, Confirm PIN), Set Up Two-Step (the QR code, the key, Code From App, Turn On; then the ten codes and Copy Codes) and Confirm It's You (Confirm With; Password or PIN; Confirm or Use Passkey) are forms. Sign Out, Turn Off, New Codes, Remove PIN and Remove Passkey ask first | Help terms on the card titles: Two-Step Sign-In, "A code from an authenticator app on your phone after your password or PIN, on a device that has not given one lately. A passkey needs no code."; PIN, "Four digits that unlock the app, and sign you in on a device you have signed in on before." | The page subtitle "Your password and where you are signed in" is removed. Where devices are managed and the flag on others: §3 step 7. The password, two-step, passkey and PIN rules, the window, the other sessions ending on a change, and the session limits: `docs/guides/identity.md` §6 |
| Shell avatar (rail, phone top bar, More) | The photo from My Profile, or initials | None | Where the photo is stored and who reads it: §3 step 1 |
| Every list and card that names a person | Their photo, or their initials | None | The sizes and how photos are fetched: §3 step 1, §6 |
| People · Employees (employee record) | Owned by People: that module's guide | That module's guide | That module's guide |
| People · Employees · Attendance setup | Owned by LA: the attendance guide §3 | The attendance guide | The attendance guide §3 |
| People · Leave (`leave`) | The month (desktop subtitle); Leave Calendar, Record Leave (`people` create); On Leave Today, Pending Approval, Starting Soon (Next 14 days), Approved This Year; search and the status chips (All, Pending, Approved, Rejected, Cancelled); Requests (Employee, Type, From, To, Days, Status); the chosen request: Employee, Type, From, To, Days, Status, Waiting On, Recorded By, Reason, Also Away (who else in the department, with their dates), Approve and Reject (Reject asks for a Reason) when it waits, Cancel Leave when granted and not ended. Record Leave: Employee, Leave Type, First Day, Last Day, Note (Optional); Cancel, Record Leave. Leave Types: Add Type (`people` create); Type, Allowance, Status (Offered, Retired); a type opens Name, Days a Year (Optional), Offered, with Delete Type (`people` delete), Cancel, Save Type. Allowances: Employee, Year, each type's entitled, taken, booked and left; Set opens Days (Optional), Cancel, Save Allowance | Help terms: Days a Year, "Working days each person gets a year. Leave empty for a type with no limit, such as unpaid leave."; Days, "Leave empty to use the type's usual allowance." | Who approves at which length: §6 and Settings · Approvals. The checks a request must pass: §6 |
| Payroll · Payslips (M6) | Owned by Payroll (M6 guide) | The M6 guide | The M6 guide |
| Queries & Sanctions (M3) | Owned by Queries & Sanctions (M3 guide) | The M3 guide | The M3 guide |
| Settings · Security (M9) | Owned by Settings (M9 guide) | The M9 guide | The M9 guide |
| Mobile bottom bar and More | Owned by the frontend foundation (FRONTEND_GUIDE §7, §9.2); Self-Service is a place in the bottom bar | None | FRONTEND_GUIDE §7 |

On a tab whose module is not delivered yet (§6, Coming Soon) the screen shows the tab title, a clock
icon, the milestone and date as a pill and "Coming Soon"; the demo adds View Full Design. What the
milestone delivers is in MILESTONES, not on the page. The demo's Prototype View switch (Full Design,
Delivered at M1) is a demo device for the client and shows on desktop only; the real app shows
Coming Soon from the module's delivery state.

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| ESS · My Profile (`my-profile`) | Edit Profile beside the title; the profile card (photo or initials, name, role, pills, Change Password, Download My Data); then icon cards two to a row: Personal, Employment (with the work schedule), Bank Details, Next of Kin, Record History | Every card's detail: each icon card opens it as a bottom sheet, with its help terms; the Prototype View switch | Edit Profile opens the form as a full sheet, Save Profile full width at its foot | ESS from the menu drawer; the tabs along the top scroll sideways |
| ESS · My Attendance (`my-attendance`) | As the attendance guide §10.2: Today's card, Temporary Sites as cards when there are any (then field assignments made before its PR 4), the four figures two to a row, then open exceptions and the days as cards | The subtitle; a day's punches and an exception's note, each in a bottom sheet | As the attendance guide | As My Profile |
| ESS · Work Location Requests (`work-location-requests`) | As the attendance guide §10.2: site cards, then old request cards while any is listed | As the attendance guide | Add Work Site, as the attendance guide | As My Profile |
| ESS · My Devices (`my-devices`) | As the attendance guide §10.2: the device cards with their status | The subtitle; a device's detail in a bottom sheet | Register This Device, as the attendance guide | As My Profile |
| ESS · Policy Updates (`policy-updates`) | As policies.md §10.2: To Acknowledge cards with Acknowledge full width, then policy cards | The subtitle | Acknowledge, as policies.md | As My Profile |
| ESS · My Performance (`my-performance`) | The five stats two to a row (KPI Score's help opens as a sheet), then icon cards: My KPIs This Month, Rolls Up To, My Reviews | The subtitle; the reviews table (a list of reviews in the My Reviews sheet) | Tap a review: its sheet | As My Profile |
| ESS · My Payslips (`my-payslips`) | The year switcher (44 px targets), Email a Copy, Download All; the stats two to a row; then the months as a list with a status pill | The subtitle and the preview beside the list: a month opens its preview as a sheet with Email a Copy and Download PDF | Download PDF, at the foot of the month's sheet | As My Profile |
| ESS · My Leave (`my-leave`) | Request Leave; the four KPI cards two to a row, each opening its list as a sheet; icon cards My Requests and Entitlement | The subtitle; the requests table (a list in the My Requests sheet); the entitlement card (its sheet) | Request Leave opens the form as a full sheet, Send Request full width | As My Profile |
| ESS · My Queries (`my-queries`) | The three cards, one to a row | The lists: each card opens its list as a sheet (archived queries and sanctions as cards) | Tap a card | As My Profile |
| ESS · My Documents (`my-documents`) | Upload Document; the five stats; the documents as a list with a status pill | The Expires column, and the preview beside the list: a document opens its details as a sheet, with View File (the file viewer, full screen, swiped and pinched) and Download | Upload Document; on a missing document, Upload Document in its sheet | As My Profile |
| ESS · My Security (`my-security`) | Icon cards two to a row: Password, Two-Step Sign-In, Passkeys, PIN, Signed In, Recent Sign-Ins, Clock-In Devices, each with its state (Changed date, On or Off, how many passkeys or devices) | Every card's detail, each in a sheet (the sign-in and passkey lists as cards) | Change Password, Save PIN and Turn On open their forms as sheets, the primary full width; Add Passkey makes the phone's own passkey (the fingerprint or face) | As My Profile |
| Shell avatar (rail, phone top bar, More) | The avatar at the right of the phone top bar; it opens More, whose top row is the person with Theme, Density and Settings | The rail itself | None | The phone top bar |
| People · Employees (employee record) | Owned by People | That module's guide | That module's guide | That module's guide |
| People · Employees · Attendance setup | Owned by LA | The attendance guide | The attendance guide | The attendance guide |
| People · Leave (`leave`) | The four figures two to a row, the search and chips, then the requests as cards | The subtitle | Tap a request: its card below the list with Approve or Reject; Record Leave opens the form as a full sheet | People from the menu; the tabs along the top scroll sideways |
| Payroll · Payslips (M6) | Owned by Payroll | The M6 guide | The M6 guide | The M6 guide |
| Queries & Sanctions (M3) | Owned by Queries & Sanctions | The M3 guide | The M3 guide | The M3 guide |
| Settings · Security (M9) | Owned by Settings | The M9 guide | The M9 guide | The M9 guide |
| Mobile bottom bar and More | Owned by the frontend foundation: the bottom bar (Home, Workspace, Community, Self-Service, More, F16) and More's launcher grid (F17) | The desktop rail | None | FRONTEND_GUIDE §7 |

On desktop each tab shows its sections in full; a review, a request, a KPI card, a document, the
Deductions figure and every form open the shared modal.

## 11 · Edge cases

- **No photo**: initials, with the + to upload.
- **Payslip not yet approved**: the month shows "In the run"; no PDF.
- **A year with no payslips** (before the start date): the year switcher stops at the start year.
- **Employee on leave**: attendance actions are unavailable (attendance guide); ESS is otherwise open.
- **Suspended employee**: no access to the app at all, ESS included (attendance guide §2).
- **Missing document on a new hire**: blocks onboarding; on a confirmed employee it blocks nothing.
- **A document People asked for twice**: two Missing rows, each answered on its own.
- **A document already given**: uploading against the same request again is refused, saying it arrived.
- **Fourth device**: refused; the employee removes one first (My Devices).
- **Bank details changed by mistake**: People are notified and can revert; the audit keeps both.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/hr_payroll/hr_ops.service.js` (1,633), `hr_ops.repo.js` (1,354) | Self-service dashboard and the lateness to query to waive or uphold loop; read through other modules' services, no repo of its own |
| pixie | `apps/admin/src/pages/hr/MyHrPage.tsx` | Renamed Employee Self-Service |
| pixie | `src/shared/hr_payroll/staff_documents.*` (952) | Through the vault |
| praxis-ls | `client/src/features/hr/employee-360.tsx` (2,420) | Layout reference for My Profile |
| praxis-ls | `src/modules/hr/leave_allowance/` (1,119) | Leave requests and balances |
| pixie | `apps/admin/src/pages/Iam*` and device enrolment | Reference for My Security and My Devices |

## 13 · Open questions

- **My Security** is an eighth ESS tab (TB, 12 October). It is not in the approved inventory
  (MILESTONES §18), which lists seven; with LA's three attendance tabs ESS now shows eleven. Needs
  sign off before the inventory, the route table and the permission catalogue are changed. TB.
- **Device approval**: the 12 October meeting said a registered device is accepted without People
  approving it; My Devices (LA) currently says People review a new device. LA and TB to agree.
- **My Payslips visibility** while Payroll is an advanced option: hide the tab, or show Coming Soon?

## 14 · Change log

- 21/10/2026 · TB · My Attendance (#9): My Days as a chart labels each day 13/10 (it read 13/10/, with a stray slash), and the shared bar chart leaves off the days that would touch, every few days at an even step, the first and the last always.
- 21/10/2026 · TB · With attendance's PR 2 (`attendance.md` §6.5): Download My Data names a punch whose location could not be proved Unclear, as every screen now does (Location Unclear); My Attendance (#9) reads Location Unclear with its help and a punch's location with its reason, and the clock panel reads the location through the feature's one reader (`app/src/features/attendance/location.ts`).
- 21/10/2026 · TB · Built with attendance's PR 3: My Profile's Work Schedule reads the person's own week (`GET /attendance/me/schedule` beside the profile's `working_week`): each day Working or Off with its hours and place, the company hours when none is set. My Attendance (#9) gains the month's Deductions and Overtime and Give Real Time on a System Clock-Out (`attendance.md` §10).
- 20/10/2026 · TB · Policy Updates (#89) built on `app/src/features/policies/PolicyUpdates.tsx` (every policy that applies to the person: To Acknowledge, All Policies, Waiting On You for an approver), described in `docs/guides/policies.md`; `features/ess/index.tsx` points there.
- 13/10/2026 · AJ · First version, from the 12 October internal workflow meeting, MILESTONES §6.3 and the 13 October demo update.
- 13/10/2026 · AJ · §10: phone layout for the four attendance tabs (icon cards that open the modal), built from LA's page.
- 13/10/2026 · AJ · §6: page footnotes removed from ESS (My Documents, My Queries, My Attendance).
- 14/10/2026 · TB · §10 rewritten to the template's content tiers and phone layout tables, from the demo as rebuilt to the screen conventions (FRONTEND_GUIDE §5, §7, §8): the What You Can Change card, the descriptive page subtitles, the chart caption, the footnotes and the Coming Soon feature list left the screen; support text became help terms on the word it explains; the leave, password and PIN forms and a new Edit Profile form use the form helpers. §2 and §6 now match, §6 gained the facts the removed text carried, §8 says who sees a query, and the ⓘ line in §6 became help terms and the Details row.
- 15/10/2026 · AJ · Five tabs ratified (#87 to #91). All twelve ESS tabs built in `app/` against the mock API, desktop and phone; not wired to the API yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: explainer cards and footnotes gone; Edit Profile is a three-step wizard; password, PIN, query response and device forms mark their fields on Submit instead of disabling it; Policy Updates shows the version and its changes as content.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): Self-Service is a place in the phone's bottom bar (F16) and the avatar sits in the phone top bar, opening More (F17); the menu drawer is gone. §2 and §10 rows brought into line; no ESS screen changed.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): every list on these screens is `DataView` (cards on a phone as before, with server sort where the contract allow-lists it), the KPI tiles are `KpiCard` (My Leave's still open only on a phone), the payslip and document previews are `Paper` and `DocumentPreview` (a PDF in the browser's own viewer, with Open in Tab and a Download card where it cannot be shown), and My Record History is the shared `Timeline`. §10 is unchanged.
- 16/10/2026 · TB · My Security runs on the real API (`identity` module; `docs/guides/identity.md`): Password, Signed In with Sign Out per device and Sign Out Others, Recent Sign-Ins, the Clock-In Devices link. Two-step sign-in, passkeys and the PIN left the screen until the security module (the second sign-in PR); §2, §5, §6 and both §10 rows say so. New passwords follow the contract's rule (8 characters with mixed case, a number and a symbol), not 12.
- 16/10/2026 · TB · My Security gains Two-Step Sign-In, the PIN and Passkeys (the `security` module; `docs/guides/identity.md` §3, §6), the Method on Recent Sign-Ins and Confirm It's You past the 15-minute window; the page subtitle goes. §2, §5, §6, §7 and both §10 rows updated.
- 17/10/2026 · TB · My Documents (#14) on the real API (M0, track B): `GET /ess/documents`,
  `/ess/documents/summary` and `POST /ess/documents`, the caller's own records only. The Vault list
  is what is held and what People asked for in one paged list, the five counts come from the server,
  the preview is the chosen document itself, and the hard-coded contract and the "Your vault"
  subtitle are gone. The `ess` module carries its first read manifest; the rest of ESS arrives with
  its milestones.
- 17/10/2026 · TB · My Security follows Settings · Security, built with foundation track C: while a
  role the person holds requires two-step, Two-Step Sign-In has no Turn Off and the server refuses
  one; the person sets it up at sign-in (`docs/guides/identity.md` §3 step 15). §2 updated.
- 17/10/2026 · TB · Leave goes to the line manager, then to Operations & People over 5 days (the leave
  flow of `docs/guides/foundation.md` §6.5, TB 16/10/2026), where §3 and §6 said one step. My Leave's
  Request Leave also opens from ⌘K (`?action=new`), and My Security's Change Password and Set PIN
  (`?action=password`, `?action=pin`).
- 17/10/2026 · AJ · My Leave (#12) and People · Leave (#26) on the real API: the `leave` module (`/api/v1/leave`) and `/ess/leave`, contract `schemas/leave.js`, `1200` and `1290`. Requests in working days, the checks in §6, the approval flow deciding and the request copying its outcome, cancelling, Record Leave approved at once, Also Away, leave types through the API and a staging seed. §2, §4, §5, §6, §9, both §10 tables and §13 updated; People · Leave added to them. The demo's View Calendar is not on My Leave.
- 17/10/2026 · AJ · My Profile (#8) on the real API: `GET /ess/profile`, `PATCH /ess/profile` (through the organisation service; a bank change tells People) and `GET /ess/profile/history`, contract `EssProfile`, `EssProfileUpdate`, `EssWorkDay`. The screen drops the Editable Fields card and the subtitle (§10), shows the organisation's working week until attendance gives each person's own, and keeps initials for the photo. Not built, as they need modules AJ does not own: the photo (§3 step 1), each person's schedule (§3 step 2), Download My Data.
- 17/10/2026 · AJ · Leave types: the four are seeded in `1290` (the team lead's decision, an exception to A26), and People add, change, retire and delete types on People · Leave (Leave Types); a type with leave on record is retired, never deleted. Allowances: People set one person's allowance of a type for a year (`GET`, `PUT /leave/balances`), and the person is told. The staging leave-types seed is gone.
- 17/10/2026 · AJ · Local data: `seeds/build/20_mock_data.js` loads the mock's 25 people, their logins and its leave into a laptop's database through the services (`npm run db:seed -- --build`, with `SEED_PASSWORD` in `.env`), so the real API shows what the mock shows. The roster moved to `app/src/api/mock/data/roster.json`, which the mock and the seed both read. Local and CI only: besides `seed.js`'s three refusals it needs APP_ENV development or test and no SMTP_HOST, and a release does not carry the roster.
- 17/10/2026 · LA · My Attendance (#9) and My Devices (#88) are built on the real API from the attendance guide, which owns them: §10.2 rows now follow its phone layout (cards from the shared list rather than icon cards). Work Location Requests and Policy Updates stay on INTERIM shapes until their API exists (attendance guide §13).
- 17/10/2026 · TB · Header gains the Capabilities row every guide now carries (README §5.2): none, Self-Service is always the person's own.
- 18/10/2026 · AJ · Leave on staging: `seeds/staging/30_leave.js` puts the mock's twelve sample requests (`seeds/staging/leave-sample.json`, kept equal to the mock's by a unit test) on the real staff through the leave service, with the same code as the laptop seed (`seeds/lib/leave-sample.js`). Dates now also move off public holidays. §13: the editable fields are confirmed by the demo (the list in §6). §13: the My Attendance asks are built (`docs/guides/attendance.md`), so that item is closed.
- 18/10/2026 · AJ · My Leave's Leave Calendar (the demo's View Calendar; §13 closed): `GET /ess/leave/calendar`, approved and waiting leave for a month, the reader's own and everyone under them in the reporting tree, everyone for the CEO and Operations & People (the team lead, 18/10/2026). §2, §5 and §10 updated.
- 18/10/2026 · AJ · Edit Profile gains a fourth step, Review: each change as before → after (the account by its last four digits), and a note when the bank changes; the Bank step shows the bank and account on record. The leave calendar and My Attendance pick a month by arrows or directly (a year and its months).
- 19/10/2026 · AJ · The photo (§3 step 1): `employee.photo_document_id` (1170), `organisation.photo` (set and clear through the upload engine as an `avatar`, the `employee_photo` read rule for every colleague, `employee.photo_updated`), `POST` and `DELETE /ess/profile/photo`, `photo_url` on `EssProfile` and on sign-in's `/auth/me`. My Profile's Profile Photo and the shell avatar show it; Community and People lists follow with `photo_url` on their rows (their owners). TB to review the organisation and identity parts. §3, §5, §7 and §10 updated.
- 19/10/2026 · AJ · Photos everywhere a person appears (§3 step 1, §6, §10): `photo_url` on `PersonRef` and on the register row, the org chart node and the worksite list, read through one SQL helper (`shared/db/person.js`, 192 px for lists); the app's `usePhotos` fetches each face once. Download My Data (§3 step 8, §5, §6, §7, §8, §10): `POST /ess/profile/export` and the CEO's `POST /employees/:id/data-export`, one workbook emailed and kept 7 days, once a day; replaces "not built". TB to review the organisation, identity, documents/vault and Home parts, GE the Community parts, LA the attendance, devices and worksites parts.
- 19/10/2026 · LA · Work Location Requests (#87) is built on the real API from the attendance guide, which owns it (§6.11, §10): §10.2 row follows its phone layout. Policy Updates (#89) stays on INTERIM shapes until M9 (attendance guide §13).
- 19/10/2026 · LA · My Attendance (#9) shows the person's field assignments in progress and to come, under Today (attendance guide §6.12, §10); §10.2 row updated.
- 19/10/2026 · LA · My Profile's Work Schedule shows each day's place (Office, Remote or Off, `EssWorkDay.place`), read from attendance's week (attendance guide §6.13): People set a hybrid employee's office days on the employee record's Attendance tab, which is the Attendance setup of §2 and §3 step 2.
- 19/10/2026 · AJ · The photo also reaches the employee record's header in People · Employees and Settings · Users and Roles (`Employee360.photo_url`, `UserRow.photo_url`); the organogram PDF is the one place left with initials.
- 19/10/2026 · TB · My Profile's Edit Profile: Home Address suggests addresses as it is typed (`AddressField` over `GET /maps/search`, `docs/guides/foundation.md` §6.13); a pick fills the address only, and what the person types is kept when nothing matches. §10.1 updated.
- 19/10/2026 · TB · My Documents (#14): View File opens a PDF or a photo full screen in the file viewer shared with Staff Community (`MediaViewer`; Download, and Share on a phone), and the preview beside the list draws a PDF's pages in the app with PDF.js, where the browser's own viewer showed nothing on Android and was blocked by the security policy on staging and production (FRONTEND_FOUNDATION §5, PR 3 question 4). §10 updated.
- 19/10/2026 · TB · Download My Data and Download Their Data download on the device that pressed, never by email (`docs/guides/foundation.md` §6.12, TB's decision; §3 step 8, §5, §6, §7, §10): the request reserves the `data_export` file (its person on `subject_employee_id`, which the vault rule now reads) and answers 202 `ExportFile`; the screen waits and saves it. The same asker pressing again that day gets the same file; anyone else is still refused that day, and a failed file does not count. Kept a day, not seven (`export-cleanup` replaces `data-export-cleanup`); no email on the login is no longer refused. The `data-export` email template is gone.
- 19/10/2026 · TB · Bank details changed takes copies in Settings · Notifications
  (`docs/guides/notifications.md` §6): People may copy it to other roles or people, Payroll say.
- 19/10/2026 · LA · Policy Updates (#89) is built on the real API from the attendance guide, which owns it (§6.15, §10): the newest version in plain sentences with what changed and Acknowledge, and all versions; §2, §10.1 and §10.2 rows follow it.
- 19/10/2026 · AJ · My Security's Clock-In Devices card lists the person's devices (registered and new, not removed: name and platform, status, last clock-in, This Device) from `GET /devices/mine`, with Manage My Devices; the phone tile says how many are registered (the team lead, 19/10/2026). §10 updated.
- 20/10/2026 · TB · My Profile's Home Address is picked, never typed (F27, `docs/guides/addresses.md`): Edit Profile opens it from `home_address_place` with Change and a Details line, sends it only when a new place was picked or its details changed, and the organisation service keeps it through `shared/places` (owner `employee.home_address`). Left out, it stays as it is, as every field here. §5 and §10.1 updated.
- 20/10/2026 · TB · Policy Updates (#89) now serves every company policy and is described in `docs/guides/policies.md` (TB's decisions of 20/10/2026); the attendance guide no longer owns it. My Profile's week becomes the person's work schedule from the record's Work Schedule tab (attendance guide §6.13, its PR 3). The broken link to `attendance-guide.md` points at `docs/guides/attendance.md`.
- 20/10/2026 · TB · Attendance's PR 4 built (attendance guide §6.11, §6.12, §10): Work Location Requests (#87) lists the person's temporary sites with Add Work Site and Withdraw Submission, a site opening by `?site=`, and their old requests under them; New Request is gone. My Attendance (#9) shows their temporary sites in place of Field Assignments (an old assignment still in force stays) and each day's route of check-ins. §2 and §10.2 rows updated.

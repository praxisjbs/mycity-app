# Employee Self-Service · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M1 |
| Backend modules | `ess` |
| Frontend paths | `app/src/features/ess/`, `app/src/features/attendance/EssAttendance.tsx` |
| Permission key(s) | `ess` (always `own` scope) |
| Screens (PROGRESS.md rows) | #8 My Profile, #9 My Attendance, #87 Work Location Requests, #88 My Devices, #89 Policy Updates, #10 My Performance, #11 My Payslips, #12 My Leave, #13 My Queries, #14 My Documents, #91 Org Chart, #90 My Security |
| Status | Draft |
| Last changed | 16/10/2026 |

Sources: MILESTONES §6.3 and §18; REUSE_MAP §2.3; the internal workflow meeting of 12 October 2026
(AJ presenting ESS, TB reviewing). The demo (`demo.html`, Employee Self-Service) was updated on
13 October to match this guide, and on 14 October to the screen conventions (FRONTEND_GUIDE §5, §7,
§8); where they differ, this guide wins. Attendance inside ESS (My
Attendance, Work Location Requests, My Devices, Policy Updates) is owned by LA and described in
`docs/MyCity-ERP-Documents/attendance-guide.md`; this guide only says how those tabs sit in ESS.

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
| ESS · My Attendance (`my-attendance`) | Staff app | Every employee, own record | Owned by LA: today, clock events, exceptions (attendance guide §1, §2) | Clock in and out, report an issue, export the month |
| ESS · Work Location Requests (`work-location-requests`) | Staff app | Every employee | Owned by LA | Request a temporary location or exception |
| ESS · My Devices (`my-devices`) | Staff app | Every employee | Owned by LA: devices used to clock in, up to 3 | Register this device |
| ESS · Policy Updates (`policy-updates`) | Staff app | Every employee | Owned by LA: attendance policy versions | Read and acknowledge |
| ESS · My Performance (`my-performance`) | Staff app | Every employee | KPIs this month, the goal chain above them, reviews | Read; open a review; self rating opens with the review cycle (M2) |
| ESS · My Payslips (`my-payslips`) | Staff app | Every employee | Payslips by year, gross, net, deductions, next payday, a preview | Change year, preview a month, download a PDF, email a copy, open the deductions breakdown |
| ESS · My Leave (`my-leave`) | Staff app | Every employee | Entitlement, taken, upcoming, remaining, requests | Request leave, open the leave calendar, open a request or a figure's list |
| ESS · My Queries (`my-queries`) | Staff app | Every employee | Three cards: Open Queries, Archived, Sanctions | Open each list; respond to an open query |
| ESS · My Documents (`my-documents`) | Staff app | Every employee | Their vault: contracts, certificates, ID; signed, verified, expiring, missing | Upload a requested document, preview, download |
| ESS · My Security (`my-security`) | Staff app | Every employee | Password (when it was changed), where they are signed in, recent sign-ins; a link to My Devices. Two-step sign-in, passkeys and the PIN join with the security module | Change password, sign out one device or all the others, open My Devices |
| Shell avatar (rail, phone top bar, More) | Staff app | Every employee | The photo from My Profile, or initials | |
| People · Employees (employee record) | Staff app | People | The same employee record | Where People edit the fields an employee cannot |
| People · Employees · Attendance setup | Staff app | People | Owned by LA: arrangement and weekly schedule | Where the work schedule shown in My Profile is set |
| Payroll · Payslips (M6) | Staff app | Payroll | The payslips ESS shows | Approving a run is what makes a payslip visible in ESS |
| Queries & Sanctions (M3) | Staff app | Managers, People, CEO | The queries and sanctions ESS shows | Raising and deciding them |
| Settings · Security (M9) | Staff app | Admins | Organisation rules for passwords, two-step sign-in, sessions | The rules My Security follows |
| Mobile bottom bar and More | Staff app, phone | Every employee | Self-Service is the fourth place in the bottom bar (F16) | |

## 3 · How the screens relate

1. **Photo.** An employee taps the + on their avatar in My Profile → the file goes through the
   upload engine into the vault → `employee.photo_document_id` is set → the shell avatar, Staff
   Community (celebration cards, profile panel) and People all read it. The + shows only while there
   is no photo; afterwards tapping the photo replaces it.
2. **Work schedule.** People set the arrangement and weekly schedule in People · Employees ·
   Attendance setup (LA) → My Profile shows it inside Employment, read only: each day Office,
   Remote or Off, with hours from the attendance policy (09:00 to 17:00, Saturday 09:00 to 15:00)
   and the place. Attendance judges lateness against the same schedule. One source.
3. **Lateness to payslip.** A late punch raises a query (attendance auto-query, LA) → it appears in
   My Queries · Open → the employee responds within 48 hours → if it is upheld a sanction is
   recorded (My Queries · Sanctions) and any deduction is accepted into the payroll run (M6) → the
   approved payslip shows it in My Payslips, and the Deductions figure opens the list of months with
   deductions, each with its query. If the query is waived nothing is deducted.
4. **Payslips** become visible when Payroll approves and locks the run (normally the 27th). Until
   then the month shows "In the run".
5. **Leave.** A request from My Leave goes to the line manager in one step → approved leave counts
   down the entitlement and is never counted as absence by attendance.
6. **Documents.** People request a document (passport photograph, a certificate) → it shows as
   Missing in My Documents → the employee uploads it → People see it on the employee record. A
   missing document blocks onboarding for a new hire, nothing for a confirmed employee.
7. **Devices.** My Security links to My Devices (LA), where the up to 3 devices are registered. A
   clock-in from any other device is flagged to People.

## 4 · Data

ESS is an aggregator (README §5.1): **no tables of its own**. It reads through other modules'
services, always for the caller's own `employee_id`.

| Table | Key columns | Notes |
|---|---|---|
| `employee` (organisation) | `employee_id`, `phone`, `address`, `next_of_kin`, `bank`, `photo_document_id` | The editable fields are written through the organisation service |
| attendance tables (LA) | see the attendance guide | Read for the work schedule |
| `payslip` (M6) | `payslip_id`, `employee_id`, `period`, `gross`, `net`, `locked_at` | Only locked payslips are returned |
| `leave_request`, `leave_balance` | `employee_id`, `type`, `from`, `to`, `status` | |
| `query`, `sanction` (M3) | `employee_id`, `status`, `outcome`, `deduction` | |
| `document` (vault) | `document_id`, `entity_type`, `entity_id`, `sensitivity` | `restricted` documents are readable by the subject in ESS (BACKEND_STRUCTURE §5) |
| identity and security tables | password, two-step, passkeys, PIN, sessions | Owned by `identity` and `security` |

Migration file(s): none; ESS adds no tables.

## 5 · API

Proposed, all under `/api/v1/ess`, all `own` scope. Writes go through the owning module's service.
Every list is paged at 25 (BACKEND_STRUCTURE §16). Contract in `packages/contract/schemas/ess.js`
(empty today).

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /profile` | → `EssProfile` | `ess` · own | | Includes the work schedule |
| `PATCH /profile` | `EssProfileUpdate` → `EssProfile` | `ess` · own | | Only phone, address, next of kin, bank. Bank change is logged and People notified |
| `POST /profile/photo` | multipart → `EssProfile` | `ess` · own | | Upload engine; image only |
| `GET /payslips` | `EssPayslipQuery` (`year`) → `PayslipPage` | `ess` · own | yes | Locked payslips only |
| `GET /payslips/:id/pdf` | → PDF | `ess` · own | | |
| `POST /payslips/:id/email` | → `{ sent }` | `ess` · own | | To the work email |
| `GET /deductions` | `PageQuery` → `DeductionPage` | `ess` · own | yes | Month, amount, reason, query |
| `GET /leave`, `POST /leave` | → `LeaveSummary`, `LeaveRequestCreate` | `ess` · own | yes | Write through the leave service |
| `GET /queries` | `EssQueryList` (`status`: open, archived) → `QueryPage` | `ess` · own | yes | |
| `POST /queries/:id/response` | `QueryResponse` | `ess` · own | | Through the queries service |
| `GET /sanctions` | `PageQuery` → `SanctionPage` | `ess` · own | yes | |
| `GET /documents`, `POST /documents` | `PageQuery` → `DocumentPage` | `ess` · own | yes | Upload engine and vault |
| `GET /performance` | → `EssPerformance` | `ess` · own | | M2 |

My Security calls the `identity` module's own-account routes (`/auth/security`, `/auth/password`,
`/auth/sessions`; `docs/guides/identity.md` §5), and later the `security` module's (two-step,
passkeys, PIN); they check ownership, not the `settings` grant (README §5.2).

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
- Leave is approved by the line manager in one step; the screen does not say so. The leave
  calendar shows clashes before a request is sent.
- Signed documents carry two hashes (content and artifact) and a public verification link on
  `go.mycityapp.io/verify/<ref>`.
- Changing the password ends the employee's other sessions. The password and session rules are
  `docs/guides/identity.md` §6. Passkeys (later) sign in with a fingerprint or face instead of a
  password; the PIN (later) unlocks the app and confirms a clock-in on a registered device.
- Up to 3 registered devices (attendance guide).
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
| `employee.profile_updated` | After an own-profile change commits | Audit row; for bank details, a notification to People |
| `employee.photo_updated` | After a photo upload | Shell and Community pick up the new avatar |
| `payroll.run_approved` (M6) | Run approved | Payslips become visible; notification "Your payslip is ready" |
| `query.raised` (M3) | Query raised against the employee | Notification opening My Queries |
| `document.requested` | People request a document | Notification opening My Documents |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Their own record only | Everything in §2 for themselves |
| People, managers, CEO | Their own record only, in ESS | Other people's records are in People, Performance, Queries & Sanctions and Payroll |

A query raised against an employee is seen by the employee, whoever raised it, People and the CEO.

Restricted documents (payslips, bank letters, ID) are readable by the subject in ESS and otherwise
only with the owning module's grant.

## 9 · AI and search

- **AI reads** (`ess.ai.js`): the caller's own profile summary, leave balance, latest payslip
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
| ESS · My Profile (`my-profile`) | The photo, or initials with a + to upload; name, role and pills (Confirmed, arrangement, grade, Reports To); Edit Profile, Download My Data, Change Password (opens My Security); Personal (Full Name, Date of Birth, Phone, Work Email, Address); Employment (Job Title, Department, Line Manager, Start Date, Employment Type, Work Arrangement, Status) with the Work Schedule inside it (each day Office, Remote or Off, hours and place; a Set by People pill); Bank Details (Bank, Account Name, masked Account Number); Next of Kin; Record History. Edit Profile: Phone, Address, Next of Kin, Next of Kin Phone, Bank, New Account Number (Optional); Cancel, Save Profile | Help terms on the card titles: Employment, "Only People can change these, including your work schedule."; Work Schedule, "Lateness is measured against these hours."; Bank Details, "Expense refunds are paid into this account. A change is logged and People are notified." On the New Account Number label: "Leave blank to keep the account ending 4417. A bank change is logged and People are notified." | The What You Can Change card (which fields an employee may change; a bank change logged): §6, and Edit Profile offers only those fields. "Every change to this record is written to the audit log": §6, §7. Where the schedule comes from and that approved leave never counts as absence: §3 steps 2 and 5. The page subtitle "What People see, and what you can change yourself" is removed |
| ESS · My Attendance (`my-attendance`) | Owned by LA: the attendance guide §1, §2 | The attendance guide | The attendance guide. ESS strips the "A correction never overwrites a punch" footnote from LA's page (attendance guide §5) |
| ESS · Work Location Requests (`work-location-requests`) | Owned by LA: the attendance guide §6 | The attendance guide | The attendance guide §6 |
| ESS · My Devices (`my-devices`) | Owned by LA: the attendance guide §1 | The attendance guide | The attendance guide §1, §7 (device rules) |
| ESS · Policy Updates (`policy-updates`) | Owned by LA: the attendance guide §7 | The attendance guide | The attendance guide §7 |
| ESS · My Performance (`my-performance`) | "October 2026 · set by Ifeoma Chukwu" (desktop subtitle); KPI Score, On Track, Weight Assigned, Last Review, Next Cycle; My KPIs This Month (each KPI with its bar and progress); Rolls Up To (the goal chain from the organisational goal down to the employee's KPI); My Reviews (Cycle, Self Rating, Manager, Second Level, Status). A review opens Your Rating, Manager, Second Level, Status and, once closed, the Manager Comment | Help term on the KPI Score label: "Your KPIs, weighted to 100%. It updates as the tasks against each KPI close." | The chart caption "Weighted. Your score updates as tasks against each KPI close" became the KPI Score help; the "Five levels… you can see the whole chain" footnote: §6. "Click a review to open it" is removed: rows show as links |
| ESS · My Payslips (`my-payslips`) | The year (‹ year ›), Email a Copy, Download All; Gross, Net Received, Payslips, Deductions (View Details), Next Payday; Payslips, 2026 (Month, Net, Status: Paid, Paid with a deduction, In the run); the selected payslip's PDF preview with Email a Copy and Download PDF. Deductions opens Salary Deductions (Month, Amount, Reason, Query, Outcome; Open My Queries). A month still in the run opens "In This Month's Run, Appears once the run is approved." | None | "This is the document the engine produces": §6. A deduction only from an upheld query, waived means nothing deducted: §3 step 3, §6. No PAYE or pension line: §6. Visible once Payroll approves, normally the 27th: §3 step 4. The Salary Deductions subtitle and "Click a month to preview it" are removed |
| ESS · My Leave (`my-leave`) | "2026 entitlement" (desktop subtitle); View Calendar, Request Leave; Entitlement, Taken, Approved Upcoming, Remaining, each opening its list or request; My Requests (Type, From, To, Days, Approver, Status), a row opens the request; Entitlement by type (allowance, bar, taken, booked, left). Request Leave: Leave Type (Annual, Compassionate, Sick, Unpaid), From and To (DD/MM/YYYY), Note (Optional); Cancel, Send Request | None | "Leave is approved by your line manager in one step" and "The calendar shows clashes before you submit": §3 step 5, §6 |
| ESS · My Queries (`my-queries`) | Open Queries, Archived, Sanctions: a count and one line each; the chosen list under them (desktop) or in a sheet (phone): "No Open Queries, Nothing is waiting on you."; Archived Queries (Subject, Raised By, Date, Your Response, Outcome); Sanctions (Sanction, Reason, Date, Deduction, Status) | None | The 48 hours to respond: §3 step 3 (an open query shows its own due time). "Most queries close with no action", the response kept beside the decision, disagreement read before the decision: §6. Who can see a query: §8. A deduction only after an upheld sanction: §3 step 3. The flowchart and the page subtitle are removed |
| ESS · My Documents (`my-documents`) | Upload Document; Documents, Signed, Verified, Expiring, Missing; Vault (Document, Uploaded, Status, Expires); a row opens the document (Uploaded, Status, Expires; Upload Document on a missing one); the contract's PDF preview | None | "Signed documents carry two hashes and a public verification link": §6. A missing document blocks onboarding only for a new hire: §3 step 6, §11. The "Your vault" subtitle and "Click any row to preview it" are removed |
| ESS · My Security (`my-security`) | Password (when it was changed, or Not changed yet; Change Password); Clock-In Devices (Open My Devices); Signed In (Device with its address, Signed In, This Device or Sign Out; Sign Out Others when there are others); Recent Sign-Ins (When, Device, Address, Status: This Device, Signed In, or how it ended). Change Password: Current Password, New Password, Confirm New Password; Cancel, Change Password. Sign Out on a device and Sign Out Others ask first | None | The page subtitle "How you sign in, and the devices you clock in from" is removed. Where devices are managed and the flag on others: §3 step 7. The password rules, the other sessions ending on a change, and the session limits: `docs/guides/identity.md` §6. Two-step sign-in, passkeys and the PIN come with the security module |
| Shell avatar (rail, phone top bar, More) | The photo from My Profile, or initials | None | Where the photo is stored and who reads it: §3 step 1 |
| People · Employees (employee record) | Owned by People: that module's guide | That module's guide | That module's guide |
| People · Employees · Attendance setup | Owned by LA: the attendance guide §3 | The attendance guide | The attendance guide §3 |
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
| ESS · My Profile (`my-profile`) | Edit Profile beside the title; the profile card (photo with +, name, role, pills, Download My Data, Change Password); then icon cards two to a row: Personal, Employment (with the work schedule), Bank Details, Next of Kin, Record History | Every card's detail: each icon card opens it as a bottom sheet, with its help terms; the Prototype View switch | Edit Profile opens the form as a full sheet, Save Profile full width at its foot | ESS from the menu drawer; the tabs along the top scroll sideways |
| ESS · My Attendance (`my-attendance`) | ESS draws it from LA's page: the header, banners and stat cards on top, then every card or table as an icon card | The cards' detail, each in a bottom sheet where LA's buttons keep working; LA's footnote | As the attendance guide | As My Profile |
| ESS · Work Location Requests (`work-location-requests`) | As My Attendance: header and banners, then icon cards | As My Attendance | New request, as the attendance guide | As My Profile |
| ESS · My Devices (`my-devices`) | As My Attendance: header, then icon cards | As My Attendance | Register this device, as the attendance guide | As My Profile |
| ESS · Policy Updates (`policy-updates`) | As My Attendance: header, the announcement and stat strip, then icon cards | As My Attendance | Acknowledge, as the attendance guide | As My Profile |
| ESS · My Performance (`my-performance`) | The five stats two to a row (KPI Score's help opens as a sheet), then icon cards: My KPIs This Month, Rolls Up To, My Reviews | The subtitle; the reviews table (a list of reviews in the My Reviews sheet) | Tap a review: its sheet | As My Profile |
| ESS · My Payslips (`my-payslips`) | The year switcher (44 px targets), Email a Copy, Download All; the stats two to a row; then the months as a list with a status pill | The subtitle and the preview beside the list: a month opens its preview as a sheet with Email a Copy and Download PDF | Download PDF, at the foot of the month's sheet | As My Profile |
| ESS · My Leave (`my-leave`) | View Calendar, Request Leave; the four KPI cards two to a row, each opening its list as a sheet; icon cards My Requests and Entitlement | The subtitle; the requests table (a list in the My Requests sheet); the entitlement card (its sheet) | Request Leave opens the form as a full sheet, Send Request full width | As My Profile |
| ESS · My Queries (`my-queries`) | The three cards, one to a row | The lists: each card opens its list as a sheet (archived queries and sanctions as cards) | Tap a card | As My Profile |
| ESS · My Documents (`my-documents`) | Upload Document; the five stats; the documents as a list with a status pill | The contract preview beside the list: a document opens its preview or details as a sheet | Upload Document; on a missing document, Upload Document in its sheet | As My Profile |
| ESS · My Security (`my-security`) | Icon cards two to a row: Password, Signed In, Recent Sign-Ins, Clock-In Devices | Every card's detail, each in a sheet (the sign-in lists as cards) | Change Password opens its form as a full sheet, the primary full width | As My Profile |
| Shell avatar (rail, phone top bar, More) | The avatar at the right of the phone top bar; it opens More, whose top row is the person with Theme, Density and Settings | The rail itself | None | The phone top bar |
| People · Employees (employee record) | Owned by People | That module's guide | That module's guide | That module's guide |
| People · Employees · Attendance setup | Owned by LA | The attendance guide | The attendance guide | The attendance guide |
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
- **My Attendance**: the 12 October notes give AJ a month picker, a chart and table toggle, the
  lateness percentage on the Late card and clickable cards paged at 25. LA's My Attendance does not
  have them yet. LA and AJ to agree who adds them.
- **My Payslips visibility** while Payroll is an advanced option: hide the tab, or show Coming Soon?
- **Editable fields**: confirm the list in §6 with Cynthia (phone and address were the examples).
- **Leave calendar**: whose calendar it shows (own, team) and across which years.

## 14 · Change log

- 13/10/2026 · AJ · First version, from the 12 October internal workflow meeting, MILESTONES §6.3 and the 13 October demo update.
- 13/10/2026 · AJ · §10: phone layout for the four attendance tabs (icon cards that open the modal), built from LA's page.
- 13/10/2026 · AJ · §6: page footnotes removed from ESS (My Documents, My Queries, My Attendance).
- 14/10/2026 · TB · §10 rewritten to the template's content tiers and phone layout tables, from the demo as rebuilt to the screen conventions (FRONTEND_GUIDE §5, §7, §8): the What You Can Change card, the descriptive page subtitles, the chart caption, the footnotes and the Coming Soon feature list left the screen; support text became help terms on the word it explains; the leave, password and PIN forms and a new Edit Profile form use the form helpers. §2 and §6 now match, §6 gained the facts the removed text carried, §8 says who sees a query, and the ⓘ line in §6 became help terms and the Details row.
- 15/10/2026 · AJ · Five tabs ratified (#87 to #91). All twelve ESS tabs built in `app/` against the mock API, desktop and phone; not wired to the API yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions: explainer cards and footnotes gone; Edit Profile is a three-step wizard; password, PIN, query response and device forms mark their fields on Submit instead of disabling it; Policy Updates shows the version and its changes as content.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): Self-Service is a place in the phone's bottom bar (F16) and the avatar sits in the phone top bar, opening More (F17); the menu drawer is gone. §2 and §10 rows brought into line; no ESS screen changed.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): every list on these screens is `DataView` (cards on a phone as before, with server sort where the contract allow-lists it), the KPI tiles are `KpiCard` (My Leave's still open only on a phone), the payslip and document previews are `Paper` and `DocumentPreview` (a PDF in the browser's own viewer, with Open in Tab and a Download card where it cannot be shown), and My Record History is the shared `Timeline`. §10 is unchanged.
- 16/10/2026 · TB · My Security runs on the real API (`identity` module; `docs/guides/identity.md`): Password, Signed In with Sign Out per device and Sign Out Others, Recent Sign-Ins, the Clock-In Devices link. Two-step sign-in, passkeys and the PIN left the screen until the security module (the second sign-in PR); §2, §5, §6 and both §10 rows say so. New passwords follow the contract's rule (8 characters with mixed case, a number and a symbol), not 12.

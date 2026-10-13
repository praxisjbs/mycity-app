# Employee Self-Service · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M1 |
| Backend modules | `ess` |
| Frontend paths | To be set when the frontend foundation lands (AJ). |
| Permission key(s) | `ess` (always `own` scope) |
| Screens (PROGRESS.md rows) | #8 My Profile, #9 My Attendance, #10 My Performance, #11 My Payslips, #12 My Leave, #13 My Queries, #14 My Documents; My Security (not yet in the approved inventory, see §13) |
| Status | Draft |
| Last changed | 13/10/2026 |

Sources: MILESTONES §6.3 and §18; REUSE_MAP §2.3; the internal workflow meeting of 12 October 2026
(AJ presenting ESS, TB reviewing). The demo (`demo.html`, Employee Self-Service) was updated on
13 October to match this guide; where they differ, this guide wins. Attendance inside ESS (My
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
| ESS · My Profile (`my-profile`) | Staff app | Every employee, own record | Photo, personal details, employment details with the **work schedule**, bank, next of kin, what they can change, record history | Upload or change their photo; edit phone, address, next of kin and bank details; download their data |
| ESS · My Attendance (`my-attendance`) | Staff app | Every employee, own record | Owned by LA: today, clock events, exceptions (attendance guide §1, §2) | Clock in and out, report an issue, export the month |
| ESS · Work Location Requests (`work-location-requests`) | Staff app | Every employee | Owned by LA | Request a temporary location or exception |
| ESS · My Devices (`my-devices`) | Staff app | Every employee | Owned by LA: devices used to clock in, up to 3 | Register this device |
| ESS · Policy Updates (`policy-updates`) | Staff app | Every employee | Owned by LA: attendance policy versions | Read and acknowledge |
| ESS · My Performance (`my-performance`) | Staff app | Every employee | KPIs this month, the goal chain above them, reviews | Read; self rating opens with the review cycle (M2) |
| ESS · My Payslips (`my-payslips`) | Staff app | Every employee | Payslips by year, gross, net, deductions, next payday, a preview | Change year, preview a month, download a PDF, email a copy, open the deductions breakdown |
| ESS · My Leave (`my-leave`) | Staff app | Every employee | Entitlement, taken, upcoming, remaining, requests | Request leave, open the leave calendar |
| ESS · My Queries (`my-queries`) | Staff app | Every employee | Three cards: Open Queries, Archived, Sanctions | Open each list; respond to an open query |
| ESS · My Documents (`my-documents`) | Staff app | Every employee | Their vault: contracts, certificates, ID; signed, verified, expiring, missing | Upload a requested document, preview, download |
| ESS · My Security (`my-security`) | Staff app | Every employee | Password, two-step sign-in, passkeys, PIN, recent sign-ins; a link to My Devices | Change password, set up two-step sign-in, add a passkey, set a PIN |
| Shell avatar (rail and top bar) | Staff app | Every employee | The photo from My Profile, or initials | |
| People · Employees (employee record) | Staff app | People | The same employee record | Where People edit the fields an employee cannot |
| People · Employees · Attendance setup | Staff app | People | Owned by LA: arrangement and weekly schedule | Where the work schedule shown in My Profile is set |
| Payroll · Payslips (M6) | Staff app | Payroll | The payslips ESS shows | Approving a run is what makes a payslip visible in ESS |
| Queries & Sanctions (M3) | Staff app | Managers, People, CEO | The queries and sanctions ESS shows | Raising and deciding them |
| Settings · Security (M9) | Staff app | Admins | Organisation rules for passwords, two-step sign-in, sessions | The rules My Security follows |
| Mobile bottom bar and menu | Staff app, phone | Every employee | ESS from the menu drawer | |

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

My Security calls the `security` and `identity` modules' own-account routes (password, two-step,
passkeys, PIN, sessions); they check ownership, not the `settings` grant (README §5.2).

## 6 · Rules and calculations

- Every ESS read and write is for the caller's own employee record. There is no parameter that
  selects another employee.
- An employee may change phone, address, next of kin, bank details and photo. Job title, salary,
  line manager and work schedule are changed only by People. Every change is audited; a bank
  change also notifies People.
- The work schedule is read only in ESS and comes from attendance; hours come from the attendance
  policy in force.
- A payslip is visible only once its run is approved and locked.
- MyCity runs simple payroll: staff are treated as contractors and consultants, so no screen
  mentions PAYE or pension, and Payroll sits behind an advanced option (12 October).
- A deduction reaches a payslip only from an upheld query. The Deductions figure opens every month
  that carried one, with its query reference.
- My Queries shows three cards: Open Queries, Archived, Sanctions. The build flowchart is not shown
  to staff (TB, 12 October).
- Leave is approved by the line manager in one step; the screen does not say so.
- Up to 3 registered devices (attendance guide).
- Coming Soon: a tab whose module is not yet delivered shows a Coming Soon page naming the milestone
  and date (My Performance M2, My Queries M3, My Payslips M6). The demo has a toggle for it.
- Copy a person reads: Title Case chrome, no em dashes, day-first dates, 25 per page.
- No footnote at the bottom of a page. Explanations live inside the card they explain, or behind an ⓘ.

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

Restricted documents (payslips, bank letters, ID) are readable by the subject in ESS and otherwise
only with the owning module's grant.

## 9 · AI and search

- **AI reads** (`ess.ai.js`): the caller's own profile summary, leave balance, latest payslip
  summary, open queries count. Never another person's record. Paged at 25.
- **AI routes**: "my payslip" → My Payslips; "request leave" → My Leave · Request Leave; "change my
  password" → My Security; "upload my photo" → My Profile.
- **Search** (`ess.search.js`, ⌘K): the tabs by name and the words people use: payslip, salary
  slip, leave, holiday, query, sanction, documents, contract, password, two-step.

## 10 · Mobile

Mobile is its own layout (gate 11). On a phone each tab shows **icon cards with a short summary**
and opens the detail in the shared modal (a bottom sheet), so there is little text at first glance:

- **My Profile**: cards for Personal, Employment (with the work schedule), Bank, Next of Kin, What
  You Can Change, Record History.
- **My Performance**: My KPIs This Month, Rolls Up To, My Reviews.
- **My Payslips**: a list of months; tapping one opens its preview with Email Me a Copy and Download.
  No preview hangs on the page.
- **My Leave**: the four stat cards stay at the top, then My Requests and Entitlement cards.
- **My Queries**: the three cards.
- **My Documents**: a list; tapping a document opens its preview.
- **My Security**: Password, Two-Step Sign-In, Passkeys, PIN, Devices, Sign-In Activity.
- **My Attendance, Work Location Requests, My Devices, Policy Updates** (LA): the header, banners and
  stat cards stay on top; every card or table becomes an icon card that opens it in the modal. Built
  from LA's own page, so her screens and data stay the one source and her buttons work in the modal.
- The rail opens as a drawer from the menu button.

On desktop the sections show in full; only the Deductions breakdown opens a modal.

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

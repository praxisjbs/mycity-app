# Attendance · Engineering Guide

| | |
|---|---|
| Owner | LA |
| Milestone | M1 |
| Backend modules | `attendance` |
| Frontend paths | `app/src/features/attendance/` |
| Permission key(s) | `attendance` |
| Screens (PROGRESS.md rows) | #9 My Attendance, #25 Attendance, #27 Devices, #28 Worksites, #73 Attendance Policy |
| Status | Draft |
| Last changed | 15/10/2026 |

This guide records the attendance behaviour demonstrated in `docs/MyCity-ERP-Documents/demo.html`.
The demo date is 9 October 2026 and its displayed times use Africa/Lagos.

---

## 1 · What it is for

Attendance lets employees record the beginning and end of a workday from an approved location. It
also gives line managers and People/HR a review trail for remote work, field assignments, missing
punches, location exceptions and policy changes without overwriting the original evidence.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Clock In / Clock Out modal (`clock`) | Global header and sign-in | Active employees | Shift, expected location, verification result and current system time | Clock in or out, retry location, or provide exception details |
| ESS · My Attendance (`my-attendance`) | Employee Self-Service | Employee, own scope | Today, history, hours, status and review references | Review own record and open relevant cases |
| ESS · Work Location Requests (`work-location-requests`) | Employee Self-Service | Employee, own scope | Draft, pending, approved and expired requests | Request a temporary home, remote day, client visit or field correction |
| ESS · My Devices (`my-devices`) | Employee Self-Service | Employee, own scope | Enrolled and pending attendance devices | Request device enrolment |
| ESS · Policy Updates (`policy-updates`) | Employee Self-Service | Employee, own scope | Published versions, changes and acknowledgment | Read and acknowledge an attendance policy |
| People · Employees (`employees`) | People | Authorised People users | Work arrangement and attendance setup | View or change arrangement and approved home geofence |
| People · Attendance (`attendance`) | People | People/HR; managers see team scope | Register, assignments, requests and manager recommendations | Review a day, approve locations and open Reconcile |
| People · Devices (`devices`) | People | Authorised People users | Device history and review state | Enrol, block or revoke a device |
| People · Worksites (`worksites`) | People | Authorised People users | Offices, coordinates, radii and status | Add or retire a worksite |
| Settings · Attendance Policy (`attendance-policy`) | Settings | Authorised People users | Draft and published attendance rules | Edit, review and publish a version |
| Notifications and Alerts (`notifications`) | Global header | Recipient within their scope | Attendance events requiring information or action | Open the relevant record or review screen |

## 3 · How the screens relate

1. People assigns an employee's work arrangement, schedule, office and approved home coordinates.
2. At sign-in, an active employee without a clock-in sees the Clock In modal. A suspended employee
   cannot enter the app; an employee on approved leave can enter permitted screens but cannot punch.
3. The attendance service resolves the expected location from an effective field assignment,
   approved location request, hybrid schedule, registered home or assigned office.
4. A punch stores fresh location and device evidence and appears in ESS and the People register.
5. A non-compliant or incomplete record creates a reconciliation case and actionable notifications.
6. A manager may add a recommendation for their direct report. People/HR makes the final attendance
   decision in Reconcile; the original punch remains visible beside any adjustment.
7. Published policy changes notify affected employees and appear in ESS · Policy Updates.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `attendance_session` | `session_id`, `employee_id`, `work_date`, `arrangement`, `expected_location_id`, `policy_version` | One calculated workday; points to immutable events |
| `attendance_event` | `event_id`, `session_id`, `kind`, `server_at`, `device_at`, `latitude`, `longitude`, `accuracy_m`, `result` | Original clock evidence is append-only |
| `attendance_location` | `location_id`, `employee_id`, `kind`, `address`, `latitude`, `longitude`, `radius_m`, `valid_from`, `valid_to`, `status` | Permanent and temporary home locations; home radius is 100 m |
| `attendance_assignment` | `assignment_id`, `employee_id`, `date`, `starts_at`, `ends_at`, `sites`, `approver_id`, `status` | An approved field assignment overrides the normal location |
| `attendance_location_request` | `request_id`, `employee_id`, `type`, `valid_from`, `valid_to`, `location`, `reason`, `status` | Carries employee request, manager recommendation and HR decision |
| `attendance_case` | `case_id`, `session_id`, `type`, `status`, `employee_explanation`, `manager_note`, `outcome` | Reconciliation history and supporting evidence |
| `attendance_policy_version` | `version`, `published_at`, `effective_from`, `settings`, `published_by` | Old records retain the version used when evaluated |
| `attendance_policy_ack` | `version`, `employee_id`, `read_at`, `acknowledged_at` | Drives employee update and HR acknowledgment report |

Migration file(s): to be assigned in the M1 attendance migration block.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /api/v1/attendance/punches` | Clock action and fresh evidence → punch result | `attendance` · own | no | Requires an idempotency key; server time is authoritative |
| `GET /api/v1/attendance/me` | Date range → own sessions | `attendance` · own | yes, 25 | Supports month export separately |
| `GET /api/v1/attendance/register` | Date, arrangement and status filters → register page | `attendance` · team/all | yes, 25 | Managers are restricted to direct reports |
| `POST /api/v1/attendance/location-requests` | Temporary-location request → request | `attendance` · own | no | Employee cannot choose a home radius |
| `POST /api/v1/attendance/location-requests/:id/recommendation` | Manager decision and note → request | `attendance` · team | no | Recommendation is advisory unless policy makes it mandatory |
| `POST /api/v1/attendance/cases/:id/decision` | Reconciliation outcome → adjusted result | `attendance` · all | no | Appends an adjustment; never edits the source event |
| `GET /api/v1/attendance/policies` | Published policy versions | `attendance` · own/all | yes, 25 | Own view contains only applicable versions |

## 6 · Rules and calculations

- A remote day uses the employee's active approved home coordinates and a mandatory 100 m fence.
- An approved temporary home applies only from its start date through its end date; the permanent
  home resumes automatically afterward.
- An approved field assignment overrides the normal office or home for its approved date and window.
- Distance is calculated between captured and approved coordinates; a result equal to the radius is
  inside, and any greater distance is outside.
- GPS accuracy of 50 m or better is good by default. Accuracy above 100 m requires a retry and does
  not produce a compliant geofence decision.
- Missing coordinates, denied permission or unavailable location are explicit unverified outcomes.
- Duplicate clock-ins and clock-outs without an open clock-in are refused using server-side
  idempotency and database uniqueness in production.
- Deduction and overtime tiers are independent. Disabling one preserves its configured tiers.
- Attendance never applies a monetary deduction or sanction automatically.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `attendance.punched` | A punch commits | Updates own attendance and the authorised register; sends confirmation |
| `attendance.review_required` | Evidence is non-compliant or incomplete | Creates a case and notifies People/HR and the employee |
| `attendance.location_request.submitted` | Employee submits a request | Notifies the assigned line manager, then People/HR |
| `attendance.location_request.decided` | People/HR approves or rejects | Notifies the employee and activates an approved location for its dates |
| `attendance.policy.published` | A policy version is published | Notifies affected employees and creates acknowledgment rows |
| Missing-punch checks | 11:00 same day / next morning per policy | Opens reconciliation cases without inventing punch times |

Notification destinations are permission-aware and open the relevant request, device, policy or
reconciliation record.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Own attendance, requests, devices and policies | Clock, request a temporary location, acknowledge policy, explain a case |
| Line manager | Attendance and pending recommendations for direct reports | Recommend a request or correction and confirm an assignment |
| People / HR | Organisation register and attendance administration | Configure homes, approve requests, reconcile and publish policy |
| CEO / authorised Operations | Organisation scope where explicitly granted | Review or decide without self-approving their own request |
| Finance / Payroll | Reviewed pay-impact outcomes only | Accept or waive an authorised payroll proposal |

Full home addresses and coordinates are restricted to authorised People users. Register and map
views show masked area labels. Every full-address view is audited.

## 9 · AI and search

- **AI reads** (`attendance.ai.js`): own attendance for employees, team attendance for managers and
  organisation summaries for authorised People users; every list is paged at 25.
- **AI routes**: clock status opens ESS · My Attendance; pending reviews open People · Attendance or
  Reconcile according to permission.
- **Search** (`attendance.search.js`): employees, request references, assignment references,
  reconciliation references and policy versions. Search results apply the same own/team/all scope.
- AI does not create punches, approve exceptions, change policy or infer missing location evidence.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). §3 and §6 are for engineers; only what is listed here reaches a screen.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Clock In / Clock Out modal | Shift, work arrangement, clock location and radius, current time, the verification result; Clock In or Clock Out, Retry Location, Report Issue, Not Now | None; the policy line says only that the latest version needs acknowledgment | "location is read only and not continuously tracked", "one time and location reading will be recorded", blocked and rejected stage explanations: §6 and §11 here |
| ESS · My Attendance | Today, history, net hours, status and review references | Clock In row: the time is the system time, not the phone's clock | "a correction never overwrites a punch": §6 |
| ESS · Work Location Requests | Active location, requests and their status; New Request | Active Location row: a temporary location applies for its dates, then the permanent home; request Address label: 100 m home radius against the field radius | "How a request moves" card, "goes to your line manager", the simulated map pin note: §3 |
| ESS · My Devices | Approved devices and every device with its status; Register This Device | Approved Devices title: an enrolled device raises no warning; Status header: what new, revoked and blocked mean | "How device checks work" card, the People review and identifier sentences: §6 |
| ESS · Policy Updates | Published versions, what changed, acknowledgment state; Acknowledge | None | "records before that date are never recalculated": §6 |
| People · Employees (attendance setup) | Work arrangement, approved home geofence; Change Arrangement, Edit Home | None | Arrangement explanations: §6 |
| People · Attendance | KPI cards, the view switch, register, field assignments, location requests, manager preview; Reconcile | Needs Reconciliation KPI: what reconciliation records and where breaches go; Valid header (assignments); Status header (requests); the Outcome field when deciding a record | The page explainer, "Click a row for every recorded field", the reconcile footnote, "What a manager can and cannot do": §3, §6, §8 |
| People · Devices | Device list with first seen, last punch, next punch and status; Device Policy, Enrol Device | Next Punch header: the effect under the current policy | "How the current device policy affects a punch" card, "devices register on every punch": §6 |
| People · Worksites | Office worksites, approved homes, field sites, outside-fence count, the location list; Add Field Assignment, Add Worksite | Address header: homes show the area only, People and the CEO open the full address; Enforcement Mode header | "How the geofence behaves" and "Why homes are masked" cards, the HR detail audit banner: §6, §8 |
| Settings · Attendance Policy | The six setting groups, configured tiers, acknowledgment report, policy versions; Discard, Review and Publish Changes, Reset Demo Data | A help term on each setting's name; "draft" in the draft bar; the outside-geofence modes as a closed Details row; Effective Date: no recalculation, no backdating | Every card footnote (seeded values, independent toggles, no automatic deduction, no overtime rates), "Employees have not been told": §6, §13 |
| Settings · Audit Log | Entries today and this month, attendance entries, recent entries | Retention KPI: append only, archived after seven years | "What append only means" card, the chart caption: §7 |
| Notifications and Alerts | Each alert or notification and the record it opens | None | What an alert is, what staff were sent, what a notification is: §7 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Clock In / Clock Out modal | A full sheet: shift, location, current time, the result | Nothing | Clock In or Clock Out, full width at the foot | Opens from the top bar clock button |
| ESS · My Attendance | Today's card, then history as cards | Subtitle, chart captions | None; a card opens its record | Bottom bar Work; ESS tabs scroll sideways |
| ESS · Work Location Requests | The active location card, then request cards | Subtitle | New Request opens a full sheet | ESS tabs |
| ESS · My Devices | Approved devices as cards | Subtitle | Register This Device | ESS tabs |
| ESS · Policy Updates | The latest version card with its changes | Subtitle | Acknowledge, full width | ESS tabs |
| People · Employees (attendance setup) | The employee sheet with arrangement and home | Nothing | Change Arrangement, Edit Home | From the Employees card list |
| People · Attendance | KPI cards two to a row, the view switch scrolling sideways, filters scrolling sideways, then register cards per employee with status, clock in and out, expected and matched location, device and exception | Open Clock Panel (the top bar clock does the same), subtitle, chart captions | Reconcile, full width in the header | Bottom bar People; tapping a register card opens the full evidence |
| People · Devices | Device cards with status | Subtitle | Enrol Device | People tabs |
| People · Worksites | KPI cards, then location cards | The Lagos geofence map | Add Worksite | People tabs |
| Settings · Attendance Policy | The draft bar, then setting groups with label and value pairs | Header Reset button, the raw tier tables | Publish Policy in the draft bar | Settings tabs |
| Settings · Audit Log | KPI cards, then entry cards, 25 per page | Chart caption | None | Settings tabs; Previous and Next |
| Notifications and Alerts | The bell sheet with the three tabs | Tab explanation lines | Open the record | Top bar bell |

## 11 · Edge cases

- Suspended employee: terminate or reject the session and deny direct navigation and punches.
- Approved leave: permit allowed app features but reject clock-in and clock-out with the leave dates.
- Missing home coordinates: reject remote verification and direct the employee to People/HR.
- GPS denied, unavailable or insufficiently accurate: never mark the punch compliant; retry or review.
- Outside geofence: retain original evidence and show Pending HR review until a decision is recorded.
- Temporary location expiry: revert to the permanent home automatically and retain both in history.
- Duplicate submission or concurrent request: return the original idempotent result.
- Offline: production behaviour is unresolved; the browser demo does not queue punches.
- Demo reload: interactive demo punches reset so presentations start at Clock In; production records
  must remain durable.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| MyCity attendance demo | `docs/MyCity-ERP-Documents/demo.html` | Replace localStorage, simulated GPS and front-end identity checks with authenticated APIs, trusted server time and durable evidence storage |

No external donor attendance implementation has been approved for M1.

## 13 · Open questions

- Which production geocoding and map provider will validate employee and worksite coordinates?
- Must a line manager recommendation be mandatory before People/HR decides a location request?
- What offline behaviour, if any, is acceptable for field employees?
- Which monetary overtime and deduction rates will Finance approve? The demo intentionally defines none.
- Which frontend feature path will replace the provisional `app/src/attendance/` path?

## 14 · Change log

- 14/10/2026 · LA · Added the template metadata, engineering sections, mobile register behaviour and ownership-ready scope required by the guide check.
- 14/10/2026 · TB · §10 rewritten to the On screen and mobile shape (content tiers and phone layout) for the screen conventions in FRONTEND_GUIDE §5 and §7; the phone register cards from this guide are kept.
- 15/10/2026 · AJ · Frontend built in `app/src/features/attendance/` and Settings · Attendance Policy (draft, review, publish, acknowledgement report) against the mock API; not wired yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions (FRONTEND_GUIDE §5, §7, §8): the ⓘ texts and explainer cards (how requests are decided, why devices are recorded, the geofence and masked-home cards, what a manager can do) are gone; setting help is a help term on its label; Add Field Assignment is a two-step wizard; every form marks its fields on Submit instead of disabling it; lists are cards on a phone. Gates 8 and 11 now crawl these screens.

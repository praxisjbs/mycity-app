# Attendance · Engineering Guide

| | |
|---|---|
| Owner | LA |
| Milestone | M1 |
| Backend modules | `attendance`, `devices`, `worksites` |
| Frontend paths | `app/src/features/attendance/` |
| Permission key(s) | `people` (all, team, own) for the register, devices and worksites; `people` approve, within its scope, to set a field assignment; `people` edit, within its scope, to set a hybrid employee's work schedule; none for the person's own clock, attendance and devices (`self`, own only) |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #9 My Attendance, #87 Work Location Requests, #88 My Devices, #25 Attendance, #27 Devices, #28 Worksites, and the Attendance tab of the employee record (#24 Employees); later in this guide: #89 Policy Updates; #73 Attendance Policy is M9 (MILESTONES §18) |
| Status | Draft |
| Last changed | 19/10/2026 |

Sources, in their order of authority (CLAUDE.md step 3): MILESTONES §6.2 and A22, A26; REUSE_MAP §2.2
(the policy model and the donor files); the 12 and 13 October meetings (three devices, enrolment
without People's approval, the 100 m office fence); BACKEND_STRUCTURE §15 (the device's own time
beside the server's). `demo.html` is look only.

---

## 1 · What it is for

Attendance lets an employee clock in and out from the place they are expected to work (their
worksite, for remote staff the home People approved, and for hybrid staff one or the other by the
weekly schedule People set), on a device they registered, and gives
People and line managers a register of who is in, late, absent or on leave, with the evidence behind
every punch. An employee who will work somewhere else for some days (a temporary home, a remote day,
a client's site with its location) asks first, and once their line manager and then People approve,
those days' punches are matched to that instead. When the organisation sends people out (an event, a client's
venue), their line manager or People set a field assignment, and on its days their punches are
matched to its sites. A punch the rules cannot accept outright is still
recorded, as evidence, and opens an exception People review; nothing is overwritten.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Clock In / Clock Out panel (`clock`) | Desktop top bar, the phone's floating button, opened by Home · Overview when the first session of a working day opens it, and by itself at the shift's start and end (§6.14) | Every employee, own record | Today's date and time at the workplace, the shift, the clock location and radius, the state (Clocked Out, Clocked In since, Review Required), this device's state, the result of a punch, a day clocked out automatically | Clock in or out, allow location, retry location, register this device, add a note to a punch under review; at the shift's end, Remind Me in 15 minutes, 30 minutes or an hour |
| ESS · My Attendance (`my-attendance`) | Employee Self-Service | Every employee, own record | Today, the month's figures, the days of the month, each day's punches (a clock-out the system made reads Automatic), open exceptions; for remote staff, their home location (approved, waiting or not set); their field assignments, today's and those to come | Pick a month, open a figure's days, switch the days between a table and a chart, open a day, explain an exception or an automatic clock-out, export the month, open a field assignment; remote staff set their home location from home, for People to approve |
| ESS · My Devices (`my-devices`) | Employee Self-Service | Every employee, own devices | The devices they clock in from, each with its status, up to three registered | Register this device, remove one of theirs |
| People · Attendance (`attendance`) | People | `people` view: Operations & People and Management everyone, line managers and heads their team | The day's figures, the register, a day's evidence (each punch's source: Clock, Added by People, Automatic), exceptions, remote staff's home locations, work location requests, field assignments | Pick a day, filter, open a person's day, decide an exception (scope all, `people` approve), approve or reject a home location (scope all, `people` approve), approve or reject a work location request waiting on them (the line manager, then Operations & People), set a field assignment for people in their scope, cancel it or take someone off it (`people` approve, within scope), export the register |
| People · Devices (`devices`) | People | `people` view, within scope | Every device used to clock in, its owner and status | Remove a device (`people` edit) |
| People · Worksites (`worksites`) | People | `people` view | Offices with their centre, radius and who is assigned | Add, change, retire and restore a worksite (`people` create, edit); assign employees |
| People · Employees, the record's Attendance tab | People | `people` view, within scope | The person's work pattern, their office and radius, their home location's state, and their week: each day Office, Remote or Off; for hybrid staff the schedule in force and one waiting to start | Set Schedule for a hybrid employee (`people` edit, within scope, never their own) |
| ESS · My Profile (`my-profile`, ess.md) | Employee Self-Service | Every employee, own record | Inside Employment, the week: each day Office, Remote or Off with its hours (read from this module) | Nothing here: People set it |
| ESS · Work Location Requests (`work-location-requests`) | Employee Self-Service | Every employee, own requests | Their requests with number, type, dates, place and status (waiting at its stage, Approved, Rejected, Cancelled), each with its approval trail | New Request: a temporary home (remote staff), a remote day (on-site and hybrid staff) or a client visit (anyone, with the site's location and radius); withdraw one still waiting, or cancel an approved one before its first day |
| ESS · Policy Updates (`policy-updates`) | Employee Self-Service | Employee, own | Not built in this delivery: M9, with Settings · Attendance Policy (§13) | |
| Settings · Attendance Policy (`attendance-policy`) | Settings | Authorised People users | M9 (MILESTONES §18); the policy is read from the database meanwhile (§6.1) | |
| Notifications (bell) | Global header | The person and People within scope | A reminder to clock in when the shift starts, a clock-out made automatically, review needed, a missing clock-out, a decision on an exception, a device registered or removed, a home location waiting or decided, a work location request waiting on you or decided, a field assignment you are put on, taken off or that is cancelled, your work schedule set | Open the record |

## 3 · How the screens relate

1. People add a worksite (People · Worksites) with its centre, radius and timezone, and assign the
   employees who work there. The employee's worksite is `employee.worksite_id`, written through the
   organisation service; an effective `employee_attendance_policy` row can override it and the policy.
   For a hybrid employee People then set the week (the employee record's Attendance tab, Set
   Schedule): which working days are at the office, from a date, with a reason. The other working
   days are worked from home, fenced on the approved home as a remote employee's are (§6.13). The
   person is told, and My Profile shows the week.
2. An employee registers the browser they clock in from (ESS · My Devices, Register This Device). It
   is the device identity sign-in already keeps (`known_device`, from the device cookie), confirmed
   by a fresh sign-in (`security.assertFresh`), at most three at a time. A remote employee, and a
   hybrid employee whose schedule has home days, also sets
   their home location from home (ESS · My Attendance, Set Home Location): one location reading taken
   when they press Use This Location, and their address as they write it. It waits for People
   (People · Attendance, Homes), who approve or reject it, never their own. The approved home is the
   remote employee's fence (§6.5, §6.10); a new one waits while the old one stays in force, and
   replaces it only once approved. An employee who will work somewhere else for some days asks
   first (ESS · Work Location Requests, New Request): a temporary home (remote staff, with one
   reading taken there), a remote day (on-site and hybrid staff) or a client visit (anyone, with the
   client's site typed as a field site is: its centre and a radius of 100 to 500 m). The
   request is numbered (`WLR-0001`) and opens the `attendance.location_request` approval: their line
   manager, then Operations & People, who decide it on People · Attendance (Requests) or from the
   notice. Approved, it changes what that person's punches on those days are matched to (§6.11).
   When the organisation sends people out, their line manager or People set a field assignment
   (People · Attendance, Field, New Assignment): a name, the client, event or campaign, one or two
   sites with their coordinates and radius, the days and the people. It is numbered (`FA-0001`) and
   in force at once: whoever sets it is the approver. Each person is told, sees it on My Attendance,
   and on its days their punches are matched to its sites (§6.12).
3. The employee presses Clock In. With a worksite to match, the panel names it (Location Check) and
   asks the browser for one reading only when Allow Location is pressed (straight away when this site
   was already allowed); a reading less accurate than the policy's `max_accuracy_m` offers Retry
   Location or Clock In Anyway. A remote employee, and a hybrid employee on a home day, is asked the
   same way, matched to their approved home; one without an approved home is asked too and told to
   set one. On a day an approved request covers, the panel names it (Temporary Home, Remote Day,
   Client Visit) and asks the same way; on a field assignment's day it names the assignment's site.
   Someone expected at an office with no office assigned is asked too, told No Office Assigned, and
   the punch goes to People's review. It sends
   `POST /attendance/punches` with an `Idempotency-Key`, and shows the server's answer.
4. The service decides the punch (§6): the clock guard, the geofence against the expected worksite,
   approved home, approved request (a client visit's site) or field assignment's sites,
   the device against the registered ones, the device's time against the server's. It records an
   `accepted`, `review` or `rejected` event with structured evidence, updates the day
   (`attendance_day`), opens exceptions, and emits `attendance.punched` in the same transaction.
5. After commit the outbox pushes `attendance.updated` to the employee and to People within scope
   (both screens reload), and `attendance.review_required` notifies People and the employee.
6. People open the person's day from the register, read the evidence and decide the exception:
   accept, reject (the punch stops counting, and stays visible), or add the missing clock-out time.
   The source event is never edited; a correction is a new event with `source = 'admin'`.
7. At 01:30 Lagos time the day-close job closes yesterday (and any day left open within 14 days):
   an open clock-in becomes a missing clock-out exception, an expected working day with no clock-in
   becomes absent, approved leave becomes leave. It never invents a clock-out time: an open shift
   reaches it only when the automatic clock-out (step 10) could not judge it (a day with no shift
   end, or no word on who is in front of the app).
8. Home reads a day's attendance through the shared roster
   (`src/modules/attendance/attendance.roster.js`, §6.9): the Clocked In Today card and the list
   behind it, the Team tab and a person's own month. The roster reads each day as steps 4, 6 and 7
   left it (`attendance_day`) and a day with no record by the register's rules, so a figure on Home
   is the figure on People · Attendance and My Attendance. Home's alert metrics
   (`src/modules/alerts/alerts.metrics.js`, home.md §6 Alerts) are the one other reader: Late
   Arrivals counts the days recorded `late`, and Missing Clock-Out the day-close's
   `missing_clock_out` exception and a day still open before today with a clock-in and no clock-out.
9. **The clock asks at the start and the end of the shift** (§6.14). Besides the sign-in prompt
   Home opens, the clock panel opens by itself over any screen: at the shift's start for someone
   not yet clocked in, and at its end for someone still clocked in, where Remind Me brings it back
   in 15 minutes, 30 minutes or an hour. Every five minutes the `attendance-clock-watch` job sends
   anyone expected and not yet in one reminder in the first hour after the start (the bell, and a
   push to their phone or computer); clocking in marks it read.
10. **An open shift closes by itself** (§6.14). Once the shift has ended, the same job clocks out
    anyone still clocked in who has been away from the app for 15 minutes: at the shift's end, or,
    when they stayed on the app after it, at the last moment they were in front of it. The punch is
    the system's (`source = 'system'`), counts at once, reads Automatic, and the person is told. If
    they think its time is wrong they explain it from the day on My Attendance, which opens an
    `automatic_clock_out` exception People accept or correct (§6.8).

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `attendance_policy` (1000, 1300, 1310) | `name`, `grace_minutes`, `geofence_mode` (`off`, `warn`, `block`), `device_mode` (`off`, `warn`, `block`), `max_accuracy_m`, `home_radius_m` (100), `latest_clock_out_minutes`, `active` | The modes came in `1300`; the booleans `require_geofence` and `require_known_device` of `1000` are superseded and dropped in a later release (MIGRATIONS §8) |
| `employee_attendance_policy` (1000) | `employee_id`, `attendance_policy_id`, `worksite_id`, `effective_from`, `effective_to` | Effective-dated override of the policy and the worksite for one person; read only in this delivery |
| `attendance_event` (1000, 1300, 1360) | `employee_id`, `event_type` (`clock_in`, `clock_out`), `work_date`, `occurred_at` (server time), `device_at`, `latitude`, `longitude`, `accuracy_m`, `distance_m`, `worksite_id`, `known_device_id`, `attendance_device_id`, `source` (`pwa`; `admin`, People's correction; `system`, an automatic clock-out, §6.14), `validation_state` (`accepted`, `review`, `rejected`), `validation` (evidence), `idempotency_key`, `attendance_policy_id`, `note`, `recorded_by`, `reason` | Append-only. Unique: one active (`accepted` or `review`) event of each type per person per work date among the person's and People's punches, and one automatic clock-out per person per work date (`1360`), so People's correction stands beside the automatic one it replaces; one event per person per idempotency key |
| `attendance_day` (1000, 1300) | `employee_id`, `attendance_date`, `status` (`present`, `late`, `absent`, `leave`, or none while nothing on an open day counts), `first_clock_in_at`, `last_clock_out_at`, `worked_minutes`, `late_minutes`, `overtime_minutes`, `closed_at` | The projection, recalculated from the day's events in the punch's transaction and by the day-close job |
| `attendance_exception` (1000, 1300, 1310, 1360) | `attendance_day_id`, `attendance_event_id`, `exception_type` (`outside_worksite`, `outside_home`, `location_unverified`, `unknown_device`, `suspicious_timestamp`, `missing_clock_out`, `automatic_clock_out`: opened only when the person explains one, §6.14), `severity`, `status` (`open`, `resolved`), `outcome` (`accepted`, `rejected`, `corrected`), `evidence`, `employee_note`, `reviewed_by`, `reviewed_at`, `resolution` | One per event and type, one day-level `missing_clock_out` per day (partial unique indexes), so a retried job adds none |
| `attendance_device` (1300) | `employee_id`, `known_device_id` (unique), `label`, `status` (`observed`, `registered`, `removed`), `first_seen_at`, `last_punch_at`, `registered_at`, `removed_at`, `removed_by`, `removal_reason` | Owned by `devices`. A device first seen on a punch is `observed`; the employee registers it; a removed one may be registered again. The device cookie and its hash never leave identity |
| `worksite` (0040) | `code`, `name`, `address` (jsonb `{ text }`), `latitude`, `longitude`, `radius_m`, `timezone`, `active` | Written by `worksites` from this delivery; the employee's assignment is `employee.worksite_id` |
| `attendance_home` (1310) | `employee_id`, `address`, `latitude`, `longitude`, `accuracy_m`, `status` (`pending`, `approved`, `rejected`, `superseded`), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_reason` | A remote employee's home location. At most one `pending` and one `approved` per person (partial unique indexes); approving supersedes the old approved one, a new request supersedes the one still waiting. Personal data: on the wire as `home_address`, `home_latitude`, `home_longitude`, masked under `employee.personal` and given only to the person and to `people` scope all |

| `attendance_location_request` (1320, 1350) | `number`, `employee_id`, `request_type` (`temporary_home`, `remote_day`, `client_visit`), `starts_on`, `ends_on`, `address`, `latitude`, `longitude`, `accuracy_m`, `site_latitude`, `site_longitude`, `site_radius_m`, `reason`, `status` (`submitted`, `approved`, `rejected`, `cancelled`), `workflow_instance_id`, `requested_by`, `decided_at`, `cancelled_at`, `cancel_reason` | A request to work somewhere else for some days, decided in its approval. `latitude`, `longitude` are a temporary home's reading only (both or neither); on the wire `home_latitude`, `home_longitude`, masked under `employee.personal` and given only to the person and to `people` scope all. `site_latitude`, `site_longitude`, `site_radius_m` (100 to 500) are a client visit's site only, all three or none: a client's venue, not personal data. A client visit sent before `1350` has none |
| `attendance_schedule` (1340) | `employee_id`, `office_days` (ISO weekdays, 1 Monday to 7 Sunday), `effective_from`, `reason`, `set_by`, `set_at` | A hybrid employee's week: the days at their worksite, from a date. One row per person per `effective_from` (setting the same start again replaces it); the row in force on a date is the latest that started by then. Read only for `hybrid` staff |
| `attendance_field_assignment` (1330) | `number`, `name`, `client`, `note`, `starts_on`, `ends_on` (at most 31 days), `status` (`active`, `cancelled`), `assigned_by`, `assigned_at`, `cancelled_at`, `cancelled_by`, `cancel_reason` | Sending people to work somewhere for some days. In force from the moment it is saved; cancelled, it stops applying to the days still to come. Never deleted |
| `attendance_field_site` (1330) | `field_assignment_id`, `position` (1 or 2), `name`, `address`, `latitude`, `longitude`, `radius_m` (100 to 500) | An assignment's one or two sites, typed as a worksite is. A client's venue, not a person's: not personal data |
| `attendance_field_member` (1330) | `field_assignment_id`, `employee_id`, `added_at`, `removed_at`, `removed_by`, `removed_reason` | The people on it, at most 25. Taking someone off keeps their row with `removed_at`; a person is on at most one active assignment a day (the service, under the person's lock) |
| `attendance_clock_reminder` (1360) | `employee_id`, `work_date`, `kind` (`clock_in_due`), `sent_at` | One row per reminder sent, unique per person, day and kind, so the watch sends it once a day however often it runs; the notice is about this row, and clocking in marks it read. Nothing about a person but who and which day |

Schema migrations: `migrations/1300_attendance_clock.sql`, `migrations/1310_attendance_home.sql`
(homes, `home_radius_m`, the `outside_home` type), `migrations/1320_attendance_location_request.sql`
(work location requests), `migrations/1330_attendance_field_assignment.sql` (field assignments,
their sites and people), `migrations/1340_attendance_schedule.sql` (hybrid staff's weekly
schedule), `migrations/1350_attendance_client_visit_site.sql` (a client visit's site),
`migrations/1360_attendance_clock_watch.sql` (the reminders sent, the `automatic_clock_out` type and
the unique indexes that count an automatic clock-out apart). Reference data:
`seeds/reference/1390_seed_attendance.sql` (two exception types),
`seeds/reference/1391_seed_attendance_home.sql` (Outside Home),
`seeds/reference/1392_seed_attendance_location_request.sql` (the `location_request` numbering scheme,
`WLR-0001`, and version 1 of the `attendance.location_request` approval),
`seeds/reference/1393_seed_attendance_field_assignment.sql` (the `field_assignment` numbering scheme,
`FA-0001`), `seeds/reference/1394_seed_attendance_clock_watch.sql` (Automatic Clock-Out). Nothing about a person,
a device, a punch, a holiday or a coordinate is seeded (A26).

**The shared roster** (§6.9) reads `attendance_day` as the punch, the decision and the day-close
write it; the day's one active clock-in on `attendance_event` (by `work_date`, for the worksite it
was judged against); `employee`, `department` and `worksite`; and granted `leave_request` with its
approval (`workflow_instance`). It reads through the indexes above (`attendance_day`'s
`(employee_id, attendance_date)` key and `(attendance_date, status)`, `attendance_event`'s one active
event a day) and needs none of its own.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/attendance/me/today` | → `AttendanceToday` | self, own | no | The authoritative state, the shift, the clock location (name and radius, no coordinates), the policy's modes and accuracy limit, this device; `clock_out_automatic` when the day's clock-out was the system's (§6.14) |
| `POST /api/v1/attendance/punches` | `PunchCreate` → `PunchResult` | self, own | no | `Idempotency-Key` required (428 without). The person is the session's; the body names nobody. 409 for a refused transition, 422 on leave or not employed |
| `GET /api/v1/attendance/me` | `MyDayListQuery` (`month`, `status`) → `AttendanceDayPage` | self, own | yes, 25 | Days of the month, newest first; `status` keeps one figure's days (`present` takes late days too, as Days Present counts them) |
| `GET /api/v1/attendance/me/summary` | `MySummaryQuery` → `MyAttendanceSummary` | self, own | no | The month's figures |
| `GET /api/v1/attendance/me/events` | `MyEventListQuery` (`date`) → `AttendanceEventPage` | self, own | yes, 25 | One day's punches, own coordinates not returned |
| `GET /api/v1/attendance/me/exceptions` | `MyExceptionListQuery` → `AttendanceExceptionPage` | self, own | yes, 25 | |
| `POST /api/v1/attendance/me/exceptions/:id/explanation` | `ExceptionExplanation` → `AttendanceException` | self, own | no | While the exception is open |
| `POST /api/v1/attendance/me/events/:id/explanation` | `ExceptionExplanation` → `AttendanceException` | self, own | no | An automatic clock-out of the person's own (§6.14): opens its `automatic_clock_out` exception with the note. 404 for anyone else's punch, 422 `NOT_AUTOMATIC` for a punch that is not one, 409 `ALREADY_EXPLAINED` once it has an exception |
| `POST /api/v1/attendance/me/export` | `MyExportRequest` (`month`) → `ExportQueued` | self, own | no | The month's workbook arrives by email |
| `GET /api/v1/attendance/register` | `RegisterQuery` (`date`, `status`, `department_id`, `q`, `sort`) → `RegisterPage` | `people` view · all/team/own | yes, 25 | One row per active employee in scope; status worked out in SQL before the page is cut |
| `GET /api/v1/attendance/summary` | `RegisterSummaryQuery` (`date`) → `RegisterSummary` | `people` view · scope | no | |
| `GET /api/v1/attendance/register/:employee_id` | `DayDetailQuery` (`date`) → `DayDetail` | `people` view · scope | no | 404 outside scope |
| `GET /api/v1/attendance/events` | `EventListQuery` (`employee_id`, `date`) → `AttendanceEventPage` | `people` view · scope | yes, 25 | Coordinates only for scope all |
| `GET /api/v1/attendance/exceptions` | `ExceptionListQuery` (`status`, `exception_type`, `date`, `employee_id`, `q`) → `AttendanceExceptionPage` | `people` view · scope | yes, 25 | |
| `POST /api/v1/attendance/exceptions/:id/decision` | `ExceptionDecision` → `AttendanceException` | `people` approve · all | no | Reason required; never your own; a correction appends an event |
| `GET /api/v1/attendance/records/:id` | → `AttendanceRecordRef` | `people` view · scope | no | A day's id or an exception's, to the person and day a link opens (⌘K, the bell) |
| `GET /api/v1/attendance/me/records/:id` | → `AttendanceRecordRef` | self, own | no | The same for the person's own |
| `POST /api/v1/attendance/export` | `RegisterExportRequest` (`from`, `to`, at most 31 days) → `ExportQueued` | `people` export · scope | no | The register's workbook arrives by email |
| `GET /api/v1/attendance/me/home` | → `MyHome` | self, own | no | The approved home, the one waiting and the last one rejected, with their own coordinates |
| `POST /api/v1/attendance/me/home` | `HomeRequestCreate` (`home_address`, `home_latitude`, `home_longitude`, `accuracy_m`) → `MyHome` | self, own | no | Remote staff, and hybrid staff whose schedule has a home day (422 `HOME_NOT_NEEDED` otherwise); the reading within `max_accuracy_m` (422 `HOME_READING_WEAK`); supersedes a request still waiting |
| `GET /api/v1/attendance/homes` | `HomeListQuery` (`status`, `employee_id`, `q`, `sort`) → `HomeRequestPage` | `people` view · scope | yes, 25 | Waiting first; address and coordinates only for scope all, masked under `employee.personal` |
| `GET /api/v1/attendance/homes/:id` | → `HomeRequest` | `people` view · scope | no | The home a link opens (`attendance_home`, `?home=` on People · Attendance); the same visibility as the list |
| `GET /api/v1/attendance/me/requests` | `MyLocationRequestListQuery` (`status`, `sort`) → `LocationRequestPage` | self, own | yes, 25 | The person's own requests, newest first |
| `POST /api/v1/attendance/me/requests` | `LocationRequestCreate` (`request_type`, `starts_on`, `ends_on`, `address`, `reason`, `home_latitude`, `home_longitude`, `accuracy_m`, `site_latitude`, `site_longitude`, `site_radius_m`) → `LocationRequest` | self, own | no | The checks of §6.11; numbered, and opens the approval in the same transaction |
| `GET /api/v1/attendance/me/requests/:id` | → `LocationRequest` | self, own | no | Another person's is a 404 |
| `POST /api/v1/attendance/me/requests/:id/cancel` | `LocationRequestCancel` (`reason`) → `LocationRequest` | self, own | no | Waiting: withdraws the approval; approved: until the day before its first day; 409 `REQUEST_NOT_CANCELLABLE` otherwise |
| `GET /api/v1/attendance/requests` | `LocationRequestListQuery` (`status`, `request_type`, `employee_id`, `q`, `sort`) → `LocationRequestPage` | `people` view · scope | yes, 25 | Waiting first; each row says whether it waits on the reader (`can_decide`) |
| `GET /api/v1/attendance/requests/:id` | → `LocationRequest` | `people` view · scope | no | The request a link opens (`attendance_location_request`, `?request=`) |
| `GET /api/v1/attendance/field-assignments` | `FieldAssignmentListQuery` (`state`, `employee_id`, `q`, `sort`) → `FieldAssignmentPage` | `people` view · scope | yes, 25 | An assignment with anyone in the reader's scope on it; in progress and upcoming first. `state`: `upcoming`, `in_progress`, `done`, `cancelled` |
| `GET /api/v1/attendance/field-assignments/:id` | → `FieldAssignment` | `people` view · scope | no | The assignment a link opens (`attendance_field_assignment`, `?assignment=`) |
| `POST /api/v1/attendance/field-assignments` | `FieldAssignmentCreate` (`name`, `client`, `note`, `starts_on`, `ends_on`, `employee_ids`, `sites`) → `FieldAssignment` | `people` approve · scope | no | In force at once; every person within the reader's scope, never the reader (§6.12) |
| `POST /api/v1/attendance/field-assignments/:id/cancel` | `FieldAssignmentCancel` (`reason`) → `FieldAssignment` | `people` approve · scope | no | Until its last day; everyone on it is told |
| `POST /api/v1/attendance/field-assignments/:id/remove` | `FieldMemberRemove` (`employee_id`, `reason`) → `FieldAssignment` | `people` approve · scope | no | Takes one person off; not the last one (cancel instead) |
| `GET /api/v1/attendance/me/field-assignments` | `MyFieldAssignmentListQuery` (`state`) → `FieldAssignmentPage` | self, own | yes, 25 | The person's own, in progress and upcoming first |
| `GET /api/v1/attendance/me/field-assignments/:id` | → `FieldAssignment` | self, own | no | One they are or were on; anyone else's is a 404 |
| `POST /api/v1/workflow/instances/:id/approve`, `/reject` | the approval's own routes (foundation.md §5) | the stage's approvers | no | How a request is decided; never by a route of this module |
| `GET /api/v1/attendance/schedules/:employee_id` | `ScheduleParams` → `WorkSchedule` | `people` view · scope | no | The person's pattern, office, home state, the week day by day, the schedule in force and the one waiting to start; `can_edit` for the reader. 404 outside scope |
| `POST /api/v1/attendance/schedules/:employee_id` | `ScheduleParams`, `WorkScheduleSet` (`office_days`, `effective_from`, `reason`) → `WorkSchedule` | `people` edit · scope | no | Hybrid staff only (422 `SCHEDULE_NOT_NEEDED`); never your own (403 `OWN_RECORD`); the checks of §6.13 |
| `POST /api/v1/attendance/homes/:id/decision` | `HomeDecision` (`decision`, `reason`) → `HomeRequest` | `people` approve · all | no | Never your own (403 `OWN_RECORD`); a rejection needs a reason of 10 or more characters; 409 once decided |
| `GET /api/v1/devices/mine` | `PageQuery` → `MyDevicePage` | self, own | yes, 25 | |
| `POST /api/v1/devices/mine` | `DeviceRegister` → `MyDevice` | self, own | no | This session's device; fresh sign-in (403 `REAUTH_REQUIRED`); 409 past three |
| `POST /api/v1/devices/mine/:id/remove` | `EmptyBody` → `MyDevice` | self, own | no | |
| `GET /api/v1/devices` | `DeviceListQuery` (`status`, `employee_id`, `q`) → `DevicePage` | `people` view · scope | yes, 25 | |
| `GET /api/v1/devices/:id` | → `Device` | `people` view · scope | no | |
| `POST /api/v1/devices/:id/remove` | `DeviceRemove` (`reason`) → `Device` | `people` edit · scope | no | The person is told |
| `GET /api/v1/worksites` | `WorksiteListQuery` (`active`, `q`, `sort`) → `WorksitePage` | `people` view | yes, 25 | |
| `GET /api/v1/worksites/:id` | → `Worksite` | `people` view | no | |
| `POST /api/v1/worksites` | `WorksiteCreate` → `Worksite` | `people` create | no | Coordinates typed until the map proxy exists (§13) |
| `PATCH /api/v1/worksites/:id` | `WorksiteUpdate` → `Worksite` | `people` edit | no | `active: false` retires, `true` restores |
| `GET /api/v1/worksites/:id/employees` | `PageQuery` → `WorksiteEmployeePage` | `people` view · scope | yes, 25 | |
| `POST /api/v1/worksites/:id/employees` | `WorksiteAssign` → `WorksiteEmployee` | `people` edit · scope | no | Through `organisation.service.updateEmployee`; assigning someone to another worksite moves them |

The shared roster has no route of its own. It is a read Home's services call: `GET /home/team`,
`/home/team/summary`, `/home/team/attendance` and the records behind the attendance cards
(`docs/guides/home.md` §5). People · Attendance and My Attendance read the routes above; the roster
agrees with them because it reads the same records the same way (§6.9). `page()` and `month()`
answer in the list envelope at 25, filtered, searched and sorted in SQL.

## 6 · Rules and calculations

### 6.1 The policy

- The policy for a person on a work date is the active `attendance_policy` of their effective
  `employee_attendance_policy` row; else the oldest active policy; else the code's defaults. A
  policy is a business choice (A26): MyCity sets it on Settings · Attendance Policy (M9).
- `geofence_mode` defaults to `warn` and `device_mode` to `off` (MILESTONES §6.2, REUSE_MAP §2.2).
  `off` judges nothing but records the evidence; `warn` accepts for review and opens an exception;
  `block` rejects.
- Grace is the policy's `grace_minutes` (code default 0). The day's start and end are the working
  week's hours for that weekday (Settings · Organisation, A22); public holidays come from the same
  calendar (`shared/time/working-week`).

### 6.2 The clock guard (`attendance.clock-guard.js`, pure)

- Active events are `accepted` and `review` ones; a `rejected` event never changes the state.
- A clock-in is allowed when the work date has no active clock-in. Once the day has a clock-in and a
  clock-out, another clock-in is refused (`SHIFT_DONE`): one shift a day, as both donors run it.
- A clock-out is allowed after an active clock-in with no active clock-out; refused with no clock-in
  (`NOT_CLOCKED_IN`) and after a clock-out (`ALREADY_CLOCKED_OUT`). A clock-in after an active
  clock-in is `ALREADY_CLOCKED_IN`.
- A clock-out closes today's open shift, or yesterday's while yesterday is not closed (a late shift).
- A refused transition writes nothing and answers 409.
- Two punches from one person are decided one after the other (`pg_advisory_xact_lock` on the
  person, inside the transaction); the unique index on active events is the backstop, and its
  violation answers the same 409.
- An automatic clock-out (§6.14) is an active clock-out like any other: after it the person's own
  clock-out is `ALREADY_CLOCKED_OUT` and a clock-in `SHIFT_DONE`. Only People's correction of its
  time is written beside it (the unique index counts the system's apart), and the automatic one
  then stops counting.

### 6.3 Idempotency

- Every punch carries an `Idempotency-Key`; without one it is refused (428). The shared middleware
  replays a finished request's stored answer. The key is also stored on the event, unique per
  person, so a replay the middleware no longer remembers (48 hours) still returns the original
  result instead of a second punch. A key sent with a different body is the middleware's 422.

### 6.4 Time

- The server's receipt time is the punch's time (`occurred_at`); the device's own time is kept
  beside it (`device_at`) with the gap, never in its place (BACKEND_STRUCTURE §15).
- The work date and the wall clock are read in the worksite's timezone (`worksite.timezone`,
  Africa/Lagos when there is no worksite), never the host's (`attendance.rules.wallClock`).
- A device time more than 2 minutes ahead of the server is implausible: the punch goes to review
  with a `suspicious_timestamp` exception. A device time more than 5 minutes behind is a delayed
  submission: recorded with both times, judged on the server's.
- Lateness: minutes after the day's start plus grace, on a working day only (0 otherwise). Worked
  minutes: last clock-out minus first clock-in. Overtime: minutes after the day's end, on a working
  day with a clock-out. No money is worked out in M1 (payroll is M6).
- A day's status: approved leave first (`leave`), then a clock-in (`late` when late minutes are
  above 0, else `present`), then, once closed, an expected working day with no clock-in (`absent`).
  A weekend or holiday with no punch has no day row.

### 6.5 The geofence (`attendance.geofence.js`, pure, distances from `shared/geo`)

- The expected location is the person's worksite (the override, else `employee.worksite_id`), if
  active. For a `remote` work pattern, and for a `hybrid` employee on a home day of their schedule
  (§6.13), it is their approved home (§6.10), with the policy's `home_radius_m` (100 m). Someone
  working from home with no approved home has no fence to meet: the location is `unverified`
  (`no_home`), so the punch goes to review under warn and block and is never rejected for it.
- Someone expected at an office (on-site staff, a hybrid employee on an office day or with no
  schedule) whose worksite is not set or not active has no fence either: the location is
  `unverified` (`no_worksite`), the same way, so a missing office shows up as an exception on the
  first punch instead of letting every reading through (owner decision, 19/10/2026). Retry Location
  is not offered for it: a new reading changes nothing.
- Distance is the server's, from the coordinates sent; a client distance or inside flag is never
  read. Equal to the radius is inside; more is outside.
- Accuracy of 50 m or better is good, up to `max_accuracy_m` (100) fair; worse is not a compliant
  reading: the location is `unverified` (`poor_accuracy`), and the panel offers Retry Location.
- No coordinates (denied, unavailable, timed out, unsupported) is `unverified` with that reason.
- `off`: accepted, the verdict kept as evidence. `warn`: outside or unverified is `review` with an
  `outside_worksite` (or, against a home, `outside_home`) or `location_unverified` exception.
  `block`: outside is `rejected`; unverified is `review` (a reading that could not be taken, or a
  home not yet approved, is not proof of being elsewhere).
- A punch against a home keeps `worksite_id` empty (the roster, §6.9, and Home read it as remote);
  its evidence names the place `home` and the home record it was judged against.
- On a day an approved work location request covers, the request decides the expected place
  instead (§6.11); on a day a field assignment covers, the assignment's sites decide it, before
  anything else (§6.12). The order is: field assignment, approved request, home (remote, or a hybrid
  home day), worksite.

### 6.6 The device (`devices.guard.js`, pure)

- The device is the session's `known_device` (set at sign-in from the device cookie). A client
  `known` flag or label is never read.
- First seen on a punch, it is recorded as `observed` (devices register even when the policy is
  `off`). Known means `registered`; `observed`, `removed` or no device is unknown.
- `off`: accepted. `warn`: unknown is `review` with an `unknown_device` exception. `block`: unknown
  is `rejected`.
- At most three registered devices per person (the 12 and 13 October meetings). Registering needs a
  fresh sign-in; nobody at People approves it. People may remove any device in scope, with a reason.

### 6.7 The result

- The punch's result is the strictest of the geofence, the device and the time checks (`rejected`,
  then `review`, then `accepted`). A rejected punch is recorded with its evidence and opens no
  exception: there is nothing to decide, the person punches again from the right place or device.

### 6.8 Deciding an exception

- People with `people` approve and scope all decide; never their own. A reason of at least 10
  characters is required.
- `accept`: the punch stands. `reject`: the punch stops counting for the day (still shown, marked
  excluded). `add_clock_out` (missing clock-out only): an `admin` clock-out at the time given, after
  the clock-in, on the work date. Each recalculates the day and is audited with before and after.
- An `automatic_clock_out` (the person explained an automatic clock-out, §6.14) takes `accept`, the
  automatic time stands, or `add_clock_out`, shown as Correct Time: an `admin` clock-out at the time
  given, as above, and the automatic one stops counting (marked excluded, outcome `corrected`).
  `reject` is refused (422 `DECISION_INVALID`): it would leave the shift open.

### 6.9 The shared roster (`attendance.roster.js`, read only)

`src/modules/attendance/attendance.roster.js` is how Home reads a day's attendance. It decides
nothing: every fact is this module's own, read the way the register (`GET /attendance/register`,
`/attendance/summary`) and My Attendance (`GET /attendance/me`, `/attendance/me/summary`) read it, so
Home and those screens never disagree.

| Function | Gives |
|---|---|
| `summary(client, { date }, scope)` | For one day within the reader's scope: `working_day`, `expected`, `present`, `on_site`, `remote`, `field`, `late`, `absent`, `on_leave`, `not_in`, `no_clock_out_yesterday`, `flagged` |
| `page(client, { date, status, department_id, q, no_clock_out_yesterday, flagged }, scope, query)` | One page of 25 people on the register that day: name, job title, department, work pattern, status, clock-in, clock-out, late minutes, the worksite (or field assignment site) the clock-in was judged against (none when the person works remotely, is on an approved remote day, or is not in), the yesterday flag and `flagged`. The filters combine. Sorts: `display_name` (the default), `department`, `clock_in_at` |
| `month(client, { from, to, department_id, q }, scope, query)` | One page of 25 people on the register on any day from `from` to `to` (at most 31), each with the totals My Attendance shows for those days: expected, on time, late, absent, on leave. One query for the page, never one per person. Sorts: `display_name` (the default), `on_time` |
| `personal(client, { employee_id, from, to })` | One person's days (at most 31), each with its status, its record's own status (`day_status`), clock-in, clock-out and late minutes, and the totals My Attendance shows: days expected, on time, late, absent, on leave |

- **A day's record is the source.** Status, first clock-in, last clock-out and late minutes are
  `attendance_day` as §6.4 to §6.8 write it: counted punches only (accepted or in review, not
  excluded by a decision), on the work date, late by the whole minutes past the start plus the
  policy's grace (§6.1, §6.4). The roster never re-reads the punches to decide any of these.
- **A day with no record** reads as the register reads it: granted leave, else nothing on a day
  that is not worked, else not in.
- **Who is on the day:** anyone with a record that day, and everyone active, started and not yet
  left (the register's people).
- **Home's words** for the register's statuses (the contract's `HomeRosterStatus`):

  | Register | Roster |
  |---|---|
  | `leave` | `on_leave` |
  | `late` | `late` |
  | `present` | `field` when a field assignment the person is on covers the date (§6.12); else `remote` when the person's work pattern is `remote` (as §6.5 and the clock panel read it), an approved remote day covers the date (§6.11), or the date is a hybrid employee's home day by the schedule in force then (§6.13); else `on_site` |
  | `absent` | `absent` (a working day the day-close closed with no clock-in) |
  | `not_in` | `not_in` (a working day not closed, no clock-in yet) |
  | `off` | none |

- **The counts** are the register summary's: `expected` is everyone on the register but those on
  leave, on a working day only (0 on a day that is not worked); `present` is late plus on site plus
  remote plus field, a clock-in that counts on any day, so a Sunday clock-in is present with nobody
  expected.
- **No clock-out yesterday:** the person's last working day (Saturday, read on a Monday; the day
  before a holiday, read after it) has a clock-in and no clock-out on its record: the open shift the
  day-close turns into a missing clock-out.
- **Flagged:** late that day, or no clock-out yesterday; a person who is both is flagged once, so
  `flagged` counts people, not flags.
- **Over a range** (`month()`): the people on the register on at least one of its days (anyone with
  a record in it, and everyone active, started by its last day and not yet left on the first day
  they are on it), each with `repo.daysSummary()`'s figures for those days, counted the same way
  in one grouped query.
- **A person's totals** are `repo.daysSummary()` up to today, the figures My Attendance shows: a day
  counts once this module has recorded it (a clock-in, or the day-close's absence or leave), so
  today's leave and a past day not yet closed count for nothing until then. Leave is counted apart,
  so `expected` is always on time plus late plus absent.
- The mapping is written once in JavaScript (`statusOf`) and once in SQL (so a list filters, counts
  and pages by it); `tests/integration/attendance-roster.test.js` holds them to each other and both
  to `repo.register`, `repo.registerSummary`, `repo.listDays` and `repo.daysSummary` on every kind of
  day. A change to the register's statuses changes the roster's mapping in the same PR.
- **The one other reader.** Home's alert metrics (`src/modules/alerts/alerts.metrics.js`, home.md
  §4.1) read `attendance_day.status = 'late'` (Late Arrivals) and the day-close's
  `missing_clock_out` exception with no event, or a day still open before today with a clock-in and
  no clock-out (Missing Clock-Out), in their own SQL. A change to the register's statuses or to
  that exception changes those two entries in the same PR, as it does the roster's mapping.

### 6.10 Home locations (`attendance.home.js`)

- A `remote` employee sets one, and so does a `hybrid` employee whose schedule in force, or the one
  waiting to start, has a home day (422 `HOME_NOT_NEEDED` otherwise; `MyHome.needed` says which).
  The reading is taken on the
  person's device when they press Use This Location, and must be within the policy's
  `max_accuracy_m` (422 `HOME_READING_WEAK`, the panel offers Retry Location). The address is their
  own words, up to 300 characters; nothing turns it into coordinates (the map proxy, F21, §13).
- A request is `pending` until People decide. A second request while one waits supersedes it. The
  approved home stays the fence until a newer one is approved; approving supersedes it.
- People with `people` approve and scope all decide (403 `FORBIDDEN` for a narrower scope), never
  their own (403 `OWN_RECORD`). Approve needs no reason; reject needs 10 or more characters, which
  the person reads. A decided request answers 409 `HOME_DECIDED`. Each request and decision is
  audited with before and after.
- Who sees what: the person sees their own address and coordinates; People with scope all see them
  (masked under `employee.personal` where a role masks personal details); team scope sees the
  status and the distance from the approved home, never the address or the point. No event,
  notification, audit payload, AI read or search result carries the address or the coordinates.
- People see how far a waiting home is from the approved one (`distance_from_approved_m`), the
  reading's accuracy and when it was taken, to judge a move.

### 6.11 Work location requests (`attendance.requests.js`)

- **Types, and who may ask** (422 `REQUEST_TYPE_NOT_ALLOWED` otherwise):
  - `temporary_home`, remote staff: somewhere else to live for some days. One reading taken there
    when they press Use This Location, within the policy's `max_accuracy_m` (422
    `HOME_READING_WEAK`), and the address in their words. Up to 90 days.
  - `remote_day`, on-site and hybrid staff: a day or a few working from home. The address is
    optional. Up to 5 days.
  - `client_visit`, anyone: a client's site. The address, as the client gave it, and the site's
    centre and radius, typed as a field site's are until address search exists (F21): latitude,
    longitude and a radius of 100 to 500 m, all required (owner decision, 19/10/2026). Up to 14
    days.
- **Dates**: the first day from today in Lagos (422 `REQUEST_IN_THE_PAST`) and within 90 days
  (422 `REQUEST_TOO_FAR`); the last day on or after the first and within the type's span (422
  `REQUEST_TOO_LONG`). A request may not share a day with another one of theirs still waiting or
  approved (409 `REQUEST_OVERLAPS`); two requests from one person are checked one after the other
  under the person's lock. A reason of 10 to 500 characters.
- **The approval**: `attendance.location_request` (`shared/workflow/definitions.js` DEFAULTS, seeded by
  `1392`): Line Manager (the CEO when there is none), then Operations & People, 48 hours each.
  Nobody decides their own (the engine). A rejection needs a reason, which the person reads. The
  engine tells the approvers when it reaches them and the person when it is decided; after commit
  the outcome is copied onto the request, once and only while it waits (`settle`), as leave does.
  Operations & People can change the stages on Settings, Approvals (version 2 on).
- **Cancelling**: the person withdraws a request still waiting (the approval is withdrawn with it),
  or cancels an approved one until the day before its first day. A rejected, cancelled or started
  request is 409 `REQUEST_NOT_CANCELLABLE`.
- **On the clock** (`attendance.calendar.js` `contextFor`): an approved request covering the work
  date replaces the usual place for that date. A temporary home is fenced at its reading with the
  policy's `home_radius_m` (100 m), judged as a home is (`outside_home` beyond it). A client visit is
  fenced at its site, judged as a field site is: inside the radius counts, beyond it is
  `outside_worksite` (warn reviews, block rejects), named Client Visit. A remote day uses
  the person's approved home when they have one, as a home; otherwise, and for a client visit sent
  before sites were asked for (`1350`), the
  approval is the check: the punch is accepted under every geofence mode with its reading kept as
  evidence (verdict `not_applied`, reason `approved_request`). The device and time checks still
  apply. The evidence names the place (`temporary_home`, `remote_day`, `client_visit`) and the
  request; `worksite_id` stays empty; the register and the punch read Temporary Home, Remote Day or
  Client Visit. Two approved requests never cover one day (the overlap rule).
- **Decided late**: approving a request after one of its days has a punch does not re-judge that
  punch; People settle its exception as for any other.
- **On Home**: a present day an approved remote day covers counts as remote on the roster (§6.9).
- **Who sees what**: the person reads their own; anyone whose `people` view reaches them reads the
  request, address and a client visit's site included (a line manager decides from it). The
  temporary home's point goes only to the person and to `people` scope all. No event, notification,
  audit payload, AI read or search result carries the address, the point or the site.

### 6.12 Field assignments (`attendance.assignments.js`)

Owner decisions of 19/10/2026: a line manager or People set one and it is in force at once (whoever
sets it is the approver); one or two sites typed in; a date range of whole days; several people on
one assignment. The limits below are LA's, to change on request.

- **Who sets one**: `people` approve, within its scope: a line manager or head for their reporting
  tree, Operations & People and Management for anyone. Every person on it must be within the
  reader's scope (403 `FORBIDDEN` naming none of the others), active and started (422
  `NOT_EMPLOYED`), and never the reader (403 `OWN_RECORD`: someone else sends you out).
- **What it holds**: a name (3 to 120 characters, "Venue Setup"), the client, event or campaign (2
  to 120), an optional note (up to 500), the first and last day, one or two sites and one to 25
  people. A site is a name (2 to 120), an optional address (up to 300) and its centre and radius,
  typed as a worksite's are until address search exists (F21): latitude, longitude and a radius of
  100 to 500 m. Numbered `FA-0001` (`field_assignment`, never reset).
- **Dates**: the first day from today in Lagos (422 `ASSIGNMENT_IN_THE_PAST`) and within 90 days
  (422 `ASSIGNMENT_TOO_FAR`); the last on or after the first and at most 31 days in all (422
  `ASSIGNMENT_TOO_LONG`).
- **One a day**: a person is on at most one active assignment on any day (409
  `ASSIGNMENT_OVERLAPS`, naming the person and the other assignment). Checked under each person's
  lock, in the order of their ids, so two assignments set at once cannot both take the same day.
  Leave and work location requests do not block one: the assignment decides the day's place, and
  approved leave still refuses a punch (§11).
- **Changing it**: Cancel Assignment, with a reason (10 to 500 characters) everyone on it reads,
  until its last day (409 `ASSIGNMENT_ENDED` after); Take Off one person, with a reason, on the same
  terms, but never the last one (409 `ASSIGNMENT_LAST_PERSON`: cancel it instead). Both need the
  same grant and scope as setting it, over every person still on it. Days already worked keep their
  punches as they were judged. Adding people, moving its dates or changing a site is not in this
  delivery: cancel it and set a new one.
- **State**, worked out on the day in Lagos: `upcoming` (it starts after today), `in_progress`
  (today is one of its days), `done` (its last day has passed), or `cancelled`.
- **On the clock** (`attendance.calendar.js` `contextFor`): for a person still on it, an assignment
  covering the work date comes before everything else (a work location request, a home, a
  worksite). The punch is judged against the nearer of its sites: inside a site's radius is inside;
  beyond every site is `outside_worksite` (warn reviews, block rejects), named with the nearer site.
  The evidence names the place `field`, the assignment and the site; `worksite_id` stays empty. The
  register, the punch and the roster read the site's name. The panel names the site (both, "A or
  B", when there are two) and asks for the location as it does for a worksite.
- **On Home**: a present day on an assignment counts as `field` on the roster (§6.9).
- **Who sees what**: anyone whose `people` view reaches one person on it reads the assignment, its
  sites and everyone on it (a crew is not personal data). The person reads every assignment they
  are or were on. `can_change` tells a reader whether they may cancel it or take someone off.
  Events carry ids, the number, the name and the dates: never a site's address or centre.

### 6.13 Hybrid staff's weekly schedule (`attendance.schedule.js`)

Owner decisions of 19/10/2026: People set which working days a hybrid employee spends at the
office (MyCity's three at MTN Plaza, 100 m); the other working days are worked from home and fenced
like a remote employee's. Set on the employee record (ess.md §3 step 2, "Attendance setup").

- **Who sets it**: `people` edit, within its scope; never on their own record (403 `OWN_RECORD`).
  Only for a `hybrid` employee (422 `SCHEDULE_NOT_NEEDED`); remote staff are home every day and
  on-site staff at the office every day, so neither has one.
- **What it holds**: the office days, ISO weekdays (1 Monday to 7 Sunday), each once; from a first
  day; a reason of 10 to 500 characters. Every office day is a working day of the organisation's
  week (422 `SCHEDULE_DAY_NOT_WORKED`), and at least one working day is left for home (422
  `SCHEDULE_NO_HOME_DAY`: all of them at the office is on site, a change of work pattern instead).
- **Dates**: the first day from today in Lagos (422 `SCHEDULE_IN_THE_PAST`) and within 90 days (422
  `SCHEDULE_TOO_FAR`). Setting one from the same first day again replaces it; a later first day adds
  the next version and the one in force stays until then. Days already worked keep their punches as
  they were judged.
- **On the clock** (`attendance.calendar.js` `contextFor`): after a field assignment and an approved
  request, a hybrid employee's date is a home day when the schedule in force that date leaves its
  weekday out. A home day is fenced at the approved home with `home_radius_m`, judged as a remote
  employee's (`outside_home` beyond it; no approved home is `unverified`, `no_home`). Any other day,
  and every day with no schedule yet, is matched to the worksite as before (§6.5).
- **The week** (`weekOf`): for anyone, each weekday is `off` when the organisation's week does not
  work it, else `office` or `remote` by the pattern (on site: office; remote: remote; hybrid: by the
  schedule in force, office every day without one). My Profile and the record's Attendance tab show
  it; Home's roster and the register read a present hybrid home day as remote (§6.9).
- **Who sees what**: the person reads their week on My Profile; anyone whose `people` view reaches
  them reads it on their record. `can_edit` tells the reader whether Set Schedule is theirs. The
  event carries the office days and the first day, which are not personal data.

### 6.14 Clock prompts, reminders and the automatic clock-out (`attendance.clock-watch.js`)

Agreed at the 12 and 13 October meetings and settled by the owner on 19/10/2026: a pop-up the
person must answer, not a toast, at the shift's start and end; push reminders; an open shift
closed at the shift's end, or at the last moment the person was on the app when they stayed on
after it; an automatic clock-out counts at once, reads Automatic, and the person can explain it.
The times below (5, 15 and 60 minutes, the three Remind Me choices) are the code's, to change on
request.

- **The start prompt** (the app, `features/attendance/prompts.ts`): on a working day, when the
  workplace's clock (kept to the server's) reaches the shift's start and the person is not clocked
  in, the clock panel opens over whatever screen is open, as Start Your Day. Once a day on each
  device: when the app is open at the start or comes to the front within the hour after it, and
  not when the panel was already shown since the start on that device (the sign-in prompt, Clock
  In). The scrim, Esc and a drag do not close it; Not Now does.
- **The closing prompt**: when the clock passes the shift's end and the person is still clocked
  in, the panel opens as Finish Your Day. Clock Out or Remind Me (in 15 minutes, 30 minutes or 1
  hour) answers it; after Remind Me it opens again at that time while they are still clocked in,
  and closing it unanswered counts as the shortest Remind Me. A day that is not worked has no end
  and no closing prompt.
- Neither prompt replaces a dialog that is open, or opens while the session is locked: it waits
  until that one closes, so a half-filled form is never lost.
- **The start reminder** (job `attendance-clock-watch`, every 5 minutes): on a working day of the
  organisation's week (Lagos), in the first 60 minutes after the start, everyone active and
  started, with a login, not on granted leave and with no clock-in that counts that day, is sent
  one reminder (`attendance.clock_in_due`): in the bell, and pushed to their devices as their
  Attendance and Leave preference allows. One a day (`attendance_clock_reminder`, unique per
  person, day and kind); a run after the first hour sends none. Clocking in marks it read, so a
  push still held (the minute it waits while the person is in front of the app) is not sent.
- **The automatic clock-out** (the same job): for a person with an open shift (a clock-in that
  counts and no clock-out) on a work date not yet closed (today, or yesterday before the
  day-close), once the workplace's clock is past that date's shift end:
  - in front of the app now on any of their logins (a tab on screen and touched in the last 5
    minutes, as `services/realtime/active.js` reads it): nothing; they have the
    closing prompt.
  - away for at least 15 minutes since the last moment they were in front of it, or never seen:
    clocked out at the later of the shift's end and that last moment, never before the clock-in
    and never after now.
  - when the presence store cannot answer (no Redis), nothing: the day-close's missing clock-out
    is the backstop.
  - The punch: a `clock_out` with `source = 'system'`, `accepted`, no location, device or device
    time; its evidence names `automatic` with the shift's end and the last moment in front of the
    app. The day is recalculated, `attendance.punched` and `attendance.clocked_out_automatically`
    are emitted in the same transaction, and the person is told ("Clocked out automatically", the
    date and time); their clock and People's register reload. Under the person's lock, so a
    clock-out they make at that moment is either first or refused.
- **Explaining it**: the person explains an automatic clock-out from the day on My Attendance
  (`POST /attendance/me/events/:id/explanation`, Explain Time). An `automatic_clock_out` exception
  (severity low) opens with their note, once per punch, People are told
  (`attendance.exception_explained`) and decide it as §6.8 says. Until then nothing waits on
  People: an automatic clock-out nobody explains needs no decision.
- **On Home and the register** it is a clock-out like any other: the day's hours, overtime and the
  roster read it. `clock_out_automatic` on the day (My Days) and on today (the panel) says it was
  the system's; a punch's `source` says the same in the day's evidence.
- **Who sees what**: the reminder and the notice go to the person alone. Whether and when someone
  was in front of the app is read on the server and never sent to a screen, an event payload or a
  notice; the punch's evidence keeps the moment its time came from, for the audit.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `attendance.punched` | A punch commits (any result) | Audit; outbox `attendance.push_updated`: `attendance.updated` to the person and to `people` view holders above them; outbox `alerts.person-signal` (Home): a clock-in (`event_type`) re-reads that person's (`employee_id`) Late Arrivals rules |
| `attendance.review_required` | A punch or the day-close opens an exception | Notifies the person and `people` approve holders within scope |
| `attendance.exception_explained` | The person explains an exception | Notifies `people` approve holders within scope |
| `attendance.exception_decided` | People decide an exception | Notifies the person; realtime refresh |
| `attendance.day_closed` | The day-close job closes a person's day | Audit; realtime refresh; outbox `alerts.person-signal` (Home): re-reads that person's (`employee_id`) Late Arrivals and Missing Clock-Out rules |
| `attendance.export_requested` | My Attendance or the register asks for a workbook | Outbox `attendance.send_export`: gathered 25 at a time, kept in the vault, emailed |
| `device.registered`, `device.removed` | My Devices, People · Devices | Notifies the person when People removed it |
| `worksite.created`, `worksite.updated` | People · Worksites | Audit |
| `attendance.home_requested` | A remote employee sets their home location | Audit; notifies `people` approve holders with scope over the person |
| `attendance.home_decided` | People approve or reject a home location | Audit; notifies the person; realtime refresh |
| `location_request.submitted` | An employee sends a work location request | Audit; the approval (`attendance.location_request`) notifies the first stage's approvers |
| `location_request.approved`, `location_request.rejected` | Its approval ends (copied on by `attendance.apply_request_decision`) | Audit; the approval already told the person; realtime refresh |
| `location_request.cancelled` | The person withdraws or cancels it | Audit; realtime refresh |
| `field_assignment.assigned` | A field assignment is set (one event for each person on it) | Audit; notifies the person; realtime refresh |
| `field_assignment.cancelled` | It is cancelled (one for each person still on it) | Audit; notifies the person with the reason; realtime refresh |
| `field_assignment.member_removed` | Someone is taken off it | Audit; notifies the person with the reason; realtime refresh |
| `attendance.schedule_set` | People set a hybrid employee's schedule | Audit on the employee (Record History: Work schedule set); notifies the person with the office days and the first day; realtime refresh |
| `attendance.clock_in_due` | The watch finds someone expected and not clocked in, in the first hour after the start (§6.14) | Notifies the person ("Time to clock in", on the `attendance_clock_reminder` row; push as their preference allows); marked read when they clock in |
| `attendance.clocked_out_automatically` | The watch clocks out an open shift (§6.14) | Audit; notifies the person with the date and time (the day opens on My Attendance); the punch's own `attendance.punched` reloads the screens |
| Job `attendance-day-close` (scheduler, 01:30 Africa/Lagos; queue of the same name for a given date) | Daily | Closes every open day before today within 14 days, under the cron lock; idempotent |
| Job `attendance-clock-watch` (scheduler, every 5 minutes) | All day | Sends the start reminders and makes the automatic clock-outs (§6.14), under the cron lock; idempotent (one reminder a day, one automatic clock-out a shift) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Own clock, days, punches, exceptions, devices, home location, work location requests, field assignments and week | Clock in and out, explain an exception, export the month, register and remove own devices; remote staff, and hybrid staff with a home day, set their home location; ask for a work location, withdraw or cancel it |
| Line Manager, Head of Department (`people` team) | The register, days, devices, exceptions and home statuses of their reporting tree, its work location requests (no temporary home's point) and its weekly schedules; no coordinates or home addresses | Decide the first stage of a direct report's work location request; set a field assignment for people in their reporting tree, cancel it or take someone off (`people` approve); set a hybrid report's schedule where their role holds `people` edit; otherwise read only; export (heads) |
| Operations & People, Management (`people` all) | Everyone, with the punch coordinates, home locations and work location requests | Decide exceptions and home locations (approve), decide a work location request's Operations & People stage, set, cancel and change field assignments for anyone (approve), remove devices and set hybrid staff's schedules (edit), manage worksites (create, edit), export |
| CEO | Everything, as the access rules give the CEO | The same as `people` all, never on their own exception |

The shared roster reads within the scope the caller's grant gives (`scopeClause` on the employee):
the whole organisation, the reader and everyone below them on the solid line, or the reader alone.
`personal()` takes no scope; its caller has already decided the reader may see that person (their
own record, or `assertInScope`).

The punch's coordinates go only to `people` scope all; the person's own screens and team scope get
the verdict, the distance and the worksite's name. The device cookie, its hash and any raw identifier
never leave identity, and no log line carries them.

## 9 · AI and search

- **AI reads** (`attendance.ai.js`): `attendance.my_days` (ess view, own), `attendance.register`
  and `attendance.exceptions` (`people` view, the caller's scope); `devices.ai.js`: `devices.mine`,
  `devices.list`; `worksites.ai.js`: `worksites.list`. Every list is a page of 25, through the same
  service and scope as the screen; no coordinates, no device identifier, no evidence blob.
- **AI routes**: clock in or see my attendance → ESS · My Attendance; review attendance → People ·
  Attendance; register a device → ESS · My Devices; add a worksite → People · Worksites; set my
  home location → ESS · My Attendance; approve home locations → People · Attendance; ask for a work
  location → ESS · Work Location Requests; approve work location requests → People · Attendance;
  send people out on a field assignment → People · Attendance; my field assignments → ESS · My
  Attendance; set a hybrid employee's office days → People · Employees (the record's Attendance
  tab); my work week → ESS · My Profile. No AI read touches a home location, a work location
  request, a field assignment or a schedule.
- **Search**: `attendance.search.js` finds attendance days and exceptions by the person's name;
  `devices.search.js` devices by label or owner; `worksites.search.js` worksites by name or code;
  `attendance.search.js` also finds home locations by the person's name (never by the address), and
  work location requests by their number or the person's name (never by the address), and field
  assignments by their number, name, client or anyone on them (never by a site's address).
  Each within the reader's `people` scope. ⌘K's New Request (`request_work_location`) opens ESS ·
  Work Location Requests with its sheet; a person's own request opens there by `?request=`.
  ⌘K's New Assignment (`new_field_assignment`, `people` approve) opens People · Attendance on its
  form; an assignment opens there by `?assignment=`, and a person's own on My Attendance. A
  schedule is not a record of its own: it is found through the employee (⌘K's employee results
  open the record, whose Attendance tab holds it), and its notice opens the person's own record
  (`employee`, My Profile). A clock-in reminder is not a record to look up
  (`attendance_clock_reminder`, `search:none` in the route map): its notice opens My Attendance with
  the clock panel (`?clock=`). AI does not create punches, decide exceptions or infer missing
  location evidence.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). §3 and §6 are for engineers; only what is listed here reaches a screen.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Clock In / Clock Out panel | For someone working from home that day (remote, or a hybrid home day) with no approved home, a banner (No Approved Home) with Set Home; for someone expected at an office with none assigned, a banner (No Office Assigned); the date and the workplace's current time, the state pill (Clocked Out, Clocked In with its time, Review Required), Shift, Work Arrangement, Clock Location with its radius (on a field assignment's day, its site), This Device with its status; the step before the browser asks (Location Check, one line naming the worksite); Clock In or Clock Out, Allow Location, Retry Location, Register Device, Not Now; the result after a punch with its reasons; Add Note when it is under review; opened by itself, Start Your Day at the start and Finish Your Day at the end, with Remind Me (In 15 Minutes, In 30 Minutes, In 1 Hour) beside Clock Out; after an automatic clock-out, Automatic Clock-Out with the day's times | Clock Location: the punch is matched to this place; This Device: why an unregistered device is flagged under the current policy | "location is read only and not continuously tracked", how block and warn decide, idempotency, how the watch decides who is away and when: §6 here |
| ESS · My Attendance | For remote staff, and hybrid staff with a home day, a Home Location card: the status (Approved, Waiting, Not Set, Rejected with People's reason), the address, Set Home Location or Update Home (a sheet: Use This Location with the reading's accuracy, Address, Send for Approval); Today's card, Field Assignments when the person has any in progress or to come (number and name, dates, the site; one opens with the client, its sites with their address and radius, and who else is on it), the month picker beside Export Month (arrows a month at a time; the month's name opens a year and its months, back two years), Days Present, Late Days (with the share of days present), Absent, Hours Worked, each of the first three opening its days paged at 25, the days with clock in, clock out, hours, status and Review or as a chart of hours (late days stand out), a day's punches, open exceptions with Explain; a clock-out the system made reads Automatic in My Days and the day's punches, and the day offers Explain Time (a sheet: Your Note, Send Note); Export Month | Hours Worked: from the first clock-in to the last clock-out | "a correction never overwrites a punch", how the automatic time is chosen: §6.8, §6.14 |
| ESS · Work Location Requests | New Request; the requests with number, type, dates, place and status (Waiting on its stage, Approved, Rejected, Cancelled); a request opens with its details, its approval trail and Withdraw Request or Cancel Request; the New Request sheet: Type, First Day, Last Day, Address, Reason, for a temporary home Use This Location with the reading's accuracy, and for a client visit a Client Site card (Latitude, Longitude, Radius, Metres), Send Request; a client visit's request shows its Site (the point and radius) | Type: what each type changes on the clock; Radius on the client site: a punch within it counts at the site | How the approval routes and what the clock does on an approved day: §6.11 |
| ESS · My Devices | The devices with status, first seen, last punch and This Device; Register This Device, Remove | Status header: what New, Registered and Removed mean | "How device checks work", the three-device reason: §6.6 |
| People · Attendance | The date, Expected, Present, Late, Absent, On Leave, Not In, Open Exceptions; Register, Exceptions, Homes (status chips; person, address, accuracy, requested, distance from the approved home, status; a home opens with Approve and Reject) and Requests (status chips; person, number, type, dates, waiting on, status; a request opens with its details, its approval route and the decisions so far, and Record Decision, Approve or Reject with a reason, when it waits on the reader) and Field (state chips; number and name, client, people, dates, sites, state; New Assignment: Name, Client, People, First Day, Last Day, Site with Latitude, Longitude and Radius, a second site, Note, Save Assignment; an assignment opens with its details, its sites and people, Take Off on a person and Cancel Assignment, each with a reason); the register (person, arrangement, clock in, clock out, location, device, status, review); a day's evidence, each punch's Source (Clock, Added by People, Automatic); Decide, an Automatic Clock-Out offering Accept and Correct Time; Export | Open Exceptions: what waits on People; Outcome on the decision form: accept, reject or add the clock-out, or for an automatic one keep or correct its time; From Approved Home: how far a new home is from the one in force; Radius on a site: a punch within it counts at the site | The page explainer, "what a manager can and cannot do", reconciliation mechanics: §3, §6.8, §8 |
| People · Devices | Device list with employee, device, status, first seen, last punch; Remove Device | Status header: as on My Devices | "devices register on every punch": §6.6 |
| People · Worksites | Worksites with code, address, radius, assigned and status; Add Worksite; a worksite's details, Edit, Retire or Restore, its employees with Assign Employee | Radius: punches inside count as on site | "How the geofence behaves": §6.5 |
| People · Employees, the record's Attendance tab | A Work Setup card: Work Pattern, Office (the worksite and its radius, or No Office Assigned), Home Location (Approved, Waiting or Not Set, for remote staff and hybrid staff with a home day); a Work Week card: each day of the week with an Office, Remote or Off pill, From (the schedule's first day) and Next (a schedule waiting to start, its days and first day); Set Schedule for a hybrid employee when `can_edit` (a sheet: one Office or Remote choice for each working day, From, Reason, Save Schedule) | Office: a punch on an office day is matched here; Work Week: the days at the office, the other working days from home | How a home day is fenced, the version rules: §6.13 |
| Settings · Attendance Policy | M9 (MILESTONES §18) | | |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Clock In / Clock Out panel | A bottom sheet: the state, the time, the shift and location, then the result (no toast over it); opened by itself, it does not drag away | Nothing | Clock In or Clock Out, full width at the foot; Remind Me above it at the shift's end, its choices an action sheet | The floating button's Clock In or Out (F18); the top bar's clock on desktop; Home · Overview opens it once, when the first session of a working day opens the Overview, for anyone not yet clocked in (home.md §6 Clock-in prompt); it opens by itself at the shift's start and end (§6.14), and from the reminder's notice |
| ESS · My Attendance | For remote staff, and hybrid staff with a home day, the Home Location card first, then Today's card, Field Assignments as cards when there are any, the four figures two to a row, then days as cards | Subtitle | Export Month in the header; Set Home Location full width in its card, its sheet's Send for Approval at the foot | Bottom bar Self-Service; ESS tabs scroll sideways |
| ESS · Work Location Requests | Request cards with number, type, dates and status | Subtitle; the place and Waiting On columns (in the request's sheet) | New Request, full width at the foot; the sheet's Send Request at its foot | ESS tabs |
| ESS · My Devices | Device cards with their status | Subtitle | Register This Device, full width | ESS tabs |
| People · Attendance | The figures two to a row (a figure filters the register), the view switch (Register, Exceptions, Homes, Requests, Field), the status chips scrolling sideways, then register cards with status, clock in and clock out; Homes as cards with the person, status and distance; Requests as cards with the person, type, dates and status; Field as cards with number and name, dates and state | Subtitle; the arrangement, location, device and review columns (in the day's sheet); an assignment's client, people and sites (in its sheet) | A card opens the day's evidence in a sheet; New Assignment in the floating button, its form a full sheet with Save Assignment at the foot | More, then People |
| People · Devices | Device cards with status | Subtitle | A card opens it; Remove Device in its sheet | People tabs |
| People · Worksites | Worksite cards | Subtitle | Add Worksite, full width | People tabs |
| People · Employees, the record's Attendance tab | Work Setup, then Work Week, one under the other | Nothing | Set Schedule, full width under Work Week; its sheet's Save Schedule at the foot | The record's tabs scroll sideways |
| Settings · Attendance Policy | M9 | | | Settings tabs |

## 11 · Edge cases

- Suspended login: auth refuses the session, so no punch arrives. Archived or left employee: 422
  `NOT_EMPLOYED`.
- Approved leave covering the work date: clock-in and clock-out are refused with the leave's dates
  (422 `ON_LEAVE`); the day is `leave`.
- No worksite on a day at the office (on-site staff, a hybrid office day or a hybrid with no
  schedule): the punch is recorded with its reading and goes to review (`location_unverified`,
  `no_worksite`) under warn and block, accepted under off; the panel says No Office Assigned.
- A hybrid employee on a home day: matched to the approved home (100 m) as a remote employee is;
  with no approved home, review (`no_home`). An approved remote day on a home day changes nothing
  but the evidence's place.
- A hybrid employee with no schedule yet: every day is an office day, as before §6.13.
- A schedule changed part way through a week: days already worked keep their judgement; the new
  one decides from its first day.
- A client visit with a site: outside its radius is `outside_worksite` (warn reviews, block
  rejects), named Client Visit. A client visit approved before sites were asked for has no fence:
  the approval is the check.
- A remote employee with no approved home (none set, or one still waiting, or the last one
  rejected): the punch is recorded and goes to review (`location_unverified`, `no_home`) under warn
  and block, accepted under off; the panel says No Approved Home and offers Set Home.
- A remote employee outside their approved home's 100 m: warn reviews (`outside_home`), block
  rejects; inside, or exactly on the radius, is accepted.
- Moving house: the person sets the new home from it; their old home stays the fence until People
  approve the new one. A request sent again while one waits replaces the waiting one.
- A weak reading when setting a home: refused (`HOME_READING_WEAK`); Retry Location.
- A work location request still waiting when its days come: the punches are judged as on any other
  day; approving it later changes the days still to come only.
- Two requests sharing a day: the second is refused (`REQUEST_OVERLAPS`); withdraw or cancel the first.
- A remote employee asking for a remote day, or anyone but remote staff asking for a temporary home:
  refused (`REQUEST_TYPE_NOT_ALLOWED`).
- An employee with no line manager: the first stage goes to the CEO (the engine).
- A field assignment and an approved work location request on the same day: the assignment decides
  the place. A field assignment on a day of approved leave: the leave still refuses the punch.
- Someone taken off a field assignment, or one cancelled, part way through: the days still to come
  go back to their usual place; punches already made keep their judgement.
- A person on two assignments sharing a day: refused (`ASSIGNMENT_OVERLAPS`); take them off the first.
- Outside every site of a field assignment: as outside a worksite, named with the nearer site.
- GPS denied, unavailable, timed out or worse than 100 m: never compliant; review under warn or
  block, accepted with the evidence under off; Retry Location reuses the same Idempotency-Key only
  for the same reading, a new reading is a new request.
- Outside the fence: warn reviews, block rejects; the original evidence stays.
- A double tap, two tabs, or a retry after a lost answer: one punch; the replay gets the first
  answer. Two different keys at once: one punch and a 409.
- Offline, a server that did not answer, or the first press still running: the panel says No
  Connection and keeps the punch's body and key for Try Again, so the retry is answered with the
  first punch if it did land; nothing is queued and nothing pretends to have been recorded.
- A second press while a punch is being recorded is ignored (the button stays busy).
- Midnight: the work date is the workplace's date at the server's time of the punch; a clock-out
  after midnight closes yesterday's shift until the day-close runs.
- A fourth device: refused; the person removes one first.
- The day-close run twice, or a run that died half way: no second exception, no second absence.
- The watch run twice, or late: one reminder a day; a shift clocked out once (the person's lock and
  the one automatic clock-out a day); a run after the first hour of the day sends no reminder.
- Still at work after the shift's end, the app open: the closing prompt, Remind Me as often as they
  like; no automatic clock-out while they are in front of the app. Working elsewhere with the app
  behind other windows counts as away: clock out, or keep the app in front.
- Left the office before the shift's end and never clocked out: clocked out at the shift's end
  (the agreed default); the person explains it and People correct the time.
- Clocked in after the shift's end (an evening start on a working day): clocked out once away 15
  minutes, at the last moment they were in front of the app, never before the clock-in.
- A day that is not worked (a Sunday clock-in, a holiday): no shift end, so no closing prompt and no
  automatic clock-out; the day-close's missing clock-out as before.
- No Redis (the presence store cannot answer): no automatic clock-out that run; reminders still go.
- Two logins for one person: in front of the app on either counts; the later last moment is used.
- A clock-out the person makes while the job is clocking them out: the person's lock decides; the
  second is `ALREADY_CLOCKED_OUT` (the person) or skipped (the job).
- Explaining an automatic clock-out twice: 409 `ALREADY_EXPLAINED`; the note is on the first.
- Push turned off for Attendance and Leave: the reminder still reaches the bell; the prompt still
  opens in the app.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/hr_payroll/clock.guard.js` (`evaluateClockTransition`) | Review events count as active, rejected never do; an explicit `SHIFT_DONE` after the day's clock-out; messages without dashes |
| pixie | `src/shared/hr_payroll/device.guard.js` (`evaluateDeviceRecognition`) | No CEO exemption and no "no device enrolled yet means neutral": an unregistered device is unknown, judged by `device_mode`; the device is the session's `known_device`, never a client fingerprint |
| pixie | `src/shared/hr_payroll/devices.service.js`, `devices.repo.js` | Cap 3 (MyCity's meetings), not 2; registration confirmed by a fresh sign-in, not an email code; no change log table (the event log and audit ledger carry every change) |
| pixie | `src/shared/attendance/geo.calc.js` | Already in `shared/geo` (M0); the policy decision is `attendance.geofence.js` |
| pixie | `src/shared/hr_payroll/lateness.calc.js` (`minutesLate`, `minutesOvertime`) | Lateness after start plus grace, overtime after the end, on the work date's wall clock; the money half (daily rate, tiers) waits for M6 |
| pixie | `src/shared/hr_payroll/hr_ops.service.js` (`selfClock`) and `migrations/000303` | The per-day unique index on active events, the advisory lock first; location is not mandatory (praxis's "always record" with the policy deciding) |
| praxis-ls | `src/modules/hr/attendance/attendance.rules.js` (`wallClock`, `localDate`, `reconcileDay`) | Statuses `present`, `late`, `absent`, `leave` (no weekend or holiday rows); grace as pixie measures it (§6.4); no deductions |
| praxis-ls | `src/modules/hr/attendance/attendance.export.js` | The register and the month as workbooks through `shared/spreadsheet`, gathered 25 at a time, emailed |
| praxis-ls | `doc/CLOCKIN_REVAMP_ENGINEERING_GUIDE.md` §1.2 (the policy model) | `block` rejects, as MyCity asked; praxis holds every punch instead |

## 13 · Open questions

- Homes are decided for remote staff (§6.10, 18/10/2026): set by the employee from home, approved
  by People, fenced at 100 m, no approved home means review. Work location requests are decided
  (§6.11, 19/10/2026): temporary homes, remote days and client visits, approved by the line manager
  then Operations & People; on an approved remote day or client visit the approval is the check.
  Field assignments are decided (§6.12, 19/10/2026): set by the line manager or People, in force at
  once, one or two typed sites, whole days, a crew on one. Hybrid staff's weekly schedule is decided
  (§6.13, 19/10/2026): People set the office days, the other working days are home days fenced on
  the approved home. A client visit carries its site, typed, and is fenced on it; an office day with
  no office assigned goes to review (19/10/2026). Still open: adding people to an assignment or
  changing its sites and dates (cancel and set a new one); picking a field site's or a client
  visit's point from an address once the address search exists (F21); a temporary home for hybrid
  staff (today remote staff only).
- The map and address search proxy (F21, Geoapify through our API) is not built; worksite
  coordinates are typed in.
- Policy Updates (#89) and policy versions with acknowledgement come with Settings · Attendance
  Policy (M9).
- A late punch raising a query (MILESTONES §6 definition of done) waits for the query rules (M3).
- Offline punching for field staff is not in scope (BACKEND_STRUCTURE §15).
- Clock prompts are decided (§6.14, 19/10/2026). Configurable reminder rules (other times, other
  people, a reminder before the start) stay with Settings · Notifications (#74, M6); a cap on
  Remind Me (the policy's `latest_clock_out_minutes` is read but not yet used) is not decided.

## 14 · Change log

- 14/10/2026 · LA · Added the template metadata, engineering sections, mobile register behaviour and ownership-ready scope required by the guide check.
- 14/10/2026 · TB · §10 rewritten to the On screen and mobile shape (content tiers and phone layout) for the screen conventions in FRONTEND_GUIDE §5 and §7; the phone register cards from this guide are kept.
- 15/10/2026 · AJ · Frontend built in `app/src/features/attendance/` and Settings · Attendance Policy (draft, review, publish, acknowledgement report) against the mock API; not wired yet.
- 15/10/2026 · AJ · Screens brought to §10 and the screen conventions (FRONTEND_GUIDE §5, §7, §8): the ⓘ texts and explainer cards (how requests are decided, why devices are recorded, the geofence and masked-home cards, what a manager can do) are gone; setting help is a help term on its label; Add Field Assignment is a two-step wizard; every form marks its fields on Submit instead of disabling it; lists are cards on a phone. Gates 8 and 11 now crawl these screens.
- 15/10/2026 · AJ · Frontend foundation PR 2 (Shell): the clock moved into the shell's reach on both shells. `ClockButton.tsx` now exports `useClock` (the desktop top bar's button and the phone's floating button share it) and `useClockPrompt` (the after-sign-in panel, called once by the shell, so it opens on a phone too, where the top bar has no clock). §10.2 navigation follows the new phone shell: bottom bar Self-Service, More for People, Clock In or Out in the floating button.
- 16/10/2026 · TB · Frontend foundation PR 3 (Build kit): these screens now draw from `@mycity/ui` rather than the app's own components. The registers are `DataView` (the same table on desktop, the same cards on a phone, and now server sort on the columns the contract allow-lists); the hours chart, the on-time donut and the trail are the shared `AreaChart`, `DonutChart` and `Timeline`; People · Attendance's list beside its day is `SplitPanes`, with the divider the keyboard can move; the worksite map and its geofence are `MapView` (F21, Leaflet with Geoapify through our API), and the clock-in address is `LocationLabel`. §10 is unchanged: every screen shows what it showed.
- 17/10/2026 · LA · Clock-in and clock-out built on the real API with the geofence and device checks: the guide rewritten to what is built. The policy modes `off`, `warn`, `block` (geofence warn, device off by default) from MILESTONES §6.2 and REUSE_MAP §2.2 replace the booleans; the permission key is `people` (README §5.2) with own-scope `self` routes for the person's clock; `devices` and `worksites` join the backend modules; three registered devices without People's approval (12 and 13 October); §4 to §9 describe the tables, routes, rules, events and reads as built; §10 drops field assignments, location requests, the manager preview and the map from these screens until their API exists (§13); Settings · Attendance Policy is M9 (MILESTONES §18).
- 17/10/2026 · LA · The five screens on the real API through `contract.gen.ts`: the clock panel (location asked only after the press, the reason first; Retry Location and Clock In Anyway; No Connection with the same key and body on Try Again; the server's result with Send Note for a punch under review), ESS · My Attendance and My Devices (Register This Device behind a fresh sign-in), People · Attendance (figures, register, a person's day with every punch's evidence, exceptions and the decision, Export Register for up to 31 days), People · Devices (Remove Device with a reason) and People · Worksites (add, edit, retire, restore, assign). `AttendanceToday.policy` gained `max_accuracy_m` so the panel offers Retry Location without a rule of its own. The INTERIM attendance types keep only Work Location Requests, Policy Updates, the policy settings and the employee setup tab; the mock answers the built routes in the contract's shapes. §3, §5, §10.2 and §11 updated.
- 17/10/2026 · TB · The shared attendance roster (`attendance.roster.js`): `summary`, `page` and
  `personal`, the one read of a day that Home uses now and My Attendance will; its status
  vocabulary and order, the expected set, lateness against the start plus the policy's grace, the
  remote rule and the yesterday flag are in §6, the tables it reads as built in §4, its scope in §8,
  and field status and the day's vocabulary in §13. Read only, no route, no event. Header gains the
  Capabilities row (none). Written for Home by owner decision; LA reviews.
- 18/10/2026 · TB · The shared roster now follows this module (§6.9), after clock-in and clock-out
  were merged: it reads each day's `attendance_day` record as the punch, the decision and the
  day-close write it, so which punches count (a punch People rejected no longer counts), the work
  date, lateness (whole minutes past the start plus grace, the organisation's policy when a person
  has none) and leave are decided once, here. A day with no record and the people on a day follow
  the register; `present` splits into on site and remote by the work pattern (no longer by a punch
  with no worksite); `absent` joins the roster's statuses; a person's totals are My Attendance's
  (`repo.daysSummary`). §3 step 8, §4, §5 and §13 follow; the "one vocabulary" question is closed
  by `1300`. `1150` no longer adds `attendance_event (occurred_at)`.
- 18/10/2026 · TB · The panel's after-sign-in opener moved to Home (owner decision O12, home.md §6): Home · Overview opens it with `useClock().open` once when the server's `prompt_clock_in` says it is due, and `ClockButton.tsx` exports `useClockSync` in place of `useClockPrompt`, which the shell still calls so a punch made elsewhere refreshes the state. The panel, its punch and §10.2's floating button are unchanged; §2 and §10.2 say who opens it.
- 18/10/2026 · TB · Home's review fixes: §2 and §10.2 now say the panel opens when the first session of a working day opens Home · Overview, so a first session that signs in through a link to another screen and never opens the Overview is not prompted that day (the top bar and the floating button still open it). Home · Overview now reads itself again after a punch, from its own files. Nothing in Attendance's code changed.
- 18/10/2026 · TB · The shared roster gains what Home's Team tab reads (§5, §6.9), for LA's review: `month()`, one page of 25 people with My Attendance's totals over a range of up to 31 days in one query (Attendance This Month); `flagged` (late, or no clock-out yesterday, each person once) as a count on `summary()` and a filter on `page()`, so the Flags card equals the records it opens. Nothing this module records or decides changed.
- 18/10/2026 · TB · Home's alert metrics named as the one other reader of `attendance_day` and `attendance_exception` (step 8, §6.9) and Home's `alerts.person-signal` handler on `attendance.punched` and `attendance.day_closed` (§7), with the payload fields it reads; the roster's header says the same. Nothing this module records or decides changed.
- 18/10/2026 · AJ · My Attendance gains the 12 October asks (`docs/guides/ess.md` §13): the month picker beside Export Month (arrows, or a year and month picked directly), the share of days present on Late Days, Days Present, Late Days and Absent each opening their days (`GET /attendance/me` takes `status`), and the days as a table or a chart of hours. §5 and §10 updated; LA to review.
- 18/10/2026 · LA · Remote staff are fenced on an approved home (owner decision, 18/10/2026, closing the 13 October question in §13): the employee sets their home from it on My Attendance (one reading within `max_accuracy_m` and their address), People approve or reject it on People · Attendance (Homes; `people` approve, scope all, never their own), and a remote punch is judged against it at the policy's `home_radius_m` (100 m): outside is `outside_home` (review under warn, rejected under block); no approved home is `location_unverified` (`no_home`), review under warn and block, never rejected. Hybrid staff stay on their worksite until a per-day schedule exists. `attendance_home`, `home_radius_m` and the `outside_home` type in `1310`, its name in `1391`; five routes; two events. The address and coordinates are personal data (masked under `employee.personal`, scope all only) and travel in no event, notification, AI read or search result. §1 to §11 and §13 updated.
- 19/10/2026 · LA · Work Location Requests (#87) built (owner decisions, 19/10/2026): three types (a temporary home for remote staff with one reading taken there, a remote day for on-site and hybrid staff, a client visit for anyone), each approved by the line manager then Operations & People through the `attendance.location_request` approval, numbered `WLR-0001`, withdrawn while waiting or cancelled before the first day. On an approved day the request decides the place: a temporary home is fenced like a home, a remote day uses the approved home when there is one, and otherwise (and for a client visit) the approval is the check, the reading kept as evidence. A present remote day counts as remote on Home's roster. `attendance_location_request` in `1320`, the numbering scheme and approval in `1392`; six routes; four events. Policy Updates (#89) stays M9 with Settings · Attendance Policy. §1 to §11 and §13 updated.
- 19/10/2026 · LA · Field assignments (owner decisions, 19/10/2026): a line manager or People send one or more people to one or two typed sites for up to 31 days, numbered `FA-0001` and in force at once; on its days the assignment's sites decide the place before anything else, judged as a worksite; cancel it or take someone off with a reason. A present day on one counts as `field` on Home's roster. `1330` and `1393`; seven routes; three events. §1 to §11 and §13 updated; §6.12 added.
- 19/10/2026 · AJ · The person on the register, exceptions, devices and a worksite's people carries `photo_url` (`PersonRef`, `WorksiteEmployee`; `attendance.repo.js` and `devices.repo.js` now read the person through `shared/db/person.js`, the roster adds it to its rows): People · Attendance, Devices and Worksites show faces, initials when there is none. Download My Data reads a person's days and punches through `listDays` and `listEvents` without coordinates (`docs/guides/ess.md` §3 step 8). LA to review.
- 19/10/2026 · LA · The client's attendance rules (owner decisions, 19/10/2026): hybrid staff's weekly schedule (§6.13): People set the office days from a date on the employee record's Attendance tab, the other working days are home days fenced on the approved home (hybrid staff with a home day now set a home too), and a present home day counts as remote on Home's roster and the register; the week, Office, Remote or Off, reaches My Profile. A client visit carries its site's centre and radius (100 to 500 m) and is fenced on it (§6.11). A day at the office with no office assigned is `unverified` (`no_worksite`) and goes to review instead of being accepted unchecked (§6.5). `1340`, `1350`; two routes; one event. §1 to §11 and §13 updated; §6.13 added.
- 19/10/2026 · TB · Clock prompts, reminders and the automatic clock-out (owner decisions, 19/10/2026, from the 12 and 13 October meetings; §6.14): the clock panel opens by itself at the shift's start for someone not clocked in and at its end for someone still in (Remind Me in 15 minutes, 30 minutes or an hour), never over an open dialog and never dismissed by the scrim; job `attendance-clock-watch` (every 5 minutes) sends one reminder a day in the first hour after the start (`attendance.clock_in_due`, bell and push, marked read on clock-in) and clocks out an open shift once its end has passed and the person has been away from the app for 15 minutes, at the shift's end or the last moment they were in front of it (`source = 'system'`, accepted, read as Automatic, `attendance.clocked_out_automatically` tells them). The person explains one from the day (`POST /attendance/me/events/:id/explanation`), which opens an `automatic_clock_out` exception People accept or correct; the day-close's missing clock-out stays for what the watch cannot judge. `attendance_clock_reminder`, the new type and the unique indexes in `1360`, its label in `1394`; one route; two events; one job. §2 to §11 and §13 updated.
- 19/10/2026 · TB · Attendance's notices are listed in Settings · Notifications (`docs/guides/notifications.md` §6):
  People may switch any of them off company-wide, and copy Attendance needs review, Attendance
  explanation and Home location to approve to other roles or people (`copy`). Nothing else changed.

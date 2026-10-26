# Attendance · Engineering Guide

| | |
|---|---|
| Owner | LA |
| Milestone | M1 |
| Backend modules | `attendance`, `devices`, `worksites` |
| Frontend paths | `app/src/features/attendance/` |
| Permission key(s) | `people` (all, team, own) for the register, devices and worksites; `people` approve, all, to decide exceptions, homes and temporary sites; `people` edit, within its scope, to set a work schedule; none for the person's own clock, attendance, devices, work schedule and temporary sites (`self`, own only). The Attendance policy itself is a rules policy in Knowledge Hub · Policies (`policies.md`) |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #9 My Attendance, #87 Work Location Requests, #88 My Devices, #25 Attendance, #27 Devices, #28 Worksites, the Work Schedule tab of the employee record (#24 Employees), Home · Overview's Add Work Site (#1), and the Attendance policy's worksheet on Knowledge Hub · Policies (#62, `policies.md`). #89 Policy Updates moved to `policies.md`; #73 Settings · Attendance Policy is dropped (TB, 20/10/2026) |
| Status | Agreed |
| Last changed | 22/10/2026 |

Sources, in their order of authority (CLAUDE.md step 3): TB's decisions of 20/10/2026 (§1.1);
MILESTONES §6.2 and A22, A26; REUSE_MAP §2.2 (the policy model and the donor files); the 12 and 13
October meetings (three devices, enrolment without People's approval, the office fence, a policy
People set and staff read and acknowledge) and Cynthia's email of 13 October (remote staff fenced on
the registered home, anything outside flagged for HR review, HR approves exceptions);
BACKEND_STRUCTURE §15 (the device's own time beside the server's). `demo.html` is look only.

---

## 1 · What it is for

Attendance lets an employee clock in and out from the place they are expected to work (their
worksite; for remote staff, while the policy's Home Location is on (§1.3), the home People approved;
and for hybrid staff one or the other by their work schedule), on a device they registered, on the days and hours of their own work schedule, and
gives People and line managers a register of who is in, late, absent or on leave, with the evidence
behind every punch. Anyone who will work somewhere else for some days (a client's office, a
training, an event, a coworking space, an assignment out of station) adds a temporary site from
Home, and once People approve it, those days' punches are matched to it; People add one themselves
when they send people out. A punch the rules cannot accept outright is still recorded, as evidence,
and opens an exception People review; nothing is overwritten. Lateness, early departure, absence
and forgotten clock-outs are counted against the policy's rules, which raise alerts and queries and
add pending deductions; overtime is counted and approved as the policy says.

The rules a punch and a day are judged by are the **Attendance policy**, a rules policy People set
on Knowledge Hub · Policies (`policies.md`): the hours and each person's schedule, the grace period,
how lateness, early departure, absence and forgotten clock-outs are counted and what each leads to
(an alert, a query, a deduction), overtime and how it is approved, whether homes are used at all
(Home Location, §1.3), how strictly the location is checked at the office, at home and at a
temporary site, and the device check. Each is a switch, a
figure or a choice with a suggested value; the system enforces what People set. A change is a
draft until People publish it as a numbered version from a first day; everyone reads it on ESS ·
Policy Updates in plain sentences with what changed, and acknowledges it.

### 1.1 Decisions (TB, 20/10/2026, binding)

| # | Question | Answer |
|---|---|---|
| T1 | Where the policy lives | Knowledge Hub · Policies, as the Attendance rules policy (`policies.md` P1, P8). Settings · Attendance Policy is retired. The policy is the one source of every attendance threshold: Home's alerts and the query rules read theirs from it |
| T2 | Lateness | Once past grace, late is counted **from the start time**: grace 5 minutes, in at 09:12, is 12 minutes late |
| T3 | Late arrivals | One row: **N late arrivals or H late hours in a period** (a week, a month, 30 days), with switches for Alert and Raise Query. A query is raised only when its switch is on. After a breach the count **restarts**, so three late arrivals raise exactly one query and the sixth raises the next |
| T4 | Deductions | Offered methods: **pro-rata by minute** (hourly rate times time late; hourly rate is the monthly gross over that month's working days over that day's hours), **a fixed amount per hour or part of one**, **a fixed amount per late day**. Once switched on, each late or absent day adds a **pending deduction** the person sees; People can waive any, one by one or in a batch, until the payroll run is locked |
| T5 | More rules | **Absence** (a day's pay; a query after N), **early departure** (counted like lateness from the end), **forgotten clock-outs** and **location flags** (N in a period: alert and query). Each starts off; People switch it on and set its figures |
| T6 | Overtime | A switch. When on, People choose how it is approved (suggested: the line manager confirms the hours afterwards; or pre-approved; or automatic) and its rate. We suggest, People set |
| T7 | Hours | The policy holds the company hours, and says **"Where your own work schedule differs, your schedule applies."** A day is judged by the person's schedule in force that day |
| T8 | Work schedules | A **Work Schedule** tab after Job on the employee record (it replaces the Attendance tab): each weekday Working or Off, its hours and Office or Remote, from a date. Blank means the company hours. ESS · My Profile shows it; the person is told when it changes and does not acknowledge it. A consultant who works Tuesday, Thursday and Saturday is never late or absent on a Monday |
| T9 | The fence | Homes and temporary sites have a radius of **at least 150 m** (Cynthia's 100 m email is answered: GPS indoors drifts 30 to 60 m). Offices keep each worksite's own radius |
| T10 | Rough readings | A reading too rough to prove where someone is (a phone set to approximate location, a laptop on cable) is never refused: the panel names the fix for that device, and a punch made anyway reaches People as **Location Unclear** |
| T11 | Working somewhere else | **Permanent sites** (the offices) and **temporary sites** in People · Worksites. A temporary site is a purpose from a searchable list (a client visit, a training, an event, a coworking space, an out-of-station assignment and more), its name, one or more picked addresses, the dates, the people and a description. People add one directly; anyone else submits it from Home (**Add Work Site**, a sheet, no page) for themselves and colleagues, and People approve it once for everyone on it. Once approved, clocking in there raises no flag. It replaces work location requests and field assignments |
| T12 | Several stops a day | On a temporary site's day the person clocks in once and presses **Check In** at each stop; each check-in is matched to the site's addresses and flagged when outside |
| T13 | Forgetting to clock out | From the shift's end a reminder every 30 minutes; **90 minutes after the end** the system clocks the person out and the day reads **System Clock-Out**. Time after the end is never counted as worked or overtime from a system clock-out; the person can give their real time and People confirm it. Both figures are the policy's |
| T14 | What the policy tells staff | "Working somewhere else? Add it from Home, or ask People." |

The decisions of 18 and 19 October that these change are marked where they stood (§6.5, §6.11 to
§6.15); the rest stand.

### 1.2 Delivery

The design is built in four pull requests (TB, 20/10/2026). Each section of §6 names its PR. Each PR
takes its migrations from its own part of the M1 block, so the four never collide.

| PR | Builds | Sections | Migrations | Status |
|---|---|---|---|---|
| 1 · Policies foundation | Knowledge Hub · Policies and ESS · Policy Updates for every policy (`policies.md`); the Attendance policy moved into it with today's rules; the clock reads its rules through `policies.rulesFor`; Settings · Attendance Policy retired | §6.1, §6.15 (the worksheet's existing rules, and the contract for every rule) | 1400 to 1419 | Built |
| 2 · Clock fixes | The audit of 20/10/2026: the location reading, Location Unclear, Refuse opening an exception, a rejected punch freeing its slot, leave on the work date, the clock panel's location reader | §6.2, §6.3, §6.5, §6.7, §6.8, §11 | 1380 to 1389 | Built (21/10/2026) |
| 3 · Rules and schedules | Hours in the policy and work schedules; lateness from the start; the consequence rules (alerts, queries); pending deductions and overtime; reminders and the system clock-out; each day judged by its own version | §6.4, §6.13, §6.14, §6.15 (the rules' effects), §6.16, §6.17 | 1420 to 1449 | Built (21/10/2026) |
| 4 · Places | Permanent and temporary sites, Add Work Site on Home, HR's approval, Check In at each stop; work location requests and field assignments retired | §6.11, §6.12 | 1450 to 1479 | Built |

Until a PR lands, the behaviour its sections replace is what runs; the sections say what stood before.

### 1.3 The Home Location switch (TB, 22/10/2026, binding)

At the Milestone 1 handover (21/10/2026) Edidiong asked that home location be something MyCity can
turn off, and Cynthia asked to keep the home checks. Home location is now a switch of the Attendance
policy. TB's ten answers of 22/10/2026:

| # | Question | Answer |
|---|---|---|
| H1 | Where the switch lives | The Attendance policy: **Home Location** (`home_location`), a switch on the worksheet's Location Checks card, with Home Check and Home Radius beneath it while it is on (§6.15). A change is a version from a first day, approved, signed and acknowledged like every rule |
| H2 | Its state when it ships | **Off.** Every version published before it reads it off, as a rule a version predates always does (§6.15); the type's default and its suggestion for a first draft are off too |
| H3 | Who decides a change | As the policy's own Needs Approval says, like every other rule (`policies.md` P6) |
| H4 | Who it covers | Everyone: one switch for the company, remote staff and hybrid staff's Remote days alike |
| H5 | A remote day while it is off | No location at all: the panel asks for none and the server keeps none (§6.5). The punch is accepted for its place (Not Checked); the device and time checks still run |
| H6 | Temporary Home while it is off | Hidden: Add Work Site does not offer it and the API refuses it. One already approved reads as a remote day, unchecked, its hours and time zone kept, with no Check In on its days (§6.11, §6.12). Every other purpose is untouched |
| H7 | Homes already registered | Kept, unread and shown nowhere while it is off. Switched on again, an approved home is the fence again and a waiting one waits again |
| H8 | When it is switched on | Everyone whose week has a Remote day with neither an approved nor a waiting home gets one push, **Set your home location**, in the working day, once for each stretch it stays on; someone who starts working from home while it is on gets it then (§6.10). Their clock-ins still go to review until People approve a home, as before |
| H9 | Open Outside Home and no home exceptions | Left for People: a day is judged once (§6.4) |
| H10 | The residential address | Untouched: the Home Address on the employee record, My Profile and Download My Data is HR's record of where someone lives, not the clock's |

While it is off, staff read one sentence under Working From Home: "Working from home, your location
is not checked." (assumed with H5, TB to confirm). It ships off although the handover agreed to keep
home checks: MyCity are told (§13).

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Clock In / Clock Out panel (`clock`) | Desktop top bar, the phone's floating button, and by itself over a blurred screen: on the first screen of the day's first sign-in, at the shift's start and at its end (§6.14) | Every employee, own record | Today's date and time at the workplace, the shift (from their work schedule), the clock location and radius (on a temporary site's day, its addresses), the state (Clocked Out, Clocked In since, Review Required), this device's state, the result of a punch, the fix for a rough reading (§6.5), a day ended by a System Clock-Out; while Home Location is off, a remote day reads Not Checked, with no location step and no home banner (§1.3) | Clock in or out, allow location, retry location, register this device, add a note to a punch under review; on a temporary site's day, Check In at each stop (PR 4); at the shift's end, Clock Out or Remind Me |
| ESS · My Attendance (`my-attendance`) | Employee Self-Service | Every employee, own record | Today, the month's figures, the days of the month, each day's punches and check-ins (a clock-out the system made reads System Clock-Out), open exceptions; pending deductions and overtime for the month with their amounts (PR 3); while Home Location is on (§1.3), for remote staff, their home location (approved, waiting or not set); their temporary sites, today's and those to come | Pick a month, open a figure's days, switch the days between a table and a chart, open a day, explain an exception or give the real time of a system clock-out, export the month, open a temporary site; while Home Location is on, remote staff set their home location from home, for People to approve |
| ESS · My Devices (`my-devices`) | Employee Self-Service | Every employee, own devices | The devices they clock in from, each with its status, up to three registered | Register this device, remove one of theirs |
| People · Attendance (`attendance`) | People | `people` view: Operations & People and Management everyone, line managers and heads their team | The day's figures, the register, a day's evidence (each punch's source: Clock, Added by People, System), exceptions, remote staff's home locations (the Homes view, while Home Location is on, §1.3); Deductions and Overtime (PR 3): the pending items with their days, minutes and amounts | Pick a day, filter, open a person's day, decide an exception (scope all, `people` approve), approve or reject a home location (scope all, `people` approve, while Home Location is on), waive deductions one by one or in a batch (scope all, `people` approve), confirm or cut overtime (the line manager for their team, People for anyone, as the policy says), export the register. A day's evidence shows its check-ins in time order between the clock-in and the clock-out (PR 4). The Requests and Field views and New Assignment left this screen in PR 4 for People · Worksites, Temporary |
| People · Devices (`devices`) | People | `people` view, within scope | Every device used to clock in, its owner and status | Remove a device (`people` edit) |
| People · Worksites (`worksites`) | People | `people` view | A switch, **Permanent** or **Temporary** (PR 4). Permanent shows the offices alone, with their centre, radius and who is assigned. Temporary shows the temporary sites in the reader's scope with number, purpose, name, dates, people and state, those waiting for approval first; and, beside them while one still waits or is in force, the work location requests and field assignments made before PR 4 (Requests, Field) | Add, change, retire and restore a permanent site (`people` create, edit); assign employees; add a temporary site (`people` approve, scope all: in force at once), approve or reject one submitted from Home (the stage's approvers, never someone on it), cancel one or take someone off it; on a request made before PR 4, Record Decision while it waits; on a field assignment made before PR 4, Cancel Assignment and Take Off while it is in force |
| Home · Overview (`overview`, home.md) | Home | Every employee | An Add Work Site button beside New, and an entry in New (PR 4) | Open the temporary site sheet: Purpose (Temporary Home among them only while Home Location is on, §1.3), Name, Addresses, First Day, Last Day, People, Description, Submit for Approval |
| People · Employees, the record's Work Schedule tab | People | `people` view, within scope | After Job (PR 3; it replaces the Attendance tab): Work Setup (work pattern, office and radius, home location's state while Home Location is on) and the work schedule in force and one waiting to start: each weekday Working or Off, its hours and Office or Remote, from a date; Company Hours when none is set | Set Schedule (`people` edit, within scope, never their own) |
| ESS · My Profile (`my-profile`, ess.md) | Employee Self-Service | Every employee, own record | Their work schedule: each day Working or Off with its hours and Office or Remote (read from this module) | Nothing here: People set it |
| ESS · Work Location Requests (`work-location-requests`) | Employee Self-Service | Every employee, own | The temporary sites they submitted or are on, with number, purpose, name, dates and state, each opening with its addresses, people, description and approval trail (PR 4); under them, while any is still listed, their own requests made before PR 4 (temporary home, remote day, client visit) with their approval trail | Add Work Site (the same sheet as Home's), Withdraw Submission while it waits; on a request made before PR 4, withdraw or cancel it as before. New Request left in PR 4 |
| Knowledge Hub · Policies (`policies`, policies.md) | Knowledge Hub | `policies.manage` | The Attendance policy's worksheet (§6.15, §10) | Change the rules, publish a version |
| ESS · Policy Updates (`policy-updates`, policies.md) | Employee Self-Service | Every employee | The Attendance policy's sentences with every other policy that applies to them | Acknowledge |
| Home · Alerts (`alerts`, home.md) | Home | As Home · Alerts | Attendance alerts raised by the policy's rules (PR 3); their rules listed read only, Set in Attendance Policy | Clear an alert |
| Notifications (bell) | Global header | The person and People within scope | A reminder to clock in when the shift starts, reminders to clock out after it ends and a system clock-out, review needed, a missing clock-out, a decision on an exception, a device registered or removed, a home location waiting or decided, Set your home location once Home Location is switched on (§1.3, H8), a temporary site waiting on you, approved or rejected, one you are put on, taken off or that is cancelled, your work schedule set, deductions added or waived and overtime to confirm (PR 3), an attendance rule breached | Open the record |

## 3 · How the screens relate

1. **People set the policy** (Knowledge Hub · Policies, the Attendance policy, `policies.md`): the
   worksheet of §6.15, saved as a draft and published as `Version N` from a first day, after the
   Policy Approval route when the policy needs one. Every punch and day on or after that day is
   judged by it (§6.1); a punch already made keeps the version it was judged by
   (`attendance_event.policy_version_id`). Everyone reads it on ESS · Policy Updates and
   acknowledges it; acknowledging never blocks the clock.
2. **People set up places and people.** Permanent sites (People · Worksites, Permanent) carry a
   centre, radius and timezone, and the employees assigned (`employee.worksite_id`, through the
   organisation service). Each employee works the company hours unless People set them a work
   schedule (the record's Work Schedule tab, Set Schedule): each weekday Working or Off, its
   hours, and Office or Remote, from a date, with a reason (§6.13). The person is told, and My
   Profile shows it.
3. **The employee registers their device and, working from home, their home.** The browser they
   clock in from (ESS · My Devices, Register This Device) is the device identity sign-in already
   keeps (`known_device`), confirmed by a fresh sign-in, at most three at a time. While the
   policy's Home Location is on (§1.3), anyone whose week has a Remote day sets their home from home
   (ESS · My Attendance, Set Home Location): one reading and their address, picked; People approve
   or reject it (People · Attendance, Homes), never their own. The approved home is their fence on
   remote days (§6.5, §6.10). When it is switched on, those who still need one are pushed once to
   set it (H8); while it is off nobody is asked and a remote day is not checked (H5).
4. **Working somewhere else** (PR 4, §6.11). Anyone presses Add Work Site on Home: a purpose from the
   list, a name, one or more picked addresses, the first and last day, the people (themselves,
   colleagues or both) and a description. It is numbered (`TS-0001`) and opens the
   `attendance.temporary_site` approval (Operations & People by default; nobody on the site may
   decide it). Once approved, on its days everyone on it has their punches matched to its addresses
   before anything else, read in its time zone, and the location flags it covers that were already
   raised on those days clear themselves; People adding one themselves puts it in force at once.
   Work location requests and field assignments made before PR 4 keep applying until their last day,
   after temporary sites (§6.11, §6.12 say how they ran).
5. **The employee clocks in** (the clock panel). The panel names the place the day expects (the
   office, the home, a temporary site's addresses) and asks the browser for a reading only when Allow
   Location is pressed (straight away when already allowed, and never when the browser has blocked
   it: the panel then says how to allow it). On a remote day while Home Location is off it asks
   for no reading at all (H5). It reads for up to ten seconds and keeps the best fix; a
   reading too rough to prove the place offers the fix for that device and Clock In Anyway (§6.5). It sends `POST /attendance/punches` with an `Idempotency-Key`, and shows the
   server's answer. On a temporary site's day, Check In at each later stop sends
   `POST /attendance/check-ins` (§6.12).
6. **The service decides the punch** (§6): the clock guard, the place against the day's fence, the
   device, the device's time. It records an `accepted`, `review` or `rejected` event with its
   evidence and the policy version, updates the day (`attendance_day`), opens exceptions (a refused
   punch included), counts the day against the policy's rules and settles its pay items
   (§6.16, §6.17: a breach is recorded and `attendance.rule_breached` emitted here, with the punch),
   and emits `attendance.punched` in the same transaction.
7. After commit the outbox pushes `attendance.updated` to the employee and to People within scope,
   `attendance.review_required` notifies People and the employee, and a breach's alert is raised
   (`attendance.raise_breach_alert`, §6.16).
8. **People review.** They open the person's day from the register, read the evidence and decide
   the exception: accept, reject (the punch stops counting and frees its slot), or add the missing
   clock-out time. The source event is never edited; a correction is a new event with
   `source = 'admin'`. The decision recalculates the day, its pay items and its rule counts in its
   own transaction (§6.16, §6.17).
9. **The clock asks at sign-in, at the start and at the end** (§6.14). The panel opens by itself
   over a blurred screen: at the day's first sign-in for someone not clocked in, at the shift's start
   and at its end, each by the person's own shift. A reminder goes to anyone not in within the
   first hour. From the shift's end, anyone still clocked in is reminded every 30 minutes, and 90
   minutes after the end the system clocks them out (System Clock-Out; both figures the policy's).
10. **The day closes** at 01:30 Lagos (the day-close job): an open clock-in becomes a missing
    clock-out exception, an expected working day with no clock-in becomes absent, approved leave
    becomes leave, each by the person's own schedule (an Off day is never absent, and nor is anyone
    with no active login). The day's late, early and absent days are counted against the rules
    (§6.16) and pending deductions and overtime are added (§6.17), in the same transaction.
11. **Rules act** (§6.16). When a rule the policy switched on is reached (three late arrivals in a
    month, two absences, three forgotten clock-outs), the breach is recorded in the transaction that
    crossed it; after commit it raises the alert on Home · Alerts when Alert is on, and, when Raise
    Query is on, the query (Queries & Sanctions, M3; until it exists, the alert reads Query Due and
    is raised even with Alert off). The count restarts.
12. **Money** (§6.17). A late, early or absent day under a deduction rule that is on adds a
    pending deduction the person sees on My Attendance; People waive any before payroll takes it
    into a run (M6 takes the rest). Overtime past the policy's minimum is confirmed as the policy
    says (the line manager afterwards, a pre-approval, or at once) and then waits for the run.
13. **Home reads a day's attendance** through the shared roster (`attendance.roster.js`, §6.9): the
    Clocked In Today card and the list behind it, the Team tab and a person's own month, so a figure
    on Home is the figure on People · Attendance and My Attendance. Home's attendance alerts are
    the policy's breaches (§6.16, home.md §6); Home has no attendance rules of its own.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `attendance_policy` (1000, 1300, 1310, 1370) | The rule columns, `status`, `version`, `effective_from` and who published or withdrew each version | **Frozen from PR 1**: its versions moved to `policy_version` with the same ids (`policies.md` §4, `1405`), their rules as `policy_version.rules`. Read by nothing; a later release drops it with `1000`'s booleans and `1300`'s `geofence_mode` (MIGRATIONS §8) |
| `attendance_policy_acknowledgement` (1370) | `attendance_policy_id`, `employee_id`, `reminded_at`, `acknowledged_at` | **Frozen from PR 1**: moved to `policy_acknowledgement` (`1405`) |
| `employee_attendance_policy` (1000) | `employee_id`, `attendance_policy_id`, `worksite_id`, `effective_from`, `effective_to` | Never written, and from PR 1 not read: one organisation policy (§6.1), and a person's own hours are their work schedule (§6.13). Dropped with `attendance_policy` |
| `attendance_event` (1000, 1300, 1360) | `employee_id`, `event_type` (`clock_in`, `clock_out`), `work_date`, `occurred_at` (server time), `device_at`, `latitude`, `longitude`, `accuracy_m`, `distance_m`, `worksite_id`, `known_device_id`, `attendance_device_id`, `source` (`pwa`; `admin`, People's correction; `system`, an automatic clock-out, §6.14), `validation_state` (`accepted`, `review`, `rejected`), `validation` (evidence), `idempotency_key`, `attendance_policy_id` (to PR 1), `policy_version_id` (from PR 1, `1405`; a punch from before keeps its version in `attendance_policy_id`, the same id, since the table is append-only: read `COALESCE(policy_version_id, attendance_policy_id)`), `note`, `recorded_by`, `reason`, `slot` (`1380`: how many punches of its type that day, among the person's and People's, a decision had already excluded when it was written; 0 for the first) | Append-only: `slot` is written once, with the punch. Unique: one active (`accepted` or `review`) event of each type per person, work date and slot among the person's and People's punches (`1380`), so a punch People rejected keeps its row and its slot and the next takes the next slot, while two written at once still collide; one automatic clock-out per person per work date (`1360`), so People's correction stands beside the automatic one it replaces; one event per person per idempotency key |
| `attendance_day` (1000, 1300, 1425) | `employee_id`, `attendance_date`, `status` (`present`, `late`, `absent`, `leave`, or none while nothing on an open day counts), `first_clock_in_at`, `last_clock_out_at`, `worked_minutes`, `late_minutes`, `early_minutes` (1425), `overtime_minutes`, `closed_at`; what judged it (1425): `policy_version_id` (the version its first clock-in was judged by, or for a day with none the version in force on its date when it closed; null for the type's defaults), `attendance_work_schedule_id` (the schedule in force, null for the company hours), `shift_working`, `shift_starts_at`, `shift_ends_at` (the shift it was judged against) and `judged_at` (when they were recorded: the first clock-in, or the day-close) | The projection, recalculated from the day's events in the punch's transaction and by the day-close job. A day is judged once (§6.4): once `judged_at` is set, a recalculation reads the recorded version (`policies.rulesOfVersion`) and shift, never a newer one |
| `attendance_exception` (1000, 1300, 1310, 1360) | `attendance_day_id`, `attendance_event_id`, `exception_type` (`outside_worksite`, `outside_home`, `location_unverified`, `unknown_device`, `suspicious_timestamp`, `missing_clock_out`, `automatic_clock_out`: opened only when the person explains one, §6.14), `severity`, `status` (`open`, `resolved`), `outcome` (`accepted`, `rejected`, `corrected`), `evidence`, `employee_note`, `reviewed_by`, `reviewed_at`, `resolution` | One per event and type, one day-level `missing_clock_out` per day (partial unique indexes), so a retried job adds none |
| `attendance_device` (1300) | `employee_id`, `known_device_id` (unique), `label`, `status` (`observed`, `registered`, `removed`), `first_seen_at`, `last_punch_at`, `registered_at`, `removed_at`, `removed_by`, `removal_reason` | Owned by `devices`. A device first seen on a punch is `observed`; the employee registers it; a removed one may be registered again. The device cookie and its hash never leave identity |
| `worksite` (0040) | `code`, `name`, `address` (jsonb `{ text }`), `latitude`, `longitude`, `radius_m`, `timezone`, `active` | Written by `worksites` from this delivery; the employee's assignment is `employee.worksite_id` |
| `attendance_home` (1310) | `employee_id`, `address`, `latitude`, `longitude`, `accuracy_m`, `status` (`pending`, `approved`, `rejected`, `superseded`), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_reason` | A remote employee's home location. At most one `pending` and one `approved` per person (partial unique indexes); approving supersedes the old approved one, a new request supersedes the one still waiting. Personal data: on the wire as `home_address`, `home_latitude`, `home_longitude`, masked under `employee.personal` and given only to the person and to `people` scope all. While the policy's Home Location is off (§1.3) its rows are kept as they are and read by nothing |

| `attendance_location_request` (1320, 1350) | `number`, `employee_id`, `request_type` (`temporary_home`, `remote_day`, `client_visit`), `starts_on`, `ends_on`, `address`, `latitude`, `longitude`, `accuracy_m`, `site_latitude`, `site_longitude`, `site_radius_m`, `reason`, `status` (`submitted`, `approved`, `rejected`, `cancelled`), `workflow_instance_id`, `requested_by`, `decided_at`, `cancelled_at`, `cancel_reason` | A request to work somewhere else for some days, decided in its approval. `latitude`, `longitude` are a temporary home's reading only (both or neither); on the wire `home_latitude`, `home_longitude`, masked under `employee.personal` and given only to the person and to `people` scope all. `site_latitude`, `site_longitude`, `site_radius_m` (100 to 500) are a client visit's site only, all three or none: a client's venue, not personal data. A client visit sent before `1350` has none |
| `attendance_schedule` (1340) | `employee_id`, `office_days` (ISO weekdays, 1 Monday to 7 Sunday), `effective_from`, `reason`, `set_by`, `set_at` | **Frozen from PR 3**: its rows were copied into `attendance_work_schedule` (`1420`). Read by nothing; a later release drops it (MIGRATIONS §8) |
| `attendance_field_assignment` (1330) | `number`, `name`, `client`, `note`, `starts_on`, `ends_on` (at most 31 days), `status` (`active`, `cancelled`), `assigned_by`, `assigned_at`, `cancelled_at`, `cancelled_by`, `cancel_reason` | Sending people to work somewhere for some days. In force from the moment it is saved; cancelled, it stops applying to the days still to come. Never deleted |
| `attendance_field_site` (1330) | `field_assignment_id`, `position` (1 or 2), `name`, `address`, `latitude`, `longitude`, `radius_m` (100 to 500) | An assignment's one or two sites, set as a worksite is; `address` is the readable line of the place picked (`place`, owner `attendance_field_site.address`, `addresses.md` §4). A client's venue, not a person's: not personal data |
| `attendance_field_member` (1330) | `field_assignment_id`, `employee_id`, `added_at`, `removed_at`, `removed_by`, `removed_reason` | The people on it, at most 25. Taking someone off keeps their row with `removed_at`; a person is on at most one active assignment a day (the service, under the person's lock) |
| `attendance_clock_reminder` (1360, 1440) | `employee_id`, `work_date`, `kind` (`clock_in_due`, `clock_out_due`, 1440), `slot` (1440: 0 for the reminder to clock in; 1, 2, 3 for each reminder to clock out, every `clock_out_reminder_minutes` from the shift's end), `due_at` (1440: the reminder's time), `sent_at` | One row per reminder sent, unique per person, day, kind and slot (1440), so the watch sends each once however often it runs; the notice is about this row, and clocking in (or out) marks it read. Nothing about a person but who and which day |
| `attendance_work_schedule` (1420) | `employee_id`, `days` (jsonb: the seven ISO weekdays in order, each `weekday`, `working`, `starts_at`, `ends_at` and `place` `office` or `remote`; an Off day has neither times nor place, a working day with no times takes the company hours), `effective_from`, `reason`, `set_by`, `set_at` | A person's own week, from a date (§6.13); the latest started by a date is in force (unique per person and first day); none means the company hours of the policy in force. Replaces `attendance_schedule`: `1420` copies its rows with blank hours, Working on the weekdays the working week worked when it ran, their office days Office and the rest Remote (§6.13). Not personal data beyond the person's hours |
| `attendance_rule_breach` (1430) | `employee_id`, `rule` (`late`, `early_departure`, `absence`, `forgotten_clock_out`, `location_flag`), `policy_version_id` (the version in force on the crossing day), `period` (`week`, `month`, `days_30`), `period_start`, `period_end`, `count`, `minutes`, `reached` (`count` or `hours`: which came first), `days` (the dates counted), `last_day`, `alert`, `raise_query` (as the version said), `breached_at`, `home_alert_id` (the Home alert it raised, set after commit), `employee_query_id` (M3: a nullable uuid with no foreign key until M3's `employee_query` exists; M3 adds the key) | One row per breach (§6.16); a breach's days are not counted again. Unique on the person, the rule and its last counted day, so a retried count adds none |
| `attendance_pay_item` (1435) | `employee_id`, `attendance_day_id`, `work_date`, `kind` (`late`, `early_departure`, `absence`, `overtime`), `minutes`, `rest_day` (overtime on a day not worked), `method` (`pro_rata`, `per_hour`, `per_day`, `daily_rate`, `multiplier`), `amount` (numeric(18,2), null with no salary set; on the wire `pay_amount`), `policy_version_id` (the version that judged the day), `status` (`pending`, `waived`, `confirmed`, `cut`, `in_run`), `decided_by` (null when the system decided), `decided_at`, `reason`, `confirmed_minutes`, `payroll_run_id` (M6: a nullable uuid with no foreign key until M6's run table exists; M6 adds the key) | One per person, day and kind (§6.17). Money through `shared/money`. Salary-derived amounts are restricted fields, masked as the salary is (`pay_amount` under `employee.salary`) |
| `attendance_overtime_approval` (1435) | `employee_id`, `work_date`, `minutes`, `approved_by`, `approved_at`, `reason` | Overtime approved for a day beforehand (Approve Overtime), read only under the Pre-Approved method (§6.17); unique per person and day, the same day again replacing it |
| `attendance_temporary_site` (`1450`) | `number` (`TS-0001`, unique), `purpose` (the contract's `TemporarySitePurpose`), `name` (3 to 120), `description` (30 to 1,000), `starts_on`, `ends_on` (at most 90 days in all), `hours` (`usual`, `site`; `1475`), `starts_at`, `ends_at` (`time`, both for `site` hours with the end after the start, neither for `usual`), `status` (`submitted`, `approved`, `rejected`, `withdrawn`, `cancelled`), `submitted_by` (the login that added it), `workflow_instance_id` (none when People add it directly), `approved_at`, `approved_by` (the approval's last approver, or whoever added it directly), `cancelled_at`, `cancelled_by`, `cancel_reason` | A place to work for some days (§6.11). A withdrawal is status `withdrawn` with `cancelled_at`, `cancelled_by` (the submitter) and `cancel_reason` (theirs); a cancellation by People the same with `cancelled`. Replaces `attendance_location_request` and `attendance_field_assignment` for new entries; theirs keep applying until their last day. Never deleted |
| `attendance_temporary_site_location` (`1450`) | `temporary_site_id`, `position` (1 to 8), `name` (an optional label, up to 60), `place_id` (the `place` picked, F27, owner `attendance_temporary_site_location.address`), `address` (its readable line), `latitude`, `longitude` (the place's point, the fence's centre), `radius_m` (150 to 500), `timezone` (the place's, Africa/Lagos when unknown) | Its addresses. A Temporary Home's is personal data: on the wire as `home_address`, `home_latitude`, `home_longitude`, masked under `employee.personal` and given only to the people on it, its submitter and `people` scope all; every other is a venue, `address`, `latitude`, `longitude` |
| `attendance_temporary_site_member` (`1450`) | `temporary_site_id`, `employee_id`, `added_at`, `removed_at`, `removed_by`, `removed_reason` | Up to 25 people. Taking someone off keeps their row with `removed_at`; a person is on at most one approved or waiting site a day (the service, under the person's lock) |
| `attendance_check_in` (`1460`) | `employee_id`, `work_date`, `occurred_at` (the server's), `device_at`, `latitude`, `longitude`, `accuracy_m`, `temporary_site_location_id` (the address it was matched to), `distance_m`, `verdict` (`inside`, `outside`, `unverified`), `evidence` (the site, the address's name and radius, the mode, and why a reading was unclear: `poor_accuracy`, or the browser's `denied`, `unavailable`, `timeout`, `unsupported`, `no_location`), `policy_version_id`, `idempotency_key` (unique per person) | A stop on a temporary site's day (§6.12): evidence, never a shift. Append-only (`prevent_ledger_mutation()`) |
| `attendance_exception.attendance_check_in_id` (`1460`) | The check-in a flag is about | One exception per check-in and type (a partial unique index), as one per punch and type. `1300`'s day-level index (`attendance_exception_day_type_uq`) now leaves check-ins out (`WHERE attendance_event_id IS NULL AND attendance_check_in_id IS NULL`), so two flagged check-ins on one day open two exceptions |
| `workflow_instance.excluded_employee_ids` (`1455`) | The employees who may never decide this approval, whatever role they hold | Set when the approval opens: a temporary site's people (§6.11; foundation.md §6.5). Empty for every other approval |

Schema migrations: `migrations/1300_attendance_clock.sql`, `migrations/1310_attendance_home.sql`
(homes, `home_radius_m`, the `outside_home` type), `migrations/1320_attendance_location_request.sql`
(work location requests), `migrations/1330_attendance_field_assignment.sql` (field assignments,
their sites and people), `migrations/1340_attendance_schedule.sql` (hybrid staff's weekly
schedule), `migrations/1350_attendance_client_visit_site.sql` (a client visit's site),
`migrations/1360_attendance_clock_watch.sql` (the reminders sent, the `automatic_clock_out` type and
the unique indexes that count an automatic clock-out apart), `migrations/1370_attendance_policy_versions.sql`
(policy versions, the three place modes, acknowledgements). Reference data:
`seeds/reference/1390_seed_attendance.sql` (two exception types),
`seeds/reference/1391_seed_attendance_home.sql` (Outside Home),
`seeds/reference/1392_seed_attendance_location_request.sql` (the `location_request` numbering scheme,
`WLR-0001`, and version 1 of the `attendance.location_request` approval),
`seeds/reference/1393_seed_attendance_field_assignment.sql` (the `field_assignment` numbering scheme,
`FA-0001`), `seeds/reference/1394_seed_attendance_clock_watch.sql` (Automatic Clock-Out),
`seeds/reference/1395_seed_attendance_policy.sql` (removes `1099`'s Standard policy while it is as
seeded and nothing was judged by it: a policy is MyCity's choice, A26). Nothing about a person, a
device, a punch, a holiday, a coordinate or a policy is seeded (A26).

From the four PRs (§1.2), each in its own part of the M1 block: PR 1's `1400`, `1405` and `1396`
(`policies.md` §4); PR 2's `migrations/1380_attendance_rejected_punch_slot.sql` (`attendance_event.slot`
and the unique index a slot at a time, in place of `1360`'s one per day: a rejected punch frees its
slot) and `seeds/reference/1397_seed_attendance_location_unclear.sql` (the `location_unverified`
label `1390` seeded renamed Location Unclear, unless someone changed it); PR 3's work schedules, rule breaches and pay items, from `1420`;
PR 4's `migrations/1450_attendance_temporary_site.sql` (the three site tables),
`migrations/1455_workflow_instance_excluded.sql` (`workflow_instance.excluded_employee_ids`),
`migrations/1460_attendance_check_in.sql` (the check-in, the exception's link to it and `1300`'s
day-level index narrowed) and `seeds/reference/1470_seed_attendance_temporary_site.sql` (the
`temporary_site` numbering scheme, `TS-0001`, and version 1 of the `attendance.temporary_site`
approval, one stage, Operations & People). The purposes are the contract's enum; nothing about a
person, a site or a place is seeded. `attendance_location_request` and the field assignment tables
take no new rows from PR 4; nothing is migrated or dropped.

PR 3's, built: `migrations/1420_attendance_work_schedule.sql` (work schedules, `1340`'s rows copied
in), `migrations/1425_attendance_day_judged.sql` (what judged a day, and `early_minutes`),
`migrations/1430_attendance_rule_breach.sql` (rule breaches),
`migrations/1435_attendance_pay_item.sql` (pay items and overtime approvals),
`migrations/1440_attendance_clock_out_reminder.sql` (the clock-out reminders' kind, slot and time)
and `migrations/1445_home_attendance_rules_off.sql` (Home's own attendance alert rules switched off,
`home.md` §4). PR 3 seeds nothing.

**The shared roster** (§6.9) reads `attendance_day` as the punch, the decision and the day-close
write it; the day's one active clock-in on `attendance_event` (by `work_date`, for the worksite it
was judged against); `employee`, `department` and `worksite`; granted `leave_request` with its
approval (`workflow_instance`); and, for where a present day was worked, the approved temporary sites
(PR 4), field assignments and remote days covering it. It reads through the indexes above (`attendance_day`'s
`(employee_id, attendance_date)` key and `(attendance_date, status)`, `attendance_event`'s one active
event a day) and needs none of its own.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/attendance/me/today` | → `AttendanceToday` | self, own | no | The authoritative state, the shift, the clock location (name and radius, no coordinates; `checked` false on a remote day while Home Location is off, so the panel reads no location, §1.3), the policy's modes (the location mode of today's place), accuracy limit and Home Location (`home_location`, which every screen showing a home reads), this device; `clock_out_automatic` when the day's clock-out was the system's, and `sign_in_prompt` when this session is the first of a working day and the person is not clocked in (§6.14). From PR 4, `temporary_site`: the day's site with its number, name, purpose and addresses with their radius (a Temporary Home's line to its own people only), no coordinates; and `check_ins`: the day's check-ins in time order (at most 20), each with its address and verdict, so the panel shows each stop's result after a reload |
| `POST /api/v1/attendance/punches` | `PunchCreate` → `PunchResult` | self, own | no | `Idempotency-Key` required (428 without). The person is the session's; the body names nobody. 409 for a refused transition, 422 on leave or not employed. On a remote day while Home Location is off, any coordinates sent are dropped, never stored (§6.5) |
| `GET /api/v1/attendance/me` | `MyDayListQuery` (`month`, `status`) → `AttendanceDayPage` | self, own | yes, 25 | Days of the month, newest first; `status` keeps one figure's days (`present` takes late days too, as Days Present counts them) |
| `GET /api/v1/attendance/me/summary` | `MySummaryQuery` → `MyAttendanceSummary` | self, own | no | The month's figures |
| `GET /api/v1/attendance/me/events` | `MyEventListQuery` (`date`) → `AttendanceEventPage` | self, own | yes, 25 | One day's punches, own coordinates not returned |
| `GET /api/v1/attendance/me/check-ins` (PR 4) | `MyCheckInListQuery` (`date`) → `CheckInPage` | self, own | yes, 25 | One day's check-ins in time order, each with its address and verdict, no coordinates. A route of its own beside `me/events` (which stays punches only), so My Attendance merges the two into the day's route |
| `GET /api/v1/attendance/me/exceptions` | `MyExceptionListQuery` → `AttendanceExceptionPage` | self, own | yes, 25 | |
| `POST /api/v1/attendance/me/exceptions/:id/explanation` | `ExceptionExplanation` → `AttendanceException` | self, own | no | While the exception is open |
| `POST /api/v1/attendance/me/events/:id/explanation` | `RealTimeGiven` (`employee_note`, `real_time`, HH:MM) → `AttendanceException` | self, own | no | Give Real Time on a System Clock-Out of the person's own (§6.14): opens its `automatic_clock_out` exception with the note and the real leaving time, which People read on the decision (`real_time`) and Correct Time starts from. The time is after the clock-in and not in the future (422 `REAL_TIME_INVALID` on `real_time`). 404 for anyone else's punch, 422 `NOT_AUTOMATIC` for a punch that is not one, 409 `ALREADY_EXPLAINED` once it has an exception |
| `POST /api/v1/attendance/me/export` | `MyExportRequest` (`month`) → `ExportFile` (202) | self, own | no | The month's workbook, made after commit and downloaded on the device that asked (`docs/guides/foundation.md` §6.12) |
| `GET /api/v1/attendance/register` | `RegisterQuery` (`date`, `status`, `department_id`, `q`, `sort`) → `RegisterPage` | `people` view · all/team/own | yes, 25 | One row per active employee in scope; status worked out in SQL before the page is cut |
| `GET /api/v1/attendance/summary` | `RegisterSummaryQuery` (`date`) → `RegisterSummary` | `people` view · scope | no | |
| `GET /api/v1/attendance/register/:employee_id` | `DayDetailQuery` (`date`) → `DayDetail` | `people` view · scope | no | 404 outside scope. `policy.pre_approved_overtime`: the version in force pays overtime only when approved beforehand, so the day offers Approve Overtime |
| `GET /api/v1/attendance/events` | `EventListQuery` (`employee_id`, `date`) → `AttendanceEventPage` | `people` view · scope | yes, 25 | Coordinates only for scope all |
| `GET /api/v1/attendance/check-ins` (PR 4) | `CheckInListQuery` (`employee_id`, `date`) → `CheckInPage` | `people` view · scope | yes, 25 | One person's check-ins on a day in time order, for the day's evidence; no coordinates; a Temporary Home's line only for scope all, masked under `employee.personal`. 404 outside scope |
| `GET /api/v1/attendance/exceptions` | `ExceptionListQuery` (`status`, `exception_type`, `date`, `employee_id`, `q`) → `AttendanceExceptionPage` | `people` view · scope | yes, 25 | `can_decide`: open, the reader holds `people` approve over everyone, and it is not their own (set in the controller, as `decide` checks); `refused`: the punch was refused at the clock, so no decision makes it count (§6.8) |
| `POST /api/v1/attendance/exceptions/:id/decision` | `ExceptionDecision` → `AttendanceException` | `people` approve · all | no | Reason required; never your own; a correction appends an event |
| `GET /api/v1/attendance/records/:id` | → `AttendanceRecordRef` | `people` view · scope | no | A day's id or an exception's, to the person and day a link opens (⌘K, the bell) |
| `GET /api/v1/attendance/me/records/:id` | → `AttendanceRecordRef` | self, own | no | The same for the person's own |
| `POST /api/v1/attendance/export` | `RegisterExportRequest` (`from`, `to`, at most 31 days, `status`) → `ExportFile` (202) | `people` export · scope | no | The register's workbook, made after commit and downloaded on the device that asked. The sheet's Status starts on the status chip in force |
| `GET /api/v1/attendance/me/home` | → `MyHome` | self, own | no | The approved home, the one waiting and the last one rejected, with their own coordinates. While Home Location is off: `needed` false and no homes (H7) |
| `POST /api/v1/attendance/me/home` | `HomeRequestCreate` (`home_address`, a `PlaceInput`: picked, pinned or the device's location in an outage; `home_latitude`, `home_longitude`, `accuracy_m`) → `MyHome` | self, own | no | While Home Location is on (409 `HOME_LOCATION_OFF` otherwise); anyone whose week, in force or waiting to start, has a Remote day, a remote employee with no schedule included (§6.10; 422 `HOME_NOT_NEEDED` otherwise); the reading within `max_accuracy_m` (422 `HOME_READING_WEAK`); supersedes a request still waiting |
| `GET /api/v1/attendance/homes` | `HomeListQuery` (`status`, `employee_id`, `q`, `sort`) → `HomeRequestPage` | `people` view · scope | yes, 25 | Waiting first; address and coordinates only for scope all, masked under `employee.personal`; `can_decide` as on exceptions (pending, scope all, not their own). 409 `HOME_LOCATION_OFF` while Home Location is off |
| `GET /api/v1/attendance/homes/:id` | → `HomeRequest` | `people` view · scope | no | The home a link opens (`attendance_home`, `?home=` on People · Attendance); the same visibility as the list, and the same 409 while Home Location is off |
| `GET /api/v1/attendance/me/requests` | `MyLocationRequestListQuery` (`status`, `sort`) → `LocationRequestPage` | self, own | yes, 25 | The person's own requests, newest first |
| `POST /api/v1/attendance/me/requests` | Removed in PR 4 with `LocationRequestCreate` | | | A temporary site replaces it (`POST /attendance/me/temporary-sites`) |
| `GET /api/v1/attendance/me/requests/:id` | → `LocationRequest` | self, own | no | Another person's is a 404 |
| `POST /api/v1/attendance/me/requests/:id/cancel` | `LocationRequestCancel` (`reason`) → `LocationRequest` | self, own | no | Waiting: withdraws the approval; approved: until the day before its first day; 409 `REQUEST_NOT_CANCELLABLE` otherwise |
| `GET /api/v1/attendance/requests` | `LocationRequestListQuery` (`status`, `request_type`, `employee_id`, `q`, `sort`) → `LocationRequestPage` | `people` view · scope | yes, 25 | Waiting first; each row says whether it waits on the reader (`can_decide`) |
| `GET /api/v1/attendance/requests/:id` | → `LocationRequest` | `people` view · scope | no | The request a link opens (`attendance_location_request`, `?request=`) |
| `GET /api/v1/attendance/field-assignments` | `FieldAssignmentListQuery` (`state`, `employee_id`, `q`, `sort`) → `FieldAssignmentPage` | `people` view · scope | yes, 25 | An assignment with anyone in the reader's scope on it; in progress and upcoming first. `state`: `upcoming`, `in_progress`, `done`, `cancelled` |
| `GET /api/v1/attendance/field-assignments/:id` | → `FieldAssignment` | `people` view · scope | no | The assignment a link opens (`attendance_field_assignment`, `?assignment=`) |
| `POST /api/v1/attendance/field-assignments` | Removed in PR 4 with `FieldAssignmentCreate` | | | People add a temporary site instead (`POST /attendance/temporary-sites`) |
| `POST /api/v1/attendance/field-assignments/:id/cancel` | `FieldAssignmentCancel` (`reason`) → `FieldAssignment` | `people` approve · scope | no | Until its last day; everyone on it is told |
| `POST /api/v1/attendance/field-assignments/:id/remove` | `FieldMemberRemove` (`employee_id`, `reason`) → `FieldAssignment` | `people` approve · scope | no | Takes one person off; not the last one (cancel instead) |
| `GET /api/v1/attendance/me/field-assignments` | `MyFieldAssignmentListQuery` (`state`) → `FieldAssignmentPage` | self, own | yes, 25 | The person's own, in progress and upcoming first |
| `GET /api/v1/attendance/me/field-assignments/:id` | → `FieldAssignment` | self, own | no | One they are or were on; anyone else's is a 404 |
| The policy's routes | `policies.md` §5 | | | Removed from this module in PR 1 (`/attendance/policy...`, `/attendance/me/policy...`): the Attendance policy is read and changed through `/policies`, and the clock reads it through `policies.rulesFor` (§6.1) |
| `POST /api/v1/workflow/instances/:id/approve`, `/reject` | the approval's own routes (foundation.md §5) | the stage's approvers | no | How a request and a temporary site are decided; never by a route of this module. The engine refuses anyone on the site (`excluded_employee_ids`, 403 `PERMISSION_DENIED`) |
| `POST /api/v1/attendance/homes/:id/decision` | `HomeDecision` (`decision`, `reason`) → `HomeRequest` | `people` approve · all | no | Never your own (403 `OWN_RECORD`); a rejection needs a reason of 10 or more characters; 409 once decided; 409 `HOME_LOCATION_OFF` while Home Location is off |
| `GET /api/v1/devices/mine` | `PageQuery` → `MyDevicePage` | self, own | yes, 25 | |
| `POST /api/v1/devices/mine` | `DeviceRegister` → `MyDevice` | self, own | no | This session's device; fresh sign-in (403 `REAUTH_REQUIRED`); 409 past three |
| `POST /api/v1/devices/mine/:id/remove` | `EmptyBody` → `MyDevice` | self, own | no | |
| `GET /api/v1/devices` | `DeviceListQuery` (`status`, `employee_id`, `q`) → `DevicePage` | `people` view · scope | yes, 25 | |
| `GET /api/v1/devices/:id` | → `Device` | `people` view · scope | no | |
| `POST /api/v1/devices/:id/remove` | `DeviceRemove` (`reason`) → `Device` | `people` edit · scope | no | The person is told |
| `GET /api/v1/worksites` | `WorksiteListQuery` (`active`, `q`, `sort`) → `WorksitePage` | `people` view | yes, 25 | |
| `GET /api/v1/worksites/:id` | → `Worksite` | `people` view | no | |
| `POST /api/v1/worksites` | `WorksiteCreate` → `Worksite` | `people` create | no | The address is picked or pinned (`PlaceInput`, below) and the place picked fills the coordinates; a centre typed or tapped with no address is named from a pin (`GET /maps/pin`) |
| `PATCH /api/v1/worksites/:id` | `WorksiteUpdate` → `Worksite` | `people` edit | no | `active: false` retires, `true` restores |
| `GET /api/v1/worksites/:id/employees` | `PageQuery` → `WorksiteEmployeePage` | `people` view · scope | yes, 25 | |
| `POST /api/v1/worksites/:id/employees` | `WorksiteAssign` → `WorksiteEmployee` | `people` edit · scope | no | Through `organisation.service.updateEmployee`; assigning someone to another worksite moves them |
| `GET /api/v1/attendance/schedules/:employee_id` (PR 3) | `ScheduleParams` → `WorkSchedule` | `people` view · scope | no | For anyone: the person's pattern, office, home state (null while Home Location is off), the week in force today day by day (Working or Off, its hours, Office or Remote, and whether the hours are the company's), the schedule in force (`current`, null for the company hours) and the one waiting to start (`next`); `can_edit` for the reader. 404 outside scope |
| `POST /api/v1/attendance/schedules/:employee_id` (PR 3) | `ScheduleParams`, `WorkScheduleSet` (`days`, the seven weekdays; `effective_from`; `reason`) → `WorkSchedule` | `people` edit · scope | no | Anyone's, whatever their work pattern; never your own (403 `OWN_RECORD`); the checks of §6.13 (422 `SCHEDULE_IN_THE_PAST`, `SCHEDULE_TOO_FAR`, `SCHEDULE_HOURS_NEEDED`) |
| `GET /api/v1/attendance/me/schedule` (PR 3) | → `WorkSchedule` | self, own | no | My Profile's week; `can_edit` is false |
| `GET /api/v1/attendance/pay-items` (PR 3) | `PayItemListQuery` (`group` deductions or overtime, `kind`, `status`, `month`, `employee_id`, `q`, `sort`) → `PayItemPage` | `people` view · scope | yes, 25 | Pending first, then the newest day. Amounts (`pay_amount`) masked as the salary is; `can_decide` says whether the reader may waive it or confirm and cut it |
| `POST /api/v1/attendance/pay-items/waive` (PR 3) | `PayItemWaive` (`pay_item_ids`, 1 to 25, `reason`, 10 to 500) → `PayItemBatchResult` | `people` approve · all (403 `FORBIDDEN` for a narrower scope) | no | Deductions only (422 `NOT_A_DEDUCTION`); never your own (403 `OWN_RECORD`); an item no longer pending (waived, or taken into a run) is skipped and named in `skipped` |
| `POST /api/v1/attendance/pay-items/:id/overtime` (PR 3) | `OvertimeDecision` (`decision` confirm or cut, `minutes` to confirm fewer, `reason`, needed to cut) → `PayItem` | `people` approve · scope (the line manager above the person, People for anyone) | no | Overtime only (422 `NOT_OVERTIME`), pending only (409 `OVERTIME_DECIDED`): only Line Manager After leaves one pending; never your own (403 `OWN_RECORD`); `minutes` at most the item's (422); confirmed minutes held to the monthly cap (§6.17) |
| `POST /api/v1/attendance/overtime-approvals` (PR 3) | `OvertimePreApprovalCreate` (`employee_id`, `work_date`, `minutes`, 1 to 720, `reason`, 10 to 500) → `OvertimePreApproval` | `people` approve · scope (the line manager above the person, People for anyone) | no | Approve Overtime, beforehand: the day from today in Lagos (422 `OVERTIME_IN_THE_PAST`) to 90 days ahead (422 `OVERTIME_TOO_FAR`); never your own (403 `OWN_RECORD`); the same person and day again replaces it. Read only under Pre-Approved (§6.17) |
| `GET /api/v1/attendance/me/pay-items` (PR 3) | `MyPayItemListQuery` (`month`, `group`, `kind`) → `PayItemPage` | self, own | yes, 25 | The person's own, newest day first, with their amounts (never masked for themselves) |
| `GET /api/v1/attendance/temporary-sites` (PR 4) | `TemporarySiteListQuery` (`status`, `state`, `purpose`, `employee_id`, `q`, `sort`) → `TemporarySitePage` | `people` view · scope | yes, 25 | Every site with someone in the reader's scope on it (or once on it). Waiting first, then in progress, upcoming and the rest; `can_decide` on each (the approval's stage waits on the reader and they are not on it), `can_change` (People with `people` approve, scope all, not on it, until its last day). `q` finds the number, name or anyone on it, never an address |
| `GET /api/v1/attendance/temporary-sites/:id` (PR 4) | → `TemporarySite` | `people` view · scope | no | `?site=` on People · Worksites; 404 outside scope |
| `POST /api/v1/attendance/temporary-sites` (PR 4) | `TemporarySiteCreate` (`purpose`, `name`, `description`, `starts_on`, `ends_on`, `locations` of `PlaceInput`, an optional `name` and `radius_m`, `employee_ids`) → `TemporarySite` | `people` approve · all | no | People's own: in force at once (status `approved`), whoever adds it its approver; never with themselves on it (403 `OWN_RECORD`: they use Add Work Site). The checks of §6.11; a Temporary Home while Home Location is off is 422 `HOME_LOCATION_OFF` on `purpose` (H6) |
| `POST /api/v1/attendance/me/temporary-sites` (PR 4) | `TemporarySiteCreate` → `TemporarySite` | self (anyone) | no | Add Work Site: numbered, `submitted`, and the `attendance.temporary_site` approval opened in the same transaction; for themselves, colleagues or both. The checks of §6.11: 422 `SITE_IN_THE_PAST`, `SITE_TOO_FAR`, `SITE_TOO_LONG`, `NOT_EMPLOYED`, `HOME_LOCATION_OFF` (a Temporary Home while Home Location is off, H6); 409 `SITE_OVERLAPS` naming the person and the other site |
| `GET /api/v1/attendance/me/temporary-sites` (PR 4) | `MyTemporarySiteListQuery` (`state`) → `TemporarySitePage` | self, own | yes, 25 | Those they submitted or are or were on: waiting, in progress and upcoming first |
| `GET /api/v1/attendance/me/temporary-sites/:id` (PR 4) | → `TemporarySite` | self, own | no | One they submitted or are or were on; anyone else's is a 404. `?site=` on ESS · Work Location Requests (a notice, ⌘K, My Attendance); `can_withdraw` for its submitter while it waits |
| `POST /api/v1/attendance/me/temporary-sites/:id/withdraw` (PR 4) | `TemporarySiteCancel` (`reason`, 10 to 500) → `TemporarySite` | self, the submitter | no | While it waits (409 `SITE_NOT_WAITING` after); the approval is withdrawn with it. Anyone else's is a 404 |
| `POST /api/v1/attendance/temporary-sites/:id/cancel`, `/remove` (PR 4) | `TemporarySiteCancel`, `TemporarySiteMemberRemove` (`employee_id`, `reason`) → `TemporarySite` | `people` approve · all | no | Until its last day (409 `SITE_ENDED`); never on a site the reader is on (403 `OWN_RECORD`). Cancel: an approved site (409 `SITE_NOT_APPROVED`: a waiting one is rejected instead). Remove: a waiting or approved site, someone still on it (409 `NOT_ON_SITE`), never the last (409 `SITE_LAST_PERSON`: cancel it instead) |
| `POST /api/v1/attendance/check-ins` (PR 4) | `CheckInCreate` (`latitude`, `longitude`, `accuracy_m`, `location_error`, `device_at`) → `CheckInResult` | self, own | no | `Idempotency-Key` required (428 without), stored on the check-in, unique per person. Only on a temporary site's day (422 `NO_TEMPORARY_SITE`; a Temporary Home's day while Home Location is off is none, H6) while clocked in (409 `NOT_CLOCKED_IN`); the 21st of a day is 422 `CHECK_IN_LIMIT`; never refused for where it was made (§6.12) |

From PR 4 the work location request and field assignment routes above take no new entry (their
create routes are removed with their sheets, `LocationRequestCreate` and `FieldAssignmentCreate`
with them). Their reads stay for the history. While one still waits or is in force its own changes
stay too: the person's withdraw or cancel of a request (`POST /me/requests/:id/cancel`), the
approval's decision on a waiting request (`POST /workflow/instances/:id/approve`, `/reject`), and
People's cancel and take off of an assignment (`/field-assignments/:id/cancel`, `/remove`). The
requests and assignments already approved keep applying until their last day (§6.11, §6.12).
People · Worksites, Temporary, lists them while one still waits or is in force (TB, 20/10/2026).

The shared roster has no route of its own. It is a read Home's services call: `GET /home/team`,
`/home/team/summary`, `/home/team/attendance` and the records behind the attendance cards
(`docs/guides/home.md` §5). People · Attendance and My Attendance read the routes above; the roster
agrees with them because it reads the same records the same way (§6.9). `page()` and `month()`
answer in the list envelope at 25, filtered, searched and sorted in SQL.

Every address on these screens is picked, never typed (F27, `docs/guides/addresses.md`): an
`AddressField` over `GET /api/v1/maps/search` (from the second character; signed places) with Drop a
Pin on its map (`GET /api/v1/maps/pin`), and the device's location while address search is down. A
request carries the address as a `PlaceInput` (`home_address`, a request's `address`, each site's
`address`), checked at the edge; the service keeps it through `shared/places` and writes its line
(details first) into its own column, so every list, mask and search reads as before. Picking a
place fills, for a worksite, a field site or a client visit, its latitude and longitude, which the
person can still correct; on a home and a temporary home it fills the address only, and the fence
stays on the reading. The worksite's maps load their tiles from `GET /api/v1/maps/tiles/...` with
the session, and a centre typed or tapped with no address is named by `GET /api/v1/maps/pin`. A
punch's point is never sent to the provider.

## 6 · Rules and calculations

### 6.1 The policy (PR 1)

- The rules for a work date are the Attendance policy's version in force on that date:
  `policies.rulesFor(client, 'attendance', date)` (`policies.md` §6.8), the latest published version
  whose first day is on or before it, parsed with the type's defaults; before any version, the type's
  defaults (`attendance.policy-type.js`, the code's, never seeded: A26). One organisation policy;
  `employee_attendance_policy` is no longer read, and a person's own hours are their work schedule
  (§6.13).
- Each punch records the version it was judged by (`attendance_event.policy_version_id`); a new
  version never re-judges a punch already made. A day is judged by the version on its first
  clock-in, and a day with none by the version in force on its date, however late it is
  recalculated (§6.4). Attendance caches no rules: `rulesFor` reads the version on each call, so a
  new version applies from its first day with no `policy.published` handler here.
- The location check has a mode for each kind of place (owner decision, 19/10/2026): the office
  (`office_geofence_mode`: a permanent site, or no site on an office day), a home
  (`home_geofence_mode`: a remote day matched to the approved home, a temporary home) and a temporary
  site (`site_geofence_mode`: a temporary site's addresses; before PR 4, a field assignment's sites and
  a client visit's site). Shown as **Off** (record only), **Flag** (`warn`: accepted for review with
  an exception) and **Refuse** (`block`). A new version offers Flag and Refuse only for a home and a
  temporary site (Cynthia: the home is mandatory); older versions keep what they set. Since
  22/10/2026 homes as a whole are the policy's Home Location switch (§1.3): a home's mode applies
  only while it is on, and while it is off a home day is not checked at all (§6.5).
- Grace is the policy's `grace_minutes`. The day's start and end are the person's work schedule for
  that weekday, else the policy's company hours, else the working week of Settings · Organisation
  (A22) while no version sets `hours`; public holidays stay in Settings · Organisation
  (`shared/time/working-week`).

### 6.2 The clock guard (`attendance.clock-guard.js`, pure)

- Active events are `accepted` and `review` ones; a `rejected` event never changes the state.
- **A punch People rejected stops counting and frees its slot** (PR 2): the guard, the open-shift
  reads (today's state, the clock watch's open shifts, the roster) and the unique index count only
  punches no decision excluded, so after People reject a clock-in the person can clock in again that
  day, and after they reject a clock-out they clock out again while the shift is open, or People add
  the missing one (§6.8). The index holds one punch a slot (`attendance_event.slot`, `1380`): the
  rejected punch keeps its row and its slot, and the next takes the next. A clock-out that still
  counts after its clock-in was rejected ends the day: another clock-in is `SHIFT_DONE`.
- A clock-in is allowed when the work date has no active clock-in. Once the day has a clock-in and a
  clock-out, another clock-in is refused (`SHIFT_DONE`): one shift a day, as both donors run it. A
  check-in at a stop (§6.12) is not a punch and never touches the shift.
- A clock-out is allowed after an active clock-in with no active clock-out; refused with no clock-in
  (`NOT_CLOCKED_IN`) and after a clock-out (`ALREADY_CLOCKED_OUT`). A clock-in after an active
  clock-in is `ALREADY_CLOCKED_IN`.
- A clock-out closes today's open shift, or yesterday's while yesterday is not closed (a late shift).
- A refused transition writes nothing and answers 409.
- Two punches from one person are decided one after the other (`pg_advisory_xact_lock` on the
  person, inside the transaction); the unique index on active events is the backstop, and its
  violation answers the same 409.
- A system clock-out (§6.14) is an active clock-out like any other: after it the person's own
  clock-out is `ALREADY_CLOCKED_OUT` and a clock-in `SHIFT_DONE`. Only People's correction of its
  time is written beside it (the unique index counts the system's apart), and the system's then stops
  counting.

### 6.3 Idempotency

- Every punch and check-in carries an `Idempotency-Key`; without one it is refused (428). The shared
  middleware replays a finished request's stored answer. The key is also stored on the event, unique
  per person, so a replay the middleware no longer remembers (48 hours) still returns the original
  result instead of a second punch. A key sent with a different body is the middleware's 422, and
  the same is true after 48 hours: a stored key whose event differs from the body (a clock out sent
  with a clock in's key) is 422 `IDEMPOTENCY_KEY_REUSED`, never the old answer (PR 2).

### 6.4 Time

- The server's receipt time is the punch's time (`occurred_at`); the device's own time is kept
  beside it (`device_at`) with the gap, never in its place (BACKEND_STRUCTURE §15).
- The work date and the wall clock are read in the place's timezone (a permanent site's or a
  temporary site location's `timezone`, Africa/Lagos otherwise), never the host's
  (`attendance.rules.wallClock`). A consultant working in Gaborone keeps their schedule's hours in
  Gaborone's time on those days (PR 4). The work date is fixed before the place is known, so a
  person's zone at an instant is its own read (`attendance.sites.js` `zoneAt`): the zone of an
  approved temporary site they are still on whose days cover that instant's date read in the site's
  own zone, else their worksite's, else Lagos. The punch, today's state and a check-in all read it.
  A site's zone is its first address's (`attendance_temporary_site_location.timezone`, from the
  place the address search picked, `addresses.md` §4); when its addresses lie in different zones,
  the day is read in the first one's.
- A device time more than 2 minutes ahead of the server is implausible: the punch goes to review
  with a `suspicious_timestamp` exception. A device time more than 5 minutes behind is a delayed
  submission: recorded with both times, judged on the server's.
- **The day's shift** is the person's work schedule for the weekday (§6.13), else the policy's
  company hours, else Settings · Organisation's working week while no version sets `hours`. A day
  the schedule marks Off, a public holiday and a weekday the hours do not work are not working days
  for that person: no lateness, no absence, no prompts, no reminders.
- **Lateness** (T2): when the first clock-in is later than the start plus grace, the minutes from
  the **start** (grace 5, in at 09:12: 12 minutes late); within grace, 0. On a working day only.
- **Early departure** (T5): when the person's own last clock-out is earlier than the end less
  `early_grace_minutes`, the minutes to the **end** (early grace 5, out at 16:50: 10 minutes early);
  within it, 0. On a working day only; a system clock-out is never early.
- **A clock-out People add** (Correct Time on a System Clock-Out, Add Clock-Out on a missing one,
  `source = 'admin'`) stands in for the person's own: People confirmed the time, so it counts for
  worked minutes, early departure and overtime, and the decision's recalculation adds, changes or
  waives the day's pay items (§6.17). A system clock-out never does (T13).
- **Worked minutes**: last clock-out minus first clock-in, except that a system clock-out counts only
  to the shift's end (T13): a clock-in after the end has none.
- **Overtime minutes**: on a working day, every minute from the end to the person's own last
  clock-out, counted once they pass the version's `overtime.after_minutes` (after 30: out at 17:45 is
  45 minutes, out at 17:20 none); on a day that is not worked for them (Sunday, a holiday, an Off
  day), every worked minute, at the rest-day rate (§6.17). Never from a system clock-out.
- **A day is judged once**: its lateness, early departure and overtime use the policy version and the
  shift recorded on the day (`attendance_day.policy_version_id`, `attendance_work_schedule_id`,
  `shift_working`, `shift_starts_at`, `shift_ends_at`, `judged_at`): on its first clock-in, the
  version that clock-in was judged by (`COALESCE(policy_version_id, attendance_policy_id)` on the
  event) and the schedule in force on the date; for a day with no clock-in, the version and schedule
  in force on its date when the day-close closes it. The version's rules are read back through
  `policies.rulesOfVersion` (`policies.md` §6.8), so a version published today from today never
  re-judges a day whose clock-in came before it. A recalculation (a decision, the day-close, a
  system clock-out) never applies a newer version or schedule (§6.1, §11).
- A day's status: approved leave first (`leave`), then a clock-in (`late` when late minutes are
  above 0, else `present`), then, once closed, an expected working day with no clock-in (`absent`).
  A day that is not worked with no punch has no day row. An employee with no active login is never
  expected to clock in and is never absent: the register reads their day Off.

### 6.5 The geofence (`attendance.geofence.js`, pure, distances from `shared/geo`)

- **The expected place**, in this order: a temporary site the person is on that day (§6.11; before
  PR 4, a field assignment, then an approved work location request), their approved home on a remote
  day of their schedule or every day for a `remote` work pattern (§6.10, the policy's
  `home_radius_m`), else their permanent site (`employee.worksite_id`), if active.
- **Home Location off** (§1.3, H5): a remote day of the schedule (every working day for a `remote`
  work pattern with none), an approved Temporary Home and a work location request for a temporary
  home or a remote day made before PR 4 are not checked. `contextFor` answers `unchecked`; the panel
  asks for no reading (`AttendanceToday.location.checked` false); the server drops any coordinates
  sent, so none is stored on the event; and `decideGeofence` answers `not_applied` with reason
  `home_location_off`, accepted under every mode (Not Checked). The device and time checks still
  run. The evidence names no place and no home. A permanent site, a field assignment and every other
  temporary site are checked as ever.
- While Home Location is on, someone working from home with no approved home has no fence to meet: the location is
  `unverified` (`no_home`), so the punch goes to review under Flag and Refuse and is never refused for
  it. Someone expected at an office whose site is not set or not active is the same (`no_worksite`,
  owner decision, 19/10/2026). Retry Location is not offered for either: a new reading changes
  nothing.
- **The reading** (PR 2). Distance is the server's, from the coordinates sent; a client distance or
  inside flag is never read. A reading with no accuracy, or an accuracy of 0 or less, is no reading
  (`unverified`, `no_accuracy`). With the accuracy `a`, the distance `d` and the radius `r`:
  - **inside** when `d <= r` and `a <= max_accuracy_m`;
  - **outside** when `d - a > r`: even the nearest point the reading allows is beyond the fence;
  - **unclear** otherwise: the reading's circle crosses the fence (`edge`), or it is rougher than
    `max_accuracy_m` (`poor_accuracy`). Unclear is never proof of being elsewhere.
  The verdict of an unclear reading is `unverified`, with its reason (`judgeReading`). The rule applies
  to whichever place judges the punch: a temporary site's nearest address, a field assignment's nearer
  site, a home or a Temporary Home, an office.
- No coordinates (denied, unavailable, timed out, unsupported, an insecure page: `LocationError`'s
  `insecure`) is `unverified` with that reason.
- **The modes** for the day's place (§6.1). Off: accepted, the verdict kept as evidence. Flag
  (`warn`): outside, unclear or unverified is `review`, with an `outside_worksite` (`outside_home`
  against a home) or `location_unverified` exception. Refuse (`block`): outside is `rejected` **and
  opens its exception** (PR 2: People see every refused punch; its detail reads Refused); unclear and
  unverified are `review`.
- `location_unverified` reads **Location Unclear** on every screen (PR 2, seed `1397`), with its
  reason: no reading, rough reading, at the edge, no home, no office.
- **The fix for a rough reading** (PR 2, the clock panel, T10): an accuracy beyond 1,000 m on a phone
  is a phone set to approximate location (iPhone: Precise Location off; Android: Approximate chosen),
  and the panel says how to turn on precise location (Precise Location Off); on a computer, Use Your
  Phone; denied, how to allow location in that browser (Location Blocked), and a location the browser
  has already blocked skips the ask step; an insecure page, that the clock needs the secure address
  (Secure Address Needed). A browser with no location, or an insecure page, offers no Retry: a new
  reading cannot change it. Clock In Anyway sends what was read (a rough fix as it is, or why there was
  none), which the server judges: unclear, it reaches People as Location Unclear. One location reader
  serves the clock's punch and Check In and the home's Use This Location
  (`app/src/features/attendance/location.ts`): it watches for up to 10 seconds and keeps the best fix
  (stopping early at 50 m or better), takes no cached position (`maximumAge` 0), and always ends (a
  watchdog: 10 seconds, or 30 for the browser's own question to be answered, then 10 from its answer),
  so Not Now, Esc and the close button work while it reads, and closing the panel stops it. The
  temporary site sheet reads a location only through `AddressField`'s own device-location fallback
  (F27), which stays as it is. A page without `crypto.randomUUID` (an insecure one) still gets each
  punch's Idempotency-Key (`newKey`).
- The radius of a home (while Home Location is on) and of a temporary site's address is at least
  150 m on a new version (T9); a permanent site keeps its own radius (25 to 1,000 m).
- A punch against a home keeps `worksite_id` empty (the roster, §6.9, and Home read it as remote);
  its evidence names the place `home` and the home record it was judged against. A punch at a
  temporary site names the site and the address it was matched to (PR 4): place `temporary_site`
  (`temporary_home` for a Temporary Home), `temporary_site_id`, the address as `site_id` and its
  name as `worksite_name` (the site's name, with the address's label when it has several, or
  Temporary Home), with `worksite_id` empty. The register, a punch and the roster read that name.
- A temporary site's addresses reach `decideGeofence` through its `sites` input, each address's id
  as `field_site_id`, so the nearest decides the punch as for a field assignment; a Temporary Home is
  `kind: "temporary_home"`, judged as a home. The geofence gains no rule of its own in PR 4.

### 6.6 The device (`devices.guard.js`, pure)

- The device is the session's `known_device` (set at sign-in from the device cookie). A client
  `known` flag or label is never read.
- First seen on a punch, it is recorded as `observed` (devices register even when the policy is
  `off`). Known means `registered`; `observed`, `removed` or no device is unknown.
- `off`: accepted. `warn` (Flag): unknown is `review` with an `unknown_device` exception. `block`
  (Refuse): unknown is `rejected`, and opens the exception too (PR 2). The policy suggests Flag
  (Cynthia agreed an unknown device is flagged, 13 October); the code's default stays `off` until a
  version sets it.
- At most three registered devices per person (the 12 and 13 October meetings). Registering needs a
  fresh sign-in; nobody at People approves it. People may remove any device in scope, with a reason.

### 6.7 The result

- The punch's result is the strictest of the geofence, the device and the time checks (`rejected`,
  then `review`, then `accepted`). A rejected punch is recorded with its evidence and opens its
  exception (outside, or unknown device; its evidence marked `refused`, its detail reading Refused) on
  its day, whose figures it leaves as they were, so People see every refusal and it counts toward the
  Location Flags rule (§6.16); the person punches again from the right place or device. Its `reasons`,
  and so the exceptions it opens, name only the checks that refused it (a device clock ahead is not
  among them). Nothing waits on the person: the panel's Review Required leaves a refused punch out.

### 6.8 Deciding an exception

- People with `people` approve and scope all decide; never their own. A reason of at least 10
  characters is required.
- `accept`: the punch stands. `reject`: the punch stops counting for the day (still shown, marked
  excluded). `add_clock_out` (missing clock-out only): an `admin` clock-out at the time given, after
  the clock-in, on the work date. Each recalculates the day and is audited with before and after.
- An `automatic_clock_out` (the person gave the real time of a System Clock-Out, §6.14) takes
  `accept`, the system's time stands, or `add_clock_out`, shown as Correct Time and starting from the
  time the person gave: an `admin` clock-out at the time given, as above, and the system's stops
  counting (marked excluded, outcome `corrected`). People's clock-out stands in for the person's own
  (§6.4), so the day's worked minutes, early departure, overtime and pay items follow it. `reject` is
  refused (422 `DECISION_INVALID`): it would leave the shift open.
- An exception on a rejected punch (PR 2) takes `accept`, which keeps the refusal as it was and
  records that People saw it ("the refusal stands"), or `reject`, which marks the refusal itself as
  wrong for the record ("the refusal is noted as wrong, and the punch still does not count"); neither
  turns a refused punch into one that counts: the person punches again.
- A rejected punch frees its slot (§6.2, PR 2): after rejecting a clock-in the person can clock in
  again; after rejecting a clock-out the person clocks out again while the shift is open, or People
  Add Clock-Out on its missing clock-out. On a day already closed the rejection opens that missing
  clock-out at once, as the day-close would have (`openMissingClockOut`), and Add Clock-Out
  recalculates the closed day, its pay items and its rule counts; the day stays closed.
- **A check-in's exception** (PR 4, §6.12; the exception carries `attendance_check_in_id`) is decided
  on the same route. `accept` clears the flag; `reject` confirms it, so it still counts toward
  Location Flags (§6.16). Neither touches a punch or the day, which is not recalculated.
  `add_clock_out` is refused (422 `DECISION_INVALID`). Until PR 4, Reject with no punch was refused
  ("There is no punch to reject"); that guard now passes an exception that carries a check-in.

### 6.9 The shared roster (`attendance.roster.js`, read only)

`src/modules/attendance/attendance.roster.js` is how Home reads a day's attendance. It decides
nothing: every fact is this module's own, read the way the register (`GET /attendance/register`,
`/attendance/summary`) and My Attendance (`GET /attendance/me`, `/attendance/me/summary`) read it, so
Home and those screens never disagree.

| Function | Gives |
|---|---|
| `summary(client, { date }, scope)` | For one day within the reader's scope: `working_day`, `expected`, `present`, `on_site`, `remote`, `field`, `late`, `absent`, `on_leave`, `not_in`, `no_clock_out_yesterday`, `flagged` |
| `page(client, { date, status, department_id, q, no_clock_out_yesterday, flagged }, scope, query)` | One page of 25 people on the register that day: name, job title, department, work pattern, status, clock-in, clock-out, late minutes, the worksite (or temporary site or field assignment site) the clock-in was judged against (none when the person works remotely, is on a Temporary Home or an approved remote day, or is not in), the yesterday flag and `flagged`. The filters combine. Sorts: `display_name` (the default), `department`, `clock_in_at` |
| `month(client, { from, to, department_id, q }, scope, query)` | One page of 25 people on the register on any day from `from` to `to` (at most 31), each with the totals My Attendance shows for those days: expected, on time, late, absent, on leave. One query for the page, never one per person. Sorts: `display_name` (the default), `on_time` |
| `personal(client, { employee_id, from, to })` | One person's days (at most 31), each with its status, its record's own status (`day_status`), clock-in, clock-out and late minutes, and the totals My Attendance shows: days expected, on time, late, absent, on leave |

- **A day's record is the source.** Status, first clock-in, last clock-out and late minutes are
  `attendance_day` as §6.4 to §6.8 write it: counted punches only (accepted or in review, not
  excluded by a decision), on the work date, late by the whole minutes from the start once past the
  grace of the version that judged the day (§6.1, §6.4). The roster never re-reads the punches to
  decide any of these.
- **Each person's own day.** Whether a day is worked, and so expected, is the person's: by the work
  schedule in force on the date, else the company hours in force on the date, else the working week
  (§6.13); a public holiday is never worked, and nobody without an active login is expected (§6.4).
  The register's status, `off`, `expected` and Not In are worked out per person in SQL before the
  page is cut (`attendance.repo.js` `EXPECTED_ON`); the company hours enter the SQL as a parameter
  the service reads through `policies.rulesFor` for each date it covers (one date for the register,
  each day of `personal()`'s range), so attendance's SQL never reads `policy_version`.
- **A day with no record** reads as the register reads it: granted leave, else nothing on a day
  that is not worked for that person, else not in. A day of an approved temporary site with its own
  hours is worked for the people still on it, whatever their schedule says (§6.11).
- **Who is on the day:** anyone with a record that day, and everyone active, started and not yet
  left (the register's people).
- **Home's words** for the register's statuses (the contract's `HomeRosterStatus`):

  | Register | Roster |
  |---|---|
  | `leave` | `on_leave` |
  | `late` | `late` |
  | `present` | `field` when an approved temporary site the person is still on covers the date, a Temporary Home aside (PR 4, §6.11), or a field assignment made before PR 4 does (§6.12); else `remote` when the date is a Remote day of the work schedule in force then (§6.13), or, with no schedule working that day, the person's work pattern is `remote`, or an approved Temporary Home (PR 4) or a remote day approved before PR 4 covers the date (§6.11); else `on_site` |
  | `absent` | `absent` (a working day the day-close closed with no clock-in) |
  | `not_in` | `not_in` (a working day not closed, no clock-in yet) |
  | `off` | none |

- **The counts** are the register summary's: `expected` is everyone on the register but those on
  leave whose own day is worked (none on a day that is not worked for anyone); `present` is late
  plus on site plus remote plus field, a clock-in that counts on any day, so a Sunday clock-in is
  present with nobody expected.
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
- **No other reader.** Home's alert metrics no longer read `attendance_day` or
  `attendance_exception` (PR 3): attendance's alerts are the Attendance policy's breaches, raised by
  this module (§6.16). Home's day strip reads the reader's own shift through `schedules.dayOn` and
  their day through the roster (home.md §6).

### 6.10 Home locations (`attendance.home.js`)

- **The switch** (§1.3). Everything below applies while the Attendance policy's Home Location is on,
  as the version in force today says (`onDate`, through `policies.rulesFor`). While it is off:
  `MyHome.needed` is false, so My Attendance shows no Home Location card, and `GET /me/home` gives
  no homes; sending one, People's list, one home and a decision answer 409 `HOME_LOCATION_OFF`; the
  Work Schedule's `home_state` is null; ⌘K finds no home; the register names a remote day Remote,
  never Home; and no home notice is sent. The rows stay as they are (H7): switched on again, the
  approved home is the fence again and a waiting one waits again.
- **Switched on** (H8): the reminder `attendance_home_needed` (the reminder engine, notifications.md
  §7.1) finds, every 5 minutes while Home Location is on, everyone active and started with a login
  whose week, in force or waiting to start, has a Remote day and who has neither an approved nor a
  waiting home, and adds one occurrence for each person and stretch the switch has stayed on (named
  by the stretch's first day: the first day of the unbroken run of versions with it on, up to the
  one in force, `policies.heldSince`; a second version published the same day names the same
  stretch). It fires in the working day (08:00 to 18:00 Lagos), after
  checking again in its own transaction that the switch is still on in the same stretch and that
  the person still needs a home and has none approved or waiting; `attendance.home_needed` then
  tells the person, **Set your home location**, and the notice opens My Attendance with the sheet
  open. One push a person for each stretch: switched off and on again, it comes again; someone who
  starts working from home while it is on is found then.
- Anyone whose week, in force or waiting to start, has a Remote day sets one (§6.13), a remote
  employee with no schedule included (their pattern makes every working day Remote): 422
  `HOME_NOT_NEEDED` otherwise; `MyHome.needed` says which, and My Attendance shows the Home Location
  card by it. The fence round it is the policy's `home_radius_m`, at least 150 m on a new version
  (T9).
  The reading is taken on the
  person's device when they press Use This Location, and must be within the policy's
  `max_accuracy_m` (422 `HOME_READING_WEAK`, the panel offers Retry Location). The address is their
  own words, up to 300 characters, with addresses suggested as they type (foundation.md §6.13); a
  suggestion picked fills the address only, never the coordinates, which are the reading's.
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

### 6.11 Temporary sites (PR 4, `attendance.sites.js`)

Owner decisions of 20/10/2026 (T11, T14), replacing work location requests and field assignments.

- **What one holds**: a **purpose** from the list below (`TemporarySitePurpose`, a searchable select),
  a **name** (3 to 120 characters: "Gaborone Partner Training"), a **description** (30 to 1,000,
  required; its help term says People approve from it and that it can cite an out-of-station
  letter), the **first and last day** (the first from today in Lagos to 90 days ahead, at most 90 days
  in all), **one to eight addresses** (each picked, never typed: a `PlaceInput` saved with
  `places.save()` under the owner `attendance_temporary_site_location.address`, F27; an optional
  label of up to 60 characters; a radius of 150 to 500 m, suggested 150, T9; its timezone from the
  place, Lagos when unknown) and **one to 25 people**. An address must carry a point: one typed
  before F27 is refused ("Pick an address"). A Temporary Home has exactly one address and is
  personal data, masked as a home is; its fence is that address's point and radius, judged with
  `home_geofence_mode`. It is offered only while Home Location is on (H6): while it is off, Add Work
  Site leaves it out of the purposes and both create routes refuse it (422 `HOME_LOCATION_OFF` on
  `purpose`).
- **Its hours** (owner decision of 21/10/2026), the sheet's first choice: **Usual Shift** (`usual`)
  or **Site Hours** (`site`) with a **start** and an **end** (`HH:MM`, the end after the start on
  the same day: a training from 11:00 to 15:00). Usual Shift keeps each person's own shift on the
  site's days (§6.13: their work schedule, else the company hours), their days off included. Site
  Hours makes every day of the site a working day for its people, weekends, public holidays and
  their schedule's days off included, with the site's hours read in the site's time zone: the clock-in reminder and the start prompt at its
  start, lateness from its start plus the policy's grace, the closing prompt, the reminders to clock
  out, early departure, overtime and the system clock-out from its end, and a day with no clock-in
  closes absent. One pair of hours for
  every day of the site; the hours are a site's, not a person's, and People approve them with it.
- **Purposes** (`TemporarySitePurpose`, in this order): Client Visit (`client_visit`), Partner Meeting
  (`partner_meeting`), Training (Delivering) (`training_delivering`), Training (Attending)
  (`training_attending`), Event (`event`), Conference (`conference`), Workshop (`workshop`),
  Exhibition (`exhibition`), Market Activation (`market_activation`), Field Survey
  (`field_survey`), Site Inspection (`site_inspection`), Media Engagement (`media_engagement`),
  Government Visit (`government_visit`), Out-of-Station Assignment (`out_of_station`), Coworking
  Space (`coworking_space`), Temporary Home (`temporary_home`), Other (`other`). The list is the
  contract's (product vocabulary, not a business choice: A26); Other's name says what it is.
- **Who adds one.** Anyone, from Home's **Add Work Site** (a sheet, no page) or ESS · Work Location
  Requests (`POST /attendance/me/temporary-sites`): for themselves, colleagues or both. In one
  transaction it is numbered (`TS-0001`, `numbering.allocate()`), saved `submitted`, and opens the
  `attendance.temporary_site` approval: Operations & People by default (Cynthia: HR approves
  exceptions to where someone clocks in), stages People change on Settings · Approvals.
  `temporary_site.submitted` is emitted with it.
- **Nobody on it decides it** (TB, 20/10/2026). The approval opens with everyone on the site in its
  `excluded_employee_ids` (foundation.md §6.5): the engine refuses them whatever role they hold,
  `can_decide` is false for them, and the stage's notice does not reach them. The submitter is the
  approval's `opened_by`, refused as for any request. The CEO, who may decide any stage (A11), may
  decide one they are on.
- **People add one directly** (`POST /attendance/temporary-sites`, `people` approve, scope all): in
  force at once (`approved`, no approval), whoever adds it its approver (`approved_by`). They never
  put themselves on it (403 `OWN_RECORD`): nobody approves their own, so they use Add Work Site.
  `temporary_site.approved` is emitted as for an approval, so its notices and the covered exceptions
  run the same way.
- **Checks**, in the order they run: the first day from today in Lagos (422 `SITE_IN_THE_PAST`) and
  at most 90 days ahead (422 `SITE_TOO_FAR`); at most 90 days in all (422 `SITE_TOO_LONG`); then,
  under each person's lock taken in the order of their ids, everyone on it active and started by the
  first day (422 `NOT_EMPLOYED`), and **one a day**: a person is on at most one approved or waiting
  temporary site on any day (409 `SITE_OVERLAPS`, naming the person and the other site). Two sites
  sent at once for the same person cannot both pass: the second waits on the first's lock.
- **Deciding a submission**: through the approval's own routes (`POST /workflow/instances/:id/approve`,
  `/reject`), never a route of this module. After commit the outcome is copied onto the site once,
  and only while it still waits (`settle`, the `attendance.apply_temporary_site_decision` handler):
  approved (`approved_at`, `approved_by` the last approver), rejected, or withdrawn (an approval
  withdrawn from Settings · Approvals by the CEO); `temporary_site.approved` or `.rejected` follows.
- **On the clock** (`attendance.calendar.js` `contextFor`, one block at its top): on its days, for
  everyone still on it, an approved site's addresses are the expected place before anything else
  (then a field assignment and an approved work location request made before PR 4, then the home,
  then the worksite). A punch is matched to the nearest address: inside its radius counts, with no
  flag; beyond every one is `outside_worksite` under the policy's `site_geofence_mode` (Flag or
  Refuse), named with the nearest; a reading too rough is `location_unverified` (§6.5). A Temporary
  Home is judged as a home (`outside_home`, `home_geofence_mode`). The wall clock and the work date
  are read in the site's zone (§6.4). A site still waiting changes nothing. Approved leave still
  refuses a punch (§11, `ON_LEAVE`). While Home Location is off, an approved Temporary Home is
  passed over here: its days read as a remote day, unchecked (§6.5), its hours and zone kept, and
  the panel shows no site and offers no Check In (H6).
- **Approved after its first day**: punches already made keep their judgement. The
  `attendance.resolve_covered_exceptions` handler on `temporary_site.approved` resolves each open
  location exception (`outside_worksite`, `outside_home`, `location_unverified`) of a person still on
  it, on one of its days, whose reading (the punch's or the check-in's point) falls inside one of its
  addresses: outcome accepted, resolution "Covered by TS-0001", decided by the site's approver. The
  person is told as for any decision (`attendance.exception_decided`). An exception with no reading
  is left for People.
- **Changing it**: the submitter withdraws it while it waits (`POST /me/temporary-sites/:id/withdraw`,
  with a reason; the approval is withdrawn with it). People (`people` approve, scope all, never on a
  site they are on) cancel an approved one or take someone off a waiting or approved one, with a
  reason (10 to 500 characters) the people on it read, until its last day; never the last person
  (cancel instead). Days still to come go back to the usual place; days already worked keep their
  judgement. Adding people or changing addresses is a new temporary site.
- **States**, worked out on the day in Lagos: `submitted` (Awaiting Approval) while it waits, then
  `upcoming`, `in_progress`, `done`; or `rejected`, `withdrawn`, `cancelled`.
- **Who sees what**: the people on it (or once on it) and its submitter, on ESS (`/me/temporary-sites`);
  anyone whose `people` view reaches one person on it, on People · Worksites. A non-home address is a
  venue: its line and point go to every reader. A Temporary Home's line and point go to the people on
  it, its submitter and `people` scope all (masked under `employee.personal`); team scope reads the
  site without them. Events, notices, AI reads and search carry ids, the number, the purpose, the
  name and the dates, never an address or a point.
- **What the policy says** (a sentence of §6.15): "Working somewhere else? Add it from Home, or ask
  People."
- Work location requests and field assignments approved before PR 4 keep applying until their last
  day, read by `contextFor` after temporary sites; no new ones are made. People · Worksites,
  Temporary, shows them (Requests, Field) while one waits or is in force; a waiting request is still
  decided in its approval, and an assignment in force is still cancelled or someone taken off it.
  ESS · Work Location Requests lists the person's own requests under their temporary sites, with
  Withdraw and Cancel as before (TB, 20/10/2026).

#### Until PR 4: work location requests (`attendance.requests.js`)

- **Types, and who may ask** (422 `REQUEST_TYPE_NOT_ALLOWED` otherwise):
  - `temporary_home`, remote staff: somewhere else to live for some days. One reading taken there
    when they press Use This Location, within the policy's `max_accuracy_m` (422
    `HOME_READING_WEAK`), and the address in their words. Up to 90 days.
  - `remote_day`, on-site and hybrid staff: a day or a few working from home. The address is
    optional. Up to 5 days.
  - `client_visit`, anyone: a client's site. The address, as the client gave it, and the site's
    centre and radius: latitude, longitude and a radius of 100 to 500 m, all required (owner
    decision, 19/10/2026). The address is picked or pinned, never typed (F27, `addresses.md`), and
    the place picked fills the centre, which stays open to correct. Up to 14 days.
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
  apply. While Home Location is off, a temporary home or a remote day still in force reads as a
  remote day, unchecked, with no reading kept (§6.5, H6); a client visit is checked as before. The evidence names the place (`temporary_home`, `remote_day`, `client_visit`) and the
  request; `worksite_id` stays empty; the register and the punch read Temporary Home, Remote Day or
  Client Visit. Two approved requests never cover one day (the overlap rule).
- **Decided late**: approving a request after one of its days has a punch does not re-judge that
  punch; People settle its exception as for any other.
- **On Home**: a present day an approved remote day covers counts as remote on the roster (§6.9).
- **Who sees what**: the person reads their own; anyone whose `people` view reaches them reads the
  request, address and a client visit's site included (a line manager decides from it). The
  temporary home's point goes only to the person and to `people` scope all. No event, notification,
  audit payload, AI read or search result carries the address, the point or the site.

### 6.12 Check-ins at each stop (PR 4)

- On a day the person is on an approved temporary site, once clocked in, the clock panel offers
  **Check In** (T12): one reading from the same location reader, sent to `POST /attendance/check-ins`
  with an `Idempotency-Key` (`attendance.check-ins.js`). The press reads through the feature's one
  location reader (`location.ts`, §6.5), as a punch does: the panel stays answerable while it reads,
  and whatever it found (a fix, a rough one, or why there was none) is sent.
- **Refused** only when it is not a check-in at all: 428 with no key; 422 `NO_TEMPORARY_SITE` on a day
  with no approved site the person is still on, or whose site is a Temporary Home while Home Location
  is off (H6); 409 `NOT_CLOCKED_IN` with no shift open (today's, or
  yesterday's still open, whose site it then checks against); 422 `CHECK_IN_LIMIT` for the 21st of a
  day. A check-in is never refused for where it was made.
- **Matched** to the nearest address of that day's site and recorded (`attendance_check_in`) with
  its distance, its verdict and the policy version, judged with the same `decideGeofence` call as a
  punch and the mode of the site (`site_geofence_mode`, `home_geofence_mode` for a Temporary Home).
  Only its `verdict` is read, never its `result`: under Flag and Refuse alike, `outside` opens
  `outside_worksite` (`outside_home` for a Temporary Home) and `unverified` opens
  `location_unverified`, each an exception carrying the check-in, on the day of the shift (one per
  check-in and type, §4). Under Off (an older version) it is only recorded. Inside an address: only
  recorded. A flagged one is counted toward Location Flags (§6.16, PR 3) and tells the person and
  People as a punch under review does (`attendance.review_required`).
- **Never the shift**: it never opens, closes or changes the shift or the day; lateness and hours come
  from the clock-in and clock-out only (§6.2).
- **Repeats**: the same key answers with the first check-in (also after the middleware forgets it);
  a second check-in at the same address within 5 minutes answers with the first, nothing recorded.
- **Its time** is the server's (`occurred_at`), the device's kept beside it (`device_at`); the work
  date is the open shift's.
- **The route**: People see the day's route on its evidence (`GET /attendance/check-ins`): clock-in,
  each check-in and the clock-out in time order, each with its address and verdict; the person sees
  the same on My Attendance (`GET /attendance/me/check-ins`), and today's on the clock panel.
- `attendance.checked_in` is emitted with each one: audit and the realtime refresh. Its payload names
  the site and the verdict, never the point.

#### Until PR 4: field assignments (`attendance.assignments.js`)

Owner decisions of 19/10/2026: a line manager or People set one and it is in force at once (whoever
sets it is the approver); one or two sites typed in; a date range of whole days; several people on
one assignment. The limits below are LA's, to change on request.

- **Who sets one**: `people` approve, within its scope: a line manager or head for their reporting
  tree, Operations & People and Management for anyone. Every person on it must be within the
  reader's scope (403 `FORBIDDEN` naming none of the others), active and started (422
  `NOT_EMPLOYED`), and never the reader (403 `OWN_RECORD`: someone else sends you out).
- **What it holds**: a name (3 to 120 characters, "Venue Setup"), the client, event or campaign (2
  to 120), an optional note (up to 500), the first and last day, one or two sites and one to 25
  people. A site is a name (2 to 120), an optional address (picked or pinned, never typed: F27,
  `addresses.md`) and its centre and radius: latitude, longitude and a radius of 100 to 500 m. As on
  a worksite, the place picked fills the centre, which stays open to correct.
  Numbered `FA-0001` (`field_assignment`, never reset).
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

### 6.13 Work schedules (`attendance.schedule.js`)

Owner decisions of 20/10/2026 (T7, T8): the policy holds the company hours; a person's own work
schedule overrides them; the Work Schedule tab sits after Job on the employee record. They replace
the hybrid office days of 19/10/2026 (`attendance_schedule`, `1340`).

- **What one holds** (`attendance_work_schedule`): for each ISO weekday, Working or Off; for a
  working day its start and end (`HH:MM`, the end after the start, the same day) and its place,
  Office or Remote; from a first day; a reason of 10 to 500 characters. At least one working day.
  A schedule may work any weekday, all at the office or all remote.
- **A working day with no hours** takes the company hours for that weekday. The service refuses one
  on a weekday the company hours in force on its first day do not work (422
  `SCHEDULE_HOURS_NEEDED` on that day's start: Sunday under the suggested hours, or a Saturday for a
  consultant when the company hours stop at Friday, T8); a blank working day that a later version
  stops working reads as Off from that version's first day.
- **Company hours**: the policy's `hours` (§6.15, Working Hours) in force on the date, else the
  working week of Settings · Organisation while no version sets them (A22). Someone with no
  schedule works the company hours at the place their work pattern gives (on site: Office; remote:
  Remote; hybrid: Office every day until a schedule sets Remote days). Public holidays are never
  worked.
- **Who sets it**: `people` edit, within its scope; never on their own record (403 `OWN_RECORD`). For
  anyone, whatever their work pattern: a part-time consultant on Tuesday, Thursday and Saturday is
  expected on those days only.
- **Dates**: the first day from today in Lagos (422 `SCHEDULE_IN_THE_PAST`) to 90 days ahead (422
  `SCHEDULE_TOO_FAR`). The same first day again replaces it; a later one is the next schedule and the
  one in force stays until then. Days already judged keep their judgement (§6.4).
- **On the clock and the day**: the schedule in force on a date gives the shift (§6.4), whether the
  day is worked (no lateness, absence, prompts or reminders on an Off day), and the place: an Office
  day is matched to the permanent site, a Remote day to the approved home (`outside_home` beyond it;
  no approved home is `unverified`, `no_home`) while Home Location is on, and not checked at all
  while it is off (§6.5, H5). A punch on a day that is not worked is matched by the
  work pattern. A temporary site on the day comes first (§6.5, PR 4).
- **Pay**: the working days of a month by the person's schedule, less public holidays, divide their
  monthly gross into a daily rate; that day's hours divide it into an hourly rate (§6.17).
- **The week** (`weekOf`): each weekday Working (with its hours, Office or Remote, and whether the
  hours are the company's) or Off. The record's Work Schedule tab and ESS · My Profile show it;
  Home's roster and the register read a present Remote day as remote (§6.9), and Home's day strip
  and Your Week read the reader's own hours (`dayOn`, home.md §6).
- **Told, not acknowledged**: setting a schedule notifies the person (`attendance.schedule_set`) with
  its first day; it is not a policy and needs no acknowledgement (T8).
- **From the hybrid office days**: `1420` copies each `attendance_schedule` row into a schedule from
  the same first day, with the same reason and author: hours blank (the company hours), Working on
  the weekdays the working week of Settings · Organisation worked when it ran, the office days
  Office and the other working days Remote. `attendance_schedule` is then read by nothing.
- **Who sees what**: the person, on My Profile; anyone whose `people` view reaches them, on the
  record. Hours and days are not personal data. `can_edit` tells the reader whether Set Schedule is
  theirs. The event carries the days and the first day.

### 6.14 Clock prompts, reminders and the system clock-out (`attendance.clock-watch.js`)

Agreed at the 12 and 13 October meetings and settled by the owner on 19/10/2026: a pop-up the
person must answer, not a toast, over a blurred screen, at the first sign-in of the day, before
the screen they asked for, and at the shift's start and end; a push reminder to whoever is not on
the app. TB's decisions of 20/10/2026 (T13) replace the automatic clock-out of 19/10/2026: from the
shift's end a reminder every 30 minutes, and 90 minutes after the end the system clocks the person
out (both figures the policy's). The sign-in prompt is Attendance's, opened by the shell, in place
of Home's (owner decision O12, home.md §6). The 60 minutes of the start reminder and the three
Remind Me choices are the code's, to change on request. Every prompt and reminder follows the
person's own shift (§6.13): a day that is not worked for them has none.

- **The sign-in prompt** (the server's `sign_in_prompt` on today, the app's `ClockPrompts`): true
  when the session reading it is the first the person signed in with that Lagos day (the earliest
  `user_session` issued that day is the caller's) and they are not clocked in on a working day of
  their schedule (active, no granted leave, no clock-in that counts, no shift still open from
  yesterday). The shell opens the panel on whatever screen the session lands on, Home or a link to
  anything else, once a day on each device. A session kept from yesterday or a second device that
  day is not prompted at sign-in (the start prompt still reaches it in the first hour). Not Now
  closes it, as for the start prompt.
- **The start prompt** (the app, `features/attendance/prompts.ts`): on a working day, when the
  workplace's clock (kept to the server's) reaches the shift's start and the person is not clocked
  in, the clock panel opens over whatever screen is open, as Start Your Day. Once a day on each
  device: when the app is open at the start or comes to the front within the hour after it, and
  not when the panel was already shown since the start on that device (the sign-in prompt, Clock
  In). The scrim, Esc and a drag do not close it; Not Now does. Behind every prompt the screen is
  blurred (`useModal().open({ blur })`); a panel the person opens themselves is not.
- **The closing prompt**: when the clock passes the shift's end and the person is still clocked
  in, the panel opens as Finish Your Day. Clock Out or Remind Me (in 15 minutes, 30 minutes or 1
  hour) answers it; after Remind Me it opens again at that time while they are still clocked in,
  and closing it unanswered counts as the shortest Remind Me. Remind Me never moves the system
  clock-out. A day that is not worked has no end and no closing prompt.
- Neither prompt replaces a dialog that is open, or opens while the session is locked: it waits
  until that one closes, so a half-filled form is never lost.
- **The start reminder** (job `attendance-clock-watch`, every 5 minutes): in the first 60 minutes
  after the start of their own shift (Lagos), everyone active and started, with a login, not on
  granted leave and with no clock-in that counts that day, on a working day of their schedule, is
  sent one reminder (`attendance.clock_in_due`): in the bell, and pushed to their devices as their
  Attendance and Leave preference allows. Not while they are in front of the app on any login
  (the push hold's reading, `services/realtime/active.js`): the start prompt asks them there, and
  a later run reminds them once they are away, still not clocked in, within the hour. When
  presence cannot be read (no Redis) the reminder goes. One a day (`attendance_clock_reminder`,
  slot 0); a run after the first hour sends none. Clocking in marks it read. On a day of a temporary
  site with its own hours (§6.11) the shift is the site's, so its people are reminded at its start,
  on the site's clock, on any day of it; the prompts, the reminders to clock out and the system
  clock-out read the same shift.
- **The reminders to clock out** (the same job, T13): for a person with an open shift (a clock-in
  that counts and no clock-out) on a working day of their schedule, from the shift's end, every
  `clock_out_reminder_minutes` (the version that judged the day; suggested 30), a reminder
  (`attendance.clock_out_due`: the bell, and a push as their preference allows) while they are
  still clocked in and the system clock-out has not come: with a 17:00 end and 30 minutes, at
  17:00, 17:30 and 18:00, each within the 5 minutes the watch runs in. One row per reminder
  (`attendance_clock_reminder`, kind `clock_out_due`, its slot and time), so a retried run sends
  none twice. In front of the app at a reminder's time, they have the closing prompt instead and
  no push; a later run in the same interval sends it once they are away. A reminder whose time came
  before the clock-in is not sent. Clocking out marks the day's reminders read.
- **The system clock-out** (the same job, T13): at the shift's end plus
  `system_clock_out_after_minutes` (suggested 90: 18:30 for a 17:00 end), anyone still clocked in is
  clocked out by the system at that moment, whenever the run reaches it: `source = 'system'`,
  accepted, no location, device or device time, its evidence naming the shift's end, the rule and
  its minutes (`validation.system`). Under the person's lock, in one transaction with the day, its
  pay items and its rule counts, as a person's punch is; `attendance.punched` and
  `attendance.clocked_out_automatically` are emitted with it, and the person is told ("System
  Clock-Out", the date and time). It reads **System Clock-Out** on every screen. The day's worked
  minutes count only to the shift's end; it is never early and never overtime; it counts toward
  Forgotten Clock-Outs (§6.16). Presence no longer decides anything: whether the person was in
  front of the app changes only whether a reminder is a push or the closing prompt.
- **An evening start**: a clock-in at or after the end plus `system_clock_out_after_minutes` is never
  clocked out by the system and gets no reminders: the shift stays open for the day-close's missing
  clock-out, as on a day that is not worked. A clock-in between the end and that moment is clocked
  out at that moment like any other, with no worked minutes past the end. The system never writes a
  clock-out timed before the clock-in.
- **Give Real Time**: the person gives their real leaving time from the day on My Attendance
  (`POST /attendance/me/events/:id/explanation`, a note and the time, after the clock-in and not in
  the future). An `automatic_clock_out` exception (severity low, shown as System Clock-Out) opens
  with them, once per punch; People are told (`attendance.exception_explained`) and accept the
  system's time or use Correct Time, which starts from the time given (§6.8). Until then nothing
  waits on People: a system clock-out nobody explains needs no decision.
- **On Home and the register** it is a clock-out like any other, counted to the shift's end:
  `clock_out_automatic` on the day (My Days) and on today (the panel) says it was the system's; a
  punch's `source` says the same in the day's evidence.
- **Who sees what**: the reminders and the notice go to the person alone. Whether and when someone
  was in front of the app is read on the server and never sent to a screen, an event payload or a
  notice.

### 6.15 The Attendance policy (`attendance.policy-type.js`)

A rules policy on Knowledge Hub · Policies (`policies.md`; versions, approval, signatures and
acknowledgement are that guide's). This module registers its type: the contract below, its
suggested values, its sections and the sentence for each rule, and it enforces what a version sets.
Every rule is a switch, a figure or a choice; **we suggest, People set** (T6). The type's
**suggested** values fill the first draft when no version exists; its **defaults** apply before any
version, and to a rule a version predates (a new rule reads as off on an older version).

| Section | Rule (`AttendanceRules` key) | Control and range | Suggested | Default | Enforced by |
|---|---|---|---|---|---|
| Working Hours | `hours`: each ISO weekday `working`, `starts_at`, `ends_at` | A row per weekday: Working or Off, start and end | Monday to Friday 09:00 to 17:00, Saturday 09:00 to 15:00, Sunday Off (A22) | None: Settings · Organisation's week | Built (§6.13) |
| Lateness | `grace_minutes` | 0 to 60 minutes | 5 | 0 | Built; lateness counted from the start (T2) |
| Late Arrivals | `late_rule`: `on`, `count`, `hours`, `period`, `alert`, `query` | A switch; then N late arrivals (1 to 31) or H late hours (0.5 to 40, optional) in a Week, Month or 30 Days; Alert and Raise Query switches | 3 in a month or 5 hours; Alert on, Raise Query on | Off | Built (§6.16) |
| Late Arrivals | `late_deduction`: `on`, `method`, `amount` | A switch; Pro-Rata by Minute, Fixed per Hour (an hour or part), Fixed per Late Day; the amount for a fixed method (₦1 to ₦1,000,000) | Pro-Rata | Off | Built (§6.17) |
| Early Departure | `early_grace_minutes` | 0 to 60 minutes | 5 | 0 | Built (§6.4) |
| Early Departure | `early_rule`, `early_deduction` | As Late Arrivals | 3 in a month; Alert on, Raise Query on; Pro-Rata | Off | Built (§6.16, §6.17) |
| Absence | `absence_rule`: `on`, `count`, `period`, `alert`, `query` | A switch; N absences (1 to 31) in a period; Alert and Raise Query | 2 in a month; both on | Off | Built (§6.16) |
| Absence | `absence_deduction`: `on` | A switch: a day's pay for each absent day | On when switched | Off | Built (§6.17) |
| Forgotten Clock-Outs | `forgotten_rule`: `on`, `count`, `period`, `alert`, `query` | A switch; N system clock-outs or missing clock-outs (1 to 31) in a period | 3 in a month; Alert on | Off | Built (§6.16) |
| Location Flags | `location_rule`: `on`, `count`, `period`, `alert`, `query` | A switch; N punches or check-ins outside a fence (1 to 31) in a period | 3 in a month; Alert on | Off | Built (§6.16) |
| Overtime | `overtime`: `on`, `after_minutes`, `approval`, `method`, `multiplier`, `amount`, `rest_day_multiplier`, `monthly_cap_hours` | A switch; counts after 0 to 120 minutes; approved by Line Manager After, Pre-Approved or Automatic; paid at a multiple of the hourly rate (1.0 to 3.0) or a fixed amount per hour (₦1 to ₦1,000,000); Sundays and holidays at a multiple (1.0 to 3.0); a monthly cap (1 to 100 hours) | 30 minutes; Line Manager After; 1.5 times; 2.0 times on rest days; 20 hours | Off | Built (§6.17) |
| Location Checks | `office_geofence_mode` | Off, Flag, Refuse | Flag | Flag | Built |
| Location Checks | `home_location`: `on` (Home Location) | A switch; while it is on, Home Check and Home Radius beneath it | Off | Off | Built 22/10/2026 (§1.3): off, no home is asked for, sent, approved or checked, and a remote day is not checked |
| Location Checks | `home_geofence_mode` (Home Check), `site_geofence_mode` (Temporary Site Check) | Flag, Refuse (Off only on an older version) | Flag | Flag | Built; Off removed from new versions in PR 1; from PR 4 the site's applies to a temporary site's addresses and its check-ins; the home's applies, and is checked in a draft, only while Home Location is on |
| Location Checks | `home_radius_m` | 150 to 500 m (a new version) | 150 | 150 | Built; the minimum in PR 1 (T9); used, and checked in a draft, only while Home Location is on |
| Location Checks | `max_accuracy_m` | 50 to 250 m | 100 | 100 | Built; its meaning in PR 2 (§6.5) |
| Devices | `device_mode` | Off, Flag, Refuse | Flag | Off | Built |
| Clock Prompts | `clock_out_reminder_minutes` | 15 to 60 minutes | 30 | 30 | Built (§6.14) |
| Clock Prompts | `system_clock_out_after_minutes` | 30 to 240 minutes | 90 | 90 | Built (§6.14) |

- **The contract** (`packages/contract/schemas/attendance.js`): `AttendanceRules` reads a version
  (every key optional, each filled with its default); `AttendanceRulesDraft` checks a draft (every key
  present; a switch that is on needs its figures: a count or hours, an amount for a fixed method;
  hours end after they start, at least one working day; a temporary site Flag or Refuse; while Home
  Location is on, a home Flag or Refuse and its radius at least 150 (off, both are kept as they were
  and checked once it is switched on, when the worksheet shows them); Home Location given (22/10/2026); from PR 3, a fixed deduction's amount and overtime's amount per hour
  from ₦1.00 to ₦1,000,000.00, each refused on its own field). PR 1 writes both in full, so PRs 3
  and 4 add behaviour, not keys.
  `latest_clock_out_minutes` is not carried into the rules: the system clock-out replaces it.
- **The worksheet** (Knowledge Hub · Policies, the Attendance policy): one card per section, a row
  per rule (its label with a help term, the control, Changed when the draft changes it); a switch
  that is on opens its figures beneath it, its Alert and Raise Query among them. PR 1 showed the
  rules then enforced (Lateness, Location Checks, Devices); PR 3 adds the rest, each in the commit
  that makes it do something, so no switch is shown that does nothing. The cards, in order:
  Working Hours (a row per weekday: Working, Starts, Ends), Lateness, Late Arrivals, Early
  Departure, Absence, Forgotten Clock-Outs, Location Flags, Overtime, Location Checks, Devices,
  Clock Prompts. Location Checks reads Office Check, Home Location (with Home Check and Home Radius
  beneath it while it is on), Temporary Site Check and GPS Accuracy.
- **The sentences** staff read, one per rule, values filled in, under the same sections; a rule that
  is off says so ("Late arrivals do not lead to a deduction."). Fixed sentences also say: "Where your
  own work schedule differs, your schedule applies." and "Working somewhere else? Add it from Home,
  or ask People." (T7, T14). With Home Location off, Working From Home reads only "Working from
  home, your location is not checked." (§1.3), and Your Location counts only the checks in use.
- **At a Temporary Site** (PR 4, the section once At a Field Site): Flag reads "At a temporary site,
  a clock-in or check-in outside its addresses is accepted and sent for review."; Refuse reads "At a
  temporary site, a clock-in outside its addresses is refused, and People see it." and "A check-in
  outside them is sent for review."; Off (an older version) reads "At a temporary site, your location
  is recorded with each clock-in and check-in. Nothing is flagged." The section always ends with
  T14's fixed sentence. The same words are in `attendance.policy-type.js`, the worksheet's labels
  (`app/src/features/policies/labels.ts`) and the mock (`app/src/api/mock/modules/policies.ts`).
- **When a version starts** nothing is reloaded: attendance caches no rules. `policies.rulesFor`
  reads the version on each call (`attendance.calendar.js` `policyFor`), so a new version applies
  from its first day, and the rules engine and Home's attendance alerts read its thresholds the same
  way; a day already judged keeps its version (§6.4). Attendance has no `policy.published` handler.

### 6.16 Consequence rules (`attendance.rules-engine.js`)

Owner decisions of 20/10/2026 (T1, T3, T5). The rules are the policy's (§6.15); this file counts
them, per person, in the transaction of the punch, decision, system clock-out or day-close that
recalculated the day (§3 step 6), so a breach is recorded and emitted with what crossed it.

- **What each rule counts**, per person:
  - **Late Arrivals**: the days recorded late, and their late minutes;
  - **Early Departure**: the days with early minutes, and those minutes;
  - **Absence**: the days closed absent;
  - **Forgotten Clock-Outs**: the days with a system clock-out that counts, or with the day-close's
    missing clock-out (once a day);
  - **Location Flags**: outside exceptions (`outside_worksite`, `outside_home`), read from
    `attendance_exception`, each dated by its day (`attendance_day_id`, never its event: a check-in's
    exception has none, PR 4). An exception whose punch was refused at the clock
    (`attendance_event.validation_state = 'rejected'`, PR 2) counts while open or accepted (Accept
    keeps the refusal, §6.8) and drops out once rejected; every other one (a punch under review,
    PR 4's check-in) counts while open or rejected, and drops out once People accept it or a
    temporary site's approval resolves it (§6.11). So PR 2's refused punches and PR 4's check-ins
    count without a change here.
- **The period**: a Week (Monday to Sunday), a Month (the calendar month) or 30 Days (the 30 days
  ending on the day counted), in Lagos.
- **A breach** (T3): counting only what came after the person's last breach of the same rule in the
  same period (the count restarts: three late arrivals give exactly one breach, the sixth the
  next), the count reaching N, or the minutes reaching H hours, whichever first. It is recorded once
  (`attendance_rule_breach`, with the days it counted and which came first, unique on the person,
  the rule and the last counted day, so a recalculation or a retried run adds none) and
  `attendance.rule_breached` is emitted in the same transaction. Counted with
  `shared/rules/window-counter` (`periodBounds` for the week, month and 30 days; `breaches` for the
  count or the summed minutes, restarting after the last one).
- **What it does**, as the version in force on the crossing day says, after commit
  (`attendance.raise_breach_alert`):
  - **Alert** on: a Home alert (`shared/alerts`) on the person ("Ada Obi: 3 late arrivals this
    month", the days as its trigger), cleared by People (`people` approve, with `alerts.clear`). The
    alert's rule is the policy's (TB, 20/10/2026): each of the five rules raises through one Home
    rule the system keeps (`home_alert_rule` with metric `attendance_policy` and key
    `attendance_policy.<rule>`, made on its first breach: threshold 1, one breach is one alert;
    severity medium; Who Can Clear People Approvers). Its subject is the breach
    (`attendance_rule_breach`, its id), with `subject_employee_id` the person, so a second breach
    raises its own alert while the first is still open; the alert opens the breach's last day on
    People · Attendance. Home · Alerts lists the five rules read only on Alert Rules, as the version
    in force today sets them, with Set in Attendance Policy; the kept rows are never edited there and
    the morning sweep never reads them (home.md §6).
  - **Raise Query** on: Queries & Sanctions (M3) subscribes to `attendance.rule_breached` and raises
    one query per breach with its days as evidence (`raise_query` on the event). Until M3 is built,
    the breach's alert reads Query Due ("Query Due: Ada Obi, 3 late arrivals this month") and is
    raised even when Alert is off, so People raise it by hand. With Raise Query off, no query is
    ever raised for that rule (T3).
- Switching a rule off stops new breaches from its version's first day; breaches already made stay.
- A breach already recorded keeps its days and its alert when one of them stops counting (leave
  granted for a day closed absent, People rejecting the clock-in that made a day late): the day
  only stops counting toward the next breach, as a rule switched off keeps its breaches.
- Waiving a deduction (§6.17) restores the pay, not the day: the day still counts.
- Home's own Late Arrivals and Missing Clock-Out rules are gone (T1): the metrics `late_arrivals` and
  `missing_clock_out` left Home's metric list, `1445` switched every rule on them off and dismissed
  their open alerts ("Rule switched off"), and Home no longer re-reads them on `attendance.punched`
  and `attendance.day_closed` (home.md §4.1, §7).

### 6.17 Pending deductions and overtime (`attendance.pay.js`)

Owner decisions of 20/10/2026 (T4, T6). The items are settled in the same transaction as the day
(§3 step 6), from the version that judged the day (§6.4).

- **A deduction** is added, as a pay item (`attendance_pay_item`), for each late, early or absent day
  whose rule's deduction switch is on in the version that judged the day. Never for leave, an Off
  day or a public holiday.
- **The amount** (T4), through `shared/money`, rounded to the kobo:
  - the **daily rate** is the person's monthly gross (`employee.gross_monthly`) over their working
    days that month (their schedule, less public holidays); the **hourly rate** is the daily rate
    over that day's scheduled hours (a Saturday of 09:00 to 15:00 is 6 hours). On a day that is not
    worked (overtime on a rest day) the hourly rate is the daily rate over the average scheduled
    hours of that month's working days;
  - **Pro-Rata by Minute**: the hourly rate times the minutes over 60; **Fixed per Hour**: the amount
    times the started hours (61 minutes is 2); **Fixed per Late Day**: the amount; **Absence**: the
    daily rate, its minutes the day's scheduled minutes.
  - With no gross set, the item keeps its minutes and its amount is empty (No Salary Set).
- **Pending until** People waive it (`people` approve, scope all, with a reason of 10 to 500
  characters; one, or up to 25 at once; never their own) or payroll takes it into a run (M6,
  `in_run`), after which it cannot be waived. The person sees each on My Attendance as it is added,
  and is told when one is added or waived.
- **When the day changes** (a decision, a clock-out People add, the day-close, leave granted for a
  closed day): an item still pending, or one the system decided, follows the day: its minutes and
  amount change with it, and when the day stops qualifying the system waives a deduction (or cuts
  overtime) with the reason ("Leave granted", "No longer late", "No longer early", "No longer
  absent", "No overtime"), keeping the trail and adding no status. An item a person decided, or one
  payroll took, stays as it is.
- **Overtime** (when the policy's switch is on): a pay item for each worked day with overtime minutes
  (§6.4), at the hourly rate times the multiplier (the rest-day multiplier on a day that is not
  worked) or the fixed amount per hour, prorated to the minute. By the policy's approval:
  - **Line Manager After**: pending until the person's line manager (or People: `people` approve
    within scope) confirms all of it, confirms fewer minutes, or cuts it, with a reason when cutting.
    The approvers are told when it is added (`attendance.pay_item_added`);
  - **Pre-Approved**: confirmed up to the minutes a line manager or People approved for that person
    and day beforehand (Approve Overtime: `POST /attendance/overtime-approvals`, a day from today in
    Lagos to 90 days ahead, the minutes and a reason; never their own; the same day again replaces
    it); minutes beyond it are cut, "Beyond pre-approval"; with no approval the item is cut, "Not
    pre-approved";
  - **Automatic**: confirmed at once.
  Confirmed overtime in a month never passes `monthly_cap_hours`; minutes beyond it are cut, "Monthly
  cap". Never from a system clock-out; nobody confirms their own. A clock-out People add stands in
  for the person's own (§6.4), so its overtime is counted.
- **Who sees what**: amounts derived from a salary are restricted as the salary is (field visibility,
  `employee.salary`): on the wire the amount is `pay_amount`, masked under `employee.salary` (never
  `amount` itself, which would mask every amount in the product); the person sees their own; People
  with the salary grant see amounts, others the minutes only.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `attendance.punched` | A punch commits (any result, the system's included) | Audit; outbox `attendance.push_updated`: `attendance.updated` to the person and to `people` view holders above them. Home no longer reads it (§6.16) |
| `attendance.review_required` | A punch or the day-close opens an exception | Notifies the person and `people` approve holders within scope |
| `attendance.exception_explained` | The person explains an exception | Notifies `people` approve holders within scope |
| `attendance.exception_decided` | People decide an exception | Notifies the person; realtime refresh |
| `attendance.day_closed` | The day-close job closes a person's day | Audit; realtime refresh |
| `attendance.day_reprojected` (PR 2) | Leave recorded or granted for a day already closed recalculates that day after commit (outbox `attendance.reproject_leave_days` on the leave module's `leave_request.recorded` and `leave_request.approved`, `reconcile.reprojectLeave`) | Audit; realtime refresh; the day's pay items follow it (a waived absence deduction tells the person, `attendance.pay_item_waived`) |
| `attendance.export_requested` | My Attendance or the register asks for a workbook | Outbox `attendance.build_export`: gathered 25 at a time into the file the request reserved, which the screen that asked downloads; nothing is emailed, and the file is removed a day later |
| `device.registered`, `device.removed` | My Devices, People · Devices | Notifies the person when People removed it |
| `worksite.created`, `worksite.updated` | People · Worksites | Audit |
| `attendance.home_requested` | A remote employee sets their home location | Audit; notifies `people` approve holders with scope over the person |
| `attendance.home_decided` | People approve or reject a home location | Audit; notifies the person; realtime refresh |
| `attendance.home_needed` | The reminder `attendance_home_needed` fires: Home Location is on and the person needs a home and has none approved or waiting (§6.10, H8) | Notifies the person ("Set your home location"; push as their Attendance and Leave preference allows); the notice opens My Attendance with Set Home Location open (`attendance_home_needed`, `?home=`) |
| `location_request.submitted` | An employee sends a work location request | Audit; the approval (`attendance.location_request`) notifies the first stage's approvers |
| `location_request.approved`, `location_request.rejected` | Its approval ends (copied on by `attendance.apply_request_decision`) | Audit; the approval already told the person; realtime refresh |
| `location_request.cancelled` | The person withdraws or cancels it | Audit; realtime refresh |
| `field_assignment.assigned` | A field assignment is set (one event for each person on it) | Audit; notifies the person; realtime refresh |
| `field_assignment.cancelled` | It is cancelled (one for each person still on it) | Audit; notifies the person with the reason; realtime refresh |
| `field_assignment.member_removed` | Someone is taken off it | Audit; notifies the person with the reason; realtime refresh |
| `attendance.schedule_set` | People set anyone's work schedule | Audit on the employee (Record History: Work schedule set), with the days; notifies the person with the first day (the notice opens their own record, My Profile); realtime refresh |
| `attendance.clock_in_due` | The watch finds someone expected, not clocked in and away from the app, in the first hour after the start of their own shift (§6.14) | Notifies the person ("Time to clock in", on the `attendance_clock_reminder` row; push as their preference allows); marked read when they clock in |
| `attendance.clocked_out_automatically` | The watch's System Clock-Out of an open shift, at the end plus `system_clock_out_after_minutes` (§6.14) | Audit; notifies the person ("System Clock-Out", the date and time; the day opens on My Attendance); the punch's own `attendance.punched` reloads the screens |
| Job `attendance-day-close` (scheduler, 01:30 Africa/Lagos; queue of the same name for a given date) | Daily | Closes every open day before today within 14 days, under the cron lock, each by the person's own schedule: absences, missing clock-outs, the rule counts and the pay items, in each day's transaction; idempotent |
| Job `attendance-clock-watch` (scheduler, every 5 minutes) | All day | Sends the reminders to clock in and to clock out and makes the System Clock-Outs (§6.14), under the cron lock; idempotent (one row per reminder, one system clock-out a shift) |
| The policy's events | `policies.md` §7 | Moved in PR 1: `policy.published`, `policy.acknowledged` and the rest. Attendance has no `policy.published` handler: it caches no rules, and reads the version in force on each call (§6.15) |
| `attendance.clock_out_due` | From the shift's end, every `clock_out_reminder_minutes`, for someone still clocked in, until the system clock-out (§6.14) | Notifies the person ("Time to clock out", the shift's end; the bell, push as their preference allows; none while they are in front of the app, who have the closing prompt); marked read when they clock out |
| `attendance.rule_breached` | A consequence rule is reached, in the transaction that crossed it (§6.16) | Audit; outbox `attendance.raise_breach_alert`: the Home alert when Alert is on, or Query Due while Raise Query is on until M3, its id kept on the breach; Queries (M3) subscribes when `raise_query` is true |
| `attendance.pay_item_added`, `attendance.pay_item_waived`, `attendance.overtime_decided` | A deduction or overtime is added, waived (by People, or by the system when its day stops qualifying), confirmed or cut (by a person, or by the method, §6.17) | Audit; notifies the person (an overtime item waiting under Line Manager After also notifies `people` approve holders over them: their line managers and People); realtime refresh. The notice opens My Attendance on its day (the person) or People · Attendance (the approvers) |
| `attendance.pay_item_changed` | A pending or system-decided item follows its day: its minutes or amount changed (§6.17) | Audit; realtime refresh; nobody is told |
| `attendance.overtime_approved` | A line manager or People approve overtime for a person's day beforehand (Approve Overtime, §6.17) | Audit; notifies the person with the day and the minutes |
| `temporary_site.submitted` (PR 4) | Add Work Site saves one (§6.11) | Audit; the approval (`attendance.temporary_site`) tells its approvers, never someone on the site; each person on it but the submitter is told they are put on it (Put on a Temporary Site); realtime refresh |
| `temporary_site.approved` (PR 4) | Its approval ends approved (copied on by `attendance.apply_temporary_site_decision`), or People add one directly (`direct`) | Audit; each person on it but the submitter (whom the approval already told) is told, or, added directly, told they are on it; outbox `attendance.resolve_covered_exceptions` resolves the open location exceptions it covers (§6.11); realtime refresh |
| `temporary_site.rejected` (PR 4) | Its approval ends rejected | Audit; each person on it but the submitter is told, with the approver's reason; realtime refresh |
| `temporary_site.withdrawn` (PR 4) | The submitter withdraws it while it waits (or its approval is withdrawn) | Audit; each person on it but the submitter is told; realtime refresh |
| `temporary_site.cancelled` (PR 4) | People cancel it (§6.11) | Audit; each person still on it is told, with the reason; realtime refresh |
| `temporary_site.member_removed` (PR 4) | People take someone off it | Audit; that person is told, with the reason; realtime refresh |
| `attendance.checked_in` (PR 4) | A check-in commits (§6.12) | Audit; realtime refresh (`attendance.push_updated`); a flagged one also emits `attendance.review_required`, which tells the person and People as for a punch |

Every temporary site event carries ids, the number, the purpose, the name and the dates, and the
people on it, never an address or a point. The engine tells only the submitter of the decision
(`workflow.completed` goes to `opened_by`), so the module's notices cover the others. Each notice is
declared with `defineNotification`, so Settings · Notifications lists it by itself
(notifications.md §6). A notice opens the site on People · Worksites for those who hold `people`,
and on ESS · Work Location Requests (`?site=`) for everyone else on it (notifications.md §3).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Employee | Own clock, days, punches, check-ins, exceptions, devices, home location, temporary sites, work location requests and field assignments made before PR 4, work schedule and week, and their own deductions and overtime with their amounts; every published version of the attendance policy | Clock in and out, check in at each stop on a temporary site's day, explain an exception, give the real time of a System Clock-Out, export the month, register and remove own devices; while Home Location is on, anyone whose week has a Remote day sets their home location; withdraw or cancel a work location request made before PR 4; acknowledge the newest policy version |
| Line Manager, Head of Department (`people` team) | The register, days, check-ins, devices, exceptions and home statuses of their reporting tree, its temporary sites (no Temporary Home's line or point), its work location requests (no temporary home's point), its work schedules, and its deductions and overtime (amounts only with the salary grant); no coordinates or home addresses | Decide the first stage of a direct report's work location request still waiting from before PR 4; cancel a field assignment made before PR 4 for people in their reporting tree, or take someone off it (`people` approve); confirm or cut a report's overtime under Line Manager After and approve it beforehand under Pre-Approved (`people` approve); set a report's work schedule where their role holds `people` edit; otherwise read only; export (heads). From PR 4 they no longer set field assignments: anyone adds a temporary site from Home |
| Operations & People, Management (`people` all) | Everyone, with the punch coordinates, home locations, temporary sites (a Temporary Home's line and point masked under `employee.personal` where the role masks personal details), work location requests, deductions and overtime | Decide exceptions, a check-in's included, and home locations while Home Location is on (approve); approve or reject a temporary site, the stage's approvers (Operations & People by default), never one they are on; add a temporary site directly, never with themselves on it, cancel one or take someone off (approve, scope all); decide a waiting work location request's Operations & People stage; cancel and change field assignments made before PR 4 (approve); waive deductions and confirm, cut or approve overtime (approve); remove devices and set anyone's work schedule (edit), manage worksites (create, edit), export |
| CEO | Everything, as the access rules give the CEO | The same as `people` all, never on their own exception; may decide any approval's stage, a temporary site they are on included (A11) |
| Anyone (from PR 4) | Their own temporary sites: those they submitted or are or were on | Add Work Site for themselves and colleagues; withdraw one they submitted while it waits; check in on its days |
| People with the salary grant | Deduction and overtime amounts (`pay_amount`, masked under `employee.salary` for everyone else) | As their grant allows |
| `policies.manage` (policies.md §8) | The Attendance policy's worksheet, versions and acknowledgements | Change and publish the rules (formerly `settings` edit on Settings · Attendance Policy) |

The shared roster reads within the scope the caller's grant gives (`scopeClause` on the employee):
the whole organisation, the reader and everyone below them on the solid line, or the reader alone.
`personal()` takes no scope; its caller has already decided the reader may see that person (their
own record, or `assertInScope`).

The punch's coordinates go only to `people` scope all; the person's own screens and team scope get
the verdict, the distance and the worksite's name. The device cookie, its hash and any raw identifier
never leave identity, and no log line carries them.

## 9 · AI and search

- **AI reads** (`attendance.ai.js`): `attendance.my_days` (ess view, own), `attendance.register`
  and `attendance.exceptions` (`people` view, the caller's scope); the rules in force are read through
  `policies.text` (`policies.md` §9; `attendance.policy` is removed in PR 1);
  `attendance.my_pay_items` (ess view, own) and `attendance.pay_items` (`people` view, the caller's
  scope, `pay_amount` masked as the salary is, the assistant's own reads included); from PR 4 `attendance.temporary_sites` (the reader's scope, no addresses); `devices.ai.js`: `devices.mine`,
  `devices.list`; `worksites.ai.js`: `worksites.list`. Every list is a page of 25, through the same
  service and scope as the screen; no coordinates, no device identifier, no evidence blob.
- **AI routes**: clock in or see my attendance → ESS · My Attendance; review attendance → People ·
  Attendance; register a device → ESS · My Devices; add a worksite → People · Worksites; set my
  home location → ESS · My Attendance; approve home locations → People · Attendance (these two only
  while Home Location is on: the assistant, M10, asks `attendance.home.onDate` before offering them,
  §1.3); approve work location requests → People · Worksites;
  read or acknowledge the attendance policy → ESS · Policy Updates; change the attendance policy →
  Knowledge Hub · Policies (`?policy=attendance`); work somewhere else → ESS · Work Location Requests,
  where Add Work Site is (PR 4; a manifest names no action, A23); approve a temporary site → People · Worksites
  (PR 4); my temporary sites → ESS · Work Location Requests; my deductions or overtime → ESS · My
  Attendance; waive deductions or confirm overtime → People · Attendance; set someone's work
  schedule → People · Employees (the record's Work Schedule tab); my work week → ESS · My Profile.
  The routes to send people out on a field assignment and to ask for a work location went in PR 4.
  `attendance.temporary_sites` (PR 4) reads a page of 25 of the reader's `people` scope, as the list
  does, with the number, purpose, name, dates, state and people, never an address, a point or a
  description. No AI read touches a home location, a work location request, a field assignment or a
  schedule. Nothing in PR 3 or PR 4 calls a model, so no AI job is chosen.
- **Search**: `attendance.search.js` finds attendance days and exceptions by the person's name;
  `devices.search.js` devices by label or owner; `worksites.search.js` worksites by name or code;
  `attendance.search.js` also finds home locations by the person's name (never by the address) while
  Home Location is on (the provider's `available`, `shared/search/provider.js`), and
  work location requests by their number or the person's name (never by the address), and field
  assignments by their number, name, client or anyone on them (never by a site's address).
  Each within the reader's `people` scope. A request opens on People · Worksites, Temporary, by
  `?request=`, and a person's own on ESS · Work Location Requests; an assignment opens on People ·
  Worksites, Temporary, by `?assignment=`,
  and a person's own on My Attendance. ⌘K's New Request (`request_work_location`) and New Assignment
  (`new_field_assignment`) went in PR 4 with their sheets. A
  schedule is not a record of its own: its event is the employee's (`attendance.schedule_set` on the
  `employee` entity, which the route map already opens), so it is found through the employee (⌘K's
  employee results open the record, whose Work Schedule tab holds it), and its notice opens the
  person's own record (My Profile). A rule breach
  (`attendance_rule_breach`) is not looked up either: its Home alert opens its last day on People ·
  Attendance; an overtime approval (`attendance_overtime_approval`) opens its day the same way, the
  person's own on My Attendance. A reminder to clock out opens My Attendance with the clock panel,
  as a reminder to clock in does. A clock-in reminder is not a record to look up
  (`attendance_clock_reminder`, `search:none` in the route map): its notice opens My Attendance with
  the clock panel (`?clock=`). Nor is the push to set a home (`attendance_home_needed`, `search:none`,
  §6.10): it opens My Attendance with Set Home Location (`?home=`). The Attendance policy is found as a policy (`policies.md` §9); the route map's
  `attendance_policy` entry goes in PR 1. From PR 4, temporary sites by their number, name, purpose
  or anyone on them (never by an address), within the reader's `people` scope, opening People ·
  Worksites `?site=` or, for the person's own, ESS · Work Location Requests `?site=` (read through
  `GET /attendance/me/temporary-sites/:id`); ⌘K's Add Work Site (`add_work_site`, everyone) opens
  Home · Overview with the sheet (`?action=work-site`), and Add Temporary Site (`add_temporary_site`,
  `people` approve) People · Worksites on Temporary with People's sheet (`?action=temporary-site`).
  A request or an assignment made before PR 4 opens on People · Worksites, Temporary. A check-in is found through its day, never on
  its own (`attendance_check_in`, `search:none` in the route map).
  A pay item is not looked up on its own (`search:none`): its notice opens My Attendance or the
  register on its day. AI does not create punches, decide exceptions, change the policy or infer missing
  location evidence.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). §3 and §6 are for engineers; only what is listed here reaches a screen.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Clock In / Clock Out panel | While Home Location is on, for someone working from home that day (a Remote day of their week) with no approved home, a banner (No Approved Home) with Set Home; while it is off, a remote day's Clock Location reads Not Checked, with no banner and no location step (Clock In goes straight to the punch); for someone expected at an office with none assigned, a banner (No Office Assigned); the date and the workplace's current time, the state pill (Clocked Out, Clocked In with its time, Review Required), Shift, Work Arrangement, Clock Location with its radius (on a field assignment's day, its site), This Device with its status; the step before the browser asks (Location Check, one line naming the worksite); Clock In or Clock Out, Allow Location, Retry Location, Register Device, Not Now; the result after a punch with its reasons; Note for People and Send Note when it is under review; opened by itself over a blurred screen, Start Your Day at the day's first sign-in and at the start and Finish Your Day at the end, with Remind Me (In 15 Minutes, In 30 Minutes, In 1 Hour) beside Clock Out; Shift is the person's own (from their work schedule); after a system clock-out, System Clock-Out with the day's times | Clock Location: the punch is matched to this place; This Device: why an unregistered device is flagged under the current policy | "location is read only and not continuously tracked", how block and warn decide, idempotency, when the system clocks you out: §6 here |
| ESS · My Attendance | While Home Location is on and their week, in force or waiting to start, has a Remote day (`MyHome.needed`), a Home Location card: the status (Approved, Waiting, Not Set, Rejected with People's reason), the address, Set Home Location or Update Home (a sheet: Use This Location with the reading's accuracy, Address, Send for Approval; a link with `?home=`, from the panel's Set Home or the push to set one, opens it while no home is approved or waiting); Today's card, Temporary Sites when the person has any waiting, in progress or to come (number and name, purpose, dates, state; one opens on ESS · Work Location Requests), and beside them Field Assignments made before PR 4 while one is in progress or to come (number and name, dates, the site; one opens with the client, its sites with their address and radius, and who else is on it), the month picker beside Export Month (arrows a month at a time; the month's name opens a year and its months, back two years), Days Present, Late Days (with the share of days present), Absent, Hours Worked, each of the first three opening its days paged at 25, the days with clock in, clock out, hours, status and Review or as a chart of hours (late days stand out), a day's punches, open exceptions with Explain; a clock-out the system made reads System Clock-Out in My Days and the day's punches, and the day offers Give Real Time (a sheet: Real Time, Your Note, Send Time); Export Month | Hours Worked: from the first clock-in to the last clock-out; a System Clock-Out counts to the shift's end | "a correction never overwrites a punch", when the system clocks you out: §6.8, §6.14 |
| ESS · Work Location Requests | Add Work Site; My Temporary Sites with number, purpose and name, dates and state (Awaiting Approval, Upcoming, In Progress, Done, Rejected, Withdrawn, Cancelled); a site opens with its details (purpose, first and last day, days, hours, its addresses with their radius on a map, the people on it, the description, who added it), its approval trail, and Withdraw Submission while it waits; the Add Work Site sheet, as Home's; under them, while any is listed, My Requests made before PR 4 with number, type, dates and status, each opening with its details, its approval trail and Withdraw Request or Cancel Request | Description: People approve from this; name an out-of-station letter if you have one. Radius: a punch within it counts here | How the approval routes and what the clock does on an approved day: §6.11 |
| ESS · My Devices | The devices with status, first seen, last punch and This Device; Register This Device, Remove | Status header: what New, Registered and Removed mean | "How device checks work", the three-device reason: §6.6 |
| People · Attendance | The date, Expected, Present, Late, Absent, On Leave, Not In, Open Exceptions; Register, Exceptions and, while Home Location is on, Homes (status chips; person, address, accuracy, requested, distance from the approved home, status; a home opens with Approve and Reject); the register (person, arrangement, clock in, clock out, location, device, status, review); a day's evidence, each punch's Source (Clock, Added by People, System Clock-Out), and from PR 4 its route: the clock-in, each Check-In with its address and verdict, then the clock-out, in time order; Decide, a System Clock-Out offering Accept and Correct Time (starting from the time the person gave, with their note), a check-in's flag offering Accept and Reject; the decision only when the reader may make it (`can_decide`), Close otherwise; Export (Period, and Status starting on the chip in force). Requests and Field (with New Assignment) left in PR 4 for People · Worksites, Temporary | Open Exceptions: what waits on People; Outcome on the decision form: accept, reject or add the clock-out, or for a System Clock-Out keep or correct its time; From Approved Home: how far a new home is from the one in force | The page explainer, "what a manager can and cannot do", reconciliation mechanics: §3, §6.8, §8 |
| People · Devices | Device list with employee, device, status, first seen, last punch; Remove Device | Status header: as on My Devices | "devices register on every punch": §6.6 |
| People · Worksites | Worksites with code, address, radius, assigned and status; Add Worksite and Edit Worksite (Name, Address with suggestions as it is typed, the one picked filling Latitude and Longitude, Radius, Metres, then a map of the centre and its fence once both coordinates are real; tapping the map moves the centre; coordinates given with no address fill it); a worksite's details with the same map, Edit, Retire or Restore, its employees with Assign Employee; under the address while typing, a spinner, "No address matches" or "Could not search addresses" | Radius: punches inside count as on site | "How the geofence behaves": §6.5; where the suggestions come from: foundation.md §6.13 |
| Clock In / Clock Out panel, from PRs 2 to 4 | A rough reading names its fix as a banner: Precise Location Off with how to turn it on (iPhone, Android), Use Your Phone (a computer), Location Blocked with how to allow it, Secure Address Needed; Clock In Anyway; the location step always ends, so Not Now works while it reads (PR 2). Finish Your Day with Clock Out and Remind Me; a day ended by the system reads System Clock-Out (PR 3). On a temporary site's day, the site's name and addresses, and Check In after clocking in, with Check-Ins under it: each stop's time, address and Inside or Flagged (Recorded when the policy checks nothing) (PR 4) | Location Unclear: the reading could not prove where you were | How the fence and the reading are judged, when the system clocks you out: §6.5, §6.14 |
| ESS · My Attendance, from PRs 3 and 4 | Deductions and Overtime cards for the month: each day, its kind, its minutes, its amount (or No Salary Set) and status (Pending, Waived, Confirmed, Cut, In Payroll), a waived or cut one with its reason; Give Real Time on a System Clock-Out; a day's route of check-ins (PR 4) | Amount: worked out from your monthly gross | The formulas, the cap, who confirms: §6.17 |
| People · Attendance, from PR 3 | Deductions and Overtime in the view switch: person, day, kind, minutes, amount (Restricted without the salary grant, or No Salary Set), status, the status chips (Pending, Waived or Confirmed, Cut, All); Waive Selected (a sheet: Waiving, "3 of 4 selected", when some ticked items are not the reader's; Reason, Waive Deductions; up to 25 ticked, on any page), Confirm and Cut on a pending overtime item (Minutes for fewer, Reason to cut); Approve Overtime on a person's day while the policy approves overtime beforehand (a sheet: Day, from today to 90 days ahead, Minutes, Reason, Approve Overtime) | Deductions (the list's title): Waive Selected restores the pay, the day still counts | The rules engine and the methods: §6.16, §6.17 |
| People · Worksites, from PR 4 | Permanent or Temporary, a switch; Permanent is the worksites alone, as above. Temporary: the status chips (All, Awaiting Approval, In Progress, Upcoming, Done, Rejected, Cancelled) over the sites in the reader's scope: number and name, purpose, dates, people, state, Awaiting Approval first; Add Temporary Site (`people` approve, scope all), the same sheet as Home's with People from the employee list and Save Site; a site opens with its details (number, purpose, first and last day, days, hours, added by, approved), its addresses on a map with their radius, its description, its people (Take Off on each person's row, with a reason; none with one person left, the list's help saying Cancel Site ends it instead), its approval trail, and Approve or Reject (a reason) when it waits on the reader, Cancel Site (a reason) while it is in force; while any made before PR 4 still waits or is in force, Requests and Field beside the sites: a request opens with its details, its approval route and Record Decision when it waits on the reader; an assignment opens with its details, sites and people, Take Off and Cancel Assignment | Description: why it is needed. Radius: a punch within it counts here | The approval route, who on a site may not decide it: §6.11 |
| Home · Overview, Add Work Site (PR 4) | The sheet: Hours first (Usual Shift or Site Hours; Site Hours adds Starts At and Ends At), Purpose (search the list; Temporary Home only while Home Location is on), Name, Addresses (picked; Add Address, up to eight, each with its Label, its Radius and a small map; Remove on all but the first), First Day, Last Day, People (you and colleagues, you first), Description, Submit for Approval; toast "TS-0001 sent for approval"; a site that overlaps another names it on First Day | Description: People approve from this; name an out-of-station letter if you have one. Radius: a punch within it counts here | Who approves and what happens on the day: §6.11 |
| People · Employees, the Work Schedule tab | After Job, in place of the Attendance tab: a Work Setup card (Work Pattern, Office with its radius or No Office Assigned, Home Location: Approved, Waiting or Not Set for someone whose week has a Remote day, while Home Location is on); a Work Schedule card: the week as seven rows, each Working or Off with its hours (Company Hours when they are the company's) and an Office or Remote pill, From (the schedule's first day, or Company Hours when none is set) and Next (a schedule waiting to start, from its first day); Set Schedule when `can_edit` (a sheet: a row per weekday with Working, Starts, Ends and Office or Remote, then From, Reason, Save Schedule) | Work Schedule: lateness and absence follow these days and hours; Days (the sheet's header): leave Starts and Ends empty for the company hours of that day | How a day is judged: §6.4, §6.13 |
| Knowledge Hub · Policies, the Attendance worksheet | One card per section (Working Hours, Lateness, Late Arrivals, Early Departure, Absence, Forgotten Clock-Outs, Location Flags, Overtime, Location Checks, Devices, Clock Prompts), each rule a row with its control and Changed; a switch that is on shows its figures; every rule since PR 3; Location Checks' Home Location a switch, with Home Check and Home Radius beneath it while it is on | Each rule's label: what it decides ("Flag: accepted, sent to People to review") | Versions, approval and acknowledgement: policies.md §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Clock In / Clock Out panel | A bottom sheet: the state, the time, the shift and location, then the result (no toast over it); opened by itself, it does not drag away | Nothing | Clock In or Clock Out, full width at the foot; Remind Me above it at the shift's end, its choices an action sheet | The floating button's Clock In or Out (F18); the top bar's clock on desktop; it opens by itself on the first screen of the day's first sign-in, at the shift's start and at its end (§6.14), and from the reminder's notice |
| ESS · My Attendance | While Home Location is on and their week has a Remote day, the Home Location card first, then Today's card, Temporary Sites as cards when there are any (then Field Assignments made before PR 4), the four figures two to a row, then days as cards | Subtitle | Export Month in the header; Set Home Location full width in its card, its sheet's Send for Approval at the foot | Bottom bar Self-Service; ESS tabs scroll sideways |
| ESS · Work Location Requests | Site cards with number and name, purpose, dates and state; then, while any is listed, request cards made before PR 4 | Subtitle; a site's people and description (in its sheet) | Add Work Site, full width at the foot and in the floating button's fan; the sheet's Submit for Approval at its foot; Withdraw Submission in the site's sheet | ESS tabs |
| ESS · My Devices | Device cards with their status | Subtitle | Register This Device, full width | ESS tabs |
| People · Attendance | The figures two to a row (a figure filters the register), the view switch (Register, Exceptions, and Homes while Home Location is on), the status chips scrolling sideways, then register cards with status, clock in and clock out; Homes as cards with the person, status and distance | Subtitle; the arrangement, location, device and review columns (in the day's sheet) | A card opens the day's evidence in a sheet, its check-ins in time order between the punches (PR 4) | More, then People |
| People · Devices | Device cards with status | Subtitle | A card opens it; Remove Device in its sheet | People tabs |
| People · Worksites | Worksite cards; the Add Worksite sheet with the address first after the name, its suggestions as 44 px rows under it inside the sheet's scroll, and the small map under Radius; a worksite's sheet shows its map under the details | Subtitle | Add Worksite, full width; picking a suggestion fills Latitude and Longitude, so a phone types neither; a tap on the map moves the centre (the map never drags, so the sheet keeps its scroll) | People tabs |
| Clock In / Clock Out panel, from PRs 2 to 4 | The banner for a rough reading above Clock In Anyway; Check In full width on a temporary site's day | Nothing | Clock In or Clock Out; Check In | As above |
| ESS · My Attendance, from PRs 3 and 4 | Deductions and Overtime as cards under the figures (the date, then the kind and minutes on one line, the amount and the status), then the days; a day's sheet shows its route, the punches and check-ins in time order (PR 4) | The Method column (in the item's sheet) | Give Real Time in the day's sheet, Send Time at the sheet's foot | ESS tabs |
| People · Attendance, from PR 3 | Deductions and Overtime in the view switch, as cards with a tick to select: the person, then the day, kind and minutes on one line, the amount and the status (Sort keeps Date and Minutes) | The Method column (in the item's sheet) | Waive Selected in the floating button; Confirm and Cut at the foot of an overtime item's sheet | More, then People |
| People · Worksites, from PR 4 | Permanent and Temporary as a switch; on Temporary the status chips scrolling sideways, then site cards with name, purpose, dates and state; Requests and Field cards while any made before PR 4 waits or is in force | The People column (in the site's sheet) | Add Temporary Site in the floating button, its sheet a full sheet; Approve and Reject at the foot of the site's sheet | People tabs |
| Home · Overview, Add Work Site (PR 4) | A full sheet: Hours first (with Starts At and Ends At side by side for Site Hours), then Purpose, Name, Addresses with a small map each, dates, People, Description | Nothing | Submit for Approval at the foot | Add Work Site in the floating button's fan beside New; ⌘K's Add Work Site |
| People · Employees, the Work Schedule tab | Work Setup, then the week as seven rows | Nothing | Set Schedule full width under the week; its sheet (full screen) a card per weekday, Save Schedule at the foot | The record's tabs scroll sideways |
| Knowledge Hub · Policies, the Attendance worksheet | The section cards one under another, each rule a 44 px row, Save Draft at the foot | Nothing | Save Draft; Publish Policy in the draft's banner | More, then Knowledge Hub |

## 11 · Edge cases

- Suspended login: auth refuses the session, so no punch arrives. Archived or left employee: 422
  `NOT_EMPLOYED`.
- Approved leave covering the work date: clock-in and clock-out are refused with the leave's dates
  (422 `ON_LEAVE`); the day is `leave`. Leave is read on the punch's work date, resolved first (PR 2):
  a clock-out after midnight that closes yesterday's shift is judged by yesterday, so a leave day
  starting today does not refuse it.
- No worksite on a day at the office (an Office day, or anyone with no schedule who is not remote):
  the punch is recorded with its reading and goes to review (`location_unverified`,
  `no_worksite`) under warn and block, accepted under off; the panel says No Office Assigned.
- A Remote day of someone's schedule: matched to the approved home as a remote employee's is;
  with no approved home, review (`no_home`). An approved remote day on a Remote day changes nothing
  but the evidence's place.
- A hybrid employee with no schedule yet: every day is an Office day at the company hours (§6.13).
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
- The watch run twice, or late: one row per reminder, so none twice; a shift clocked out once (the
  person's lock and the one system clock-out a day), at the end plus
  `system_clock_out_after_minutes` whenever the run reaches it; a run after the first hour of the
  day sends no reminder to clock in.
- Still at work after the shift's end, the app open: the closing prompt, Remind Me as often as they
  like, and no push while they are in front of it; at the end plus 90 minutes the System Clock-Out
  all the same (Remind Me never moves it). They give the real time and People confirm it.
- Left the office before the shift's end and never clocked out: reminded from the end, then clocked
  out by the system at the end plus 90 minutes; the day's hours count to the end; the person gives
  the real time and People correct it, and the corrected time decides early departure.
- Clocked in after the shift's end (an evening start on a working day): a clock-in between the end
  and the end plus 90 minutes is clocked out at that moment, with no worked minutes past the end; a
  clock-in at or after it is never clocked out by the system and gets no reminders: the day-close's
  missing clock-out, as on a day that is not worked.
- A day that is not worked (a Sunday clock-in, a holiday, an Off day): no shift end, so no closing
  prompt, no reminders and no system clock-out; the day-close's missing clock-out as before.
- No Redis (the presence store cannot answer): reminders go as pushes; the system clock-out happens
  on time, since presence no longer decides it.
- Two logins for one person: in front of the app on either holds the push for that reminder.
- A clock-out the person makes while the job is clocking them out: the person's lock decides; the
  second is `ALREADY_CLOCKED_OUT` (the person) or skipped (the job).
- Giving the real time of a System Clock-Out twice: 409 `ALREADY_EXPLAINED`; the note and time are on
  the first.
- Push turned off for Attendance and Leave: the reminder still reaches the bell; the prompt still
  opens in the app.
- No version of the Attendance policy yet: the type's defaults judge every punch (§6.1); Knowledge
  Hub · Policies lists it as Default Rules and a first draft starts from the suggested values. The
  policy's other edge cases are `policies.md` §11.
- A version published today from today: punches before it was published keep the version they were
  judged by; the next punch is judged by it.
- A day whose clock-in came before a new version started that day and whose clock-out came after:
  the day is judged by the version on its clock-in, recorded on the day (§6.4).
- A rough reading (approximate location, a laptop): never refused; Location Unclear for People with
  the fix shown to the person (PR 2).
- A punch People reject (PR 2): the person clocks in again that day; a rejected clock-out leaves the
  day open for Add Clock-Out, also after the day closed.
- Leave granted for a past day already closed absent (PR 2): the day becomes leave; its pending
  absence deduction is waived by the system ("Leave granted"), and it stops counting toward the next
  Absence breach; a breach already recorded that counted it stays (§6.16, §6.17).
- People reject the clock-in that made a day late (PR 2 lets the person clock in again): the day's
  pending deduction follows it ("No longer late", or new minutes for a later clock-in), and a breach
  already recorded stays.
- A part-time person on an Off day of their schedule: no prompt, no reminder, no absence; a
  punch that day is recorded, is never late, and counts as overtime at the rest-day rate when
  overtime is on.
- Still clocked in at the end plus 90 minutes: System Clock-Out; hours count to the end; the
  person gives the real time if they worked on and People confirm it.
- A deduction for a person with no monthly gross: kept with its minutes and No Salary Set; it gains
  its amount when payroll prices it.
- A waived deduction: the pay is restored; the day still counts toward its rule.
- Three late arrivals, then a query, then three more in the same month: a second breach with its own
  alert and, with Raise Query on, a second query (the count restarts); five late arrivals give one.
- A rule switched off mid-month: no breach from that version's first day; earlier breaches stay.
- An employee with no active login: never expected, never absent; their day reads Off.
- A schedule's blank working day on a weekday a later version of the company hours stops working:
  Off from that version's first day (§6.13).
- Overtime above the monthly cap: confirmed up to the cap, the rest cut "Monthly cap".
- Overtime pre-approved for fewer minutes than worked: confirmed up to the approval, the rest cut
  "Beyond pre-approval"; none approved: cut "Not pre-approved".
- A temporary site approved after its first day (PR 4): the location exceptions it covers on those
  days resolve themselves ("Covered by TS-0001"); punches keep their judgement; an exception with no
  reading, or a reading outside every address, stays for People.
- Two temporary sites for one person on one day (PR 4): the second is refused (`SITE_OVERLAPS`),
  waiting or approved; two sent at once wait on the person's lock, so one passes.
- A temporary site abroad (PR 4): the work date and the wall clock are read in its first address's
  timezone (Africa/Gaborone: a clock-in at 23:30 Lagos time is 00:30 the next day there, and that
  is its work date).
- A temporary site with its own hours over a weekend or a public holiday (21/10/2026): every day of
  it is worked by its people, with its hours; a Sunday with no clock-in closes absent. A site on
  the Usual Shift keeps each person's own days off: a clock-in on one is recorded, as on any day
  off.
- Site hours of 11:00 to 15:00 with ten minutes' grace: a clock-in at 11:08 is on time, at 11:12
  late by 12 minutes; the closing prompt and the system clock-out read 15:00, and worked time past
  it is overtime. The hours are the site's clock: abroad, its own zone (§6.4).
- A temporary site still waiting on its days (PR 4): it changes nothing until approved; the punches
  are judged as on any other day, and an approval later covers their flags.
- Someone on a temporary site who holds Operations & People (PR 4): they cannot decide it; another
  approver, or the CEO, does.
- A temporary site cancelled, or someone taken off it, part way through (PR 4): the days still to
  come go back to the usual place; punches and check-ins already made keep their judgement.
- A check-in with no temporary site that day (PR 4): refused (`NO_TEMPORARY_SITE`); a check-in while
  clocked out: refused (`NOT_CLOCKED_IN`); the 21st of a day: refused (`CHECK_IN_LIMIT`).
- A second Check In at the same address within 5 minutes (PR 4): answered with the first, nothing new
  recorded. A press with no connection keeps its key and body for Try Again, as a punch does.
- A rough or missing reading at a stop (PR 4): recorded and flagged Location Unclear, never refused.
- A work location request or field assignment made before PR 4 and still in force (PR 4): it keeps
  applying until its last day, after any temporary site; a request still waiting is still decided in
  its approval.
- In front of the app at the start and not clocked in: the start prompt, no push; away within the
  hour still not clocked in: the push then.
- Signing in through a link to another screen, first thing in the day: the sign-in prompt opens
  over that screen; closing it leaves the screen as it was.
- Home Location switched off by a version from today (§1.3): punches before it keep their judgement,
  and a day whose clock-in was checked against the home stays judged so (§6.4); the next remote
  punch is not checked.
- Home Location off with a home waiting: it waits, unseen; switched on again, People see it in Homes
  and decide it. An open Outside Home or no home exception stays on Exceptions for People (H9).
- Home Location switched on: whoever needs a home and has none approved or waiting gets one push in
  the working day; someone who sets one first is not pushed; switched off and on again, those still
  without one are pushed again (H8). Their clock-ins go to review (no home) until People approve.
- Moving house while Home Location is off: nothing to do; once it is on again, the old approved home
  is the fence until the person sends the new one and People approve it.
- A Temporary Home approved, then Home Location switched off: its remaining days read as remote,
  unchecked, its hours and zone kept; Check In is refused (`NO_TEMPORARY_SITE`); switched on again,
  its remaining days are fenced again (H6).
- A link to a home (an older notice, a search remembered) while Home Location is off: People ·
  Attendance opens without the Homes view and shows nothing about the home.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| pixie | `src/shared/hr_payroll/clock.guard.js` (`evaluateClockTransition`) | Review events count as active, rejected never do; an explicit `SHIFT_DONE` after the day's clock-out; messages without dashes |
| pixie | `src/shared/hr_payroll/device.guard.js` (`evaluateDeviceRecognition`) | No CEO exemption and no "no device enrolled yet means neutral": an unregistered device is unknown, judged by `device_mode`; the device is the session's `known_device`, never a client fingerprint |
| pixie | `src/shared/hr_payroll/devices.service.js`, `devices.repo.js` | Cap 3 (MyCity's meetings), not 2; registration confirmed by a fresh sign-in, not an email code; no change log table (the event log and audit ledger carry every change) |
| pixie | `src/shared/attendance/geo.calc.js` | Already in `shared/geo` (M0); the policy decision is `attendance.geofence.js` |
| pixie | `src/shared/hr_payroll/lateness.calc.js` (`minutesLate`, `minutesOvertime`) | Lateness counted from the start once past grace (T2), early departure to the end, overtime after the end once past `after_minutes`, on the work date's wall clock (`attendance.lateness.js`); the money half is used now (`attendance.pay.js`): daily pay pro-rated over the person's working days that month, with T4's three methods (pro-rata by minute, fixed per started hour, fixed per late day) in place of its tiers |
| pixie | `src/shared/hr_payroll/hr_ops.service.js` (`selfClock`) and `migrations/000303` | The per-day unique index on active events, the advisory lock first; location is not mandatory (praxis's "always record" with the policy deciding) |
| praxis-ls | `src/modules/hr/attendance/attendance.rules.js` (`wallClock`, `localDate`, `reconcileDay`) | Statuses `present`, `late`, `absent`, `leave` (no weekend or holiday rows); lateness from the start once past grace (T2, §6.4); the shift from the person's own schedule (§6.13); deductions in `attendance.pay.js` |
| praxis-ls | `src/modules/hr/attendance/attendance.export.js` | The register and the month as workbooks through `shared/spreadsheet`, gathered 25 at a time, downloaded on the device that asked (never emailed) |
| praxis-ls | `doc/CLOCKIN_REVAMP_ENGINEERING_GUIDE.md` §1.2 (the policy model) | `block` rejects, as MyCity asked; praxis holds every punch instead |

## 13 · Open questions

- **Decided 20/10/2026 (TB, §1.1)** and closing what stood open here: the pay rules (deductions and
  overtime) and the query, alert and absence rules join the policy as switches (§6.15 to §6.17); a
  per-person policy is replaced by work schedules (§6.13); field assignments and work location
  requests become temporary sites, approved by People (§6.11); the open shift's cap becomes the
  system clock-out (§6.14); the home fence is at least 150 m (T9).
- **The query itself is M3's** (GE, 26 to 30 October). PR 3 emits `attendance.rule_breached` with
  `raise_query`; Queries & Sanctions subscribes and raises one query per breach. Until it does, the
  breach's alert reads Query Due. The M1 definition of done ("a late punch raises a query; HR waives
  it and the deduction is restored") is met once PR 3 and M3's subscriber are both in.
- **Payroll** (M6, LA) takes pending items into a run (`in_run`) and owns what a payslip shows;
  PR 3 prices them from `employee.gross_monthly` so the person sees them as they happen.
- **Cynthia is told** the home fence is 150 m, not the 100 m of her email, and why (TB, 20/10/2026).
- **Home Location ships off** (TB, 22/10/2026, §1.3 H2), although the 21/10 handover agreed to keep
  home checks for remote staff (Cynthia). MyCity are told; People switch it on by publishing a
  version of the Attendance policy whenever they want it. TB to confirm the Working From Home
  sentence read while it is off.
- **The assistant** (M10) offers the two home routes (§9) only while Home Location is on; no AI
  route is conditional yet, since nothing reads the routes before M10.
- Still open: overnight shifts (a schedule's end after midnight; today a shift ends the day it
  starts); offline punching for field staff (not in scope, BACKEND_STRUCTURE §15); whether excusing a
  late day (not only waiving its deduction) should take it out of the count (today it never does).
- The address search, the maps and picked addresses are built (`addresses.md`, F27); temporary
  sites use them (PR 4).

## 14 · Change log

- 26/10/2026 · JP · From the User Guide audit's screen defects: exceptions and homes carry `can_decide` (scope all, open or pending, not one's own) and the decision form shows only then; an exception says when its punch was `refused` at the clock, and its Outcome help then says neither choice makes it count; a punch People rejected reads Rejected, apart from Not Counted (refused at the clock), on People · Attendance and My Attendance; Open Exceptions opens the day's open exceptions; the day's `policy.pre_approved_overtime` gates Approve Overtime, whose sheet takes a Day up to 90 days ahead; Export Register's sheet shows the Status it exports; ticks to waive count across pages, a waive with nothing waivable says so, and the toast counts what was skipped and why; a confirmation the monthly cap cut or shortened says so; Take Off is a button on each person's row, and with one person left the People list says to cancel instead. §5 and §10 updated; the People chapter with it.
- 26/10/2026 · JP · From the User Guide audit's screen defects: a punch carries `real_time_given`, so My Attendance shows Real Time Given in place of a second Give Real Time; after clock-out the clock stays pressable as Done For Today (top bar and Quick Actions) and opens the day's times with My Attendance, no punch (the owner's decision, 26/10/2026); the Today pill reads Not Available, not On Leave, for someone who no longer works here; People · Attendance opens a person's today from `?employee=` (Home's View Attendance); the clock's "Note not sent. Try again." is an error toast; My Devices tells a session with no device to sign in again; a Work Location Request's approval that cannot be read offers Try Again; §10.1 names the clock's Note for People and Send Note.
- 26/10/2026 · JP · Field messages in four words (FRONTEND_GUIDE §8.3): "Tick a working day" (was "At least one working day", cut to Check this value on screen) for a schedule and the company hours; the company hours mark the day whose time is wrong ("Required" on an empty time, "Ends after it starts"), not Monday's Working. A Home Radius under 50 reads "At least 50", not "Too short".
- 22/10/2026 · TB · The Home Location switch (§1.3, TB's ten answers after the Milestone 1 handover): `home_location` joins the Attendance policy (Location Checks, Home Check and Home Radius beneath it), off by default and on every version before it. Off, no home is asked for, sent, listed, approved, searched or notified (409 `HOME_LOCATION_OFF` on the home routes), a remote day, an approved Temporary Home and an older temporary home or remote day request are not checked (no reading asked or kept, `not_applied`, `home_location_off`), Temporary Home leaves Add Work Site, its days offer no Check In, the register names a remote day Remote, and Working From Home reads one sentence. Homes stay as they were. Switched on, the reminder `attendance_home_needed` pushes Set your home location once a stretch to whoever needs one (`policies.heldSince` gives the stretch's first day, which names it). `AttendanceToday` gains `policy.home_location` and `location.checked`. The rule is a switch named like a place, so it is marked `address:none` in the contract for gate 22 (`addresses.md`). A draft checks a home's Home Check and Home Radius only while Home Location is on, when the worksheet shows them, so an older version's Off or 100 m never blocks a draft on a hidden field. §1 to §11 and §13 updated.
- 21/10/2026 · TB · The shared roster's `page()` takes `statuses`, any of several (Home's Daily Attendance report: Late and Absent together, `home.md` §6 Reports); nothing it reads or decides changed.
- 21/10/2026 · TB · Every attendance date field keeps what is typed and refuses a day outside its range as it is typed (the shared `DateField`, fault #2 of the 21/10 brief: a typed 28/10/2026 had become 2020-10-28, so a temporary site, a schedule or overtime from a typed date was refused as Already Past after Save). People · Attendance's Export takes the Period's own message ("Pick 21/10/2026 or earlier") through `DateRangeField`'s `onProblem`.
- 21/10/2026 · TB · My Days as a chart (`EssAttendance.tsx`, `ess.md`) labels each day 13/10, not 13/10/; the shared bar chart leaves off the days that would touch.
- 21/10/2026 · TB · PR 2 built (clock fixes): the reading judged with its accuracy (`attendance.geofence.js` `judgeReading`: inside, outside when even its nearest point is beyond the fence, else unclear at the `edge` or `poor_accuracy`; no accuracy is `no_accuracy`), on whichever place judges the punch; Refuse opens the refused punch's exception (outside or unknown device, its detail Refused) and its `reasons` name only the checks that refused it; `location_unverified` reads Location Unclear (`1397`, `labels.ts`, the mock, the exports) with its reason; a punch People reject frees its slot (`1380`, `attendance_event.slot`; the guard, the open shifts and the roster count only what no decision excluded), a clock-out rejected on a closed day opens its missing clock-out for Add Clock-Out; leave read on the work date, and leave granted for a closed day re-projects it (`attendance.day_reprojected`); a stored key reused for the other punch after 48 hours is 422; `LocationError` gains `insecure`; `shared/geo`'s second geofence (`evaluateClockIn`) removed. The clock panel, Check In and the home read through one reader (`location.ts`: up to ten seconds, the best fix, a watchdog, the fix for the device: Precise Location Off, Use Your Phone, Location Blocked, Secure Address Needed). §1.2, §3, §4, §6.2 to §6.8, §6.12, §7 and §11 updated; §6.5 now says the temporary site sheet reads only through `AddressField`.
- 21/10/2026 · TB · A temporary site's hours (owner decision, 21/10/2026; §4, §6.9, §6.11, §6.14,
  §10, §11): the sheet's first choice is Usual Shift or Site Hours with a start and an end. Site
  Hours set the shift of every day of the site for the people on it (`calendar.shiftOn`, and
  `WORKS_ON` in SQL), weekends and holidays included, on the site's own clock: the clock-in reminder
  and start prompt at its start, lateness from it, the closing prompt, the reminders to clock out,
  overtime and the system clock-out from its end, absence when nobody clocks in. `hours`,
  `starts_at` and `ends_at` on `attendance_temporary_site` in `1475`.
- 21/10/2026 · TB · PR 3 built (rules and schedules): the company hours in the policy and each person's work schedule (`attendance.schedule.js`, People · Employees' Work Schedule tab after Job, in place of the Attendance tab); each day judged once against its own shift and version (`attendance.reconcile.js` `judgementOf`, `1425`); lateness from the start, early departures, overtime past `after_minutes`; the five consequence rules counted per person (`attendance.rules-engine.js`, `attendance_rule_breach`), each breach a Home alert on the rule the system keeps for it (Query Due while M3's query is not in); pending deductions and overtime priced from the monthly gross (`attendance.pay.js`, `attendance_pay_item`), waived, confirmed or cut by People and Approve Overtime beforehand; reminders to clock out every 30 minutes and the System Clock-Out 90 minutes after the end, with Give Real Time (`attendance.clock-watch.js`, `1440`); the worksheet shows every rule. PR 2 is not built yet, so §6.2, §6.3, §6.5, §6.7 and §6.8 still describe what stands. Help on a text field inside a sheet moved to the sheet's own header (Days) or the list's title (Deductions): a help-labelled field fails the a11y check inside a dialog (noted for the frontend foundation).
- 20/10/2026 · TB · PR 4 (Places) built: temporary sites (`attendance.sites.js`, `1450`, `1470`): Add Work Site from Home and ESS · Work Location Requests for oneself and colleagues, numbered `TS-0001` and approved through `attendance.temporary_site` (Operations & People; nobody on it decides it, through the engine's new per-instance exclusion, `1455`), People adding one directly, withdraw, cancel and take off, one site a person a day, the site first in `contextFor` and its zone for the work date and the wall clock, flags cleared by a late approval; check-ins at each stop (`attendance.check-ins.js`, `1460`: 20 a day, 5 minutes, flagged and decided as a punch's are, never the shift); People · Worksites' Permanent and Temporary switch, the old requests and assignments shown there while live (TB, 20/10/2026); a Temporary Home reads remote on the roster and any other site field (TB, 20/10/2026); the policy's Temporary Site Check and the T14 sentence. Work location requests and field assignments take no new entries. §1.2, §2 to §11 updated; the "Until PR 4" sections kept as history.
- 20/10/2026 · TB · PR 1 built: the clock reads its rules through `policies.rulesFor` (`attendance.calendar.js`) and each punch keeps `policy_version_id`; `attendance.policy.js` and the `/attendance/policy` routes, events and reminder are gone, and `attendance.policy-type.js` registers the Attendance type. Settings · Attendance Policy's screen and its sentences left `app/src/features/attendance/` for `app/src/features/policies/`; `prompts.ts` gained `signInAsked`, which the acknowledge sheet waits on.

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
- 19/10/2026 · TB · Every address on these screens searches as it is typed (`AddressField` over `GET /maps/search`, foundation.md §6.13): on People · Worksites, a field assignment's sites and a client visit the place picked fills Latitude and Longitude, which stay open to correct; on a home and a temporary home it fills the address only, the coordinates staying the reading's. §5, §6.10, §6.11, §6.13, §10 and §13 updated; the map tiles and the reverse lookup stay open.
- 19/10/2026 · TB · People · Worksites draws the centre and its fence on a map, in the form and the worksite's details (tiles through `GET /maps/tiles`, fetched with the session); a tap on the form's map moves the centre, and coordinates typed with no address fill it from `GET /maps/reverse`, for worksites only (decided 19/10/2026: a home's or a punch's coordinates are never sent to the provider). §5, §10 and §13 updated.
- 19/10/2026 · TB · A field assignment's sites (People · Attendance, New Assignment) and a client visit's site (ESS · Work Location Requests, New Request) show the site and its fence on a map under the radius once both coordinates are real; a tap moves the centre. One piece, `SiteMap.tsx`, draws it on all three forms (worksites too). No address lookup on these two (worksites only, decided 19/10/2026). §10 and §13 updated.
- 19/10/2026 · TB · The three gaps against the 12 and 13 October rules closed (owner, 19/10/2026; §6.14): the sign-in prompt is Attendance's (`sign_in_prompt` on today, the first-session rule Home's `dashboard.prompt.js` held, which is gone) and the shell opens it on whatever screen comes first, Home or a link; the start reminder is not sent to someone in front of the app (the start prompt asks them; a later run reminds them once away); every prompt opens over a blurred screen (`useModal().open({ blur })`). §2, §3, §5, §6.14, §7, §10 and §11 updated; home.md says the prompt left Home (O12 replaced).
- 19/10/2026 · TB · Exports download on the device that pressed (`docs/guides/foundation.md` §6.12, TB's decision): Export Month and Export Register answer 202 with the file pending (`ExportFile`) instead of the email they would reach, `attendance.build_export` makes the workbook into that file, and the screens wait and save it (Downloads on Android and desktop, the share sheet on an iPhone app). Export Register's sheet closes once the request is taken and the file arrives wherever the person is in the app. A login with no email is no longer refused. The `attendance-export` email template is gone.
- 19/10/2026 · TB · Attendance's notices are listed in Settings · Notifications (`docs/guides/notifications.md` §6):
  People may switch any of them off company-wide, and copy Attendance needs review, Attendance
  explanation and Home location to approve to other roles or people (`copy`). Nothing else changed.
- 19/10/2026 · LA · Settings · Attendance Policy (#73) and ESS · Policy Updates (#89) built (owner decisions, 19/10/2026; §6.15): one organisation policy in numbered versions. People edit the clock checks (grace minutes; the location check for the office, a home and a field site, each off, warn or block; GPS accuracy; home radius; the device check), save them as a draft and publish it as `Version N` from a first day with a note; a version waiting can be withdrawn. Everyone at work with a login is told (bell and push), reads the version on Policy Updates as full sentences with what changed tagged, and acknowledges it; acknowledging never blocks the clock; a reminder goes once after 3 days; People see who has acknowledged. The location mode is now per place (§6.1, §6.5) and each punch keeps the version it was judged by. `1370` (versions, the place modes, `attendance_policy_acknowledgement`), `1395` (1099's Standard policy out, A26); twelve routes; six events; one reminder. §1 to §11 and §13 updated; §6.15 added.
- 20/10/2026 · LA · The policy's 3-day reminder moves onto the reminder engine merged from main (`docs/guides/notifications.md` §7.1, "a module never writes its own clock"): `attendance_policy_unacknowledged` finds who is due and fires in the working day, in place of the `attendance-policy-reminder` scheduler, which is gone. Who is reminded, and once, is unchanged. §3 step 12, §6.15 and §7 updated.
- 20/10/2026 · TB · Every address on these screens is picked, never typed (F27, `docs/guides/addresses.md`): a home's, a work location request's and each field site's address is a `PlaceInput` the service keeps through `shared/places` (owners `attendance_home.address`, `attendance_location_request.address`, `attendance_field_site.address`), writing its line, details first, into its own column, so lists, masks and search read as before; the places-name job rewrites a line through `renameAddress`. A worksite's centre with no address is named from `GET /maps/pin`, which replaces `/maps/reverse`. The fences still come from the readings and the typed centres. §4, §5 and §6.9 to §6.11 updated.
- 20/10/2026 · TB · Rewritten to TB's decisions of 20/10/2026 (§1.1) and the audit of the same day, delivered in four PRs (§1.2): the Attendance policy moves to Knowledge Hub · Policies as a rules policy (§6.1, §6.15; Settings · Attendance Policy and its routes retired, Policy Updates moved to `policies.md`); lateness from the start, consequence rules raising alerts and queries, pending deductions and overtime (§6.4, §6.16, §6.17); work schedules for anyone on the Work Schedule tab (§6.13); reminders and the system clock-out 90 minutes after the end (§6.14); the reading judged with its accuracy, Location Unclear, Refuse opening an exception, a rejected punch freeing its slot (§6.2, §6.5, §6.7, §6.8); temporary sites from Home with People's approval and check-ins at each stop, replacing work location requests and field assignments (§6.11, §6.12); a 150 m minimum fence for homes and temporary sites.

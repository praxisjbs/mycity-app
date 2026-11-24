# Group e verdicts (written as each finding is finished)

ID: F14a
Title: Attendance adoption and when to switch sanctions on
Verdict: CLIENT_ACTION
Severity: High
Module: Attendance
Evidence: Every consequence rule (late arrivals, absence, early departure, forgotten clock-outs, location flags) starts Off and is switched on by People in the Attendance policy (docs/guides/attendance.md §1.1 T3 to T5, §6.16). Whether remote staff must clock in is the policy's and each person's work schedule (T7, T8, §6.13). The sparse register (absences, 17% on time) is staff not clocking in on staging, not a calculation fault: lateness and absence are tested in tests/integration/attendance.test.js ("lateness is read on the workplace's clock", "the day-close ... absences are counted").
Scope ref: MILESTONES §6 (M1); attendance.md §1.1 T3 to T8, §6.16
Fix: None in code. MyCity decide who must clock in, run the adoption push, and publish a version of the Attendance policy that switches the consequence rules on only after it.
Effort: S
For MyCity: The attendance figures are correct for what staff have actually punched; most staff are simply not clocking in yet. MyCity decide who must clock in and switch lateness and absence rules on in Knowledge Hub · Policies · Attendance once adoption is steady.

ID: F14b
Title: Devices marked New need no approval from anyone
Verdict: BY_DESIGN
Severity: Low
Module: Attendance
Evidence: docs/guides/attendance.md §6.6: a device first seen on a punch is recorded as observed ("New", app/src/features/attendance/Devices.tsx:16); "Registering needs a fresh sign-in; nobody at People approves it." The person registers their own device (up to three) from the clock panel's Register Device or ESS · My Devices. An unregistered device opens an exception only because staging's policy sets the device check to Flag.
Scope ref: attendance.md §6.6 (12 and 13 October meetings; Cynthia agreed unknown devices are flagged)
Fix: None. Staff press Register Device on their own phone or laptop.
Effort: S
For MyCity: Nobody at MyCity needs to approve devices: each person registers their own from the clock panel or ESS · My Devices. Ask staff to do this once; the "Unregistered device" exceptions then stop.

ID: F66a
Title: One exception per punch from an unregistered device
Verdict: IMPROVEMENT
Severity: Medium
Module: Attendance
Evidence: Reproduced with a throwaway integration test (device check Flag, Home Location off): a remote person's clock-in and clock-out from one unregistered device on Monday 05/10/2026 each went to review with reason unknown_device and opened two unknown_device exceptions, one per event. This is the documented model: attendance_exception is "One per event and type" (docs/guides/attendance.md §4 line 212, §6.6).
Scope ref: attendance.md §4 (attendance_exception), §6.6
Fix: Open one unknown_device exception per person, device and work date, and attach later punches from that device that day to it (attendance.service punch path and a partial unique index in a new M1-block migration); deciding it decides the day's punches from that device.
Effort: M
For MyCity: Confirmed: each punch from an unregistered device raises its own exception, as built. We will group them to one per device per day so People's queue is not doubled.

ID: F66b
Title: Clock-in after the shift's end is accepted and marked late
Verdict: BY_DESIGN
Severity: Low
Module: Attendance
Evidence: Reproduced: an on-site person clocking in at 17:22 Lagos on Tuesday 06/10/2026 (shift 09:00 to 17:00) is accepted (review only for the unregistered device) and the day reads Late with 502 minutes (8h 22m). attendance.md §11 (line 1546) and §6.14 "An evening start" decide that a clock-in after the end is accepted, with no worked minutes past the end, and T2 counts lateness from the start.
Scope ref: attendance.md §1.1 T2, §6.14 (An evening start), §11
Fix: None. If MyCity want such a clock-in refused or flagged, it is a new policy rule to agree first.
Effort: S
For MyCity: This is how the clock was agreed to work: a late arrival is recorded, never refused, and counted late from 09:00. Tell us if you want a rule that flags clock-ins after the shift has ended.

ID: F66c
Title: Remote clock-ins read Not Checked while Home Location is off
Verdict: CLIENT_ACTION
Severity: Low
Module: Attendance
Evidence: Reproduced: with the policy's Home Location off (it ships off, attendance.md §1.3 H2), a remote punch's evidence is geofence verdict not_applied, reason home_location_off, accepted (shown as Not Checked); the device and time checks still run (H5). So the auditor's "geofence still applies to remote staff" does not hold; only the device check does.
Scope ref: attendance.md §1.3 H1 to H10 (TB, 22/10/2026, after Edidiong asked for the switch)
Fix: None in code. MyCity decide whether to switch Home Location on (and whether to keep the device check on Flag) by publishing a version of the Attendance policy.
Effort: S
For MyCity: Remote locations are not checked because Home Location is switched off, as MyCity asked at the Milestone 1 handover. Switch it on in Knowledge Hub · Policies · Attendance if remote staff should clock in from an approved home.

ID: F42
Title: Day sheet does not say a System Clock-Out counts to shift end
Verdict: IMPROVEMENT
Severity: Low
Module: Attendance
Evidence: Worked minutes count only to the shift's end after a System Clock-Out (attendance.md §1.1 T13, §6.4), so 09:24 to an 18:30 System Clock-Out is 7h 36m, as the auditor saw. The explanation exists only as help on the Hours Worked KPI ("A System Clock-Out counts to the shift's end.", app/src/features/attendance/EssAttendance.tsx:145); the day's sheet shows Hours 7h 36m beside a System Clock-Out pill with no help (EssAttendance.tsx:225, 248).
Scope ref: attendance.md T13, §6.4, §10.1
Fix: Add a help term on the day sheet's Hours row (and the table's Hours) when clock_out_automatic is true: "Counted to the shift's end. Give your real time if you left later." in EssAttendance.tsx; update the ESS chapter.
Effort: S
For MyCity: The hours are correct: an automatic clock-out counts only to the end of the shift, and the person can press Give Real Time. We will add that explanation on the day itself.

ID: F67
Title: Staff cannot back-date sick leave; HR records it
Verdict: BY_DESIGN
Severity: Low
Module: Self-Service / Leave
Evidence: Reproduced: an employee's POST /ess/leave for Sick 10/11/2026 to 11/11/2026 is refused 422 LEAVE_IN_THE_PAST; People's Record Leave (POST /leave/requests) for the same days succeeds, 201, approved at once, 2 days, recorded true. docs/guides/ess.md §6 (line 222): a request "starts in the past (the employee's own)" is refused; the First Day's min is today only on My Leave (app/src/features/people/Leave.tsx:479, no min for Record Leave). The User Guide covers Record Leave (docs/manual/people.md §Record leave for someone).
Scope ref: ess.md §6 (TB, 21/10/2026); MILESTONES §6 (M1)
Fix: None required. Optional: a help term on My Leave's First Day saying past sick days are recorded by People.
Effort: S
For MyCity: By design, staff request leave from today on, and HR records sick days after the fact in People · Leave · Record Leave, which accepts past dates (we tested it). Train HR to use it on the person's return.

ID: F60a
Title: Leave form shows working days and balance only after Send
Verdict: IMPROVEMENT
Severity: Low
Module: Self-Service / Leave
Evidence: ess.md §10 (line 434) specifies the allowance mark "32 working days, 19 left" after Send. Since 264eaee (17/11) the form already calls GET /ess/leave/check once type and both days are picked (app/src/features/people/Leave.tsx:411), and that route returns the working days (reproduced: 01/12/2026 to 05/12/2026 returns days 5), but the form uses it only to drop the Optional tags and never shows the count.
Scope ref: ess.md §5 (GET /leave/check), §10
Fix: Show the working days and what would be left ("5 working days, 15 left") under Last Day from the check route's days and the type's remaining balance, in LeaveForm (app/src/features/people/Leave.tsx); mark the Last Day before Send when it exceeds the balance. Update ess.md §10 and the ESS chapter.
Effort: S
For MyCity: The server's check is right; the form just waits for Send to show it. We will show the day count and remaining balance as soon as the dates are picked.

ID: F60b
Title: A Saturday counts as one full leave day
Verdict: BY_DESIGN
Severity: Low
Module: Self-Service / Leave
Evidence: Reproduced: GET /ess/leave/check for Tuesday 01/12/2026 to Saturday 05/12/2026 returns 5 days, and Saturday 05/12/2026 alone returns 1. ess.md §6 (line 220): "A request is counted in working days: the configured week (Monday to Saturday, A22)". A22 sets Saturday's hours (09:00 to 15:00) but says nothing about counting Saturday as half a leave day; no decision records a half day.
Scope ref: MILESTONES A22; ess.md §6
Fix: None unless MyCity's leave policy says otherwise; a half-day Saturday would be a change to leave.balance.js daysOf and the amount column's precision (M).
Effort: S
For MyCity: Leave is counted in working days and Saturday is a working day, so it counts as one day. If MyCity's policy counts Saturday as half a day of leave, confirm it in writing and we will raise the change.

ID: F15a
Title: One acknowledge sheet per owed policy, one after another
Verdict: BY_DESIGN
Severity: Low
Module: Policies
Evidence: docs/guides/policies.md P3 (line 40) and §3 step (line 84): after the clock, "the shell opens the acknowledge sheet for each version they owe, oldest due first"; §10 (line 354) one policy at a time. app/src/features/policies/AcknowledgeSheet.tsx opens them in turn (dismissible: false; Later, Read Full Policy, Acknowledge). Later before the due date holds a version until tomorrow on the server (src/modules/policies/policies.service.js:920 skips a version put off today).
Scope ref: policies.md P3, §6.7
Fix: None as decided. A combined "2 policies need you" prompt would reverse P3 and needs MyCity's agreement.
Effort: S
For MyCity: Showing each policy that needs acknowledging, one at a time, is what was agreed. Pressing Later holds it until the next day; acknowledging it ends it.

ID: F15b
Title: Overdue policy sheet returns on every page reload, not every sign-in
Verdict: BUG
Severity: Low
Module: Policies
Evidence: Code reading (a remount test would only restate it): policies.md §6.7 (line 248) says that after the due date "the sheet returns at every sign-in". The app remembers what it showed only in memory (AcknowledgeSheet.tsx: shown = useRef(new Set())), and GET /policies/me/due returns every overdue version on every call (policies.service.js:918 to 920, can_later false). So each full page load (a refresh, a typed address, a link) opens every overdue version again; a version left with Read Full Policy (which closes without deferring) also comes back on the next load before its due date.
Scope ref: policies.md P3, §6.7
Fix: Key the shown set to the session (sessionStorage under the session id, wrapped in try/catch) so a version shows once per sign-in as the guide says; optionally treat Read Full Policy as Later for that day. AcknowledgeSheet.tsx and its test.
Effort: S
For MyCity: Confirmed in part: a policy past its due date comes back on every page refresh rather than once per sign-in. We will make it appear once per sign-in, as agreed.

ID: F16a
Title: Menu and tab counts do not say they are unread notices
Verdict: IMPROVEMENT
Severity: Low
Module: Navigation / Notifications
Evidence: Every rail, bottom-bar, More tile and tab count is the reader's unread notifications that open there (docs/guides/notifications.md §3 step 7 "Where it waits", JBS Praxis 26/10/2026; app/src/shell/nav.ts:6, 21 to 58; GET /notifications/badges). The count is a bare number: packages/ui/src/shell/Rail.tsx:154 to 164 renders it with no tooltip or screen-reader words, likewise BottomBar and MoreSheet.
Scope ref: notifications.md §3 step 7, §10 (line 49)
Fix: Give each count a Tooltip and sr-only text ("21 unread notices") in Rail, BottomBar, MoreSheet and Tabs (packages/ui), with their tests and gallery pages; on a phone the words go in the accessible name only.
Effort: S
For MyCity: The numbers on the menu are unread notifications waiting in that area, not tasks or totals. We will label them so hovering or a screen reader says so.

ID: F16b
Title: More's count adds up every module behind it
Verdict: BY_DESIGN
Severity: Low
Module: Navigation
Evidence: notifications.md §10.2 (line 448): "The bottom bar's More counts every module behind it"; app/src/shell/nav.ts:36 sums the modules behind More. On staging the sum is large because many notices are unread.
Scope ref: notifications.md §10.2; FRONTEND_FOUNDATION F16, F17
Fix: None (the F16a label will say "79 unread notices").
Effort: S
For MyCity: More shows how many unread notifications wait in the modules it holds, as designed. Reading or clearing notifications brings it down.

ID: F18
Title: Fixed caption on Home attendance chart can contradict the data
Verdict: IMPROVEMENT
Severity: Low
Module: Home
Evidence: The caption is a fixed string (app/src/features/home/sections.tsx:53, "Dips are Saturdays, a half day"), written into home.md §10 (line 735) and pinned by app/src/features/home/Overview.test.tsx:187. It is shown whatever the 14 days hold, so when few staff clock in every day is low and the caption reads false.
Scope ref: home.md §10, §11 (Saturday reads lower by design)
Fix: Remove the caption (sections.tsx, the test, home.md §10, the Home chapter's picture), or show it only when the Saturdays in view are the low points.
Effort: S
For MyCity: Confirmed: the caption is fixed text, so it can disagree with what the chart shows. We will remove it or show it only when the data bears it out.

ID: F19a
Title: Alert Age is how long the alert is open, not the wait
Verdict: BY_DESIGN
Severity: Low
Module: Home / Alerts
Evidence: An approval-ageing alert is raised on the day the request reaches the rule's threshold (src/modules/alerts/alerts.metrics.js:103 to 135), so "waiting 10 days" with Age Today and Over By +0 means it reached the 10-day rule today. Age is time since raised (sorted on raised_at, app/src/features/home/Alerts.test.tsx:198) and the Over By help says "+0 over 3 means it reached 3" (home.md §10, line 738).
Scope ref: home.md §6 Alerts (count metric, Over By), §10
Fix: None. Optional: rename the Age column "Open For".
Effort: S
For MyCity: The figures agree: the request had waited 10 days, which is when the alert was raised, so the alert itself is new (Today) and exactly at its limit (+0).

ID: F19b
Title: Two Temporary Site alerts are two separate requests
Verdict: NOT_REPRODUCED
Severity: Low
Module: Home / Alerts
Evidence: Approval ageing raises one alert per pending workflow instance (alerts.metrics.js:117 to 120, keyed on workflow_instance_id), and "one open alert per rule and subject: the next sweep refreshes, it never doubles" passes in tests/integration/home-alerts.test.js (39 of 39 passed on mycity_audite_test). Different ages (25 and 26 days) mean two requests that entered their stage on different days, so two Temporary Site submissions for the same person are waiting.
Scope ref: home.md §6 Alerts ("The same breach is raised once")
Fix: None for duplicates (see F19c for naming the record).
Effort: S
For MyCity: These are two different temporary site requests still waiting for approval, not one alert shown twice. Approving or rejecting them clears both.

ID: F19c
Title: Approval alert title omits what the request is
Verdict: IMPROVEMENT
Severity: Low
Module: Home / Alerts
Evidence: The title is "<approval flow name> for <person>: waiting N days" (alerts.metrics.js:129); a request with no person it is about reads just "Requisition: waiting 10 days", and two requests for one person read the same. The record's own number or title is not included.
Scope ref: home.md §6 Alerts (metric registry: "the alert is about the record waiting")
Fix: Add the record's label (its number or title, through the route map's or the owning module's label for entity_type and entity_id) to the title and trigger in approvalAgeing; refresh on the next sweep.
Effort: S
For MyCity: We will name the record in each waiting-approval alert (for example its number), so two alerts for one person can be told apart.

ID: F19d
Title: Alert Sources counts include alerts already cleared
Verdict: BY_DESIGN
Severity: Low
Module: Home / Alerts
Evidence: home.md §6 Alerts, The counts (lines 509 to 510): "Alert Sources, 30 Days (raised in the last 30 days by metric, cleared ones included)". Budget Threshold 1 is an alert raised and since cleared, so it is not in Open Alerts.
Scope ref: home.md §6 Alerts, §10
Fix: None.
Effort: S
For MyCity: Alert Sources shows everything raised in the last 30 days, including alerts already cleared, so it can list a source with no open alert.

ID: F20a
Title: Scheduled report runs are recorded but shown to recipients only
Verdict: NOT_REPRODUCED
Severity: Low
Module: Home / Reports
Evidence: The scheduled-reports scheduler is started with the worker (src/jobs/registry.js:199; the schedulers gate checks it). tests/integration/home-reports.test.js passed 59 of 59, including "the job makes one run per recipient and format for the slot" and "the files the reader received and every file of the reports they own". Recent Runs and Runs This Month cover only runs the reader received or owns (home.md §6 Reports). Staging's Daily Attendance is owned by and sent to the Operations lead only (seeds/staging/60_home.js:66 to 72), so a Management login sees it Scheduled with No Runs Yet. Staging's worker itself was not inspected from here.
Scope ref: home.md §6 Reports (Runs This Month, who opens a file)
Fix: None. Optional: show a shared report's last run time to everyone who sees it.
Effort: S
For MyCity: The report does run; its files go only to the people it is sent to, so other readers see no runs. Add yourself as a recipient to receive it.

ID: F20b
Title: Recipients card counts running schedules only
Verdict: BY_DESIGN
Severity: Low
Module: Home / Reports
Evidence: Recipients counts distinct recipients of active schedules (src/modules/reports/reports.repo.js:174 to 191, "WHERE a.active IS TRUE"), as home.md §6 Reports says ("people who receive at least one scheduled report"). On staging the running Daily Attendance goes to the Operations lead, and the second person (the CEO) is only on the paused Weekly Headcount (seeds/staging/60_home.js:74 to 80), who receives nothing while it is paused. So 1 is right.
Scope ref: home.md §6 Reports
Fix: None. Optional help term on the card: "People receiving a running schedule."
Effort: S
For MyCity: The card counts people who actually receive a report now; the second person is on a paused schedule, so they receive nothing until it is resumed.

ID: F17
Title: QA and test records typed on staging, not seeded
Verdict: CLIENT_ACTION
Severity: Low
Module: Home / platform data
Evidence: None of 'another test', 'Testing', 'test run', 'Set new', 'QADeep...', 'Qa Preview', 'JBS test' or '#qa-e2e' appears in seeds/ (grep of seeds/staging and seeds/staff; the 28 rows of seeds/staff/staff-list.xlsx hold no QA or test name) or in any test that writes to staging. They were typed on staging by testers on both sides ("JBS test" is likely ours). Production is never seeded with demo data (A5) and starts from seeds/reference and seeds/staff only. Organisational goals can already be removed: Delete Goal (performance.md §10 and line 694, refused only while a company objective uses the goal).
Scope ref: MILESTONES A5, A26; CLAUDE.md (Production is never seeded)
Fix: None in code. Whoever created them deletes them on staging if they get in the way (Delete Goal, and so on); nothing carries to production.
Effort: S
For MyCity: These records were typed into staging during testing and are not in our seed files. Production starts clean, so they will not appear at go-live; delete them on staging if they get in the way.

ID: F12a
Title: Headcount figures differ by definition and are not labelled
Verdict: IMPROVEMENT
Severity: Low
Module: Home / People (platform)
Evidence: Each number is a deliberate, documented definition: Home's "of 22" is today's expected (people with an active login on a working day of their schedule, not on leave; home.md §6 Team line 419, attendance.md §6.4); the Team roster and Employees (24) are today's active staff on the register, someone with no login reading Day Off; Attendance This Month (25) is everyone on the register on any day this month, including someone who left (home.md line 436 to 440); Users (23) counts logins. Scorecards: the Scorecards tile (19) counts all statuses, Agreed plus Awaiting Agreement (17) leaves out Draft and Closed (app/src/features/performance/Scorecards.tsx:137 to 168; ScorecardStatus draft, binding, agreed, closed). The auditor's own check found new records move each count by one.
Scope ref: home.md §6 Team, §10; performance.md §10
Fix: Name the denominator and add help terms: "of 22 expected today" on Clocked In Today, help on Attendance This Month ("everyone on the register this month, leavers included"), and a Draft tile or "of 19" on Scorecards. Home and Performance screens and chapters.
Effort: S
For MyCity: The headcounts differ because each answers a different question (expected today, on the staff list, on the register this month, with a login). We will label each one so the difference is clear.

ID: F12b
Title: Badge counts are unread notices, not totals
Verdict: BY_DESIGN
Severity: Low
Module: Notifications (platform)
Evidence: People 53, the Alerts tab's 21, Policy Updates' To Acknowledge 4 and the Scorecards tab's 15 are unread-notice counts (notifications.md §3 step 7; line 259 "The numbers are unread notices"; app/src/features/notifications/marks.tsx withNews). They differ from the lists by design: an alert closed since its notice was sent still has an unread notice, and each owed policy version carries two notices (the publication and the 3-day reminder, src/modules/policies/policies.events.js:112 to 128), so 2 policies give 4.
Scope ref: notifications.md §3 step 7 (JBS Praxis, 26/10/2026)
Fix: None beyond F16a's label. Optional: count distinct records rather than notices on a tab.
Effort: S
For MyCity: The small numbers on tabs and menus count unread notifications, not records, so they can be higher than the list. We will label them (see F16a).

ID: F12c
Title: Tasks Done column header and its cards agree
Verdict: NOT_REPRODUCED
Severity: Low
Module: Workspace
Evidence: Code reading: a column's total and its cards come from the same server response (app/src/features/workspace/TaskBoard.tsx:85 to 89, count = page.total, cards = rows; Load More when more). On desktop the header shows two numbers: a yellow badge of unread notices beside the label and the total at the right (packages/ui/src/data/Kanban.tsx:333 to 335). "Done 2" with 3 cards matches 2 unread notices and a total of 3.
Scope ref: workspace.md §10.1; notifications.md §3 step 7
Fix: None (F16a's label applies to the column badge too).
Effort: S
For MyCity: The 2 beside Done is the number of unread notifications about those tasks; the column's total (3) is shown at the right of the header.


ID: F34a
Title: History shows each person the tokens and cost of their own questions
Verdict: BY_DESIGN
Severity: Low
Module: Praxis AI
Evidence: app/src/features/assistant/index.tsx:296 to 302 (Your Spend card) and :327 to 328 (Tokens, desktop only, and Cost columns). This is the specified screen: docs/guides/praxis-ai.md §10.1 line 2014 lists "Question, Asked, Sources Read, Tokens, Cost" and Your Spend; §5 line 475 (`GET /history/questions`, "each with its sources, tokens and cost"). Decision 7 (line 61, amended 22/10/2026) keeps History to the person's own figures; everyone's spend is only on AI Control · Spend and, as counts and naira, for AI Control holders. On a phone Tokens is already hidden (§10.2 line 2023).
Scope ref: praxis-ai.md §1.1 decision 7, §5, §10.1 (GE, 22/10/2026)
Fix: None required. If MyCity prefer staff not to see cost, hide the Tokens and Cost columns and Your Spend for people without AI Control view in index.tsx and the guide's §10 (a decision change, cheap).
Effort: S
For MyCity: Staff see only what their own questions cost, as agreed when History was built; nobody sees anyone else's questions. If you would rather staff saw no cost at all, tell us and we will show it to AI Control holders only.

ID: F34b
Title: A simple how-to question reads the whole context every round
Verdict: IMPROVEMENT
Severity: Low
Module: Praxis AI
Evidence: Code reading (a live model run is not possible here). Every question sends one system turn carrying the person's screens, routes and one tool per read and summary they may run (src/services/ai/assistant/orchestrator.js:11 to 22, 172 to 200, 351), resent on each round of the loop (up to 8). A how-to question takes at least two rounds (the `guide.search` read, then the answer; praxis-ai.md line 757 to 760), so about 23,600 tokens (two rounds of about 11,800) and ₦24 is consistent with the design. The prefix is built to be cached (decision 24, line 112), but only the Anthropic adapter sets a cache mark (src/services/ai/vendors/anthropic.js:143), so the discount depends on which model AI Control assigns to Data Answers.
Scope ref: praxis-ai.md §1.1 decisions 24 and 25, §6.1, §6.9 (guide.search)
Fix: Measure tokens per round on staging, then trim the tools offered on the first round (for example route how-to questions to `guide.search` and the route list before the full read catalogue) in orchestrator.js; confirm the cache discount reaches the ledger for the vendor in use.
Effort: M
For MyCity: The figure is what the current design costs: each question carries everything the person is allowed to ask about. We will look at trimming it for simple how-to questions.

ID: F36
Title: Urgent announcements show a red bar on every screen until acknowledged
Verdict: BY_DESIGN
Severity: Low
Module: Platform / Community
Evidence: The row is the urgent bar ("1 of 3" means three urgent notices are open for this person), not a general announcement banner. packages/ui/src/feedback/UrgentBar.tsx:62 to 90: one line, the title truncated, the count, and Acknowledge; app/src/features/notifications/UrgentNotices.tsx:11 to 45 closes a notice only on Acknowledge. Its tests pass (`npx vitest run src/feedback/UrgentBar.test.tsx` in packages/ui: 4 passed). Decided: docs/guides/community.md §3 step 2 lines 66 to 72 (Urgent "puts the urgent bar on every screen of everyone in the audience ... until each person presses Acknowledge", TB, 19/10/2026) and docs/guides/notifications.md line 45 and §10.2 line 447 (on a phone "the title on one line and the count", tap the title to open it). "System Testing Queries" is not in our seeds (no match in seeds/ or src/), so it was posted as Urgent on staging by a MyCity user.
Scope ref: community.md §3 step 2 Levels (TB, 19/10/2026); notifications.md §6, §10
Fix: None. The bar goes as soon as the person presses Acknowledge on it or on the card in #announcements; posters should use Normal or Important for anything that is not an emergency.
Effort: S
For MyCity: The red bar is how an Urgent announcement was agreed to work: it stays on every screen until each person acknowledges it. Press Acknowledge on the bar to clear it, and post routine news as Normal or Important so it does not take the bar.

ID: F41
Title: Record History shows raw event keys for events it has no words for
Verdict: BUG
Severity: Low
Module: Self-Service / People
Evidence: Reproduced with a one-off node call: `summaryOf({action: "commitments.due"})` from src/modules/organisation/employee-360.service.js returns "commitments.due" (and "Record changed" for employee.updated). summaryOf (lines 106 to 120) words only six actions and otherwise prints the key with only an "employee." prefix stripped. The monthly commitments reminder is emitted on the employee record (src/modules/targets/targets.commitments.js:545, `entity: { type: "employee" }`), so its audit row lands in the person's history (organisation.repo.js:437 to 448, every audit row on the employee). About a dozen other modules emit on the employee entity too (leave, documents, payslips, reviews, attendance, workspace), so their keys can show the same way. People's History tab on the employee uses the same function. Every event already has a plain summary in its module's events file (targets.events.js:43, "A person has not sent their commitments for the month").
Scope ref: ess.md §5 line 147 and §10.1 line 427 (Record History); FRONTEND_GUIDE §5 (no internal words on screen)
Fix: In summaryOf, fall back to the event catalogue's own summary for the key (or a short label map) instead of the raw key, and decide whether reminders such as commitments.due belong in Record History at all (filter them in historyOf). Add a unit test over every key emitted on the employee entity.
Effort: S
For MyCity: Confirmed: some entries in Record History show a system name instead of words. We will word every entry and leave reminders out of the record's history.

ID: F48a
Title: New Lead in the header and in the floating button's fan
Verdict: BY_DESIGN
Severity: Low
Module: Platform (phone shell) / Partnerships
Evidence: app/src/features/partnerships/Pipeline.tsx:34 gives the screen's New Lead to the floating button (`useScreenAction`) and :40 keeps New Lead in the page header. Both are specified: F18 (docs/FRONTEND_FOUNDATION.md line 75) makes the floating button a fan of the screen's New action, Clock In or Out, Praxis AI and Help on every phone screen, and docs/guides/partnerships.md §10.2 line 1275 puts "New Lead, full width" on the phone's Pipeline; line 1456 (TB, 06/11/2026) records that the header buttons stay beside the fan's action. The "+" is not a second New Lead button: it opens the fan, with Hide Here.
Scope ref: FRONTEND_FOUNDATION F18; partnerships.md §10.2, §13 (TB, 06/11/2026)
Fix: None.
Effort: S
For MyCity: This is intended: the round button opens a short menu (the page's New action, Clock In, Praxis AI and Help) that is the same on every phone screen, and the page keeps its own New Lead button. It can be hidden on a page with Hide Here.

ID: F48b
Title: Small tap targets on Goals and Employees on a phone
Verdict: NOT_REPRODUCED
Severity: Low
Module: Platform (phone shell) / Performance / People
Evidence: Built the staff app's demo (vite build --mode demo into a scratch folder) and measured every control at 375 px with Chromium on Performance · Goals, People · Employees and Partnerships · Pipeline. Under 32 px on Goals: 2 help terms and 8 record codes (ORG-2026-01, BM-KR1.1) 20 px tall; on Employees: 2 help terms; on Pipeline: 2 help terms. The record codes are each card's open button with `stretch-link` (packages/ui/src/data/DataView.tsx:284; packages/ui/src/styles/base.css:132 to 137, an ::after covering the whole card), so their real tap area is the full card; a script counting element boxes reports them as tiny. Help terms are the one written exception to 44 px (docs/FRONTEND_GUIDE.md line 366). Every other control was 44 px or more (`phone:size-control`, tokens.css line 278). Staging's larger data gives more cards, hence the auditor's higher counts.
Scope ref: FRONTEND_FOUNDATION F5 (44 px on a phone); FRONTEND_GUIDE §7 line 366; gate 11 (scripts/check/two-shells.js)
Fix: None.
Effort: S
For MyCity: We measured these screens at phone width: the small items are the card titles, and the whole card responds to a tap, and the small "?" help words, which are the agreed exception. Nothing needs changing.

ID: F50
Title: First search after the server starts is slower than later ones
Verdict: IMPROVEMENT
Severity: Low
Module: Platform (⌘K search)
Evidence: Throwaway integration test (since deleted) on the real migrations, as a Management login, GET /api/v1/search five times in one fresh process: "Kora" 944 ms, "invoice" 281 ms, "Kora" again 199 ms, "leave" 268 ms, "Ada" 231 ms. So the first search in a process pays a one-off cost and later ones, including the same term, are fast. Part of it is the User Guide group: the manual's 18 chapters are parsed and word-indexed on first use (src/modules/user_guide/user_guide.chapters.js:30 to 51, user_guide.service.js:173 to 180; about 0.45 s measured with node), not at boot (src/server.js:70 to 71 loads only the registries). Staging's smaller machine and real data plausibly push that past 2 s. One-word terms like "Kora" never wait on the model (user_guide.search.js:38 to 40). No milestone sets a search latency target.
Scope ref: foundation.md §6.7 (⌘K); MILESTONES §15 (⌘K finds every page, tab and record)
Fix: Warm the search at boot in src/server.js: load and index the User Guide chapters, and open the pool and pg_trgm check, before the server takes traffic. Then measure p95 on staging from the request log.
Effort: S
For MyCity: Confirmed in part: the first search after the system restarts takes longer while it prepares; later searches answer in about a quarter of a second. We will do that preparation at start-up so the first person does not wait.

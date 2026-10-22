# My Workspace · Engineering Guide

| | |
|---|---|
| Owner | AJ |
| Milestone | M2 |
| Backend modules | `workspace`, `tasks`, `calendar` |
| Frontend paths | `app/src/features/workspace/` |
| Permission key(s) | `workspace` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #4 Today, #5 Tasks, #6 Calendar, #7 Analytics |
| Status | Draft |
| Last changed | 22/10/2026 |

Sources: MILESTONES §7 (A24) and §7 Definition of done; REUSE_MAP §3.1; the meeting of
10 October 2026 (Cynthia Osakunih, Tom-Blake Asaah: "task and activity tracking is a primary
reason for needing the ERP"; tasks stay in the workspace, performance is its own module). The
Performance Management System (goals, scorecards, KPIs, reviews) is TB's, built from MyCity's own
sheets (`docs/guides/performance.md`); this guide covers what it brings into the workspace (its PR 4):
commitments on tasks, Counts Towards a scorecard line or a key result, the week on Today and
performance dates on the calendar. The demo (`demo.html`, My Workspace) is a visual reference; where it
differs, this guide wins.

---

## 1 · What it is for

My Workspace is where MyCity's staff see and move their own work, and where a line manager sets the
week and the day for the people who report to them (A24). Every employee uses it for their own
tasks; line managers and heads of department also use it to set and follow their reporting line's
work; the CEO and Management read Analytics across the organisation. Each month's priority tasks are
marked as commitments and approved as a set (performance.md §6.11), and each week is read off the
board itself (My Week), so MyCity's weekly tracker retires.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| My Workspace · Today (`today`) | staff app | every employee, own scope; managers also their team's weeks | the day's tasks (own and set by the manager, overdue first), Due Today, Overdue, In Review, Done This Week, the day's diary (calendar events), Since You Were Away (the task activity on their tasks since their last visit); My Week (done this week, planned next week, blocked) with Support Needed; Team This Week for a manager | open a task and move it on; Add Task; Write Support Needed, Tidy With AI; open a person's week |
| My Workspace · Tasks (`tasks`) | staff app | every employee; a manager switches to My Team | the board: To Do, In Progress, In Review, Done; four KPI cards (Open, Due This Week, Overdue, Done This Week); search; Cancelled behind a filter; a Commitment pill on a commitment's card | New Task (for themselves, or for someone in their reporting line); mark it a commitment with acceptance criteria and its month; Send Commitments; drag a card between columns and within one; open a task: edit, comment, pick the scorecard line or key result it counts towards, mark blocked, cancel, Rescope Commitment, Set Recovery on a missed commitment, decide a rescope named to them |
| My Workspace · Calendar (`calendar`) | staff app | every employee | the month: their own events, events they are invited to, events shared with everyone, their tasks' deadlines, their approved leave, their performance dates (check-in due, reviews to write, key results finishing, PIP reviews); Coming Up | New Event (with attendees); answer an invitation; open a task from its deadline; open a performance date's record |
| My Workspace · Analytics (`analytics`) | staff app | every employee for themselves; managers for their reporting line; CEO and `all` scope for everyone | completion rate, overdue, average completion time, tasks completed per week, workload by person, tasks by priority | switch Mine and My Team; choose the period (30 days, 90 days, this year); open a figure's tasks |
| Home · Overview, Team (M1, TB) | staff app | as Home | Overdue Tasks and My Overdue Tasks cards, Your Week, Open Tasks on the roster | read only, through `dashboard/sources/tasks.source.js` and `calendar.source.js` |
| ESS · My Performance (M2) | staff app | the employee | My Commitments: this month's commitments and their states; a line measured in tasks counts its done tasks | Send Commitments (performance.md §10) |
| Performance · Scorecards (M2), Commitments view | staff app | `performance` view · scope | the month's commitments, which are tasks; Waiting On You | Approve Month, Request Changes; a row opens its task here and Back returns (performance.md §10) |
| Notifications bell (M0) | both shells | the assignee, the setter; a commitment's person and approver | task set for you, task due tomorrow, task blocked, comment on your task; commitments waiting, approved or returned; a rescope's outcome; send your commitments | open the task (`linkFor("task", id)`) or the Commitments view |
| ⌘K search | both shells | per scope | tasks by number and title (commitments are tasks); calendar events by title; New Task, New Event, New Commitment | open the task or event; the form |

## 3 · How the screens relate

1. **A manager sets the week.** Ifeoma (line manager) opens Tasks, New Task, picks Assign To
   (anyone in her `workspace` scope), Cadence Weekly or Daily, a due date and, optionally, the KPI it
   counts towards. `POST /api/v1/tasks` writes `task` with `set_by_employee_id` = Ifeoma,
   `primary_assignee_id` = the employee, emits `task.created`; the outbox notifies the assignee.
2. **The employee adds their own.** The same form without Assign To writes a task with
   `set_by_employee_id` = the employee. Both kinds show on one board and on Today; Set By on the card
   says who set it (A24).
3. **Work moves.** Dragging a card to another column (or Move To, on a phone and by keyboard) calls
   `POST /api/v1/tasks/:id/move` with the new status; the API also takes the card it now sits above
   (`before_task_id`), which the board will use once `Kanban` reorders within a column. The service
   sets `status`, `sort_order`, `started_at`/`completed_at`, and emits `task.status_changed`
   (`task.completed` into Done, `task.reopened` out of it). Today, Analytics, Home and the setter's
   board read the change.
4. **Done counts.** The task form's Counts Towards picks one of the assignee's scorecard lines
   (`employee_target_id`) or a key result they own (`entity_type` `key_result`), from
   `GET /api/v1/tasks/counts-towards`. A line measured in tasks counts the Done tasks pointing at it
   in the month, worked out where it is read (performance.md §6.18), so `task.completed` and
   `task.reopened` only carry the line and the month.
5. **Commitments.** A task marked Commitment, with its acceptance criteria and month, is a draft until
   Send Commitments (on Tasks, or My Commitments on ESS) puts the month's commitments in the person's
   set and `performance.commitments` approves it; approval fixes each original date. A later due date
   moves the date now only. Rescope Commitment and Set Recovery act on one commitment from its panel
   (performance.md §6.11).
6. **The week.** Today's My Week is built from the board: tasks done Monday to Sunday, open tasks due
   next week, blocked tasks; the person writes one line, Support Needed (`PUT /api/v1/workspace/week`),
   and may press Tidy With AI for a short summary they keep or discard. A manager's Team This Week lists
   each person in their scope with the three counts and their line.
7. **A deadline is on the calendar.** `GET /api/v1/calendar` returns, for the month, the reader's
   events, plus each open task with a due date (kind Deadline), plus their approved leave (read
   through the leave service), plus their performance dates (kind `performance`). A task opened there
   is the same task panel.
8. **A blockage.** Mark Blocked asks for a reason; `task.blocked` notifies the setter and the
   project owner. Clearing it emits `task.unblocked`.
9. **A task points at a record.** A task created from a partner, a vacancy, a key result (an
   initiative), a review (a corrective action), a PIP or a missed commitment (a Recovery task) carries
   `entity_type` and `entity_id`; the panel's Open link is `linkFor(entity_type, entity_id)` worked
   out on every read, never stored (§6). A link from elsewhere (`/workspace?tab=tasks&id=…`, the
   Commitments view, the bell) opens the task's panel on Tasks.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `task` (2000, 2010, 2100, 2400) | `task_id`, `number`, `title`, `status`, `priority`, `primary_assignee_id`, `set_by_employee_id`, `created_by`, `cadence`, `due_at`, `started_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `employee_target_id`, `entity_type`, `entity_id`, `blocked_reason`, `blocked_at`, `sort_order`, `recurrence`, `archived_at`; a commitment's `is_commitment`, `acceptance_criteria`, `commitment_month`, `original_due_at`, `commitment_set_id`, `rescoped_at` (2100) and `rescope_reason` (2400) | `status` CHECK `todo`, `in_progress`, `in_review`, `done`, `cancelled`; `priority` CHECK `low`, `normal`, `high`, `urgent`; `cadence` CHECK `daily`, `weekly` or NULL (a task with no horizon). `number` is filled by numbering for every task saved through the service; rows written before 2010 have none. The next occurrence of a repeating task points back at it through `parent_task_id`. Read by Home (`task_id`, `title`, `status`, `priority`, `due_at`, `completed_at`, `archived_at`, `primary_assignee_id`) |
| `task_assignee` (2000) | `task_id`, `employee_id`, `assignment_role` | the people beside the primary assignee (`assignment_role` `collaborator` or `reviewer`); the primary assignee is always on `task` |
| `task_comment` (2000) | `task_id`, `author_user_id`, `body`, `deleted_at` | paged at 25, newest last |
| `task_activity` (2010) | `task_id`, `actor_user_id`, `kind`, `from_status`, `to_status`, `detail` | history the panel and Since You Were Away read; never updated (trigger), removed only with its task |
| `calendar_event` (2000, 2010) | `calendar_event_id`, `title`, `event_type`, `owner_employee_id`, `starts_at`, `ends_at`, `all_day`, `location`, `visibility`, `entity_type`, `entity_id`, `cancelled_at` | `event_type` CHECK `meeting`, `deadline`, `campaign`, `event`, `interview`; `visibility` CHECK `private`, `attendees`, `everyone`. `entity_type`/`entity_id` point at an interview (M4) or a partner meeting (M7) without a foreign key into a later milestone. Read by Home |
| `calendar_event_attendee` (2010) | `calendar_event_id`, `employee_id`, `response` | `response` CHECK `pending`, `accepted`, `declined`; UNIQUE (event, employee) |
| `project` (2000) | `project_id`, `number`, `name`, `owner_employee_id` | kept for grouping; no screen in M2 (§13) |
| `commitment_set` (2100, performance) | `commitment_set_id`, `employee_id`, `month`, `status`, `workflow_instance_id`, `submitted_at`, `approved_at` | one person's commitments for a month, approved as one; written by the targets service (performance.md §4) |
| `weekly_summary` (2100) | `weekly_summary_id`, `employee_id`, `week_starts_on`, `support_needed`, `summary_text`, `ai_run_id` | the week's one line and an accepted summary; UNIQUE (employee, week); written by the workspace service |

Schema migration file(s): `migrations/2010_workspace.sql`; Performance's `2100_performance_foundation.sql`
(the commitment columns, `commitment_set`, `weekly_summary`) and `2400_performance_commitments.sql`
(`entity_type` `task`, a Recovery task's pointer; `rescope_reason`). Reference-data file(s):
`seeds/reference/2090_seed_workspace.sql` (the `task` numbering scheme, the status, priority and
event type codes, `cancelled`).

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/workspace/today` | → `TodayView` | `workspace` view · own | no (each list is its first 25 with a total and a link to Tasks) | |
| `GET /api/v1/workspace/analytics` | `AnalyticsQuery` → `WorkspaceAnalytics` | `workspace` view · own, team or all | no (aggregates) | `scope` `mine` or `team`; `period` `30d`, `90d`, `year`. `team` answers for the reader's `scope_ids` |
| `GET /api/v1/tasks` | `TaskListQuery` → `TaskPage` | `workspace` view · own, team, all | yes, 25 | filters `status`, `scope` (`mine`, `team`), `assignee_id`, `cadence`, `priority`, `due` (`overdue`, `today`, `week`), `employee_target_id`, `is_commitment`, `commitment_month`, `q`; sort `sort_order` (default), `due_at`, `priority`, `created_at` |
| `GET /api/v1/tasks/counts-towards` | `CountsTowardsQuery` → `CountsTowardsPage` | `workspace` view · the assignee is the caller or in scope | yes, 25 | `assignee_id`, `month`, `q`: the assignee's scorecard lines and key results (performance.md §6.18) |
| `GET /api/v1/tasks/summary` | `TaskSummaryQuery` → `TaskSummary` | `workspace` view | no | the four KPI cards for `mine` or `team` |
| `GET /api/v1/tasks/:id` | → `TaskDetail` | `workspace` view · scope | | 404 outside scope; a commitment's state, pending rescope, recovery and what the reader may do to it |
| `POST /api/v1/tasks` | `TaskCreate` → `Task` | `workspace` create · scope | | `primary_assignee_id` must be the caller or in their `scope_ids`; `is_commitment` with `acceptance_criteria`, `commitment_month` and a `due_on` in that month |
| `PATCH /api/v1/tasks/:id` | `TaskEdit` → `Task` | `workspace` edit · scope | | the assignee may edit their own task's status, notes and commitment fields; title, due and assignee only the setter or someone with the setter's scope; an approved commitment keeps its mark, month and criteria (409 `COMMITMENT_APPROVED`) |
| `POST /api/v1/tasks/:id/move` | `TaskMove` → `Task` | `workspace` edit · scope | | `status` and `before_task_id` (null = end of column) |
| `POST /api/v1/tasks/:id/block` | `TaskBlock` → `Task` | `workspace` edit · scope | | `blocked_reason`; `EmptyBody` on `/unblock` |
| `POST /api/v1/tasks/:id/cancel` | `TaskCancel` → `Task` | `workspace` edit · scope | | `cancel_reason`; setter only; never an approved commitment (409 `COMMITMENT_APPROVED`: rescope it) |
| `GET /api/v1/tasks/:id/comments` | `CommentListQuery` → `TaskCommentPage` | `workspace` view · scope | yes, 25 | |
| `POST /api/v1/tasks/:id/comments` | `TaskCommentCreate` → `TaskComment` | `workspace` view · scope | | anyone who can see the task may comment |
| `GET /api/v1/tasks/:id/activity` | `ActivityListQuery` → `TaskActivityPage` | `workspace` view · scope | yes, 25 | |
| `GET /api/v1/calendar` | `CalendarListQuery` → `CalendarItemPage` | `workspace` view · own | yes, 25 | `month` (YYYY-MM) required; events, task deadlines, approved leave and performance dates (`item_kind` `performance`, named by `performance_kind`), by start |
| `POST /api/v1/calendar` | `CalendarEventCreate` → `CalendarEvent` | `workspace` create · own | | attendees are any employees on the staff (an invitation, like a message in Community) |
| `PATCH /api/v1/calendar/:id` | `CalendarEventEdit` → `CalendarEvent` | `workspace` edit · own | | owner only |
| `POST /api/v1/calendar/:id/cancel` | `EmptyBody` → `CalendarEvent` | `workspace` edit · own | | owner only; attendees are told |
| `POST /api/v1/calendar/:id/respond` | `CalendarRespond` → `CalendarEvent` | `workspace` view · own | | an attendee's `response` |
| `GET /api/v1/workspace/week` | `WeekQuery` → `WeekView` | `workspace` view · own (a manager may read someone in scope) | no (each list is its first 25 with a total) | `week_starts_on` (a Monday; this week unless given), `employee_id` |
| `PUT /api/v1/workspace/week` | `WeekSave` → `WeekView` | `workspace` view · own | | Support Needed, and a summary the person accepted with its `ai_run_id` |
| `GET /api/v1/workspace/team-weeks` | `TeamWeekQuery` → `TeamWeekPage` | `workspace` view · team, all | yes, 25 | one row per person in scope but the reader |
| `POST /api/v1/workspace/week/tidy` | `TidyRequest` (`kind` `week`) → `TidyResult` | `workspace` view · own | | one `week-summary` run; saves nothing |

Commitments' own routes (send a month, the figures, Waiting On You, rescope, recovery, the month-end
report) live with Performance under `/api/v1/performance/commitments` (performance.md §5).

## 6 · Rules and calculations

- **Who may set a task for whom (A24).** The caller may set a task for themselves, or for anyone in
  their `workspace` scope (`scopeOf(req).scope_ids`, from the org chart: a line manager's reporting
  line, a head's department, everyone for `all`). Anyone else is a 422 on `primary_assignee_id`.
- **Set by.** `set_by_employee_id` is the caller's employee. A task is "set by your manager" when
  `set_by_employee_id` differs from `primary_assignee_id`.
- **Cadence.** A task set with cadence Daily is due that working day at 17:00 (15:00 on Saturday)
  unless a due date is given; Weekly is due on the last working day of that week. Working days come
  from `shared/time/working-week` (Saturday is a working day, A22).
- **Statuses** move freely between To Do, In Progress, In Review and Done by drag. Entering In
  Progress the first time sets `started_at`; entering Done sets `completed_at`; leaving Done clears
  it. Cancelled is reached only through Cancel Task, with a reason, by the setter; a cancelled task
  leaves the board and stays reportable.
- **Order in a column.** `sort_order` is a number between the neighbours' (fractional ranking, as
  the donor does); moving before a card takes the midpoint, to the end takes the last plus one.
- **Overdue.** A task is overdue when it is not Done or Cancelled and `due_at` is before now.
  Its pill reads "Overdue 3 days"; one due today reads "Today"; tomorrow "Tomorrow"; otherwise the
  day-first date.
- **Pointer, never a stored link.** `link_url` on the wire is `linkFor(entity_type, entity_id)` (and
  Counts Towards `linkFor("target", employee_target_id)` or `linkFor("key_result", id)`), worked out on
  every read. M2 allows `entity_type` `partner`, `vacancy`, `goal`, `key_result`, `scorecard`,
  `performance_review`, `improvement_plan` and `task`; a type the route map does not know is a 422.
- **Counts Towards** (performance.md §6.18): one of the assignee's lines on their binding scorecard for
  the quarter of the task's month, or a key result they own in a binding plan; a line that is not the
  assignee's is a 422 ("Not one of their lines"). Picking a key result sets the task's record to it.
- **Commitments** (performance.md §6.11): a commitment needs acceptance criteria and a due date in its
  month. The assignee, as well as whoever manages the task, may mark it, unmark it and change its
  criteria and month while it is a draft; once its set is approved the mark, the month and the criteria
  are fixed and Cancel Task refuses it (409 `COMMITMENT_APPROVED`); its due date may still move later,
  which changes `due_at` only. Its state (Not Sent, Awaiting Approval, Returned, Due, On Time, Late,
  Missed, Rescoped) is worked out on every read.
- **The week** (performance.md §6.18): Monday to Sunday in Lagos. Done is tasks completed that week,
  Planned is open tasks due the next week, Blocked is open tasks marked blocked, each the assignee's own,
  first 25 with a total. Support Needed and a summary are the person's own; a manager reads the weeks of
  the people in their scope, never writes them.
- **Who sees a task.** The repo's `scopeClause` on `primary_assignee_id`, plus tasks where the
  caller is the setter or a `task_assignee`. A manager sees current, completed, pending and overdue
  work for their reporting line and nobody else's.
- **Analytics** (the period is the last 30 days, 90 days or the calendar year, Africa/Lagos):
  completion rate = tasks Done in the period ÷ (Done + still open and due in the period);
  overdue = open tasks past due now; average completion time = mean of `completed_at − created_at`
  over tasks Done in the period, in days to one decimal; completed per week = Done by ISO week;
  workload by person = open tasks per assignee in scope, top 25 by count; tasks by priority = open
  tasks per priority. Cancelled tasks count nowhere except a Cancelled figure.
- **Recurrence.** A task may repeat Daily, Weekly (chosen days) or Monthly (day of month). The
  next occurrence is created when the current one is Done or its due day passes, by an outbox job;
  any other rule is a 422 naming `recurrence` (ported canonicaliser).
- **Calendar.** An event is visible to its owner, its attendees, and everyone when `visibility` is
  `everyone`. Times are stored as instants and shown in Africa/Lagos. A month is always the reader's
  own (their events, invitations, open tasks' deadlines, approved leave, performance dates); a manager
  follows their team's work on Tasks, not on the calendar. A called-off event leaves every month.
  Performance dates are all day: their check-in due, the reviews they must write, the key results they
  own finishing, PIP reviews of theirs or of reviews they wrote (performance.md §6.18).
- **Since You Were Away** lists what other people did to the reader's tasks (assigned or set) from
  the start of the previous working day, newest first, one page.
- **Today's Your Day** is the reader's open tasks overdue or due today, overdue first; **Set by
  Your Manager** is their open tasks someone else set.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `task.created` | a task is saved | notification to the assignee when the setter is someone else ("Ifeoma set you a task") |
| `task.status_changed` | a move commits | activity row; realtime to the setter's board |
| `task.completed` | a task enters Done | notification to the setter when it is someone else; carries the line it counts towards and the month, which Performance reads (performance.md §6.18) |
| `task.reopened` | a task leaves Done | as above, without a notice |
| `task.blocked` / `task.unblocked` | Mark Blocked / Clear Blocker | notification to the setter |
| `task.cancelled` | Cancel Task | notification to the assignee |
| `task.commented` | a comment is saved | notification to the assignee and setter, not the author |
| job `task-recurrence` | 07:30 daily | the next occurrence of each repeating task that is done or past its day (counted from today when its day has passed, so a task days overdue repeats once); on a working day, `task.due_soon` for tasks due today and the next working day (once a day per task) |
| `calendar_event.created`, `.changed`, `.cancelled` | save, change, call off | notification to the attendees (an ICS file by email is §13) |
| `calendar_event.answered` | an attendee accepts or declines | notification to the owner |
| `week.summary_saved` | Support Needed or a summary saved | audit; Team This Week reads it |
| `commitments.*`, `commitment.*`, reminder `commitments_due` | sending, approving, rescoping and recovering commitments | Performance's (performance.md §7) |

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Staff (`employee`) | own tasks, events, analytics | create own tasks and events; move and comment on tasks they can see |
| Line Manager (`manager`) | their reporting line's tasks and analytics | set tasks for their reporting line; cancel tasks they set |
| Head of Department | their department | as a line manager, for the department |
| Management, Operations & People | as their grant's scope (`all` for Management) | as above, organisation-wide |
| CEO | everyone | everything |

No restricted fields. No capabilities: the grant's scope is the whole rule (README §5.2). A commitment
set and a rescope are decided by the person the flow names (performance.md §6.11), whatever their grant.

## 9 · AI and search

- **AI reads** (`tasks.ai.js`): `tasks.list` (TaskListQuery: "what is overdue on my team"),
  `calendar.ai.js`: `calendar.month` ("what's on Thursday"). Both `workspace` view, scoped, paged at
  25. The `workspace` module itself (Today, Analytics) is `ai:none`: it is a view over these two.
- **AI routes**: "create a task" → `workspace.tasks` with `new=1` and the title prefilled; "set my
  commitments" → `workspace.tasks` with `new=1&commitment=1`; "book a meeting" → `workspace.calendar`
  with `new=1`.
- **Feature AI**: Tidy With AI on the week, action `week-summary` (Default, personal data, TB,
  22/10/2026; prompt `services/ai/prompts/week-summary.md`), only when pressed (performance.md §6.18).
- **Search** (`tasks.search.js`): type `task`, words task, todo, to do, commitment, commitments; number
  and title. `calendar.search.js`: type `calendar_event`, words event, meeting; title; the reader's own
  events only (pinned to them, whatever their grant). ⌘K actions New Task, New Event and New Commitment
  (`shared/search/actions.js`). The week is a view over tasks: `ai:none` and `search:none`, as the rest
  of the `workspace` module.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.**

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| My Workspace · Today (`today`) | The date (desktop subtitle); Due Today, Overdue, In Review, Done This Week; Your Day (task cards, overdue first, with an Overdue pill count); Set by Your Manager with Add Task; Diary (time or All Day, title, place, Accepted, Pending or Declined); Since You Were Away (who did what, to which task, when); empty lines "Nothing due today.", "Nothing set for you.", "Nothing in the diary.", "Nothing new."; My Week (Done This Week, Planned Next Week, Blocked, each with its count and its tasks; Support Needed and the accepted Summary; Write Support Needed, which opens Support Needed with Tidy With AI and Save Line, a summary showing with Use Summary and Discard Summary); Team This Week for a manager (Person, Done, Planned, Blocked, Support Needed; a row opens that person's week) | Help term on Support Needed: "One line on what would help you this week. Your manager sees it." | That manager-set and own tasks share one list: §3. That the weekly tracker retired: performance.md §3.4 |
| My Workspace · Tasks (`tasks`) | Mine and My Team (for a reader with a reporting line); New Task; Send Commitments; Open, Due This Week, Overdue, Done This Week; Search Tasks; Show Cancelled; the board To Do, In Progress, In Review, Done, each with its count; a card: title, due pill, priority dot, assignee avatar, Set By avatar when someone else set it, a Blocked pill, a Commitment pill. A task opens its panel: Number, Assignee, Set By, Due, Priority, Cadence, Counts Towards (Open), Linked To (Open), Status, Notes, Comments, History; for a commitment its Acceptance Criteria, State, Original Date and Recovery; Edit Task, Mark Blocked or Clear Blocker, Cancel Task (setter; asks Reason, Keep Task or Cancel Task), Rescope Commitment (asks Reason), Approve Rescope and Request Changes (its approver; asks Reason), Set Recovery (a missed commitment; Owner, Due). Details, Comments and History switch on the panel. New Task: Task, Assign To (Optional; shown to someone with a reporting line), Cadence (Optional), Due (Optional), Priority, Counts Towards (Optional), Commitment (a checkbox; ticked, it asks Acceptance Criteria and Month and needs Due), Notes (Optional); Cancel, Create Task. Send Commitments: Person (Optional; for someone with a reporting line), Month, the month's commitments not yet approved (title, due, state); Cancel, Send Commitments | Help term on Cadence: "Daily is due by the end of the day. Weekly is due by the end of the week."; on Counts Towards: "The scorecard line or key result this work is for. Done tasks show as evidence."; on Commitment: "A priority for the month. Its date is fixed once approved."; on Original Date: "The date agreed when the month was approved. It never moves." | "Click a card to move it along" is removed. Fractional ordering, recurrence mechanics: §6. Commitment approval and on-time rules: performance.md §6.11 |
| My Workspace · Calendar (`calendar`) | The month and year (desktop subtitle); Previous Month, Today, Next Month; New Event; the month grid (events, task deadlines highlighted, leave, performance dates highlighted); Coming Up (date, title, time, Deadline, Leave, Check-In Due, Review Due, Key Result Due or PIP Review); a performance date opens its record. New Event: Event, Date, Start, End, Kind, Attendees (Optional), Location (Optional), Who Can See (Attendees, Everyone, Only Me); Cancel, Add Event. An event opens When, Organiser, Where, Attendees with Accept and Decline for an invitee, Call Off for its owner | None | "Leave, interviews, payday and campaign dates all land here" is removed. Visibility rules: §6 |
| My Workspace · Analytics (`analytics`) | The period's dates (desktop subtitle); Mine and My Team; 30 Days, 90 Days, This Year; Completion Rate, Overdue, Avg Completion Time, Done; Tasks Completed per Week; Workload by Person; Tasks by Priority | Help on Tasks Completed per Week: "Tasks done, out of those done or due in the period, gives the completion rate." | How each figure is worked out: §6 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| My Workspace · Today (`today`) | the four KPI cards two to a row, then Your Day as task cards, then My Week as one card (three counts and Support Needed) | Team This Week beyond 5 people (View All opens a sheet); a count's tasks (tapping the count opens them in a sheet) | New Task, the floating button; Write Support Needed in the card's sheet | bottom bar Workspace; the four tabs along the top |
| My Workspace · Tasks (`tasks`) | the stage tabs (To Do, In Progress, In Review, Done) with counts, one column of cards at a time | the KPI cards (a summary line under the tabs instead) | New Task, the floating button; Send Commitments in the header; a card opens a sheet with Move To and, for a commitment, its actions at the foot | bottom bar Workspace; drag is replaced by Move To in the sheet |
| My Workspace · Calendar (`calendar`) | the month grid at phone height, then Coming Up as 44 px rows | nothing | New Event, the floating button | bottom bar Workspace |
| My Workspace · Analytics (`analytics`) | the four KPI cards, then Tasks Completed per Week | Workload by Person beyond the first 5 (View All opens a sheet) | none | bottom bar Workspace |

## 11 · Edge cases

- **Double press** on Create Task or a move: one request (F26); a move that lost a race to another
  move answers 409 and the board reloads that column.
- **Assignee leaves** (employee archived): their open tasks stay theirs and show on the setter's My
  Team with a Left pill; the setter reassigns.
- **Manager changes**: tasks keep their setter; the new manager sees them through scope.
- **Saturday**: a Daily task set on Saturday is due 15:00 (A22).
- **A scorecard is not binding yet**: Counts Towards lists only lines of a binding (or agreed)
  scorecard; with none, it offers the key results the person owns, or nothing ("No lines or key
  results").
- **A commitment's date moves past its month**: it stays in its month (performance.md §11).
- **A link to a task the reader cannot see** (`?id=`): the board opens with no panel, as for a task that
  is gone.
- **Huge column**: each column is its own paged list (25 a page, Load More at the foot).
- **Empty board**: "No Tasks Yet" with New Task.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| praxis | `src/modules/dashboard/workspace/tasks.service.js` | statuses lowercase as the contract; operations-file links become partner, vacancy, KPI and goal pointers; audience from `scopeOf(req)`; A24 cadence and setter added; no tenancy |
| praxis | `tasks.repo.js` | `pageQuery`, `scopeClause`, `orderBy`; no hand `LIMIT` |
| praxis | `tasks.validator.js` | becomes the contract (`packages/contract/schemas/tasks.js`) |
| praxis | `recurrence.js`, `workspace.time.js` | Africa/Lagos and the working week from `shared/time` |
| praxis | `client/src/features/workspace/*` | rebuilt on `@mycity/ui` (Kanban, Calendar, charts); analytics figures cut to §6 |

## 13 · Open questions

- Projects: the table exists (2000) but no screen asked for it; kept out of M2 screens. AJ, at the
  23/10 demo.
- Late reasons (the demo's Overdue Reasons card) need a reason captured when a late task closes;
  not in the definition of done, left off. Cynthia, at the 23/10 demo.
- An ICS invitation by email beside the in-app notice (`services/calendar/ics`). AJ, after the demo.
- Reordering within a column on the board: the API takes `before_task_id`; `Kanban` moves between
  columns only today. AJ, after the demo.

## 14 · Change log

- 22/10/2026 · TB · Performance PR 4 (`docs/guides/performance.md` §6.11, §6.18): §1 to §11 now cover
  commitments on tasks (marked by the person or their manager, sent as a month, approved with their
  original dates fixed, rescoped or recovered from the panel), Counts Towards a scorecard line or a key
  result picked from the assignee's own, My Week and Team This Week on Today with Tidy With AI
  (`week-summary`), performance dates on the calendar, a task opened from a link by `?id=`, the `task`
  pointer of a Recovery task (2400) and New Commitment on ⌘K. §13's note on PR 4 is settled.
- 22/10/2026 · TB · `tasks.service.create` takes the caller's transaction (`{ client }`), so Performance's OKR workbook import sets a key result's dated initiatives as tasks for its owner inside the import (`entity_type` `key_result`); nothing on screen changes.
- 22/10/2026 · TB · §13: Performance PR 4's changes to this module, agreed in `performance.md`, noted; the module is unchanged until that PR.
- 21/10/2026 · AJ · An event's Location stays free text, marked `address:none` for gate 22 (F27): a meeting's room or call link, not a street address.
- 21/10/2026 · AJ · Performance left out of M2's PR (the lead, 21/10/2026: TB builds it from MyCity's sheets): the task form's Counts Towards field is gone until a KPIs API exists; `task.completed` and `task.reopened` still carry the KPI for it. The staging seed is `40_workspace.js` (tasks and calendar only).
- 20/10/2026 · AJ · Staging: `seeds/staging/40_workspace.js` sets tasks (by the CEO, the head of department and the line manager for their people, and people's own, A24) and this week's meetings through the tasks and calendar services, after taking Home's forward rows out of those tables.
- 20/10/2026 · AJ · §7: a repeating task days overdue repeats once, on its next day still to come, instead of once per sweep (found when the integration suite ran on a Tuesday).
- 19/10/2026 · AJ · Built: §3 to §10 now say what shipped (drag between columns, Since You Were Away
  from the previous working day, the reader's own month, attendees any employee, the morning
  `task-recurrence` sweep with reminders, ⌘K New Task and New Event, no `workspace.ai.js`); §13 adds
  ICS and in-column order.
- 19/10/2026 · AJ · First version, from MILESTONES §7, REUSE_MAP §3.1 and the 10/10 meeting.

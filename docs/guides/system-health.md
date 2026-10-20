# System Health · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M9 |
| Backend modules | `system_health` |
| Frontend paths | `app/src/features/settings/SystemHealth.tsx` |
| Permission key(s) | `system_health` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #95 |
| Status | Draft |
| Last changed | 20/10/2026 |

---

## 1 · What it is for

System Health is the one screen the IT team opens to answer "is the ERP well, and what is broken".
It shows every readiness check as it stands now, how the system has behaved over the last day and
week, and every fault the code has reported, grouped so one bug is one line with a count rather
than a thousand rows. The IT team gives each fault a status the whole team shares, and ticks the
faults they want fixed to download one Markdown file that briefs an AI assistant well enough to
diagnose and fix them without further explanation.

It is for the Implementation Team and the System Administrator. Operations & People, Management and
the CEO do not receive its notifications: a stack trace is not theirs to act on, and waking them for
one creates alarm without action.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Settings · System Health (`system-health`) | staff app, second tab, after Organisation | `system_health` view (Implementation Team, System Administrator); the CEO passes every check by design | Status (every readiness check), Performance (24 hours and 7 days), Faults (grouped, 25 a page) | Filter and search faults, open one, set its status, assign it, note it, tick several and Download Brief |
| Settings · Notifications (`notifications`) | staff app | `settings` view | The six System Health notices in the System Health category, each with who it tells and its channels | Turn a notice off, change its urgency and channels |
| Settings · Roles & Permissions (`roles-and-permissions`) | staff app | `settings` view | `system_health` as a module a role can be granted | Grant or remove System Health on a role |
| The bell and the notification pane | staff app, both shells | the people a notice names | A check going down, a new or returning fault, a spike, the 08:00 digest | Open the notice, which lands on the fault or the Status section |

## 3 · How the screens relate

1. Code fails anywhere in the API or the worker. `shared/observability/error-reporter.js` scrubs it
   and writes a row to `error_event` with a fingerprint. Nothing about that path changes.
2. The `system-health` scheduler runs every 5 minutes in the worker. It upserts an `error_group`
   for each fingerprint it has not seen, refreshes the group's last seen time and release, detects
   a group that was marked Fixed and has fired again, and detects a spike.
3. A new, returning or spiking group emits its event, which the fan-out turns into a notification
   for `system_health` view holders: the bell, a banner, and push to every device they registered.
4. The same run takes a readiness snapshot (`src/http/health.js` `runChecks()`) into
   `health_snapshot`, and compares it with the run before: a check that moved off `up` emits
   `system_health.check_down`, and one that came back emits `system_health.check_recovered`.
5. The IT team opens Settings · System Health from the notice. Status shows the live checks,
   Performance draws the snapshots, Faults lists the groups.
6. A fault left Open 24 hours after it was first seen fires `system_health.fault_unattended`, which
   reaches email as well as the bell and push, and repeats once a day until somebody moves it to
   Being Handled, Fixed or Ignored.
7. At 08:00 Lagos the `system-health-digest` scheduler emits `system_health.digest`: open faults by
   severity, what is new, what came back, and any check not up.
8. Ticking faults and pressing Download Brief reserves an export file, emits
   `system_health.brief_requested`, and the worker writes the Markdown. The browser saves it on the
   device that pressed. Every ticked fault still Open becomes Being Handled, assigned to whoever
   pressed if nobody holds it, exactly as Nfelia Ops does, so two people do not fix one bug twice.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `error_group` | `fingerprint` (unique), `title`, `severity`, `origin`, `route`, `frame`, `status`, `assigned_to`, `status_changed_at`, `status_changed_by`, `first_seen_at`, `last_seen_at`, `first_release`, `last_release`, `regressions`, `regressed_at`, `escalated_at`, `last_message` | One row per distinct fault. State only: counts are never stored here, they are aggregated from `error_event` at read time, so a late or replayed row can never double count |
| `error_group_note` | `error_group_id`, `author_user_id`, `body`, `created_at` | What the team worked out about a fault. `author_user_id` null means the system wrote it (came back, spiking) |
| `health_snapshot` | `taken_at`, `status`, `checks` jsonb, `outbox_backlog`, `worker_lag_s`, `faults_open`, `faults_new_24h`, `release` | One row every 5 minutes. Drawn as the Performance section; kept 30 days |
| `error_event` | gains index `(fingerprint, occurred_at DESC)` | The table itself is unchanged. The index is what makes the grouped list and the 24 hour and 7 day counts cheap |

Schema migration file: `migrations/9100_system_health.sql`. Reference-data file:
`seeds/reference/9190_seed_system_health.sql` (the `system_health` grants for the Implementation
Team and the System Administrator).

Retention: `error_event` rows are purged after 90 days and `health_snapshot` rows after 30, by the
existing cleanup pattern. `error_group` rows are never purged: a fault's history and the decision
somebody took on it outlive the events that raised it.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/system-health/status` | `SystemHealthStatus` | `system_health` view · all | no | The live readiness checks and the build, from `runChecks()` |
| `GET /api/v1/system-health/performance` | `PerformanceQuery` to `PerformanceSeries` | `system_health` view · all | no | `range` is `24h` or `7d`; snapshots, bucketed |
| `GET /api/v1/system-health/faults` | `FaultListQuery` to `FaultPage` | `system_health` view · all | yes, 25 | Filters: `q`, `status`, `severity`, `origin`, `sort` (`recent`, `today`, `new`) |
| `GET /api/v1/system-health/faults/:id` | `FaultDetail` | `system_health` view · all | no | The group, its last 5 occurrences, 14 days of daily counts, its notes and its history |
| `PATCH /api/v1/system-health/faults/:id` | `FaultPatch` to `FaultDetail` | `system_health` edit · all | no | Status and assignee, in one write |
| `POST /api/v1/system-health/faults/:id/notes` | `FaultNoteCreate` to `FaultNote` | `system_health` edit · all | no | |
| `POST /api/v1/system-health/faults/bulk` | `FaultBulkStatus` to `FaultBulkResult` | `system_health` edit · all | no | Up to 50 ids, one status |
| `POST /api/v1/system-health/briefs` | `BriefRequest` to `ExportFile` | `system_health` export · all | no | Up to 25 fault ids. Answers 202 with the file pending; the worker writes it |

Every list is paged at 25 (BACKEND_STRUCTURE §16). The screen waits on `GET /api/v1/exports/:id` and
downloads `GET /api/v1/documents/:id/content`, as every other export does.

## 6 · Rules and calculations

- A fault's identity is the fingerprint `error-reporter.js` already computes. System Health never
  fingerprints anything itself, so the screen and the alert channel always agree on what one fault is.
- A group's `severity` is the worst severity seen on it. `notice` (a 422) never alerts and never
  escalates: it is counted so form trouble can be seen, nothing more.
- Status is `open`, `handling`, `fixed` or `ignored`. Only `open` escalates, and only `open` and
  `handling` are shown by default.
- **Came back.** A group whose status is `fixed` and which has an event later than
  `status_changed_at` returns to `open`, `regressions` goes up by one, `regressed_at` is set, and
  `system_health.fault_returned` is emitted. A group marked `ignored` never comes back on its own.
- **A spike** is 10 or more events in the last hour and at least 5 times the group's mean hourly rate
  over the previous 7 days. Told once per group per 6 hours.
- **Unattended** is a group still `open` whose severity is `fatal` or `error`, 24 hours after
  `first_seen_at`. It fires `system_health.fault_unattended`, which carries email among its default
  channels, and repeats every 24 hours until the status changes. `escalated_at` records the last
  firing.
- **Counts** on the list are aggregated from `error_event` for the window asked for: Today is the
  last 24 hours, In All is every event still kept. They are never incremented into `error_group`.
- **The brief's questions.** The Markdown tells the receiving AI to ask the owner **at least 4
  questions and at most 10**, at most 4 in one `AskUserQuestion` call, and to say why it needs more
  than 4 when it asks for more. MyCity is a wider system than a single shop ledger, so 2 questions,
  which is Nfelia's standard, leaves too much guessed.
- **The brief carries no names.** Route, stack, release, counts and the number of people affected.
  Never a display name, an email address or a user id: the file is made to be pasted into an AI chat
  outside MyCity. Everything in it has already been through `observability/scrub.js`.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `system-health` (scheduler, every 5 minutes) | worker | Upserts groups, detects regressions and spikes, takes a `health_snapshot`, compares checks with the run before |
| `system-health-digest` (scheduler, 08:00 Lagos) | worker | Emits `system_health.digest` once a day |
| `system-health-purge` (scheduler, nightly) | worker | `error_event` over 90 days and `health_snapshot` over 30 days |
| `system_health.check_down` | a readiness check leaves `up` | Notifies, urgency `urgent` for `postgres`, `redis` and `worker`, `important` otherwise |
| `system_health.check_recovered` | it returns to `up` | Notifies, urgency `normal` |
| `system_health.fault_new` | a fingerprint is seen for the first time | Notifies, urgency from severity |
| `system_health.fault_returned` | a fault marked Fixed fires again | Notifies, urgency `important` |
| `system_health.fault_spiked` | the spike rule matches | Notifies, urgency `important`, at most once per 6 hours |
| `system_health.fault_unattended` | still Open 24 hours after first seen | Notifies with email on, repeats daily |
| `system_health.digest` | 08:00 Lagos | The day's summary |
| `system_health.brief_requested` | Download Brief is pressed | Outbox: the worker writes the Markdown into the reserved export file |

All six notices sit in a new **System Health** notification category: `locked` like Security, so push
and the bell cannot be switched off for production faults, with email off by default. Only
`system_health.fault_unattended` declares email among its own default channels, through a new
per-notice `channels` option on `defineNotification`. That option is a small addition to the shared
fan-out, so `docs/guides/notifications.md` changes with it.

WhatsApp is deliberately not used. `ALERT_WHATSAPP_URLS` stays exactly as it is for the
infrastructure alerts that have nothing to do with the app's own notification engine (the uptime
probe, the nightly backup, the restore drill); nothing in this module writes to it.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Implementation Team | Everything | View, edit, export: set status, assign, note, download briefs |
| System Administrator | Everything | View, edit, export: the same |
| Operations & People | Nothing | The tab is not in their Settings |
| Management | Nothing | The tab is not in their Settings |
| Line Manager, Staff | Nothing | |
| CEO | Everything, by the standing rule that the CEO passes every check | Never notified: `fanout.js` does not add the CEO to a permission audience, which is what keeps a fault off her phone |

`system_health` is a new module key in `shared/access/access.catalog.js`, area `system`. It is
granted by `seeds/reference/9190_seed_system_health.sql` to `implementation` and `administrator`
only. Because it is a module key and not a hard-coded role test, a new IT hire is given System
Health from Settings · Roles & Permissions with no deploy.

No restricted fields. The whole screen is restricted instead, which is why the permission exists.

## 9 · AI and search

- **AI reads** (`system_health.ai.js`): none. A fault is engineering detail; the assistant answering
  "is the system down" from a stack trace would be worse than useless to a member of staff, and A23
  keeps the assistant read-only anyway.
- **AI routes**: none.
- **Search** (`system_health.search.js`): the screen itself is reachable from ⌘K through the route
  map, for those who hold the permission. Individual faults are `search:none`: they are found on the
  screen with its filters, not by name, and a fingerprint is not a word anybody types.

## 10 · On screen and mobile

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Settings · System Health | Four tiles (Status, Open Faults, New Today, Checks Down); the check list with a state pill each; the 24 hour and 7 day chart; the fault table with severity, Today, In All, People, Last Seen, Status and who holds it; Set Status, Assign, Add Note, Download Brief | Help term on Came Back: a fault marked fixed that has happened again. Help term on People: how many different people hit it. Details row on a check: what to look at when it is not up | Fingerprinting, the spike formula, the escalation clock, why WhatsApp is not used: §6 and §7 here, and `docs/runbooks/system-health.md` |
| Fault sheet | Title, severity, where, first and last seen with release, the last 5 occurrences with stack, 14 days of bars, notes, history | Help term on Release: the build the fault was last seen on | The brief's full text, the AI instructions: the downloaded file |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Settings · System Health | The overall state line, then the four tiles two to a row, then checks that are not up as cards | The 7 day chart, the full check list when everything is up, the In All and People columns | Download Brief, full width in the sheet after faults are ticked | Bottom bar More, then Settings; the tabs scroll sideways |
| Fault sheet | Severity pill, title, when it was last seen, Set Status | The stack trace, collapsed behind Show Stack | Set Status, full width in the sheet's footer | Opens as a sheet over the list, back closes it |

## 11 · Edge cases

- **No faults at all.** The Faults section shows an empty state saying nothing has failed, not an
  empty table. This is the normal state of a healthy system and must not read as a broken screen.
- **The database is down.** Status still renders: `runChecks()` answers with `postgres` down, and the
  Faults and Performance sections show their error state rather than an empty one. A 503 on
  `/health/ready` never blanks the screen.
- **A fault with no stack.** `error_event.stack` is nullable. The brief says so rather than printing
  an empty fence.
- **Ticking more than 25 faults.** The tick-all box covers the page in view. The brief caps at 25
  faults and tells the person so before it downloads: more than that is not one fixing session.
- **Two people press Download Brief on the same fault.** Both get the file. The status moves to
  Being Handled once, assigned to whoever got there first; the second person sees who holds it.
- **A fault whose events have all been purged.** The group stays with its counts at zero and a line
  saying its occurrences are no longer kept. The decision somebody took on it is still worth reading.
- **The worker is down.** No snapshots are taken and no briefs are built, so the Performance chart
  shows a gap rather than a flat line, and a brief that has not arrived in 5 minutes fails with the
  standard export message. The `worker` check being down is itself what says why.
- **A deploy.** `release` changes. A fault first seen on an earlier release and still firing shows
  both, which is how the AI is told what to compare against.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| none | | The shape of the fault list, the shared status and the Markdown brief follow a working pattern from another operations console, rewritten here against Postgres, the contract, the fan-out and the export pipeline. No file is copied |

## 13 · Open questions

- The per-notice `channels` option on `defineNotification` (§7) is a change to shared fan-out code
  that `docs/guides/notifications.md` covers. GE to confirm the shape before it is merged. The
  alternative, seeding a `notification_rule` row for the escalation, is rejected here because
  Reset to Default on that notice would silently turn the 24 hour email off.
- Whether Management should later get a view-only Status section, without faults or the brief. Not
  built; TB decided against it on 20/10/2026 to keep the screen single-audience.

## 14 · Change log

- 20/10/2026 · TB · Written. Settings · System Health agreed as one tab after Organisation, with its
  own `system_health` permission key granted to the Implementation Team and the System Administrator
  only; faults grouped on the existing fingerprint with a shared status; push and in-app to every
  registered device, email only after 24 hours unattended, an 08:00 digest, and no WhatsApp; a
  Markdown brief whose instructions require 4 to 10 clarity questions before any fix.

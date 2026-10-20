# System Health · Engineering Guide

| | |
|---|---|
| Owner | GE |
| Milestone | M9 |
| Backend modules | `system_health` |
| Frontend paths | `app/src/features/settings/SystemHealth.tsx`, `app/src/features/settings/Performance.tsx` |
| Permission key(s) | `system_health` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #95, #96, #97 |
| Status | Built |
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
| Settings · Status (`status`) | staff app, second tab, after Organisation | `system_health` view (Implementation Team, System Administrator); the CEO passes every check by design | Every readiness check, including disk, memory, processor, database size and connections, and whether every background job has run | Read what is wrong and where to look |
| Settings · Performance (`performance`) | staff app, third tab | the same | Availability, response time and failed requests against their targets; the whole server's processor, memory and disk in real units, split by what uses them; network, disk activity and server facts; trends over an hour, a day, a week or a month; then Slowest Routes, Database, Background Work and Processes | Switch the window, switch the section, Edit Targets (`system_health` edit) |
| Settings · Faults (`faults`) | staff app, fourth tab | the same | Faults, grouped, 25 a page | Filter and search, open one, set its status, assign it, note it, tick several and Download Brief |
| Settings · Notifications (`notifications`) | staff app | `settings` view | The six System Health notices in the System Health category, each with who it tells and its channels | Turn a notice off, change its urgency and channels |
| Settings · Roles & Permissions (`roles-and-permissions`) | staff app | `settings` view | `system_health` as a module a role can be granted | Grant or remove System Health on a role |
| The bell and the notification pane | staff app, both shells | the people a notice names | A check going down, a new or returning fault, a spike, the 08:00 digest | Open the notice: a fault notice opens Faults with that fault's sheet open (`error_group`), a check or the digest opens Status (`health_snapshot`), through `shared/route-map.js` |

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
   Performance draws the samples, Faults lists the groups.
5a. Every minute the `system-health-sample` scheduler reads the whole server (processor, memory,
   disk, disk activity, network, and each systemd service's own share through its cgroup), asks
   the API on loopback whether it is ready, and writes one `perf_sample` row. Every 15 minutes
   the root `mycity-host-stats` timer writes `/var/lib/mycity/host-stats.json` with what fills the
   disk and whether the server wants a restart or updates; both environments read it.
5b. The API counts every `/api/` request a minute at a time (`request_stat`) and per route a
   quarter hour at a time (`route_stat`), each with the latency buckets the percentiles are
   worked from. Each API and worker process upserts its own `process_beat` row every minute.
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
| `schedule_run` | `name`, `last_run_at`, `duration_ms`, `ok`, `runs`, `failures` | One row per background job, written after every tick by `jobs/registry.js`. Without it a job that stops is invisible, which is exactly how the first release shipped |
| `request_stat` | `minute`, `requests`, `errors`, `client_errors`, `slow`, `total_ms`, `max_ms` | A minute of traffic, written by the API. Counts are added, never replaced, so several processes and a restart inside one minute land in one row. Sums, not a percentile: a mean adds across processes, a p95 does not |
| `health_snapshot` | gains `disk_free_pct`, `memory_used_pct`, `cpu_load`, `database_mb`, `database_connections_pct`, `requests`, `error_pct`, `mean_ms` | Database size over time (growth per day) |
| `perf_sample` | `minute` (PK), `cores`, `cpu_busy_pct`, `cpu_steal_pct`, `cpu_iowait_pct`, `load_1m`, `memory_total_mb`, `memory_in_use_mb`, `memory_cache_mb`, `memory_free_mb`, `swap_total_mb`, `swap_used_mb`, `disk_total_mb`, `disk_used_mb`, `disk_free_mb`, `disk_read_kb`, `disk_written_kb`, `disk_busy_pct`, `network_in_kb`, `network_out_kb`, `tcp_connections`, `<group>_cpu_pct` and `<group>_memory_mb` for `production`, `staging`, `database`, `redis`, `scanner`, `api_up`, `users_online` | One row a minute, written by the worker: the whole server, not one environment. What the Performance tab draws. Kept 30 days |
| `request_stat` | gains `buckets` (integer[]) | How many requests of the minute fell in each latency bucket, so a percentile can be worked out across processes. From this release only `/api/` requests are counted (no health probes, no frontend files) |
| `route_stat` | `bucket` (a quarter hour), `method`, `route` (PK together), `requests`, `errors`, `client_errors`, `slow`, `total_ms`, `max_ms`, `buckets` | Slowest Routes. `route` is the route as declared (`/api/v1/system-health/faults/:id`), or `(no route)` for a 404, so the set of rows is bounded. Kept 30 days |
| `process_beat` | `instance` (PK: role, host, pid and start), `role`, `host`, `pid`, `release`, `started_at`, `last_beat_at`, `memory_mb`, `heap_mb`, `loop_delay_ms`, `cpu_pct`, `sockets`, `users_online` | One row per API or worker process, updated every minute. A new row is a start, so restarts are counted from it. Kept 30 days after its last beat |
| `performance_target` | `singleton` (unique, always true), `availability_pct`, `response_p95_ms`, `error_pct`, `disk_warn_free_pct`, `disk_down_free_pct`, `memory_warn_pct`, `memory_down_pct`, `cpu_warn_pct`, `cpu_down_pct`, `connections_warn_pct`, `connections_down_pct`, `updated_by` | The one row Edit Targets writes. No row means the defaults in `system_health.targets.js` (99.9%, 800 ms, 1%, and the levels in §6); nothing is seeded |
| `schedule_run` | gains `total_ms`, `max_ms` | A job's mean and longest run, for Background Work |

The file the root timer writes, `/var/lib/mycity/host-stats.json` (mode 644), is not a table:
`{ version: 1, taken_at, uses: { production_database, production_files, staging_database,
staging_files, backups, logs }, restart_needed, updates: { waiting, security } }`, every size in
bytes. Anything it cannot measure is `null`. It carries no names, only sizes and counts.

Schema migration files: `migrations/9100_system_health.sql`, `migrations/9110_system_health_engine.sql` and `migrations/9120_system_health_performance.sql`. Reference-data file:
`seeds/reference/9190_seed_system_health.sql` (the `system_health` grants for the Implementation
Team and the System Administrator).

Retention: `error_event` rows are purged after 90 days; `health_snapshot`, `request_stat`,
`perf_sample`, `route_stat` and silent `process_beat` rows after 30, by the existing cleanup pattern. `error_group` rows are never purged: a fault's history and the decision
somebody took on it outlive the events that raised it.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /api/v1/system-health/status` | `SystemHealthStatus` | `system_health` view · all | no | The live readiness checks and the build, from `runChecks()` |
| `GET /api/v1/system-health/performance` | `PerformanceQuery` to `PerformanceSeries` | `system_health` view · all | no | `range` is `hour`, `day`, `week` or `month`: the four headline figures against their targets, and the samples bucketed by the minute, 15 minutes, the hour or the day |
| `GET /api/v1/system-health/capacity` | `PerformanceCapacity` | `system_health` view · all | no | The server now: processor, memory and disk in real units with each part, disk activity, network, the server's facts, and the days until the disk is full |
| `GET /api/v1/system-health/routes` | `RouteStatQuery` to `RouteStatPage` | `system_health` view · all | yes, 25 | Each route over the window: calls, p95, mean, longest, errors, slow. Sort `p95_ms` (default), `requests`, `errors`, `mean_ms` |
| `GET /api/v1/system-health/database` | `DatabaseSummary` | `system_health` view · all | no | Size and growth, connections by state, cache hit, deadlocks, temporary files, the oldest transaction, the version, and whether slow SQL is on |
| `GET /api/v1/system-health/database/tables` | `TableStatQuery` to `TableStatPage` | `system_health` view · all | yes, 25 | Largest tables first; sort `total_bytes`, `rows`, `dead_pct` |
| `GET /api/v1/system-health/database/queries` | `QueryStatQuery` to `QueryStatPage` | `system_health` view · all | yes, 25 | From `pg_stat_statements`, this environment's role only; an empty page while it is off. Sort `total_ms` (default), `mean_ms`, `calls` |
| `GET /api/v1/system-health/background` | `BackgroundWork` | `system_health` view · all | no | Each queue's waiting, active, delayed and failed jobs, the outbox, and live workers |
| `GET /api/v1/system-health/background/jobs` | `JobRunQuery` to `JobRunPage` | `system_health` view · all | yes, 25 | Every scheduler with its last run, mean and longest run, runs and failures. Sort `name` (default), `last_ms`, `failures` |
| `GET /api/v1/system-health/processes` | `ProcessList` | `system_health` view · all | no | People online now, each live API and worker process, and restarts this week |
| `GET /api/v1/system-health/targets` | `PerformanceTargets` | `system_health` view · all | no | The targets and warning levels, defaults applied |
| `PUT /api/v1/system-health/targets` | `PerformanceTargetsUpdate` to `PerformanceTargets` | `system_health` edit · all | no | All eleven at once. Audited, emits `system_health.targets_changed`; Status's checks read the new levels within a minute |
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
- **Recording, not quiet.** Performance with no sample in the last 3 minutes says the one-minute
  job has stopped, rather than showing a neutral empty state. The same fact is a `schedulers`
  readiness check, so it is visible from Status as well as from the chart.
- **Availability** is the share of recorded minutes in which the API answered
  `/api/health/ready` with 200 (ready or degraded) on loopback. A 503 (the database is down) or no
  answer within 3 seconds is a minute down. Minutes with no sample (the worker was down) are not
  counted either way; they are shown as Not Recorded. Samples taken while the database is down are
  held in the worker (up to 2 hours) and written when it is back, so an outage reads as down, not
  as a gap. Not Recorded starts at the first sample ever taken, so a new server does not report a
  day of gaps.
- **Response time** is worked out from latency buckets (25, 50, 100, 200, 300, 500, 800, 1000,
  1500, 2000, 3000, 5000 and 10000 ms, and over), added across processes, and read at the 95th
  percentile with straight-line interpolation inside the bucket. Over 10 s reads as 10 s. Mean is
  total time over requests. Only `/api/` requests count, never health probes or frontend files.
- **Failed requests** are answers of 500 or more, as a share of all `/api/` requests. A 4xx is
  the caller's mistake and is counted apart (Slowest Routes shows it), never against the target.
- **A target is met** when availability is at or above it, p95 is at or under it, and failed
  requests are at or under it. No traffic in the window means no verdict, not a pass.
- **Processor.** Busy is user, nice, system, irq and softirq time over all time, from
  `/proc/stat`, across every core. Steal (time the host gave to other machines) and I/O wait are
  shown apart and never counted as busy. Each part is the systemd service's own CPU time from its
  cgroup (`cpu.stat`), as a share of the whole machine: Production is `mycity-api-prod` and
  `mycity-worker-prod` (Chromium runs inside the worker), Staging the two `-stg` units, Database
  `postgresql@*`, Redis `redis-server`, Upload Scanner `clamav-daemon`; Other is the rest.
- **Memory.** In use is total less available (`MemAvailable`), which is what the server cannot
  give back. Cache is available less free: disk cache the kernel hands back the moment a process
  asks, never a problem in itself. Each service's part is its cgroup's `memory.current` less its
  file cache. Other is in use less the parts. Swap is shown only when the server has any.
- **Disk.** Total, used and left are the root filesystem's (`statfs /`); left is what a process
  can still write, so the blocks kept back for root show as Reserved. The parts come from the
  root timer's file: each environment's database and files, backups and logs; System is used
  less the parts (the operating system, releases, the database's write-ahead log). A file older
  than 1 hour is shown with its time; no file says the timer is not installed.
- **Full in.** A least-squares line through the last 7 days of disk used, one point an hour.
  Growth under 50 MB a day, or fewer than 24 hours of samples, reads as Not Filling.
- **Windows.** Hour by the minute (60 points), Day by 15 minutes (96), Week by the hour (168),
  Month by the day (30, Lagos days). A bucket with no sample is a gap in the line, never zero.
- **Thresholds.** Edit Targets holds them, with these defaults. Disk: degraded under 10% free,
  down under 5%. Memory in use: degraded at 90%, down at 95%. Processor busy: degraded at 85%,
  down at 95%. Database connections: degraded at 80% of `max_connections`, down at 90%. Each
  down level must be beyond its warning level, and the API refuses a pair that is not. Status's
  `disk`, `memory`, `cpu` and `database_usage` checks read the same row (kept 60 seconds), so the
  screen and the alerts agree.
- **A scheduler is late** when it has not run for three of its own intervals, or for 3 hours when
  its cron runs hourly and 26 hours when it runs daily. Degraded, never fatal: the API serves
  without background work.
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
| `system-health` (scheduler, every 5 minutes) | worker | Upserts groups, detects regressions and spikes, takes a `health_snapshot` with the resources and the traffic, compares checks with the run before |
| Every scheduler's tick | worker | Writes `schedule_run`, so a job that stops can be seen. Best effort: a tick never fails because its bookkeeping did |
| `system-health-digest` (scheduler, 08:00 Lagos) | worker | Emits `system_health.digest` once a day |
| `system-health-purge` (scheduler, nightly) | worker | `error_event` over 90 days; `health_snapshot`, `request_stat`, `perf_sample`, `route_stat` and silent `process_beat` rows over 30 days |
| `system-health-sample` (scheduler, every minute) | worker | Reads the server and the API's readiness and writes `perf_sample`; holds rows while the database is down |
| Every API and worker process, every minute | both | Upserts its `process_beat`: memory, heap, event-loop delay (p99 of the minute), CPU, and on the API the sockets and people connected |
| `mycity-host-stats.timer` (root, every 15 minutes) | server | `ops/monitoring/host-stats.sh` writes `/var/lib/mycity/host-stats.json`: the disk's parts, restart needed, updates waiting |
| `system_health.targets_changed` | Edit Targets is saved | Audit only; no notice |
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
| Implementation Team | Everything | View, edit, export: set status, assign, note, download briefs, Edit Targets |
| System Administrator | Everything | View, edit, export: the same |
| Operations & People | Nothing | The tab is not in their Settings |
| Management | Nothing | The tab is not in their Settings |
| Line Manager, Staff | Nothing | |
| CEO | Everything, by the standing rule that the CEO passes every check | Never notified: `fanout.js` does not add the CEO to a permission audience, which is what keeps a fault off her phone |

Status, Performance and Faults are tabs of Settings but are held by `system_health`, not
`settings`: the shell (`app/src/shell/access.ts`) and ⌘K (`shared/search/screens.js`) show them
only to its holders and the CEO, and a holder without Settings still reaches Settings with only
these three tabs. Their record types in `shared/route-map.js` carry `permission: "system_health"`,
so a notice's link is offered to whoever may open it.

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
| Settings · Status | Four tiles (Checks Down, Open Faults, New Today, Came Back); the check list with a state pill each, including disk, memory, processor, database and background jobs | Details row on a check that is not up: where to look | Fingerprinting, the spike formula, the escalation clock, why WhatsApp is not used: §6 and §7 here, and `docs/runbooks/system-health.md` |
| Settings · Performance | Four target tiles (Availability, Response Time, Failed Requests, Requests), each with its target; Processor, Memory and Disk cards in real units with a bar split by what uses them; Network and Server cards; Response Time, Requests, Failed Requests, Processor, Memory, Disk Activity and Network over the window; the section switch (Slowest Routes, Database, Background Work, Processes). A banner when nothing is recording | Help terms on Steal, I/O Wait, Cache, Reserved, Full In and p95, one sentence each; the ⓘ on a chart says what it counts | How each figure is worked out, the bucket bounds and the regression: §6 here |
| Edit Targets | A three-step wizard: Targets (availability, response time, failed requests), Disk and Memory, Processor and Connections; Save Targets | Nothing | Why the defaults are what they are: §6 here |
| Settings · Faults | The fault table with severity, Today, In All, People, Last Seen, Status and who holds it; Set Status, Assign, Add Note, Download Brief | Help term on Came Back: a fault marked fixed that has happened again. Help term on People: how many different people hit it | The brief's full text: the downloaded file |
| Fault sheet | Title, severity, where, first and last seen with release, the last 5 occurrences with stack, 14 days of bars, notes, history | Help term on Release: the build the fault was last seen on | The brief's full text, the AI instructions: the downloaded file |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Settings · Status | The state pill, then the four tiles two to a row, then checks that are not up as cards | The full check list when everything is up | Nothing; Status is for reading | Bottom bar More, then Settings; the tabs scroll sideways |
| Settings · Performance | The window switch, the banner when nothing is recording, then the four target tiles two to a row, then Processor, Memory and Disk with their split bars, then Network | Every trend chart (a trend is not a phone screen), the Server card, and the columns marked desktop in each section (Over 1 s, Longest, Indexes, Heap) | The window switch; Edit Targets as a full-screen sheet | As above; sections are cards, not tables |
| Settings · Faults | Search, then fault cards with a severity pill | The In All and People columns | Download Brief, full width in the sheet after faults are ticked | As above |
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
- **Not Linux** (a laptop on Windows or macOS). There is no `/proc` or cgroup to read, so the
  server's figures are empty and the cards say Not Available; traffic, the database and the jobs
  still show. Nothing fails.
- **cgroup v1, or a service not running.** Its part is left out and counted in Other.
- **The root timer is not installed yet.** The disk card shows total, used and left from `statfs`,
  and its parts say Not Measured until `provision.sh` has been run again.
- **Slow SQL is off.** `pg_stat_statements` needs `shared_preload_libraries` and a database
  restart (`docs/runbooks/system-health.md` §7). Until then the Database section says Not Turned
  On and the rest of it works.
- **A deploy.** `release` changes. A fault first seen on an earlier release and still firing shows
  both, which is how the AI is told what to compare against.

## 12 · Donor code

| From | File | Change on the way in |
|---|---|---|
| none | | The shape of the fault list, the shared status and the Markdown brief follow a working pattern from another operations console, rewritten here against Postgres, the contract, the fan-out and the export pipeline. No file is copied |

As built: the roll-up lives in the worker rather than the error reporter, because the reporter writes on a path that has already gone wrong and its own comment says a reporter that breaks the thing it reports on is worse than none. `text/markdown` was added to `shared/files/sniff.js` so an export file may be `.md`; no upload purpose lists it, so nothing new can be uploaded.

## 13 · Open questions

- The per-notice `channels` option on `defineNotification` (§7) is a change to shared fan-out code
  that `docs/guides/notifications.md` covers. GE to confirm the shape before it is merged. The
  alternative, seeding a `notification_rule` row for the escalation, is rejected here because
  Reset to Default on that notice would silently turn the 24 hour email off.
- Slow SQL and the disk's parts wait on the server: `provision.sh` run again and one database
  restart (TB, 20/10/2026: TB does the restart). Until then both show their Not Turned On state.
- Whether Management should later get a view-only Status section, without faults or the brief. Not
  built; TB decided against it on 20/10/2026 to keep the screen single-audience.

## 14 · Change log

- 20/10/2026 · TB · Performance rebuilt from TB's answers (targets 99.9% up, p95 under 800 ms,
  failed requests under 1%, editable on screen; this environment's traffic and the whole server's
  resources with staging's share; Hour, Day, Week and Month; processor, memory and disk in real
  units split by service and use; disk activity, network and server facts; Slowest Routes,
  Database with slow SQL, Background Work and Processes). Added `perf_sample`, `route_stat`,
  `process_beat`, `performance_target`, latency buckets on `request_stat`, the one-minute sampler,
  per-process beats, the root `mycity-host-stats` timer and `pg_stat_statements` in provisioning.
  The first release drew time series as labelled rows, called degraded minutes down (0.0% of the
  day while serving), and counted a day of gaps on a server an hour old. §2 to §8, §10, §11, §13.
- 20/10/2026 · TB · System Health's notices did not open anything: `error_group` and
  `health_snapshot` had no route in `shared/route-map.js`, so every notice was sent without a
  link. A fault notice now opens Faults with its sheet (`?id=`), a check or the digest opens
  Status, and the three tabs follow `system_health` in the shell and ⌘K, as §8 always said.

- 20/10/2026 · TB · Split into three tabs (#95 Status, #96 Performance, #97 Faults) and the engine
  behind it fixed, after TB walked the first release on staging. The three schedulers were never in
  `SCHEDULERS` (`src/jobs/registry.js`), so nothing ran and the chart read "Nothing Recorded Yet",
  which looks like good news. Added: the registration; `schedule_run` and a `schedulers` readiness
  check; `scripts/check/schedulers.js`, the gate that would have caught it; disk, memory, processor
  and database usage checks; `request_stat` and the response time and failure share they feed; and a
  chart that says when nothing is recording. §2, §4, §6, §7 and §10 updated.
- 20/10/2026 · TB · Built. 30 unit tests and 19 integration tests on the real migrations: who may open it, the roll-up and its idempotence, a fault coming back, the brief the worker writes and who may download it, the snapshot and the chart, the 24 hour escalation reaching email once a day, the digest, and the purge leaving the fault itself behind.
- 20/10/2026 · TB · Written. Settings · System Health agreed as one tab after Organisation, with its
  own `system_health` permission key granted to the Implementation Team and the System Administrator
  only; faults grouped on the existing fingerprint with a shared status; push and in-app to every
  registered device, email only after 24 hours unattended, an 08:00 digest, and no WhatsApp; a
  Markdown brief whose instructions require 4 to 10 clarity questions before any fix.

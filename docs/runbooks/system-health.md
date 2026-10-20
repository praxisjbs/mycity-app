# Runbook · System Health

Settings · System Health is the screen the IT team opens to see whether the ERP is well and what is
broken (`docs/guides/system-health.md`). Almost all of it needs nothing from the server: the tables
arrive with the migration and the work runs in the worker that is already there.

This page is what is left for GE: **four checks after the deploy, one of which may need a change to
the `.env`**, **one command once to start the health watch** (§7), and what to do when the screen
says something is wrong.

---

## 1 · What the deploy does on its own

Nothing here is run by hand. `main` to staging, then a person approves production
(`docs/runbooks/deploy.md`).

| | |
|---|---|
| `migrations/9100_system_health.sql` | Creates `error_group`, `error_group_note`, `health_snapshot`, and the index on `error_event` that makes the counts cheap |
| `migrations/9110_system_health_engine.sql` | Creates `schedule_run` (when each background job last ran) and `request_stat` (a minute of traffic), and adds the resource columns to `health_snapshot` |
| `migrations/9120_system_health_performance.sql` | Creates `perf_sample` (the server a minute at a time), `route_stat`, `process_beat` and `performance_target`, adds latency buckets to `request_stat` and run times to `schedule_run`, and the `perf_percentile()` function |
| `seeds/reference/9190_seed_system_health.sql` | Grants the new `system_health` permission to the Implementation Team and the System Administrator |
| The worker | Picks up four schedulers: `system-health` every 5 minutes, `system-health-sample` every minute, `system-health-digest` at 08:00 Lagos, `system-health-purge` at 02:10 |
| Every API and worker process | Writes its own `process_beat` once a minute |

`error_event` is **not** rewritten: the migration only adds an index beside it, so the deploy does
not pause on a large table.

## 2 · After the deploy, four checks

Run these on staging first, then on production. Each is read-only.

**1. The migration and the seed landed.**

```
sudo -u postgres psql -d mycity_prod -c \
  "SELECT name FROM schema_migration WHERE name LIKE '9100%' OR name LIKE '9190%' ORDER BY name"
```

Two rows: `9100_system_health` and `9190_seed_system_health`. No rows means the deploy gate stopped
before them; read `~mycity-deploy/deploy-gate.log`.

**2. The right two roles hold it, and nobody else.**

```
sudo -u postgres psql -d mycity_prod -c \
  "SELECT r.name, p.scope, p.can_view, p.can_edit, p.can_export
     FROM permission p JOIN role r ON r.role_id = p.role_id
    WHERE p.module_key = 'system_health' ORDER BY r.name"
```

Exactly two rows: **Implementation Team** and **System Administrator**. If Operations & People or
Management appears, somebody granted it in the app; that is their call, but say so to TB, because
the whole reason the permission exists is to keep stack traces away from them.

**3. Every background job is actually running.** This is the one that matters most: the first
release of this module shipped with its own three schedulers unregistered, so nothing ran for an
hour and the screen showed an empty chart that read like good news.

```
sudo -u postgres psql -d mycity_prod -c \
  "SELECT name, last_run_at, ok, runs FROM schedule_run ORDER BY last_run_at DESC NULLS FIRST"
```

Within ten minutes of the worker starting you want a row for every job, `system-health` among them,
with a recent `last_run_at`. A job missing from the table has never run: `systemctl status
mycity-worker-prod`, then `journalctl -u mycity-worker-prod -n 100`.

You do not have to remember this: **Settings · Status now has a Background Jobs line** that turns
amber and names any job that has not run when it should have.

**4. The snapshots are being written.** Five minutes after the worker is up:

```
sudo -u postgres psql -d mycity_prod -c \
  "SELECT taken_at, status, faults_open FROM health_snapshot ORDER BY taken_at DESC LIMIT 3"
```

A row every five minutes. An empty table after ten minutes is the one real failure of this
release: the screen's Performance section will show a gap, and the 24 hour escalation will never
fire. Check 3 above first.

## 3 · The one thing that may need a change: push and email

System Health tells people on the bell, on their phones, and by email once a fault has sat open for
a day. The bell always works. The other two use what is already configured, so they only need
checking, not setting up:

```
grep -E '^(VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|SMTP_HOST|MAIL_FROM)=' /srv/mycity/prod/shared/.env
```

| Line | If it is empty |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Fine. The app makes a pair on first start and keeps it encrypted in the database (`.env.example` line 149). Phones still get notifications |
| `SMTP_HOST`, `MAIL_FROM` | **Not fine.** The 24 hour escalation has nowhere to go. Set them as `docs/runbooks/dns-and-mail.md` §4 says, then `sudo systemctl restart mycity-api-prod mycity-worker-prod` |

Confirm mail is answering without sending anything:

```
curl -s localhost:7000/api/health/ready | jq '.checks.mail'
```

`"status": "up"` is what you want.

**WhatsApp is not used by this module, and nothing about it changes.** `ALERT_WHATSAPP_URLS` stays
exactly as it is for the infrastructure alerts that have nothing to do with the app's own engine:
the uptime probe, the nightly backup and the restore drill (`docs/runbooks/monitoring.md` §2). TB
decided on 20/10/2026 that faults reach people through the app's own notifications instead, so
there is no new gateway, no new key and no new number to register.

## 4 · What to do when the screen says something is wrong

Settings · System Health already names the check and what to look at. This is the same table, for
when you are on the server rather than in the app. `docs/runbooks/monitoring.md` §1 has the full
list; these are the ones that reach somebody's phone.

| Check | First command | Then |
|---|---|---|
| Database | `systemctl status postgresql` | `docs/runbooks/backup-restore.md` if it will not start |
| Cache and Sessions | `systemctl status redis-server` | Sessions and queued jobs are down until it is back |
| Worker | `systemctl status mycity-worker-prod` | `journalctl -u mycity-worker-prod -n 100`. Mail, PDFs and notifications are waiting, not lost |
| Events | `curl -s localhost:7000/api/health/ready \| jq '.checks.outbox'` | A backlog that keeps growing with a healthy worker means a handler is failing: `journalctl -u mycity-worker-prod \| grep outbox` |
| File Storage | `ls -ld /srv/mycity/prod/media` | It must be writable by the service user |
| Upload Scanning | `systemctl status clamav-daemon` | Uploads are refused while it is down. Degraded, never fatal |
| Disk Space | `df -h /` | Amber under 10% free, red under 5%. Old releases and dumps are pruned; media and logs grow |
| Memory | `free -h` (the `available` column) | Amber at 90% in use, red at 95%, or the levels in Edit Targets. In use is total less available: the cache is not counted. A process that runs out is killed. Performance's Memory card shows which service holds it |
| Processor | `top` (the `id` and `st` figures) | Amber at 85% busy, red at 95%, or the levels in Edit Targets. Steal (`st`) is the host taking time for other machines: a provider matter, not ours |
| Database Usage | `sudo -u postgres psql -d mycity_prod -c "SELECT count(*) FROM pg_stat_activity"` | Amber at 80% of `max_connections`. Something is holding connections open, or the pool is too large |
| Background Jobs | the `schedule_run` query in §2 | A job that has stopped. Reminders, snapshots and clean-ups are waiting. Press the line on Settings · Status: its sheet lists every job with what it was set to, its last run, its error and its next run. **Not due yet** is a job started less than a day ago that has not reached its first slot: that is fine |

You rarely need this table by hand any more: **Download Brief** on Settings · Status writes all of
it for this server, with the commands already filled in, into a file you paste into an AI (§7).

## 5 · Keeping and space

The purge runs nightly at 02:10, before the backup.

| What | Kept | Why |
|---|---|---|
| `error_event` | 90 days | Long enough to see a fault that only fires at month end |
| `health_snapshot` | 30 days | The screen draws a week |
| `error_group` | Forever | A fault's history, and the decision somebody took on it, outlive the rows that raised it. A group is one row |
| `request_stat` | 30 days | A row a minute, about 43,000 a month, a few MB |
| `perf_sample` | 30 days | A row a minute, about 43,000 a month, under 10 MB |
| `route_stat` | 30 days | A row a quarter hour per route that was called; a few hundred thousand at most |
| `process_beat` | 30 days after its last beat | A row per process start |
| `performance_target` | Forever | One row, or none while the defaults apply |
| `schedule_run` | Forever | One row per job, 19 rows |

How much space it is using:

```
sudo -u postgres psql -d mycity_prod -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
     FROM pg_catalog.pg_statio_user_tables
    WHERE relname IN ('error_event', 'error_group', 'health_snapshot', 'request_stat', 'schedule_run',
                      'perf_sample', 'route_stat', 'process_beat') ORDER BY relname"
```

`health_snapshot` settles at roughly 8,600 rows. If `error_event` is growing past a gigabyte the
system is throwing far more than it should: open the screen and look at what is at the top.

## 6 · Giving somebody access later

Do not edit the seed and do not deploy. `system_health` is a module key like any other, so in the
app: **Settings · Roles & Permissions**, open the role, tick System Health, save. That is the whole
reason it is a permission and not a hard-coded role test.

## 7 · Investigating with an AI, and the mail when something is down

### 7.1 From the screen

Settings · Status, **Download Brief**. The Markdown file is the whole system, problems first, with
read-only commands written for this server. Paste it into Claude Code (with the repository checked
out, ideally) and follow it: the AI explains what is wrong first, asks you 4 to 10 questions, gives
you read-only commands to run over SSH and paste back, and changes nothing on the server until you
say yes to a block headed **Changes the server**. A bug in the code becomes a draft pull request; a
DNS, mail provider or GitHub change is walked through click by click.

The screen needs the API, the database and the worker to make that file. When one of them is down,
use one of the two below.

### 7.2 On the server, at once

```
cd /srv/mycity/prod/current
sudo node --env-file=/srv/mycity/prod/shared/.env scripts/ops/health-brief.js > ~/status.md
```

(`stg` for staging.) It builds the same file from whatever still answers, and adds what only the
server can see: the services, the timers with their last and next runs, cron, the last two hours of
warnings in the journal, the listening ports and the release in use. Copy `~/status.md` to your
computer (`scp`) and paste it into the AI. It prints nothing secret and changes nothing.

### 7.3 By mail, without running anything

`mycity-health-watch-prod.timer` and `mycity-health-watch-stg.timer` run that script every 5
minutes. When something is **down** (the API not answering, a check down, or no worker
heartbeat; amber never mails) for two readings in a row, it mails the brief to
`intelligence@jbspraxis.com`, copying `tomblakeasaah@gmail.com` and `praxisjbs@gmail.com`; again at
once if something else goes down; every hour while it stays down; and once with **All Clear** when
it recovers. Staging's subjects start `[STAGING]`.

**Once, to start it** (the timers are new; provisioning installs them, deploys do not). From the
checkout you provisioned from, after `git pull`:

```
sudo install -m 644 ops/systemd/mycity-health-watch-{prod,stg}.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mycity-health-watch-prod.timer mycity-health-watch-stg.timer
systemctl list-timers 'mycity-health-watch-*'
```

Or run `sudo bash ops/provision/provision.sh` again, which is safe to repeat and now installs them.
Each one skips itself until a release carrying `scripts/ops/health-brief.js` is deployed.

**Who it mails** is `HEALTH_ALERT_TO` and `HEALTH_ALERT_CC` in the environment's `.env`; left out,
they are the addresses above. Set `HEALTH_ALERT_TO=` (empty) to stop an environment mailing.

**Checking it is alive:**

```
sudo journalctl -u mycity-health-watch-prod -n 20 --no-pager
sudo cat /var/lib/mycity-health-watch-prod/state.json
```

Each run logs one line, `nothing red` or what was red. The state file is what it remembers between
runs (how many red readings in a row, and when it last mailed). Deleting it is safe: the next run
starts afresh.

**When mail itself fails**, it posts one line to `ALERT_WEBHOOK_URL` if that is set (never to
WhatsApp) and tries the mail again at the next reading.

**What it cannot cover:** the whole server being off or unreachable. Nothing on it can mail then;
the uptime probe from outside (`docs/runbooks/monitoring.md` §2) is what notices (TB, 20/10/2026).

## 8 · Performance: the two things the server needs

Everything on Settings · Performance works after the deploy except two parts, which need
`provision.sh` run again on the server (TB, 20/10/2026). Until then the Disk card shows total,
used and left but its parts read Not Measured, and Database · Slowest Queries reads Not Turned On.

```
cd /path/to/a/checkout && git pull
sudo bash ops/provision/provision.sh
```

It is safe to run again (it says so at its top). For this release it does two things:

**If a run stopped at step 6 with `line 194: $1: unbound variable`** (the first version of this
release, 20/10/2026), it had already emptied `/etc/postgresql/16/main/conf.d/mycity.conf` before
it stopped. PostgreSQL keeps running on the settings it started with, so nothing breaks at once,
but a restart before the file is written again would start it on the defaults (100 connections,
a 128 MB cache). Pull and run the fixed script, or the previous one, before PostgreSQL restarts
for any reason, then check the file is full again:

```
sudo cat /etc/postgresql/16/main/conf.d/mycity.conf      # max_connections = 200 and the rest
```


| What | Why | Cost |
|---|---|---|
| Adds `shared_preload_libraries = 'pg_stat_statements'` to `/etc/postgresql/16/main/conf.d/mycity.conf` and creates the extension in `mycity_prod` and `mycity_stg` | Slowest Queries: each statement's time, normalised (`$1`, never the values), this environment's role only | **One PostgreSQL restart**, a few seconds in which both environments cannot reach the database. Do it outside working hours; the API answers 503 for those seconds and recovers on its own |
| Installs `/srv/mycity/bin/mycity-host-stats` and starts `mycity-host-stats.timer` (every 15 minutes) | The Disk card's parts (each environment's database and files, backups, logs), Restart Needed and Updates Waiting. Production's service user cannot read staging's files or the backups, so a root timer measures them into `/var/lib/mycity/host-stats.json` | `du` over the media and backup folders at idle I/O priority |

Check both afterwards:

```
sudo -u postgres psql -d mycity_prod -c "SELECT count(*) FROM pg_stat_statements"   # a number, not an error
systemctl list-timers mycity-host-stats.timer                                         # a next run within 15 minutes
cat /var/lib/mycity/host-stats.json                                                   # sizes in bytes
```

Nothing else on the page needs the server: processor, memory, disk, disk activity and network
come from `/proc` and each service's cgroup, which the service users can already read.

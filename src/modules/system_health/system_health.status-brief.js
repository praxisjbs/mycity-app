"use strict";
/**
 * The Status brief: the whole system as one Markdown file, problems first, written so
 * that an AI assistant can take a server that is not well back to well without being
 * told anything else (docs/guides/system-health.md §6). Made three ways, from the same
 * build(): Download Brief on Settings · Status (the worker writes it), `npm run
 * health:brief` on the server, and the server's health watcher, which mails it.
 *
 * What it makes the AI do, in order: understand the problem before anything else; ask
 * the owner 4 to 10 questions; gather evidence with read-only commands the owner runs
 * over SSH and pastes back; change the server only with a yes, one block at a time; fix
 * a bug in the code through a draft pull request, exactly as the Faults brief does; walk
 * the owner by hand through what no command can do; prove it is well; write it up.
 *
 * It carries no stacks: each open fault is one line, and the Faults brief has the rest.
 * Its standing instructions are the Faults brief's own pieces (system_health.brief.js),
 * so the two files never disagree about how this repository is changed.
 *
 * Nothing in it is a secret. Every string has been through observability/scrub.js, and
 * every command it suggests reads one setting at a time, never a whole settings file.
 */
const shared = require("./system_health.brief");
const { inWords } = require("../../jobs/report");

const { fence, oneLine, when } = shared;

const SHORT = { production: "prod", staging: "stg" };
const STATE = { up: "Up", degraded: "Degraded", down: "Down" };
const SERVICE = { ready: "Ready", degraded: "Degraded", unavailable: "Unavailable" };
const JOB = { on_time: "On time", failing: "Failing", late: "Late", waiting: "Not due yet" };
const SEVERITY = { fatal: "Crash", error: "Error", warning: "Warning", notice: "Form refused" };
const ORIGIN = { server: "API", worker: "Worker", job: "Background job", browser: "Browser" };

/** Changes of state the file carries, newest first. The rest is on the screen. */
const MAX_CHANGES = 25;

/** A table cell: one line, no pipe that would end the cell early. */
const cell = (v) => (v === null || v === undefined || v === "" ? "" : oneLine(v).replace(/\|/g, "\\|"));
const at = (v) => (v ? `${when(v)} UTC` : "never");
const code = (v) => `\`${String(v).replace(/`/g, "'")}\``;
const lower = (v) => (v ? v.charAt(0).toLowerCase() + v.slice(1) : v);

/**
 * Since when, in words. A check with no since changed within the last five minutes only
 * while the snapshots are being taken; otherwise nobody knows when it changed.
 */
function sinceWords(c, ctx) {
  if (c.since) return `${at(c.since)} (${inWords(ctx.now - new Date(c.since).getTime())})`;
  return ctx.recording === false ? "not known: nothing has been recorded recently" : "within the last 5 minutes";
}

/** The same, as the end of a heading: "since ...", "changed within ...". */
const sincePhrase = (c, ctx) =>
  c.since || ctx.recording === false ? `since ${sinceWords(c, ctx)}` : `changed ${sinceWords(c, ctx)}`;

/**
 * Where everything is on this environment's server, from its own settings: the names a
 * command must use. Outside a server (a laptop, CI) the environment part is `<env>`.
 * @param {object} config  config/env's config
 */
function serverOf(config) {
  const env = SHORT[config.APP_ENV] || "<env>";
  const redis = /\/(\d+)\s*$/.exec(String(config.REDIS_URL || ""));
  return {
    on_server: Boolean(SHORT[config.APP_ENV]),
    app_env: config.APP_ENV,
    env,
    user: `mycity-${env}`,
    api_unit: `mycity-api-${env}`,
    worker_unit: `mycity-worker-${env}`,
    watch_unit: `mycity-health-watch-${env}`,
    release: `/srv/mycity/${env}/current`,
    env_file: `/srv/mycity/${env}/shared/.env`,
    media: config.MEDIA_ROOT || `/srv/mycity/${env}/media`,
    backups: `/srv/mycity/backups/${env}`,
    deploy_log: "~mycity-deploy/deploy-gate.log",
    database: config.DB_NAME || `mycity_${env}`,
    port: config.PORT || 7000,
    redis_db: redis ? redis[1] : "0",
    staff_origin: config.STAFF_ORIGIN || null,
  };
}

/* ------------------------------------------------------------------ *
 * The first commands for each check: read-only, written for this server
 * ------------------------------------------------------------------ */

const ready = (s, key) => `curl -s localhost:${s.port}/api/health/ready | jq '.checks.${key}'`;
const psql = (s, sql) => `sudo -u postgres psql -d ${s.database} -c "${sql}"`;
const journal = (unit, n = 100) => `sudo journalctl -u ${unit} -n ${n} --no-pager -o short-iso`;

/**
 * Each check's commands, written for this server: they change nothing. Records keyed by
 * the probe's name rather than an object, as CHECKS is in system_health.service.js, so
 * the `numbering` probe does not read as a document type to the numbering gate.
 */
const FIRST_LOOK = new Map([
  ["postgres", () => [
    "systemctl status postgresql --no-pager",
    "pg_isready",
    journal("postgresql", 50),
    "df -h /var/lib/postgresql",
  ]],
  ["redis", () => [
    "systemctl status redis-server --no-pager",
    journal("redis-server", 50),
    "ss -ltn '( sport = :6379 )'",
  ]],
  ["worker", (s) => [
    `systemctl status ${s.worker_unit} --no-pager`,
    journal(s.worker_unit, 150),
    ready(s, "worker"),
  ]],
  ["modules", (s) => [`${journal(s.api_unit, 300)} | grep -iE "module|skipped|failed to load"`, ready(s, "modules")]],
  ["migrations", (s) => [
    `${psql(s, "SELECT name, applied_at FROM schema_migration ORDER BY applied_at DESC")} | head -12`,
    `sudo tail -n 60 ${s.deploy_log}`,
  ]],
  ["numbering", (s) => [ready(s, "numbering"), `${journal(s.api_unit, 300)} | grep -i numbering`]],
  ["outbox", (s) => [
    ready(s, "outbox"),
    psql(
      s,
      "SELECT status, event_key, count(*), min(created_at) AS oldest, max(attempts) AS attempts FROM event_outbox WHERE status <> 'done' GROUP BY 1, 2 ORDER BY 3 DESC",
    ),
    `${psql(s, "SELECT event_key, attempts, left(last_error, 200) AS error, updated_at FROM event_outbox WHERE status = 'failed' ORDER BY updated_at DESC")} | head -25`,
  ]],
  ["storage", (s) => [
    `ls -ld ${s.media}`,
    `df -h ${s.media}`,
    `sudo -u ${s.user} test -w ${s.media} && echo writable || echo NOT writable`,
  ]],
  ["chromium", (s) => [ready(s, "chromium"), `sudo grep -E '^CHROMIUM_PATH=' ${s.env_file}`, "which chromium google-chrome google-chrome-stable"]],
  ["ffmpeg", (s) => [ready(s, "ffmpeg"), "ffmpeg -version | head -1", "ffprobe -version | head -1"]],
  ["clamd", (s) => ["systemctl status clamav-daemon --no-pager", journal("clamav-daemon", 50), ready(s, "clamd")]],
  ["mail", (s) => [
    ready(s, "mail"),
    `sudo grep -E '^(SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|MAIL_FROM|MAIL_SEND_PER_HOUR)=' ${s.env_file}`,
    `sudo grep -c '^SMTP_PASSWORD=.' ${s.env_file}`,
    `${journal(s.worker_unit, 400)} | grep -iE "mail|smtp"`,
  ]],
  ["ai", (s) => [ready(s, "ai"), `sudo grep -E '^GEMINI_MODEL=' ${s.env_file}`, `sudo grep -c '^GEMINI_API_KEY=.' ${s.env_file}`]],
  ["static", (s) => [`ls -l ${s.release}/app/dist/index.html ${s.release}/public-app/dist/index.html`, ready(s, "static")]],
  ["disk", (s) => [
    "df -h",
    "sudo du -xh --max-depth=2 /srv/mycity 2>/dev/null | sort -h | tail -20",
    "sudo journalctl --disk-usage",
    `sudo du -sh /var/lib/postgresql ${s.backups} 2>/dev/null`,
  ]],
  ["memory", () => ["free -h", "ps -eo pid,user,rss,etime,comm --sort=-rss | head -15"]],
  ["cpu", () => ["uptime", "nproc", "ps -eo pid,user,pcpu,etime,comm --sort=-pcpu | head -15"]],
  ["database_usage", (s) => [
    psql(
      s,
      "SELECT state, application_name, count(*), max(now() - state_change) AS longest FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2 ORDER BY 3 DESC",
    ),
    psql(s, "SELECT pg_size_pretty(pg_database_size(current_database())) AS size, current_setting('max_connections') AS allowed"),
  ]],
  ["schedulers", (s) => [
    psql(s, "SELECT name, last_run_at, ok, runs, failures, left(note, 120) AS note, created_at FROM schedule_run ORDER BY last_run_at NULLS FIRST"),
    `systemctl status ${s.worker_unit} --no-pager`,
    `${journal(s.worker_unit, 400)} | grep -iE "schedul|tick|cron"`,
  ]],
]);

/** The commands to start from for one check. A check this file does not know gets its probe. */
function firstLook(key, server) {
  return (FIRST_LOOK.get(key) || ((s) => [ready(s, key)]))(server);
}

/* ------------------------------------------------------------------ *
 * The instructions
 * ------------------------------------------------------------------ */

function instructions(count, server) {
  const problems = count === 1 ? "this problem" : "these problems";
  return `## Your job

You are investigating the health of a running **MyCity App ERP** server
(\`tomblakeasaah196/mycity-app\`): an Express and PostgreSQL API and a worker on one Ubuntu
server, behind nginx, with Redis for sessions and queues and systemd running everything.
${count ? `Take ${problems} from this report to a system that is well again, without making anything worse on the way.` : "Nothing is down. Read it as a record of a healthy system, and say if anything in it still looks wrong."}

1. **Understand it before you do anything.** Read this whole file first. Then, in your first
   reply and before any command or fix:
   - say each problem in one line, and what in this file shows it;
   - give the likely causes of each, ranked, with how sure you are and what would prove or
     rule each one out;
   - look for one cause behind several symptoms before treating them apart. A full disk stops
     the database; a database that is down stops the worker; a worker that is down makes every
     background job late and every queue back up. Fix the first domino, not the last. The
     **Changes over the last 7 days** table says what went first;
   - say what you still do not know.
   Propose no fix yet. A fix chosen before the cause is understood is a guess, and on a
   production server a wrong guess costs more than the fault.

2. ${shared.learnStep(`Then \`docs/guides/system-health.md\`
   (what each check measures and what its states mean), \`docs/runbooks/system-health.md\`,
   \`docs/runbooks/monitoring.md\`, \`docs/runbooks/incident.md\`, and \`docs/SYSTEM_ARCHITECTURE.md\`
   §1, §2 and §9 to §11 (the server, its processes, the release and its checks).`)}
   Without the repository, work from this file and say that you are.

3. ${shared.questionsStep("Run no command that changes anything, and change no code, until the owner has answered.", "the problems")}
   Questions that usually change an investigation: what changed recently (a deploy, a server
   update, a settings edit, a new integration); whether staging shows the same; how urgent it is
   and what may be restarted during working hours; who has \`sudo\` on the server; what the owner
   sees from outside (the site, mail, phones).

4. **Gather evidence with read-only commands, and have the owner paste back what they print.**
   You cannot see the server. The owner runs what you give them in an SSH session and pastes
   the output back to you. So:
   - give at most 5 commands at a time, each in its own numbered fenced block headed
     **Read-only**, with one line on what it shows and what you expect it to print if your
     leading cause is right;
   - use the exact names in **The server** below (units, paths, port, database), never another
     environment's, and start from the **First look** under each problem: they are written for
     this server;
   - never print a secret. Never \`cat\` a \`.env\`, a key or anything holding a password: read one
     setting with \`sudo grep -E '^NAME=' ${server.env_file}\`, or whether a secret is set at all
     with \`sudo grep -c '^NAME=.' ${server.env_file}\`. Never ask the owner for a password, a token
     or a key; if one appears in pasted output, tell them to change it;
   - read what comes back before asking for more: say what it proved and what it ruled out,
     then narrow. Stop gathering once the cause is proven.

5. **Change the server only with a yes.** A command that changes anything (a restart, an edit,
   a deletion, freeing space, a package, a permission, a rollback) goes in its own block headed
   **Changes the server**, with what it changes, what could go wrong, how to undo it, and the
   command that proves it worked. Then stop, and run nothing in it until the owner says yes to
   that block. One change at a time, proven before the next. On this server:
   - prefer the runbook's way to an improvised one: \`docs/runbooks/rollback.md\` to go back a
     release, \`docs/runbooks/incident.md\` for an outage, \`docs/runbooks/backup-restore.md\`
     before anything near the data;
   - never drop, truncate or delete production data, and never restore a backup over production
     unless the owner says so in as many words;
   - never run a migration by hand: only the deploy gate runs them (\`docs/runbooks/deploy.md\`);
   - never edit a file under \`${server.release}\`: a release is sealed by checksums and the next
     deploy replaces it. A change to the code is a pull request (step 6);
   - restart the app with \`sudo systemctl restart ${server.api_unit}\` or
     \`${server.worker_unit}\`. PostgreSQL and Redis serve production and staging at once: say so
     before asking to restart either.

6. **A bug in the code is fixed in the code.** When the evidence points into the repository (a
   handler that throws, a job that never finishes, a probe that judges wrong), fix it through a
   draft pull request, as the Faults brief does. Find the cause and reproduce it, ideally as a
   failing test, before you change anything. If it is also listed under **Open faults**, ask the
   owner for the Faults brief (Settings · Faults, tick it, Download Brief): it has the stack and
   the occurrences this file leaves out.
   - **Fix it.** The smallest change that removes the cause, written like the code around it. ${shared.RULES}
   - ${shared.CHECK_STEP}
   - ${shared.PAPERWORK_STEP}
   - ${shared.pullRequestStep(`the cause, the evidence from the server, the fix,
   and how the owner checks it (which screen or command, and what they should now see).`)}

7. **What no command can do, walk the owner through by hand.** DNS records, the mail provider's
   panel, GitHub settings and secrets, the hosting provider's console, a certificate: give
   numbered steps, each one place to go, what to press and what they should see there, and
   after the last step the command or the screen that proves it took effect.

8. **Prove it is well.** For each problem: the command whose output shows it is fixed, and what
   Settings · Status should show within 5 minutes (the check Up, and its sheet showing the change
   in its history). A problem is not fixed until that has been seen.

9. **Write it up in a few lines:** the cause, what was changed, what is left, what to watch for.
   If the runbooks did not cover it, write the paragraph \`docs/runbooks/\` was missing, in the pull
   request if there is one.`;
}

/* ------------------------------------------------------------------ *
 * The sections
 * ------------------------------------------------------------------ */

function serverSection(s, release, deployedAt) {
  const out = ["## The server", ""];
  if (!s.on_server) {
    out.push(
      `This file was made outside a server (\`APP_ENV=${s.app_env}\`), so \`<env>\` below stands for \`prod\` or \`stg\`.`,
      "",
    );
  }
  out.push("| | |", "|---|---|");
  out.push(`| Environment | ${s.app_env} (\`APP_ENV=${s.app_env}\`) |`);
  if (s.staff_origin) out.push(`| Staff app | ${s.staff_origin} |`);
  out.push(`| API on the server | \`http://localhost:${s.port}\`, readiness at \`/api/health/ready\` |`);
  out.push(`| Build | \`${release || "unknown"}\`${deployedAt ? `, built ${at(deployedAt)}` : ""} |`);
  out.push(`| Units | \`${s.api_unit}\`, \`${s.worker_unit}\`, \`${s.watch_unit}.timer\` |`);
  out.push(`| Runs as | \`${s.user}\` |`);
  out.push(`| Release in use | \`${s.release}\` (sealed: never edit it) |`);
  out.push(`| Settings | \`${s.env_file}\` (holds secrets: read one line at a time) |`);
  out.push(`| Media | \`${s.media}\` |`);
  out.push(`| Database | \`${s.database}\` on PostgreSQL 16: \`sudo -u postgres psql -d ${s.database}\` |`);
  out.push(`| Redis | database ${s.redis_db} on \`127.0.0.1:6379\` |`);
  out.push(`| Logs | \`sudo journalctl -u ${s.api_unit}\`, \`sudo journalctl -u ${s.worker_unit}\` |`);
  out.push(`| Deploy log | \`${s.deploy_log}\` |`);
  out.push(`| Backups | \`${s.backups}\`, nightly at 02:30 Lagos (\`mycity-backup.timer\`) |`);
  return out;
}

function glanceSection(input, problems) {
  const out = ["## At a glance", ""];
  out.push(`- **State:** ${SERVICE[input.state] || input.state}, ${problems.length} ${problems.length === 1 ? "check" : "checks"} not up of ${input.checks.length}.`);
  if (input.api) {
    out.push(
      input.api.answering
        ? "- **API:** answering. The checks below are the API's own."
        : `- **API:** not answering (${cell(input.api.error || "no reply")}). The checks below were run by the server script itself, so Modules could not be checked.`,
    );
  }
  if (input.faults) out.push(`- **Open faults:** ${input.faults.total}.`);
  if (input.last24) {
    out.push(
      `- **Last 24 hours:** every check up ${input.last24.uptime_pct}% of the time; ${input.last24.gap_minutes} minutes without a snapshot.${input.last24.recording ? "" : " **Nothing is recording now:** the five-minute job is not running."}`,
    );
  }
  return out;
}

/** The jobs a problem is about, as a table. */
function jobsTable(jobs) {
  const out = [
    "| Job | Set as | In words | Last run | Took | Result | Runs, failures | Next | State | Why |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const j of jobs) {
    out.push(
      `| \`${j.name}\` | \`${cell(j.set_as)}\` | ${cell(j.cadence)} | ${at(j.last_run_at)} | ${j.duration_ms === null ? "" : `${j.duration_ms} ms`} | ${j.last_ok === null ? "" : j.last_ok ? "ok" : "failed"} | ${j.runs}, ${j.failures} | ${j.next_run_at ? at(j.next_run_at) : ""} | ${JOB[j.state] || j.state} | ${cell(j.reason)} |`,
    );
  }
  return out;
}

function queuesTable(queues) {
  const out = ["| Queue | Waiting | Active | Delayed | Failed, kept | Newest failure |", "|---|---|---|---|---|---|"];
  for (const q of queues) {
    out.push(
      `| \`${q.queue}\` | ${q.waiting} | ${q.active} | ${q.delayed} | ${q.failed} | ${q.last_failure ? `${at(q.last_failed_at)}: ${cell(q.last_failure).slice(0, 200)}` : ""} |`,
    );
  }
  return out;
}

function problemSection(c, n, input, server) {
  const out = ["", `### ${n} · ${c.label}: ${(STATE[c.state] || c.state).toLowerCase()}, ${sincePhrase(c, input)}`, ""];
  out.push(`- **It says:** ${oneLine(c.detail)}`);
  if (c.look_at) out.push(`- **What that means:** ${oneLine(c.look_at)}`);
  out.push(`- **Probe key:** \`${c.key}\``);
  if (c.facts && c.facts.length) {
    out.push(`- **What its probe measured:** ${c.facts.map((f) => `${f.label} ${code(f.value)}`).join(", ")}`);
  }

  if (c.key === "schedulers" && input.jobs) {
    const unwell = input.jobs.jobs.filter((j) => j.state === "late" || j.state === "failing");
    if (unwell.length) out.push("", "**The jobs that are not on time:**", "", ...jobsTable(unwell));
    const errors = unwell.filter((j) => j.last_error);
    if (errors.length) {
      out.push("", "**Their last errors:**", "");
      for (const j of errors) out.push(`- \`${j.name}\` at ${at(j.last_failure_at)}:`, "", fence(j.last_error), "");
    }
  }
  if (c.key === "worker" && input.queues && input.queues.queues.length) {
    const busy = input.queues.queues.filter((q) => q.waiting || q.active || q.delayed || q.last_failure);
    if (busy.length) out.push("", "**Queues with work in them or a failure:**", "", ...queuesTable(busy));
  }

  out.push("", "**First look** (read-only, written for this server):", "", fence(firstLook(c.key, server).join("\n")));
  return out;
}

function checksSection(checks, ctx) {
  const out = ["## Every check", "", "| Check | Key | State | Since | It says |", "|---|---|---|---|---|"];
  for (const c of checks) {
    out.push(`| ${cell(c.label)} | \`${c.key}\` | ${STATE[c.state] || c.state} | ${sinceWords(c, ctx)} | ${cell(c.detail)} |`);
  }
  return out;
}

function jobsSection(jobs) {
  const out = ["## Background jobs", ""];
  if (!jobs) return [...out, "_Not read._"];
  out.push(
    "Every scheduler the worker runs. **Set as** is what the code declared (`jobs/schedulers/<name>.js`); a job is late after **Late after** without a run, counted from its last run or, before its first, from when the worker first started it. `worker` jobs run on a timer inside every worker; `queue` jobs are ticked once across processes by the schedule queue.",
    "",
  );
  if (jobs.db_error) out.push(`_Their runs could not be read: ${cell(jobs.db_error)}._`, "");
  if (jobs.queue_error) out.push(`_The schedule queue could not be read, so no next tick is known: ${cell(jobs.queue_error)}._`, "");
  out.push(
    "| Job | What it does | Set as | In words | Runs in | Late after | Started | Last run | Took | Result | Runs, failures | Next | State |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const j of jobs.jobs) {
    out.push(
      `| \`${j.name}\` | ${cell(j.summary)} | \`${cell(j.set_as)}\` | ${cell(j.cadence)} | ${j.runs_in} | ${j.late_after} | ${at(j.started_at)} | ${at(j.last_run_at)} | ${j.duration_ms === null ? "" : `${j.duration_ms} ms`} | ${j.last_ok === null ? "" : j.last_ok ? "ok" : "failed"} | ${j.runs}, ${j.failures} | ${j.next_run_at ? at(j.next_run_at) : ""} | ${JOB[j.state] || j.state}${j.reason ? `: ${lower(cell(j.reason))}` : ""} |`,
    );
  }
  const errors = jobs.jobs.filter((j) => j.last_error && j.state !== "late" && j.state !== "failing");
  if (errors.length) {
    out.push("", "Jobs whose last run failed but are not counted as a problem yet:", "");
    for (const j of errors) out.push(`- \`${j.name}\` at ${at(j.last_failure_at)}: ${code(j.last_error)}`);
  }
  return out;
}

function queuesSection(queues) {
  const out = ["## Queues", ""];
  if (!queues) return [...out, "_Not read._"];
  if (queues.error) return [...out, `_Could not be read: ${cell(queues.error)}._`];
  out.push("Every BullMQ queue the worker consumes. **Failed, kept** is every failed job still kept (the last 5,000), not today's.", "");
  return [...out, ...queuesTable(queues.queues)];
}

function changesSection(changes) {
  const out = ["## Changes over the last 7 days", ""];
  if (!changes) return [...out, "_Could not be read._"];
  if (!changes.rows.length) return [...out, "No check changed state in the last 7 days."];
  out.push("Newest first, from the five-minute snapshots. The oldest change is usually the cause; the rest follow it.", "");
  out.push("| When | Check | From | To | It said |", "|---|---|---|---|---|");
  for (const r of changes.rows.slice(0, MAX_CHANGES)) {
    out.push(`| ${at(r.at)} | ${cell(r.label)} | ${STATE[r.from] || r.from} | ${STATE[r.to] || r.to} | ${cell(r.detail)} |`);
  }
  if (changes.total > MAX_CHANGES) {
    out.push("", `${changes.total - MAX_CHANGES} older changes are not in this file: each check's sheet on Settings · Status has them all.`);
  }
  return out;
}

function last24Section(p) {
  const out = ["## The last 24 hours", ""];
  if (!p) return [...out, "_Could not be read._"];
  out.push(`- Every check up ${p.uptime_pct}% of the time; ${p.gap_minutes} minutes without a snapshot.`);
  out.push(`- Newest snapshot: ${at(p.last_snapshot_at)}.${p.recording ? "" : " **Nothing is recording**: the five-minute `system-health` job is not running."}`);
  const latest = [...(p.points || [])].reverse().find((x) => x.requests !== null || x.disk_free_pct !== null);
  if (latest) {
    const bits = [];
    if (latest.requests !== null) bits.push(`${latest.requests} requests, mean ${latest.mean_ms} ms, ${latest.error_pct || "0"}% failed`);
    if (latest.disk_free_pct !== null) bits.push(`disk ${latest.disk_free_pct}% free`);
    if (latest.memory_used_pct !== null) bits.push(`memory ${latest.memory_used_pct}% used`);
    if (latest.cpu_load !== null) bits.push(`load ${latest.cpu_load} per core`);
    if (latest.database_mb !== null) bits.push(`database ${latest.database_mb} MB`);
    out.push(`- The newest hour (${at(latest.at)}): ${bits.join(", ")}.`);
  }
  return out;
}

function faultsSection(faults) {
  const out = ["## Open faults", ""];
  if (!faults) return [...out, "_Could not be read._"];
  if (!faults.rows.length) return [...out, "None open."];
  out.push(
    "What the code reported, one line each. The stacks and occurrences are in the Faults brief (Settings · Faults, tick them, Download Brief): ask the owner for it when one of these looks like the cause.",
    "",
    "| Fault | Kind | Where | Today | On record | Last seen | Status |",
    "|---|---|---|---|---|---|---|",
  );
  for (const g of faults.rows) {
    out.push(
      `| ${cell(g.title).slice(0, 120)} | ${SEVERITY[g.severity] || g.severity} | ${ORIGIN[g.origin] || g.origin}${g.route ? ` ${code(g.route)}` : ""} | ${g.today} | ${g.total} | ${at(g.last_seen_at)} | ${g.came_back ? "came back" : g.status} |`,
    );
  }
  if (faults.total > faults.rows.length) out.push("", `${faults.total - faults.rows.length} more open faults are on Settings · Faults.`);
  return out;
}

function hostSection(host) {
  const out = ["## On the server", "", "Read by the server script itself, as the user named under each command."];
  for (const h of host) {
    out.push("", `### ${h.title}`, "", `\`${h.command}\``, "");
    out.push(h.output ? fence(h.output) : `_Nothing came back${h.error ? `: ${cell(h.error)}` : ""}._`);
  }
  return out;
}

/**
 * The whole file.
 * @param {object} input
 *   now        Date the brief was made
 *   made       { how: "screen"|"server"|"watch", by?: string|null }
 *   config     config/env's config, for the server's names
 *   release, deployed_at
 *   state      ready, degraded or unavailable
 *   checks     [{ key, label, state, detail, look_at, since, facts }]
 *   api        { answering, error } when the server script asked the API; null otherwise
 *   jobs       report.schedulers()'s result
 *   queues     report.queues()'s result
 *   changes    { rows: [{ at, key, label, from, to, detail }], total } | null
 *   last24     performance("24h") | null
 *   faults     { rows: FaultRow[], total } | null
 *   host       [{ title, command, output, error }] from the server script | null
 *   unread     what could not be read, in words
 * @returns {string}
 */
function build(input) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const ctx = { ...input, now: now.getTime(), recording: input.last24 ? input.last24.recording : null };
  const server = serverOf(input.config || {});
  const problems = input.checks.filter((c) => c.state !== "up");
  const how = (input.made && input.made.how) || "screen";
  const by = input.made && input.made.by;
  const md = [];

  const title = problems.length
    ? `${problems.length} ${problems.length === 1 ? "problem" : "problems"}: ${problems.map((c) => c.label).join(", ")}`
    : "nothing down";
  md.push(`# MyCity system status, ${server.app_env}: ${title}`);
  md.push("");
  md.push(
    {
      screen: `Downloaded from MyCity App, Settings · Status, on ${when(now)} UTC${by ? ` by ${by}` : ""}.`,
      server: `Made on the server by \`npm run health:brief\` on ${when(now)} UTC.`,
      watch: `Mailed by the server's health watch (\`${server.watch_unit}.timer\`) on ${when(now)} UTC, because something is down.`,
    }[how],
  );
  md.push("");
  md.push(
    "Paste this whole file into an AI assistant, ideally Claude Code with the repository checked out. It carries its own instructions: work through them in order, and stop where they say to wait for the owner.",
  );
  md.push("");
  md.push("Nothing here is a secret or names a person: every message has been scrubbed, and no command in it prints a password.");
  md.push("");
  md.push(instructions(problems.length, server));
  md.push("");
  md.push(...serverSection(server, input.release, input.deployed_at));
  md.push("");
  md.push(...glanceSection(input, problems));
  md.push("");
  md.push("## What is wrong");
  if (!problems.length) {
    md.push("", "Every check is up.");
  } else {
    md.push("", "Worst first. Each says what its probe found, what that means, and the read-only commands to start from.");
    const order = { down: 0, degraded: 1 };
    [...problems]
      .sort((a, b) => order[a.state] - order[b.state])
      .forEach((c, i) => md.push(...problemSection(c, i + 1, ctx, server)));
  }
  md.push("");
  md.push(...checksSection(input.checks, ctx));
  md.push("");
  md.push(...jobsSection(input.jobs));
  md.push("");
  md.push(...queuesSection(input.queues));
  md.push("");
  md.push(...changesSection(input.changes));
  md.push("");
  md.push(...last24Section(input.last24));
  md.push("");
  md.push(...faultsSection(input.faults));
  if (input.host && input.host.length) {
    md.push("");
    md.push(...hostSection(input.host));
  }
  if (input.unread && input.unread.length) {
    md.push("", "## What could not be read", "", "An empty table above may be one of these, not an empty system:", "");
    for (const u of input.unread) md.push(`- ${oneLine(u)}`);
  }
  md.push("");
  return md.join("\n");
}

module.exports = { build, instructions, serverOf, firstLook, FIRST_LOOK, MAX_CHANGES };

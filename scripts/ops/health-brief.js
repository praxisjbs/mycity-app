#!/usr/bin/env node
"use strict";
/**
 * The Status brief, made on the server (docs/runbooks/system-health.md §7): the same file
 * Download Brief writes on Settings · Status, built from whatever still answers, for when
 * the screen cannot make it because the API, the database or the worker is what is down.
 *
 *   sudo node --env-file=/srv/mycity/prod/shared/.env scripts/ops/health-brief.js > status.md
 *   npm run health:brief                         a laptop, with the checkout's .env
 *   ... --out=/tmp/status.md                     write a file rather than print
 *   ... --watch --state=<file>                   the timer's mode: mail when something is down
 *
 * Run from the release (`cd /srv/mycity/<env>/current`). What it adds to the screen's
 * file is what only the server can see: systemd's units and timers, cron, the journal's
 * recent warnings, the listening ports and the release in use. As root it reads all of
 * it; as the service user the journal needs the systemd-journal group (the watch unit
 * gives it), and anything it could not read says so.
 *
 * Watch mode (mycity-health-watch-<env>.timer, every 5 minutes). Red is the API not
 * answering, a check reporting `down`, or no worker heartbeat; amber stays on the screen
 * and the bell. It mails HEALTH_ALERT_TO, copying HEALTH_ALERT_CC, with the brief attached:
 *   - after two red readings in a row, so a deploy's restart never sends one;
 *   - at once when something else goes red;
 *   - every hour while anything stays red;
 *   - once, All Clear, after two clean readings.
 * Its memory is one small JSON file (--state). Mail goes through the system mailer's plain
 * sender, which needs neither the database nor Redis. When even that fails, one line goes
 * to ALERT_WEBHOOK_URL (never WhatsApp, guide §7) and the mail is tried again next time.
 *
 * It never prints a secret and never reads a whole settings file: every line it collects
 * goes through observability/scrub.js. It exits 0 whatever it found, so a red system does
 * not read as a failed timer; it exits 1 only when it could not do its own job.
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const WATCH = flag("watch");
const OUT = value("out");

// The brief may be printed: no log line may land in the middle of it.
if (!WATCH && !OUT) process.env.LOG_LEVEL = "silent";
else if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "warn";

const HOUR_MS = 60 * 60_000;
const API_TIMEOUT_MS = 4000;
const COMMAND_TIMEOUT_MS = 5000;
const REDIS_TIMEOUT_MS = 3000;
/** How much of one command's output the brief keeps: the end, where the news is. */
const OUTPUT_LINES = 60;

const say = (line) => process.stderr.write(`health-brief: ${line}\n`);

/* ------------------------------------------------------------------ *
 * Reading the system
 * ------------------------------------------------------------------ */

/**
 * The API's own readiness, over its local port. A 503 is an answer: the API is up and
 * says the database is not. No answer at all is the API being down.
 * @returns {Promise<{answering: boolean, checks: object|null, error: string|null}>}
 */
function askApi(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health/ready", timeout: API_TIMEOUT_MS }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve({ answering: true, checks: json.checks || {}, error: null });
        } catch {
          resolve({ answering: false, checks: null, error: `answered ${res.statusCode} without its health JSON` });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`no answer within ${API_TIMEOUT_MS} ms`)));
    req.on("error", (err) => resolve({ answering: false, checks: null, error: String(err.code || err.message) }));
  });
}

/** Connect the shared Redis client, giving up after a few seconds rather than waiting forever. */
async function connectRedis() {
  const redis = require("../../src/config/redis");
  try {
    let t;
    await Promise.race([
      redis.initRedis(),
      new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error("Redis did not answer")), REDIS_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(t));
  } catch (err) {
    say(`redis: ${err.message}`);
  }
}

/**
 * The checks: the API's when it answers, otherwise run here. Here, nothing is mounted, so
 * Modules is reported as not checked rather than as an empty success.
 */
async function readChecks(config) {
  const api = await askApi(config.PORT);
  if (api.answering) return { api, checks: api.checks };
  const { runChecks } = require("../../src/http/health");
  const { checks } = await runChecks();
  checks.modules = { status: "degraded", error: "not checked: only the API mounts the modules, and it is not answering" };
  return { api, checks };
}

/** What counts as red for mail: the API silent, a check down, or no worker alive. */
function redOf({ api, checks }) {
  const service = require("../../src/modules/system_health/system_health.service");
  const red = [];
  if (!api.answering) red.push({ key: "api", label: "API", detail: `not answering (${api.error || "no reply"})` });
  for (const [key, v] of Object.entries(checks || {})) {
    if (!v) continue;
    if (v.status === "down") red.push({ key, label: service.label(key), detail: service.detailOf(key, v) });
    else if (key === "worker" && Number(v.workers) === 0)
      red.push({ key, label: service.label(key), detail: `no heartbeat${v.error ? ` (${v.error})` : ""}` });
  }
  return red;
}

/** Run one command with no shell, and keep the end of what it printed, scrubbed. */
function run(cmd, args) {
  const { scrub } = require("../../src/shared/observability/scrub");
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stdout || "").trim() || String(stderr || "").trim();
      const tail = text.split("\n").slice(-OUTPUT_LINES).join("\n");
      resolve({
        output: tail ? scrub(tail) : "",
        error: err && !text ? scrub(String(err.code === "ENOENT" ? `${cmd} is not installed` : err.message)).slice(0, 200) : null,
      });
    });
  });
}

/** What only the server can see. Read-only, every one of them. */
async function hostFacts(s) {
  const asWho = (await run("id", ["-un"])).output || "unknown";
  const list = [
    ["The services", "systemctl", ["is-active", s.api_unit, s.worker_unit, "postgresql", "redis-server", "clamav-daemon", "nginx"]],
    ["Timers (when each last ran and runs next)", "systemctl", ["list-timers", "--all", "--no-pager", "mycity-*"]],
    ["Units that failed", "systemctl", ["--failed", "--no-pager", "--plain"]],
    [
      "Warnings in the last 2 hours",
      "journalctl",
      ["-u", s.api_unit, "-u", s.worker_unit, "-p", "warning", "--since", "-2h", "-n", String(OUTPUT_LINES), "--no-pager", "-o", "short-iso"],
    ],
    ["Cron, this user", "crontab", ["-l"]],
    ["Cron, the system", "ls", ["-l", "/etc/cron.d"]],
    ["The release in use", "readlink", ["-f", s.release]],
    ["Disk", "df", ["-h"]],
    ["Memory", "free", ["-h"]],
    ["Load", "uptime", []],
    ["Listening ports", "ss", ["-ltn"]],
    ["PostgreSQL", "pg_isready", []],
  ];
  const out = [];
  for (const [title, cmd, args] of list) {
    const r = await run(cmd, args);
    out.push({ title: `${title} (as ${asWho})`, command: [cmd, ...args].join(" "), output: r.output, error: r.error });
  }
  return out;
}

/** The whole brief, from whatever answers. */
async function makeBrief({ config, seen, how }) {
  const service = require("../../src/modules/system_health/system_health.service");
  const statusBrief = require("../../src/modules/system_health/system_health.status-brief");
  const server = statusBrief.serverOf(config);
  const input = await service.statusBriefInput({ checks: seen.checks, api: seen.api });
  const host = server.on_server || flag("host") ? await hostFacts(server) : null;
  return statusBrief.build({ ...input, host, made: { how } });
}

/* ------------------------------------------------------------------ *
 * Watch mode
 * ------------------------------------------------------------------ */

/**
 * What to do with one reading, from what the watch remembers. Pure, so every rule in the
 * header is a test (tests/unit/foundation/operations.test.js).
 * @param {object} prev   the state file, or {}
 * @param {Array<{key: string}>} red  this reading's red
 * @param {number} now
 * @returns {{state: object, mail: null|"down"|"worse"|"still"|"clear"}}
 */
function decide(prev, red, now) {
  const s = { red_streak: 0, clear_streak: 0, down_since: null, mailed: null, ...(prev || {}) };
  const keys = [...new Set(red.map((r) => r.key))].sort();
  if (keys.length) {
    if (s.red_streak === 0) s.down_since = now;
    s.red_streak += 1;
    s.clear_streak = 0;
    if (s.red_streak < 2) return { state: s, mail: null };
    if (!s.mailed) return { state: s, mail: "down" };
    if (keys.some((k) => !s.mailed.keys.includes(k))) return { state: s, mail: "worse" };
    if (now - s.mailed.at >= HOUR_MS) return { state: s, mail: "still" };
    return { state: s, mail: null };
  }
  s.clear_streak += 1;
  s.red_streak = 0;
  if (s.mailed && s.clear_streak >= 2) return { state: s, mail: "clear" };
  if (!s.mailed) s.down_since = null;
  return { state: s, mail: null };
}

/** The state after a mail went out. */
function afterMail(state, kind, red, now) {
  if (kind === "clear") return { ...state, mailed: null, down_since: null };
  return { ...state, mailed: { keys: [...new Set(red.map((r) => r.key))].sort(), labels: red.map((r) => r.label), at: now } };
}

const addresses = (v) =>
  String(v || "")
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);

/** Subject and body of one mail. Plain text: it may be read on a phone, and the brief is attached. */
function mailOf(kind, { red, state, config, server, now }) {
  const { inWords } = require("../../src/jobs/report");
  const env = config.APP_ENV;
  const names = red.map((r) => r.label).join(", ");
  const fresh = state.mailed ? red.filter((r) => !state.mailed.keys.includes(r.key)).map((r) => r.label).join(", ") : names;
  const when = (ms) => `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  const subject = {
    down: `MyCity ${env} is down: ${names}`,
    worse: `MyCity ${env} is down, now also: ${fresh}`,
    still: `MyCity ${env} still down after ${inWords(now - (state.down_since || now))}: ${names}`,
    clear: `MyCity ${env} all clear: ${(state.mailed && state.mailed.labels.join(", ")) || "everything"} answering again`,
  }[kind];
  const where = `MyCity App, ${env}${server.staff_origin ? ` (${server.staff_origin})` : ""}. From the server's health watch, ${server.watch_unit}.timer.`;
  if (kind === "clear") {
    return {
      subject,
      text: [
        where,
        "",
        `Everything that was down is answering again, after ${inWords(now - (state.down_since || now))}.`,
        "Settings · Status shows each check's history. Nothing more will be mailed unless something goes down again.",
      ].join("\n"),
    };
  }
  return {
    subject,
    text: [
      where,
      "",
      "Down now:",
      ...red.map((r) => `- ${r.label}: ${r.detail}`),
      "",
      `Since: ${when(state.down_since || now)} (${inWords(now - (state.down_since || now))}).`,
      "",
      "What to do: open the attached Markdown file in an AI assistant, ideally Claude Code with the repository. It carries its own instructions. It will first explain what is wrong, then ask you questions, then give you read-only commands to run on the server and paste back. It changes nothing on the server without your yes.",
      "",
      "You will hear again in an hour if it is still down, at once if anything else goes down, and once when it is all clear.",
      "",
      `A fresh copy at any time, on the server: cd ${server.release} && sudo node --env-file=${server.env_file} scripts/ops/health-brief.js > status.md`,
    ].join("\n"),
  };
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Written whole or not at all, so a reading cut short never leaves half a file. */
function writeState(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

async function watch(config) {
  const file = value("state");
  if (!file) throw new Error("--watch needs --state=<file>");
  const statusBrief = require("../../src/modules/system_health/system_health.status-brief");
  const server = statusBrief.serverOf(config);
  const seen = await readChecks(config);
  const red = redOf(seen);
  const now = Date.now();
  const prev = readState(file);
  const { state, mail } = decide(prev, red, now);
  say(red.length ? `red: ${red.map((r) => r.key).join(", ")} (reading ${state.red_streak})` : "nothing red");

  if (!mail) return writeState(file, state);
  const to = addresses(config.HEALTH_ALERT_TO);
  if (!to.length) {
    say("HEALTH_ALERT_TO is empty: nothing is mailed");
    return writeState(file, state);
  }
  const { subject, text } = mailOf(mail, { red, state, config, server, now });
  try {
    const attachments = [];
    if (mail !== "clear") {
      const md = await makeBrief({ config, seen, how: "watch" });
      const stamp = new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, "");
      attachments.push({ filename: `mycity-status-${server.env}-${stamp}.md`, content: md, contentType: "text/markdown" });
    }
    const systemMail = require("../../src/services/mail/system-mail.service");
    await systemMail.sendPlain({ to, cc: addresses(config.HEALTH_ALERT_CC), subject, text, attachments });
    say(`mailed (${mail}) to ${to.length + addresses(config.HEALTH_ALERT_CC).length} recipients`);
    writeState(file, afterMail(state, mail, red, now));
  } catch (err) {
    // Not remembered as mailed, so the next reading tries again.
    say(`mail failed: ${err.message}`);
    const { send } = require("../../src/shared/observability/alert");
    await send(`${subject}. The health watch could not mail its brief (${String(err.code || err.message).slice(0, 120)}).`, {
      webhook: config.ALERT_WEBHOOK_URL,
      whatsapp: "",
    });
    writeState(file, state);
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const { config } = require("../../src/config/env");
  await connectRedis();
  if (WATCH) return watch(config);
  const seen = await readChecks(config);
  const md = await makeBrief({ config, seen, how: "server" });
  if (OUT) {
    fs.writeFileSync(OUT, md);
    say(`written to ${OUT}`);
  } else {
    process.stdout.write(md);
  }
}

async function close() {
  await Promise.allSettled([
    require("../../src/config/db").pool.end(),
    require("../../src/jobs/queues").closeQueues(),
    require("../../src/config/redis").closeRedis(),
  ]);
}

if (require.main === module) {
  main()
    .then(close)
    .then(() => process.exit(0))
    .catch(async (err) => {
      say(`could not finish: ${err && err.stack ? err.stack : err}`);
      await close();
      process.exit(1);
    });
}

module.exports = { decide, afterMail, redOf, mailOf, addresses, askApi, HOUR_MS };

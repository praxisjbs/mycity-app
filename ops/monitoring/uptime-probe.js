#!/usr/bin/env node
"use strict";
/**
 * Uptime probe: is MyCity up, as the outside world sees it (SYSTEM_ARCHITECTURE §11, MILESTONES
 * M11 "uptime monitoring live with alerting", docs/runbooks/monitoring.md §5).
 *
 *   node ops/monitoring/uptime-probe.js                      production's two hosts
 *   node ops/monitoring/uptime-probe.js --with-staging       and staging's
 *        --state=<file>     remember the last result, alert on changes only (see below)
 *        --json             print the results as JSON
 *
 * Run from OFF the server, or it proves nothing: .github/workflows/uptime.yml runs it on a
 * schedule from GitHub, and any other machine with Node 20 and a cron can run it as well.
 * Only Node's own modules and the repository's alert sender (src/shared/observability/alert.js)
 * are used.
 *
 * Each host is checked over HTTPS, through DNS, the firewall, nginx and TLS, like a person:
 *   hub.   GET /api/health/ready   200 with ok: true. A degraded check (mail, clamd...) is listed,
 *                                  not alerted: the app is serving
 *   go.    GET /api/health         200
 *   both   X-Mycity-Environment is the environment the host belongs to (a DNS or proxy mistake
 *          that sends production's name to staging is down, not up); the certificate has more
 *          than 14 days left (renewal runs at 30, so 14 means renewal is failing)
 * A failed check is tried again twice, 15 seconds apart, before the host counts as down.
 *
 * Alerts go to ALERT_WHATSAPP_URLS and ALERT_WEBHOOK_URL (environment variables here, repository
 * secrets in the workflow; observability/alert.js says what they hold). With --state the probe alerts when a host goes down, every hour
 * while it stays down, once when it recovers, and once a day per expiring certificate; without
 * it, on every run that finds a problem. Exit 1 when any host is down.
 */
const fs = require("node:fs");
const tls = require("node:tls");
const sender = require("../../src/shared/observability/alert");

const TARGETS = [
  {
    name: "hub.mycityapp.io",
    env: "production",
    path: "/api/health/ready",
    ready: true,
  },
  { name: "go.mycityapp.io", env: "production", path: "/api/health" },
];
const STAGING = [
  {
    name: "hub.staging.mycityapp.io",
    env: "staging",
    path: "/api/health/ready",
    ready: true,
  },
  { name: "go.staging.mycityapp.io", env: "staging", path: "/api/health" },
];
const TIMEOUT_MS = 10000;
const CERT_MIN_DAYS = 14;
const REALERT_MS = 60 * 60 * 1000;
const CERT_REALERT_MS = 24 * 60 * 60 * 1000;
const RETRIES = Number(process.env.PROBE_RETRIES ?? 2);
const RETRY_MS = Number(process.env.PROBE_RETRY_MS ?? 15000);

function parseArgs(argv) {
  const out = { staging: false, state: null, json: false };
  for (const a of argv) {
    if (a === "--with-staging") out.staging = true;
    else if (a === "--json") out.json = true;
    else if (a.startsWith("--state=") && a.length > 8) out.state = a.slice(8);
    else
      throw new Error(
        `unknown argument ${a} (use --with-staging, --state=<file>, --json)`,
      );
  }
  return out;
}

/**
 * Judge one HTTP answer for a target. Pure, so the rules are testable without a network.
 * @param {{env: string, ready?: boolean}} target
 * @param {{status: number, headers: Headers|Record<string,string>, json?: any}|{error: string}} answer
 * @returns {{up: boolean, reason: string, degraded: string[], build: string|null}}
 */
function judge(target, answer) {
  if (answer.error)
    return { up: false, reason: answer.error, degraded: [], build: null };
  const header = (k) =>
    typeof answer.headers.get === "function"
      ? answer.headers.get(k)
      : answer.headers[k];
  const build = header("x-mycity-build") || null;
  const env = header("x-mycity-environment");
  if (answer.status !== 200)
    return {
      up: false,
      reason: `HTTP ${answer.status}${answer.json && answer.json.status ? ` (${answer.json.status})` : ""}`,
      degraded: [],
      build,
    };
  if (env && env !== target.env)
    return {
      up: false,
      reason: `answered as ${env}, expected ${target.env}`,
      degraded: [],
      build,
    };
  if (!env)
    return {
      up: false,
      reason: "no X-Mycity-Environment header: not the MyCity API",
      degraded: [],
      build,
    };
  if (!target.ready) return { up: true, reason: "ok", degraded: [], build };
  const body = answer.json || {};
  if (body.ok !== true)
    return {
      up: false,
      reason: `not ready (${body.status || "no status"})`,
      degraded: [],
      build,
    };
  const degraded = Object.entries(body.checks || {})
    .filter(([, c]) => c && c.status && c.status !== "up")
    .map(([k, c]) => `${k}=${c.status}`);
  return { up: true, reason: body.status || "ready", degraded, build };
}

async function fetchAnswer(target) {
  try {
    const res = await fetch(`https://${target.name}${target.path}`, {
      redirect: "manual",
      headers: { "user-agent": "mycity-uptime-probe" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* an HTML error page from the proxy */
    }
    return { status: res.status, headers: res.headers, json };
  } catch (err) {
    if (err.name === "TimeoutError")
      return { error: `no answer in ${TIMEOUT_MS / 1000}s` };
    const code = err.cause && err.cause.code;
    const plain = {
      ECONNREFUSED: "connection refused (nginx down or port 443 closed)",
      ENOTFOUND: "DNS: the name does not resolve",
      EAI_AGAIN: "DNS: no answer from the resolver",
      ECONNRESET: "connection reset",
      ETIMEDOUT: "connection timed out (server off or firewall)",
      EHOSTUNREACH: "host unreachable",
    }[code];
    if (plain) return { error: plain };
    if (code && /CERT|SELF_SIGNED|ISSUER|ALTNAME/.test(code))
      return { error: `TLS certificate: ${code}` };
    return { error: code || (err.cause && err.cause.message) || err.message };
  }
}

/** Days until the host's certificate expires, or null when TLS cannot be reached. */
function certDays(host) {
  return new Promise((resolve) => {
    // Trust is judged by the HTTPS check; this only reads the dates, so an expired or untrusted
    // certificate still reports how many days it has (negative when expired).
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        timeout: TIMEOUT_MS,
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(
          cert && cert.valid_to
            ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000)
            : null,
        );
      },
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(
  target,
  { fetchImpl = fetchAnswer, certImpl = certDays } = {},
) {
  let verdict;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt) await sleep(RETRY_MS);
    verdict = judge(target, await fetchImpl(target));
    if (verdict.up) break;
  }
  const days = await certImpl(target.name);
  return { host: target.name, env: target.env, ...verdict, cert_days: days };
}

/**
 * What to alert, given the last state and this run's results. Pure.
 * @param {object} prev state from the last run ({} when none)
 * @param {Array<object>} results this run's probe results
 * @param {number} now ms
 * @param {boolean} remember false: no state, alert on every problem
 * @returns {{state: object, alerts: string[]}}
 */
function decide(prev, results, now, remember = true) {
  const state = { hosts: { ...((prev && prev.hosts) || {}) } };
  const alerts = [];
  for (const r of results) {
    const was = state.hosts[r.host] || {};
    const host = { ...was };
    if (!r.up) {
      const since = was.status === "down" ? was.since : now;
      const due =
        !remember ||
        was.status !== "down" ||
        now - (was.alerted_at || 0) >= REALERT_MS;
      if (due) {
        const mins = Math.round((now - since) / 60000);
        alerts.push(
          was.status === "down" && remember
            ? `STILL DOWN ${r.host} for ${mins} min: ${r.reason}`
            : `DOWN ${r.host}: ${r.reason}`,
        );
        host.alerted_at = now;
      }
      Object.assign(host, { status: "down", since });
    } else {
      if (remember && was.status === "down")
        alerts.push(
          `RECOVERED ${r.host} after ${Math.round((now - was.since) / 60000)} min (${r.reason})`,
        );
      Object.assign(host, {
        status: "up",
        since: was.status === "up" ? was.since : now,
      });
      delete host.alerted_at;
    }
    if (
      r.cert_days !== null &&
      r.cert_days !== undefined &&
      r.cert_days < CERT_MIN_DAYS
    ) {
      if (!remember || now - (was.cert_alerted_at || 0) >= CERT_REALERT_MS) {
        alerts.push(
          `CERTIFICATE ${r.host} expires in ${r.cert_days} days: renewal is failing (sudo certbot renew on the server)`,
        );
        host.cert_alerted_at = now;
      }
    } else delete host.cert_alerted_at;
    state.hosts[r.host] = host;
  }
  return { state, alerts };
}

function line(r) {
  const cert = r.cert_days === null ? "cert ?" : `cert ${r.cert_days}d`;
  const extra = r.degraded.length
    ? ` · degraded: ${r.degraded.join(", ")}`
    : "";
  return `${r.up ? "up  " : "DOWN"}  ${r.host.padEnd(26)} ${r.reason} · ${cert}${r.build ? ` · ${r.build}` : ""}${extra}`;
}

async function alert(text) {
  const r = await sender.send(text, {
    webhook: process.env.ALERT_WEBHOOK_URL || "",
    whatsapp: process.env.ALERT_WHATSAPP_URLS || "",
  });
  return sender.summary(r);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`uptime-probe: ${err.message}`);
    process.exit(2);
  }
  const targets = opts.staging ? [...TARGETS, ...STAGING] : TARGETS;
  const results = await Promise.all(targets.map((t) => probe(t)));
  let prev = {};
  if (opts.state) {
    try {
      prev = JSON.parse(fs.readFileSync(opts.state, "utf8"));
    } catch {
      /* first run */
    }
  }
  const { state, alerts } = decide(
    prev,
    results,
    Date.now(),
    Boolean(opts.state),
  );
  if (opts.state)
    fs.writeFileSync(opts.state, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    opts.json
      ? JSON.stringify({ results, alerts }, null, 2)
      : results.map(line).join("\n"),
  );
  if (alerts.length) {
    const text = `MyCity uptime: ${alerts.join("; ")}`;
    console.log(`\n${text}\n${await alert(text)}`);
  }
  process.exit(results.every((r) => r.up) ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  TARGETS,
  STAGING,
  CERT_MIN_DAYS,
  parseArgs,
  judge,
  probe,
  decide,
  line,
};

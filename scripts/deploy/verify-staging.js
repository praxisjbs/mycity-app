#!/usr/bin/env node
"use strict";
/**
 * Verify staging before it is sealed (SYSTEM_ARCHITECTURE §9.2 step 3, §9.4).
 *
 *   node scripts/deploy/verify-staging.js --sha=<commit>
 *
 * Run by release.yml after `deploy-gate stage`, from GitHub, against the real staging hosts over
 * HTTPS, so the proxy, TLS and DNS are tested too. Exit 0 means seal; anything else stops the
 * release before the approval step.
 *
 * Checks now:
 *   readiness      200, ok, status not "unavailable", this exact build, APP_ENV staging
 *   modules        none skipped for an error (health/ready "modules")
 *   migrations     the database head is the newest file in migrations/ or seeds/reference/
 *   frontends      both builds present (health/ready "static"); a deep link on hub. serves
 *                  index.html uncached; hashed assets are immutable
 *   surfaces       each host refuses the other's API; go. has no socket.io (runbooks/proxy.md §5)
 *   markers        X-Mycity-Environment: staging and X-Robots-Tag noindex on every answer
 *   transport      HTTP redirects to HTTPS; HSTS on HTTPS
 *   sessions       the staff API refuses a call with no session; sign-in refuses a wrong
 *                  password as a wrong password (identity and the database answer, not a 5xx)
 * With the QA login in the environment (STAGING_QA_EMAIL, STAGING_QA_PASSWORD: a Staff-role
 * account on staging, two-step off, made with create-admin; docs/runbooks/deploy.md §1):
 *   sign-in        the round trip: sign in, read the session's own account, sign out
 *   RBAC deny      that Staff session is refused Settings, Approvals (403)
 * Without the QA login those two are PENDING, and so are the checks whose modules or mailbox are
 * not ready: workflow round trip, PDF render, mail to the QA inbox, the Playwright smoke. They
 * become checks here (or Jest suites in tests/staging, run with --suite) as they land.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HUB = "https://hub.staging.mycityapp.io";
const GO = "https://go.staging.mycityapp.io";
const TIMEOUT_MS = 15000;

/** An address no account can have (.invalid never resolves), so the probe never throttles one. */
const PROBE_LOGIN = { email: "verify-staging@mycityapp.invalid", password: "Not-the-password-1!" };

const PENDING = [
  ["workflow round trip", "a request the QA login may open and withdraw"],
  ["PDF render", "a document the QA login may render"],
  ["mail delivered to the QA inbox", "SMTP on staging and a QA mailbox"],
  ["Playwright smoke, phone and desktop", "app/ wired to the API"],
];
const QA_PENDING = [
  ["sign-in round trip", "STAGING_QA_EMAIL and STAGING_QA_PASSWORD"],
  ["RBAC deny check", "STAGING_QA_EMAIL and STAGING_QA_PASSWORD"],
];

/**
 * The newest step in the checkout, or null when there are none yet. Migrations and reference
 * seeds are one numbered sequence in the database's ledger, so the head is the newest of both.
 */
function expectedHead(root = ROOT) {
  const { listMigrations } = require(
    path.join(root, "scripts", "db", "migrate"),
  );
  const all = listMigrations();
  return all.length ? all[all.length - 1].name : null;
}

async function get(url, { method = "GET", body, redirect = "manual", headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    redirect,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** The error code of an API error answer, or null. */
const errorCode = (r) => (r.json && r.json.error && r.json.error.code) || null;

/**
 * Sign in as the QA login, read its own account, check a grant it lacks is refused, sign out.
 * @returns {Promise<void>}
 */
async function qaRoundTrip({ hub, qa, fetchOne, check }) {
  const signIn = await fetchOne(`${hub}/api/v1/auth/login`, { method: "POST", body: qa });
  const token = signIn.json && signIn.json.access_token;
  if (!token) {
    const why = signIn.json && signIn.json.challenge_token
      ? "the QA login asks for a code; turn two-step off for it"
      : `HTTP ${signIn.status}${errorCode(signIn) ? ` ${errorCode(signIn)}` : ""}`;
    check(false, "sign-in round trip", why);
    check(false, "RBAC deny check", "no session to check with");
    return;
  }
  const auth = { authorization: `Bearer ${token}` };
  const me = await fetchOne(`${hub}/api/v1/auth/me`, { headers: auth });
  const who = me.json && String(me.json.email || "").toLowerCase();
  const deny = await fetchOne(`${hub}/api/v1/settings/approvals`, { headers: auth });
  const out = await fetchOne(`${hub}/api/v1/auth/logout`, { method: "POST", body: {}, headers: auth });
  check(
    me.status === 200 && who === qa.email.toLowerCase() && out.status === 204,
    "sign-in round trip",
    `sign in 200, own account ${me.status}, sign out ${out.status}`,
  );
  check(
    deny.status === 403,
    "RBAC deny check",
    `a Staff session asking for Settings, Approvals: HTTP ${deny.status}`,
  );
}

/**
 * Every check that can run today. `fetchImpl` is for the tests.
 * @param {{sha: string, hub?: string, go?: string, head?: string|null, qa?: {email: string, password: string}|null, fetchImpl?: Function}} opts
 * @returns {Promise<{passed: string[], failed: string[], warnings: string[], pending: string[][]}>}
 */
async function verify({
  sha,
  hub = HUB,
  go = GO,
  head = expectedHead(),
  qa = null,
  fetchImpl,
}) {
  const passed = [];
  const failed = [];
  const warnings = [];
  const pending = qa ? [...PENDING] : [...QA_PENDING, ...PENDING];
  const fetchOne = fetchImpl || get;
  const check = (ok, label, detail) =>
    (ok ? passed : failed).push(detail ? `${label}: ${detail}` : label);
  const markers = (r, where) => {
    check(
      r.headers.get("x-mycity-environment") === "staging",
      `${where} marked staging`,
      r.headers.get("x-mycity-environment") || "no X-Mycity-Environment",
    );
    check(
      /noindex/.test(r.headers.get("x-robots-tag") || ""),
      `${where} not indexed`,
    );
  };

  let ready;
  try {
    ready = await fetchOne(`${hub}/api/health/ready`);
  } catch (err) {
    failed.push(`readiness: ${hub} did not answer (${err.message})`);
    return { passed, failed, warnings, pending };
  }
  const r = ready.json || {};
  const checks = r.checks || {};
  check(
    ready.status === 200 && r.ok === true,
    "readiness",
    `HTTP ${ready.status}, ${r.status || "no body"}`,
  );
  check(
    r.build && r.build.sha === sha,
    "build",
    `staging runs ${r.build ? String(r.build.sha).slice(0, 12) : "?"}, expected ${sha.slice(0, 12)}`,
  );
  check(
    r.build && r.build.env === "staging",
    "environment",
    r.build ? r.build.env : "?",
  );
  markers(ready, "readiness");
  for (const [name, c] of Object.entries(checks)) {
    if (c && c.status !== "up" && name !== "modules" && name !== "migrations")
      warnings.push(`${name} is ${c.status}${c.error ? ` (${c.error})` : ""}`);
  }
  const mods = checks.modules || {};
  check(
    Array.isArray(mods.skipped) && mods.skipped.length === 0,
    "modules",
    mods.skipped && mods.skipped.length
      ? `skipped: ${mods.skipped.join(", ")}`
      : `${mods.mounted ?? 0} mounted`,
  );
  const mig = checks.migrations || {};
  if (head === null) warnings.push("no migrations in the repository yet");
  else
    check(
      mig.head === head,
      "migrations at head",
      `database ${mig.head || "none"}, repository ${head}`,
    );
  const stat = checks.static || {};
  check(
    stat.staff === true && stat.public === true,
    "frontend builds present",
    JSON.stringify({ staff: stat.staff, public: stat.public }),
  );

  const deep = await fetchOne(`${hub}/people/employees`);
  check(
    deep.status === 200 &&
      /text\/html/.test(deep.headers.get("content-type") || ""),
    "hub deep link serves the app",
    `HTTP ${deep.status}`,
  );
  check(
    /no-cache/.test(deep.headers.get("cache-control") || ""),
    "index.html not cached",
    deep.headers.get("cache-control") || "none",
  );
  const asset = /\/assets\/[^"']+\.js/.exec(deep.text || "");
  if (asset) {
    const a = await fetchOne(`${hub}${asset[0]}`);
    check(
      a.status === 200 &&
        /immutable/.test(a.headers.get("cache-control") || ""),
      "hashed assets immutable",
      `${asset[0]}: ${a.headers.get("cache-control") || a.status}`,
    );
  } else warnings.push("no hashed asset found in index.html to check");

  const wrongPublic = await fetchOne(`${hub}/api/public/v1/jobs`);
  check(
    wrongPublic.status === 404,
    "hub refuses the public API",
    `HTTP ${wrongPublic.status}`,
  );
  const wrongStaff = await fetchOne(`${go}/api/v1/auth/me`);
  check(
    wrongStaff.status === 404,
    "go refuses the staff API",
    `HTTP ${wrongStaff.status}`,
  );
  markers(wrongStaff, "go");
  const sock = await fetchOne(`${go}/socket.io/`);
  check(sock.status === 404, "go has no socket.io", `HTTP ${sock.status}`);
  const goHome = await fetchOne(`${go}/`);
  check(
    goHome.status === 200,
    "go serves the public site",
    `HTTP ${goHome.status}`,
  );

  const plain = await fetchOne(`${hub.replace(/^https:/, "http:")}/api/health`);
  check(
    [301, 308].includes(plain.status) &&
      /^https:/.test(plain.headers.get("location") || ""),
    "HTTP redirects to HTTPS",
    `HTTP ${plain.status}`,
  );
  check(
    /max-age=\d+/.test(ready.headers.get("strict-transport-security") || ""),
    "HSTS on",
  );

  const noSession = await fetchOne(`${hub}/api/v1/auth/me`);
  check(noSession.status === 401, "staff API needs a session", `HTTP ${noSession.status}`);
  const wrong = await fetchOne(`${hub}/api/v1/auth/login`, { method: "POST", body: PROBE_LOGIN });
  check(
    wrong.status === 401 && errorCode(wrong) === "INVALID_CREDENTIALS",
    "sign-in refuses a wrong password",
    `HTTP ${wrong.status} ${errorCode(wrong) || "no error code"}`,
  );
  if (qa) await qaRoundTrip({ hub, qa, fetchOne, check });

  return { passed, failed, warnings, pending };
}

/** The QA login from the environment, or null when it is not set. Half set is a mistake. */
function qaFromEnv(env = process.env) {
  const email = env.STAGING_QA_EMAIL || "";
  const password = env.STAGING_QA_PASSWORD || "";
  if (!email && !password) return null;
  if (!email || !password)
    throw new Error("Set both STAGING_QA_EMAIL and STAGING_QA_PASSWORD, or neither");
  return { email, password };
}

function args(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unknown argument "${a}"`);
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function main(argv) {
  const a = args(argv);
  if (!/^[0-9a-f]{40}$/.test(String(a.sha || "")))
    throw new Error("--sha=<the 40-character commit> is required");
  const r = await verify({ sha: a.sha, hub: a.hub || HUB, go: a.go || GO, qa: qaFromEnv() });
  for (const p of r.passed) console.log(`  ok       ${p}`);
  for (const w of r.warnings) console.log(`  warning  ${w}`);
  for (const [what, waits] of r.pending)
    console.log(`  PENDING  ${what} (waits for ${waits})`);
  for (const f of r.failed) console.log(`  FAILED   ${f}`);

  const suite = path.join(ROOT, "tests", "staging");
  let suiteFailed = false;
  if (
    a.suite &&
    fs.existsSync(suite) &&
    fs.readdirSync(suite).some((f) => f.endsWith(".test.js"))
  ) {
    const j = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "jest", "bin", "jest.js"),
        "--ci",
        suite,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          STAGING_SHA: a.sha,
          STAGING_HUB: a.hub || HUB,
          STAGING_GO: a.go || GO,
        },
      },
    );
    suiteFailed = j.status !== 0;
  }
  const ok = r.failed.length === 0 && !suiteFailed;
  console.log(
    ok
      ? `verify-staging: ok, ${a.sha.slice(0, 12)} may be sealed`
      : "verify-staging: FAILED, do not seal",
  );
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`verify-staging: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { verify, expectedHead, qaFromEnv, PENDING, QA_PENDING };

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
 *   migrations     the database head is the newest file in migrations/
 *   frontends      both builds present (health/ready "static"); a deep link on hub. serves
 *                  index.html uncached; hashed assets are immutable
 *   surfaces       each host refuses the other's API; go. has no socket.io (runbooks/proxy.md §5)
 *   markers        X-Mycity-Environment: staging and X-Robots-Tag noindex on every answer
 *   transport      HTTP redirects to HTTPS; HSTS on HTTPS
 * Checks that need modules not built yet are listed as PENDING with what they wait for; they
 * become checks here (or Jest suites in tests/staging, run with --suite) as those modules land:
 * sign-in round trip, RBAC deny, workflow round trip, PDF render, mail to the QA inbox, and the
 * Playwright smoke on both shells.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HUB = "https://hub.staging.mycityapp.io";
const GO = "https://go.staging.mycityapp.io";
const TIMEOUT_MS = 15000;

const PENDING = [
  ["sign-in round trip", "identity module"],
  ["RBAC deny check", "access module"],
  ["workflow round trip", "workflow module"],
  ["PDF render", "documents module routes"],
  ["mail delivered to the QA inbox", "SMTP on staging and a QA mailbox"],
  ["Playwright smoke, phone and desktop", "app/ wired to the API"],
];

/** The newest migration name in the checkout, or null when there are none yet. */
function expectedHead(root = ROOT) {
  const { listMigrations } = require(
    path.join(root, "scripts", "db", "migrate"),
  );
  const all = listMigrations(path.join(root, "migrations"));
  return all.length ? all[all.length - 1].name : null;
}

async function get(url, { redirect = "manual", headers = {} } = {}) {
  const res = await fetch(url, {
    redirect,
    headers,
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

/**
 * Every check that can run today. `fetchImpl` is for the tests.
 * @param {{sha: string, hub?: string, go?: string, head?: string|null, fetchImpl?: Function}} opts
 * @returns {Promise<{passed: string[], failed: string[], warnings: string[]}>}
 */
async function verify({
  sha,
  hub = HUB,
  go = GO,
  head = expectedHead(),
  fetchImpl,
}) {
  const passed = [];
  const failed = [];
  const warnings = [];
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
    return { passed, failed, warnings };
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

  return { passed, failed, warnings };
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
  const r = await verify({ sha: a.sha, hub: a.hub || HUB, go: a.go || GO });
  for (const p of r.passed) console.log(`  ok       ${p}`);
  for (const w of r.warnings) console.log(`  warning  ${w}`);
  for (const [what, waits] of PENDING)
    console.log(`  PENDING  ${what} (waits for the ${waits})`);
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

module.exports = { verify, expectedHead, PENDING };

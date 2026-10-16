#!/usr/bin/env node
"use strict";
/**
 * Restore drill: prove the newest backup restores (SYSTEM_ARCHITECTURE §11, MILESTONES M11
 * "a restore rehearsed from the backup into a scratch database", docs/runbooks/backup-restore.md).
 *
 *   sudo mycity-restore-drill                  production's newest nightly dump
 *   sudo mycity-restore-drill --env=stg        staging's
 *   sudo mycity-restore-drill --dump=<file>    any dump (a pre-deploy one, a copy brought back)
 *        --keep                                leave the scratch database for a look; drop it after
 *        --json                                print the report as JSON
 *
 * Installed root-owned at /srv/mycity/bin/mycity-restore-drill by ops/provision/provision.sh and
 * run as root by mycity-restore-drill.service every Sunday (mycity-restore-drill.timer). It uses
 * only Node's own modules and the alert sender installed beside it, so it runs from there without
 * a release.
 *
 * What it does, in order:
 *   1. picks the dump; without --dump, the newest nightly of the environment must be under 36
 *      hours old (a backup that silently stopped is the failure this exists to catch);
 *   2. checks the dump's sha256 against the .json the backup wrote beside it;
 *   3. restores it into a scratch database (mycity_restore_drill_<env>) as the postgres
 *      superuser, which also creates the extensions the dump needs, and times it;
 *   4. compares the restore with what the backup recorded from the same snapshot it dumped
 *      (scripts/db/backup.sh): the migration head, and the exact row count of every table. Any
 *      difference fails. The live database's counts are listed beside them for information
 *      only (they move with whatever was written since), read in a read-only transaction. A
 *      dump with no record (a pre-deploy one, --dump) is restored and listed, not compared;
 *   5. drops the scratch database, appends the report to backups/drills.jsonl, and exits 0 when
 *      every check passed. On a failure it exits 1 and alerts production's channels through
 *      mycity-alert (ALERT_WEBHOOK_URL, ALERT_WHATSAPP_URLS: src/shared/observability/alert.js).
 *
 * The DRILL_* environment variables exist for the tests.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = process.env.DRILL_ROOT || "/srv/mycity";
// Who runs psql and pg_restore. On the server: the postgres superuser, by peer authentication.
const AS =
  process.env.DRILL_AS === undefined ? "postgres" : process.env.DRILL_AS;
const MAX_AGE_HOURS = 36;
const ENVS = new Set(["prod", "stg"]);

/** --name=value and --flag arguments. */
function parseArgs(argv) {
  const out = { env: "prod", dump: null, keep: false, json: false };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    const [, k, v] = m;
    if (k === "env" && ENVS.has(v)) out.env = v;
    else if (k === "dump" && v) out.dump = v;
    else if (k === "keep" && v === undefined) out.keep = true;
    else if (k === "json" && v === undefined) out.json = true;
    else
      throw new Error(
        `unknown argument ${a} (use --env=prod|stg, --dump=<file>, --keep, --json)`,
      );
  }
  return out;
}

/** UTC time from a nightly-YYYYMMDDTHHMMSSZ.dump name, or null. */
function stampOf(name) {
  const m = /^nightly-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/.exec(
    name,
  );
  return m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
    : null;
}

/**
 * The newest nightly dump among file names, and whether it is fresh enough.
 * @returns {{name: string|null, taken: Date|null, ageHours: number|null, fresh: boolean}}
 */
function newestNightly(names, now = new Date()) {
  const dumps = names
    .map((name) => ({ name, taken: stampOf(name) }))
    .filter((d) => d.taken)
    .sort((a, b) => b.taken - a.taken);
  if (!dumps.length)
    return { name: null, taken: null, ageHours: null, fresh: false };
  const ageHours = (now - dumps[0].taken) / 3600000;
  return { ...dumps[0], ageHours, fresh: ageHours <= MAX_AGE_HOURS };
}

/**
 * The restore against the backup's record of the same snapshot: every table, exact counts.
 * @param {Record<string, number>} recorded row counts the backup read when it dumped
 * @param {Record<string, number>} restored row counts in the scratch database
 * @param {Record<string, number>} [live] row counts in the live database now (shown, not judged)
 * @returns {{failures: string[], rows: Array<{table: string, recorded: number|null, restored: number|null, live: number|null}>}}
 */
function compareTables(recorded, restored, live = {}) {
  const failures = [];
  const tables = [
    ...new Set([...Object.keys(recorded), ...Object.keys(restored)]),
  ].sort();
  const at = (map, t) => (t in map ? map[t] : null);
  const rows = tables.map((table) => ({
    table,
    recorded: at(recorded, table),
    restored: at(restored, table),
    live: at(live, table),
  }));
  for (const r of rows) {
    if (r.restored === null)
      failures.push(`${r.table} is missing from the restore`);
    else if (r.recorded === null)
      failures.push(
        `${r.table} is in the restore but not in the backup's record`,
      );
    else if (r.restored !== r.recorded)
      failures.push(
        `${r.table} restored ${r.restored} rows, the backup recorded ${r.recorded}`,
      );
  }
  return { failures, rows };
}

/** One value from a file of KEY=value lines. */
function valueIn(file, key) {
  try {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const hit = lines.filter((l) => l.startsWith(`${key}=`)).pop();
    return hit ? hit.slice(key.length + 1) : "";
  } catch {
    return "";
  }
}

let account;
/** uid, gid and home of AS, from the passwd database. */
function asAccount() {
  if (account === undefined) {
    account = null;
    if (AS) {
      const r = spawnSync("getent", ["passwd", AS], { encoding: "utf8" });
      const f = (r.stdout || "").trim().split(":");
      if (r.status !== 0 || f.length < 6)
        throw new Error(`no ${AS} user on this machine`);
      account = { uid: Number(f[2]), gid: Number(f[3]), home: f[5] };
    }
  }
  return account;
}

/**
 * Run a command as AS (or as this process when AS is empty), from /. stdin is a file this
 * process opened, so the dump never has to be readable by AS. Dropping to AS's uid and gid is
 * done by Node itself: no runuser, no PAM session inside a sandboxed unit.
 */
function run(cmd, args, { input, env } = {}) {
  const who = asAccount();
  const stdio = [input ? fs.openSync(input, "r") : "ignore", "pipe", "pipe"];
  const r = spawnSync(cmd, args, {
    cwd: "/",
    stdio,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ...(who ? { HOME: who.home, USER: AS, LOGNAME: AS } : {}),
      ...env,
    },
    ...(who ? { uid: who.uid, gid: who.gid } : {}),
  });
  if (typeof stdio[0] === "number") fs.closeSync(stdio[0]);
  if (r.error) throw r.error;
  return r;
}

function sql(db, query, { readOnly = false } = {}) {
  const env = readOnly
    ? { PGOPTIONS: "-c default_transaction_read_only=on" }
    : {};
  const r = run(
    "psql",
    ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", query],
    { env },
  );
  if (r.status !== 0)
    throw new Error(`psql on ${db}: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.stdout.trim();
}

// Exact row counts of every table outside the system schemas, one "schema.table|count" a line.
const COUNTS = `
SELECT format('%s.%s', schemaname, tablename) || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text
  FROM pg_tables
 WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
 ORDER BY 1`;
const HEAD = `SELECT CASE WHEN to_regclass('schema_migration') IS NULL THEN 'none'
  ELSE coalesce((SELECT max(name) FROM schema_migration), 'none') END`;

function counts(db, opts) {
  const out = {};
  for (const line of sql(db, COUNTS, opts).split("\n").filter(Boolean)) {
    const i = line.lastIndexOf("|");
    out[line.slice(0, i)] = Number(line.slice(i + 1));
  }
  return out;
}

function sha256(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0)
    h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest("hex");
}

/**
 * The alert sender: provisioning's copy beside this one on the server, the repository's when run
 * from a checkout. Both are src/shared/observability/alert.js.
 */
function alertSender() {
  for (const f of [
    process.env.DRILL_ALERT,
    "/srv/mycity/bin/mycity-alert",
    path.join(
      __dirname,
      "..",
      "..",
      "src",
      "shared",
      "observability",
      "alert.js",
    ),
  ]) {
    if (f && fs.existsSync(f)) return require(f);
  }
  return null;
}

async function alert(text) {
  const sender = alertSender();
  if (!sender)
    return "mycity-alert is missing (re-run provisioning): nobody was told";
  const r = await sender.send(
    text,
    sender.channelsFromFile(path.join(ROOT, "prod", "shared", ".env")),
  );
  return sender.summary(r);
}

/** The drill. Returns the report; throws nothing a caller has to catch. */
function drill(opts, now = new Date()) {
  const started = Date.now();
  const report = {
    env: opts.env,
    started_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    dump: null,
    passed: [],
    failures: [],
    tables: [],
  };
  const pass = (s) => report.passed.push(s);
  const fail = (s) => report.failures.push(s);
  const dir = path.join(ROOT, "backups", opts.env);
  const scratch = `mycity_restore_drill_${opts.env}`;
  const liveDb =
    valueIn(path.join(ROOT, opts.env, "shared", ".env"), "DB_NAME") ||
    `mycity_${opts.env}`;
  let created = false;

  try {
    // 1. Which dump
    let file = opts.dump;
    if (!file) {
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        /* reported below */
      }
      const newest = newestNightly(names, now);
      if (!newest.name)
        throw new Error(
          `no nightly dump in ${dir}: the nightly backup has never run`,
        );
      file = path.join(dir, newest.name);
      if (newest.fresh)
        pass(`newest nightly is ${newest.ageHours.toFixed(1)} hours old`);
      else
        fail(
          `newest nightly is ${newest.ageHours.toFixed(1)} hours old (over ${MAX_AGE_HOURS}): the nightly backup has stopped`,
        );
    }
    if (!fs.existsSync(file)) throw new Error(`${file} does not exist`);
    report.dump = file;
    report.bytes = fs.statSync(file).size;

    // 2. Integrity against what the backup recorded
    const metaFile = file.replace(/\.dump$/, ".json");
    let meta = null;
    if (fs.existsSync(metaFile))
      meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (meta && meta.sha256) {
      if (sha256(file) === meta.sha256)
        pass("sha256 matches the backup's record");
      else
        throw new Error(
          "sha256 does not match the backup's record: the file changed after it was written",
        );
    } else {
      report.notes = [
        "no record beside the dump (not a nightly): restored and listed, not compared",
      ];
    }

    // 3. Restore into a scratch database, timed
    sql("postgres", `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    sql(
      "postgres",
      `CREATE DATABASE ${scratch} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'`,
    );
    created = true;
    const t0 = Date.now();
    const restore = run(
      "pg_restore",
      ["--no-owner", "--exit-on-error", "-d", scratch],
      { input: file },
    );
    report.restore_seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (restore.status !== 0)
      throw new Error(
        `pg_restore failed: ${(restore.stderr || "").trim().split("\n").slice(-1)[0]}`,
      );
    pass(`restored in ${report.restore_seconds}s`);

    // 4. Compare
    const head = sql(scratch, HEAD);
    report.migration_head = head;
    if (meta && meta.migration_head) {
      if (head === meta.migration_head)
        pass(`migration head ${head}, as recorded`);
      else
        fail(
          `migration head in the restore is ${head}, the backup recorded ${meta.migration_head}`,
        );
    }
    const restored = counts(scratch);
    let live = {};
    try {
      live = counts(liveDb, { readOnly: true });
    } catch (err) {
      report.notes = [
        ...(report.notes || []),
        `live counts not read: ${err.message}`,
      ];
    }
    if (meta && meta.tables) {
      const cmp = compareTables(meta.tables, restored, live);
      report.tables = cmp.rows;
      cmp.failures.forEach(fail);
      if (!cmp.failures.length)
        pass(
          `all ${cmp.rows.length} tables restored with exactly the rows the backup recorded`,
        );
    } else {
      report.tables = compareTables(restored, restored, live).rows.map((r) => ({
        ...r,
        recorded: null,
      }));
    }
  } catch (err) {
    fail(err.message);
  } finally {
    if (created && !opts.keep) {
      try {
        sql("postgres", `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
      } catch (err) {
        fail(`could not drop ${scratch}: ${err.message}`);
      }
    }
    if (created && opts.keep) report.kept = scratch;
  }
  report.ok = report.failures.length === 0;
  report.seconds = Math.round((Date.now() - started) / 100) / 10;
  return report;
}

function printReport(r) {
  const lines = [
    `Restore drill · ${r.env} · ${r.started_at}`,
    `dump      ${r.dump || "none"}${r.bytes ? ` (${r.bytes} bytes)` : ""}`,
    ...r.passed.map((s) => `ok        ${s}`),
    ...(r.notes || []).map((s) => `note      ${s}`),
    ...r.failures.map((s) => `FAILED    ${s}`),
  ];
  if (r.tables.length) {
    const cell = (v, w) => String(v ?? "-").padStart(w);
    lines.push(
      "",
      `${"table".padEnd(36)} ${cell("recorded", 9)} ${cell("restored", 9)} ${cell("live now", 9)}`,
    );
    for (const t of r.tables)
      lines.push(
        `${t.table.padEnd(36)} ${cell(t.recorded, 9)} ${cell(t.restored, 9)} ${cell(t.live, 9)}`,
      );
  }
  if (r.kept)
    lines.push(
      "",
      `kept ${r.kept}: drop it with  sudo -u postgres dropdb ${r.kept}`,
    );
  lines.push("", `${r.ok ? "PASSED" : "FAILED"} in ${r.seconds}s`);
  return lines.join("\n");
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`restore-drill: ${err.message}`);
    process.exit(2);
  }
  const report = drill(opts);
  console.log(
    opts.json ? JSON.stringify(report, null, 2) : printReport(report),
  );
  try {
    fs.appendFileSync(
      path.join(ROOT, "backups", "drills.jsonl"),
      `${JSON.stringify(report)}\n`,
      { mode: 0o600 },
    );
  } catch (err) {
    console.error(`restore-drill: the report was not saved (${err.message})`);
  }
  if (!report.ok) {
    console.error(
      await alert(
        `MyCity restore drill FAILED (${report.env}): ${report.failures.join("; ")}. See journalctl -u mycity-restore-drill`,
      ),
    );
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  stampOf,
  newestNightly,
  compareTables,
  valueIn,
  printReport,
  MAX_AGE_HOURS,
};

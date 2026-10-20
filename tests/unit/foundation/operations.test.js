"use strict";
/**
 * Operations: the alert sender, the nightly backup, the restore drill and the uptime probe. The rules each one
 * judges by are tested here without a network or a database; backup.sh's file handling (media
 * snapshots, keeping 14, the run record, failures) runs for real in a temporary folder. The
 * dump, restore and offsite round trip needs Postgres and SSH; docs/runbooks/backup-restore.md
 * says how it was exercised.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

process.env.PROBE_RETRY_MS = "0";
const drill = require("../../../scripts/db/restore-drill");
const probe = require("../../../ops/monitoring/uptime-probe");
const alert = require("../../../src/shared/observability/alert");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BACKUP = path.join(ROOT, "scripts", "db", "backup.sh");
const ALERT = path.join(ROOT, "src", "shared", "observability", "alert.js");

describe("alert sender", () => {
  beforeEach(() => alert.__reset());
  const LINK = "https://api.callmebot.com/whatsapp.php?phone=+2348031234567&apikey=111&text={text}";
  const LINK2 = "https://api.callmebot.com/whatsapp.php?phone=+2348039999999&apikey=222&text={text}";
  function recorder(status = 200) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", body: init.body });
      return { ok: status < 300, status };
    };
    return { calls, fetchImpl };
  }

  test("WhatsApp links: one GET each, the message encoded where {text} is; the webhook gets JSON", async () => {
    const { calls, fetchImpl } = recorder();
    const r = await alert.send("DOWN hub & go: HTTP 502", { webhook: "https://hooks.example/x", whatsapp: `${LINK}  ${LINK2}`, fetchImpl });
    expect(r).toEqual({ sent: 3, failed: [], skipped: [] });
    expect(calls).toContainEqual({ url: "https://hooks.example/x", method: "POST", body: JSON.stringify({ text: "DOWN hub & go: HTTP 502" }) });
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual([
      LINK.replace("{text}", "DOWN%20hub%20%26%20go%3A%20HTTP%20502"),
      LINK2.replace("{text}", "DOWN%20hub%20%26%20go%3A%20HTTP%20502"),
    ]);
  });

  test("a long message is cut for WhatsApp, not for the webhook", async () => {
    const { calls, fetchImpl } = recorder();
    await alert.send("x".repeat(3000), { webhook: "https://hooks.example/x", whatsapp: LINK, fetchImpl });
    const sent = decodeURIComponent(calls.find((c) => c.method === "GET").url.split("&text=")[1]);
    expect(sent).toHaveLength(alert.WHATSAPP_MAX_CHARS);
    expect(sent.endsWith("…")).toBe(true);
    expect(JSON.parse(calls.find((c) => c.method === "POST").body).text).toHaveLength(3000);
  });

  test("bad links are skipped by position, never printed; at most 5 per person per 10 minutes", async () => {
    const { fetchImpl } = recorder();
    const r = await alert.send("x", { whatsapp: "http://insecure.example/?k=SECRET&t={text} https://no-placeholder.example/?k=SECRET", fetchImpl });
    expect(r.skipped).toEqual(["WhatsApp link 1 is not https", "WhatsApp link 2 has no {text}"]);
    expect(alert.summary(r)).not.toMatch(/SECRET|example/);
    const t0 = Date.parse("2026-10-16T09:00:00Z");
    for (let i = 0; i < 5; i += 1) expect((await alert.send("x", { whatsapp: LINK, fetchImpl, now: t0 + i })).sent).toBe(1);
    expect((await alert.send("x", { whatsapp: LINK, fetchImpl, now: t0 + 6 })).skipped).toEqual(["WhatsApp 1: more than 5 in 10 minutes"]);
    expect((await alert.send("x", { whatsapp: LINK, fetchImpl, now: t0 + 10 * 60000 + 1 })).sent).toBe(1);
  });

  test("a gateway that refuses or is unreachable is reported, never thrown", async () => {
    const refused = await alert.send("x", { whatsapp: LINK, fetchImpl: recorder(403).fetchImpl });
    expect(refused).toEqual({ sent: 0, failed: ["WhatsApp 1 answered 403"], skipped: [] });
    const down = await alert.send("x", { webhook: "https://hooks.example/x", fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    expect(down.failed).toEqual(["webhook: unreachable"]);
    expect(alert.summary(await alert.send("x", {}))).toBe("no alert channel set: nobody was told");
  });

  test("the channels from an environment's .env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-alert-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, `DB_NAME=x\nALERT_WEBHOOK_URL=\nALERT_WHATSAPP_URLS=${LINK} ${LINK2}\r\n`);
    expect(alert.channelsFromFile(file)).toEqual({ webhook: "", whatsapp: `${LINK} ${LINK2}` });
    expect(alert.channelsFromFile(path.join(dir, "none"))).toEqual({ webhook: "", whatsapp: "" });
  });
});

describe("restore drill", () => {
  test("arguments", () => {
    expect(drill.parseArgs([])).toEqual({ env: "prod", dump: null, keep: false, json: false });
    expect(drill.parseArgs(["--env=stg", "--dump=/x.dump", "--keep", "--json"])).toEqual({ env: "stg", dump: "/x.dump", keep: true, json: true });
    expect(() => drill.parseArgs(["--env=dev"])).toThrow(/unknown argument --env=dev/);
    expect(() => drill.parseArgs(["--keep=1"])).toThrow(/unknown argument/);
  });

  test("the newest nightly, and whether the backup has stopped", () => {
    const now = new Date("2026-10-16T08:00:00Z");
    const names = ["nightly-20261014T013000Z.dump", "nightly-20261015T013000Z.dump", "nightly-20261015T013000Z.json", "predeploy-20261016T070000Z-abc.dump"];
    const n = drill.newestNightly(names, now);
    expect(n).toMatchObject({ name: "nightly-20261015T013000Z.dump", fresh: true });
    expect(n.ageHours).toBeCloseTo(30.5);
    expect(drill.newestNightly(names, new Date("2026-10-16T14:00:00Z")).fresh).toBe(false);
    expect(drill.newestNightly(["predeploy-x.dump"], now)).toEqual({ name: null, taken: null, ageHours: null, fresh: false });
    expect(drill.stampOf("nightly-20261015T013000Z.dump").toISOString()).toBe("2026-10-15T01:30:00.000Z");
  });

  test("the restore must hold exactly what the backup recorded; live counts are shown, never judged", () => {
    const recorded = { "public.employee": 500, "public.audit": 9 };
    const ok = drill.compareTables(recorded, { ...recorded }, { "public.employee": 640, "public.audit": 12, "public.newer": 3 });
    expect(ok.failures).toEqual([]);
    expect(ok.rows).toContainEqual({ table: "public.employee", recorded: 500, restored: 500, live: 640 });
    const bad = drill.compareTables(recorded, { "public.employee": 499, "public.extra": 1 });
    expect(bad.failures).toEqual([
      "public.audit is missing from the restore",
      "public.employee restored 499 rows, the backup recorded 500",
      "public.extra is in the restore but not in the backup's record",
    ]);
  });

  test("the printed report", () => {
    const text = drill.printReport({
      env: "prod", started_at: "2026-10-18T03:00:00Z", dump: "/b/nightly.dump", bytes: 10, passed: ["restored in 1s"],
      failures: [], tables: [{ table: "public.employee", recorded: 5, restored: 5, live: 6 }], ok: true, seconds: 2,
    });
    expect(text).toMatch(/ok {8}restored in 1s/);
    expect(text).toMatch(/public\.employee +5 +5 +6/);
    expect(text).toMatch(/PASSED in 2s$/);
  });
});

describe("uptime probe", () => {
  const hub = probe.TARGETS[0];
  const go = probe.TARGETS[1];
  const answer = (status, json, env = "production") => ({ status, json, headers: { "x-mycity-environment": env, "x-mycity-build": "abc123" } });

  test("judging an answer", () => {
    const ready = { ok: true, status: "degraded", checks: { postgres: { status: "up" }, mail: { status: "degraded" }, clamd: { status: "down" } } };
    expect(probe.judge(hub, answer(200, ready))).toEqual({ up: true, reason: "degraded", degraded: ["mail=degraded", "clamd=down"], build: "abc123" });
    expect(probe.judge(go, answer(200, { ok: true }))).toMatchObject({ up: true, reason: "ok" });
    expect(probe.judge(hub, answer(503, { ok: false, status: "unavailable" }))).toMatchObject({ up: false, reason: "HTTP 503 (unavailable)" });
    expect(probe.judge(hub, answer(200, ready, "staging"))).toMatchObject({ up: false, reason: "answered as staging, expected production" });
    expect(probe.judge(hub, { status: 200, json: ready, headers: {} })).toMatchObject({ up: false, reason: /not the MyCity API/ });
    expect(probe.judge(hub, answer(200, { ok: false, status: "starting" }))).toMatchObject({ up: false, reason: "not ready (starting)" });
    expect(probe.judge(hub, { error: "connection refused" })).toMatchObject({ up: false, reason: "connection refused" });
  });

  test("a failure is retried before the host counts as down", async () => {
    const seq = [{ error: "connection reset" }, answer(200, { ok: true })];
    const r = await probe.probe(go, { fetchImpl: async () => seq.shift(), certImpl: async () => 80 });
    expect(r).toMatchObject({ host: "go.mycityapp.io", up: true, cert_days: 80 });
    let calls = 0;
    const down = await probe.probe(go, { fetchImpl: async () => { calls += 1; return { error: "x" }; }, certImpl: async () => null });
    expect(down.up).toBe(false);
    expect(calls).toBe(3);
  });

  test("alerts on a change, hourly while down, once on recovery, daily for a certificate", () => {
    const t0 = Date.parse("2026-10-16T08:00:00Z");
    const up = { host: "hub.mycityapp.io", up: true, reason: "ready", cert_days: 60 };
    const down = { ...up, up: false, reason: "HTTP 502" };
    let s = probe.decide({}, [up], t0);
    expect(s.alerts).toEqual([]);
    s = probe.decide(s.state, [down], t0 + 60000);
    expect(s.alerts).toEqual(["DOWN hub.mycityapp.io: HTTP 502"]);
    s = probe.decide(s.state, [down], t0 + 31 * 60000);
    expect(s.alerts).toEqual([]);
    s = probe.decide(s.state, [down], t0 + 62 * 60000);
    expect(s.alerts).toEqual(["STILL DOWN hub.mycityapp.io for 61 min: HTTP 502"]);
    s = probe.decide(s.state, [up], t0 + 90 * 60000);
    expect(s.alerts).toEqual(["RECOVERED hub.mycityapp.io after 89 min (ready)"]);
    const expiring = { ...up, cert_days: 9 };
    s = probe.decide(s.state, [expiring], t0 + 100 * 60000);
    expect(s.alerts).toEqual([expect.stringMatching(/^CERTIFICATE hub\.mycityapp\.io expires in 9 days/)]);
    expect(probe.decide(s.state, [expiring], t0 + 130 * 60000).alerts).toEqual([]);
    // Without state, every run that finds a problem says so.
    expect(probe.decide({}, [down], t0, false).alerts).toEqual(["DOWN hub.mycityapp.io: HTTP 502"]);
  });

  test("arguments", () => {
    expect(probe.parseArgs(["--with-staging", "--state=s.json", "--json"])).toEqual({ staging: true, state: "s.json", json: true });
    expect(() => probe.parseArgs(["--state="])).toThrow(/unknown argument/);
  });
});

const tools = process.platform !== "win32" && ["bash", "jq", "rsync"].every((t) => spawnSync("which", [t]).status === 0);
(tools ? describe : describe.skip)("backup.sh without a database", () => {
  function server() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-backup-"));
    for (const e of ["prod", "stg"]) {
      fs.mkdirSync(path.join(root, e, "shared"), { recursive: true });
      fs.mkdirSync(path.join(root, e, "media", "docs"), { recursive: true });
      fs.writeFileSync(path.join(root, e, "media", "docs", "a.pdf"), `${e} document`);
    }
    fs.mkdirSync(path.join(root, "backups"));
    return root;
  }
  const run = (root, extra = {}) =>
    spawnSync("bash", [BACKUP], {
      encoding: "utf8",
      env: { ...process.env, BK_ROOT: root, BK_CONF: path.join(root, "none.env"), BK_ALERT: ALERT, ...extra },
    });

  test("media is snapshotted with hard links, 14 kept; a database it cannot reach fails the run", () => {
    const root = server();
    const media = path.join(root, "backups", "prod", "media");
    for (let i = 0; i < 3; i += 1) {
      fs.mkdirSync(path.join(media, `2026101${i}T013000Z`), { recursive: true });
    }
    const r = run(root, { BK_KEEP: "2" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAILED: prod database: no DB_NAME/);
    expect(r.stdout).toMatch(/offsite: not set up/);
    expect(r.stdout).toMatch(/no alert channel set: nobody was told/);
    const snaps = fs.readdirSync(media).sort();
    expect(snaps).toHaveLength(2);
    expect(snaps[0]).toBe("20261012T013000Z");
    const copy = path.join(media, snaps[1], "docs", "a.pdf");
    expect(fs.readFileSync(copy, "utf8")).toBe("prod document");

    const last = JSON.parse(fs.readFileSync(path.join(root, "backups", "last-run.json"), "utf8"));
    expect(last.ok).toBe(false);
    expect(last.failures).toEqual([
      expect.stringMatching(/^prod database: no DB_NAME/),
      expect.stringMatching(/^stg database: no DB_NAME/),
    ]);
    expect(last.items.map((i) => `${i.kind}:${i.env}`)).toEqual(["media:prod", "media:stg"]);

    // The next night, an unchanged file is the same inode: it costs nothing.
    const again = spawnSync("bash", ["-c", `sleep 1.1; BK_ROOT='${root}' BK_CONF=/none BK_ALERT='${ALERT}' BK_ENVS=prod bash '${BACKUP}'`], { encoding: "utf8" });
    expect(again.status).toBe(1);
    const latest = fs.readdirSync(media).sort();
    const [a, b] = latest.slice(-2).map((d) => fs.statSync(path.join(media, d, "docs", "a.pdf")).ino);
    expect(a).toBe(b);
  });

  test("no backups folder: it says to provision first", () => {
    const root = server();
    fs.rmSync(path.join(root, "backups"), { recursive: true });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/run ops\/provision\/provision\.sh first/);
  });
});

describe("health watch (scripts/ops/health-brief.js)", () => {
  const watch = require("../../../scripts/ops/health-brief");
  const DB = [{ key: "postgres", label: "Database", detail: "not answering" }];
  const MIN = 60_000;

  /** Readings one after another, five minutes apart, as the timer takes them. */
  function readings(list, start = Date.parse("2026-10-20T10:00:00Z")) {
    let state = {};
    return list.map((red, i) => {
      const now = start + i * 5 * MIN;
      const r = watch.decide(state, red, now);
      state = r.mail ? watch.afterMail(r.state, r.mail, red, now) : r.state;
      return r.mail;
    });
  }

  test("one red reading is not enough: a deploy's restart never mails", () => {
    expect(readings([DB, [], [], []])).toEqual([null, null, null, null]);
  });

  test("two red readings mail, then hourly while it stays down, then all clear after two clean readings", () => {
    const down = Array.from({ length: 14 }, () => DB);
    const mails = readings([...down, [], []]);
    expect(mails[1]).toBe("down");
    // Readings 2 to 12 are within the hour of that mail; reading 13 is an hour after it.
    expect(mails.slice(2, 13).every((m) => m === null)).toBe(true);
    expect(mails[13]).toBe("still");
    expect(mails[14]).toBe(null);
    expect(mails[15]).toBe("clear");
  });

  test("something else going down mails at once", () => {
    const worker = { key: "worker", label: "Worker", detail: "no heartbeat" };
    expect(readings([DB, DB, [...DB, worker]])).toEqual([null, "down", "worse"]);
  });

  test("nothing was mailed, nothing to clear", () => {
    expect(readings([DB, [], [], []])).toEqual([null, null, null, null]);
  });

  test("red is the API silent, a check down or no worker; amber is never mailed", () => {
    const red = watch.redOf({
      api: { answering: false, error: "ECONNREFUSED" },
      checks: {
        postgres: { status: "down", error: "connect ECONNREFUSED" },
        worker: { status: "degraded", workers: 0, error: "redis not connected" },
        disk: { status: "degraded", free_pct: 8 },
        cpu: { status: "up" },
      },
    });
    expect(red.map((r) => r.key)).toEqual(["api", "postgres", "worker"]);
    expect(red.find((r) => r.key === "worker").detail).toMatch(/no heartbeat/);
  });

  test("the mail says what is down, since when, and what to do with the brief", () => {
    const config = { APP_ENV: "production", STAFF_ORIGIN: "https://hub.mycityapp.io", PORT: 7000 };
    const server = require("../../../src/modules/system_health/system_health.status-brief").serverOf(config);
    const now = Date.parse("2026-10-20T10:20:00Z");
    const state = { down_since: now - 15 * MIN, mailed: null };
    const m = watch.mailOf("down", { red: DB, state, config, server, now });
    expect(m.subject).toBe("MyCity production is down: Database");
    expect(m.text).toContain("- Database: not answering");
    expect(m.text).toContain("15 minutes");
    expect(m.text).toContain("It changes nothing on the server without your yes");
    expect(m.text).toContain("sudo node --env-file=/srv/mycity/prod/shared/.env scripts/ops/health-brief.js");
    expect(m.text).not.toContain("—");
    const clear = watch.mailOf("clear", { red: [], state: { ...state, mailed: { keys: ["postgres"], labels: ["Database"], at: now } }, config, server, now });
    expect(clear.subject).toBe("MyCity production all clear: Database answering again");
  });

  test("addresses split on commas and spaces", () => {
    expect(watch.addresses("a@x.io, b@y.io  c@z.io;d@w.io")).toEqual(["a@x.io", "b@y.io", "c@z.io", "d@w.io"]);
    expect(watch.addresses("")).toEqual([]);
  });

  test("its mail needs neither a template nor the database", async () => {
    const systemMail = require("../../../src/services/mail/system-mail.service");
    systemMail.__reset();
    await systemMail.sendPlain({
      to: ["intelligence@jbspraxis.com"],
      cc: ["tomblakeasaah@gmail.com", "praxisjbs@gmail.com"],
      subject: "MyCity production is down: Database",
      text: "Down now",
      attachments: [{ filename: "mycity-status.md", content: "# brief", contentType: "text/markdown" }],
    });
    const [sent] = systemMail.capturedMail();
    expect(sent.template).toBe("plain");
    expect(sent.subject).toBe("MyCity production is down: Database");
    expect(sent.cc).toEqual(["tomblakeasaah@gmail.com", "praxisjbs@gmail.com"]);
    expect(sent.attachments[0].filename).toBe("mycity-status.md");
    systemMail.__reset();
  });

  test("the watch's recipients default to the JBS Praxis inbox, copying the two named", () => {
    const { config } = require("../../../src/config/env");
    expect(config.HEALTH_ALERT_TO).toBe("intelligence@jbspraxis.com");
    expect(watch.addresses(config.HEALTH_ALERT_CC)).toEqual(["tomblakeasaah@gmail.com", "praxisjbs@gmail.com"]);
  });

  test("the timers are provisioned, the units run the script as the environment's user, and releases ship it", () => {
    const provision = fs.readFileSync(path.join(ROOT, "ops", "provision", "provision.sh"), "utf8");
    expect(provision).toMatch(/TIMERS=\([^)]*mycity-health-watch-prod mycity-health-watch-stg\)/);
    for (const env of ["prod", "stg"]) {
      const unit = fs.readFileSync(path.join(ROOT, "ops", "systemd", `mycity-health-watch-${env}.service`), "utf8");
      expect(unit).toContain(`User=mycity-${env}`);
      expect(unit).toContain(`EnvironmentFile=/srv/mycity/${env}/shared/.env`);
      expect(unit).toContain("scripts/ops/health-brief.js --watch --state=");
      expect(unit).toContain(`StateDirectory=mycity-health-watch-${env}`);
      expect(fs.readFileSync(path.join(ROOT, "ops", "systemd", `mycity-health-watch-${env}.timer`), "utf8")).toContain("OnCalendar=*:0/5");
    }
    expect(fs.readFileSync(path.join(ROOT, "scripts", "deploy", "release-manifest.js"), "utf8")).toContain('{ path: "scripts/ops" }');
  });
});

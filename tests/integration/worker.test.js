"use strict";
/**
 * The worker against a real Postgres and Redis: the cron lock, queues and consumers,
 * the outbox triggers, notification delivery to a live socket, the socket's sign-in
 * rules, the job handlers' failure paths, the schedules and heartbeat, and the migrate
 * and seed scripts.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/worker
 *
 * Refuses to run unless the database name ends in "_test": it rebuilds the public
 * schema from the real migrations (helpers/schema.js). Redis keys are this environment's
 * (mycity:test:*) and are cleared at the start and the end.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");
const { io: connectClient } = require("socket.io-client");
const { Emitter } = require("@socket.io/redis-emitter");

const { config, REDIS_PREFIX } = require("../../src/config/env");
const schema = require("./helpers/schema");
const { pool } = require("../../src/config/db");
const redis = require("../../src/config/redis");
const { atomically } = require("../../src/shared/db/tx");
const { emit } = require("../../src/shared/events/emit");
const outbox = require("../../src/shared/events/outbox");
const sessions = require("../../src/shared/rbac/sessions");
const systemMail = require("../../src/services/mail/system-mail.service");
const documents = require("../../src/shared/documents/generate");
const engine = require("../../src/shared/import/engine");
const registry = require("../../src/jobs/registry");
const queues = require("../../src/jobs/queues");
const { withCronLock } = require("../../src/jobs/cron-lock");
const emitter = require("../../src/services/realtime/emitter");
const socket = require("../../src/realtime/socket");
const worker = require("../../src/worker");
const migrate = require("../../scripts/db/migrate");
const seed = require("../../scripts/db/seed");

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(50);
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function clearRedis() {
  const r = redis.getClient();
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(
      cursor,
      "MATCH",
      `${REDIS_PREFIX}:*`,
      "COUNT",
      500,
    );
    if (keys.length) await r.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}

const people = {};
const consumers = [];

beforeAll(async () => {
  if (!config.DB_NAME.endsWith("_test"))
    throw new Error(`refusing: ${config.DB_NAME} is not a _test database`);
  await schema.rebuild(pool, config.DB_NAME);
  await redis.initRedis();
  await clearRedis();
  for (const [key, first] of [
    ["ada", "Ada"],
    ["bayo", "Bayo"],
  ]) {
    const e = await one(
      schema.sql.employeeNamed,
      [first],
    );
    const u = await one(
      schema.sql.userPlain,
      [e.employee_id, `${key}@mycity.test`],
    );
    people[key] = { user_id: u.user_id, employee_id: e.employee_id };
  }
});

afterAll(async () => {
  await Promise.allSettled(consumers.map((w) => w.close()));
  for (const name of [
    ...registry.JOBS.map((j) => j.queue),
    registry.SCHEDULE_QUEUE,
  ]) {
    await queues
      .getQueue(name)
      .obliterate({ force: true })
      .catch(() => {});
  }
  await queues.closeQueues();
  await socket.close();
  await clearRedis();
  await redis.closeRedis();
  await require("../../src/services/pdf/chromium").close();
  await require("../../src/shared/observability/error-reporter").flush();
  await pool.end();
});

describe("loading the worker's handlers", () => {
  test("shared handlers, triggers and delivery are registered before the outbox may run", () => {
    expect(outbox.isReady()).toBe(false);
    const loaded = worker.loadHandlers({ dir: tmp("mycity-nomods-") });
    expect(outbox.isReady()).toBe(true);
    const names = outbox.registrations().map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "notifications.fanout",
        "jobs.pdf-render",
        "jobs.media-scan",
        "jobs.av-transcode",
      ]),
    );
    expect(loaded.modules).toEqual([]);
  });
});

describe("cron lock", () => {
  test("a second run of the same scheduler is skipped while the first holds the lock", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const first = withCronLock("test-lock", async () => {
      await gate;
      return "ran";
    });
    await until(
      async () =>
        (
          await one(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted",
          )
        ).n > 0,
    );
    expect(await withCronLock("test-lock", async () => "also")).toBeUndefined();
    expect(await withCronLock("other-lock", async () => "other")).toBe("other");
    release();
    expect(await first).toBe("ran");
    expect(await withCronLock("test-lock", async () => "again")).toBe("again");
  });
});

describe("queues and consumers", () => {
  beforeAll(() => {
    require("../../src/jobs/handlers/notification-deliver"); // declares the notification email's variables
    consumers.push(...registry.startConsumers({ only: ["email-send"] }));
  });

  test("a job lands under this environment's prefix and a consumer runs it", async () => {
    systemMail.__reset();
    const job = await queues.enqueue("email-send", "test", {
      to: { name: "Ada Test", email: "ada@mycity.test" },
      recipient: { first_name: "Ada" },
      template: "notification",
      data: { title: "Leave request", body: "Bayo asked for 3 days" },
    });
    expect(
      (await redis.getClient().keys(`${REDIS_PREFIX}:email-send:*`)).length,
    ).toBeGreaterThan(0);
    const state = await until(async () => {
      const s = await job.getState();
      return ["completed", "failed"].includes(s) && s;
    });
    expect(state).toBe("completed");
    const mail = systemMail
      .capturedMail()
      .find((m) => m.subject === "Leave request");
    expect(mail).toBeTruthy();
    expect(mail.html).toContain("Hello Ada,");
    expect(mail.html).toContain("Bayo asked for 3 days");
  });

  test("a message that can never be sent fails at once, not after five tries", async () => {
    const job = await queues.enqueue("email-send", "test", {
      to: "ada@mycity.test",
      template: "notification",
      data: { body: "no title" },
    });
    await until(async () => (await job.getState()) === "failed");
    const done = await queues.getQueue("email-send").getJob(job.id);
    expect(done.attemptsMade).toBe(1);
    expect(done.failedReason).toMatch(
      /TEMPLATE_DATA_INVALID|cannot be produced|title/,
    );
  });
});

describe("outbox triggers", () => {
  test("a committed upload that needs transcoding queues one av-transcode job, once", async () => {
    const docId = crypto.randomUUID();
    const ev = await tx((c) =>
      emit(c, {
        key: "document.stored",
        entity: { type: "document", id: docId },
        module: "settings",
        actor: null,
        payload: { document_id: docId, kind: "audio", needs: ["av"] },
      }),
    );
    await outbox.dispatchDue({ db: pool });
    const job = await queues
      .getQueue("av-transcode")
      .getJob(`av-transcode-${ev.event_id}`);
    expect(job).toBeTruthy();
    expect(job.data.document_id).toBe(docId);
    expect(
      await queues.getQueue("media-scan").getJob(`media-scan-${ev.event_id}`),
    ).toBeFalsy();

    // The outbox delivers at least once: the same event queued again adds nothing.
    await queues.enqueue(
      "av-transcode",
      "document.stored",
      { document_id: docId },
      { jobId: `av-transcode-${ev.event_id}` },
    );
    expect(
      await queues
        .getQueue("av-transcode")
        .getJobCountByTypes("waiting", "delayed", "prioritized"),
    ).toBe(1);
  });
});

describe("realtime", () => {
  let server;
  let url;
  const sid = crypto.randomUUID();
  const token = (sub, opts = {}) =>
    jwt.sign(
      { sub, sid: opts.sid || sid, typ: "access" },
      config.JWT_ACCESS_SECRET,
      { algorithm: "HS256", expiresIn: opts.expiresIn || "15m" },
    );

  const connect = (auth) =>
    new Promise((resolve) => {
      const client = connectClient(url, {
        auth,
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      client.on("connect", () => resolve({ client, error: null }));
      client.on("connect_error", (err) => {
        client.close();
        resolve({ client: null, error: err.message });
      });
    });

  beforeAll(async () => {
    await sessions.indexSession(sid, {
      userId: people.ada.user_id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    server = http.createServer();
    socket.attach(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  test("a socket without a valid token, or with an ended session, is refused", async () => {
    expect((await connect({})).error).toBe("AUTH_REQUIRED");
    expect((await connect({ token: "nonsense" })).error).toBe("INVALID_TOKEN");
    const killed = crypto.randomUUID();
    await q(
      "INSERT INTO user_session (session_id, user_id, refresh_token_hash, killed_at, expires_at) VALUES ($1::uuid, $2, $1::uuid::text, now(), now() + interval '1 day')",
      [killed, people.ada.user_id],
    );
    expect(
      (await connect({ token: token(people.ada.user_id, { sid: killed }) }))
        .error,
    ).toBe("SESSION_ENDED");
    await q("UPDATE app_user SET status = 'suspended' WHERE user_id = $1", [
      people.bayo.user_id,
    ]);
    expect((await connect({ token: token(people.bayo.user_id) })).error).toBe(
      "USER_INACTIVE",
    );
  });

  test("a message published from another process (the worker) reaches the user's socket", async () => {
    const { client, error } = await connect({
      token: token(people.ada.user_id),
    });
    expect(error).toBeNull();
    const got = new Promise((r) => client.on("notification", r));
    const fromWorker = new Emitter(
      redis.createConnection("test:worker-emitter"),
      { key: emitter.CHANNEL_KEY },
    );
    fromWorker
      .to(emitter.ROOMS.user(people.ada.user_id))
      .emit("notification", { notification_id: "n1", title: "Hello" });
    expect(await got).toMatchObject({ notification_id: "n1" });

    // A different environment's prefix does not reach it.
    const other = new Emitter(redis.createConnection("test:other-env"), {
      key: "mycity:prod:socket.io",
    });
    let leaked = false;
    client.on("leak", () => {
      leaked = true;
    });
    other.to(emitter.ROOMS.user(people.ada.user_id)).emit("leak", {});
    await sleep(300);
    expect(leaked).toBe(false);
    client.close();
  });

  test("notification-deliver pushes the bell and sends each email once across retries", async () => {
    systemMail.__reset();
    const { client } = await connect({ token: token(people.ada.user_id) });
    const bells = [];
    client.on("notification", (n) => bells.push(n));
    const handler = require("../../src/jobs/handlers/notification-deliver");
    const row = {
      notification_id: crypto.randomUUID(),
      user_id: people.ada.user_id,
      category: "approvals",
      priority: "normal",
      title: "Approval needed: Leave",
      body: "A stage is waiting on you.",
      entity_type: "document",
      entity_id: crypto.randomUUID(),
      channels: ["in_app", "email", "push"],
    };
    const job = {
      data: { event: { key: "test.event" }, notifications: [row] },
    };
    job.updateData = async (d) => {
      job.data = d;
    };
    expect(await handler(job)).toMatchObject({
      in_app: 1,
      email: 1,
      push_queued: 1,
    });
    expect(await handler(job)).toMatchObject({ in_app: 1, email: 0 });
    // One push job per notice across retries (its id is the notice's), sent at once: nobody
    // is in front of the app.
    const push = await queues
      .getQueue("notification-push")
      .getJob(`push-${row.notification_id}`);
    expect(push.data).toMatchObject({ notification_id: row.notification_id });
    expect(push.opts.delay || 0).toBe(0);
    await until(async () => bells.length >= 1);
    expect(bells[0]).toMatchObject({
      notification_id: row.notification_id,
      title: row.title,
    });
    const mails = systemMail
      .capturedMail()
      .filter((m) => m.subject === row.title);
    expect(mails).toHaveLength(1);
    client.close();
  });

  test("ending a session closes its sockets; an expired token closes the socket", async () => {
    const { client } = await connect({ token: token(people.ada.user_id) });
    const closed = new Promise((r) => client.on("disconnect", r));
    expect(emitter.endSession(sid)).toBe(true);
    await closed;

    const short = await connect({
      token: token(people.ada.user_id, { expiresIn: "2s" }),
    });
    expect(short.error).toBeNull();
    await new Promise((r) => short.client.on("disconnect", r));
  });
});

describe("realtime on the public host", () => {
  test("on the public host, /socket.io is the app's JSON 404, and an upgrade is refused", async () => {
    await socket.close();
    const app = (req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
    };
    const split = { split: true, staff: { host: "hub.mycity.test" }, public: { host: "go.mycity.test" } };
    const hosts = http.createServer(app);
    socket.attach(hosts, { sites: split });
    await new Promise((r) => hosts.listen(0, "127.0.0.1", r));
    const port = hosts.address().port;
    const get = (host) =>
      new Promise((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port, path: "/socket.io/?EIO=4&transport=polling", headers: { host } }, (res) => {
            let body = "";
            res.on("data", (d) => (body += d));
            res.on("end", () => resolve({ status: res.statusCode, body }));
          })
          .on("error", reject);
      });
    const upgrade = (host) =>
      new Promise((resolve) => {
        const req = http.request({
          host: "127.0.0.1",
          port,
          path: "/socket.io/?EIO=4&transport=websocket",
          headers: { host, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
        });
        req.on("response", (res) => resolve(res.statusCode));
        req.on("upgrade", () => resolve(101));
        req.end();
      });
    try {
      const go = await get("go.mycity.test");
      expect(go.status).toBe(404);
      expect(JSON.parse(go.body).error.code).toBe("NOT_FOUND");
      expect(await upgrade("go.mycity.test")).toBe(404);
      const hub = await get("hub.mycity.test");
      expect(hub.status).toBe(200);
      expect(hub.body).toMatch(/"sid"/);
    } finally {
      await socket.close();
    }
  });
});

describe("handler failure paths", () => {
  async function pendingDoc() {
    return one(
      `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source, render_status, render_html)
       VALUES ('test_doc', 'x.pdf', $1, 'application/pdf', 0, 'employee', 'e1', 'normal', 'skipped', 'generated', 'pending', '<p>x</p>')
       RETURNING document_id`,
      [`generated/2026/10/${crypto.randomUUID()}.pdf`],
    );
  }

  test("pdf-render marks the document failed on its last attempt only", async () => {
    const handler = require("../../src/jobs/handlers/pdf-render");
    const spy = jest
      .spyOn(documents, "renderPending")
      .mockRejectedValue(new Error("chromium is not there"));
    try {
      const early = await pendingDoc();
      await expect(
        handler({
          data: { document_id: early.document_id },
          attemptsMade: 0,
          opts: { attempts: 5 },
        }),
      ).rejects.toThrow(/chromium/);
      expect(
        (
          await one(
            "SELECT render_status FROM document WHERE document_id = $1",
            [early.document_id],
          )
        ).render_status,
      ).toBe("pending");

      const last = await pendingDoc();
      await expect(
        handler({
          data: { document_id: last.document_id },
          attemptsMade: 4,
          opts: { attempts: 5 },
        }),
      ).rejects.toThrow(/chromium/);
      const row = await one(
        "SELECT render_status, render_error FROM document WHERE document_id = $1",
        [last.document_id],
      );
      expect(row).toEqual({
        render_status: "failed",
        render_error: "chromium is not there",
      });
      expect(
        await one(
          "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'document.render_failed' AND entity_id = $1",
          [last.document_id],
        ),
      ).toEqual({ n: 1 });
    } finally {
      spy.mockRestore();
    }
  });

  test("a job about a record that does not exist fails at once", async () => {
    const id = crypto.randomUUID();
    for (const queue of ["media-scan", "av-transcode", "media-derive"]) {
      await expect(
        registry.handlerOf(queue)({ data: { document_id: id } }),
      ).rejects.toMatchObject({ name: "UnrecoverableError" });
    }
    await expect(
      registry.handlerOf("import-validate")({
        data: { import_batch_id: id, user_id: crypto.randomUUID() },
      }),
    ).rejects.toMatchObject({
      name: "UnrecoverableError",
    });
  });
});

describe("import cleanup", () => {
  test("imports left unfinished for two weeks are closed; committed ones are kept", async () => {
    const src = await one(
      `INSERT INTO document (doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity, scan_status, source)
       VALUES ('import_sheet', 'staff.xlsx', $1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10, 'import_batch', 'x', 'personal', 'skipped', 'upload')
       RETURNING document_id`,
      [`imports/2026/10/${crypto.randomUUID()}.xlsx`],
    );
    const batch = async (n, status, ageDays) => {
      const id = crypto.randomUUID();
      await q(
        `INSERT INTO import_batch (import_batch_id, number, importer_key, document_id, file_name, status, created_at, previewed_at)
         VALUES ($1, $2, 'staff', $3, 'staff.xlsx', $4, now() - make_interval(days => $5), now() - make_interval(days => $5))`,
        [id, n, src.document_id, status, ageDays],
      );
      await q(
        `INSERT INTO import_row (import_batch_id, row_number, raw, "values", status, action) VALUES ($1, 2, '{}', '{}', 'ok', 'create')`,
        [id],
      );
      return id;
    };
    const old = await batch("IMP-9001", "previewed", 20);
    const fresh = await batch("IMP-9002", "previewed", 2);
    const committed = await batch("IMP-9003", "committed", 40);

    expect(await engine.expireAbandoned({ db: pool })).toEqual({ expired: 1 });
    expect(
      await one(
        "SELECT status, stats->>'expired' AS expired FROM import_batch WHERE import_batch_id = $1",
        [old],
      ),
    ).toEqual({ status: "failed", expired: "true" });
    const rows = async (id) =>
      (
        await one(
          "SELECT count(*)::int AS n FROM import_row WHERE import_batch_id = $1",
          [id],
        )
      ).n;
    expect(await rows(old)).toBe(0);
    expect(await rows(fresh)).toBe(1);
    expect(await rows(committed)).toBe(1);
    expect(
      await one(
        "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'import.expired'",
      ),
    ).toEqual({ n: 1 });
    expect(await engine.expireAbandoned({ db: pool })).toEqual({ expired: 0 });
  });
});

describe("schedules and heartbeat", () => {
  test("ticked schedulers are registered once; the outbox poll runs in process", async () => {
    const started = await registry.startSchedules();
    started.stop();
    expect(started.in_process).toEqual(["outbox-dispatch"]);
    const again = await registry.startSchedules();
    again.stop();
    const ids = (
      await queues.getQueue(registry.SCHEDULE_QUEUE).getJobSchedulers(0, -1)
    )
      .map((s) => s.key || s.id)
      .sort();
    expect(ids).toEqual([
      "alert-ageing",
      "announcement-release",
      "attendance-clock-watch",
      "attendance-day-close",
      "celebrations",
      "export-cleanup",
      "home-alert-sweeps",
      "import-cleanup",
      "mail-sync",
      "media-reconcile",
      "reminders",
      "scheduled-reports",
      "urgent-repeats",
      "workflow-timeout",
    ]);
  });

  test("a schedule tick runs its sweep under the lock", async () => {
    const byName = new Map(registry.schedules().map((s) => [s.name, s]));
    expect(await byName.get("alert-ageing").run()).toEqual({ escalated: 0 });
    expect(await byName.get("home-alert-sweeps").run()).toEqual({ rules: 0, raised: 0, refreshed: 0, skipped: 0, failed: 0 });
    expect(await byName.get("scheduled-reports").run()).toEqual({ due: 0 });
    expect(await byName.get("workflow-timeout").run()).toMatchObject({
      due: 0,
    });
    expect(await byName.get("outbox-dispatch").run()).toMatchObject({
      claimed: expect.any(Number),
    });
  });

  test("readiness sees a worker only while its heartbeat is fresh", async () => {
    expect(await registry.workerHealth()).toMatchObject({
      status: "degraded",
      workers: 0,
    });
    const stop = registry.startHeartbeat();
    await until(async () => (await registry.workerHealth()).workers === 1);
    await stop();
    expect(await registry.workerHealth()).toMatchObject({
      status: "degraded",
      workers: 0,
    });
  });
});

describe("scripts", () => {
  const connect = async () => {
    const c = new Client({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
    });
    await c.connect();
    // The runner's own tests use throwaway files and a ledger of their own, in a schema of
    // their own: public holds the real migrations and their ledger.
    await c.query("CREATE SCHEMA IF NOT EXISTS runner_test");
    await c.query("SET search_path TO runner_test, public");
    return c;
  };

  test("migrate applies in order, records hashes, refuses an edited file, undoes the last", async () => {
    const dir = tmp("mycity-migrations-");
    const write = (name, up, down) =>
      fs.writeFileSync(
        path.join(dir, name),
        `-- UP\n${up}\n-- DOWN\n${down}\n`,
      );
    write(
      "0001_mig_a.sql",
      "CREATE TABLE IF NOT EXISTS mig_a (x int);",
      "DROP TABLE IF EXISTS mig_a;",
    );
    write(
      "0002_mig_b.sql",
      "CREATE TABLE IF NOT EXISTS mig_b (x int);",
      "DROP TABLE IF EXISTS mig_b;",
    );
    const c = await connect();
    try {
      expect(await migrate.migrate(c, { dir })).toEqual({
        applied: ["0001_mig_a", "0002_mig_b"],
        head: "0002_mig_b",
      });
      expect(await migrate.migrate(c, { dir })).toEqual({
        applied: [],
        head: "0002_mig_b",
      });

      write(
        "0001_mig_a.sql",
        "CREATE TABLE IF NOT EXISTS mig_a (x int, y int);",
        "DROP TABLE IF EXISTS mig_a;",
      );
      await expect(migrate.migrate(c, { dir })).rejects.toThrow(
        /changed after they were applied: 0001_mig_a/,
      );
      expect((await migrate.status(c, dir)).changed).toEqual(["0001_mig_a"]);
      write(
        "0001_mig_a.sql",
        "CREATE TABLE IF NOT EXISTS mig_a (x int);",
        "DROP TABLE IF EXISTS mig_a;",
      );

      write(
        "0003_mig_bad.sql",
        "CREATE TABLE mig_c (x int);\nSELECT * FROM no_such_table;",
        "DROP TABLE IF EXISTS mig_c;",
      );
      await expect(migrate.migrate(c, { dir })).rejects.toThrow(
        /0003_mig_bad.sql failed, nothing of it was applied/,
      );
      expect(await one("SELECT to_regclass('mig_c') AS t")).toEqual({
        t: null,
      });
      fs.rmSync(path.join(dir, "0003_mig_bad.sql"));

      expect(await migrate.down(c, { dir })).toBe("0002_mig_b");
      expect(await one("SELECT to_regclass('mig_b') AS t")).toEqual({
        t: null,
      });
      expect((await migrate.status(c, dir)).pending).toEqual(["0002_mig_b"]);
    } finally {
      await c.query("DROP TABLE IF EXISTS mig_a, mig_b, schema_migration");
      await c.end();
    }
  });

  test("migrate orders M10 after M9, and --down refuses a file declared irreversible", async () => {
    const dir = tmp("mycity-migrations-");
    const write = (name, up, down) =>
      fs.writeFileSync(
        path.join(dir, name),
        `-- UP\n${up}\n-- DOWN\n${down}\n`,
      );
    write(
      "9000_mig_n.sql",
      "CREATE TABLE IF NOT EXISTS mig_n (x int);",
      "-- IRREVERSIBLE: test of the refusal",
    );
    write(
      "10000_mig_t.sql",
      "ALTER TABLE mig_n ADD COLUMN IF NOT EXISTS y int;",
      "ALTER TABLE mig_n DROP COLUMN IF EXISTS y;",
    );
    const c = await connect();
    try {
      expect(await migrate.migrate(c, { dir, until: 9000 })).toEqual({
        applied: ["9000_mig_n"],
        head: "9000_mig_n",
      });
      expect(await migrate.migrate(c, { dir })).toEqual({
        applied: ["10000_mig_t"],
        head: "10000_mig_t",
      });
      expect(await migrate.down(c, { dir })).toBe("10000_mig_t");
      await expect(migrate.down(c, { dir })).rejects.toThrow(
        /9000_mig_n\.sql is declared irreversible \(test of the refusal\)/,
      );
      expect((await migrate.status(c, dir)).applied).toEqual(["9000_mig_n"]);
    } finally {
      await c.query("DROP TABLE IF EXISTS mig_n, schema_migration");
      await c.end();
    }
  });

  test("the reversibility round trip: UP, each DOWN against the catalogue before it, UP again", async () => {
    const rev = require("../../scripts/check/migration-reversibility");
    const dir = tmp("mycity-roundtrip-");
    const write = (name, up, down) =>
      fs.writeFileSync(
        path.join(dir, name),
        `-- UP\n${up}\n-- DOWN\n${down}\n`,
      );
    write(
      "0001_rt_a.sql",
      "CREATE TABLE IF NOT EXISTS rt_a (rt_a_id int PRIMARY KEY, label text);\nCREATE OR REPLACE FUNCTION rt_touch() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;",
      "DROP FUNCTION IF EXISTS rt_touch();\nDROP TABLE IF EXISTS rt_a;",
    );
    write(
      "0002_rt_b.sql",
      "ALTER TABLE rt_a ADD COLUMN IF NOT EXISTS note text;\nCREATE INDEX IF NOT EXISTS rt_a_note_idx ON rt_a (note);",
      "DROP INDEX IF EXISTS rt_a_note_idx;\nALTER TABLE rt_a DROP COLUMN IF EXISTS note;",
    );
    const url = process.env.DATABASE_URL;
    expect(await rev.roundTrip({ databaseUrl: url, dir })).toEqual({
      problems: [],
      notes: [],
    });

    write(
      "0002_rt_b.sql",
      "ALTER TABLE rt_a ADD COLUMN IF NOT EXISTS note text;\nCREATE INDEX IF NOT EXISTS rt_a_note_idx ON rt_a (note);",
      "DROP INDEX IF EXISTS rt_a_note_idx;\nALTER TABLE rt_a DROP COLUMN IF EXISTS label;",
    );
    const bad = await rev.roundTrip({ databaseUrl: url, dir });
    expect(bad.problems).toEqual([
      "migrations/0002_rt_b.sql: after DOWN, column public.rt_a.note is still there",
      "migrations/0002_rt_b.sql: DOWN removed column public.rt_a.label, which existed before its UP",
    ]);
    const left = await one(
      "SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'mycity_revcheck_%'",
    );
    expect(left.n).toBe(0);
  });

  test("seed refuses a database that does not say it is not production, then runs its files", async () => {
    const root = tmp("mycity-seeds-");
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(
      path.join(root, "build", "10_things.js"),
      'module.exports = async ({ pool, actor }) => { await pool.query("CREATE TABLE IF NOT EXISTS seeded (by text)"); await pool.query("INSERT INTO seeded VALUES ($1)", [actor.source]); };',
    );
    const run = () =>
      seed.seed({
        mode: "build",
        db: pool,
        appEnv: "test",
        dbName: config.DB_NAME,
        root,
      });
    await expect(run()).rejects.toMatchObject({
      code: "SEED_REFUSED",
      problems: [expect.stringMatching(/system_marker has no row/)],
    });
    await q("INSERT INTO system_marker (environment) VALUES ('production')");
    await expect(run()).rejects.toMatchObject({
      problems: [expect.stringMatching(/says production/)],
    });
    await q("UPDATE system_marker SET environment = 'development'");
    expect(await run()).toEqual({ ran: ["10_things.js"] });
    expect(await one("SELECT by FROM seeded")).toEqual({ by: "script:seed" });
    await q("DROP TABLE seeded");
    await q("DELETE FROM system_marker");
  });
});

describe("the worker process", () => {
  test("boots, renders a queued document through Chromium, and stops cleanly on SIGTERM", async () => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "..", "..", "src", "worker.js")],
      {
        env: { ...process.env, MYCITY_SKIP_DOTENV: "1", LOG_LEVEL: "warn" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const exited = new Promise((r) => child.on("exit", (code) => r(code)));
    try {
      await until(
        async () => (await registry.workerHealth()).workers === 1,
        20_000,
      );

      const id = crypto.randomUUID();
      await tx(async (c) => {
        await c.query(
          `INSERT INTO document (document_id, doc_type, original_name, storage_key, mime, bytes, entity_type, entity_id, sensitivity,
                                 scan_status, source, render_status, render_html, number)
           VALUES ($1, 'test_doc', 'letter.pdf', $2, 'application/pdf', 0, 'employee', 'e1', 'normal', 'skipped', 'generated',
                   'pending', '<h1>Rendered by the worker</h1>', 'LTR-WORKER-1')`,
          [id, `generated/2026/10/${id}.pdf`],
        );
        await emit(c, {
          key: "document.render_requested",
          entity: { type: "document", id },
          module: "settings",
          actor: null,
          payload: { document_id: id },
        });
      });
      const row = await until(async () => {
        const r = await one(
          "SELECT render_status, bytes, content_hash, locked_at FROM document WHERE document_id = $1",
          [id],
        );
        return r.render_status !== "pending" && r;
      }, 30_000);
      expect(row.render_status).toBe("done");
      expect(Number(row.bytes)).toBeGreaterThan(1000);
      expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.locked_at).not.toBeNull();
    } finally {
      child.kill("SIGTERM");
    }
    expect(await exited).toBe(0);
    expect(await registry.workerHealth()).toMatchObject({ workers: 0 });
    expect(output).not.toMatch(/"level":(50|60)/);
  }, 60_000);
});

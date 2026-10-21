"use strict";
/**
 * Home · Reports end to end (docs/guides/home.md §3 steps 7 and 8, §5, §6 Reports, §7, §8, §9):
 * the real migrations and reference seeds, the whole app over HTTP, every response parsed with
 * its contract (APP_ENV=test checks each one too).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-reports
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person here is invented.
 *
 * Reports are built, shared, scheduled, paused, run and archived on the tab's own routes; then
 * the outbox builds each file as its recipient (the PDF rendered by a stand-in for Chromium,
 * which tests do not have), the scheduler fires a slot, and the Overview is exported.
 *
 * People: the CEO; Operations (every grant, `home.reports`); a line manager over Musa and
 * Zainab; Musa, Zainab and Bisi, staff without `home.reports`, Bisi outside the manager's team;
 * a clerk who holds `home.reports` and no People grant; Dayo, a second line manager who will
 * be suspended; Tola and Yemi, report readers who will lose the People grant and `home.reports`.
 * Musa and Bisi were late today; Zainab was in on time.
 */
const request = require("supertest");
const ExcelJS = require("exceljs");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const documents = require("../../src/shared/documents/generate");
const storage = require("../../src/services/storage/storage.service");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const searchService = require("../../src/shared/search/search.service");
const realtime = require("../../src/services/realtime/emitter");
const queues = require("../../src/jobs/queues");
const schedule = require("../../src/modules/reports/reports.schedule");
const reports = require("../../src/modules/reports/reports.service");
const reportsRepo = require("../../src/modules/reports/reports.repo");

// The queues and the socket emitter would hold Redis connections open past the run; the calls
// are what the tests read: the email for each file, the scheduler's jobs.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const r = c.reports;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Home-Reports9Test";
const MINUTE_MS = 60_000;

/** A service answer as the wire carries it: what the route's response check parses. */
const wire = (value) => JSON.parse(JSON.stringify(value));

const countEvents = async (key) => (await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = $1", [key])).n;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const res = await outbox.dispatchDue({ db: pool });
    if (res.claimed === 0) return;
  }
}

/** The emails queued for report files, newest last. */
const reportEmails = () =>
  queues.enqueue.mock.calls
    .filter(([queue, name]) => queue === "email-send" && name === "home-report")
    .map(([, , data, opts]) => ({ ...data, job_id: opts.jobId }));

/** A run as the database holds it now. */
const runRow = (id) =>
  one("SELECT status, document_id, emailed_at, error, finished_at FROM home_report_run WHERE home_report_run_id = $1", [
    id,
  ]);

/** The rows of a stored workbook's sheet, its header first; the first data sheet unless named. */
async function sheetRows(documentId, name = null) {
  const doc = await one("SELECT storage_key, doc_type, mime FROM document WHERE document_id = $1", [documentId]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await storage.get(doc.storage_key));
  const ws = name ? book.getWorksheet(name) : book.worksheets.find((s) => s.name !== "Cover" && s.name !== "Summary");
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1)));
  return { doc, sheets: book.worksheets.map((s) => s.name), rows };
}

/** A stand-in for Chromium: tests have no browser, and the run only needs a PDF to exist. */
const fakePdf = async () => Buffer.from("%PDF-1.4\n% a report\n");

describeDb("Home · Reports against the real migrations", () => {
  let app;
  let today;
  const people = {};
  const ids = {};
  const tokens = {};
  const users = {};
  const made = {};
  const runs = {};

  const as = (who) => {
    const auth = (req) => req.set("Authorization", `Bearer ${tokens[who]}`);
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      patch: (path, body = {}) => auth(request(app).patch(`/api/v1${path}`)).send(body),
    };
  };

  /** A list over HTTP, every page, each parsed with its contract. */
  async function everyPage(who, path, schema) {
    const rows = [];
    for (let n = 1; ; n += 1) {
      const res = await as(who).get(`${path}${path.includes("?") ? "&" : "?"}page=${n}`);
      expect([path, res.status]).toEqual([path, 200]);
      const page = schema.parse(res.body);
      rows.push(...page.data);
      if (!page.page.has_next) return rows;
    }
  }
  const reportsOf = (who, query = "") => everyPage(who, `/home/reports${query}`, r.HomeReportPage);
  const namesOf = async (who, query = "") => (await reportsOf(who, query)).map((x) => x.name).sort();
  const runsOf = (who, query = "") => everyPage(who, `/home/report-runs${query}`, r.HomeReportRunPage);

  /** POST a report as someone, answered 201 and parsed. */
  async function build(who, body) {
    const res = await as(who).post("/home/reports", body);
    expect([body.name, res.status, res.body.error]).toEqual([body.name, 201, undefined]);
    return r.HomeReport.parse(res.body);
  }

  /** Run Now as someone, answered 202 and parsed. */
  async function runNow(who, report, format, headers = {}) {
    let req = as(who).post(`/home/reports/${report.saved_report_id}/run`, { format });
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const res = await req;
    expect([report.name, res.status, res.body.error]).toEqual([report.name, 202, undefined]);
    return r.HomeReportRun.parse(res.body);
  }

  /** A role made on Settings, with its grants and capabilities. */
  async function role(code, name, perms, capabilities) {
    const { role_id: id } = await one("INSERT INTO role (code, name, home_view) VALUES ($1, $2, 'staff') RETURNING role_id", [
      code,
      name,
    ]);
    for (const [module, scope, actions] of perms)
      await q(
        `INSERT INTO permission (role_id, module_key, scope, can_view, can_create, can_edit, can_delete, can_approve, can_export)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, module, scope, ...["view", "create", "edit", "delete", "approve", "export"].map((x) => actions.includes(x))],
      );
    for (const capability of capabilities)
      await q("INSERT INTO role_capability (role_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = $2", [
        id,
        capability,
      ]);
    return id;
  }

  const daily = (over = {}) => ({
    recurrence: { freq: "daily", working_days_only: true },
    starts_on: today,
    run_time: "18:00",
    formats: ["pdf", "xlsx"],
    recipient_user_ids: [],
    ...over,
  });

  /** One Lagos day's attendance: Musa and Bisi late, Zainab in on time. Written once a day. */
  async function attend(day) {
    for (const [who, status, late] of [
      ["staff", "late", 30],
      ["outsider", "late", 12],
      ["remote", "present", 0],
    ])
      await q(
        `INSERT INTO attendance_day (employee_id, attendance_date, status, first_clock_in_at, late_minutes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, attendance_date) DO NOTHING`,
        [ids[who], day, status, lagos.instant(day, "09:00"), late],
      );
  }

  /**
   * Hold the `report_run` counter while a slot fires and `other` runs, then let both finish: the
   * slot's job has taken its locks up to the counter, and `other` is waiting on one of them.
   * @returns {Promise<[object, object]>} what each answered, an error as it was thrown
   */
  async function whileFiring(scheduleId, slot, other) {
    const waiting = async (n) => {
      for (let i = 0; i < 200; i += 1) {
        const row = await one(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (row.n >= n) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`whileFiring: ${n} waiting transactions never came`);
    };
    const holder = await pool.connect();
    let open = false;
    try {
      await holder.query("BEGIN");
      open = true;
      const held = await holder.query("SELECT 1 FROM numbering_counter WHERE doc_type = 'report_run' FOR UPDATE");
      expect(held.rowCount).toBe(1);
      const fired = reports.fireSlot(scheduleId, slot).catch((err) => err);
      await waiting(1);
      // A request is sent once something waits on it.
      const changed = Promise.resolve(other());
      await waiting(2);
      await holder.query("COMMIT");
      open = false;
      return await Promise.all([fired, changed]);
    } finally {
      if (open) await holder.query("ROLLBACK");
      holder.release();
    }
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    today = lagos.today();

    await role("report_clerk", "Report Clerk", [["home", "own", ["view"]]], ["home.reports"]);
    await role("reader_a", "Report Reader A", [["home", "own", ["view"]], ["people", "all", ["view"]]], ["home.reports"]);
    await role("reader_b", "Report Reader B", [["home", "own", ["view"]], ["people", "all", ["view"]]], ["home.reports"]);

    const make = (who, first, last, roleCode, job, department, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@reports.mycity.test`,
              phone: "08031234567",
              job_title: job,
              department_name: department,
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: roleCode,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
        ids[who] = people[who].employee.employee_id;
      });
    await make("ceo", "Ifeoma", "Nwankwo", "management", "Chief Executive Officer", "Management", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    await make("remote", "Zainab", "Lawal", "employee", "Field Officer", "Programmes");
    await make("outsider", "Bisi", "Ojo", "employee", "Accounts Officer", "Operations");
    await make("clerk", "Chidi", "Eze", "report_clerk", "Records Officer", "Operations");
    await make("leaver", "Dayo", "Ola", "manager", "Programme Lead", "Programmes");
    await make("tola", "Tola", "Ade", "reader_a", "People Officer", "Operations");
    await make("yemi", "Yemi", "Bello", "reader_b", "People Officer", "Operations");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      ids.manager,
      [ids.staff, ids.remote],
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [ids.ops, ids.outsider]);
    await grantsCache.bumpTeamVersion();

    await attend(today);
    await drain();

    let ip = 0;
    for (const who of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.75.0.${ip}`)
        .send({ email: `${who}@reports.mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
      users[who] = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const userId = (who) => people[who].user.user_id;

  /* ---------------------------------------------------------------- *
   * Who may use Reports
   * ---------------------------------------------------------------- */

  test("only a holder of `home.reports` reads, builds or runs reports", async () => {
    for (const res of [
      await as("staff").get("/home/reports"),
      await as("staff").get("/home/reports/summary"),
      await as("staff").get("/home/report-runs"),
      await as("staff").post("/home/reports", { name: "Mine", report_key: "headcount" }),
    ])
      expect([res.status, res.body.error.code]).toEqual([403, "CAPABILITY_REQUIRED"]);
    expect((await request(app).get("/api/v1/home/reports")).status).toBe(401);
  });

  /* ---------------------------------------------------------------- *
   * Building a report
   * ---------------------------------------------------------------- */

  describe("building a report", () => {
    test("a schedule runs from its next slot in Lagos, to the people chosen, in order", async () => {
      const body = {
        name: "Late Today",
        report_key: "daily_attendance",
        filters: { roster_statuses: ["late"] },
        shared: true,
        schedule: daily({ recipient_user_ids: [userId("manager"), userId("ops")] }),
      };
      const calendar = await workingWeek.loadCalendar(pool);
      const before = schedule.nextSlot(body.schedule, new Date(), calendar).toISOString();
      const created = await countEvents("home.report_created");
      made.late = await build("manager", body);
      const after = schedule.nextSlot(body.schedule, new Date(), calendar).toISOString();

      expect(made.late).toMatchObject({
        name: "Late Today",
        report_key: "daily_attendance",
        filters: { roster_statuses: ["late"] },
        shared: true,
        owner_user_id: userId("manager"),
        owner_name: "Kemi Alade",
        status: "scheduled",
        can_edit: true,
        archived_at: null,
        schedule: {
          recurrence: { freq: "daily", working_days_only: true },
          starts_on: today,
          run_time: "18:00",
          formats: ["pdf", "xlsx"],
          active: true,
          last_run_at: null,
          audience: [
            { user_id: userId("manager"), display_name: "Kemi Alade", email: "manager@reports.mycity.test" },
            { user_id: userId("ops"), display_name: "Tunde Bakare", email: "ops@reports.mycity.test" },
          ],
        },
      });
      expect([before, after]).toContain(new Date(made.late.schedule.next_run_at).toISOString());
      expect(await one("SELECT recipients::text[] AS recipients, timezone FROM report_schedule WHERE saved_report_id = $1", [
        made.late.saved_report_id,
      ])).toEqual({ recipients: ["manager@reports.mycity.test", "ops@reports.mycity.test"], timezone: "Africa/Lagos" });
      expect((await countEvents("home.report_created")) - created).toBe(1);
    });

    test("a name is the owner's once, case aside; another owner may use it", async () => {
      const res = await as("manager").post("/home/reports", { name: "late today", report_key: "headcount" });
      expect([res.status, res.body.error.code, res.body.error.fields]).toEqual([
        409,
        "REPORT_NAME_TAKEN",
        { name: ["Name already used"] },
      ]);
      made.opsLate = await build("ops", { name: "Late Today", report_key: "daily_attendance" });
      expect(made.opsLate).toMatchObject({ status: "on_demand", schedule: null, shared: false, filters: {} });
    });

    test("two saves of one name at once, case aside, make one report", async () => {
      // A save of the owner's is under way: both wait for it, then take turns with the name.
      const holder = await pool.connect();
      let both;
      let open = false;
      try {
        await holder.query("BEGIN");
        open = true;
        await reportsRepo.lockOwner(holder, userId("ops"));
        const answered = [];
        const sent = ["Same Time", "same time"].map((name) =>
          as("ops")
            .post("/home/reports", { name, report_key: "headcount" })
            .then((res) => {
              answered.push(res.status);
              return res;
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(answered).toEqual([]);
        await holder.query("COMMIT");
        open = false;
        both = await Promise.all(sent);
      } finally {
        if (open) await holder.query("ROLLBACK");
        holder.release();
      }
      expect(both.map((res) => res.status).sort()).toEqual([201, 409]);
      const kept = both.find((res) => res.status === 201).body;
      // Archived, so the lists below hold only the reports they name.
      expect((await as("ops").post(`/home/reports/${kept.saved_report_id}/archive`)).status).toBe(200);
    });

    test("the source is one the creator may open, never the Overview, with filters it takes", async () => {
      const refused = async (who, body, field, message) => {
        const res = await as(who).post("/home/reports", body);
        expect([who, res.status, res.body.error.fields[field]]).toEqual([who, 422, [message]]);
      };
      await refused("clerk", { name: "People In", report_key: "daily_attendance" }, "report_key", "Not open to you");
      await refused("manager", { name: "Hiring", report_key: "recruitment" }, "report_key", "Not open to you");
      // Open Alerts is opened as its tab is: `alerts.clear` or `alerts.manage`, which the clerk holds neither of.
      await refused("clerk", { name: "Alerts Now", report_key: "open_alerts" }, "report_key", "Not open to you");
      await refused("ops", { name: "Mine", report_key: "overview" }, "report_key", "Choose a source");
      await refused("ops", { name: "Mine", report_key: "headcount", filters: { severity: "high" } }, "filters.severity", "Not for this source");
      const nowhere = "0b6e4f1c-7d1a-4a8e-9f0e-2c3d4e5f6a7b";
      await refused("ops", { name: "Mine", report_key: "headcount", filters: { department_id: nowhere } }, "filters.department_id", "Department not found");
      await refused("ops", { name: "Mine", report_key: "leave", filters: { leave_type_id: nowhere } }, "filters.leave_type_id", "Leave type not found");
      expect(await one("SELECT count(*)::int AS n FROM saved_report WHERE name IN ('Mine', 'Alerts Now')")).toEqual({ n: 0 });
    });

    test("every recipient may receive it: an active login with `home.reports` who may open its source", async () => {
      // Each person refused is named, so the form can say whom to take off.
      const refused = async (recipients, messages) => {
        const res = await as("ops").post("/home/reports", {
          name: "Leave Watch",
          report_key: "leave",
          schedule: daily({ recipient_user_ids: recipients }),
        });
        expect([res.status, res.body.error.fields]).toEqual([422, { "schedule.recipient_user_ids": messages }]);
      };
      await refused([userId("staff")], ["Musa Danjuma: no access"]);
      await refused([userId("manager"), userId("clerk")], ["Chidi Eze: no access"]);
      await refused([userId("clerk"), userId("manager"), userId("staff")], ["Chidi Eze: no access", "Musa Danjuma: no access"]);
      await refused(["0b6e4f1c-7d1a-4a8e-9f0e-2c3d4e5f6a7b"], ["Cannot receive this report"]);
      expect(await one("SELECT count(*)::int AS n FROM saved_report WHERE name = 'Leave Watch'")).toEqual({ n: 0 });
    });

    test("Operations build a private weekly report for the manager, and a headcount on demand", async () => {
      made.leave = await build("ops", {
        name: "Leave Requests",
        report_key: "leave",
        filters: { leave_status: "submitted" },
        schedule: daily({
          recurrence: { freq: "weekly", by_weekday: [1] },
          // Two weeks out, so no Monday 08:00 comes due while this file runs.
          starts_on: lagos.addDays(today, 14),
          run_time: "08:00",
          formats: ["xlsx"],
          recipient_user_ids: [userId("manager")],
        }),
      });
      expect(made.leave).toMatchObject({ status: "scheduled", shared: false, schedule: { formats: ["xlsx"] } });
      expect(lagos.weekday(lagos.dateOf(new Date(made.leave.schedule.next_run_at)))).toBe(1);
      expect(lagos.timeOf(new Date(made.leave.schedule.next_run_at))).toBe("08:00");
      made.headcount = await build("ops", { name: "Ops Headcount", report_key: "headcount" });
    });
  });

  /* ---------------------------------------------------------------- *
   * Who sees a report
   * ---------------------------------------------------------------- */

  describe("who sees a report", () => {
    test("its owner, its recipients, and holders who may open the source of a shared one; the CEO every one", async () => {
      expect(await namesOf("manager")).toEqual(["Late Today", "Leave Requests"]);
      expect(await namesOf("ops")).toEqual(["Late Today", "Late Today", "Leave Requests", "Ops Headcount"]);
      expect(await namesOf("tola")).toEqual(["Late Today"]);
      expect(await namesOf("clerk")).toEqual([]);
      expect(await namesOf("ceo")).toEqual(["Late Today", "Late Today", "Leave Requests", "Ops Headcount"]);
      const shared = (await reportsOf("ops")).find((x) => x.saved_report_id === made.late.saved_report_id);
      expect(shared).toMatchObject({ owner_name: "Kemi Alade", can_edit: false });
    });

    test("one report is a 404 for whoever may not see it", async () => {
      const path = `/home/reports/${made.late.saved_report_id}`;
      expect(r.HomeReport.parse((await as("tola").get(path)).body).name).toBe("Late Today");
      for (const [who, id] of [
        ["clerk", made.late.saved_report_id],
        ["manager", made.headcount.saved_report_id],
        ["manager", made.opsLate.saved_report_id],
      ]) {
        const res = await as(who).get(`/home/reports/${id}`);
        expect([who, res.status, res.body.error.code]).toEqual([who, 404, "NOT_FOUND"]);
      }
    });

    test("the list filters by mine, source, status and name, and sorts by name or created", async () => {
      expect(await namesOf("ops", "?mine=true")).toEqual(["Late Today", "Late Today", "Leave Requests", "Ops Headcount"]);
      expect(await namesOf("tola", "?mine=true")).toEqual([]);
      expect(await namesOf("ops", "?report_key=headcount")).toEqual(["Ops Headcount"]);
      expect(await namesOf("ops", "?status=scheduled")).toEqual(["Late Today", "Leave Requests"]);
      expect(await namesOf("ops", "?status=on_demand")).toEqual(["Late Today", "Ops Headcount"]);
      expect(await namesOf("ops", "?q=leave")).toEqual(["Leave Requests"]);
      const newest = (await reportsOf("ops", "?sort=-created_at")).map((x) => x.name);
      expect(newest).toEqual(["Ops Headcount", "Leave Requests", "Late Today", "Late Today"]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Changing a report
   * ---------------------------------------------------------------- */

  describe("changing a report", () => {
    const path = () => `/home/reports/${made.late.saved_report_id}`;

    test("only its owner or the CEO changes it", async () => {
      const res = await as("ops").patch(path(), { name: "Mine Now" });
      expect([res.status, res.body.error.code]).toEqual([403, "REPORT_NOT_YOURS"]);
      const pause = await as("ops").patch(`${path()}/schedule`, { active: false });
      expect([pause.status, pause.body.error.code]).toEqual([403, "REPORT_NOT_YOURS"]);
      const renamed = r.HomeReport.parse((await as("ceo").patch(path(), { name: "Late Arrivals Today" })).body);
      expect(renamed).toMatchObject({ name: "Late Arrivals Today", can_edit: true });
      expect(r.HomeReport.parse((await as("manager").patch(path(), { name: "Late Today" })).body).name).toBe("Late Today");
    });

    test("saving it as it is records nothing", async () => {
      const updated = await countEvents("home.report_updated");
      const res = await as("manager").patch(path(), {
        name: "Late Today",
        filters: { roster_statuses: ["late"] },
        shared: true,
        schedule: daily({ recipient_user_ids: [userId("manager"), userId("ops")] }),
      });
      expect(res.status).toBe(200);
      expect(await countEvents("home.report_updated")).toBe(updated);
    });

    test("pausing keeps the rule and has no next slot; a schedule saved while paused stays paused", async () => {
      const paused = r.HomeReport.parse((await as("manager").patch(`${path()}/schedule`, { active: false })).body);
      expect(paused).toMatchObject({ status: "paused", schedule: { active: false, next_run_at: null, run_time: "18:00" } });
      const saved = r.HomeReport.parse(
        (await as("manager").patch(path(), {
          schedule: daily({ run_time: "17:30", recipient_user_ids: [userId("manager"), userId("ops")] }),
        })).body,
      );
      expect(saved).toMatchObject({ status: "paused", schedule: { active: false, next_run_at: null, run_time: "17:30" } });
      const resumedFrom = Date.now();
      const resumed = r.HomeReport.parse((await as("manager").patch(`${path()}/schedule`, { active: true })).body);
      expect(resumed).toMatchObject({ status: "scheduled", schedule: { active: true, run_time: "17:30" } });
      expect(lagos.timeOf(new Date(resumed.schedule.next_run_at))).toBe("17:30");
      expect(new Date(resumed.schedule.next_run_at).getTime()).toBeGreaterThan(resumedFrom);
      const change = await one(
        "SELECT payload FROM event_log WHERE event_key = 'home.report_updated' ORDER BY occurred_at DESC LIMIT 1",
      );
      expect(change.payload).toMatchObject({ changed: ["active"] });
    });

    test("filters stay the source's; a report on demand has no schedule to pause", async () => {
      const res = await as("manager").patch(path(), { filters: { category: "attendance" } });
      expect([res.status, res.body.error.fields]).toEqual([422, { "filters.category": ["Not for this source"] }]);
      const none = await as("ops").patch(`/home/reports/${made.headcount.saved_report_id}/schedule`, { active: false });
      expect([none.status, none.body.error.code]).toEqual([409, "REPORT_ON_DEMAND"]);
    });

    test("a schedule taken away makes it on demand", async () => {
      const temp = await build("ops", {
        name: "Temporary",
        report_key: "headcount",
        schedule: daily({ recipient_user_ids: [userId("ops")] }),
      });
      const res = await as("ops").patch(`/home/reports/${temp.saved_report_id}`, { schedule: null });
      expect(r.HomeReport.parse(res.body)).toMatchObject({ status: "on_demand", schedule: null });
      expect(await one("SELECT count(*)::int AS n FROM report_schedule WHERE saved_report_id = $1", [temp.saved_report_id])).toEqual({
        n: 0,
      });
      expect((await as("ops").post(`/home/reports/${temp.saved_report_id}/archive`)).status).toBe(200);
    });
  });

  /* ---------------------------------------------------------------- *
   * Run Now
   * ---------------------------------------------------------------- */

  describe("Run Now", () => {
    test("answers one pending file for the caller; pressing again is the same run", async () => {
      const queued = await countEvents("home.report_run");
      runs.managerPdf = await runNow("manager", made.late, "pdf");
      expect(runs.managerPdf).toMatchObject({
        number: expect.stringMatching(/^RPT-\d{4}$/),
        report_name: "Late Today",
        report_key: "daily_attendance",
        report_schedule_id: null,
        scheduled_for: null,
        recipient_user_id: userId("manager"),
        recipient_name: "Kemi Alade",
        requested_by: userId("manager"),
        format: "pdf",
        status: "pending",
        document_id: null,
        emailed_at: null,
        finished_at: null,
      });
      const again = await runNow("manager", made.late, "pdf");
      expect(again.home_report_run_id).toBe(runs.managerPdf.home_report_run_id);
      const key = { "Idempotency-Key": "run-now-late-today-1" };
      const first = await runNow("manager", made.late, "xlsx", key);
      const replay = await runNow("manager", made.late, "xlsx", key);
      expect(replay.home_report_run_id).toBe(first.home_report_run_id);
      runs.managerXlsx = first;
      expect((await countEvents("home.report_run")) - queued).toBe(2);
    });

    test("the format is one the schedule offers; a report on demand offers either", async () => {
      const res = await as("manager").post(`/home/reports/${made.leave.saved_report_id}/run`, { format: "pdf" });
      expect([res.status, res.body.error.fields]).toEqual([422, { format: ["Not offered"] }]);
      runs.leave = await runNow("manager", made.leave, "xlsx");
      runs.headcountPdf = await runNow("ops", made.headcount, "pdf");
      runs.headcountXlsx = await runNow("ops", made.headcount, "xlsx");
    });

    test("whoever sees a shared report runs it for themselves; whoever does not is a 404", async () => {
      runs.opsLate = await runNow("ops", made.late, "xlsx");
      expect(runs.opsLate).toMatchObject({ recipient_user_id: userId("ops"), requested_by: userId("ops") });
      const res = await as("clerk").post(`/home/reports/${made.late.saved_report_id}/run`, { format: "pdf" });
      expect([res.status, res.body.error.code]).toEqual([404, "NOT_FOUND"]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Recent Runs
   * ---------------------------------------------------------------- */

  describe("Recent Runs", () => {
    const numbers = (rows) => rows.map((x) => x.number);

    test("the files the reader received and every file of the reports they own, newest first", async () => {
      const manager = await runsOf("manager");
      expect(numbers(manager)).toEqual(
        numbers([runs.opsLate, runs.leave, runs.managerXlsx, runs.managerPdf]),
      );
      const ops = await runsOf("ops");
      expect(numbers(ops)).toEqual(numbers([runs.opsLate, runs.headcountXlsx, runs.headcountPdf, runs.leave]));
      expect(await runsOf("tola")).toEqual([]);
      expect(await runsOf("ceo")).toHaveLength(6);
    });

    test("filters by report, status and format", async () => {
      expect(numbers(await runsOf("manager", `?saved_report_id=${made.late.saved_report_id}`))).toEqual(
        numbers([runs.opsLate, runs.managerXlsx, runs.managerPdf]),
      );
      expect(numbers(await runsOf("ops", "?format=pdf"))).toEqual([runs.headcountPdf.number]);
      expect(await runsOf("ops", "?status=done")).toEqual([]);
    });

    test("one run is read by whoever has it on Recent Runs; anyone else is answered 404", async () => {
      const path = `/home/report-runs/${runs.opsLate.home_report_run_id}`;
      const listed = (await runsOf("ops")).find((x) => x.home_report_run_id === runs.opsLate.home_report_run_id);
      // Its recipient, its report's owner and the CEO.
      for (const who of ["ops", "manager", "ceo"]) {
        const res = await as(who).get(path);
        expect([who, res.status]).toEqual([who, 200]);
        expect(r.HomeReportRun.parse(res.body)).toEqual(listed);
      }
      // Tola sees the shared report, not Tunde's file of it; the clerk sees neither.
      for (const [who, at] of [
        ["tola", path],
        ["clerk", path],
        ["ops", "/home/report-runs/0b6e4f1c-7d1a-4a8e-9f0e-2c3d4e5f6a7b"],
      ]) {
        const res = await as(who).get(at);
        expect([who, at, res.status, res.body.error.code]).toEqual([who, at, 404, "NOT_FOUND"]);
      }
      const staff = await as("staff").get(path);
      expect([staff.status, staff.body.error.code]).toEqual([403, "CAPABILITY_REQUIRED"]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Generating the files
   * ---------------------------------------------------------------- */

  describe("each file is built as its recipient", () => {
    beforeAll(async () => {
      // A file reads the roster of the Lagos day its run was made: the next day when Lagos
      // midnight falls during this file, so that day holds the same arrivals.
      for (const run of [runs.managerXlsx, runs.managerPdf, runs.opsLate]) await attend(lagos.today(new Date(run.run_at)));
      queues.enqueue.mockClear();
      await drain();
    });

    test("an XLSX is stored at once and its run done, for the screen that pressed: only the rows its recipient may see", async () => {
      const manager = await runRow(runs.managerXlsx.home_report_run_id);
      expect(manager).toMatchObject({ status: "done", document_id: expect.any(String), error: null });
      expect(manager.emailed_at).toBeNull();
      const mine = await sheetRows(manager.document_id);
      expect(mine.doc).toMatchObject({ doc_type: "home_report" });
      expect(mine.sheets).toEqual(["Cover", "Daily Attendance"]);
      expect(mine.rows[0]).toEqual(expect.arrayContaining(["Employee", "Status", "Clock-In", "Late Minutes"]));
      expect(mine.rows.slice(1).map((row) => row[0])).toEqual(["Musa Danjuma"]);

      const opsFile = await sheetRows((await runRow(runs.opsLate.home_report_run_id)).document_id);
      expect(opsFile.rows.slice(1).map((row) => row[0]).sort()).toEqual(["Bisi Ojo", "Musa Danjuma"]);
      expect(opsFile.rows.slice(1).map((row) => row[3])).toEqual(["Late", "Late"]);
    });

    test("Daily Attendance on the last working day lists who was absent, which today's roster never can", async () => {
      const roster = require("../../src/modules/attendance/attendance.roster");
      const lastDay = roster.yesterdayOf(lagos.today(), await workingWeek.loadCalendar(pool)).date;
      // As the day-close leaves it: Musa never came in, Bisi came in late.
      for (const [who, status, late, inAt] of [
        ["staff", "absent", 0, null],
        ["outsider", "late", 12, lagos.instant(lastDay, "09:12")],
      ])
        await q(
          `INSERT INTO attendance_day (employee_id, attendance_date, status, first_clock_in_at, late_minutes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (employee_id, attendance_date) DO UPDATE SET status = EXCLUDED.status,
             first_clock_in_at = EXCLUDED.first_clock_in_at, late_minutes = EXCLUDED.late_minutes`,
          [ids[who], lastDay, status, inAt, late],
        );
      const absent = await build("ops", {
        name: "Absent and Late",
        report_key: "daily_attendance",
        filters: { roster_day: "last_working_day", roster_statuses: ["absent", "late"] },
      });
      const absentToday = await as("ops").post("/home/reports", { name: "Absent Today", report_key: "daily_attendance", filters: { roster_statuses: ["absent"] } });
      expect([absentToday.status, absentToday.body.error.fields]).toEqual([422, { "filters.roster_statuses": ["Absent needs Last Working Day"] }]);

      const run = await runNow("ops", absent, "xlsx");
      await drain();
      const file = await sheetRows((await runRow(run.home_report_run_id)).document_id);
      const byName = Object.fromEntries(file.rows.slice(1).map((row) => [row[0], row[3]]));
      expect(byName).toEqual({ "Musa Danjuma": "Absent", "Bisi Ojo": "Late" });
      const cover = await sheetRows((await runRow(run.home_report_run_id)).document_id, "Cover");
      expect(cover.rows.flat().join(" ")).toContain(`Last Working Day, ${lastDay.slice(8, 10)}/${lastDay.slice(5, 7)}/${lastDay.slice(0, 4)}`);
    });

    test("the same Idempotency-Key answers the same run, even once its file is made", async () => {
      expect(await runRow(runs.managerXlsx.home_report_run_id)).toMatchObject({ status: "done" });
      const queued = await countEvents("home.report_run");
      const replay = await runNow("manager", made.late, "xlsx", { "Idempotency-Key": "run-now-late-today-1" });
      expect(replay.home_report_run_id).toBe(runs.managerXlsx.home_report_run_id);
      expect(await countEvents("home.report_run")).toBe(queued);
    });

    test("a run somebody pressed for is never emailed: its recipient downloads the file", async () => {
      expect(reportEmails()).toEqual([]);
      const file = await as("manager").get(`/documents/${(await runRow(runs.managerXlsx.home_report_run_id)).document_id}/content`);
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toMatch(/spreadsheetml/);
    });

    test("a PDF waits for its render, as the recipient sees it, and its run is done once it exists", async () => {
      const waiting = await runRow(runs.managerPdf.home_report_run_id);
      expect(waiting).toMatchObject({ status: "pending", emailed_at: null, document_id: expect.any(String) });
      const listed = (await runsOf("manager")).find((x) => x.home_report_run_id === runs.managerPdf.home_report_run_id);
      expect(listed).toMatchObject({ status: "pending", document_id: null });
      const doc = await one("SELECT render_html, render_status, number, title FROM document WHERE document_id = $1", [
        waiting.document_id,
      ]);
      expect(doc).toMatchObject({ render_status: "pending", number: null, title: "Late Today" });
      expect(doc.render_html).toContain(runs.managerPdf.number);
      expect(doc.render_html).toContain("Musa Danjuma");
      expect(doc.render_html).not.toContain("Bisi Ojo");
      expect(doc.render_html).toContain("Status: Late");
      expect(doc.render_html).toContain("size: A4 landscape");

      await documents.renderPending(waiting.document_id, { db: pool, renderPdf: fakePdf });
      await drain();
      expect(await runRow(runs.managerPdf.home_report_run_id)).toMatchObject({ status: "done", error: null });
      expect(reportEmails().filter((e) => e.job_id === `home-report-run-${runs.managerPdf.home_report_run_id}`)).toHaveLength(0);
      const done = (await runsOf("manager")).find((x) => x.home_report_run_id === runs.managerPdf.home_report_run_id);
      expect(done).toMatchObject({ status: "done", document_id: waiting.document_id, emailed_at: null });
    });

    test("a PDF the render job gives up on fails its run, and nothing is emailed", async () => {
      const waiting = await runRow(runs.headcountPdf.home_report_run_id);
      await documents.failRender(waiting.document_id, new Error("Chromium crashed"), { db: pool });
      await drain();
      expect(await runRow(runs.headcountPdf.home_report_run_id)).toMatchObject({
        status: "failed",
        error: "The PDF could not be rendered.",
      });
      expect(reportEmails().some((e) => e.job_id === `home-report-run-${runs.headcountPdf.home_report_run_id}`)).toBe(false);
      const listed = (await runsOf("ops", "?status=failed")).map((x) => x.number);
      expect(listed).toEqual([runs.headcountPdf.number]);
    });

    test("a file that cannot be built is retried, and on the outbox's last attempt its run fails with why", async () => {
      const generate = require("../../src/modules/reports/reports.generate");
      const broken = await build("ops", { name: "Broken Filter", report_key: "daily_attendance" });
      // A filter no form can send, so the roster refuses it: the build throws every time.
      await q("UPDATE saved_report SET definition = $2 WHERE saved_report_id = $1", [
        broken.saved_report_id,
        JSON.stringify({ filters: { roster_statuses: ["asleep"] } }),
      ]);
      const run = await runNow("ops", broken, "xlsx");
      await expect(generate.generate(run.home_report_run_id, { attempt: 1, max_attempts: 8 })).rejects.toThrow(
        /not a roster status/,
      );
      expect(await runRow(run.home_report_run_id)).toMatchObject({ status: "pending", document_id: null });
      await generate.generate(run.home_report_run_id, { attempt: 8, max_attempts: 8 });
      expect(await runRow(run.home_report_run_id)).toMatchObject({
        status: "failed",
        document_id: null,
        error: expect.stringMatching(/not a roster status/),
      });
      await drain();
      expect(await runRow(run.home_report_run_id)).toMatchObject({ status: "failed" });
      expect(reportEmails().some((e) => e.job_id === `home-report-run-${run.home_report_run_id}`)).toBe(false);
      // Put back what no form could have written, so the lists below read it as any other report.
      await q("UPDATE saved_report SET definition = $2 WHERE saved_report_id = $1", [
        broken.saved_report_id,
        JSON.stringify({ filters: {} }),
      ]);
      expect((await as("ops").post(`/home/reports/${broken.saved_report_id}/archive`)).status).toBe(200);
    });

    test("the file is opened by its recipient, its report's owner and the CEO, and nobody else", async () => {
      const opsFile = (await runRow(runs.opsLate.home_report_run_id)).document_id;
      const managerFile = (await runRow(runs.managerXlsx.home_report_run_id)).document_id;
      const status = async (who, id) => (await as(who).get(`/documents/${id}/content`)).status;
      expect(await status("ops", opsFile)).toBe(200);
      expect(await status("manager", opsFile)).toBe(200);
      expect(await status("ceo", opsFile)).toBe(200);
      expect(await status("manager", managerFile)).toBe(200);
      for (const who of ["ops", "staff", "clerk", "tola"]) expect([who, await status(who, managerFile)]).toEqual([who, 404]);
    });

    test("every source runs through its own screen's query, its file headed by its columns", async () => {
      const keys = Object.entries(r.HOME_REPORT_SOURCES)
        .filter(([, s]) => s.offered)
        .map(([key]) => key);
      const ceoRuns = {};
      for (const key of keys) {
        const report = await build("ceo", { name: `Every ${key}`, report_key: key });
        ceoRuns[key] = await runNow("ceo", report, "xlsx");
      }
      await drain();
      const { SOURCES } = require("../../src/modules/reports/reports.sources");
      for (const key of keys) {
        const run = await runRow(ceoRuns[key].home_report_run_id);
        expect([key, run.status, run.error]).toEqual([key, "done", null]);
        const file = await sheetRows(run.document_id);
        expect([key, file.sheets[1], file.rows[0]]).toEqual([key, SOURCES[key].label, SOURCES[key].columns.map((col) => col.header)]);
      }
      const headcount = await sheetRows((await runRow(ceoRuns.headcount.home_report_run_id)).document_id);
      expect(headcount.rows.length - 1).toBe(
        (await one("SELECT count(*)::int AS n FROM employee WHERE status = 'active'")).n,
      );
    });

    test("a filter reaches the source's query, and the file names it", async () => {
      const { department_id: programmes } = await one("SELECT department_id FROM department WHERE name = 'Programmes'");
      const report = await build("ops", {
        name: "Programmes Headcount",
        report_key: "headcount",
        filters: { department_id: programmes },
      });
      const run = await runNow("ops", report, "xlsx");
      await drain();
      const file = await sheetRows((await runRow(run.home_report_run_id)).document_id);
      expect(file.rows.slice(1).map((row) => row[1]).sort()).toEqual(["Dayo Ola", "Kemi Alade", "Musa Danjuma", "Zainab Lawal"]);
      const cover = await sheetRows((await runRow(run.home_report_run_id)).document_id, "Cover");
      expect(cover.rows.flat().join(" ")).toContain("Source = Headcount");
      expect(cover.rows.flat().join(" ")).toContain("Department = Programmes");
      expect((await as("ops").post(`/home/reports/${report.saved_report_id}/archive`)).status).toBe(200);
    });
  });

  /* ---------------------------------------------------------------- *
   * The scheduler
   * ---------------------------------------------------------------- */

  describe("the scheduler", () => {
    let slot;
    const path = () => `/home/reports/${made.late.saved_report_id}`;
    const slotRuns = () =>
      q(
        `SELECT x.home_report_run_id, x.recipient_user_id, x.format FROM home_report_run x
          WHERE x.report_schedule_id = $1 AND x.scheduled_for = $2 ORDER BY x.number`,
        [made.late.schedule.report_schedule_id, slot],
      ).then((res) => res.rows);
    const scheduledJobs = () => queues.enqueue.mock.calls.filter(([queue]) => queue === "scheduled-report");

    beforeAll(async () => {
      const res = await as("manager").patch(path(), {
        schedule: daily({
          run_time: "17:30",
          recipient_user_ids: ["manager", "ops", "leaver", "tola", "yemi"].map(userId),
        }),
      });
      made.late = r.HomeReport.parse(res.body);
      slot = new Date(Math.floor((Date.now() - 2 * MINUTE_MS) / MINUTE_MS) * MINUTE_MS);
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE saved_report_id = $1", [made.late.saved_report_id, slot]);
      queues.enqueue.mockClear();
    });

    test("the tick queues each schedule whose slot has come, once per slot", async () => {
      const registry = require("../../src/jobs/registry");
      const tick = registry.schedules().find((s) => s.name === "scheduled-reports");
      expect(await tick.run()).toEqual({ due: 1 });
      expect(scheduledJobs()).toEqual([
        [
          "scheduled-report",
          "slot",
          { report_schedule_id: made.late.schedule.report_schedule_id, slot: slot.toISOString() },
          // A slot whose job failed every attempt is queued again, not left to block the schedule.
          { jobId: `scheduled-report-${made.late.schedule.report_schedule_id}-${slot.getTime()}`, replaceFinished: true },
        ],
      ]);
    });

    test("the job makes one run per recipient and format for the slot, and moves to the next slot", async () => {
      const handler = require("../../src/jobs/handlers/scheduled-report");
      const queued = await countEvents("home.report_run");
      const firedFrom = new Date();
      const out = await handler({ data: { report_schedule_id: made.late.schedule.report_schedule_id, slot: slot.toISOString() } });
      const firedBy = new Date();
      expect(out.runs).toBe(10);
      expect((await countEvents("home.report_run")) - queued).toBe(10);
      const rows = await slotRuns();
      expect(rows.map((x) => `${x.recipient_user_id}:${x.format}`)).toEqual(
        ["manager", "ops", "leaver", "tola", "yemi"].flatMap((who) => [`${userId(who)}:pdf`, `${userId(who)}:xlsx`]),
      );
      const s = await one("SELECT last_run_at, next_run_at FROM report_schedule WHERE saved_report_id = $1", [
        made.late.saved_report_id,
      ]);
      expect(s.last_run_at.getTime()).toBe(slot.getTime());
      const calendar = await workingWeek.loadCalendar(pool);
      // The next slot after the moment the job ran, which was between these two.
      expect(s.next_run_at.getTime()).toBeGreaterThan(firedFrom.getTime());
      expect(lagos.timeOf(s.next_run_at)).toBe("17:30");
      const after = (at) => schedule.nextSlot(made.late.schedule, at, calendar).getTime();
      expect([after(firedFrom), after(firedBy)]).toContain(s.next_run_at.getTime());
      const view = r.HomeReport.parse((await as("manager").get(path())).body);
      expect(new Date(view.schedule.last_run_at).getTime()).toBe(slot.getTime());
    });

    test("run again, or for a slot it already holds, it makes nothing", async () => {
      const id = made.late.schedule.report_schedule_id;
      expect(await reports.fireSlot(id, slot)).toEqual({ runs: 0, skipped: "not this slot" });
      const next = (await one("SELECT next_run_at FROM report_schedule WHERE report_schedule_id = $1", [id])).next_run_at;
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [id, slot]);
      expect((await reports.fireSlot(id, slot)).runs).toBe(0);
      expect(await slotRuns()).toHaveLength(10);
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [id, next]);
    });

    test("a paused schedule is not due and its slot makes nothing", async () => {
      const temp = await build("ops", {
        name: "Paused Headcount",
        report_key: "headcount",
        schedule: daily({ recipient_user_ids: [userId("ops")] }),
      });
      expect((await as("ops").patch(`/home/reports/${temp.saved_report_id}/schedule`, { active: false })).status).toBe(200);
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE saved_report_id = $1", [temp.saved_report_id, slot]);
      queues.enqueue.mockClear();
      // At the slot itself: every running schedule has moved past it, and this one is paused at it.
      expect(await reports.queueDue({ now: slot })).toEqual({ due: 0 });
      expect(await reports.fireSlot(temp.schedule.report_schedule_id, slot)).toEqual({ runs: 0, skipped: "not running" });
    });

    test("a PDF is built while its recipient may have it, and waits for its render", async () => {
      const generate = require("../../src/modules/reports/reports.generate");
      runs.yemiPdf = await runNow("yemi", made.late, "pdf");
      await generate.generate(runs.yemiPdf.home_report_run_id, { attempt: 1, max_attempts: 8 });
      expect(await runRow(runs.yemiPdf.home_report_run_id)).toMatchObject({ status: "pending", document_id: expect.any(String) });
    });

    test("an owner builds a report while they may open its source", async () => {
      made.tolaHeadcount = await build("tola", { name: "Tola Headcount", report_key: "headcount" });
    });

    test("a recipient who may no longer have it is skipped: suspended, without the source, without `home.reports`", async () => {
      await q("UPDATE app_user SET status = 'suspended' WHERE user_id = $1", [userId("leaver")]);
      await q("DELETE FROM permission WHERE role_id = (SELECT role_id FROM role WHERE code = 'reader_a') AND module_key = 'people'");
      await q(
        `DELETE FROM role_capability WHERE role_id = (SELECT role_id FROM role WHERE code = 'reader_b')
            AND capability_id = (SELECT capability_id FROM capability WHERE code = 'home.reports')`,
      );
      for (const who of ["leaver", "tola", "yemi"]) await grantsCache.invalidateUser(userId(who));
      await grantsCache.invalidateGrants();
      queues.enqueue.mockClear();
      await drain();

      const byWho = {};
      for (const row of await slotRuns()) {
        const who = Object.keys(people).find((k) => userId(k) === row.recipient_user_id);
        byWho[`${who}:${row.format}`] = await runRow(row.home_report_run_id);
      }
      for (const format of ["pdf", "xlsx"]) {
        expect(byWho[`leaver:${format}`]).toMatchObject({ status: "skipped", document_id: null, error: "The recipient's account is not active." });
        expect(byWho[`tola:${format}`]).toMatchObject({ status: "skipped", document_id: null, error: "The recipient may no longer open this report's source." });
        expect(byWho[`yemi:${format}`]).toMatchObject({ status: "skipped", document_id: null, error: "The recipient may no longer receive reports." });
      }
      expect(byWho["manager:xlsx"]).toMatchObject({ status: "done" });
      expect(byWho["ops:xlsx"]).toMatchObject({ status: "done" });
      expect(byWho["manager:pdf"]).toMatchObject({ status: "pending", document_id: expect.any(String) });
      const emailed = reportEmails().map((e) => e.to.email).sort();
      expect(emailed).toEqual(["manager@reports.mycity.test", "ops@reports.mycity.test"]);
      // A schedule's file is still emailed to its recipients: nobody pressed anything for it.
      expect(reportEmails().every((e) => e.template === "scheduled-report" && e.attachments.length === 1)).toBe(true);
      expect(await countEvents("home.report_run_finished")).toBeGreaterThan(0);
    });

    test("an edit that keeps the saved recipients saves though some may no longer have it; one added is checked", async () => {
      const current = r.HomeReport.parse((await as("manager").get(path())).body);
      const unchanged = {
        recurrence: current.schedule.recurrence,
        starts_on: current.schedule.starts_on,
        run_time: current.schedule.run_time,
        formats: current.schedule.formats,
        recipient_user_ids: current.schedule.audience.map((p) => p.user_id),
      };
      expect(unchanged.recipient_user_ids).toEqual(["manager", "ops", "leaver", "tola", "yemi"].map(userId));
      // Edit Report sends the schedule back as it was with every change.
      for (const name of ["Late Arrivals", "Late Today"]) {
        const res = await as("manager").patch(path(), {
          name,
          filters: current.filters,
          shared: current.shared,
          schedule: unchanged,
        });
        expect([name, res.status, res.body.error]).toEqual([name, 200, undefined]);
        expect(r.HomeReport.parse(res.body)).toMatchObject({ name, schedule: { next_run_at: current.schedule.next_run_at } });
      }
      const added = await as("manager").patch(path(), {
        schedule: { ...unchanged, recipient_user_ids: [...unchanged.recipient_user_ids, userId("staff")] },
      });
      expect([added.status, added.body.error.fields]).toEqual([422, { "schedule.recipient_user_ids": ["Musa Danjuma: no access"] }]);
    });

    test("asked again before it is emailed: a PDF that renders after its recipient lost the right is skipped", async () => {
      const waiting = await runRow(runs.yemiPdf.home_report_run_id);
      await documents.renderPending(waiting.document_id, { db: pool, renderPdf: fakePdf });
      queues.enqueue.mockClear();
      await drain();
      expect(await runRow(runs.yemiPdf.home_report_run_id)).toMatchObject({
        status: "skipped",
        emailed_at: null,
        error: "The recipient may no longer receive reports.",
      });
      expect(reportEmails()).toEqual([]);
      // Its owner sees it skipped, with no file to download.
      const listed = (await runsOf("manager", "?status=skipped")).find((x) => x.home_report_run_id === runs.yemiPdf.home_report_run_id);
      expect(listed).toMatchObject({ status: "skipped", document_id: null, recipient_name: "Yemi Bello" });
    });

    test("an owner who may no longer open the source still sees the report, and cannot run it", async () => {
      const own = `/home/reports/${made.tolaHeadcount.saved_report_id}`;
      expect(r.HomeReport.parse((await as("tola").get(own)).body)).toMatchObject({ name: "Tola Headcount", can_edit: true });
      expect(await namesOf("tola")).toEqual(["Tola Headcount"]);
      const res = await as("tola").post(`${own}/run`, { format: "xlsx" });
      expect([res.status, res.body.error.code]).toEqual([403, "REPORT_SOURCE_CLOSED"]);
    });

    test("a slot missed while the worker was down is sent once, late, and the schedule moves past now", async () => {
      const temp = await build("ops", {
        name: "Missed Headcount",
        report_key: "headcount",
        schedule: daily({
          starts_on: lagos.addDays(today, -7),
          run_time: "07:00",
          formats: ["xlsx"],
          recipient_user_ids: [userId("ops")],
        }),
      });
      const id = temp.schedule.report_schedule_id;
      const missed = lagos.instant(lagos.addDays(today, -3), "07:00");
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [id, missed]);

      const now = new Date();
      expect((await reports.fireSlot(id, missed, { now })).runs).toBe(1);
      const fired = (await q("SELECT scheduled_for FROM home_report_run WHERE report_schedule_id = $1", [id])).rows;
      expect(fired.map((x) => x.scheduled_for.getTime())).toEqual([missed.getTime()]);
      const s = await one("SELECT last_run_at, next_run_at FROM report_schedule WHERE report_schedule_id = $1", [id]);
      expect(s.last_run_at.getTime()).toBe(missed.getTime());
      expect(s.next_run_at.getTime()).toBeGreaterThan(now.getTime());
      expect(lagos.timeOf(s.next_run_at)).toBe("07:00");
      expect(await reports.fireSlot(id, missed)).toEqual({ runs: 0, skipped: "not this slot" });
      // Archived, so the counts below are over the reports they name.
      expect((await as("ops").post(`/home/reports/${temp.saved_report_id}/archive`)).status).toBe(200);
    });

    test("a running schedule saved while its slot is due keeps that slot: it is sent once, late, to whom it now names", async () => {
      const kept = daily({
        starts_on: lagos.addDays(today, -7),
        run_time: "07:00",
        formats: ["xlsx"],
        recipient_user_ids: [userId("ops")],
      });
      const temp = await build("ops", { name: "Due Headcount", report_key: "headcount", schedule: kept });
      const id = temp.schedule.report_schedule_id;
      const due = lagos.instant(lagos.addDays(today, -1), "07:00");
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [id, due]);

      // The worker is down at the slot; meanwhile the owner adds the CEO.
      const res = await as("ops").patch(`/home/reports/${temp.saved_report_id}`, {
        schedule: { ...kept, recipient_user_ids: [userId("ops"), userId("ceo")] },
      });
      const saved = r.HomeReport.parse(res.body);
      expect(new Date(saved.schedule.next_run_at).getTime()).toBe(due.getTime());

      const now = new Date();
      expect((await reports.fireSlot(id, due, { now })).runs).toBe(2);
      const fired = (await q("SELECT recipient_user_id, scheduled_for FROM home_report_run WHERE report_schedule_id = $1 ORDER BY number", [id])).rows;
      expect(fired.map((x) => [x.recipient_user_id, x.scheduled_for.getTime()])).toEqual([
        [userId("ops"), due.getTime()],
        [userId("ceo"), due.getTime()],
      ]);
      const s = await one("SELECT next_run_at FROM report_schedule WHERE report_schedule_id = $1", [id]);
      expect(s.next_run_at.getTime()).toBeGreaterThan(now.getTime());
      expect((await as("ops").post(`/home/reports/${temp.saved_report_id}/archive`)).status).toBe(200);
    });

    test("Run Now answers only the caller's own run on demand, never a slot's run whose schedule was taken away", async () => {
      const temp = await build("ops", {
        name: "Switched Headcount",
        report_key: "headcount",
        schedule: daily({ starts_on: lagos.addDays(today, -7), run_time: "07:00", formats: ["xlsx"], recipient_user_ids: [userId("ops")] }),
      });
      const id = temp.schedule.report_schedule_id;
      const missed = lagos.instant(lagos.addDays(today, -1), "07:00");
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [id, missed]);
      expect((await reports.fireSlot(id, missed)).runs).toBe(1);
      const slotRun = await one("SELECT home_report_run_id FROM home_report_run WHERE report_schedule_id = $1", [id]);

      // Back to on demand while the slot's file still waits: the run keeps its slot, not its schedule.
      const res = await as("ops").patch(`/home/reports/${temp.saved_report_id}`, { schedule: null });
      expect(r.HomeReport.parse(res.body)).toMatchObject({ status: "on_demand", schedule: null });
      expect(await one("SELECT report_schedule_id, scheduled_for, status FROM home_report_run WHERE home_report_run_id = $1", [
        slotRun.home_report_run_id,
      ])).toEqual({ report_schedule_id: null, scheduled_for: missed, status: "pending" });

      const run = await runNow("ops", temp, "xlsx");
      expect(run.home_report_run_id).not.toBe(slotRun.home_report_run_id);
      expect(run).toMatchObject({ report_schedule_id: null, scheduled_for: null, requested_by: userId("ops"), status: "pending" });
      expect((await runNow("ops", temp, "xlsx")).home_report_run_id).toBe(run.home_report_run_id);
      expect((await as("ops").post(`/home/reports/${temp.saved_report_id}/archive`)).status).toBe(200);
    });
  });

  /* ---------------------------------------------------------------- *
   * A slot firing while its report changes
   * ---------------------------------------------------------------- */

  describe("a slot firing while its report changes", () => {
    let busy;
    const path = () => `/home/reports/${busy.saved_report_id}`;
    const dueAt = async (daysAgo) => {
      const slot = lagos.instant(lagos.addDays(today, -daysAgo), "07:00");
      await q("UPDATE report_schedule SET next_run_at = $2 WHERE report_schedule_id = $1", [busy.schedule.report_schedule_id, slot]);
      return slot;
    };

    beforeAll(async () => {
      busy = await build("ops", {
        name: "Busy Headcount",
        report_key: "headcount",
        schedule: daily({ starts_on: lagos.addDays(today, -7), run_time: "07:00", formats: ["xlsx"], recipient_user_ids: [userId("ops")] }),
      });
    });

    afterAll(async () => {
      expect((await as("ops").post(`${path()}/archive`)).status).toBe(200);
    });

    // The slot takes the report, then its schedule, then the counter, as every change does, so
    // whichever comes second waits for the first instead of the two waiting on each other.
    test("a rename and a new schedule wait for the slot", async () => {
      const slot = await dueAt(1);
      const [fired, res] = await whileFiring(busy.schedule.report_schedule_id, slot, () =>
        as("ops").patch(path(), {
          name: "Busy Headcount Renamed",
          schedule: daily({ starts_on: lagos.addDays(today, -7), run_time: "07:30", formats: ["xlsx"], recipient_user_ids: [userId("ops")] }),
        }),
      );
      expect(fired).toMatchObject({ runs: 1 });
      expect([res.status, res.body.error]).toEqual([200, undefined]);
      expect(r.HomeReport.parse(res.body)).toMatchObject({ name: "Busy Headcount Renamed", schedule: { run_time: "07:30", active: true } });
    });

    test("Pause waits for the slot", async () => {
      const slot = await dueAt(2);
      const [fired, res] = await whileFiring(busy.schedule.report_schedule_id, slot, () =>
        as("ops").patch(`${path()}/schedule`, { active: false }),
      );
      expect(fired).toMatchObject({ runs: 1 });
      expect([res.status, res.body.error]).toEqual([200, undefined]);
      expect(r.HomeReport.parse(res.body)).toMatchObject({ status: "paused", schedule: { next_run_at: null } });
      expect((await as("ops").patch(`${path()}/schedule`, { active: true })).status).toBe(200);
    });

    test("Run Now waits for the slot", async () => {
      const slot = await dueAt(3);
      const [fired, res] = await whileFiring(busy.schedule.report_schedule_id, slot, () =>
        as("ops").post(`${path()}/run`, { format: "xlsx" }),
      );
      expect(fired).toMatchObject({ runs: 1 });
      expect([res.status, res.body.error]).toEqual([202, undefined]);
      expect(r.HomeReportRun.parse(res.body)).toMatchObject({ scheduled_for: null, requested_by: userId("ops") });
    });
  });

  /* ---------------------------------------------------------------- *
   * The Overview Export
   * ---------------------------------------------------------------- */

  describe("the Overview Export", () => {
    test("anyone on Home exports their own Overview: a pending run, the same while it waits", async () => {
      const first = await as("staff").post("/home/overview/export", { format: "pdf" });
      expect(first.status).toBe(202);
      runs.staffOverview = r.HomeReportRun.parse(first.body);
      expect(runs.staffOverview).toMatchObject({
        report_name: "Overview",
        report_key: "overview",
        recipient_user_id: userId("staff"),
        requested_by: userId("staff"),
        status: "pending",
        document_id: null,
      });
      const again = r.HomeReportRun.parse((await as("staff").post("/home/overview/export", { format: "pdf" })).body);
      expect(again.home_report_run_id).toBe(runs.staffOverview.home_report_run_id);
    });

    test("the screen that pressed waits on its own run, though it holds no `home.reports`; nobody else's", async () => {
      const path = `/home/overview/export/${runs.staffOverview.home_report_run_id}`;
      const mine = await as("staff").get(path);
      expect(mine.status).toBe(200);
      expect(r.HomeReportRun.parse(mine.body)).toMatchObject({ home_report_run_id: runs.staffOverview.home_report_run_id, status: "pending" });
      // Recent Runs is not theirs to ask; someone else's run, or a run of another report, is a 404 here.
      expect((await as("staff").get(`/home/report-runs/${runs.staffOverview.home_report_run_id}`)).status).toBe(403);
      expect((await as("ops").get(path)).status).toBe(404);
      expect((await as("manager").get(`/home/overview/export/${runs.managerXlsx.home_report_run_id}`)).status).toBe(404);
    });

    test("its file is the reader's own Overview, built as them, though they hold no `home.reports`", async () => {
      await drain();
      const run = await runRow(runs.staffOverview.home_report_run_id);
      expect(run).toMatchObject({ status: "pending", document_id: expect.any(String) });
      const doc = await one("SELECT render_html, title FROM document WHERE document_id = $1", [run.document_id]);
      expect(doc.title).toBe("Overview");
      expect(doc.render_html).toContain("Hello Musa.");
      expect(doc.render_html).toContain("Cards");
    });

    test("as XLSX, a summary and a sheet for each part of the Overview", async () => {
      const res = await as("ops").post("/home/overview/export", { format: "xlsx" });
      runs.opsOverview = r.HomeReportRun.parse(res.body);
      await drain();
      const run = await runRow(runs.opsOverview.home_report_run_id);
      expect(run).toMatchObject({ status: "done", error: null, emailed_at: null });
      // Done, the screen that pressed reads it done and downloads it there; nothing is emailed.
      const waited = r.HomeReportRun.parse((await as("ops").get(`/home/overview/export/${runs.opsOverview.home_report_run_id}`)).body);
      expect(waited).toMatchObject({ status: "done", document_id: run.document_id });
      expect((await as("ops").get(`/documents/${run.document_id}/content`)).status).toBe(200);
      expect(reportEmails().some((e) => e.job_id === `home-report-run-${runs.opsOverview.home_report_run_id}`)).toBe(false);
      const file = await sheetRows(run.document_id, "Summary");
      expect(file.sheets.slice(0, 3)).toEqual(["Cover", "Summary", "Cards"]);
      expect(file.rows[1][0]).toMatch(/^Hello Tunde\. This is your Home on /);
    });

    test("the report behind it is never listed, and a name its owner chooses wins it", async () => {
      const hidden = await one("SELECT saved_report_id FROM saved_report WHERE owner_user_id = $1 AND report_key = 'overview'", [
        userId("ops"),
      ]);
      expect((await namesOf("ops")).includes("Overview")).toBe(false);
      expect((await as("ops").get(`/home/reports/${hidden.saved_report_id}`)).status).toBe(404);
      expect((await as("ops").post(`/home/reports/${hidden.saved_report_id}/run`, { format: "pdf" })).status).toBe(404);

      await build("ops", { name: "Overview", report_key: "headcount" });
      expect(await one("SELECT name FROM saved_report WHERE saved_report_id = $1", [hidden.saved_report_id])).toEqual({
        name: "Overview 2",
      });
      const next = r.HomeReportRun.parse((await as("ops").post("/home/overview/export", { format: "pdf" })).body);
      expect(next).toMatchObject({ saved_report_id: hidden.saved_report_id, report_name: "Overview 2" });
    });
  });

  /* ---------------------------------------------------------------- *
   * The counts
   * ---------------------------------------------------------------- */

  test("the counts are over the reports the reader may see and the files on their Recent Runs", async () => {
    // Runs This Month counts from the 1st of the month the summary is asked in: one moment for
    // both sides, so a file run across a month's start counts the same here and in the service.
    const now = new Date();
    const summaryOf = async (who) => {
      const asked = r.HomeReportSummary.parse((await as(who).get("/home/reports/summary")).body);
      const pinned = r.HomeReportSummary.parse(wire(await reports.summary(users[who], { now })));
      expect({ ...asked, runs_this_month: 0 }).toEqual({ ...pinned, runs_this_month: 0 });
      return pinned;
    };
    const done = async (who) =>
      (await runsOf(who, "?status=done")).filter(
        (x) => new Date(x.run_at) >= lagos.startOfDay(lagos.monthBounds(lagos.today(now)).first),
      ).length;
    expect(await summaryOf("manager")).toEqual({
      scheduled: 2,
      paused: 0,
      runs_this_month: await done("manager"),
      recipients: 5,
    });
    const ops = await summaryOf("ops");
    expect(ops).toMatchObject({ scheduled: 2, paused: 1, recipients: 5 });
    expect(ops.runs_this_month).toBe(await done("ops"));
    expect(await summaryOf("clerk")).toEqual({ scheduled: 0, paused: 0, runs_this_month: 0, recipients: 0 });
  });

  /* ---------------------------------------------------------------- *
   * Archiving
   * ---------------------------------------------------------------- */

  describe("archiving", () => {
    const path = () => `/home/reports/${made.late.saved_report_id}`;

    test("only its owner or the CEO archives it; its schedule stops and its runs stay", async () => {
      const refused = await as("ops").post(`${path()}/archive`);
      expect([refused.status, refused.body.error.code]).toEqual([403, "REPORT_NOT_YOURS"]);
      const runsBefore = (await runsOf("manager", `?saved_report_id=${made.late.saved_report_id}`)).length;
      const archived = r.HomeReport.parse((await as("manager").post(`${path()}/archive`)).body);
      expect(archived).toMatchObject({ status: "paused", schedule: { active: false, next_run_at: null } });
      expect(archived.archived_at).not.toBeNull();
      expect((await runsOf("manager", `?saved_report_id=${made.late.saved_report_id}`)).length).toBe(runsBefore);
      expect(await reports.queueDue()).toEqual({ due: 0 });
    });

    test("it leaves the list unless the archived are asked for, and neither changes nor runs", async () => {
      expect(await namesOf("manager")).toEqual(["Leave Requests"]);
      expect(await namesOf("manager", "?archived=true")).toEqual(["Late Today"]);
      expect(r.HomeReport.parse((await as("manager").get(path())).body).name).toBe("Late Today");
      for (const res of [
        await as("manager").patch(path(), { name: "Late Again" }),
        await as("manager").patch(`${path()}/schedule`, { active: true }),
        await as("manager").post(`${path()}/run`, { format: "pdf" }),
      ])
        expect([res.status, res.body.error.code]).toEqual([409, "REPORT_ARCHIVED"]);
      const archived = await countEvents("home.report_archived");
      expect((await as("manager").post(`${path()}/archive`)).status).toBe(200);
      expect(await countEvents("home.report_archived")).toBe(archived);
    });
  });

  /* ---------------------------------------------------------------- *
   * The assistant and ⌘K
   * ---------------------------------------------------------------- */

  describe("the assistant and ⌘K", () => {
    test("reports.mine is the reports the asker owns or receives; empty without `home.reports`", async () => {
      const read = await authorise.runRead(pool, users.manager, "reports.mine", {});
      expect(read.list).toBe(true);
      expect(r.HomeReportPage.parse(wire({ data: read.data, page: read.page })).data.map((x) => x.name)).toEqual([
        "Leave Requests",
      ]);
      expect(read.citations).toEqual([
        {
          type: "home_report",
          id: made.leave.saved_report_id,
          label: "Leave Requests",
          link: `/home?tab=reports&id=${made.leave.saved_report_id}`,
          read: "reports.mine",
        },
      ]);
      const none = await authorise.runRead(pool, users.staff, "reports.mine", {});
      expect([none.data, none.page.total]).toEqual([[], 0]);
    });

    test("runs.mine is the files the asker received, newest first", async () => {
      const read = await authorise.runRead(pool, users.manager, "runs.mine", {});
      const page = r.HomeReportRunPage.parse(wire({ data: read.data, page: read.page }));
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.every((x) => x.recipient_user_id === userId("manager"))).toBe(true);
      expect(read.citations[0]).toMatchObject({ type: "home_report_run", label: page.data[0].number });
    });

    test("⌘K finds a report and a run only for whoever may see them", async () => {
      const found = async (who, term, type) => {
        const res = await searchService.search(pool, users[who], { q: term, types: [type] });
        return (res.groups[0] || { items: [] }).items;
      };
      expect((await found("tola", "leave", "home_report")).map((i) => i.title)).toEqual([]);
      expect((await found("manager", "leave requests", "home_report")).map((i) => [i.title, i.link])).toEqual([
        ["Leave Requests", `/home?tab=reports&id=${made.leave.saved_report_id}`],
      ]);
      expect(await found("staff", "leave requests", "home_report")).toEqual([]);
      const run = await found("ops", runs.opsLate.number, "home_report_run");
      expect(run.map((i) => [i.ref, i.link])).toEqual([
        [runs.opsLate.number, `/home?tab=reports&run=${runs.opsLate.home_report_run_id}`],
      ]);
      expect(await found("clerk", runs.opsLate.number, "home_report_run")).toEqual([]);
    });

    test("New Report is offered to a holder of `home.reports`, not to anyone else", async () => {
      const newReport = async (who) => {
        const res = await searchService.everything(pool, users[who], { q: "new report", type: "action" });
        return (res.groups[0] || { items: [] }).items.filter((i) => i.title === "New Report").map((i) => i.link);
      };
      expect(await newReport("manager")).toEqual(["/home?tab=reports&action=new"]);
      expect(await newReport("staff")).toEqual([]);
    });
  });
});

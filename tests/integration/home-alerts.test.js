"use strict";
/**
 * Home · Alerts end to end (docs/guides/home.md §3 steps 5 and 6, §5, §6 Alerts, §7, §8, §9):
 * the real migrations and reference seeds, the whole app over HTTP, every response parsed with
 * its contract (APP_ENV=test checks each one too).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-alerts
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person here is invented. Days are counted back from today in Lagos.
 *
 * The rules are made on the screen's own routes, and the morning sweep raises their alerts from
 * real rows in the modules that own them: a request waiting for approval, documents near expiry,
 * a confirmation and contracts coming due. Attendance's alerts are the Attendance policy's
 * breaches (attendance.md §6.16): a version in force switches Late Arrivals and Forgotten
 * Clock-Outs on, the attendance module counts each person's days as it records them, and each
 * breach raises its own alert after commit on the rule Home keeps for that policy rule. Who sees
 * which alert follows the rule's grant over the person it is about, and never reaches the person
 * themselves; clearing takes both checks; a rule switched off dismisses its open alerts; a
 * closed alert is raised again only for new evidence.
 *
 * People: the CEO; Operations (every grant, both capabilities); a line manager over Musa and
 * Zainab, who clears alerts, with a line manager of her own over her; Bisi outside that team; a
 * clerk with every People grant and no capability; a rule keeper who manages rules but clears
 * none; twenty-four more with contracts ending, so the contracts rule's alerts are two pages.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { emit } = require("../../src/shared/events/emit");
const { rebuild } = require("./helpers/schema");
const { attendanceVersion } = require("./helpers/policies");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const { formatDate } = require("../../src/shared/time/day-first");
const workingWeek = require("../../src/shared/time/working-week");
const aiRegistry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const searchService = require("../../src/shared/search/search.service");
const realtime = require("../../src/services/realtime/emitter");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const rulesEngine = require("../../src/modules/attendance/attendance.rules-engine");
const { EVENTS: ATTENDANCE } = require("../../src/modules/attendance/attendance.events");
const sweeps = require("../../src/modules/alerts/alerts.sweeps");
const engine = require("../../src/shared/alerts/alerts");

// The queues and the socket emitter would hold Redis connections open past the run.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const a = c.alerts;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Home-Alerts9Test";
const DAY_MS = 86_400_000;

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
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("Home · Alerts against the real migrations", () => {
  let app;
  let today;
  let headOffice;
  let staffNumber = 0;
  let leaveRequest;
  const people = {};
  const ids = {};
  const tokens = {};
  const users = {};
  const rules = {};
  const departments = {};

  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`);
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

  const alertsOf = (who, query = "") => everyPage(who, `/home/alerts${query}`, a.HomeAlertPage);
  const summaryOf = async (who) => {
    const res = await as(who).get("/home/alerts/summary");
    expect(res.status).toBe(200);
    return a.HomeAlertSummary.parse(res.body);
  };
  const subjects = (rows) => rows.map((r) => `${r.rule_name}: ${r.title}`).sort();
  const openAlert = (rule, subjectId) =>
    one("SELECT home_alert_id FROM home_alert WHERE home_alert_rule_id = $1 AND subject_id = $2 AND cleared_at IS NULL", [
      rules[rule].home_alert_rule_id,
      subjectId,
    ]);
  const daysFromToday = (n) => lagos.addDays(today, n);
  /** The open alert of a policy rule about a person (its subject is the breach). */
  const policyAlert = (policyRule, who) =>
    one(
      `SELECT a.home_alert_id, a.subject_id FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
        WHERE r.key = $1 AND a.subject_employee_id = $2 AND a.cleared_at IS NULL
        ORDER BY a.raised_at DESC LIMIT 1`,
      [`attendance_policy.${policyRule}`, ids[who]],
    );

  /** Someone with no login, as People · Employees adds them. */
  async function person(key, first, last, { manager = null } = {}) {
    staffNumber += 1;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id,
                             employment_type, work_pattern, start_date, line_manager_id, status)
       VALUES ($1, $2, $3, $4, 'Field Officer', $5, 'full_time', 'on_site', '2026-01-05', $6, 'active')
       RETURNING employee_id`,
      [
        `A${String(staffNumber).padStart(4, "0")}`,
        first,
        last,
        `${first}.${last}@alerts.mycity.test`.toLowerCase(),
        departments.Operations,
        manager ? ids[manager] : null,
      ],
    );
    ids[key] = row.employee_id;
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
    for (const code_ of capabilities)
      await q("INSERT INTO role_capability (role_id, capability_id) SELECT $1, capability_id FROM capability WHERE code = $2", [
        id,
        code_,
      ]);
  }

  /**
   * Days the attendance module recorded late for a person, closed, each clocked in at 09:30
   * unless `clockedIn` says when.
   */
  async function lateOn(who, offsets, clockedIn = null) {
    for (const n of offsets) {
      const date = daysFromToday(-n);
      await q(
        `INSERT INTO attendance_day (employee_id, attendance_date, status, first_clock_in_at, late_minutes, closed_at)
         VALUES ($1, $2, 'late', $3, 30, now())
         ON CONFLICT (employee_id, attendance_date)
         DO UPDATE SET status = 'late', first_clock_in_at = EXCLUDED.first_clock_in_at, late_minutes = 30, closed_at = now()`,
        [ids[who], date, clockedIn || lagos.instant(date, "09:30")],
      );
    }
  }

  /**
   * The attendance module counts a person's consequence rules on a day, as a punch or the day-close
   * would, and each breach's alert follows after commit.
   */
  async function countRules(who, daysAgo) {
    await tx(async (client) => rulesEngine.countDay(client, await attendanceRepo.person(client, ids[who]), daysFromToday(-daysAgo)));
    await drain();
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    // The Attendance policy MyCity would publish: Late Arrivals (3 in 30 days, Alert) and Forgotten
    // Clock-Outs (1 in 30 days, Alert and Raise Query) switched on.
    const countRule = (count, alert, query) => ({ on: true, count, period: "days_30", alert, query });
    await attendanceVersion(
      pool,
      { late_rule: { ...countRule(3, true, false), hours: null }, forgotten_rule: countRule(1, true, true) },
      "2026-01-01",
    );
    workingWeek.invalidateCalendar();
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    today = lagos.today();
    ({ worksite_id: headOffice } = await one(
      `INSERT INTO worksite (code, name, latitude, longitude, radius_m)
       VALUES ('HQ_ALERTS', 'Head Office', 6.4281, 3.4219, 150) RETURNING worksite_id`,
    ));
    await role(
      "alerts_clerk",
      "Alerts Clerk",
      [["home", "own", ["view"]], ["people", "all", ["view", "edit", "approve"]]],
      [],
    );
    await role("rule_keeper", "Rule Keeper", [["home", "own", ["view"]], ["people", "all", ["view"]]], ["alerts.manage"]);

    const make = (who, first, last, roleCode, job, department, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@alerts.mycity.test`,
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
    await make("clerk", "Chidi", "Eze", "alerts_clerk", "People Officer", "Operations");
    await make("keeper", "Dayo", "Ola", "rule_keeper", "Systems Officer", "Operations");
    await make("head", "Ngozi", "Okafor", "manager", "Head of Programmes", "Programmes");
    for (const { department_id: id, name } of (await q("SELECT department_id, name FROM department")).rows)
      departments[name] = id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [
      ids.manager,
      [ids.staff, ids.remote],
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [ids.ops, ids.outsider]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [ids.head, ids.manager]);
    for (let n = 1; n <= 24; n += 1) await person(`filler${n}`, "Filler", `Number${String(n).padStart(2, "0")}`);
    await grantsCache.bumpTeamVersion();
    await drain();

    let ip = 0;
    for (const who of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.74.0.${ip}`)
        .send({ email: `${who}@alerts.mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
      users[who] = await grantsCache.getAuthUser(pool, people[who].user.user_id);
    }
    // A schema rebuild and nine password hashes and logins: more than a test's 15 s on a busy machine.
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Rules
   * ---------------------------------------------------------------- */

  describe("the rules", () => {
    const RULES = {
      waiting: { name: "Approvals Waiting", metric: "approval_ageing", threshold: "3", severity: "high", permission_key: "people.approve" },
      waitingSlow: { name: "Approvals Waiting", metric: "approval_ageing", threshold: "4", severity: "medium", permission_key: "people.view" },
      documents: { name: "Documents Expiring", metric: "document_expiry", threshold: "30", severity: "medium", permission_key: "people.edit" },
      confirmations: { name: "Confirmations Due", metric: "confirmation_due", threshold: "14", severity: "medium", permission_key: "people.edit" },
      contracts: { name: "Contracts Ending", metric: "contract_ending", threshold: "30.00", severity: "high", permission_key: "people.edit" },
      partners: { name: "Quiet Partners", metric: "partner_inactivity", threshold: "30", severity: "low", permission_key: "partnerships.edit" },
    };

    test("only a holder of `alerts.manage` reads or writes them", async () => {
      for (const who of ["manager", "clerk", "staff"]) {
        for (const res of [await as(who).get("/home/alert-rules"), await as(who).post("/home/alert-rules", RULES.waiting)])
          expect([who, res.status, res.body.error.code]).toEqual([who, 403, "CAPABILITY_REQUIRED"]);
      }
      expect((await request(app).get("/api/v1/home/alert-rules")).status).toBe(401);
    });

    test("a rule is made with a key from its metric and name, a number on the end when taken", async () => {
      const before = await countEvents("home.alert_rule_created");
      for (const [key, body] of Object.entries(RULES)) {
        const res = await as("ops").post("/home/alert-rules", body);
        expect([key, res.status]).toEqual([key, 201]);
        rules[key] = a.HomeAlertRule.parse(res.body);
      }
      expect(rules.waiting).toMatchObject({
        key: "approval_ageing.approvals_waiting",
        name: "Approvals Waiting",
        category: "approval",
        kind: "count",
        threshold: "3",
        window_days: null,
        who_can_clear: "People Approvers",
        enabled: true,
        open_alerts: 0,
        created_by: people.ops.user.user_id,
        updated_by: people.ops.user.user_id,
      });
      expect(rules.waitingSlow).toMatchObject({ key: "approval_ageing.approvals_waiting_2", who_can_clear: "People Viewers" });
      expect(rules.contracts).toMatchObject({ key: "contract_ending.contracts_ending", kind: "deadline", threshold: "30" });
      expect(rules.partners).toMatchObject({ category: "partnership", who_can_clear: "Partnerships Editors" });
      expect((await countEvents("home.alert_rule_created")) - before).toBe(Object.keys(RULES).length);
    });

    test("a rule fits its metric: no window, whole days for a deadline, a known grant; attendance's are the policy's", async () => {
      const refused = async (body, field, message) => {
        const res = await as("ops").post("/home/alert-rules", body);
        expect([res.status, res.body.error.fields[field]]).toEqual([422, [message]]);
      };
      await refused({ ...RULES.documents, threshold: "2.5" }, "threshold", "Whole days only");
      await refused({ ...RULES.waiting, window_days: 30 }, "window_days", "Not for this metric");
      await refused({ ...RULES.waiting, permission_key: "nowhere.view" }, "permission_key", "Choose who clears");
      expect((await as("ops").post("/home/alert-rules", { ...RULES.waiting, key: "mine" })).status).toBe(422);
      for (const metric of ["late_arrivals", "missing_clock_out", "attendance_policy"])
        expect([metric, (await as("ops").post("/home/alert-rules", { ...RULES.waiting, metric })).status]).toEqual([metric, 422]);
    });

    test("the rules list pages, filters and sorts; one rule reads by id", async () => {
      const all = await everyPage("ops", "/home/alert-rules", a.HomeAlertRulePage);
      expect(all.map((r) => r.name)).toEqual([
        "Approvals Waiting",
        "Approvals Waiting",
        "Confirmations Due",
        "Contracts Ending",
        "Documents Expiring",
        "Quiet Partners",
      ]);
      expect((await everyPage("ops", "/home/alert-rules?category=people", a.HomeAlertRulePage)).map((r) => r.name)).toEqual([
        "Confirmations Due",
        "Contracts Ending",
      ]);
      expect(await everyPage("ops", "/home/alert-rules?metric=approval_ageing", a.HomeAlertRulePage)).toHaveLength(2);
      expect(await everyPage("ops", "/home/alert-rules?enabled=false", a.HomeAlertRulePage)).toEqual([]);
      expect((await everyPage("ops", "/home/alert-rules?q=quiet", a.HomeAlertRulePage)).map((r) => r.key)).toEqual([
        "partner_inactivity.quiet_partners",
      ]);
      const newest = a.HomeAlertRulePage.parse((await as("ops").get("/home/alert-rules?sort=-created_at")).body);
      expect(newest.data[0].name).toBe("Quiet Partners");
      const res = await as("ops").get(`/home/alert-rules/${rules.waiting.home_alert_rule_id}`);
      expect(a.HomeAlertRule.parse(res.body)).toEqual(rules.waiting);
      expect((await as("ops").get(`/home/alert-rules/${crypto.randomUUID()}`)).status).toBe(404);
    });

    test("a rule changes in anything but its metric; saving it unchanged records nothing", async () => {
      const path = `/home/alert-rules/${rules.waitingSlow.home_alert_rule_id}`;
      const before = await countEvents("home.alert_rule_updated");
      const changed = a.HomeAlertRule.parse((await as("ops").patch(path, { name: "Approvals Waiting, Slow", severity: "high" })).body);
      expect(changed).toMatchObject({ name: "Approvals Waiting, Slow", key: "approval_ageing.approvals_waiting_2" });
      expect(await countEvents("home.alert_rule_updated")).toBe(before + 1);
      expect((await as("ops").patch(path, { name: "Approvals Waiting, Slow", threshold: "4.00" })).status).toBe(200);
      expect(await countEvents("home.alert_rule_updated")).toBe(before + 1);

      expect((await as("ops").patch(path, { metric: "approval_ageing" })).status).toBe(422);
      const refused = async (id, body, field, message) => {
        const res = await as("ops").patch(`/home/alert-rules/${id}`, body);
        expect([res.status, res.body.error.fields[field]]).toEqual([422, [message]]);
      };
      await refused(rules.documents.home_alert_rule_id, { threshold: "7.5" }, "threshold", "Whole days only");
      await refused(rules.waiting.home_alert_rule_id, { window_days: 7 }, "window_days", "Not for this metric");
      await refused(rules.waiting.home_alert_rule_id, { permission_key: "nowhere.approve" }, "permission_key", "Choose who clears");
      expect((await as("ops").patch(`/home/alert-rules/${crypto.randomUUID()}`, { name: "X" })).status).toBe(404);
      expect((await as("keeper").patch(path, { threshold: "4.5" })).status).toBe(200);
      expect((await one("SELECT updated_by FROM home_alert_rule WHERE key = 'approval_ageing.approvals_waiting_2'")).updated_by).toBe(
        people.keeper.user.user_id,
      );
    });
  });

  /* ---------------------------------------------------------------- *
   * The Attendance policy's breaches
   * ---------------------------------------------------------------- */

  describe("the Attendance policy's breaches (attendance.md §6.16)", () => {
    test("the day-close's missing clock-out is a forgotten clock-out: its breach raises Query Due after commit", async () => {
      const yesterday = workingWeek.addWorkingDays(today, -1, await workingWeek.loadCalendar(pool));
      await q(
        `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
         VALUES ($1, 'clock_in', $2, $3, $4, 'pwa', 'accepted')`,
        [ids.remote, lagos.instant(yesterday, "08:00"), yesterday, headOffice],
      );
      await reconcile.recomputeDay(pool, await attendanceRepo.person(pool, ids.remote), yesterday);
      await reconcile.closeDays();
      // The breach is recorded with the day-close; its alert follows after commit.
      const breach = await one("SELECT attendance_rule_breach_id, rule, count, days, home_alert_id FROM attendance_rule_breach WHERE employee_id = $1", [
        ids.remote,
      ]);
      expect(breach).toMatchObject({ rule: "forgotten_clock_out", count: 1, home_alert_id: null });
      expect((await one("SELECT count(*)::int AS n FROM home_alert")).n).toBe(0);
      await drain();
      const { rows } = await q(
        `SELECT r.key, r.metric, a.subject_type, a.subject_id, a.subject_employee_id, a.title, a.trigger, a.severity
           FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id`,
      );
      expect(rows).toEqual([
        {
          key: "attendance_policy.forgotten_rule",
          metric: "attendance_policy",
          subject_type: "attendance_rule_breach",
          subject_id: breach.attendance_rule_breach_id,
          subject_employee_id: ids.remote,
          title: "Query Due: Zainab Lawal, 1 forgotten clock-out in 30 days",
          trigger: `No clock-out on ${formatDate(yesterday)}`,
          severity: "medium",
        },
      ]);
      expect((await one("SELECT home_alert_id FROM attendance_rule_breach WHERE attendance_rule_breach_id = $1", [breach.attendance_rule_breach_id])).home_alert_id).toBeTruthy();
      // Running the handlers again changes nothing.
      await q("UPDATE event_outbox SET status = 'pending', completed_handlers = '{}' WHERE event_key = $1", [
        ATTENDANCE.ATTENDANCE_RULE_BREACHED,
      ]);
      await drain();
      expect((await one("SELECT count(*)::int AS n FROM home_alert")).n).toBe(1);
      expect(await countEvents("home.alert_raised")).toBe(1);
    });

    test("late arrivals: three give one breach and its alert; the fourth waits for the next", async () => {
      await lateOn("outsider", [2, 3, 6, 12]);
      await countRules("outsider", 2);
      const breaches = await q("SELECT days::text[] AS days, count FROM attendance_rule_breach WHERE employee_id = $1 AND rule = 'late'", [
        ids.outsider,
      ]);
      expect(breaches.rows).toEqual([{ days: [12, 6, 3].map((n) => daysFromToday(-n)), count: 3 }]);
      const raised = await policyAlert("late_rule", "outsider");
      expect(await one("SELECT title, trigger, subject_employee_id FROM home_alert WHERE home_alert_id = $1", [raised.home_alert_id])).toEqual({
        title: "Bisi Ojo: 3 late arrivals in 30 days",
        trigger: `Late on ${[12, 6, 3].map((n) => formatDate(daysFromToday(-n))).join(", ").replace(/, ([^,]*)$/, " and $1")}`,
        subject_employee_id: ids.outsider,
      });
      // Counting the same day again adds nothing.
      await countRules("outsider", 2);
      expect((await one("SELECT count(*)::int AS n FROM attendance_rule_breach WHERE employee_id = $1", [ids.outsider])).n).toBe(1);
    });

    test("a breach with Alert and Raise Query off raises nothing", async () => {
      const day = daysFromToday(-20);
      await tx(async (client) => {
        const { attendance_rule_breach_id: id } = await attendanceRepo.insertBreach(client, {
          employee_id: ids.filler2,
          rule: "location_flag",
          policy_version_id: null,
          period: "month",
          period_start: day,
          period_end: day,
          count: 1,
          minutes: 0,
          reached: "count",
          days: [day],
          last_day: day,
          alert: false,
          raise_query: false,
        });
        await emit(client, {
          key: ATTENDANCE.ATTENDANCE_RULE_BREACHED,
          entity: { type: "attendance_rule_breach", id },
          actor: null,
          payload: { attendance_rule_breach_id: id, employee_id: ids.filler2, alert: false, raise_query: false },
        });
      });
      await drain();
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_employee_id = $1", [ids.filler2])).n).toBe(0);
    });

    test("Alert Rules reads the policy's five rules, read only; the rules Home keeps for them are never listed or edited", async () => {
      const res = await as("ops").get("/home/alert-rules/policy");
      expect(res.status).toBe(200);
      const read = a.HomeAlertPolicyRules.parse(res.body);
      expect(read.version).toBeGreaterThanOrEqual(1);
      expect(read.rules.map((r) => [r.rule, r.name, r.on, r.figures, r.alert, r.query])).toEqual([
        ["late_rule", "Late Arrivals", true, "3 late arrivals in 30 days", true, false],
        ["early_rule", "Early Departure", false, null, true, true],
        ["absence_rule", "Absence", false, null, true, true],
        ["forgotten_rule", "Forgotten Clock-Outs", true, "1 forgotten clock-out in 30 days", true, true],
        ["location_rule", "Location Flags", false, null, true, false],
      ]);
      expect(read.rules.find((r) => r.rule === "late_rule").open_alerts).toBe(1);
      expect(read.rules.find((r) => r.rule === "forgotten_rule").open_alerts).toBe(1);
      expect((await as("keeper").get("/home/alert-rules/policy")).status).toBe(200);
      expect((await as("manager").get("/home/alert-rules/policy")).status).toBe(403);

      const kept = await one("SELECT home_alert_rule_id FROM home_alert_rule WHERE key = 'attendance_policy.late_rule'");
      expect((await everyPage("ops", "/home/alert-rules", a.HomeAlertRulePage)).map((r) => r.metric)).not.toContain("attendance_policy");
      expect((await as("ops").get(`/home/alert-rules/${kept.home_alert_rule_id}`)).status).toBe(404);
      expect((await as("ops").patch(`/home/alert-rules/${kept.home_alert_rule_id}`, { enabled: false })).status).toBe(404);
      expect((await one("SELECT enabled FROM home_alert_rule WHERE home_alert_rule_id = $1", [kept.home_alert_rule_id])).enabled).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- *
   * The morning sweep
   * ---------------------------------------------------------------- */

  describe("the morning sweep", () => {
    let tally;
    const docIds = {};

    beforeAll(async () => {
      // Late: Musa three times in 30 days, a breach; Zainab twice in them and once long before, none.
      await lateOn("staff", [3, 7, 9]);
      await countRules("staff", 3);
      await lateOn("remote", [5, 8, 45]);
      await countRules("remote", 5);
      // A leave request waiting five days at the line manager; another opened today.
      const { workflow_definition_id: flow } = await one(
        "SELECT workflow_definition_id FROM workflow_definition WHERE key = 'leave.approval' AND version = 1",
      );
      leaveRequest = crypto.randomUUID();
      for (const [who, entity, entered] of [
        ["staff", leaveRequest, new Date(Date.now() - 5 * DAY_MS)],
        ["remote", crypto.randomUUID(), new Date()],
      ])
        await q(
          `INSERT INTO workflow_instance (workflow_definition_id, definition_key, module_key, entity_type, entity_id,
                                          subject_employee_id, current_stage, state, stage_entered_at, opened_at)
           VALUES ($1, 'leave.approval', 'people', 'leave_request', $2, $3, 'line_manager', 'pending', $4, $4)`,
          [flow, entity, ids[who], entered],
        );
      // Documents: Musa's passport in 10 days, Zainab's ID card in 60, the office lease expired,
      // and an old version of a certificate that no longer counts.
      for (const [key, title, subject, expires, current] of [
        ["passport", "Passport", ids.staff, daysFromToday(10), true],
        ["id", "ID Card", ids.remote, daysFromToday(60), true],
        ["lease", "Office Lease", null, daysFromToday(-2), true],
        ["old", "Certificate", ids.staff, daysFromToday(5), false],
      ])
        ({ document_id: docIds[key] } = await one(
          `INSERT INTO document (doc_type, title, storage_key, mime, bytes, source, scan_status, is_current,
                                 subject_employee_id, expires_on)
           VALUES ('employee_document', $1, $2, 'application/pdf', 1024, 'upload', 'clean', $3, $4, $5)
           RETURNING document_id`,
          [title, `alerts/${key}.pdf`, current, subject, expires],
        ));
      // Confirmations: Musa in a week, Zainab in twenty days, Bisi due soon but confirmed.
      await q("UPDATE employee SET confirmation_due_on = $2 WHERE employee_id = $1", [ids.staff, daysFromToday(7)]);
      await q("UPDATE employee SET confirmation_due_on = $2 WHERE employee_id = $1", [ids.remote, daysFromToday(20)]);
      await q("UPDATE employee SET confirmation_due_on = $2, confirmed_on = '2026-06-01' WHERE employee_id = $1", [
        ids.outsider,
        daysFromToday(3),
      ]);
      // Contracts: Musa, Zainab and the twenty-four end within thirty days; the CEO's in ninety.
      const ending = ["staff", "remote", ...Array.from({ length: 24 }, (_, i) => `filler${i + 1}`)];
      for (const [i, who] of ending.entries())
        await q("UPDATE employee SET contract_ends_on = $2 WHERE employee_id = $1", [ids[who], daysFromToday(1 + i)]);
      await q("UPDATE employee SET contract_ends_on = $2 WHERE employee_id = $1", [ids.ceo, daysFromToday(90)]);

      tally = await require("../../src/jobs/schedulers/home-alert-sweeps").run();
    });

    test("each metric over M0 tables raises from real rows, and nothing below its threshold; the policy's are not swept", async () => {
      expect(tally).toEqual({ rules: 6, raised: 31, refreshed: 0, skipped: 0, failed: 0 });
      const { rows } = await q(
        `SELECT r.key, a.subject_type, a.subject_id, a.subject_employee_id, a.title, a.trigger, a.over_by
           FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
          WHERE r.key <> 'contract_ending.contracts_ending'
          ORDER BY r.key, a.title`,
      );
      expect(rows).toEqual([
        {
          key: "approval_ageing.approvals_waiting",
          subject_type: "leave_request",
          subject_id: leaveRequest,
          subject_employee_id: ids.staff,
          title: "Leave Request for Musa Danjuma: waiting 5 days",
          trigger: `At Line Manager since ${formatDate(daysFromToday(-5))}`,
          over_by: "2.00",
        },
        {
          key: "approval_ageing.approvals_waiting_2",
          subject_type: "leave_request",
          subject_id: leaveRequest,
          subject_employee_id: ids.staff,
          title: "Leave Request for Musa Danjuma: waiting 5 days",
          trigger: `At Line Manager since ${formatDate(daysFromToday(-5))}`,
          over_by: "0.50",
        },
        {
          key: "attendance_policy.forgotten_rule",
          subject_type: "attendance_rule_breach",
          subject_id: expect.any(String),
          subject_employee_id: ids.remote,
          title: "Query Due: Zainab Lawal, 1 forgotten clock-out in 30 days",
          trigger: expect.stringMatching(/^No clock-out on /),
          over_by: "0.00",
        },
        {
          key: "attendance_policy.late_rule",
          subject_type: "attendance_rule_breach",
          subject_id: expect.any(String),
          subject_employee_id: ids.outsider,
          title: "Bisi Ojo: 3 late arrivals in 30 days",
          trigger: expect.stringMatching(/^Late on /),
          over_by: "0.00",
        },
        {
          key: "attendance_policy.late_rule",
          subject_type: "attendance_rule_breach",
          subject_id: expect.any(String),
          subject_employee_id: ids.staff,
          title: "Musa Danjuma: 3 late arrivals in 30 days",
          trigger: `Late on ${[9, 7, 3].map((n) => formatDate(daysFromToday(-n))).join(", ").replace(/, ([^,]*)$/, " and $1")}`,
          over_by: "0.00",
        },
        {
          key: "confirmation_due.confirmations_due",
          subject_type: "employee",
          subject_id: ids.staff,
          subject_employee_id: ids.staff,
          title: "Musa Danjuma: confirmation due",
          trigger: `Due on ${formatDate(daysFromToday(7))}`,
          over_by: "7.00",
        },
        {
          key: "document_expiry.documents_expiring",
          subject_type: "document",
          subject_id: docIds.passport,
          subject_employee_id: ids.staff,
          title: "Musa Danjuma: Passport",
          trigger: `Expires on ${formatDate(daysFromToday(10))}`,
          over_by: "10.00",
        },
        {
          key: "document_expiry.documents_expiring",
          subject_type: "document",
          subject_id: docIds.lease,
          subject_employee_id: null,
          title: "Office Lease",
          trigger: `Expired on ${formatDate(daysFromToday(-2))}`,
          over_by: "-2.00",
        },
      ]);
      expect((await one("SELECT count(*)::int AS n FROM home_alert WHERE subject_id = $1", [leaveRequest])).n).toBe(2);
      const contracts = await q(
        "SELECT a.over_by FROM home_alert a WHERE a.home_alert_rule_id = $1 ORDER BY a.over_by::numeric",
        [rules.contracts.home_alert_rule_id],
      );
      expect(contracts.rows.map((r) => r.over_by)).toEqual(Array.from({ length: 26 }, (_, i) => `${i + 1}.00`));
    });

    test("one open alert per rule and subject: the next sweep refreshes, it never doubles", async () => {
      const again = await sweeps.sweep();
      expect(again).toEqual({ rules: 6, raised: 0, refreshed: 31, skipped: 0, failed: 0 });
      expect((await one("SELECT count(*)::int AS n FROM home_alert")).n).toBe(34);
      expect(await countEvents("home.alert_raised")).toBe(34);
    });

    test("the queue re-runs a morning by hand, under the scheduler's lock", async () => {
      const handler = require("../../src/jobs/handlers/home-alert-sweeps");
      expect(await handler({ data: { date: today } })).toMatchObject({ raised: 0, refreshed: 31, failed: 0 });
    });
  });

  /* ---------------------------------------------------------------- *
   * Who sees which alert
   * ---------------------------------------------------------------- */

  describe("who sees which alert", () => {
    test("signed out it is a 401; without either capability a 403, whatever the grants", async () => {
      expect((await request(app).get("/api/v1/home/alerts")).status).toBe(401);
      for (const who of ["staff", "clerk"])
        for (const path of ["/home/alerts", "/home/alerts/summary"]) {
          const res = await as(who).get(path);
          expect([who, path, res.status, res.body.error.code]).toEqual([who, path, 403, "CAPABILITY_REQUIRED"]);
        }
    });

    test("Operations and the CEO see every alert, two pages of them", async () => {
      const first = a.HomeAlertPage.parse((await as("ops").get("/home/alerts")).body);
      expect(first.page).toEqual({ number: 1, size: 25, total: 34, pages: 2, has_next: true });
      expect(await alertsOf("ceo")).toHaveLength(34);
      expect((await alertsOf("ops")).every((r) => r.can_clear)).toBe(true);
    });

    test("a line manager sees the alerts of the rules their grants hold, about their own team only", async () => {
      expect(subjects(await alertsOf("manager"))).toEqual([
        "Approvals Waiting, Slow: Leave Request for Musa Danjuma: waiting 5 days",
        "Approvals Waiting: Leave Request for Musa Danjuma: waiting 5 days",
        "Forgotten Clock-Outs: Query Due: Zainab Lawal, 1 forgotten clock-out in 30 days",
        "Late Arrivals: Musa Danjuma: 3 late arrivals in 30 days",
      ]);
    });

    test("a rule keeper sees the alerts their grant reaches but may clear none of them", async () => {
      const rows = await alertsOf("keeper");
      expect(subjects(rows)).toEqual(["Approvals Waiting, Slow: Leave Request for Musa Danjuma: waiting 5 days"]);
      expect(rows.map((r) => r.can_clear)).toEqual([false]);
      expect(await alertsOf("keeper", "?mine=true")).toEqual([]);
    });

    test("an alert about no one in particular is seen only with `all` scope", async () => {
      const lease = (rows) => rows.filter((r) => r.subject_employee_id === null).map((r) => r.title);
      expect(lease(await alertsOf("ops"))).toEqual(["Office Lease"]);
      expect(lease(await alertsOf("manager"))).toEqual([]);
    });

    test("a row says what the screen shows: Who Can Clear, Over By and its kind, where it opens", async () => {
      const rows = await alertsOf("ops");
      const passport = rows.find((r) => r.title === "Musa Danjuma: Passport");
      expect(passport).toMatchObject({
        rule_name: "Documents Expiring",
        metric: "document_expiry",
        category: "document",
        severity: "medium",
        over_by: "10.00",
        over_by_kind: "days_left",
        threshold: "30",
        permission_key: "people.edit",
        who_can_clear: "People Editors",
        link: `/people?tab=employees&id=${passport.subject_id}`,
        cleared_at: null,
        outcome: null,
        can_clear: true,
      });
      const late = rows.find((r) => r.title === "Bisi Ojo: 3 late arrivals in 30 days");
      expect(late).toMatchObject({
        rule_name: "Late Arrivals",
        metric: "attendance_policy",
        category: "attendance",
        subject_type: "attendance_rule_breach",
        subject_employee_id: ids.outsider,
        over_by: null,
        over_by_kind: null,
        who_can_clear: "People Approvers",
        link: `/people?tab=attendance&id=${late.subject_id}`,
      });
      const waiting = rows.find((r) => r.metric === "approval_ageing");
      expect(waiting.link).toBe(`/people?tab=leave&id=${leaveRequest}`);
    });

    test("one alert reads by id for whoever may see it, and is a 404 for anyone else", async () => {
      const { home_alert_id: id } = await openAlert("documents", (await one("SELECT document_id FROM document WHERE title = 'Passport'")).document_id);
      expect(a.HomeAlert.parse((await as("ops").get(`/home/alerts/${id}`)).body).title).toBe("Musa Danjuma: Passport");
      expect((await as("manager").get(`/home/alerts/${id}`)).status).toBe(404);
      expect((await as("ops").get(`/home/alerts/${crypto.randomUUID()}`)).status).toBe(404);
    });

    test("the list filters by category, severity, rule and age, and sorts by severity", async () => {
      expect(subjects(await alertsOf("ops", "?category=attendance"))).toEqual([
        "Forgotten Clock-Outs: Query Due: Zainab Lawal, 1 forgotten clock-out in 30 days",
        "Late Arrivals: Bisi Ojo: 3 late arrivals in 30 days",
        "Late Arrivals: Musa Danjuma: 3 late arrivals in 30 days",
      ]);
      expect(await alertsOf("ops", "?severity=high")).toHaveLength(28);
      expect(await alertsOf("ops", `?home_alert_rule_id=${rules.contracts.home_alert_rule_id}`)).toHaveLength(26);
      expect(await alertsOf("ops", "?q=passport")).toHaveLength(1);
      const bySeverity = a.HomeAlertPage.parse((await as("ops").get("/home/alerts?sort=-severity")).body).data;
      expect(bySeverity[0].severity).toBe("high");
      // No rule raising low alerts breaches here: the least severe open is medium.
      const lowest = a.HomeAlertPage.parse((await as("ops").get("/home/alerts?sort=severity")).body).data;
      expect(lowest[0].severity).toBe("medium");

      const { home_alert_id: aged } = await policyAlert("late_rule", "outsider");
      await q("UPDATE home_alert SET raised_at = now() - interval '8 days' WHERE home_alert_id = $1", [aged]);
      expect((await alertsOf("ops", "?overdue=true")).map((r) => r.home_alert_id)).toEqual([aged]);
    });
  });

  /* ---------------------------------------------------------------- *
   * Clearing
   * ---------------------------------------------------------------- */

  describe("clearing and dismissing", () => {
    const clear = (who, id, body = {}) => as(who).post(`/home/alerts/${id}/clear`, body);

    test("a rule's grant without `alerts.clear` is refused at the route", async () => {
      const { home_alert_id: id } = await policyAlert("late_rule", "staff");
      for (const who of ["clerk", "keeper", "staff"]) {
        const res = await clear(who, id);
        expect([who, res.status, res.body.error.code]).toEqual([who, 403, "CAPABILITY_REQUIRED"]);
      }
    });

    test("`alerts.clear` without the rule's grant over the person cannot reach the alert", async () => {
      const passport = await openAlert("documents", (await one("SELECT document_id FROM document WHERE title = 'Passport'")).document_id);
      expect((await clear("manager", passport.home_alert_id)).status).toBe(404);
      const outsider = await policyAlert("late_rule", "outsider");
      expect((await clear("manager", outsider.home_alert_id)).status).toBe(404);
      expect(await one("SELECT cleared_at FROM home_alert WHERE home_alert_id = $1", [outsider.home_alert_id])).toEqual({
        cleared_at: null,
      });
    });

    test("a line manager clears their team's alert, once: again is the same answer and no second entry", async () => {
      const { home_alert_id: id } = await policyAlert("late_rule", "staff");
      const before = await countEvents("home.alert_cleared");
      const first = a.HomeAlert.parse((await clear("manager", id, { note: "Spoke to Musa" })).body);
      expect(first).toMatchObject({
        outcome: "cleared",
        note: "Spoke to Musa",
        cleared_by: people.manager.user.user_id,
        cleared_by_name: "Kemi Alade",
        can_clear: false,
      });
      const twice = a.HomeAlert.parse((await clear("manager", id, { outcome: "dismissed" })).body);
      expect(twice).toEqual(first);
      expect(await countEvents("home.alert_cleared")).toBe(before + 1);
    });

    test("the CEO clears anything, and an alert is dismissed with a note", async () => {
      const lease = await openAlert("documents", (await one("SELECT document_id FROM document WHERE title = 'Office Lease'")).document_id);
      expect(a.HomeAlert.parse((await clear("ceo", lease.home_alert_id)).body).outcome).toBe("cleared");
      const confirmation = await openAlert("confirmations", ids.staff);
      const dismissed = a.HomeAlert.parse(
        (await clear("ops", confirmation.home_alert_id, { outcome: "dismissed", note: "Confirmed on paper" })).body,
      );
      expect(dismissed).toMatchObject({ outcome: "dismissed", note: "Confirmed on paper", cleared_by_name: "Tunde Bakare" });
    });

    test("View Dismissed lists the dismissed, newest first; the cleared have their own list", async () => {
      expect((await alertsOf("ops", "?state=dismissed")).map((r) => r.title)).toEqual(["Musa Danjuma: confirmation due"]);
      expect((await alertsOf("ops", "?state=cleared")).map((r) => r.title).sort()).toEqual([
        "Musa Danjuma: 3 late arrivals in 30 days",
        "Office Lease",
      ]);
      expect(await alertsOf("ops")).toHaveLength(31);
    });

    test("a breach a person closed is not raised again by the next sweep; the next breach raises its own", async () => {
      expect(await sweeps.sweep()).toEqual({ rules: 6, raised: 0, refreshed: 29, skipped: 0, failed: 0 });
      // Late three more times after the breach: the count restarted, so a second breach and its own alert (T3).
      await lateOn("staff", [0, 1, 2], new Date());
      await countRules("staff", 0);
      const fresh = await policyAlert("late_rule", "staff");
      expect(await one("SELECT title FROM home_alert WHERE home_alert_id = $1", [fresh.home_alert_id])).toEqual({
        title: "Musa Danjuma: 3 late arrivals in 30 days",
      });
      expect((await one("SELECT count(*)::int AS n FROM attendance_rule_breach WHERE employee_id = $1 AND rule = 'late'", [ids.staff])).n).toBe(2);
      expect((await clear("manager", fresh.home_alert_id)).status).toBe(200);
    });
  });

  /* ---------------------------------------------------------------- *
   * The counts
   * ---------------------------------------------------------------- */

  describe("the counts", () => {
    test("Open, Needs You, Overdue 7 Days +, Cleared This Week, the chips and Alert Sources", async () => {
      expect(await summaryOf("ops")).toEqual({
        open: 31,
        needs_you: 31,
        overdue: 1,
        cleared_this_week: 3,
        categories: [
          { category: "people", count: 26 },
          { category: "approval", count: 2 },
          { category: "attendance", count: 2 },
          { category: "document", count: 1 },
        ],
        sources: [
          { metric: "contract_ending", count: 26 },
          { metric: "attendance_policy", count: 4 },
          { metric: "approval_ageing", count: 2 },
          { metric: "document_expiry", count: 2 },
          { metric: "confirmation_due", count: 1 },
        ],
      });
    });

    test("each reader's counts are over the alerts they may see; a rule keeper needs to clear none", async () => {
      expect(await summaryOf("manager")).toMatchObject({ open: 3, needs_you: 3, overdue: 0, cleared_this_week: 2 });
      expect(await summaryOf("keeper")).toMatchObject({ open: 1, needs_you: 0, overdue: 0, cleared_this_week: 0 });
    });

    test("the list, the Overview's alerts beside Need You and the Open High Alerts card agree", async () => {
      const overview = (who) => as(who).get("/home/overview").then((res) => c.dashboard.HomeOverview.parse(res.body));
      expect((await overview("manager")).alerts_to_clear).toBe((await summaryOf("manager")).needs_you);
      expect((await overview("ops")).alerts_to_clear).toBe(31);
      expect((await overview("keeper")).alerts_to_clear).toBeNull();
      const card = c.dashboard.HomeKpiDetailPage.parse((await as("ops").get("/home/kpi/alerts_high_open")).body);
      expect(card.page.total).toBe((await alertsOf("ops", "?severity=high")).length);
    });

    test("the Open High Alerts card reads Over By in the Alerts tab's words, a deadline's days left included", async () => {
      const meta = c.dashboard.HomeKpiDetailMeta.parse((await as("ops").get("/home/kpi/alerts_high_open/meta")).body);
      expect(meta.columns.find((col) => col.key === "over_by")).toEqual({ key: "over_by", label: "Over By", numeric: false, phone: true });
      const records = await everyPage("ops", "/home/kpi/alerts_high_open", c.dashboard.HomeKpiDetailPage);
      const overBy = new Map(records.map((r) => [r.id, r.cells.over_by]));
      const high = await alertsOf("ops", "?severity=high");
      expect(records).toHaveLength(high.length);
      const waiting = high.find((r) => r.home_alert_rule_id === rules.waiting.home_alert_rule_id);
      expect(waiting).toMatchObject({ over_by: "2.00", over_by_kind: "over" });
      expect(overBy.get(waiting.home_alert_id)).toEqual({ kind: "text", text: "+2" });
      const contracts = high.filter((r) => r.home_alert_rule_id === rules.contracts.home_alert_rule_id);
      expect(contracts.length).toBeGreaterThan(2);
      for (const r of contracts) {
        const left = Number(r.over_by);
        expect([r.over_by_kind, overBy.get(r.home_alert_id)]).toEqual([
          "days_left",
          { kind: "text", text: `${left} ${left === 1 ? "day" : "days"} left` },
        ]);
      }
      expect(contracts.some((r) => r.over_by === "1.00")).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- *
   * Switching a rule off
   * ---------------------------------------------------------------- */

  describe("switching a rule off", () => {
    test("dismisses its open alerts as the rule change, and they do not count as cleared", async () => {
      const path = `/home/alert-rules/${rules.contracts.home_alert_rule_id}`;
      const cleared = await countEvents("home.alert_cleared");
      const off = a.HomeAlertRule.parse((await as("ops").patch(path, { enabled: false })).body);
      expect(off).toMatchObject({ enabled: false, open_alerts: 0 });
      expect((await countEvents("home.alert_cleared")) - cleared).toBe(26);
      const change = await one(
        "SELECT payload FROM event_log WHERE event_key = 'home.alert_rule_updated' ORDER BY occurred_at DESC LIMIT 1",
      );
      expect(change.payload).toMatchObject({ changed: ["enabled"], dismissed: 26 });

      const dismissed = await alertsOf("ops", "?state=dismissed");
      expect(dismissed).toHaveLength(27);
      expect(dismissed.filter((r) => r.note === "Rule switched off").every((r) => r.cleared_by === null)).toBe(true);
      expect(await summaryOf("ops")).toMatchObject({ open: 5, needs_you: 5, cleared_this_week: 3 });

      expect((await as("ops").patch(path, { enabled: false })).status).toBe(200);
      expect((await countEvents("home.alert_cleared")) - cleared).toBe(26);
      expect((await sweeps.sweep()).rules).toBe(5);
    });

    test("switched back on, what still breaches is raised at the next sweep", async () => {
      const path = `/home/alert-rules/${rules.contracts.home_alert_rule_id}`;
      expect(a.HomeAlertRule.parse((await as("ops").patch(path, { enabled: true })).body).enabled).toBe(true);
      expect((await sweeps.sweep()).raised).toBe(26);
    });
  });

  /* ---------------------------------------------------------------- *
   * The assistant and ⌘K
   * ---------------------------------------------------------------- */

  describe("the assistant and ⌘K", () => {
    test("alerts.mine is the open alerts the asker may clear, a page of 25; empty without `alerts.clear`", async () => {
      const read = await authorise.runRead(pool, users.manager, "alerts.mine", {});
      expect(read.list).toBe(true);
      expect(a.HomeAlertPage.parse(wire({ data: read.data, page: read.page })).page.total).toBe(3);
      expect(read.citations.map((x) => x.type)).toEqual(["home_alert", "home_alert", "home_alert"]);
      const ops = await authorise.runRead(pool, users.ops, "alerts.mine", { category: "people" });
      expect(ops.page).toMatchObject({ total: 26, pages: 2 });
      for (const who of ["keeper", "staff"]) {
        const none = await authorise.runRead(pool, users[who], "alerts.mine", {});
        expect([who, none.data, none.page.total]).toEqual([who, [], 0]);
      }
    });

    test("⌘K finds an alert only for whoever may see it, and a rule only for a holder of `alerts.manage`", async () => {
      const found = async (who, q_, type) => {
        const r = await searchService.search(pool, users[who], { q: q_, types: [type] });
        return (r.groups[0] || { items: [] }).items;
      };
      expect((await found("ops", "passport", "home_alert")).map((i) => [i.title, i.link])).toEqual([
        ["Musa Danjuma: Passport", expect.stringMatching(/^\/home\?tab=alerts&id=/)],
      ]);
      expect(await found("manager", "passport", "home_alert")).toEqual([]);
      expect(await found("staff", "passport", "home_alert")).toEqual([]);
      expect((await found("ops", "contracts ending", "home_alert_rule")).map((i) => [i.title, i.ref, i.link])).toEqual([
        ["Contracts Ending", "contract_ending.contracts_ending", `/home?tab=alerts&rule=${rules.contracts.home_alert_rule_id}`],
      ]);
      expect(await found("manager", "contracts ending", "home_alert_rule")).toEqual([]);
    });

    test("New Rule is offered to a holder of `alerts.manage`, not to one who only clears", async () => {
      const newRule = async (who) => {
        const r = await searchService.everything(pool, users[who], { q: "new rule", type: "action" });
        return (r.groups[0] || { items: [] }).items.filter((i) => i.title === "New Rule").map((i) => i.link);
      };
      expect(await newRule("ops")).toEqual(["/home?tab=alerts&action=new"]);
      expect(await newRule("keeper")).toEqual(["/home?tab=alerts&action=new"]);
      expect(await newRule("manager")).toEqual([]);
    });
  });

  /* ---------------------------------------------------------------- *
   * An alert about the reader
   * ---------------------------------------------------------------- */

  describe("an alert about the reader", () => {
    let id;
    let before;

    beforeAll(async () => {
      const mine = await authorise.runRead(pool, users.manager, "alerts.mine", {});
      before = { summary: await summaryOf("manager"), mine: mine.page.total };
      // Kemi, the line manager, is late three times herself: a breach of the policy's Late Arrivals.
      await lateOn("manager", [1, 2, 4]);
      await countRules("manager", 1);
      ({ home_alert_id: id } = (await policyAlert("late_rule", "manager")) || {});
    });

    /** How many times someone was told an alert was raised. */
    const told = async (who) =>
      (
        await one(
          "SELECT count(*)::int AS n FROM notification WHERE event_key = 'home.alert_raised' AND entity_id = $1 AND user_id = $2",
          [id, people[who].user.user_id],
        )
      ).n;

    test("is not theirs to see, count or clear: a 404, as for any alert out of reach", async () => {
      expect(id).toBeTruthy();
      const about = (rows) => rows.filter((r) => r.subject_employee_id === ids.manager);
      expect(about(await alertsOf("manager"))).toEqual([]);
      expect(about(await alertsOf("manager", "?mine=true"))).toEqual([]);
      expect((await as("manager").get(`/home/alerts/${id}`)).status).toBe(404);
      expect((await as("manager").post(`/home/alerts/${id}/clear`, { outcome: "dismissed" })).status).toBe(404);
      expect(await tx((client) => engine.mayClear(client, users.manager, { permission_key: "people.approve" }, ids.manager))).toBe(
        false,
      );

      expect(await summaryOf("manager")).toEqual(before.summary);
      const overview = c.dashboard.HomeOverview.parse((await as("manager").get("/home/overview")).body);
      expect(overview.alerts_to_clear).toBe(before.summary.needs_you);
      expect((await authorise.runRead(pool, users.manager, "alerts.mine", {})).page.total).toBe(before.mine);
      const found = await searchService.search(pool, users.manager, { q: "Kemi Alade", types: ["home_alert"] });
      expect((found.groups[0] || { items: [] }).items).toEqual([]);
      expect(await told("manager")).toBe(0);
    });

    test("her own line manager, Operations and the CEO see it, and the line manager clears it", async () => {
      const ops = (await alertsOf("ops")).find((r) => r.home_alert_id === id);
      expect(ops).toMatchObject({ title: "Kemi Alade: 3 late arrivals in 30 days", can_clear: true });
      expect((await alertsOf("ceo")).some((r) => r.home_alert_id === id)).toBe(true);
      expect([await told("head"), await told("ops")]).toEqual([1, 1]);
      const head = a.HomeAlert.parse((await as("head").get(`/home/alerts/${id}`)).body);
      expect(head).toMatchObject({ subject_employee_id: ids.manager, can_clear: true });
      const found = await searchService.search(pool, users.head, { q: "Kemi Alade", types: ["home_alert"] });
      expect((found.groups[0] || { items: [] }).items.map((i) => i.title)).toEqual(["Kemi Alade: 3 late arrivals in 30 days"]);

      const cleared = a.HomeAlert.parse((await as("head").post(`/home/alerts/${id}/clear`, { note: "Spoke to Kemi" })).body);
      expect(cleared).toMatchObject({ outcome: "cleared", cleared_by: people.head.user.user_id });
    });
  });

  /* ---------------------------------------------------------------- *
   * New evidence, and the same evidence seen again
   * ---------------------------------------------------------------- */

  describe("evidence after a person closed an alert", () => {
    test("a breach's alert a person cleared stays cleared when its day is counted again", async () => {
      const { home_alert_id: id, subject_id: breachId } = await policyAlert("late_rule", "outsider");
      expect((await as("ops").post(`/home/alerts/${id}/clear`, { note: "Spoke to Bisi" })).status).toBe(200);
      await countRules("outsider", 2);
      await q("UPDATE event_outbox SET status = 'pending', completed_handlers = '{}' WHERE event_key = $1", [
        ATTENDANCE.ATTENDANCE_RULE_BREACHED,
      ]);
      await drain();
      const { rows } = await q("SELECT cleared_at IS NULL AS open FROM home_alert WHERE subject_id = $1", [breachId]);
      expect(rows).toEqual([{ open: false }]);
    });

    test("a deadline alert someone cleared is raised again when its date changes, and only then", async () => {
      const { document_id: passport } = await one("SELECT document_id FROM document WHERE title = 'Passport'");
      const passportAlerts = async () =>
        (
          await q(
            `SELECT due_on::text AS due_on, trigger, over_by, cleared_at IS NULL AS open FROM home_alert
              WHERE subject_id = $1 ORDER BY raised_at`,
            [passport],
          )
        ).rows;
      const { home_alert_id: id } = await openAlert("documents", passport);
      expect((await as("ops").post(`/home/alerts/${id}/clear`, { note: "Renewal booked" })).status).toBe(200);
      await sweeps.sweep();
      expect(await passportAlerts()).toHaveLength(1);

      // The renewal fell through and the passport now expires today: a new date, a new alert.
      await q("UPDATE document SET expires_on = $2 WHERE document_id = $1", [passport, today]);
      await sweeps.sweep();
      await sweeps.sweep();
      expect(await passportAlerts()).toEqual([
        { due_on: daysFromToday(10), trigger: `Expires on ${formatDate(daysFromToday(10))}`, over_by: "10.00", open: false },
        { due_on: today, trigger: `Expires on ${formatDate(today)}`, over_by: "0.00", open: true },
      ]);
    });
  });
});

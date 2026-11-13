"use strict";
/**
 * M6's staging seed against the real migrations (seeds/staging/58_payroll.js; docs/guides/payroll.md
 * §13.1 item 19, §13.2 item 46): the Implementation Team's build account, the real roster, then this
 * seed, twice. Payroll is shown on invented test people only, at addresses that never take mail: last
 * month's run is locked by the CEO's approval and this month's computed, with an advance over two
 * months and two joiners; every real person is left out of both runs; nothing statutory is entered;
 * a second run adds nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/payroll-staging-seed
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const lagos = require("../../src/shared/time/lagos");
const staffSeed = require("../../seeds/staging/10_staff");
const seed = require("../../seeds/staging/58_payroll");
const { atomically } = require("../../src/shared/db/tx");
const { createAdmin, BUILD_ACCOUNT } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);

const runFile = (fn, logs = []) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () => fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }));

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
  }
}

const TABLES = ["employee", "payroll_run", "payslip", "payslip_line", "payroll_deduction", "payroll_deduction_instalment", "statutory_rate", "payroll_setting"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

/** The first day of the month `offset` months from today's. */
function monthStart(offset = 0) {
  const [y, m] = lagos.today().slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

const runOf = async (period) =>
  (await q("SELECT payroll_run_id, status, headcount FROM payroll_run WHERE period = $1", [period])).rows[0];

describeDb("Payroll's staging seed against the real migrations", () => {
  let first;
  let second;
  const logs = [];
  const testIds = new Map();

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    const client = await pool.connect();
    try {
      const account = { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } };
      await atomically(client, () => createAdmin(client, account, "A-long-Test-password-1!", { allowAdditional: true }));
    } finally {
      client.release();
    }
    await runFile(staffSeed);
    await runFile(seed, logs);
    await settle();
    first = await counts();
    await runFile(seed, logs);
    await settle();
    second = await counts();
    const { rows } = await q("SELECT employee_id, lower(work_email::text) AS email FROM employee WHERE work_email::text LIKE '%@example.test'");
    for (const r of rows) testIds.set(r.email, r.employee_id);
  }, 300_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  const idOf = (key) => testIds.get(seed.emailOf(seed.PEOPLE.find((p) => p.key === key)));

  test("the test people are invented, at reserved addresses, in the Implementation department, with no login", async () => {
    expect(logs.filter((l) => /stopped/.test(l))).toEqual([]);
    expect(testIds.size).toBe(seed.PEOPLE.length);
    const { rows } = await q(
      `SELECT d.name AS department, count(u.user_id)::int AS logins
         FROM employee e JOIN department d ON d.department_id = e.department_id
         LEFT JOIN app_user u ON u.employee_id = e.employee_id
        WHERE e.employee_id = ANY($1::uuid[]) GROUP BY d.name`,
      [[...testIds.values()]],
    );
    expect(rows).toEqual([{ department: "Implementation", logins: 0 }]);
  });

  test("last month is locked by the CEO's approval, its payslips the test people's alone", async () => {
    const last = await runOf(monthStart(-1));
    expect(last.status).toBe("approved");
    const { rows } = await q("SELECT employee_id, status, excluded_reason FROM payslip WHERE payroll_run_id = $1", [last.payroll_run_id]);
    const published = rows.filter((r) => r.status === "published").map((r) => r.employee_id);
    expect(published.sort()).toEqual(["adaeze", "tunde", "ngozi", "musa"].map(idOf).sort());
    const others = rows.filter((r) => !published.includes(r.employee_id));
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) expect(r).toMatchObject({ status: "excluded", excluded_reason: seed.LEFT_OUT });
    const decided = await q(
      `SELECT u.is_ceo FROM payroll_run r
         JOIN workflow_decision d ON d.workflow_instance_id = r.workflow_instance_id AND d.decision = 'approve'
         JOIN app_user u ON u.user_id = d.actor_id
        WHERE r.payroll_run_id = $1`,
      [last.payroll_run_id],
    );
    expect(decided.rows).toEqual([{ is_ceo: true }]);
  });

  test("no real person is paid: every payslip not a test person's is left out", async () => {
    const { rows } = await q(
      "SELECT count(*)::int AS n FROM payslip WHERE status <> 'excluded' AND NOT (employee_id = ANY($1::uuid[]))",
      [[...testIds.values()]],
    );
    expect(rows[0].n).toBe(0);
  });

  test("this month is computed: the joiners, No Salary Set for the one without pay, the advance's first share", async () => {
    const current = await runOf(monthStart(0));
    expect(current.status).toBe("computed");
    const slip = async (key) =>
      (await q("SELECT payslip_id, status, working_days, working_days_paid FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2", [current.payroll_run_id, idOf(key)])).rows[0];
    const joiner = await slip("chiamaka");
    expect(joiner.working_days_paid).toBeLessThan(joiner.working_days);
    expect(await slip("segun")).toBeDefined();

    const advance = await q(
      `SELECT d.total_amount, d.instalments, d.start_period::text AS start_period,
              (SELECT array_agg(i.period::text ORDER BY i.period) FROM payroll_deduction_instalment i WHERE i.payroll_deduction_id = d.payroll_deduction_id) AS periods
         FROM payroll_deduction d WHERE d.employee_id = $1 AND d.source = 'salary_advance'`,
      [idOf("adaeze")],
    );
    expect(advance.rows).toEqual([{ total_amount: "100000.00", instalments: 2, start_period: monthStart(0), periods: [monthStart(0), monthStart(1)] }]);
    const line = await q("SELECT amount FROM payslip_line WHERE payslip_id = $1 AND code = 'advance'", [(await slip("adaeze")).payslip_id]);
    expect(line.rows.map((r) => r.amount)).toEqual(["50000.00"]);
  });

  test("nothing statutory is entered and the advanced option stays off", () => {
    expect(first.statutory_rate).toBe(0);
    expect(first.payroll_setting).toBe(0);
  });

  test("a second run adds nothing", () => {
    expect(second).toEqual(first);
    expect(first.payroll_run).toBe(2);
    expect(logs).toContain("payroll: runs already exist, none added");
  });
});

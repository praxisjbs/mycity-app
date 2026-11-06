"use strict";
/**
 * M8's staging seed against the real migrations (seeds/staging/80_expenses.js; docs/guides/expenses.md
 * §3, F13): the Implementation Team's build account and a teammate's, the real roster, Home's seed
 * first (its forward rows), then this one. Home's requests and budgets go before anything is
 * written, 8099's five categories with them; the twelve suggested categories, three departments'
 * budgets and two projects are set; requests are raised by the Implementation department's people
 * only and walked through every stage; a second run adds nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/expenses-staging-seed
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const staffSeed = require("../../seeds/staging/10_staff");
const seed = require("../../seeds/staging/80_expenses");
const { HOME_STAGING_ROWS } = require("../../seeds/staging/lib/home-staging-rows");
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

const TABLES = ["expense_category", "budget", "budget_line", "expense_request", "expense_request_line", "requisition", "disbursement"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("Expenses' staging seed against the real migrations", () => {
  let first;
  let second;
  const logs = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    const team = [
      { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } },
      { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, first_name: "Ada", middle_name: "Grace", last_name: "Builder", preferred_name: "Ada", work_email: "ada@jbspraxis.test" } },
    ];
    for (const account of team) {
      const client = await pool.connect();
      try {
        await atomically(client, () => createAdmin(client, account, "A-long-Test-password-1!", { allowAdditional: true }));
      } finally {
        client.release();
      }
    }
    await runFile(staffSeed);
    // 8099's five, as a staging database that ran Home's seed before 8101 still holds them.
    await q(`INSERT INTO expense_category (code, name) VALUES ('travel', 'Travel'), ('office', 'Office Supplies') ON CONFLICT (code) DO NOTHING`);
    await runFile(seed, logs);
    await settle();
    first = await counts();
    await runFile(seed, logs);
    await settle();
    second = await counts();
  }, 240_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("8099's categories go and the twelve suggested ones are added once", async () => {
    const { rows } = await q("SELECT code::text AS code FROM expense_category");
    expect(rows.map((r) => r.code)).not.toEqual(expect.arrayContaining(["travel"]));
    expect(rows).toHaveLength(12);
  });

  test("Home's demonstration requests and budgets are gone", async () => {
    for (const table of seed.EXPENSE_TABLES) {
      const ids = HOME_STAGING_ROWS.find((e) => e.table === table).ids;
      const { rows } = await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${table}_id = ANY($1::uuid[])`, [ids]);
      expect([table, rows[0].n]).toEqual([table, 0]);
    }
  });

  test("every stage is on staging, raised by the Implementation department's people only", async () => {
    expect(logs.filter((l) => /stopped/.test(l))).toEqual([]);
    const { rows } = await q(
      `SELECT er.status, d.name AS department FROM expense_request er JOIN employee e ON e.employee_id = er.employee_id LEFT JOIN department d ON d.department_id = e.department_id`,
    );
    expect([...new Set(rows.map((r) => r.department))]).toEqual(["Implementation"]);
    const statuses = new Set(rows.map((r) => r.status));
    for (const s of ["draft", "submitted", "approved", "in_requisition", "authorised", "disbursed", "sent_back", "rejected"]) expect([s, statuses.has(s)]).toEqual([s, true]);
    const missing = await q("SELECT count(*)::int AS n FROM disbursement WHERE payment_reference IS NULL");
    expect(missing.rows[0].n).toBe(1);
  });

  test("the budgets count what was approved and paid, one line past 90% used", async () => {
    const { rows } = await q(
      `SELECT bl.amount, bl.committed_amount, bl.spent_amount FROM budget_line bl
        WHERE bl.amount > 0 AND (bl.committed_amount + bl.spent_amount) >= bl.amount * 0.9`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const projects = await q("SELECT count(*)::int AS n FROM project WHERE budget_amount IS NOT NULL");
    expect(projects.rows[0].n).toBe(2);
  });

  test("a second run adds nothing", () => {
    expect(second).toEqual(first);
    expect(first.expense_request).toBe(seed.REQUESTS.length);
  });
});

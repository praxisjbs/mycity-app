"use strict";
/**
 * The staging seed for Partnerships' records (seeds/staging/70_partnerships.js; docs/guides/
 * partnerships.md §4.3, Appendix B): after MyCity's staff (10_staff.js) and the Categories set-up
 * (65_partnership_setup.js), a synthetic tracker through the services: partners with returns, leads
 * at their stages, proposals, agreements as far as Active; Home's own rows in the M7 tables removed
 * first; and nothing added by a second run.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-staging-records
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
const setup = require("../../seeds/staging/65_partnership_setup");
const seed = require("../../seeds/staging/70_partnerships");
const { atomically } = require("../../src/shared/db/tx");
const { createAdmin, BUILD_ACCOUNT } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const runFile = (fn, logs = []) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () => fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }));

async function settle() {
  for (let i = 0; i < 12; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
  }
}

const TABLES = ["lead", "partner", "partnership_opportunity", "deal_return", "partner_interaction", "partnership_proposal", "partnership_agreement"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("Partnerships' records staging seed against the real migrations", () => {
  let first;
  let second;
  const logs = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    const client = await pool.connect();
    try {
      await atomically(client, () => createAdmin(client, { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } }, "A-long-Test-password-1!", { allowAdditional: true }));
    } finally {
      client.release();
    }
    await runFile(staffSeed);
    await runFile(setup, logs);
    // A row of Home's own in an M7 table, as a staging database that ran Home's seed first holds one.
    await q("INSERT INTO partner (partner_id, number, name, status, owner_id) VALUES ('c2c82fcf-6088-5999-9e6a-5a37a6e6739a', 'PAR-STG-01', 'MTN Nigeria', 'active', NULL)");
    await runFile(seed, logs);
    await settle();
    first = await counts();
    await runFile(seed, logs);
    await settle();
    second = await counts();
  }, 300_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("a second run adds nothing, and Home's own row is gone", async () => {
    expect(logs.filter((m) => / stopped /.test(m))).toEqual([]);
    expect(second).toEqual(first);
    expect(await one("SELECT count(*)::int AS n FROM partner WHERE name = 'MTN Nigeria'")).toEqual({ n: 0 });
    expect(logs.some((m) => /removed Home's 1 demonstration rows/.test(m))).toBe(true);
  });

  test("partners signed before the hub, with their returns and latest contact; one quiet", async () => {
    const names = (await q("SELECT name FROM partner ORDER BY name")).rows.map((r) => r.name);
    for (const p of seed.PARTNERS) expect(names).toContain(p.name);
    expect(first.deal_return).toBe(seed.PARTNERS.reduce((n, p) => n + p.returns.length, 0));
    const quiet = await one(
      `SELECT max(pi.occurred_at) < now() - interval '30 days' AS quiet FROM partner p JOIN partner_interaction pi ON pi.partner_id = p.partner_id WHERE p.name = 'Kora Street Kitchens'`,
    );
    expect(quiet.quiet).toBe(true);
    expect((await one("SELECT count(*)::int AS n FROM partner WHERE status = 'active'")).n).toBeGreaterThanOrEqual(seed.PARTNERS.length);
  });

  test("leads at their stages: one stalled with its blockers, one lost, one converted by its signed agreement", async () => {
    const stalled = await one("SELECT po.health, po.blockers FROM partnership_opportunity po JOIN lead l ON l.lead_id = po.lead_id WHERE l.name = 'Niger Delta Film Week'");
    expect(stalled).toEqual({ health: "stalled", blockers: expect.stringContaining("ticket split") });
    expect(await one("SELECT status, lost_reason IS NOT NULL AS why FROM lead WHERE name = 'Coastline Boat Tours'")).toEqual({ status: "lost", why: true });
    expect(await one("SELECT status FROM lead WHERE name = 'Tallow Tech Summit'")).toEqual({ status: "converted" });
    expect(await one("SELECT count(*)::int AS n FROM partner WHERE name = 'Tallow Tech Summit'")).toEqual({ n: 1 });
    expect((await one("SELECT count(*)::int AS n FROM partner_interaction WHERE interaction_type = 'meeting'")).n).toBeGreaterThanOrEqual(2);
  });

  test("proposals filled from the record, one sent; agreements as Draft, In Approval and Active", async () => {
    const statuses = (await q("SELECT status FROM partnership_proposal ORDER BY status")).rows.map((r) => r.status);
    expect(statuses).toEqual(["draft", "sent"]);
    const agreements = (await q("SELECT a.status, COALESCE(p.name, l.name) AS name FROM partnership_agreement a LEFT JOIN partner p ON p.partner_id = a.partner_id LEFT JOIN lead l ON l.lead_id = a.lead_id ORDER BY 2")).rows;
    expect(agreements).toEqual([
      { status: "review", name: "Lagoon Youth Fest" },
      { status: "draft", name: "Niger Delta Film Week" },
      { status: "active", name: "Tallow Tech Summit" },
    ]);
  });
});

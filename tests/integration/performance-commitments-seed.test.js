"use strict";
/**
 * The commitments staging seed end to end (seeds/staging/47_performance_commitments.js,
 * docs/guides/performance.md §6.11): the real migrations, MyCity's real staff from 10_staff.js,
 * My Workspace's and the plan's seeds as the runner runs them, then the commitments seed twice.
 * October and November land in every state the day allows, through the services and the
 * approval flow, on the real staff, and the second run changes nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/performance-commitments-seed
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. A state is worked out from the clock, so what October shows depends on whether it has
 * closed: before 1 November it has On Time and Due, after it Missed and a Recovery.
 */
const path = require("node:path");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const tasksRepo = require("../../src/modules/tasks/tasks.repo");
const staffSeed = require("../../seeds/staging/10_staff");
const workspaceSeed = require("../../seeds/staging/40_workspace");
const performanceSeed = require("../../seeds/staging/45_performance_plan");
const seed = require("../../seeds/staging/47_performance_commitments");

// The queues and the socket emitter would hold Redis connections open past the run.
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const [OCTOBER, NOVEMBER] = seed.MONTHS;
const today = lagos.today();
const octoberOpen = today < NOVEMBER;

/** A seed file run as the runner runs one: in its request context, as the seed. */
const runFile = (fn, logs = []) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () =>
    fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }),
  );

/** How many rows the seed's tables hold. */
async function counts() {
  const out = {};
  for (const table of ["task", "commitment_set", "workflow_instance", "workflow_decision", "event_log"])
    out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

/** Each commitment of a month with its state and its set's status. */
async function statesOf(month) {
  const { rows } = await q(
    `SELECT t.task_id, t.primary_assignee_id, t.original_due_at, t.rescope_reason, cs.status AS set_status,
            ${tasksRepo.COMMITMENT_STATE("t")} AS state
       FROM task t LEFT JOIN commitment_set cs ON cs.commitment_set_id = t.commitment_set_id
      WHERE t.is_commitment AND t.commitment_month = $1`,
    [month],
  );
  return rows;
}

describeDb("the commitments staging seed against the real migrations", () => {
  let first;
  let second;
  const logs = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    await runFile(staffSeed);
    await runFile(workspaceSeed);
    await runFile(performanceSeed);
    await runFile(seed, logs);
    first = await counts();
    await runFile(seed, logs);
    second = await counts();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the runner loads it after the plan and before Home", () => {
    const files = runner.seedFiles("staging").map((f) => path.basename(f));
    const at = files.indexOf("47_performance_commitments.js");
    expect(at).toBeGreaterThan(files.indexOf("45_performance_plan.js"));
    expect(at).toBeLessThan(files.indexOf("60_home.js"));
  });

  test("running it twice changes nothing, and nothing was skipped", () => {
    expect(second).toEqual(first);
    expect(logs.filter((m) => m.includes("skipped"))).toEqual([]);
  });

  test("October has every state its day allows", async () => {
    const rows = await statesOf(OCTOBER);
    const states = new Set(rows.map((r) => r.state));
    const expected = octoberOpen ? ["on_time", "late", "rescoped", "due", "awaiting_approval"] : ["late", "rescoped", "missed", "awaiting_approval"];
    for (const s of expected) expect([s, states.has(s)]).toEqual([s, true]);
    // The sent months were approved and their original dates fixed; the unsent one is a draft.
    for (const r of rows.filter((x) => x.set_status)) expect(r).toMatchObject({ set_status: "approved" });
    for (const r of rows.filter((x) => x.state === "awaiting_approval")) expect(r).toMatchObject({ set_status: null, original_due_at: null });
    // One rescope waits on the reviewer.
    const waiting = await q(
      `SELECT count(*)::int AS n FROM workflow_instance
        WHERE definition_key = 'performance.commitments' AND entity_type = 'task' AND state = 'pending'`,
    );
    expect(waiting.rows[0].n).toBe(1);
  });

  test("November waits on the reviewers and one month came back with its reason", async () => {
    const rows = await statesOf(NOVEMBER);
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["awaiting_approval"]));
    expect(new Set(rows.map((r) => r.set_status))).toEqual(new Set(["submitted", "returned"]));
    const back = await q(
      `SELECT d.reason FROM workflow_decision d JOIN workflow_instance i USING (workflow_instance_id)
        WHERE i.entity_type = 'commitment_set' AND d.decision = 'reject'`,
    );
    expect(back.rows.map((r) => r.reason)).toEqual(["Add the Abuja launch dates to each one"]);
  });

  test("a recovery is set once October has closed, and not before", async () => {
    const { rows } = await q(
      `SELECT r.title FROM task r JOIN task t ON r.entity_type = 'task' AND r.entity_id = t.task_id
        WHERE t.commitment_month = $1`,
      [OCTOBER],
    );
    expect(rows).toHaveLength(octoberOpen ? 0 : 1);
  });

  test("every commitment hangs off the real staff", async () => {
    const { rows } = await q(
      `SELECT count(*)::int AS n FROM task t
        WHERE t.is_commitment AND NOT EXISTS (SELECT 1 FROM import_row r WHERE r.target_id = t.primary_assignee_id::text)`,
    );
    expect(rows[0].n).toBe(0);
  });
});

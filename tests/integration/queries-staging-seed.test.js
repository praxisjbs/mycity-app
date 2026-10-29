"use strict";
/**
 * Queries & Sanctions' staging seed end to end (seeds/staging/50_queries.js, docs/guides/queries.md
 * §3, §6): the real migrations, the Implementation Team's build account and a second team account,
 * MyCity's real staff from 10_staff.js as the runner loads them, then the seed twice. Through the
 * services it enters the chain, switches on a rule and walks six queries from raised to issued, on
 * the Implementation department's people only, never MyCity's staff; Operations & People approve and
 * sign what Management proposed, the worker issues it, and the second run changes nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/queries-staging-seed
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const chromium = require("../../src/services/pdf/chromium");
const staffSeed = require("../../seeds/staging/10_staff");
const policiesSeed = require("../../seeds/staging/48_policies");
const seed = require("../../seeds/staging/50_queries");
const { realStaff } = require("../../seeds/staging/lib/staff");
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
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () =>
    fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }),
  );

/** Run the outbox until it is empty, as the worker would after the seed. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
  }
}

const TABLES = ["policy", "policy_version", "consequence_step", "query_rule", "employee_query", "query_response", "sanction", "sanction_fine"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("Queries & Sanctions' staging seed against the real migrations", () => {
  let first;
  let second;
  let staff;
  const logs = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    // Our own accounts, in the Implementation department, as on staging: the build account and a
    // teammate's, made before the roster so the loader gives the build account its line to the CTO.
    const team = [
      { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } },
      {
        ...BUILD_ACCOUNT,
        employee: { ...BUILD_ACCOUNT.employee, first_name: "Ada", middle_name: "Grace", last_name: "Builder", preferred_name: "Ada", work_email: "ada@jbspraxis.test" },
      },
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
    await runFile(policiesSeed, logs);
    await runFile(seed, logs);
    await settle();
    first = await counts();
    await runFile(policiesSeed, logs);
    await runFile(seed, logs);
    await settle();
    second = await counts();
    staff = await realStaff(pool);
  }, 240_000);

  afterAll(async () => {
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("enters the five rungs MILESTONES §8 ratified and switches the rule on", async () => {
    const { rows } = await q("SELECT name, letter_template FROM consequence_step ORDER BY position");
    expect(rows.map((r) => r.name)).toEqual(["Caution", "Warning", "Second Warning", "Suspension Without Pay", "Dismissal or Termination"]);
    expect(rows[0].letter_template).toBe("caution-letter");
    const rule = (await q("SELECT name, active FROM query_rule")).rows;
    expect(rule).toEqual([{ name: "Unregistered Device", active: true }]);
  });

  test("walks six queries on the Implementation department's people only, raised and signed", async () => {
    expect(logs.filter((m) => m.includes("stopped"))).toEqual([]);
    const { rows } = await q(
      `SELECT q.subject, q.status, q.outcome, q.source, q.raised_by, q.signature_document_id, d.name AS department
         FROM employee_query q JOIN employee e ON e.employee_id = q.employee_id
         LEFT JOIN department d ON d.department_id = e.department_id
        ORDER BY q.number`,
    );
    expect(rows).toHaveLength(6);
    // Never MyCity's staff: staging mails a query letter to the person it is about.
    expect([...new Set(rows.map((r) => r.department))]).toEqual(["Implementation"]);
    const team = staff.everyone.filter((p) => p.department === "Implementation");
    expect(team).toHaveLength(2);
    const raisers = new Set(rows.map((r) => r.raised_by));
    expect(raisers.size).toBeGreaterThan(0);
    expect(team.some((p) => raisers.has(p.user_id))).toBe(false);
    expect(rows.every((r) => r.source === "person" && r.signature_document_id)).toBe(true);
    const by = Object.fromEntries(rows.map((r) => [r.subject, r]));
    expect(by["Missed Weekly Field Report"].status).toBe("awaiting_response");
    expect(by["Late Vendor Report"].status).toBe("under_review");
    expect(by["Absent From Team Meeting"]).toMatchObject({ status: "resolved", outcome: "no_action" });
    expect(by["Unapproved Schedule Change"]).toMatchObject({ status: "resolved", outcome: "sanctioned" });
    expect(by["Company Phone Misuse"]).toMatchObject({ status: "resolved", outcome: "sanctioned" });
    expect(by["Unanswered Partner Complaint"].status).toBe("under_review");
  });

  test("Operations & People approve and sign what Management proposed", async () => {
    const { rows } = await q(
      `SELECT s.status, s.decided_by, s.signed_by, s.signature_document_id, cs.name AS step, f.amount_ngn AS amount
         FROM sanction s JOIN consequence_step cs ON cs.consequence_step_id = s.consequence_step_id
         LEFT JOIN sanction_fine f ON f.sanction_id = s.sanction_id
        ORDER BY s.created_at`,
    );
    expect(rows.map((r) => [r.step, r.status])).toEqual([
      ["Caution", "issued"],
      ["Warning", "issued"],
      ["Caution", "pending_approval"],
    ]);
    const proposer = (staff.management[0] || staff.ceo).user_id;
    expect(rows.every((r) => r.decided_by === proposer)).toBe(true);
    for (const r of rows.slice(0, 2)) {
      expect(r.signed_by).toBe(staff.operations.user_id);
      expect(r.signature_document_id).toBeTruthy();
    }
    expect(rows[1].amount).toBe("5000.00");
    expect(rows[2].signed_by).toBeNull();
  });

  test("two policies in force for Implementation only; every query and the rule cite one, and the letter quotes it", async () => {
    expect(logs.filter((m) => m.startsWith("policies:") && m.includes("stopped"))).toEqual([]);
    const { rows: pols } = await q(
      `SELECT p.title, v.version, v.effective_from, v.applies_to_everyone,
              (SELECT array_agg(d.name) FROM policy_audience pa JOIN department d ON d.department_id = pa.department_id
                WHERE pa.policy_version_id = v.policy_version_id) AS departments
         FROM policy p JOIN policy_version v ON v.policy_id = p.policy_id AND v.status = 'published'
        ORDER BY p.title`,
    );
    expect(pols.map((p) => [p.title, Number(p.version), p.applies_to_everyone, p.departments])).toEqual([
      ["Code of Conduct", 1, false, ["Implementation"]],
      ["Use of Company Devices", 1, false, ["Implementation"]],
    ]);
    const { rows: cites } = await q(
      `SELECT q.subject, p.title, q.policy_clause FROM employee_query q
         JOIN policy_version v ON v.policy_version_id = q.policy_version_id JOIN policy p ON p.policy_id = v.policy_id`,
    );
    expect(cites).toHaveLength(6);
    expect(Object.fromEntries(cites.map((r) => [r.subject, r.title]))["Company Phone Misuse"]).toBe("Use of Company Devices");
    expect(cites.every((r) => policiesSeed.POLICIES.some((p) => p.body_html.includes(r.policy_clause)))).toBe(true);
    const rule = (await q("SELECT p.title, r.policy_clause FROM query_rule r JOIN policy p ON p.policy_id = r.policy_id")).rows;
    expect(rule).toEqual([{ title: "Use of Company Devices", policy_clause: policiesSeed.CLAUSES.clockIn }]);
    const { rows: letter } = await q(
      `SELECT d.render_html FROM employee_query q JOIN document d ON d.document_id = q.letter_document_id
        WHERE q.subject = 'Missed Weekly Field Report'`,
    );
    if (letter[0] && letter[0].render_html) expect(letter[0].render_html).toContain(`This is against our Code of Conduct`);
  });

  test("a second run adds nothing", () => {
    expect(second).toEqual(first);
  });

  // Staging had Caution and Warning entered by hand before the seed ran, so it entered none.
  test("a chain entered in part gets its missing rungs, in order; a retired rung stays retired", async () => {
    await q("UPDATE consequence_step SET active = false WHERE name = 'Second Warning'");
    await q("DELETE FROM consequence_step WHERE name IN ('Suspension Without Pay', 'Dismissal or Termination')");
    await runFile(seed, logs);
    await settle();
    const { rows } = await q("SELECT name, active FROM consequence_step ORDER BY position");
    expect(rows).toEqual([
      { name: "Caution", active: true },
      { name: "Warning", active: true },
      { name: "Second Warning", active: false },
      { name: "Suspension Without Pay", active: true },
      { name: "Dismissal or Termination", active: true },
    ]);
  });
});

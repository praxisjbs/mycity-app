"use strict";
/**
 * The access matrix (docs/guides/praxis-ai.md §1.2 decision 26; the handoff §7): every read,
 * summary and action the manifests declare, crossed with every seeded role and the CEO, on the
 * real migrations with the staging seeds' rows. For each case the rule is the screen's own
 * (middleware/rbac.scopeFor): a role that holds the grant is offered the tool and may run it; a
 * role that does not is neither offered it nor served; what a scoped person is served is a
 * subset of what the CEO is served, and never carries a field the mask hides from them. A
 * mismatch anywhere fails the build. PR5 adds each module's scope probes (inside and outside
 * records) to the same generator.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-matrix
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const runner = require("../../scripts/db/seed");
const staffSeed = require("../../seeds/staging/10_staff");
const leaveSeed = require("../../seeds/staging/30_leave");
const workspaceSeed = require("../../seeds/staging/40_workspace");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const { scopeFor } = require("../../src/middleware/rbac");
const registry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const fieldMask = require("../../src/shared/rbac/field-mask");
const engine = require("../../src/services/ai/engine");
const catalog = require("../../src/shared/access/access.catalog");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const NOW = new Date("2026-10-14T11:00:00Z");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const runFile = (fn, extra = {}) => requestContext.run({ requestId: "seed-staging", surface: "script" }, () => fn({ pool, actor: runner.ACTOR, log: () => {}, ...extra }));

/** The id a row is cited by, for the subset rule. */
const idsOf = (tool, rows) =>
  rows
    .map((r) => {
      const cite = tool.cite(r);
      return cite && cite.id ? `${cite.type}:${cite.id}` : JSON.stringify(r);
    })
    .sort();

describeDb("the access matrix on the real migrations and the staging seeds", () => {
  const people = new Map();
  let roles = [];
  let cases = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    await runFile(staffSeed);
    await runFile(leaveSeed);
    await runFile(workspaceSeed, { now: NOW });
    roles = (await q("SELECT code FROM role WHERE active ORDER BY code")).rows.map((r) => r.code);
    // One person per seeded role, made as the first administrator is made; the CEO is MyCity's own, from the staff seed.
    const ceo = (await q("SELECT user_id FROM app_user WHERE is_ceo AND status = 'active' LIMIT 1")).rows[0];
    expect(ceo).toBeTruthy();
    people.set("ceo", ceo.user_id);
    await tx(async (client) => {
      let i = 0;
      for (const role of roles) {
        i += 1;
        const employee = {
          first_name: "Matrix",
          last_name: role.replace(/_/g, " "),
          work_email: `matrix-${role}@mycity.test`,
          phone: `0803${String(1000000 + i).slice(-7)}`,
          job_title: `Matrix ${role}`,
          department_name: "HR & Operations",
          start_date: "2026-01-05",
          employment_type: "full_time",
          work_pattern: "remote",
        };
        await createAdmin(client, { employee, role_code: role, is_ceo: false }, `Matrix#${role}2026`, { allowAdditional: true });
      }
    });
    for (const role of roles) {
      const u = (await q("SELECT user_id FROM app_user WHERE email = $1", [`matrix-${role}@mycity.test`])).rows[0];
      expect([role, Boolean(u)]).toEqual([role, true]);
      people.set(role, u.user_id);
    }
    for (const [who, userId] of people) {
      const u = await grantsCache.getAuthUser(pool, userId);
      expect([who, Boolean(u && u.user_id)]).toEqual([who, true]);
      people.set(who, u);
    }
    registry.load();
    const tools = [...registry.reads(), ...registry.summaries(), ...registry.actions()];
    const may = (role, module, action) => {
      const u = people.get(role);
      return Boolean(u) && (u.is_ceo === true || grantsOf.get(`${role}:${module}:${action}`) === true);
    };
    const grantsOf = new Map();
    for (const [role, u] of people) for (const t of tools) grantsOf.set(`${role}:${t.permission[0]}:${t.permission[1]}`, Boolean(await scopeFor(u, t.permission[0], t.permission[1])));
    cases = engine.matrix.casesFor({ tools, roles: [...people.keys()], may });
  }, 180_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the matrix covers every tool and every role, and the CEO may run everything", () => {
    const tools = [...registry.reads(), ...registry.summaries(), ...registry.actions()];
    expect(tools.length).toBeGreaterThan(40);
    expect(cases.length).toBe(tools.length * people.size);
    expect(cases.filter((k) => k.role === "ceo").every((k) => k.expect === "allowed")).toBe(true);
    expect(cases.some((k) => k.expect === "refused")).toBe(true);
  });

  test("what each role is offered is exactly what scopeFor allows: reads, summaries and actions alike", async () => {
    for (const [role, u] of people) {
      const offered = new Set([...(await authorise.allowedReads(u)), ...(await authorise.allowedSummaries(u)), ...(await authorise.allowedActions(u))].map((t) => t.key));
      const expected = new Set(cases.filter((k) => k.role === role && k.expect === "allowed").map((k) => k.key));
      expect([role, [...offered].sort()]).toEqual([role, [...expected].sort()]);
    }
  });

  test("a refused case is refused when run, whatever the parameters", async () => {
    const refused = cases.filter((k) => k.expect === "refused");
    expect(refused.length).toBeGreaterThan(0);
    for (const k of refused) {
      const u = people.get(k.role);
      if (k.kind === "read") await expect(authorise.runRead(pool, u, k.key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
      else if (k.kind === "summary") await expect(authorise.runSummary(pool, u, k.key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
      else await expect(authorise.checkAction(u, k.key, {})).rejects.toMatchObject({ code: "AI_ACTION_FORBIDDEN" });
    }
  });

  test("an allowed read serves a scoped person a subset of what the CEO is served, and never a field the mask hides from them", async () => {
    const ceo = people.get("ceo");
    const served = new Map();
    let compared = 0;
    const skipped = { invalid: 0, many: 0, own: 0 };
    for (const k of cases.filter((c) => c.expect === "allowed" && c.kind === "read")) {
      const u = people.get(k.role);
      let res;
      try {
        res = await authorise.runRead(pool, u, k.key, {});
      } catch (err) {
        // A read whose parameters are required cannot run with none: it is offered, and its parameters are the schema's business.
        if (err.code === "AI_READ_INVALID") {
          skipped.invalid += 1;
          continue;
        }
        throw Object.assign(err, { message: `${k.key} as ${k.role}: ${err.message}` });
      }
      const tool = registry.read(k.key);
      const rows = res.list ? res.data : res.data ? [res.data] : [];
      const hidden = fieldMask.maskedPropsFor(await fieldMask.maskedKeysFor(pool, u));
      for (const row of rows) for (const prop of hidden) if (row && Object.prototype.hasOwnProperty.call(row, prop)) expect([k.key, k.role, prop, row[prop]]).toEqual([k.key, k.role, prop, null]);
      if (k.role === "ceo") {
        served.set(k.key, idsOf(tool, rows));
        continue;
      }
      // A read of the own-only module (ESS) is the asker's own record, never a subset of the CEO's own: the mask rule
      // above holds; who it is about is PR5's probe.
      if (catalog.OWN_ONLY.has(tool.permission[0])) {
        skipped.own += 1;
        continue;
      }
      const all = served.get(k.key) || idsOf(tool, res.list ? (await authorise.runRead(pool, ceo, k.key, {})).data : [(await authorise.runRead(pool, ceo, k.key, {})).data].filter(Boolean));
      served.set(k.key, all);
      const mine = idsOf(tool, rows);
      if (res.list && res.page && res.page.total > res.page.size) {
        skipped.many += 1; // one page of many: the CEO's page may differ in order
        continue;
      }
      for (const id of mine) expect([k.key, k.role, id, all.includes(id)]).toEqual([k.key, k.role, id, true]);
      compared += 1;
    }
    expect({ compared, ...skipped }).toMatchObject({ compared: expect.any(Number) });
    if (!compared) throw new Error(`nothing compared: ${JSON.stringify(skipped)}`);
  });

  test("an allowed action is checked with the person's scope and its schema: values that do not parse are problems, never a run", async () => {
    for (const k of cases.filter((c) => c.expect === "allowed" && c.kind === "action")) {
      const u = people.get(k.role);
      const checked = await authorise.checkAction(u, k.key, {});
      expect([k.key, k.role, typeof checked.scope.scope]).toEqual([k.key, k.role, "string"]);
      expect(Array.isArray(checked.records)).toBe(true);
    }
  });
});

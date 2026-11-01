"use strict";
/**
 * The access matrix (docs/guides/praxis-ai.md §1.2 decision 26; the handoff §7): every read,
 * summary and action the manifests declare, crossed with every seeded role and the CEO, on the
 * real migrations with the staging seeds' rows. For each case the rule is the screen's own
 * (middleware/rbac.scopeFor): a role that holds the grant is offered the tool and may run it; a
 * role that does not is neither offered it nor served; what a scoped person is served is a
 * subset of what the CEO is served, and never carries a field the mask hides from them. A
 * mismatch anywhere fails the build. The modules with team or own scopes give the generator a probe
 * (praxis-ai.md §6.17): a record inside the person's reach and one outside it, built on the fly
 * through the modules' own services; a read must return the inside record and never the outside
 * one, and a card naming the outside one is refused by the action's own check. Each role gets one
 * report (a person under them) and the suite one outsider nobody manages, so a team scope has
 * someone in it and someone out of it.
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
const { AppError } = require("../../src/shared/errors");
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

/** The outbox worked as the worker would, so a person made here has their channels and notices. */
async function drainOutbox() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

/** How many pages of 25 a list is walked for: 250 rows, more than any seeded list here holds. */
const PAGES_WALKED = 10;

/**
 * A read's rows across its pages (up to PAGES_WALKED), as the person is served them: a list is 25 a
 * page, so a record of theirs may sit on a later page.
 */
async function walk(u, key, params = {}) {
  const first = await authorise.runRead(pool, u, key, params);
  if (!first.list) return { rows: first.data ? [first.data] : [], total: first.data ? 1 : 0, whole: true };
  const rows = [...first.data];
  let page = first.page;
  while (page && page.has_next && page.number < PAGES_WALKED) {
    const next = await authorise.runRead(pool, u, key, { ...params, page: page.number + 1 });
    rows.push(...next.data);
    page = next.page;
  }
  return { rows, total: first.page.total, whole: !(page && page.has_next) };
}

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
  /** Each role's report (a person under them), by role; the outsider nobody manages; what the probes look up. */
  const reports = new Map();
  let outsider = null;
  let leaveTypeId = null;
  let roles = [];
  let cases = [];
  /* Working days ahead (the company's week, public holidays out), each handed out once: a probe's leave request or meeting never overlaps another's. */
  let calendar = null;
  let dayCursor = new Date(Date.now() + 21 * 86_400_000);
  const freshDay = () => {
    do dayCursor = new Date(dayCursor.getTime() + 86_400_000);
    while (!workingWeek.isWorkingDay(dayCursor.toISOString().slice(0, 10), calendar));
    return dayCursor.toISOString().slice(0, 10);
  };

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
    const sample = (first, last, email, job, i, department = "HR & Operations") => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: `0803${String(1000000 + i).slice(-7)}`,
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });
    await tx(async (client) => {
      let i = 0;
      for (const role of roles) {
        i += 1;
        await createAdmin(client, { employee: sample("Matrix", role.replace(/_/g, " "), `matrix-${role}@mycity.test`, `Matrix ${role}`, i), role_code: role, is_ceo: false }, `Matrix#${role}2026`, { allowAdditional: true });
        // One person under each role's person, so a team scope has someone in it.
        await createAdmin(client, { employee: sample("Report", role.replace(/_/g, " "), `report-${role}@mycity.test`, `Reports to ${role}`, 100 + i), role_code: "employee", is_ceo: false }, `Report#${role}2026`, { allowAdditional: true });
      }
      // The outsider: on nobody's team, in another department, with a login of their own.
      await createAdmin(client, { employee: sample("Outsider", "Matrix", "outsider-matrix@mycity.test", "Accounts Officer", 999, "Finance"), role_code: "employee", is_ceo: false }, "Outsider#Matrix2026", { allowAdditional: true });
    });
    const login = async (email) => {
      const u = (await q("SELECT user_id, employee_id FROM app_user WHERE email = $1", [email])).rows[0];
      expect([email, Boolean(u)]).toEqual([email, true]);
      const user = await grantsCache.getAuthUser(pool, u.user_id);
      expect([email, Boolean(user && user.user_id)]).toEqual([email, true]);
      return { user, employee_id: u.employee_id };
    };
    for (const role of roles) {
      const own = await login(`matrix-${role}@mycity.test`);
      people.set(role, own.user);
      const report = await login(`report-${role}@mycity.test`);
      reports.set(role, report);
      await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [own.employee_id, report.employee_id]);
    }
    // Every role's person, and the outsider, report to the CEO, so their own leave requests have an approver.
    await q("UPDATE employee SET line_manager_id = $1 WHERE work_email LIKE 'matrix-%@mycity.test' OR work_email = 'outsider-matrix@mycity.test'", [ceo.employee_id || (await q("SELECT employee_id FROM app_user WHERE user_id = $1", [ceo.user_id])).rows[0].employee_id]);
    await grantsCache.bumpTeamVersion();
    outsider = await login("outsider-matrix@mycity.test");
    outsider.scope = await scopeFor(outsider.user, "workspace", "create");
    people.set("ceo", await grantsCache.getAuthUser(pool, ceo.user_id));
    leaveTypeId = (await q("SELECT leave_type_id FROM leave_type WHERE code = 'annual' AND active")).rows[0].leave_type_id;
    calendar = await workingWeek.loadCalendar(pool);
    await drainOutbox();
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
    // One case per tool and role, and a scoped case more where a probe exists and the role may run the tool.
    expect(cases.filter((k) => k.expect !== "scoped").length).toBe(tools.length * people.size);
    expect(cases.filter((k) => k.expect === "scoped").length).toBeGreaterThan(20);
    expect(cases.filter((k) => k.role === "ceo").every((k) => k.expect === "allowed" || k.expect === "scoped")).toBe(true);
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
      if (k.role === "ceo") continue;
      // A read of the own-only module (ESS) is the asker's own record, never a subset of the CEO's own: the mask rule
      // above holds; who it is about is PR5's probe.
      if (catalog.OWN_ONLY.has(tool.permission[0])) {
        skipped.own += 1;
        continue;
      }
      if (!served.has(k.key)) {
        // The CEO's whole list, walked page by page; a list longer than the walk cannot be compared.
        const everything = await walk(ceo, k.key, {});
        served.set(k.key, everything.whole ? idsOf(tool, everything.rows) : null);
      }
      const all = served.get(k.key);
      const mine = idsOf(tool, rows);
      if (all === null || (res.list && res.page && res.page.total > res.page.size)) {
        skipped.many += 1; // more rows than the walk reads, or one page of many for this person
        continue;
      }
      for (const id of mine) expect([k.key, k.role, id, all.includes(id)]).toEqual([k.key, k.role, id, true]);
      compared += 1;
    }
    expect({ compared, ...skipped }).toMatchObject({ compared: expect.any(Number) });
    if (!compared) throw new Error(`nothing compared: ${JSON.stringify(skipped)}`);
  });

  test("the probes: a read returns the record inside the person's reach and never the one outside it; a card naming the outside record is refused by the action's own check (§6.17)", async () => {
    const scoped = cases.filter((c) => c.expect === "scoped");
    expect(scoped.length).toBeGreaterThan(20);
    const done = { reads_inside: 0, reads_outside: 0, actions_inside: 0, actions_outside: 0, nothing: 0 };
    /** The ids a person is served by a read, across its pages, without their type. */
    const idsServed = async (u, key, params) => idsOf(registry.tool(key), (await walk(u, key, params)).rows).map((x) => x.split(":").slice(1).join(":"));
    for (const k of scoped) {
      const u = people.get(k.role);
      const scope = await scopeFor(u, k.module, k.action);
      const actor = { ...u, scope };
      const ctx = {
        actor,
        key: k.key,
        role: k.role,
        report: reports.get(k.role) || null,
        outsider,
        leaveTypeId,
        freshDay,
        capabilities: u.is_ceo === true ? ["home.team"] : await grantsCache.getCapabilities(pool, u.user_id),
        scopeOf: (module, action) => scopeFor(u, module, action),
      };
      const where = `${k.key} as ${k.role}`;
      const inside = await k.probe.inside(ctx);
      // Nothing is outside the reach of someone who sees everything.
      const outside = scope.scope === "all" ? null : await k.probe.outside(ctx);
      if (!inside && !outside) {
        done.nothing += 1;
        continue;
      }
      const tool = registry.tool(k.key);
      if (k.kind === "read") {
        if (inside) {
          const ids = await idsServed(u, k.key, inside.params || {});
          expect([where, "inside", String(inside.id), ids.includes(String(inside.id))]).toEqual([where, "inside", String(inside.id), true]);
          done.reads_inside += 1;
        }
        if (outside) {
          const ids = await idsServed(u, k.key, outside.params || {});
          expect([where, "outside", String(outside.id), ids.includes(String(outside.id))]).toEqual([where, "outside", String(outside.id), false]);
          done.reads_outside += 1;
        }
      } else if (k.kind === "action") {
        const check = async (values) => {
          const checked = await authorise.checkAction(u, k.key, values, pool);
          if (!checked.ok) throw new AppError("VALIDATION", `the values do not parse: ${JSON.stringify(checked.problems)}`, 422);
          if (tool.check) await tool.check(pool, checked.values, { ...u, scope: checked.scope });
          return checked;
        };
        if (inside) {
          const checked = await check(inside.values);
          expect([where, "inside", checked.records.every((r) => r.label !== null)]).toEqual([where, "inside", true]);
          done.actions_inside += 1;
        }
        if (outside) {
          let refused = null;
          try {
            await check(outside.values);
          } catch (err) {
            if (!(err instanceof AppError) || err.status >= 500) throw err;
            refused = err.code;
          }
          expect([where, "outside", refused !== null]).toEqual([where, "outside", true]);
          done.actions_outside += 1;
        }
      }
    }
    expect(done.reads_inside).toBeGreaterThan(10);
    expect(done.reads_outside).toBeGreaterThan(10);
    expect(done.actions_inside).toBeGreaterThan(5);
    expect(done.actions_outside).toBeGreaterThan(5);
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

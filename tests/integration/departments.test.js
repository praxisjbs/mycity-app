"use strict";
/**
 * People · Departments (#103): departments kept on screen, and the reporting lines and the
 * head's role following the head (docs/guides/organogram.md §6.1, JBS Praxis 27/10/2026), end
 * to end on the real migrations.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test \
 *     npx jest tests/integration/departments
 *
 * Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const schema = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const organisation = require("../../src/modules/organisation/organisation.service");
const access = require("../../src/modules/access/access.service");
const users = require("../../src/modules/users/users.service");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const ACTOR = { user_id: null, source: "test" };

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const OPS_PASSWORD = "Opera!ions2026";
const MANAGER_PASSWORD = "Manag3r!2026";

describeDb("People · Departments against the real migrations", () => {
  let app;
  const tokens = {};
  const p = {};
  const d = {};
  const userOf = {};

  const auth = (token) => (r) => r.set("Authorization", `Bearer ${token}`);
  const asOps = () => auth(tokens.ops);

  /** Where someone works and reports now. */
  const where = (employeeId) =>
    one("SELECT department_id, line_manager_id, line_manager_seat_id FROM employee WHERE employee_id = $1", [employeeId]);
  /** The role codes a person's login holds, and whether headship gave Head of Department. */
  const rolesOf = async (employeeId) => {
    const { rows } = await q(
      `SELECT r.code::text AS code, ur.from_headship
         FROM user_role ur JOIN role r ON r.role_id = ur.role_id JOIN app_user u ON u.user_id = ur.user_id
        WHERE u.employee_id = $1 ORDER BY r.code`,
      [employeeId],
    );
    return rows;
  };
  const holdsHead = async (employeeId) => (await rolesOf(employeeId)).some((r) => r.code === "head_of_department");

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });

    await tx(async (client) => {
      const ops = await createAdmin(
        client,
        { employee: sample("Ada", "Obi", "ops@dept.test", "Operations & People Lead", "People & Culture"), role_code: "operations_people", is_ceo: false },
        OPS_PASSWORD,
      );
      const manager = await createAdmin(
        client,
        { employee: sample("Uche", "Eze", "manager@dept.test", "Line Manager", "People & Culture"), role_code: "manager", is_ceo: false },
        MANAGER_PASSWORD,
      );
      p.ops = ops.employee.employee_id;
      p.manager = manager.employee.employee_id;
      d.pc = ops.employee.department_id;

      for (const [key, name, code] of [
        ["gm", "General Management", "GM"],
        ["bm", "Branding", "BM"],
        ["pg", "Growth", "PG"],
        ["op", "Operations", "OPS"],
      ])
        d[key] = (await organisation.createDepartment(client, { name, code }, ACTOR)).department_id;

      let n = 0;
      const person = async (key, first, department, managerKey, job = "Officer") => {
        n += 1;
        const e = await organisation.createEmployee(
          client,
          {
            first_name: first,
            last_name: "Test",
            work_email: `${key}@dept.test`,
            phone: `+23480312345${String(n).padStart(2, "0")}`,
            job_title: job,
            start_date: "2026-02-02",
            employment_type: "full_time",
            work_pattern: "remote",
            department_id: d[department],
            ...(managerKey ? { line_manager_id: p[managerKey] } : {}),
          },
          ACTOR,
        );
        p[key] = e.employee_id;
      };
      const login = async (key, { ceo = false } = {}) => {
        const { rows } = await client.query(schema.sql.user, [p[key], `${key}@dept.test`, ceo]);
        userOf[key] = rows[0].user_id;
        await access.setRoles(client, userOf[key], ["employee"], ACTOR);
      };

      await person("ceo", "Ife", "gm", null, "Chief Executive Officer");
      await person("pm", "Edi", "gm", "ceo", "Program Manager");
      await person("bHead", "Chi", "bm", "pm", "Head of Branding");
      await person("b1", "Aaron", "bm", "bHead", "Brand Lead");
      await person("b2", "Precious", "bm", "bHead", "Designer");
      await person("b3", "Simi", "bm", "b1", "Junior Designer");
      await person("x1", "Ola", "op", "pm", "Operations Lead");
      await person("x2", "Bayo", "op", "x1", "Operations Officer");
      await person("loner", "Kemi", "op", "pm", "Analyst");
      for (const key of ["ceo", "pm", "bHead", "b1", "b2"]) await login(key, { ceo: key === "ceo" });

      // Growth's head is an open role under the Program Manager, who acts for it.
      const seat = await organisation.createSeat(client, { title: "Head, Growth", department_id: d.pg, line_manager_id: p.pm }, ACTOR);
      p.gSeat = seat.org_seat_id;
      await person("g1", "Tochi", "pg", null, "Growth Officer");
      await organisation.setReportingLine(client, p.g1, { line_manager_seat_id: p.gSeat }, ACTOR);

      await organisation.updateDepartment(client, d.gm, { head_employee_id: p.ceo }, ACTOR);
      await organisation.updateDepartment(client, d.bm, { head_employee_id: p.bHead }, ACTOR);
      await organisation.updateDepartment(client, d.pg, { head_seat_id: p.gSeat }, ACTOR);
    });

    for (const [key, email, password] of [
      ["ops", "ops@dept.test", OPS_PASSWORD],
      ["manager", "manager@dept.test", MANAGER_PASSWORD],
    ]) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.40.0.${key === "ops" ? 1 : 2}`)
        .send({ email, password });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("the list pages at 25 in the contract's shape, with heads, open roles and whether each may be deleted", async () => {
    const res = await asOps()(request(app).get("/api/v1/departments"));
    expect(res.status).toBe(200);
    expect(c.organisation.DepartmentPage.safeParse(res.body).success).toBe(true);
    expect(res.body.page.size).toBe(25);
    const growth = res.body.data.find((x) => x.department_id === d.pg);
    expect(growth).toMatchObject({ code: "PG", open_roles: 1, can_delete: false, merged_into: null });
    expect(growth.head).toMatchObject({ org_seat_id: p.gSeat, vacant: true });
    expect(growth.acting_head.employee_id).toBe(p.pm);

    const sorted = await asOps()(request(app).get("/api/v1/departments?sort=-headcount"));
    expect(sorted.status).toBe(200);
    expect(sorted.body.data[0].headcount).toBeGreaterThanOrEqual(sorted.body.data[1].headcount);

    const single = await asOps()(request(app).get(`/api/v1/departments/${d.bm}`));
    expect(single.status).toBe(200);
    expect(c.organisation.Department.safeParse(single.body).success).toBe(true);
    expect(single.body.head).toMatchObject({ employee_id: p.bHead, vacant: false });
  });

  test("a head, or whoever acts for an open head role, holds Head of Department while they head; the CEO never", async () => {
    expect(await rolesOf(p.bHead)).toEqual(expect.arrayContaining([{ code: "head_of_department", from_headship: true }]));
    expect(await holdsHead(p.pm)).toBe(true);
    expect(await holdsHead(p.ceo)).toBe(false);
    expect(await holdsHead(p.b1)).toBe(false);
    const given = await one(
      "SELECT count(*)::int AS n FROM event_log WHERE event_key = 'access.roles_set' AND entity_id = $1 AND payload -> 'roles' ? 'head_of_department'",
      [userOf.bHead],
    );
    expect(given.n).toBe(1);
  });

  test("a name or a code another department holds is refused on its field", async () => {
    const name = await asOps()(request(app).patch(`/api/v1/departments/${d.bm}`)).send({ name: "general management" });
    expect(name.status).toBe(409);
    expect(name.body.error.fields.name).toBeDefined();
    const code = await asOps()(request(app).post("/api/v1/departments")).send({ name: "Design", code: "bm" });
    expect(code.status).toBe(409);
    expect(code.body.error.fields.code).toBeDefined();
    const short = await asOps()(request(app).post("/api/v1/departments")).send({ name: "Design", code: "D" });
    expect(short.status).toBe(422);
  });

  test("Set Head: the new head takes the old head's place, and the old head and their reports follow", async () => {
    const res = await asOps()(request(app).patch(`/api/v1/departments/${d.bm}`)).send({ head_employee_id: p.b1 });
    expect(res.status).toBe(200);
    expect(c.organisation.Department.safeParse(res.body).success).toBe(true);
    expect(res.body.head.employee_id).toBe(p.b1);

    expect((await where(p.b1)).line_manager_id).toBe(p.pm);
    expect((await where(p.b2)).line_manager_id).toBe(p.b1);
    expect((await where(p.bHead)).line_manager_id).toBe(p.b1);
    expect((await where(p.b3)).line_manager_id).toBe(p.b1);
    const history = await one("SELECT manager_id FROM reporting_line WHERE employee_id = $1 AND effective_to IS NULL", [p.b2]);
    expect(history.manager_id).toBe(p.b1);
    const audited = await one(
      `SELECT al.metadata FROM audit_ledger al JOIN event_log e ON e.event_id = al.event_id
        WHERE e.event_key = 'employee.reporting_line_changed' AND e.entity_id = $1
        ORDER BY al.created_at DESC LIMIT 1`,
      [p.b2],
    );
    expect(audited.metadata.reason).toBe("Head of Branding changed");

    expect(await holdsHead(p.b1)).toBe(true);
    expect(await holdsHead(p.bHead)).toBe(false);
  });

  test("a head who heads another department too keeps where they work and their own line", async () => {
    const res = await asOps()(request(app).patch(`/api/v1/departments/${d.op}`)).send({ head_employee_id: p.b1 });
    expect(res.status).toBe(200);
    expect(await where(p.b1)).toMatchObject({ department_id: d.bm, line_manager_id: p.pm });
    const cleared = await asOps()(request(app).patch(`/api/v1/departments/${d.op}`)).send({ head_employee_id: null });
    expect(cleared.body.head).toBeNull();
    expect(await holdsHead(p.b1)).toBe(true);
  });

  test("Save Roles keeps Head of Department on someone while they head", async () => {
    await users.setRoles(userOf.b1, ["employee"], { user_id: userOf.ceo, source: "test" });
    expect(await holdsHead(p.b1)).toBe(true);
  });

  test("someone whose role already sets a function's goals is not given Head of Department", async () => {
    const made = await asOps()(request(app).post("/api/v1/departments")).send({ name: "Finance", code: "FIN", head_employee_id: p.ops });
    expect(made.status).toBe(201);
    expect(made.body.head.employee_id).toBe(p.ops);
    expect(await holdsHead(p.ops)).toBe(false);
    // The head moved in, since they headed nothing else.
    expect((await where(p.ops)).department_id).toBe(made.body.department_id);
    d.fin = made.body.department_id;
  });

  test("moving people in: one alone reports to the head, a team moved together keeps its lines", async () => {
    const team = await asOps()(request(app).post(`/api/v1/departments/${d.pg}/people`)).send({ employee_ids: [p.x1, p.x2] });
    expect(team.status).toBe(200);
    expect(c.organisation.Department.safeParse(team.body).success).toBe(true);
    expect(await where(p.x1)).toMatchObject({ department_id: d.pg, line_manager_id: null, line_manager_seat_id: p.gSeat });
    expect(await where(p.x2)).toMatchObject({ department_id: d.pg, line_manager_id: p.x1 });
    const moved = await one(
      "SELECT payload FROM event_log WHERE event_key = 'department.people_moved' AND entity_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [d.pg],
    );
    expect(moved.payload.moved).toHaveLength(2);
  });

  test("a new Department on Edit Record moves the line to that department's head", async () => {
    const res = await asOps()(request(app).patch(`/api/v1/employees/${p.loner}`)).send({ department_id: d.bm });
    expect(res.status).toBe(200);
    expect(await where(p.loner)).toMatchObject({ department_id: d.bm, line_manager_id: p.b1 });
  });

  test("the CEO's line never moves, and a move that would make a loop leaves that line as it was", async () => {
    const ceo = await asOps()(request(app).post(`/api/v1/departments/${d.bm}/people`)).send({ employee_ids: [p.ceo] });
    expect(ceo.status).toBe(200);
    expect(await where(p.ceo)).toMatchObject({ department_id: d.bm, line_manager_id: null });
    await asOps()(request(app).post(`/api/v1/departments/${d.gm}/people`)).send({ employee_ids: [p.ceo] });

    // Branding's head reports to the Program Manager: putting the Program Manager under them would loop.
    const pm = await asOps()(request(app).post(`/api/v1/departments/${d.bm}/people`)).send({ employee_ids: [p.pm] });
    expect(pm.status).toBe(200);
    expect(await where(p.pm)).toMatchObject({ department_id: d.bm, line_manager_id: p.ceo });
    await asOps()(request(app).post(`/api/v1/departments/${d.gm}/people`)).send({ employee_ids: [p.pm] });
  });

  test("Retire waits for an empty department; Merge moves its people and open roles and retires it", async () => {
    const early = await asOps()(request(app).patch(`/api/v1/departments/${d.pg}`)).send({ active: false });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("DEPARTMENT_NOT_EMPTY");

    const self = await asOps()(request(app).post(`/api/v1/departments/${d.pg}/merge`)).send({ into_department_id: d.pg });
    expect(self.status).toBe(422);

    const merged = await asOps()(request(app).post(`/api/v1/departments/${d.pg}/merge`)).send({ into_department_id: d.bm });
    expect(merged.status).toBe(200);
    expect(merged.body.department_id).toBe(d.bm);
    const growth = (await asOps()(request(app).get(`/api/v1/departments/${d.pg}`))).body;
    expect(growth).toMatchObject({ active: false, head: null, merged_into: { department_id: d.bm, name: "Branding" }, can_delete: false });
    expect((await asOps()(request(app).delete(`/api/v1/departments/${d.pg}`))).status).toBe(409);

    // The open role and everyone under it moved together: only the role's own line follows the new head.
    const seat = await one("SELECT department_id, line_manager_id FROM org_seat WHERE org_seat_id = $1", [p.gSeat]);
    expect(seat).toEqual({ department_id: d.bm, line_manager_id: p.b1 });
    expect(await where(p.g1)).toMatchObject({ department_id: d.bm, line_manager_seat_id: p.gSeat });
    expect(await where(p.x1)).toMatchObject({ department_id: d.bm, line_manager_seat_id: p.gSeat });
    // Nobody acts for Growth now, so the Program Manager's role from it goes.
    expect(await holdsHead(p.pm)).toBe(false);

    const twice = await asOps()(request(app).post(`/api/v1/departments/${d.pg}/merge`)).send({ into_department_id: d.bm });
    expect(twice.status).toBe(409);
    const into = await asOps()(request(app).post(`/api/v1/departments/${d.op}/people`)).send({ employee_ids: [p.b2] });
    expect(into.status).toBe(200);
    const intoRetired = await asOps()(request(app).post(`/api/v1/departments/${d.pg}/people`)).send({ employee_ids: [p.b2] });
    expect(intoRetired.status).toBe(409);
  });

  test("Restore brings a department back with no head, and Retire clears an empty one's head", async () => {
    const back = await asOps()(request(app).patch(`/api/v1/departments/${d.pg}`)).send({ active: true });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ active: true, head: null, merged_into: null });

    const fin = await asOps()(request(app).post(`/api/v1/departments/${d.fin}/people`)).send({ employee_ids: [p.ops] });
    expect(fin.status).toBe(200);
    await asOps()(request(app).post(`/api/v1/departments/${d.pc}/people`)).send({ employee_ids: [p.ops] });
    const retired = await asOps()(request(app).patch(`/api/v1/departments/${d.fin}`)).send({ active: false });
    expect(retired.status).toBe(200);
    expect(retired.body).toMatchObject({ active: false, head: null });
  });

  test("Delete only a department nothing has named; one used before is retired instead", async () => {
    const made = await asOps()(request(app).post("/api/v1/departments")).send({ name: "Spare", code: "SP" });
    expect(made.body.can_delete).toBe(true);
    const gone = await asOps()(request(app).delete(`/api/v1/departments/${made.body.department_id}`));
    expect(gone.status).toBe(204);
    expect((await asOps()(request(app).get(`/api/v1/departments/${made.body.department_id}`))).status).toBe(404);

    const used = await asOps()(request(app).delete(`/api/v1/departments/${d.bm}`));
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe("DEPARTMENT_IN_USE");
  });

  test("only People with the grant over everyone change departments", async () => {
    const res = await auth(tokens.manager)(request(app).patch(`/api/v1/departments/${d.bm}`)).send({ name: "Brand" });
    expect(res.status).toBe(403);
    const move = await auth(tokens.manager)(request(app).post(`/api/v1/departments/${d.bm}/people`)).send({ employee_ids: [p.b2] });
    expect(move.status).toBe(403);
  });
});

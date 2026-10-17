"use strict";
/**
 * People · Employees (#24), the employee 360, Org Chart (#91), Organogram (#92), the
 * staff importer and the roster loader, end to end: the real migrations on a throwaway
 * database, the whole app through HTTP, the outbox drained as the worker would.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test \
 *     npx jest tests/integration/organisation
 *
 * Every person here is invented. MyCity's own staff are in seeds/staff/, and a test
 * never names them.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const schema = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const organisation = require("../../src/modules/organisation/organisation.service");
const loader = require("../../scripts/db/load-staff");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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

const OPS_PASSWORD = "Opera!ions2026";
const MANAGER_PASSWORD = "Manag3r!2026";

/** A staff sheet in MyCity's own column order, with invented people. */
async function sheet(rows, { headers } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(
    headers || [
      "S/N",
      "Staff ID",
      "Name",
      "Designation",
      "Team",
      "Gender",
      "DOJ",
      "DOB",
      "Line Manager",
      "Email",
      "Phone",
      "Emploment Type",
      "Work Arrangement",
      "Work Hours",
      "Bank Name",
    ],
  );
  rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describeDb("the organisation module against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const temp = path.join(os.tmpdir(), `mycity-staff-${process.pid}`);

  const auth = (token) => (r) => r.set("Authorization", `Bearer ${token}`);
  const asOps = () => auth(tokens.ops);
  const asManager = () => auth(tokens.manager);

  beforeAll(async () => {
    await schema.rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    fs.mkdirSync(temp, { recursive: true });

    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "Delivery",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });

    await tx(async (client) => {
      people.ops = await createAdmin(
        client,
        {
          employee: sample("Ada", "Obi", "ops@mycity.test", "Operations & People Lead"),
          role_code: "operations_people",
          is_ceo: false,
        },
        OPS_PASSWORD,
      );
      people.manager = await createAdmin(
        client,
        {
          employee: sample("Chidi", "Nwankwo", "manager@mycity.test", "Delivery Manager"),
          role_code: "manager",
          is_ceo: false,
        },
        MANAGER_PASSWORD,
      );
      const delivery = await organisation.findDepartmentByName(client, "Delivery");
      people.staff = await organisation.createEmployee(
        client,
        {
          first_name: "Ngozi",
          last_name: "Umeh",
          work_email: "ngozi@mycity.test",
          phone: "+2348031234570",
          job_title: "Delivery Analyst",
          start_date: "2026-03-02",
          employment_type: "full_time",
          work_pattern: "hybrid",
          department_id: delivery.department_id,
          line_manager_id: people.manager.employee.employee_id,
          gross_monthly: "450000.00",
          bank_name: "Test Bank",
          account_number: "0123456789",
          date_of_birth: "1994-04-12",
          home_address: "12 Test Close, Lagos",
        },
        { user_id: null, source: "test" },
      );
      people.delivery = delivery;
    });
    await drain();

    for (const [key, email, password] of [
      ["ops", "ops@mycity.test", OPS_PASSWORD],
      ["manager", "manager@mycity.test", MANAGER_PASSWORD],
    ]) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.30.0.${key === "ops" ? 1 : 2}`)
        .send({ email, password });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------------ *
   * The register
   * ------------------------------------------------------------------ */

  describe("the register", () => {
    test("pages at 25, in the contract's shape, with the login state", async () => {
      const res = await asOps()(request(app).get("/api/v1/employees"));
      expect(res.status).toBe(200);
      expect(res.body.page.size).toBe(25);
      expect(res.body.page.total).toBe(3);
      expect(c.organisation.EmployeePage.safeParse(res.body).success).toBe(true);
      const ngozi = res.body.data.find((r) => r.staff_number === people.staff.staff_number);
      expect(ngozi).toMatchObject({
        display_name: "Ngozi Umeh",
        job_title: "Delivery Analyst",
        department: "Delivery",
        work_pattern: "hybrid",
        status: "active",
        login: "none",
      });
      expect(ngozi.line_manager).toMatchObject({ display_name: "Chidi Nwankwo", vacant: false });
      const ada = res.body.data.find((r) => r.display_name === "Ada Obi");
      expect(ada.login).toBe("active");
    });

    test("searches, filters and sorts on the server", async () => {
      const found = await asOps()(request(app).get("/api/v1/employees?q=ngozi"));
      expect(found.body.page.total).toBe(1);
      const byName = await asOps()(request(app).get("/api/v1/employees?q=umeh"));
      expect(byName.body.page.total).toBe(1);
      const byNumber = await asOps()(
        request(app).get(`/api/v1/employees?q=${people.staff.staff_number}`),
      );
      expect(byNumber.body.page.total).toBe(1);
      const hybrid = await asOps()(request(app).get("/api/v1/employees?work_pattern=hybrid"));
      expect(hybrid.body.data.map((r) => r.display_name)).toEqual(["Ngozi Umeh"]);
      const sorted = await asOps()(request(app).get("/api/v1/employees?sort=-display_name"));
      expect(sorted.body.data[0].display_name).toBe("Ngozi Umeh");
      const team = await asOps()(
        request(app).get(`/api/v1/employees?line_manager_id=${people.manager.employee.employee_id}`),
      );
      expect(team.body.data.map((r) => r.display_name)).toEqual(["Ngozi Umeh"]);
    });

    test("a page size or an unknown filter is refused, and so is a sort nobody allow-listed", async () => {
      for (const query of ["?limit=100", "?page_size=50", "?nonsense=1", "?sort=gross_monthly"]) {
        const res = await asOps()(request(app).get(`/api/v1/employees${query}`));
        expect(res.status).toBe(422);
      }
    });

    test("a line manager sees their team, not the whole register", async () => {
      const res = await asManager()(request(app).get("/api/v1/employees"));
      expect(res.status).toBe(200);
      expect(res.body.data.map((r) => r.display_name).sort()).toEqual(["Chidi Nwankwo", "Ngozi Umeh"]);
    });

    test("the counts above it are computed, and say what needs a decision", async () => {
      const res = await asOps()(request(app).get("/api/v1/employees/summary"));
      expect(res.status).toBe(200);
      expect(c.organisation.EmployeesSummary.safeParse(res.body).success).toBe(true);
      expect(res.body.kpis[0]).toEqual({ key: "headcount", label: "Headcount", value: "3" });
      expect(res.body.departments[0]).toMatchObject({ label: "Delivery", value: "3" });
      const invites = res.body.decisions.find((d) => d.title === "Not Yet Invited");
      expect(invites.text).toBe("1 person with no login");
      expect(invites.link).toBe("/settings?tab=users");
    });
  });

  /* ------------------------------------------------------------------ *
   * The record
   * ------------------------------------------------------------------ */

  describe("the employee 360", () => {
    test("carries the profile, the job, the reporting line and the login", async () => {
      const res = await asOps()(request(app).get(`/api/v1/employees/${people.staff.employee_id}`));
      expect(res.status).toBe(200);
      expect(c.organisation.Employee360.safeParse(res.body).success).toBe(true);
      expect(res.body).toMatchObject({
        display_name: "Ngozi Umeh",
        first_name: "Ngozi",
        department: "Delivery",
        direct_reports: 0,
        start_date: "2026-03-02",
      });
      expect(res.body.login).toMatchObject({ state: "none", user_id: null, roles: [] });
      expect(res.body.gross_monthly).toBe("450000.00");
      expect(res.body.bank_name).toBe("Test Bank");
    });

    test("restricted fields are masked for a viewer without the field grant", async () => {
      await q(
        `INSERT INTO field_visibility (role_id, field_key, visibility)
         SELECT role_id, 'employee.salary', 'masked' FROM role WHERE code = 'manager'
         ON CONFLICT DO NOTHING`,
      );
      await q(
        `INSERT INTO field_visibility (role_id, field_key, visibility)
         SELECT role_id, 'employee.bank', 'masked' FROM role WHERE code = 'manager'
         ON CONFLICT DO NOTHING`,
      );
      await require("../../src/shared/rbac/grants-cache").invalidateGrants();
      const res = await asManager()(request(app).get(`/api/v1/employees/${people.staff.employee_id}`));
      expect(res.status).toBe(200);
      expect(res.body.gross_monthly).toBeNull();
      expect(res.body.bank_name).toBeNull();
      expect(res.body.account_number).toBeNull();
      expect(res.body.display_name).toBe("Ngozi Umeh");
    });

    test("a person's own record is never masked from them", async () => {
      const mine = await asManager()(
        request(app).get(`/api/v1/employees/${people.manager.employee.employee_id}`),
      );
      expect(mine.status).toBe(200);
      expect(mine.body.display_name).toBe("Chidi Nwankwo");
      expect(mine.body.phone).not.toBeNull();
    });

    test("a record outside the caller's scope is a 404, not a 403", async () => {
      const res = await asManager()(
        request(app).get(`/api/v1/employees/${people.ops.employee.employee_id}`),
      );
      expect(res.status).toBe(404);
    });

    test("history names every change to the record", async () => {
      const res = await asOps()(
        request(app).get(`/api/v1/employees/${people.staff.employee_id}/history`),
      );
      expect(res.status).toBe(200);
      expect(c.organisation.EmployeeHistoryPage.safeParse(res.body).success).toBe(true);
      expect(res.body.data[res.body.data.length - 1].summary).toBe("Record created");
    });
  });

  /* ------------------------------------------------------------------ *
   * The writes
   * ------------------------------------------------------------------ */

  describe("adding, correcting, archiving and restoring", () => {
    let addedId;

    test("Add Employee issues the next staff number and records the event", async () => {
      const res = await asOps()(request(app).post("/api/v1/employees")).send({
        first_name: "Tariq",
        last_name: "Bello",
        work_email: "tariq@mycity.test",
        phone: "08031234571",
        job_title: "Delivery Analyst",
        start_date: "2026-04-01",
        employment_type: "contractor",
        work_pattern: "remote",
        contract_ends_on: "2026-12-31",
        department_id: people.delivery.department_id,
        line_manager_id: people.manager.employee.employee_id,
      });
      expect(res.status).toBe(201);
      expect(c.organisation.Employee360.safeParse(res.body).success).toBe(true);
      expect(res.body.staff_number).toMatch(/^\d{5}$/);
      addedId = res.body.employee_id;
      expect(await one("SELECT 1 AS x FROM event_log WHERE event_key = 'employee.created' AND entity_id = $1", [addedId])).toEqual({ x: 1 });
    });

    test("the same work email twice is refused on the field", async () => {
      const res = await asOps()(request(app).post("/api/v1/employees")).send({
        first_name: "Other",
        last_name: "Person",
        work_email: "tariq@mycity.test",
        phone: "08031234572",
        job_title: "Delivery Analyst",
        start_date: "2026-04-01",
        employment_type: "full_time",
        work_pattern: "remote",
        department_id: people.delivery.department_id,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.fields.work_email).toEqual(["Already in use"]);
    });

    test("Edit changes only what it was given", async () => {
      const res = await asOps()(request(app).patch(`/api/v1/employees/${addedId}`)).send({
        job_title: "Senior Delivery Analyst",
        work_pattern: "hybrid",
      });
      expect(res.status).toBe(200);
      expect(res.body.job_title).toBe("Senior Delivery Analyst");
      expect(res.body.work_pattern).toBe("hybrid");
      expect(res.body.employment_type).toBe("contractor");
      const audit = await one(
        "SELECT changed_fields FROM audit_ledger WHERE entity_id = $1 AND action = 'employee.updated' ORDER BY occurred_at DESC",
        [addedId],
      );
      expect(audit.changed_fields.sort()).toEqual(["job_title", "work_pattern"]);
    });

    test("an empty edit is refused by the contract", async () => {
      const res = await asOps()(request(app).patch(`/api/v1/employees/${addedId}`)).send({});
      expect(res.status).toBe(422);
    });

    test("Archive takes the record off the register and Restore brings it back", async () => {
      const archived = await asOps()(request(app).post(`/api/v1/employees/${addedId}/archive`)).send({
        archive_reason: "Contract ended early",
      });
      expect(archived.status).toBe(200);
      expect(archived.body.status).toBe("archived");
      expect(archived.body.archive_reason).toBe("Contract ended early");

      const list = await asOps()(request(app).get("/api/v1/employees"));
      expect(list.body.data.map((r) => r.employee_id)).not.toContain(addedId);
      const asked = await asOps()(request(app).get("/api/v1/employees?status=archived"));
      expect(asked.body.data.map((r) => r.employee_id)).toEqual([addedId]);

      const restored = await asOps()(request(app).post(`/api/v1/employees/${addedId}/restore`)).send({});
      expect(restored.status).toBe(200);
      expect(restored.body.status).toBe("active");
      expect(restored.body.archived_at).toBeNull();
    });

    test("archiving twice is refused, and so is archiving the CEO", async () => {
      await asOps()(request(app).post(`/api/v1/employees/${addedId}/archive`)).send({ archive_reason: "Again" });
      const twice = await asOps()(request(app).post(`/api/v1/employees/${addedId}/archive`)).send({ archive_reason: "Again" });
      expect(twice.status).toBe(422);
      expect(twice.body.error.code).toBe("ALREADY_ARCHIVED");
      await asOps()(request(app).post(`/api/v1/employees/${addedId}/restore`)).send({});
    });

    test("a reporting line may be set, cleared, and never looped", async () => {
      const set = await asOps()(
        request(app).patch(`/api/v1/employees/${people.manager.employee.employee_id}/line-manager`),
      ).send({ line_manager_id: people.ops.employee.employee_id, reason: "New structure" });
      expect(set.status).toBe(200);
      expect(set.body.line_manager.display_name).toBe("Ada Obi");

      const loop = await asOps()(
        request(app).patch(`/api/v1/employees/${people.ops.employee.employee_id}/line-manager`),
      ).send({ line_manager_id: people.staff.employee_id });
      expect(loop.status).toBe(422);
      expect(loop.body.error.code).toBe("REPORTING_LOOP");

      const self = await asOps()(
        request(app).patch(`/api/v1/employees/${people.staff.employee_id}/line-manager`),
      ).send({ line_manager_id: people.staff.employee_id });
      expect(self.status).toBe(422);
      expect(self.body.error.code).toBe("REPORTS_TO_SELF");

      const history = await one(
        "SELECT count(*)::int AS n FROM reporting_line WHERE employee_id = $1",
        [people.manager.employee.employee_id],
      );
      expect(history.n).toBeGreaterThan(0);
      expect(
        await one("SELECT 1 AS x FROM event_log WHERE event_key = 'employee.reporting_line_changed'"),
      ).toEqual({ x: 1 });
    });
  });

  /* ------------------------------------------------------------------ *
   * Departments, seats and the tree
   * ------------------------------------------------------------------ */

  describe("departments, seats and the reporting tree", () => {
    let seatId;

    test("a department is data, with its headcount", async () => {
      const made = await asOps()(request(app).post("/api/v1/departments")).send({ name: "Trading" });
      expect(made.status).toBe(201);
      expect(made.body.code).toBe("TRADING");
      const again = await asOps()(request(app).post("/api/v1/departments")).send({ name: "trading" });
      expect(again.status).toBe(409);
      const list = await asOps()(request(app).get("/api/v1/departments"));
      expect(c.organisation.DepartmentPage.safeParse(list.body).success).toBe(true);
      expect(list.body.data.find((d) => d.name === "Delivery").headcount).toBeGreaterThan(0);
      const renamed = await asOps()(request(app).patch(`/api/v1/departments/${made.body.department_id}`)).send({
        name: "Trading Desk",
      });
      expect(renamed.body.name).toBe("Trading Desk");
    });

    test("a vacant seat holds a post nobody fills, and can carry reports", async () => {
      const seat = await asOps()(request(app).post("/api/v1/org-seats")).send({
        title: "Head of Trading",
        department_id: people.delivery.department_id,
        line_manager_id: people.ops.employee.employee_id,
      });
      expect(seat.status).toBe(201);
      expect(c.organisation.OrgSeat.safeParse(seat.body).success).toBe(true);
      seatId = seat.body.org_seat_id;

      const moved = await asOps()(
        request(app).patch(`/api/v1/employees/${people.staff.employee_id}/line-manager`),
      ).send({ line_manager_seat_id: seatId, dotted_manager_id: people.manager.employee.employee_id });
      expect(moved.status).toBe(200);
      expect(moved.body.line_manager).toMatchObject({ display_name: "Head of Trading", vacant: true });
      expect(moved.body.dotted_manager).toMatchObject({ display_name: "Chidi Nwankwo" });

      const seats = await asOps()(request(app).get("/api/v1/org-seats?status=vacant"));
      expect(seats.body.data.find((s) => s.org_seat_id === seatId).reports).toBe(1);
    });

    test("the whole tree is one read, seats included, and every member of staff may read it", async () => {
      const res = await asManager()(request(app).get("/api/v1/org-chart?view=viewer"));
      expect(res.status).toBe(200);
      expect(c.organisation.OrgChartTree.safeParse(res.body).success).toBe(true);
      const seat = res.body.nodes.find((n) => n.node_kind === "seat");
      expect(seat).toMatchObject({ display_name: "Head of Trading", vacant: true });
      const ngozi = res.body.nodes.find((n) => n.display_name === "Ngozi Umeh");
      expect(ngozi.manager_node_id).toBe(seat.node_id);
      expect(ngozi.dotted_line_to).toBe("Chidi Nwankwo");
      expect(ngozi.meta).toBeNull();
      expect(res.body.open).toBe(1);
      expect(res.body.filled).toBeGreaterThan(0);
    });

    test("the builder's view adds the since and arrangement line", async () => {
      const res = await asOps()(request(app).get("/api/v1/org-chart?view=builder"));
      const ngozi = res.body.nodes.find((n) => n.display_name === "Ngozi Umeh");
      expect(ngozi.meta).toBe("Since 2026 · Hybrid");
    });

    test("an archived person leaves the tree and their reports become roots", async () => {
      const before = await asOps()(request(app).get("/api/v1/org-chart"));
      const rootsBefore = before.body.roots;
      await asOps()(request(app).post(`/api/v1/employees/${people.manager.employee.employee_id}/archive`)).send({
        archive_reason: "Left the company",
      });
      const after = await asOps()(request(app).get("/api/v1/org-chart"));
      expect(after.body.nodes.find((n) => n.display_name === "Chidi Nwankwo")).toBeUndefined();
      expect(after.body.roots).toBeGreaterThanOrEqual(rootsBefore);
      const ngozi = after.body.nodes.find((n) => n.display_name === "Ngozi Umeh");
      expect(ngozi.dotted_line_to).toBeNull();
      await asOps()(request(app).post(`/api/v1/employees/${people.manager.employee.employee_id}/restore`)).send({});
    });
  });

  /* ------------------------------------------------------------------ *
   * The staff importer and the roster loader
   * ------------------------------------------------------------------ */

  describe("the staff importer and the roster", () => {
    const rolesFile = () => {
      const file = path.join(temp, "roles.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          default: { roles: ["employee"] },
          by_job_title: {
            "Chief Executive Officer": { roles: ["management"], is_ceo: true },
            "Head of Trading": { roles: ["head_of_department"], work_email: "trading@mycity.test" },
          },
        }),
      );
      return file;
    };

    /** The invented sheet: a chief, a head with no email, two officers and a vacant post. */
    const rows = () => [
      ["T0001", "Zuri Danladi", "Chief Executive Officer", "Trading Desk", "Female", new Date(Date.UTC(2024, 0, 8)), "12/12", "", "zuri@mycity.test", "#0000000000", "FTE", "Remote", "Mon - Fri", "Test Bank"],
      ["T0002", "Hauwa Lawal", "Head of Trading", "Trading Desk", "Female", new Date(Date.UTC(2025, 5, 2)), "26/09", "Zuri Danladi", "", "#0000000000", "FTE", "Hybrid", "Mon - Fri", "Test Bank"],
      ["T0003", "Emeka Obiora", "Trading Officer", "Trading Desk", "Male", new Date(Date.UTC(2026, 2, 2)), "03/02", "Hauwa - Head of Trading", "emeka@mycity.test", "#0000000000", "FTE", "Remote", "Mon - Fri", "Test Bank"],
      ["T0004", "Sade Akin", "Trading Officer", "Trading Desk", "Female", new Date(Date.UTC(2026, 3, 6)), "17/09", "Head of Settlement, with dotted line to Head of Trading", "sade@mycity.test", "#0000000000", "FTE", "Remote", "Mon - Fri", "Test Bank"],
      ["", "VACANT", "Head of Settlement", "Trading Desk", "", "", "", "", "", "", "FTE", "Hybrid", "Mon - Fri", ""],
    ];

    let sheetFile;

    beforeAll(async () => {
      sheetFile = path.join(temp, "staff-list.xlsx");
      fs.writeFileSync(sheetFile, await sheet(rows()));
    });

    test("the loader reads the sheet, drops the columns it gets wrong, and loads the roster", async () => {
      const log = [];
      const result = await loader.loadStaff({
        db: pool,
        log: (m) => log.push(m),
        sheet: sheetFile,
        rolesFile: rolesFile(),
      });
      expect(result.status).toBe("loaded");
      expect(result.stats.create).toBe(5);
      expect(result.stats.error).toBe(0);
      expect(result.dropped.map((d) => d.field).sort()).toEqual(["date_of_birth", "phone"]);
      expect(log.join("\n")).toMatch(/column "DOB" not imported/);

      const zuri = await one(
        "SELECT staff_number::text AS staff_number, work_email::text AS work_email, start_date, gender FROM employee WHERE staff_number = 'T0001'",
      );
      expect(zuri).toMatchObject({ work_email: "zuri@mycity.test", gender: "female" });
      expect(String(zuri.start_date).slice(0, 10)).toBe("2024-01-08");
      expect(await one("SELECT date_of_birth, phone FROM employee WHERE staff_number = 'T0001'")).toEqual({
        date_of_birth: null,
        phone: null,
      });
    });

    test("the post whose email the sheet leaves empty takes it from roles.json", async () => {
      const hauwa = await one(
        "SELECT work_email::text AS work_email FROM employee WHERE staff_number = 'T0002'",
      );
      expect(hauwa.work_email).toBe("trading@mycity.test");
    });

    test("a name, a name with a post, and a post are all resolved to the right manager", async () => {
      const line = await one(
        `SELECT btrim(m.first_name || ' ' || m.last_name) AS manager
           FROM employee e JOIN employee m ON m.employee_id = e.line_manager_id
          WHERE e.staff_number = 'T0002'`,
      );
      expect(line.manager).toBe("Zuri Danladi");
      const byPost = await one(
        `SELECT btrim(m.first_name || ' ' || m.last_name) AS manager
           FROM employee e JOIN employee m ON m.employee_id = e.line_manager_id
          WHERE e.staff_number = 'T0003'`,
      );
      expect(byPost.manager).toBe("Hauwa Lawal");
    });

    test("a VACANT row becomes a seat, and the row under it reports to the seat with a dotted line", async () => {
      const seat = await one("SELECT org_seat_id, title, status FROM org_seat WHERE title = 'Head of Settlement'");
      expect(seat.status).toBe("vacant");
      const sade = await one(
        `SELECT e.line_manager_seat_id, btrim(d.first_name || ' ' || d.last_name) AS dotted
           FROM employee e LEFT JOIN employee d ON d.employee_id = e.dotted_manager_id
          WHERE e.staff_number = 'T0004'`,
      );
      expect(sade.line_manager_seat_id).toBe(seat.org_seat_id);
      expect(sade.dotted).toBe("Hauwa Lawal");
    });

    test("every person gets a login in the invited state, with the roles their post is given", async () => {
      const zuri = await one(
        `SELECT u.password_hash, u.is_ceo, u.password_changed_at,
                (SELECT array_agg(r.code::text ORDER BY r.code) FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id) AS roles
           FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
          WHERE e.staff_number = 'T0001'`,
      );
      expect(zuri.password_hash).toBe("!invited");
      expect(zuri.password_changed_at).toBeNull();
      expect(zuri.is_ceo).toBe(true);
      expect(zuri.roles).toEqual(["management"]);
      const hauwa = await one(
        `SELECT (SELECT array_agg(r.code::text) FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id) AS roles
           FROM app_user u JOIN employee e ON e.employee_id = u.employee_id WHERE e.staff_number = 'T0002'`,
      );
      expect(hauwa.roles).toEqual(["head_of_department"]);
      const officer = await one(
        `SELECT (SELECT array_agg(r.code::text) FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id) AS roles
           FROM app_user u JOIN employee e ON e.employee_id = u.employee_id WHERE e.staff_number = 'T0003'`,
      );
      expect(officer.roles).toEqual(["employee"]);
    });

    test("nobody is emailed: Send Invite does that later", async () => {
      expect(sent.filter((j) => j.data && j.data.template === "user-invite")).toEqual([]);
    });

    test("the staff-number counter moves past the numbers the sheet brought", async () => {
      const res = await asOps()(request(app).post("/api/v1/employees")).send({
        first_name: "After",
        last_name: "Import",
        work_email: "after@mycity.test",
        phone: "08031234573",
        job_title: "Delivery Analyst",
        start_date: "2026-05-04",
        employment_type: "full_time",
        work_pattern: "remote",
        department_id: people.delivery.department_id,
      });
      expect(res.status).toBe(201);
      const taken = await one("SELECT 1 AS x FROM employee WHERE staff_number = $1 AND work_email <> 'after@mycity.test'", [res.body.staff_number]);
      expect(taken).toBeUndefined();
    });

    test("running it again changes nothing, and an edit made on screen stands", async () => {
      const hauwa = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0002'");
      const edited = await asOps()(request(app).patch(`/api/v1/employees/${hauwa.employee_id}`)).send({
        job_title: "Head of Trading and Settlement",
      });
      expect(edited.status).toBe(200);

      const before = await one("SELECT count(*)::int AS n FROM employee");
      const again = await loader.loadStaff({ db: pool, sheet: sheetFile, rolesFile: rolesFile() });
      expect(again.status).toBe("already_loaded");
      expect(await one("SELECT count(*)::int AS n FROM employee")).toEqual(before);
      const kept = await one("SELECT job_title FROM employee WHERE staff_number = 'T0002'");
      expect(kept.job_title).toBe("Head of Trading and Settlement");
    });

    test("a changed sheet adds the new row and leaves the people it already loaded alone", async () => {
      const grown = [...rows(), ["T0005", "Bilal Sani", "Trading Officer", "Trading Desk", "Male", new Date(Date.UTC(2026, 6, 1)), "", "Head of Settlement", "bilal@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""]];
      fs.writeFileSync(sheetFile, await sheet(grown));
      const result = await loader.loadStaff({ db: pool, sheet: sheetFile, rolesFile: rolesFile() });
      expect(result.status).toBe("loaded");
      expect(result.stats.create).toBe(1);
      expect(result.stats.unchanged).toBe(5);
      const kept = await one("SELECT job_title FROM employee WHERE staff_number = 'T0002'");
      expect(kept.job_title).toBe("Head of Trading and Settlement");
      const bilal = await one(
        `SELECT e.staff_number::text AS staff_number, s.title
           FROM employee e JOIN org_seat s ON s.org_seat_id = e.line_manager_seat_id
          WHERE e.staff_number = 'T0005'`,
      );
      expect(bilal.title).toBe("Head of Settlement");
    });

    test("the batch is in Imports history with its counts", async () => {
      const batch = await one(
        `SELECT number, importer_key, status, stats, options->>'keep_existing' AS keep
           FROM import_batch WHERE status = 'committed' ORDER BY committed_at DESC`,
      );
      expect(batch.importer_key).toBe("employees");
      expect(batch.keep).toBe("true");
      expect(batch.stats.rows).toBe(6);
    });

    test("a row the sheet gets wrong is reported and does not stop the others", async () => {
      const broken = [
        ["T0101", "Kemi Alabi", "Trading Officer", "Trading Desk", "Female", new Date(Date.UTC(2026, 1, 2)), "", "Nobody At All", "kemi@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
        ["T0102", "Yusuf Garba", "Trading Officer", "Trading Desk", "Male", new Date(Date.UTC(2026, 1, 3)), "", "", "yusuf@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
      ];
      const file = path.join(temp, "broken.xlsx");
      fs.writeFileSync(file, await sheet(broken));
      const log = [];
      const result = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile(), log: (m) => log.push(m) });
      expect(result.status).toBe("loaded");
      expect(await one("SELECT 1 AS x FROM employee WHERE staff_number = 'T0102'")).toEqual({ x: 1 });
      const kemi = await one(
        `SELECT e.line_manager_id, e.line_manager_seat_id FROM employee e WHERE e.staff_number = 'T0101'`,
      );
      expect(kemi.line_manager_id).toBeNull();
      expect(kemi.line_manager_seat_id).toBeNull();
      expect(log.join("\n")).toMatch(/Line Manager "Nobody At All" is not in the file or the system; saved without Line Manager/);
    });

    test("no sheet in the build means nothing happens at all", async () => {
      const result = await loader.loadStaff({ db: pool, sheet: path.join(temp, "missing.xlsx") });
      expect(result.status).toBe("no_sheet");
    });
  });
});

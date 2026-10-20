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
const lagos = require("../../src/shared/time/lagos");
const approvers = require("../../src/shared/workflow/approvers");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const c = require("@mycity/contract");
const { picked } = require("../helpers/places");

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
          // The service takes what the contract parsed: the place itself.
          home_address: c.maps.PlaceInput.parse(picked("12 Test Close, Lagos")),
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
      expect(res.body.data.map((r) => r.photo_url)).toEqual([null, null]);
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

    test("Home reads the same counts through the service, counted from the Lagos date it is given", async () => {
      const all = { scope: "all", scope_ids: null };
      const today = lagos.today();
      const tomorrow = lagos.addDays(today, 1);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const before = {
          today: await organisation.counts(client, all, { today }),
          tomorrow: await organisation.counts(client, all, { today: tomorrow }),
        };
        const add = async (first, set, values) => {
          const { employee_id: id } = (await client.query(schema.sql.employee, [first, "Counted", null])).rows[0];
          await client.query(`UPDATE employee SET ${set} WHERE employee_id = $1`, [id, ...values]);
        };
        await add("Dueinthirty", "confirmation_due_on = $2", [lagos.addDays(today, 30)]);
        await add("Dueinthirtyone", "confirmation_due_on = $2", [lagos.addDays(today, 31)]);
        await add("Leftninety", "start_date = $2, status = 'left', left_on = $3", [
          lagos.addDays(today, -400),
          lagos.addDays(today, -90),
        ]);
        await add("Leftninetyone", "start_date = $2, status = 'left', left_on = $3", [
          lagos.addDays(today, -400),
          lagos.addDays(today, -91),
        ]);
        const change = async (on) => {
          const now = await organisation.counts(client, all, { today: on });
          const was = before[on === today ? "today" : "tomorrow"];
          return Object.fromEntries(Object.keys(now).map((k) => [k, now[k] - was[k]]));
        };
        // Today the windows hold the 30th day ahead and the 90th day back, and nothing beyond.
        expect(await change(today)).toEqual({ headcount: 2, attrition_90d: 1, confirmations_due: 1 });
        // A day later both windows have moved with the date: nothing reads the database's clock.
        expect(await change(tomorrow)).toEqual({ headcount: 2, attrition_90d: 0, confirmations_due: 2 });
        // And the register's own count is the same figure.
        const counted = await organisation.counts(client, all);
        const summary = await organisation.summary(client, all);
        expect(summary.kpis.find((k) => k.key === "headcount").value).toBe(String(counted.headcount));
        expect(summary.kpis.find((k) => k.key === "attrition").value).toBe(String(counted.attrition_90d));
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    test("the counts refuse a date that is not one", async () => {
      await expect(organisation.counts(pool, { scope: "all", scope_ids: null }, { today: "2026-02-30" })).rejects.toThrow(
        TypeError,
      );
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

    test("an edit leaves every field it was not given alone, masked ones included", async () => {
      const before = await one(
        "SELECT gross_monthly, bank_name, account_number, date_of_birth, home_address FROM employee WHERE employee_id = $1",
        [people.staff.employee_id],
      );
      expect(before.gross_monthly).not.toBeNull();
      /* What a viewer without the field grant sees: those fields come back null, and a
         form that sent them back as they look (empty, or null for a typed field) would
         blank them. */
      const res = await asOps()(request(app).patch(`/api/v1/employees/${people.staff.employee_id}`)).send({
        job_title: "Senior Analyst",
        gross_monthly: null,
        bank_name: "",
        account_number: null,
        date_of_birth: "",
      });
      expect(res.status).toBe(200);
      expect(res.body.job_title).toBe("Senior Analyst");
      const after = await one(
        "SELECT gross_monthly, bank_name, account_number, date_of_birth, home_address FROM employee WHERE employee_id = $1",
        [people.staff.employee_id],
      );
      expect(after).toEqual(before);
      const audit = await one(
        "SELECT changed_fields FROM audit_ledger WHERE entity_id = $1 AND action = 'employee.updated' ORDER BY occurred_at DESC",
        [people.staff.employee_id],
      );
      expect(audit.changed_fields).toEqual(["job_title"]);
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

    test("a seat can be corrected, and naming a manager clears the other kind", async () => {
      /* Its own two seats, closed at the end, so no other test's structure moves. */
      const above = await asOps()(request(app).post("/api/v1/org-seats")).send({
        title: "Head of Clearing",
        department_id: people.delivery.department_id,
      });
      const below = await asOps()(request(app).post("/api/v1/org-seats")).send({
        title: "Clearing Lead",
        department_id: people.delivery.department_id,
      });
      expect(above.status).toBe(201);
      expect(below.status).toBe(201);

      const underSeat = await asOps()(request(app).patch(`/api/v1/org-seats/${below.body.org_seat_id}`)).send({
        line_manager_seat_id: above.body.org_seat_id,
      });
      expect(underSeat.status).toBe(200);
      expect(underSeat.body.line_manager).toMatchObject({ display_name: "Head of Clearing", vacant: true });

      const underPerson = await asOps()(request(app).patch(`/api/v1/org-seats/${below.body.org_seat_id}`)).send({
        title: "Clearing Lead, Lagos",
        line_manager_id: people.ops.employee.employee_id,
      });
      expect(underPerson.status).toBe(200);
      expect(underPerson.body.title).toBe("Clearing Lead, Lagos");
      expect(underPerson.body.line_manager).toMatchObject({ display_name: "Ada Obi", vacant: false });
      const row = await one("SELECT line_manager_id, line_manager_seat_id FROM org_seat WHERE org_seat_id = $1", [
        below.body.org_seat_id,
      ]);
      expect(row.line_manager_seat_id).toBeNull();
      expect(row.line_manager_id).toBe(people.ops.employee.employee_id);

      const itself = await asOps()(request(app).patch(`/api/v1/org-seats/${below.body.org_seat_id}`)).send({
        line_manager_seat_id: below.body.org_seat_id,
      });
      expect(itself.status).toBe(422);

      for (const id of [below.body.org_seat_id, above.body.org_seat_id])
        expect((await asOps()(request(app).patch(`/api/v1/org-seats/${id}`)).send({ status: "closed" })).status).toBe(200);
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
      // Nobody here has a photo: a person shows initials, and a seat never has one.
      expect(ngozi.photo_url).toBeNull();
      expect(seat.photo_url).toBeNull();
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
   * Download PDF (docs/guides/organogram.md §5 to §7)
   * ------------------------------------------------------------------ */

  describe("Download PDF", () => {
    const documents = require("../../src/shared/documents/generate");
    const vault = require("../../src/shared/documents/vault");
    /* Tests have no Chromium; this stands in for it, as the reports tests do. */
    const fakePdf = async () => Buffer.from("%PDF-1.4\n% an organogram\n");
    const chartDocuments = async () =>
      (await q("SELECT document_id, render_status, render_html, uploaded_by, entity_id, locked_at FROM document WHERE doc_type = 'org_chart' ORDER BY created_at")).rows;

    test("any member of staff may ask: the chart is laid out as they asked, drawn after commit and downloaded, never emailed", async () => {
      const before = (await chartDocuments()).length;
      const res = await asManager()(request(app).post("/api/v1/org-chart/exports")).send({ view: "viewer" });
      expect(res.status).toBe(202);
      const file = c.documents.ExportFile.parse(res.body);
      expect(file).toMatchObject({ status: "pending", file_name: "Organogram.pdf" });

      const docs = await chartDocuments();
      expect(docs).toHaveLength(before + 1);
      const doc = docs[docs.length - 1];
      expect(doc).toMatchObject({ document_id: file.document_id, render_status: "pending", uploaded_by: people.manager.user.user_id });
      /* Every card is on the page, the open role as one; the viewer's card has no since line. */
      expect(doc.render_html).toContain("Ngozi Umeh");
      expect(doc.render_html).toContain("Vacant · ");
      expect(doc.render_html).toContain("Dotted line · Chidi Nwankwo");
      expect(doc.render_html).not.toContain("Since 2026 · Hybrid");
      const waiting = await asManager()(request(app).get(`/api/v1/exports/${file.document_id}`));
      expect(waiting.body.status).toBe("pending");

      sent.length = 0;
      await documents.renderPending(doc.document_id, { db: pool, renderPdf: fakePdf });
      await drain();
      expect(sent.filter((m) => m.queue === "email-send")).toEqual([]);
      const done = await asManager()(request(app).get(`/api/v1/exports/${file.document_id}`));
      expect(c.documents.ExportFile.parse(done.body)).toEqual({ ...file, status: "done" });
      /* An export is a copy for one person, never locked, so the cleanup can remove it a day later. */
      expect((await vault.get(pool, doc.document_id)).locked_at).toBeNull();
      const pdf = await asManager()(request(app).get(`/api/v1/documents/${file.document_id}/content`));
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-type"]).toMatch(/pdf/);

      /* The file is the asker's: they and the CEO open it, not even Operations, who cannot wait on it either. */
      const row = await vault.get(pool, doc.document_id);
      expect(await vault.canRead(pool, await grantsCache.getAuthUser(pool, people.manager.user.user_id), row)).toBe(true);
      expect(await vault.canRead(pool, await grantsCache.getAuthUser(pool, people.ops.user.user_id), row)).toBe(false);
      expect((await asOps()(request(app).get(`/api/v1/exports/${file.document_id}`))).status).toBe(404);

      /* The request is on the record, with the file it made. */
      const asked = await one(
        "SELECT entity_type, entity_id, payload FROM event_log WHERE event_key = 'org_chart.export_requested' ORDER BY occurred_at DESC",
      );
      expect(asked).toMatchObject({ entity_type: "org_chart_export", entity_id: doc.entity_id, payload: { view: "viewer", document_id: doc.document_id } });
    });

    test("the builder's PDF carries the since and arrangement line", async () => {
      await asOps()(request(app).post("/api/v1/org-chart/exports")).send({ view: "builder" });
      const docs = await chartDocuments();
      expect(docs[docs.length - 1].render_html).toContain("Since 2026 · Hybrid");
    });

    test("a PDF the render job gives up on is failed for the screen waiting on it, and nobody is notified", async () => {
      const res = await asManager()(request(app).post("/api/v1/org-chart/exports")).send({});
      const doc = (await chartDocuments()).pop();
      expect(doc.document_id).toBe(res.body.document_id);
      await documents.failRender(doc.document_id, new Error("Chromium went away"), { db: pool });
      await drain();
      expect((await asManager()(request(app).get(`/api/v1/exports/${doc.document_id}`))).body.status).toBe("failed");
      const told = await q("SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND entity_type = 'org_chart_export'", [
        people.manager.user.user_id,
      ]);
      expect(told.rows[0].n).toBe(0);
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

      /* The DOB column's day and month are kept for the celebrations, matched by email, else staff number. */
      expect(result.birthdays).toEqual({ set: 4, unmatched: 0 });
      expect(await one("SELECT birth_day, birth_month FROM employee WHERE staff_number = 'T0001'")).toEqual({ birth_day: 12, birth_month: 12 });
      expect(await one("SELECT birth_day, birth_month FROM employee WHERE staff_number = 'T0002'")).toEqual({ birth_day: 26, birth_month: 9 });
      const due = await require("../../src/modules/community/community.repo").celebrationsOn(pool, "2026-09-17");
      const sade = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0004'");
      expect(due).toContainEqual({ employee_id: sade.employee_id, occasion: "birthday", years: null });
    });

    test("a day and month cell reads day first, and a full date or nonsense is not one", () => {
      expect(loader.dayMonth("03/07")).toEqual({ day: 3, month: 7 });
      expect(loader.dayMonth(" 29-2 ")).toEqual({ day: 29, month: 2 });
      expect(loader.dayMonth("31/04")).toBeNull();
      expect(loader.dayMonth("03/07/1991")).toBeNull();
      expect(loader.dayMonth(new Date())).toBeNull();
      expect(loader.dayMonth("")).toBeNull();
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
      expect(again.birthdays).toEqual({ set: 0, unmatched: 0 }); // each one is written once
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

    test("the roster takes back a staff number held by somebody it does not name", async () => {
      // The bootstrap administrator is created before any roster and is given the first
      // number, which the sheet says belongs to someone else.
      const res = await asOps()(request(app).post("/api/v1/employees")).send({
        first_name: "Ifeanyi",
        last_name: "Squatter",
        work_email: "squatter@mycity.test",
        phone: "08031234574",
        job_title: "Delivery Analyst",
        start_date: "2026-05-05",
        employment_type: "full_time",
        work_pattern: "remote",
        department_id: people.delivery.department_id,
      });
      expect(res.status).toBe(201);
      const number = res.body.staff_number;

      const file = path.join(temp, "reclaim.xlsx");
      fs.writeFileSync(
        file,
        await sheet([
          [number, "Ngozi Umeh", "Trading Officer", "Trading Desk", "Female", new Date(Date.UTC(2026, 4, 6)), "", "", "ngozi.reclaim@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
        ]),
      );
      const result = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(result.stats.create).toBe(1);
      expect(result.stats.error).toBe(0);

      const owner = await one("SELECT work_email::text AS work_email FROM employee WHERE staff_number = $1", [number]);
      expect(owner.work_email).toBe("ngozi.reclaim@mycity.test");

      const moved = await one(
        "SELECT staff_number::text AS staff_number, job_title FROM employee WHERE work_email = 'squatter@mycity.test'",
      );
      expect(moved.staff_number).not.toBe(number);
      expect(moved.job_title).toBe("Delivery Analyst");
    });

    test("a staff number the same sheet gives somebody else is a problem, not a move", async () => {
      const file = path.join(temp, "contradicts.xlsx");
      fs.writeFileSync(
        file,
        await sheet([
          ["T0301", "Chidi Nwosu", "Trading Officer", "Trading Desk", "Male", new Date(Date.UTC(2026, 4, 7)), "", "", "chidi.one@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
          ["T0301", "Amaka Eze", "Trading Officer", "Trading Desk", "Female", new Date(Date.UTC(2026, 4, 8)), "", "", "amaka.two@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
        ]),
      );
      const result = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(result.stats.create).toBe(1);
      expect(result.stats.duplicate).toBe(1);
      const held = await one("SELECT work_email::text AS work_email FROM employee WHERE staff_number = 'T0301'");
      expect(held.work_email).toBe("chidi.one@mycity.test");
      expect(await one("SELECT 1 AS x FROM employee WHERE work_email = 'amaka.two@mycity.test'")).toBeUndefined();
    });

    test("a holder the roster names keeps their number, and the row says so", async () => {
      await expect(
        tx((client) =>
          organisation.importRow(
            client,
            {
              staff_number: "T0301",
              full_name: "Amaka Eze",
              job_title: "Trading Officer",
              work_email: "amaka.two@mycity.test",
              department: people.delivery.department_id,
            },
            {
              actor: null,
              options: {
                reclaim_staff_numbers: true,
                roster_work_emails: ["chidi.one@mycity.test", "amaka.two@mycity.test"],
              },
            },
          ),
        ),
      ).rejects.toMatchObject({ code: "STAFF_NUMBER_TAKEN" });
      const kept = await one("SELECT work_email::text AS work_email FROM employee WHERE staff_number = 'T0301'");
      expect(kept.work_email).toBe("chidi.one@mycity.test");
    });

    test("importing a sheet by hand reports a taken staff number instead of moving anyone", async () => {
      const held = await one("SELECT staff_number::text AS staff_number FROM employee WHERE staff_number = 'T0001'");
      await expect(
        tx((client) =>
          organisation.importRow(
            client,
            {
              staff_number: held.staff_number,
              full_name: "Wale Adeyemi",
              job_title: "Trading Officer",
              work_email: "wale.byhand@mycity.test",
              department: people.delivery.department_id,
            },
            { actor: null, options: {} },
          ),
        ),
      ).rejects.toMatchObject({ code: "STAFF_NUMBER_TAKEN" });
      const kept = await one("SELECT work_email::text AS work_email FROM employee WHERE staff_number = 'T0001'");
      expect(kept.work_email).toBe("zuri@mycity.test");
    });

    test("a VACANT row's Line Manager is the seat's own line, given only while the seat has none", async () => {
      const zuri = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0001'");
      const risk = [
        ["", "VACANT", "Head of Risk", "Trading Desk", "", "", "", "Chief Executive Officer", "", "", "FTE", "Hybrid", "Mon - Fri", ""],
        ["T0401", "Femi Ojo", "Risk Analyst", "Trading Desk", "Male", new Date(Date.UTC(2026, 6, 6)), "", "Head of Risk", "femi@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
      ];
      const file = path.join(temp, "seat-line.xlsx");
      fs.writeFileSync(file, await sheet(risk));
      const first = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(first.stats).toMatchObject({ create: 2, warning: 0, error: 0 });
      const seat = await one("SELECT org_seat_id, line_manager_id FROM org_seat WHERE title = 'Head of Risk'");
      expect(seat.line_manager_id).toBe(zuri.employee_id);
      const femi = await one("SELECT line_manager_seat_id FROM employee WHERE staff_number = 'T0401'");
      expect(femi.line_manager_seat_id).toBe(seat.org_seat_id);

      /* A line set on screen stays: the next sheet names someone else, and the roster leaves it. */
      const onScreen = await asOps()(request(app).patch(`/api/v1/org-seats/${seat.org_seat_id}`)).send({
        line_manager_id: people.ops.employee.employee_id,
      });
      expect(onScreen.status).toBe(200);
      risk[0][7] = "Hauwa Lawal";
      fs.writeFileSync(file, await sheet(risk));
      const again = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(again.status).toBe("loaded");
      expect(again.stats).toMatchObject({ create: 0, update: 0, unchanged: 2, error: 0 });
      const kept = await one("SELECT line_manager_id FROM org_seat WHERE org_seat_id = $1", [seat.org_seat_id]);
      expect(kept.line_manager_id).toBe(people.ops.employee.employee_id);
    });

    test("while a seat is empty, the first person above it approves for its reports and has them in team scope", async () => {
      const femi = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0401'");
      expect(
        await approvers.resolve(pool, [{ type: "manager_of_subject" }], { subject_employee_id: femi.employee_id }),
      ).toEqual([{ type: "employee", value: people.ops.employee.employee_id, via: "manager_of_subject" }]);
      await drain();
      expect(await grantsCache.getTeamEmployeeIds(pool, people.ops.employee.employee_id)).toContain(femi.employee_id);
      const me = await asOps()(request(app).get("/api/v1/auth/me"));
      expect(me.body.manages_people).toBe(true);
    });

    test("a seat under one of its own reports, or a person under a seat below them, is a loop", async () => {
      const seat = await one("SELECT org_seat_id FROM org_seat WHERE title = 'Head of Risk'");
      const femi = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0401'");
      const seatUnderReport = await asOps()(request(app).patch(`/api/v1/org-seats/${seat.org_seat_id}`)).send({
        line_manager_id: femi.employee_id,
      });
      expect(seatUnderReport.status).toBe(422);
      expect(seatUnderReport.body.error.code).toBe("REPORTING_LOOP");
      /* The seat reports to Ada (set on screen above), so Ada under the seat would circle. */
      await expect(
        tx((client) =>
          organisation.setReportingLine(client, people.ops.employee.employee_id, { line_manager_seat_id: seat.org_seat_id }, null),
        ),
      ).rejects.toMatchObject({ code: "REPORTING_LOOP" });
    });

    test("a post the sheet does not hold is given the line manager roles.json names, only while it has none", async () => {
      const partner = await asOps()(request(app).post("/api/v1/employees")).send({
        first_name: "Build",
        last_name: "Partner",
        work_email: "partner@mycity.test",
        phone: "08031234575",
        job_title: "Implementation Partner",
        start_date: "2026-05-05",
        employment_type: "consultant",
        work_pattern: "remote",
        department_id: people.delivery.department_id,
      });
      expect(partner.status).toBe(201);
      const roles = path.join(temp, "roles-partner.json");
      fs.writeFileSync(
        roles,
        JSON.stringify({
          default: { roles: ["employee"] },
          by_job_title: {
            "Chief Executive Officer": { roles: ["management"], is_ceo: true },
            "Implementation Partner": { line_manager: "Chief Executive Officer" },
          },
        }),
      );
      const log = [];
      const result = await loader.loadStaff({ db: pool, sheet: sheetFile, rolesFile: roles, log: (m) => log.push(m) });
      expect(result.status).toBe("already_loaded");
      expect(result.lines).toEqual({ set: 1, unresolved: 0 });
      expect(log.join("\n")).toMatch(/Build Partner \(Implementation Partner\) now reports to the Chief Executive Officer/);
      const zuri = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0001'");
      const line = await one("SELECT line_manager_id FROM employee WHERE employee_id = $1", [partner.body.employee_id]);
      expect(line.line_manager_id).toBe(zuri.employee_id);

      /* A manager set on screen stays. */
      const moved = await asOps()(request(app).patch(`/api/v1/employees/${partner.body.employee_id}/line-manager`)).send({
        line_manager_id: people.ops.employee.employee_id,
      });
      expect(moved.status).toBe(200);
      const again = await loader.loadStaff({ db: pool, sheet: sheetFile, rolesFile: roles });
      expect(again.lines).toEqual({ set: 0, unresolved: 0 });
      const kept = await one("SELECT line_manager_id FROM employee WHERE employee_id = $1", [partner.body.employee_id]);
      expect(kept.line_manager_id).toBe(people.ops.employee.employee_id);
    });

    test("a corrected work email keeps the person on their number, with no second record", async () => {
      const before = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0003'");
      const corrected = rows().map((r) => (r[0] === "T0003" ? Object.assign([...r], { 8: "emeka.obiora@mycity.test" }) : r));
      const file = path.join(temp, "corrected-email.xlsx");
      fs.writeFileSync(file, await sheet(corrected));
      const result = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(result.stats).toMatchObject({ create: 0, error: 0 });
      const after = await one("SELECT employee_id FROM employee WHERE staff_number = 'T0003'");
      expect(after.employee_id).toBe(before.employee_id);
      expect(await one("SELECT count(*)::int AS n FROM employee WHERE first_name = 'Emeka' AND last_name = 'Obiora'")).toEqual({ n: 1 });
    });

    test("a dotted line to someone the same sheet creates is kept from the preview to the commit", async () => {
      const file = path.join(temp, "dotted-new.xlsx");
      fs.writeFileSync(
        file,
        await sheet([
          ["T0501", "Kemi Bello", "Settlement Lead", "Trading Desk", "Female", new Date(Date.UTC(2026, 7, 3)), "", "Zuri Danladi", "kemi.bello@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
          ["T0502", "Tunde Ade", "Settlement Officer", "Trading Desk", "Male", new Date(Date.UTC(2026, 7, 4)), "", "Head of Settlement, with dotted line to Kemi Bello", "tunde@mycity.test", "", "FTE", "Remote", "Mon - Fri", ""],
        ]),
      );
      const result = await loader.loadStaff({ db: pool, sheet: file, rolesFile: rolesFile() });
      expect(result.stats).toMatchObject({ create: 2, error: 0 });
      const tunde = await one(
        `SELECT s.title, btrim(d.first_name || ' ' || d.last_name) AS dotted
           FROM employee e
           JOIN org_seat s ON s.org_seat_id = e.line_manager_seat_id
           LEFT JOIN employee d ON d.employee_id = e.dotted_manager_id
          WHERE e.staff_number = 'T0502'`,
      );
      expect(tunde).toEqual({ title: "Head of Settlement", dotted: "Kemi Bello" });
    });

    test("an import's problem list carries the rows saved with something missing, beside the errors", async () => {
      const batch = await one(
        `SELECT b.import_batch_id FROM import_batch b
          WHERE EXISTS (SELECT 1 FROM import_row r WHERE r.import_batch_id = b.import_batch_id AND r.status = 'warning')
          ORDER BY b.created_at DESC`,
      );
      const res = await asOps()(request(app).get(`/api/v1/imports/${batch.import_batch_id}/rows?status=problem`));
      expect(res.status).toBe(200);
      expect(c.imports.ImportRowPage.safeParse(res.body).success).toBe(true);
      expect(res.body.data.map((r) => r.status)).toContain("warning");
      const errors = await asOps()(request(app).get(`/api/v1/imports/${batch.import_batch_id}/rows?status=error`));
      expect(errors.body.data.every((r) => r.status === "error")).toBe(true);
    });

    test("no sheet in the build means nothing happens at all", async () => {
      const result = await loader.loadStaff({ db: pool, sheet: path.join(temp, "missing.xlsx") });
      expect(result.status).toBe("no_sheet");
    });
  });
});

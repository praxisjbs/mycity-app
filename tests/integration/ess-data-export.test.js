"use strict";
/**
 * Download My Data end to end (docs/guides/ess.md §3 step 8, §5, §6, §7): the real migrations on a
 * throwaway database, the whole app through HTTP, the worker's handler through the outbox, the
 * file the screen waits on and downloads, and the workbook itself opened and read.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ess-data-export
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const ExcelJS = require("exceljs");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const storage = require("../../src/services/storage/storage.service");

// The queues would hold Redis connections open past the run: the jobs a handler queues are kept here.
const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Data-Copy9Test";

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

/** A stored workbook, opened: each sheet's name and its rows as arrays of cell text. */
async function open(documentId) {
  const doc = (await q("SELECT storage_key FROM document WHERE document_id = $1", [documentId])).rows[0];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await storage.get(doc.storage_key));
  const sheets = {};
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v instanceof Date ? v.toISOString() : String(v ?? "")))));
    sheets[ws.name] = rows;
  });
  return sheets;
}

describeDb("Download My Data against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const make = (key, first, last, role, job, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${key}@mycity.test`,
              phone: "08031234567",
              job_title: job,
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "hybrid",
            },
            role_code: role,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Amaka", "Eze", "management", "Chief Executive Officer", true);
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    const staff = people.staff.employee.employee_id;
    await q(
      `UPDATE employee SET line_manager_id = $1, bank_name = 'Zenith', account_number = '0123456789',
              next_of_kin_name = 'Aisha Danjuma', next_of_kin_relationship = 'Sister'
        WHERE employee_id = $2`,
      [people.manager.employee.employee_id, staff],
    );
    // A day with a punch that carries coordinates: they must never reach the file.
    await q("INSERT INTO attendance_day (employee_id, attendance_date, status, first_clock_in_at) VALUES ($1, '2026-10-05', 'present', '2026-10-05T08:02:00Z')", [staff]);
    await q(
      `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, latitude, longitude, source, validation_state)
       VALUES ($1, 'clock_in', '2026-10-05T08:02:00Z', '2026-10-05', 6.512345, 3.398765, 'pwa', 'accepted')`,
      [staff],
    );
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();
    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.63.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out is a 401", async () => {
    expect((await request(app).post("/api/v1/ess/profile/export").send({})).status).toBe(401);
  });

  test("my own copy: reserved at once and audited, made after commit into the file I download, never emailed", async () => {
    const res = await as("staff").post("/ess/profile/export");
    expect(res.status).toBe(202);
    const file = c.documents.ExportFile.parse(res.body);
    expect(file).toMatchObject({ status: "pending", file_name: expect.stringMatching(/^my-data-.+\.xlsx$/) });

    const audit = await q(
      "SELECT actor_user_id, entity_type, entity_id FROM audit_ledger WHERE action = 'employee.data_export_requested'",
    );
    expect(audit.rows).toEqual([
      { actor_user_id: people.staff.user.user_id, entity_type: "employee", entity_id: people.staff.employee.employee_id },
    ]);

    // The screen waits on it: pending until the worker has made it, and nothing to download yet.
    expect((await as("staff").get(`/exports/${file.document_id}`)).body.status).toBe("pending");
    expect((await as("staff").get(`/documents/${file.document_id}/content`)).status).toBe(409);

    await drain();
    const docs = await q("SELECT document_id, sensitivity, entity_type, subject_employee_id, render_status FROM document WHERE doc_type = 'data_export'");
    expect(docs.rows).toEqual([
      {
        document_id: file.document_id,
        sensitivity: "restricted",
        entity_type: "data_export",
        subject_employee_id: people.staff.employee.employee_id,
        render_status: "done",
      },
    ]);
    const done = await as("staff").get(`/exports/${file.document_id}`);
    expect(c.documents.ExportFile.parse(done.body)).toEqual({ ...file, status: "done" });
    expect(sent.filter((m) => m.queue === "email-send")).toEqual([]);
    const failed = await q("SELECT count(*)::int AS n FROM event_outbox WHERE event_key = 'employee.data_export_requested' AND status <> 'done'");
    expect(failed.rows[0].n).toBe(0);

    // Only the person who asked waits on it; the person and the CEO may open it, nobody else.
    expect((await as("ceo").get(`/exports/${file.document_id}`)).status).toBe(404);
    const content = (who) => as(who).get(`/documents/${file.document_id}/content`);
    expect((await content("staff")).status).toBe(200);
    expect((await content("ceo")).status).toBe(200);
    expect((await content("manager")).status).toBe(404);
    expect((await content("ops")).status).toBe(404);
  });

  test("the workbook: a cover, a sheet per area, and nothing restricted in it", async () => {
    const doc = (await q("SELECT document_id FROM document WHERE doc_type = 'data_export' ORDER BY created_at LIMIT 1")).rows[0];
    const sheets = await open(doc.document_id);
    expect(Object.keys(sheets)).toEqual([
      "Cover",
      "Profile",
      "Next of Kin",
      "Bank",
      "Record History",
      "Leave Requests",
      "Leave Balances",
      "Attendance Days",
      "Punches",
      "Documents",
      "Sign-Ins",
    ]);
    const cover = sheets.Cover.map((r) => r.join(" ")).join("\n");
    expect(cover).toContain("Download My Data");
    expect(cover).toContain("Musa Danjuma");
    expect(cover).toContain("Nigeria Data Protection Act");
    for (const name of ["Profile", "Leave Requests", "Punches", "Sign-Ins"]) expect(cover).toContain(name);

    const value = (sheet, field) => (sheets[sheet].find((r) => r[0] === field) || [])[1];
    expect(value("Profile", "Job Title")).toBe("Field Officer");
    expect(value("Next of Kin", "Name")).toBe("Aisha Danjuma");
    expect(value("Bank", "Account Ending")).toBe("6789");
    expect(sheets.Punches).toHaveLength(2);
    expect(sheets.Punches[1][1]).toBe("Clock In");
    expect(sheets["Sign-Ins"].length).toBeGreaterThan(1);

    const everything = JSON.stringify(sheets);
    expect(everything).not.toContain("0123456789");
    expect(everything).not.toContain("6.512345");
    expect(everything).not.toContain("3.398765");
    expect(everything).not.toMatch(/Latitude|Longitude/);
  });

  test("once a day: pressing again hands back the same file, and the CEO is refused that day", async () => {
    const first = (await q("SELECT document_id FROM document WHERE doc_type = 'data_export'")).rows[0];
    const again = await as("staff").post("/ess/profile/export");
    expect(again.status).toBe(202);
    expect(c.documents.ExportFile.parse(again.body)).toMatchObject({ document_id: first.document_id, status: "done" });
    expect((await q("SELECT count(*)::int AS n FROM document WHERE doc_type = 'data_export'")).rows[0].n).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'employee.data_export_requested'")).rows[0].n).toBe(1);

    const ceo = await as("ceo").post(`/employees/${people.staff.employee.employee_id}/data-export`);
    expect(ceo.status).toBe(429);
    expect(ceo.body.error.code).toBe("DATA_EXPORT_LIMIT");
    expect(ceo.body.error.message).toMatch(/today/);
  });

  test("Download Their Data is the CEO's alone, downloaded by the CEO and audited with who asked", async () => {
    const manager = people.manager.employee.employee_id;
    expect((await as("ops").post(`/employees/${manager}/data-export`)).status).toBe(403);
    expect((await as("manager").post(`/employees/${people.staff.employee.employee_id}/data-export`)).status).toBe(403);
    expect((await as("staff").post(`/employees/${manager}/data-export`)).status).toBe(403);

    const res = await as("ceo").post(`/employees/${manager}/data-export`);
    expect(res.status).toBe(202);
    const file = c.documents.ExportFile.parse(res.body);
    expect(file.status).toBe("pending");
    const audit = await q(
      "SELECT actor_user_id FROM audit_ledger WHERE action = 'employee.data_export_requested' AND entity_id = $1",
      [manager],
    );
    expect(audit.rows).toEqual([{ actor_user_id: people.ceo.user.user_id }]);

    await drain();
    expect((await as("ceo").get(`/exports/${file.document_id}`)).body.status).toBe("done");
    expect(sent.filter((m) => m.queue === "email-send")).toEqual([]);
    const sheets = await open(file.document_id);
    const cover = sheets.Cover.map((r) => r.join(" ")).join("\n");
    expect(cover).toContain("Kemi Alade");
    expect(cover).toContain("Amaka Eze");
    // The person it is about may open it too.
    expect((await as("manager").get(`/documents/${file.document_id}/content`)).status).toBe(200);

    // The manager's own request that day is the one a day already used.
    expect((await as("manager").post("/ess/profile/export")).status).toBe(429);
    expect((await as("ceo").post("/employees/00000000-0000-4000-8000-000000000000/data-export")).status).toBe(404);
  });

  test("one its asker may no longer have fails, and a failed file does not use the day up", async () => {
    const grantsCache = require("../../src/shared/rbac/grants-cache");
    const setStatus = async (status) => {
      await q("UPDATE app_user SET status = $2 WHERE user_id = $1", [people.ops.user.user_id, status]);
      await grantsCache.invalidateUser(people.ops.user.user_id);
    };
    const res = await as("ops").post("/ess/profile/export");
    expect(res.status).toBe(202);
    const first = c.documents.ExportFile.parse(res.body);
    // Suspended before the worker reached it: nothing is made, and the screen waiting is told.
    await setStatus("suspended");
    await drain();
    await setStatus("active");
    expect((await as("ops").get(`/exports/${first.document_id}`)).body.status).toBe("failed");
    expect((await as("ops").get(`/documents/${first.document_id}/content`)).status).toBe(410);

    const again = await as("ops").post("/ess/profile/export");
    expect(again.status).toBe(202);
    const second = c.documents.ExportFile.parse(again.body);
    expect(second.document_id).not.toBe(first.document_id);
    await drain();
    expect((await as("ops").get(`/exports/${second.document_id}`)).body.status).toBe("done");
  });

  test("a day later the export cleanup removes the file from the vault", async () => {
    const exportFiles = require("../../src/shared/documents/exports");
    const before = await q("SELECT document_id, storage_key FROM document WHERE doc_type = 'data_export' ORDER BY created_at");
    expect(before.rows).toHaveLength(4);
    expect(await exportFiles.purgeExpired(new Date())).toEqual({ removed: 0 });

    await q("UPDATE document SET created_at = now() - interval '25 hours' WHERE document_id = $1", [before.rows[0].document_id]);
    expect(await exportFiles.purgeExpired(new Date())).toEqual({ removed: 1 });
    const after = await q("SELECT document_id FROM document WHERE doc_type = 'data_export' ORDER BY created_at");
    expect(after.rows.map((r) => r.document_id)).toEqual(before.rows.slice(1).map((r) => r.document_id));
    expect(await storage.exists(before.rows[0].storage_key)).toBe(false);
    const removed = await q("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'document.removed' AND entity_id = $1", [
      before.rows[0].document_id,
    ]);
    expect(removed.rows[0].n).toBe(1);
    // Gone from the vault, it is gone from the screen that waited on it too.
    expect((await as("staff").get(`/exports/${before.rows[0].document_id}`)).status).toBe(404);
  });
});

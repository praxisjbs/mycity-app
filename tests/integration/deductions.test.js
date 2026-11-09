"use strict";
/**
 * M6 PR 3, Payroll · Deductions end to end (docs/guides/payroll.md §3.3, §3.4, §5, §6.6, Appendix A), on the
 * real migrations, over HTTP with every response parsed by its contract (APP_ENV=test), through the real
 * outbox, the real approval engine and the real payroll run:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/deductions
 *
 * The tab is one page of three kinds of money (waiting attendance deductions, fines, advances); Accept This
 * Month and Spread Over Months write a deduction with one instalment a month, the kobo that do not divide
 * going to the first; Waive, Release, Record Advance and Cancel Advance move them; never their own; nothing is
 * taken back once a month of it is in a run. An advance is carried through two approved runs and settled.
 * Every person is invented.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const { emit } = require("../../src/shared/events/emit");
const realtime = require("../../src/services/realtime/emitter");
const { EVENTS: SANCTION_EVENTS } = require("../../src/modules/sanctions/sanctions.events");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Ded-Uct9Test";
const d = c.deductions;
const SEP = "2026-09-01";
const OCT = "2026-10-01";
const NOV = "2026-11-01";

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

describeDb("Payroll · Deductions against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  const fines = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const employeeId = (who) => ids[who] || people[who].employee.employee_id;

  async function hire(key, { gross = null } = {}) {
    const dept = (await one("SELECT department_id FROM department ORDER BY name LIMIT 1")).department_id;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, gross_monthly, bank_name, account_number)
       VALUES ($1, $2, 'Tester', $3, 'Officer', $4, 'full_time', 'on_site', 'active', '2026-01-05', $5, 'Test Bank', '0123456789') RETURNING employee_id`,
      [`D${String(Object.keys(ids).length + 1).padStart(4, "0")}`, key[0].toUpperCase() + key.slice(1), `${key}@mycity.test`, dept, gross],
    );
    ids[key] = row.employee_id;
  }

  const item = (who, date, kind, amount, { status = "pending", minutes = 30, method = "pro_rata" } = {}) =>
    q(`INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      employeeId(who),
      date,
      kind,
      minutes,
      method,
      amount,
      status,
    ]);

  /** A query, an issued sanction and its fine, for a person; the fine in `status`. */
  async function fineFor(who, amount, { status = "pending", reason = "Damaged the studio monitor" } = {}) {
    const n = (await one("SELECT count(*)::int AS n FROM employee_query")).n + 1;
    const number = `QRY-${String(n).padStart(4, "0")}`;
    const query = await one(`INSERT INTO employee_query (number, employee_id, subject, details) VALUES ($1, $2, 'Subject', 'Details') RETURNING employee_query_id`, [
      number,
      employeeId(who),
    ]);
    const sanction = await one(
      `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, status, number)
       VALUES ($1, $2, 'fine', $3, $4, '2026-09-10', 'issued', $5) RETURNING sanction_id`,
      [query.employee_query_id, employeeId(who), reason, people.ops.user.user_id, `SAN-D-${n}`],
    );
    const fine = await one(`INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, $2, $3) RETURNING sanction_fine_id`, [
      sanction.sanction_id,
      amount,
      status,
    ]);
    return { fine: fine.sanction_fine_id, sanction: sanction.sanction_id, number };
  }

  const list = async (who, query = "") => d.DeductionPage.parse((await as(who).get(`/deductions${query}`)).body);
  const rowOf = async (source, sourceId, who = "ops") => {
    for (let page = 1; page < 20; page += 1) {
      const res = await list(who, `?page=${page}`);
      const row = res.data.find((r) => r.source === source && r.source_id === sourceId);
      if (row) return row;
      if (!res.page.has_next) return null;
    }
    return null;
  };
  const instalments = async (deductionId) =>
    (
      await q(`SELECT period::text AS period, amount::text AS amount, status FROM payroll_deduction_instalment WHERE payroll_deduction_id = $1 ORDER BY period`, [
        deductionId,
      ])
    ).rows;
  const deductionOf = (fineId) => one(`SELECT payroll_deduction_id, status FROM payroll_deduction WHERE sanction_fine_id = $1 ORDER BY created_at DESC LIMIT 1`, [fineId]);
  const fineStatus = async (fineId) => (await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [fineId])).settlement_status;
  const notices = (who, title) =>
    q(`SELECT title, body FROM notification WHERE user_id = $1 AND title = $2 ORDER BY created_at`, [people[who].user.user_id, title]).then((r) => r.rows);

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const make = (who, first, last, role, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@mycity.test`,
              phone: "08031234567",
              job_title: "Officer",
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people");
    await make("ceo", "Amaka", "Eze", "management", true);
    await make("staff", "Musa", "Danjuma", "employee");
    for (const [who, gross] of [["ops", "250000.00"], ["ceo", "500000.00"], ["staff", "200000.00"]])
      await q("UPDATE employee SET gross_monthly = $2, bank_name = 'Test Bank', account_number = '0000111122' WHERE employee_id = $1", [employeeId(who), gross]);

    await q("DELETE FROM working_week");
    for (let weekday = 1; weekday <= 7; weekday += 1)
      await q("INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)", [weekday, weekday <= 6, weekday <= 6 ? "09:00" : null, weekday <= 6 ? "17:00" : null]);
    workingWeek.invalidateCalendar();

    await hire("ada", { gross: "450000.00" });
    await hire("bola", { gross: "300000.00" });
    await hire("chidi", {});
    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of ["ops", "ceo", "staff"]) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.75.0.${ip}`).send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }

    await item("ada", "2026-09-02", "late", "1500.00");
    await item("ada", "2026-09-03", "absence", "17307.69", { minutes: 480, method: "daily_rate" });
    await item("chidi", "2026-09-04", "late", null);
    await item("ada", "2026-09-05", "overtime", "8000.00", { status: "confirmed", method: "multiplier" });
    fines.ada = await fineFor("ada", "45000.00");
    fines.bola = await fineFor("bola", "10000.00");
    fines.waiveMe = await fineFor("bola", "5000.00", { reason: "Late with a delivery" });
    fines.waived = await fineFor("chidi", "2000.00", { status: "waived", reason: "Waived in review" });
    fines.ops = await fineFor("ops", "3000.00");
    fines.tiny = await fineFor("ada", "0.05");
  }, 180_000);

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * What the tab shows
   * ---------------------------------------------------------------- */

  test("the tab is one page of waiting attendance deductions, fines and advances, pending first, each with what the reader may press", async () => {
    const res = await as("ops").get("/deductions");
    expect(res.status).toBe(200);
    const page = d.DeductionPage.parse(res.body);
    // Two priced attendance items and one with no salary to price it; overtime is never a deduction; six fines (one waived).
    expect(page.page).toMatchObject({ number: 1, size: 25, total: 9, pages: 1, has_next: false });
    expect(page.data.filter((r) => r.source === "attendance")).toHaveLength(3);
    expect(page.data.filter((r) => r.source === "fine")).toHaveLength(6);
    // Pending first.
    const statuses = page.data.map((r) => r.status);
    expect(statuses.slice(0, 8).every((s) => s === "pending")).toBe(true);
    expect(statuses[8]).toBe("waived");

    const ada = page.data.find((r) => r.source === "fine" && r.source_id === fines.ada.fine);
    expect(ada).toMatchObject({
      sanction_fine_id: fines.ada.fine,
      payroll_deduction_id: null,
      reason: "Damaged the studio monitor",
      pay_amount: "45000.00",
      salary_set: true,
      period: SEP,
      instalments: null,
      instalments_applied: null,
      status: "pending",
      query_number: fines.ada.number,
      can_accept: true,
      can_waive: true,
      can_release: false,
      can_cancel: false,
    });
    expect(ada.employee).toMatchObject({ employee_id: employeeId("ada"), display_name: "Ada Tester" });

    // An attendance row is listed and offers nothing: People waive it on People · Attendance.
    const late = page.data.find((r) => r.source === "attendance" && r.pay_amount === "1500.00");
    expect(late).toMatchObject({ reason: "Late arrival, 02/09/2026", period: SEP, status: "pending", payroll_deduction_id: null, sanction_fine_id: null });
    expect([late.can_accept, late.can_waive, late.can_release, late.can_cancel]).toEqual([false, false, false, false]);
    const noPay = page.data.find((r) => r.source === "attendance" && r.employee.employee_id === employeeId("chidi"));
    expect(noPay).toMatchObject({ pay_amount: null, salary_set: false });

    // Never their own: a fine about the reader is theirs to be accepted by someone else.
    const own = page.data.find((r) => r.source_id === fines.ops.fine);
    expect([own.can_accept, own.can_waive]).toEqual([false, false]);

    // A reader without `payroll` reads nothing.
    expect((await as("staff").get("/deductions")).status).toBe(403);
    expect((await as("staff").get("/deductions/summary")).status).toBe(403);
  });

  test("filters, search and sorts run in SQL and the page size is not the caller's to choose", async () => {
    expect((await list("ops", "?source=fine")).page.total).toBe(6);
    expect((await list("ops", "?source=attendance&status=pending")).page.total).toBe(3);
    expect((await list("ops", "?status=waived")).data.map((r) => r.source_id)).toEqual([fines.waived.fine]);
    expect((await list("ops", `?employee_id=${employeeId("bola")}`)).page.total).toBe(2);
    expect((await list("ops", "?month=2026-09")).page.total).toBe(9);
    expect((await list("ops", "?month=2026-10")).page.total).toBe(0);
    expect((await list("ops", "?q=studio monitor")).page.total).toBe(4);
    expect((await list("ops", `?q=${fines.bola.number}`)).data.map((r) => r.source_id)).toEqual([fines.bola.fine]);
    expect((await list("ops", "?q=ada")).page.total).toBe(4);

    const byAmount = (await list("ops", "?sort=-amount")).data.map((r) => r.pay_amount);
    expect(byAmount.slice(0, 3)).toEqual(["45000.00", "17307.69", "10000.00"]);
    const byName = (await list("ops", "?sort=employee&source=fine")).data.map((r) => r.employee.display_name);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));

    for (const bad of ["?limit=100", "?page_size=5", "?sort=salary", "?status=cancelled", "?month=2026-13", "?source=loan"])
      expect([bad, (await as("ops").get(`/deductions${bad}`)).status]).toEqual([bad, 422]);
  });

  test("a second page holds what the first does not, with the true total", async () => {
    for (let day = 1; day <= 28; day += 1) await item("bola", `2026-08-${String(day).padStart(2, "0")}`, "late", "100.00");
    const first = await list("ops");
    expect(first.page).toMatchObject({ number: 1, size: 25, total: 37, pages: 2, has_next: true });
    expect(first.data).toHaveLength(25);
    const second = await list("ops", "?page=2");
    expect(second.page).toMatchObject({ number: 2, total: 37, has_next: false });
    expect(second.data).toHaveLength(12);
    const seen = new Set([...first.data, ...second.data].map((r) => `${r.source}:${r.source_id}`));
    expect(seen.size).toBe(37);
    await q("DELETE FROM attendance_pay_item WHERE work_date BETWEEN '2026-08-01' AND '2026-08-28'");
  });

  test("the figures above the tab, and the month a fine goes into unless a later one is picked", async () => {
    const s = d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body);
    expect(s.pending_fines).toEqual({ count: 5, pay_amount: "63000.05" });
    expect(s.pending_attendance).toEqual({ count: 3, pay_amount: "18807.69" });
    expect(s.active).toEqual({ count: 0, pay_amount: "0.00" });
    expect(s.recovered_this_year).toEqual({ count: 0, pay_amount: "0.00" });
    // No run yet: the current Lagos month.
    expect(s.open_period).toBe(lagos.monthBounds(lagos.today()).first);
  });

  /* ---------------------------------------------------------------- *
   * Accept, spread and waive
   * ---------------------------------------------------------------- */

  let septemberRun;

  test("the open month is the month of the newest run still a Draft", async () => {
    const res = await as("ops").post("/payroll/runs", { period: SEP });
    expect(res.status).toBe(201);
    septemberRun = res.body.payroll_run_id;
    expect(d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body).open_period).toBe(SEP);
  });

  test("Accept This Month is one instalment of the whole fine in the open month, and the fine is accepted through its owner", async () => {
    const res = await as("ops").post(`/deductions/fines/${fines.ada.fine}/accept`, { months: 1, start_period: SEP });
    expect(res.status).toBe(200);
    const row = d.DeductionRow.parse(res.body);
    expect(row).toMatchObject({
      source: "fine",
      source_id: fines.ada.fine,
      sanction_fine_id: fines.ada.fine,
      pay_amount: "45000.00",
      status: "active",
      instalments: 1,
      instalments_applied: 0,
      period: SEP,
      reason: "Damaged the studio monitor",
      query_number: fines.ada.number,
      can_accept: false,
      can_waive: false,
      can_release: true,
      can_cancel: false,
    });
    expect(row.payroll_deduction_id).not.toBeNull();
    expect(await fineStatus(fines.ada.fine)).toBe("accepted");
    expect(await instalments(row.payroll_deduction_id)).toEqual([{ period: SEP, amount: "45000.00", status: "scheduled" }]);
    expect(await one("SELECT created_by FROM payroll_deduction WHERE payroll_deduction_id = $1", [row.payroll_deduction_id])).toEqual({ created_by: people.ops.user.user_id });
    ids.adaDeduction = row.payroll_deduction_id;
    // Once accepted it is no longer pending on the tab: the same fine is now one row, an active one.
    const rows = (await list("ops", "?source=fine")).data.filter((r) => r.sanction_fine_id === fines.ada.fine);
    expect(rows).toHaveLength(1);
    // A second press is the fine's own refusal.
    const again = await as("ops").post(`/deductions/fines/${fines.ada.fine}/accept`, { months: 1, start_period: SEP });
    expect([again.status, again.body.error.code]).toEqual([409, "FINE_NOT_MOVABLE"]);
  });

  test("Spread Over Months shares the fine equally, the kobo that do not divide going to the first, and they sum exactly", async () => {
    const res = await as("ops").post(`/deductions/fines/${fines.bola.fine}/accept`, { months: 3, start_period: SEP });
    expect(res.status).toBe(200);
    const row = d.DeductionRow.parse(res.body);
    expect(row).toMatchObject({ status: "active", instalments: 3, instalments_applied: 0, pay_amount: "10000.00", period: SEP });
    expect((await instalments(row.payroll_deduction_id)).map((i) => [i.period, i.amount])).toEqual([
      [SEP, "3333.34"],
      [OCT, "3333.33"],
      [NOV, "3333.33"],
    ]);
    ids.bolaDeduction = row.payroll_deduction_id;
  });

  test("a fine too small to give every month a kobo is refused on the months field, and nothing is written", async () => {
    const res = await as("ops").post(`/deductions/fines/${fines.tiny.fine}/accept`, { months: 12, start_period: SEP });
    expect([res.status, res.body.error.code]).toEqual([422, "TOO_MANY_MONTHS"]);
    expect(res.body.error.fields).toEqual({ months: ["Fewer months"] });
    expect(await fineStatus(fines.tiny.fine)).toBe("pending");
    expect(await deductionOf(fines.tiny.fine)).toBeUndefined();
    // Five kobo over five months is five instalments of one.
    const ok = await as("ops").post(`/deductions/fines/${fines.tiny.fine}/accept`, { months: 5, start_period: SEP });
    expect(ok.status).toBe(200);
    expect((await instalments((await deductionOf(fines.tiny.fine)).payroll_deduction_id)).map((i) => i.amount)).toEqual(["0.01", "0.01", "0.01", "0.01", "0.01"]);
  });

  test("the start month is the open month or a later one, and never one that already has a run sent for approval", async () => {
    const early = await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/accept`, { months: 1, start_period: "2026-08-01" });
    expect([early.status, early.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
    expect(early.body.error.fields).toEqual({ start_period: ["Pick a later month"] });
    const notFirst = await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/accept`, { months: 1, start_period: "2026-09-15" });
    expect(notFirst.status).toBe(422);
    for (const bad of [{ months: 0, start_period: SEP }, { months: 13, start_period: SEP }, { months: 1.5, start_period: SEP }, { months: 1 }, { start_period: SEP }])
      expect([JSON.stringify(bad), (await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/accept`, bad)).status]).toEqual([JSON.stringify(bad), 422]);
    expect(await fineStatus(fines.waiveMe.fine)).toBe("pending");
  });

  test("Waive needs a reason and nothing is deducted; the person is told", async () => {
    const short = await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/waive`, { reason: "No" });
    expect(short.status).toBe(422);
    expect(await fineStatus(fines.waiveMe.fine)).toBe("pending");
    const res = await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/waive`, { reason: "The delivery was the driver's fault" });
    expect(res.status).toBe(200);
    expect(d.DeductionRow.parse(res.body)).toMatchObject({ status: "waived", source_id: fines.waiveMe.fine, can_accept: false, can_waive: false, payroll_deduction_id: null });
    expect(await fineStatus(fines.waiveMe.fine)).toBe("waived");
    expect(await deductionOf(fines.waiveMe.fine)).toBeUndefined();
    const again = await as("ops").post(`/deductions/fines/${fines.waiveMe.fine}/waive`, { reason: "The delivery was the driver's fault" });
    expect([again.status, again.body.error.code]).toEqual([409, "FINE_NOT_MOVABLE"]);
  });

  test("never their own: nobody accepts, waives, releases, records or cancels a deduction for themselves", async () => {
    for (const [path, body] of [
      [`/deductions/fines/${fines.ops.fine}/accept`, { months: 1, start_period: SEP }],
      [`/deductions/fines/${fines.ops.fine}/waive`, { reason: "Waive my own fine please" }],
      ["/deductions/advances", { employee_id: employeeId("ops"), amount: "10000.00", granted_on: "2026-09-01", months: 1, start_period: SEP, reason: "An advance for me" }],
    ]) {
      const res = await as("ops").post(path, body);
      expect([path, res.status, res.body.error.code]).toEqual([path, 403, "OWN_RECORD"]);
    }
    expect(await fineStatus(fines.ops.fine)).toBe("pending");
    // The same fine is another holder's to settle: the CEO may (they hold every grant).
    const res = await as("ceo").post(`/deductions/fines/${fines.ops.fine}/waive`, { reason: "Waived by someone else" });
    expect(res.status).toBe(200);
    // A reader without the grant cannot press anything.
    for (const path of [`/deductions/fines/${fines.ada.fine}/accept`, `/deductions/${ids.adaDeduction}/release`, "/deductions/advances", `/deductions/${ids.adaDeduction}/cancel`])
      expect([path, (await as("staff").post(path, {})).status]).toEqual([path, 403]);
  });

  test("a fine or a deduction that does not exist is a 404, and a path that is no id is refused", async () => {
    const nobody = "00000000-0000-4000-8000-0000000000aa";
    expect((await as("ops").post(`/deductions/fines/${nobody}/accept`, { months: 1, start_period: SEP })).status).toBe(404);
    expect((await as("ops").post(`/deductions/fines/${nobody}/waive`, { reason: "A reason that is long" })).status).toBe(404);
    expect((await as("ops").post(`/deductions/${nobody}/release`, { reason: "A reason that is long" })).status).toBe(404);
    expect((await as("ops").post(`/deductions/${nobody}/cancel`, { reason: "A reason that is long" })).status).toBe(404);
    expect((await as("ops").post("/deductions/fines/not-an-id/accept", { months: 1, start_period: SEP })).status).toBe(422);
  });

  /* ---------------------------------------------------------------- *
   * Release
   * ---------------------------------------------------------------- */

  test("Release sends an accepted fine back to waiting while every month is still scheduled, and it can be accepted again", async () => {
    const res = await as("ops").post(`/deductions/${ids.bolaDeduction}/release`, { reason: "Accepted for the wrong person" });
    expect(res.status).toBe(200);
    expect(d.DeductionRow.parse(res.body)).toMatchObject({ source: "fine", source_id: fines.bola.fine, status: "pending", payroll_deduction_id: null, can_accept: true });
    expect(await fineStatus(fines.bola.fine)).toBe("pending");
    expect(await one("SELECT status, cancel_reason FROM payroll_deduction WHERE payroll_deduction_id = $1", [ids.bolaDeduction])).toEqual({
      status: "cancelled",
      cancel_reason: "Accepted for the wrong person",
    });
    expect((await instalments(ids.bolaDeduction)).every((i) => i.status === "cancelled")).toBe(true);

    // A new acceptance is a new deduction: the old one stays cancelled, the live one is unique.
    const again = await as("ops").post(`/deductions/fines/${fines.bola.fine}/accept`, { months: 2, start_period: SEP });
    expect(again.status).toBe(200);
    const row = d.DeductionRow.parse(again.body);
    expect(row).toMatchObject({ status: "active", instalments: 2 });
    expect((await instalments(row.payroll_deduction_id)).map((i) => [i.period, i.amount])).toEqual([[SEP, "5000.00"], [OCT, "5000.00"]]);
    expect((await q("SELECT 1 FROM payroll_deduction WHERE sanction_fine_id = $1", [fines.bola.fine])).rows).toHaveLength(2);
    ids.bolaDeduction = row.payroll_deduction_id;

    const second = await as("ops").post(`/deductions/${ids.bolaDeduction}/release`, { reason: "Accepted again by mistake" });
    expect(second.status).toBe(200);
    // Released twice is nothing to release.
    const third = await as("ops").post(`/deductions/${ids.bolaDeduction}/release`, { reason: "Accepted again by mistake" });
    expect([third.status, third.body.error.code]).toEqual([409, "FINE_NOT_MOVABLE"]);
    const final = await as("ops").post(`/deductions/fines/${fines.bola.fine}/accept`, { months: 2, start_period: SEP });
    expect(final.status).toBe(200);
    ids.bolaDeduction = final.body.payroll_deduction_id;
  });

  test("an advance is released by nobody and a fine is cancelled by nobody: each has its own undoing", async () => {
    const advance = await as("ops").post("/deductions/advances", {
      employee_id: employeeId("staff"),
      amount: "20000.00",
      granted_on: "2026-09-01",
      months: 2,
      start_period: SEP,
      reason: "Recorded for the wrong person",
    });
    expect(advance.status).toBe(201);
    const wrong = d.DeductionRow.parse(advance.body);
    const release = await as("ops").post(`/deductions/${wrong.payroll_deduction_id}/release`, { reason: "It is an advance" });
    expect([release.status, release.body.error.code]).toEqual([422, "NOT_A_FINE"]);
    const cancel = await as("ops").post(`/deductions/${ids.adaDeduction}/cancel`, { reason: "It is a fine" });
    expect([cancel.status, cancel.body.error.code]).toEqual([422, "NOT_AN_ADVANCE"]);

    const done = await as("ops").post(`/deductions/${wrong.payroll_deduction_id}/cancel`, { reason: "Recorded for the wrong person" });
    expect(done.status).toBe(200);
    expect(await one("SELECT status FROM payroll_deduction WHERE payroll_deduction_id = $1", [wrong.payroll_deduction_id])).toEqual({ status: "cancelled" });
    expect((await instalments(wrong.payroll_deduction_id)).every((i) => i.status === "cancelled")).toBe(true);
    expect(await rowOf("advance", wrong.payroll_deduction_id)).toBeNull();
    const twice = await as("ops").post(`/deductions/${wrong.payroll_deduction_id}/cancel`, { reason: "Recorded for the wrong person" });
    expect([twice.status, twice.body.error.code]).toEqual([409, "NOT_ACTIVE"]);
  });

  /* ---------------------------------------------------------------- *
   * Record Advance
   * ---------------------------------------------------------------- */

  test("Record Advance is a deduction recovered in equal instalments from the month picked", async () => {
    const res = await as("ops").post("/deductions/advances", {
      employee_id: employeeId("bola"),
      amount: "75000.00",
      granted_on: "2026-09-04",
      months: 2,
      start_period: SEP,
      reason: "Paid ahead of the school fees",
    });
    expect(res.status).toBe(201);
    const row = d.DeductionRow.parse(res.body);
    expect(row).toMatchObject({
      source: "advance",
      source_id: row.payroll_deduction_id,
      sanction_fine_id: null,
      pay_amount: "75000.00",
      status: "active",
      instalments: 2,
      instalments_applied: 0,
      period: SEP,
      reason: "Paid ahead of the school fees",
      query_number: null,
      can_cancel: true,
      can_release: false,
      can_accept: false,
    });
    expect((await instalments(row.payroll_deduction_id)).map((i) => [i.period, i.amount])).toEqual([[SEP, "37500.00"], [OCT, "37500.00"]]);
    expect(await one("SELECT granted_on::text AS granted_on, source FROM payroll_deduction WHERE payroll_deduction_id = $1", [row.payroll_deduction_id])).toEqual({
      granted_on: "2026-09-04",
      source: "salary_advance",
    });
    ids.advance = row.payroll_deduction_id;
  });

  test("an advance is refused for no one, a day still to come, a month already past, or a person who is not there", async () => {
    const base = { employee_id: employeeId("bola"), amount: "10000.00", granted_on: "2026-09-04", months: 2, start_period: SEP, reason: "Paid ahead of the month" };
    const nobody = await as("ops").post("/deductions/advances", { ...base, employee_id: "00000000-0000-4000-8000-0000000000aa" });
    expect([nobody.status, nobody.body.error.code]).toEqual([404, "NOT_FOUND"]);
    const future = await as("ops").post("/deductions/advances", { ...base, granted_on: lagos.addDays(lagos.today(), 3) });
    expect([future.status, future.body.error.code]).toEqual([422, "GRANTED_IN_THE_FUTURE"]);
    expect(future.body.error.fields).toEqual({ granted_on: ["Not in the future"] });
    const past = await as("ops").post("/deductions/advances", { ...base, start_period: "2026-07-01" });
    expect([past.status, past.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
    for (const bad of [{ amount: "0.00" }, { amount: "-5.00" }, { months: 13 }, { reason: "short" }, { start_period: "2026-09-10" }])
      expect([JSON.stringify(bad), (await as("ops").post("/deductions/advances", { ...base, ...bad })).status]).toEqual([JSON.stringify(bad), 422]);
    expect((await q("SELECT 1 FROM payroll_deduction WHERE source = 'salary_advance' AND status = 'active'")).rows).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- *
   * The notices
   * ---------------------------------------------------------------- */

  test("the events carry ids, months and counts, and never an amount", async () => {
    await drain();
    const accepted = await q(`SELECT payload FROM event_log WHERE event_key = 'payroll_deduction.accepted' ORDER BY occurred_at`);
    expect(accepted.rows.length).toBeGreaterThanOrEqual(4);
    for (const { payload } of accepted.rows) {
      expect(Object.keys(payload).some((k) => /amount/.test(k))).toBe(false);
      expect(payload).toEqual(expect.objectContaining({ payroll_deduction_id: expect.any(String), instalments: expect.any(Number) }));
    }
    const waived = await q(`SELECT payload FROM event_log WHERE event_key = 'payroll_deduction.waived'`);
    expect(waived.rows.length).toBe(2);
    for (const { payload } of waived.rows) expect(Object.keys(payload).some((k) => /amount/.test(k))).toBe(false);
  });

  test("a sanction issued with a fine tells the holders of payroll edit once, by person and query, and the person it is about is not told by this", async () => {
    const who = await fineFor("ada", "7000.00", { status: "pending" });
    const payload = { sanction_id: who.sanction, employee_id: employeeId("ada"), subject_employee_id: employeeId("ada"), query_number: who.number, fine_amount: "7000.00" };
    const issue = () =>
      tx((client) => emit(client, { key: SANCTION_EVENTS.SANCTION_ISSUED, entity: { type: "sanction", id: who.sanction }, actor: null, payload }));
    await issue();
    await drain();
    const told = await notices("ops", "Fine Waiting for Payroll");
    expect(told).toEqual([{ title: "Fine Waiting for Payroll", body: `Ada Tester, ${who.number}` }]);
    expect(told[0].body).not.toMatch(/7,?000/);
    // The CEO is not added to every audience, and the person is not told of what payroll will decide.
    expect(await notices("ceo", "Fine Waiting for Payroll")).toHaveLength(0);
    expect(await notices("staff", "Fine Waiting for Payroll")).toHaveLength(0);

    // The same sanction delivered again tells no one twice.
    await issue();
    await drain();
    expect(await notices("ops", "Fine Waiting for Payroll")).toHaveLength(1);
    expect((await q("SELECT 1 FROM event_outbox o JOIN event_log l ON l.event_id = o.event_id WHERE l.event_key = 'payroll_deduction.fine_pending'")).rows).toHaveLength(1);

    // A sanction with no fine tells payroll nothing.
    await tx((client) =>
      emit(client, { key: SANCTION_EVENTS.SANCTION_ISSUED, entity: { type: "sanction", id: who.sanction }, actor: null, payload: { ...payload, fine_amount: null } }),
    );
    await drain();
    expect(await notices("ops", "Fine Waiting for Payroll")).toHaveLength(1);
    await q("DELETE FROM sanction_fine WHERE sanction_fine_id = $1", [who.fine]);
  });

  /* ---------------------------------------------------------------- *
   * Two runs: freeze, started, applied, settled
   * ---------------------------------------------------------------- */

  const reads = (run) => as("ops").get(`/payroll/runs/${run}`).then((r) => c.payroll.PayrollRun.parse(r.body));

  test("a person with a login is told when a deduction is scheduled for them, and when a fine is waived", async () => {
    const mine = await fineFor("staff", "12000.00", { reason: "Lost a company badge" });
    const accept = await as("ops").post(`/deductions/fines/${mine.fine}/accept`, { months: 3, start_period: SEP });
    expect(accept.status).toBe(200);
    const waive = await fineFor("staff", "4000.00", { reason: "A second fine" });
    expect((await as("ops").post(`/deductions/fines/${waive.fine}/waive`, { reason: "Waived after the review" })).status).toBe(200);
    await drain();
    const scheduled = await q(`SELECT n.title, n.body FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 AND n.title = 'Deduction Scheduled'`, [
      employeeId("staff"),
    ]);
    expect(scheduled.rows).toEqual([
      { title: "Deduction Scheduled", body: "2 months from September 2026: Recorded for the wrong person" },
      { title: "Deduction Scheduled", body: "3 months from September 2026: Lost a company badge" },
    ]);
    expect(JSON.stringify(scheduled.rows)).not.toMatch(/12,?000|20,?000/);
    const waived = await q(`SELECT n.body FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 AND n.title = 'Fine Waived'`, [employeeId("staff")]);
    expect(waived.rows).toEqual([{ body: `${waive.number}: Waived after the review` }]);
    ids.staffDeduction = (await deductionOf(mine.fine)).payroll_deduction_id;
  });

  test("Submit freezes the month's instalments; from then on nothing of it is released, cancelled or added to", async () => {
    // Chidi has no salary: payroll cannot pay them, so they are left out of the run.
    expect((await as("ops").post(`/payroll/runs/${septemberRun}/exclude`, { employee_id: employeeId("chidi"), reason: "No salary entered yet" })).status).toBe(200);
    const computed = await as("ops").post(`/payroll/runs/${septemberRun}/compute`);
    expect(computed.status).toBe(200);
    const bolaLines = (
      await q(
        `SELECT l.code, l.label, l.detail, l.amount::text AS amount FROM payslip_line l JOIN payslip s ON s.payslip_id = l.payslip_id
          WHERE s.payroll_run_id = $1 AND s.employee_id = $2 AND l.kind = 'deduction' ORDER BY l.position`,
        [septemberRun, employeeId("bola")],
      )
    ).rows;
    expect(bolaLines).toEqual([
      { code: "fine", label: "Fine", detail: `${fines.bola.number}, 1 of 2`, amount: "5000.00" },
      { code: "advance", label: "Salary Advance Repayment", detail: expect.any(String), amount: "37500.00" },
    ]);

    const run = await reads(septemberRun);
    const submit = await as("ops").post(`/payroll/runs/${septemberRun}/submit`, { expected_net_total: run.net_pay });
    expect(submit.status).toBe(200);
    ids.septemberApproval = submit.body.workflow_instance_id;
    expect((await instalments(ids.advance)).map((i) => i.status)).toEqual(["in_run", "scheduled"]);

    // Released, cancelled: a month of it is in a run.
    for (const [path, body] of [
      [`/deductions/${ids.adaDeduction}/release`, { reason: "Release after the run was sent" }],
      [`/deductions/${ids.bolaDeduction}/release`, { reason: "Release after the run was sent" }],
      [`/deductions/${ids.advance}/cancel`, { reason: "Cancel after the run was sent" }],
    ]) {
      const res = await as("ops").post(path, body);
      expect([path, res.status, res.body.error.code]).toEqual([path, 409, "INSTALMENTS_STARTED"]);
    }
    expect((await instalments(ids.advance)).map((i) => i.status)).toEqual(["in_run", "scheduled"]);
    expect(await fineStatus(fines.ada.fine)).toBe("accepted");

    // Added to: nothing is added to a month already with the approver.
    const late = await fineFor("ada", "9000.00", { reason: "A fine after the run was sent" });
    const accept = await as("ops").post(`/deductions/fines/${late.fine}/accept`, { months: 1, start_period: SEP });
    expect([accept.status, accept.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
    const spread = await as("ops").post(`/deductions/fines/${late.fine}/accept`, { months: 3, start_period: "2026-08-01" });
    expect([spread.status, spread.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
    const advance = await as("ops").post("/deductions/advances", {
      employee_id: employeeId("ada"),
      amount: "10000.00",
      granted_on: "2026-09-04",
      months: 2,
      start_period: SEP,
      reason: "An advance after the run was sent",
    });
    expect([advance.status, advance.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
    expect(await fineStatus(late.fine)).toBe("pending");

    // Now the open month moves on: a Draft run no longer exists, so it is the current Lagos month.
    expect(d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body).open_period).toBe(lagos.monthBounds(lagos.today()).first);

    // The pay items it counted are frozen too, so they are no longer waiting.
    const summary = d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body);
    expect(summary.pending_attendance.count).toBe(1);
    await q("DELETE FROM sanction_fine WHERE sanction_fine_id = $1", [late.fine]);
  });

  test("Send Back gives every instalment back, and then the fine can be released again", async () => {
    const res = await as("ceo").post(`/workflow/instances/${ids.septemberApproval}/request-changes`, { reason: "Check Bola's advance" });
    expect(res.status).toBe(200);
    await drain();
    expect((await reads(septemberRun)).status).toBe("draft");
    expect((await instalments(ids.advance)).map((i) => i.status)).toEqual(["scheduled", "scheduled"]);
    expect((await rowOf("fine", fines.ada.fine)).can_release).toBe(true);
    // Released and accepted again as a new deduction, in two months.
    expect((await as("ops").post(`/deductions/${ids.adaDeduction}/release`, { reason: "Spread it over two months" })).status).toBe(200);
    const again = await as("ops").post(`/deductions/fines/${fines.ada.fine}/accept`, { months: 2, start_period: SEP });
    expect(again.status).toBe(200);
    expect((await instalments(again.body.payroll_deduction_id)).map((i) => [i.period, i.amount])).toEqual([[SEP, "22500.00"], [OCT, "22500.00"]]);
    ids.adaDeduction = again.body.payroll_deduction_id;
  });

  test("an advance is carried through two approved runs and settled with its last instalment", async () => {
    const compute = await as("ops").post(`/payroll/runs/${septemberRun}/compute`);
    expect(compute.status).toBe(200);
    const run = await reads(septemberRun);
    const submit = await as("ops").post(`/payroll/runs/${septemberRun}/submit`, { expected_net_total: run.net_pay });
    expect(submit.status).toBe(200);
    expect((await as("ceo").post(`/workflow/instances/${submit.body.workflow_instance_id}/approve`, {})).status).toBe(200);
    await drain();
    expect((await reads(septemberRun)).status).toBe("approved");

    // September's share is applied; the advance and the fine have a month to go.
    expect((await instalments(ids.advance)).map((i) => i.status)).toEqual(["applied", "scheduled"]);
    let advance = await rowOf("advance", ids.advance);
    expect(advance).toMatchObject({ status: "active", instalments: 2, instalments_applied: 1, can_cancel: false });
    expect(await q("SELECT status FROM payroll_deduction WHERE payroll_deduction_id = $1", [ids.advance])).toMatchObject({ rows: [{ status: "active" }] });
    let ada = await rowOf("fine", fines.ada.fine);
    expect(ada).toMatchObject({ status: "active", instalments: 2, instalments_applied: 1, can_release: false });
    expect(await fineStatus(fines.ada.fine)).toBe("accepted");
    // Five deductions are being recovered: Ada's fine, Bola's fine and advance, Musa's badge, and the five kobo.
    const summary = d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body);
    expect(summary.active.count).toBe(5);

    // October's run: the second instalments are scheduled in its month and nothing else asks for them.
    const october = await as("ops").post("/payroll/runs", { period: OCT });
    expect(october.status).toBe(201);
    const octoberRun = october.body.payroll_run_id;
    expect(d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body).open_period).toBe(OCT);
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("chidi"), reason: "No salary entered yet" })).status).toBe(200);
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    const bola = (
      await q(
        `SELECT l.code, l.detail, l.amount::text AS amount FROM payslip_line l JOIN payslip s ON s.payslip_id = l.payslip_id
          WHERE s.payroll_run_id = $1 AND s.employee_id = $2 AND l.kind = 'deduction' ORDER BY l.position`,
        [octoberRun, employeeId("bola")],
      )
    ).rows;
    expect(bola.map((l) => [l.code, l.amount])).toEqual([["fine", "5000.00"], ["advance", "37500.00"]]);
    const octoberNow = await reads(octoberRun);
    const send = await as("ops").post(`/payroll/runs/${octoberRun}/submit`, { expected_net_total: octoberNow.net_pay });
    expect(send.status).toBe(200);
    expect((await as("ceo").post(`/workflow/instances/${send.body.workflow_instance_id}/approve`, {})).status).toBe(200);
    await drain();
    expect((await reads(octoberRun)).status).toBe("approved");

    expect((await instalments(ids.advance)).map((i) => i.status)).toEqual(["applied", "applied"]);
    advance = await rowOf("advance", ids.advance);
    expect(advance).toMatchObject({ status: "settled", instalments: 2, instalments_applied: 2, can_cancel: false });
    ada = await rowOf("fine", fines.ada.fine);
    expect(ada).toMatchObject({ status: "settled", instalments_applied: 2, can_release: false });
    expect(await fineStatus(fines.ada.fine)).toBe("settled");
    expect(await fineStatus(fines.bola.fine)).toBe("settled");
    // A settled fine cannot be released; nothing is left to take back.
    const released = await as("ops").post(`/deductions/${ids.adaDeduction}/release`, { reason: "Release a fine already settled" });
    expect([released.status, released.body.error.code]).toEqual([409, "INSTALMENTS_STARTED"]);
    const cancelled = await as("ops").post(`/deductions/${ids.advance}/cancel`, { reason: "Cancel an advance already settled" });
    expect([cancelled.status, cancelled.body.error.code]).toEqual([409, "INSTALMENTS_STARTED"]);

    // Recovered this year counts the instalments applied in the Lagos calendar year, by the month they paid.
    const year = lagos.today().slice(0, 4);
    const expected = await one(
      `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total FROM payroll_deduction_instalment WHERE status = 'applied' AND period >= $1::date`,
      [`${year}-01-01`],
    );
    const after = d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body);
    expect(after.recovered_this_year).toEqual({ count: expected.n, pay_amount: expected.total });
    expect(after.recovered_this_year.count).toBe(year === "2026" ? 10 : 0);
    // Musa's badge and the five kobo still have months to come.
    expect(after.active.count).toBe(2);
    // The status chip: settled rows only.
    const settled = await list("ops", "?status=settled");
    expect(settled.data.map((r) => r.source_id).sort()).toEqual([ids.advance, fines.ada.fine, fines.bola.fine].sort());
  });

  /* ---------------------------------------------------------------- *
   * What a reader is shown
   * ---------------------------------------------------------------- */

  test("a reader without the salary grant sees the rows and the counts, and null for the money; a person with no salary set is not Restricted", async () => {
    const role = "(SELECT role_id FROM role WHERE code = 'operations_people')";
    await q(`UPDATE field_visibility SET visibility = 'masked' WHERE field_key = 'employee.salary' AND role_id = ${role}`);
    await grantsCache.invalidateUser(people.ops.user.user_id);
    try {
      const page = await list("ops");
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.every((r) => r.pay_amount === null)).toBe(true);
      expect(page.data.some((r) => r.salary_set === true)).toBe(true);
      expect(page.data.find((r) => r.source === "attendance" && r.employee.employee_id === employeeId("chidi")).salary_set).toBe(false);
      const s = d.DeductionSummary.parse((await as("ops").get("/deductions/summary")).body);
      expect(s.pending_fines.count).toBeGreaterThanOrEqual(0);
      expect([s.pending_fines.pay_amount, s.pending_attendance.pay_amount, s.active.pay_amount, s.recovered_this_year.pay_amount]).toEqual([null, null, null, null]);
      expect(s.recovered_this_year.count).toBeGreaterThan(0);
    } finally {
      await q(`UPDATE field_visibility SET visibility = 'visible' WHERE field_key = 'employee.salary' AND role_id = ${role}`);
      await grantsCache.invalidateUser(people.ops.user.user_id);
    }
    expect((await list("ops")).data.some((r) => r.pay_amount !== null)).toBe(true);
  });

  test("search finds an accepted fine or an advance by the person or the reason, and a fine still waiting is the query's to find", async () => {
    const res = await as("ops").get("/search?q=school fees");
    expect(res.status).toBe(200);
    const group = (res.body.data || res.body.groups || []).flat ? JSON.stringify(res.body) : "";
    expect(group).toContain("Bola Tester");
    expect(group).toContain("Deductions");
    expect(JSON.stringify((await as("staff").get("/search?q=school fees")).body)).not.toContain("Bola Tester");
  });
});

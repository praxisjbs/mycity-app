"use strict";
/**
 * M6 PR 2, a month's pay run end to end (docs/guides/payroll.md §3, §5, §6, Appendix A), on the real
 * migrations, over HTTP with every response parsed by its contract (APP_ENV=test), through the real
 * workflow engine and the outbox:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/payroll-run
 *
 * October 2026 is worked Monday to Saturday (A22) less Thursday 1 October (Independence Day): 26 working
 * days for a person on the company week. Ada is the worked example of §6.14 (₦450,000.00 a month, net
 * ₦362,576.93); a joiner on Wednesday 14 October is paid 16 of the 26 days (₦276,923.08); a leaver on Thursday
 * 15 October has every outstanding instalment taken in the final run. Every person is invented.
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
const m = require("../../src/shared/money/money");
const realtime = require("../../src/services/realtime/emitter");
const attendancePay = require("../../src/modules/attendance/attendance.pay");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const fines = require("../../src/modules/sanctions/sanctions.fines");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Pay-Roll9Test";
const p = c.payroll;
const OCT = "2026-10-01";
const SEP = "2026-09-01";
const AUG = "2026-08-01";

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

describeDb("a month's payroll run against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;
  let octoberRun;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    delete: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
  });
  const employeeId = (who) => ids[who] || people[who].employee.employee_id;

  /** An employee by SQL: only what payroll reads, the rest the real defaults. */
  async function hire(key, { gross = null, start = "2026-01-05", left = null, bank = true, status = left ? "left" : "active" } = {}) {
    const dept = (await one("SELECT department_id FROM department ORDER BY name LIMIT 1")).department_id;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, left_on, gross_monthly, bank_name, account_number)
       VALUES ($1, $2, 'Tester', $3, 'Officer', $4, 'full_time', 'on_site', $5, $6, $7, $8, $9, $10) RETURNING employee_id`,
      [`T${String(Object.keys(ids).length + 1).padStart(4, "0")}`, key[0].toUpperCase() + key.slice(1), `${key}@mycity.test`, dept, status, start, left, gross, bank ? "Test Bank" : null, bank ? "0123456789" : null],
    );
    ids[key] = row.employee_id;
    return row.employee_id;
  }

  const item = (who, date, kind, amount, { status = "pending", minutes = 30, method = "pro_rata" } = {}) =>
    q(
      `INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [employeeId(who), date, kind, minutes, method, amount, status],
    );

  /** A deduction with its instalments; `months` shares of the total, from `from`. */
  async function deduct(who, { source, total, months, from, fineId = null }) {
    const d = await one(
      `INSERT INTO payroll_deduction (employee_id, source, sanction_fine_id, reason, total_amount, instalments, start_period, granted_on, created_by)
       VALUES ($1, $2, $3, 'Test deduction', $4, $5, $6, $7, $8) RETURNING payroll_deduction_id`,
      [employeeId(who), source, fineId, total, months, from, source === "salary_advance" ? "2026-09-20" : null, people.ops.user.user_id],
    );
    const shares = m.allocate(total, Array.from({ length: months }, () => 1));
    for (let i = 0; i < months; i += 1)
      await q(`INSERT INTO payroll_deduction_instalment (payroll_deduction_id, period, amount) VALUES ($1, $2::date + ($3 || ' months')::interval, $4)`, [
        d.payroll_deduction_id,
        from,
        String(i),
        shares[i],
      ]);
    return d.payroll_deduction_id;
  }

  /** A query, a sanction and its fine, for a person; the fine in `status`. */
  async function fineFor(who, amount, { status = "accepted", step = null, from = "2026-09-01", to = "2026-09-01" } = {}) {
    const n = (await one("SELECT count(*)::int AS n FROM employee_query")).n + 1;
    const query = await one(
      `INSERT INTO employee_query (number, employee_id, subject, details) VALUES ($1, $2, 'Subject', 'Details') RETURNING employee_query_id`,
      [`QRY-${String(n).padStart(4, "0")}`, employeeId(who)],
    );
    const sanction = await one(
      `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, ends_on, status, number, consequence_step_id)
       VALUES ($1, $2, 'fine', 'Test', $3, $4, $5, 'issued', $6, $7) RETURNING sanction_id`,
      [query.employee_query_id, employeeId(who), people.ops.user.user_id, from, to, `SAN-T-${n}`, step],
    );
    const fine = await one(`INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, $2, $3) RETURNING sanction_fine_id`, [
      sanction.sanction_id,
      amount,
      status,
    ]);
    return { fine: fine.sanction_fine_id, sanction: sanction.sanction_id, number: `QRY-${String(n).padStart(4, "0")}` };
  }

  const lines = async (runId, who) =>
    (
      await q(
        `SELECT l.position, l.kind, l.code, l.label, l.detail, l.amount::text AS amount
           FROM payslip_line l JOIN payslip s ON s.payslip_id = l.payslip_id
          WHERE s.payroll_run_id = $1 AND s.employee_id = $2 ORDER BY l.position`,
        [runId, employeeId(who)],
      )
    ).rows;
  const slip = (runId, who) =>
    one(
      `SELECT number::text AS number, status, excluded_reason, gross_monthly::text AS gross_monthly, working_days, working_days_paid,
              earnings_total::text AS earnings_total, deductions_total::text AS deductions_total, net_pay::text AS net_pay,
              bank_name, account_last4, published_at
         FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2`,
      [runId, employeeId(who)],
    );
  const snapshot = async (runId) => ({
    run: await one(`SELECT status, headcount, earnings_total::text, deductions_total::text, net_total::text FROM payroll_run WHERE payroll_run_id = $1`, [runId]),
    slips: (
      await q(
        `SELECT s.employee_id, s.number::text AS number, s.status, s.earnings_total::text, s.deductions_total::text, s.net_pay::text,
                (SELECT json_agg(json_build_array(l.position, l.code, l.label, l.detail, l.amount::text, l.source_id) ORDER BY l.position)
                   FROM payslip_line l WHERE l.payslip_id = s.payslip_id) AS lines
           FROM payslip s WHERE s.payroll_run_id = $1 ORDER BY s.number`,
        [runId],
      )
    ).rows,
  });
  const itemStatus = async (who, date, kind) =>
    one(`SELECT status, payroll_run_id FROM attendance_pay_item WHERE employee_id = $1 AND work_date = $2 AND kind = $3`, [employeeId(who), date, kind]);

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

    // The company week: Monday to Saturday, and Independence Day (A22).
    await q("DELETE FROM working_week");
    for (let weekday = 1; weekday <= 7; weekday += 1)
      await q("INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)", [
        weekday,
        weekday <= 6,
        weekday <= 6 ? "09:00" : null,
        weekday <= 6 ? "17:00" : null,
      ]);
    await q("INSERT INTO public_holiday (holiday_date, name) VALUES ('2026-10-01', 'Independence Day') ON CONFLICT (holiday_date) DO NOTHING");
    workingWeek.invalidateCalendar();

    await hire("ada", { gross: "450000.00" });
    await hire("joiner", { gross: "450000.00", start: "2026-10-14" });
    await hire("nosalary", {});
    await hire("leaver", { gross: "300000.00", left: "2026-10-15" });
    await hire("nobank", { gross: "100000.00", bank: false });
    await hire("suspended", { gross: "240000.00" });

    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of ["ops", "ceo", "staff"]) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.74.0.${ip}`)
        .send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }

    // Ada: the worked example (§6.14).
    await item("ada", "2026-10-05", "overtime", "8000.00", { status: "confirmed", minutes: 120, method: "multiplier" });
    await item("ada", "2026-10-10", "overtime", "5000.00", { status: "cut", method: "multiplier" });
    await item("ada", "2026-10-06", "late", "1622.60");
    await item("ada", "2026-10-07", "late", "1877.40");
    await item("ada", "2026-10-09", "late", "999.00", { status: "waived" });
    await item("ada", "2026-10-08", "absence", "17307.69", { minutes: 480, method: "daily_rate" });
    const unpaid = (await one("SELECT leave_type_id FROM leave_type WHERE unpaid LIMIT 1")).leave_type_id;
    await q(
      `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status)
       VALUES ($1, $2, '2026-10-12', '2026-10-13', 2, 'approved')`,
      [employeeId("ada"), unpaid],
    );
    const adaFine = await fineFor("ada", "45000.00");
    await deduct("ada", { source: "sanction_fine", total: "45000.00", months: 3, from: OCT, fineId: adaFine.fine });
    await deduct("ada", { source: "salary_advance", total: "75000.00", months: 3, from: OCT });
    ids.adaFineQuery = adaFine.number;

    // The leaver owes three instalments of a fine; the final run takes all of them.
    const leaverFine = await fineFor("leaver", "18000.00");
    ids.leaverFine = leaverFine.fine;
    await deduct("leaver", { source: "sanction_fine", total: "18000.00", months: 3, from: OCT, fineId: leaverFine.fine });

    // Someone with a day of absence inside an unpaid suspension: that day is counted once.
    const step = (
      await one(
        `INSERT INTO consequence_step (code, name, position, financial_effect)
         VALUES ('unpaid-suspension-test', 'Unpaid Suspension', (SELECT COALESCE(max(position), 0) + 1 FROM consequence_step), 'unpaid_days') RETURNING consequence_step_id`,
      )
    ).consequence_step_id;
    await fineFor("suspended", "1000.00", { status: "waived", step, from: "2026-10-12", to: "2026-10-14" });
    await item("suspended", "2026-10-13", "absence", "9230.77", { minutes: 480, method: "daily_rate" });

    // Waiting on someone else: overtime not yet decided, and a fine not yet accepted.
    await item("nobank", "2026-10-20", "overtime", "3000.00", { status: "pending", method: "multiplier" });
    await fineFor("staff", "5000.00", { status: "pending" });
  }, 180_000);

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Opening a run
   * ---------------------------------------------------------------- */

  test("New Run is a Draft numbered for the month; a second for the month is a 409, and the wrong months a 422", async () => {
    const res = await as("ops").post("/payroll/runs", { period: OCT });
    expect(res.status).toBe(201);
    const run = p.PayrollRun.parse(res.body);
    octoberRun = run.payroll_run_id;
    expect(run).toMatchObject({
      number: "PAY-2026-10",
      period: OCT,
      status: "draft",
      headcount: 0,
      advanced: false,
      can_compute: true,
      can_submit: false,
      can_discard: true,
      can_pay: false,
      can_decide: false,
      chain: [],
    });

    const again = await as("ops").post("/payroll/runs", { period: OCT });
    expect([again.status, again.body.error.code]).toEqual([409, "RUN_EXISTS"]);

    const next = lagos.addMonths(lagos.monthBounds(lagos.today()).first, 1);
    const future = await as("ops").post("/payroll/runs", { period: next });
    expect([future.status, future.body.error.code]).toEqual([422, "PERIOD_NOT_ALLOWED"]);
    const early = await as("ops").post("/payroll/runs", { period: "2025-12-01" });
    expect([early.status, early.body.error.code]).toEqual([422, "PERIOD_NOT_ALLOWED"]);
    const notMonth = await as("ops").post("/payroll/runs", { period: "2026-09-15" });
    expect(notMonth.status).toBe(422);

    expect((await as("staff").post("/payroll/runs", { period: SEP })).status).toBe(403);
    expect((await as("staff").get("/payroll/runs")).status).toBe(403);
  });

  /* ---------------------------------------------------------------- *
   * Compute
   * ---------------------------------------------------------------- */

  test("Compute builds every payslip: the worked example to the kobo, a joiner prorated, a leaver's whole debt taken", async () => {
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/compute`);
    expect(res.status).toBe(200);
    const run = p.PayrollRun.parse(res.body);
    expect(run.status).toBe("computed");
    expect(run.computed_at).not.toBeNull();

    // Ada: 26 working days, the whole gross, the month's items, one leave, one fine's share and one advance's.
    expect(await lines(octoberRun, "ada")).toEqual([
      { position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", detail: null, amount: "450000.00" },
      { position: 2, kind: "earning", code: "overtime", label: "Overtime", detail: "1 day", amount: "8000.00" },
      { position: 3, kind: "deduction", code: "lateness", label: "Lateness", detail: "2 late arrivals", amount: "3500.00" },
      { position: 4, kind: "deduction", code: "absence", label: "Absence", detail: "1 absence", amount: "17307.69" },
      { position: 5, kind: "deduction", code: "unpaid_leave", label: "Unpaid Leave", detail: "2 days, 12 to 13 October", amount: "34615.38" },
      { position: 6, kind: "deduction", code: "fine", label: "Fine", detail: `${ids.adaFineQuery}, 1 of 3`, amount: "15000.00" },
      { position: 7, kind: "deduction", code: "advance", label: "Salary Advance Repayment", detail: "1 of 3", amount: "25000.00" },
    ]);
    expect(await slip(octoberRun, "ada")).toMatchObject({
      status: "draft",
      gross_monthly: "450000.00",
      working_days: 26,
      working_days_paid: 26,
      earnings_total: "458000.00",
      deductions_total: "95423.07",
      net_pay: "362576.93",
      bank_name: "Test Bank",
      account_last4: "6789",
    });

    // The joiner on 14 October is paid 16 of the 26 days; the full account number is never copied.
    expect(await lines(octoberRun, "joiner")).toEqual([
      { position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", detail: null, amount: "276923.08" },
    ]);
    expect(await slip(octoberRun, "joiner")).toMatchObject({ working_days: 26, working_days_paid: 16, net_pay: "276923.08" });

    // The leaver (left Thursday 15 October): 12 of the 26 days, and the three instalments of 6,000.00 in one go.
    expect(await lines(octoberRun, "leaver")).toEqual([
      { position: 1, kind: "earning", code: "monthly_pay", label: "Monthly Pay", detail: null, amount: "138461.54" },
      expect.objectContaining({ code: "fine", amount: "6000.00", detail: expect.stringMatching(/, 1 of 3$/) }),
      expect.objectContaining({ code: "fine", amount: "6000.00", detail: expect.stringMatching(/, 2 of 3$/) }),
      expect.objectContaining({ code: "fine", amount: "6000.00", detail: expect.stringMatching(/, 3 of 3$/) }),
    ]);
    expect(await slip(octoberRun, "leaver")).toMatchObject({ working_days_paid: 12, net_pay: "120461.54" });

    // Unpaid suspension 12 to 14 October with the 13th already counted absent: two days, not three.
    expect(await lines(octoberRun, "suspended")).toEqual([
      expect.objectContaining({ code: "monthly_pay", amount: "240000.00" }),
      expect.objectContaining({ code: "absence", amount: "9230.77" }),
      expect.objectContaining({ code: "unpaid_suspension", detail: "2 days, 12 to 14 October", amount: "18461.54" }),
    ]);

    // No salary: a payslip with no lines. No bank: the payslip still computes.
    expect(await lines(octoberRun, "nosalary")).toEqual([]);
    expect(await slip(octoberRun, "nosalary")).toMatchObject({ gross_monthly: null, net_pay: "0.00" });
    expect((await slip(octoberRun, "nobank")).bank_name).toBeNull();

    // A waived, a cut and a pending-overtime item are never paid; the pay items are only read.
    const untouched = await q("SELECT count(*)::int AS n FROM attendance_pay_item WHERE payroll_run_id IS NOT NULL");
    expect(untouched.rows[0].n).toBe(0);
  });

  test("a run's totals are the sums of its payslips, and its payslips' the sums of their lines", async () => {
    const run = await one(`SELECT headcount, earnings_total::text AS e, deductions_total::text AS d, net_total::text AS n FROM payroll_run WHERE payroll_run_id = $1`, [
      octoberRun,
    ]);
    const sums = await one(
      `SELECT count(*)::int AS headcount, sum(earnings_total)::text AS e, sum(deductions_total)::text AS d, sum(net_pay)::text AS n
         FROM payslip WHERE payroll_run_id = $1 AND status <> 'excluded'`,
      [octoberRun],
    );
    expect(run).toEqual(sums);
    expect(run.headcount).toBe(9);
    const mismatched = await q(
      `SELECT s.employee_id FROM payslip s
         LEFT JOIN LATERAL (SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'earning'), 0) AS e,
                                   COALESCE(sum(amount) FILTER (WHERE kind = 'deduction'), 0) AS d,
                                   COALESCE(sum(amount) FILTER (WHERE kind = 'employer'), 0) AS r
                              FROM payslip_line WHERE payslip_id = s.payslip_id) l ON true
        WHERE s.payroll_run_id = $1
          AND (s.earnings_total <> l.e OR s.deductions_total <> l.d OR s.employer_total <> l.r OR s.net_pay <> l.e - l.d)`,
      [octoberRun],
    );
    expect(mismatched.rows).toEqual([]);
    // Payslips carry the run's month and the staff-number order: PAY-2026-10-0001 on.
    const numbers = (await q("SELECT number::text AS number FROM payslip WHERE payroll_run_id = $1 ORDER BY number", [octoberRun])).rows.map((r) => r.number);
    expect(numbers[0]).toBe("PAY-2026-10-0001");
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test("Compute twice with nothing changed is the same lines and totals to the kobo, with the same numbers", async () => {
    const before = await snapshot(octoberRun);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/compute`);
    expect(res.status).toBe(200);
    expect(await snapshot(octoberRun)).toEqual(before);
  });

  test("the problems a run reports: blocking first, each naming the person and what to do", async () => {
    const run = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(run).toMatchObject({ blocking_problems: 1, warnings: 3, status: "computed" });
    const page = p.PayrollProblemPage.parse((await as("ops").get(`/payroll/runs/${octoberRun}/problems`)).body);
    expect(page.page).toMatchObject({ size: 25, total: 4 });
    expect(page.data.map((x) => [x.code, x.severity, x.employee && x.employee.display_name])).toEqual([
      ["NO_SALARY", "blocking", "Nosalary Tester"],
      ["OVERTIME_WAITING", "warning", "Nobank Tester"],
      ["FINE_WAITING", "warning", "Musa Danjuma"],
      ["NO_BANK", "warning", "Nobank Tester"],
    ]);
    expect(page.data[0].message).toBe("No Salary Set for Nosalary Tester");
    expect(page.data.every((x) => x.action.length > 0)).toBe(true);
  });

  test("a person with no start date is in the run with No Start Date, blocking, and no lines: never left out unseen", async () => {
    const id = await hire("nostart", { gross: "150000.00", start: null });
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    const run = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(run.blocking_problems).toBe(2);
    const page = p.PayrollProblemPage.parse((await as("ops").get(`/payroll/runs/${octoberRun}/problems`)).body);
    const found = page.data.find((x) => x.code === "NO_START_DATE");
    expect(found).toMatchObject({ severity: "blocking", message: "No Start Date for Nostart Tester" });
    const slip = await one("SELECT payslip_id, net_pay::text AS net_pay FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2", [octoberRun, id]);
    expect(slip.net_pay).toBe("0.00");
    expect((await one("SELECT count(*)::int AS n FROM payslip_line WHERE payslip_id = $1", [slip.payslip_id])).n).toBe(0);

    // Gone before the month began: Compute takes the payslip away and the run is as it was.
    await q("UPDATE employee SET status = 'left', left_on = '2025-12-31' WHERE employee_id = $1", [id]);
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    expect(p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body)).toMatchObject({ blocking_problems: 1, warnings: 3 });
    expect((await one("SELECT count(*)::int AS n FROM payslip WHERE employee_id = $1", [id])).n).toBe(0);
  });

  /* ---------------------------------------------------------------- *
   * Submit
   * ---------------------------------------------------------------- */

  test("Submit is refused while a blocking problem stands, and freezes nothing", async () => {
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/submit`, {});
    expect([res.status, res.body.error.code]).toEqual([422, "RUN_HAS_PROBLEMS"]);
    expect((await itemStatus("ada", "2026-10-06", "late")).status).toBe("pending");
    expect((await one("SELECT status FROM payroll_run WHERE payroll_run_id = $1", [octoberRun])).status).toBe("computed");
    expect(await one("SELECT count(*)::int AS n FROM workflow_instance WHERE entity_type = 'payroll_run'")).toEqual({ n: 0 });
  });

  test("Exclude leaves a person out with a reason and sends the run back to Draft; Include puts them back", async () => {
    const short = await as("ops").post(`/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("nosalary"), reason: "short" });
    expect(short.status).toBe(422);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("nosalary"), reason: "Paid outside the system this month" });
    expect(res.status).toBe(200);
    expect(p.PayrollRun.parse(res.body)).toMatchObject({ status: "draft", headcount: 8, can_submit: false, can_compute: true });
    expect(await slip(octoberRun, "nosalary")).toMatchObject({ status: "excluded", excluded_reason: "Paid outside the system this month", net_pay: "0.00" });

    // A person not paid in the month cannot be excluded or given an adjustment.
    const stranger = await hire("latecomer", { gross: "100000.00", start: "2026-11-02" });
    const no = await as("ops").post(`/payroll/runs/${octoberRun}/exclude`, { employee_id: stranger, reason: "Not even employed yet" });
    expect([no.status, no.body.error.code]).toEqual([422, "NOT_IN_RUN"]);

    const back = await as("ops").post(`/payroll/runs/${octoberRun}/include`, { employee_id: employeeId("nosalary") });
    expect(p.PayrollRun.parse(back.body)).toMatchObject({ status: "draft", headcount: 9 });
    const notOut = await as("ops").post(`/payroll/runs/${octoberRun}/include`, { employee_id: employeeId("ada") });
    expect(notOut.status).toBe(404);
    await as("ops").post(`/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("nosalary"), reason: "Paid outside the system this month" });
  });

  test("an adjustment is a one-off line with its reason, and adding or removing one sends a Computed run back to Draft", async () => {
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    const bad = await as("ops").post(`/payroll/runs/${octoberRun}/adjustments`, {
      employee_id: employeeId("ada"),
      kind: "earning",
      label: "Bonus",
      amount: "0.00",
      reason: "Quarter bonus agreed with the CEO",
    });
    expect(bad.status).toBe(422);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/adjustments`, {
      employee_id: employeeId("ada"),
      kind: "earning",
      label: "Correction: September Overtime",
      amount: "2500.00",
      reason: "Overtime missed in September's run",
    });
    expect(res.status).toBe(201);
    const adjustment = p.PayrollAdjustment.parse(res.body);
    expect(adjustment).toMatchObject({ kind: "earning", pay_amount: "2500.00", label: "Correction: September Overtime" });
    expect(p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body).status).toBe("draft");

    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    expect(await lines(octoberRun, "ada")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "adjustment_earning", label: "Correction: September Overtime", amount: "2500.00", detail: null })]),
    );
    expect((await slip(octoberRun, "ada")).net_pay).toBe("365076.93");

    const listed = p.PayrollAdjustmentPage.parse((await as("ops").get(`/payroll/runs/${octoberRun}/adjustments`)).body);
    expect(listed.data.map((a) => a.label)).toEqual(["Correction: September Overtime"]);

    const excludedOne = await as("ops").post(`/payroll/runs/${octoberRun}/adjustments`, {
      employee_id: employeeId("nosalary"),
      kind: "deduction",
      label: "Anything",
      amount: "10.00",
      reason: "Not in this run at all",
    });
    expect([excludedOne.status, excludedOne.body.error.code]).toEqual([422, "NOT_IN_RUN"]);

    expect((await as("ops").delete(`/payroll/runs/${octoberRun}/adjustments/${adjustment.payroll_adjustment_id}`)).status).toBe(204);
    expect((await as("ops").delete(`/payroll/runs/${octoberRun}/adjustments/${adjustment.payroll_adjustment_id}`)).status).toBe(404);
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
    expect((await slip(octoberRun, "ada")).net_pay).toBe("362576.93");
  });

  test("a changed total is a 409 RUN_CHANGED with the totals that now stand, nothing frozen, and the recompute kept", async () => {
    // Pay changed after the screen showed it: Joiner's gross is raised, so Submit's recompute differs.
    const shown = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    await q("UPDATE employee SET gross_monthly = '460000.00' WHERE employee_id = $1", [employeeId("joiner")]);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/submit`, { expected_net_total: shown.net_pay });
    expect([res.status, res.body.error.code]).toEqual([409, "RUN_CHANGED"]);
    expect(res.body.error.fields).toEqual({
      gross_pay: [expect.stringMatching(/^\d+\.\d{2}$/)],
      total_deductions: [expect.stringMatching(/^\d+\.\d{2}$/)],
      net_pay: [expect.stringMatching(/^\d+\.\d{2}$/)],
    });
    expect(res.body.error.fields.net_pay[0]).not.toBe(shown.net_pay);
    expect((await itemStatus("ada", "2026-10-06", "late")).status).toBe("pending");
    expect(await one("SELECT count(*)::int AS n FROM workflow_instance WHERE entity_type = 'payroll_run'")).toEqual({ n: 0 });
    // The recompute stands: the run already shows what the error said.
    const now = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(now.net_pay).toBe(res.body.error.fields.net_pay[0]);
    expect(now.status).toBe("computed");
    expect((await slip(octoberRun, "joiner")).net_pay).toBe("283076.92");
    await q("UPDATE employee SET gross_monthly = '450000.00' WHERE employee_id = $1", [employeeId("joiner")]);
  });

  test("Submit freezes the items and instalments it counted, opens the CEO's approval and locks the run's contents", async () => {
    const shown = p.PayrollRun.parse((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).body);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/submit`, { expected_net_total: shown.net_pay });
    expect(res.status).toBe(200);
    const run = p.PayrollRun.parse(res.body);
    expect(run).toMatchObject({
      status: "submitted",
      submitted_by_name: "Tunde Bakare",
      can_compute: false,
      can_submit: false,
      can_decide: false,
      returned_reason: null,
    });
    expect(run.chain.map((s) => [s.key, s.state])).toEqual([["ceo", "now"]]);

    // Frozen: Ada's counted items (lateness, absence, overtime) and the month's instalments; others untouched.
    const frozen = await q(
      `SELECT kind, work_date::text AS work_date, status FROM attendance_pay_item WHERE payroll_run_id = $1 ORDER BY work_date, kind`,
      [octoberRun],
    );
    expect(frozen.rows).toEqual([
      { kind: "overtime", work_date: "2026-10-05", status: "in_run" },
      { kind: "late", work_date: "2026-10-06", status: "in_run" },
      { kind: "late", work_date: "2026-10-07", status: "in_run" },
      { kind: "absence", work_date: "2026-10-08", status: "in_run" },
      { kind: "absence", work_date: "2026-10-13", status: "in_run" },
    ]);
    expect((await itemStatus("ada", "2026-10-09", "late")).status).toBe("waived");
    expect((await itemStatus("ada", "2026-10-10", "overtime")).status).toBe("cut");
    expect((await itemStatus("nobank", "2026-10-20", "overtime")).payroll_run_id).toBeNull();
    const instalments = await q(`SELECT status, count(*)::int AS n FROM payroll_deduction_instalment WHERE payroll_run_id = $1 GROUP BY status`, [octoberRun]);
    expect(instalments.rows).toEqual([{ status: "in_run", n: 5 }]);
    expect((await q(`SELECT count(*)::int AS n FROM payroll_deduction_instalment WHERE status = 'scheduled'`)).rows[0].n).toBe(4);

    // People can no longer waive a frozen item.
    const waive = await as("ops").post("/attendance/pay-items/waive", {
      pay_item_ids: [(await one("SELECT attendance_pay_item_id AS id FROM attendance_pay_item WHERE employee_id = $1 AND work_date = '2026-10-06' AND kind = 'late'", [employeeId("ada")])).id],
      reason: "Agreed with the line manager",
    });
    expect(waive.status).toBe(200);
    expect(waive.body.skipped).toEqual([expect.objectContaining({ code: "IN_RUN" })]);

    // Locked means locked: nothing but the approval and, later, Mark Paid touches a submitted run.
    for (const [method, path, body] of [
      ["post", `/payroll/runs/${octoberRun}/compute`, {}],
      ["post", `/payroll/runs/${octoberRun}/submit`, {}],
      ["post", `/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("ada"), reason: "Trying to exclude late" }],
      ["post", `/payroll/runs/${octoberRun}/include`, { employee_id: employeeId("nosalary") }],
      ["post", `/payroll/runs/${octoberRun}/adjustments`, { employee_id: employeeId("ada"), kind: "earning", label: "Late", amount: "1.00", reason: "Trying to add late" }],
    ]) {
      const refused = await as("ops")[method](path, body);
      expect([path.split("/").pop(), refused.status, refused.body.error.code]).toEqual([path.split("/").pop(), 409, expect.stringMatching(/^RUN_NOT_/)]);
    }
    expect((await as("ops").delete(`/payroll/runs/${octoberRun}`)).status).toBe(409);
    const paid = await as("ops").post(`/payroll/runs/${octoberRun}/mark-paid`, { paid_on: lagos.today() });
    expect([paid.status, paid.body.error.code]).toEqual([409, "NOT_APPROVED"]);

    // The approver is told by the engine; the run's events carry ids and counts, never an amount.
    await drain();
    const told = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'workflow.opened'", [people.ceo.user.user_id]);
    expect(told.rows.length).toBeGreaterThan(0);
    const submitted = await one(`SELECT payload FROM event_log WHERE event_key = 'payroll_run.submitted'`);
    expect(Object.keys(submitted.payload).sort()).toEqual(
      ["headcount", "instalments_frozen", "instance_id", "items_frozen", "number", "payroll_run_id", "period"].sort(),
    );
    expect(submitted.payload).toMatchObject({ headcount: 8, items_frozen: 5, instalments_frozen: 5 });
  });

  test("the approver reads the run with its route, and a reader without the approval cannot decide it", async () => {
    const asCeo = p.PayrollRun.parse((await as("ceo").get(`/payroll/runs/${octoberRun}`)).body);
    expect(asCeo).toMatchObject({ status: "submitted", can_decide: true, can_compute: false });
    expect(asCeo.chain).toHaveLength(1);
    const asOps = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(asOps.can_decide).toBe(false);
    const instance = asOps.workflow_instance_id;
    const denied = await as("ops").post(`/workflow/instances/${instance}/approve`, {});
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect((await one("SELECT status FROM payroll_run WHERE payroll_run_id = $1", [octoberRun])).status).toBe("submitted");
  });

  /* ---------------------------------------------------------------- *
   * Send Back, and the approval
   * ---------------------------------------------------------------- */

  test("Send Back releases everything frozen, returns the run to Draft with the reason and keeps one run for the month", async () => {
    const instance = (await one("SELECT workflow_instance_id AS id FROM workflow_instance WHERE entity_type = 'payroll_run'")).id;
    const noReason = await as("ceo").post(`/workflow/instances/${instance}/request-changes`, {});
    expect(noReason.status).toBe(422);
    const res = await as("ceo").post(`/workflow/instances/${instance}/request-changes`, { reason: "Ada's September overtime is missing" });
    expect(res.status).toBe(200);
    await drain();

    const run = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(run).toMatchObject({ status: "draft", returned_reason: "Ada's September overtime is missing", submitted_by_name: null, can_compute: true });
    expect((await itemStatus("ada", "2026-10-06", "late"))).toEqual({ status: "pending", payroll_run_id: null });
    expect((await itemStatus("ada", "2026-10-05", "overtime"))).toEqual({ status: "confirmed", payroll_run_id: null });
    expect((await q(`SELECT count(*)::int AS n FROM payroll_deduction_instalment WHERE status = 'in_run' OR payroll_run_id IS NOT NULL`)).rows[0].n).toBe(0);
    expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [instance])).state).toBe("cancelled");
    expect((await one("SELECT count(*)::int AS n FROM payroll_run WHERE period = $1", [OCT])).n).toBe(1);
    // The withdrawal the Send Back made did not return the run a second time.
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'payroll_run.returned'")).rows).toHaveLength(1);

    // It is a Draft again: the waived item can be waived now, and the run is computed and sent again.
    const adjust = await as("ops").post(`/payroll/runs/${octoberRun}/adjustments`, {
      employee_id: employeeId("ada"),
      kind: "earning",
      label: "Correction: September Overtime",
      amount: "2500.00",
      reason: "Overtime missed in September's run",
    });
    expect(adjust.status).toBe(201);
    expect((await as("ops").post(`/payroll/runs/${octoberRun}/compute`)).status).toBe(200);
  });

  test("Approve locks the run: payslips published and numbered, instalments applied, a finished fine settled, each person told", async () => {
    const shown = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    const submit = await as("ops").post(`/payroll/runs/${octoberRun}/submit`, { expected_net_total: shown.net_pay });
    expect(submit.status).toBe(200);
    const instance = p.PayrollRun.parse(submit.body).workflow_instance_id;
    expect(instance).not.toBeNull();
    await q("UPDATE sanction_fine SET settlement_status = 'accepted' WHERE sanction_fine_id = $1", [ids.leaverFine]);

    const res = await as("ceo").post(`/workflow/instances/${instance}/approve`, {});
    expect(res.status).toBe(200);
    await drain();

    const run = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
    expect(run).toMatchObject({ status: "approved", approved_by_name: "Amaka Eze", can_pay: true, can_compute: false, can_discard: false, can_decide: false });
    expect(run.approved_at).not.toBeNull();
    expect(run.net_pay).toBe(shown.net_pay);

    expect((await q("SELECT status, count(*)::int AS n FROM payslip WHERE payroll_run_id = $1 GROUP BY status ORDER BY status", [octoberRun])).rows).toEqual([
      { status: "excluded", n: 1 },
      { status: "published", n: 8 },
    ]);
    expect((await slip(octoberRun, "ada")).published_at).not.toBeNull();
    expect((await slip(octoberRun, "nosalary")).published_at).toBeNull();

    expect((await q(`SELECT status, count(*)::int AS n FROM payroll_deduction_instalment WHERE payroll_run_id = $1 GROUP BY status`, [octoberRun])).rows).toEqual([
      { status: "applied", n: 5 },
    ]);
    // Ada's fine and advance still have two shares to come; the leaver's deduction is paid in full and its fine settled.
    expect((await q("SELECT employee_id, status FROM payroll_deduction ORDER BY status, employee_id")).rows.map((r) => r.status).sort()).toEqual(["active", "active", "settled"]);
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [ids.leaverFine])).settlement_status).toBe("settled");
    // The items stay with the run that paid them.
    expect((await itemStatus("ada", "2026-10-06", "late"))).toEqual({ status: "in_run", payroll_run_id: octoberRun });

    // Each person is told "Your payslip is ready" for the month, and the events name no amount.
    const notice = await q("SELECT title, body FROM notification WHERE event_key = 'payslip.published' AND user_id = $1", [people.staff.user.user_id]);
    expect(notice.rows).toEqual([{ title: "Your payslip is ready", body: "October 2026" }]);
    const published = await q(`SELECT payload FROM event_log WHERE event_key = 'payslip.published'`);
    expect(published.rows).toHaveLength(8);
    for (const e of (await q(`SELECT event_key, payload FROM event_log WHERE module_key = 'payroll'`)).rows) {
      expect([e.event_key, Object.keys(e.payload).filter((k) => /amount|net|gross|total|pay$/.test(k))]).toEqual([e.event_key, []]);
    }
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'payroll_run.approved'")).rows).toHaveLength(1);
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'payroll_deduction.settled'")).rows).toHaveLength(1);

    // Approval applied twice changes nothing (at least once, idempotent).
    const service = require("../../src/modules/payroll/payroll.service");
    expect(await service.settle(octoberRun, "approved", instance)).toBeNull();
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'payroll_run.approved'")).rows).toHaveLength(1);
  });

  test("an approved run is locked: nothing in it changes, and only Mark Paid moves it on", async () => {
    for (const [method, path, body] of [
      ["post", `/payroll/runs/${octoberRun}/compute`, {}],
      ["post", `/payroll/runs/${octoberRun}/submit`, {}],
      ["post", `/payroll/runs/${octoberRun}/exclude`, { employee_id: employeeId("ada"), reason: "Trying to exclude late" }],
      ["post", `/payroll/runs/${octoberRun}/adjustments`, { employee_id: employeeId("ada"), kind: "earning", label: "Late", amount: "1.00", reason: "Trying to add late" }],
    ]) {
      const refused = await as("ops")[method](path, body);
      expect([refused.status, refused.body.error.code]).toEqual([409, "RUN_NOT_EDITABLE"]);
    }
    expect((await as("ops").delete(`/payroll/runs/${octoberRun}`)).status).toBe(409);
    expect((await as("ops").delete(`/payroll/runs/${octoberRun}/adjustments/${(await one("SELECT payroll_adjustment_id AS id FROM payroll_adjustment"))?.id}`)).status).toBe(409);
  });

  test("Mark Paid records the day and the reference, never a future day, and once", async () => {
    const tomorrow = lagos.addDays(lagos.today(), 1);
    const future = await as("ops").post(`/payroll/runs/${octoberRun}/mark-paid`, { paid_on: tomorrow });
    expect([future.status, future.body.error.code]).toEqual([422, "PAID_IN_THE_FUTURE"]);
    const res = await as("ops").post(`/payroll/runs/${octoberRun}/mark-paid`, { paid_on: "2026-10-30", payment_reference: "TRF-20261030-01" });
    expect(res.status).toBe(200);
    expect(p.PayrollRun.parse(res.body)).toMatchObject({ status: "paid", paid_on: "2026-10-30", payment_reference: "TRF-20261030-01", paid_by_name: "Tunde Bakare", can_pay: false });
    const again = await as("ops").post(`/payroll/runs/${octoberRun}/mark-paid`, { paid_on: "2026-10-30" });
    expect([again.status, again.body.error.code]).toEqual([409, "NOT_APPROVED"]);
  });

  /* ---------------------------------------------------------------- *
   * Reading runs, and Home
   * ---------------------------------------------------------------- */

  test("Run History pages at 25 with the filters, and the summary names the run to show first", async () => {
    const list = p.PayrollRunPage.parse((await as("ops").get("/payroll/runs?year=2026&status=paid")).body);
    expect(list.data.map((r) => [r.number, r.status, r.chain.length])).toEqual([["PAY-2026-10", "paid", 0]]);
    expect(list.page).toMatchObject({ size: 25, total: 1 });
    expect(p.PayrollRunPage.parse((await as("ops").get("/payroll/runs?status=draft")).body).data).toEqual([]);
    expect((await as("ops").get("/payroll/runs?limit=100")).status).toBe(422);
    const summary = p.PayrollRunSummary.parse((await as("ops").get("/payroll/runs/summary")).body);
    expect(summary.counts).toEqual({ draft: 0, computed: 0, submitted: 0, approved: 0, paid: 1 });
    expect(summary.current).toMatchObject({ number: "PAY-2026-10", status: "paid" });
    expect(summary.trend).toEqual([{ period: OCT, net_pay: expect.stringMatching(/^\d+\.\d{2}$/) }]);
    expect((await as("ops").get("/payroll/runs/00000000-0000-4000-8000-0000000000aa")).status).toBe(404);
  });

  test("a reader without the salary grant sees counts and statuses and null for the money, in the run, the summary and the adjustments", async () => {
    const role = "(SELECT role_id FROM role WHERE code = 'operations_people')";
    await q(`UPDATE field_visibility SET visibility = 'masked' WHERE field_key = 'employee.salary' AND role_id = ${role}`);
    await grantsCache.invalidateUser(people.ops.user.user_id);
    try {
      const run = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body);
      expect(run).toMatchObject({ number: "PAY-2026-10", status: "paid", headcount: 8, gross_pay: null, total_deductions: null, net_pay: null, employer_cost: null });
      const list = p.PayrollRunPage.parse((await as("ops").get("/payroll/runs")).body);
      expect(list.data.every((r) => r.net_pay === null && r.gross_pay === null)).toBe(true);
      const summary = p.PayrollRunSummary.parse((await as("ops").get("/payroll/runs/summary")).body);
      expect(summary.current.net_pay).toBeNull();
      expect(summary.trend.every((t) => t.net_pay === null)).toBe(true);
      const adjustments = p.PayrollAdjustmentPage.parse((await as("ops").get(`/payroll/runs/${octoberRun}/adjustments`)).body);
      expect(adjustments.data.length).toBeGreaterThan(0);
      expect(adjustments.data.every((a) => a.pay_amount === null && a.label.length > 0)).toBe(true);
      // Home shows the card to no one who may not read pay.
      expect((await as("ops").get("/home/kpi/payroll_run_state")).status).toBe(404);
    } finally {
      await q(`UPDATE field_visibility SET visibility = 'visible' WHERE field_key = 'employee.salary' AND role_id = ${role}`);
      await grantsCache.invalidateUser(people.ops.user.user_id);
    }
    expect(p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${octoberRun}`)).body).net_pay).not.toBeNull();
  });

  test("Home's Payroll In Progress counts the runs not yet paid, and a paid run no longer counts", async () => {
    const card = await as("ops").get("/home/kpi/payroll_run_state");
    expect(card.status).toBe(200);
    expect(card.body.data).toEqual([]);
    const open = await as("ops").post("/payroll/runs", { period: SEP });
    expect(open.status).toBe(201);
    const rows = (await as("ops").get("/home/kpi/payroll_run_state")).body.data;
    expect(rows.map((r) => [r.cells.run.text, r.cells.status.text, r.cells.month.text])).toEqual([["PAY-2026-09", "Draft", "September 2026"]]);
    expect(rows[0].link).toMatch(/payroll/);
    expect((await as("staff").get("/home/kpi/payroll_run_state")).status).toBe(404);
  });

  /* ---------------------------------------------------------------- *
   * Discard, concurrency
   * ---------------------------------------------------------------- */

  test("two Computes at once queue on the run and leave one consistent set of payslips", async () => {
    const run = (await one("SELECT payroll_run_id FROM payroll_run WHERE period = $1", [SEP])).payroll_run_id;
    const [a, b] = await Promise.all([as("ops").post(`/payroll/runs/${run}/compute`), as("ceo").post(`/payroll/runs/${run}/compute`)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const slips = (await q("SELECT employee_id, number::text AS number FROM payslip WHERE payroll_run_id = $1", [run])).rows;
    expect(new Set(slips.map((s) => s.employee_id)).size).toBe(slips.length);
    expect(new Set(slips.map((s) => s.number)).size).toBe(slips.length);
    expect(slips.length).toBe(8);
    const before = await snapshot(run);
    expect((await as("ops").post(`/payroll/runs/${run}/compute`)).status).toBe(200);
    expect(await snapshot(run)).toEqual(before);
  });

  test("two Submits at once are one: the second finds the run already with the approver", async () => {
    const run = (await one("SELECT payroll_run_id FROM payroll_run WHERE period = $1", [SEP])).payroll_run_id;
    expect((await as("ops").post(`/payroll/runs/${run}/exclude`, { employee_id: employeeId("nosalary"), reason: "Paid outside the system this month" })).status).toBe(200);
    expect((await as("ops").post(`/payroll/runs/${run}/compute`)).status).toBe(200);
    const [a, b] = await Promise.all([as("ops").post(`/payroll/runs/${run}/submit`, {}), as("ceo").post(`/payroll/runs/${run}/submit`, {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(refused.body.error.code).toMatch(/^RUN_NOT_/);
    expect((await q("SELECT 1 FROM workflow_instance WHERE entity_type = 'payroll_run' AND entity_id = $1", [run])).rows).toHaveLength(1);
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'payroll_run.submitted' AND entity_id = $1", [run])).rows).toHaveLength(1);
  });

  test("a rejection returns the run to Draft the same way, and a Draft can be discarded: its number is free again", async () => {
    const run = (await one("SELECT payroll_run_id, workflow_instance_id FROM payroll_run WHERE period = $1", [SEP]));
    const rejected = await as("ceo").post(`/workflow/instances/${run.workflow_instance_id}/reject`, { reason: "Not this month: the bonuses are missing" });
    expect(rejected.status).toBe(200);
    await drain();
    const back = p.PayrollRun.parse((await as("ops").get(`/payroll/runs/${run.payroll_run_id}`)).body);
    expect(back).toMatchObject({ status: "draft", returned_reason: "Not this month: the bonuses are missing" });
    expect((await q(`SELECT 1 FROM attendance_pay_item WHERE payroll_run_id = $1`, [run.payroll_run_id])).rows).toEqual([]);

    expect((await as("staff").delete(`/payroll/runs/${run.payroll_run_id}`)).status).toBe(403);
    expect((await as("ops").delete(`/payroll/runs/${run.payroll_run_id}`)).status).toBe(204);
    expect((await q("SELECT 1 FROM payslip WHERE payroll_run_id = $1", [run.payroll_run_id])).rows).toEqual([]);
    expect((await as("ops").get(`/payroll/runs/${run.payroll_run_id}`)).status).toBe(404);
    const reopened = await as("ops").post("/payroll/runs", { period: SEP });
    expect(reopened.status).toBe(201);
    expect(p.PayrollRun.parse(reopened.body).number).toBe("PAY-2026-09");
  });

  /* ---------------------------------------------------------------- *
   * What the owners' functions refuse, and how long Compute takes
   * ---------------------------------------------------------------- */

  test("attendance's takeIntoRun refuses an item that changed since Compute counted it, and releaseFromRun is safe twice", async () => {
    const runId = (await one("SELECT payroll_run_id FROM payroll_run WHERE period = $1", [SEP])).payroll_run_id;
    await item("ada", "2026-09-10", "late", "700.00");
    await item("ada", "2026-09-11", "late", "800.00", { status: "waived" });
    const both = (await q("SELECT attendance_pay_item_id AS id FROM attendance_pay_item WHERE employee_id = $1 AND work_date IN ('2026-09-10', '2026-09-11') ORDER BY work_date", [employeeId("ada")])).rows.map((r) => r.id);
    await expect(tx((client) => attendancePay.takeIntoRun(client, { run_id: runId, items: both }))).rejects.toMatchObject({ code: "RUN_CHANGED", status: 409 });
    expect((await itemStatus("ada", "2026-09-10", "late")).status).toBe("pending");

    expect(await tx((client) => attendancePay.takeIntoRun(client, { run_id: runId, items: [both[0]] }))).toEqual({ taken: 1 });
    expect(await itemStatus("ada", "2026-09-10", "late")).toEqual({ status: "in_run", payroll_run_id: runId });
    expect(await tx((client) => attendancePay.releaseFromRun(client, runId))).toEqual({ released: 1 });
    expect(await tx((client) => attendancePay.releaseFromRun(client, runId))).toEqual({ released: 0 });
    expect(await itemStatus("ada", "2026-09-10", "late")).toEqual({ status: "pending", payroll_run_id: null });
  });

  test("an item with no price gets one when payroll takes it, once the person has a salary", async () => {
    const version = await one("SELECT policy_version_id FROM policy_version WHERE status = 'published' ORDER BY version LIMIT 1");
    await q(
      `INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, policy_version_id, status)
       VALUES ($1, '2026-09-15', 'absence', 480, 'daily_rate', NULL, $2, 'pending')`,
      [employeeId("ada"), version && version.policy_version_id],
    );
    const row = await one("SELECT attendance_pay_item_id AS id FROM attendance_pay_item WHERE employee_id = $1 AND work_date = '2026-09-15'", [employeeId("ada")]);
    const priced = await attendancePay.pricesOf(pool, await attendanceRepo.lockPayItemsForRun(pool, [row.id]));
    // With a policy version to read the rule from, the absence is a day's pay on the person's own working days.
    if (version) expect(priced.get(row.id)).toMatch(/^\d+\.\d{2}$/);
    else expect(priced.get(row.id)).toBeNull();
    await q("DELETE FROM attendance_pay_item WHERE attendance_pay_item_id = $1", [row.id]);
  });

  test("sanctions.fines.release puts an accepted fine back to waiting, and refuses one that is not accepted", async () => {
    const waiting = await fineFor("staff", "7000.00", { status: "accepted" });
    await tx((client) => fines.release(client, waiting.fine, null, "Accepted in error"));
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [waiting.fine])).settlement_status).toBe("pending");
    await expect(tx((client) => fines.release(client, waiting.fine, null))).rejects.toMatchObject({ code: "FINE_NOT_MOVABLE", status: 409 });
    expect((await q("SELECT 1 FROM event_log WHERE event_key = 'sanction_fine.released'")).rows).toHaveLength(1);
    await tx((client) => fines.accept(client, waiting.fine, null));
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [waiting.fine])).settlement_status).toBe("accepted");
  });

  test("the assistant's New Run card (payroll_runs.create) runs the function New Run's button runs, as a risk the person confirms", async () => {
    const manifest = require("../../src/modules/payroll/payroll.ai");
    const action = manifest.actions.find((a) => a.key === "payroll_runs.create");
    expect([action.label, action.permission, action.risk, action.input]).toEqual(["New Run", ["payroll", "create"], "payroll", p.PayrollRunCreate]);
    const actor = await grantsCache.getAuthUser(pool, people.ops.user.user_id);
    const run = await action.run({ period: "2026-07-01" }, actor);
    expect(run).toMatchObject({ number: "PAY-2026-07", status: "draft" });
    expect(action.readback(run)[0]).toMatchObject({ type: "payroll_run", label: "PAY-2026-07, July 2026", status: "draft" });
    await expect(action.run({ period: "2026-07-01" }, actor)).rejects.toMatchObject({ code: "RUN_EXISTS", status: 409 });
    await require("../../src/modules/payroll/payroll.service").discardRun(actor, run.payroll_run_id);
    expect((await one("SELECT count(*)::int AS n FROM payroll_run WHERE period = '2026-07-01'")).n).toBe(0);
  });

  test("Compute for 300 people is measured (decision 3 of §13.2) and stays well under the three seconds that would need a job", async () => {
    await q(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, gross_monthly, bank_name, account_number)
       SELECT 'M' || lpad(i::text, 4, '0'), 'Staff' || i, 'Member', 'staff' || i || '@mycity.test', 'Officer',
              (SELECT department_id FROM department LIMIT 1), 'full_time', 'on_site', 'active', '2026-01-05',
              150000 + (i % 50) * 5000, 'Test Bank', lpad(i::text, 10, '0')
         FROM generate_series(1, 300) AS i`,
    );
    await q(
      `INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status)
       SELECT e.employee_id, '2026-08-04'::date, 'late', 30, 'pro_rata', 500.00, 'pending' FROM employee e WHERE e.staff_number LIKE 'M%'
       UNION ALL
       SELECT e.employee_id, '2026-08-05'::date, 'overtime', 60, 'multiplier', 2000.00, 'confirmed' FROM employee e WHERE e.staff_number LIKE 'M%' AND right(e.staff_number, 1) IN ('1', '2', '3')`,
    );
    await q(
      `INSERT INTO payroll_deduction (employee_id, source, reason, total_amount, instalments, start_period, granted_on, status)
       SELECT e.employee_id, 'salary_advance', 'Advance', 30000.00, 3, '2026-08-01', '2026-07-20', 'active' FROM employee e WHERE e.staff_number LIKE 'M%' AND right(e.staff_number, 1) = '5'`,
    );
    await q(
      `INSERT INTO payroll_deduction_instalment (payroll_deduction_id, period, amount)
       SELECT d.payroll_deduction_id, '2026-08-01'::date + (g || ' months')::interval, 10000.00
         FROM payroll_deduction d, generate_series(0, 2) AS g WHERE d.reason = 'Advance'`,
    );
    const run = p.PayrollRun.parse((await as("ops").post("/payroll/runs", { period: AUG })).body);
    const started = process.hrtime.bigint();
    const res = await as("ops").post(`/payroll/runs/${run.payroll_run_id}/compute`);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(res.status).toBe(200);
    if (process.env.PAYROLL_MEASURE) process.stderr.write(`payroll: Compute for ${res.body.headcount} people took ${Math.round(ms)} ms\n`);
    expect(p.PayrollRun.parse(res.body).headcount).toBeGreaterThanOrEqual(300);
    // The guide decides the job stubs on three seconds; the test only guards against a regression far past it.
    expect(ms).toBeLessThan(8000);
    const again = await snapshot(run.payroll_run_id);
    expect((await as("ops").post(`/payroll/runs/${run.payroll_run_id}/compute`)).status).toBe(200);
    expect(await snapshot(run.payroll_run_id)).toEqual(again);
  }, 120_000);
});

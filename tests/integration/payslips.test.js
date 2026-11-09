"use strict";
/**
 * M6 PR 4, payslips from an approved run to the person's hands (docs/guides/payroll.md §5, §6.10, Appendix A), on the
 * real migrations, over HTTP with every response parsed by its contract (APP_ENV=test), through the real approval
 * engine, the outbox and the document engine (the PDFs are rendered by Chromium, as the worker does):
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/payslips
 *
 * October 2026 is worked Monday to Saturday (A22) less Thursday 1 October: 26 working days. Musa (`staff`) is the worked
 * example of §6.14 (₦450,000.00 a month, net ₦362,576.93) with a ₦2,500.00 bonus added on top; Bola (`other`) is simple
 * pay; a sixth person is excluded from the run. Every person is invented and uses an address on mycity.test.
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
const documents = require("../../src/shared/documents/generate");
const systemMail = require("../../src/services/mail/system-mail.service");
const queues = require("../../src/jobs/queues");
const settings = require("../../src/modules/payroll/payroll.config.repo");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Pay-Slip9Test";
const s = c.payslips;
const OCT = "2026-10-01";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 20; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

/** How many pages a PDF has: Chromium writes each page's dictionary in the clear. */
const pagesOf = (pdf) => (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

const STATUTORY = /PAYE|pension|\btax\b|\bNHF\b|\bITF\b|NSITF/i;

describeDb("payslips from an approved run to the person", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  let ip = 0;
  let run;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const employeeId = (who) => ids[who] || people[who].employee.employee_id;
  const payslipOf = (who) => one("SELECT payslip_id, document_id, number::text AS number, emailed_at FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2", [run, employeeId(who)]);
  const mailsQueued = () => queues.enqueue.mock.calls.filter(([queue, template]) => queue === "email-send" && template === "payslip-ready");

  /** Render every payslip's pending document as the worker's pdf-render job does. */
  async function renderAll() {
    const rows = (await q("SELECT document_id FROM document WHERE doc_type = 'payslip' AND render_status = 'pending' ORDER BY created_at")).rows;
    for (const r of rows) expect(await documents.renderPending(r.document_id, { db: pool })).not.toBeNull();
    return rows.length;
  }

  async function hire(key, { gross, start = "2026-01-05" }) {
    const dept = (await one("SELECT department_id FROM department ORDER BY name LIMIT 1")).department_id;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, gross_monthly, bank_name, account_number)
       VALUES ($1, $2, 'Tester', $3, 'Officer', $4, 'full_time', 'on_site', 'active', $5, $6, 'Test Bank', '0123456789') RETURNING employee_id`,
      [`S${String(Object.keys(ids).length + 1).padStart(4, "0")}`, key[0].toUpperCase() + key.slice(1), `${key}@mycity.test`, dept, start, gross],
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

  /** A deduction with its instalments, `months` shares from October. */
  async function deduct(who, { source, total, months, fineId = null }) {
    const d = await one(
      `INSERT INTO payroll_deduction (employee_id, source, sanction_fine_id, reason, total_amount, instalments, start_period, granted_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING payroll_deduction_id`,
      [employeeId(who), source, fineId, source === "salary_advance" ? "Laptop advance" : "Cash shortage", total, months, OCT, source === "salary_advance" ? "2026-09-20" : null, people.ops.user.user_id],
    );
    const shares = m.allocate(total, Array.from({ length: months }, () => 1));
    for (let i = 0; i < months; i += 1)
      await q(`INSERT INTO payroll_deduction_instalment (payroll_deduction_id, period, amount) VALUES ($1, $2::date + ($3 || ' months')::interval, $4)`, [
        d.payroll_deduction_id,
        OCT,
        String(i),
        shares[i],
      ]);
  }

  async function fineFor(who, amount) {
    const n = (await one("SELECT count(*)::int AS n FROM employee_query")).n + 1;
    const number = `QRY-${String(n).padStart(4, "0")}`;
    const query = await one(`INSERT INTO employee_query (number, employee_id, subject, details) VALUES ($1, $2, 'Subject', 'Details') RETURNING employee_query_id`, [number, employeeId(who)]);
    const sanction = await one(
      `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, ends_on, status, number)
       VALUES ($1, $2, 'fine', 'Test', $3, '2026-09-01', '2026-09-01', 'issued', $4) RETURNING sanction_id`,
      [query.employee_query_id, employeeId(who), people.ops.user.user_id, `SAN-P-${n}`],
    );
    const fine = await one(`INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, $2, 'accepted') RETURNING sanction_fine_id`, [sanction.sanction_id, amount]);
    return { fine: fine.sanction_fine_id, number, query: query.employee_query_id };
  }

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
    await make("mgmt", "Ife", "Adewale", "management");
    await make("staff", "Musa", "Danjuma", "employee");
    await make("other", "Bola", "Okoro", "employee");
    for (const [who, gross] of [["ops", "250000.00"], ["ceo", "500000.00"], ["mgmt", "300000.00"], ["staff", "450000.00"], ["other", "180000.00"]])
      await q("UPDATE employee SET gross_monthly = $2, bank_name = 'Test Bank', account_number = '0000111122' WHERE employee_id = $1", [employeeId(who), gross]);
    await hire("left_out", { gross: "100000.00" });

    // The company week: Monday to Saturday, and Independence Day (A22).
    await q("DELETE FROM working_week");
    for (let weekday = 1; weekday <= 7; weekday += 1)
      await q("INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)", [weekday, weekday <= 6, weekday <= 6 ? "09:00" : null, weekday <= 6 ? "17:00" : null]);
    await q("INSERT INTO public_holiday (holiday_date, name) VALUES ('2026-10-01', 'Independence Day') ON CONFLICT (holiday_date) DO NOTHING");
    workingWeek.invalidateCalendar();

    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of ["ops", "ceo", "mgmt", "staff", "other"]) {
      ip += 1;
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.75.0.${ip}`).send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }

    // Musa: the worked example (§6.14).
    await item("staff", "2026-10-05", "overtime", "8000.00", { status: "confirmed", minutes: 120, method: "multiplier" });
    await item("staff", "2026-10-06", "late", "1622.60");
    await item("staff", "2026-10-07", "late", "1877.40");
    await item("staff", "2026-10-08", "absence", "17307.69", { minutes: 480, method: "daily_rate" });
    const unpaid = (await one("SELECT leave_type_id FROM leave_type WHERE unpaid LIMIT 1")).leave_type_id;
    await q(`INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status) VALUES ($1, $2, '2026-10-12', '2026-10-13', 2, 'approved')`, [employeeId("staff"), unpaid]);
    ids.fine = await fineFor("staff", "45000.00");
    await deduct("staff", { source: "sanction_fine", total: "45000.00", months: 3, fineId: ids.fine.fine });
    await deduct("staff", { source: "salary_advance", total: "75000.00", months: 3 });
  }, 180_000);

  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Before approval: a preview for Payroll, nothing for the person
   * ---------------------------------------------------------------- */

  test("a computed run's payslips are a preview for Payroll readers, with the breakdown behind a grouped line, and nothing for the person", async () => {
    const created = await as("ops").post("/payroll/runs", { period: OCT });
    expect(created.status).toBe(201);
    run = c.payroll.PayrollRun.parse(created.body).payroll_run_id;
    await q("SELECT 1");
    const exclude = await as("ops").post(`/payroll/runs/${run}/exclude`, { employee_id: employeeId("left_out"), reason: "Paid outside the system" });
    expect(exclude.status).toBe(200);
    const added = await as("ops").post(`/payroll/runs/${run}/adjustments`, {
      employee_id: employeeId("staff"),
      kind: "earning",
      label: "Spot Bonus",
      amount: "2500.00",
      reason: "Delivered the launch early",
    });
    expect(added.status).toBe(201);
    expect((await as("ops").post(`/payroll/runs/${run}/compute`)).status).toBe(200);

    const list = await as("ops").get(`/payslips?run_id=${run}`);
    expect(list.status).toBe(200);
    const page = s.PayslipPage.parse(list.body);
    expect(page.page).toMatchObject({ number: 1, size: 25, total: 6 });
    // The default order is the person's name; every payslip is a draft, the left-out one excluded.
    expect(page.data.map((p) => p.employee.display_name)).toEqual(["Amaka Eze", "Bola Okoro", "Ife Adewale", "Left_out Tester", "Musa Danjuma", "Tunde Bakare"]);
    expect(page.data.map((p) => p.status)).toEqual(["draft", "draft", "draft", "excluded", "draft", "draft"]);
    expect(page.data.every((p) => p.run_status === "computed" && p.period === OCT)).toBe(true);
    const musa = page.data.find((p) => p.employee.display_name === "Musa Danjuma");
    expect(musa).toMatchObject({ gross_pay: "460500.00", total_deductions: "95423.07", net_pay: "365076.93", has_deduction: true, published_at: null, emailed_at: null });

    const detail = s.PayslipDetail.parse((await as("ops").get(`/payslips/${musa.payslip_id}`)).body);
    expect(detail).toMatchObject({ pdf_ready: false, working_days: 26, working_days_paid: 26, gross_monthly: "450000.00", bank_name: "Test Bank", account_last4: "1122", status: "draft" });
    expect(detail.lines.map((l) => [l.code, l.label, l.detail, l.pay_amount, l.has_breakdown])).toEqual([
      ["monthly_pay", "Monthly Pay", null, "450000.00", false],
      ["overtime", "Overtime", "1 day", "8000.00", true],
      ["adjustment_earning", "Spot Bonus", null, "2500.00", false],
      ["lateness", "Lateness", "2 late arrivals", "3500.00", true],
      ["absence", "Absence", "1 absence", "17307.69", true],
      ["unpaid_leave", "Unpaid Leave", "2 days, 12 to 13 October", "34615.38", false],
      ["fine", "Fine", `${ids.fine.number}, 1 of 3`, "15000.00", false],
      ["advance", "Salary Advance Repayment", "1 of 3", "25000.00", false],
    ]);
    // The pay date is the month's: the 30th by default.
    expect(detail.pay_date).toBe("2026-10-30");

    // A grouped line lists the items the next Compute would take; an adjustment shows its reason; a fine, its month.
    const line = (code) => detail.lines.find((l) => l.code === code).payslip_line_id;
    const lateness = s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${musa.payslip_id}/lines/${line("lateness")}/items`)).body);
    expect(lateness.data.map((i) => [i.label, i.work_date, i.minutes, i.status, i.pay_amount])).toEqual([
      ["Late Arrival", "2026-10-06", 30, "Pending", "1622.60"],
      ["Late Arrival", "2026-10-07", 30, "Pending", "1877.40"],
    ]);
    const bonus = s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${musa.payslip_id}/lines/${line("adjustment_earning")}/items`)).body);
    expect(bonus.data).toEqual([expect.objectContaining({ label: "Spot Bonus", reason: "Delivered the launch early", pay_amount: "2500.00" })]);
    const fine = s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${musa.payslip_id}/lines/${line("fine")}/items`)).body);
    expect(fine.data).toEqual([expect.objectContaining({ label: `${ids.fine.number}, 1 of 3`, work_date: OCT, status: "Scheduled", pay_amount: "15000.00" })]);
    expect(s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${musa.payslip_id}/lines/${line("monthly_pay")}/items`)).body).data).toEqual([]);
    const strange = await as("ops").get(`/payslips/${musa.payslip_id}/lines/00000000-0000-4000-8000-000000000000/items`);
    expect(strange.status).toBe(404);

    // Filters and sorts, 25 a page: by status, by name, by net pay.
    expect(s.PayslipPage.parse((await as("ops").get(`/payslips?run_id=${run}&status=excluded`)).body).data).toHaveLength(1);
    expect(s.PayslipPage.parse((await as("ops").get(`/payslips?run_id=${run}&q=musa`)).body).data.map((p) => p.number)).toEqual([musa.number]);
    const byNet = s.PayslipPage.parse((await as("ops").get(`/payslips?run_id=${run}&sort=-net_pay`)).body).data;
    expect(byNet[0].employee.display_name).toBe("Amaka Eze");
    expect((await as("ops").get(`/payslips?run_id=${run}&page=2`)).body.data).toEqual([]);
    expect((await as("ops").get(`/payslips?limit=100`)).status).toBe(422);

    // No PDF before approval; the person sees nothing of a month still in the run.
    const preview = await as("ops").get(`/payslips/${musa.payslip_id}/pdf`);
    expect([preview.status, preview.body.error.code]).toEqual([409, "NOT_APPROVED"]);
    const mine = await as("staff").get("/ess/payslips?year=2026");
    expect(s.PayslipPage.parse(mine.body)).toMatchObject({ data: [], page: { total: 0 } });
    expect((await as("staff").get(`/ess/payslips/${musa.payslip_id}`)).status).toBe(404);
    expect((await as("staff").get(`/ess/payslips/${musa.payslip_id}/pdf`)).status).toBe(404);
    const quietRes = await as("staff").get("/ess/payslips/summary?year=2026");
    const quiet = s.EssPayslipSummary.parse(quietRes.body);
    expect(quiet).toMatchObject({ year: 2026, payslips: 0, gross_pay: "0.00", net_pay: "0.00", total_deductions: "0.00" });

    // Email All and Download All wait for the approval.
    const early = await as("ops").post(`/payroll/runs/${run}/email-payslips`, {});
    expect([early.status, early.body.error.code]).toEqual([409, "NOT_APPROVED"]);
    const earlyExport = await as("ops").post(`/payroll/runs/${run}/payslips-export`, {});
    expect([earlyExport.status, earlyExport.body.error.code]).toEqual([409, "NOT_APPROVED"]);
    ids.musaPayslip = musa.payslip_id;
  });

  test("payslips are for Payroll readers: the person and a reader of another module are refused, and one without edit cannot open a PDF", async () => {
    for (const path of ["/payslips", `/payslips/${ids.musaPayslip}`, `/payslips/${ids.musaPayslip}/pdf`])
      expect([path, (await as("staff").get(path)).status]).toEqual([path, 403]);
    expect((await as("staff").post(`/payroll/runs/${run}/email-payslips`, {})).status).toBe(403);
    expect((await as("staff").post(`/payroll/runs/${run}/payslips-export`, {})).status).toBe(403);
    // Management may view and export, never edit.
    expect((await as("mgmt").get("/payslips")).status).toBe(200);
    expect((await as("mgmt").post(`/payroll/runs/${run}/email-payslips`, {})).status).toBe(403);
  });

  /* ---------------------------------------------------------------- *
   * Approval: the lock publishes and requests every PDF
   * ---------------------------------------------------------------- */

  test("Approve publishes every payslip and requests its PDF: a restricted document of the person's own, not yet rendered", async () => {
    const shown = c.payroll.PayrollRun.parse((await as("ops").get(`/payroll/runs/${run}`)).body);
    const submit = await as("ops").post(`/payroll/runs/${run}/submit`, { expected_net_total: shown.net_pay });
    expect(submit.status).toBe(200);
    const instance = c.payroll.PayrollRun.parse(submit.body).workflow_instance_id;
    expect((await as("ceo").post(`/workflow/instances/${instance}/approve`, {})).status).toBe(200);
    await drain();

    expect((await q("SELECT status, count(*)::int AS n FROM payslip WHERE payroll_run_id = $1 GROUP BY status ORDER BY status", [run])).rows).toEqual([
      { status: "excluded", n: 1 },
      { status: "published", n: 5 },
    ]);
    const docs = (
      await q(
        `SELECT d.doc_type, d.sensitivity, d.render_status, d.subject_employee_id, d.uploaded_by, d.entity_type, d.title, p.employee_id, p.number::text AS number
           FROM payslip p JOIN document d ON d.document_id = p.document_id WHERE p.payroll_run_id = $1 ORDER BY p.number`,
        [run],
      )
    ).rows;
    expect(docs).toHaveLength(5);
    for (const d of docs) {
      expect(d).toMatchObject({ doc_type: "payslip", sensitivity: "restricted", render_status: "pending", entity_type: "payslip", uploaded_by: null });
      expect(d.subject_employee_id).toBe(d.employee_id);
      expect(d.title).toBe(`Payslip ${d.number}`);
    }
    // The excluded person has no payslip document.
    expect((await one("SELECT document_id FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2", [run, employeeId("left_out")])).document_id).toBeNull();

    // What the document says: the month, the lines as printed, the net; never a statutory word in simple mode.
    const html = (await one(`SELECT d.render_html FROM payslip p JOIN document d ON d.document_id = p.document_id WHERE p.payroll_run_id = $1 AND p.employee_id = $2`, [run, employeeId("staff")])).render_html;
    for (const text of ["October 2026", "Musa Danjuma", "Monthly Pay", "₦450,000.00", "Spot Bonus", "Salary Advance Repayment", "₦95,423.07", "₦365,076.93", "Ending 1122", "30/10/2026", "26 of 26"])
      expect([text, html.includes(text)]).toEqual([text, true]);
    expect(html).not.toMatch(STATUTORY);

    // Until the worker has rendered it the PDF is Preparing, for the person and for Payroll alike.
    const early = await as("staff").get(`/ess/payslips/${ids.musaPayslip}/pdf`);
    expect([early.status, early.body.error.code]).toEqual([409, "NOT_READY"]);
    expect((await as("ops").get(`/payslips/${ids.musaPayslip}/pdf`)).status).toBe(409);
    const detail = s.PayslipDetail.parse((await as("staff").get(`/ess/payslips/${ids.musaPayslip}`)).body);
    expect(detail).toMatchObject({ status: "published", pdf_ready: false, run_status: "approved" });
    // Email a Copy waits for the PDF too, and sends nothing.
    const copy = await as("staff").post(`/ess/payslips/${ids.musaPayslip}/email`);
    expect([copy.status, copy.body.error.code]).toEqual([409, "NOT_READY"]);
    expect(mailsQueued()).toHaveLength(0);
  });

  test("the worker renders each PDF: a real one page document, read by its owner and by Payroll editors only", async () => {
    expect(await renderAll()).toBe(5);
    const rows = (await q("SELECT d.render_status, d.locked_at, d.render_html, d.bytes FROM document d WHERE d.doc_type = 'payslip'")).rows;
    expect(rows.every((r) => r.render_status === "done" && r.locked_at !== null && r.render_html === null && Number(r.bytes) > 1000)).toBe(true);

    const own = await as("staff").get(`/ess/payslips/${ids.musaPayslip}/pdf`).buffer(true);
    expect([own.status, own.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect(Buffer.from(own.body).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pagesOf(own.body)).toBe(1);

    // Payroll with edit opens it; Management (view and export only) and another employee do not.
    const ops = await as("ops").get(`/payslips/${ids.musaPayslip}/pdf`).buffer(true);
    expect([ops.status, ops.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect((await as("mgmt").get(`/payslips/${ids.musaPayslip}/pdf`)).status).toBe(403);
    expect((await as("other").get(`/ess/payslips/${ids.musaPayslip}/pdf`)).status).toBe(404);
    const stranger = (await payslipOf("staff")).document_id;
    expect((await as("other").get(`/documents/${stranger}/content`)).status).toBe(404);
    expect((await as("mgmt").get(`/documents/${stranger}/content`)).status).toBe(404);
    expect((await as("staff").get(`/documents/${stranger}/content`)).status).toBe(200);

    expect(s.PayslipDetail.parse((await as("staff").get(`/ess/payslips/${ids.musaPayslip}`)).body).pdf_ready).toBe(true);
  });

  test("a payslip's lines equal the run's, and the person reads only their own", async () => {
    const slips = (await q("SELECT payslip_id, employee_id, earnings_total::text AS e, deductions_total::text AS d, net_pay::text AS n FROM payslip WHERE payroll_run_id = $1 AND status = 'published'", [run])).rows;
    expect(slips).toHaveLength(5);
    for (const sl of slips) {
      const who = Object.keys(people).find((k) => people[k].employee.employee_id === sl.employee_id);
      const token = ["staff", "other"].includes(who) ? who : "ops";
      const res = await as(token).get(token === "ops" ? `/payslips/${sl.payslip_id}` : `/ess/payslips/${sl.payslip_id}`);
      const detail = s.PayslipDetail.parse(res.body);
      const stored = (await q("SELECT position, kind, code, label, detail, amount::text AS amount FROM payslip_line WHERE payslip_id = $1 AND kind <> 'employer' ORDER BY position", [sl.payslip_id])).rows;
      expect(detail.lines.map((l) => [l.position, l.kind, l.code, l.label, l.detail, l.pay_amount])).toEqual(stored.map((l) => [l.position, l.kind, l.code, l.label, l.detail, l.amount]));
      expect([detail.gross_pay, detail.total_deductions, detail.net_pay]).toEqual([sl.e, sl.d, sl.n]);
      expect(m.toWire(m.sum(stored.filter((l) => l.kind === "earning").map((l) => l.amount)).minus(m.sum(stored.filter((l) => l.kind === "deduction").map((l) => l.amount))))).toBe(sl.n);
    }
    // Bola sees her own payslip and not Musa's, by id, by list or by the PDF.
    const bola = s.PayslipPage.parse((await as("other").get("/ess/payslips?year=2026")).body);
    expect(bola.data.map((p) => p.employee.display_name)).toEqual(["Bola Okoro"]);
    expect((await as("other").get(`/ess/payslips/${ids.musaPayslip}`)).status).toBe(404);
    // The grouped line behind a published payslip is the run's own items now.
    const musa = s.PayslipDetail.parse((await as("ops").get(`/payslips/${ids.musaPayslip}`)).body);
    const lateness = musa.lines.find((l) => l.code === "lateness");
    const items = s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${ids.musaPayslip}/lines/${lateness.payslip_line_id}/items`)).body);
    expect(items.data.map((i) => [i.work_date, i.status])).toEqual([["2026-10-06", "In the Run"], ["2026-10-07", "In the Run"]]);
    const fine = s.PayslipLineItemPage.parse((await as("ops").get(`/payslips/${ids.musaPayslip}/lines/${musa.lines.find((l) => l.code === "fine").payslip_line_id}/items`)).body);
    expect(fine.data[0]).toMatchObject({ status: "Deducted", work_date: OCT });
  });

  test("My Payslips: the year's cards, its months with their run's status, Next Payday and the deductions with their query", async () => {
    const mine = s.PayslipPage.parse((await as("staff").get("/ess/payslips?year=2026")).body);
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0]).toMatchObject({ number: expect.stringMatching(/^PAY-2026-10-\d{4}$/), period: OCT, run_status: "approved", status: "published", has_deduction: true, net_pay: "365076.93" });
    expect(mine.data[0].emailed_at).toBeNull();
    expect(s.PayslipPage.parse((await as("staff").get("/ess/payslips?year=2025")).body).data).toEqual([]);

    const summary = s.EssPayslipSummary.parse((await as("staff").get("/ess/payslips/summary?year=2026")).body);
    expect(summary).toMatchObject({ year: 2026, payslips: 1, gross_pay: "460500.00", net_pay: "365076.93", total_deductions: "95423.07" });
    // Next Payday is the first pay date on or after today (the 30th, held to a short month's last day).
    const today = lagos.today();
    let expected = settings.payDateOf({ pay_day: null }, lagos.monthBounds(today).first);
    if (expected < today) expected = settings.payDateOf({ pay_day: null }, lagos.addMonths(lagos.monthBounds(today).first, 1));
    expect(summary.next_payday).toBe(expected);

    // Deductions: the fine's and the advance's three months, each with its place, and the fine names its query.
    const deductions = s.EssDeductionPage.parse((await as("staff").get("/ess/deductions")).body);
    expect(deductions.page.total).toBe(6);
    const firstFine = deductions.data.find((d) => d.source === "fine" && d.instalment === 1);
    expect(firstFine).toMatchObject({ period: OCT, reason: "Cash shortage", pay_amount: "15000.00", instalments: 3, status: "applied", query_number: ids.fine.number, query_id: ids.fine.query });
    expect(deductions.data.find((d) => d.source === "advance" && d.instalment === 3)).toMatchObject({ period: "2026-12-01", pay_amount: "25000.00", status: "scheduled", query_number: null, query_id: null });
    expect(deductions.data.map((d) => d.period)).toEqual([...deductions.data.map((d) => d.period)].sort().reverse());
    // Bola has none, and Musa's are not hers.
    expect(s.EssDeductionPage.parse((await as("other").get("/ess/deductions")).body).data).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * Email a Copy and Email All
   * ---------------------------------------------------------------- */

  test("Email a Copy sends the person's own payslip to their work email, once a minute, and marks it emailed", async () => {
    const res = await as("other").post(`/ess/payslips/${(await payslipOf("other")).payslip_id}/email`);
    expect(res.status).toBe(200);
    expect(s.PayslipCopySent.parse(res.body)).toEqual({ sent: true });
    expect((await payslipOf("other")).emailed_at).not.toBeNull();
    await drain();

    expect(mailsQueued()).toHaveLength(1);
    const [, template, job, options] = mailsQueued()[0];
    const slip = await payslipOf("other");
    expect(template).toBe("payslip-ready");
    expect(job).toMatchObject({
      to: { name: "Bola Okoro", email: "other@mycity.test" },
      template: "payslip-ready",
      data: { period_label: "October 2026", number: slip.number, read_url: expect.stringMatching(/\/ess\?tab=my-payslips&id=/) },
      attachments: [{ document_id: slip.document_id }],
    });
    expect(options.jobId).toMatch(/^payslip-ready-/);
    // The mail says the month and where to read it, never an amount or a statutory word.
    const rendered = await systemMail.renderEmail(pool, "payslip-ready", job.data, { recipient: job.recipient });
    expect(rendered.subject).toBe("Your payslip for October 2026");
    expect(rendered.text).toContain("October 2026");
    expect(rendered.text).toContain(slip.number);
    expect(`${rendered.subject} ${rendered.text} ${rendered.html}`).not.toMatch(/₦|\d{1,3},\d{3}|\d\.\d{2}\b/);
    expect(`${rendered.subject} ${rendered.text}`).not.toMatch(STATUTORY);

    // Again within the minute is refused, and sends nothing; another person's is not hers.
    const again = await as("other").post(`/ess/payslips/${slip.payslip_id}/email`);
    expect([again.status, again.body.error.code]).toEqual([429, "EMAIL_TOO_SOON"]);
    expect((await as("other").post(`/ess/payslips/${ids.musaPayslip}/email`)).status).toBe(404);
    await drain();
    expect(mailsQueued()).toHaveLength(1);
  });

  test("Email All mails each published payslip once: those not yet emailed, nobody twice, and a resend takes every one", async () => {
    queues.enqueue.mockClear();
    const res = await as("ops").post(`/payroll/runs/${run}/email-payslips`, {});
    expect(res.status).toBe(202);
    // Bola was sent her copy a moment ago; the other four are queued, and the excluded person has no payslip to send.
    expect(c.payslips.PayslipEmailQueued.parse(res.body)).toEqual({ queued: 4 });
    await drain();
    expect(mailsQueued()).toHaveLength(4);
    const to = mailsQueued().map(([, , job]) => job.to.email).sort();
    expect(to).toEqual(["ceo@mycity.test", "mgmt@mycity.test", "ops@mycity.test", "staff@mycity.test"]);
    for (const [, , job] of mailsQueued()) expect(job.attachments).toEqual([{ document_id: expect.any(String) }]);
    expect((await q("SELECT count(*)::int AS n FROM payslip WHERE payroll_run_id = $1 AND emailed_at IS NOT NULL", [run])).rows[0].n).toBe(5);
    expect((await one("SELECT emailed_at FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2", [run, employeeId("left_out")])).emailed_at).toBeNull();
    expect(s.Payslip.parse((await as("ops").get(`/payslips?run_id=${run}&status=published`)).body.data[0]).emailed_at).not.toBeNull();

    // A repeat press sends nothing again.
    queues.enqueue.mockClear();
    const repeat = await as("ops").post(`/payroll/runs/${run}/email-payslips`, {});
    expect([repeat.status, c.payslips.PayslipEmailQueued.parse(repeat.body)]).toEqual([202, { queued: 0 }]);
    await drain();
    expect(mailsQueued()).toHaveLength(0);

    // Email Again takes every published payslip, once each.
    const resend = await as("ops").post(`/payroll/runs/${run}/email-payslips`, { resend: true });
    expect(c.payslips.PayslipEmailQueued.parse(resend.body)).toEqual({ queued: 5 });
    await drain();
    expect(mailsQueued()).toHaveLength(5);
    expect(new Set(mailsQueued().map(([, , , o]) => o.jobId)).size).toBe(5);
    await drain();
    expect(mailsQueued()).toHaveLength(5);

    // The events name people and counts, never an amount.
    const events = (await q(`SELECT event_key, payload FROM event_log WHERE event_key IN ('payslip.emailed', 'payroll_run.email_requested')`)).rows;
    expect(events.filter((e) => e.event_key === "payslip.emailed").length).toBe(1 + 4 + 5);
    for (const e of events) expect(JSON.stringify(e.payload)).not.toMatch(/amount|₦|\d\.\d{2}\b|net_pay|gross/);
  });

  test("a payslip whose PDF is still rendering is mailed on the handler's next attempt, and nobody is marked emailed for nothing", async () => {
    // One payslip's PDF goes back to pending, as if the worker had not reached it, and Email Again is pressed.
    const slip = await payslipOf("ops");
    await q("UPDATE document SET render_status = 'pending' WHERE document_id = $1", [slip.document_id]);
    queues.enqueue.mockClear();
    const res = await as("ops").post(`/payroll/runs/${run}/email-payslips`, { resend: true });
    expect(res.status).toBe(202);
    // One pass at a time, without bringing a retry forward: the four whose PDFs are done are mailed, the fifth waits.
    const settle = async () => {
      for (let i = 0; i < 10; i += 1) if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
    };
    await settle();
    expect(mailsQueued()).toHaveLength(4);
    const pressed = () => one("SELECT status, attempts, last_error FROM event_outbox WHERE event_key = 'payroll_run.email_requested' ORDER BY created_at DESC LIMIT 1");
    const waiting = await pressed();
    expect([waiting.status, waiting.attempts]).toEqual(["pending", 1]);
    expect(waiting.last_error).toMatch(/still being prepared/);
    // The worker finishes rendering; the next attempt mails the one that waited.
    await q("UPDATE document SET render_status = 'done' WHERE document_id = $1", [slip.document_id]);
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE event_key = 'payroll_run.email_requested' AND status = 'pending'");
    await settle();
    expect(mailsQueued()).toHaveLength(5);
    expect((await pressed()).status).toBe("done");
    // Nobody was mailed twice.
    expect(new Set(mailsQueued().map(([, , job]) => job.to.email)).size).toBe(5);
  });

  /* ---------------------------------------------------------------- *
   * Download All
   * ---------------------------------------------------------------- */

  test("Download All is one document of the run's published payslips, a page each, in staff-number order, kept as an export", async () => {
    const res = await as("ops").post(`/payroll/runs/${run}/payslips-export`, {});
    expect(res.status).toBe(202);
    const file = c.documents.ExportFile.parse(res.body);
    expect(file).toMatchObject({ status: "pending", file_name: "Payslips, October 2026.pdf" });

    const doc = await one("SELECT doc_type, sensitivity, uploaded_by, render_html, subject_employee_id, entity_type FROM document WHERE document_id = $1", [file.document_id]);
    expect(doc).toMatchObject({ doc_type: "payroll_payslips_export", sensitivity: "restricted", uploaded_by: people.ops.user.user_id, subject_employee_id: null, entity_type: "payroll_run" });
    // Staff-number order: the people were numbered in the order they were made, and a page each.
    const numbers = (await q("SELECT p.number::text AS number FROM payslip p JOIN employee e ON e.employee_id = p.employee_id WHERE p.payroll_run_id = $1 AND p.status = 'published' ORDER BY e.staff_number", [run])).rows.map((r) => r.number);
    const at = numbers.map((n) => doc.render_html.indexOf(n));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(doc.render_html.match(/class="pb-slip"/g)).toHaveLength(5);
    expect(doc.render_html).not.toContain("Left_out");
    expect(doc.render_html).not.toMatch(STATUTORY);

    // The person who pressed it waits on it and downloads it; nobody else does.
    expect((await as("ops").get(`/exports/${file.document_id}`)).body.status).toBe("pending");
    expect((await as("staff").get(`/exports/${file.document_id}`)).status).toBe(404);
    const rendered = await documents.renderPending(file.document_id, { db: pool });
    expect(rendered.locked_at).toBeNull();
    expect((await as("ops").get(`/exports/${file.document_id}`)).body.status).toBe("done");
    const pdf = await as("ops").get(`/documents/${file.document_id}/content`).buffer(true);
    expect([pdf.status, pdf.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect(pagesOf(pdf.body)).toBe(5);
    expect((await as("staff").get(`/documents/${file.document_id}/content`)).status).toBe(404);
    // It is an export: the clean-up job removes it a day later, like every other.
    expect(require("../../src/shared/documents/types").exportTypes()).toContain("payroll_payslips_export");

    // Management may export (a reader with `payroll` export) and so may the CEO.
    expect((await as("mgmt").post(`/payroll/runs/${run}/payslips-export`, {})).status).toBe(202);
    expect((await as("staff").post(`/payroll/runs/${run}/payslips-export`, {})).status).toBe(403);
  });

  test("Download All on My Payslips is the person's year, a page each; a year with none is refused", async () => {
    const res = await as("staff").post("/ess/payslips/export", { year: 2026 });
    expect(res.status).toBe(202);
    const file = c.documents.ExportFile.parse(res.body);
    expect(file.status).toBe("pending");
    const doc = await one("SELECT subject_employee_id, uploaded_by, render_html, title FROM document WHERE document_id = $1", [file.document_id]);
    expect(doc).toMatchObject({ subject_employee_id: employeeId("staff"), uploaded_by: people.staff.user.user_id, title: "My Payslips, 2026" });
    expect(doc.render_html).toContain("Musa Danjuma");
    expect(doc.render_html).not.toContain("Bola Okoro");
    await documents.renderPending(file.document_id, { db: pool });
    const pdf = await as("staff").get(`/documents/${file.document_id}/content`).buffer(true);
    expect([pdf.status, pagesOf(pdf.body)]).toEqual([200, 1]);
    const none = await as("staff").post("/ess/payslips/export", { year: 2025 });
    expect([none.status, none.body.error.code]).toEqual([409, "NO_PAYSLIPS"]);
  });

  /* ---------------------------------------------------------------- *
   * Masks
   * ---------------------------------------------------------------- */

  test("a Payroll reader whose role hides pay sees Restricted for money and is handed no PDF; their own payslip is not hidden from them", async () => {
    const ops = await one("SELECT role_id FROM role WHERE code = 'operations_people'");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.salary', 'masked') ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = 'masked'", [ops.role_id]);
    await grantsCache.invalidateGrants();
    try {
      const list = s.PayslipPage.parse((await as("ops").get(`/payslips?run_id=${run}`)).body);
      const mine = list.data.find((p) => p.employee.display_name === "Tunde Bakare");
      const theirs = list.data.find((p) => p.employee.display_name === "Musa Danjuma");
      expect(theirs).toMatchObject({ gross_pay: null, total_deductions: null, net_pay: null });
      expect(theirs.number).toMatch(/^PAY-/);
      expect(mine).toMatchObject({ gross_pay: "250000.00", net_pay: "250000.00" });
      const detail = s.PayslipDetail.parse((await as("ops").get(`/payslips/${ids.musaPayslip}`)).body);
      expect([detail.gross_monthly, detail.net_pay, ...detail.lines.map((l) => l.pay_amount)].every((v) => v === null)).toBe(true);
      expect(detail.lines).toHaveLength(8);
      const items = await as("ops").get(`/payslips/${ids.musaPayslip}/lines/${detail.lines.find((l) => l.code === "lateness").payslip_line_id}/items`);
      expect(items.body.data.every((i) => i.pay_amount === null)).toBe(true);

      // The documents carry the pay, so they are not handed out: not the payslip's PDF, not Download All, not the run's totals.
      const pdf = await as("ops").get(`/payslips/${ids.musaPayslip}/pdf`);
      expect([pdf.status, pdf.body.error.code]).toEqual([403, "FIELD_RESTRICTED"]);
      const all = await as("ops").post(`/payroll/runs/${run}/payslips-export`, {});
      expect([all.status, all.body.error.code]).toEqual([403, "FIELD_RESTRICTED"]);
      expect((await as("ops").get(`/payslips/${(await payslipOf("ops")).payslip_id}/pdf`).buffer(true)).status).toBe(200);
      // The person's own My Payslips is theirs, whatever their role hides.
      expect(s.PayslipDetail.parse((await as("staff").get(`/ess/payslips/${ids.musaPayslip}`)).body).net_pay).toBe("365076.93");
    } finally {
      await q("UPDATE field_visibility SET visibility = 'visible' WHERE role_id = $1 AND field_key = 'employee.salary'", [ops.role_id]);
      await grantsCache.invalidateGrants();
    }
  });

  test("the bank on a payslip is masked as the bank is, for a role that hides it", async () => {
    const ops = await one("SELECT role_id FROM role WHERE code = 'operations_people'");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.bank', 'masked') ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = 'masked'", [ops.role_id]);
    await grantsCache.invalidateGrants();
    try {
      const detail = s.PayslipDetail.parse((await as("ops").get(`/payslips/${ids.musaPayslip}`)).body);
      expect([detail.bank_name, detail.account_last4]).toEqual([null, null]);
      expect(detail.net_pay).toBe("365076.93");
      expect((await as("ops").get(`/payslips/${ids.musaPayslip}/pdf`)).status).toBe(403);
    } finally {
      await q("UPDATE field_visibility SET visibility = 'visible' WHERE role_id = $1 AND field_key = 'employee.bank'", [ops.role_id]);
      await grantsCache.invalidateGrants();
    }
  });

  test("a payslip is findable from ⌘K by its number and the person's name, by a Payroll reader, and shows no amount", async () => {
    const found = await as("ops").get("/search?q=musa%20danjuma");
    expect(found.status).toBe(200);
    const group = (found.body.groups || found.body.results || []).find((g) => g.type === "payslip" || g.label === "Payslips");
    expect(group).toBeTruthy();
    expect(JSON.stringify(group)).not.toMatch(/₦|\d,\d{3}/);
    expect((await as("staff").get("/search?q=musa%20danjuma")).body.groups?.some((g) => g.label === "Payslips") || false).toBe(false);
  });

  test("Mark Paid keeps the payslips readable and mailable: the pay date becomes the day paid, and the month's status is Paid", async () => {
    const today = lagos.today();
    const paid = await as("ops").post(`/payroll/runs/${run}/mark-paid`, { paid_on: today, payment_reference: "TRF-001" });
    expect(paid.status).toBe(200);
    const detail = s.PayslipDetail.parse((await as("staff").get(`/ess/payslips/${ids.musaPayslip}`)).body);
    expect([detail.run_status, detail.pay_date]).toEqual(["paid", today]);
    expect(s.PayslipPage.parse((await as("staff").get("/ess/payslips?year=2026")).body).data[0].run_status).toBe("paid");
    // A paid run is still out: Email All has nobody new to send to, the PDF opens and Download All is made again.
    queues.enqueue.mockClear();
    const again = await as("ops").post(`/payroll/runs/${run}/email-payslips`, {});
    expect([again.status, again.body]).toEqual([202, { queued: 0 }]);
    expect((await as("staff").get(`/ess/payslips/${ids.musaPayslip}/pdf`).buffer(true)).status).toBe(200);
    expect((await as("ops").post(`/payroll/runs/${run}/payslips-export`, {})).status).toBe(202);
    // Locked means locked: Email a Copy and the rest still answer, and nothing else on the run moves.
    expect((await as("ops").post(`/payroll/runs/${run}/compute`)).status).toBe(409);
  });

  test("approving 300 payslips requests 300 PDFs in the lock's transaction, measured", async () => {
    await q(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, gross_monthly, bank_name, account_number)
       SELECT 'M' || lpad(i::text, 4, '0'), 'Staff' || i, 'Member', 'staff' || i || '@mycity.test', 'Officer',
              (SELECT department_id FROM department LIMIT 1), 'full_time', 'on_site', 'active', '2026-01-05',
              150000 + (i % 50) * 5000, 'Test Bank', lpad(i::text, 10, '0')
         FROM generate_series(1, 300) AS i`,
    );
    const aug = c.payroll.PayrollRun.parse((await as("ops").post("/payroll/runs", { period: "2026-08-01" })).body);
    expect((await as("ops").post(`/payroll/runs/${aug.payroll_run_id}/compute`)).status).toBe(200);
    // The lock's own step: publish, then request every payslip's document, in one transaction.
    const pdf = require("../../src/modules/payslips/payslips.pdf");
    const started = process.hrtime.bigint();
    const requested = await tx(async (client) => {
      await client.query("UPDATE payslip SET status = 'published', published_at = now() WHERE payroll_run_id = $1 AND status = 'draft'", [aug.payroll_run_id]);
      return pdf.requestForRun(client, aug.payroll_run_id);
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (process.env.PAYROLL_MEASURE) process.stderr.write(`payroll: requesting ${requested} payslip PDFs took ${Math.round(ms)} ms\n`);
    expect(requested).toBeGreaterThanOrEqual(300);
    expect((await one("SELECT count(*)::int AS n FROM payslip p JOIN document d ON d.document_id = p.document_id WHERE p.payroll_run_id = $1 AND d.render_status = 'pending'", [aug.payroll_run_id])).n).toBe(requested);
    // A guard far past any real month, not a promise: the lock waits on this, so a slowdown shows here first.
    expect(ms).toBeLessThan(30_000);
  }, 180_000);
});

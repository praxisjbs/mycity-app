"use strict";
/**
 * Charts in the Overview, PR 4 on the real migrations (docs/guides/praxis-ai.md §6.13 Finance and pay,
 * §6.19 item 9): `expenses.summary`, `requisitions.summary`, `disbursements.summary`, `payroll.month`
 * widened, `payroll.trend`, `deductions.summary` and `my_pay.summary` answer with figures and never a row;
 * each reader's figures are their own audience's and scope's (a line manager their team's, staff their own,
 * the requests waiting on the person at their stage); requisitions and disbursements give no figures to a
 * reader without `expenses.finance`; pay is left out, never shown as zero, for a reader whose role hides
 * it, while a person's own pay is never hidden from them; payroll's summaries are refused to staff; a
 * series stops at 60 points; and every read of the area names its summary.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-finance
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person here is invented.
 */
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const authorise = require("../../src/shared/ai/authorise");
const registry = require("../../src/shared/ai/registry");
const engine = require("../../src/services/ai/engine");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const YEAR = Number(lagos.today().slice(0, 4));
const SEP = `${YEAR}-09-01`;
const OCT = `${YEAR}-10-01`;

describeDb("the finance and pay summaries against the real migrations", () => {
  let h;
  const cat = {};
  const req = {};

  const actor = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => {
    const out = await authorise.runSummary(pool, await actor(who), key, params);
    expect(() => c.assistant.AiSummaryResult.parse(out.result)).not.toThrow();
    expect(out.result).not.toHaveProperty("data");
    return out.result;
  };
  const figuresOf = (result) => Object.fromEntries(result.figures.map((f) => [f.key, f.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const employeeOf = (who) => h.people[who].employee_id;

  /** A request of `who`'s for one line of `amount`, sent unless `submit` is false. */
  const raise = async (who, category, amount, submit = true) => {
    const res = await h
      .as(who)
      .post("/expenses/mine")
      .send({
        purpose: `Test request for ${amount}`,
        expense_category_id: cat[category],
        lines: [{ description: "One item", quantity: "1", unit_price: amount }],
        payee_type: "vendor",
        payee_name: "Chuks Stores",
        bank_name: "GTBank",
        account_name: "Chuks Stores Ltd",
        account_number: "0123456789",
        submit,
      });
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    await drain();
    return res.body;
  };
  const decide = async (who, instanceId) => {
    const res = await h.as(who).post(`/workflow/instances/${instanceId}/approve`).send({});
    expect([who, res.status, res.body.error]).toEqual([who, 200, undefined]);
    await drain();
  };
  const instanceOf = async (id) => (await one("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [id])).workflow_instance_id;
  const maskPay = (code, visibility) =>
    q(
      `INSERT INTO field_visibility (role_id, field_key, visibility) SELECT role_id, 'employee.salary', $2 FROM role WHERE code = $1
       ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = $2`,
      [code, visibility],
    ).then(() => grantsCache.invalidateGrants());

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app } = buildApp({ strict: true, accessLog: false });
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "other", first: "Zainab", last: "Lawal", email: "other@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "outsider", first: "Bisi", last: "Ade", email: "outsider@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    for (const who of ["staff", "other"]) await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [employeeOf("manager"), employeeOf(who)]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [employeeOf("ceo"), [employeeOf("manager"), employeeOf("outsider")]]);
    await grantsCache.bumpTeamVersion();
    await q("DELETE FROM expense_category");
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(200);
    for (const r of (await pool.query("SELECT expense_category_id, name FROM expense_category")).rows) cat[r.name] = r.expense_category_id;

    // A: paid. B: authorised, not yet paid. C: waiting on the line manager. D: another person's draft. E: waiting on the CEO.
    req.a = await raise("staff", "Events and Activations", "100000.00");
    req.b = await raise("staff", "Travel and Transport", "50000.00");
    for (const r of [req.a, req.b]) {
      await decide("manager", await instanceOf(r.expense_request_id));
      await decide("ops", await instanceOf(r.expense_request_id));
    }
    const requisition = await h.as("ops").post("/requisitions").send({ expense_request_ids: [req.a.expense_request_id, req.b.expense_request_id] });
    expect([requisition.status, requisition.body.error]).toEqual([201, undefined]);
    await drain();
    await decide("ceo", requisition.body.workflow_instance_id);
    const paid = await h.as("ops").post("/disbursements").send({ expense_request_id: req.a.expense_request_id, payment_reference: "GT-0001", paid_on: lagos.today() });
    expect([paid.status, paid.body.error]).toEqual([201, undefined]);
    req.c = await raise("other", "Events and Activations", "30000.00");
    req.d = await raise("other", "Events and Activations", "20000.00", false);
    req.e = await raise("outsider", "Office and Admin", "40000.00");
    await drain();

    // Payroll: September paid and published, October computed (its payslips a preview), the other person excluded.
    const run = async (period, status, totals) =>
      (
        await one(
          `INSERT INTO payroll_run (number, period, status, headcount, earnings_total, deductions_total, net_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING payroll_run_id`,
          [`PAY-${period.slice(0, 7)}`, period, status, ...totals],
        )
      ).payroll_run_id;
    const slip = async (runId, who, status, gross, deductions, net) =>
      (
        await one(
          `INSERT INTO payslip (number, payroll_run_id, employee_id, status, excluded_reason, earnings_total, deductions_total, net_pay, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING payslip_id`,
          [`PS-${runId.slice(0, 8)}-${who}`, runId, employeeOf(who), status, status === "excluded" ? "Left in the month" : null, gross, deductions, net, status === "published" ? new Date() : null],
        )
      ).payslip_id;
    const line = (payslipId, position, code, label, amount) =>
      q(`INSERT INTO payslip_line (payslip_id, position, kind, code, label, amount) VALUES ($1, $2, 'deduction', $3, $4, $5)`, [payslipId, position, code, label, amount]);
    const sep = await run(SEP, "paid", [2, "400000.00", "40000.00", "360000.00"]);
    const staffSep = await slip(sep, "staff", "published", "200000.00", "25000.00", "175000.00");
    await line(staffSep, 1, "paye", "PAYE", "10000.00");
    await line(staffSep, 2, "fine", "Fine, QRY-0001", "15000.00");
    const opsSep = await slip(sep, "ops", "published", "200000.00", "15000.00", "185000.00");
    await line(opsSep, 1, "advance", "Salary advance, 1 of 3", "15000.00");
    const oct = await run(OCT, "computed", [2, "450000.00", "70000.00", "380000.00"]);
    await slip(oct, "staff", "draft", "200000.00", "20000.00", "180000.00");
    await slip(oct, "ops", "draft", "250000.00", "50000.00", "200000.00");
    await slip(oct, "other", "excluded", "0.00", "0.00", "0.00");

    // Deductions: a fine of the staff member's waiting for payroll; the other person's advance, its first month applied.
    const query = await one(`INSERT INTO employee_query (number, employee_id, subject, details) VALUES ('QRY-0001', $1, 'Subject', 'Details') RETURNING employee_query_id`, [employeeOf("staff")]);
    const sanction = await one(
      `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, ends_on, status, number)
       VALUES ($1, $2, 'fine', 'Test', $3, $4, $4, 'issued', 'SAN-T-1') RETURNING sanction_id`,
      [query.employee_query_id, employeeOf("staff"), h.people.ops.user_id, SEP],
    );
    await q(`INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, '9000.00', 'pending')`, [sanction.sanction_id]);
    const advance = await one(
      `INSERT INTO payroll_deduction (employee_id, source, reason, total_amount, instalments, start_period, status)
       VALUES ($1, 'salary_advance', 'School fees', '30000.00', 3, $2, 'active') RETURNING payroll_deduction_id`,
      [employeeOf("other"), SEP],
    );
    for (const [period, status] of [[SEP, "applied"], [OCT, "scheduled"], [`${YEAR}-11-01`, "scheduled"]])
      await q(`INSERT INTO payroll_deduction_instalment (payroll_deduction_id, period, amount, status) VALUES ($1, $2, '10000.00', $3)`, [advance.payroll_deduction_id, period, status]);
    await maskPay("operations_people", "visible");
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * expenses.summary
   * ---------------------------------------------------------------- */

  test("expenses.summary: the CEO's figures in naira, never a row; each category a stacked bar of Paid, Approved and Waiting; somebody else's draft left out", async () => {
    const result = await summaryOf("ceo", "expenses.summary");
    expect(figuresOf(result)).toMatchObject({ requests: 4, asked: "220000.00", approved: "50000.00", paid: "100000.00", waiting: 2, waiting_amount: "70000.00", sent_back: 0, rejected: 0 });
    expect(result.figures.find((f) => f.key === "asked").unit).toBe("ngn");
    expect(groupOf(result, "status").rows.map((r) => [r.label, r.count, r.value])).toEqual(
      expect.arrayContaining([["Paid", 1, "100000.00"], ["Authorised", 1, "50000.00"], ["Waiting", 2, "70000.00"]]),
    );
    const events = groupOf(result, "category").rows.find((r) => r.key === cat["Events and Activations"]);
    expect(events.parts.map((p) => [p.label, p.value])).toEqual([["Paid", "100000.00"], ["Approved", "0.00"], ["Waiting", "30000.00"]]);
    expect(events.value).toBe("130000.00");
    expect(groupOf(result, "requester").rows[0]).toMatchObject({ key: employeeOf("staff"), value: "150000.00", count: 2 });
    expect(result.series.map((s) => s.key)).toEqual(["asked", "paid"]);
    expect(result.series[1].points).toEqual([{ at: lagos.today().slice(0, 7), value: "100000.00" }]);

    // The stacked bar reaches the pane as one series a part.
    const o = engine.pane.overviewOf(
      { summary: "expenses.summary", figures: ["asked", "paid", "waiting_amount"], chart: { kind: "stacked_bar", title: "Requests by category", group: "category" } },
      [{ n: 1, key: "expenses.summary", kind: "summary", ok: true, result }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Paid", "Approved", "Waiting"]);
  });

  test("expenses.summary: a line manager's figures are their team's; mine is the person's own, drafts too; waiting_on_me is what waits at their stage", async () => {
    const team = figuresOf(await summaryOf("manager", "expenses.summary"));
    expect(team).toMatchObject({ requests: 3, asked: "180000.00", waiting: 1 });
    const mine = figuresOf(await summaryOf("other", "expenses.summary", { mine: true }));
    expect(mine).toMatchObject({ requests: 2, asked: "30000.00", waiting: 1 });
    const waiting = await summaryOf("manager", "expenses.summary", { waiting_on_me: true, by: "payee_type" });
    expect(figuresOf(waiting)).toMatchObject({ requests: 1, waiting: 1, waiting_amount: "30000.00" });
    expect(groupOf(waiting, "payee_type").rows.map((r) => r.label)).toEqual(["Vendor"]);
    expect(figuresOf(await summaryOf("ceo", "expenses.summary", { waiting_on_me: true }))).toMatchObject({ requests: 1, waiting_amount: "40000.00" });
    // Staff hold `expenses` view over their own: never another's.
    expect(figuresOf(await summaryOf("outsider", "expenses.summary"))).toMatchObject({ requests: 1, asked: "40000.00" });
    // A month with nothing sent in it has nothing.
    expect(figuresOf(await summaryOf("ceo", "expenses.summary", { month: `${YEAR - 1}-01` }))).toMatchObject({ requests: 0, asked: "0.00" });
  });

  /* ---------------------------------------------------------------- *
   * requisitions.summary and disbursements.summary
   * ---------------------------------------------------------------- */

  test("requisitions.summary and disbursements.summary: figures for a holder of expenses.finance, none for anyone else", async () => {
    const requisitions = await summaryOf("ops", "requisitions.summary");
    expect(figuresOf(requisitions)).toEqual({ requisitions: 1, requests: 2, total: "150000.00", waiting: 0, approved: 1, declined: 0 });
    expect(groupOf(requisitions, "status").rows).toEqual([expect.objectContaining({ label: "Approved", value: "150000.00", count: 1 })]);

    const disbursements = await summaryOf("ops", "disbursements.summary");
    expect(figuresOf(disbursements)).toMatchObject({ payments: 1, paid: "100000.00", reference_missing: 0, to_pay: 1, to_pay_amount: "50000.00" });
    expect(groupOf(disbursements, "category").rows).toEqual([expect.objectContaining({ key: cat["Events and Activations"], value: "100000.00", count: 1 })]);
    expect(figuresOf(await summaryOf("ops", "disbursements.summary", { reference_missing: true }))).toMatchObject({ payments: 0 });

    for (const who of ["manager", "staff"]) {
      expect(await summaryOf(who, "requisitions.summary")).toEqual({ figures: [], groups: [], series: [], total: 0 });
      expect(await summaryOf(who, "disbursements.summary")).toEqual({ figures: [], groups: [], series: [], total: 0 });
    }
  });

  test("disbursements.summary: amount paid by day stops at the newest 60 days", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 61 more paid requests, each paid a day apart, copied from the one paid above.
      await client.query(
        `INSERT INTO expense_request
         SELECT (jsonb_populate_record(NULL::expense_request, to_jsonb(er) || jsonb_build_object(
                   'expense_request_id', gen_random_uuid(), 'number', er.number || '-' || g, 'workflow_instance_id', NULL))).*
           FROM expense_request er, generate_series(1, 61) g WHERE er.expense_request_id = $1`,
        [req.a.expense_request_id],
      );
      await client.query(
        `INSERT INTO disbursement
         SELECT (jsonb_populate_record(NULL::disbursement, to_jsonb(ds) || jsonb_build_object(
                   'disbursement_id', gen_random_uuid(), 'number', ds.number || '-' || g, 'expense_request_id', er.expense_request_id,
                   'paid_on', ($2::date - g)::text, 'payment_reference', 'GT-' || g))).*
           FROM disbursement ds
           CROSS JOIN generate_series(1, 61) g
           JOIN expense_request er ON er.number = (SELECT number FROM expense_request WHERE expense_request_id = $1) || '-' || g
          WHERE ds.expense_request_id = $1`,
        [req.a.expense_request_id, lagos.today()],
      );
      const out = await authorise.runSummary(client, await actor("ops"), "disbursements.summary", { by: "day", from: lagos.addDays(lagos.today(), -100), to: lagos.today() });
      expect(figuresOf(out.result)).toMatchObject({ payments: 62 });
      expect(out.result.series[0].points).toHaveLength(60);
      expect(out.result.series[0].points[59].at).toBe(lagos.today());
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  /* ---------------------------------------------------------------- *
   * Payroll
   * ---------------------------------------------------------------- */

  test("payroll.month: the month's payslips by department, gross stacked as Net Pay and Deductions, and by status; its money in naira", async () => {
    const result = await summaryOf("ops", "payroll.month");
    expect(result.figures.map((f) => [f.key, f.unit])).toEqual([["headcount", "count"], ["gross", "ngn"], ["deductions", "ngn"], ["net", "ngn"]]);
    expect(result.groups.map((g) => g.by)).toEqual(["department", "status"]);
    expect(groupOf(result, "department").rows.map((r) => [r.label, r.value, r.parts.map((p) => [p.label, p.value])])).toEqual([
      ["Operations", "250000.00", [["Net Pay", "200000.00"], ["Deductions", "50000.00"]]],
      ["Programmes", "200000.00", [["Net Pay", "180000.00"], ["Deductions", "20000.00"]]],
    ]);
    expect(groupOf(result, "status").rows.map((r) => [r.label, r.count])).toEqual([["Preview", 2], ["Excluded", 1]]);
    expect((await summaryOf("ops", "payroll.month", { by: "status" })).groups.map((g) => g.by)).toEqual(["status", "department"]);
  });

  test("payroll.trend: runs, months paid and the latest run; people paid, gross, deductions and net by month from the approved and paid runs", async () => {
    const result = await summaryOf("ops", "payroll.trend");
    expect(figuresOf(result)).toEqual({ runs: 2, months_paid: 1, latest_month: `October ${YEAR}`, latest_status: "Computed" });
    expect(groupOf(result, "status").rows.map((r) => [r.label, r.count])).toEqual([["Computed", 1], ["Paid", 1]]);
    expect(result.series.map((s) => [s.key, s.points])).toEqual([
      ["headcount", [{ at: SEP.slice(0, 7), value: 2 }]],
      ["gross", [{ at: SEP.slice(0, 7), value: "400000.00" }]],
      ["deductions", [{ at: SEP.slice(0, 7), value: "40000.00" }]],
      ["net", [{ at: SEP.slice(0, 7), value: "360000.00" }]],
    ]);
    expect(figuresOf(await summaryOf("ops", "payroll.trend", { year: YEAR - 1 }))).toEqual({ runs: 0, months_paid: 0 });
  });

  test("deductions.summary: what the tab lists by source, status and department, with what is scheduled, recovered and owed on advances", async () => {
    const result = await summaryOf("ops", "deductions.summary");
    expect(figuresOf(result)).toEqual({ deductions: 2, amount: "39000.00", waiting: 1, waived: 0, scheduled: "20000.00", recovered: "10000.00", advances: "20000.00" });
    expect(result.groups.map((g) => g.by)).toEqual(["source", "status", "department"]);
    expect(groupOf(result, "source").rows.map((r) => [r.label, r.value, r.count])).toEqual([["Salary advances", "30000.00", 1], ["Fines", "9000.00", 1]]);
    expect(groupOf(result, "department").rows.map((r) => [r.label, r.value])).toEqual([["Programmes", "39000.00"]]);
    expect(result.series[0]).toMatchObject({ key: "amount", points: [{ at: SEP.slice(0, 7), value: "39000.00" }] });
    expect((await summaryOf("ops", "deductions.summary", { by: "department" })).groups[0].by).toBe("department");
    expect(figuresOf(await summaryOf("ops", "deductions.summary", { employee_id: employeeOf("staff") }))).toMatchObject({ deductions: 1, amount: "9000.00", advances: "0.00" });
  });

  test("a reader whose role hides pay gets counts, never an amount and never a zero in its place; a person's own pay is never hidden from them", async () => {
    await maskPay("operations_people", "masked");
    try {
      const month = await summaryOf("ops", "payroll.month");
      expect(month.figures.map((f) => f.key)).toEqual(["headcount"]);
      expect(groupOf(month, "department").rows.map((r) => [r.label, r.value, r.parts])).toEqual([
        ["Operations", 1, undefined],
        ["Programmes", 1, undefined],
      ]);
      const trend = await summaryOf("ops", "payroll.trend");
      expect(trend.series.map((s) => s.key)).toEqual(["headcount"]);
      const deductions = await summaryOf("ops", "deductions.summary");
      expect(deductions.figures.map((f) => f.key)).toEqual(["deductions", "waiting", "waived"]);
      expect(groupOf(deductions, "source").rows.map((r) => r.value)).toEqual([1, 1]);
      expect(deductions.series[0]).toMatchObject({ key: "deductions", points: [{ value: 2 }] });
      for (const result of [month, trend, deductions]) expect(JSON.stringify(result)).not.toMatch(/"\d+\.\d\d"/);
    } finally {
      await maskPay("operations_people", "visible");
    }
  });

  test("my_pay.summary: the person's own published payslips of the year, never masked from them; another person's never", async () => {
    // The Employee role hides salaries from others by default; the person's own figures still come.
    expect(await require("../../src/shared/rbac/field-mask").maskedKeysFor(pool, await actor("staff"))).toContain("employee.salary");
    const result = await summaryOf("staff", "my_pay.summary");
    expect(figuresOf(result)).toEqual({ payslips: 1, gross: "200000.00", deductions: "25000.00", net: "175000.00", fines: "15000.00", advances: "0.00" });
    expect(groupOf(result, "reason").rows.map((r) => [r.label, r.value])).toEqual([["Fines", "15000.00"], ["PAYE", "10000.00"]]);
    expect(result.series.map((s) => [s.key, s.points.length])).toEqual([["gross", 1], ["deductions", 1], ["net", 1]]);
    expect(figuresOf(await summaryOf("ops", "my_pay.summary"))).toMatchObject({ payslips: 1, advances: "15000.00" });
    expect(figuresOf(await summaryOf("other", "my_pay.summary"))).toMatchObject({ payslips: 0, gross: "0.00" });
  });

  test("payroll's summaries are refused to a role without payroll view; the person's own is offered to everyone", async () => {
    const staff = await actor("staff");
    for (const key of ["payroll.month", "payroll.trend", "deductions.summary"])
      await expect(authorise.runSummary(pool, staff, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    const offered = (await authorise.allowedSummaries(staff)).map((s) => s.key);
    expect(offered).toEqual(expect.arrayContaining(["expenses.summary", "my_pay.summary", "requisitions.summary", "disbursements.summary"]));
    expect(offered).not.toEqual(expect.arrayContaining(["payroll.trend"]));
  });

  test("every read of finance and pay names its summary", () => {
    const named = {
      "expenses.mine": "expenses.summary",
      "expenses.list": "expenses.summary",
      "expenses.approvals": "expenses.summary",
      "expense_categories.list": "expenses.summary",
      "requisitions.list": "requisitions.summary",
      "disbursements.list": "disbursements.summary",
      "deductions.list": "deductions.summary",
      "deductions.mine": "my_pay.summary",
      "payslips.mine": "my_pay.summary",
      "payroll.runs": "payroll.trend",
      "payslips.list": "payroll.month",
    };
    for (const [read, summary] of Object.entries(named)) expect([read, registry.read(read).summary]).toEqual([read, summary]);
  });
});

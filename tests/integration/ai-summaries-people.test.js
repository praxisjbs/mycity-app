"use strict";
/**
 * Charts in the Overview, PR 7 on the real migrations (docs/guides/praxis-ai.md §6.13 People,
 * performance and queries, §6.19 item 9): `exceptions.summary`, `pay_items.summary`,
 * `temporary_sites.summary`, `devices.summary`, `seats.summary`, `my_attendance.summary`,
 * `my_leave.summary`, `kpis.summary`, `scorecards.summary`, `commitments.summary`, `queries.summary` and
 * `sanctions.summary` answer with figures and never a row; a head of department's figures are their
 * team's (and, for queries and sanctions, the queries they raised); a member of staff without People is
 * refused People's; pay items' and fines' naira are left out, never zero, for a role that does not see
 * pay; the two `my_` summaries are the person's own; a part only some rows have is drawn only where one
 * does; a series stops at 60 points; the reads name their summaries.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-summaries-people
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

const SUMMARIES = [
  "exceptions.summary",
  "pay_items.summary",
  "temporary_sites.summary",
  "devices.summary",
  "seats.summary",
  "my_attendance.summary",
  "my_leave.summary",
  "kpis.summary",
  "scorecards.summary",
  "commitments.summary",
  "queries.summary",
  "sanctions.summary",
];
/** People's own: a member of staff holds no `people` grant. */
const PEOPLE = ["exceptions.summary", "pay_items.summary", "temporary_sites.summary", "devices.summary", "seats.summary"];

describeDb("People, performance and queries summaries against the real migrations", () => {
  let h;
  const dept = {};
  const id = {};
  const today = lagos.today();
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));

  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => (await authorise.runSummary(pool, await userOf(who), key, params)).result;
  const figuresOf = (result) => Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const partsOf = (row) => row.parts.map((p) => [p.label, p.value]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    const { app: server } = buildApp({ strict: true, accessLog: false });
    h = harness(server);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "head", first: "Kemi", last: "Alade", email: "head@mycity.test", job: "Head of Programmes", role: "head_of_department", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    const p = h.people;
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [p.head.employee_id])).department_id;
    dept.operations = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [p.ops.employee_id])).department_id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [p.head.employee_id, p.staff.employee_id]);
    await grantsCache.bumpTeamVersion();

    // Attendance: the staff member's three days this month (on time, late, absent), one of Ada's.
    const day = async (who, date, status, late = 0) =>
      (await one(
        `INSERT INTO attendance_day (employee_id, attendance_date, status, late_minutes, worked_minutes, overtime_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING attendance_day_id`,
        [p[who].employee_id, date, status, late, status === "absent" ? 0 : 480, who === "ops" ? 60 : 0],
      )).attendance_day_id;
    await day("staff", `${month}-01`, "present");
    const d2 = await day("staff", `${month}-02`, "late", 20);
    const d3 = await day("staff", `${month}-03`, "absent");
    const d4 = await day("ops", `${month}-01`, "present");

    // Three exceptions: the staff member's open and accepted, Ada's rejected.
    const exception = (dayId, type, status, outcome) =>
      q("INSERT INTO attendance_exception (attendance_day_id, exception_type, severity, status, outcome) VALUES ($1, $2, 'medium', $3, $4)", [dayId, type, status, outcome]);
    await exception(d2, "missing_clock_out", "open", null);
    await exception(d3, "outside_worksite", "resolved", "accepted");
    await exception(d4, "unknown_device", "resolved", "rejected");

    // Three pay items: the staff member's late (pending) and absence (waived), Ada's overtime (confirmed).
    const item = (who, date, kind, minutes, method, amount, status, confirmed = null) =>
      q(
        `INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status, confirmed_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p[who].employee_id, date, kind, minutes, method, amount, status, confirmed],
      );
    await item("staff", `${month}-02`, "late", 20, "pro_rata", "1500.00", "pending");
    await item("staff", `${month}-03`, "absence", 480, "daily_rate", "10000.00", "waived");
    await item("ops", `${month}-01`, "overtime", 90, "multiplier", "3000.00", "confirmed", 60);

    // Two temporary sites: the staff member's client visit in progress (three days), Ada's workshop waiting.
    const site = async (number, who, purpose, status, from, to) => {
      const s = await one(
        `INSERT INTO attendance_temporary_site (number, purpose, name, description, starts_on, ends_on, submitted_by, status)
         VALUES ($1, $2, $3, 'A site for the summaries suite', $4, $5, $6, $7) RETURNING temporary_site_id`,
        [number, purpose, `${number} venue`, from, to, p[who].user_id, status],
      );
      await q("INSERT INTO attendance_temporary_site_member (temporary_site_id, employee_id) VALUES ($1, $2)", [s.temporary_site_id, p[who].employee_id]);
    };
    await site("TS-0901", "staff", "client_visit", "approved", lagos.addDays(today, -1), lagos.addDays(today, 1));
    await site("TS-0902", "ops", "workshop", "submitted", lagos.addDays(today, 10), lagos.addDays(today, 11));

    // Three devices: the staff member's registered and new, Ada's removed.
    const device = async (who, label, status) => {
      const k = await one("INSERT INTO known_device (user_id, fingerprint_hash) VALUES ($1, $2) RETURNING known_device_id", [p[who].user_id, `hash-${label}`]);
      await q("INSERT INTO attendance_device (employee_id, known_device_id, label, status) VALUES ($1, $2, $3, $4)", [p[who].employee_id, k.known_device_id, label, status]);
    };
    await device("staff", "Musa's Phone", "registered");
    await device("staff", "Musa's Tablet", "observed");
    await device("ops", "Ada's Old Phone", "removed");

    // A department of its own for the seats: one open role (its head role, Ada reporting to it), one filled, one closed.
    dept.seats = (await one("INSERT INTO department (code, name) VALUES ('ST', 'Seats Test') RETURNING department_id")).department_id;
    const seat = async (title, status, filledBy = null) =>
      (await one("INSERT INTO org_seat (title, department_id, status, filled_by_employee_id) VALUES ($1, $2, $3, $4) RETURNING org_seat_id", [title, dept.seats, status, filledBy])).org_seat_id;
    id.openSeat = await seat("Seats Lead", "vacant");
    await seat("Seats Officer", "filled", p.staff.employee_id);
    await seat("Seats Driver", "closed");
    await q("UPDATE department SET head_seat_id = $1 WHERE department_id = $2", [id.openSeat, dept.seats]);
    await q("UPDATE employee SET line_manager_id = NULL, line_manager_seat_id = $1 WHERE employee_id = $2", [id.openSeat, p.ops.employee_id]);

    // Leave: the staff member's Annual taken today, booked ahead, waiting, and one last year.
    const annual = (await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'")).leave_type_id;
    const leave = (from, days, status) =>
      q("INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status) VALUES ($1, $2, $3, $4, $5, $6)", [
        p.staff.employee_id,
        annual,
        from,
        lagos.addDays(from, days - 1),
        days,
        status,
      ]);
    id.booked = lagos.addDays(today, 7);
    id.waiting = lagos.addDays(today, 14);
    await leave(today, 1, "approved");
    await leave(id.booked, 2, "approved");
    await leave(id.waiting, 3, "submitted");
    await leave(`${year - 1}-03-02`, 1, "approved");

    // KPIs: Programmes' two (met, not met), Operations' one with no result yet.
    const kpi = async (code, departmentId, result) => {
      const k = await one("INSERT INTO kpi_definition (code, name, department_id) VALUES ($1, $2, $3) RETURNING kpi_definition_id", [code, `${code} Measure`, departmentId]);
      if (result) await q("INSERT INTO kpi_month (kpi_definition_id, month, result) VALUES ($1, $2, $3)", [k.kpi_definition_id, `${month}-01`, result]);
    };
    await kpi("PG-K91", dept.programmes, "met");
    await kpi("PG-K92", dept.programmes, "not_met");
    await kpi("OP-K91", dept.operations, null);

    // Scorecards in one quarter: the staff member's agreed and scored, Ada's a draft with no score.
    id.period = (await one(
      `INSERT INTO performance_period (name, starts_on, ends_on, plan_year_starts_on, rules, status)
       VALUES ('Summaries Quarter', $1, $2, $3, '{}'::jsonb, 'active') RETURNING performance_period_id`,
      [`${year}-10-01`, `${year}-12-31`, `${year}-01-01`],
    )).performance_period_id;
    await q(
      `INSERT INTO scorecard (performance_period_id, employee_id, department_id, reviewer_employee_id, status, score_to_date, rating)
       VALUES ($1, $2, $3, $4, 'agreed', 0.8, 'meets')`,
      [id.period, p.staff.employee_id, dept.programmes, p.head.employee_id],
    );
    await q("INSERT INTO scorecard (performance_period_id, employee_id, department_id, status) VALUES ($1, $2, $3, 'draft')", [id.period, p.ops.employee_id, dept.operations]);

    // Commitments: the staff member's on time this month and missed last month, Ada's not yet approved.
    const lastMonth = lagos.addDays(`${month}-01`, -1).slice(0, 7);
    const commitment = (who, title, monthOf, due, status, done) =>
      q(
        `INSERT INTO task (title, created_by, primary_assignee_id, is_commitment, commitment_month, original_due_at, due_at, status, completed_at)
         VALUES ($1, $2, $3, true, $4, $5::timestamptz, $5::timestamptz, $6, CASE WHEN $7 THEN now() END)`,
        [title, p.ops.user_id, p[who].employee_id, `${monthOf}-01`, due, status, done],
      );
    await commitment("staff", "Deliver the venue list", month, new Date(Date.now() + 86_400_000).toISOString(), "done", true);
    await commitment("staff", "Close the September survey", lastMonth, `${lastMonth}-15T12:00:00Z`, "todo", false);
    await commitment("ops", "Draft the training plan", month, null, "todo", false);

    // Queries: one the head raised about the staff member (past its response time), one Ada raised and closed
    // with a sanction two days on, one a rule raised about Ada (under review).
    const query = async (number, who, raisedBy, status, extra = {}) =>
      (await one(
        `INSERT INTO employee_query (number, employee_id, subject, details, raised_by, source, status, outcome, response_due_at, reviewed_at, created_at)
         VALUES ($1, $2, 'A summaries subject', 'What happened, for the summaries suite.', $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
         RETURNING employee_query_id`,
        [number, p[who].employee_id, raisedBy, raisedBy ? "person" : "attendance", status, extra.outcome || null, extra.due || null, extra.reviewed || null, extra.created || null],
      )).employee_query_id;
    id.q1 = await query("QRY-0901", "staff", p.head.user_id, "awaiting_response", { due: new Date(Date.now() - 86_400_000).toISOString() });
    id.q2 = await query("QRY-0902", "staff", p.ops.user_id, "resolved", {
      outcome: "sanctioned",
      created: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      reviewed: new Date().toISOString(),
    });
    await query("QRY-0903", "ops", null, "under_review");

    // Sanctions on two steps of the chain: a written warning issued with a fine recovered, a verbal one waiting.
    const step = async (code, name, position) =>
      (await one("INSERT INTO consequence_step (code, name, position) VALUES ($1, $2, $3) RETURNING consequence_step_id", [code, name, position])).consequence_step_id;
    const verbal = await step("VW9", "Verbal Warning", 91);
    const written = await step("WW9", "Written Warning", 92);
    const sanction = async (queryId, stepId, status) =>
      (await one(
        `INSERT INTO sanction (employee_query_id, employee_id, consequence_step_id, sanction_type, reason, decided_by, effective_on, status, number)
         VALUES ($1, $2, $3, 'warning', 'For the summaries suite', $4, $5, $6, CASE WHEN $6 = 'issued' THEN 'SAN-0901' END) RETURNING sanction_id`,
        [queryId, p.staff.employee_id, stepId, p.ops.user_id, today, status],
      )).sanction_id;
    const issued = await sanction(id.q2, written, "issued");
    await sanction(id.q1, verbal, "pending_approval");
    await q("INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, '5000.00', 'settled')", [issued]);
    await drain();
  }, 180_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("each summary answers the CEO with figures and never a row", async () => {
    for (const key of SUMMARIES) {
      const res = await authorise.runSummary(pool, await userOf("ceo"), key, {});
      expect([key, c.assistant.AiSummaryResult.safeParse(res.result).success]).toEqual([key, true]);
      expect([key, "data" in res, "rows" in res.result]).toEqual([key, false, false]);
    }
  });

  test("exceptions.summary: by type stacked Open and Accepted with Rejected where some row has one, no Corrected; the head's are their team's", async () => {
    const all = await summaryOf("ops", "exceptions.summary");
    expect(figuresOf(all)).toMatchObject({ exceptions: 3, open: 1, accepted: 1, rejected: 1, corrected: 0, people: 2 });
    const types = groupOf(all, "type").rows;
    expect(types.map((r) => r.label).sort()).toEqual(["Missing Clock-Out", "Outside Worksite", "Unknown Device"]);
    expect(partsOf(types.find((r) => r.key === "unknown_device"))).toEqual([["Open", 0], ["Accepted", 0], ["Rejected", 1]]);
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Open", 1], ["Accepted", 1], ["Rejected", 1]]);
    expect(partsOf(groupOf(all, "department").rows.find((r) => r.key === dept.programmes))).toEqual([["Open", 1], ["Accepted", 1], ["Rejected", 0]]);
    // The parts reach the pane as a stacked bar, one series a part.
    const o = engine.pane.overviewOf(
      { summary: "exceptions.summary", figures: ["exceptions", "open", "accepted"], chart: { kind: "stacked_bar", title: "Exceptions by type", group: "type" } },
      [{ n: 1, key: "exceptions.summary", kind: "summary", ok: true, result: all }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Open", "Accepted", "Rejected"]);
    expect((await summaryOf("ops", "exceptions.summary", { by: "person" })).groups[0]).toMatchObject({ by: "person", label: "Exceptions by person" });
    expect((await summaryOf("ops", "exceptions.summary", { by: "week" })).series[0].label).toBe("Exceptions by week");
    expect((await summaryOf("head", "exceptions.summary")).total).toBe(2);
  });

  test("pay_items.summary: kinds, minutes and status; naira for a role that sees pay, left out, never zero, for one that does not", async () => {
    const all = await summaryOf("ops", "pay_items.summary");
    expect(figuresOf(all)).toMatchObject({ items: 3, late: 1, absence: 1, overtime: 1, deducted_minutes: 20, overtime_minutes: 60, pending: 1, waived: 1, confirmed: 1 });
    expect(figuresOf(all)).toMatchObject({ deducted_amount: "1500.00", overtime_amount: "3000.00" });
    expect(all.figures.find((x) => x.key === "deducted_amount").unit).toBe("ngn");
    const late = groupOf(all, "kind").rows.find((r) => r.key === "late");
    // Only the statuses some row has: no Cut or In Payroll.
    expect(partsOf(late)).toEqual([["Pending", 1], ["Waived", 0], ["Confirmed", 0]]);
    expect(groupOf(all, "department").rows.find((r) => r.key === dept.programmes).parts.map((x) => x.label)).toEqual(["Late", "Absence", "Overtime"]);
    expect(all.series.map((s) => s.label)).toEqual(["Minutes deducted by month", "Overtime minutes by month"]);
    const head = await summaryOf("head", "pay_items.summary");
    expect(head.total).toBe(2);
    expect(head.figures.map((x) => x.key)).toEqual(expect.arrayContaining(["items", "deducted_minutes"]));
    expect(head.figures.map((x) => x.key)).not.toContain("deducted_amount");
    expect(head.figures.map((x) => x.key)).not.toContain("overtime_amount");
    // By person, the minutes that count: Ada's 60 of overtime kept, the staff member's 20 late (the waived absence's never).
    expect((await summaryOf("ops", "pay_items.summary", { by: "person" })).groups[0].rows.map((r) => [r.label, r.value])).toEqual([["Ada Obi", 60], ["Musa Danjuma", 20]]);
  });

  test("temporary_sites.summary: by purpose and state, people on a site today and person-days; the head's are their team's", async () => {
    const all = await summaryOf("ops", "temporary_sites.summary");
    expect(figuresOf(all)).toMatchObject({ sites: 2, waiting: 1, in_progress: 1, on_site: 1, person_days: 3 });
    expect(groupOf(all, "purpose").rows.map((r) => r.label).sort()).toEqual(["Client Visit", "Workshop"]);
    expect(groupOf(all, "state").rows.map((r) => [r.label, r.value])).toEqual([["Awaiting Approval", 1], ["In Progress", 1]]);
    expect((await summaryOf("head", "temporary_sites.summary")).total).toBe(1);
  });

  test("devices.summary: by status, by department stacked Registered and New with Removed where some row has one, staff with none", async () => {
    const all = await summaryOf("ops", "devices.summary");
    expect(figuresOf(all)).toMatchObject({ devices: 3, registered: 1, observed: 1, removed: 1, people_registered: 1, none_registered: 3 });
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Registered", 1], ["New", 1], ["Removed", 1]]);
    expect(partsOf(groupOf(all, "department").rows.find((r) => r.key === dept.programmes))).toEqual([["Registered", 1], ["New", 1], ["Removed", 0]]);
    const head = await summaryOf("head", "devices.summary");
    expect(head.total).toBe(2);
    expect(partsOf(groupOf(head, "department").rows[0])).toEqual([["Registered", 1], ["New", 1]]);
  });

  test("seats.summary: open and filled by department, the closed apart, people reporting to an open role, an acting head", async () => {
    const one_ = await summaryOf("ops", "seats.summary", { department_id: dept.seats });
    expect(figuresOf(one_)).toEqual({ seats: 2, filled: 1, open: 1, closed: 1, reporting_to_open: 1, acting: 1 });
    expect(partsOf(groupOf(one_, "department").rows[0])).toEqual([["Filled", 1], ["Open", 1]]);
    expect(groupOf(one_, "status").rows.map((r) => [r.label, r.value])).toEqual([["Filled", 1], ["Open", 1], ["Closed", 1]]);
    expect((await summaryOf("ops", "seats.summary", { by: "status" })).groups[0].by).toBe("status");
  });

  test("my_attendance.summary: the person's own month by week stacked; someone else's days never counted; a series stops at 60 points", async () => {
    const mine = await summaryOf("staff", "my_attendance.summary", { month });
    expect(figuresOf(mine)).toMatchObject({ worked: 2, on_time: 1, late: 1, absent: 1, late_minutes: 20, deductions_pending: 1 });
    expect(groupOf(mine, "week").rows[0].parts.map((x) => x.label)).toEqual(["On Time", "Late", "Absent", "On Leave"]);
    expect(groupOf(mine, "week").rows.reduce((n, r) => n + r.value, 0)).toBe(3);
    // Ada's own month is hers: one day, an hour over, none of the staff member's.
    expect(figuresOf(await summaryOf("ops", "my_attendance.summary", { month }))).toMatchObject({ worked: 1, late: 0, absent: 0, overtime_minutes: 60 });
    // Seventy late days of the CEO's: the minutes-late series keeps the newest 60.
    await q(
      "INSERT INTO attendance_day (employee_id, attendance_date, status, late_minutes) SELECT $1, d::date, 'late', 5 FROM generate_series($2::date, $3::date, interval '1 day') d",
      [h.people.ceo.employee_id, lagos.addDays(today, -169), lagos.addDays(today, -100)],
    );
    const long = await summaryOf("ceo", "my_attendance.summary", { from: lagos.addDays(today, -169), to: lagos.addDays(today, -100) });
    expect(long.total).toBe(70);
    expect(long.series[0].points).toHaveLength(60);
    expect(long.series[0].points.at(-1).at).toBe(lagos.addDays(today, -100));
  });

  test("my_leave.summary: the person's own leave this year by type, every request unless a year is asked", async () => {
    const mine = await summaryOf("staff", "my_leave.summary");
    const f = figuresOf(mine);
    expect(f).toMatchObject({ requests: 4, waiting_requests: 1, taken: 1 });
    const sameYear = (d) => Number(d.slice(0, 4)) === year;
    if (sameYear(id.booked)) expect(f.booked).toBe(2);
    if (sameYear(id.waiting)) expect(f.waiting).toBe(3);
    const annual = groupOf(mine, "type").rows.find((r) => r.label === "Annual");
    expect(annual.parts.map((x) => x.label)).toEqual(["Taken", "Booked", "Waiting", "Left"]);
    // Annual's 20 days: what is used and what is left add up to the allowance.
    expect(annual.value).toBe(20);
    expect((await summaryOf("staff", "my_leave.summary", { year })).total).toBe(3);
    expect((await summaryOf("staff", "my_leave.summary", { year: year - 1 })).total).toBe(1);
    // Somebody else's leave is never theirs.
    expect((await summaryOf("ops", "my_leave.summary")).total).toBe(0);
  });

  test("my_leave.summary counts a request dated next year unless a year is asked: the matrix's probe day may fall in January (§6.17)", async () => {
    // Through the summary's own run, as the matrix counts it, so the summary cache never answers.
    const tool = registry.tool("my_leave.summary");
    const staff = await userOf("staff");
    const totalOf = async (params = {}) => (await tool.run(pool, tool.params.parse(params), { ...staff, scope: { scope: "own", scope_ids: [staff.employee_id] } })).total;
    const before = await totalOf();
    const unpaid = (await one("SELECT leave_type_id FROM leave_type WHERE code = 'unpaid'")).leave_type_id;
    await q("INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status) VALUES ($1, $2, $3, $3, 1, 'submitted')", [
      staff.employee_id,
      unpaid,
      `${year + 1}-01-05`,
    ]);
    expect(await totalOf()).toBe(before + 1);
    expect(await totalOf({ year })).toBe(3);
    expect(await totalOf({ year: year + 1 })).toBe(1);
  });

  test("kpis.summary: by function stacked by latest result, Not Entered where some row has one; the head reaches their function", async () => {
    const all = await summaryOf("ops", "kpis.summary");
    expect(figuresOf(all)).toMatchObject({ kpis: 3, met: 1, not_met: 1, not_entered: 1, met_share: 50 });
    expect(partsOf(groupOf(all, "function").rows.find((r) => r.key === dept.programmes))).toEqual([["Met", 1], ["Not Met", 1], ["Not Entered", 0]]);
    expect(all.series[0].points).toEqual([{ at: month, value: 50 }]);
    expect((await summaryOf("ops", "kpis.summary", { by: "result" })).groups[0].by).toBe("result");
    expect((await summaryOf("head", "kpis.summary")).total).toBe(2);
  });

  test("scorecards.summary: by status, the average score by department over scored ones, by rating; the head's name them", async () => {
    const all = await summaryOf("ops", "scorecards.summary", { period_id: id.period });
    expect(figuresOf(all)).toMatchObject({ scorecards: 2, draft: 1, agreed: 1, rated: 1, average_score: 80 });
    // Operations has no score yet, so it is left out of the averages, never 0.
    expect(groupOf(all, "department").rows).toEqual([expect.objectContaining({ key: dept.programmes, value: 80, count: 1 })]);
    expect(groupOf(all, "rating").rows.map((r) => [r.label, r.value])).toEqual([["Meets", 1]]);
    expect(groupOf(await summaryOf("ops", "scorecards.summary", { by: "reviewer" }), "reviewer").rows[0].label).toBe("Kemi Alade");
    expect((await summaryOf("head", "scorecards.summary")).total).toBe(1);
  });

  test("commitments.summary: by state, by department stacked, the on-time rate, a month asked narrows it", async () => {
    const all = await summaryOf("ops", "commitments.summary");
    expect(figuresOf(all)).toMatchObject({ commitments: 3, awaiting_approval: 1, on_time: 1, missed: 1, on_time_rate: 50 });
    expect(partsOf(groupOf(all, "department").rows.find((r) => r.key === dept.programmes))).toEqual([["Due", 0], ["On Time", 1], ["Late", 0], ["Missed", 1]]);
    expect(all.series.map((s) => s.label)).toEqual(["Due by week", "On time by week"]);
    expect((await summaryOf("ops", "commitments.summary", { month })).total).toBe(2);
    expect((await summaryOf("head", "commitments.summary")).total).toBe(2);
  });

  test("queries.summary: by status and department stacked, past the response time, days to close; the head sees the ones they raised", async () => {
    const all = await summaryOf("ops", "queries.summary");
    expect(figuresOf(all)).toMatchObject({ queries: 3, awaiting_response: 1, overdue: 1, under_review: 1, resolved: 1, sanctioned: 1, days_to_close: 2 });
    expect(partsOf(groupOf(all, "department").rows.find((r) => r.key === dept.programmes))).toEqual([["Awaiting Response", 1], ["Under Review", 0], ["Closed", 1]]);
    const byRule = groupOf(await summaryOf("ops", "queries.summary", { by: "rule" }), "rule").rows.map((r) => r.label).sort();
    expect(byRule).toEqual(["Attendance Policy", "Raised by a Person"]);
    expect((await summaryOf("head", "queries.summary")).total).toBe(1);
    expect((await summaryOf("staff", "queries.summary")).total).toBe(0);
  });

  test("sanctions.summary: by step in the chain's order, stacked; fines in naira only for a role that sees pay", async () => {
    const all = await summaryOf("ops", "sanctions.summary");
    expect(figuresOf(all)).toMatchObject({ sanctions: 2, issued: 1, pending_approval: 1, in_force: 1, fines: 1, fines_amount: "5000.00", fines_recovered: "5000.00" });
    const steps = groupOf(all, "step").rows;
    expect(steps.map((r) => r.label)).toEqual(["Verbal Warning", "Written Warning"]);
    expect(partsOf(steps[0])).toEqual([["Issued", 0], ["Awaiting Approval", 1]]);
    const head = await summaryOf("head", "sanctions.summary");
    expect(head.total).toBe(1);
    expect(head.figures.map((x) => x.key)).toContain("fines");
    expect(head.figures.map((x) => x.key)).not.toContain("fines_amount");
  });

  test("a period narrows a summary only when asked: a month long past counts nothing", async () => {
    const lastYear = `${year - 1}-01`;
    for (const key of ["exceptions.summary", "pay_items.summary", "temporary_sites.summary", "queries.summary", "sanctions.summary"])
      expect([key, (await summaryOf("ops", key, { month: lastYear })).total]).toEqual([key, 0]);
  });

  test("a member of staff without People is refused People's summaries, and offered their own", async () => {
    const staff = await userOf("staff");
    for (const key of PEOPLE) await expect(authorise.runSummary(pool, staff, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    const offered = (await authorise.allowedSummaries(staff)).map((s) => s.key);
    expect(offered).toEqual(expect.arrayContaining(["my_attendance.summary", "my_leave.summary"]));
  });

  test("every read names its summary: the people, performance and queries lists name theirs, and none waits in the gaps file", () => {
    const named = {
      "attendance.exceptions": "exceptions.summary",
      "attendance.pay_items": "pay_items.summary",
      "attendance.temporary_sites": "temporary_sites.summary",
      "attendance.my_days": "my_attendance.summary",
      "attendance.my_pay_items": "my_attendance.summary",
      "devices.list": "devices.summary",
      "seats.list": "seats.summary",
      "my_leave.list": "my_leave.summary",
      "kpis.list": "kpis.summary",
      "scorecards.list": "scorecards.summary",
      "commitments.list": "commitments.summary",
      "queries.list": "queries.summary",
      "sanctions.list": "sanctions.summary",
    };
    for (const [read, summary] of Object.entries(named)) expect([read, registry.read(read).summary]).toEqual([read, summary]);
    const gaps = require("../../scripts/check/ai-summary-gaps.json").gaps.map((g) => g.read);
    expect(gaps.filter((r) => r in named)).toEqual([]);
  });
});

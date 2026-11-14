"use strict";
/**
 * Charts in the Overview, PR 7 on the real migrations (docs/guides/praxis-ai.md §6.13 People, performance and
 * queries, §6.19 item 9): `exceptions.summary`, `pay_items.summary`, `temporary_sites.summary`,
 * `devices.summary`, `seats.summary`, `my_attendance.summary`, `my_leave.summary`, `kpis.summary`,
 * `scorecards.summary`, `commitments.summary`, `queries.summary` and `sanctions.summary` answer with figures
 * and never a row; a head of department's figures are their reach's (their team, the functions they read,
 * the queries they raised); a role without the grant is refused; pay items' amounts and sanctions' fines are
 * left out, never zero, for a role that does not see pay; a person's own two are theirs alone; a part only
 * some rows have is drawn only where one does; the reads name their summaries.
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
const workingWeek = require("../../src/shared/time/working-week");
const leave = require("../../src/modules/leave/leave.service");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const PEOPLE_VIEW = ["exceptions.summary", "pay_items.summary", "temporary_sites.summary", "devices.summary", "seats.summary"];
const OWN = ["my_attendance.summary", "my_leave.summary"];
const PERFORMANCE = ["kpis.summary", "scorecards.summary", "commitments.summary"];
const QUERIES = ["queries.summary", "sanctions.summary"];
const SUMMARIES = [...PEOPLE_VIEW, ...OWN, ...PERFORMANCE, ...QUERIES];

describeDb("People, performance and queries summaries against the real migrations", () => {
  let h;
  const dept = {};
  let leaveDay = null;

  const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const summaryOf = async (who, key, params = {}) => (await authorise.runSummary(pool, await userOf(who), key, params)).result;
  const figuresOf = (result) => Object.fromEntries(result.figures.map((x) => [x.key, x.value]));
  const groupOf = (result, by) => result.groups.find((g) => g.by === by);
  const emp = (who) => h.people[who].employee_id;
  const today = lagos.today();
  const day = (n) => lagos.addDays(today, n);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = lagos.monthBounds(lagos.addDays(thisMonth, -1)).first;

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
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [emp("head")])).department_id;
    dept.operations = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [emp("ops")])).department_id;
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("staff")]);
    await grantsCache.bumpTeamVersion();

    // Attendance: the field officer late on one day and present the next; Ada present.
    const dayOf = async (who, date, status, late = 0) =>
      (await one("INSERT INTO attendance_day (employee_id, attendance_date, status, late_minutes, worked_minutes) VALUES ($1, $2, $3, $4, 480) RETURNING attendance_day_id", [emp(who), date, status, late]))
        .attendance_day_id;
    const staffLate = await dayOf("staff", day(-2), "late", 15);
    await dayOf("staff", day(-1), "present");
    const opsDay = await dayOf("ops", day(-2), "present");
    // Three exceptions: one waiting and one accepted of the field officer's, one of Ada's rejected.
    const exception = (dayId, type, status, outcome) =>
      q("INSERT INTO attendance_exception (attendance_day_id, exception_type, severity, status, outcome) VALUES ($1, $2, 'medium', $3, $4)", [dayId, type, status, outcome]);
    await exception(staffLate, "missing_clock_out", "open", null);
    await exception(staffLate, "outside_worksite", "resolved", "accepted");
    await exception(opsDay, "unknown_device", "resolved", "rejected");
    // Pay items: the field officer's late minutes pending and overtime confirmed; Ada's absence waived.
    const item = (who, date, kind, minutes, amount, status) =>
      q("INSERT INTO attendance_pay_item (employee_id, work_date, kind, minutes, method, amount, status) VALUES ($1, $2, $3, $4, 'pro_rata', $5, $6)", [emp(who), date, kind, minutes, amount, status]);
    await item("staff", day(-2), "late", 15, "1500.00", "pending");
    await item("staff", day(-1), "overtime", 60, "4000.00", "confirmed");
    await item("ops", day(-2), "absence", 480, "10000.00", "waived");

    // Two temporary sites: a client visit in progress with the field officer and the head on it, Ada's event waiting.
    const site = async (number, purpose, by, status, from, to, members) => {
      const s = await one(
        `INSERT INTO attendance_temporary_site (number, purpose, name, description, starts_on, ends_on, status, submitted_by)
         VALUES ($1, $2, $3, 'A summary suite visit, written long enough to pass.', $4, $5, $6, $7) RETURNING temporary_site_id`,
        [number, purpose, `Site ${number}`, from, to, status, h.people[by].user_id],
      );
      for (const who of members) await q("INSERT INTO attendance_temporary_site_member (temporary_site_id, employee_id) VALUES ($1, $2)", [s.temporary_site_id, emp(who)]);
    };
    await site("TS-0901", "client_visit", "staff", "approved", day(-1), day(1), ["staff", "head"]);
    await site("TS-0902", "event", "ops", "submitted", day(10), day(11), ["ops"]);

    // Devices: the field officer's registered, Ada's new; nobody else has one.
    const device = async (who, label, status) => {
      const k = await one("INSERT INTO known_device (user_id, fingerprint_hash) VALUES ($1, $2) RETURNING known_device_id", [h.people[who].user_id, `hash-${who}-${label}`]);
      await q("INSERT INTO attendance_device (employee_id, known_device_id, label, status) VALUES ($1, $2, $3, $4)", [emp(who), k.known_device_id, label, status]);
    };
    await device("staff", "Musa's phone", "registered");
    await device("ops", "Ada's laptop", "observed");

    // Seats: a new department whose head role is vacant, so someone above acts for it.
    const research = await one("INSERT INTO department (code, name) VALUES ('RSH', 'Research') RETURNING department_id");
    dept.research = research.department_id;
    const seat = await one("INSERT INTO org_seat (title, department_id) VALUES ('Head of Research', $1) RETURNING org_seat_id", [dept.research]);
    await q("INSERT INTO org_seat (title, department_id) VALUES ('Research Officer', $1)", [dept.research]);
    await q("UPDATE department SET head_seat_id = $1 WHERE department_id = $2", [seat.org_seat_id, dept.research]);

    // Leave: the field officer asks for a working day ahead, through Request Leave's own service.
    const calendar = await workingWeek.loadCalendar(pool);
    leaveDay = day(14);
    while (!workingWeek.isWorkingDay(leaveDay, calendar)) leaveDay = lagos.addDays(leaveDay, 1);
    const annual = await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'");
    await leave.request(await userOf("staff"), emp("staff"), { leave_type_id: annual.leave_type_id, starts_on: leaveDay, ends_on: leaveDay, reason: "A day for the summaries suite" });

    // KPIs: Programmes' two (one met this month, one not entered), Operations' one not met.
    const kpi = async (code, department, result) => {
      const k = await one("INSERT INTO kpi_definition (code, name, department_id) VALUES ($1, $2, $3) RETURNING kpi_definition_id", [code, `KPI ${code}`, department]);
      if (result) await q("INSERT INTO kpi_month (kpi_definition_id, month, result) VALUES ($1, $2, $3)", [k.kpi_definition_id, thisMonth, result]);
    };
    await kpi("PRG-K01", dept.programmes, "met");
    await kpi("PRG-K02", dept.programmes, null);
    await kpi("OPS-K01", dept.operations, "not_met");

    // Scorecards in a quarter: the field officer's agreed, reviewed by the head; Ada's a draft.
    const period = await h.as("ops").post("/performance/periods").send({ starts_on: "2026-10-01" });
    if (period.status !== 201) throw new Error(`the quarter: ${period.status} ${JSON.stringify(period.body)}`);
    const card = (who, department, reviewer, status, score, rating) =>
      q(
        `INSERT INTO scorecard (performance_period_id, employee_id, department_id, reviewer_employee_id, status, score_to_date, rating)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [period.body.performance_period_id, emp(who), department, reviewer ? emp(reviewer) : null, status, score, rating],
      );
    await card("staff", dept.programmes, "head", "agreed", "0.825", "meets");
    await card("ops", dept.operations, "ceo", "draft", null, null);

    // Commitments: the field officer's on time and due this month and one missed last month; Ada's late.
    const commitment = (who, month, due, completed) =>
      q(
        `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at, completed_at, is_commitment, commitment_month, original_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $5)`,
        [`Commitment of ${who}`, completed ? "done" : "todo", h.people[who].user_id, emp(who), due, completed, month],
      );
    const at = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
    await commitment("staff", thisMonth, at(2), at(0));
    await commitment("staff", thisMonth, at(3), null);
    await commitment("staff", lastMonth, `${lagos.addDays(thisMonth, -3)}T09:00:00Z`, null);
    await commitment("ops", thisMonth, at(-3), at(0));

    // Queries: the head's about the field officer, past its response time; Ada's under review with a sanction
    // waiting; a rule's, closed with a fine issued.
    const query = async (number, about, by, status, extra = {}) =>
      one(
        `INSERT INTO employee_query (number, employee_id, subject, details, raised_by, status, response_due_at, source, outcome)
         VALUES ($1, $2, 'Subject', 'Details', $3, $4, now() - interval '1 day', $5, $6) RETURNING employee_query_id`,
        [number, emp(about), by ? h.people[by].user_id : null, status, extra.source || "person", extra.outcome || null],
      );
    await query("QRY-0901", "staff", "head", "awaiting_response");
    const opsQuery = await query("QRY-0902", "staff", "ops", "under_review");
    const ruleQuery = await query("QRY-0903", "ops", null, "resolved", { source: "rule", outcome: "sanctioned" });
    const sanction = (queryId, about, status, number) =>
      one(
        `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, ends_on, status, number)
         VALUES ($1, $2, 'warning', 'For the summaries suite', $3, $4, $4, $5, $6) RETURNING sanction_id`,
        [queryId, emp(about), h.people.ops.user_id, today, status, number],
      );
    await sanction(opsQuery.employee_query_id, "staff", "pending_approval", null);
    const fined = await sanction(ruleQuery.employee_query_id, "ops", "issued", "SAN-0901");
    await q("INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, '5000.00', 'accepted')", [fined.sanction_id]);
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

  test("exceptions.summary: by type stacked by where each stands, Corrected left out where no row has one; the head's are their team's", async () => {
    const all = await summaryOf("ceo", "exceptions.summary");
    expect(figuresOf(all)).toMatchObject({ exceptions: 3, waiting: 1, accepted: 1, corrected: 0, rejected: 1, people: 2 });
    const missing = groupOf(all, "type").rows.find((r) => r.key === "missing_clock_out");
    expect(missing.label).toBe("Missing Clock-Out");
    expect(missing.parts.map((p) => [p.label, p.value])).toEqual([["Waiting", 1], ["Accepted", 0], ["Rejected", 0]]);
    expect(groupOf(all, "status").rows.map((r) => [r.label, r.value])).toEqual([["Waiting", 1], ["Accepted", 1], ["Rejected", 1]]);
    expect(groupOf(all, "department").rows.find((r) => r.key === dept.programmes).value).toBe(2);
    const byPerson = await summaryOf("ceo", "exceptions.summary", { by: "person" });
    expect(groupOf(byPerson, "person").rows[0]).toMatchObject({ label: "Musa Danjuma", value: 2 });
    expect((await summaryOf("ceo", "exceptions.summary", { by: "week" })).series[0].label).toBe("Exceptions by week");
    expect((await summaryOf("head", "exceptions.summary")).total).toBe(2);
  });

  test("pay_items.summary: kinds and minutes, by kind stacked by status; amounts for a role that sees pay, left out for one that does not", async () => {
    const all = await summaryOf("ops", "pay_items.summary");
    expect(figuresOf(all)).toMatchObject({ items: 3, late: 1, absence: 1, overtime: 1, deduction_minutes: 495, overtime_minutes: 60, pending: 1, deduction_amount: "1500.00", overtime_amount: "4000.00" });
    const late = groupOf(all, "kind").rows.find((r) => r.key === "late");
    expect(late.parts.map((p) => p.label)).toEqual(["Pending", "Waived", "Confirmed"]);
    expect(all.series.map((s) => s.key)).toEqual(["deduction_minutes", "overtime_minutes"]);
    const head = await summaryOf("head", "pay_items.summary");
    expect(head.total).toBe(2);
    expect(head.figures.map((x) => x.key)).not.toContain("deduction_amount");
    expect(head.figures.map((x) => x.key)).not.toContain("overtime_amount");
  });

  test("temporary_sites.summary: by purpose and state, who is on a site today and the person-days; the head's are those with their team on them", async () => {
    const all = await summaryOf("ceo", "temporary_sites.summary");
    expect(figuresOf(all)).toMatchObject({ sites: 2, submitted: 1, in_progress: 1, on_site: 2, person_days: 6 });
    expect(groupOf(all, "purpose").rows.map((r) => r.label).sort()).toEqual(["Client Visit", "Event"]);
    expect(groupOf(all, "state").rows.map((r) => [r.label, r.value])).toEqual([["Awaiting Approval", 1], ["In Progress", 1]]);
    expect((await summaryOf("head", "temporary_sites.summary")).total).toBe(1);
  });

  test("devices.summary: by department stacked Registered and New with no Removed part; who has none registered", async () => {
    const all = await summaryOf("ceo", "devices.summary");
    expect(figuresOf(all)).toMatchObject({ devices: 2, registered: 1, observed: 1, removed: 0, people_registered: 1 });
    expect(figuresOf(all).none_registered).toBeGreaterThanOrEqual(3);
    const operations = groupOf(all, "department").rows.find((r) => r.key === dept.operations);
    expect(operations.parts.map((p) => [p.label, p.value])).toEqual([["Registered", 0], ["New", 1]]);
    const head = await summaryOf("head", "devices.summary");
    expect([head.total, figuresOf(head).none_registered]).toEqual([1, 1]);
  });

  test("seats.summary: the whole structure by status and department, and a head role left vacant", async () => {
    const seats = (await one("SELECT count(*)::int AS n FROM org_seat")).n;
    const all = await summaryOf("ceo", "seats.summary");
    expect(all.total).toBe(seats);
    expect(figuresOf(all).acting).toBe(1);
    const research = groupOf(all, "department").rows.find((r) => r.key === dept.research);
    expect(research.parts.map((p) => [p.label, p.value])).toEqual(expect.arrayContaining([["Filled", 0], ["Vacant", 2]]));
    // Every `people` reader reads the same structure, as seats.list.
    expect((await summaryOf("head", "seats.summary")).total).toBe(seats);
  });

  test("my_attendance.summary: the person's own days stacked by week, minutes late by day, their overtime and pending deduction; nobody else's", async () => {
    const mine = await summaryOf("staff", "my_attendance.summary", { from: day(-2), to: today });
    expect(figuresOf(mine)).toMatchObject({ days: 2, on_time: 1, late: 1, late_minutes: 15, overtime_minutes: 60, deductions_pending: 1, pending_amount: "1500.00" });
    const weeks = groupOf(mine, "week").rows;
    expect(weeks[0].parts.map((p) => p.label)).toEqual(["On Time", "Late", "Absent", "On Leave"]);
    expect(weeks.reduce((n, w) => n + w.value, 0)).toBe(2);
    expect(mine.series[0].points).toEqual([{ at: day(-2), value: 15 }]);
    const ceo = await summaryOf("ceo", "my_attendance.summary", { from: day(-2), to: today });
    expect(ceo.total).toBe(0);
  });

  test("my_leave.summary: the person's own year by type, stacked Taken, Booked, Waiting and Left; nobody else's", async () => {
    const year = Number(leaveDay.slice(0, 4));
    const mine = await summaryOf("staff", "my_leave.summary", { year });
    expect(mine.total).toBe(1);
    const annual = groupOf(mine, "type").rows.find((r) => r.label === "Annual");
    expect(annual.parts.map((p) => [p.label, p.value])).toEqual([["Taken", 0], ["Booked", 0], ["Waiting", 1], ["Left", 19]]);
    expect(figuresOf(mine).pending).toBe(1);
    expect((await summaryOf("ops", "my_leave.summary", { year })).total).toBe(0);
  });

  test("kpis.summary: by function stacked Met, Not Met, N/A and Not Entered, met as a per cent; the head's are their function's", async () => {
    const all = await summaryOf("ceo", "kpis.summary");
    expect(figuresOf(all)).toMatchObject({ kpis: 3, met: 1, not_met: 1, not_entered: 1, met_rate: 50 });
    const programmes = groupOf(all, "function").rows.find((r) => r.key === dept.programmes);
    expect(programmes.parts.map((p) => [p.label, p.value])).toEqual([["Met", 1], ["Not Met", 0], ["N/A", 0], ["Not Entered", 1]]);
    expect(all.series[0].points).toEqual([{ at: thisMonth.slice(0, 7), value: 50 }]);
    const head = await summaryOf("head", "kpis.summary");
    expect(head.total).toBe(2);
  });

  test("scorecards.summary: by status, the average score by department, by rating; the head's are their team's and those they review", async () => {
    const all = await summaryOf("ceo", "scorecards.summary");
    expect(figuresOf(all)).toMatchObject({ scorecards: 2, draft: 1, agreed: 1, average: 82.5, below: 0 });
    // A department with none scored is left out, never 0.
    expect(groupOf(all, "department").rows).toEqual([expect.objectContaining({ key: dept.programmes, value: 82.5, count: 1 })]);
    expect(groupOf(all, "rating").rows.map((r) => [r.label, r.value])).toEqual([["Meets", 1]]);
    expect((await summaryOf("ceo", "scorecards.summary", { by: "reviewer" })).groups[0].rows[0].label).toBe("Kemi Alade");
    expect((await summaryOf("head", "scorecards.summary")).total).toBe(1);
  });

  test("commitments.summary: the month by person stacked, the on-time rate, last month's missed when asked; the head's are their team's", async () => {
    const all = await summaryOf("ceo", "commitments.summary");
    expect(figuresOf(all)).toMatchObject({ commitments: 3, due: 1, on_time: 1, late: 1, missed: 0, on_time_rate: 50 });
    const musa = groupOf(all, "person").rows.find((r) => r.key === emp("staff"));
    expect(musa.parts.map((p) => [p.label, p.value])).toEqual([["Due", 1], ["On Time", 1], ["Late", 0], ["Missed", 0]]);
    const before = await summaryOf("ceo", "commitments.summary", { month: lastMonth.slice(0, 7) });
    expect(figuresOf(before)).toMatchObject({ commitments: 1, missed: 1 });
    expect((await summaryOf("head", "commitments.summary")).total).toBe(2);
  });

  test("queries.summary: by department stacked by status, past the response time, escalated; anyone below scope all sees only what they raised", async () => {
    const all = await summaryOf("ceo", "queries.summary");
    expect(figuresOf(all)).toMatchObject({ queries: 3, awaiting_response: 1, overdue: 1, under_review: 1, escalated: 1, resolved: 1, sanctioned: 1 });
    const programmes = groupOf(all, "department").rows.find((r) => r.key === dept.programmes);
    expect(programmes.parts.map((p) => [p.label, p.value])).toEqual([["Awaiting Response", 1], ["Under Review", 1], ["Closed", 0]]);
    const byRule = await summaryOf("ceo", "queries.summary", { by: "rule" });
    expect(groupOf(byRule, "rule").rows.map((r) => r.label).sort()).toEqual(["A rule", "No rule"]);
    expect((await summaryOf("head", "queries.summary")).total).toBe(1);
  });

  test("sanctions.summary: by department stacked by status, the fines' total for a role that sees pay and left out, never zero, for one that does not", async () => {
    const all = await summaryOf("ops", "sanctions.summary");
    expect(figuresOf(all)).toMatchObject({ sanctions: 2, issued: 1, pending_approval: 1, fines: 1, fines_total: "5000.00" });
    const operations = groupOf(all, "department").rows.find((r) => r.key === dept.operations);
    expect(operations.parts.map((p) => p.label)).toEqual(["Issued", "Awaiting Approval"]);
    // The parts reach the pane as a stacked bar, one series a part.
    const o = engine.pane.overviewOf(
      { summary: "sanctions.summary", figures: ["sanctions", "issued", "fines"], chart: { kind: "stacked_bar", title: "Sanctions by department", group: "department" } },
      [{ n: 1, key: "sanctions.summary", kind: "summary", ok: true, result: all }],
    );
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
    expect(o.chart.series.map((s) => s.label)).toEqual(["Issued", "Awaiting Approval"]);
    const head = await summaryOf("head", "sanctions.summary");
    expect(head.total).toBe(0);
    expect(head.figures.map((x) => x.key)).not.toContain("fines_total");
  });

  test("a period narrows a list that shows every record only when asked: a month long past counts nothing", async () => {
    const lastYear = `${Number(today.slice(0, 4)) - 1}-01`;
    for (const key of ["exceptions.summary", "pay_items.summary", "temporary_sites.summary", "queries.summary", "sanctions.summary"])
      expect([key, (await summaryOf("ceo", key, { month: lastYear })).total]).toEqual([key, 0]);
  });

  test("a role without the grant is refused: a member of staff has no People view, and their own two answer them", async () => {
    const staff = await userOf("staff");
    for (const key of PEOPLE_VIEW) await expect(authorise.runSummary(pool, staff, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    for (const key of OWN) expect([key, c.assistant.AiSummaryResult.safeParse((await authorise.runSummary(pool, staff, key, {})).result).success]).toEqual([key, true]);
  });

  test("every read names its summary, and none waits in the gaps file", () => {
    const named = {
      "attendance.exceptions": "exceptions.summary",
      "attendance.my_days": "my_attendance.summary",
      "attendance.my_pay_items": "my_attendance.summary",
      "attendance.pay_items": "pay_items.summary",
      "attendance.temporary_sites": "temporary_sites.summary",
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

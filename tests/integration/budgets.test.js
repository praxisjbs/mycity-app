"use strict";
/**
 * Budgets end to end (docs/guides/expenses.md §3 step 7, §5, §6.6): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its contract.
 * Operations & People set a department's year by category and change it (Budget History); the
 * line's committed and spent are recounted as a request is approved, withdrawn and paid; Over
 * Budget is worked out again for a request still deciding when its line moves; a project's budget
 * is set through the projects service; the budget-threshold sweep warns once; the monthly report
 * and Home's Budget Used read committed and spent.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/budgets
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 * Every person and payee here is invented.
 */
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
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("budgets against the real migrations", () => {
  let app;
  let h;
  const cat = {};
  const dept = {};
  const year = Number(lagos.today().slice(0, 4));
  let budget;

  const decide = async (who, instanceId) => {
    const res = await h.as(who).post(`/workflow/instances/${instanceId}/approve`).send({});
    expect([who, res.status, res.body.error]).toEqual([who, 200, undefined]);
    await drain();
  };
  const raise = async (over = {}) => {
    const res = await h.as("staff").post("/expenses/mine").send({
      purpose: "Ikeja activation water",
      expense_category_id: cat.events,
      lines: [{ description: "Crates of water", quantity: "10", unit_price: "10000.00" }],
      payee_type: "vendor",
      payee_name: "Chuks Stores",
      bank_name: "GTBank",
      account_name: "Chuks Stores Ltd",
      account_number: "0123456789",
      submit: true,
      ...over,
    });
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    return res.body;
  };
  const line = async (category) =>
    one("SELECT amount, committed_amount, spent_amount FROM budget_line WHERE budget_id = $1 AND expense_category_id = $2", [budget.budget_id, category]);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people.staff.employee_id]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.ceo.employee_id, h.people.manager.employee_id]);
    dept.programmes = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.staff.employee_id])).department_id;
    await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [h.people.manager.employee_id, dept.programmes]);
    await grantsCache.bumpTeamVersion();
    await q("DELETE FROM expense_category");
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(200);
    for (const r of (await pool.query("SELECT expense_category_id, name FROM expense_category")).rows) cat[r.name] = r.expense_category_id;
    cat.events = cat["Events and Activations"];
    cat.travel = cat["Travel and Transport"];
    cat.office = cat["Office and Admin"];
    await drain();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("with no budget, a request sent is flagged Over Budget and counts against nothing", async () => {
    const r = await raise({ purpose: "Before any budget" });
    expect(r).toMatchObject({ over_budget: true, budget_remaining: null, department_remaining: null });
  });

  test("New Budget: Operations & People set a department's year by category; staff cannot; one per department per year", async () => {
    const lines = [
      { expense_category_id: cat.events, amount: "300000.00" },
      { expense_category_id: cat.travel, amount: "50000.00" },
    ];
    expect((await h.as("staff").post("/budgets").send({ department_id: dept.programmes, year, lines })).body.error.code).toBe("CAPABILITY_REQUIRED");
    const twice = await h.as("ops").post("/budgets").send({ department_id: dept.programmes, year, lines: [lines[0], lines[0]] });
    expect([twice.status, twice.body.error.fields]).toEqual([422, { lines: ["Each category once"] }]);

    const made = await h.as("ops").post("/budgets").send({ department_id: dept.programmes, year, lines });
    expect([made.status, made.body.error]).toEqual([201, undefined]);
    budget = made.body;
    expect(budget).toMatchObject({
      name: `Programmes ${year}`,
      starts_on: `${year}-01-01`,
      ends_on: `${year}-12-31`,
      status: "approved",
      allocated: "350000.00",
      owner: expect.objectContaining({ employee_id: h.people.manager.employee_id }),
    });
    expect(budget.number).toMatch(/^BUD-/);
    // The request sent before the budget now counts against its line and is flagged against it.
    expect(budget.lines.find((l) => l.expense_category_id === cat.events)).toMatchObject({ amount: "300000.00", committed_amount: "0.00", remaining: "300000.00" });
    const before = await one("SELECT budget_line_id, over_budget FROM expense_request WHERE purpose = 'Before any budget'");
    expect(before.budget_line_id).not.toBeNull();
    expect(before.over_budget).toBe(false);

    const again = await h.as("ops").post("/budgets").send({ department_id: dept.programmes, year, lines });
    expect([again.status, again.body.error.code]).toEqual([409, "BUDGET_EXISTS"]);
  });

  test("the list and one budget within scope: the head sees their department's, staff see none of it", async () => {
    const ops = await h.as("ops").get(`/budgets?year=${year}`);
    expect(ops.body.page).toMatchObject({ total: 1, size: 25 });
    const head = await h.as("manager").get(`/budgets/${budget.budget_id}`);
    expect(head.status).toBe(200);
    const staff = await h.as("staff").get(`/budgets/${budget.budget_id}`);
    expect(staff.status).toBe(404);
  });

  test("the recount: approved is committed, withdrawn leaves it, paid moves it to spent; a request still deciding is flagged again", async () => {
    const big = await raise({ purpose: "Stage and sound", lines: [{ description: "Stage", unit_price: "250000.00" }] });
    expect(big).toMatchObject({ over_budget: false, budget_remaining: "300000.00", department_remaining: "350000.00" });

    const first = await raise({ purpose: "Water for the walk" });
    await decide("manager", first.workflow_instance_id);
    await decide("ops", (await h.as("staff").get(`/expenses/${first.expense_request_id}`)).body.workflow_instance_id);
    expect(await line(cat.events)).toMatchObject({ committed_amount: "100000.00", spent_amount: "0.00" });
    // 300,000 less 100,000 committed leaves 200,000: the stage request still deciding is now over.
    const stage = await h.as("manager").get(`/expenses/${big.expense_request_id}`);
    expect(stage.body).toMatchObject({ over_budget: true, budget_remaining: "200000.00", department_remaining: "250000.00" });

    // Raised by Edit Budget, the line has room again and the flag comes off before anyone decides.
    const raised = await h.as("ops").patch(`/budgets/${budget.budget_id}`).send({
      lines: [
        { expense_category_id: cat.events, amount: "500000.00" },
        { expense_category_id: cat.office, amount: "20000.00" },
      ],
    });
    expect([raised.status, raised.body.error]).toEqual([200, undefined]);
    expect(raised.body.lines.map((l) => l.category).sort()).toEqual(["Events and Activations", "Office and Admin"]);
    expect((await h.as("manager").get(`/expenses/${big.expense_request_id}`)).body.over_budget).toBe(false);

    // Withdrawn once approved: committed falls back.
    const second = await raise({ purpose: "Second water run" });
    await decide("manager", second.workflow_instance_id);
    await decide("ops", (await h.as("staff").get(`/expenses/${second.expense_request_id}`)).body.workflow_instance_id);
    expect((await line(cat.events)).committed_amount).toBe("200000.00");
    expect((await h.as("ops").post(`/expenses/${second.expense_request_id}/withdraw`).send({ reason: "Bought already" })).status).toBe(200);
    expect((await line(cat.events)).committed_amount).toBe("100000.00");

    // Grouped, authorised and paid: committed moves to spent.
    const grouped = await h.as("ops").post("/requisitions").send({ expense_request_ids: [first.expense_request_id] });
    expect(grouped.status).toBe(201);
    await decide("ceo", grouped.body.workflow_instance_id);
    expect((await line(cat.events)).committed_amount).toBe("100000.00");
    const paid = await h.as("ops").post("/disbursements").send({ expense_request_id: first.expense_request_id, payment_reference: "GT0001", paid_on: lagos.today() });
    expect([paid.status, paid.body.error]).toEqual([201, undefined]);
    expect(await line(cat.events)).toMatchObject({ committed_amount: "0.00", spent_amount: "100000.00" });
  });

  test("Budget History: each line a save changed, before and after, newest first, 25 a page; the head is told of a change", async () => {
    const res = await h.as("ops").get(`/budgets/${budget.budget_id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.page.size).toBe(25);
    const rows = res.body.data;
    expect(rows.slice(0, 3)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Events and Activations", before: "300000.00", after: "500000.00", by: expect.any(String) }),
        expect.objectContaining({ category: "Office and Admin", before: null, after: "20000.00" }),
        expect.objectContaining({ category: "Travel and Transport", before: "50000.00", after: null }),
      ]),
    );
    expect(rows.filter((r) => r.before === null && r.after === "300000.00")).toHaveLength(1);
    const told = await one(
      `SELECT count(*)::int AS n FROM notification n JOIN app_user u ON u.user_id = n.user_id
        WHERE u.employee_id = $1 AND n.title LIKE 'Budget changed:%'`,
      [h.people.manager.employee_id],
    );
    expect(told.n).toBe(1);
  });

  test("a line requests count against is never taken away: it is set to 0", async () => {
    const res = await h.as("ops").patch(`/budgets/${budget.budget_id}`).send({ lines: [{ expense_category_id: cat.office, amount: "20000.00" }] });
    expect(res.status).toBe(200);
    expect(res.body.lines.find((l) => l.expense_category_id === cat.events)).toMatchObject({ amount: "0.00", spent_amount: "100000.00", remaining: "-100000.00" });
    await h.as("ops").patch(`/budgets/${budget.budget_id}`).send({ lines: [{ expense_category_id: cat.events, amount: "500000.00" }, { expense_category_id: cat.office, amount: "20000.00" }] });
  });

  test("Expenses · Projects: Set Budget through the projects service; committed and spent over its requests", async () => {
    const project = await one(
      `INSERT INTO project (number, name, owner_employee_id, status) VALUES ('PRJ-0901', 'Ikeja Walk', $1, 'active') RETURNING project_id`,
      [h.people.manager.employee_id],
    );
    const r = await raise({ purpose: "Walk banners", project_id: project.project_id, lines: [{ description: "Banners", unit_price: "40000.00" }] });
    expect((await h.as("staff").patch(`/budgets/projects/${project.project_id}`).send({ budget_amount: "100000.00" })).body.error.code).toBe("CAPABILITY_REQUIRED");
    const set = await h.as("ops").patch(`/budgets/projects/${project.project_id}`).send({ budget_amount: "100000.00" });
    expect([set.status, set.body.error]).toEqual([200, undefined]);
    expect(set.body).toMatchObject({ name: "Ikeja Walk", budget_amount: "100000.00", committed: "0.00", remaining: "100000.00", requests: 1 });
    await decide("manager", r.workflow_instance_id);
    await decide("ops", (await h.as("staff").get(`/expenses/${r.expense_request_id}`)).body.workflow_instance_id);
    const page = await h.as("ops").get("/budgets/projects?q=walk");
    expect(page.body.data[0]).toMatchObject({ committed: "40000.00", remaining: "60000.00" });
    expect((await one("SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'project.budget_set'")).n).toBe(1);
    // Projects' spend is read across the company: a team reader is refused.
    expect((await h.as("manager").get("/budgets/projects")).status).toBe(403);
    const off = await h.as("ops").patch(`/budgets/projects/${project.project_id}`).send({ budget_amount: null });
    expect(off.body).toMatchObject({ budget_amount: null, remaining: null });
  });

  test("the budget-threshold sweep: a line 90% used tells the head and Operations & People, once", async () => {
    const service = require("../../src/modules/budgets/budgets.service");
    await h.as("ops").patch(`/budgets/${budget.budget_id}`).send({ lines: [{ expense_category_id: cat.events, amount: "150000.00" }, { expense_category_id: cat.office, amount: "20000.00" }] });
    expect((await service.warnThresholds()).warned).toBe(1);
    await drain();
    expect((await service.warnThresholds()).warned).toBe(0);
    const told = await pool.query(
      `SELECT u.employee_id FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE n.title LIKE 'Events and Activations at %'`,
    );
    expect(told.rows.map((r) => r.employee_id).sort()).toEqual([h.people.manager.employee_id, h.people.ops.employee_id].sort());
  });

  test("the monthly report by department, project and category, and Home's Budget Used, count committed and spent", async () => {
    const variance = require("../../src/modules/budgets/budgets.variance");
    const month = lagos.monthBounds(lagos.today());
    const all = { scope: "all", scope_ids: null };
    const r = await variance.monthly(pool, all, { from: month.first, to: month.last });
    const programmes = r.departments.find((d) => d.name === "Programmes");
    expect(programmes).toMatchObject({ paid: "100000.00", allocated: "170000.00" });
    expect(r.categories.find((c) => c.name === "Events and Activations")).toMatchObject({ paid: "100000.00" });
    expect(r.projects.find((p) => p.name === "PRJ-0901 Ikeja Walk")).toMatchObject({ committed: "40000.00" });

    const home = require("../../src/modules/dashboard/sources/budgets.source");
    const used = await home.used(pool, { today: lagos.today() }, all);
    const committed = await one("SELECT sum(committed_amount + spent_amount)::numeric AS u, sum(amount)::numeric AS a FROM budget_line");
    expect(used.value).toBe(Math.round((100 * Number(committed.u)) / Number(committed.a)));
  });
  test("the recount locks its lines first: two moves on one line at once both count (audit F6)", async () => {
    const repo = require("../../src/modules/budgets/budgets.repo");
    const a = await raise({ purpose: "Parallel one", lines: [{ description: "Tent", unit_price: "1000.00" }] });
    const b = await raise({ purpose: "Parallel two", lines: [{ description: "Chairs", unit_price: "2000.00" }] });
    const { budget_line_id: lineId } = await one("SELECT budget_line_id FROM expense_request WHERE expense_request_id = $1", [a.expense_request_id]);
    const before = (await line(cat.events)).committed_amount;
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query("UPDATE expense_request SET status = 'approved' WHERE expense_request_id = $1", [a.expense_request_id]);
      await second.query("UPDATE expense_request SET status = 'approved' WHERE expense_request_id = $1", [b.expense_request_id]);
      await repo.recount(first, [lineId]);
      // The second waits on the first's lock, then reads the first's committed move.
      const waiting = repo.recount(second, [lineId]).then(() => second.query("COMMIT"));
      await new Promise((r) => setTimeout(r, 200));
      await first.query("COMMIT");
      await waiting;
    } finally {
      first.release();
      second.release();
    }
    const after = (await line(cat.events)).committed_amount;
    expect(Number(after) - Number(before)).toBe(3000);
    for (const r of [a, b]) await q("UPDATE expense_request SET status = 'cancelled' WHERE expense_request_id = $1", [r.expense_request_id]);
    await repo.recount(pool, [lineId]);
  });

  test("one budget per department per year holds under two New Budget presses at once (audit F7)", async () => {
    const d = await one("INSERT INTO department (code, name) VALUES ('PTN', 'Partnerships') RETURNING department_id");
    const body = { department_id: d.department_id, year, lines: [{ expense_category_id: cat.office, amount: "10000.00" }] };
    const [x, y] = await Promise.all([h.as("ops").post("/budgets").send(body), h.as("ops").post("/budgets").send(body)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect([x, y].find((r) => r.status === 409).body.error.code).toBe("BUDGET_EXISTS");
    expect((await one("SELECT count(*)::int AS n FROM budget WHERE department_id = $1", [d.department_id])).n).toBe(1);
  });

  test("a line only uncounted requests name is taken away, and they let go of it (audit F16)", async () => {
    const r = await raise({ purpose: "Printer paper", expense_category_id: cat.office, lines: [{ description: "Reams", unit_price: "5000.00" }] });
    expect((await h.as("staff").post(`/expenses/mine/${r.expense_request_id}/cancel`).send({})).status).toBe(200);
    expect((await one("SELECT budget_line_id FROM expense_request WHERE expense_request_id = $1", [r.expense_request_id])).budget_line_id).not.toBeNull();
    const res = await h.as("ops").patch(`/budgets/${budget.budget_id}`).send({ lines: [{ expense_category_id: cat.events, amount: "150000.00" }] });
    expect([res.status, res.body.error]).toEqual([200, undefined]);
    expect(res.body.lines.map((l) => l.expense_category_id)).toEqual([cat.events]);
    expect((await one("SELECT budget_line_id FROM expense_request WHERE expense_request_id = $1", [r.expense_request_id])).budget_line_id).toBeNull();
  });

  test("a budget's owner is the department's head now, for scope and the notice (audit F17)", async () => {
    await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [h.people.staff.employee_id, dept.programmes]);
    await grantsCache.bumpTeamVersion();
    try {
      const res = await h.as("ops").get(`/budgets/${budget.budget_id}`);
      expect(res.body.owner).toEqual(expect.objectContaining({ employee_id: h.people.staff.employee_id }));
    } finally {
      await q("UPDATE department SET head_employee_id = $1 WHERE department_id = $2", [h.people.manager.employee_id, dept.programmes]);
      await grantsCache.bumpTeamVersion();
    }
  });

  test("the monthly report's budget columns follow /budgets: approved, naira, within the reader's scope (audit F18)", async () => {
    const variance = require("../../src/modules/budgets/budgets.variance");
    const month = lagos.monthBounds(lagos.today());
    const span = { from: month.first, to: month.last };
    const all = await variance.monthly(pool, { scope: "all", scope_ids: null }, span);
    expect(all.departments.find((d) => d.name === "Programmes").allocated).toBe("150000.00");
    // A reader whose scope holds the requester but not the department's head sees the spend, not the budget.
    const narrow = await variance.monthly(pool, { scope: "own", scope_ids: [h.people.staff.employee_id] }, span);
    expect(narrow.departments.find((d) => d.name === "Programmes")).toMatchObject({ allocated: null, remaining: null });
    await q("UPDATE budget SET currency = 'USD' WHERE budget_id = $1", [budget.budget_id]);
    try {
      const usd = await variance.monthly(pool, { scope: "all", scope_ids: null }, span);
      expect(usd.departments.find((d) => d.name === "Programmes").allocated).toBeNull();
    } finally {
      await q("UPDATE budget SET currency = 'NGN' WHERE budget_id = $1", [budget.budget_id]);
    }
  });
});

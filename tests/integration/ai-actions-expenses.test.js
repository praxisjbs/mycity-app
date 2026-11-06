"use strict";
/**
 * Praxis AI's expense cards on the real migrations (docs/guides/expenses.md §9;
 * docs/guides/praxis-ai.md §6.11, decision 33): a member of staff raises a request with its first
 * line, adds a line and changes it, each through New Request's and Edit's own service; Operations
 * & People add and deactivate a category, group approved requests for the CEO, and record a
 * transfer (money: Confirm It's You first) and its reference. A card naming somebody else's
 * request, or one held to `expenses.finance` for someone without it, is refused with nothing run.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-expenses
 */
process.env.GEMINI_API_KEY = "test-key";
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
const registry = require("../../src/shared/ai/registry");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's expense cards against the real migrations", () => {
  let app;
  let h;
  let events;
  const made = {};

  const card = async (who, key, values, question = "Draft it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect([key, asked.status, asked.body.error]).toEqual([key, 200, undefined]);
    return asked.body.card;
  };
  const decide = async (who, id) => {
    const res = await h.as(who).post(`/workflow/instances/${id}/approve`).send({});
    expect([who, res.status, res.body.error]).toEqual([who, 200, undefined]);
    await drain();
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "one", first: "Musa", last: "Danjuma", email: "one@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "two", first: "Zainab", last: "Lawal", email: "two@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    for (const who of ["one", "two"]) await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people[who].employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();
    // No category is seeded (A26, 8101): Operations & People add the suggested twelve.
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(200);
    events = (await one("SELECT expense_category_id FROM expense_category WHERE name = 'Travel and Transport'")).expense_category_id;
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  test("my_expenses.create: a request with its first line as a card, its category written by name, sent through New Request's own service", async () => {
    const drafted = await card("one", "my_expenses.create", {
      purpose: "Ikeja activation water",
      expense_category_id: "Travel and Transport",
      description: "Crates of water",
      quantity: "2",
      unit_price: "4500.00",
      payee_type: "vendor",
      payee_name: "Chuks Stores",
      bank_name: "GTBank",
      account_name: "Chuks Stores Ltd",
      account_number: "0123456789",
    });
    expect(drafted).toMatchObject({ action_key: "my_expenses.create", label: "New Request", risk: "standard", values: { expense_category_id: events, submit: true }, problems: {} });
    expect(drafted.names).toEqual([expect.objectContaining({ type: "expense_category", id: events, label: "Travel and Transport" })]);
    const pressed = await h.press("one", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "expense", label: expect.stringMatching(/^EXP-\d{4}, Ikeja activation water$/), ok: true, message: "sent" })]);
    const r = await one("SELECT expense_request_id, status, amount FROM expense_request WHERE purpose = 'Ikeja activation water'");
    expect(r).toMatchObject({ status: "submitted", amount: "9000.00" });
    made.sent = r.expense_request_id;
  });

  test("my_expenses.add_line and my_expenses.edit: a draft of the person's own grows a line and changes its purpose; somebody else's is refused", async () => {
    const draft = await h.as("two").post("/expenses/mine").send({ purpose: "Banner printing", expense_category_id: events, lines: [{ description: "Banner", unit_price: "15000.00" }], payee_type: "vendor", payee_name: "Print Hub", bank_name: "Zenith", account_name: "Print Hub Ltd", account_number: "1234509876" });
    expect(draft.status).toBe(201);
    const id = draft.body.expense_request_id;

    const line = await card("two", "my_expenses.add_line", { expense_request_id: id, description: "Stand", quantity: "2", unit_price: "2500.00" });
    expect(line.records).toEqual([expect.objectContaining({ type: "expense", id, label: `${draft.body.number}, Banner printing` })]);
    expect((await h.press("two", line.ai_action_draft_id)).status).toBe(200);
    const grown = await h.as("two").get(`/expenses/${id}`);
    expect(grown.body).toMatchObject({ amount: "20000.00", status: "draft" });
    expect(grown.body.lines.map((l) => l.description)).toEqual(["Banner", "Stand"]);

    const change = await card("two", "my_expenses.edit", { expense_request_id: id, purpose: "Banner printing for the walk" });
    expect((await h.press("two", change.ai_action_draft_id)).status).toBe(200);
    const changed = await h.as("two").get(`/expenses/${id}`);
    expect(changed.body).toMatchObject({ purpose: "Banner printing for the walk", amount: "20000.00", payee_name: "Print Hub" });
    expect(changed.body.lines).toHaveLength(2);

    // Somebody else's request is never named, and the press is refused with nothing changed.
    const theirs = await card("one", "my_expenses.edit", { expense_request_id: id, purpose: "Mine now" });
    expect(theirs.records).toEqual([]);
    const refused = await h.press("one", theirs.ai_action_draft_id);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await one("SELECT purpose FROM expense_request WHERE expense_request_id = $1", [id])).purpose).toBe("Banner printing for the walk");
  });

  test("expense_categories.create and expense_categories.edit: Operations & People add one and deactivate it by its name; staff are never offered them", async () => {
    const add = await card("ops", "expense_categories.create", { name: "Field Logistics", type: "operating" });
    expect((await h.press("ops", add.ai_action_draft_id)).status).toBe(200);
    const row = await one("SELECT expense_category_id, active FROM expense_category WHERE name = 'Field Logistics'");
    expect(row.active).toBe(true);

    const off = await card("ops", "expense_categories.edit", { expense_category_id: "Field Logistics", active: false });
    expect(off).toMatchObject({ values: { expense_category_id: row.expense_category_id, active: false }, problems: {} });
    expect((await h.press("ops", off.ai_action_draft_id)).status).toBe(200);
    expect((await one("SELECT active FROM expense_category WHERE expense_category_id = $1", [row.expense_category_id])).active).toBe(false);

    script(say({ text: "Here it is.", action: { key: "expense_categories.create", values: { name: "Snacks" }, suggested: false } }));
    const notMine = await h.ask("one", { question: "Add a category called Snacks.", shows: ["cards"] });
    expect(notMine.body.card).toBeNull();
  });

  test("budgets.create, budgets.edit and budgets.set_project: Operations & People set a department's year, change it by its name and give a project a budget; staff are never offered them", async () => {
    const department = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.one.employee_id])).department_id;
    const year = Number(require("../../src/shared/time/lagos").today().slice(0, 4)) + 1;
    const set = await card("ops", "budgets.create", { department_id: department, year, lines: [{ expense_category_id: events, amount: "200000.00" }] });
    expect(set).toMatchObject({ action_key: "budgets.create", label: "New Budget", problems: {} });
    expect(set.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "department", id: department }), expect.objectContaining({ type: "expense_category", id: events, label: "Travel and Transport" })]));
    const pressed = await h.press("ops", set.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "budget", label: expect.stringMatching(/^BUD-.*, Programmes \d{4}$/), message: "set", ok: true })]);
    const b = await one("SELECT budget_id, name FROM budget WHERE department_id = $1 AND date_part('year', starts_on)::int = $2", [department, year]);

    const edit = await card("ops", "budgets.edit", { budget_id: b.name, lines: [{ expense_category_id: events, amount: "250000.00" }] });
    expect(edit).toMatchObject({ values: { budget_id: b.budget_id }, problems: {} });
    expect(edit.records).toEqual([expect.objectContaining({ type: "budget", id: b.budget_id })]);
    expect((await h.press("ops", edit.ai_action_draft_id)).status).toBe(200);
    expect((await one("SELECT amount FROM budget_line WHERE budget_id = $1", [b.budget_id])).amount).toBe("250000.00");

    const project = await one("INSERT INTO project (number, name, owner_employee_id, status) VALUES ('PRJ-0950', 'Lagos Walk', $1, 'active') RETURNING project_id", [h.people.manager.employee_id]);
    const give = await card("ops", "budgets.set_project", { project_id: project.project_id, budget_amount: "90000.00" });
    expect(give.problems).toEqual({});
    const given = await h.press("ops", give.ai_action_draft_id);
    expect(given.status).toBe(200);
    expect(given.body.lines).toEqual([expect.objectContaining({ type: "project", message: "budget set", ok: true })]);
    expect((await one("SELECT budget_amount FROM project WHERE project_id = $1", [project.project_id])).budget_amount).toBe("90000.00");

    script(say({ text: "Here it is.", action: { key: "budgets.create", values: { department_id: department, year, lines: [] }, suggested: false } }));
    expect((await h.ask("one", { question: "Set my department's budget.", shows: ["cards"] })).body.card).toBeNull();
  });

  test("requisitions.create, approvals.decide on the requisition as the CEO, disbursements.create and disbursements.add_reference: approved requests grouped, the CEO approves, the transfer recorded after Confirm It's You and its reference added", async () => {
    await decide("manager", (await one("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [made.sent])).workflow_instance_id);
    await decide("ops", (await one("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [made.sent])).workflow_instance_id);

    const group = await card("ops", "requisitions.create", { expense_request_ids: [made.sent] });
    expect(group.records).toEqual([expect.objectContaining({ type: "expense", id: made.sent })]);
    const grouped = await h.press("ops", group.ai_action_draft_id);
    expect(grouped.status).toBe(200);
    expect(grouped.body.lines).toEqual([expect.objectContaining({ type: "requisition", label: expect.stringMatching(/^REQ-\d{4}, 1 request$/), message: "sent to the CEO", ok: true })]);
    const req = await one("SELECT workflow_instance_id FROM requisition ORDER BY created_at DESC LIMIT 1");
    // The CEO decides the requisition through the approvals' own card (audit F20), after Confirm It's You.
    const ceo = await card("ceo", "approvals.decide", { workflow_instance_ids: [req.workflow_instance_id], decision: "approve" });
    expect(ceo).toMatchObject({ action_key: "approvals.decide", risk: "approval", problems: {} });
    expect(ceo.records).toEqual([expect.objectContaining({ type: "workflow_instance", id: req.workflow_instance_id })]);
    await h.confirmPassword("ceo");
    const decided = await h.press("ceo", ceo.ai_action_draft_id);
    expect([decided.status, decided.body.error]).toEqual([200, undefined]);
    expect(decided.body.lines).toEqual([expect.objectContaining({ id: req.workflow_instance_id, ok: true, message: "approved" })]);
    await drain();
    expect((await one("SELECT status FROM expense_request WHERE expense_request_id = $1", [made.sent])).status).toBe("authorised");

    const pay = await card("ops", "disbursements.create", { expense_request_id: made.sent, paid_on: "2026-11-02", confirm_without_reference: true });
    expect(pay).toMatchObject({ risk: "money", confirm: expect.any(String) });
    await h.stale("ops");
    expect((await h.press("ops", pay.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const paid = await h.press("ops", pay.ai_action_draft_id);
    expect(paid.status).toBe(200);
    expect(paid.body.lines).toEqual([expect.objectContaining({ type: "disbursement", message: "recorded, reference missing", ok: true })]);
    const d = await one("SELECT disbursement_id, payment_reference FROM disbursement WHERE expense_request_id = $1", [made.sent]);
    expect(d.payment_reference).toBeNull();

    const ref = await card("ops", "disbursements.add_reference", { disbursement_id: d.disbursement_id, payment_reference: "GT2611020042" });
    expect((await h.press("ops", ref.ai_action_draft_id)).status).toBe(200);
    expect((await one("SELECT payment_reference FROM disbursement WHERE disbursement_id = $1", [d.disbursement_id])).payment_reference).toBe("GT2611020042");

    // A member of staff holds no expenses.finance: the payment card is never drawn for them.
    script(say({ text: "Here it is.", action: { key: "disbursements.create", values: { expense_request_id: made.sent, paid_on: "2026-11-02" }, suggested: false } }));
    expect((await h.ask("one", { question: "Record my payment.", shows: ["cards"] })).body.card).toBeNull();
  });
});

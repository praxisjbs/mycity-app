"use strict";
/**
 * Expenses end to end (docs/guides/expenses.md §3, §5, §6): the real migrations on a throwaway
 * database, the whole app through HTTP, every response parsed with its contract (APP_ENV=test).
 * Categories kept by Operations & People; a request raised line by line, approved by the line
 * manager and Operations & People, sent back and sent again, cancelled and withdrawn; approved
 * requests grouped for the CEO, one removed, the rest authorised and paid, with and without the
 * bank's reference.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/expenses
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

const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

describeDb("expenses against the real migrations", () => {
  let app;
  let h;
  const cat = {};

  const status = async (id) => (await one("SELECT status FROM expense_request WHERE expense_request_id = $1", [id])).status;

  /** A request of `who`'s, with the payee typed: a vendor paid at GTBank. */
  const body = (over = {}) => ({
    purpose: "Ikeja activation water",
    expense_category_id: cat.events,
    lines: [
      { description: "Crates of water", quantity: "2", unit_price: "4500.00" },
      { description: "Ice", quantity: "1.5", unit_price: "1000.00" },
    ],
    payee_type: "vendor",
    payee_name: "Chuks Stores",
    bank_name: "GTBank",
    account_name: "Chuks Stores Ltd",
    account_number: "0123456789",
    ...over,
  });
  const raise = async (who, over = {}, submit = true) => {
    const res = await h.as(who).post("/expenses/mine").send(body({ ...over, submit }));
    expect([res.status, res.body.error]).toEqual([201, undefined]);
    return res.body;
  };
  const decide = async (who, instanceId, verb = "approve", reason) => {
    const res = await h.as(who).post(`/workflow/instances/${instanceId}/${verb}`).send(reason ? { reason } : {});
    expect([who, verb, res.status, res.body.error]).toEqual([who, verb, 200, undefined]);
    await drain();
  };
  /** A request sent and approved by the line manager and Operations & People. */
  const approved = async (who, over = {}) => {
    const r = await raise(who, over);
    await decide("manager", r.workflow_instance_id);
    const again = await h.as(who).get(`/expenses/${r.expense_request_id}`);
    await decide("ops", again.body.workflow_instance_id);
    expect(await status(r.expense_request_id)).toBe("approved");
    return r;
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
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "other", first: "Zainab", last: "Lawal", email: "other@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "outsider", first: "Bisi", last: "Ade", email: "outsider@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    for (const who of ["staff", "other"]) await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people[who].employee_id]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.ceo.employee_id, h.people.manager.employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();
  }, 120_000);

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out, the expense routes answer 401", async () => {
    const request = require("supertest");
    for (const path of ["/expenses/mine", "/expenses", "/expense-categories", "/requisitions", "/disbursements"])
      expect((await request(app).get(`/api/v1${path}`)).status).toBe(401);
  });

  test("categories: Add Suggested Categories only while there are none; Operations & People add, rename and deactivate; staff only read", async () => {
    // No category is seeded (A26): 8101 took 8099's five out, so the suggestions are offered at once.
    expect((await one("SELECT count(*)::int AS n FROM expense_category")).n).toBe(0);
    expect((await h.as("staff").post("/expense-categories/suggested").send({})).body.error.code).toBe("CAPABILITY_REQUIRED");
    const made = await h.as("ops").post("/expense-categories/suggested").send({});
    expect(made.status).toBe(200);
    expect(made.body.page.total).toBe(12);
    expect(made.body.data.find((c) => c.name === "Equipment")).toMatchObject({ type: "capital", active: true, spent_this_month: "0.00", requests: 0 });
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(409);

    const read = await h.as("staff").get("/expense-categories?active=true&sort=name");
    expect(read.status).toBe(200);
    expect(read.body.page.size).toBe(25);
    for (const c of read.body.data) cat[c.name] = c.expense_category_id;
    cat.events = cat["Events and Activations"];
    cat.office = cat["Office and Admin"];

    expect((await h.as("staff").post("/expense-categories").send({ name: "Field Logistics" })).body.error.code).toBe("CAPABILITY_REQUIRED");
    const added = await h.as("ops").post("/expense-categories").send({ name: "Field Logistics", description: "Vans and fuel for field teams" });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ name: "Field Logistics", type: "operating", description: "Vans and fuel for field teams", active: true });
    expect((await h.as("ops").post("/expense-categories").send({ name: "field logistics" })).body.error.code).toBe("CATEGORY_EXISTS");
    const off = await h.as("ops").patch(`/expense-categories/${added.body.expense_category_id}`).send({ active: false });
    expect(off.body.active).toBe(false);
    const offered = await h.as("staff").get("/expense-categories?active=true&q=logistics");
    expect(offered.body.data).toEqual([]);
    cat.retired = added.body.expense_category_id;
    expect((await one("SELECT count(*)::int AS n FROM audit_ledger WHERE action LIKE 'expense_category.%'")).n).toBeGreaterThanOrEqual(3);
  });

  test("a draft: its lines worked out to the kobo, the request's amount their sum, seen by its requester alone", async () => {
    const draft = await raise("staff", {}, false);
    expect(draft).toMatchObject({
      status: "draft",
      amount: "10500.00",
      currency: "NGN",
      category: "Events and Activations",
      requester: { display_name: "Musa Danjuma" },
      department: "Programmes",
      waiting_on: null,
      workflow_instance_id: null,
      can_edit: true,
      can_cancel: true,
    });
    expect(draft.number).toMatch(/^EXP-\d{4}$/);
    expect(draft.lines.map((l) => [l.position, l.quantity, l.unit_price, l.amount])).toEqual([
      [1, "2.00", "4500.00", "9000.00"],
      [2, "1.50", "1000.00", "1500.00"],
    ]);
    // Somebody else's draft is theirs alone, even to Operations & People.
    expect((await h.as("ops").get(`/expenses/${draft.expense_request_id}`)).status).toBe(404);
    expect((await h.as("ops").get("/expenses")).body.data.map((r) => r.expense_request_id)).not.toContain(draft.expense_request_id);
    expect((await h.as("outsider").get(`/expenses/${draft.expense_request_id}`)).status).toBe(404);

    const edited = await h.as("staff").patch(`/expenses/mine/${draft.expense_request_id}`).send(body({ purpose: "Ikeja activation refreshments", lines: [{ description: "Crates of water", quantity: "3", unit_price: "4500.00" }] }));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ purpose: "Ikeja activation refreshments", amount: "13500.00" });
    expect(edited.body.lines).toHaveLength(1);
    expect((await h.as("other").patch(`/expenses/mine/${draft.expense_request_id}`).send(body())).status).toBe(404);
    // A deactivated category is not offered on a new request.
    const retired = await h.as("staff").post("/expenses/mine").send(body({ expense_category_id: cat.retired }));
    expect([retired.status, retired.body.error.fields]).toEqual([422, { expense_category_id: ["Not offered"] }]);
    const zero = await h.as("staff").post("/expenses/mine").send(body({ lines: [{ description: "Nothing", unit_price: "0.00" }] }));
    expect([zero.body.error.code, zero.body.error.fields]).toEqual(["EXPENSE_TOTAL_NOT_POSITIVE", { lines: ["Total above zero"] }]);
    // A discount is a negative line (praxis-ai.md decision 45); the request's total is still above zero.
    const discounted = await h.as("staff").post("/expenses/mine").send(body({ bank_name: "Moniepoint", lines: [{ description: "Banner", unit_price: "50000.00" }, { description: "Discount", unit_price: "-10000.00" }] }));
    expect([discounted.status, discounted.body.amount, discounted.body.lines.map((l) => l.amount)]).toEqual([201, "40000.00", ["50000.00", "-10000.00"]]);
    const below = await h.as("staff").post("/expenses/mine").send(body({ lines: [{ description: "Banner", unit_price: "5000.00" }, { description: "Discount", unit_price: "-10000.00" }] }));
    expect([below.status, below.body.error.code]).toEqual([422, "EXPENSE_TOTAL_NOT_POSITIVE"]);
    const cancelled = await h.as("staff").post(`/expenses/mine/${draft.expense_request_id}/cancel`).send({});
    expect(cancelled.body).toMatchObject({ status: "cancelled", can_cancel: false, can_edit: false });
  });

  test("banks: the common ones and every bank a request names, most used first, one row a name whatever its case", async () => {
    // The draft above named GTBank; a bank no list knows is kept as typed and offered from then on.
    await raise("other", { bank_name: "Coda Bank" }, false);
    await raise("other", { bank_name: "gtbank" }, false);
    const all = await h.as("staff").get("/expenses/banks");
    expect(all.status).toBe(200);
    expect(all.body.page.size).toBe(25);
    expect(all.body.data[0]).toEqual({ bank_name: "GTBank", uses: 2 });
    expect(all.body.data.filter((b) => b.bank_name.toLowerCase() === "gtbank")).toHaveLength(1);
    expect(all.body.data).toContainEqual({ bank_name: "Coda Bank", uses: 1 });
    expect(all.body.data).toContainEqual({ bank_name: "Access Bank", uses: 0 });
    const zen = await h.as("staff").get("/expenses/banks?q=zen");
    expect(zen.body.data).toEqual([{ bank_name: "Zenith Bank", uses: 0 }]);
  });

  test("a line may take money off, as its invoice does; the request asks for what is left, never for nothing", async () => {
    // A discount or an amount already paid is a line below zero (TB, 13/11/2026).
    const credited = await h.as("staff").post("/expenses/mine").send(body({ bank_name: "Nombank MFB", lines: [
      { description: "Ticket platform", quantity: "1", unit_price: "300000.00" },
      { description: "Long-term client discount", quantity: "1", unit_price: "-100000.00" },
      { description: "Paid to date", quantity: "1", unit_price: "-50000.50" },
    ] }));
    expect([credited.status, credited.body.amount]).toEqual([201, "149999.50"]);
    expect(credited.body.lines.map((l) => [l.unit_price, l.amount])).toEqual([["300000.00", "300000.00"], ["-100000.00", "-100000.00"], ["-50000.50", "-50000.50"]]);
    const overCredited = await h.as("staff").post("/expenses/mine").send(body({ bank_name: "Nombank MFB", lines: [
      { description: "Ticket platform", quantity: "1", unit_price: "100000.00" },
      { description: "Paid to date", quantity: "1", unit_price: "-100000.00" },
    ] }));
    expect([overCredited.status, overCredited.body.error.code]).toEqual([422, "EXPENSE_TOTAL_NOT_POSITIVE"]);
  });

  test("sent: the line manager, then Operations & People, each from Expenses · Approvals; nobody else decides it", async () => {
    const r = await raise("staff");
    expect(r).toMatchObject({ status: "submitted", waiting_on: "Line Manager", over_budget: true, can_edit: false, can_cancel: true });
    expect(r.submitted_at).toEqual(expect.any(String));

    const waiting = await h.as("manager").get("/expenses/approvals");
    expect(waiting.status).toBe(200);
    expect(waiting.body.data.map((x) => x.expense_request_id)).toContain(r.expense_request_id);
    const figures = await h.as("manager").get("/expenses/approvals/summary");
    expect(figures.body).toMatchObject({ with_you: 1, total_value: "10500.00", oldest_days: 0 });
    expect((await h.as("ops").get("/expenses/approvals")).body.data).toEqual([]);
    expect((await h.as("staff").get("/expenses/approvals")).status).toBe(403);
    // The line manager sees their team's request; the outsider does not.
    expect((await h.as("manager").get(`/expenses/${r.expense_request_id}`)).status).toBe(200);
    expect((await h.as("outsider").get(`/expenses/${r.expense_request_id}`)).status).toBe(404);
    expect((await h.as("manager").patch(`/expenses/mine/${r.expense_request_id}`).send(body())).status).toBe(404);

    await decide("manager", r.workflow_instance_id);
    const atOps = await h.as("staff").get(`/expenses/${r.expense_request_id}`);
    expect(atOps.body).toMatchObject({ status: "submitted", waiting_on: "Operations & People" });
    expect((await h.as("ops").get("/expenses/approvals")).body.data.map((x) => x.expense_request_id)).toContain(r.expense_request_id);
    await decide("ops", r.workflow_instance_id);
    const done = await h.as("staff").get(`/expenses/${r.expense_request_id}`);
    expect(done.body).toMatchObject({ status: "approved", waiting_on: "Operations & People", can_cancel: false });
    expect(done.body.approved_at).toEqual(expect.any(String));
    expect((await h.as("staff").post(`/expenses/mine/${r.expense_request_id}/cancel`).send({})).body.error.code).toBe("EXPENSE_NOT_CANCELLABLE");
    expect((await h.as("manager").get("/expenses/approvals/summary")).body).toMatchObject({ with_you: 0, approved_this_month: 1 });

    const mine = await h.as("staff").get("/expenses/mine/summary");
    expect(mine.body).toMatchObject({ in_flight: expect.any(Number), disbursed_this_year: "0.00", rejected: 0 });
  });

  test("a line manager's own request goes straight to Operations & People; a rejection ends it", async () => {
    const r = await raise("manager", { purpose: "Team offsite lunch", expense_category_id: cat.office });
    expect(r.waiting_on).toBe("Operations & People");
    const res = await h.as("ops").post(`/workflow/instances/${r.workflow_instance_id}/reject`).send({ reason: "Use the team budget" });
    expect(res.status).toBe(200);
    await drain();
    expect(await status(r.expense_request_id)).toBe("rejected");
    expect((await h.as("manager").get("/expenses/mine/summary")).body.rejected).toBe(1);
  });

  test("Send Back: the approval withdrawn, the request back with its requester; Send Again opens a new one at the line manager", async () => {
    const r = await raise("other");
    await decide("manager", r.workflow_instance_id, "request-changes", "Attach the vendor's invoice");
    const back = await h.as("other").get(`/expenses/${r.expense_request_id}`);
    expect(back.body).toMatchObject({ status: "sent_back", waiting_on: "Requester", can_edit: true, can_cancel: true });
    expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [r.workflow_instance_id])).state).toBe("cancelled");
    expect((await h.as("manager").get("/expenses/approvals")).body.data.map((x) => x.expense_request_id)).not.toContain(r.expense_request_id);
    // The withdrawal's own copy changes nothing: the request stays with its requester.
    await drain();
    expect(await status(r.expense_request_id)).toBe("sent_back");
    // The withdrawal is the Send Back's: nobody is told the requester withdrew it.
    expect((await one("SELECT count(*)::int AS n FROM notification WHERE title LIKE 'Withdrawn:%'")).n).toBe(0);

    const fixed = await h.as("other").patch(`/expenses/mine/${r.expense_request_id}`).send(body({ purpose: "Ikeja activation water, invoice coming" }));
    expect(fixed.body.status).toBe("sent_back");
    const again = await h.as("other").post(`/expenses/mine/${r.expense_request_id}/submit`).send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "submitted", waiting_on: "Line Manager" });
    expect(again.body.workflow_instance_id).not.toBe(r.workflow_instance_id);
    expect((await h.as("other").post(`/expenses/mine/${r.expense_request_id}/submit`).send({})).body.error.code).toBe("EXPENSE_ALREADY_SENT");

    // Cancelled while it waits: its approval is withdrawn with it.
    const gone = await h.as("other").post(`/expenses/mine/${r.expense_request_id}/cancel`).send({ reason: "Bought it myself" });
    expect(gone.body.status).toBe("cancelled");
    expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [again.body.workflow_instance_id])).state).toBe("cancelled");
  });

  test("Use My Company Account: refused without bank details on the profile; copied from it at sending", async () => {
    const own = { payee_type: "staff", uses_profile_account: true, payee_name: undefined, bank_name: undefined, account_name: undefined, account_number: undefined };
    const missing = await h.as("staff").post("/expenses/mine").send(body({ ...own, submit: true }));
    expect([missing.status, missing.body.error.code, missing.body.error.fields]).toEqual([422, "PROFILE_BANK_MISSING", { uses_profile_account: ["Add them to your profile"] }]);
    expect((await h.as("staff").post("/expenses/mine").send(body({ ...own, payee_type: "vendor" }))).body.error.code).toBe("PROFILE_ACCOUNT_STAFF_ONLY");
    await q("UPDATE employee SET bank_name = 'Access Bank', account_number = '0987654321' WHERE employee_id = $1", [h.people.staff.employee_id]);
    const r = await raise("staff", own);
    expect(r).toMatchObject({ uses_profile_account: true, payee_name: "Musa Danjuma", bank_name: "Access Bank", account_name: "Musa Danjuma", account_number: "0987654321" });
    // A later change to the profile leaves the request as it was sent.
    await q("UPDATE employee SET account_number = '1111111111' WHERE employee_id = $1", [h.people.staff.employee_id]);
    expect((await h.as("staff").get(`/expenses/${r.expense_request_id}`)).body.account_number).toBe("0987654321");
    // A payee typed by hand must be whole to send.
    const half = await h.as("staff").post("/expenses/mine").send(body({ account_name: undefined, submit: true }));
    expect([half.status, half.body.error.fields]).toEqual([422, { account_name: ["Required"] }]);
  });

  test("bank details are masked for a reader whose role hides them, never for the requester", async () => {
    const r = await raise("staff");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) SELECT role_id, 'employee.bank', 'masked' FROM role WHERE code = 'manager' ON CONFLICT DO NOTHING");
    await grantsCache.invalidateGrants();
    const seen = await h.as("manager").get(`/expenses/${r.expense_request_id}`);
    expect(seen.body).toMatchObject({ bank_name: null, account_name: null, account_number: null, payee_name: "Chuks Stores" });
    expect((await h.as("staff").get(`/expenses/${r.expense_request_id}`)).body.account_number).toBe("0123456789");
    await q("DELETE FROM field_visibility WHERE field_key = 'employee.bank'");
    await grantsCache.invalidateGrants();
  });

  test("an invoice staged through the upload engine is claimed by its request and opens for its approvers, not for others", async () => {
    const staged = await h.as("staff").post("/documents").field("purpose", "document").attach("file", pdf(), { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(staged.status).toBe(201);
    // Somebody else's staged file is never claimed.
    const stolen = await h.as("other").post("/expenses/mine").send(body({ invoice_document_id: staged.body.document_id }));
    expect([stolen.status, stolen.body.error.fields]).toEqual([422, { invoice_document_id: ["Upload it again"] }]);
    const r = await raise("staff", { invoice_document_id: staged.body.document_id });
    expect(r.invoice).toMatchObject({ document_id: staged.body.document_id, file_name: "invoice.pdf", mime_type: "application/pdf" });
    expect(await one("SELECT doc_type, entity_type, entity_id FROM document WHERE document_id = $1", [staged.body.document_id])).toEqual({ doc_type: "expense_invoice", entity_type: "expense", entity_id: r.expense_request_id });
    expect((await h.as("manager").get(`/documents/${staged.body.document_id}`)).status).toBe(200);
    expect((await h.as("ops").get(`/documents/${staged.body.document_id}`)).status).toBe(200);
    expect((await h.as("outsider").get(`/documents/${staged.body.document_id}`)).status).toBe(404);
  });

  test("requisitions: approved requests grouped for the CEO, one removed with a reason, the rest authorised; a rejection returns them", async () => {
    const a = await approved("staff", { purpose: "Banner printing" });
    const b = await approved("other", { purpose: "Venue deposit" });
    const c2 = await approved("other", { purpose: "Generator fuel" });
    const waiting = await raise("staff", { purpose: "Not yet approved" });

    expect((await h.as("manager").post("/requisitions").send({ expense_request_ids: [a.expense_request_id] })).body.error.code).toBe("CAPABILITY_REQUIRED");
    const refused = await h.as("ops").post("/requisitions").send({ expense_request_ids: [a.expense_request_id, waiting.expense_request_id] });
    expect([refused.status, refused.body.error.code]).toEqual([409, "REQUEST_NOT_APPROVED"]);
    expect(await status(a.expense_request_id)).toBe("approved");

    const made = await h.as("ops").post("/requisitions").send({ expense_request_ids: [a.expense_request_id, b.expense_request_id, c2.expense_request_id] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: "submitted", requests: 3, total_amount: "31500.00", requester: { display_name: "Ada Obi" }, can_decide: false });
    expect(made.body.number).toMatch(/^REQ-\d{4}$/);
    expect(made.body.items.map((x) => x.status)).toEqual(["in_requisition", "in_requisition", "in_requisition"]);
    expect((await h.as("ops").post("/requisitions").send({ expense_request_ids: [a.expense_request_id] })).body.error.code).toBe("REQUEST_NOT_APPROVED");
    expect((await h.as("staff").get(`/expenses/${a.expense_request_id}`)).body).toMatchObject({ status: "in_requisition", waiting_on: "CEO", requisition_number: made.body.number });

    const asCeo = await h.as("ceo").get(`/requisitions/${made.body.requisition_id}`);
    expect(asCeo.body.can_decide).toBe(true);
    expect((await h.as("ops").post(`/requisitions/${made.body.requisition_id}/remove`).send({ expense_request_id: b.expense_request_id, reason: "Not now" })).status).toBe(403);
    const removed = await h.as("ceo").post(`/requisitions/${made.body.requisition_id}/remove`).send({ expense_request_id: b.expense_request_id, reason: "Book the venue next quarter" });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ requests: 2, total_amount: "21000.00" });
    expect(await status(b.expense_request_id)).toBe("approved");
    await drain();
    expect(await one("SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 AND n.title LIKE 'Removed from requisition%'", [h.people.other.employee_id])).toBeTruthy();

    await decide("ceo", made.body.workflow_instance_id);
    expect(await status(a.expense_request_id)).toBe("authorised");
    expect(await status(c2.expense_request_id)).toBe("authorised");
    expect((await h.as("ops").get(`/requisitions/${made.body.requisition_id}`)).body).toMatchObject({ status: "approved", can_decide: false });

    const second = await h.as("ops").post("/requisitions").send({ expense_request_ids: [b.expense_request_id] });
    const no = await h.as("ceo").post(`/workflow/instances/${second.body.workflow_instance_id}/reject`).send({ reason: "Too early" });
    expect(no.status).toBe(200);
    await drain();
    expect(await one("SELECT status, requisition_id FROM expense_request WHERE expense_request_id = $1", [b.expense_request_id])).toEqual({ status: "approved", requisition_id: null });
    expect((await h.as("ops").get(`/requisitions/${second.body.requisition_id}`)).body.status).toBe("rejected");

    // Removing the only request left cancels the requisition and its approval.
    const lone = await h.as("ops").post("/requisitions").send({ expense_request_ids: [b.expense_request_id] });
    const emptied = await h.as("ceo").post(`/requisitions/${lone.body.requisition_id}/remove`).send({ expense_request_id: b.expense_request_id, reason: "Rebook later" });
    expect(emptied.body).toMatchObject({ status: "cancelled", requests: 0 });
    expect((await one("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [lone.body.workflow_instance_id])).state).toBe("cancelled");

    const page = await h.as("ops").get("/requisitions?status=approved");
    expect(page.body.data.map((r) => r.requisition_id)).toContain(made.body.requisition_id);
    expect((await h.as("staff").get("/requisitions")).body.error.code).toBe("CAPABILITY_REQUIRED");
  });

  test("disbursements: the bank reference asked for, Save Without Reference flags it Reference Missing, Add Reference fills it; one per request", async () => {
    const r = await approved("staff", { purpose: "T-shirts for the walk" });
    const req = await h.as("ops").post("/requisitions").send({ expense_request_ids: [r.expense_request_id] });
    await decide("ceo", req.body.workflow_instance_id);

    const early = await approved("other", { purpose: "Not authorised" });
    expect((await h.as("ops").post("/disbursements").send({ expense_request_id: early.expense_request_id, payment_reference: "GT1", paid_on: "2026-11-02" })).body.error.code).toBe("REQUEST_NOT_AUTHORISED");

    const noRef = await h.as("ops").post("/disbursements").send({ expense_request_id: r.expense_request_id, paid_on: "2026-11-02" });
    expect([noRef.status, noRef.body.error.code, noRef.body.error.fields]).toEqual([422, "REFERENCE_REQUIRED", { payment_reference: ["Add the reference"] }]);
    expect((await h.as("staff").post("/disbursements").send({ expense_request_id: r.expense_request_id, paid_on: "2026-11-02", confirm_without_reference: true })).body.error.code).toBe("CAPABILITY_REQUIRED");

    const paid = await h.as("ops").post("/disbursements").send({ expense_request_id: r.expense_request_id, paid_on: "2026-11-02", confirm_without_reference: true });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ amount: "10500.00", recipient_type: "vendor", recipient_name: "Chuks Stores", bank_name: "GTBank", account_number: "0123456789", payment_reference: null, reference_missing: true, paid_on: "2026-11-02", processed_by: "Ada Obi" });
    expect(paid.body.number).toMatch(/^DSB-\d{4}$/);
    expect(await status(r.expense_request_id)).toBe("disbursed");
    const twice = await h.as("ops").post("/disbursements").send({ expense_request_id: r.expense_request_id, paid_on: "2026-11-02", payment_reference: "GT2" });
    expect([twice.status, twice.body.error.code]).toEqual([409, "ALREADY_DISBURSED"]);

    const missing = await h.as("ops").get("/disbursements?reference_missing=true");
    expect(missing.body.data.map((d) => d.disbursement_id)).toEqual([paid.body.disbursement_id]);
    const filled = await h.as("ops").patch(`/disbursements/${paid.body.disbursement_id}`).send({ payment_reference: "GT2611020042" });
    expect(filled.body).toMatchObject({ payment_reference: "GT2611020042", reference_missing: false });
    expect((await h.as("ops").patch(`/disbursements/${paid.body.disbursement_id}`).send({ payment_reference: "GT9" })).body.error.code).toBe("REFERENCE_SET");
    expect((await h.as("ops").get("/disbursements?reference_missing=true")).body.data).toEqual([]);

    await drain();
    expect(await one("SELECT title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 AND n.title = $2", [h.people.staff.employee_id, `Paid: ${r.number}`])).toBeTruthy();
    expect((await h.as("staff").get("/expenses/mine/summary")).body.disbursed_this_year).toBe("10500.00");
    expect((await h.as("staff").get(`/expenses/${r.expense_request_id}`)).body).toMatchObject({ status: "disbursed", waiting_on: null, can_cancel: false });
  });

  test("withdraw: an `expenses.finance` holder takes back an approved request with a reason, out of its requisition, and its requester is told", async () => {
    const r = await approved("staff", { purpose: "Flyers" });
    const s = await approved("staff", { purpose: "Posters" });
    const req = await h.as("ops").post("/requisitions").send({ expense_request_ids: [r.expense_request_id, s.expense_request_id] });
    expect((await h.as("manager").post(`/expenses/${r.expense_request_id}/withdraw`).send({ reason: "No" })).body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await h.as("ops").post(`/expenses/${r.expense_request_id}/withdraw`).send({})).body.error.code).toBe("REASON_REQUIRED");
    const out = await h.as("ops").post(`/expenses/${r.expense_request_id}/withdraw`).send({ reason: "The event moved online" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: "cancelled", requisition_id: null });
    expect((await h.as("ops").get(`/requisitions/${req.body.requisition_id}`)).body).toMatchObject({ requests: 1, total_amount: "10500.00" });
    await drain();
    expect(await one("SELECT body FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1 AND n.title = $2", [h.people.staff.employee_id, `Request withdrawn: ${r.number}`])).toEqual({ body: "Reason: The event moved online" });
    const pending = await raise("staff", { purpose: "Still waiting" });
    expect((await h.as("ops").post(`/expenses/${pending.expense_request_id}/withdraw`).send({ reason: "No" })).body.error.code).toBe("EXPENSE_NOT_WITHDRAWABLE");
  });

  test("lists page at 25 within scope: a member of staff their own, a line manager their team, Operations & People everyone", async () => {
    const mine = await h.as("staff").get("/expenses/mine");
    expect(mine.body.page.size).toBe(25);
    expect(mine.body.data.every((r) => r.requester.display_name === "Musa Danjuma")).toBe(true);
    const own = await h.as("staff").get("/expenses");
    expect(own.body.data.every((r) => r.requester.display_name === "Musa Danjuma")).toBe(true);
    const team = await h.as("manager").get("/expenses");
    expect(new Set(team.body.data.map((r) => r.requester.display_name))).toEqual(new Set(["Musa Danjuma", "Zainab Lawal", "Kemi Alade"]));
    expect((await h.as("outsider").get("/expenses")).body.data).toEqual([]);
    const all = await h.as("ops").get("/expenses?status=disbursed");
    expect(all.body.data.length).toBeGreaterThan(0);
    const found = await h.as("ops").get(`/expenses?q=${encodeURIComponent("t-shirts")}`);
    expect(found.body.data.map((r) => r.purpose)).toEqual(["T-shirts for the walk"]);
  });

  test("a request's history: its own events, its approval's, and its requisition's removal by the CEO (audit F3), 25 a page", async () => {
    const r = await approved("staff", { purpose: "History walk water" });
    const grouped = await h.as("ops").post("/requisitions").send({ expense_request_ids: [r.expense_request_id] });
    expect(grouped.status).toBe(201);
    const removed = await h.as("ceo").post(`/requisitions/${grouped.body.requisition_id}/remove`).send({ expense_request_id: r.expense_request_id, reason: "Not this month" });
    expect(removed.status).toBe(200);
    await drain();
    const res = await h.as("staff").get(`/expenses/${r.expense_request_id}/history`);
    expect([res.status, res.body.error]).toEqual([200, undefined]);
    expect(res.body.page.size).toBe(25);
    const actions = res.body.data.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["expense_request.created", "expense_request.submitted", "expense_request.approved", "requisition.submitted", "requisition.request_removed"]));
    expect(res.body.data.find((e) => e.action === "requisition.request_removed")).toMatchObject({ label: "Removed from its requisition by the CEO", reason: "Not this month", by: expect.any(String) });
    expect((await h.as("outsider").get(`/expenses/${r.expense_request_id}/history`)).status).toBe(404);
  });
  test("Possible Duplicates names only the requests the reader may open; the rest are a count, and the AI gets the named ones (audit F8)", async () => {
    const vendor = { payee_name: "Lekki Tents", account_name: "Lekki Tents Ltd", account_number: "0999999999", lines: [{ description: "Tent", unit_price: "77000.00" }] };
    const theirs = await raise("outsider", { ...vendor, purpose: "Finance tent" });
    const ours = await raise("staff", { ...vendor, purpose: "Programmes tent" });
    const mine = (await h.as("staff").get(`/expenses/${ours.expense_request_id}`)).body;
    expect([mine.possible_duplicates, mine.possible_duplicates_hidden]).toEqual([[], 1]);
    // The line manager deciding it reads their team, not Finance.
    const head = (await h.as("manager").get(`/expenses/${ours.expense_request_id}`)).body;
    expect([head.possible_duplicates.length, head.possible_duplicates_hidden]).toEqual([0, 1]);
    const ops = (await h.as("ops").get(`/expenses/${ours.expense_request_id}`)).body;
    expect(ops.possible_duplicates.map((d) => d.expense_request_id)).toEqual([theirs.expense_request_id]);
    expect(ops.possible_duplicates_hidden).toBe(0);
    expect(JSON.stringify(mine)).not.toContain("Finance tent");
    // Check Duplicate from the requester compares with nothing they cannot open.
    const checked = await h.as("staff").post(`/expenses/${ours.expense_request_id}/duplicate-check`).send({});
    expect([checked.status, checked.body.available, checked.body.reason]).toEqual([200, false, "none"]);
  });

  test("the KPI cards' own filters: disbursed from a day, and approved by the reader from a day (audit F21)", async () => {
    const year = `${lagos.today().slice(0, 4)}-01-01`;
    const paid = await h.as("staff").get(`/expenses/mine?disbursed_from=${year}`);
    expect(paid.body.data.length).toBeGreaterThan(0);
    expect(paid.body.data.every((r) => r.status === "disbursed")).toBe(true);
    expect((await h.as("staff").get(`/expenses/mine?disbursed_from=${Number(year.slice(0, 4)) + 1}-01-01`)).body.data).toEqual([]);
    const month = `${lagos.today().slice(0, 7)}-01`;
    const approvedByHead = await h.as("manager").get(`/expenses?approved_by_me_from=${month}`);
    expect(approvedByHead.body.data.length).toBeGreaterThan(0);
    const decided = await one(
      `SELECT count(DISTINCT wi.entity_id)::int AS n FROM workflow_decision d JOIN workflow_instance wi ON wi.workflow_instance_id = d.workflow_instance_id
        JOIN app_user u ON u.user_id = d.actor_id WHERE wi.definition_key = 'expenses.request' AND d.decision = 'approve' AND u.employee_id = $1`,
      [h.people.manager.employee_id],
    );
    expect(approvedByHead.body.page.total).toBe(decided.n);
    expect((await h.as("other").get(`/expenses?approved_by_me_from=${month}`)).body.data).toEqual([]);
  });
});

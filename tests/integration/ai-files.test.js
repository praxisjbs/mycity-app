"use strict";
/**
 * Documents in the chat on the real migrations (docs/guides/praxis-ai.md §1.10 decisions 41 to 48,
 * §6.18), the chat's model scripted and each kind's reader stubbed: JBS Praxis's sample invoice
 * becomes a New Request card of ₦150,000.00 in six lines (four items, the discount, the payment
 * already made) whose press claims the invoice for the request, so its line manager opens it; a
 * receipt matched to the one authorised request it paid becomes Record Disbursement, pressed after
 * Confirm It's You, the receipt claimed; a kind is offered only to someone who may make what it
 * becomes; somebody else's upload, a Word file and a file that cannot be read draw no card.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-files
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
const ai = require("../../src/services/ai/llm.service");
const drafts = require("../../src/services/ai/drafts");
const gemini = require("../../src/services/ai/vendors/gemini");
const lagos = require("../../src/shared/time/lagos");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
/** A made-up account: never a real one. */
const ACCOUNT = "0000054321";

/** JBS Praxis's invoice INV-202611-9525 as the reader returns it (the account number made up). */
const INVOICE = {
  payee_name: "JBS Praxis",
  category: "Legal and Professional Services",
  subject: "Website ticket payments: three switchable gateways",
  invoice_number: "INV-202611-9525",
  issued_on: "2026-11-10",
  currency: "NGN",
  lines: [
    { description: "Payment gateway integration", quantity: "1", unit_price: "250000.00" },
    { description: "Ticket checkout pages", quantity: "1", unit_price: "150000.00" },
    { description: "Refunds and reconciliation", quantity: "1", unit_price: "100000.00" },
    { description: "Testing and go-live support", quantity: "1", unit_price: "50000.00" },
    { description: "Discount", quantity: "1", unit_price: "-100000.00" },
  ],
  total: "450000.00",
  paid_to_date: "300000.00",
  balance_due: "150000.00",
  bank_name: "Nombank MFB",
  account_name: "JBS Praxis",
  account_number: ACCOUNT,
};

describeDb("documents in the chat against the real migrations", () => {
  let app;
  let h;
  const made = {};

  /** The kinds' readers answer from the stub; every other call goes on as it would. */
  const readers = (outputs) => {
    const real = ai.complete;
    return jest.spyOn(ai, "complete").mockImplementation(async (opts) => (outputs[opts.purpose] !== undefined ? { output: outputs[opts.purpose], run_id: null } : real(opts)));
  };
  const stage = async (who, { file = pdf(), name = "invoice.pdf", type = "application/pdf" } = {}) => {
    const res = await h.as(who).post("/documents").field("purpose", "ai_attachment").attach("file", file, { filename: name, contentType: type });
    return res;
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
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "other", first: "Bisi", last: "Ade", email: "other@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people.staff.employee_id]);
    await grantsCache.bumpTeamVersion();
    expect((await h.as("ops").post("/expense-categories/suggested").send({})).status).toBe(200);
    await drain();
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  beforeEach(() => {
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
  });
  afterEach(() => jest.restoreAllMocks());

  test("a kind is offered only to someone who may make what it becomes, and refused to anyone else", async () => {
    const staff = await h.as("staff").get("/ai/attachment-kinds");
    // Every seeded role sees Partnerships, so Contract or MoU is everyone's tile (decision 41).
    expect([staff.status, staff.body]).toEqual([
      200,
      {
        kinds: [
          { kind: "invoice", label: "Invoice", question: "Raise an expense request from this invoice" },
          { kind: "contract", label: "Contract or MoU", question: "Summarise this contract and file it" },
        ],
        available: true,
      },
    ]);
    const ops = await h.as("ops").get("/ai/attachment-kinds");
    expect(ops.body.kinds.map((k) => k.kind)).toEqual(["invoice", "payment_receipt", "contract"]);

    const staged = await stage("staff", { name: "receipt.pdf" });
    expect(staged.status).toBe(201);
    const refused = await h.ask("staff", { question: "", attachment: { document_id: staged.body.document_id, kind: "payment_receipt" }, shows: ["cards"] });
    expect([refused.status, refused.body.error.code, refused.body.error.fields]).toEqual([403, "ATTACHMENT_FORBIDDEN", { attachment: ["Not open to you"] }]);
    // An empty question needs a document.
    expect((await h.ask("staff", { question: "", shows: ["cards"] })).body.error.fields).toEqual({ question: ["Ask a question"] });
  });

  test("my_expenses.from_invoice: the sample invoice is read as file.invoice and drawn as New Request for its balance due, the reader's figures over the model's; the press claims the invoice", async () => {
    readers({ "expense-invoice-read": INVOICE });
    const sent = script(
      say({ text: "This invoice from JBS Praxis asks for the balance of ₦150,000.00.", action: { key: "my_expenses.from_invoice", values: { purpose: "Whatever the model wrote", lines: [{ description: "Made up", quantity: 1, unit_price: 999 }] }, suggested: false } }),
    );
    const staged = await stage("staff", { name: "INV-202611-9525.pdf" });
    const asked = await h.ask("staff", { question: "", attachment: { document_id: staged.body.document_id, kind: "invoice" }, shows: ["cards"] });
    expect([asked.status, asked.body.error]).toEqual([200, undefined]);
    const a = asked.body;
    expect(a.question).toBe("Raise an expense request from this invoice");
    // An invoice shows its figures on the card, so it draws no terms for the Record tab (§6.18).
    expect(a.attachment).toEqual({ kind: "invoice", document: expect.objectContaining({ document_id: staged.body.document_id, file_name: "INV-202611-9525.pdf" }), record: null });
    expect(a.reads[0]).toMatchObject({ n: 1, key: "file.invoice", outcome: "read", module_key: "expenses" });
    // The model got the reading as data with the question, never the file, and never the account number.
    const user = sent[0].messages.filter((m) => m.role === "user").pop();
    expect(user.content).toContain("INV-202611-9525");
    expect(user.content).not.toContain(ACCOUNT);

    const card = a.card;
    expect(card).toMatchObject({ action_key: "my_expenses.from_invoice", label: "New Request", problems: {} });
    expect(card.values).toMatchObject({
      purpose: "Website ticket payments: three switchable gateways, INV-202611-9525",
      payee_type: "vendor",
      payee_name: "JBS Praxis",
      bank_name: "Nombank MFB",
      account_number: ACCOUNT,
      invoice_document_id: staged.body.document_id,
      expense_category_id: expect.any(String),
      submit: true,
    });
    expect(card.values.lines).toHaveLength(6);
    expect(card.values.lines[5]).toEqual({ description: "Paid to date on INV-202611-9525", quantity: "1", unit_price: "-300000.00" });
    expect(card.fields.find((f) => f.name === "lines")).toMatchObject({ kind: "lines" });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "document", id: staged.body.document_id, label: "INV-202611-9525.pdf" })]));
    // The file read is never replayed: there is no read of it to run again.
    expect((await h.as("staff").get(`/ai/answers/${a.ai_message_id}/reads/1`)).status).toBe(404);

    // A later question in the same conversation keeps the file's figures on its card (§6.18 step 6).
    script(say({ text: "Kept as a draft.", action: { key: "my_expenses.from_invoice", values: { submit: false, lines: [] }, suggested: false } }));
    const again = await h.ask("staff", { question: "Keep it as a draft for now.", ai_conversation_id: a.ai_conversation_id, shows: ["cards"] });
    expect([again.status, again.body.error]).toEqual([200, undefined]);
    expect(again.body.card.values).toMatchObject({ submit: false, invoice_document_id: staged.body.document_id });
    expect(again.body.card.values.lines).toHaveLength(6);
    expect(again.body.attachment).toBeNull();
    const turns = await h.as("staff").get(`/ai/conversations/${a.ai_conversation_id}/turns`);
    expect(turns.body.data.map((t) => (t.attachment ? t.attachment.kind : null))).toEqual([null, "invoice"]);

    const pressed = await h.press("staff", card.ai_action_draft_id);
    expect([pressed.status, pressed.body.error]).toEqual([200, undefined]);
    await drain();
    const row = await one("SELECT expense_request_id, amount, status, invoice_document_id, account_number FROM expense_request WHERE purpose LIKE 'Website ticket payments%'");
    expect(row).toMatchObject({ amount: "150000.00", status: "submitted", invoice_document_id: staged.body.document_id, account_number: ACCOUNT });
    expect((await one("SELECT count(*)::int AS n FROM expense_request_line WHERE expense_request_id = $1", [row.expense_request_id])).n).toBe(6);
    expect(await one("SELECT doc_type, entity_type FROM document WHERE document_id = $1", [staged.body.document_id])).toEqual({ doc_type: "expense_invoice", entity_type: "expense" });
    // Its line manager opens the request and its invoice.
    const opened = await h.as("manager").get(`/expenses/${row.expense_request_id}`);
    expect([opened.status, opened.body.invoice && opened.body.invoice.document_id]).toEqual([200, staged.body.document_id]);
    expect((await h.as("manager").get(`/documents/${staged.body.document_id}/content`)).status).toBe(200);
    made.request = row.expense_request_id;
  });

  test("an invoice paid in full draws no card and says so; one that cannot be read is one sentence with no model asked", async () => {
    readers({ "expense-invoice-read": { ...INVOICE, paid_to_date: "450000.00", balance_due: "0.00" } });
    script(say({ text: "This invoice from JBS Praxis.", action: null }));
    const paidUp = await stage("staff");
    const paid = await h.ask("staff", { question: "", attachment: { document_id: paidUp.body.document_id, kind: "invoice" }, shows: ["cards"] });
    expect([paid.status, paid.body.card]).toEqual([200, null]);
    expect(paid.body.content).toContain("paid in full");

    jest.restoreAllMocks();
    jest.spyOn(drafts, "availability").mockResolvedValue({ available: true, reason: null });
    readers({ "expense-invoice-read": { ...INVOICE, lines: [], total: null, paid_to_date: null, balance_due: null } });
    const talk = jest.spyOn(gemini, "complete");
    const blurred = await stage("staff", { name: "blurred.pdf" });
    const unread = await h.ask("staff", { question: "", attachment: { document_id: blurred.body.document_id, kind: "invoice" }, shows: ["cards"] });
    expect([unread.status, unread.body.content, unread.body.card, unread.body.reads]).toEqual([200, "This file cannot be read. Try a clearer copy.", null, []]);
    expect(talk).not.toHaveBeenCalled();
  });

  test("somebody else's upload and a Word file are refused", async () => {
    const mine = await stage("staff");
    const theirs = await h.ask("other", { question: "", attachment: { document_id: mine.body.document_id, kind: "invoice" }, shows: ["cards"] });
    expect([theirs.status, theirs.body.error.fields]).toEqual([404, { attachment: ["Upload it again"] }]);
    const word = await stage("staff", { file: Buffer.from("Dear Sir, please pay the attached."), name: "invoice.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect([word.status, word.body.error.code]).toEqual([415, "FILE_TYPE_REFUSED"]);
  });

  test("disbursements.create from a receipt: read as file.payment_receipt, the one authorised request it paid matched in SQL, pressed after Confirm It's You, the receipt claimed", async () => {
    // The invoice's request through its approvals and the CEO's requisition: authorised, waiting to be paid.
    const instance = async () => (await one("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [made.request])).workflow_instance_id;
    await decide("manager", await instance());
    await decide("ops", await instance());
    expect((await h.as("ops").post("/requisitions").send({ expense_request_ids: [made.request] })).status).toBe(201);
    await drain();
    await decide("ceo", (await one("SELECT workflow_instance_id FROM requisition ORDER BY created_at DESC LIMIT 1")).workflow_instance_id);
    expect((await one("SELECT status FROM expense_request WHERE expense_request_id = $1", [made.request])).status).toBe("authorised");

    const today = lagos.today();
    const RECEIPT = { payment_reference: "NB2611120001", paid_on: today, amount: "150000.00", beneficiary_name: "JBS Praxis", beneficiary_account_number: ACCOUNT, beneficiary_bank: "Nombank MFB", narration: "Balance on INV-202611-9525" };
    readers({ "disbursement-receipt-read": RECEIPT });
    // The model drafts nothing: the kind's own card is drawn from the reading.
    script(say({ text: "A transfer of ₦150,000.00 to JBS Praxis.", action: null }));
    const staged = await stage("ops", { name: "transfer.pdf" });
    const asked = await h.ask("ops", { question: "", attachment: { document_id: staged.body.document_id, kind: "payment_receipt" }, shows: ["cards"] });
    expect([asked.status, asked.body.error]).toEqual([200, undefined]);
    expect(asked.body.reads[0]).toMatchObject({ n: 1, key: "file.payment_receipt", outcome: "read" });
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "disbursements.create", risk: "money", confirm: "fresh_sign_in", suggested: false, problems: {} });
    expect(card.values).toMatchObject({ expense_request_id: made.request, payment_reference: "NB2611120001", paid_on: today, receipt_document_id: staged.body.document_id });
    expect(card.records).toEqual([expect.objectContaining({ type: "expense", id: made.request })]);
    expect(card.names).toEqual([expect.objectContaining({ type: "document", label: "transfer.pdf" })]);

    await h.stale("ops");
    expect((await h.press("ops", card.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const paid = await h.press("ops", card.ai_action_draft_id);
    expect([paid.status, paid.body.error]).toEqual([200, undefined]);
    await drain();
    const d = await one("SELECT number, payment_reference, receipt_document_id FROM disbursement WHERE expense_request_id = $1", [made.request]);
    expect(d).toMatchObject({ payment_reference: "NB2611120001", receipt_document_id: staged.body.document_id });
    expect((await one("SELECT doc_type FROM document WHERE document_id = $1", [staged.body.document_id])).doc_type).toBe("disbursement_receipt");

    // The same receipt again matches a request already paid: named, and the card asks which request instead.
    script(say({ text: "A transfer of ₦150,000.00 to JBS Praxis.", action: null }));
    const twice = await stage("ops", { name: "transfer-again.pdf" });
    const again = await h.ask("ops", { question: "", attachment: { document_id: twice.body.document_id, kind: "payment_receipt" }, shows: ["cards"] });
    expect(again.body.content).toContain(`was already paid as ${d.number}`);
    expect([again.body.card, again.body.content]).toEqual([null, expect.stringContaining("Which request was paid?")]);
  });
});

"use strict";
/**
 * Read Invoice and Suggest Category on New Request (docs/guides/expenses.md §9; jobs chosen by AJ,
 * docs/handoff/m8-expenses.md decision 14). Each runs only when the person presses it, never in a
 * transaction, and nothing is kept: the form takes what they accept, and saving the request is
 * their own press (A23).
 *
 *   readInvoice()     POST /expenses/mine/invoice-reading, prompt `expense-invoice-read` on Image
 *                     Reading: the invoice they staged read for its payee, lines and category
 *   suggestCategory() POST /expenses/mine/category-suggestion, prompt `expense-category-suggest` on
 *                     Default: one offered category from the purpose and the lines typed so far
 *   readForChat()     an invoice attached on Praxis AI (praxis-ai.md §6.18, decision 45), read by the
 *                     same action for New Request's card: its balance due line by line, a payment
 *                     already made a negative line, the payee's bank, a possible duplicate named
 *
 * What the model is given: the invoice itself (Read Invoice), the form's purpose and line
 * descriptions (Suggest Category), and the names of the categories offered on a request. Nothing
 * about the person. A category the model names is matched among those offered; one it made up is
 * left empty. Amounts are worked out here through shared/money, never by the model's sum.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const m = require("../../shared/money/money");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const categories = require("../expense_categories/expense_categories.service");
const { scopeFor } = require("../../middleware/rbac");
const { formatDate } = require("../../shared/time/day-first");

const MODULE = "expenses";

const offInvoice = (reason) => ({ available: false, reason, payee_name: null, expense_category_id: null, category: null, lines: [], amount: null, bank_name: null, account_name: null, account_number: null, ai_run_id: null });
/** An account number a request takes: ten digits, as printed with its spaces taken out. */
const accountOf = (v) => {
  const digits = String(v || "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
};
const offCategory = (reason) => ({ available: false, reason, expense_category_id: null, category: null, ai_run_id: null });

/** The names of the categories a request may use, and their ids by folded name. */
async function offered(db) {
  const list = await categories.offeredForSuggestion(db);
  const byName = new Map(list.map((o) => [o.name.toLowerCase(), o.id]));
  return { names: list.map((o) => o.name), idOf: (name) => (name ? byName.get(String(name).trim().toLowerCase()) || null : null) };
}

/** Run one suggestion (`ask` makes the one call), or answer why there is none (off, or this month's budget spent). */
async function run(ask, off) {
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return { off: off(now.reason) };
  try {
    return { run: await ask() };
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return { off: off(reason) };
    // A provider that refuses the file (its kind, its size) answers like a wrong setting; for a
    // file the person sees "This file cannot be read" (audit F9). The administrator is told by
    // the AI client either way.
    if (err && (err.code === "AI_VENDOR_CONFIG" || err.code === "AI_FILE_TOO_LARGE") && off === offInvoice) return { unreadable: true };
    throw err;
  }
}

/**
 * Read Invoice: the file the person staged for this request (POST /documents) or one their own
 * request already holds, read for the form.
 * @param {object} user  req.user
 * @param {{document_id: string}} body  ExpenseInvoiceReading
 */
async function readInvoice(user, body) {
  const doc = await vault.getReadable(pool, user, body.document_id);
  const staged = doc.doc_type === vault.STAGED_DOC_TYPE && doc.uploaded_by === user.user_id;
  const own = doc.entity_type === "expense" && doc.subject_employee_id === user.employee_id;
  if (!staged && !own) throw new AppError("NOT_FOUND", "Document not found", 404, { document_id: ["Upload it again"] });
  if (!ai.FILE_TYPES.includes(doc.mime)) return offInvoice("unreadable");
  if (doc.scan_status === "pending" || doc.scan_status === "infected") return offInvoice("unreadable");

  const { names, idOf } = await offered(pool);
  const data = await storage.get(doc.storage_key);
  const got = await run(
    () =>
      ai.complete({
        purpose: "expense-invoice-read",
        module: MODULE,
        actor: user,
        input: { categories: names },
        output: c.expenses.ExpenseInvoiceRead,
        files: [{ mime_type: doc.mime, data }],
        egress: "external",
        temperature: 0,
      }),
    offInvoice,
  );
  if (got.off) return got.off;
  if (got.unreadable) return offInvoice("unreadable");
  const out = got.run.output;
  // The stub cannot read an invoice: with no provider set up, Read Invoice is off.
  if (!out) return offInvoice("off");
  const lines = out.lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unit_price: m.toWire(l.unit_price) }));
  const amount = lines.length ? m.toWire(m.sum(lines.map((l) => m.money(l.quantity).times(m.money(l.unit_price))))) : null;
  const categoryId = idOf(out.category);
  return {
    available: true,
    reason: null,
    payee_name: out.payee_name ? out.payee_name.trim() : null,
    expense_category_id: categoryId,
    category: categoryId ? out.category.trim() : null,
    lines,
    amount,
    // The payee's bank as the invoice prints it, so the form fills it from the same reading (praxis-ai.md §6.18).
    bank_name: out.bank_name ? out.bank_name.trim() : null,
    account_name: out.account_name ? out.account_name.trim() : null,
    account_number: accountOf(out.account_number),
    ai_run_id: got.run.run_id || null,
  };
}

/** A line's text as a request holds it. */
const cut = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
/** The currencies a request is raised in: naira only (guide §6.1 rule 1). */
const NAIRA = /^(NGN|N|₦|NAIRA)$/i;

/**
 * An invoice's lines as the request asks for its balance due (praxis-ai.md decision 45): the items as
 * read (a discount a negative line), then the payment already made as one negative line, counted
 * through shared/money; the problem the card shows when the lines are not the invoice's to send.
 * Pure: the same reading gives the same lines.
 * @param {object} out  ExpenseInvoiceRead
 * @returns {{lines: Array<{description: string, quantity: string, unit_price: string}>, total: string, problems: Record<string, string[]>}}
 */
function invoiceLines(out) {
  const lines = (out.lines || []).map((l) => ({ description: cut(l.description, 200), quantity: l.quantity || "1", unit_price: m.toWire(l.unit_price) }));
  // An invoice that prints only its total is one line of it.
  const whole = out.total || out.balance_due;
  if (!lines.length && whole) lines.push({ description: cut(out.subject || (out.invoice_number ? `Invoice ${out.invoice_number}` : "Invoice"), 200), quantity: "1", unit_price: m.toWire(out.total || out.balance_due) });
  if (out.paid_to_date && m.money(out.paid_to_date).greaterThan(0))
    lines.push({ description: cut(`Paid to date on ${out.invoice_number || "this invoice"}`, 200), quantity: "1", unit_price: m.toWire(m.money(out.paid_to_date).negated()) });
  const total = lines.length ? m.toWire(m.sum(lines.map((l) => m.money(l.quantity).times(m.money(l.unit_price))))) : "0.00";
  const problems = {};
  if (out.currency && !NAIRA.test(String(out.currency).trim())) problems.lines = ["Naira only"];
  else if (lines.length > 25) problems.lines = ["At most 25"];
  else if (out.balance_due && !m.money(total).equals(m.money(out.balance_due))) problems.lines = ["Check the lines"];
  return { lines, total, problems };
}

/** What the request is for: the invoice's subject with its number, else the invoice and its payee. */
function purposeOf(out) {
  const subject = cut(out.subject, 150);
  const number = cut(out.invoice_number, 60);
  if (subject) return cut(number ? `${subject}, ${number}` : subject, 200);
  const from = cut(out.payee_name, 120);
  return cut([`Invoice${number ? ` ${number}` : ""}`, from && `from ${from}`].filter(Boolean).join(" "), 200);
}

const fold = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Who the invoice is paid to, as a request names it: the person themself (Staff), a partner they see
 * by that name (Partner), else Vendor.
 */
async function payeeTypeOf(actor, payeeName, db) {
  const name = fold(payeeName);
  if (!name) return "vendor";
  const me = await db.query("SELECT first_name, last_name FROM employee WHERE employee_id = $1", [actor.employee_id || null]);
  const own = me.rows[0] ? fold(`${me.rows[0].first_name} ${me.rows[0].last_name}`) : "";
  if (own && own === name) return "staff";
  const scope = await scopeFor(actor, "partnerships", "view");
  if (!scope) return "vendor";
  try {
    const partners = require("../partners/partners.service");
    const page = await partners.list({ q: String(payeeName).trim().slice(0, 100), page: 1 }, scope);
    return (page.data || []).some((p) => fold(p.name) === name) ? "partner" : "vendor";
  } catch {
    return "vendor";
  }
}

/** A line of the answer naming a request the invoice may repeat (§6.8), only one the person may open. */
async function duplicateNote(actor, payee, amount) {
  const scope = await scopeFor(actor, "expenses", "view");
  const service = require("./expenses.service");
  const found = await service.possibleDuplicatesOf(actor, scope, { ...payee, amount });
  const d = found[0];
  return d ? `${d.number} asked the same payee for the same amount on ${formatDate(new Date(d.submitted_at))}.` : null;
}

/**
 * An invoice attached on Praxis AI, read for New Request's card (praxis-ai.md §6.18): the same action
 * as Read Invoice, on the person's own staged file. The model reads; the server decides every figure
 * (decision 44): the lines and their total through shared/money, the category among those offered,
 * the account number only when it is ten digits, the project and the payee among the person's own.
 * Nothing is saved: the card is the person's to check and press.
 * @param {object} actor  req.user
 * @param {object} doc    the staged document (vault row)
 * @param {{query: Function}} [db]
 * @returns {Promise<{outcome: string, reading?: object, card?: object|null, notes?: string[]}>}
 */
async function readForChat(actor, doc, db = pool) {
  if (!ai.FILE_TYPES.includes(doc.mime) || doc.scan_status === "pending" || doc.scan_status === "infected") return { outcome: "unreadable" };
  const { names, idOf } = await offered(db);
  const data = await storage.get(doc.storage_key);
  const got = await run(
    () =>
      ai.complete({
        purpose: "expense-invoice-read",
        module: MODULE,
        actor,
        input: { categories: names },
        output: c.expenses.ExpenseInvoiceRead,
        files: [{ mime_type: doc.mime, data }],
        egress: "external",
        temperature: 0,
      }),
    offInvoice,
  );
  if (got.off) return { outcome: got.off.reason === "limit" ? "limit" : "off" };
  if (got.unreadable) return { outcome: "unreadable" };
  const out = got.run.output;
  if (!out) return { outcome: "off" };
  if (!(out.lines || []).length && !out.total && !out.balance_due) return { outcome: "unreadable" };

  const { lines, total, problems } = invoiceLines(out);
  const payeeName = cut(out.payee_name, 150) || null;
  const account = String(out.account_number || "").replace(/[\s-]/g, "") || null;
  const reading = {
    payee_name: payeeName,
    subject: out.subject,
    invoice_number: out.invoice_number,
    issued_on: out.issued_on,
    currency: out.currency,
    lines: out.lines,
    total: out.total,
    paid_to_date: out.paid_to_date,
    balance_due: out.balance_due,
    category: out.category,
    bank_name: out.bank_name,
    account_name: out.account_name,
    account_number: account,
    request_total: total,
  };
  const notes = [];
  if (!m.money(total).greaterThan(0)) {
    notes.push("This invoice is paid in full, so there is nothing to request.");
    return { outcome: "read", reading, card: null, notes };
  }
  const dup = await duplicateNote(actor, { account_number: account, payee_name: payeeName }, total).catch(() => null);
  if (dup) notes.push(dup);
  const me = await db.query("SELECT department_id FROM employee WHERE employee_id = $1", [actor.employee_id || null]);
  const categoryId = idOf(out.category);
  const values = {
    purpose: purposeOf(out),
    lines,
    payee_type: await payeeTypeOf(actor, payeeName, db),
    invoice_document_id: doc.document_id,
    ...(payeeName ? { payee_name: payeeName } : {}),
    ...(out.bank_name ? { bank_name: cut(out.bank_name, 100) } : {}),
    ...(out.account_name ? { account_name: cut(out.account_name, 150) } : {}),
    // Ten digits or the card says so on the field: never a number made up to fit.
    ...(account ? { account_number: account } : {}),
  };
  // What was matched rather than read gives way to the person's own words in a later question.
  const defaults = {
    ...(categoryId ? { expense_category_id: categoryId } : {}),
    ...(me.rows[0] && me.rows[0].department_id ? { department_id: me.rows[0].department_id } : {}),
  };
  return { outcome: "read", reading, card: { action: "my_expenses.from_invoice", values, defaults, problems }, notes };
}

/**
 * Suggest Category: one offered category from the purpose and lines typed so far.
 * @param {object} user  req.user
 * @param {{purpose: string, lines: Array<{description: string}>}} body  ExpenseCategoryHint
 */
async function suggestCategory(user, body) {
  const { names, idOf } = await offered(pool);
  if (!names.length) return offCategory("off");
  const got = await run(
    () =>
      ai.complete({
        purpose: "expense-category-suggest",
        module: MODULE,
        actor: user,
        input: { purpose: body.purpose, lines: (body.lines || []).map((l) => l.description), categories: names },
        output: c.expenses.ExpenseCategoryPick,
        egress: "external",
        temperature: 0,
      }),
    offCategory,
  );
  if (got.off) return got.off;
  const out = got.run.output;
  if (!out) return offCategory("off");
  const id = idOf(out.category);
  return { available: true, reason: null, expense_category_id: id, category: id ? out.category.trim() : null, ai_run_id: got.run.run_id || null };
}

module.exports = { readInvoice, suggestCategory, readForChat, invoiceLines, purposeOf };

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
 *
 * What the model is given: the invoice itself (Read Invoice), the form's purpose and line
 * descriptions (Suggest Category), and the names of the categories offered on a request. Nothing
 * about the person. A category the model names is matched among those offered; one it made up is
 * left empty. Amounts are worked out here through shared/money, never by the model's sum; a
 * discount or an amount already paid is a line below zero, and the amount the invoice asks to be
 * paid now comes back beside the lines' sum, so the form can say when the two differ.
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

const MODULE = "expenses";

const offInvoice = (reason) => ({ available: false, reason, payee_name: null, expense_category_id: null, category: null, lines: [], amount: null, amount_due: null, ai_run_id: null });
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
    amount_due: out.amount_due ? m.toWire(out.amount_due) : null,
    ai_run_id: got.run.run_id || null,
  };
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

module.exports = { readInvoice, suggestCategory };

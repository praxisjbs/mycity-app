"use strict";
/**
 * A payment receipt attached on Praxis AI · Ask, read for Record Disbursement's card
 * (docs/guides/praxis-ai.md §1.10 decisions 43, 44 and 46, §6.18; job chosen by TB, Image Reading).
 *
 *   readForChat(actor, doc, db)   the receipt on `disbursement-receipt-read`; the request it paid
 *                                 matched here, in SQL through the repo, never by the model
 *
 * The model reads the bank reference, the day, the amount and the beneficiary; the server matches the
 * authorised requests in the person's `expenses` scope whose account number (else payee name) and
 * amount are the receipt's. One fills the card's request; several are offered to tap under "Which
 * request was paid?"; none leaves that question with the authorised requests to tap. A request
 * already paid is named in the answer. Nothing is saved: Record Disbursement is the person's press,
 * behind Confirm It's You (risk money), and claims the receipt.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { scopeFor } = require("../../middleware/rbac");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const { choiceWords } = require("../../shared/ai/named");
const storage = require("../../services/storage/storage.service");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const repo = require("./disbursements.repo");

const MODULE = "expenses";
const ACTION = "disbursements.create";

const cut = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A request as its record question offers it: as the authorised requests' read cites it ("EXP-0012, Water for the walk"). */
const choiceOf = (r) => choiceWords(`${r.number}, ${r.purpose}`);

/**
 * @param {object} actor  req.user
 * @param {object} doc    the person's staged document (vault row)
 * @param {{query: Function}} [db]
 * @returns {Promise<{outcome: string, reading?: object, card?: object|null, notes?: string[]}>}
 */
async function readForChat(actor, doc, db = pool) {
  if (!ai.FILE_TYPES.includes(doc.mime) || doc.scan_status === "pending" || doc.scan_status === "infected") return { outcome: "unreadable" };
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return { outcome: now.reason === "limit" ? "limit" : "off" };
  let run;
  try {
    run = await ai.complete({
      purpose: "disbursement-receipt-read",
      module: MODULE,
      actor,
      input: { today: lagos.today() },
      output: c.disbursements.DisbursementReceiptRead,
      files: [{ mime_type: doc.mime, data: await storage.get(doc.storage_key) }],
      egress: "external",
      temperature: 0,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return { outcome: reason === "limit" ? "limit" : "off" };
    // A provider that refuses the file (its kind, its size) reads as a file that cannot be read.
    if (err && (err.code === "AI_VENDOR_CONFIG" || err.code === "AI_FILE_TOO_LARGE")) return { outcome: "unreadable" };
    throw err;
  }
  const out = run.output;
  // The stub reads nothing: with no provider set up, reading is off.
  if (!out) return { outcome: "off" };
  if (!out.amount && !out.payment_reference) return { outcome: "unreadable" };

  const account = cut(out.beneficiary_account_number, 30).replace(/[\s-]/g, "") || null;
  const amount = out.amount && m.money(out.amount).greaterThan(0) ? m.toWire(out.amount) : null;
  const reading = {
    payment_reference: out.payment_reference,
    paid_on: out.paid_on,
    amount,
    beneficiary_name: out.beneficiary_name,
    // Named as redaction names it, so the chat's model never receives it (services/ai/redact.js NEVER_PROPS).
    account_number: account,
    beneficiary_bank: out.beneficiary_bank,
    narration: out.narration,
  };
  const notes = [];
  const values = { receipt_document_id: doc.document_id };
  const reference = cut(out.payment_reference, 100);
  if (reference) values.payment_reference = reference;
  // A day ahead of today is a misreading: the card asks for it rather than carry it.
  if (out.paid_on && ISO_DAY.test(out.paid_on) && out.paid_on <= lagos.today()) values.paid_on = out.paid_on;
  const choices = {};
  if (amount) {
    const scope = (await scopeFor(actor, "expenses", "create")) || { scope: "own", scope_ids: [actor.employee_id].filter(Boolean) };
    const receipt = { account_number: account, beneficiary_name: cut(out.beneficiary_name, 150) || null, amount };
    const [open, paid] = await Promise.all([repo.requestsPaidBy(db, receipt, scope, ["authorised"]), repo.requestsPaidBy(db, receipt, scope, ["disbursed"])]);
    if (open.length === 1) values.expense_request_id = open[0].expense_request_id;
    else if (open.length > 1) choices.expense_request_id = open.map(choiceOf);
    if (!open.length && paid[0])
      notes.push(`${paid[0].number} was already paid as ${paid[0].disbursement_number}${paid[0].paid_on ? ` on ${formatDate(paid[0].paid_on)}` : ""}.`);
  }
  return { outcome: "read", reading, card: { action: ACTION, values, defaults: {}, problems: {}, choices }, notes };
}

module.exports = { readForChat };

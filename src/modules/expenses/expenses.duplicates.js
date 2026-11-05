"use strict";
/**
 * Check Duplicate on a request's modal (docs/guides/expenses.md §6.8, §9; Default, chosen by AJ,
 * docs/handoff/m8-expenses.md decision 14).
 *
 * The flag itself is the database's: a request shows Possible Duplicate when another was sent
 * within 30 days to the same payee for the same amount (expenses.repo duplicatesOf), so every
 * approver sees it without a model. Check Duplicate, pressed by whoever may open the request,
 * asks the model to compare their purposes and lines and say which one it most likely repeats and
 * why. It runs on the person's press, never in a transaction, and nothing is kept: the approver
 * reads it and decides.
 *
 * What the model is given: the requests' numbers, purposes, days sent, statuses and lines. Never
 * the requester's name, the payee or the bank details: they are what made them alike.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const repo = require("./expenses.repo");

const MODULE = "expenses";

const off = (reason) => ({ available: false, reason, duplicate: null, explanation: null, ai_run_id: null });

const day = (at) => (at instanceof Date ? at.toISOString().slice(0, 10) : at ? String(at).slice(0, 10) : null);

/** A request as the model reads it: what it is for and its items, nothing about who. */
async function described(db, row) {
  const lines = await repo.lines(db, row.expense_request_id);
  return {
    number: row.number,
    purpose: row.purpose,
    sent_on: day(row.submitted_at),
    status: row.status,
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price })),
  };
}

/**
 * Check Duplicate. The caller (expenses.service checkDuplicate) has checked the reader may open
 * the request.
 * @param {object} user  req.user
 * @param {object} row   the request as expenses.repo get reads it, with possible_duplicates
 */
async function check(user, row) {
  const others = row.possible_duplicates || [];
  if (!others.length) return off("none");
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return off(now.reason);
  let run;
  try {
    run = await ai.complete({
      purpose: "expense-duplicate-check",
      module: MODULE,
      actor: user,
      input: { request: await described(pool, row), others: await Promise.all(others.map((o) => described(pool, o))) },
      output: c.expenses.ExpenseDuplicateJudgement,
      egress: "external",
      temperature: 0,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  if (!run.output) return off("off");
  const named = run.output.duplicate_of ? others.find((o) => o.number === String(run.output.duplicate_of).trim()) || null : null;
  return { available: true, reason: null, duplicate: named, explanation: run.output.reason.trim(), ai_run_id: run.run_id || null };
}

module.exports = { check };

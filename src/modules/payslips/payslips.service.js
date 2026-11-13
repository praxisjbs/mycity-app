"use strict";
/**
 * Payslips: what Payroll readers and the person read, and what Email All, Email a Copy and Download All do
 * (docs/guides/payroll.md §5, §6.10). The payslips are written by payroll's Compute and lock; this file only
 * reads them, requests their PDFs' downstream work and marks them mailed.
 *
 *   list, get, lineItems, pdfOf        what Payroll · Payslips reads (`payroll` view; the PDF needs `edit`)
 *   ownList, ownSummary, ownGet, ownPdf,
 *   ownDeductions                       what ESS · My Payslips reads, always the caller's own
 *   requestEmailAll, requestRunExport   Email All Payslips and Download All on a run
 *   emailOwnCopy, requestOwnExport      Email a Copy and Download All on My Payslips
 *   emailRun, mailPayslip               the two outbox handlers behind them (payslips.events.js)
 *
 * Every write on a run that is out (approved or paid) is made with `payroll.lock.defineWrite` and the
 * `published` guard: it locks the run row and refuses a run still in the approval (409 NOT_APPROVED) before it does
 * anything, as every other write on a run does (§6.9 rule 4). The salary-derived amounts leave under the names the
 * salary mask governs; the controller masks them for a Payroll reader without the grant, and the person's own are
 * never masked.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { canSee } = require("../../shared/rbac/field-mask");
const vault = require("../../shared/documents/vault");
const exportFiles = require("../../shared/documents/exports");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const { formatMonth } = require("../../shared/time/day-first");
const lock = require("../payroll/payroll.lock");
const settings = require("../payroll/payroll.config.repo");
const breakdown = require("./payslips.breakdown");
const pdf = require("./payslips.pdf");
const repo = require("./payslips.repo");
const { EVENTS, EMAIL } = require("./payslips.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (at) => (at ? new Date(at).toISOString() : null);
const notFound = () => new AppError("NOT_FOUND", "That payslip does not exist", 404);

/* ------------------------------------------------------------------ *
 * What a reader is shown
 * ------------------------------------------------------------------ */

/** A repo row as the contract's Payslip. */
const present = (row) => ({
  payslip_id: row.payslip_id,
  number: row.number,
  payroll_run_id: row.payroll_run_id,
  period: row.period,
  run_status: row.run_status,
  employee: row.employee,
  staff_number: String(row.staff_number),
  status: row.status,
  excluded_reason: row.excluded_reason || null,
  gross_pay: row.earnings_total,
  total_deductions: row.deductions_total,
  net_pay: row.net_pay,
  has_deduction: row.has_deduction,
  published_at: iso(row.published_at),
  emailed_at: iso(row.emailed_at),
});

/** A line as the modal shows it. */
const presentLine = (l) => ({
  payslip_line_id: l.payslip_line_id,
  position: Number(l.position),
  kind: l.kind,
  code: l.code,
  label: l.label,
  detail: l.detail || null,
  pay_amount: l.amount,
  has_breakdown: l.has_breakdown,
});

/**
 * One payslip as its modal shows it. Employer charges are MyCity's own cost and never on the slip, so they are left
 * off; the day paid is the run's own once it is marked paid, else the month's pay date.
 */
async function presentDetail(row) {
  const lines = (await repo.linesOf(pool, row.payslip_id)).filter((l) => l.kind !== "employer");
  return {
    ...present(row),
    gross_monthly: row.gross_monthly ?? null,
    working_days: row.working_days === null || row.working_days === undefined ? null : Number(row.working_days),
    working_days_paid: row.working_days_paid === null || row.working_days_paid === undefined ? null : Number(row.working_days_paid),
    bank_name: row.bank_name || null,
    account_last4: row.account_last4 || null,
    pay_date: row.run_paid_on || (await settings.payDateFor(pool, row.period)),
    pdf_ready: row.status === "published" && row.pdf_status === "done",
    lines: lines.map(presentLine),
  };
}

/** The PDF of a payslip, ready to stream, or the reason it is not. */
async function readyPdf(row) {
  if (row.status !== "published") throw new AppError("NOT_APPROVED", "A payslip has no PDF until its run is approved", 409);
  if (!row.document_id || row.pdf_status !== "done") throw new AppError("NOT_READY", "The PDF is still being prepared", 409);
  const doc = await vault.get(pool, row.document_id);
  if (!doc) throw new AppError("NOT_READY", "The PDF is still being prepared", 409);
  return doc;
}

/**
 * A document that carries pay and bank details goes only to a reader who may see both, or to the person it is about
 * (§6.13 rule 3: masks apply in exports too). Called before a PDF is streamed or an export reserved.
 * @param {{user_id: string, employee_id?: string|null}} user
 * @param {string|null} ownerEmployeeId  the person the document is about, when it is about one
 */
async function assertMayPrint(user, ownerEmployeeId) {
  if (ownerEmployeeId && ownerEmployeeId === user.employee_id) return;
  const [salary, bank] = await Promise.all([canSee(pool, user, "employee.salary"), canSee(pool, user, "employee.bank")]);
  if (!salary || !bank) throw new AppError("FIELD_RESTRICTED", "Your role cannot see pay or bank details.", 403);
}

/* ------------------------------------------------------------------ *
 * Payroll · Payslips
 * ------------------------------------------------------------------ */

/** GET /payslips: 25 a page, draft and published alike, within the reader's `payroll` scope. */
async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(present) };
}

/** The payslip, 404 when it does not exist or its person is outside the reader's scope. */
async function inScope(id, scope) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  return row;
}

/** GET /payslips/:id: one payslip with its lines. */
async function get(id, scope) {
  return presentDetail(await inScope(id, scope));
}

/** GET /payslips/:id/lines/:line_id/items: what stands behind a line, 25 a page. */
async function lineItems(id, lineId, query, scope) {
  await inScope(id, scope);
  const page = await breakdown.itemsOf(pool, id, lineId, query);
  if (!page) throw notFound();
  return page;
}

/** GET /payslips/:id/pdf: the PDF document a `payroll` edit holder may open. */
async function pdfOf(id, scope) {
  return readyPdf(await inScope(id, scope));
}

/* ------------------------------------------------------------------ *
 * ESS · My Payslips (always the caller's own: the employee comes from the session)
 * ------------------------------------------------------------------ */

/** The year to read: the one asked for, else this Lagos year. */
const yearOf = (query) => (query && query.year) || lagos.yearMonth(lagos.today()).year;

/** GET /ess/payslips: the person's published payslips of a year, newest month first. */
async function ownList(employeeId, query) {
  const page = await repo.listOwn(pool, employeeId, yearOf(query), query);
  return { ...page, data: page.data.map(present) };
}

/** GET /ess/payslips/summary: the year's gross, Net Received, payslips and deductions, and Next Payday. */
async function ownSummary(employeeId, query) {
  const year = yearOf(query);
  const [s, nextPayday] = await Promise.all([
    repo.summaryOwn(pool, employeeId, year),
    settings.nextPayDate(pool, lagos.today(), (period) => repo.periodPaid(pool, period)),
  ]);
  return { year, gross_pay: s.earnings_total, net_pay: s.net_pay, payslips: s.payslips, total_deductions: s.deductions_total, next_payday: nextPayday };
}

/** GET /ess/payslips/:id: one of the person's own published payslips. */
async function ownGet(employeeId, id) {
  const row = await repo.getOwn(pool, employeeId, id);
  if (!row) throw notFound();
  return presentDetail(row);
}

/** GET /ess/payslips/:id/pdf: the PDF of the person's own payslip. */
async function ownPdf(employeeId, id) {
  const row = await repo.getOwn(pool, employeeId, id);
  if (!row) throw notFound();
  return readyPdf(row);
}

/** GET /ess/deductions: each month that carried a deduction and each scheduled instalment, 25 a page. */
async function ownDeductions(employeeId, query) {
  const page = await repo.deductionsOwn(pool, employeeId, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      payroll_deduction_instalment_id: r.payroll_deduction_instalment_id,
      source: r.source === "salary_advance" ? "advance" : "fine",
      period: r.period,
      reason: r.reason,
      pay_amount: r.amount,
      instalment: Number(r.ordinal),
      instalments: Number(r.instalments),
      status: r.status,
      query_number: r.query_number || null,
      query_id: r.query_id || null,
    })),
  };
}

/**
 * The assistant's reads of the person's own pay (`payslips.mine`, `deductions.mine`, guide §9). A person's own pay is
 * never masked from them (§6.13 rule 3), yet the assistant's engine masks the salary-derived names in every row it reads
 * and the Employee role hides salaries by default (0449), so an ordinary employee would be answered null about their own
 * payslip. The amounts therefore travel under names the mask does not govern (`gross`, `net`, `deductions`, `amount`), on
 * rows that are the asker's own alone: `ownList` and `ownDeductions` read by the session's employee id and nobody else's.
 */
async function ownPayslipsForAssistant(employeeId, query) {
  const page = await ownList(employeeId, query);
  return {
    ...page,
    data: page.data.map((p) => ({
      payslip_id: p.payslip_id,
      number: p.number,
      month: formatMonth(p.period),
      period: p.period,
      status: p.run_status === "paid" ? "Paid" : "Approved",
      gross: p.gross_pay,
      net: p.net_pay,
      deductions: p.total_deductions,
      has_deduction: p.has_deduction,
    })),
  };
}

/** A deduction line's code in words, for `my_pay.summary`'s deductions by reason. */
const DEDUCTION_WORDS = Object.freeze({
  lateness: "Lateness",
  early_departure: "Early departure",
  absence: "Absence",
  unpaid_leave: "Unpaid leave",
  unpaid_suspension: "Unpaid suspension",
  fine: "Fines",
  advance: "Advance repayments",
  adjustment_deduction: "Adjustments",
  paye: "PAYE",
  pension_employee: "Pension",
  nhf: "NHF",
});

/**
 * `my_pay.summary` (docs/guides/praxis-ai.md §6.13, Finance and pay): the asking person's own published payslips of
 * a year (this Lagos year unless asked) in figures, read by the session's employee id and nobody else's. A summary
 * is never masked (only a read's rows are), and this one is the person's own pay, so it is given whatever their role
 * hides from others (§6.13 rule 3). Someone with no employee record has no payslips and gets no figures.
 * @param {{query: Function}} client
 * @param {object} params  MyPaySummaryQuery, parsed
 * @param {object} actor
 */
async function myPaySummary(client, params, actor, now = new Date()) {
  if (!actor.employee_id) return { figures: [], groups: [], series: [], total: 0 };
  const { figure, group, series } = require("../../shared/ai/summary");
  const m = require("../../shared/money/money");
  const year = params.year || Number(lagos.today(now).slice(0, 4));
  const r = (await repo.myPay(client, actor.employee_id, year)) || {};
  const f = r.figures || {};
  const taken = r.taken || {};
  const money = (v) => m.toWire(v || "0.00");
  const points = (key) => (r.points || []).map((p) => ({ at: p.at, value: money(p[key]) }));
  return {
    figures: [
      figure("payslips", `Payslips in ${year}`, f.payslips || 0),
      figure("gross", "Gross to date", money(f.gross), "ngn"),
      figure("deductions", "Deductions to date", money(f.deductions), "ngn"),
      figure("net", "Net to date", money(f.net), "ngn"),
      figure("fines", "Fines", money(taken.fines), "ngn"),
      figure("advances", "Advance repayments", money(taken.advances), "ngn"),
    ],
    groups: [group("reason", "Deductions by reason", (r.by_reason || []).map((x) => ({ key: x.key, label: DEDUCTION_WORDS[x.key] || x.key, value: money(x.value), count: x.count })))],
    series: [series("gross", "Gross by month", points("gross")), series("deductions", "Deductions by month", points("deductions")), series("net", "Net by month", points("net"))],
    total: f.payslips || 0,
  };
}

/** The person's own instalments for the assistant, under the same names (above): the month, the reason, "1 of 3", the amount. */
async function ownDeductionsForAssistant(employeeId, query) {
  const page = await ownDeductions(employeeId, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      payroll_deduction_instalment_id: r.payroll_deduction_instalment_id,
      source: r.source,
      month: formatMonth(r.period),
      period: r.period,
      reason: r.reason,
      instalment: `${r.instalment} of ${r.instalments}`,
      amount: r.pay_amount,
      status: r.status,
      query_number: r.query_number,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * What mails and downloads do
 * ------------------------------------------------------------------ */

/**
 * Mark a payslip emailed and record it, in the transaction the caller owns: the mail itself is queued after commit by
 * the outbox handler `payslips.mail`, so a payslip is marked before its mail exists and a repeat press never mails a
 * person twice. `copy` is whether the person asked for it themselves.
 */
async function markAndRecord(client, run, payslip, { copy, actor }) {
  await repo.markEmailed(client, payslip.payslip_id);
  await emit(client, {
    key: EVENTS.PAYSLIP_EMAILED,
    entity: { type: "payslip", id: payslip.payslip_id },
    actor,
    payload: {
      payslip_id: payslip.payslip_id,
      payroll_run_id: run.payroll_run_id,
      employee_id: payslip.employee_id,
      subject_employee_id: payslip.employee_id,
      number: payslip.number,
      period: run.period,
      copy,
    },
  });
}

/** Email All Payslips: the request that the worker's handler walks, with the time the run asked, by the database's clock. */
const emailAll = lock.defineWrite("emailAll", "published", async (client, run, { resend, actor }) => {
  const queued = await repo.countToEmail(client, run.payroll_run_id, resend);
  const { rows } = await client.query("SELECT now() AS at");
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_EMAIL_REQUESTED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    payload: {
      payroll_run_id: run.payroll_run_id,
      number: run.number,
      period: run.period,
      resend,
      queued,
      requested_at: iso(rows[0].at),
      requested_by: actor && actor.user_id ? actor.user_id : null,
    },
  });
  return { queued };
});

/** One payslip of Email All marked emailed (the handler's, a transaction each). */
const markEmailed = lock.defineWrite("markEmailed", "published", async (client, run, { payslip, actor }) => {
  await markAndRecord(client, run, payslip, { copy: false, actor });
});

/** A payslip put back to not emailed: its mail could not be made, so Email All takes it again. */
const unmarkEmailed = lock.defineWrite("unmarkEmailed", "published", async (client, run, { payslip_id: id }) => {
  await repo.clearEmailed(client, id);
});

/** Email a Copy: the person's own payslip, its PDF done, at most once a minute. */
const emailCopy = lock.defineWrite("emailCopy", "published", async (client, run, { employee_id: employeeId, payslip_id: id, actor }) => {
  const p = await repo.lockOwn(client, employeeId, id);
  if (!p || p.status !== "published") throw notFound();
  if (p.pdf_status !== "done") throw new AppError("NOT_READY", "The PDF is still being prepared", 409);
  if (p.just_emailed) throw new AppError("EMAIL_TOO_SOON", "A copy was just sent. Try again in a minute.", 429);
  await markAndRecord(client, run, p, { copy: true, actor });
  return { sent: true };
});

/** Download All on a run: every published payslip, a page each, reserved here and rendered by the worker. */
const exportAll = lock.defineWrite("exportAll", "published", async (client, run, { actor }) => {
  const rows = await repo.printRowsOfRun(client, run.payroll_run_id);
  if (!rows.length) throw new AppError("NO_PAYSLIPS", "There are no payslips to download", 409);
  const label = formatMonth(run.period);
  const doc = await pdf.requestExport(client, {
    rows,
    title: `Payslips, ${label}`,
    period_label: label,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
  });
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_EXPORT_REQUESTED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    payload: { payroll_run_id: run.payroll_run_id, number: run.number, period: run.period, document_id: doc.document_id, payslips: rows.length },
  });
  return exportFiles.present(doc);
});

/** POST /payroll/runs/:id/email-payslips: 202 with how many mails the press will send. */
const requestEmailAll = (actor, runId, body) => tx((client) => emailAll(client, runId, { resend: Boolean(body && body.resend), actor }));

/** POST /payroll/runs/:id/payslips-export: 202 with the file the screen waits on. */
const requestRunExport = (actor, runId) => tx((client) => exportAll(client, runId, { actor }));

/** POST /ess/payslips/:id/email: a copy of the person's own payslip to their work email. */
async function emailOwnCopy(actor, id) {
  const row = await repo.getOwn(pool, actor.employee_id, id);
  if (!row) throw notFound();
  return tx((client) => emailCopy(client, row.payroll_run_id, { employee_id: actor.employee_id, payslip_id: id, actor }));
}

/** POST /ess/payslips/export: the person's published payslips of a year, a page each. */
async function requestOwnExport(actor, query) {
  const year = yearOf(query);
  return tx(async (client) => {
    const rows = await repo.printRowsOfYear(client, actor.employee_id, year);
    if (!rows.length) throw new AppError("NO_PAYSLIPS", "There are no payslips to download", 409);
    const doc = await pdf.requestExport(client, {
      rows,
      title: `My Payslips, ${year}`,
      period_label: String(year),
      entity: { type: "employee", id: actor.employee_id },
      subject_employee_id: actor.employee_id,
      actor,
    });
    await emit(client, {
      key: EVENTS.PAYSLIP_EXPORT_REQUESTED,
      entity: { type: "employee", id: actor.employee_id },
      actor,
      payload: { employee_id: actor.employee_id, subject_employee_id: actor.employee_id, year, document_id: doc.document_id, payslips: rows.length },
    });
    return exportFiles.present(doc);
  });
}

/* ------------------------------------------------------------------ *
 * The outbox handlers
 * ------------------------------------------------------------------ */

/**
 * `payroll.email_payslips`: walk a run's published payslips that are not yet emailed (on a resend, not emailed since
 * the press), 25 a pass, whose PDF is done, and mark each emailed in its own transaction; the `payslip.emailed` it
 * records queues the mail. A payslip whose PDF is still rendering is tried again on the next attempt. A press made
 * again while one runs is safe: what is marked leaves the set, and a payslip already marked is never taken twice.
 */
async function emailRun(event, ctx) {
  const { payroll_run_id: runId, resend, requested_at: requestedAt } = event.payload;
  const asked = { resend: Boolean(resend), requestedAt };
  const done = new Set();
  for (;;) {
    const batch = (await repo.nextToEmail(pool, runId, asked)).filter((p) => !done.has(p.payslip_id));
    if (!batch.length) break;
    for (const p of batch) {
      await tx((client) => markEmailed(client, runId, { payslip: p, actor: null }));
      done.add(p.payslip_id);
    }
  }
  const waiting = await repo.countRendering(pool, runId, asked);
  if (waiting > 0 && ctx && ctx.attempt < ctx.max_attempts) throw new Error(`${waiting} payslips are still being prepared; mailing them again shortly`);
}

/** The link a payslip's mail opens: the person's own My Payslips, with the payslip picked. */
function readUrl(id) {
  const link = routeMap.linkFor("payslip", id, { self: true });
  return new URL(link.path, config.STAFF_ORIGIN).href;
}

/**
 * `payslips.mail`: queue the mail of one `payslip.emailed`: the month and where to read it, never an amount, with the
 * PDF attached. The mail job is named for the event, so the handler run again queues it once.
 */
async function mailPayslip(event, ctx) {
  const p = await repo.mailOf(pool, event.payload.payslip_id);
  if (!p || p.status !== "published") return;
  if (!p.work_email) {
    await tx((client) => unmarkEmailed(client, p.payroll_run_id, { payslip_id: p.payslip_id }));
    return;
  }
  if (p.pdf_status !== "done") {
    if (ctx && ctx.attempt >= ctx.max_attempts) await tx((client) => unmarkEmailed(client, p.payroll_run_id, { payslip_id: p.payslip_id }));
    throw new Error(`payslip ${p.number} cannot be mailed yet: its PDF is still being prepared`);
  }
  await require("../../jobs/queues").enqueue(
    "email-send",
    EMAIL,
    {
      to: { name: `${p.first_name} ${p.last_name}`.trim(), email: p.work_email },
      recipient: { first_name: p.first_name, last_name: p.last_name, email: p.work_email },
      template: EMAIL,
      data: { period_label: formatMonth(p.period), number: p.number, read_url: readUrl(p.payslip_id) },
      attachments: [{ document_id: p.document_id }],
    },
    { jobId: `payslip-ready-${event.event_id}` },
  );
}

module.exports = {
  assertMayPrint,
  list,
  get,
  lineItems,
  pdfOf,
  ownList,
  ownSummary,
  ownGet,
  ownPdf,
  ownDeductions,
  ownPayslipsForAssistant,
  ownDeductionsForAssistant,
  myPaySummary,
  requestEmailAll,
  requestRunExport,
  emailOwnCopy,
  requestOwnExport,
  emailRun,
  mailPayslip,
  // The writes on a run that is out, by name: the test that enumerates every write function holds them to the guard.
  emailAll,
  markEmailed,
  unmarkEmailed,
  emailCopy,
  exportAll,
};

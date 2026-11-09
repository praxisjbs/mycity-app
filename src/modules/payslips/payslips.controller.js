"use strict";
// ai:none the assistant's payslip reads (payslips.mine, payslips.list) are written with M6 PR 6 (docs/guides/payroll.md §9); this pull request adds no read, summary or card, and a payslip has no create or edit form
/**
 * Payslips: the HTTP edge for Payroll · Payslips (docs/guides/payroll.md §5). Every route is behind the `payroll`
 * grant, and a payslip is read within the reader's scope. The salary-derived amounts (`gross_pay`,
 * `total_deductions`, `net_pay`, `gross_monthly`, `pay_amount`) and the bank (`bank_name`, `account_last4`) are masked
 * for a reader whose role hides them, so they reach the screen as Restricted; a reader's own payslip is never
 * masked from them. The PDF is a restricted file (`payroll` edit, not only view), and a reader who may not see pay or
 * bank details is not handed a document that carries them. The person's own payslips are the `ess` module's
 * routes, which call this module's service with the caller's own employee id.
 */
const { pool } = require("../../config/db");
const { ok } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { scopeOf } = require("../../shared/rbac/scope");
const vault = require("../../shared/documents/vault");
const service = require("./payslips.service");

const id = (req) => req.validated.params.id;

/** Mask a page or a record for the reader, leaving a payslip that is theirs as it is. */
async function maskedExceptOwn(req, data) {
  const masked = await maskForUser(pool, req.user, data);
  const me = req.user && req.user.employee_id;
  if (!me) return masked;
  const own = (row) => row && row.employee && row.employee.employee_id === me;
  if (Array.isArray(data.data)) return { ...masked, data: masked.data.map((row, i) => (own(data.data[i]) ? data.data[i] : row)) };
  return own(data) ? data : masked;
}

module.exports = {
  list: async (req, res) => sendPaged(res, await maskedExceptOwn(req, await service.list(req.validated.query, scopeOf(req)))),

  get: async (req, res) => ok(res, await maskedExceptOwn(req, await service.get(id(req), scopeOf(req)))),

  lineItems: async (req, res) => {
    const { id: payslipId, line_id: lineId } = req.validated.params;
    return sendPaged(res, await maskForUser(pool, req.user, await service.lineItems(payslipId, lineId, req.validated.query, scopeOf(req))));
  },

  pdf: async (req, res) => {
    const doc = await service.pdfOf(id(req), scopeOf(req));
    await service.assertMayPrint(req.user, doc.subject_employee_id);
    return vault.serve(req, res, doc, { inline: true });
  },
};

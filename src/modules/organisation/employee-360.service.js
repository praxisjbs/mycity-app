"use strict";
/**
 * The employee 360: one person, on one page (docs/guides/foundation.md §5, §10.1).
 *
 * Who they are, their job, their reporting line and their login, in the contract's
 * Employee360 shape. Each part is read from the module that owns it: the record and the
 * tree from here, the login and its roles from identity and access.
 *
 * What is NOT here, on purpose:
 *  - documents, which the documents module serves on its own route;
 *  - the record's history, which is a page of audit rows (`GET /employees/:id/history`);
 *  - attendance, pay and queries, which belong to their own modules and screens.
 *
 * Restricted fields (salary, bank, personal details) are read as they are stored and
 * masked at the boundary, in the controller (shared/rbac/field-mask.js), so the person
 * whose record it is always sees their own.
 */
const { AppError } = require("../../shared/errors");
const repo = require("./organisation.repo");
const { PHOTO_VARIANTS, photoPath } = require("../../shared/db/person");

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null));
const at = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));
const money = (v) => (v === null || v === undefined ? null : String(v));

/**
 * @param {{query: Function}} client
 * @param {string} employeeId
 * @returns {Promise<object>} Employee360
 */
async function get(client, employeeId) {
  const row = await repo.get(client, employeeId);
  if (!row) throw new AppError("NOT_FOUND", "Not found", 404);
  const roles = await repo.rolesOf(client, row.user_id);
  return {
    employee_id: row.employee_id,
    staff_number: row.staff_number,
    display_name: row.display_name,
    first_name: row.first_name,
    middle_name: row.middle_name ?? null,
    last_name: row.last_name,
    preferred_name: row.preferred_name ?? null,
    job_title: row.job_title,
    department_id: row.department_id,
    department: row.department,
    worksite_id: row.worksite_id ?? null,
    status: row.status,
    employment_type: row.employment_type,
    work_pattern: row.work_pattern,
    start_date: day(row.start_date),
    contract_ends_on: day(row.contract_ends_on),
    confirmation_due_on: day(row.confirmation_due_on),
    confirmed_on: day(row.confirmed_on),
    left_on: day(row.left_on),
    archived_at: at(row.archived_at),
    archive_reason: row.archive_reason ?? null,
    work_email: row.work_email,
    phone: row.phone ?? null,
    gender: row.gender ?? null,
    line_manager: repo.managerRef(row, "manager"),
    dotted_manager: repo.managerRef(row, "dotted"),
    direct_reports: row.direct_reports,
    login: {
      user_id: row.user_id ?? null,
      email: row.login_email ?? null,
      state: row.login,
      roles,
      last_sign_in_at: at(row.last_login_at),
    },
    date_of_birth: day(row.date_of_birth),
    home_address: row.home_address ?? null,
    personal_email: row.personal_email ?? null,
    next_of_kin_name: row.next_of_kin_name ?? null,
    next_of_kin_phone: row.next_of_kin_phone ?? null,
    next_of_kin_relationship: row.next_of_kin_relationship ?? null,
    bank_name: row.bank_name ?? null,
    account_number: row.account_number ?? null,
    gross_monthly: money(row.gross_monthly),
    created_at: at(row.created_at),
    photo_url: photoPath(row.photo_document_id, PHOTO_VARIANTS.profile),
  };
}

/** One page of what has been done to this record, as the History tab reads it. */
async function history(client, employeeId, query) {
  const page = await repo.historyOf(client, employeeId, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      event_id: r.event_id,
      occurred_at: at(r.occurred_at),
      action: r.action,
      actor_name: r.actor_name ?? null,
      changed_fields: r.changed_fields || [],
      summary: summaryOf(r),
    })),
  };
}

/** The line the History tab shows: what was done, and to which fields. */
function summaryOf(row) {
  const fields = (row.changed_fields || []).filter(Boolean);
  const said = {
    "employee.created": "Record created",
    "employee.updated": "Record changed",
    "employee.archived": "Record archived",
    "employee.restored": "Record restored",
    "employee.reporting_line_changed": "Reporting line changed",
    "attendance.schedule_set": "Work schedule set",
  }[row.action];
  const what = said || row.action.replace(/^employee\./, "").replace(/_/g, " ");
  return fields.length ? `${what}: ${fields.join(", ")}` : what;
}

module.exports = { get, history, summaryOf };

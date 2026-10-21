"use strict";
/**
 * Attendance as a workbook (docs/guides/attendance.md §5, §7): a person's month from
 * ESS · My Attendance, or the register over up to 31 days from People · Attendance.
 *
 * Asked for in the request (attendance.export_requested), which reserves the file
 * (shared/documents/exports.js), and built here, in the worker, after commit: the rows
 * gathered 25 at a time through the same reads the screens use, into the restricted file the
 * person who asked is waiting on, which their screen downloads on the device that asked.
 * Nothing is emailed. The register is read with the asker's `people` export scope as it stands
 * when the file is built, so a grant taken away in the meantime narrows what they get. At
 * most EXPORT_CEILING rows go into one file.
 *
 * Coordinates and device identifiers are never in a file: the location column is the
 * verdict, the device column its label.
 */
const { pool } = require("../../config/db");
const { formatDate, formatMonth } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const repo = require("./attendance.repo");

/** The most rows one export file holds. */
const EXPORT_CEILING = 5000;

/** The document type an export's file is kept under, and the record it belongs to. */
const DOC_TYPE = "attendance_export";

/** Each export's title and the name its file is saved under, before the date. */
const KINDS = Object.freeze({
  month: { title: "My Attendance", base: "my-attendance" },
  register: { title: "Attendance Register", base: "attendance-register" },
});

const STATUS = Object.freeze({
  present: "Present",
  late: "Late",
  absent: "Absent",
  leave: "On Leave",
  not_in: "Not In",
  off: "Day Off",
});
const VERDICT = Object.freeze({
  inside: "Inside",
  outside: "Outside",
  unverified: "Unclear",
  not_applied: "Not Judged",
});

const MONTH_COLUMNS = [
  { key: "attendance_date", header: "Date", format: "date", width: 12 },
  { key: "status", header: "Status", width: 12 },
  { key: "first_clock_in_at", header: "Clock In", format: "datetime", width: 18 },
  { key: "last_clock_out_at", header: "Clock Out", format: "datetime", width: 18 },
  { key: "worked_minutes", header: "Worked Minutes", format: "int", width: 14 },
  { key: "late_minutes", header: "Late Minutes", format: "int", width: 12 },
  { key: "overtime_minutes", header: "Overtime Minutes", format: "int", width: 16 },
  { key: "open_exceptions", header: "Open Exceptions", format: "int", width: 15 },
];

const REGISTER_COLUMNS = [
  { key: "date", header: "Date", format: "date", width: 12 },
  { key: "employee", header: "Employee", width: 26 },
  { key: "department", header: "Department", width: 20 },
  { key: "status", header: "Status", width: 12 },
  { key: "clock_in_at", header: "Clock In", format: "datetime", width: 18 },
  { key: "clock_out_at", header: "Clock Out", format: "datetime", width: 18 },
  { key: "worked_minutes", header: "Worked Minutes", format: "int", width: 14 },
  { key: "late_minutes", header: "Late Minutes", format: "int", width: 12 },
  { key: "expected_location", header: "Expected Location", width: 22 },
  { key: "location_verdict", header: "Location Check", width: 14 },
  { key: "device_label", header: "Device", width: 22 },
  { key: "open_exceptions", header: "Open Exceptions", format: "int", width: 15 },
];

/** Every page of a read, up to the ceiling. */
async function gather(read) {
  const rows = [];
  let page = await read(1);
  rows.push(...page.data);
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await read(page.page.number + 1);
    rows.push(...page.data);
  }
  return { rows: rows.slice(0, EXPORT_CEILING), total: page.page.total, capped: page.page.total > EXPORT_CEILING };
}

/** A person's month, as rows. */
async function monthRows(employeeId, month) {
  const { first, last } = lagos.monthBounds(`${month}-01`);
  const out = await gather((n) => repo.listDays(pool, employeeId, first, last, { page: n }));
  return {
    ...out,
    period: formatMonth(first),
    rows: out.rows.map((r) => ({ ...r, status: r.status ? STATUS[r.status] : "" })),
  };
}

/** The register from one date to another, as rows. */
async function registerRows(scope, { from, to, ...filters }) {
  const rows = [];
  let total = 0;
  let capped = false;
  for (let d = from; d <= to && !capped; d = lagos.addDays(d, 1)) {
    const day = await gather((n) => repo.register(pool, d, { ...filters, page: n }, scope));
    total += day.total;
    for (const r of day.rows) {
      if (rows.length >= EXPORT_CEILING) {
        capped = true;
        break;
      }
      rows.push({
        ...r,
        employee: r.employee.display_name,
        department: r.employee.department || "",
        status: STATUS[r.status] || r.status,
        location_verdict: r.location_verdict ? VERDICT[r.location_verdict] : "",
      });
    }
  }
  return { rows, total, capped: capped || total > EXPORT_CEILING, period: `${formatDate(from)} to ${formatDate(to)}` };
}

/**
 * The outbox handler: the workbook made into the file the request reserved, as the person
 * who asked may see it now. One no longer active, or no longer holding the register's export
 * grant, gets a failed file instead.
 * @param {object} event  attendance.export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildExport(event, ctx) {
  const exportFiles = require("../../shared/documents/exports");
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const { scopeFor } = require("../../middleware/rbac");

  const p = event.payload || {};
  // Asked for before exports were downloaded: that one went by email, and has no file here.
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  if (p.kind === "month" && !reader.employee_id)
    return exportFiles.fail(p.document_id, "The person who asked has no attendance.");
  const scope = p.kind === "month" ? null : await scopeFor(reader, "people", "export");
  if (p.kind !== "month" && !scope)
    return exportFiles.fail(p.document_id, "The person who asked may no longer export the register.");

  const { title } = KINDS[p.kind === "month" ? "month" : "register"];
  await exportFiles.make(p.document_id, ctx, async () => {
    const built = p.kind === "month" ? await monthRows(reader.employee_id, p.month) : await registerRows(scope, p.filters);
    return buildWorkbook({
      sheets: [{ name: title, columns: p.kind === "month" ? MONTH_COLUMNS : REGISTER_COLUMNS, rows: built.rows, freeze: { y: 1 } }],
      context: workbookContext({ actor: { name: reader.display_name }, title, filters: { period: built.period } }),
      cover: true,
    });
  });
}

module.exports = { DOC_TYPE, KINDS, buildExport, monthRows, registerRows, EXPORT_CEILING, STATUS };

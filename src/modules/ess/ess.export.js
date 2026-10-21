"use strict";
/**
 * Download My Data (docs/guides/ess.md §3 step 8, §5, §6, §7): everything a person can already
 * see about themselves in the app, as one workbook with a sheet per area and a cover.
 *
 *   requestOwn(user)            POST /ess/profile/export, the caller's own
 *   requestFor(ceo, id)         POST /employees/:id/data-export, the CEO's Download Their Data
 *   build(event, ctx)           employee.data_export_requested, in the worker after commit
 *
 * Asked for in the request, at once and audited: `employee.data_export_requested` is on the
 * person's record with who asked, and the file is reserved (shared/documents/exports.js) as a
 * restricted `data_export` the person and the CEO alone may open (ess.events.js). At most one
 * file a day for a person (Lagos days), the CEO's for them counted with their own: the same
 * asker pressing again that day gets that day's file again, to download once more; anyone else
 * is refused with a 429 that says so. The rows are gathered after commit, 25 at a time, through
 * the same reads the screens use: the employee 360 and its history, leave, attendance, the
 * vault's list and the sign-ins My Security shows. The screen that asked downloads the file on
 * its own device; nothing is emailed, and the export-cleanup job removes it a day later.
 *
 * What never goes in: the full bank account (its last four digits only), attendance
 * coordinates and device identifiers (a punch carries its location verdict and the device's
 * label), the files themselves (the list of them only), pay (M6).
 *
 * ESS keeps no tables (README §5.1): the file is the vault's, and the request's record is the
 * event log's.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const exportFiles = require("../../shared/documents/exports");
const vault = require("../../shared/documents/vault");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { formatDate, formatDateTime } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const { EVENTS, DATA_EXPORT } = require("./ess.events");
const { meOf } = require("./ess.documents");

/** The most rows one sheet holds; a working life of attendance fits many times over. */
const SHEET_CEILING = 5000;

const NDPA_LINE =
  "This is the data MyCity holds about you that you can see in the app (Nigeria Data Protection Act 2023).";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------ */

/** Today's file for a person (Lagos day), whoever asked, unless it failed; null when none. */
async function todaysFile(client, employeeId) {
  const { rows } = await client.query(
    `SELECT ${vault.COLUMNS} FROM document
      WHERE doc_type = $1 AND subject_employee_id = $2 AND render_status IS DISTINCT FROM 'failed'
        AND created_at >= ($3::date::timestamp AT TIME ZONE 'Africa/Lagos')
      ORDER BY created_at DESC
      LIMIT 1`,
    [DATA_EXPORT, employeeId, lagos.today()],
  );
  return rows[0] || null;
}

/**
 * Reserve the file and record the request, after the checks: the person exists, and nobody has
 * a file of theirs today. One request for a person is decided at a time, so two presses cannot
 * both pass the limit.
 * @returns {Promise<object>} the ExportFile: pending, or today's again for the same asker
 */
function request(actor, employeeId, own) {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('data-export:' || $1::text, 0))", [employeeId]);
    const person = await require("../organisation/organisation.repo").findEmployeeById(client, employeeId);
    if (!person) throw new AppError("NOT_FOUND", "Not found", 404);
    const today = await todaysFile(client, employeeId);
    if (today && today.uploaded_by === actor.user_id) return exportFiles.present(today);
    if (today)
      throw new AppError(
        "DATA_EXPORT_LIMIT",
        own
          ? "Your copy was already made today. Try tomorrow."
          : "Their copy was already made today. Try tomorrow.",
        429,
      );
    const name = `${person.first_name} ${person.last_name}`.trim();
    const doc = await exportFiles.reserve(client, {
      doc_type: DATA_EXPORT,
      entity: { type: DATA_EXPORT, id: crypto.randomUUID() },
      subject_employee_id: employeeId,
      file_name: exportFilename({ base: `my-data-${person.staff_number}`, env: config.APP_ENV, extension: "xlsx" }),
      title: `Download My Data, ${name}`,
      actor,
    });
    await emit(client, {
      key: EVENTS.EMPLOYEE_DATA_EXPORT_REQUESTED,
      entity: { type: "employee", id: employeeId },
      actor,
      payload: { employee_id: employeeId, requested_by: actor.user_id, own, document_id: doc.document_id },
      metadata: { for_employee_id: employeeId, by_user_id: actor.user_id, own },
    });
    return exportFiles.present(doc);
  });
}

/** Download My Data: the caller's own. */
const requestOwn = (user) => request(user, meOf(user), true);

/** Download Their Data: the CEO asks for one person's (the route checks requireCeo). */
const requestFor = (ceo, employeeId) => request(ceo, employeeId, employeeId === ceo.employee_id);

/* ------------------------------------------------------------------ *
 * The workbook
 * ------------------------------------------------------------------ */

/** Every page of a paged read, up to the ceiling. */
async function gather(read) {
  const rows = [];
  let page = await read(1);
  rows.push(...page.data);
  while (page.page.has_next && rows.length < SHEET_CEILING) {
    page = await read(page.page.number + 1);
    rows.push(...page.data);
  }
  return rows.slice(0, SHEET_CEILING);
}

/** A stored value as a person reads it: on_site is On Site. */
const words = (v) =>
  v === null || v === undefined || v === "" ? "" : String(v).replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

const LEAVE_STATUS = Object.freeze({ submitted: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" });
const PUNCH = Object.freeze({ clock_in: "Clock In", clock_out: "Clock Out" });
const VERDICT = Object.freeze({ inside: "Inside", outside: "Outside", unverified: "Unclear", not_applied: "Not Judged" });
const METHOD = Object.freeze({
  password: "Password",
  password_totp: "Password and Code",
  pin: "PIN",
  pin_totp: "PIN and Code",
  passkey: "Passkey",
});

const FIELD_COLUMNS = [
  { key: "field", header: "Field", width: 26 },
  { key: "value", header: "Value", width: 48, wrap: true },
];

/** The sheets in order: name, what the cover says it holds, columns. */
const SHEETS = Object.freeze([
  { name: "Profile", holds: "Personal and employment details", columns: FIELD_COLUMNS },
  { name: "Next of Kin", holds: "The next of kin on the record", columns: FIELD_COLUMNS },
  { name: "Bank", holds: "The bank and the last four digits of the account", columns: FIELD_COLUMNS },
  {
    name: "Record History",
    holds: "What has been done to the record, and by whom",
    columns: [
      { key: "occurred_at", header: "When", format: "datetime", width: 18 },
      { key: "summary", header: "What", width: 48, wrap: true },
      { key: "actor_name", header: "By", width: 26 },
    ],
  },
  {
    name: "Leave Requests",
    holds: "Every leave request made, or recorded by People",
    columns: [
      { key: "leave_type_name", header: "Type", width: 18 },
      { key: "starts_on", header: "From", format: "date", width: 12 },
      { key: "ends_on", header: "To", format: "date", width: 12 },
      { key: "days", header: "Days", format: "int", width: 8 },
      { key: "status", header: "Status", width: 12 },
      { key: "reason", header: "Reason", width: 36, wrap: true },
      { key: "submitted_at", header: "Asked", format: "datetime", width: 18 },
      { key: "decided_at", header: "Decided", format: "datetime", width: 18 },
    ],
  },
  {
    name: "Leave Balances",
    holds: "Each year's allowance by leave type: entitled, taken, booked, pending, left",
    columns: [
      { key: "year", header: "Year", format: "int", width: 8 },
      { key: "name", header: "Type", width: 18 },
      { key: "entitled", header: "Entitled", format: "qty", width: 10 },
      { key: "taken", header: "Taken", format: "int", width: 8 },
      { key: "booked", header: "Booked", format: "int", width: 8 },
      { key: "pending", header: "Pending", format: "int", width: 8 },
      { key: "remaining", header: "Left", format: "qty", width: 8 },
    ],
  },
  {
    name: "Attendance Days",
    holds: "Each day attendance recorded",
    columns: [
      { key: "attendance_date", header: "Date", format: "date", width: 12 },
      { key: "status", header: "Status", width: 12 },
      { key: "first_clock_in_at", header: "Clock In", format: "datetime", width: 18 },
      { key: "last_clock_out_at", header: "Clock Out", format: "datetime", width: 18 },
      { key: "worked_minutes", header: "Worked Minutes", format: "int", width: 14 },
      { key: "late_minutes", header: "Late Minutes", format: "int", width: 12 },
      { key: "overtime_minutes", header: "Overtime Minutes", format: "int", width: 16 },
    ],
  },
  {
    name: "Punches",
    holds: "Each clock-in and clock-out, with the location check and the device's name",
    columns: [
      { key: "work_date", header: "Date", format: "date", width: 12 },
      { key: "event_type", header: "Punch", width: 12 },
      { key: "occurred_at", header: "Time", format: "datetime", width: 18 },
      { key: "worksite_name", header: "Worksite", width: 22 },
      { key: "geofence", header: "Location Check", width: 14 },
      { key: "device_label", header: "Device", width: 22 },
      { key: "source", header: "Source", width: 12 },
      { key: "note", header: "Note", width: 30, wrap: true },
    ],
  },
  {
    name: "Documents",
    holds: "The documents in the vault, and the ones People asked for (not the files)",
    columns: [
      { key: "name", header: "Document", width: 32 },
      { key: "status", header: "Status", width: 12 },
      { key: "uploaded_at", header: "Uploaded", format: "datetime", width: 18 },
      { key: "expires_on", header: "Expires", format: "date", width: 12 },
      { key: "number", header: "Reference", width: 16 },
    ],
  },
  {
    name: "Sign-Ins",
    holds: "Each sign-in, from where, and how",
    columns: [
      { key: "issued_at", header: "Signed In", format: "datetime", width: 18 },
      { key: "last_seen_at", header: "Last Seen", format: "datetime", width: 18 },
      { key: "device_label", header: "Device", width: 26 },
      { key: "method", header: "Method", width: 18 },
      { key: "ip_address", header: "Address", width: 16 },
      { key: "status", header: "Status", width: 10 },
    ],
  },
]);

const field = (label, value) => ({ field: label, value: value === null || value === undefined ? "" : String(value) });
const day = (d) => (d ? formatDate(d) : "");

/** The employee 360 as the Profile, Next of Kin and Bank sheets; the account by its last four. */
function recordSheets(e) {
  const manager = e.line_manager ? e.line_manager.display_name : "";
  const account = e.account_number ? String(e.account_number) : "";
  return {
    Profile: [
      field("Staff Number", e.staff_number),
      field("First Name", e.first_name),
      field("Middle Name", e.middle_name),
      field("Last Name", e.last_name),
      field("Preferred Name", e.preferred_name),
      field("Date of Birth", day(e.date_of_birth)),
      field("Gender", words(e.gender)),
      field("Phone", e.phone),
      field("Work Email", e.work_email),
      field("Personal Email", e.personal_email),
      field("Home Address", e.home_address),
      field("Job Title", e.job_title),
      field("Department", e.department),
      field("Line Manager", manager),
      field("Employment Type", words(e.employment_type)),
      field("Work Arrangement", words(e.work_pattern)),
      field("Status", words(e.status)),
      field("Start Date", day(e.start_date)),
      field("Confirmed On", day(e.confirmed_on)),
      field("Contract Ends", day(e.contract_ends_on)),
      field("Login", e.login && e.login.email),
      field("Last Sign-In", e.login && e.login.last_sign_in_at ? formatDateTime(e.login.last_sign_in_at) : ""),
    ],
    "Next of Kin": [
      field("Name", e.next_of_kin_name),
      field("Relationship", e.next_of_kin_relationship),
      field("Phone", e.next_of_kin_phone),
    ],
    Bank: [field("Bank", e.bank_name), field("Account Ending", account ? account.slice(-4) : "")],
  };
}

/** Every sheet's rows for one person, through the reads their screens use. */
async function gatherAll(employeeId) {
  const employee360 = require("../organisation/employee-360.service");
  const leave = require("../leave/leave.service");
  const attendanceRepo = require("../attendance/attendance.repo");
  const { STATUS } = require("../attendance/attendance.export");
  const documents = require("../documents/documents.service");
  const identity = require("../identity/identity.service");

  const e = await employee360.get(pool, employeeId);
  const today = lagos.today();
  const out = recordSheets(e);

  out["Record History"] = await gather((page) => employee360.history(pool, employeeId, { page }));

  const requests = await gather((page) => leave.listFor(employeeId, { page }));
  out["Leave Requests"] = requests.map((r) => ({ ...r, status: LEAVE_STATUS[r.status] || words(r.status) }));

  // Each year with leave on record, and this one.
  const years = new Set([Number(today.slice(0, 4)), ...requests.map((r) => Number(String(r.starts_on).slice(0, 4)))]);
  out["Leave Balances"] = [];
  for (const year of [...years].sort()) {
    const { balances } = await leave.balancesFor(employeeId, year);
    out["Leave Balances"].push(...balances.map((b) => ({ ...b, year })));
  }

  const from = e.start_date && e.start_date < today ? e.start_date : "2000-01-01";
  const days = await gather((page) => attendanceRepo.listDays(pool, employeeId, from, today, { page }));
  out["Attendance Days"] = days.map((d) => ({ ...d, status: d.status ? STATUS[d.status] || words(d.status) : "" }));
  const punches = [];
  for (const d of days) {
    if (punches.length >= SHEET_CEILING) break;
    const date = String(d.attendance_date).slice(0, 10);
    const events = await gather((page) => attendanceRepo.listEvents(pool, employeeId, date, { page }, { coordinates: false }));
    punches.push(
      ...events.map((ev) => ({
        work_date: ev.work_date,
        event_type: PUNCH[ev.event_type] || words(ev.event_type),
        occurred_at: ev.occurred_at,
        worksite_name: ev.worksite_name,
        geofence: VERDICT[ev.geofence] || words(ev.geofence),
        device_label: ev.device_label,
        source: ev.source === "admin" ? "Added by People" : "Clock",
        note: ev.note,
      })),
    );
  }
  out.Punches = punches.slice(0, SHEET_CEILING);

  const docs = await gather((page) => documents.listFor([employeeId], { page }));
  out.Documents = docs.map((d) => ({ ...d, status: words(d.status) }));

  const login = e.login && e.login.user_id;
  const signIns = login
    ? await gather((page) => identity.listSessions({ user_id: login, session_id: null }, { page }))
    : [];
  out["Sign-Ins"] = signIns.map((s) => ({ ...s, method: METHOD[s.method] || words(s.method), status: words(s.status) }));
  return { employee: e, sheets: out };
}

/** The workbook: the cover, then a sheet per area. */
async function workbookFor(employeeId, asker) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const { employee, sheets } = await gatherAll(employeeId);
  const own = asker.employee_id === employeeId;
  const lines = [
    ["For", `${employee.display_name} (${employee.staff_number})`],
    ...(own ? [] : [["Asked for by", asker.display_name]]),
    ...SHEETS.map((s) => [s.name, `${s.holds}: ${sheets[s.name].length} rows`]),
    ["Not included", "Pay (with Payroll), the files themselves, coordinates and device identifiers"],
    ["About this file", NDPA_LINE],
  ];
  const buffer = await buildWorkbook({
    sheets: SHEETS.map((s) => ({ name: s.name, columns: s.columns, rows: sheets[s.name], freeze: { y: 1 } })),
    context: workbookContext({ actor: { name: asker.display_name }, title: "Download My Data", lines }),
    cover: true,
  });
  return { buffer, employee, own };
}

/**
 * employee.data_export_requested: the workbook made into the file the request reserved. An asker
 * no longer active, or no longer the person or the CEO, gets a failed file instead.
 * @param {object} event
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function build(event, ctx) {
  const grantsCache = require("../../shared/rbac/grants-cache");
  const p = event.payload || {};
  // Asked for before exports were downloaded: that one went by email, and has no file here.
  if (!p.document_id) return;
  const asker = p.requested_by ? await grantsCache.getAuthUser(pool, p.requested_by) : null;
  if (!asker || asker.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  // Only the person themselves or the CEO may have it, as when it was asked for.
  if (asker.employee_id !== p.employee_id && asker.is_ceo !== true)
    return exportFiles.fail(p.document_id, "Only the person or the CEO may have this file.");
  await exportFiles.make(p.document_id, ctx, async () => (await workbookFor(p.employee_id, asker)).buffer);
}

module.exports = {
  SHEETS,
  NDPA_LINE,
  requestOwn,
  requestFor,
  build,
  gatherAll,
  recordSheets,
};

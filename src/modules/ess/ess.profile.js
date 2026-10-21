"use strict";
/**
 * ESS · My Profile: the caller's own record (docs/guides/ess.md §3 steps 1 and 2, §6, §10).
 *
 * Read from the organisation module's employee 360, the same record People see, with
 * the bank account cut to its last four digits. Written through the organisation
 * service, the one write path for an employee (audit, events, field rules), limited to
 * the fields an employee changes themselves (EssProfileUpdate): phone, home address,
 * next of kin and bank. A bank change also tells People, who pay expense refunds into
 * that account.
 *
 * The photo is the organisation module's too (organisation.photo.js): uploaded here through the
 * upload engine as an avatar, read by every colleague.
 *
 * The work schedule is the person's own week from the attendance module (attendance guide §6.13):
 * each day Working or Off, its hours and Office or Remote, by the schedule People set, else the
 * company hours (the Attendance policy's, else Settings' working week, A22) at the place the work
 * pattern gives.
 */
const { pool } = require("../../config/db");
const places = require("../../shared/places/places");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const organisation = require("../organisation/organisation.service");
const employee360 = require("../organisation/employee-360.service");
const photo = require("../organisation/organisation.photo");
const documents = require("../documents/documents.service");
const schedules = require("../attendance/attendance.schedule");
const { meOf } = require("./ess.documents");
const { EVENTS } = require("./ess.events");

const BANK_FIELDS = ["bank_name", "account_number"];

/** The person's own week, Monday first: each day worked or not, its hours, and Office, Remote or Off. */
async function workingWeekOf(client, employeeId) {
  return (await schedules.weekOf(client, employeeId)).map((d) => ({
    weekday: d.weekday,
    is_working_day: d.working,
    starts_at: d.starts_at,
    ends_at: d.ends_at,
    place: schedules.placeOf(d),
  }));
}

/** The 360 cut to what My Profile shows. */
function profileOf(e, week, photoUrl = null) {
  const account = e.account_number ? String(e.account_number) : null;
  return {
    employee_id: e.employee_id,
    staff_number: e.staff_number,
    display_name: e.display_name,
    first_name: e.first_name,
    last_name: e.last_name,
    job_title: e.job_title,
    department: e.department ?? null,
    status: e.status,
    confirmed: Boolean(e.confirmed_on),
    employment_type: e.employment_type,
    work_pattern: e.work_pattern,
    start_date: e.start_date,
    line_manager: e.line_manager ?? null,
    work_email: e.work_email,
    phone: e.phone,
    date_of_birth: e.date_of_birth,
    home_address: e.home_address,
    next_of_kin_name: e.next_of_kin_name,
    next_of_kin_relationship: e.next_of_kin_relationship,
    next_of_kin_phone: e.next_of_kin_phone,
    bank_name: e.bank_name,
    account_last4: account ? account.slice(-4) : null,
    photo_url: photoUrl,
    working_week: week,
  };
}

async function get(user) {
  const me = meOf(user);
  return {
    ...profileOf(await employee360.get(pool, me), await workingWeekOf(pool, me), await photo.photoOf(pool, me)),
    home_address_place: await places.view(pool, "employee.home_address", me),
  };
}

/**
 * Upload my photo (purpose `avatar`) and use it: My Profile, the shell, wherever I appear.
 * Answers with the stored file as every upload does (DocumentRef: the upload engine in the
 * apps waits for a document_id); the screen then reads my profile again.
 */
async function setPhoto(user, file) {
  const me = meOf(user);
  const client = await pool.connect();
  try {
    return documents.refOf(await atomically(client, () => photo.setPhoto(client, me, file, user)));
  } finally {
    client.release();
  }
}

/** Stop using my photo; my initials show again. */
async function removePhoto(user) {
  const me = meOf(user);
  const client = await pool.connect();
  try {
    await atomically(client, () => photo.clearPhoto(client, me, user));
  } finally {
    client.release();
  }
  return get(user);
}

/** What has been done to my record, a page at a time. */
const history = (user, query) => employee360.history(pool, meOf(user), query);

/** Change my own contact, next-of-kin and bank details. */
async function update(user, body) {
  const me = meOf(user);
  // A field left empty on the form is left as it is: only what was given is written.
  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  const before = await employee360.get(pool, me);
  const bankChanged = BANK_FIELDS.some(
    (k) => patch[k] !== undefined && String(patch[k]) !== String(before[k] ?? ""),
  );
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      await organisation.updateEmployee(client, me, patch, user);
      if (bankChanged) {
        await emit(client, {
          key: EVENTS.EMPLOYEE_BANK_DETAILS_CHANGED,
          entity: { type: "employee", id: me },
          actor: user,
          payload: {
            employee_id: me,
            subject_employee_id: me,
            display_name: before.display_name,
          },
        });
      }
    });
  } finally {
    client.release();
  }
  return get(user);
}

module.exports = { get, history, update, setPhoto, removePhoto, workingWeekOf, profileOf };

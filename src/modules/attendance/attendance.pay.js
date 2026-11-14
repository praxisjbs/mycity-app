"use strict";
/**
 * Pending deductions and overtime (docs/guides/attendance.md §6.17; TB's decisions of 20/10/2026,
 * T4, T6): what a late, early or absent day, or a day's overtime, comes to under the policy version
 * that judged the day.
 *
 *   settleDay()   in the transaction that recalculates a day (a punch, a decision, a system
 *                 clock-out, the day-close): one pay item per kind the day qualifies for, priced from
 *                 the person's monthly gross; an item still pending, or one the system decided,
 *                 follows the day (its figures change, and the system waives or cuts it once the
 *                 day stops qualifying: "Leave granted", "No longer late"); one a person decided or
 *                 payroll took (in_run) stays as it is
 *   waive()       People waive up to 25 pending deductions with a reason (`people` approve, scope
 *                 all; never their own)
 *   decideOvertime()  the line manager or People confirm all of a pending overtime item, confirm
 *                 fewer minutes, or cut it with a reason (Line Manager After; never their own)
 *   approveOvertime() Approve Overtime: minutes for a person's day beforehand (Pre-Approved)
 *   monthRates()  a person's month for payroll: their working days and daily rate (docs/guides/payroll.md
 *                 §6.2), from the one loop pricing a day already uses
 *   takeIntoRun() payroll's Submit freezes the items it counted into its run (in_run), pricing one
 *                 that had no amount; releaseFromRun() a Send Back gives them back (§6.9). Payroll
 *                 never writes the table itself: it asks here, inside its own transaction
 *
 * The amounts, through shared/money, rounded to the kobo once:
 *   daily rate    the monthly gross over the person's working days that month (their schedule,
 *                 less public holidays)
 *   hourly rate   the daily rate over that day's scheduled hours; on a day not worked, over the
 *                 average scheduled hours of the month's working days
 *   pro_rata      the hourly rate times the minutes over 60
 *   per_hour      a deduction: the amount times the started hours; overtime: the amount an hour,
 *                 prorated to the minute
 *   per_day       the amount
 *   daily_rate    an absence: the daily rate
 *   multiplier    overtime: the hourly rate times the multiplier (the rest-day multiplier on a day
 *                 not worked), prorated to the minute
 * With no gross set, a salary-derived amount is null (No Salary Set) and the item keeps its minutes.
 *
 * Confirmed overtime in a month never passes the policy's monthly cap; the minutes beyond it are
 * cut ("Monthly cap"). Events carry ids, the day, the kind, the minutes and the status, never an
 * amount: amounts are salary-derived (masked as the salary is, `pay_amount`).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { scopeFor } = require("../../middleware/rbac");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const policies = require("../policies/policies.service");
const calendar = require("./attendance.calendar");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

const DEDUCTIONS = Object.freeze(["late", "early_departure", "absence"]);
const KINDS = Object.freeze([...DEDUCTIONS, "overtime"]);
/** Why the system waives a deduction, or cuts overtime, once its day stops qualifying. */
const NO_LONGER = Object.freeze({
  late: "No longer late",
  early_departure: "No longer early",
  absence: "No longer absent",
  overtime: "No overtime",
});
const LEAVE_GRANTED = "Leave granted";
const MONTHLY_CAP = "Monthly cap";
const BEYOND_APPROVAL = "Beyond pre-approval";
const NOT_PRE_APPROVED = "Not pre-approved";
/** How far ahead overtime may be approved, in days. */
const APPROVE_AHEAD_DAYS = 90;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * The amounts, pure
 * ------------------------------------------------------------------ */

/** A shift's scheduled minutes, 0 for a day not worked. */
function shiftMinutes(shift) {
  if (!shift || !shift.working_day) return 0;
  const start = rules.parseHHMM(shift.starts_at);
  const end = rules.parseHHMM(shift.ends_at);
  return start === null || end === null || end <= start ? 0 : end - start;
}

/** The monthly gross over the month's working days, unrounded; null with no gross or no working day. */
function dailyRate(gross, workingDays) {
  if (gross === null || gross === undefined || !workingDays) return null;
  return m.money(gross).dividedBy(workingDays);
}

/** The daily rate over a day's scheduled minutes, an hour's worth; null without both. */
function hourlyRate(daily, dayMinutes) {
  if (!daily || !dayMinutes) return null;
  return daily.times(60).dividedBy(dayMinutes);
}

/**
 * A deduction's amount on the wire ("1250.00"), or null when it needs a salary there is none of.
 * @param {"pro_rata"|"per_hour"|"per_day"|"daily_rate"} method
 * @param {{daily: object|null, hourly: object|null, minutes: number, amount?: string|null}} basis
 */
function deductionAmount(method, { daily, hourly, minutes, amount = null }) {
  if (method === "per_day") return amount ? m.toWire(amount) : null;
  if (method === "per_hour") return amount ? m.toWire(m.money(amount).times(Math.ceil(minutes / 60))) : null;
  if (method === "daily_rate") return daily ? m.toWire(daily) : null;
  return hourly ? m.toWire(hourly.times(minutes).dividedBy(60)) : null;
}

/**
 * Overtime's amount on the wire, prorated to the minute, or null with no salary for a multiple.
 * @param {"multiplier"|"per_hour"} method
 * @param {{hourly: object|null, minutes: number, multiplier: number, amount?: string|null}} basis
 */
function overtimeAmount(method, { hourly, minutes, multiplier, amount = null }) {
  if (method === "per_hour") return amount ? m.toWire(m.money(amount).times(minutes).dividedBy(60)) : null;
  return hourly ? m.toWire(hourly.times(m.money(String(multiplier))).times(minutes).dividedBy(60)) : null;
}

/**
 * What the approval method makes of an overtime item when it is added or follows its day (§6.17):
 * pending for its line manager, confirmed at once, or confirmed up to a pre-approval; the monthly
 * cap holds every confirmation. Pure.
 * @param {{approval: string, minutes: number, preApproved: number|null, capLeft: number}} a
 * @returns {{status: "pending"|"confirmed"|"cut", confirmed_minutes: number|null, reason: string|null}}
 */
function overtimeOutcome({ approval, minutes, preApproved, capLeft }) {
  if (approval === "manager_after") return { status: "pending", confirmed_minutes: null, reason: null };
  let allowed = minutes;
  let reason = null;
  if (approval === "pre_approved") {
    if (!preApproved) return { status: "cut", confirmed_minutes: 0, reason: NOT_PRE_APPROVED };
    if (preApproved < minutes) {
      allowed = preApproved;
      reason = BEYOND_APPROVAL;
    }
  }
  return capped(allowed, capLeft, reason);
}

/** Minutes held to what the month's cap has left: the rest cut, "Monthly cap". Pure. */
function capped(minutes, capLeft, reason = null) {
  const left = Math.max(0, capLeft);
  if (left <= 0) return { status: "cut", confirmed_minutes: 0, reason: MONTHLY_CAP };
  if (minutes > left) return { status: "confirmed", confirmed_minutes: left, reason: MONTHLY_CAP };
  return { status: "confirmed", confirmed_minutes: minutes, reason };
}

/**
 * The items a day qualifies for under the version that judged it, by kind (§6.17). Pure.
 * @param {{status: string|null, late_minutes: number, early_minutes: number, overtime_minutes: number}} day
 * @param {{working_day: boolean}} shift  the shift the day was judged against
 * @param {object} r  the judging version's rules (AttendanceRules)
 * @returns {Record<string, {minutes: number, method: string, rest_day: boolean, amount: string|null}>}
 */
function qualifies(day, shift, r) {
  const out = {};
  if (day.status === "leave") return out;
  if (shift.working_day) {
    if (day.status === "late" && day.late_minutes > 0 && r.late_deduction.on)
      out.late = { minutes: day.late_minutes, method: r.late_deduction.method, rest_day: false, amount: r.late_deduction.amount };
    if (day.early_minutes > 0 && r.early_deduction.on && (day.status === "present" || day.status === "late"))
      out.early_departure = {
        minutes: day.early_minutes,
        method: r.early_deduction.method,
        rest_day: false,
        amount: r.early_deduction.amount,
      };
    if (day.status === "absent" && r.absence_deduction.on)
      out.absence = { minutes: shiftMinutes(shift), method: "daily_rate", rest_day: false, amount: null };
  }
  if (r.overtime.on && day.overtime_minutes > 0 && (day.status === "present" || day.status === "late"))
    out.overtime = {
      minutes: day.overtime_minutes,
      method: r.overtime.method,
      rest_day: !shift.working_day,
      amount: r.overtime.amount,
    };
  return out;
}

/* ------------------------------------------------------------------ *
 * The rates, from the person's month
 * ------------------------------------------------------------------ */

/**
 * What a month's rates are read from, loaded once: the working week with its public holidays, and the
 * company hours of each day. Payroll loads it once for a whole run and hands it to `monthRates` for
 * every person, so 300 people do not each load the calendar again.
 */
async function monthContext(db, date) {
  const { first, last } = lagos.monthBounds(date);
  return { cal: await workingWeek.loadCalendar(db), hours: await calendar.companyHoursBetween(db, first, last) };
}

/**
 * A person's month (docs/guides/payroll.md §6.2): the days they work by their own schedule, less public
 * holidays, with the scheduled minutes of those days, and the daily rate (their monthly gross over the
 * working days, unrounded; null with no gross or no working day). This is the one loop `ratesFor` prices
 * a day with, so payroll and attendance can never count the month differently.
 * @param {{query: Function}} db
 * @param {{employee_id: string, work_pattern: string, gross_monthly: string|null}} person
 * @param {string} date  any date of the month
 * @param {{cal: object, hours: object}|null} [shared]  `monthContext(db, date)`, when the caller holds it
 * @returns {Promise<{first: string, last: string, working_dates: string[], working_days: number,
 *   total_minutes: number, daily: object|null}>}
 */
async function monthRates(db, person, date, shared = null) {
  const { first, last } = lagos.monthBounds(date);
  const { cal, hours } = shared || (await monthContext(db, date));
  const schedules = await repo.workSchedulesBetween(db, person.employee_id, first, last);
  const workingDates = [];
  let minutes = 0;
  for (let d = first; d <= last; d = lagos.addDays(d, 1)) {
    const schedule = schedules.filter((s) => String(s.effective_from).slice(0, 10) <= d).pop() || null;
    const s = rules.shiftFor(d, cal, { hours: hours[d] }, { schedule, pattern: person.work_pattern });
    if (!s.working_day) continue;
    workingDates.push(d);
    minutes += shiftMinutes(s);
  }
  return {
    first,
    last,
    working_dates: workingDates,
    working_days: workingDates.length,
    total_minutes: minutes,
    daily: dailyRate(person.gross_monthly, workingDates.length),
  };
}

/**
 * The person's daily and hourly rates for a day: their gross over the month's working days by
 * their own schedule (less public holidays), and over the day's scheduled minutes (on a day not
 * worked, the month's average). Null rates with no gross set.
 */
async function ratesFor(db, person, date, shift) {
  if (person.gross_monthly === null || person.gross_monthly === undefined) return { daily: null, hourly: null };
  const month = await monthRates(db, person, date);
  const dayMinutes = shift.working_day
    ? shiftMinutes(shift)
    : month.working_days
      ? Math.round(month.total_minutes / month.working_days)
      : 0;
  return { daily: month.daily, hourly: hourlyRate(month.daily, dayMinutes) };
}

/* ------------------------------------------------------------------ *
 * Settling a day
 * ------------------------------------------------------------------ */

/** The facts an item's events carry: ids, the day, the kind, the minutes and the status. */
const factsOf = (item, extra = {}) => ({
  attendance_pay_item_id: item.attendance_pay_item_id,
  employee_id: item.employee_id,
  subject_employee_id: item.employee_id,
  work_date: String(item.work_date).slice(0, 10),
  kind: item.kind,
  minutes: item.minutes,
  confirmed_minutes: item.confirmed_minutes ?? null,
  status: item.status,
  reason: item.reason || null,
  ...extra,
});

/** What an audit line records of an item: never its amount. */
const auditOf = (item) =>
  item && { kind: item.kind, minutes: item.minutes, method: item.method, status: item.status, reason: item.reason || null };

/**
 * Settle a day's pay items, in the caller's transaction (after the person's lock): one per kind the
 * day qualifies for under the version that judged it, priced now; an item the system keeps follows
 * the day. Returns the items as they stand.
 * @param {import("pg").PoolClient} client
 * @param {object} person  repo.person()
 * @param {object} day  the attendance_day row just written
 * @param {{rules: object, shift: object, policy_version_id: string|null}} judged
 */
async function settleDay(client, person, day, judged) {
  const date = String(day.attendance_date).slice(0, 10);
  const existing = new Map((await repo.payItemsOn(client, person.employee_id, date)).map((x) => [x.kind, x]));
  const want = qualifies(day, judged.shift, judged.rules);
  if (!existing.size && !Object.keys(want).length) return [];
  const rates = Object.keys(want).length ? await ratesFor(client, person, date, judged.shift) : null;
  const out = [];
  for (const kind of KINDS) {
    const row = existing.get(kind) || null;
    if (row && (row.status === "in_run" || row.decided_by)) {
      out.push(row);
      continue;
    }
    const w = want[kind];
    if (!w) {
      if (row && row.status !== "waived" && row.status !== "cut") out.push(await withdraw(client, row, day));
      else if (row) out.push(row);
      continue;
    }
    const figures = await figuresOf(client, person, date, kind, w, rates, judged, row);
    if (!row) out.push(await add(client, person, day, kind, figures, judged));
    else out.push(await follow(client, row, figures));
  }
  return out;
}

/** An item's figures and status, priced and put through its approval method. */
async function figuresOf(client, person, date, kind, w, rates, judged, row) {
  const base = {
    minutes: w.minutes,
    rest_day: w.rest_day,
    method: w.method,
    policy_version_id: judged.policy_version_id,
    status: "pending",
    reason: null,
    confirmed_minutes: null,
  };
  if (kind !== "overtime")
    return { ...base, amount: deductionAmount(w.method, { daily: rates.daily, hourly: rates.hourly, minutes: w.minutes, amount: w.amount }) };
  const o = judged.rules.overtime;
  const pre = o.approval === "pre_approved" ? await repo.overtimeApprovalOn(client, person.employee_id, date) : null;
  const { first, last } = lagos.monthBounds(date);
  const used = await repo.confirmedOvertime(client, person.employee_id, first, last, row ? row.attendance_pay_item_id : null);
  const outcome = overtimeOutcome({
    approval: o.approval,
    minutes: w.minutes,
    preApproved: pre ? Number(pre.minutes) : null,
    capLeft: o.monthly_cap_hours * 60 - used,
  });
  const paid = outcome.status === "pending" ? w.minutes : outcome.confirmed_minutes;
  const multiplier = w.rest_day ? o.rest_day_multiplier : o.multiplier;
  return {
    ...base,
    ...outcome,
    amount: overtimeAmount(w.method, { hourly: rates.hourly, minutes: paid, multiplier, amount: w.amount }),
  };
}

/** A new item: added, the person told; overtime waiting on its line manager tells them too. */
async function add(client, person, day, kind, f, judged) {
  const item = await repo.insertPayItem(client, {
    employee_id: person.employee_id,
    attendance_day_id: day.attendance_day_id,
    work_date: day.attendance_date,
    kind,
    ...f,
  });
  if (!item) return (await repo.payItemsOn(client, person.employee_id, day.attendance_date)).find((x) => x.kind === kind);
  const awaiting = kind === "overtime" && item.status === "pending";
  await emit(client, {
    key: EVENTS.ATTENDANCE_PAY_ITEM_ADDED,
    entity: { type: "attendance_pay_item", id: item.attendance_pay_item_id },
    actor: null,
    after: auditOf(item),
    payload: factsOf(item, { awaiting_approval: awaiting, employee_name: person.ref.display_name }),
  });
  if (kind === "overtime" && item.status !== "pending")
    await emit(client, {
      key: EVENTS.ATTENDANCE_OVERTIME_DECIDED,
      entity: { type: "attendance_pay_item", id: item.attendance_pay_item_id },
      actor: null,
      after: auditOf(item),
      payload: factsOf(item, { by_method: judged.rules.overtime.approval }),
    });
  return item;
}

const sameFigures = (row, f) =>
  row.minutes === f.minutes &&
  row.rest_day === f.rest_day &&
  row.method === f.method &&
  (row.amount || null) === (f.amount || null) &&
  row.status === f.status &&
  (row.reason || null) === (f.reason || null) &&
  (row.confirmed_minutes ?? null) === (f.confirmed_minutes ?? null);

/** An item the system keeps follows its day; one waived or cut by the system that qualifies again is back. */
async function follow(client, row, f) {
  if (sameFigures(row, f)) return row;
  const item = await repo.updatePayItem(client, row.attendance_pay_item_id, f);
  if (!item) return row;
  const back = (row.status === "waived" || row.status === "cut") && item.status === "pending";
  await emit(client, {
    key: back ? EVENTS.ATTENDANCE_PAY_ITEM_ADDED : EVENTS.ATTENDANCE_PAY_ITEM_CHANGED,
    entity: { type: "attendance_pay_item", id: item.attendance_pay_item_id },
    actor: null,
    before: auditOf(row),
    after: auditOf(item),
    payload: factsOf(item, { awaiting_approval: back && item.kind === "overtime" }),
  });
  return item;
}

/** The day stopped qualifying: the system waives a deduction, or cuts overtime, with why. */
async function withdraw(client, row, day) {
  const reason = day.status === "leave" ? LEAVE_GRANTED : NO_LONGER[row.kind];
  const status = row.kind === "overtime" ? "cut" : "waived";
  const item = await repo.updatePayItem(client, row.attendance_pay_item_id, {
    ...row,
    status,
    reason,
    confirmed_minutes: row.kind === "overtime" ? 0 : row.confirmed_minutes,
  });
  if (!item) return row;
  await emit(client, {
    key: row.kind === "overtime" ? EVENTS.ATTENDANCE_OVERTIME_DECIDED : EVENTS.ATTENDANCE_PAY_ITEM_WAIVED,
    entity: { type: "attendance_pay_item", id: item.attendance_pay_item_id },
    actor: null,
    before: auditOf(row),
    after: auditOf(item),
    payload: factsOf(item),
  });
  return item;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A repo row as the contract's PayItem. */
function present(row) {
  return {
    attendance_pay_item_id: row.attendance_pay_item_id,
    attendance_day_id: row.attendance_day_id || null,
    employee: row.employee,
    work_date: String(row.work_date).slice(0, 10),
    kind: row.kind,
    minutes: row.minutes,
    rest_day: Boolean(row.rest_day),
    method: row.method,
    pay_amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
    salary_set: Boolean(row.salary_set),
    status: row.status,
    confirmed_minutes: row.confirmed_minutes ?? null,
    reason: row.reason || null,
    decided_by_name: row.decided_by_name || null,
    decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    can_decide: Boolean(row.can_decide),
  };
}

const presentPage = (page) => ({ ...page, data: page.data.map(present) });

/** The month's bounds, or none. */
const monthRange = (month) => (month ? lagos.monthBounds(`${month}-01`) : { first: null, last: null });

/** What the reader may decide: their own employee id, and the people their `people` approve reaches. */
async function readerOf(user) {
  const approve = await scopeFor(user, "people", "approve");
  return {
    employee_id: user.employee_id,
    approve_all: Boolean(approve && approve.scope === "all"),
    approve_ids: approve && approve.scope !== "all" ? approve.scope_ids || [] : [],
  };
}

/** GET /attendance/pay-items, within the reader's `people` view scope. */
async function list(user, query, scope) {
  const { first, last } = monthRange(query.month);
  return presentPage(await repo.listPayItems(pool, query, scope, { reader: await readerOf(user), from: first, to: last }));
}

/** GET /attendance/me/pay-items: the person's own for a month (this month in Lagos when none). */
async function mine(user, query) {
  const month = query.month || lagos.today().slice(0, 7);
  const { first, last } = monthRange(month);
  const own = { scope: "own", scope_ids: [user.employee_id] };
  const page = await repo.listPayItems(pool, { ...query, employee_id: user.employee_id, sort: query.sort || { field: "work_date", dir: "desc" } }, own, {
    reader: { employee_id: user.employee_id, approve_all: false, approve_ids: [] },
    from: first,
    to: last,
  });
  return presentPage(page);
}

/* ------------------------------------------------------------------ *
 * Payroll's hand-off (docs/guides/payroll.md §4.4, §6.4, §6.9)
 * ------------------------------------------------------------------ */

/**
 * What an item with no price comes to now that the person has a salary: "it gains its amount when
 * payroll prices it" (§6.17 above). The item's own figures through its judging version's rules, the
 * way a day is priced when it is settled. Null for an item that still cannot be priced (no salary, no
 * working day, or no version to read the rule from).
 * @param {{query: Function}} db
 * @param {object} row  a pay item with its person's `gross_monthly` and `work_pattern`
 * @returns {Promise<string|null>}
 */
async function priceOf(db, row) {
  if (row.amount !== null && row.amount !== undefined) return String(row.amount);
  if (row.gross_monthly === null || row.gross_monthly === undefined || !row.policy_version_id) return null;
  const person = { employee_id: row.employee_id, work_pattern: row.work_pattern, gross_monthly: row.gross_monthly };
  const date = String(row.work_date).slice(0, 10);
  const r = (await policies.rulesOfVersion(db, "attendance", row.policy_version_id)).rules;
  const day = await repo.getDay(db, row.employee_id, date);
  const shift = day && day.judged_at ? rules.recordedShift(day, r) : { working_day: !row.rest_day };
  const rates = await ratesFor(db, person, date, shift);
  if (row.kind === "overtime") {
    const o = r.overtime;
    return overtimeAmount(row.method, {
      hourly: rates.hourly,
      minutes: row.confirmed_minutes ?? row.minutes,
      multiplier: row.rest_day ? o.rest_day_multiplier : o.multiplier,
      amount: o.amount,
    });
  }
  const rule = row.kind === "early_departure" ? r.early_deduction : r.late_deduction;
  return deductionAmount(row.method, { daily: rates.daily, hourly: rates.hourly, minutes: row.minutes, amount: rule.amount });
}

/**
 * Payroll's Compute asks what each pending deduction and confirmed overtime item comes to, so a total
 * shown before Submit is the one Submit freezes: the item's own amount, or its price now when it had none.
 * @param {{query: Function}} db
 * @param {object[]} rows  pay items with their person's `gross_monthly` and `work_pattern`
 * @returns {Promise<Map<string, string|null>>} attendance_pay_item_id → amount on the wire
 */
async function pricesOf(db, rows) {
  const out = new Map();
  for (const row of rows) out.set(row.attendance_pay_item_id, await priceOf(db, row));
  return out;
}

/**
 * Submit freezes the items a run counted (§6.9 rule 1): each becomes `in_run` with the run, so People
 * can no longer waive it. An item that had no price gets it now. Every item named must still be a
 * pending deduction or confirmed overtime with no run, or nothing is frozen and the caller's
 * transaction ends in 409 `RUN_CHANGED`: someone waived, cut or took it since Compute counted it.
 * Called inside payroll's transaction; one event for the run, with the count.
 * @param {import("pg").PoolClient} client
 * @param {{run_id: string, items: string[], actor?: object|null}} args
 * @returns {Promise<{taken: number}>}
 */
async function takeIntoRun(client, { run_id: runId, items, actor = null }) {
  const ids = [...new Set(items || [])];
  if (!ids.length) return { taken: 0 };
  const rows = await repo.lockPayItemsForRun(client, ids);
  for (const row of rows) {
    if (row.amount === null || row.amount === undefined) {
      const price = await priceOf(client, row);
      if (price !== null) await repo.setPayItemAmount(client, row.attendance_pay_item_id, price);
    }
  }
  const taken = await repo.takePayItems(client, ids, runId);
  if (rows.length !== ids.length || taken.length !== ids.length)
    throw new AppError("RUN_CHANGED", "Attendance changed while the run was sent", 409);
  await emit(client, {
    key: EVENTS.ATTENDANCE_PAY_ITEMS_TAKEN,
    entity: { type: "payroll_run", id: runId },
    actor,
    payload: { payroll_run_id: runId, items: taken.length },
  });
  return { taken: taken.length };
}

/**
 * A Send Back, a Reject or a withdrawal gives the run's items back (§6.9 rule 2): a deduction to
 * pending, confirmed overtime to confirmed, no run. Safe to call twice: the second finds none.
 * @param {import("pg").PoolClient} client
 * @param {string} runId
 * @param {object|null} [actor]
 * @returns {Promise<{released: number}>}
 */
async function releaseFromRun(client, runId, actor = null) {
  const released = await repo.releasePayItems(client, runId);
  if (released > 0)
    await emit(client, {
      key: EVENTS.ATTENDANCE_PAY_ITEMS_RELEASED,
      entity: { type: "payroll_run", id: runId },
      actor,
      payload: { payroll_run_id: runId, items: released },
    });
  return { released };
}

/* ------------------------------------------------------------------ *
 * People's decisions
 * ------------------------------------------------------------------ */

/**
 * POST /attendance/pay-items/waive: up to 25 pending deductions, each with the reason the person
 * reads. `people` approve with scope all; never their own. An item no longer pending is skipped.
 */
async function waive(actor, scope, body) {
  if (scope.scope !== "all")
    throw new AppError("FORBIDDEN", "Only People with access to everyone waive deductions", 403);
  const ids = [...new Set(body.pay_item_ids)];
  const { waived, skipped } = await tx(async (client) => {
    const rows = await repo.lockPayItems(client, ids);
    if (rows.length !== ids.length) throw new AppError("NOT_FOUND", "A deduction does not exist", 404);
    if (rows.some((r) => r.employee_id === actor.employee_id))
      throw new AppError("OWN_RECORD", "Someone else waives your own deductions", 403);
    if (rows.some((r) => r.kind === "overtime"))
      throw new AppError("NOT_A_DEDUCTION", "Only deductions are waived; confirm or cut overtime", 422, {
        pay_item_ids: ["Deductions only"],
      });
    const done = [];
    const left = [];
    for (const r of rows) {
      if (r.status !== "pending") {
        left.push({ attendance_pay_item_id: r.attendance_pay_item_id, code: r.status === "in_run" ? "IN_RUN" : "NOT_PENDING" });
        continue;
      }
      const item = await repo.decidePayItem(client, r.attendance_pay_item_id, { status: "waived", reason: body.reason, by: actor.user_id });
      await emit(client, {
        key: EVENTS.ATTENDANCE_PAY_ITEM_WAIVED,
        entity: { type: "attendance_pay_item", id: item.attendance_pay_item_id },
        actor,
        before: auditOf(r),
        after: auditOf(item),
        payload: factsOf(item),
      });
      done.push(item.attendance_pay_item_id);
    }
    return { waived: done, skipped: left };
  });
  return { waived: (await repo.payItemsByIds(pool, waived)).map(present), skipped };
}

/**
 * POST /attendance/pay-items/:id/overtime: confirm all, confirm fewer minutes, or cut with a reason,
 * while it waits on its line manager (Line Manager After). `people` approve within scope, never
 * their own; a confirmation is held to the month's cap.
 */
async function decideOvertime(actor, scope, id, body) {
  const result = await tx(async (client) => {
    const row = await repo.getPayItem(client, id, { forUpdate: true });
    if (!row) throw new AppError("NOT_FOUND", "That overtime does not exist", 404);
    assertInScope(scope, row.employee_id);
    if (row.employee_id === actor.employee_id)
      throw new AppError("OWN_RECORD", "Someone else confirms your own overtime", 403);
    if (row.kind !== "overtime") throw new AppError("NOT_OVERTIME", "Only overtime is confirmed or cut", 422);
    if (row.status !== "pending") throw new AppError("OVERTIME_DECIDED", "This overtime was already decided", 409);
    let status = "cut";
    let minutes = 0;
    let reason = body.reason || null;
    if (body.decision === "confirm") {
      const want = body.minutes ?? row.minutes;
      if (want > row.minutes)
        throw new AppError("OVERTIME_MINUTES", `At most ${row.minutes} minutes`, 422, { minutes: [`At most ${row.minutes}`] });
      const r = await policies.rulesOfVersion(client, "attendance", row.policy_version_id);
      const { first, last } = lagos.monthBounds(String(row.work_date).slice(0, 10));
      const used = await repo.confirmedOvertime(client, row.employee_id, first, last, row.attendance_pay_item_id);
      const held = capped(want, r.rules.overtime.monthly_cap_hours * 60 - used, reason);
      status = held.status;
      minutes = held.confirmed_minutes;
      reason = held.reason;
    }
    const item = await repo.decidePayItem(client, id, { status, reason, confirmedMinutes: minutes, by: actor.user_id });
    if (!item) throw new AppError("OVERTIME_DECIDED", "This overtime was already decided", 409);
    if (status === "confirmed" && item.minutes > 0 && minutes !== item.minutes) {
      // The amount follows the minutes confirmed.
      const person = await repo.person(client, item.employee_id);
      const r = await policies.rulesOfVersion(client, "attendance", item.policy_version_id);
      const day = await repo.getDay(client, item.employee_id, item.work_date);
      const shift = day && day.judged_at ? rules.recordedShift(day, r.rules) : { working_day: !item.rest_day };
      const rates = await ratesFor(client, person, String(item.work_date).slice(0, 10), shift);
      const o = r.rules.overtime;
      await client.query("UPDATE attendance_pay_item SET amount = $2::numeric WHERE attendance_pay_item_id = $1", [
        id,
        overtimeAmount(item.method, {
          hourly: rates.hourly,
          minutes,
          multiplier: item.rest_day ? o.rest_day_multiplier : o.multiplier,
          amount: o.amount,
        }),
      ]);
    }
    await emit(client, {
      key: EVENTS.ATTENDANCE_OVERTIME_DECIDED,
      entity: { type: "attendance_pay_item", id },
      actor,
      before: auditOf(row),
      after: auditOf(item),
      payload: factsOf(item),
    });
    return id;
  });
  const [row] = await repo.payItemsByIds(pool, [result]);
  return present(row);
}

/**
 * POST /attendance/overtime-approvals: Approve Overtime for a person's day beforehand (§6.17,
 * Pre-Approved). `people` approve within scope (the line manager above them, or People), never
 * their own; the day from today in Lagos to 90 days ahead; the same day again replaces it.
 */
async function approveOvertime(actor, scope, body) {
  const today = lagos.today();
  if (body.work_date < today)
    throw new AppError("OVERTIME_IN_THE_PAST", "Approve overtime for today or later", 422, { work_date: ["Already past"] });
  if (lagos.daysBetween(today, body.work_date) > APPROVE_AHEAD_DAYS)
    throw new AppError("OVERTIME_TOO_FAR", `Pick a day within ${APPROVE_AHEAD_DAYS} days`, 422, { work_date: ["Too far ahead"] });
  const id = await tx(async (client) => {
    await repo.lockEmployee(client, body.employee_id);
    const person = await repo.person(client, body.employee_id);
    if (!person) throw new AppError("NOT_FOUND", "That employee does not exist", 404);
    assertInScope(scope, body.employee_id);
    if (body.employee_id === actor.employee_id)
      throw new AppError("OWN_RECORD", "Someone else approves your own overtime", 403);
    if (person.status !== "active") throw new AppError("NOT_EMPLOYED", "Only people who work here now are approved overtime.", 422);
    const row = await repo.upsertOvertimeApproval(client, { ...body, approved_by: actor.user_id });
    await emit(client, {
      key: EVENTS.ATTENDANCE_OVERTIME_APPROVED,
      entity: { type: "attendance_overtime_approval", id: row.attendance_overtime_approval_id },
      actor,
      after: { work_date: body.work_date, minutes: body.minutes, reason: body.reason },
      payload: {
        attendance_overtime_approval_id: row.attendance_overtime_approval_id,
        employee_id: body.employee_id,
        subject_employee_id: body.employee_id,
        work_date: body.work_date,
        minutes: body.minutes,
      },
    });
    return row.attendance_overtime_approval_id;
  });
  const approval = await repo.overtimeApprovalOn(pool, body.employee_id, body.work_date);
  const person = await repo.person(pool, body.employee_id);
  return {
    attendance_overtime_approval_id: id,
    employee: person.ref,
    work_date: body.work_date,
    minutes: approval.minutes,
    reason: approval.reason,
    approved_by_name: approval.approved_by_name || null,
    approved_at: new Date(approval.approved_at).toISOString(),
  };
}

/*
 * Praxis AI's Approve Overtime card (docs/guides/praxis-ai.md §6.11, decision 33): the person it
 * names and its re-check, Approve Overtime's own rules before the press runs approveOvertime.
 * Nothing here writes.
 */

/** Is this person in the reader's `people` scope? */
const inReach = (scope, employeeId) => {
  try {
    assertInScope(scope, employeeId);
    return true;
  } catch {
    return false;
  }
};

/** The person a card approves overtime for, by name, when they are in the reader's reach; nothing otherwise. */
async function cardPerson(db, employeeId, scope) {
  if (!db || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId || "")) || !inReach(scope, employeeId)) return [];
  const person = await repo.person(db, employeeId);
  return person ? [{ type: "employee", id: employeeId, label: person.ref.display_name }] : [];
}

/** The card's re-check (§6.11 step 5): someone in the reader's reach who works here now, never themselves. */
async function assertCardOvertime(db, { employee_id: employeeId }, actor) {
  const person = (await cardPerson(db, employeeId, actor.scope)).length ? await repo.person(db, employeeId) : null;
  if (!person) throw new AppError("NOT_FOUND", "That employee does not exist", 404, { employee_id: ["No such person"] });
  if (employeeId === actor.employee_id) throw new AppError("OWN_RECORD", "Someone else approves your own overtime", 403, { employee_id: ["Not yourself"] });
  if (person.status !== "active") throw new AppError("NOT_EMPLOYED", "Only people who work here now are approved overtime.", 422, { employee_id: ["Not active"] });
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, People, performance and queries)
 * ------------------------------------------------------------------ */

/** A pay item's kind and status, as People · Attendance names them. */
const KIND_WORDS = Object.freeze({ late: "Late", early_departure: "Early Departure", absence: "Absence", overtime: "Overtime" });
const STATUS_PARTS = Object.freeze([
  { key: "pending", label: "Pending" },
  { key: "waived", label: "Waived", optional: true },
  { key: "confirmed", label: "Confirmed", optional: true },
  { key: "cut", label: "Cut", optional: true },
  { key: "in_run", label: "In Payroll", optional: true },
]);

/**
 * The deductions and overtime the reader's `people` scope reaches, in figures (PayItemSummaryQuery):
 * every item unless a period (the work date) is asked; by kind stacked by status, by status, by
 * department (20) or person (top 10, minutes), and each side's minutes by month. The amounts are
 * priced from the salary, so a reader who sees them Restricted on the screen is given none (decision
 * 58): the amount figures are left out, never zero.
 * @param {{query: Function}} client
 * @param {object} params   PayItemSummaryQuery, parsed
 * @param {object} actor    the asking person with their `people` scope
 */
async function aiSummary(client, params, actor, now = new Date()) {
  const { figure, group, top, series, askedPeriod, stacked } = require("../../shared/ai/summary");
  const { canSee } = require("../../shared/rbac/field-mask");
  const period = askedPeriod(params, now);
  const dim = params.by === "person" ? "person" : "department";
  const [r, salary] = await Promise.all([
    repo.payItemSummary(client, { ...params, from: period && period.from, to: period && period.to, dim }, actor.scope),
    canSee(client, actor, "employee.salary"),
  ]);
  const f = r.figures;
  const counted = new Map(r.by_status.map((x) => [x.key, x.value]));
  const figures = [
    figure("items", "Items", f.items || 0),
    figure("late", "Late", f.late || 0),
    figure("early_departure", "Early departures", f.early_departure || 0),
    figure("absence", "Absences", f.absence || 0),
    figure("overtime", "Overtime", f.overtime || 0),
    figure("deduction_minutes", "Deduction minutes", f.deduction_minutes || 0, "minutes"),
    figure("overtime_minutes", "Overtime minutes", f.overtime_minutes || 0, "minutes"),
    figure("pending", "Pending", f.pending || 0),
  ];
  if (salary)
    figures.push(
      figure("deduction_amount", "Deductions", m.toWire(f.deduction_amount || "0.00"), "ngn"),
      figure("overtime_amount", "Overtime pay", m.toWire(f.overtime_amount || "0.00"), "ngn"),
    );
  const months = r.months;
  return {
    figures,
    groups: [
      group("kind", "Items by kind", stacked(r.by_kind.map((x) => ({ ...x, label: KIND_WORDS[x.key] || x.key })), STATUS_PARTS)),
      group("status", "Items by status", STATUS_PARTS.filter((x) => counted.has(x.key)).map((x) => ({ key: x.key, label: x.label, value: counted.get(x.key) }))),
      dim === "person" ? top("person", "Minutes by person", r.by_dim) : group("department", "Items by department", r.by_dim),
    ],
    series: [
      series("deduction_minutes", "Deduction minutes by month", months.map((x) => ({ at: x.at, value: x.deduction_minutes }))),
      series("overtime_minutes", "Overtime minutes by month", months.map((x) => ({ at: x.at, value: x.overtime_minutes }))),
    ],
    total: f.items || 0,
  };
}

module.exports = {
  aiSummary,
  DEDUCTIONS,
  KINDS,
  NO_LONGER,
  LEAVE_GRANTED,
  MONTHLY_CAP,
  BEYOND_APPROVAL,
  NOT_PRE_APPROVED,
  shiftMinutes,
  dailyRate,
  hourlyRate,
  deductionAmount,
  overtimeAmount,
  overtimeOutcome,
  capped,
  qualifies,
  ratesFor,
  monthContext,
  monthRates,
  pricesOf,
  takeIntoRun,
  releaseFromRun,
  settleDay,
  present,
  list,
  mine,
  waive,
  decideOvertime,
  approveOvertime,
  cardPerson,
  assertCardOvertime,
};

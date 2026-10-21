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
 * The person's daily and hourly rates for a day: their gross over the month's working days by
 * their own schedule (less public holidays), and over the day's scheduled minutes (on a day not
 * worked, the month's average). Null rates with no gross set.
 */
async function ratesFor(db, person, date, shift) {
  if (person.gross_monthly === null || person.gross_monthly === undefined) return { daily: null, hourly: null };
  const { first, last } = lagos.monthBounds(date);
  const cal = await workingWeek.loadCalendar(db);
  const schedules = await repo.workSchedulesBetween(db, person.employee_id, first, last);
  const hours = await calendar.companyHoursBetween(db, first, last);
  let days = 0;
  let minutes = 0;
  for (let d = first; d <= last; d = lagos.addDays(d, 1)) {
    const schedule = schedules.filter((s) => String(s.effective_from).slice(0, 10) <= d).pop() || null;
    const s = rules.shiftFor(d, cal, { hours: hours[d] }, { schedule, pattern: person.work_pattern });
    if (!s.working_day) continue;
    days += 1;
    minutes += shiftMinutes(s);
  }
  const daily = dailyRate(person.gross_monthly, days);
  const dayMinutes = shift.working_day ? shiftMinutes(shift) : days ? Math.round(minutes / days) : 0;
  return { daily, hourly: hourlyRate(daily, dayMinutes) };
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

module.exports = {
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
  settleDay,
  present,
  list,
  mine,
  waive,
  decideOvertime,
  approveOvertime,
};

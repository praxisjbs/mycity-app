"use strict";
/**
 * The Overview beside its cards: which sections each Home view draws, and the figures in
 * each (docs/guides/home.md §6 Overview, §10.1). The cards are the KPI catalogue's; this
 * file is everything else the Overview shows but Activity Today (dashboard.activity.js) and
 * Need You (GET /workflow/mine, read by the screen). The clock-in prompt is Attendance's
 * (docs/guides/attendance.md §6.14), opened by the shell on whatever screen comes first.
 *
 * WHICH VIEW DRAWS WHAT (code, like the cards' defaults; a role's Home view picks it):
 *
 *   operations    Clocked In under the greeting, the attendance chart (present out of
 *                 expected on each of the last 14 working days, today the last when it is
 *                 one), the On Time donut (this month so far), the Partnership Pipeline
 *                 and Goals This Quarter
 *   ceo           the organisation's goals as the main chart and the Org KPI donut (each
 *                 department beside it), and the Partnership Pipeline; Goals This Quarter
 *                 is the chart, so it is not drawn twice
 *   partnerships  the value signed in each month of this year, counted as the Signed Value
 *                 card counts it, the Partnership Pipeline and Goals This Quarter
 *   staff         the day strip, My Goals This Quarter and Upcoming Leave: a member of
 *                 staff's Overview is their own day
 *   every view    Your Week
 *
 * A section whose module the reader cannot view (their `view` grant, the same one the
 * cards check) is null and is not drawn (home.md §11), and so is a section their view does
 * not draw. A section is read in the reader's scope on its module. A section whose read
 * fails is logged and left null, never drawn as an empty one, as a card is (kpi-catalog
 * guards.js).
 *
 * A goal's progress, a line's score and the Org KPI are Performance's (docs/guides/performance.md
 * §6.21), read through goals.source.js; each is null while nothing behind it is scored.
 *
 * The server sends figures; every title and caption is written on the screen.
 */
const { logger } = require("../../config/logger");
const { PAGE_SIZE } = require("../../shared/http/paged");
const m = require("../../shared/money/money");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const roster = require("../attendance/attendance.roster");
const schedules = require("../attendance/attendance.schedule");
const leave = require("../leave/leave.service");
const organisation = require("../organisation/organisation.service");
const calendar = require("./sources/calendar.source");
const goals = require("./sources/goals.source");
const partners = require("./sources/partners.source");
const tasks = require("./sources/tasks.source");
const { leadBalance } = require("./kpi-catalog/tiles/people");

/** What each Home view draws beside its cards. */
const VIEWS = Object.freeze({
  operations: Object.freeze({
    chart: "attendance_days",
    donut: "on_time",
    clocked_in: true,
    pipeline: true,
    goals: true,
  }),
  ceo: Object.freeze({ chart: "goals", donut: "org_kpi", pipeline: true }),
  partnerships: Object.freeze({
    chart: "signed_value",
    pipeline: true,
    goals: true,
  }),
  staff: Object.freeze({
    day_strip: true,
    my_goals: true,
    upcoming_leave: true,
  }),
});

/** Working days the attendance chart covers. */
const HISTORY_DAYS = 14;

const iso = (at) => (at ? new Date(at).toISOString() : null);

const pathOf = (type, id, opts) => {
  const link = routeMap.linkFor(type, id, opts);
  return link ? link.path : null;
};

/** The first and last day of the calendar quarter `date` is in. */
function quarterOf(date) {
  const { year, month } = lagos.yearMonth(date);
  const first = `${year}-${String(month - ((month - 1) % 3)).padStart(2, "0")}-01`;
  return { from: first, to: lagos.addDays(lagos.addMonths(first, 3), -1) };
}

/**
 * Run one part of the Overview's read; a failure is logged and the part left null.
 * @param {string} part  what it is, named in the log line ("attendance", "activity")
 * @param {() => Promise<*>} read
 */
async function guarded(part, read) {
  try {
    return await read();
  } catch (err) {
    logger.warn({ err, part }, "an Overview part could not be read");
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Attendance: Clocked In, the chart and the On Time donut
 * ------------------------------------------------------------------ */

/**
 * The last HISTORY_DAYS working days up to today (today the last when it is one), oldest
 * first, and the working days of this month so far.
 * @param {string} today
 * @param {import("../../shared/time/working-week").Calendar} cal
 */
function attendanceDays(today, cal) {
  const last = workingWeek.isWorkingDay(today, cal)
    ? today
    : workingWeek.addWorkingDays(today, -1, cal);
  const history = [last];
  while (history.length < HISTORY_DAYS)
    history.unshift(workingWeek.addWorkingDays(history[0], -1, cal));
  const month = [];
  for (
    let d = lagos.monthBounds(today).first;
    d <= today;
    d = lagos.addDays(d, 1)
  )
    if (workingWeek.isWorkingDay(d, cal)) month.push(d);
  return { history, month };
}

/**
 * Who is in today, the last 14 working days and this month so far, each day counted by the
 * shared attendance roster (attendance.roster.js summary) in the reader's `people` scope:
 * the same figures as Clocked In Today and People · Attendance. On time is present and not
 * late; absent is a working day the day-close closed with no clock-in, so today never adds
 * to it. The days are read one after the other, one small read a day for this month and the
 * fortnight before it, so an Overview holds one connection of the pool at a time for them.
 */
async function attendance(client, { today, scopes }) {
  const scope = scopes.get("people");
  const cal = await workingWeek.loadCalendar(client);
  const { history, month } = attendanceDays(today, cal);
  const counts = new Map();
  for (const date of [...new Set([...history, ...month, today])].sort())
    counts.set(date, await roster.summary(client, { date }, scope));
  const sum = (key) => month.reduce((n, date) => n + counts.get(date)[key], 0);
  const sofar = counts.get(today);
  return {
    clocked_in: { present: sofar.present, expected: sofar.expected },
    chart: {
      kind: "attendance_days",
      days: history.map((date) => ({
        date,
        present: counts.get(date).present,
        expected: counts.get(date).expected,
      })),
    },
    donut: {
      kind: "on_time",
      on_time: sum("on_site") + sum("remote") + sum("field"),
      late: sum("late"),
      absent: sum("absent"),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Goals, the Org KPI and the pipeline
 * ------------------------------------------------------------------ */

/**
 * The organisation's goals live this quarter, soonest ending first, at most a page, each with its
 * progress: the mean score of the company objectives serving it, as a percentage (goals.source.js).
 */
async function quarterGoals(client, { today }) {
  const page = await goals.organisationGoals(client, quarterOf(today), {
    page: 1,
  });
  return page.data.map((g) => ({
    title: g.title,
    progress: g.progress ?? null,
    due_on: g.ends_on,
    link: pathOf("goal", g.organisational_goal_id),
  }));
}

/**
 * The Org KPI donut: the company's score this quarter and each active department's function score
 * beside it, as percentages (goals.source.js orgScores: the score Goals shows), null for one with
 * nothing scored; the departments are the organisation's own, the first page of them by name.
 */
async function orgKpi(client, { today }) {
  const [page, scores] = await Promise.all([
    organisation.departments(client, { page: 1, active: "true" }),
    goals.orgScores(client, { today }),
  ]);
  const percentOf = new Map(scores.map((r) => [r.department_id, r.percent]));
  return {
    kind: "org_kpi",
    percent: percentOf.get(null) ?? null,
    departments: page.data.map((d) => ({
      department_id: d.department_id,
      department: d.name,
      percent: percentOf.get(d.department_id) ?? null,
    })),
  };
}

/**
 * The Naira value of the agreements signed in each month of this year, a month with nothing
 * signed at 0.00, in the reader's `partnerships` scope: the agreements the Signed Value card
 * counts, each in the month it starts until M7 records when it was signed
 * (partners.source.js). The year is read whole, as the card reads it, so the months add up
 * to the card; they run to this month, or to a later one an agreement already starts in.
 */
async function signedValue(client, { today, scopes }) {
  const year = today.slice(0, 4);
  const rows = await partners.signedByMonth(
    client,
    { from: `${year}-01-01`, to: `${year}-12-31` },
    scopes.get("partnerships"),
  );
  const signed = new Map(rows.map((r) => [r.month, r.amount]));
  const last = Math.max(
    Number(today.slice(5, 7)),
    ...rows.map((r) => Number(r.month.slice(5, 7))),
  );
  const months = [];
  for (let n = 1; n <= last; n += 1) {
    const month = `${year}-${String(n).padStart(2, "0")}`;
    months.push({
      month,
      amount: m.toWire(signed.has(month) ? signed.get(month) : "0"),
    });
  }
  return { kind: "signed_value", months };
}

/** Open opportunities by stage, in the stages' order, and the active partners gone quiet. */
async function pipeline(client, { today, scopes }) {
  const scope = scopes.get("partnerships");
  const [stages, quiet] = await Promise.all([
    partners.pipelineByStage(client, scope),
    partners.quietCount(client, { today }, scope),
  ]);
  return {
    stages: stages
      .slice(0, PAGE_SIZE)
      .map((s) => ({ stage: s.stage, label: s.label, open: s.open })),
    quiet_30d: quiet,
  };
}

/* ------------------------------------------------------------------ *
 * A member of staff's own day
 * ------------------------------------------------------------------ */

/**
 * The day strip: today's hours by the reader's own work schedule (attendance.schedule.js dayOn,
 * none on a day they do not work), and their own row of today's roster (its status, clock-in,
 * clock-out and the worksite of the clock-in, none when they work remotely or are not in). Hours
 * Today is the day's worked minutes as Attendance records them: a System Clock-Out counts only to
 * the shift's end, and there are none until they clock out.
 */
async function dayStrip(client, { user, today }) {
  const shift = user.employee_id ? await schedules.dayOn(client, user.employee_id, today) : null;
  const own = { scope: "own", scope_ids: [user.employee_id] };
  const row =
    (await roster.page(client, { date: today }, own, { page: 1 })).data[0] ||
    null;
  return {
    starts_at: shift ? shift.starts_at : null,
    ends_at: shift ? shift.ends_at : null,
    clock_in_at: iso(row && row.clock_in_at ? new Date(row.clock_in_at) : null),
    clock_out_at: iso(row && row.clock_out_at ? new Date(row.clock_out_at) : null),
    status: row ? row.status : null,
    worksite: row ? row.worksite : null,
    worked_minutes: row && row.clock_out_at ? Number(row.worked_minutes) || 0 : 0,
  };
}

/** The reader's own targets due this quarter, soonest first, at most a page, each with its score from closed reviews as a percentage. */
async function myGoals(client, { user, today }) {
  const page = await goals.targetsOf(
    client,
    { employee_id: user.employee_id, ...quarterOf(today) },
    { page: 1 },
  );
  return page.data.map((t) => ({
    title: t.title,
    progress: t.progress ?? null,
    due_on: t.due_on,
    link: pathOf("target", t.employee_target_id, { self: true }),
  }));
}

/**
 * The reader's own leave still ahead, waiting or granted, soonest first, as the leave
 * module shapes a request; and what is left this year of the type My Leave leads with
 * (Annual, else the first type with an allowance), the figure My Leave shows.
 */
async function upcomingLeave({ user, today }) {
  const ahead = (status) =>
    leave.listFor(user.employee_id, { status, from: today, page: 1 });
  const [waiting, granted, year] = await Promise.all([
    ahead("submitted"),
    ahead("approved"),
    leave.balancesFor(user.employee_id, Number(today.slice(0, 4))),
  ]);
  const requests = [...waiting.data, ...granted.data]
    .sort(
      (a, b) =>
        a.starts_on.localeCompare(b.starts_on) ||
        a.leave_request_id.localeCompare(b.leave_request_id),
    )
    .slice(0, PAGE_SIZE);
  const lead = leadBalance(year.balances);
  return {
    balance:
      lead && lead.remaining !== null
        ? {
            leave_type_id: lead.leave_type_id,
            name: lead.name,
            remaining: lead.remaining,
          }
        : null,
    requests,
  };
}

/* ------------------------------------------------------------------ *
 * Your Week
 * ------------------------------------------------------------------ */

/** Items of a day in their order: all-day first, then by time, then by title. */
const byTime = (a, b) =>
  (a.at || "").localeCompare(b.at || "") || a.title.localeCompare(b.title);

/**
 * This week's working days of the reader's own schedule, Monday first (the days their work
 * schedule, else the company hours, works: attendance.schedule.js dayOn; a public holiday among
 * them named and given no hours), each with its hours, whether the reader's granted leave
 * covers it, and their own calendar events and the tasks due on it (the M2 sources; only for a
 * reader who may view My Workspace). Each day reads its own page of events and of tasks, the
 * days side by side, so a busy Monday never takes Friday's place: an event shows on the day it
 * starts, one that began before Monday on Monday.
 */
async function week(client, { user, today, scopes }) {
  const cal = await workingWeek.loadCalendar(client);
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));
  const sunday = lagos.addDays(monday, 6);
  const workspace = scopes.has("workspace");
  // A public holiday stays in the week, named and given no hours, on a day the person's week works.
  const noHolidays = { ...cal, holidays: new Set(), holidayNames: new Map() };
  const dates = [];
  const shifts = new Map();
  for (let d = monday; d <= sunday; d = lagos.addDays(d, 1)) {
    if (!user.employee_id) {
      if (cal.days.has(lagos.weekday(d))) dates.push(d);
      continue;
    }
    const shift = await schedules.dayOn(client, user.employee_id, d, { calendar: cal });
    const works =
      shift.working_day ||
      (cal.holidays.has(d) && (await schedules.dayOn(client, user.employee_id, d, { calendar: noHolidays })).working_day);
    if (!works) continue;
    dates.push(d);
    shifts.set(d, shift);
  }

  /** One working day's events and tasks, at most a page of each. */
  async function itemsOn(d) {
    if (!workspace) return [];
    const span = {
      employee_id: user.employee_id,
      from: lagos.startOfDay(d),
      to: lagos.endOfDayExclusive(d),
    };
    const [events, due] = await Promise.all([
      calendar.eventsStarting(
        client,
        { ...span, running: d === monday },
        { page: 1 },
      ),
      tasks.dueBetween(client, span, { page: 1 }),
    ]);
    return [
      ...events.data.map((e) => ({
        kind: "event",
        title: e.title,
        at: e.all_day ? null : iso(e.starts_at),
        link: pathOf("calendar_event", e.calendar_event_id),
      })),
      ...due.data.map((t) => ({
        kind: "task",
        title: t.title,
        at: iso(t.due_at),
        link: pathOf("task", t.task_id),
      })),
    ]
      .sort(byTime)
      .slice(0, PAGE_SIZE);
  }

  // One day at a time (each day's two reads together), so an Overview holds few connections of
  // the pool for its week, as attendance() does for its days.
  async function everyDay() {
    const out = [];
    for (const d of dates) out.push(await itemsOn(d));
    return out;
  }

  const [granted, items] = await Promise.all([
    leave.listFor(user.employee_id, {
      status: "approved",
      from: monday,
      to: sunday,
      page: 1,
    }),
    everyDay(),
  ]);
  return dates.map((d, i) => {
    const hours = shifts.get(d) || roster.dayOf(d, cal);
    return {
      date: d,
      starts_at: hours.starts_at,
      ends_at: hours.ends_at,
      holiday: cal.holidays.has(d) ? cal.holidayNames.get(d) : null,
      on_leave: granted.data.some((l) => l.starts_on <= d && l.ends_on >= d),
      items: items[i],
    };
  });
}

/* ------------------------------------------------------------------ *
 * The sections, together
 * ------------------------------------------------------------------ */

/**
 * Every section of the reader's Overview but its cards and Activity Today (HomeOverview), each
 * null when it is not drawn.
 * @param {{query: Function}} client
 * @param {{user: object, view: string, today: string, scopes: Map<string, object>}} reader
 *   view    their Home view (/me home_view)
 *   scopes  their scope on each module they may view (eligibility.forUser)
 */
async function sectionsFor(client, reader) {
  const v = VIEWS[reader.view] || VIEWS.staff;
  const may = (module) => reader.scopes.has(module);
  const when = (drawn, part, read) => (drawn ? guarded(part, read) : null);
  const fromRoster =
    v.chart === "attendance_days" ||
    v.donut === "on_time" ||
    v.clocked_in === true;

  const [roll, goalList, kpis, signed, pipe, strip, mine, ahead, days] =
    await Promise.all([
      when(fromRoster && may("people"), "attendance", () =>
        attendance(client, reader),
      ),
      when(
        (v.chart === "goals" || v.goals === true) && may("performance"),
        "goals",
        () => quarterGoals(client, reader),
      ),
      when(v.donut === "org_kpi" && may("performance"), "org_kpi", () =>
        orgKpi(client, reader),
      ),
      when(
        v.chart === "signed_value" && may("partnerships"),
        "signed_value",
        () => signedValue(client, reader),
      ),
      when(v.pipeline === true && may("partnerships"), "pipeline", () =>
        pipeline(client, reader),
      ),
      when(v.day_strip === true && may("ess"), "day_strip", () =>
        dayStrip(client, reader),
      ),
      when(v.my_goals === true && may("ess"), "my_goals", () =>
        myGoals(client, reader),
      ),
      when(v.upcoming_leave === true && may("ess"), "upcoming_leave", () =>
        upcomingLeave(reader),
      ),
      guarded("week", () => week(client, reader)),
    ]);

  const charts = {
    attendance_days: roll && roll.chart,
    goals: goalList && {
      kind: "goals",
      goals: goalList.map(({ title, progress, link }) => ({
        title,
        progress,
        link,
      })),
    },
    signed_value: signed,
  };
  const donuts = { on_time: roll && roll.donut, org_kpi: kpis };
  return {
    clocked_in: v.clocked_in === true && roll ? roll.clocked_in : null,
    chart: (v.chart && charts[v.chart]) || null,
    donut: (v.donut && donuts[v.donut]) || null,
    day_strip: strip,
    pipeline: pipe,
    goals: v.goals === true ? goalList : null,
    my_goals: mine,
    upcoming_leave: ahead,
    week: days,
  };
}

module.exports = {
  VIEWS,
  HISTORY_DAYS,
  quarterOf,
  attendanceDays,
  guarded,
  dayStrip,
  sectionsFor,
};
